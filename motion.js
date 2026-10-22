"use strict";
// Motion: springs that start from where things are on screen, carry the finger's speed,
// and can be grabbed again mid-flight. Also bottom sheets you can drag down to close,
// and "tap again to confirm" buttons. With Reduce Motion on, things move without animating.

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Springs are described like Apple's: damping (1 = no bounce, lower = bouncier) and
// response (roughly how quickly the target is reached, in seconds).
const anims = new Map();

function animate(key, from, to, { velocity = {}, damping = 1, response = 0.35, onUpdate, onDone } = {}) {
  stopAnim(key);
  const props = Object.keys(to).map((k) => ({
    k, x: from[k], v: velocity[k] || 0, to: to[k],
    rest: 0.001 * Math.max(1, Math.abs(to[k] - from[k])),
  }));
  const values = () => Object.fromEntries(props.map((p) => [p.k, p.x]));
  const finish = () => {
    props.forEach((p) => { p.x = p.to; p.v = 0; });
    anims.delete(key);
    onUpdate?.(values());
    onDone?.();
  };
  if (reducedMotion()) { finish(); return; }
  const stiffness = (2 * Math.PI / response) ** 2;
  const friction = (4 * Math.PI * damping) / response;
  const a = { raf: 0, values, velocities: () => Object.fromEntries(props.map((p) => [p.k, p.v])) };
  anims.set(key, a);
  let last = performance.now();
  const step = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const n = Math.max(1, Math.ceil(dt / 0.004));
    let moving = false;
    for (const p of props) {
      for (let i = 0; i < n; i++) {
        p.v += (-stiffness * (p.x - p.to) - friction * p.v) * (dt / n);
        p.x += p.v * (dt / n);
      }
      if (Math.abs(p.x - p.to) > p.rest || Math.abs(p.v) > p.rest * 10) moving = true;
    }
    if (!moving) { finish(); return; }
    onUpdate?.(values());
    if (anims.get(key) === a) a.raf = requestAnimationFrame(step);  // unless stopped or replaced meanwhile
  };
  a.raf = requestAnimationFrame(step);
}

// Stop a running spring where it is; returns its current values and speeds (or null).
function stopAnim(key) {
  const a = anims.get(key);
  if (!a) return null;
  cancelAnimationFrame(a.raf);
  anims.delete(key);
  return { values: a.values(), velocity: a.velocities() };
}

// Past an edge, follow the finger less and less (never a hard stop).
function rubberband(over, dimension, constant = 0.55) {
  return (over * dimension * constant) / (dimension + constant * Math.abs(over));
}

function soften(v, min, max, dimension) {
  if (v < min) return min - rubberband(min - v, dimension);
  if (v > max) return max + rubberband(v - max, dimension);
  return v;
}

// Where a flick would come to rest, like scrolling momentum.
function project(velocity, rate = 0.998) {
  return (velocity / 1000) * rate / (1 - rate);
}

// Finger speed in px/s over the last ~100 ms.
function tracker() {
  const pts = [];
  return {
    add(x, y) {
      const t = performance.now();
      pts.push({ x, y, t });
      while (pts.length > 2 && t - pts[0].t > 100) pts.shift();
    },
    velocity() {
      const a = pts[0], b = pts.at(-1);
      if (!a || a === b || performance.now() - b.t > 80) return { x: 0, y: 0 };
      const dt = (b.t - a.t) / 1000;
      return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
    },
  };
}

/* ---------- Bottom sheets ---------- */
// Every pop-up slides up from the bottom. Close it with ✕, by dragging it down,
// by tapping the dimmed page behind it, or with its own Done button.

const scrim = document.createElement("div");
scrim.className = "scrim";
document.body.append(scrim);

function setSheetY(d, y) {
  d.style.transform = y ? `translateY(${y}px)` : "";
  scrim.style.opacity = String(Math.max(0, Math.min(1, 1 - y / (d.offsetHeight || 1))));
}

function openSheet(d) {
  if (d.open && !d.dataset.closing) return;
  stopAnim(d.id);
  delete d.dataset.closing;
  if (!d.open) d.showModal();
  d.scrollTop = 0;
  const h = d.offsetHeight;
  setSheetY(d, h);
  animate(d.id, { y: h }, { y: 0 }, { response: 0.4, onUpdate: ({ y }) => setSheetY(d, y) });
}

function closeSheet(d, velocity = 0) {
  if (!d.open || d.dataset.closing) return;
  d.dataset.closing = "1";
  const now = stopAnim(d.id)?.values.y ?? (new DOMMatrix(getComputedStyle(d).transform).m42 || 0);
  const h = d.offsetHeight;
  const done = () => { delete d.dataset.closing; d.close(); setSheetY(d, 0); scrim.style.opacity = "0"; };
  // Aim a little past the bottom edge and finish as soon as the sheet is out of sight.
  animate(d.id, { y: now }, { y: h + 40 }, {
    velocity: { y: Math.max(0, velocity) }, response: 0.32,
    onUpdate: ({ y }) => { setSheetY(d, y); if (y >= h && anims.has(d.id)) { stopAnim(d.id); done(); } },
    onDone: () => { if (d.dataset.closing) done(); },
  });
}

function setupSheet(d) {
  const grabber = document.createElement("div");
  grabber.className = "grabber";
  grabber.setAttribute("aria-hidden", "true");
  d.prepend(grabber);

  // Done / ✕ buttons submit the form; close with the slide-down instead of instantly.
  d.querySelector("form")?.addEventListener("submit", (e) => {
    if (e.defaultPrevented) return;
    e.preventDefault();
    closeSheet(d);
  });
  d.addEventListener("cancel", (e) => { e.preventDefault(); closeSheet(d); });
  d.addEventListener("click", (e) => {
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    if (e.clientY < r.top) closeSheet(d);  // tapped the dimmed page above the sheet
  });

  // Drag down from the top of the content (or the grabber) to close.
  let drag = null;
  d.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1 || d.dataset.closing) { drag = null; return; }
    const t = e.touches[0];
    drag = { x: t.clientX, y: t.clientY, top: d.scrollTop <= 0, active: false, track: tracker(), h: d.offsetHeight };
    drag.track.add(0, 0);
  }, { passive: true });
  d.addEventListener("touchmove", (e) => {
    if (!drag) return;
    const t = e.touches[0];
    const dx = t.clientX - drag.x, dy = t.clientY - drag.y;
    if (!drag.active) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (!(dy > 0 && drag.top && Math.abs(dy) > Math.abs(dx))) { drag = null; return; }
      drag.active = true;
      drag.y = t.clientY;  // start following from here, without a jump
      stopAnim(d.id);
      return;
    }
    e.preventDefault();
    const y = t.clientY - drag.y;
    drag.track.add(0, y);
    setSheetY(d, y >= 0 ? y : -rubberband(-y, drag.h));
  }, { passive: false });
  const end = () => {
    if (!drag?.active) { drag = null; return; }
    const v = drag.track.velocity().y;
    const y = new DOMMatrix(getComputedStyle(d).transform).m42 || 0;
    const h = drag.h;
    drag = null;
    if (y + project(v) > h * 0.4 && v > -50) closeSheet(d, v);
    else animate(d.id, { y }, { y: 0 }, { velocity: { y: v }, damping: 0.85, response: 0.35, onUpdate: ({ y: v2 }) => setSheetY(d, v2) });
  };
  d.addEventListener("touchend", end);
  d.addEventListener("touchcancel", end);
}

document.querySelectorAll("dialog.sheet").forEach(setupSheet);

/* ---------- Tap again to confirm ---------- */
// For actions that can't be undone: the first tap turns the button into a red
// "tap again" prompt for a few seconds; only the second tap acts.
function confirmTap(btn, prompt) {
  if (btn.dataset.armed) {
    clearTimeout(Number(btn.dataset.armed));
    btn.innerHTML = btn.dataset.label;
    delete btn.dataset.armed;
    btn.classList.remove("armed");
    return true;
  }
  btn.dataset.label = btn.innerHTML;
  btn.textContent = prompt;
  btn.classList.add("armed");
  btn.dataset.armed = String(setTimeout(() => {
    btn.innerHTML = btn.dataset.label;
    delete btn.dataset.armed;
    btn.classList.remove("armed");
  }, 4000));
  return false;
}
