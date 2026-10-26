// Photo review: when someone flags a photo in the app, email the owner the photo with
// Keep / Remove links. The links open review.html in the app, which posts the decision back.
//
//   POST {action: "report", photo_id, species_id, species_name, photo_url}
//   POST {action: "decide", photo_id, token, decision: "keep" | "remove"}
//   POST {action: "name", species_id, species_name, current_name, suggestion, note, env}
//        Someone thinks a bird's Afrikaans name is wrong: save it and email the owner.
//
// Secrets: RESEND_API_KEY (set in the Supabase dashboard). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";

const OWNER_EMAIL = "wilkehoffmann@gmail.com";
const APP_URL = "https://dirkwilkehoffmann.github.io/sa-bird-flashcards/";
const PHOTO_PREFIX = "https://inaturalist-open-data.s3.amazonaws.com/photos/";
const MAX_EMAILS_PER_DAY = 20;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function sendEmail(review: { photo_id: number; species_name: string; photo_url: string; token: string }) {
  const link = (decision: string) =>
    `${APP_URL}review.html?id=${review.photo_id}&token=${review.token}&decision=${decision}`;
  const name = escape(review.species_name || "Unknown bird");
  const html = `
    <div style="font-family:sans-serif;max-width:520px">
      <h2 style="margin:0 0 8px">Photo flagged: ${name}</h2>
      <p>Someone hid this photo in SA Bird Flashcards. Should it stay in the app?</p>
      <img src="${escape(review.photo_url)}" alt="${name}" style="width:100%;border-radius:10px">
      <p style="margin:18px 0">
        <a href="${link("keep")}" style="background:#4f9d5d;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">✅ Keep photo</a>
        &nbsp;
        <a href="${link("remove")}" style="background:#c0563f;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">❌ Remove photo</a>
      </p>
      <p style="color:#777;font-size:12px">Photo ${review.photo_id} on iNaturalist. The buttons open a page where you confirm.</p>
    </div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "SA Birds <onboarding@resend.dev>", to: [OWNER_EMAIL], subject: `Flagged photo: ${review.species_name}`, html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

async function report(body: Record<string, unknown>) {
  const photoId = Number(body.photo_id);
  const photoUrl = String(body.photo_url || "");
  if (!Number.isInteger(photoId) || photoId <= 0 || !photoUrl.startsWith(PHOTO_PREFIX)) {
    return json({ error: "bad request" }, 400);
  }
  let { data: review } = await db.from("photo_reviews").select("*").eq("photo_id", photoId).maybeSingle();
  if (review) {
    await db.from("photo_reviews").update({ reports: review.reports + 1 }).eq("photo_id", photoId);
    if (review.emailed_at || review.status !== "pending") return json({ ok: true, emailed: false });
    // An earlier email failed (e.g. before the Resend key was set): try again below.
  } else {
    const inserted = await db.from("photo_reviews").insert({
      photo_id: photoId,
      species_id: Number(body.species_id) || null,
      species_name: String(body.species_name || "").slice(0, 120),
      photo_url: photoUrl.slice(0, 300),
    }).select().single();
    if (inserted.error) return json({ error: inserted.error.message }, 500);
    review = inserted.data;
  }

  // Spam guard: at most MAX_EMAILS_PER_DAY emails in any 24 hours.
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await db.from("photo_reviews").select("*", { count: "exact", head: true }).gte("emailed_at", since);
  if ((count ?? 0) >= MAX_EMAILS_PER_DAY) return json({ ok: true, emailed: false });
  await sendEmail(review);
  await db.from("photo_reviews").update({ emailed_at: new Date().toISOString() }).eq("photo_id", photoId);
  return json({ ok: true, emailed: true });
}

async function nameReport(body: Record<string, unknown>) {
  const text = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
  const row = {
    species_id: Number(body.species_id) || null,
    species_name: text(body.species_name, 120),
    current_name: text(body.current_name, 120),
    suggestion: text(body.suggestion, 120),
    note: text(body.note, 500),
    env: ["main", "dev", "tips"].includes(String(body.env)) ? String(body.env) : "main",
  };
  if (!row.species_id || (!row.suggestion && !row.note)) return json({ error: "bad request" }, 400);
  const inserted = await db.from("name_reports").insert(row).select("id").single();
  if (inserted.error) return json({ error: inserted.error.message }, 500);

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await db.from("name_reports").select("*", { count: "exact", head: true }).gte("emailed_at", since);
  if ((count ?? 0) >= MAX_EMAILS_PER_DAY) return json({ ok: true, emailed: false });
  const html = `
    <div style="font-family:sans-serif;max-width:520px">
      <h2 style="margin:0 0 8px">Afrikaans name: ${escape(row.species_name)}</h2>
      <p>Someone thinks this name could be wrong${row.env === "main" ? "" : ` (on ${row.env})`}.</p>
      <p>Now in the app: <b>${escape(row.current_name || "(none)")}</b><br>
         Suggested: <b>${escape(row.suggestion || "(no suggestion)")}</b></p>
      ${row.note ? `<p>Note: ${escape(row.note)}</p>` : ""}
      <p><a href="${APP_URL}admin.html">Open the dashboard</a> to mark it done.</p>
    </div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "SA Birds <onboarding@resend.dev>", to: [OWNER_EMAIL],
      subject: `Afrikaans name: ${row.species_name} → ${row.suggestion || "?"}`, html }),
  });
  if (!r.ok) { console.error(`Resend ${r.status}: ${await r.text()}`); return json({ ok: true, emailed: false }); }
  await db.from("name_reports").update({ emailed_at: new Date().toISOString() }).eq("id", inserted.data.id);
  return json({ ok: true, emailed: true });
}

async function decide(body: Record<string, unknown>) {
  const decision = body.decision === "keep" ? "kept" : body.decision === "remove" ? "removed" : null;
  const photoId = Number(body.photo_id);
  if (!decision || !Number.isInteger(photoId) || typeof body.token !== "string") return json({ error: "bad request" }, 400);
  const { data, error } = await db.from("photo_reviews")
    .update({ status: decision, decided_at: new Date().toISOString() })
    .eq("photo_id", photoId).eq("token", body.token)
    .select("photo_id, species_name, photo_url, status");
  if (error || !data?.length) return json({ error: "not found" }, 404);
  return json({ ok: true, review: data[0] });
}

async function lookup(body: Record<string, unknown>) {
  const { data } = await db.from("photo_reviews").select("photo_id, species_name, photo_url, status")
    .eq("photo_id", Number(body.photo_id)).eq("token", String(body.token || "")).maybeSingle();
  return data ? json({ ok: true, review: data }) : json({ error: "not found" }, 404);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    const body = await req.json();
    if (body.action === "report") return await report(body);
    if (body.action === "decide") return await decide(body);
    if (body.action === "name") return await nameReport(body);
    if (body.action === "lookup") return await lookup(body);
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "server error" }, 500);
  }
});
