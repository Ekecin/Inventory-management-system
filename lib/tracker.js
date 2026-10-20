import { supabase } from "@/lib/supabase";

// Lightweight usage telemetry for the admin dashboard.
//  - tracked(): wraps a Supabase call and records what it was, whether it worked, and how long it took.
//  - startPresence(): heartbeat so the dashboard can show who is online right now.
// Everything here is best-effort: a tracking failure must never break the app,
// and tracking calls are never logged themselves (no feedback loop).

const FLUSH_MS = 4000;
const MAX_QUEUE = 200;
const HEARTBEAT_MS = 30000;

let queue = [];
let timer = null;

export async function flushEvents() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!supabase || queue.length === 0) return;
  const batch = queue.slice(0, 50);
  queue = queue.slice(50);
  try {
    await supabase.rpc("log_activity", { events: batch });
  } catch {
    // Telemetry is optional; drop the batch rather than retry forever.
  }
  if (queue.length > 0) timer = setTimeout(flushEvents, FLUSH_MS);
}

function logEvent(event) {
  if (!supabase) return;
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push(event);
  if (!timer) timer = setTimeout(flushEvents, FLUSH_MS);
}

/**
 * Run a Supabase call and log it.
 * @param {string} action  Dotted name, e.g. "inventory.select" or "auth.login"
 * @param {"GET"|"POST"|"PATCH"|"DELETE"|"AUTH"} method
 * @param {() => PromiseLike<{error?: {message: string} | null}>} fn
 * @param {{ email?: string }} [meta]  Attempted email, for sign-in attempts before a session exists
 */
export async function tracked(action, method, fn, meta = {}) {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const elapsed = () => Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - started);
  try {
    const result = await fn();
    logEvent({
      action, method,
      status: result?.error ? "error" : "success",
      duration_ms: elapsed(),
      error: result?.error?.message,
      email: meta.email,
    });
    return result;
  } catch (err) {
    logEvent({ action, method, status: "error", duration_ms: elapsed(), error: err?.message || "Unexpected error", email: meta.email });
    throw err;
  }
}

/** Start the online-presence heartbeat. Returns a function that stops it. */
export function startPresence(getView) {
  if (!supabase || typeof window === "undefined") return () => {};

  const beat = () => {
    if (document.visibilityState !== "visible") return;
    supabase
      .rpc("touch_presence", { p_view: getView?.() || null, p_agent: navigator.userAgent })
      .then(() => {}, () => {});
  };

  beat();
  const interval = setInterval(beat, HEARTBEAT_MS);
  const onVisible = () => { if (document.visibilityState === "visible") beat(); else flushEvents(); };
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/** Mark the current user as offline right away (call before signing out). */
export async function endPresence() {
  if (!supabase) return;
  try { await supabase.rpc("end_presence"); } catch { /* best effort */ }
}
