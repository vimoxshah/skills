/* deck-anim.js — count-up stats, self-typing terminals, latency counter.
   Static-first: every animated element is fully visible by default; this script
   only HIDES-then-reveals when motion is enabled, so print / reduced-motion / no-JS
   all show the finished state. */
(function () {
  'use strict';

  function motionOK() {
    if (document.documentElement.classList.contains('motion-off')) return false;
    try { return !window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return true; }
  }

  /* ---------- count-up numbers ---------- */
  function countUp(el) {
    var target = parseInt(el.getAttribute('data-count'), 10);
    if (isNaN(target)) return;
    var original = el.getAttribute('data-final') || el.textContent;
    el.setAttribute('data-final', original);
    var prefixMatch = original.match(/^[^\d]*/);
    var prefix = prefixMatch ? prefixMatch[0] : '';
    var suffix = el.getAttribute('data-suffix') || '';
    if (!motionOK()) { el.textContent = prefix + fmt(target) + suffix; return; }
    var dur = 950, start = null;
    function fmt(n) { return n >= 10000 ? n.toLocaleString('en-US') : String(n); }
    function frame(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = prefix + fmt(Math.round(target * eased)) + suffix;
      if (p < 1) requestAnimationFrame(frame);
    }
    el.textContent = prefix + '0' + suffix;
    requestAnimationFrame(frame);
  }
  // hoist fmt for the non-motion branch
  function fmt(n) { return n >= 10000 ? n.toLocaleString('en-US') : String(n); }

  /* ---------- terminal line reveal ---------- */
  var animToken = 0;
  function revealTerminal(slide, isQuery) {
    var token = ++animToken;
    var bodyId = isQuery ? 'term-query' : 'term-agent';
    var body = slide.querySelector('#' + bodyId);
    if (!body) return;
    var lines = Array.prototype.slice.call(body.querySelectorAll('.term-line'));
    var dots = Array.prototype.slice.call(slide.querySelectorAll('.pdots i'));
    var latency = slide.querySelector('#query-latency');

    if (!motionOK()) {
      lines.forEach(function (l) { l.style.opacity = '1'; l.style.transform = 'none'; });
      dots.forEach(function (d) { d.classList.add('on'); });
      if (latency) latency.textContent = '41ms';
      return;
    }

    // hide all
    lines.forEach(function (l) {
      l.style.opacity = '0';
      l.style.transform = 'translateY(8px)';
      l.style.transition = 'opacity .26s ease, transform .26s ease';
    });
    dots.forEach(function (d) { d.classList.remove('on'); });
    if (latency) latency.textContent = '';

    var delay = 320, cmdIdx = 0;
    lines.forEach(function (l) {
      var isCmd = !!l.querySelector('.cmd') && !!l.querySelector('.pr');
      var myCmd = isCmd ? cmdIdx++ : -1;
      var d = delay;
      setTimeout(function () {
        if (token !== animToken) return;
        l.style.opacity = '1';
        l.style.transform = 'none';
        if (myCmd >= 0 && dots[myCmd]) dots[myCmd].classList.add('on');
      }, d);
      // command lines feel like typing -> longer beat before the next line
      delay += isCmd ? 560 : (l.textContent.trim() === '' ? 120 : 360);
    });

    // latency count-up after everything lands
    if (latency) {
      setTimeout(function () {
        if (token !== animToken) return;
        var t = 0, target = 41, start = null;
        function f(ts) {
          if (token !== animToken) return;
          if (start === null) start = ts;
          var p = Math.min((ts - start) / 700, 1);
          latency.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))) + 'ms';
          if (p < 1) requestAnimationFrame(f);
        }
        requestAnimationFrame(f);
      }, delay + 120);
    }
  }

  /* ---------- per-slide activation ---------- */
  function onSlide(slide, reason) {
    if (!slide) return;
    slide.querySelectorAll('.statstrip .stat .n[data-count]').forEach(function (el) { countUp(el); });
    var anim = slide.getAttribute('data-anim');
    if (anim === 'terminal') revealTerminal(slide, false);
    else if (anim === 'query') revealTerminal(slide, true);
  }

  function init() {
    var stage = document.querySelector('deck-stage');
    if (!stage) { setTimeout(init, 60); return; }
    stage.addEventListener('slidechange', function (e) {
      onSlide(e.detail && e.detail.slide, e.detail && e.detail.reason);
    });
    // in case init slidechange fired before listener attached
    var active = document.querySelector('[data-deck-active]');
    if (active) onSlide(active, 'init');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
