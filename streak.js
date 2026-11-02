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
let calendarMonth = null;  // the month shown on the progress screen, as "2026-11"

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

function bestStreak() {
  let best = 0, run = 0, prev = null;
  for (const k of Object.keys(days).sort()) {
    if (!goalMet(k)) { run = 0; prev = k; continue; }
    run = prev && goalMet(prev) && dayKey(addDays(new Date(`${k}T12:00:00`), -1)) === prev ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  }
  return Math.max(best, currentStreak());
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

/* ---------- On the progress screen: streak, today's goal and a month calendar ---------- */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December"];

function streakCard() {
  const box = document.createElement("section");
  box.className = "streak";
  const today = days[dayKey()] || { a: 0, r: 0, m: 0 };
  const n = currentStreak();
  const best = bestStreak();
  const done = Math.min(today.r, DAILY_GOAL);
  box.innerHTML = `
    <div class="streak-top">
      <div class="ring" style="--p:${done / DAILY_GOAL}" role="img" aria-label="${done} of ${DAILY_GOAL} right today">
        <span>${done}<small>/${DAILY_GOAL}</small></span>
      </div>
      <div class="streak-words">
        <b>${n ? `🔥 ${n}-day streak` : "No streak yet"}</b>
        <span>${done >= DAILY_GOAL ? "Today's goal is done. Well done!"
          : n && !goalMet(dayKey()) ? `Get ${DAILY_GOAL - done} more right today to keep it going`
          : `Get ${DAILY_GOAL - done} more right today${n ? "" : " to start one"}`}</span>
        ${best > 1 ? `<span class="best">Best: ${best} days</span>` : ""}
      </div>
    </div>`;
  box.append(calendar());
  return box;
}

function calendar() {
  const wrap = document.createElement("div");
  wrap.className = "cal";
  const now = new Date();
  calendarMonth ??= dayKey(now).slice(0, 7);
  const [y, m] = calendarMonth.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const head = document.createElement("div");
  head.className = "cal-head";
  const earliest = Object.keys(days).sort()[0]?.slice(0, 7) || calendarMonth;
  head.innerHTML = `<button type="button" class="cal-nav" data-d="-1" aria-label="Previous month"${calendarMonth <= earliest ? " disabled" : ""}>‹</button>
    <b>${MONTHS[m - 1]} ${y}</b>
    <button type="button" class="cal-nav" data-d="1" aria-label="Next month"${calendarMonth >= dayKey(now).slice(0, 7) ? " disabled" : ""}>›</button>`;
  const grid = document.createElement("div");
  grid.className = "cal-grid";
  for (const l of ["M", "T", "W", "T", "F", "S", "S"]) {
    const c = document.createElement("span");
    c.className = "cal-dow";
    c.textContent = l;
    grid.append(c);
  }
  for (let i = 0; i < (first.getDay() + 6) % 7; i++) grid.append(document.createElement("span"));
  const detail = document.createElement("p");
  detail.className = "cal-detail";
  const describe = (k, d) => {
    const date = new Date(`${k}T12:00:00`).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
    if (!d?.a) return `${date}: didn't play`;
    return `${date}: ${d.a} answer${d.a === 1 ? "" : "s"}, ${d.r} right`
      + (d.m ? `, ${d.m} bird${d.m === 1 ? "" : "s"} mastered` : "") + (d.r >= DAILY_GOAL ? " · goal reached" : "");
  };
  const todayKey = dayKey(now);
  for (let day = 1; day <= new Date(y, m, 0).getDate(); day++) {
    const k = `${calendarMonth}-${String(day).padStart(2, "0")}`;
    const d = days[k];
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cal-day" + (d?.r >= DAILY_GOAL ? " goal" : d?.a ? " played" : "")
      + (k === todayKey ? " today" : "") + (k > todayKey ? " future" : "");
    cell.textContent = day;
    if (d?.m) cell.insertAdjacentHTML("beforeend", '<i aria-hidden="true">★</i>');
    cell.setAttribute("aria-label", describe(k, d));
    cell.disabled = k > todayKey;
    cell.addEventListener("click", () => {
      grid.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel"));
      cell.classList.add("sel");
      detail.textContent = describe(k, d);
    });
    grid.append(cell);
  }
  detail.textContent = calendarMonth === todayKey.slice(0, 7) ? describe(todayKey, days[todayKey]) : "Tap a day to see how it went.";
  head.addEventListener("click", (e) => {
    const b = e.target.closest(".cal-nav");
    if (!b || b.disabled) return;
    calendarMonth = dayKey(new Date(y, m - 1 + Number(b.dataset.d), 1)).slice(0, 7);
    wrap.replaceWith(calendar());
  });
  const key = document.createElement("p");
  key.className = "cal-key";
  key.innerHTML = `<i class="k-played"></i>Played <i class="k-goal"></i>Goal reached <span>★</span> Bird mastered`;
  wrap.append(head, grid, detail, key);
  return wrap;
}
