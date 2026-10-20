"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity, AlertTriangle, ArrowLeft, BellRing, Gauge, LayoutDashboard,
  Plus, RefreshCw, ShieldCheck, Trash2, Users
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

const ONLINE_SECONDS = 90;
const REFRESH_MS = 10000;
const RANGES = [
  { label: "Last 15 minutes", minutes: 15 },
  { label: "Last hour", minutes: 60 },
  { label: "Last 24 hours", minutes: 1440 },
];
const METRICS = {
  requests_per_user: { label: "Requests per user", unit: "requests" },
  errors_per_user: { label: "Errors per user", unit: "errors" },
  failed_logins: { label: "Failed sign-ins per email", unit: "failures" },
  deletes_per_user: { label: "Deletes per user", unit: "deletes" },
  total_requests: { label: "Total requests (all users)", unit: "requests" },
  error_rate: { label: "Error rate (needs 10+ requests)", unit: "%" },
};
const SEVERITIES = ["info", "warning", "critical"];
const ENDPOINT_LABELS = {
  "inventory.select": "Load inventory",
  "inventory.insert": "Add item",
  "inventory.update": "Edit item",
  "inventory.delete": "Delete item",
  "auth.login": "Sign in",
  "auth.signup": "Create account",
};
const TABS = [
  { id: "Overview", icon: LayoutDashboard },
  { id: "Traffic", icon: Activity },
  { id: "Alerts", icon: BellRing },
  { id: "Rules", icon: Gauge },
];

const num = (n) => Number(n || 0).toLocaleString();
const time = (iso) => new Date(iso).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function ago(seconds) {
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function device(ua = "") {
  const mobile = /Mobi|Android|iPhone/i.test(ua);
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${browser} · ${mobile ? "Mobile" : "Desktop"}`;
}

export default function AdminDashboard() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(null);
  const [tab, setTab] = useState("Overview");
  const [range, setRange] = useState(60);
  const [snap, setSnap] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [rules, setRules] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !session?.user) { setIsAdmin(null); return; }
    let cancelled = false;
    supabase.from("admins").select("user_id").eq("user_id", session.user.id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setIsAdmin(Boolean(data)); });
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  const refresh = useCallback(async () => {
    if (!supabase || !isAdmin) return;
    setLoading(true);
    const [s, a, r] = await Promise.all([
      supabase.rpc("admin_snapshot", { p_minutes: range }),
      supabase.rpc("admin_alerts"),
      supabase.from("monitoring_rules").select("*").order("created_at", { ascending: true }),
    ]);
    const failure = s.error || a.error || r.error;
    if (failure) setError(failure.message);
    else {
      setError("");
      setSnap(s.data);
      setAlerts(a.data || []);
      setRules(r.data || []);
      setUpdatedAt(new Date());
    }
    setLoading(false);
  }, [isAdmin, range]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!auto || !isAdmin) return;
    const id = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [auto, isAdmin, refresh]);

  async function saveRule(id, patch) {
    const { error: e } = await supabase.from("monitoring_rules").update(patch).eq("id", id);
    if (e) setError(e.message); else refresh();
  }
  async function addRule(rule) {
    const { error: e } = await supabase.from("monitoring_rules").insert(rule);
    if (e) { setError(e.message); return false; }
    refresh();
    return true;
  }
  async function deleteRule(rule) {
    if (!window.confirm(`Delete the rule "${rule.name}"?`)) return;
    const { error: e } = await supabase.from("monitoring_rules").delete().eq("id", rule.id);
    if (e) setError(e.message); else refresh();
  }

  if (!isSupabaseConfigured) return <Gate title="Supabase isn’t configured"><p className="muted">Add your Supabase details to <code>.env.local</code> and restart the dev server.</p></Gate>;
  if (authLoading || (session && isAdmin === null)) return <div className="center-screen"><div className="loader" /><p>Checking admin access…</p></div>;
  if (!session) return <Gate title="Sign in first"><p className="muted">Sign in to the inventory app with an admin account, then come back to this page.</p><p><a className="primary small" href="/">Go to sign in</a></p></Gate>;
  if (!isAdmin) return (
    <Gate title="Admin access only">
      <p className="muted">This account isn’t on the admin list. If you own this project, run <code>supabase/admin-monitoring.sql</code> in the Supabase SQL editor, then add yourself:</p>
      <pre>{`insert into public.admins (user_id)\nvalues ('${session.user.id}');`}</pre>
      <p><a className="secondary small" href="/">Back to inventory</a></p>
    </Gate>
  );

  const totals = snap?.totals || { calls: 0, errors: 0, unique_users: 0, avg_ms: 0 };
  const errorRate = totals.calls ? Math.round((totals.errors / totals.calls) * 1000) / 10 : 0;
  const users = (snap?.users || []).map((u) => ({ ...u, online: u.seconds_ago <= ONLINE_SECONDS }));
  const rangeLabel = RANGES.find((r) => r.minutes === range)?.label.toLowerCase();
  const subtitle = {
    Overview: "Who is using the app right now and how busy it is.",
    Traffic: "Which API calls are being made, by whom, and how they perform.",
    Alerts: "Rules that are currently triggered.",
    Rules: "Thresholds the dashboard checks on every refresh.",
  }[tab];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><img src="/gratitude-logo.jpeg" alt="Gratitude Technologies" /><div><strong>Gratitude</strong><span>TECHNOLOGIES</span></div></div>
        <div className="workspace-label">MONITORING</div>
        <nav>
          {TABS.map(({ id, icon: Icon }) => (
            <button key={id} className={tab === id ? "nav-item active" : "nav-item"} onClick={() => setTab(id)}>
              <Icon size={18} /> {id}
              {id === "Alerts" && alerts.length > 0 && <span className="nav-count warning-count">{alerts.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <a className="nav-item" href="/"><ArrowLeft size={18} /> Back to inventory</a>
          <div className="secure-note"><ShieldCheck size={15} /> Admin access verified</div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div>
            <p className="eyebrow">ADMIN DASHBOARD</p>
            <h1>{tab}</h1>
            <p className="muted">{subtitle}</p>
          </div>
          <div className="admin-controls">
            <label className="select-box"><select value={range} onChange={(e) => setRange(Number(e.target.value))}>{RANGES.map((r) => <option key={r.minutes} value={r.minutes}>{r.label}</option>)}</select></label>
            <label className="auto-toggle"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-refresh</label>
            <button className="secondary" onClick={refresh} disabled={loading}><RefreshCw size={15} /> Refresh</button>
          </div>
        </header>

        {error && <div className="alert error global-alert"><span>{error}</span></div>}
        {!snap && !error && <div className="empty-state"><div className="loader" /><p>Loading activity…</p></div>}

        {snap && tab === "Overview" && <>
          <section className="stats-grid">
            <StatCard icon={<Users size={19} />} label="Online now" value={num(snap.online_count)} note={`${users.length} seen in the last 24 hours`} />
            <StatCard icon={<Activity size={19} />} label="API requests" value={num(totals.calls)} note={`${rangeLabel} · ${num(totals.unique_users)} active users`} />
            <StatCard icon={<AlertTriangle size={19} />} label="Error rate" value={`${errorRate}%`} note={`${num(totals.errors)} failed · avg ${num(totals.avg_ms)} ms`} warning={errorRate > 10} />
            <StatCard icon={<BellRing size={19} />} label="Active alerts" value={num(alerts.length)} note={alerts.length ? "Rules are triggered" : "All rules are quiet"} warning={alerts.length > 0} />
          </section>
          <section className="admin-grid">
            <div className="panel admin-panel">
              <div className="panel-heading"><div><h2>Requests over time</h2><p className="muted">{rangeLabel}{updatedAt ? ` · updated ${time(updatedAt)}` : ""}</p></div>
                <div className="legend"><span><i className="dot ok" /> OK</span><span><i className="dot err" /> Errors</span></div></div>
              <Timeline points={snap.timeline || []} />
            </div>
            <div className="panel admin-panel">
              <div className="panel-heading"><div><h2>Active alerts</h2><p className="muted">Highest severity first</p></div><button className="text-button" onClick={() => setTab("Alerts")}>View all <span>→</span></button></div>
              <AlertList alerts={alerts.slice(0, 4)} empty="Nothing is triggered right now." />
            </div>
          </section>
          <section className="panel inventory-panel">
            <div className="panel-heading inventory-heading"><div><h2>People using the app</h2><p className="muted">Online means a heartbeat in the last {ONLINE_SECONDS} seconds</p></div></div>
            <div className="table-wrap"><table><thead><tr><th>USER</th><th>STATUS</th><th>VIEWING</th><th>DEVICE</th><th>LAST SEEN</th></tr></thead><tbody>
              {users.length === 0 ? <tr><td colSpan="5"><div className="empty-state"><div className="empty-icon"><Users size={23} /></div><strong>No one has been active yet</strong><p>Users appear here once they open the app.</p></div></td></tr> :
                users.map((u) => <tr key={u.user_id}><td><strong>{u.user_email || u.user_id}</strong></td><td><span className={u.online ? "status healthy" : "status idle"}><span />{u.online ? "Online" : "Offline"}</span></td><td>{u.current_view || "—"}</td><td>{device(u.user_agent)}</td><td>{ago(u.seconds_ago)}</td></tr>)}
            </tbody></table></div>
          </section>
        </>}

        {snap && tab === "Traffic" && <>
          <section className="panel inventory-panel">
            <div className="panel-heading inventory-heading"><div><h2>API endpoints</h2><p className="muted">Calls made by the app, {rangeLabel}</p></div></div>
            <div className="table-wrap"><table><thead><tr><th>ENDPOINT</th><th>METHOD</th><th>CALLS</th><th>ERRORS</th><th>AVG</th><th>P95</th></tr></thead><tbody>
              {(snap.endpoints || []).length === 0 ? <tr><td colSpan="6"><div className="empty-state"><strong>No traffic in this period</strong><p>Use the app, then refresh.</p></div></td></tr> :
                snap.endpoints.map((e) => <tr key={`${e.action}-${e.method}`}><td><div className="product-cell"><div><strong>{ENDPOINT_LABELS[e.action] || e.action}</strong><small className="mono">{e.action}</small></div></div></td><td><span className={`method m-${e.method}`}>{e.method}</span></td><td><strong>{num(e.calls)}</strong></td><td className={e.errors > 0 ? "text-warning" : ""}>{num(e.errors)}</td><td>{num(e.avg_ms)} ms</td><td>{num(e.p95_ms)} ms</td></tr>)}
            </tbody></table></div>
          </section>
          <section className="admin-grid admin-grid-even">
            <div className="panel inventory-panel">
              <div className="panel-heading inventory-heading"><div><h2>Most active users</h2><p className="muted">By API calls, {rangeLabel}</p></div></div>
              <div className="table-wrap"><table><thead><tr><th>USER</th><th>CALLS</th><th>ERRORS</th><th>LAST ACTIVE</th></tr></thead><tbody>
                {(snap.top_users || []).length === 0 ? <tr><td colSpan="4"><div className="empty-state"><strong>No activity yet</strong></div></td></tr> :
                  snap.top_users.map((u) => <tr key={u.user_email}><td><strong>{u.user_email}</strong></td><td>{num(u.calls)}</td><td className={u.errors > 0 ? "text-warning" : ""}>{num(u.errors)}</td><td>{time(u.last_active)}</td></tr>)}
              </tbody></table></div>
            </div>
            <div className="panel inventory-panel">
              <div className="panel-heading inventory-heading"><div><h2>Recent activity</h2><p className="muted">Latest 40 calls</p></div></div>
              <div className="table-wrap scroll-y"><table><thead><tr><th>TIME</th><th>USER</th><th>ACTION</th><th>RESULT</th></tr></thead><tbody>
                {(snap.recent || []).map((r) => <tr key={r.id}><td>{time(r.created_at)}</td><td>{r.user_email}</td><td className="mono">{r.action}</td><td><span className={r.status === "error" ? "status low" : "status healthy"} title={r.error_message || ""}><span />{r.status === "error" ? "Error" : `${num(r.duration_ms)} ms`}</span></td></tr>)}
              </tbody></table></div>
            </div>
          </section>
        </>}

        {snap && tab === "Alerts" && (
          <section className="panel admin-panel">
            <div className="panel-heading"><div><h2>{alerts.length} active {alerts.length === 1 ? "alert" : "alerts"}</h2><p className="muted">Re-checked on every refresh. Alerts clear on their own when the activity drops below the threshold.</p></div></div>
            <AlertList alerts={alerts} empty="All rules are quiet. Nothing needs your attention." />
          </section>
        )}

        {snap && tab === "Rules" && (
          <section className="panel admin-panel">
            <div className="panel-heading"><div><h2>Monitoring rules</h2><p className="muted">A rule fires when its metric goes above the threshold within the time window.</p></div></div>
            <div className="rules-list">
              {rules.length === 0 && <p className="muted">No rules yet. Add one below.</p>}
              {rules.map((rule) => <RuleRow key={`${rule.id}-${rule.name}-${rule.window_minutes}-${rule.threshold}-${rule.severity}-${rule.enabled}`} rule={rule} onSave={saveRule} onDelete={deleteRule} />)}
            </div>
            <NewRule onAdd={addRule} />
          </section>
        )}

        <footer className="footer"><span>© {new Date().getFullYear()} Gratitude Technologies</span><span>Usage is recorded by the app itself; see README for limits.</span></footer>
      </main>
    </div>
  );
}

function Gate({ title, children }) {
  return <main className="setup-screen"><div className="setup-card"><img src="/gratitude-logo.jpeg" alt="Gratitude Technologies logo" /><p className="eyebrow">ADMIN</p><h1>{title}</h1>{children}</div></main>;
}

function StatCard({ icon, label, value, note, warning }) {
  return <article className="stat-card"><div className={warning ? "stat-icon warning" : "stat-icon"}>{icon}</div><div className="stat-label">{label}</div><strong className="stat-value">{value}</strong><div className={warning ? "stat-note note-warning" : "stat-note"}>{note}</div></article>;
}

function Timeline({ points }) {
  if (!points.length) return <div className="empty-state"><p>No data for this period.</p></div>;
  const max = Math.max(1, ...points.map((p) => p.calls));
  return (
    <>
      <div className="timeline" role="img" aria-label="Requests over time">
        {points.map((p) => (
          <div key={p.t} className="tbar" title={`${time(p.t)} · ${p.calls} requests, ${p.errors} errors`}>
            {p.errors > 0 && <span className="tbar-err" style={{ height: `${(p.errors / max) * 100}%` }} />}
            {p.calls - p.errors > 0 && <span className="tbar-ok" style={{ height: `${((p.calls - p.errors) / max) * 100}%` }} />}
          </div>
        ))}
      </div>
      <div className="timeline-axis"><span>{time(points[0].t)}</span><span>peak {num(max)} / interval</span><span>{time(points[points.length - 1].t)}</span></div>
    </>
  );
}

function AlertList({ alerts, empty }) {
  if (!alerts.length) return <div className="alert-empty"><ShieldCheck size={18} /> {empty}</div>;
  return (
    <div className="alert-list">
      {alerts.map((a, i) => {
        const unit = METRICS[a.metric]?.unit || "";
        const pct = a.metric === "error_rate";
        return (
          <div key={`${a.rule_id}-${a.subject}-${i}`} className={`alert-row sev-${a.severity}`}>
            <span className={`sev-pill sev-${a.severity}`}>{a.severity}</span>
            <div><strong>{a.rule}</strong><small>{a.subject} · {num(a.value)}{pct ? "%" : ` ${unit}`} in {a.window_minutes} min (limit {num(a.threshold)}{pct ? "%" : ""})</small></div>
          </div>
        );
      })}
    </div>
  );
}

function RuleRow({ rule, onSave, onDelete }) {
  const [draft, setDraft] = useState({ name: rule.name, window_minutes: String(rule.window_minutes), threshold: String(rule.threshold), severity: rule.severity });
  const dirty = draft.name !== rule.name || Number(draft.window_minutes) !== rule.window_minutes || Number(draft.threshold) !== Number(rule.threshold) || draft.severity !== rule.severity;
  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  const metric = METRICS[rule.metric] || { label: rule.metric, unit: "" };

  return (
    <div className={rule.enabled ? "rule-row" : "rule-row disabled"}>
      <div className="rule-main">
        <input className="rule-name" value={draft.name} onChange={set("name")} maxLength={80} aria-label="Rule name" />
        <small className="muted">{metric.label}</small>
      </div>
      <label className="rule-field">More than<input type="number" min="0" step="any" value={draft.threshold} onChange={set("threshold")} /><span>{metric.unit}</span></label>
      <label className="rule-field">within<input type="number" min="1" max="1440" step="1" value={draft.window_minutes} onChange={set("window_minutes")} /><span>min</span></label>
      <label className="rule-field"><select value={draft.severity} onChange={set("severity")}>{SEVERITIES.map((s) => <option key={s}>{s}</option>)}</select></label>
      <label className="auto-toggle"><input type="checkbox" checked={rule.enabled} onChange={(e) => onSave(rule.id, { enabled: e.target.checked })} /> On</label>
      <div className="rule-actions">
        <button className="primary small" disabled={!dirty} onClick={() => onSave(rule.id, { name: draft.name.trim(), window_minutes: Number(draft.window_minutes), threshold: Number(draft.threshold), severity: draft.severity })}>Save</button>
        <button className="icon-button delete-button" title="Delete rule" onClick={() => onDelete(rule)}><Trash2 size={16} /></button>
      </div>
    </div>
  );
}

function NewRule({ onAdd }) {
  const blank = { name: "", metric: "requests_per_user", window_minutes: "5", threshold: "100", severity: "warning" };
  const [form, setForm] = useState(blank);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(event) {
    event.preventDefault();
    const ok = await onAdd({ name: form.name.trim(), metric: form.metric, window_minutes: Number(form.window_minutes), threshold: Number(form.threshold), severity: form.severity });
    if (ok) setForm(blank);
  }

  return (
    <form className="new-rule" onSubmit={submit}>
      <h3>Add a rule</h3>
      <div className="new-rule-grid">
        <label>Name<input value={form.name} onChange={set("name")} placeholder="e.g. Heavy API use" required maxLength={80} /></label>
        <label>Metric<select value={form.metric} onChange={set("metric")}>{Object.entries(METRICS).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}</select></label>
        <label>Threshold ({METRICS[form.metric].unit})<input type="number" min="0" step="any" value={form.threshold} onChange={set("threshold")} required /></label>
        <label>Window (minutes)<input type="number" min="1" max="1440" step="1" value={form.window_minutes} onChange={set("window_minutes")} required /></label>
        <label>Severity<select value={form.severity} onChange={set("severity")}>{SEVERITIES.map((s) => <option key={s}>{s}</option>)}</select></label>
        <button className="primary" type="submit"><Plus size={16} /> Add rule</button>
      </div>
    </form>
  );
}
