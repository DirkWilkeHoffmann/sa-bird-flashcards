"use strict";
// Friend quizzes (docs/plan-friend-quizzes.md): add friends with a friend code, send them a round of
// 10 birds from an area and level, everyone types the names (1 minute a bird), then sees how everyone
// did. Rounds are open for 24 hours. Nothing is public and a quiz never changes learning progress.
// Everything goes through the quiz_* database functions, as the signed-in player (auth.js).

const QUIZ_ENV = IS_DEV ? "dev" : "main";
const QUIZ_BIRDS = 10;
const QUIZ_MS = 60 * 1000;          // per bird
const QUIZ_MAX_FRIENDS = 9;         // invited per round
const PUSH_URL = `${SUPABASE_URL}/functions/v1/quiz-push`;
const QUIZ_LEVELS = ["beginner", "easy", "medium", "hard"];

let quizMe = null;          // { code, name }
let quizFriends = [];       // [{ id, name }]
let quizRounds = [];        // rounds from quiz_list, newest first
let quizLoaded = 0;         // when the lists were last fetched
let quizBusy = null;        // the fetch in flight
let quizPlay = null;        // the round being played (see startRound)
let quizOpenRound = null;   // the round shown in the results sheet

const quizOn = () => Boolean(authClient) && Boolean(account);

async function qrpc(name, args = {}) {
  const { data, error } = await authClient.rpc(name, args);
  if (error) throw error;
  return data;
}

// "Dirk Hoffmann" → "Dirk H.": what friends see until the player changes it.
function suggestedName() {
  const meta = account?.user_metadata || {};
  const full = (meta.full_name || meta.name || "").trim();
  if (!full) return (account?.email || "Birder").split("@")[0].slice(0, 30);
  const parts = full.split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
}

async function loadQuiz(force = false) {
  if (!quizOn()) return;
  if (!force && quizBusy) return quizBusy;
  if (!force && Date.now() - quizLoaded < 20 * 1000) return;
  quizBusy = (async () => {
    quizMe ??= await qrpc("quiz_me", { p_name: suggestedName() });
    [quizFriends, quizRounds] = await Promise.all([qrpc("quiz_friends"), qrpc("quiz_list", { p_env: QUIZ_ENV })]);
    quizLoaded = Date.now();
  })();
  try { await quizBusy; } finally { quizBusy = null; }
  updateQuizDot();
}

const roundOpen = (r) => r.open && new Date(r.closes_at) > new Date();
const waitingForMe = (r) => roundOpen(r) && (r.my_status === "invited" || r.my_status === "playing");

function updateQuizDot() {
  $("quizDot").hidden = !quizRounds.some((r) => waitingForMe(r) && !r.mine);
}

function timeLeft(r) {
  const ms = new Date(r.closes_at) - Date.now();
  if (ms <= 0) return "closed";
  if (ms >= 3600000) return `${Math.ceil(ms / 3600000)} h left`;
  return `${Math.max(1, Math.round(ms / 60000))} min left`;
}

const levelName = (l) => LEVEL_NAMES[l] || l;
const clock = (ms) => {
  const s = Math.round((ms || 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const qel = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const qbutton = (text, cls, onClick) => {
  const b = qel("button", cls, text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
};

/* ---------- The quiz sheet ---------- */

async function openQuiz() {
  renderQuiz();
  openSheet($("quiz"));
  if (!quizOn()) return;
  try {
    await loadQuiz(true);
    renderQuiz();
  } catch {
    renderQuiz("Couldn't load your quizzes. Check your signal and try again.");
  }
}

function renderQuiz(problem = "") {
  const body = $("quizBody");
  body.replaceChildren();
  if (!authClient) {
    body.append(qel("p", "note", "Quizzes need a connection."));
    return;
  }
  if (!account) {
    body.append(qel("p", "quiz-lead", "Send friends 10 birds and see who names the most."));
    const b = qbutton("", "btn google", () => signInFrom("quiz"));
    b.innerHTML = `<span aria-hidden="true">G</span> Sign in with Google`;
    body.append(b);
    return;
  }
  if (problem) body.append(qel("p", "note quiz-problem", problem));
  if (!quizMe) {
    if (!problem) body.append(qel("p", "note", "Loading…"));
    return;
  }

  // Quizzes from friends first, then your own; a long list shows 3 and folds the rest away.
  const toPlay = quizRounds.filter(waitingForMe).sort((a, b) => Number(a.mine) - Number(b.mine));
  for (const r of toPlay.slice(0, 3)) body.append(roundCard(r, true));
  if (toPlay.length > 3) {
    const more = qel("details", "quiz-history quiz-more");
    more.open = quizMoreOpen;
    more.addEventListener("toggle", () => { quizMoreOpen = more.open; });
    more.append(qel("summary", null, `${toPlay.length - 3} more to play`));
    for (const r of toPlay.slice(3)) more.append(roundCard(r, true));
    body.append(more);
  }

  if (quizFriends.length) {
    body.append(qbutton("New quiz", "btn primary quiz-new", openNewQuiz));
  } else {
    body.append(qel("p", "quiz-lead", "Send friends 10 birds and see who names the most. Start by adding a friend."),
      qbutton("Add a friend", "btn primary quiz-new", openFriends));
  }

  // Friends have their own screen; here just who they are.
  if (quizFriends.length) {
    const row = qbutton("", "quiz-row", openFriends);
    row.append(qel("b", null, "Friends"), qel("span", "quiz-row-list", quizFriends.map((f) => f.name).join(", ")));
    row.insertAdjacentHTML("beforeend", icon("chevron", "small"));
    body.append(row);
  }

  const push = pushButton();
  if (push) body.append(push);

  // Past quizzes at the bottom, folded away until opened.
  const rest = quizRounds.filter((r) => !waitingForMe(r));
  if (rest.length) {
    const history = qel("details", "quiz-history");
    history.open = quizHistoryOpen;
    history.addEventListener("toggle", () => { quizHistoryOpen = history.open; });
    history.append(qel("summary", null, `Your quizzes (${rest.length})`));
    for (const r of rest) history.append(roundCard(r));
    body.append(history);
  }
}
let quizHistoryOpen = false;
let quizMoreOpen = false;

function openFriends() {
  renderFriends();
  openSheet($("quizFriendsSheet"));
}

function renderFriends() {
  if (!quizMe) return;
  $("quizFriendsBody").replaceChildren(friendsSection());
}

// "You 8 · Dirk H. 7", or how far each player is while the quiz is on.
function playerLine(r) {
  const open = roundOpen(r);
  return r.players.map((p) => {
    const who = p.me ? "You" : p.name;
    if (p.status === "done") return p.score != null ? `${who} ${p.score}` : `${who} ✓`;
    if (p.status === "declined") return `${who} –`;
    return open ? `${who} …` : `${who} –`;
  }).join(" · ");
}

function roundCard(r, toPlay = false) {
  const card = qel("div", `quiz-card${toPlay ? ` to-play ${r.mine ? "outgoing" : "incoming"}` : ""}`);
  const head = qel("div", "quiz-card-head");
  const settled = !r.players.some((p) => p.status === "invited" || p.status === "playing");
  head.append(qel("b", null, `${r.area_name} · ${levelName(r.level)}`),
    qel("span", "quiz-when", roundOpen(r) && !settled ? timeLeft(r) : shortDate(r.created_at)));
  card.append(head);
  if (toPlay) {
    const sentTo = r.players.filter((p) => !p.me).map((p) => p.name).join(", ");
    card.append(qel("p", "quiz-meta", r.mine ? `You sent this to ${sentTo}` : `From ${r.by}`));
    const row = qel("div", "quiz-card-actions");
    const done = r.my_answers?.length || 0;
    row.append(qbutton(r.my_status === "playing" && done ? `Carry on (${done}/10)` : "Play", "btn primary small", () => startRound(r.id)));
    if (!r.mine && r.my_status === "invited") row.append(qbutton("No thanks", "btn ghost small", () => declineRound(r)));
    card.append(row);
  } else {
    card.append(qel("p", "quiz-players", playerLine(r)));
    card.classList.add("tap");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.addEventListener("click", () => openResults(r.id));
  }
  return card;
}

function shortDate(iso) {
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

async function declineRound(r) {
  if (!confirm(`Skip ${r.by}'s quiz?`)) return;
  try {
    await qrpc("quiz_decline", { p_round: r.id });
    await loadQuiz(true);
    renderQuiz();
  } catch { showToast("Couldn't do that. Check your signal and try again.", { ms: 4000 }); }
}

/* ---------- Friends ---------- */

function friendsSection() {
  const box = qel("section", "quiz-friends");

  for (const f of quizFriends) {
    const row = qel("div", "quiz-friend");
    const remove = qbutton("", "quiz-remove", async () => {
      if (!confirm(`Remove ${f.name} from your friends?`)) return;
      try { await qrpc("quiz_remove_friend", { p_id: f.id }); await loadQuiz(true); renderQuiz(); renderFriends(); }
      catch { showToast("Couldn't remove them. Check your signal.", { ms: 3500 }); }
    });
    remove.innerHTML = icon("xmark");
    remove.setAttribute("aria-label", `Remove ${f.name}`);
    row.append(qel("span", null, f.name), remove);
    box.append(row);
  }

  const add = qel("form", "quiz-add");
  const input = qel("input", "select");
  input.placeholder = "Add a friend's code";
  input.autocomplete = "off";
  input.autocapitalize = "characters";
  input.spellcheck = false;
  input.maxLength = 12;
  input.setAttribute("aria-label", "Friend's code");
  const go = qel("button", "btn ghost small", "Add");
  go.type = "submit";
  add.append(input, go);
  add.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    go.disabled = true;
    try {
      const res = await qrpc("quiz_add_friend", { p_code: value });
      if (res.error === "self") showToast("That's your own code.", { ms: 3000 });
      else if (res.error === "too_many") showToast("Too many wrong codes. Try again in an hour.", { ms: 4000 });
      else if (res.error) showToast("No one has that code. Check it and try again.", { ms: 3500 });
      else {
        showToast(`${res.name} is now your friend`, { ms: 3000 });
        logEvent("quiz", null, { step: "friend" });
        await loadQuiz(true);
        renderQuiz();
        renderFriends();
        return;
      }
    } catch { showToast("Couldn't add your friend. Check your signal and try again.", { ms: 4000 }); }
    go.disabled = false;
  });
  box.append(add);

  const me = qel("p", "quiz-me");
  me.append("Your code ", qel("b", "quiz-code", quizMe.code), " ",
    qbutton("Copy", "link-btn", async () => {
      try { await navigator.clipboard.writeText(quizMe.code); showToast("Code copied", { ms: 2000 }); }
      catch { showToast(`Your code is ${quizMe.code}`, { ms: 4000 }); }
    }),
    qel("br"), "Friends see you as ", qel("b", null, quizMe.name), " ",
    qbutton("Change", "link-btn", changeQuizName));
  box.append(me);
  return box;
}

async function changeQuizName() {
  const name = prompt("The name your friends see:", quizMe.name);
  if (name == null || !name.trim()) return;
  try { quizMe = await qrpc("quiz_set_name", { p_name: name }); renderQuiz(); renderFriends(); }
  catch { showToast("Couldn't change your name. Check your signal.", { ms: 3500 }); }
}

/* ---------- Notifications (web push) ---------- */

const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// Only while notifications could be turned on and aren't yet: one button. (Without them, a dot on the
// quiz button shows new invites.)
function pushButton() {
  if (!pushSupported() || Notification.permission !== "default") return null;
  return qbutton("🔔 Tell me when friends send a quiz", "btn ghost quiz-push-btn", async (e) => {
    e.currentTarget.disabled = true;
    await enablePush(true);
    renderQuiz();
  });
}

function keyBytes(base64) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function pushCall(body) {
  const { data } = await authClient.auth.getSession();
  const r = await fetch(PUSH_URL, {
    method: "POST",
    headers: { apikey: SYNC_API_KEY, "Content-Type": "application/json",
               ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`quiz-push ${r.status}`);
  return r.json();
}

// ask: show the permission prompt (only from a tap); otherwise just keep an allowed subscription current.
async function enablePush(ask = false) {
  if (!pushSupported() || !quizOn()) return false;
  try {
    if (Notification.permission !== "granted") {
      if (!ask) return false;
      if (await Notification.requestPermission() !== "granted") return false;
    }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { key } = await pushCall({ type: "key" });
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    }
    const j = sub.toJSON();
    await qrpc("push_subscribe", { p_env: QUIZ_ENV, p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    if (ask) logEvent("quiz", null, { step: "push" });
    return true;
  } catch (e) {
    console.warn("push", e);
    if (ask) showToast("Couldn't turn on notifications on this phone.", { ms: 3500 });
    return false;
  }
}

/* ---------- A new round ---------- */

// The birds of an area in the app's four groups (Beginner … Hard), as the learning screen works them out.
function groupsOfArea(area) {
  const has = (s) => {
    if (area === "all") return true;
    if (area.startsWith("c:")) return s.countries.includes(area.slice(2));
    if (area === "near") return nearSet ? nearSet.has(s.id) : false;
    return areaSets[area] ? areaSets[area].has(s.id) : false;
  };
  const listed = areaSets[area] ? areas.birds[area].map((id) => speciesById.get(id)).filter(Boolean)
    : [...species].sort((x, y) => y.obs - x.obs);
  const list = listed.filter((s) => has(s) && s.photos.length);
  const ids = list.map((s) => s.id);
  const rank = Object.fromEntries(ids.map((id, i) => [id, i]));
  const info = Object.fromEntries(list.map((s) => [s.id, {
    rank: rank[s.id], spread: spread[s.id] || 0, mixups: (s.similar || []).filter((x) => x.why === "mixup").length,
  }]));
  return Learn.groupsFor(ids, info, area === "near" || Boolean(areaSets[area]));
}

// 10 birds from the level; if it has fewer, the nearest levels fill up the rest.
function drawBirds(area, level) {
  const groups = groupsOfArea(area);
  const at = QUIZ_LEVELS.indexOf(level);
  const order = [at, at - 1, at + 1, at - 2, at + 2, at - 3, at + 3].filter((i) => i >= 0 && i < groups.length);
  const picked = [];
  for (const i of order) {
    for (const id of shuffle([...groups[i]])) {
      if (picked.length >= QUIZ_BIRDS) break;
      picked.push(id);
    }
  }
  return picked.slice(0, QUIZ_BIRDS).map((id) => {
    const s = speciesById.get(id);
    return { id, photo: s.photos[Math.floor(Math.random() * s.photos.length)].id };
  });
}

// 3 new quizzes an hour (quiz_create checks this too): when the next one can go, or null if now.
const QUIZ_PER_HOUR = 3;
function nextQuizAt() {
  const hourAgo = Date.now() - 3600e3;
  const sent = quizRounds.filter((r) => r.mine && new Date(r.created_at) > hourAgo)
    .map((r) => new Date(r.created_at).getTime()).sort((a, b) => a - b);
  return sent.length >= QUIZ_PER_HOUR ? new Date(sent[sent.length - QUIZ_PER_HOUR] + 3600e3) : null;
}
const quizLimitText = (at) => `You can send 3 quizzes an hour. Your next one can go at ${
  at ? at.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" }) : "the end of the hour"}.`;

function openNewQuiz() {
  if (!species.length) { showToast("The birds are still loading. Try again in a moment.", { ms: 3000 }); return; }
  const wait = nextQuizAt();
  if (wait) { showToast(quizLimitText(wait), { ms: 5000 }); return; }
  if (!quizFriends.length) { showToast("Add a friend first, with their friend code.", { ms: 3000 }); return; }
  const sel = $("quizArea");
  sel.replaceChildren(...[...$("areaSelect").children].map((n) => n.cloneNode(true)));
  sel.querySelector('option[value="near"]')?.remove();  // quizzes are for named areas only
  sel.value = settings.family || settings.area === "near" ? "c:ZA" : settings.area;
  if (!sel.value) sel.value = "c:ZA";
  for (const r of document.querySelectorAll('input[name="quizLevel"]')) r.checked = r.value === "easy";
  const list = $("quizInvite");
  list.replaceChildren();
  for (const f of quizFriends) {
    const label = qel("label", "quiz-invite");
    const box = qel("input");
    box.type = "checkbox";
    box.value = f.id;
    label.append(box, qel("span", null, f.name));
    list.append(label);
  }
  updateNewQuiz();
  openSheet($("quizNew"));
}

function newQuizChoice() {
  const area = $("quizArea").value;
  const level = document.querySelector('input[name="quizLevel"]:checked')?.value || "easy";
  const invite = [...$("quizInvite").querySelectorAll("input:checked")].map((x) => x.value);
  return { area, level, invite };
}

function updateNewQuiz() {
  const { area, level, invite } = newQuizChoice();
  const groups = species.length ? groupsOfArea(area) : [];
  const n = groups[QUIZ_LEVELS.indexOf(level)]?.length || 0;
  const total = groups.reduce((t, g) => t + g.length, 0);
  $("quizCount").textContent = total < QUIZ_BIRDS ? "This area has too few birds for a quiz. Pick a bigger one."
    : n >= QUIZ_BIRDS ? `10 of the ${n} ${levelName(level)} birds in ${areaNameOf(area)}.`
    : `${areaNameOf(area)} has only ${n} ${levelName(level)} birds, so the nearest levels fill up the 10.`;
  const many = invite.length > QUIZ_MAX_FRIENDS;
  $("quizInviteNote").textContent = many ? `Pick up to ${QUIZ_MAX_FRIENDS} friends.` : invite.length ? "" : "Pick at least one friend.";
  $("quizSend").disabled = !invite.length || many || total < QUIZ_BIRDS;
}

$("quizNew").addEventListener("change", updateNewQuiz);

$("quizSend").addEventListener("click", async () => {
  const { area, level, invite } = newQuizChoice();
  const birds = drawBirds(area, level);
  if (birds.length < QUIZ_BIRDS) return;
  $("quizSend").disabled = true;
  $("quizSend").textContent = "Sending…";
  try {
    const id = await qrpc("quiz_create", { p_env: QUIZ_ENV, p_area: area, p_area_name: areaNameOf(area),
      p_level: level, p_birds: birds, p_invite: invite });
    logEvent("quiz", null, { step: "new", level, n: invite.length });
    pushCall({ type: "invite", round_id: id }).catch(() => {});
    closeSheet($("quizNew"));
    await loadQuiz(true);
    renderQuiz();
    const names = quizFriends.filter((f) => invite.includes(f.id)).map((f) => f.name);
    const to = names.join(", ");
    showToast(`Quiz sent to ${to}${to.endsWith(".") ? "" : "."} Play your 10 now?`, { action: { label: "Play", run: () => startRound(id) }, ms: 9000 });
  } catch (e) {
    showToast(/too many/.test(e.message || "") ? quizLimitText(nextQuizAt())
      : "Couldn't send the quiz. Check your signal and try again.", { ms: 4000 });
  } finally {
    $("quizSend").textContent = "Send quiz";
    updateNewQuiz();
  }
});

/* ---------- Checking a typed name ---------- */
// Forgiving: capitals, accents, spaces, hyphens and apostrophes don't matter, "gray" = "grey", and a few
// typos are fine (more for longer names). English (IOC), Afrikaans and scientific names count, and so do
// the bird's former name in the app (Spotted Dikkop, Cape Turtle Dove…), the names South African birders
// use where the IOC list has another (Dark-capped Bulbul…), and the name without a leading Common / African / Southern / Eurasian / Western
// (Stonechat, Hoopoe, Masked Weaver). But a typo that is as close or closer to another bird's name
// doesn't count.
const QUIZ_ALSO = {  // scientific name → other names in use in Southern Africa
  "Pycnonotus barbatus": ["Dark-capped Bulbul", "Black-eyed Bulbul"],
  "Upupa epops": ["African Hoopoe"],
  "Chrysococcyx caprius": ["Dideric Cuckoo"],
  "Tyto alba": ["Barn Owl"],
  "Elanus caeruleus": ["Black-shouldered Kite"],
  "Buteo buteo": ["Steppe Buzzard"],
  "Lanius collaris": ["Common Fiscal", "Fiscal Shrike"],
  "Gallirex porphyreolophus": ["Purple-crested Lourie"],
  "Ploceus velatus": ["Masked Weaver"],
  "Bucorvus leadbeateri": ["Ground Hornbill"],
  "Sigelus silens": ["Fiscal Flycatcher"],
};
const DROP_FIRST = /^(common|african|southern|eurasian|western)\s+/;

function squash(text) {
  return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/gray/g, "grey").replace(/[^a-z]/g, "");
}

function namesOf(s) {
  const out = new Set();
  for (const n of [s.name, s.af, s.sci, s.was, ...(QUIZ_ALSO[s.sci] || [])]) {
    if (!n) continue;
    out.add(squash(n));
    const plain = n.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (DROP_FIRST.test(plain)) out.add(squash(plain.replace(DROP_FIRST, "")));
  }
  out.delete("");
  return [...out];
}

// Optimal string alignment distance (a swapped pair of letters counts as one typo).
function typos(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      low = Math.min(low, v);
    }
    if (low > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

const allowedTypos = (len) => (len <= 4 ? 0 : len <= 7 ? 1 : len <= 12 ? 2 : 3);
let quizNameIndex = null;  // [{ id, names }] for every bird

function nameMatches(typed, target) {
  const t = squash(typed);
  if (t.length < 3) return false;
  const own = namesOf(target);
  if (own.includes(t)) return true;
  const max = allowedTypos(t.length);
  const best = (names) => Math.min(...names.map((n) => typos(t, n, max)));
  const mine = best(own);
  if (mine > max) return false;
  quizNameIndex ??= species.map((s) => ({ id: s.id, names: namesOf(s) }));
  // Wrong if another bird's name is as close (or closer) to what was typed.
  return !quizNameIndex.some((x) => x.id !== target.id && best(x.names) <= mine);
}

/* ---------- Playing a round ---------- */

async function startRound(id) {
  if (quizPlay) return;
  if (!species.length) { showToast("The birds are still loading. Try again in a moment.", { ms: 3000 }); return; }
  let r;
  try { r = await qrpc("quiz_start", { p_round: id }); }
  catch { showToast("Couldn't start the quiz. Check your signal and try again.", { ms: 4000 }); return; }
  if (!r || !r.birds) { showToast("This quiz has closed.", { ms: 3000 }); await loadQuiz(true); renderQuiz(); return; }
  if (r.my_status === "done") { openResults(id); return; }
  if (r.my_status !== "playing") { showToast("This quiz has closed.", { ms: 3000 }); return; }
  const birds = r.birds.map((b) => ({ s: speciesById.get(b.id), photo: b.photo })).filter((b) => b.s);
  if (birds.length < r.birds.length) { showToast("Update the app to play this quiz (it has birds this version doesn't).", { ms: 5000 }); return; }
  quizPlay = { round: r, birds, i: (r.my_answers || []).length, answers: [...(r.my_answers || [])], saving: Promise.resolve() };
  for (const d of document.querySelectorAll("dialog.sheet[open]")) closeSheet(d);
  stopAudio();
  logEvent("quiz", null, { step: "play" });
  document.body.classList.add("quizzing");
  $("quizPlay").hidden = false;
  fitQuizPlay();
  showQuizBird();
}

function quizPhotos(b) {
  const first = b.s.photos.find((p) => p.id === b.photo);
  return first ? [first, ...b.s.photos.filter((p) => p !== first)] : b.s.photos;
}

function showQuizBird() {
  const q = quizPlay;
  const b = q.birds[q.i];
  q.answered = false;
  $("qpStep").textContent = `Bird ${q.i + 1} of ${QUIZ_BIRDS}`;
  const photos = quizPhotos(b);
  const strip = $("qpStrip");
  strip.replaceChildren(...photos.map((p, i) => {
    const img = document.createElement("img");
    img.alt = `Photo ${i + 1} of the bird to name`;
    img.draggable = false;
    if (i > 0) img.loading = "lazy";
    img.src = photoUrl(p, "medium");
    return img;
  }));
  strip.scrollLeft = 0;
  const count = $("qpCount");
  count.hidden = photos.length < 2;
  count.textContent = `1 / ${photos.length}`;
  // the next bird's first photo, so it's there when needed
  const next = q.birds[q.i + 1];
  if (next) new Image().src = photoUrl(quizPhotos(next)[0], "medium");

  $("qpForm").hidden = false;
  $("qpFeedback").hidden = true;
  const input = $("qpInput");
  input.value = "";
  input.disabled = false;
  setTimeout(() => input.focus({ preventScroll: true }), 50);
  q.started = performance.now();
  clearInterval(q.timer);
  q.timer = setInterval(tickQuiz, 200);
  tickQuiz();
}

function tickQuiz() {
  const q = quizPlay;
  if (!q || q.answered) return;
  const left = Math.max(0, QUIZ_MS - (performance.now() - q.started));
  $("qpTime").textContent = `0:${String(Math.ceil(left / 1000)).padStart(2, "0")}`.replace("0:60", "1:00");
  $("qpBar").style.transform = `scaleX(${left / QUIZ_MS})`;
  $("qpTimer").classList.toggle("low", left <= 10000);
  if (left <= 0) answerQuiz({ timeout: true });
}

function answerQuiz({ timeout = false, skip = false } = {}) {
  const q = quizPlay;
  if (!q || q.answered) return;
  q.answered = true;
  clearInterval(q.timer);
  const b = q.birds[q.i];
  const typed = skip ? "" : $("qpInput").value.trim();
  const ok = Boolean(typed) && nameMatches(typed, b.s);
  const ms = Math.min(QUIZ_MS, Math.round(performance.now() - q.started));
  const index = q.i;
  q.answers.push({ ok, ms, typed });
  // Saved one by one, so a closed app carries on where it stopped.
  q.saving = q.saving.then(() => saveAnswer(q.round.id, index, ok, ms, typed));
  haptic(ok ? 10 : [10, 40, 10]);

  $("qpInput").disabled = true;
  $("qpForm").hidden = true;
  const fb = $("qpFeedback");
  fb.hidden = false;
  fb.className = `qp-feedback ${ok ? "good" : "bad"}`;
  $("qpVerdict").textContent = ok ? "✓ Right" : timeout ? "Time's up" : skip ? "Not this time" : "✗ Not quite";
  $("qpName").textContent = nameOf(b.s);
  setAltName($("qpAlt"), b.s);
  $("qpTyped").textContent = typed && squash(typed) !== squash(nameOf(b.s)) ? `You typed “${typed}”` : "";
  $("qpNext").textContent = q.i + 1 < QUIZ_BIRDS ? "Next bird" : "See results";
  setTimeout(() => $("qpNext").focus({ preventScroll: true }), 50);
}

async function saveAnswer(round, index, ok, ms, typed, tries = 3) {
  for (let t = 0; t < tries; t++) {
    try {
      return await qrpc("quiz_answer", { p_round: round, p_index: index, p_ok: ok, p_ms: ms, p_typed: typed });
    } catch (e) {
      if (/closed|not playing/.test(e.message || "")) return { failed: true, closed: true };
      await new Promise((res) => setTimeout(res, 1500 * (t + 1)));
    }
  }
  return { failed: true };
}

async function nextQuizBird() {
  const q = quizPlay;
  if (!q || !q.answered) return;
  if (q.i + 1 < QUIZ_BIRDS) { q.i++; showQuizBird(); return; }
  $("qpNext").disabled = true;
  $("qpNext").textContent = "Saving…";
  const last = await q.saving;
  $("qpNext").disabled = false;
  if (last?.failed && !last.closed) {
    $("qpNext").textContent = "Try again";
    $("qpTyped").textContent = "Couldn't save your answers. Check your signal, then try again.";
    q.saving = Promise.resolve().then(() => resend(q));
    return;
  }
  logEvent("quiz", null, { step: "done", score: q.answers.filter((a) => a.ok).length });
  if (last?.everyone) pushCall({ type: "results", round_id: q.round.id }).catch(() => {});
  const id = q.round.id;
  closeQuizPlay();
  await openResults(id);
}

// After a failed save: send whatever the server doesn't have yet, in order.
async function resend(q) {
  const r = await qrpc("quiz_round", { p_round: q.round.id }).catch(() => null);
  if (!r) return { failed: true };
  let res = null;
  for (let i = (r.my_answers || []).length; i < q.answers.length; i++) {
    const a = q.answers[i];
    res = await saveAnswer(q.round.id, i, a.ok, a.ms, a.typed);
    if (res?.failed) return res;
  }
  return res || { everyone: false };
}

function closeQuizPlay() {
  if (quizPlay) clearInterval(quizPlay.timer);
  quizPlay = null;
  $("quizPlay").hidden = true;
  $("quizPlay").style.height = "";
  $("quizPlay").style.transform = "";
  document.body.classList.remove("quizzing");
  $("qpInput").blur();
}

// ✕ while playing: the bird on screen counts as missed; the rest can be played later, within the 24 hours.
async function leaveQuiz() {
  const q = quizPlay;
  if (!q) return;
  if (!q.answered) {
    if (!confirm("Leave the quiz? This bird counts as missed. You can play the rest later, before the quiz closes.")) return;
    answerQuiz({ skip: true });
  }
  if (q.i + 1 >= QUIZ_BIRDS) { nextQuizBird(); return; }
  await q.saving;
  closeQuizPlay();
  await loadQuiz(true).catch(() => {});
  renderQuiz();
}

// The play screen fills only what's visible above the keyboard, so the whole photo stays on screen
// (smaller) while typing. Phones shrink the "visual viewport" for the keyboard and may scroll it.
function fitQuizPlay() {
  const vv = window.visualViewport;
  const el = $("quizPlay");
  if (!vv || el.hidden) return;
  el.style.height = `${vv.height}px`;
  el.classList.toggle("kb", vv.height < window.innerHeight - 120);  // the keyboard is up
  el.style.transform = vv.offsetTop ? `translateY(${vv.offsetTop}px)` : "";
}
window.visualViewport?.addEventListener("resize", fitQuizPlay);
window.visualViewport?.addEventListener("scroll", fitQuizPlay);

$("qpForm").addEventListener("submit", (e) => { e.preventDefault(); if ($("qpInput").value.trim()) answerQuiz(); });
$("qpDontKnow").addEventListener("click", () => answerQuiz({ skip: true }));
$("qpNext").addEventListener("click", nextQuizBird);
$("qpClose").addEventListener("click", leaveQuiz);
$("qpStrip").addEventListener("scroll", () => {
  const strip = $("qpStrip");
  const n = strip.children.length;
  $("qpCount").textContent = `${Math.round(strip.scrollLeft / (strip.clientWidth || 1)) + 1} / ${n}`;
}, { passive: true });
$("qpStrip").addEventListener("click", () => {
  const strip = $("qpStrip");
  const n = strip.children.length;
  if (n < 2) return;
  const at = Math.round(strip.scrollLeft / (strip.clientWidth || 1));
  strip.scrollTo({ left: ((at + 1) % n) * strip.clientWidth, behavior: reducedMotion() ? "auto" : "smooth" });
});

/* ---------- Results ---------- */

async function openResults(id) {
  quizOpenRound = id;
  $("quizResultTitle").textContent = "Quiz";
  $("quizResultBody").replaceChildren(qel("p", "note", "Loading…"));
  openSheet($("quizResult"));
  let r;
  try { r = await qrpc("quiz_round", { p_round: id }); }
  catch { $("quizResultBody").replaceChildren(qel("p", "note", "Couldn't load this quiz. Check your signal and try again.")); return; }
  if (quizOpenRound !== id) return;
  if (!r) { $("quizResultBody").replaceChildren(qel("p", "note", "This quiz isn't there any more.")); return; }
  renderResults(r);
  loadQuiz(true).then(() => { if ($("quiz").open) renderQuiz(); }).catch(() => {});
}

function renderResults(r) {
  $("quizResultTitle").textContent = `${r.area_name} · ${levelName(r.level)}`;
  const body = $("quizResultBody");
  body.replaceChildren();
  const open = roundOpen(r);
  body.append(qel("p", "note quiz-result-meta",
    `${r.mine ? "Your quiz" : `From ${r.by}`} · ${shortDate(r.created_at)} · ${open ? timeLeft(r) : "closed"}`));

  const seeAll = r.my_status === "done" || !open;
  if (!seeAll) {
    body.append(qel("p", "quiz-lead", "Play your 10 to see how everyone did."));
    if (waitingForMe(r)) body.append(qbutton("Play", "btn primary", () => { closeSheet($("quizResult")); startRound(r.id); }));
  }

  const table = qel("ol", "quiz-scores");
  const players = [...r.players].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (a.time_ms ?? 1e9) - (b.time_ms ?? 1e9));
  for (const p of players) {
    const li = qel("li", p.me ? "me" : "");
    const name = qel("span", "qs-name", p.me ? `${p.name} (you)` : p.name);
    let score;
    if (p.status === "done" && p.score != null) score = qel("span", "qs-score", `${p.score}/10 · ${clock(p.time_ms)}`);
    else if (p.status === "done") score = qel("span", "qs-score muted", "played");
    else if (p.status === "declined") score = qel("span", "qs-score muted", "no thanks");
    else if (!open) score = qel("span", "qs-score muted", p.answered ? `didn't finish (${p.answered}/10)` : "didn't play");
    else if (p.status === "playing") score = qel("span", "qs-score muted", `playing (${p.answered}/10)`);
    else score = qel("span", "qs-score muted", "still to play");
    li.append(name, score);
    table.append(li);
  }
  body.append(table);

  if (!seeAll || !r.birds) return;
  body.append(qel("h3", "quiz-h", "The birds"));
  const grid = qel("div", "quiz-birds");
  const shown = r.players.filter((p) => p.answers);
  r.birds.forEach((b, i) => {
    const s = speciesById.get(b.id);
    if (!s) return;
    const item = qel("button", "quiz-bird");
    item.type = "button";
    const photo = s.photos.find((p) => p.id === b.photo) || s.photos[0];
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.src = photoUrl(photo, "small");
    const text = qel("span", "qb-text");
    text.append(qel("b", null, nameOf(s)));
    const marks = qel("span", "qb-marks");
    for (const p of shown) {
      const ok = p.answers[i];
      const m = qel("span", ok === true ? "ok" : ok === false ? "no" : "none", `${p.me ? "You" : p.name.split(" ")[0]} ${ok === true ? "✓" : ok === false ? "✗" : "–"}`);
      marks.append(m);
    }
    text.append(marks);
    if (r.my_answers?.[i]?.typed && !r.my_answers[i].ok) text.append(qel("small", null, `You typed “${r.my_answers[i].typed}”`));
    item.append(img, text);
    item.addEventListener("click", () => openBird(s));
    grid.append(item);
  });
  body.append(grid);
}

/* ---------- Wiring ---------- */

$("quizBtn").addEventListener("click", openQuiz);

// Opened from a notification: ?quiz=<round> on start, or a message from the service worker.
const QUIZ_FROM_URL = (() => {
  const id = new URLSearchParams(location.search).get("quiz");
  if (id) {
    const url = new URL(location.href);
    url.searchParams.delete("quiz");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  }
  return /^[0-9a-f-]{36}$/.test(id || "") ? id : null;
})();

async function openRoundFromNotification(id) {
  if (!quizOn()) { openQuiz(); return; }
  await loadQuiz(true).catch(() => {});
  const r = quizRounds.find((x) => x.id === id);
  if (r && waitingForMe(r)) { renderQuiz(); openSheet($("quiz")); }
  else openResults(id);
}

navigator.serviceWorker?.addEventListener("message", (e) => {
  if (e.data && typeof e.data.quiz === "string" && /^[0-9a-f-]{36}$/.test(e.data.quiz)) openRoundFromNotification(e.data.quiz);
});

if (authClient) {
  authClient.auth.onAuthStateChange((event, session) => {
    if (!session?.user) {
      quizMe = null; quizFriends = []; quizRounds = []; quizLoaded = 0;
      updateQuizDot();
      if (event === "INITIAL_SESSION" && QUIZ_FROM_URL) setTimeout(openQuiz, 800);
      return;
    }
    if (event !== "INITIAL_SESSION" && event !== "SIGNED_IN") return;
    // After the auth callbacks (they can't call the database themselves without blocking sign-in).
    setTimeout(async () => {
      try { await loadQuiz(true); } catch { /* offline: try again later */ }
      enablePush(false);
      if ($("quiz").open) renderQuiz();
      if (event === "INITIAL_SESSION" && QUIZ_FROM_URL) openRoundFromNotification(QUIZ_FROM_URL);
    }, 0);
  });
}

// Coming back to the app: new invites may be waiting.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !quizOn()) return;
  loadQuiz().then(() => { if ($("quiz").open && !quizPlay) renderQuiz(); }).catch(() => {});
});
