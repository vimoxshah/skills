/* deck-pageturn.js — OPT-IN page-turn transition (pairs with deck-pageturn.css)
 *
 * Additive. Hooks deck-stage's public `slidechange` event from outside and never
 * edits deck-stage.js — same contract as deck-fragments.js / deck-motion.js.
 *
 * A true no-op unless a deck opts in with <deck-stage data-pageturn>, so it is
 * safe to include in every deck to keep the option available.
 *
 * ── Why any JS is needed at all ────────────────────────────────────────────
 * The turn is pure CSS except for one thing CSS cannot do: deck-stage removes
 * [data-deck-active] from the outgoing slide the instant you navigate, so the
 * sheet that should turn away is already hidden before any animation could run.
 * There is no "leaving" state to style. This file supplies one — .is-turning-out
 * — and takes it away when the turn ends.
 *
 * Backward navigation needs no help: the page that moves is the one arriving, and
 * it is still [data-deck-active], so the stylesheet handles that direction alone.
 */
(function () {
  var TURN_MS = 900;           // MUST match the .9s in deck-pageturn.css
  var DIR_ATTR = 'data-dk-dir';

  function init() {
    var stage = document.querySelector('deck-stage[data-pageturn]');
    if (!stage) return;        // not opted in — do nothing at all

    var timer = null;

    function motionOff() {
      // Same gate deck-anim.js uses, so one toggle governs the whole deck.
      return document.documentElement.classList.contains('motion-off') ||
             document.documentElement.classList.contains('dk-no3d') ||
             (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    stage.addEventListener('slidechange', function (e) {
      var d = e.detail || {};
      var i = d.index, p = d.previousIndex;
      var back = (typeof p === 'number' && p >= 0 && p > i);

      // Direction. deck-console.js writes the same attribute when a deck ships
      // the console, so this only fills it in when nothing else has — one
      // direction signal, never two competing ones.
      if (typeof p === 'number' && p >= 0 && p !== i) {
        document.documentElement.setAttribute(DIR_ATTR, back ? 'back' : 'fwd');
      }

      // Clear a turn still in flight. Without this a fast click-through leaves a
      // half-turned sheet pinned above the deck at z-index 3 — the deck looks
      // frozen on a slide you already left, and the only way out is a reload.
      if (timer) { clearTimeout(timer); timer = null; }
      var stale = stage.querySelector('.is-turning-out');
      if (stale) stale.classList.remove('is-turning-out');

      // FORWARD only: hold the outgoing sheet visible so it can turn away.
      if (!back && !motionOff() && d.previousSlide && d.previousSlide !== d.slide) {
        var out = d.previousSlide;
        out.classList.add('is-turning-out');
        timer = setTimeout(function () {
          out.classList.remove('is-turning-out');
          timer = null;
        }, TURN_MS);
      }
    });
  }

  // deck-stage upgrades its custom element on DOMContentLoaded; querying earlier
  // can miss it.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
