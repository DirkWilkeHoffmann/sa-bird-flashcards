"use strict";
// Google sign-in through Supabase Auth. A signed-in account is linked to a sync code
// (table public.accounts), so progress follows the account to every device.
// Without the library (e.g. offline on first launch) the app simply works signed out.

const SUPABASE_URL = "https://oenkcaswabrkqhvukcyb.supabase.co";
const authClient = window.supabase?.createClient(SUPABASE_URL, SYNC_API_KEY, {
  auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
let account = null;  // the signed-in user, if any

function renderAccount() {
  const signedIn = Boolean(account);
  $("accountStatus").textContent = !authClient ? "Sign-in isn't available right now (offline?)."
    : signedIn ? `Signed in as ${account.email}. Your progress is saved to this account.`
    : "Sign in to keep your progress safe and use it on any device.";
  $("signIn").hidden = signedIn || !authClient;
  $("signOut").hidden = !signedIn;
}

// Link this account and this phone: an existing account brings its progress here,
// a new one takes over the progress already on this phone.
async function linkAccount(user) {
  const { data, error } = await authClient.from("accounts").select("sync_code").eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (data?.sync_code) {
    if (data.sync_code !== syncCode()) await adoptCode(data.sync_code);
  } else {
    const { error: insertError } = await authClient.from("accounts").insert({ user_id: user.id, sync_code: syncCode() });
    if (insertError) throw insertError;
  }
}

async function signIn() {
  $("accountStatus").textContent = "Opening Google…";
  const { error } = await authClient.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) $("accountStatus").textContent = "Couldn't open Google sign-in. Please try again.";
}

async function signOut() {
  await authClient.auth.signOut();
  account = null;
  renderAccount();
}

if (authClient) {
  authClient.auth.onAuthStateChange((event, session) => {
    const user = session?.user || null;
    const fresh = user && user.id !== account?.id;
    account = user;
    renderAccount();
    if (fresh) {
      linkAccount(user).catch(() => { $("accountStatus").textContent = "Signed in, but couldn't link your progress yet — it will retry next time."; });
    }
    // Tidy the address bar after returning from Google.
    if (location.search.includes("code=")) history.replaceState(null, "", location.pathname);
  });
}

$("signIn").addEventListener("click", signIn);
$("signOut").addEventListener("click", signOut);
$("score").addEventListener("click", renderAccount);
renderAccount();
