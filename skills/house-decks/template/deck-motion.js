/*
 * deck-motion.js — honest count-up (opt-in via [data-count-honest]).
 *
 * deck-anim.js's existing countUp() animates `.statstrip .stat .n[data-count]`
 * FROM ZERO. That is a house-rule conflict with visual-verify's honest-
 * quantity rule: a count-up must climb from a floor of 1 toward the target
 * and never overshoot the claim — rendering 0 under a label that claims a
 * real quantity is a false frame for the instant it's on screen.
 *
 * INTENT: code does <deck-anim.js's countUp animates from 0, unconditionally,
 * for every element matching [data-count]> / check expects <a count-up must
 * never render 0 under a real-quantity label, per visual-verify's honest-
 * quantity rule> / spec says <deck-anim.js is canonical and must not be
 * edited (Phase 3 hard constraint), so the two rules cannot both govern the
 * same attribute>. Resolution: this file does NOT touch deck-anim.js or its
 * [data-count] selector. It adds a parallel, opt-in attribute,
 * [data-count-honest], with its own corrected animation (floor of 1, clamps
 * at target, never shows 0). A slide chooses one convention per element by
 * choosing which attribute to author. Retiring the old from-0 behavior
 * (i.e. making deck-anim.js's [data-count] itself honest) is a human call —
 * flagged here and in references/motion.md, not made unilaterally.
 *
 * An element MUST NOT carry both [data-count] and [data-count-honest] — that
 * would double-animate (two independent requestAnimationFrame loops writing
 * the same textContent). This file detects that and skips with a console
 * warning rather than guessing which one should win.
 */
(function () {
  'use strict';

  function motionOK() {
    if (document.documentElement.classList.contains('motion-off')) return false;
    try { return !window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return true; }
  }

  // Matches deck-anim.js's own fmt() exactly so honest and from-0 stats on
  // the same slide format identically.
  function fmt(n) { return n >= 10000 ? n.toLocaleString('en-US') : String(n); }

  function countUpHonest(el) {
    var target = parseInt(el.getAttribute('data-count-honest'), 10);
    if (isNaN(target)) return;
    if (el.hasAttribute('data-count')) {
      console.warn('deck-motion.js: element has both [data-count-honest] and [data-count] — skipping to avoid a double count-up race with deck-anim.js.', el);
      return;
    }

    var original = el.getAttribute('data-final') || el.textContent;
    el.setAttribute('data-final', original);
    var prefixMatch = original.match(/^[^\d]*/);
    var prefix = prefixMatch ? prefixMatch[0] : '';
    var suffix = el.getAttribute('data-suffix') || '';

    // A claim of 0 (or negative) has no honest non-zero floor to climb
    // from; render it directly rather than starting at a floor of 1, which
    // would itself overshoot a claim of 0.
    if (target <= 0 || !motionOK()) {
      el.textContent = prefix + fmt(target) + suffix;
      return;
    }

    var dur = 950, start = null;
    function frame(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3); // ease-out cubic, monotonic 0..1 — cannot overshoot
      if (p >= 1) {
        el.textContent = prefix + fmt(target) + suffix; // exact final value, no rounding drift
        return;
      }
      var value = Math.min(target, Math.max(1, Math.round(target * eased)));
      el.textContent = prefix + fmt(value) + suffix;
      requestAnimationFrame(frame);
    }
    el.textContent = prefix + fmt(1) + suffix; // floor of 1, never 0
    requestAnimationFrame(frame);
  }

  function onSlide(slide) {
    if (!slide) return;
    var els = slide.querySelectorAll('[data-count-honest]');
    for (var i = 0; i < els.length; i++) countUpHonest(els[i]);
  }

  function init() {
    var stage = document.querySelector('deck-stage');
    if (!stage) { setTimeout(init, 60); return; }
    stage.addEventListener('slidechange', function (e) {
      onSlide(e.detail && e.detail.slide);
    });
    var active = document.querySelector('[data-deck-active]');
    if (active) onSlide(active);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
