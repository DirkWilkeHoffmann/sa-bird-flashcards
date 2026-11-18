"use strict";
// Daily goal and streak. The goal is 10 Right answers (without a hint) in a day; the streak is
// the number of days in a row the goal was reached, by the phone's calendar. A day without it
// starts the streak again. Each day's answers, Rights and newly mastered birds are kept for the
// calendar on the progress screen, and follow the account (see syncProfile in progress.js).

const DAYS_KEY = "sabirds.days.v1";  // { "2026-11-02": { a: answers, r: right, m: mastered } }
const DAILY_GOAL = 10;
const KEEP_DAYS = 400;
let days = load(DAYS_KEY, {});
let daysDirty = load("sabirds.daysDirty.v1", false);

const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const goalMet = (key) => (days[key]?.r || 0) >= DAILY_GOAL;

function saveDays() {
  const keys = Object.keys(days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete days[k];
  daysDirty = true;
  save(DAYS_KEY, days);
  save("sabirds.daysDirty.v1", true);
}

// Days in a row with the goal reached, ending today, or yesterday while today is still to play.
function currentStreak(today = new Date()) {
  let d = goalMet(dayKey(today)) ? today : addDays(today, -1);
  let n = 0;
  while (goalMet(dayKey(d))) { n++; d = addDays(d, -1); }
  return n;
}

// After each answer. Returns true when this answer reached today's goal.
function noteDay(right, mastered) {
  const key = dayKey();
  const d = days[key] || (days[key] = { a: 0, r: 0, m: 0 });
  d.a++;
  if (right) d.r++;
  if (mastered) d.m++;
  saveDays();
  if (right && d.r === DAILY_GOAL) {
    logEvent("daily_goal", null, { streak: currentStreak() });
    return true;
  }
  return false;
}

function celebrateGoal() {
  const n = currentStreak();
  haptic([12, 60, 12, 60, 12]);
  showToast(n > 1 ? `Daily goal done! 🔥 ${n}-day streak` : "Daily goal done! 🔥 Your streak has started");
}

// The account keeps the highest count of each day from any phone.
function mergeDays(remote) {
  let changed = false;
  for (const [k, r] of Object.entries(remote || {})) {
    const d = days[k] || { a: 0, r: 0, m: 0 };
    const merged = { a: Math.max(d.a, r.a || 0), r: Math.max(d.r, r.r || 0), m: Math.max(d.m, r.m || 0) };
    const k2 = d.k || r.k;  // the day's sticker (stickers.js): the first one earned stays
    if (k2) merged.k = k2;
    if (merged.a !== d.a || merged.r !== d.r || merged.m !== d.m || merged.k !== d.k) { days[k] = merged; changed = true; }
  }
  if (changed) save(DAYS_KEY, days);
  return changed;
}

/* ---------- On the progress screen: the streak and one week (or month) at a time ---------- */
// Kept simple and friendly: the streak, and a week of days. Days the goal was reached are filled
// in, days played have a soft ring, and a gold star shows how many birds were mastered that day.
// Missed days are just plain dates, with nothing to make anyone feel bad. A small label above the
// days names the month; tap it to see the whole month, and again to go back to the week.

const FIRST_DAY = new Date(2026, 9, 1);  // the calendar goes back no further than October 2026
let weekOffset = 0;   // 0 = this week (Monday to Sunday), -1 = last week, ...
let monthView = false;
let monthOffset = 0;  // in the month view: 0 = this month, -1 = last month, ...

const mondayOf = (d) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
const monthLabel = (d, short) => d.toLocaleDateString("en-ZA", { month: short ? "short" : "long", year: "numeric" });

// "November 2026", or "Oct – Nov 2026" for a week across two months.
function weekLabel(from, to) {
  if (from.getMonth() === to.getMonth()) return monthLabel(from);
  const m = (d) => d.toLocaleDateString("en-ZA", { month: "short" });
  return from.getFullYear() === to.getFullYear()
    ? `${m(from)} – ${m(to)} ${to.getFullYear()}` : `${monthLabel(from, true)} – ${monthLabel(to, true)}`;
}

function streakCard() {
  const box = document.createElement("section");
  box.className = "streak";
  const n = currentStreak();
  const title = document.createElement("p");
  title.className = "streak-title";
  title.textContent = n ? `🔥 ${n}-day streak` : "Play today to start a streak 🔥";
  box.append(title, calendar());
  if (typeof stickerAlbumButton === "function") box.append(stickerAlbumButton());
  return box;
}

// One day: its date in a dot (filled, ringed or plain), any birds mastered, and its sticker.
function dayCell(date, todayKey, letter) {
  const k = dayKey(date);
  const d = days[k];
  const day = document.createElement("div");
  day.className = "wday" + (k === todayKey ? " today" : "") + (k > todayKey ? " future" : "");
  const dot = document.createElement("span");
  dot.className = "wdot" + (d?.r >= DAILY_GOAL ? " goal" : d?.a ? " played" : "");
  dot.textContent = date.getDate();
  if (d?.m) {
    const star = document.createElement("i");
    star.textContent = `★${d.m}`;
    dot.append(star);
  }
  // A sticker earned that day (stickers.js) covers the day; tap it to see it big.
  const st = d?.k && typeof stickerOf === "function" ? stickerOf(d.k) : null;
  if (st) {
    dot.classList.add("has-sticker", st.tier);
    dot.append(stickerImage(st.id));
    day.classList.add("tappable");
    day.setAttribute("role", "button");
    day.tabIndex = 0;
    day.addEventListener("click", () => showSticker(st.id, { day: k }));
    day.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showSticker(st.id, { day: k }); } });
  }
  day.setAttribute("aria-label", `${date.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" })}`
    + (d?.r >= DAILY_GOAL ? ", streak day" : d?.a ? ", played" : "") + (d?.m ? `, ${d.m} bird${d.m === 1 ? "" : "s"} mastered` : "")
    + (st ? `, sticker: ${stickerName(st.id)}` : ""));
  if (letter) {
    const label = document.createElement("small");
    label.textContent = letter;
    day.append(label);
  }
  day.append(dot);
  return day;
}

function calendar() {
  const wrap = document.createElement("div");
  wrap.className = "cal";
  const now = new Date();
  const todayKey = dayKey(now);
  let from, to;
  if (monthView) {
    from = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    to = new Date(from.getFullYear(), from.getMonth() + 1, 0);
  } else {
    from = addDays(mondayOf(now), 7 * weekOffset);
    to = addDays(from, 6);
  }

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "cal-toggle";
  toggle.setAttribute("aria-expanded", String(monthView));
  toggle.innerHTML = `<span></span><span aria-hidden="true">${monthView ? "▴" : "▾"}</span>`;
  toggle.firstChild.textContent = monthView ? monthLabel(from) : weekLabel(from, to);
  toggle.setAttribute("aria-label", monthView ? `${monthLabel(from)}, show one week` : `${weekLabel(from, to)}, show the whole month`);

  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "week-nav";
  prev.textContent = "‹";
  prev.setAttribute("aria-label", monthView ? "Previous month" : "Previous week");
  prev.disabled = from <= FIRST_DAY;
  const next = document.createElement("button");
  next.type = "button";
  next.className = "week-nav";
  next.textContent = "›";
  next.setAttribute("aria-label", monthView ? "Next month" : "Next week");
  next.disabled = monthView ? monthOffset >= 0 : weekOffset >= 0;

  const row = document.createElement("div");
  row.className = "week-days" + (monthView ? " month" : "");
  if (monthView) {
    for (const letter of "MTWTFSS") {
      const h = document.createElement("small");
      h.className = "wletter";
      h.textContent = letter;
      row.append(h);
    }
    for (let i = (from.getDay() + 6) % 7; i > 0; i--) row.append(document.createElement("span"));
    for (let date = from; date <= to; date = addDays(date, 1)) row.append(dayCell(date, todayKey));
  } else {
    for (let i = 0; i < 7; i++) row.append(dayCell(addDays(from, i), todayKey, "MTWTFSS"[i]));
  }

  const redraw = (cls) => {
    const fresh = calendar();
    if (cls) fresh.querySelector(".week-days").classList.add(cls);
    wrap.replaceWith(fresh);
    if (!cls) fresh.querySelector(".cal-toggle").focus({ preventScroll: true });
  };
  const move = (by) => {
    if ((by < 0 && prev.disabled) || (by > 0 && next.disabled)) return;
    if (monthView) monthOffset += by; else weekOffset += by;
    redraw(by < 0 ? "from-left" : "from-right");
  };
  toggle.addEventListener("click", () => {
    if (monthView) {
      // Back to a week: this week for this month, otherwise the month's last week.
      weekOffset = monthOffset === 0 ? 0 : Math.round((mondayOf(to) - mondayOf(now)) / (7 * 864e5));
    } else {
      // The month of the week shown (of its last day that has been, for a week across two months).
      const ref = to > now ? now : to;
      monthOffset = (ref.getFullYear() - now.getFullYear()) * 12 + ref.getMonth() - now.getMonth();
    }
    monthView = !monthView;
    redraw();
  });
  // Swipe the days sideways for earlier or later weeks (or months) (up and down still scrolls the page).
  let startX = null, startY = 0;
  row.addEventListener("touchstart", (e) => { startX = e.touches[0].clientX; startY = e.touches[0].clientY; }, { passive: true });
  row.addEventListener("touchend", (e) => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX, dy = e.changedTouches[0].clientY - startY;
    startX = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx > 0 ? -1 : 1);
  }, { passive: true });
  prev.addEventListener("click", () => move(-1));
  next.addEventListener("click", () => move(1));
  const strip = document.createElement("div");
  strip.className = "week";
  strip.append(prev, row, next);
  wrap.append(toggle, strip);
  return wrap;
}
