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
    if (merged.a !== d.a || merged.r !== d.r || merged.m !== d.m) { days[k] = merged; changed = true; }
  }
  if (changed) save(DAYS_KEY, days);
  return changed;
}

/* ---------- On the progress screen: the streak and one week at a time ---------- */
// Kept simple and friendly: the streak, and a week of days. Days the goal was reached are filled
// in, days played have a soft ring, and a gold star shows how many birds were mastered that day.
// Missed days are just plain dates, with nothing to make anyone feel bad.

const MAX_WEEKS_BACK = 52;
let weekOffset = 0;  // 0 = this week (Monday to Sunday), -1 = last week, ...

function streakCard() {
  const box = document.createElement("section");
  box.className = "streak";
  const n = currentStreak();
  const title = document.createElement("p");
  title.className = "streak-title";
  title.textContent = n ? `🔥 ${n}-day streak` : "Play today to start a streak 🔥";
  box.append(title, week());
  return box;
}

function week() {
  const wrap = document.createElement("div");
  wrap.className = "week";
  const now = new Date();
  const first = addDays(now, -((now.getDay() + 6) % 7) + 7 * weekOffset);  // that week's Monday
  const todayKey = dayKey(now);
  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "week-nav";
  prev.textContent = "‹";
  prev.setAttribute("aria-label", "Previous week");
  prev.disabled = weekOffset <= -MAX_WEEKS_BACK;
  const next = document.createElement("button");
  next.type = "button";
  next.className = "week-nav";
  next.textContent = "›";
  next.setAttribute("aria-label", "Next week");
  next.disabled = weekOffset >= 0;
  const row = document.createElement("div");
  row.className = "week-days";
  for (let i = 0; i < 7; i++) {
    const date = addDays(first, i);
    const letter = "MTWTFSS"[i];
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
    const label = document.createElement("small");
    label.textContent = letter;
    day.setAttribute("aria-label", `${date.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" })}`
      + (d?.r >= DAILY_GOAL ? ", streak day" : d?.a ? ", played" : "") + (d?.m ? `, ${d.m} bird${d.m === 1 ? "" : "s"} mastered` : ""));
    day.append(label, dot);
    row.append(day);
  }
  const move = (by) => {
    if ((by < 0 && prev.disabled) || (by > 0 && next.disabled)) return;
    weekOffset += by;
    const fresh = week();
    fresh.querySelector(".week-days").classList.add(by < 0 ? "from-left" : "from-right");
    wrap.replaceWith(fresh);
  };
  // Swipe the days sideways for earlier or later weeks (up and down still scrolls the page).
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
  wrap.append(prev, row, next);
  return wrap;
}
