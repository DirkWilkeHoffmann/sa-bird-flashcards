// Quiz notifications (web push): "Dirk invited you to a quiz" and "Everyone's played".
// See docs/plan-friend-quizzes.md.
//
//   POST {type: "key"}                      → { key }: the public VAPID key the app subscribes with
//   POST {type: "invite", round_id}          the round's maker tells the invited friends (once per round)
//   POST {type: "results", round_id}         once everyone has played or declined, tells the players (once)
//
// "invite" and "results" need the player's sign-in (Authorization: Bearer <access token>).
// The VAPID keys are made here the first time and kept in table push_config (service role only),
// so the private key never leaves the server.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// Only the browsers' own push services (push_subscribe checks this too).
const PUSH_HOSTS = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)\//;
const LEVELS: Record<string, string> = { beginner: "Beginner", easy: "Easy", medium: "Medium", hard: "Hard" };
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

let vapid: { public_key: string; private_key: string; subject: string } | null = null;
async function keys() {
  if (vapid) return vapid;
  let { data } = await db.from("push_config").select("*").eq("id", 1).maybeSingle();
  if (!data) {
    const k = webpush.generateVAPIDKeys();
    await db.from("push_config").upsert({ id: 1, public_key: k.publicKey, private_key: k.privateKey, subject: "https://sabirds.co.za" },
      { onConflict: "id", ignoreDuplicates: true });
    ({ data } = await db.from("push_config").select("*").eq("id", 1).single());
  }
  vapid = data;
  webpush.setVapidDetails(data.subject, data.public_key, data.private_key);
  return data;
}

async function userOf(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  return data?.user ?? null;
}

// Sends one message to every phone of these players on the round's build (Dev or main).
async function send(userIds: string[], env: string, message: Record<string, unknown>) {
  if (!userIds.length) return 0;
  await keys();
  const { data: subs } = await db.from("push_subscriptions").select("*").in("user_id", userIds).eq("env", env);
  let sent = 0;
  await Promise.all((subs || []).filter((s) => PUSH_HOSTS.test(s.endpoint)).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(message), { TTL: 24 * 60 * 60, urgency: "high" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      else console.error("push failed", code, (e as Error).message);
    }
  }));
  return sent;
}

const nameOf = async (id: string) =>
  (await db.from("quiz_players").select("name").eq("user_id", id).maybeSingle()).data?.name || "A friend";

async function invite(req: Request, roundId: string) {
  const user = await userOf(req);
  if (!user) return json({ error: "not signed in" }, 401);
  // Only the maker, only once.
  const { data: round } = await db.from("quiz_rounds").update({ invite_sent: true })
    .eq("id", roundId).eq("created_by", user.id).eq("invite_sent", false).select().maybeSingle();
  if (!round) return json({ sent: 0 });
  const { data: entries } = await db.from("quiz_entries").select("user_id").eq("round_id", roundId).neq("user_id", user.id);
  const by = await nameOf(user.id);
  const sent = await send((entries || []).map((e) => e.user_id), round.env, {
    title: `${by} invited you to a quiz`,
    body: `10 birds · ${round.area_name} · ${LEVELS[round.level] || round.level}. Open within 24 hours to play.`,
    round: round.id, tag: `quiz-${round.id}`,
  });
  return json({ sent });
}

async function results(req: Request, roundId: string) {
  const user = await userOf(req);
  if (!user) return json({ error: "not signed in" }, 401);
  const { data: entries } = await db.from("quiz_entries").select("user_id, status").eq("round_id", roundId);
  if (!entries?.some((e) => e.user_id === user.id)) return json({ sent: 0 });
  if (entries.some((e) => e.status === "invited" || e.status === "playing")) return json({ sent: 0 });
  const { data: round } = await db.from("quiz_rounds").update({ results_sent: true })
    .eq("id", roundId).eq("results_sent", false).select().maybeSingle();
  if (!round) return json({ sent: 0 });
  // The player who finished last sees the results on screen already.
  const others = entries.filter((e) => e.status === "done" && e.user_id !== user.id).map((e) => e.user_id);
  const sent = await send(others, round.env, {
    title: "Everyone's played",
    body: `${round.area_name} · ${LEVELS[round.level] || round.level}: see how everyone did.`,
    round: round.id, tag: `quiz-${round.id}`,
  });
  return json({ sent });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    const body = await req.json();
    const id = typeof body.round_id === "string" && /^[0-9a-f-]{36}$/.test(body.round_id) ? body.round_id : null;
    if (body.type === "key") return json({ key: (await keys()).public_key });
    if (body.type === "invite" && id) return await invite(req, id);
    if (body.type === "results" && id) return await results(req, id);
    return json({ error: "bad request" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: "server error" }, 500);
  }
});
