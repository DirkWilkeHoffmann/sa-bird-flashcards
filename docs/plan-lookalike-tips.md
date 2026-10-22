# Plan: "How to tell them apart" for lookalike birds

*Status: pinned for later (from tester feedback). Nothing built yet.*

## The idea

In **Easily confused with** and in **Compare**, show a few short, concrete tips for each pair,
for example:

> **Cape Weaver vs Southern Masked Weaver**
> - Eye: Cape Weaver's is pale (white); Masked Weaver's is red.
> - Face: breeding male Masked Weaver has a black mask that reaches the forehead; Cape Weaver has an orange wash, no black.
> - Size: Cape Weaver is bigger, with a longer, more pointed bill.

## Size of the job

- 1,630 lookalike pairs in `data/similar.json` across all 852 birds.
- 266 of them involve the 50 Beginner birds (South Africa), so start there.
- About 700 involve Easy birds.

## Where the tips could come from

| Source | Quality | Effort | Notes |
| --- | --- | --- | --- |
| **Field guides** (Roberts, Sasol, Newman's) | Best | — | Copyrighted, so they can't be copied. Fine as a reference when checking tips. |
| **Wikipedia** "Description" / "Similar species" text | Patchy | Low | Already downloaded per bird. Sentences like "distinguished from X by…" can be pulled out automatically, but only some birds have them. |
| **AI-drafted tips, checked by Dirk** | Good, once checked | Medium | Write each pair's tips from both birds' descriptions (size, bill, eye, plumage, call, habitat, range). Each tip is checked before it goes live. |
| **Community tips** | Grows over time | Medium–high | A "Suggest a tip" button; suggestions are emailed for approval, like flagged photos. |

## Recommended approach

1. **Draft:** a build script (like `scripts/build_similar.py`) writes 2–4 tips per pair for the
   266 Beginner pairs. It works only from the downloaded descriptions plus the range and month
   data, and stores the tips in `data/tips.json` as `{ "idA-idB": { tips: [...], status: "draft" } }`.
2. **Review:** a page like `review.html` lists the drafts. Dirk (or a trusted birder) taps
   **Approve**, **Edit** or **Reject** for each one. Only approved tips are shown in the app.
3. **Show:**
   - Under each lookalike in *Easily confused with*: one line ("Pale eye, no black mask").
   - In *Compare*: the full list between the two columns, plus a **Hear the difference**
     button that plays both calls one after the other.
4. **Grow:** add the Easy pairs next, then the community "Suggest a tip" button.

## Extra ideas

- **Range and season as tips:** "Only in the Western Cape" or "Summer visitor (Oct–Mar)". These
  can be worked out automatically from the range and month data the app already has, so they're
  free and accurate.
- **Quiz the difference:** after a mix-up, show the tip for that exact pair ("You picked
  Southern Masked Weaver — look at the eye colour").

## Open questions for Dirk

- Who reviews the tips: you only, or a few trusted birders?
- Should a tip say where it came from (e.g. "checked by …")?
- Start with Beginner pairs only, or include Easy from day one?
