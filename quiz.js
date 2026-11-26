"use strict";
// Friend quizzes (docs/plan-friend-quizzes.md): add friends with an invite link, send them a round of
// 10 birds from an area and level, everyone types the names (1 minute a bird), then sees how everyone
// did. Rounds are open for 24 hours. Nothing is public and a quiz never changes learning progress.
// Everything goes through the quiz_* database functions, as the signed-in player (auth.js).

const QUIZ_ENV = IS_DEV ? "dev" : "main";
const QUIZ_BIRDS = 10;
const QUIZ_MS = 60 * 1000;          // per bird
const QUIZ_MAX_FRIENDS = 9;         // invited per round
const PUSH_URL = `${SUPABASE_URL}/functions/v1/quiz-push`;
const QUIZ_LEVELS = ["beginner", "easy", "medium", "hard"];

let quizMe = null;          // { link, name }
const INVITE_KEY = "sabirds.addFriend.v1";  // the link's token, kept across the Google sign-in
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
  // Quiz stickers (stickers.js): reached ones are saved and shown on the way. Never holds up the quizzes.
  if (typeof gotQuizAwards === "function") qrpc("quiz_awards", { p_env: QUIZ_ENV }).then(gotQuizAwards).catch(() => {});
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
    const token = load(INVITE_KEY, null);
    body.append(qel("p", "quiz-lead", token
      ? "A friend invited you to be friends on SA Birds. Sign in with Google and you're friends."
      : "Send friends 10 birds and see who names the most."));
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
  if (newFriend) body.append(newFriendNote());

  // Laid out like iOS Settings: labelled groups of rows. Quizzes to play first (friends' before your own).
  const toPlay = quizRounds.filter(waitingForMe).sort((a, b) => Number(a.mine) - Number(b.mine));
  if (toPlay.length) body.append(qgroup("To play", toPlay.map(playRow)));
  // Played, and waiting for the others or for you to see the results: stays up here till then.
  const played = quizRounds.filter(following);
  if (played.length) body.append(qgroup("Results", played.map(resultRow)));

  if (quizFriends.length) {
    // A friend's quiz waiting: its Play is the one orange button, so New quiz isn't mistaken for it.
    const friendsQuiz = toPlay.some((r) => !r.mine);
    const b = qbutton("", `btn ${friendsQuiz ? "ghost" : "primary"} quiz-new`, openNewQuiz);
    b.innerHTML = `${icon("plus")}<span>New quiz</span>`;
    body.append(b);
  } else {
    body.append(qel("p", "quiz-lead", "Send friends 10 birds and see who names the most. Start by inviting a friend."),
      qbutton("Invite a friend", "btn primary quiz-new", shareInvite));
  }

  const friendRows = [];
  if (quizFriends.length) {
    friendRows.push(qrow({ icon: "friends", tone: "neutral", title: `${quizFriends.length} friend${quizFriends.length === 1 ? "" : "s"}`,
      sub: quizFriends.map((f) => f.name).join(", "), chevron: true, onClick: openFriends }));
    friendRows.push(actionRow("share", "Invite a friend", shareInvite));
  }
  if (friendRows.length) body.append(qgroup("Friends", friendRows));

  const push = pushRow();
  if (push) body.append(qgroup("", [push], "Get a notification when a friend sends you a quiz."));

  // Past quizzes at the bottom, folded into one row until opened.
  const rest = quizRounds.filter((r) => !waitingForMe(r) && !following(r));
  if (rest.length) {
    const past = qel("details", "qgroup qpast");
    past.open = quizHistoryOpen;
    past.addEventListener("toggle", () => { quizHistoryOpen = past.open; });
    const sum = qel("summary", "qrow tap noicon");
    sum.append(qel("span", "qrow-text"), qel("span", "qrow-end", String(rest.length)));
    sum.firstChild.append(qel("b", null, "Past quizzes"));
    sum.insertAdjacentHTML("beforeend", icon("chevron", "qrow-chev"));
    past.append(sum, ...rest.map(pastRow));
    body.append(qel("div", "qsection"));
    body.lastChild.append(past);
  }
}
let quizHistoryOpen = false;

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
    return open ? "" : `${who} –`;
  }).filter(Boolean).join(" · ");
}

// "Sam K." → "Sam's quiz"
const quizOf = (name) => { const first = (name || "A friend").split(" ")[0]; return `${first}'${first.endsWith("s") ? "" : "s"} quiz`; };
const playLabel = (r) => {
  const done = r.my_answers?.length || 0;
  if (r.my_status === "playing" && done) return `Carry on (${done}/10)`;
  return r.mine ? "Play" : `Play ${quizOf(r.by)}`;
};

/* ---------- Rows and groups (iOS grouped-list style) ---------- */

// A labelled group of rows, with an optional note under it.
function qgroup(title, rows, foot = "") {
  const sec = qel("section", "qsection");
  if (title) sec.append(qel("h3", "qgroup-h", title));
  const group = qel("div", "qgroup");
  group.append(...rows);
  sec.append(group);
  if (foot) sec.append(qel("p", "qgroup-foot", foot));
  return sec;
}

// One row: an icon in a coloured square, a title and a line under it, something at the end, maybe a ›.
// The whole row is the tap target; a button at its end (Play, Results) does its own thing.
function qrow({ icon: name, tone = "neutral", title, sub, end, chevron = false, onClick, cls = "" }) {
  const row = qel("div", `qrow${onClick ? " tap" : ""}${name ? "" : " noicon"}${cls ? ` ${cls}` : ""}`);
  if (onClick) {
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.addEventListener("click", onClick);
    row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); } });
  }
  if (name) {
    const ic = qel("span", `qrow-icon ${tone}`);
    ic.innerHTML = icon(name);
    row.append(ic);
  }
  const text = qel("span", "qrow-text");
  text.append(qel("b", null, title));
  if (sub) text.append(qel("span", null, sub));
  row.append(text);
  if (end != null) row.append(typeof end === "string" ? qel("span", "qrow-end", end) : end);
  if (chevron) row.insertAdjacentHTML("beforeend", icon("chevron", "qrow-chev"));
  return row;
}

// A row that does something (Invite a friend…): tint icon and title, no ›.
const actionRow = (name, title, onClick) => qrow({ icon: name, tone: "action", title, onClick, cls: "action" });

// The small capsule at a row's end, like the App Store's Get button.
function qcapsule(text, onClick, soft = false) {
  const b = qbutton(text, `qcap${soft ? " soft" : ""}`, (e) => { e.stopPropagation(); onClick(); });
  return b;
}

// The capsule with a small note under it ("22 h left"), as the App Store does under Get.
function capsuleWithNote(cap, note) {
  const box = qel("span", "qcap-stack");
  box.append(cap, qel("small", null, note));
  return box;
}

const what = (r) => `${r.area_name} · ${levelName(r.level)}`;

// To play: "Quiz from Sam K. / Kruger National Park · Easy · 22 h left   [Play]". The row opens the
// quiz's page (what it is, Play, No thanks); the capsule starts it.
function playRow(r) {
  const done = r.my_answers?.length || 0;
  const going = r.my_status === "playing" && done;
  const sentTo = r.players.filter((p) => !p.me).map((p) => p.name).join(", ");
  return qrow({
    icon: r.mine ? "person" : "friends", tone: r.mine ? "mine" : "friend",
    title: r.mine ? `Your quiz to ${sentTo}` : `Quiz from ${r.by}`,
    sub: going ? `${done} of 10 done · ${what(r)}` : what(r),
    end: capsuleWithNote(qcapsule(going ? "Carry on" : "Play", () => startRound(r.id)), timeLeft(r)),
    onClick: () => openResults(r.id),
  });
}

// Played: waiting for friends (scores so far), or everyone's done ([Results]).
function resultRow(r) {
  const ready = settledRound(r);
  const waiting = r.players.filter((p) => !p.me && (p.status === "invited" || p.status === "playing")).map((p) => p.name);
  return qrow({
    icon: ready ? "check" : "clock", tone: ready ? "mine" : "wait",
    title: what(r),
    sub: ready ? playerLine(r) : `Waiting for ${waiting.join(", ")}`,
    end: ready ? qcapsule("Results", () => openResults(r.id)) : timeLeft(r),
    chevron: !ready,
    onClick: () => openResults(r.id),
  });
}

function pastRow(r) {
  return qrow({ title: what(r), sub: `${shortDate(r.created_at)} · ${playerLine(r)}`, chevron: true, onClick: () => openResults(r.id) });
}

// A quiz you've played stays at the top while friends still have to play, then with "See results"
// until you've looked at them (remembered on this phone), or for a day after it closes.
const QUIZ_SEEN_KEY = "sabirds.quizSeen.v1";
const settledRound = (r) => !roundOpen(r) || !r.players.some((p) => p.status === "invited" || p.status === "playing");
const resultsSeen = (r) => load(QUIZ_SEEN_KEY, []).includes(r.id);
function following(r) {
  if (r.my_status !== "done" || (settledRound(r) && resultsSeen(r))) return false;
  return roundOpen(r) || Date.now() - new Date(r.closes_at) < 24 * 3600e3;
}
function markResultsSeen(r) {
  if (!settledRound(r) || resultsSeen(r)) return;
  save(QUIZ_SEEN_KEY, [r.id, ...load(QUIZ_SEEN_KEY, [])].slice(0, 100));
}

function shortDate(iso) {
  return new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

async function declineRound(r) {
  if (!confirm(`Skip ${r.by}'s quiz?`)) return false;
  try {
    await qrpc("quiz_decline", { p_round: r.id });
    await loadQuiz(true);
    renderQuiz();
    return true;
  } catch { showToast("Couldn't do that. Check your signal and try again.", { ms: 4000 }); return false; }
}

/* ---------- Friends ---------- */

function friendsSection() {
  const box = qel("div", "quiz-friends");
  if (quizFriends.length) {
    box.append(qgroup("", quizFriends.map((f) => {  // the screen is called Friends already
      const remove = qbutton("", "qrow-remove", async (e) => {
        e.stopPropagation();
        if (!confirm(`Remove ${f.name} from your friends?`)) return;
        try { await qrpc("quiz_remove_friend", { p_id: f.id }); await loadQuiz(true); renderQuiz(); renderFriends(); }
        catch { showToast("Couldn't remove them. Check your signal.", { ms: 3500 }); }
      });
      remove.innerHTML = icon("xmark");
      remove.setAttribute("aria-label", `Remove ${f.name}`);
      return qrow({ icon: "person", tone: "neutral", title: f.name, end: remove });
    })));
  }
  box.append(qgroup("",
    [actionRow("share", "Invite a friend", shareInvite)],
    "Your invite link works for anyone you send it to. Friends are friends both ways."));
  box.append(qgroup("You", [
    qrow({ title: "Name friends see", end: quizMe.name, chevron: true, onClick: changeQuizName }),
    qrow({ title: "Make a new invite link", cls: "action", onClick: newInviteLink }),
  ], "A new link stops the old one from working. Your friends stay your friends."));
  return box;
}

const inviteUrl = (token = quizMe.link) => `${new URL(".", location.href).href}?add=${token}`;

// The phone's own share sheet (WhatsApp, messages…); elsewhere the link is copied.
async function shareInvite() {
  if (!quizMe) return;
  const url = inviteUrl();
  const text = "Be my friend on SA Birds and we can quiz each other on southern African birds:";
  logEvent("quiz", null, { step: "invite_share" });
  if (navigator.share) {
    try { await navigator.share({ title: "SA Birds", text, url }); return; }
    catch (e) { if (e?.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(`${text} ${url}`); showToast("Invite link copied. Paste it in a message.", { ms: 3500 }); }
  catch { prompt("Send this link to your friend:", url); }
}

async function newInviteLink() {
  if (!confirm("Make a new invite link? The old one stops working. Your friends stay your friends.")) return;
  try { quizMe = await qrpc("quiz_new_link"); showToast("New invite link ready", { ms: 2500 }); }
  catch { showToast("Couldn't make a new link. Check your signal.", { ms: 3500 }); }
}

// Opened from someone's invite link. Tapping the link is the yes, so they're added straight away
// (once signed in) and the quiz page says so. In a phone's browser it also says to go to the SA Birds
// app on the Home Screen: iPhones open every link in Safari, never in the Home Screen app, and the two
// don't share saved data or sign-in; the friendship is on the server, so the app has it too.
// Since there's no "Add?" question, the note has an Undo: a link someone else sent you to can't
// leave you friends with them by accident.
let newFriend = null;  // { name, id, already }: the note at the top of the quiz page, until it's closed
async function checkInvite() {
  const token = load(INVITE_KEY, null);
  if (!token || !quizOn()) return;
  try {
    const peek = await qrpc("quiz_invite_peek", { p_token: token });
    if (peek.error) {
      save(INVITE_KEY, null);
      showToast(peek.error === "self" ? "That's your own invite link."
        : "That invite link doesn't work any more. Ask your friend for a new one.", { ms: 4000 });
      return;
    }
    if (!peek.already) {
      const res = await qrpc("quiz_invite_accept", { p_token: token });
      if (res.error) {
        save(INVITE_KEY, null);
        showToast("That invite link doesn't work any more. Ask your friend for a new one.", { ms: 4000 });
        return;
      }
      logEvent("quiz", null, { step: "friend" });
      newFriend = { name: peek.name, id: res.id, already: false };
    } else {
      newFriend = { name: peek.name, already: true };
    }
    save(INVITE_KEY, null);
    await loadQuiz(true);
    renderQuiz();
    openSheet($("quiz"));
  } catch { /* offline: the link is kept and tried next time */ }
}
$("quiz").addEventListener("close", () => { newFriend = null; });

const inPhoneBrowser = () => typeof isPhone !== "undefined" && isPhone && !standalone();

function newFriendNote() {
  const { name, already } = newFriend;
  const box = qel("section", "qnotice");
  const ic = qel("span", "qrow-icon mine");
  ic.innerHTML = icon("check");
  const text = qel("div", "qnotice-text");
  text.append(qel("b", null, already ? `You and ${name} are already friends` : `You and ${name} are now friends`));
  if (inPhoneBrowser()) {
    text.append(qel("p", null, "Now open SA Birds from your Home Screen to play together."),
      qel("p", "note", "Not on your Home Screen yet? Add it from this page first, then open it and sign in."));
  } else {
    text.append(qel("p", null, `Send ${name.split(" ")[0]} a quiz, or wait for theirs.`));
  }
  box.append(ic, text);
  if (!already && newFriend.id) {
    const undo = qbutton("Undo", "link-btn qnotice-undo", async () => {
      undo.disabled = true;
      try {
        await qrpc("quiz_remove_friend", { p_id: newFriend.id });
        showToast(`${name} is no longer your friend.`, { ms: 3000 });
        newFriend = null;
        await loadQuiz(true);
        renderQuiz();
      } catch { undo.disabled = false; showToast("Couldn't undo. Check your signal and try again.", { ms: 3500 }); }
    });
    undo.setAttribute("aria-label", `Undo: don't be friends with ${name}`);
    box.append(undo);
  }
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

// Only while notifications could be turned on and aren't yet: one row. (Without them, a dot on the
// quiz button shows new invites.)
function pushRow() {
  if (!pushSupported() || Notification.permission !== "default") return null;
  let busy = false;
  return actionRow("bell", "Turn on notifications", async () => {
    if (busy) return;
    busy = true;
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
  if (!quizFriends.length) { showToast("Invite a friend first.", { ms: 3000 }); return; }
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
// the bird's former name in the app (Spotted Dikkop…), the other names BirdLife South Africa's checklist
// gives (Hadeda Ibis, Cape Turtle Dove…), a few more names SA birders use, and the name without a leading Common / African / Southern / Eurasian / Western
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
  for (const n of [s.name, s.af, s.sci, s.was, ...(s.aka || []), ...(QUIZ_ALSO[s.sci] || [])]) {
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
  resetZoom();
  strip.scrollLeft = 0;
  $("qpDots").replaceChildren(...photos.map(() => document.createElement("span")));
  $("qpDots").hidden = photos.length < 2;
  showQuizPhoto(0);
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
  // Not done after the 10th means an earlier answer never arrived (the server only takes them in order).
  if ((last?.failed && !last.closed) || (last && !last.failed && last.done === false)) {
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
  resetZoom();
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
// The bird's photos work as when studying: swipe (arrows on a computer), dots, pinch or double-tap to zoom.
const quizPhotoAt = () => Math.round($("qpStrip").scrollLeft / ($("qpStrip").clientWidth || 1));
let quizPhotoShown = 0;
function showQuizPhoto(i) {
  const n = $("qpStrip").children.length;
  if (i !== quizPhotoShown) resetZoom();
  quizPhotoShown = i;
  [...$("qpDots").children].forEach((d, j) => d.classList.toggle("on", j === i));
  $("qpPhotoPrev").hidden = n < 2 || i <= 0;
  $("qpPhotoNext").hidden = n < 2 || i >= n - 1;
}
function stepQuizPhoto(d) {
  const strip = $("qpStrip");
  const i = Math.max(0, Math.min(strip.children.length - 1, quizPhotoAt() + d));
  strip.scrollTo({ left: i * strip.clientWidth, behavior: reducedMotion() ? "auto" : "smooth" });
}
$("qpStrip").addEventListener("scroll", () => {
  const i = quizPhotoAt();
  if (i !== quizPhotoShown) showQuizPhoto(i);
}, { passive: true });
$("qpPhotoPrev").addEventListener("click", () => stepQuizPhoto(-1));
$("qpPhotoNext").addEventListener("click", () => stepQuizPhoto(1));
// (app.js has it; guarded so a phone briefly holding an older app.js still gets the rest of the quizzes)
if (typeof enableZoom === "function") enableZoom($("qpStrip"), () => $("qpStrip").children[quizPhotoAt()]);

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
  if (r.my_status === "done") markResultsSeen(r);
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
    if (waitingForMe(r)) {
      // Straight from a notification: what this quiz is, and one button to start it.
      body.append(qel("p", "quiz-lead", r.mine
        ? `Your quiz: 10 birds from ${r.area_name}, ${levelName(r.level)}. You get a minute to name each bird.`
        : `${r.by} sent you a quiz: 10 birds from ${r.area_name}, ${levelName(r.level)}. You get a minute to name each bird.`));
      body.append(qbutton(playLabel(r), "btn primary quiz-new", () => { closeSheet($("quizResult")); startRound(r.id); }));
      if (!r.mine && r.my_status === "invited") {
        body.append(qbutton("No thanks", "btn ghost quiz-new", async () => { if (await declineRound(r)) closeSheet($("quizResult")); }));
      }
      body.append(qel("p", "note", "Play your 10 to see how everyone did."));
    } else {
      body.append(qel("p", "quiz-lead", "Play your 10 to see how everyone did."));
    }
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

// Opened from a friend's invite link (?add=<token>): keep it through the Google sign-in.
(() => {
  const params = new URLSearchParams(location.search);
  const token = params.get("add");
  if (token === null) return;
  const url = new URL(location.href);
  url.searchParams.delete("add");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  if (/^[0-9a-f]{32}$/.test(token)) save(INVITE_KEY, token);
})();

async function openRoundFromNotification(id) {
  if (!quizOn()) { openQuiz(); return; }
  await loadQuiz(true).catch(() => {});
  if ($("quiz").open) renderQuiz();
  openResults(id);  // a quiz to play opens ready to start; a finished one on its results
}

navigator.serviceWorker?.addEventListener("message", (e) => {
  if (e.data && typeof e.data.quiz === "string" && /^[0-9a-f-]{36}$/.test(e.data.quiz)) openRoundFromNotification(e.data.quiz);
});

if (authClient) {
  authClient.auth.onAuthStateChange((event, session) => {
    if (!session?.user) {
      quizMe = null; quizFriends = []; quizRounds = []; quizLoaded = 0; newFriend = null;
      if (typeof quizAwards !== "undefined") quizAwards = { played: 0, won: 0, got: new Map() };
      updateQuizDot();
      if (event === "INITIAL_SESSION" && (QUIZ_FROM_URL || load(INVITE_KEY, null))) setTimeout(openQuiz, 800);
      return;
    }
    if (event !== "INITIAL_SESSION" && event !== "SIGNED_IN") return;
    // After the auth callbacks (they can't call the database themselves without blocking sign-in).
    setTimeout(async () => {
      try { await loadQuiz(true); } catch { /* offline: try again later */ }
      enablePush(false);
      if ($("quiz").open) renderQuiz();
      checkInvite();
      if (event === "INITIAL_SESSION" && QUIZ_FROM_URL) openRoundFromNotification(QUIZ_FROM_URL);
    }, 0);
  });
}

// Coming back to the app: new invites may be waiting.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !quizOn()) return;
  loadQuiz().then(() => { if ($("quiz").open && !quizPlay) renderQuiz(); }).catch(() => {});
});
