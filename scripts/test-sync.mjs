// Checks that signing in on another phone never loses the streak or stickers (progress.js and
// streak.js, run against a pretend server).  node scripts/test-sync.mjs [file to test instead of progress.js]
//
// What went wrong on 18 Nov 2026: a new phone's first sync read the phone's own (empty) profile;
// signing in switched the phone to the account's code while that read was on its way; the sync then
// saved the empty view under the account's code, replacing every streak day and sticker.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import assert from "node:assert/strict";

const root = new URL("..", import.meta.url);
const progressFile = process.argv[2] || new URL("progress.js", root);
const Learn = createRequire(import.meta.url)("../learn.js");

let failures = 0;
async function check(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); }
  catch (e) { failures++; console.log(`FAIL ${name}\n     ${e.message}`); }
}

// The account's record before the new phone signs in: 13 days in a row, each with a sticker.
const ACCOUNT = "bird-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA";
const PHONE = "bird-BBBBB-BBBBB-BBBBB-BBBBB-BBBBB";
const accountDays = {};
for (let d = 5; d <= 17; d++) accountDays[`2026-11-${String(d).padStart(2, "0")}`] = { a: 40, r: 30, m: 2, k: 1000 + d };

// A pretend Supabase: the profile functions replace the whole document (as profile_push did before
// 20261118_profile_days_merge.sql), so the phone alone has to keep the account's days safe.
function server() {
  const s = { profiles: { [ACCOUNT]: { v: 1, birds: { 5: { w: 4, seen: true, added: 1, run: 0, u: 1 } },
    settings: { area: "c:ZA", near: null, family: "", u: "2026-11-01T00:00:00.000Z" }, days: structuredClone(accountDays) } },
    onPull: null };
  const answer = (v) => ({ ok: true, status: v === undefined ? 204 : 200, json: async () => v });
  s.fetch = async (url, opts) => {
    await new Promise((r) => setTimeout(r, 1));  // every request takes a moment
    const name = String(url).split("/").pop();
    const body = JSON.parse(opts.body);
    if (name === "sync_pull") return answer({ progress: [], mixups: [], hidden: [] });
    if (name === "photo_decisions") return answer({ removed: [], kept: [] });
    if (name === "profile_pull") {
      const doc = s.profiles[body.p_key] ?? null;
      if (s.onPull) s.onPull(body.p_key);
      return answer(structuredClone(doc));
    }
    if (name === "profile_push") { s.profiles[body.p_key] = structuredClone(body.p_data); return answer(); }
    return answer();  // sync_push, log_events
  };
  return s;
}

// A phone: localStorage, the page bits progress.js touches, then streak.js and progress.js themselves.
function phone(srv, { code, days = {} }) {
  const store = new Map();
  const el = () => ({ textContent: "", open: false, value: "", classList: { contains: () => false }, addEventListener() {} });
  const ctx = {
    console, setTimeout, clearTimeout, crypto: globalThis.crypto, structuredClone, fetch: srv.fetch, Learn,
    IS_DEV: false, document: { addEventListener() {}, visibilityState: "visible" }, window: { addEventListener() {} },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
  };
  vm.createContext(ctx);
  vm.runInContext(`
    const storeKey = (k) => k;
    function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
    function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
    const els = {}; const $ = (id) => (els[id] ??= (${el})());
    const STATS_KEY = "s.stats", HIDDEN_KEY = "s.hidden", LEARN_KEY = "s.learn", SETTINGS_KEY = "s.settings",
      NAMES_KEY = "s.names", NAMES_U_KEY = "s.namesU", SNOOZE_KEY = "s.snooze", SEEN_KEY = "s.seen";
    let stats = {}, learn = Learn.blank(), learnDirty = false, queue = [], card = null, afFirst = false, snoozed = {};
    let settings = { v: 2, area: "c:ZA", near: null, family: "", u: null };
    let photoDecisions = { removed: [], kept: [] }, hiddenPhotos = new Set(), species = [], seenBirds = new Set();
    let session = {};
    const applyArea = () => {}, topUp = () => {}, nextCard = () => {}, summary = () => "";
    const confirmTap = () => true, haptic = () => {}, showToast = () => {};
  `, ctx);
  ctx.localStorage.setItem("sabirds.syncCode.v1", JSON.stringify(code));
  ctx.localStorage.setItem("sabirds.days.v1", JSON.stringify(days));
  vm.runInContext(readFileSync(new URL("streak.js", root), "utf8"), ctx);
  vm.runInContext(readFileSync(progressFile, "utf8"), ctx);
  ctx.run = (js) => vm.runInContext(js, ctx);
  return ctx;
}

const stickers = (days) => Object.values(days || {}).filter((d) => d.k).length;

await check("signing in while the first sync is on its way keeps the account's streak and stickers", async () => {
  const srv = server();
  const p = phone(srv, { code: PHONE, days: { "2026-11-18": { a: 12, r: 10, m: 0 } } });
  let adopting = null;
  // linkAccount finds the account and switches this phone to its code while the phone's own
  // profile is being read.
  srv.onPull = (key) => { if (key === PHONE && !adopting) adopting = p.run(`adoptCode(${JSON.stringify(ACCOUNT)})`); };
  const first = p.run("syncNow()");
  await first;
  await adopting;
  await p.run("syncNow()");
  const saved = srv.profiles[ACCOUNT].days;
  assert.equal(stickers(saved), 13, `account has ${stickers(saved)} of 13 stickers left: ${JSON.stringify(saved)}`);
  assert.deepEqual(saved["2026-11-18"], { a: 12, r: 10, m: 0 }, "today's play on the new phone is added");
  assert.equal(p.run("currentStreak(new Date('2026-11-18T12:00'))"), 14, "the phone shows the 14-day streak");
  assert.ok(srv.profiles[ACCOUNT].birds[5], "the account's birds are kept too");
});

await check("two syncs at once on the new phone keep the account's streak and stickers", async () => {
  const srv = server();
  const p = phone(srv, { code: PHONE });
  p.run(`save(SYNC_CODE_KEY, ${JSON.stringify(ACCOUNT)}); save("sabirds.joining.v1", true);`);
  await Promise.all([p.run("syncNow()"), p.run("syncNow()"), p.run("syncNow()")]);
  assert.equal(stickers(srv.profiles[ACCOUNT].days), 13);
  assert.equal(p.run("Object.values(days).filter((d) => d.k).length"), 13);
});

await check("a phone that has the streak and one that doesn't: both end up with all of it", async () => {
  const srv = server();
  const a = phone(srv, { code: ACCOUNT, days: structuredClone(accountDays) });
  const b = phone(srv, { code: PHONE, days: { "2026-11-18": { a: 30, r: 26, m: 1, k: 77 } } });
  b.run(`adoptCode(${JSON.stringify(ACCOUNT)})`);
  await b.run("syncNow()");
  await a.run("syncNow()");
  for (const [name, p] of [["first", a], ["second", b]]) {
    await p.run("syncNow()");
    assert.equal(p.run("Object.values(days).filter((d) => d.k).length"), 14, `${name} phone`);
  }
  assert.equal(stickers(srv.profiles[ACCOUNT].days), 14);
});

await check("signing out leaves no streak behind for the next account on this phone", async () => {
  const srv = server();
  const p = phone(srv, { code: ACCOUNT, days: structuredClone(accountDays) });
  await p.run("syncNow()");
  p.run("startFresh()");
  assert.equal(p.run("Object.keys(days).length"), 0, "days cleared on the phone");
  assert.equal(p.run("Object.keys(load(DAYS_KEY, {})).length"), 0, "and in its storage");
  assert.equal(stickers(srv.profiles[ACCOUNT].days), 13, "the account keeps them");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
