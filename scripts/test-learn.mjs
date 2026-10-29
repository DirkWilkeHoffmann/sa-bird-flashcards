// Checks learn.js: the rules from docs/dirk-progression-coding-spec.md, then a simulated player of
// each kind over 30 days of play.  node scripts/test-learn.mjs
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const Learn = createRequire(import.meta.url)("../learn.js");
const { C } = Learn;

// A seeded random number generator, so runs repeat.
function seeded(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}

let failures = 0;
function check(name, fn) {
  try { fn(); console.log(`ok   ${name}`); }
  catch (e) { failures++; console.log(`FAIL ${name}\n     ${e.message}`); }
}

const now0 = new Date("2026-11-01T08:00:00").getTime();
const ids = Array.from({ length: 300 }, (_, i) => i + 1);
const info = Object.fromEntries(ids.map((id) => [id, { rank: id, spread: 400 - id, mixups: id % 4 }]));
const groups = Learn.groupsFor(ids, info);
const rank = Object.fromEntries(ids.map((id) => [id, id]));

check("groups: 15% (at least 20), 20%, 30%, rest; commonest first", () => {
  assert.deepEqual(groups.map((g) => g.length), [45, 60, 90, 105]);
  assert.ok(groups[0].every((id, i) => i === 0 || groups[0][i - 1] < id));
  const small = Learn.groupsFor(ids.slice(0, 50), info);
  assert.equal(small[0].length, 20);
});

check("momentum starts at +5 and fades into the answers", () => {
  const s = Learn.blank();
  Learn.touch(s, now0);
  assert.equal(Learn.momentum(s), 5);
  s.session.answers = [2, 2, 2, 2, 2];
  assert.equal(Learn.momentum(s), 12.5);
  s.session.answers = Array(10).fill(2);
  assert.equal(Learn.momentum(s), 20);
});

check("weights: +1, +1.5 high, +2 perfect, −1, 0, −0.5; floor −5, cap 7", () => {
  const s = Learn.blank();
  Learn.touch(s, now0);
  Learn.answer(s, 1, "wrong", now0);
  assert.equal(Learn.bird(s, 1).w, -3);
  Learn.answer(s, 1, "hintRight", now0);
  assert.equal(Learn.bird(s, 1).w, -3);
  Learn.answer(s, 1, "hintWrong", now0);
  assert.equal(Learn.bird(s, 1).w, -3.5);
  for (let i = 0; i < 5; i++) Learn.answer(s, 1, "wrong", now0);
  assert.equal(Learn.bird(s, 1).w, -5);
  s.session.answers = Array(10).fill(2);           // perfect
  Learn.answer(s, 2, "right", now0);
  assert.equal(Learn.bird(s, 2).w, 0);
  s.session.answers = [2, 2, 2, 2, 2, 2, 2, 2, -2, 2]; // 16: high
  Learn.answer(s, 3, "right", now0);
  assert.equal(Learn.bird(s, 3).w, -0.5);
  s.birds[4] = { ...Learn.bird(s, 4), w: 6.5, added: true };
  s.session.answers = Array(10).fill(2);
  Learn.answer(s, 4, "right", now0);
  assert.equal(Learn.bird(s, 4).w, 7);
});

check("3 right in a row without a hint → mastered (4)", () => {
  const s = Learn.blank();
  Learn.touch(s, now0);
  s.session.answers = [-2, -2, -2];  // low momentum: +1 each
  const r1 = Learn.answer(s, 9, "right", now0);
  Learn.answer(s, 9, "right", now0);
  const r3 = Learn.answer(s, 9, "right", now0);
  assert.equal(r1.after, -1);
  assert.equal(r3.after, 4);
  assert.ok(r3.mastered);
  Learn.answer(s, 10, "right", now0);
  Learn.answer(s, 10, "hintRight", now0);
  Learn.answer(s, 10, "right", now0);
  assert.ok(Learn.bird(s, 10).w < 4, "a hint breaks the run");
});

check("a missed bird comes back after 3–5 cards, then 5–8, then not forced", () => {
  const s = Learn.blank();
  Learn.touch(s, now0);
  Learn.shown(s, 5, now0);
  Learn.answer(s, 5, "wrong", now0, 0, () => 0);
  assert.equal(s.session.retries[0].at, s.session.card + 3);
  Learn.answer(s, 5, "wrong", now0, 0, () => 0.999);
  assert.equal(s.session.retries[0].at, s.session.card + 8);
  Learn.answer(s, 5, "wrong", now0);
  assert.equal(s.session.retries.length, 0);
  Learn.answer(s, 6, "wrong", now0);
  Learn.answer(s, 6, "right", now0);
  assert.equal(s.session.retries.length, 0, "a right answer clears it");
});

check("first visit adds the 20 commonest Beginner birds", () => {
  const s = Learn.blank();
  Learn.touch(s, now0);
  const added = Learn.maybeAdd(s, ids, groups, now0);
  assert.deepEqual(added, groups[0].slice(0, 20));
});

check("resting birds (7) drop to 6 now and then, others never", () => {
  const s = Learn.blank();
  for (const id of ids) s.birds[id] = { ...Learn.bird(s, id), added: true, w: id <= 100 ? 7 : 6 };
  s.restDay = "2026-10-31";
  const n = Learn.restDecay(s, now0, seeded(1));
  assert.ok(n > 2 && n < 25, `dropped ${n} of 100`);
  assert.equal(Learn.restDecay(s, now0, seeded(2)), 0, "once a day");
  assert.ok(ids.slice(100).every((id) => s.birds[id].w === 6));
});

check("moving old progress", () => {
  const s = Learn.migrate({ 1: { right: 5, wrong: 0, streak: 3 }, 2: { right: 2, wrong: 4, streak: 0 },
    3: { right: 9, wrong: 1, streak: 1 } }, [4], now0);
  assert.equal(s.birds[1].w, 4);
  assert.equal(s.birds[2].w, -4);
  assert.equal(s.birds[3].w, 3);
  assert.equal(s.birds[4].w, -2);
});

check("pick: high momentum → lowest weights, low momentum → highest", () => {
  const s = Learn.blank();
  Learn.touch(s, now0);
  for (const id of ids.slice(0, 50)) s.birds[id] = { ...Learn.bird(s, id), added: true, seen: true, w: -5 + id * 0.1 };
  s.session.answers = Array(10).fill(2);
  const lows = new Set();
  const rng = seeded(3);
  for (let i = 0; i < 200; i++) {
    const p = Learn.pick(s, { ids, skip: new Set(), rank }, rng);
    if (p.why.startsWith("band")) lows.add(p.id);
  }
  assert.ok([...lows].every((id) => id <= 10), `high momentum picked ${[...lows]}`);
  s.session.answers = Array(10).fill(-2);
  const highs = new Set();
  for (let i = 0; i < 200; i++) {
    const p = Learn.pick(s, { ids, skip: new Set(), rank }, rng);
    if (p.why.startsWith("band")) highs.add(p.id);
  }
  assert.ok([...highs].every((id) => id > 40), `low momentum picked ${[...highs]}`);
});

// A simulated player: knows a bird with a chance that grows with its weight, plus a skill.
function play(name, skill, days, cardsPerDay) {
  const rng = seeded(42);
  const s = Learn.blank();
  let now = now0, picks = 0, repeats = 0, lastId = null;
  const why = {};
  for (let d = 0; d < days; d++) {
    now = now0 + d * 86400000;
    Learn.restDecay(s, now, rng);
    Learn.touch(s, now);
    lastId = null;  // a new session may start with yesterday's last bird
    for (let c = 0; c < cardsPerDay; c++) {
      Learn.maybeAdd(s, ids, groups, now, rng);
      const p = Learn.pick(s, { ids, skip: new Set(), rank }, rng);
      if (!p) throw new Error(`${name}: nothing to show on day ${d}`);
      picks++;
      if (p.id === lastId) repeats++;
      lastId = p.id;
      why[p.why.replace(/\d/, "")] = (why[p.why.replace(/\d/, "")] || 0) + 1;
      Learn.shown(s, p.id, now);
      const w = Learn.bird(s, p.id).w;
      const chance = Math.min(0.97, skill + (w + 5) * 0.05);
      const r = rng();
      const result = r < chance ? "right" : r < chance + 0.05 ? "hintRight" : r < chance + 0.1 ? "hintWrong" : "wrong";
      const lSize = Learn.split(s, ids).l.length;
      Learn.answer(s, p.id, result, now, lSize, rng);
      now += 8000;
    }
  }
  const parts = Learn.split(s, ids);
  console.log(`     ${name}: pool ${parts.l.length + parts.mastered.length + parts.resting.length}, L ${parts.l.length} `
    + `(target ${Learn.targetL(s)}), mastered ${parts.mastered.length}, resting ${parts.resting.length}, `
    + `avg M ${Learn.averageMomentum(s).toFixed(1)}, picks ${JSON.stringify(why)}`);
  return { s, parts, repeats };
}

for (const [name, skill] of [["novice", 0.35], ["casual", 0.55], ["expert", 0.85]]) {
  check(`simulated ${name}, 30 days × 40 cards`, () => {
    const { s, parts, repeats } = play(name, skill, 30, 40);
    assert.equal(repeats, 0, "never the same bird twice in a row");
    assert.ok(parts.l.length <= C.L_MAX, `L ${parts.l.length}`);
    if (Learn.split(s, ids).unadded.length) assert.ok(parts.l.length >= C.L_MIN, `L ${parts.l.length}`);
    assert.ok(Object.values(s.birds).every((b) => b.w >= C.FLOOR && b.w <= C.MAX));
  });
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
