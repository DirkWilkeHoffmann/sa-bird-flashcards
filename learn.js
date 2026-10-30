"use strict";
// The Dirk Progression (docs/dirk-progression-coding-spec.md): every bird has a weight for how well
// it's known, the player has a momentum from their last answers, and together they decide which
// bird comes next and when new birds join the pool. No page or storage code here, so Node can run
// it too (scripts/test-learn.mjs). `rng` is Math.random unless a test passes its own.

const Learn = (() => {
  const C = {
    START: -2, FLOOR: -5, MASTERED: 4, MAX: 7,      // weights
    RIGHT: 1, RIGHT_HIGH: 1.5, RIGHT_PERFECT: 2, WRONG: -1, HINT_RIGHT: 0, HINT_WRONG: -0.5,
    RUN_TO_MASTER: 3,                                // correct in a row without a hint → mastered
    N: 10, M_START: 5, WELL: 8, HIGH: 14, PERFECT: 20, // momentum
    POINTS: { right: 2, wrong: -2, hintRight: 1, hintWrong: -1 },
    SESSION_GAP_MS: 30 * 60 * 1000,
    AVG_WINDOW: 100,                                 // answers in the average momentum
    L_LOW: 15, L_NORMAL: 25, L_HIGH: 40, L_MIN: 8, L_MAX: 50,
    SHRINK_WINDOW: 20,                               // answers to look back for "L has shrunk"
    FIRST_POOL: 20, ADD_MIN: 2, ADD_MAX: 5,
    ADD_PERFECT: 5, ADD_BY_BAND: [4, 3, 2, 2, 2],     // birds per batch: perfect, then by momentum band
    REST_CHANCE: 0.1, REST_MAX_DAYS: 30,             // weight 7 → 6, per day
    RECENT: 3,                                       // no bird from the last 3 cards (except retries)
    RETRY_FIRST: [3, 5], RETRY_SECOND: [5, 8],       // cards before a missed bird comes back
    BAND_MASTERED: [0.05, 0.10, 0.15, 0.25, 0.35],   // chance of a mastered bird, by momentum band
    GROUP_SHARES: [0.15, 0.20, 0.30], BEGINNER_MIN: 20, // Beginner, Easy, Medium; Hard = the rest
    // The first-time walkthrough (docs/plan-first-time-walkthrough.md): by how well the player says
    // they know birds, the first session's momentum, the average momentum it seeds (so L's target),
    // how many of the area's Beginner / Easy / Medium birds start in L, and their starting weight.
    LEVELS: {
      start: { m: 5, avg: 5, take: [15, 0, 0], w: -2 },
      some: { m: 8, avg: 10, take: [25, 0, 0], w: -2 },
      most: { m: 12, avg: 12, take: [25, 15, 0], w: -1 },
      expert: { m: 16, avg: 16, take: [15, 15, 10], w: 0 },
    },
    SEED_ANSWERS: 20,                                 // how many answers the seeded average counts as
    SCORE: { common: 0.6, spread: 0.25, plain: 0.15 },
    // In a region or near me, spread across all of southern Africa says little (a Cape Sugarbird is
    // everywhere in Cape Town), so there only how common and how easily confused count.
    SCORE_LOCAL: { common: 0.85, spread: 0, plain: 0.15 },
  };
  const GROUPS = ["beginner", "easy", "medium", "hard"];

  const blank = () => ({
    v: 1, birds: {}, avg: [], lSizes: [], restDay: null, allKnown: {},
    session: { answers: [], lastAt: 0, card: 0, recent: [], retries: [] },
  });

  const bird = (state, id) => state.birds[id] || { w: C.START, seen: false, added: false, run: 0, t: 0, u: null };
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const randInt = (lo, hi, rng) => lo + Math.floor(rng() * (hi - lo + 1));

  /* ---------- Momentum ---------- */

  // A new session after 30+ minutes away: momentum starts again from +5, retries are dropped.
  function touch(state, now) {
    const s = state.session;
    if (!s.lastAt || now - s.lastAt > C.SESSION_GAP_MS) {
      state.session = { answers: [], lastAt: now, card: 0, recent: [], retries: [] };
      return true;
    }
    return false;
  }

  // The sum of the last N answers' points; the starting +5 fades out as the window fills.
  // The first session after the walkthrough starts from the player's level instead of +5.
  function momentum(state) {
    const a = state.session.answers.slice(-C.N);
    const sum = a.reduce((x, y) => x + y, 0);
    return sum + ((state.session.start ?? C.M_START) * (C.N - a.length)) / C.N;
  }

  // Band 0 (doing very well) to 4 (struggling).
  function band(m) {
    if (m >= C.HIGH) return 0;
    if (m >= C.WELL) return 1;
    if (m >= 2) return 2;
    if (m >= -4) return 3;
    return 4;
  }

  function averageMomentum(state) {
    const a = state.avg;
    return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  }

  function targetL(state) {
    const avg = averageMomentum(state);
    const t = avg === null || (avg >= C.WELL && avg < C.HIGH) ? C.L_NORMAL : avg < C.WELL ? C.L_LOW : C.L_HIGH;
    return clamp(t, C.L_MIN, C.L_MAX);
  }

  /* ---------- Groups of birds ---------- */

  // The pool split for one area: eligible ids → { l, mastered, resting, unadded }.
  function split(state, ids) {
    const out = { l: [], mastered: [], resting: [], unadded: [] };
    for (const id of ids) {
      const b = bird(state, id);
      if (!b.added) out.unadded.push(id);
      else if (b.w < C.MASTERED) out.l.push(id);
      else if (b.w < C.MAX) out.mastered.push(id);
      else out.resting.push(id);
    }
    return out;
  }

  // Difficulty groups for an area. `info` maps id → { rank (0 = commonest here), spread (map cells),
  // mixups (known confusions) }. `local`: a region or near me (see SCORE_LOCAL).
  // Returns four lists (Beginner … Hard), each commonest first.
  function groupsFor(ids, info, local = false) {
    const n = ids.length;
    if (!n) return [[], [], [], []];
    const pct = (key, higherIsBetter) => {
      const sorted = [...ids].sort((a, b) => info[a][key] - info[b][key]);
      const out = {};
      sorted.forEach((id, i) => { out[id] = n === 1 ? 1 : (higherIsBetter ? i : n - 1 - i) / (n - 1); });
      return out;
    };
    const common = pct("rank", false), spread = pct("spread", true), plain = pct("mixups", false);
    const k = local ? C.SCORE_LOCAL : C.SCORE;
    const score = (id) => k.common * common[id] + k.spread * spread[id] + k.plain * plain[id];
    const ranked = [...ids].sort((a, b) => score(b) - score(a) || info[a].rank - info[b].rank);
    const beginner = Math.min(n, Math.max(C.BEGINNER_MIN, Math.round(n * C.GROUP_SHARES[0])));
    const easy = Math.min(n, beginner + Math.round(n * C.GROUP_SHARES[1]));
    const medium = Math.min(n, easy + Math.round(n * C.GROUP_SHARES[2]));
    const byRank = (list) => list.sort((a, b) => info[a].rank - info[b].rank);
    return [ranked.slice(0, beginner), ranked.slice(beginner, easy), ranked.slice(easy, medium), ranked.slice(medium)].map(byRank);
  }

  /* ---------- Adding new birds ---------- */

  // Adding a bird isn't a change to what the player knows, so it gets no `u`: on a new phone the
  // starter birds must not win over the account's real weights when they sync.
  function addBirds(state, ids) {
    for (const id of ids) state.birds[id] = { ...bird(state, id), added: true };
  }

  // Pick `x` birds to add: from the first group that still has birds, at random among the 2x
  // commonest not yet added; then the next group if that one runs out.
  function chooseNew(state, groups, x, rng) {
    const picked = [];
    for (let g = 0; g < groups.length && picked.length < x; g++) {
      const left = groups[g].filter((id) => !bird(state, id).added && !picked.includes(id));
      const from = left.slice(0, 2 * (x - picked.length));
      while (from.length && picked.length < x) picked.push(from.splice(Math.floor(rng() * from.length), 1)[0]);
    }
    return picked;
  }

  // Called with an area's eligible birds and groups. First visit: the 20 commonest Beginner birds.
  // After that: top L up to its target when the player is doing well, L has shrunk, or L is tiny.
  // Birds come in batches of 2–5 (never one at a time): more the higher the momentum, or as many as
  // L is short if that's more. Returns the ids added (maybe none).
  function maybeAdd(state, ids, groups, now, rng = Math.random) {
    const parts = split(state, ids);
    if (!parts.l.length && !parts.mastered.length && !parts.resting.length) {
      const first = groups[0].filter((id) => !bird(state, id).added).slice(0, C.FIRST_POOL);
      const list = first.length ? first : chooseNew(state, groups, C.FIRST_POOL, rng);
      addBirds(state, list);
      return list;
    }
    const size = parts.l.length, target = targetL(state);
    if (size >= target || !parts.unadded.length) return [];
    const back = state.lSizes.length >= C.SHRINK_WINDOW ? state.lSizes[state.lSizes.length - C.SHRINK_WINDOW] : null;
    const shrunk = back !== null && size < back;
    const m = momentum(state);
    if (!(m >= C.WELL || shrunk || size < C.L_MIN)) return [];
    const byMomentum = m >= C.PERFECT ? C.ADD_PERFECT : C.ADD_BY_BAND[band(m)];
    const x = clamp(Math.max(target - size, byMomentum), C.ADD_MIN, C.ADD_MAX);
    const list = chooseNew(state, groups, x, rng);
    addBirds(state, list);
    if (list.length) state.lSizes = [];  // a fresh start for "has L shrunk"
    return list;
  }

  // A new player's start, from the walkthrough: replaces the pool with the area's commonest birds
  // for their level. Call after touch(). Returns the ids added.
  function setup(state, level, groups) {
    const L = C.LEVELS[level] || C.LEVELS.start;
    state.birds = {};
    state.session.start = L.m;
    state.avg = Array(C.SEED_ANSWERS).fill(L.avg);
    const ids = groups.flatMap((g, i) => g.slice(0, L.take[i] || 0));
    for (const id of ids) state.birds[id] = { ...bird(state, id), w: L.w, added: true };
    return ids;
  }

  /* ---------- Choosing the next bird ---------- */

  // ctx: { ids (eligible here), skip (Set: hidden or already queued), ahead (cards queued before
  // this one), rank (id → commonness) }. Returns { id, why } or null when nothing is eligible.
  function pick(state, ctx, rng = Math.random) {
    const s = state.session;
    const cardNo = s.card + (ctx.ahead || 0);
    const ok = (id) => !ctx.skip.has(id);
    const last = s.recent[s.recent.length - 1];
    const recent = new Set(s.recent.slice(-C.RECENT));
    const parts = split(state, ctx.ids.filter(ok));

    // 1. A missed bird that's due back.
    const inArea = new Set(ctx.ids);
    const due = s.retries.filter((r) => r.at <= cardNo && inArea.has(r.id) && ok(r.id) && r.id !== last)
      .sort((a, b) => a.at - b.at)[0];
    if (due) return { id: due.id, why: "retry" };

    const m = momentum(state), b = band(m);
    const fresh = (list) => list.filter((id) => !recent.has(id));
    const notLast = (list) => list.filter((id) => id !== last);

    // 2. Now and then a mastered bird, lower weights more likely.
    const mastered = fresh(parts.mastered);
    if (mastered.length && (rng() < C.BAND_MASTERED[b] || !parts.l.length)) {
      return { id: weighted(mastered, (id) => C.MAX - bird(state, id).w, rng), why: "mastered" };
    }

    // 3. From L: sorted by weight, the band for this momentum, one at random.
    let l = fresh(parts.l);
    if (!l.length) l = notLast(parts.l);
    if (l.length) {
      const rank = ctx.rank || {};
      l.sort((x, y) => bird(state, x).w - bird(state, y).w || bird(state, x).t - bird(state, y).t
        || (rank[x] ?? 1e9) - (rank[y] ?? 1e9));
      const n = l.length;
      const from = Math.floor((n * b) / 5), to = Math.max(from + 1, Math.floor((n * (b + 1)) / 5));
      const slice = l.slice(Math.min(from, n - 1), Math.min(to, n));
      return { id: slice[Math.floor(rng() * slice.length)], why: `band${b + 1}` };
    }

    // 4. Nothing left to learn: mastered birds, then resting ones.
    const anyMastered = notLast(parts.mastered);
    if (anyMastered.length) return { id: weighted(anyMastered, (id) => C.MAX - bird(state, id).w, rng), why: "mastered" };
    const resting = notLast(parts.resting);
    if (resting.length) return { id: resting[Math.floor(rng() * resting.length)], why: "rest" };
    return null;
  }

  function weighted(list, weightOf, rng) {
    const ws = list.map((id) => Math.max(0.1, weightOf(id)));
    let r = rng() * ws.reduce((x, y) => x + y, 0);
    for (let i = 0; i < list.length; i++) { r -= ws[i]; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  }

  // A card was shown (answered, skipped or not).
  function shown(state, id, now) {
    const s = state.session;
    s.card += 1;
    s.recent = [...s.recent.filter((x) => x !== id), id].slice(-10);
    s.lastAt = now;
    state.birds[id] = { ...bird(state, id), seen: true, added: true, t: now };
  }

  /* ---------- Answers ---------- */

  // result: "right" | "wrong" | "hintRight" | "hintWrong". `lSize` is L's size before the answer.
  // Returns { before, after, mastered, m } where m is the momentum the answer was graded with.
  function answer(state, id, result, now, lSize, rng = Math.random) {
    const s = state.session;
    const m = momentum(state);
    const b = bird(state, id);
    let delta = { wrong: C.WRONG, hintRight: C.HINT_RIGHT, hintWrong: C.HINT_WRONG }[result];
    if (result === "right") delta = m >= C.PERFECT ? C.RIGHT_PERFECT : m >= C.HIGH ? C.RIGHT_HIGH : C.RIGHT;
    const run = result === "right" ? (b.run || 0) + 1 : 0;
    let w = clamp(b.w + delta, C.FLOOR, C.MAX);
    if (run >= C.RUN_TO_MASTER) w = Math.max(w, C.MASTERED);
    state.birds[id] = { ...b, w, run, seen: true, added: true, u: new Date(now).toISOString() };

    s.answers = [...s.answers, C.POINTS[result]].slice(-C.N);
    s.lastAt = now;
    state.avg = [...state.avg, momentum(state)].slice(-C.AVG_WINDOW);
    if (lSize !== undefined) state.lSizes = [...state.lSizes, lSize].slice(-C.SHRINK_WINDOW);

    // Missed birds come back soon: 3–5 cards, then 5–8, then back to the normal rules.
    const old = s.retries.find((r) => r.id === id);
    s.retries = s.retries.filter((r) => r.id !== id);
    if (result === "wrong" || result === "hintWrong") {
      const misses = (old?.misses || 0) + 1;
      const gap = misses === 1 ? C.RETRY_FIRST : misses === 2 ? C.RETRY_SECOND : null;
      if (gap) s.retries.push({ id, misses, at: s.card + randInt(gap[0], gap[1], rng) });
    }
    return { before: b.w, after: w, mastered: b.w < C.MASTERED && w >= C.MASTERED, m };
  }

  /* ---------- Once a day: resting birds come back now and then ---------- */

  function dayKey(now) {
    const d = new Date(now);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // Returns how many resting birds dropped to 6.
  function restDecay(state, now, rng = Math.random) {
    const today = dayKey(now);
    if (state.restDay === today) return 0;
    const days = state.restDay
      ? clamp(Math.round((new Date(today) - new Date(state.restDay)) / 86400000), 1, C.REST_MAX_DAYS) : 1;
    state.restDay = today;
    const chance = 1 - (1 - C.REST_CHANCE) ** days;
    let n = 0;
    for (const [id, b] of Object.entries(state.birds)) {
      if (b.w >= C.MAX && rng() < chance) {
        state.birds[id] = { ...b, w: C.MAX - 1, u: new Date(now).toISOString() };
        n++;
      }
    }
    return n;
  }

  /* ---------- Moving progress from before the Dirk Progression ---------- */

  // stats: { id: { right, wrong, streak } }; seenIds: birds shown before.
  function migrate(stats, seenIds, now) {
    const state = blank();
    const u = new Date(now).toISOString();
    const add = (id, w) => { state.birds[id] = { w, seen: true, added: true, run: 0, t: 0, u }; };
    for (const id of seenIds) add(id, C.START);
    for (const [id, st] of Object.entries(stats)) {
      if (!(st.right || st.wrong)) continue;
      add(id, (st.streak || 0) >= 3 ? C.MASTERED : clamp(C.START + (st.right || 0) - (st.wrong || 0), C.FLOOR, C.MASTERED - 1));
    }
    return state;
  }

  // Newest change per bird wins. Returns true when anything here changed.
  function merge(state, remote) {
    let changed = false;
    for (const [id, rb] of Object.entries(remote?.birds || {})) {
      const lb = state.birds[id];
      if (!lb || !lb.u || (rb.u && rb.u > lb.u)) {
        state.birds[id] = { ...bird(state, id), ...rb };
        changed = true;
      }
    }
    return changed;
  }

  const status = (state, id) => {
    const b = state.birds[id];
    if (!b || !b.seen) return "new";
    return b.w >= C.MASTERED ? "mastered" : "learning";
  };

  return { C, GROUPS, blank, bird, touch, momentum, band, averageMomentum, targetL, split, groupsFor,
           maybeAdd, chooseNew, addBirds, setup, pick, shown, answer, restDecay, dayKey, migrate, merge, status };
})();

if (typeof module !== "undefined") module.exports = Learn;
