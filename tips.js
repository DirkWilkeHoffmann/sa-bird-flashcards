"use strict";
// How to tell lookalike birds apart: a few short tips per pair (data/tips.json, built by
// scripts/build_tips.py). Field-mark tips are drafts until checked; range and season tips
// are worked out from the app's own records. Whoever holds the review key (opened once
// with ?review=<key>) sees ✓ / ✗ buttons; decisions are saved online for everyone.

const REVIEW_KEY = "sabirds.reviewKey.v1";
let tipsData = null;               // { "<id>-<id>": { tips: [...], auto: [...], confidence } }
let tipReviews = new Map();        // "<pair>|<tip>" -> { decision: "ok" | "wrong", note }

// A review link stores the key on this phone and is then removed from the address bar.
(() => {
  const url = new URL(location.href);
  const key = url.searchParams.get("review");
  if (!key) return;
  save(REVIEW_KEY, key);
  url.searchParams.delete("review");
  history.replaceState(null, "", url);
})();
const reviewKey = () => load(REVIEW_KEY, "");

const tipsReady = Promise.all([
  fetch("data/tips.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  rpc("tip_reviews_list", {}).catch(() => []),
]).then(([data, reviews]) => {
  tipsData = data;
  for (const r of reviews || []) tipReviews.set(`${r.pair}|${r.tip}`, r);
});

const pairKey = (a, b) => (a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`);

// The tips to show for a pair, each { text, auto, review }. Tips marked wrong are hidden,
// except from the reviewer (who sees them crossed out and can change their mind).
function tipsFor(a, b) {
  const d = tipsData?.[pairKey(a, b)];
  if (!d) return [];
  const pair = pairKey(a, b);
  const all = [...d.tips.map((text) => ({ text, auto: false })), ...d.auto.map((text) => ({ text, auto: true }))]
    .map((t) => ({ ...t, pair, review: tipReviews.get(`${pair}|${t.text}`) }));
  return reviewKey() ? all : all.filter((t) => t.review?.decision !== "wrong");
}

// "Eye: Cape Weaver's is pale…" -> <b>Eye</b> Cape Weaver's is pale…
function tipLine(t) {
  const li = document.createElement("li");
  li.className = `tip${t.auto ? " auto" : ""}`;
  const m = /^([A-Z][\w ]{1,18}):\s*(.*)$/.exec(t.text);
  const label = document.createElement("b");
  label.textContent = m ? m[1] : "";
  const text = document.createElement("span");
  text.textContent = m ? m[2] : t.text;
  li.append(label, text);
  markTip(li, t);
  if (reviewKey()) li.append(reviewButtons(li, t));
  return li;
}

function markTip(li, t) {
  const d = t.review?.decision;
  li.classList.toggle("checked", d === "ok");
  li.classList.toggle("rejected", d === "wrong");
  li.querySelector(".draft")?.remove();
  if (!d && !t.auto) {
    const tag = document.createElement("small");
    tag.className = "draft";
    tag.textContent = "Draft";
    li.querySelector("span").append(" ", tag);
  }
}

function reviewButtons(li, t) {
  const box = document.createElement("div");
  box.className = "tip-review";
  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "tip-ok";
  ok.setAttribute("aria-label", "This tip is right");
  ok.textContent = "✓";
  const no = document.createElement("button");
  no.type = "button";
  no.className = "tip-no";
  no.setAttribute("aria-label", "This tip is wrong");
  no.textContent = "✗";
  const note = document.createElement("input");
  note.className = "tip-note";
  note.placeholder = "What's wrong? (optional)";
  note.hidden = true;
  note.value = t.review?.note || "";
  const status = document.createElement("small");
  status.className = "tip-status";

  async function decide(decision) {
    // Tapping the same answer again undoes it.
    const next = t.review?.decision === decision && decision === "ok" ? null : decision;
    status.textContent = "Saving…";
    const saved = await rpc("tip_review_set", {
      p_key: reviewKey(), p_pair: t.pair, p_tip: t.text, p_decision: next, p_note: next === "wrong" ? note.value.trim() || null : null,
    }).catch(() => null);
    if (saved !== true) { status.textContent = saved === false ? "Review key not accepted." : "Couldn't save — check your connection."; return; }
    t.review = next ? { decision: next, note: note.value.trim() } : undefined;
    if (next) tipReviews.set(`${t.pair}|${t.text}`, t.review); else tipReviews.delete(`${t.pair}|${t.text}`);
    markTip(li, t);
    status.textContent = next === "ok" ? "Checked" : next === "wrong" ? "Marked wrong" : "";
    haptic(10);
  }
  ok.addEventListener("click", () => decide("ok"));
  no.addEventListener("click", () => {
    if (note.hidden) { note.hidden = false; note.focus(); }
    decide("wrong");
  });
  note.addEventListener("change", () => decide("wrong"));
  box.append(ok, no, status, note);
  return box;
}

// The block of tips for one pair (or null when there are none).
function tipsList(a, b) {
  const tips = tipsFor(a, b);
  if (!tips.length) return null;
  const ul = document.createElement("ul");
  ul.className = "tips";
  tips.forEach((t) => ul.append(tipLine(t)));
  return ul;
}

// Under "Easily confused with": one card per lookalike, "vs <name>" and its tips.
function tellApart(s, others) {
  const wrap = document.createElement("div");
  wrap.className = "tell-apart";
  const fill = () => {
    wrap.replaceChildren();
    for (const other of others) {
      const ul = tipsList(s, other);
      if (!ul) continue;
      const h = document.createElement("h4");
      h.textContent = `vs ${other.name}`;
      wrap.append(h, ul);
    }
    if (wrap.children.length) {
      const h = document.createElement("p");
      h.className = "tell-title";
      h.textContent = "How to tell them apart";
      wrap.prepend(h);
    }
  };
  if (tipsData) fill(); else tipsReady.then(fill);
  return wrap;
}

// In the compare sheet: the tips for the two birds above their columns.
function compareTips(a, b) {
  const box = $("compareTips");
  box.replaceChildren();
  const fill = () => {
    const ul = tipsList(a, b);
    if (!ul) return;
    const h = document.createElement("p");
    h.className = "tell-title";
    h.textContent = "How to tell them apart";
    box.append(h, ul);
  };
  if (tipsData) fill(); else tipsReady.then(fill);
}
