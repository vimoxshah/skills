/*
 * deck-fragments.js — presenter-paced fragment stepping (opt-in, additive).
 *
 * Problem: today the whole `--i` stagger fires on slide entry and then the
 * slide just sits there. A presenter can't pace reveals to their own speech.
 *
 * Author contract
 * ----------------
 *   <section class="slide" data-fragments>
 *     <p data-frag="1">shown on step 1</p>
 *     <p data-frag="1">also step 1 (same group == revealed together)</p>
 *     <p data-frag="2">shown on step 2</p>
 *   </section>
 * Unmarked content and `data-frag="0"` show immediately on slide entry.
 * Forward key (Right/PageDown/Space) reveals the next group; only once every
 * group is revealed does the key fall through to deck-stage and advance the
 * slide. Backward key (Left/PageUp) un-reveals the last group; at group 0 it
 * falls through to the previous slide. Home/End/digit/R jumps are NOT
 * intercepted — they are direct navigation, not incremental pacing.
 *
 * Mechanism: deck-stage.js dispatches `slidechange` on every active-slide
 * change (see deck-stage.js's own USAGE header) — that is the only hook this
 * file uses. Key interception is a CAPTURE-phase `keydown` listener on
 * `window`; deck-stage registers its own handler on `window` in the bubble
 * phase (connectedCallback), so a capture listener that calls
 * stopPropagation() when it consumes the key runs first and wins, regardless
 * of registration order (capture always precedes bubble at the same target).
 *
 * This file does not import deck-anim.js or deck-stage.js and does not
 * modify them. Styling (the hidden/revealed look) lives in deck-motion.css;
 * this file also injects a tiny unconditional fallback rule so hide/show is
 * correct even if deck-motion.css is not linked.
 *
 * If a document has no [data-fragments] slides, this file registers no
 * listeners and injects no styles — a true no-op — but it still defines
 * window.deckFragments so callers can always call state() safely.
 */
(function () {
  'use strict';

  function motionOK() {
    if (document.documentElement.classList.contains('motion-off')) return false;
    try { return !window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return true; }
  }

  // Same guard deck-stage.js's own _onKey uses (ignore keys while typing).
  var TYPING_TAGS = /^(INPUT|TEXTAREA|SELECT)$/;
  var FORWARD_KEYS = { ArrowRight: 1, PageDown: 1, ' ': 1, Spacebar: 1 };
  var BACKWARD_KEYS = { ArrowLeft: 1, PageUp: 1 };

  // current: state of the active fragmented slide (or null slide when the
  // active slide isn't fragmented). `slide` here is the DOM element for
  // internal use; state() below exposes the 0-based index instead so it is
  // JSON-serializable (see window.deckFragments docs).
  var current = { slide: null, index: -1, group: 0, groups: 0 };
  var printSnapshot = null;

  function maxGroup(slide) {
    var max = 0;
    var frags = slide.querySelectorAll('[data-frag]');
    for (var i = 0; i < frags.length; i++) {
      var g = parseInt(frags[i].getAttribute('data-frag'), 10);
      if (!isNaN(g) && g > max) max = g;
    }
    return max;
  }

  // Set data-frag-pending to match `group`. When `instant` is true, force
  // the change to skip any CSS transition (used on slide entry/reset and as
  // print fallback) via the standard read-offsetWidth-to-force-reflow trick.
  function applyGroup(slide, group, instant) {
    var frags = slide.querySelectorAll('[data-frag]');
    for (var i = 0; i < frags.length; i++) {
      var el = frags[i];
      var g = parseInt(el.getAttribute('data-frag'), 10);
      if (isNaN(g)) g = 0;
      var shouldPend = g > group;
      var isPending = el.hasAttribute('data-frag-pending');
      if (shouldPend === isPending) continue;
      if (instant || !motionOK()) {
        var prevTransition = el.style.transition;
        el.style.transition = 'none';
        toggle(el, shouldPend);
        void el.offsetWidth; // force reflow so 'none' takes effect before restoring
        el.style.transition = prevTransition;
      } else {
        toggle(el, shouldPend);
      }
    }
  }

  function toggle(el, pending) {
    if (pending) el.setAttribute('data-frag-pending', '');
    else el.removeAttribute('data-frag-pending');
  }

  function next() {
    if (!current.slide || current.group >= current.groups) return false;
    current.group += 1;
    applyGroup(current.slide, current.group, false);
    return true;
  }

  function prev() {
    if (!current.slide || current.group <= 0) return false;
    current.group -= 1;
    applyGroup(current.slide, current.group, false);
    return true;
  }

  function state() {
    return { slide: current.index, group: current.group, groups: current.groups };
  }

  function onKeyDown(e) {
    if (!current.slide) return; // nothing fragmented is active — stay out of the way
    var t = e.target;
    if (t && (t.isContentEditable || TYPING_TAGS.test(t.tagName))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var key = e.key;
    if (FORWARD_KEYS.hasOwnProperty(key)) {
      if (next()) { e.preventDefault(); e.stopPropagation(); }
      // else: fully revealed — let deck-stage advance the slide.
    } else if (BACKWARD_KEYS.hasOwnProperty(key)) {
      if (prev()) { e.preventDefault(); e.stopPropagation(); }
      // else: at group 0 — let deck-stage go to the previous slide.
    }
  }

  function onSlideChange(e) {
    var d = e.detail || {};
    var slide = d.slide || null;
    var index = (typeof d.index === 'number') ? d.index : -1;
    var prevIndex = (typeof d.previousIndex === 'number') ? d.previousIndex : -1;

    if (!slide || !slide.hasAttribute('data-fragments')) {
      current = { slide: null, index: index, group: 0, groups: 0 };
      return;
    }

    var groups = maxGroup(slide);
    var group;
    if (slide === current.slide && index === prevIndex) {
      // Re-broadcast without real navigation (e.g. a rail/content mutation
      // re-fires slidechange with reason 'init'/'mutation') — hold pace,
      // just re-clamp in case fragment content changed under us.
      group = Math.min(current.group, groups);
    } else if (index > prevIndex) {
      group = 0; // forward entry (including first load) — start collapsed
    } else if (index < prevIndex) {
      group = groups; // backward entry — re-entering a finished slide shows it finished
    } else {
      group = 0; // unexpected: different slide but equal index — safe default
    }

    current = { slide: slide, index: index, group: group, groups: groups };
    applyGroup(slide, group, true);
  }

  function onBeforePrint() {
    // Print shows every slide at once (deck-stage's own beforeprint marks
    // every <section> data-deck-active); force every fragment visible so a
    // printed/PDF export never shows a blank not-yet-revealed fragment.
    printSnapshot = [];
    var frags = document.querySelectorAll('[data-fragments] [data-frag]');
    for (var i = 0; i < frags.length; i++) {
      var el = frags[i];
      var wasPending = el.hasAttribute('data-frag-pending');
      printSnapshot.push({ el: el, pending: wasPending });
      if (wasPending) {
        var prevTransition = el.style.transition;
        el.style.transition = 'none';
        el.removeAttribute('data-frag-pending');
        void el.offsetWidth;
        el.style.transition = prevTransition;
      }
    }
  }

  function onAfterPrint() {
    if (!printSnapshot) return;
    for (var i = 0; i < printSnapshot.length; i++) {
      var rec = printSnapshot[i];
      if (rec.pending) rec.el.setAttribute('data-frag-pending', '');
    }
    printSnapshot = null;
  }

  function injectFallbackStyle() {
    var style = document.createElement('style');
    style.setAttribute('data-deck-fragments-fallback', '');
    // Belt-and-suspenders: correct hide/show even if deck-motion.css isn't
    // linked. deck-motion.css adds the real transition/transform on top.
    style.textContent = '[data-frag][data-frag-pending]{opacity:0 !important;}';
    document.head.appendChild(style);
  }

  // Best-effort 0-based index for the catch-up path below, where there is
  // no CustomEvent detail to read it from. deck-stage.js stamps
  // data-deck-slide on each slide; fall back to DOM position if that isn't
  // present. Only used once, at startup, and only to decide "forward or
  // backward" (irrelevant here since previousIndex is always -1 for a
  // catch-up) and to seed state().slide with a real number.
  function slideIndexOf(slide) {
    var n = parseInt(slide.getAttribute('data-deck-slide'), 10);
    if (!isNaN(n)) return n;
    var stage = slide.closest('deck-stage');
    if (!stage) return -1;
    return Array.prototype.indexOf.call(stage.querySelectorAll('.slide'), slide);
  }

  function bindToStage(retriesLeft) {
    var stage = document.querySelector('deck-stage');
    if (stage) {
      stage.addEventListener('slidechange', onSlideChange);
      // deck-stage upgrades (and dispatches its initial 'init' slidechange)
      // as soon as customElements.define() runs in deck-stage.js, which can
      // happen synchronously before this later <script> tag even runs —
      // the listener above would then miss that first event entirely.
      // Mirrors deck-anim.js's own init() catch-up check.
      var active = document.querySelector('[data-deck-active]');
      if (active) {
        onSlideChange({ detail: { slide: active, index: slideIndexOf(active), previousIndex: -1, reason: 'init' } });
      }
      return;
    }
    if (retriesLeft <= 0) return;
    setTimeout(function () { bindToStage(retriesLeft - 1); }, 60);
  }

  function init() {
    var hasFragments = !!document.querySelector('[data-fragments]');
    if (hasFragments) {
      injectFallbackStyle();
      window.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('beforeprint', onBeforePrint);
      window.addEventListener('afterprint', onAfterPrint);
      bindToStage(50); // ~3s of retries, mirrors deck-anim.js's init() wait pattern
    }
    // Always defined, even in the no-op case, so callers can safely probe
    // state() (e.g. state().groups === 0 means "nothing fragmented here").
    window.deckFragments = { next: next, prev: prev, state: state };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
