/* ---------------------------------------------------------------------------
 * settle-template.js — force a tween-driven page into its FINAL state so a
 * headless screenshot can actually show it.
 *
 * WHY THIS EXISTS
 *   GSAP (and anything rAF-driven) advances on requestAnimationFrame
 *   timestamps. Chromium's --virtual-time-budget fast-forwards timers but does
 *   NOT feed rAF proportionally, so a 1s tween can still be at 35% progress
 *   when a t=16s screenshot fires. You end up "seeing" a broken page that is
 *   actually fine, or missing a real bug behind a half-finished transition.
 *
 * HOW TO USE
 *   1. Read the real page. Do NOT edit it.
 *   2. Splice this block in just before the last line of the scene's IIFE /
 *      module body, where its locals are still in scope.
 *   3. Write the result to /tmp/verify-<state>.html and screenshot THAT.
 *   4. Repeat once per discrete state — bugs hide in the states you skip.
 *
 * Injection (python), anchoring on a line unique to the scene's setup:
 *   a = s.rindex("  io.observe(stageEl);")
 *   open('/tmp/verify-%s.html' % i, 'w').write(s[:a] + BLOCK % i + s[a:])
 * ------------------------------------------------------------------------- */

setTimeout(function () {
  /* 1. Stop the animation engine so nothing overwrites what we set below.
   *    pause() is preferred over kill()/clear(): tweens keep their targets,
   *    so a value you do not explicitly set stays at its current value
   *    rather than snapping back to a from-state. */
  if (window.gsap) gsap.globalTimeline.pause();

  var i = STATE_INDEX;          /* templated in per screenshot */
  var s = STAGES[i];

  /* 2. Assign every ANIMATED value its final value directly.
   *    Anything you forget here shows up as a phantom bug in the shot, so
   *    mirror the real transition function property-for-property. */
  shells.forEach(function (p, k) {
    p.material.opacity = (k === i) ? 1 : 0;
  });
  gates.forEach(function (g, k) {
    g.material.opacity = 0.30;
    g.scale.setScalar(s.r * 1.12 + k * 0.26);
  });
  hub.scale.setScalar(s.camZ / 5.0);
  camera.position.set(0, s.camY, s.camZ);
  camera.lookAt(0, 0, 0);

  /* 3. Text/DOM the tweens would have written, including any element whose
   *    opacity is animated in — otherwise it screenshots invisible and you
   *    chase a layout bug that does not exist. */
  var q = function (id) { return document.getElementById(id); };
  q('roCount').textContent = s.n >= 1000 ? '1,000+' : String(s.n);
  q('roName').textContent  = s.name;
  q('roDesc').textContent  = s.desc;
  q('roName').style.opacity = 1;
  q('roDesc').style.opacity = 1;

  /* 4. Canvas renderers are pull-based: with the rAF loop effectively frozen,
   *    nothing repaints unless you ask for one frame explicitly. */
  renderer.render(scene, camera);
}, 900);
