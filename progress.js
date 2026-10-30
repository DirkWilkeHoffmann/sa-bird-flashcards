"use strict";
// Learning progress (New / Learning / Mastered) and syncing it between devices.
// Progress lives on the phone (localStorage) and is mirrored to Supabase under a private
// sync code. The database only exposes two functions, sync_pull and sync_push; the code
// is stored there as a hash. Newest change per bird wins when two devices disagree.

const MIXUPS_KEY = "sabirds.mixups.v1";
const SYNC_CODE_KEY = "sabirds.syncCode.v1";
const SYNC_URL = "https://oenkcaswabrkqhvukcyb.supabase.co/rest/v1/rpc";
const SYNC_API_KEY = "sb_publishable_3n_rTfWAWYptlsWuCNqyUQ_x6emNOwB"; // public by design
const SYNC_DELAY_MS = 4000;
const REVIEW_URL = "https://oenkcaswabrkqhvukcyb.supabase.co/functions/v1/photo-review";
const REPORTS_KEY = "sabirds.pendingReports.v1";

let mixups = load(MIXUPS_KEY, {});  // { [speciesId]: { [pickedId]: count } }
let dirty = new Set(load("sabirds.dirty.v1", []));  // birds changed since the last successful push
let hiddenDirty = new Set(load("sabirds.hiddenDirty.v1", []));
let syncTimer = null;
const EVENTS_KEY = "sabirds.events.v1";
let events = load(EVENTS_KEY, []);  // anonymous usage events waiting to be sent: { t, id, d, at }
let lastSync = null;

/* ---------- Status ---------- */

// Mastered = weight 4 or more (Dirk Progression); Learning = seen, below 4; New = not seen yet.
const status = (id) => Learn.status(learn, id);

function noteMixup(id, pickedId) {
  mixups[id] ??= {};
  mixups[id][pickedId] = (mixups[id][pickedId] || 0) + 1;
  save(MIXUPS_KEY, mixups);
}

function markDirty(id) {
  dirty.add(id);
  save("sabirds.dirty.v1", [...dirty]);
  syncSoon();
}

function noteHidden(photoId, speciesId) {
  hiddenDirty.add(`${photoId}:${speciesId}`);
  save("sabirds.hiddenDirty.v1", [...hiddenDirty]);
  syncSoon();
}

/* ---------- Usage events ---------- */
// Anonymous counts of what players do (answers, hints, skips, level-ups, …), sent with the
// normal sync under the hashed sync code: no names or emails. Shown on admin.html.
function logEvent(t, id = null, d = null) {
  events.push({ t, id, d, at: new Date().toISOString() });
  if (events.length > 1000) events = events.slice(-1000);  // offline for a long time: keep the newest
  save(EVENTS_KEY, events);
  syncSoon();
}

async function sendEvents() {
  while (events.length) {
    const batch = events.slice(0, 500);
    await rpc("log_events", { p_key: syncCode(), p_env: IS_DEV ? "dev" : "main", p_events: batch });
    events = events.slice(batch.length);
    save(EVENTS_KEY, events);
  }
}

/* ---------- Sync ---------- */

function syncCode() {
  let code = load(SYNC_CODE_KEY, null);
  if (!code) {
    // 25 random characters from an unambiguous alphabet, e.g. bird-7KQ2M-X9PHT-...
    const abc = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    const chars = [...bytes].map((b) => abc[b % abc.length]).join("");
    code = `bird-${chars.match(/.{5}/g).join("-")}`;
    save(SYNC_CODE_KEY, code);
  }
  return code;
}

async function rpc(name, body) {
  const r = await fetch(`${SYNC_URL}/${name}`, {
    method: "POST",
    headers: { apikey: SYNC_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${name} failed: ${r.status}`);
  return r.status === 204 ? null : r.json();
}

function setSyncStatus(text) {
  const el = $("syncStatus");
  if (el) el.textContent = text;
}

// Merge what the server has into this phone: newest change per bird wins.
function mergeRemote(remote) {
  let changed = false;
  for (const row of remote.progress || []) {
    const local = stats[row.id];
    if (!local || !local.updated || new Date(row.updated) > new Date(local.updated)) {
      stats[row.id] = { right: row.right, wrong: row.wrong, hint: local?.hint || 0, streak: row.streak,
                        seen: row.seen, updated: row.updated };
      dirty.delete(row.id);
      changed = true;
    }
  }
  for (const m of remote.mixups || []) {
    mixups[m.id] ??= {};
    mixups[m.id][m.picked] = Math.max(mixups[m.id][m.picked] || 0, m.n);
  }
  const kept = new Set(photoDecisions.kept);
  for (const photoId of remote.hidden || []) {
    if (!hiddenPhotos.has(photoId) && !kept.has(photoId)) {
      hiddenPhotos.add(photoId);
      for (const s of species) {
        if (s.photos.length > 1) s.photos = s.photos.filter((p) => p.id !== photoId);
      }
      changed = true;
    }
  }
  save(STATS_KEY, stats);
  save(MIXUPS_KEY, mixups);
  save(HIDDEN_KEY, [...hiddenPhotos]);
  save("sabirds.dirty.v1", [...dirty]);
  return changed;
}

async function pushDirty() {
  const progress = [...dirty].filter((id) => stats[id]).map((id) => {
    const st = stats[id];
    return { id: Number(id), right: st.right || 0, wrong: st.wrong || 0, streak: st.streak || 0,
             seen: st.seen || null, updated: st.updated || new Date().toISOString() };
  });
  const mix = [];
  for (const id of dirty) {
    for (const [picked, n] of Object.entries(mixups[id] || {})) mix.push({ id: Number(id), picked: Number(picked), n });
  }
  const hidden = [...hiddenDirty].map((x) => {
    const [photo, id] = x.split(":").map(Number);
    return { photo, id };
  });
  if (!progress.length && !mix.length && !hidden.length) return;
  await rpc("sync_push", { p_key: syncCode(), p_progress: progress, p_mixups: mix, p_hidden: hidden });
  dirty.clear();
  hiddenDirty.clear();
  save("sabirds.dirty.v1", []);
  save("sabirds.hiddenDirty.v1", []);
}

/* ---------- Weights, pool and area (Dirk Progression) ---------- */
// One document per sync code (profile_pull / profile_push, see
// supabase/migrations/20261029_learner_profiles.sql). Newest change wins, per bird and for the area.
// Until that migration is applied the calls fail and everything stays on this phone.
let profileMissing = false;

async function syncProfile() {
  if (profileMissing || !learn) return;
  let remote;
  try { remote = await rpc("profile_pull", { p_key: syncCode() }); }
  catch (e) { if (/ 404$/.test(e.message)) profileMissing = true; throw e; }
  let changed = false;
  if (remote) {
    changed = Learn.merge(learn, remote);
    const rs = remote.settings;
    const other = rs && (rs.area !== settings.area || (rs.family || "") !== (settings.family || ""));
    if (rs?.u && (!settings.u || rs.u > settings.u) && other) {
      applyArea(rs.area, rs.near || null, { family: rs.family || "", fromSync: true });
      settings.u = rs.u;
      save(SETTINGS_KEY, settings);
    } else if (rs?.u && (!settings.u || rs.u > settings.u)) {
      settings.u = rs.u;
      save(SETTINGS_KEY, settings);
    }
    if (changed) { save(LEARN_KEY, learn); queue = []; }
  }
  const remoteBehind = !remote || (settings.u && settings.u !== remote.settings?.u);
  if (!learnDirty && !remoteBehind && !(remote && Object.keys(learn.birds).length > Object.keys(remote.birds || {}).length)) return;
  const birds = Object.fromEntries(Object.entries(learn.birds).map(([id, b]) => [id, { w: b.w, seen: b.seen, added: b.added, run: b.run, u: b.u }]));
  await rpc("profile_push", { p_key: syncCode(), p_data: { v: 1, birds, settings: { area: settings.area, near: settings.near, family: settings.family || "", u: settings.u } } });
  learnDirty = false;
  save("sabirds.learnDirty.v1", false);
}

/* ---------- Flagged photos: email the owner, apply their decisions ---------- */

let pendingReports = load(REPORTS_KEY, []);  // reports made while offline

function reportPhoto(photo, s) {
  pendingReports.push({ photo_id: photo.id, species_id: s.id, species_name: s.name, photo_url: photoUrl(photo, "large") });
  save(REPORTS_KEY, pendingReports);
  sendReports();
}

// Someone thinks a bird's Afrikaans name is wrong; sent the same way, so it waits if offline.
function reportName(s, suggestion, note) {
  pendingReports.push({ action: "name", species_id: s.id, species_name: s.name, current_name: s.af || "",
                        suggestion, note, env: IS_DEV ? "dev" : "main" });
  save(REPORTS_KEY, pendingReports);
  sendReports();
}

async function sendReports() {
  while (pendingReports.length) {
    const r = await fetch(REVIEW_URL, {
      method: "POST",
      headers: { apikey: SYNC_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "report", ...pendingReports[0] }),
    }).catch(() => null);
    if (!r || r.status >= 500) return;  // offline or server trouble: try again on the next sync
    pendingReports.shift();
    save(REPORTS_KEY, pendingReports);
  }
}

// Removed photos disappear for everyone; kept photos come back for whoever hid them.
async function applyDecisions() {
  const d = await rpc("photo_decisions", {});
  photoDecisions = { removed: d.removed || [], kept: d.kept || [] };
  save("sabirds.photoDecisions.v1", photoDecisions);
  const removed = new Set(photoDecisions.removed);
  let changed = false;
  for (const id of photoDecisions.kept) {
    if (hiddenPhotos.delete(id)) changed = true;
  }
  if (changed) save(HIDDEN_KEY, [...hiddenPhotos]);
  for (const s of species) {
    if (s.photos.some((p) => removed.has(p.id)) && s.photos.length > 1) {
      s.photos = s.photos.filter((p) => !removed.has(p.id));
    }
  }
}

async function syncNow() {
  clearTimeout(syncTimer);
  syncTimer = null;
  try {
    setSyncStatus("Syncing…");
    // First sync on this phone: send everything learned before syncing existed.
    if (!load("sabirds.syncedOnce.v1", false)) Object.keys(stats).forEach((id) => dirty.add(id));
    await pushDirty();
    await sendEvents().catch(() => {});  // usage counts are optional; progress matters more
    mergeRemote(await rpc("sync_pull", { p_key: syncCode() }));
    await syncProfile().catch(() => {});  // weights, pool and area (Dirk Progression)
    await applyDecisions().catch(() => {});
    sendReports();
    save("sabirds.syncedOnce.v1", true);
    lastSync = new Date();
    setSyncStatus(`Synced at ${lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`);
    if ($("progress").open) renderProgress();
  } catch {
    setSyncStatus("Offline — progress is saved on this phone and will sync later.");
  }
}

function syncSoon() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, SYNC_DELAY_MS);
}

function startSync() {
  syncNow();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && (dirty.size || hiddenDirty.size)) syncNow();
    if (document.visibilityState === "visible") syncNow();
  });
  window.addEventListener("online", syncNow);
}

async function useOtherCode() {
  const code = $("otherCode").value.trim();
  if (code.length < 20) { setSyncStatus("That code looks too short. Copy the whole code from the other device."); return; }
  if (code === syncCode()) return;
  // Can't be undone, so ask for a second tap; this phone's progress is added to the other code.
  if (!confirmTap($("useCode"), "Tap again to use it")) return;
  $("otherCode").value = "";
  await adoptCode(code);
}

// After signing out, this phone starts over under a new private code. The account keeps
// everything it learned and brings it back on the next sign-in, so a different account
// starts clean instead of sharing the first one's progress.
function startFresh() {
  stats = {};
  save(STATS_KEY, stats);
  mixups = {};
  save(MIXUPS_KEY, mixups);
  dirty.clear();
  save("sabirds.dirty.v1", []);
  try { localStorage.removeItem(storeKey(SYNC_CODE_KEY)); } catch { /* private mode */ }
  save("sabirds.syncedOnce.v1", false);
  seenBirds = new Set();
  save(SEEN_KEY, []);
  learn = Learn.blank();
  save(LEARN_KEY, learn);
  learnDirty = false;
  save("sabirds.learnDirty.v1", false);
  topUp();
  session = { right: 0, seen: 0 };
  $("score").textContent = "0 / 0";
  $("filterSummary").textContent = summary();
  queue = [];
  nextCard();
  if ($("progress").open) renderProgress();
}

// Switch this phone to another sync code, keeping what it has learned (it is sent under the new code).
async function adoptCode(code) {
  Object.keys(stats).forEach((id) => dirty.add(id));
  save(SYNC_CODE_KEY, code);
  await syncNow();
  if ($("progress").open) renderProgress();
}

/* ---------- Progress screen ---------- */

function bar(list) {
  const n = list.length || 1;
  const m = list.filter((s) => status(s.id) === "mastered").length;
  const l = list.filter((s) => status(s.id) === "learning").length;
  return { m, l, html: `<span class="prog-bar"><span class="m" style="width:${(m / n) * 100}%"></span><span class="l" style="width:${(l / n) * 100}%"></span></span>` };
}

// One group or family with its progress bar; tapping it lists its birds. (A "Study only these
// birds" button may come later: changing the study set belongs in the settings sheet for now.)
function row(label, list, title = label, opts = {}) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "prog-row";
  const { m, l, html } = bar(list);
  b.innerHTML = `<span></span><small>${m} of ${list.length} mastered${l ? ` · ${l} learning` : ""} ${icon("chevron", "small")}</small>${html}`;
  b.querySelector("span").textContent = label;
  b.addEventListener("click", () => openBirdList(title, list, null, opts));
  return b;
}

/* ---------- Bird lists: Mastered, then Learning, then To be seen ---------- */

const LIST_SECTIONS = [["mastered", "Mastered"], ["learning", "Learning"], ["new", "To be seen"]];
const familyName = (s) => s.familyName || s.family || "";

// A list of birds in three sections: Mastered, Learning, To be seen. Lists with more than one family
// are sorted by family, with a small heading per family; tapping a bird shows its info. `at`
// scrolls to a section. `others`: the same kind of birds from other areas, in three more sections
// at the bottom. `family`: a family's list, with "Study only these birds" at the top.
function openBirdList(title, list, at = null, { others = [], family = null } = {}) {
  logEvent("bird_list", null, { title, n: list.length, others: others.length });
  $("birdListTitle").textContent = title;
  const body = $("birdListBody");
  body.replaceChildren();
  if (family) {
    const studying = settings.family === family;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn primary study-family";
    b.textContent = studying ? `Stop: back to ${areaNameOf(settings.area)}` : `Study only these birds (${list.length + others.length})`;
    b.addEventListener("click", () => {
      closeSheet($("birdList"));
      closeSheet($("progress"));
      studyFamily(studying ? "" : family);
    });
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = studying ? "You're studying this family in all areas." : "All of this family's birds, from every area, become your learning group.";
    body.append(b, note);
  }
  birdSections(body, list, "");
  if (others.length) {
    const h = document.createElement("h3");
    h.className = "list-other";
    h.id = "list-other";
    h.textContent = "Other areas";
    body.append(h);
    birdSections(body, others, "other-");
  }
  openSheet($("birdList"));
  if (at) $(`list-${at}`)?.scrollIntoView({ block: "start" });
}

function birdSections(body, list, prefix) {
  const families = new Set(list.map((s) => s.family)).size > 1;
  const order = (a, b) => (families && familyName(a).localeCompare(familyName(b))) || nameOf(a).localeCompare(nameOf(b));
  for (const [key, label] of LIST_SECTIONS) {
    const birds = list.filter((s) => status(s.id) === key).sort(order);
    const h = document.createElement("p");
    h.className = `prog-h list-h ${key}`;
    h.id = `list-${prefix}${key}`;
    h.textContent = `${label} · ${birds.length}`;
    body.append(h);
    if (!birds.length) {
      const none = document.createElement("p");
      none.className = "note";
      none.textContent = "None yet";
      body.append(none);
      continue;
    }
    let grid = null, family = null;
    for (const s of birds) {
      if (!grid || (families && s.family !== family)) {
        if (families) {
          const f = document.createElement("p");
          f.className = "list-family";
          f.textContent = familyName(s);
          body.append(f);
        }
        grid = document.createElement("div");
        grid.className = "lookalikes bird-list";
        body.append(grid);
        family = s.family;
      }
      const b = document.createElement("button");
      b.type = "button";
      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.src = photoUrl(s.photos[0], "small");
      const name = document.createElement("span");
      name.textContent = nameOf(s);
      b.append(img, name);
      if (otherNameOf(s)) {
        const alt = document.createElement("small");
        alt.textContent = otherNameOf(s);
        b.append(alt);
      }
      b.addEventListener("click", () => openBird(s));
      grid.append(b);
    }
  }
}

function renderProgress() {
  const body = $("progressBody");
  body.replaceChildren();
  const info = areaInfo();
  const here = info.ids.map((id) => speciesById.get(id)).filter(Boolean);
  const counts = { mastered: 0, learning: 0, new: 0 };
  for (const s of here) counts[status(s.id)]++;
  const fam = settings.family;
  const place = document.createElement("p");
  place.className = "prog-h";
  place.textContent = `📍 ${areaName()}`;
  // Birds of the same kind that live elsewhere, listed under "Other areas" at the bottom.
  const elsewhere = (list) => species.filter((s) => s.photos.length && !inArea(s) && list(s));
  const total = document.createElement("div");
  total.className = "prog-total";
  total.innerHTML = `<button type="button" class="m" data-at="mastered"><b>${counts.mastered}</b><span>Mastered</span></button>
    <button type="button" class="l" data-at="learning"><b>${counts.learning}</b><span>Learning</span></button>
    <button type="button" data-at="new"><b>${counts.new}</b><span>To be seen</span></button>`;
  for (const b of total.querySelectorAll("button")) {
    b.addEventListener("click", () => openBirdList(areaName(), here, b.dataset.at,
      fam ? { family: fam } : { others: elsewhere(() => true) }));
  }
  const legend = document.createElement("p");
  legend.className = "legend";
  legend.innerHTML = `Mastered = you've shown you know it. More birds join as you learn. Tap a number, group or family to see its birds.<br>
    <i style="background:var(--good)"></i>Mastered<i style="background:var(--tint)"></i>Learning<i style="background:var(--fill-2)"></i>To be seen`;
  body.append(place, total, legend);
  if (fam) {
    // Studying one family: no groups or families to break it into.
    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn ghost";
    back.textContent = `Stop: back to ${areaNameOf(settings.area)}`;
    back.addEventListener("click", () => { closeSheet($("progress")); studyFamily(""); });
    body.append(back);
    if (IS_DEV) body.append(devProgress());
    return;
  }

  const h1 = document.createElement("p");
  h1.className = "prog-h";
  h1.textContent = `By group in ${areaName()}`;
  body.append(h1);
  info.groups.forEach((ids, i) => {
    const name = LEVEL_NAMES[Learn.GROUPS[i]];
    body.append(row(name, ids.map((id) => speciesById.get(id)).filter(Boolean), `${name} in ${areaName()}`));
  });

  const h2 = document.createElement("p");
  h2.className = "prog-h";
  h2.textContent = "By family";
  body.append(h2);
  const families = new Map();
  for (const s of here) {
    if (!families.has(s.family)) families.set(s.family, []);
    families.get(s.family).push(s);
  }
  const sorted = [...families.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [family, list] of sorted) {
    body.append(row(list[0].familyName || family, list, undefined,
      { family, others: elsewhere((s) => s.family === family) }));
  }
  if (IS_DEV) body.append(devProgress());
}

// Dev build only: every number the Dirk Progression uses, and the pool's birds with their weights.
function devProgress() {
  const box = document.createElement("div");
  const m = Learn.momentum(learn), avg = Learn.averageMomentum(learn), parts = areaSplit();
  const C = Learn.C;
  const rows = [
    ["Momentum M", `${m.toFixed(1)} (band ${Learn.band(m) + 1} of 5; well ≥ ${C.WELL}, high ≥ ${C.HIGH}, perfect ${C.PERFECT})`],
    ["Answers this session", learn.session.answers.join(" ") || "none"],
    ["Average M (last 100)", avg === null ? "none yet" : avg.toFixed(1)],
    ["L (learning) / target", `${parts.l.length} / ${Learn.targetL(learn)}`],
    ["Mastered (4–6)", parts.mastered.length],
    ["Resting (7)", parts.resting.length],
    ["Not in pool yet", parts.unadded.length],
    ["Retries waiting", learn.session.retries.map((r) => `${speciesById.get(Number(r.id))?.name || r.id} @${r.at}`).join(", ") || "none"],
    ["Card number", learn.session.card],
    ["Rest check day", learn.restDay || "—"],
    ["Account sync of weights", profileMissing ? "not set up (migration not applied)" : "on"],
  ];
  const pool = [...parts.l, ...parts.mastered, ...parts.resting]
    .map((id) => ({ s: speciesById.get(id), b: Learn.bird(learn, id) }))
    .sort((x, y) => x.b.w - y.b.w);
  box.innerHTML = `<p class="prog-h">Dev: learning state</p>
    <table class="dev-table"><tbody>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</tbody></table>
    <p class="prog-h">Dev: pool birds by weight (${pool.length})</p>
    <table class="dev-table"><thead><tr><th>Bird</th><th>Group</th><th class="n">Weight</th><th class="n">Run</th></tr></thead><tbody>
    ${pool.map(({ s, b }) => `<tr><td>${s ? s.name : "?"}${b.seen ? "" : " (new)"}</td><td>${areaInfo().groupOf[s?.id] || ""}</td>`
      + `<td class="n">${b.w}</td><td class="n">${b.run || 0}</td></tr>`).join("")}</tbody></table>`;
  return box;
}

function openProgress() {
  renderProgress();
  $("syncCode").textContent = syncCode();
  setSyncStatus(lastSync ? `Synced at ${lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.` : "");
  openSheet($("progress"));
}

$("progressBtn").addEventListener("click", openProgress);
$("copyCode").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(syncCode()); $("copyCode").textContent = "Copied"; }
  catch { /* the code is selectable as a fallback */ }
  setTimeout(() => { $("copyCode").textContent = "Copy"; }, 1500);
});
$("useCode").addEventListener("click", useOtherCode);
