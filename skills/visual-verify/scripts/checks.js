/* ---------------------------------------------------------------------------
 * checks.js — injected programmatic checks. No eyes needed for these five:
 * overflow, contrast, weakCues, missing (required selectors), fontload.
 *
 * SCOPE: everything here is SINGLE-PAGE, SINGLE-MOMENT — one injected DOM at
 * one instant. Any check that needs to compare two or more sampled states
 * (dead scroll; "this cue never peaks anywhere on the page") cannot live here
 * and lives in converge-driver.mjs, where multi-sample data actually exists.
 * cueSample() below is the per-sample half that driver builds on.
 *
 * HOW TO USE
 *   1. Read the real page. Do NOT edit it.
 *   2. Optionally set window.__REQUIRE = [...css selectors...] and/or
 *      window.__FONTS = [...CSS font shorthands...] via a small script tag
 *      BEFORE this one (order does not matter — both are read lazily, at
 *      report time, not at injection time).
 *   3. Append this file's contents as a classic <script> just before
 *      </body> in a throwaway copy (see render.sh's with_probe() for the
 *      "splice before </body>, screenshot the copy" idiom — reuse it, do
 *      not edit the source page).
 *   4. Read the result with: render.sh dump <copy.html>
 *      It prints document.title, which this script sets to a JSON blob.
 *
 * WHY document.title
 *   `--dump-dom` is the only headless-Chromium introspection render.sh uses
 *   that does not need a live CDP session. document.title round-trips
 *   through HTML serialization, so this script sanitizes every DOM-derived
 *   string (selectors, class names) to a safe charset before it goes in —
 *   an unescaped "<" or "&" from a class name would corrupt the dump.
 *   JSON's own structural characters ({ } [ ] : , ") are untouched by HTML
 *   text-node serialization and are safe as-is (this is the same pattern
 *   SKILL.md section 4 already uses for ad-hoc probes).
 *
 * WHY document.fonts.ready + a hard fallback timer
 *   A 404'd @font-face takes a beat to fail. Reading document.fonts.check()
 *   before the load/error settles is a false negative. document.fonts.ready
 *   resolves once every requested font has either loaded or failed, but if
 *   something wedges that promise, a hard setTimeout still fires so the
 *   title always gets set (render.sh dump only waits ~4s by default).
 *
 * WHY document.fonts.check() alone is not enough to prove a font "works"
 *   Empirically (Chromium 151, headless): document.fonts.check() returns
 *   TRUE for a family name that has NO @font-face rule at all — the font
 *   matcher reports the fallback as "available" rather than failing. It
 *   only returns FALSE for a family that has a real @font-face whose
 *   resource actually failed to load (status "error"). So window.__FONTS
 *   entries are only meaningful for families your page declares via
 *   @font-face — that is also the only case worth gating on, since it is
 *   the "silently fell back to a system stack" failure this check exists
 *   to catch.
 * ------------------------------------------------------------------------- */
(function () {
  var CAP = 12; // keep the title small enough to survive a dump-dom round trip

  function safe(str) {
    return String(str).replace(/[^A-Za-z0-9_.#\- ]/g, '').trim();
  }

  function classOf(el) {
    var c = el.className;
    if (!c || typeof c !== 'string') return '';
    return safe(c.trim().split(/\s+/)[0] || '');
  }

  function selectorFor(el) {
    var s = el.tagName.toLowerCase();
    if (el.id) s += '#' + safe(el.id);
    var cls = classOf(el);
    if (cls) s += '.' + cls;
    return s;
  }

  // ---- overflow: elements pushing past the viewport's right edge ----------
  function checkOverflow() {
    var clientWidth = document.documentElement.clientWidth;
    var scrollWidth = document.documentElement.scrollWidth;
    var all = document.querySelectorAll('*');
    var offenders = [];
    var total = 0;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var r = el.getBoundingClientRect();
      if (r.right > clientWidth + 2) {
        total++;
        if (offenders.length < CAP) {
          offenders.push({
            tag: el.tagName.toLowerCase(),
            cls: classOf(el),
            width: Math.round(r.width),
            right: Math.round(r.right)
          });
        }
      }
    }
    return {
      clientWidth: clientWidth,
      scrollWidth: scrollWidth,
      // the real bug class this check exists for: does the page scroll
      // horizontally at all? A fixed-position element past the edge may
      // not cause this even though it is technically "overflowing".
      pageScrollsX: scrollWidth > clientWidth + 2,
      count: total,
      offenders: offenders
    };
  }

  // ---- contrast: WCAG 2.1 ratio of text color vs nearest ancestor bg ------
  function parseColor(str) {
    var m = str && str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    var p = m[1].split(',').map(function (s) { return parseFloat(s); });
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }

  function relLuminance(c) {
    function chan(v) {
      v = v / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b);
  }

  function contrastRatio(c1, c2) {
    var l1 = relLuminance(c1) + 0.05;
    var l2 = relLuminance(c2) + 0.05;
    return l1 > l2 ? l1 / l2 : l2 / l1;
  }

  function nearestBg(el) {
    var node = el;
    while (node) {
      var cs = getComputedStyle(node);
      var bg = parseColor(cs.backgroundColor);
      if (bg && bg.a > 0) return bg;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 }; // canvas default
  }

  function hasDirectText(el) {
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3 && n.textContent.trim()) return true;
    }
    return false;
  }

  function checkContrast() {
    var all = document.querySelectorAll('*');
    var offenders = [], offending = 0;
    var total = 0;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (!hasDirectText(el)) continue;
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      var fg = parseColor(cs.color);
      if (!fg || fg.a === 0) continue;
      // Self-inclusive background lookup (INTENT note, resolved not deferred):
      // code does nearestBg(el) — checks the element's OWN background first,
      // falling back to ancestors only if el itself is transparent.
      // Literal spec wording says "nearest ancestor with a non-transparent
      // background-color", which read strictly would start at el.parentElement
      // and skip el's own background entirely. That literal reading was
      // shipped first and produced a wrong answer: a white-on-#222 badge
      // (true ratio ~16:1) was scored 1.0 because the check walked past its
      // own background to the page's white body. A check whose number
      // contradicts the rendered page is a defect, not a spec ambiguity, so
      // this was corrected to self-inclusive rather than left non-compliant.
      // Residual risk: a self-declared *semi-transparent* background (e.g.
      // rgba(0,0,0,0.4)) is treated as opaque and used uncomposited — the
      // spec's binary transparent/non-transparent wording doesn't cover
      // partial alpha, and this check doesn't composite against what's
      // beneath it in that case.
      var bg = nearestBg(el);
      var ratio = contrastRatio(fg, bg);
      var size = parseFloat(cs.fontSize) || 16;
      var weight = parseInt(cs.fontWeight, 10) || 400;
      var isLarge = size >= 24 || (weight >= 700 && size >= 18.66);
      var threshold = isLarge ? 3.0 : 4.5;
      total++;
      if (ratio < threshold) {
        offending++;
        if (offenders.length < CAP) {
          offenders.push({
            selector: selectorFor(el),
            ratio: Math.round(ratio * 100) / 100,
            threshold: threshold
          });
        }
      }
    }
    // count is every offender; offenders[] stays capped for title size. Guarding the
    // PUSH and then reading offenders.length reported 12 for a page with 40 failures.
    return { total: total, count: offending, offenders: offenders };
  }

  // ---- weakCues: text under animation control that never reaches full strength

  // Opacity COMPOSITES multiplicatively, and getComputedStyle(el).opacity
  // returns only the element's OWN value — verified empirically (Chromium 151,
  // headless): a <span> at opacity .4 inside a <div> at opacity .5 reports
  // "0.4" while the pixels on screen are at .2. Read the element alone and a
  // cue looks fully arrived while being half invisible because an ancestor
  // wrapper is still mid-fade. So multiply the whole chain.
  function effectiveOpacity(el) {
    var o = 1, node = el;
    while (node && node.nodeType === 1) {
      var cs = getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
      var v = parseFloat(cs.opacity);
      o *= isNaN(v) ? 1 : v;
      node = node.parentElement;
    }
    return o;
  }

  // WHICH TEXT "SHOULD BE FULLY VISIBLE" — the decision this whole check turns
  // on, and the reason it is not just "opacity < 0.8".
  //
  // Flagging every text element under the threshold is worse than useless: a
  // muted caption, a disabled control, a watermark and a de-emphasised legend
  // are all *deliberately* faint. A check that fires on those trains you to
  // ignore it, which costs you the one real finding it exists for.
  //
  // So an element only qualifies as a cue when its opacity is under ANIMATION
  // CONTROL — some animation or transition on it, or on an ancestor whose
  // opacity it composites with, actually keyframes `opacity`. That is exactly
  // the line between "designed faint" and "left faint by an animation that
  // never finished", and it is READ rather than guessed:
  // effect.getKeyframes() lists the properties each animation writes (verified:
  // an opacity animation reports "opacity", a transform one reports
  // "transform"), and a CSSTransition also exposes transitionProperty.
  //
  // LIMITATION, stated rather than papered over: a cue that was never
  // triggered at all has no animation on it to detect, so the heuristic cannot
  // see it — it is indistinguishable from static text. window.__CUES is
  // therefore the primary path whenever you know which elements must arrive;
  // an author's list beats any inference. Use `missing` for "should be there
  // and isn't"; this check is for "arrived, but never all the way".
  function opacityIsAnimated(el) {
    var node = el;
    while (node && node.nodeType === 1) {
      // (a) LIVE animation objects. Precise — getKeyframes() names the exact
      //     properties written — and the only way to see a WAAPI
      //     element.animate() that has no CSS declaration behind it.
      var anims = null;
      try { anims = node.getAnimations({ subtree: false }); } catch (e) { anims = null; }
      if (anims) {
        for (var i = 0; i < anims.length; i++) {
          var a = anims[i];
          if (a.transitionProperty === 'opacity' || a.transitionProperty === 'all') return true;
          var kf = null;
          try { kf = a.effect && a.effect.getKeyframes ? a.effect.getKeyframes() : null; }
          catch (e2) { kf = null; }
          if (kf) {
            for (var j = 0; j < kf.length; j++) {
              if (Object.prototype.hasOwnProperty.call(kf[j], 'opacity')) return true;
            }
          }
        }
      }

      // (b) DECLARED CSS. Not a fallback — load-bearing, and the reason (a)
      //     alone is not enough. Verified empirically (Chromium 151, headless):
      //     a COMPLETED CSS transition is REMOVED from getAnimations()
      //     entirely (liveAnims: [] on an element sitting at the 0.5 its
      //     transition just delivered), because a finished transition with no
      //     fill is no longer a relevant animation. This check samples the
      //     SETTLED state by design, so (a) is blind at exactly the moment it
      //     matters most: the evidence expires before we look. The computed
      //     style does not — transitionProperty stayed "opacity" and
      //     transitionDuration stayed "0.7s" after the transition ended.
      var cs = getComputedStyle(node);

      // DURATION IS NOT OPTIONAL. transition-property's initial value is
      // `all`, so getComputedStyle(el).transitionProperty returns "all" for
      // EVERY element on the page whether or not a transition is declared
      // (verified: a plain dimmed <p> reports "all" / "0s"). Matching on the
      // property list alone therefore makes every text element a "cue", the
      // discriminator collapses, and a deliberately muted caption fires as a
      // false positive — the exact failure this check is built to avoid.
      // Pair each property with its own duration and require a real one.
      var props = String(cs.transitionProperty).split(',');
      var durs = String(cs.transitionDuration).split(',');
      for (var k = 0; k < props.length; k++) {
        var prop = props[k].trim();
        if (prop !== 'opacity' && prop !== 'all') continue;
        // transition-duration repeats to match the property list length.
        var dur = parseFloat((durs[k % durs.length] || '0s').trim());
        if (!isNaN(dur) && dur > 0) return true;
      }

      // A CSS animation, live or long finished. Coarser than (a): the computed
      // style cannot say whether the keyframes touch opacity, so this
      // over-reports rather than under-reports — the right way to fail for a
      // check whose job is to find something.
      if (cs.animationName && cs.animationName !== 'none'
          && parseFloat(cs.animationDuration) > 0) return true;

      node = node.parentElement;
    }
    return false;
  }

  function cueText(el) {
    return safe((el.textContent || '').replace(/\s+/g, ' ').trim()).slice(0, 46);
  }

  // On screen, not merely non-transparent. An element parked off-viewport at
  // opacity 1 is not a visible cue, and counting it produces findings that
  // send you chasing something the reader never sees.
  function cueOnScreen(el) {
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    return !(r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth);
  }

  function cueElements() {
    var declared = window.__CUES;
    if (!declared || !declared.length) return null;
    var els = [];
    for (var d = 0; d < declared.length; d++) {
      var found;
      try { found = document.querySelectorAll(declared[d]); } catch (e) { continue; }
      for (var f = 0; f < found.length; f++) els.push(found[f]);
    }
    return els;
  }

  // Per-sample cue reading, exported for the driver.
  //
  // "Never reaches 0.8" is a statement about every frame the reader is shown,
  // and ONE page state cannot make it — a cue caught at 0.4 on this sample may
  // be at 1.0 two samples later, which is a healthy fade, not a defect. So this
  // returns the raw per-sample reading and converge-driver.mjs takes the MAX
  // per cue across the whole run. checkWeakCues below reports only what a
  // single sample can honestly support, and labels itself as such.
  function cueSample() {
    var declared = cueElements();
    var els = declared || document.querySelectorAll('*');
    var out = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var txt = cueText(el);
      if (declared) {
        if (!txt) continue;
      } else {
        if (!hasDirectText(el) || !opacityIsAnimated(el)) continue;
      }
      if (!cueOnScreen(el)) continue;
      out.push({
        selector: selectorFor(el),
        text: txt,
        opacity: Math.round(effectiveOpacity(el) * 1000) / 1000
      });
    }
    return out;
  }

  // INTENT: code does — checkContrast returns `count: offenders.length`, i.e.
  // the CAP-truncated length, so a page with 40 contrast failures reports
  // `count: 12`. check expects — "mirror checkContrast's return object
  // exactly", which read literally inherits that under-report. spec says —
  // this file's own header and SKILL.md section 10 both state "every list is
  // capped at 12 entries WITH A TOTAL COUNT", and checkOverflow already
  // implements that (`count: total`, list capped separately). Resolved in the
  // spec's favour: the key names are mirrored exactly ({total, count,
  // offenders}) and `count` is the TRUE uncapped offender count. checkContrast
  // itself is left untouched — flagged, not silently changed.
  function checkWeakCues() {
    var threshold = typeof window.__CUE_THRESHOLD === 'number' ? window.__CUE_THRESHOLD : 0.8;
    var declared = window.__CUES;
    var offenders = [];

    // An unparseable selector must not read as "no cues are weak".
    if (declared && declared.length) {
      for (var d = 0; d < declared.length; d++) {
        try { document.querySelectorAll(declared[d]); }
        catch (e) {
          offenders.push({ selector: safe(declared[d]), text: '', opacity: null,
                           threshold: threshold, reason: 'invalid-selector' });
        }
      }
    }

    var sample = cueSample();
    for (var i = 0; i < sample.length; i++) {
      // A cue at ~0 is ABSENT, not weak — not triggered yet, or deliberately
      // hidden. Reporting it here buries the real finding (arrived, but not all
      // the way) under noise. `missing` is the check for "should be there".
      if (sample[i].opacity <= 0.02) continue;
      if (sample[i].opacity < threshold) offenders.push({
        selector: sample[i].selector, text: sample[i].text,
        opacity: sample[i].opacity, threshold: threshold
      });
    }

    return {
      total: sample.length,
      count: offenders.length,
      threshold: threshold,
      mode: (declared && declared.length) ? 'declared' : 'animated-opacity-heuristic',
      // Say what this number can support. A single injected page state cannot
      // prove "never" — converge.sh's peak rollup is what upgrades this to a
      // whole-timeline claim.
      scope: 'single-sample',
      offenders: offenders.slice(0, CAP)
    };
  }

  // ---- missing: required selectors that match nothing, or match 0x0 -------
  function checkMissing() {
    var required = window.__REQUIRE || [];
    var offenders = [];
    for (var i = 0; i < required.length; i++) {
      var sel = required[i];
      var els;
      try {
        els = document.querySelectorAll(sel);
      } catch (e) {
        offenders.push({ selector: safe(sel), reason: 'invalid-selector' });
        continue;
      }
      if (els.length === 0) {
        offenders.push({ selector: safe(sel), reason: 'zero-matches' });
        continue;
      }
      var ok = false;
      for (var j = 0; j < els.length; j++) {
        var r = els[j].getBoundingClientRect();
        if (r.width > 0 && r.height > 0) { ok = true; break; }
      }
      if (!ok) offenders.push({ selector: safe(sel), reason: 'zero-size' });
    }
    return { required: required.length, count: offenders.length, offenders: offenders.slice(0, CAP) };
  }

  // ---- fontload: document.fonts.check() per declared shorthand ------------
  function checkFontload() {
    var fonts = (window.__FONTS || []).slice(0, CAP);
    var results = fonts.map(function (spec) {
      var loaded;
      try { loaded = document.fonts.check(spec); } catch (e) { loaded = false; }
      return { spec: safe(spec), loaded: loaded };
    });
    return { total: (window.__FONTS || []).length, results: results };
  }

  // Each check is isolated. emit() below sets its `emitted` guard BEFORE
  // assigning document.title, so a single throwing check used to take the whole
  // report down with it: the title kept whatever the page had set, the 1500ms
  // fallback became a no-op, and the other four checks silently stopped
  // reporting. One broken check must never look like "the page is fine" — it
  // reports {error} in its own slot and the rest still land.
  function guard(name, fn) {
    try { return fn(); }
    catch (e) { return { error: safe(name + ': ' + (e && e.message ? e.message : 'threw')) }; }
  }

  function collect() {
    return {
      checks: {
        overflow: guard('overflow', checkOverflow),
        contrast: guard('contrast', checkContrast),
        weakCues: guard('weakCues', checkWeakCues),
        missing: guard('missing', checkMissing),
        fontload: guard('fontload', checkFontload)
      }
    };
  }

  // Exported so a CDP driver can call these repeatedly, once per sampled
  // position, instead of re-implementing them. document.title carries ONE
  // shot of state and the emit() guard below fires once, which is right for
  // the inject-and-dump path and useless for a timeline walk — so
  // converge-driver.mjs evaluates these directly per sample. One
  // implementation, two consumers.
  window.__vvChecks = {
    overflow: checkOverflow,
    contrast: checkContrast,
    weakCues: checkWeakCues,
    missing: checkMissing,
    fontload: checkFontload,
    cueSample: cueSample,
    effectiveOpacity: effectiveOpacity,
    collect: collect
  };

  var emitted = false;
  function emit() {
    if (emitted) return;
    emitted = true;
    document.title = JSON.stringify(collect());
  }

  if (window.document && document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { setTimeout(emit, 300); }, function () { setTimeout(emit, 300); });
  }
  setTimeout(emit, 1500); // hard fallback: the title must always get set
})();
