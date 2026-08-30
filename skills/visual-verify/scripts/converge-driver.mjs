/* ---------------------------------------------------------------------------
 * converge-driver.mjs — the wait-for-convergence capture mode's engine.
 * Invoked by converge.sh, which owns arg parsing and browser discovery.
 *
 *   node converge-driver.mjs --browser <path> --url <url> --out <dir>
 *        --offsets 0,600,1200 [--viewport 1280x800] [--dpr 1]
 *        [--settle-timeout 4000] [--dwell 180] [--poll 60]
 *        [--dead-scroll-delta 0.25] [--cue-threshold 0.8]
 *        [--cues '.headline,.sub'] [--require '.nav'] [--fonts '700 16px "Inter"']
 *        [--reduced-motion] [--full-page]
 *
 * WHY THIS IS NOT settle-template.js
 *   settle-template.js KILLS the animation engine and force-writes final
 *   values. That is the right tool for the END STATE of one page, and it is
 *   structurally blind to every intermediate state. This file is the opposite
 *   strategy: let the page run in real time and WAIT for it to arrive, once per
 *   sampled position, so a timeline can be verified at many points. Neither
 *   replaces the other — see SKILL.md section 3.
 *
 * WHY CDP AND NOT --screenshot
 *   Chromium's --screenshot fires on its own schedule; there is no way to say
 *   "shoot now, I have decided the page is ready". A convergence wait needs a
 *   live session, so this speaks the DevTools protocol over node's BUILT-IN
 *   WebSocket + fetch (node >= 22). No npm dependency is added — playwright is
 *   NOT installed on this machine (only its browser cache is), and adding it
 *   just to poll a predicate would be a heavy dependency for a skill whose
 *   other scripts are plain bash.
 *
 * WHY REAL TIME, NOT --virtual-time-budget
 *   Verified empirically (Chromium 151, headless): under
 *   --virtual-time-budget every animation reports playState "running" with
 *   currentTime pinned at 0 FOREVER — virtual time does not feed the animation
 *   clock. A convergence wait under virtual time can therefore never converge.
 *   This mode runs the page in real wall-clock time; that is why it is slower
 *   than render.sh, and why it is the only mode that can see a timeline.
 * ------------------------------------------------------------------------- */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// --- args -------------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i === -1 || i === argv.length - 1 ? dflt : argv[i + 1];
};
const flag = (name) => argv.includes('--' + name);

const BROWSER = arg('browser');
const URL_IN = arg('url');
const OUT = arg('out');
if (!BROWSER || !URL_IN || !OUT) {
  console.error('converge-driver.mjs: --browser, --url and --out are all required');
  process.exit(2);
}
const OFFSETS = String(arg('offsets', '')).split(',').map((s) => s.trim()).filter(Boolean).map(Number);
const [VW, VH] = String(arg('viewport', '1280x800')).split('x').map(Number);
const DPR = Number(arg('dpr', 1));
const SETTLE_TIMEOUT = Number(arg('settle-timeout', 4000));
const DWELL = Number(arg('dwell', 180));
const POLL = Number(arg('poll', 60));
const DEAD_DELTA = Number(arg('dead-scroll-delta', 0.25));
const CUE_THRESHOLD = Number(arg('cue-threshold', 0.8));
const CUES = arg('cues', '');
const IGNORE_MOTION = arg('ignore-motion', '');
const REQUIRE = arg('require', '');
const FONTS = arg('fonts', '');
const REDUCED = flag('reduced-motion');
const FULL_PAGE = flag('full-page');
const STEPS = Number(arg('steps', 0));

const toUrl = (u) =>
  /^(https?|file):\/\//.test(u) ? u : u.startsWith('/') ? 'file://' + u : 'file://' + join(process.cwd(), u);
const URL_ = toUrl(URL_IN);

mkdirSync(OUT, { recursive: true });

// --- CDP over node's built-in WebSocket -------------------------------------
const profile = mkdtempSync(join(tmpdir(), 'vvconverge'));
let child = null;
let ws = null;

function launch() {
  const flags = [
    '--headless=new',
    '--disable-gpu',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--user-data-dir=${profile}`,
    // Port 0 = let the OS pick a free one, then read it back from
    // DevToolsActivePort. Deriving a port from the pid collides as soon as two
    // runs overlap, and the failure looks like "the browser did not start".
    '--remote-debugging-port=0',
  ];
  if (REDUCED) flags.push('--force-prefers-reduced-motion');
  flags.push('about:blank');
  return spawn(BROWSER, flags, { stdio: ['ignore', 'ignore', 'pipe'] });
}

async function devtoolsPort() {
  const f = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 200; i++) {
    if (existsSync(f)) {
      const first = readFileSync(f, 'utf8').split('\n')[0];
      if (first && first.trim()) return first.trim();
    }
    await sleep(50);
  }
  throw new Error('browser never wrote DevToolsActivePort — it failed to start');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 0;
const pending = new Map();

function send(method, params = {}, sessionId) {
  return new Promise((res, rej) => {
    const id = ++msgId;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

// --- the convergence predicate ---------------------------------------------
//
// Upstream scroll-craft polls its OWN engine's objects:
//
//   clips.every((c) => Math.abs(c.cur - c.target) < 0.002 && !c.el.seeking)
//
// which is worthless off that engine's generated pages. This is the
// standards-based equivalent, over document.getAnimations() + the media
// elements. Every animation is sorted into exactly ONE bucket, and only the
// 'moving' bucket blocks the capture. Every other non-'settled' bucket is
// REPORTED, because each one means the frame is settled for a reason the
// reader of the report needs to know.
//
// Every claim below was verified empirically against Chromium 151 headless
// before it was relied on; the two that would otherwise have produced a
// silent wrong answer are called out inline.
const PREDICATE = `(function (prevMap, timelineAdvanced) {
  function classify(a) {
    var tl = a.timeline;

    // 1. PROGRESS-DRIVEN (scroll() / view() timelines). Converged BY
    //    CONSTRUCTION once the scroll position is fixed: its playhead is a pure
    //    function of scrollTop, so at a stopped offset it is exactly where the
    //    reader would see it. It also NEVER reports playState 'finished'.
    //
    //    This must be tested FIRST. Verified: a scroll-timeline animation
    //    reports endTime as the CSSUnitValue "100%", so Number(endTime) is NaN
    //    and Number.isFinite() is false — an endless-check that ran first would
    //    misfile every healthy scroll-driven page as "endless, phase arbitrary"
    //    and quietly discard the one guarantee this mode can actually give.
    var progress = false;
    try {
      if (typeof ScrollTimeline !== 'undefined' && tl instanceof ScrollTimeline) progress = true;
      if (typeof ViewTimeline !== 'undefined' && tl instanceof ViewTimeline) progress = true;
    } catch (e) {}
    if (!progress && tl && typeof document !== 'undefined' && tl !== document.timeline) {
      // Unknown non-document timeline: treat as progress-driven rather than
      // waiting on a clock we cannot reason about, and say so in the bucket.
      progress = true;
    }
    if (progress) return 'progress';

    // 2. Genuinely done. 'finished' is verified; 'idle' is defensive — it was
    //    never observed in the probes, and is included because the spec lists
    //    it as a terminal non-advancing state.
    if (a.playState === 'finished' || a.playState === 'idle') return 'settled';

    // 3. Paused: will never advance on its own, so waiting is pointless. Not
    //    silently accepted — a paused animation means this frame shows an
    //    arbitrary phase of it, which the report has to say.
    if (a.playState === 'paused') return 'held';

    // 4. Endless by construction (animation-iteration-count: infinite).
    //    Verified: getComputedTiming().endTime === Infinity, and the animation
    //    stays playState 'running' with currentTime advancing forever while its
    //    .finished promise NEVER resolves (probed: still pending after 1500ms).
    //    Waiting on it is the hang the task warned about, so it is excluded
    //    from the wait and reported instead.
    //
    //    Infinity is read as a BOOLEAN here, in-page, on purpose:
    //    JSON.stringify({x: Infinity}) is '{"x":null}', so shipping the raw
    //    value out over CDP would silently turn Infinity into null.
    var ct = null;
    try { ct = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null; } catch (e) {}
    if (ct && !Number.isFinite(Number(ct.endTime))) return 'endless';

    // 5. Finite, 'running', but its playhead did not move since the previous
    //    poll — a stuck animation, the general form of upstream's "frozen
    //    clip". Only trustworthy when the DOCUMENT TIMELINE itself advanced
    //    between the two polls: verified that document.timeline.currentTime
    //    read twice inside one evaluation returns the IDENTICAL value, because
    //    it ticks per animation frame, not per millisecond. Without that gate
    //    two polls landing in the same frame tick make every animation look
    //    quiet and fire convergence mid-flight — early, and silently.
    var key = keyOf(a);
    if (timelineAdvanced && prevMap && Object.prototype.hasOwnProperty.call(prevMap, key)
        && prevMap[key] === String(a.currentTime)) return 'stuck';

    return 'moving';
  }

  function keyOf(a) {
    var t = a.effect && a.effect.target;
    var id = t ? (t.id || t.tagName + '.' + String(t.className).split(' ')[0]) : '?';
    return (a.animationName || a.transitionProperty || 'waapi') + '@' + id;
  }

  var anims = document.getAnimations();
  var buckets = { progress: [], settled: [], held: [], endless: [], stuck: [], moving: [] };
  var nowMap = {};
  for (var i = 0; i < anims.length; i++) {
    var a = anims[i];
    nowMap[keyOf(a)] = String(a.currentTime);
    buckets[classify(a)].push(keyOf(a));
  }

  // Media elements are a SEPARATE axis: HTMLMediaElement.seeking and
  // .readyState are the analogue of upstream's !c.el.seeking. Verified both
  // properties exist. An element with no resolvable source is skipped, not
  // waited on — a src-less <video> reports readyState 0 (HAVE_NOTHING)
  // permanently and would otherwise block every single sample forever.
  var media = [];
  var mediaBlocking = [];
  var els = document.querySelectorAll('video, audio');
  for (var m = 0; m < els.length; m++) {
    var v = els[m];
    var hasSrc = !!(v.currentSrc || v.src || v.querySelector('source'));
    var rec = { tag: v.tagName.toLowerCase(), id: v.id || '', hasSrc: hasSrc,
                seeking: !!v.seeking, readyState: v.readyState,
                t: Number((v.currentTime || 0).toFixed(3)) };
    media.push(rec);
    // HAVE_CURRENT_DATA (2) is the floor for "there is a frame to paint".
    if (hasSrc && (v.seeking || v.readyState < 2)) mediaBlocking.push(rec.tag + '#' + rec.id);
  }

  return {
    converged: buckets.moving.length === 0 && mediaBlocking.length === 0,
    buckets: buckets,
    nowMap: nowMap,
    media: media,
    mediaBlocking: mediaBlocking,
    timelineNow: String(document.timeline.currentTime)
  };
})`;

// --- session ----------------------------------------------------------------
let sessionId = null;

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error('in-page: ' + (d.exception?.description || d.text));
  }
  return r.result.value;
}

/* Wait for the page to arrive at the current scroll position.
 *
 * ON TIMEOUT IT REPORTS AND PROCEEDS — it never hangs and never lies. The
 * sample is still captured, `settled` is recorded as false, and the names of
 * the animations still in the 'moving' bucket go into report.json and onto
 * stderr. A capture mode that silently proceeded would hand you a mid-tween
 * frame labelled as settled, which is the exact defect this whole mode exists
 * to remove; one that hung would be worse. So: capture, mark, and say which. */
async function waitForConvergence() {
  // MANDATORY pre-poll dwell. Scroll-narrative reveals are usually
  // IntersectionObserver-triggered, and that callback lands a frame or more
  // AFTER scrollTo returns. Poll immediately and getAnimations() is still an
  // EMPTY list, which satisfies the predicate trivially — you capture the
  // pre-reveal frame and call it settled. Two rAFs plus a fixed delay is what
  // keeps that from happening.
  await evaluate('new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r)})})');
  await sleep(DWELL);

  const t0 = Date.now();
  let prevMap = null;
  let prevTimeline = null;
  let last = null;
  let polls = 0;

  for (;;) {
    const snap = await evaluate(
      `${PREDICATE}(${JSON.stringify(prevMap)}, ${JSON.stringify(prevTimeline !== null)})`
    );
    polls++;
    last = snap;

    // Only treat "unchanged currentTime" as meaningful once we know the
    // document timeline moved between these two polls.
    const advanced = prevTimeline !== null && snap.timelineNow !== prevTimeline;
    if (snap.converged && (advanced || polls > 1)) {
      return { settled: true, polls, waitedMs: Date.now() - t0, snap };
    }
    if (Date.now() - t0 > SETTLE_TIMEOUT) {
      return { settled: false, polls, waitedMs: Date.now() - t0, snap, timedOut: true };
    }
    prevMap = advanced || prevTimeline === null ? snap.nowMap : prevMap;
    prevTimeline = snap.timelineNow;
    await sleep(POLL);
  }
}

// --- multi-sample checks ----------------------------------------------------
//
// These two CANNOT live in checks.js. That file is injected into one DOM at one
// instant and reports what that instant supports; both of these are statements
// about the RELATIONSHIP BETWEEN samples, so they live where the multi-sample
// data actually exists rather than being forced into the wrong file.
// Return shape mirrors the checks.js family: {total, count, offenders}, with
// `count` the TRUE uncapped count and `offenders` capped (see the INTENT note
// in checks.js).
const CAP = 12;

/* checkDeadScroll — consecutive samples whose visible state is IDENTICAL
 * across a large scroll delta. The reader scrolled a whole viewport and was
 * shown nothing new.
 *
 * The signature deliberately generalises upstream's hand-rolled one. Upstream
 * lists cue opacities, clip times, rail transforms, wipe clip-paths and stage
 * offsets because its engine writes those itself. document.getAnimations()
 * already reports every animation's playhead — including scroll-driven ones,
 * which on a scroll narrative is where most of the motion lives — so the
 * animation phases replace rails/wipes/stages wholesale. Inline transforms and
 * clip-paths are still sampled separately, because a library that writes them
 * directly (GSAP) creates no Animation object at all.
 *
 * A finding here is Measured (two signatures are byte-identical — rerun it and
 * you get the same answer). Whether it is a DEFECT is Inferred: a footer or a
 * flow section that holds still across two samples is a page behaving
 * correctly. Triage each pair; widen --dead-scroll-delta if the sampling is
 * simply too dense. */
function checkDeadScroll(samples, viewportH, deltaFrac) {
  const parts = {
    cues: (s) => JSON.stringify(s.cues.map((c) => c.text + ':' + c.opacity)),
    visibleText: (s) => JSON.stringify(s.visibleText || []),
    sigPhases: (s) => JSON.stringify(s.sigPhases),
    transforms: (s) => JSON.stringify(s.transforms),
    mediaTimes: (s) => JSON.stringify(s.mediaTimes),
  };
  const keys = Object.keys(parts);
  const sigOf = (s, skip) => JSON.stringify(
    keys.filter((k) => !(skip || []).includes(k)).map((k) => parts[k](s)));

  const minDelta = viewportH * deltaFrac;
  const pairs = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    // ACTUAL scroll position, never the requested offset. An offset past the
    // end of the document clamps silently, so two requested offsets 900px
    // apart can be the same pixel — comparing requested values would call that
    // a 900px gap and report a false dead-scroll finding.
    const delta = b.actualY - a.actualY;
    // Two samples a few dozen pixels apart SHOULD look the same. Only a gap
    // wide enough for the reader to notice nothing happening is a finding.
    if (delta < minDelta) continue;
    pairs.push({ a, b, delta });
  }

  const offenders = pairs.filter((p) => sigOf(p.a, null) === sigOf(p.b, null)).map((p) => ({
    from: p.a.name, to: p.b.name, fromY: p.a.actualY, toY: p.b.actualY,
    deltaPx: p.delta, deltaViewports: Number((p.delta / viewportH).toFixed(2)),
  }));

  // MASKING. Two criteria, both required, because either alone is wrong:
  //
  //   1. The component differs on EVERY compared pair. That is the signature of
  //      state which changes by construction rather than because the page told
  //      a story — a document-wide scroll-progress bar advances at every
  //      offset, so it separates every pair no matter how inert the region is.
  //      Without this criterion `cues` gets reported, which is noise: cue
  //      changes ARE the narrative, and removing them manufactures findings.
  //   2. Dropping it surfaces a finding the full signature missed. That is what
  //      makes the report actionable rather than a guess.
  //
  // Ablation is over SUBSETS, not single components, because one offending
  // element usually contributes to several: a scroll-driven progress bar shows
  // up in sigPhases (its animation playhead) AND transforms (its computed
  // matrix), so dropping either one alone still leaves the other separating
  // every pair, and a single-component test finds nothing while the check is
  // fully masked. Observed on the fixture before this was subset-based.
  //
  // Why any of this exists: a masked check reports a clean pass over a
  // completely inert region. "Checked, nothing to do" and "could not check"
  // must never look the same.
  // Needs at least TWO compared pairs: with one pair "differs on every pair"
  // is trivially true of whatever changed, which is not evidence of anything.
  const differsEverywhere = keys.filter((k) =>
    pairs.length > 1 && pairs.every((p) => parts[k](p.a) !== parts[k](p.b)));

  const masking = [];
  if (differsEverywhere.length) {
    // Prefer the smallest subset that actually unmasks something.
    const subsets = [];
    for (let mask = 1; mask < (1 << differsEverywhere.length); mask++) {
      const sub = differsEverywhere.filter((_, i) => mask & (1 << i));
      subsets.push(sub);
    }
    subsets.sort((a, b) => a.length - b.length);
    for (const sub of subsets) {
      const extra = pairs.filter((p) => sigOf(p.a, sub) === sigOf(p.b, sub));
      if (extra.length > offenders.length) {
        masking.push({
          components: sub,
          wouldFind: extra.length - offenders.length,
          examples: extra.slice(0, 3).map((p) => `${p.a.name} -> ${p.b.name}`),
        });
        break;
      }
    }
  }

  return {
    total: pairs.length,
    count: offenders.length,
    minDeltaPx: Math.round(minDelta),
    scope: 'multi-sample',
    masking,
    offenders: offenders.slice(0, CAP),
  };
}

/* checkWeakCuesPeak — the whole-timeline rollup of checks.js's per-sample
 * checkWeakCues. A cue is only weak if it never reaches the threshold on ANY
 * sampled frame, so this takes the MAX per cue across the run. This is the
 * claim "never reaches 0.8" that a single sample cannot make. */
function checkWeakCuesPeak(samples, threshold, declared) {
  const peak = new Map();
  for (const s of samples) {
    for (const c of s.cues) {
      // Key on selector AND text. Keying on text alone collapses repeated
      // strings: two "Learn more" links, one arriving and one stuck at 0.4,
      // would share a bucket and the healthy one's max would hide the broken
      // one — a false negative in exactly the claim this check exists to make.
      const k = c.selector + '|' + c.text;
      const cur = peak.get(k);
      if (!cur || c.opacity > cur.opacity) peak.set(k, { ...c });
    }
  }
  const all = [...peak.values()];
  const offenders = all
    .filter((c) => c.opacity > 0.02 && c.opacity < threshold)
    .map((c) => ({ selector: c.selector, text: c.text, peak: c.opacity, threshold }));
  return {
    total: all.length,
    count: offenders.length,
    threshold,
    scope: 'multi-sample-peak',
    mode: declared ? 'declared' : 'animated-opacity-heuristic',
    offenders: offenders.slice(0, CAP),
  };
}

// --- per-sample state capture ----------------------------------------------
//
// THE SIGNATURE RULE: a dead-scroll signature may contain ONLY state that is a
// deterministic function of SCROLL POSITION. Anything driven by the wall clock
// makes every sample accidentally unique and silently disables the check.
//
// This was not theoretical — it was the first real run's result. The fixture's
// decorative `animation: spin 900ms infinite` reported playheads of 1662, 2009,
// 2317, 2591... across five samples, so every consecutive pair differed and
// checkDeadScroll found nothing on a page with a deliberately inert 1820px
// region in it. One decorative spinner anywhere on the page would have
// suppressed the check globally, and it would have looked like a pass.
//
// So an animation contributes to the signature only when its playhead is
// scroll-deterministic:
//   * progress-driven (scroll()/view() timeline) -> phase is f(scrollTop)
//   * time-driven AND in a terminal state (finished / idle / paused)
//     -> phase is pinned, so it is stable across samples
//   * time-driven AND running (endless, or still in flight) -> EXCLUDED
// The same rule governs the transform/clip-path sample and the media times.
// Full diagnostic phases are still recorded separately for the report.
const STATE = `(function () {
  function keyOf(a) {
    var t = a.effect && a.effect.target;
    var id = t ? (t.id || t.tagName) : '?';
    return (a.animationName || a.transitionProperty || 'waapi') + '@' + id;
  }
  function isProgress(a) {
    var tl = a.timeline;
    try {
      if (typeof ScrollTimeline !== 'undefined' && tl instanceof ScrollTimeline) return true;
      if (typeof ViewTimeline !== 'undefined' && tl instanceof ViewTimeline) return true;
    } catch (e) {}
    return !!(tl && tl !== document.timeline);
  }
  function isTerminal(a) {
    return a.playState === 'finished' || a.playState === 'idle' || a.playState === 'paused';
  }
  function isDeterministic(a) { return isProgress(a) || isTerminal(a); }

  // Global chrome (a document-wide scroll-progress bar, a parallax backdrop)
  // moves at EVERY scroll position by construction, so leaving it in the
  // signature makes every pair of samples unique and dead-scroll detection can
  // never fire anywhere on the page. A standards-based check cannot tell
  // narrative motion from chrome on its own, so this is author-declared.
  var IGNORE = window.__IGNORE_MOTION || [];
  function ignored(el) {
    if (!el || !IGNORE.length) return false;
    for (var q = 0; q < IGNORE.length; q++) {
      try { if (el.closest(IGNORE[q])) return true; } catch (e) {}
    }
    return false;
  }

  var cues = (window.__vvChecks && window.__vvChecks.cueSample)
    ? window.__vvChecks.cueSample()
    : [];

  var anims = document.getAnimations();
  var phases = [];      // diagnostics: every animation, for the report
  var sigPhases = [];   // signature: scroll-deterministic playheads only
  var excluded = [];    // named, so a suppressed check is never a silent pass
  for (var i = 0; i < anims.length; i++) {
    var a = anims[i];
    var entry = keyOf(a) + '=' + String(a.currentTime);
    phases.push(entry);
    var tgt = a.effect && a.effect.target;
    if (ignored(tgt)) excluded.push(keyOf(a) + ' (ignore-motion)');
    else if (isDeterministic(a)) sigPhases.push(entry);
    else excluded.push(keyOf(a));
  }
  phases.sort(); sigPhases.sort(); excluded.sort();

  // A library that writes transforms/clip-paths directly (GSAP, or any
  // hand-rolled rAF tween) creates NO Animation object, so sigPhases cannot
  // see it. Sample the computed values too — but skip any element carrying a
  // live wall-clock animation, whose transform is f(time), not f(scroll).
  // Capped at 40 elements in document order to keep the signature bounded.
  var tf = [];
  var all = document.querySelectorAll('*');
  for (var j = 0; j < all.length && tf.length < 40; j++) {
    var el = all[j];
    var cs = getComputedStyle(el);
    if (cs.transform === 'none' && cs.clipPath === 'none') continue;
    if (ignored(el)) continue;
    var live = false;
    try {
      var ea = el.getAnimations({ subtree: false });
      for (var k = 0; k < ea.length; k++) if (!isDeterministic(ea[k])) { live = true; break; }
    } catch (e) {}
    if (live) continue;
    tf.push((el.id || el.tagName) + '|' + cs.transform + '|' + cs.clipPath);
  }

  // Only PAUSED media. A scroll-scrubbed video is paused and seeked, so its
  // currentTime is f(scrollTop) and belongs in the signature (this is the
  // generalisation of upstream's video[data-sc-scrub] selector). An autoplaying
  // background loop advances on the wall clock and must stay out.
  // VISIBLE CONTENT FINGERPRINT. Without this the signature only tracks
  // animated state, so ORDINARY CONTENT SCROLLING PAST IS INVISIBLE to it —
  // two samples showing completely different headings compare as identical and
  // the check reports dead scroll on a page that is simply scrolling. Caught by
  // looking at the contact sheet: a frame showing a heading and a blank frame
  // were called identical.
  //
  // This also gives the generalised check the right behaviour in BOTH regimes,
  // which is what upstream gets by restricting itself to pinned acts:
  //   * pinned / sticky region — text is held in place, so this stays constant
  //     and a genuine hold is still detectable through the cues and animations
  //   * flow region — text moves, so the fingerprint changes and normal
  //     scrolling is correctly NOT reported as dead
  // Position is part of it on purpose: a stage sliding up the screen while its
  // progress is still clamped is motion the reader sees.
  var vis = [];
  for (var v2 = 0; v2 < all.length && vis.length < 40; v2++) {
    var e2 = all[v2];
    var direct = '';
    for (var n2 = 0; n2 < e2.childNodes.length; n2++) {
      var nd = e2.childNodes[n2];
      if (nd.nodeType === 3 && nd.textContent.trim()) { direct = nd.textContent.trim(); break; }
    }
    if (!direct) continue;
    var cs2 = getComputedStyle(e2);
    if (cs2.display === 'none' || cs2.visibility === 'hidden') continue;
    var r2 = e2.getBoundingClientRect();
    if (r2.width <= 0 || r2.height <= 0) continue;
    if (r2.bottom < 0 || r2.top > innerHeight) continue;
    // Rounded to 10px: sub-pixel drift is not something a reader notices.
    // NOTE the DOUBLE backslash: this code lives in a JS template literal, where
    // a lone \s is an unrecognised escape that silently collapses to plain "s".
    // Written singly, this ran as /s+/g and replaced every letter s in the page's
    // text with a space ("a slow reveal" -> "a  low reveal"). It corrupted only
    // the signature's own text keys, so it degraded the comparison without
    // erroring. Any regex added to this block or to PREDICATE needs the same care.
    vis.push(direct.replace(/\\s+/g, ' ').slice(0, 24) + '@' + Math.round(r2.top / 10) * 10);
  }

  var mt = [];
  var mtAll = [];
  document.querySelectorAll('video, audio').forEach(function (v) {
    var e = (v.id || v.tagName) + '=' + Number((v.currentTime || 0).toFixed(3));
    mtAll.push(e);
    if (v.paused) mt.push(e);
  });

  return {
    cues: cues,
    visibleText: vis,
    animationPhases: phases,
    sigPhases: sigPhases,
    sigExcluded: excluded,
    transforms: tf,
    mediaTimes: mt,
    mediaTimesAll: mtAll,
    scrollY: Math.round(window.scrollY),
    docHeight: document.documentElement.scrollHeight,
    viewportH: window.innerHeight
  };
})()`;

// --- main -------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
const consoleErrors = [];

async function main() {
  child = launch();
  child.stderr.on('data', () => {});
  const port = await devtoolsPort();
  const info = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();

  ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP websocket failed')); });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || 'exception');
    }
  };

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride',
    { width: VW, height: VH, deviceScaleFactor: DPR, mobile: false }, sessionId);
  if (REDUCED) {
    await send('Emulation.setEmulatedMedia',
      { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
  }

  // Load, then splice in checks.js so cueSample() is available per sample.
  // The page file itself is never modified — this is the same "never edit the
  // source" rule the other scripts follow, applied via CDP instead of a copy.
  const loaded = new Promise((res) => {
    const h = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Page.loadEventFired') { ws.removeEventListener('message', h); res(); }
    };
    ws.addEventListener('message', h);
  });
  await send('Page.navigate', { url: URL_ }, sessionId);
  await Promise.race([loaded, sleep(15000)]);

  const globals = [
    CUES ? `window.__CUES=${JSON.stringify(CUES.split(',').map((s) => s.trim()).filter(Boolean))};` : '',
    REQUIRE ? `window.__REQUIRE=${JSON.stringify(REQUIRE.split(',').map((s) => s.trim()).filter(Boolean))};` : '',
    FONTS ? `window.__FONTS=${JSON.stringify(FONTS.split('|').map((s) => s.trim()).filter(Boolean))};` : '',
    `window.__CUE_THRESHOLD=${CUE_THRESHOLD};`,
    IGNORE_MOTION ? `window.__IGNORE_MOTION=${JSON.stringify(IGNORE_MOTION.split(',').map((x) => x.trim()).filter(Boolean))};` : '',
  ].join('');
  await evaluate(globals + '1');
  await evaluate(readFileSync(join(HERE, 'checks.js'), 'utf8'));

  const doc = await evaluate(
    '({h: document.documentElement.scrollHeight, vh: window.innerHeight, vw: window.innerWidth})'
  );

  // Sampling positions. Explicit --offsets is the stable path and the default
  // recommendation: uniform sampling distributes positions by page LENGTH, so
  // adding a section anywhere silently moves every sample and findings appear
  // and disappear with unrelated edits. --steps is the convenience path.
  let offsets = OFFSETS;
  if (!offsets.length) {
    const n = STEPS > 0 ? STEPS : 8;
    const max = Math.max(0, doc.h - doc.vh);
    offsets = Array.from({ length: n }, (_, i) => Math.round(n === 1 ? 0 : (max * i) / (n - 1)));
  }

  const manifest = join(OUT, 'manifest.txt');
  writeFileSync(manifest, '');
  const samples = [];

  for (let i = 0; i < offsets.length; i++) {
    const y = offsets[i];
    await evaluate(`scrollTo({top: ${y}, behavior: 'instant'}); 1`);
    const conv = await waitForConvergence();
    const state = await evaluate(STATE);
    const name = `s${pad(i)}__y${String(y).padStart(5, '0')}.png`;

    const shot = await send('Page.captureScreenshot',
      { format: 'png', ...(FULL_PAGE ? { captureBeyondViewport: true } : {}) }, sessionId);
    writeFileSync(join(OUT, name), Buffer.from(shot.data, 'base64'));

    const b = conv.snap.buckets;
    samples.push({
      i, name, y, requestedY: y, actualY: state.scrollY,
      settled: conv.settled, timedOut: !!conv.timedOut,
      polls: conv.polls, waitedMs: conv.waitedMs,
      buckets: b, media: conv.snap.media, mediaBlocking: conv.snap.mediaBlocking,
      cues: state.cues, visibleText: state.visibleText,
      animationPhases: state.animationPhases,
      sigPhases: state.sigPhases, sigExcluded: state.sigExcluded,
      transforms: state.transforms, mediaTimes: state.mediaTimes,
      mediaTimesAll: state.mediaTimesAll,
      clamped: state.scrollY !== y,
    });

    const notes = [];
    if (b.endless.length) notes.push(`endless=${b.endless.length}`);
    if (b.progress.length) notes.push(`scroll-driven=${b.progress.length}`);
    if (b.held.length) notes.push(`paused=${b.held.length}`);
    if (b.stuck.length) notes.push(`stuck=${b.stuck.length}`);
    if (conv.snap.mediaBlocking.length) notes.push(`media-not-ready=${conv.snap.mediaBlocking.length}`);
    const line = `${name}\tsettled=${conv.settled}\ty=${y}\twaited=${conv.waitedMs}ms\tpolls=${conv.polls}` +
      `\tcues=${state.cues.length}` + (notes.length ? `\t${notes.join(' ')}` : '');
    console.log(line);
    appendFileSync(manifest, line + '\n');
    if (conv.timedOut) {
      console.error(`  converge.sh: TIMEOUT at y=${y} after ${SETTLE_TIMEOUT}ms — captured anyway, ` +
        `settled=false. Still moving: ${b.moving.join(', ') || '(none)'}` +
        (conv.snap.mediaBlocking.length ? ` | media not ready: ${conv.snap.mediaBlocking.join(', ')}` : ''));
    }
  }

  // --- multi-sample findings ---
  // Under prefers-reduced-motion the page is SUPPOSED to hold still: animations
  // go instant, cue opacities and animation phases go constant, and large
  // regions become legitimately identical between samples. Reporting that
  // flags the accessibility path as broken on every single run, which is how a
  // real finding gets trained away. Skipped and SAID, never silently passed.
  const dead = REDUCED
    ? { total: 0, count: 0, minDeltaPx: 0, scope: 'multi-sample',
        skipped: 'reduced-motion holds the page still by design', masking: [], offenders: [] }
    : checkDeadScroll(samples, doc.vh, DEAD_DELTA);
  const weak = checkWeakCuesPeak(samples, CUE_THRESHOLD, !!CUES);
  const unsettled = samples.filter((s) => !s.settled).map((s) => s.name);

  writeFileSync(join(OUT, 'report.json'), JSON.stringify({
    url: URL_, viewport: { w: VW, h: VH, dpr: DPR }, doc,
    reducedMotion: REDUCED,
    settings: { settleTimeout: SETTLE_TIMEOUT, dwell: DWELL, poll: POLL,
                deadScrollDelta: DEAD_DELTA, cueThreshold: CUE_THRESHOLD },
    checks: { deadScroll: dead, weakCuesPeak: weak },
    unsettled, consoleErrors, samples,
  }, null, 2));

  console.log('');
  console.log(`converge.sh: ${samples.length} sample(s) -> ${OUT}`);
  console.log(`  settled: ${samples.length - unsettled.length}/${samples.length}` +
    (unsettled.length ? `  NOT SETTLED: ${unsettled.join(', ')}` : ''));

  if (weak.count) {
    console.log(`\nWEAK CUES (peak opacity < ${weak.threshold} across all ${samples.length} samples):`);
    for (const o of weak.offenders) console.log(`  ${o.peak}  ${o.selector}  "${o.text}"`);
  } else if (weak.total === 0) {
    // "Nothing was weak" and "nothing was looked at" are different answers and
    // must never print the same. Zero tracked cues means the check did not run.
    console.log(`\nweak cues: NOT CHECKED — zero cues were tracked, so this is NOT a pass.`);
    if (REDUCED && !CUES) {
      console.log(`  Under --reduced-motion the page's animations and transitions are switched off,`);
      console.log(`  so the "opacity is under animation control" heuristic has nothing to detect and`);
      console.log(`  is structurally blind. Name the elements that must arrive with --cues.`);
    } else if (!CUES) {
      console.log(`  No element had its opacity under animation control. If cues exist that are never`);
      console.log(`  triggered, the heuristic cannot see them either — name them with --cues.`);
    } else {
      console.log(`  The --cues selectors matched no on-screen text at any sampled offset.`);
    }
  } else {
    console.log(`\nweak cues: none — all ${weak.total} tracked cue(s) reach ${weak.threshold} ` +
      `on some sample (mode: ${weak.mode})`);
  }

  if (dead.skipped) {
    console.log(`\ndead scroll: SKIPPED — ${dead.skipped}. Re-run without --reduced-motion to check it.`);
  } else if (dead.count) {
    console.log(`\nDEAD SCROLL (identical state across >= ${dead.minDeltaPx}px):`);
    for (const o of dead.offenders) {
      console.log(`  ${o.from} -> ${o.to}  (${o.deltaPx}px, ${o.deltaViewports} viewports)`);
    }
  } else if (!dead.skipped) {
    console.log(`dead scroll: none across ${dead.total} compared pair(s)`);
  }
  if (dead.masking.length) {
    for (const m of dead.masking) {
      const comps = m.components.join(' + ');
      console.log(`  NOTE: ${comps} differs on EVERY pair and is MASKING this check — ` +
        `dropping it surfaces ${m.wouldFind} further finding(s): ${m.examples.join(', ')}.`);
      // The --ignore-motion escape only applies to the motion components. When
      // `cues` is the masker the answer is different: the cue text/opacity
      // genuinely changes at every sample, so either the sampling is too coarse
      // to see a hold, or there is no hold to see. Do not offer a fix that
      // cannot apply.
      if (m.components.includes('sigPhases') || m.components.includes('transforms')) {
        const chrome = [...new Set(samples.flatMap((s) => s.sigPhases.map((p) => p.split('=')[0])))];
        console.log(`    A document-wide scroll-driven element advances at every offset by ` +
          `construction and separates every pair. Exclude it with --ignore-motion.`);
        if (chrome.length) console.log(`    Candidates: ${chrome.join(', ')}`);
      } else if (m.components.includes('visibleText')) {
        console.log(`    Content scrolls past at every sample, so no region is held. That is a ` +
          `flow page behaving normally — dead scroll only means something where the viewport ` +
          `is pinned.`);
      } else {
        console.log(`    Not a motion masker — ${comps} genuinely changes at every sample. ` +
          `Sample more densely if you suspect a hold between two of these offsets.`);
      }
    }
    if (!dead.count) console.log('  So this is NOT a clean pass — it is an unchecked region.');
  }
  const clamped = samples.filter((s) => s.clamped);
  if (clamped.length) {
    console.log(`\nNOTE: ${clamped.length} requested offset(s) clamped to the document end ` +
      `(${clamped.map((s) => s.y + '->' + s.actualY).join(', ')}) — the offsets overshoot the page.`);
  }

  if (consoleErrors.length) console.log('\nCONSOLE ERRORS:\n  ' + consoleErrors.join('\n  '));
  console.log(`\nreport: ${join(OUT, 'report.json')}`);

  // Exit nonzero on a real finding so this is usable as a gate. An unsettled
  // sample counts: it means the evidence is a mid-flight frame, not a settled
  // one, and that must not pass quietly.
  return dead.count || weak.count || unsettled.length ? 1 : 0;
}

let code = 1;
try {
  code = await main();
} catch (e) {
  console.error('converge.sh: ' + (e && e.message ? e.message : String(e)));
  code = 2;
} finally {
  // Always tear down: a leaked headless Chrome holds the profile dir and the
  // port, and the next run's failure looks like a browser bug.
  try { ws && ws.close(); } catch {}
  try { child && child.kill(); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
process.exit(code);
