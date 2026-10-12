 "use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, ArrowDownToLine, Boxes, Check, ChevronDown,
  CirclePlus, ClipboardList, Edit3, LayoutDashboard, LogOut, Package,
  Search, Settings2, ShieldCheck, Trash2, TrendingUp, X
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

const emptyForm = { name: "", sku: "", category: "General", quantity: "0", unit_price: "", reorder_level: "5", supplier: "" };
const money = (value) => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(Number(value || 0));

export default function InventoryApp() {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState("login");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All categories");
  const [activeTab, setActiveTab] = useState("Overview");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  const loadItems = useCallback(async () => {
    if (!supabase || !session?.user) return;
    setLoading(true);
    setError("");
    const { data, error: loadError } = await supabase
      .from("inventory_items")
      .select("*")
      .order("created_at", { ascending: false });
    if (loadError) setError(loadError.message);
    else setItems(data || []);
    setLoading(false);
  }, [session]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const categories = useMemo(() => ["All categories", ...new Set(items.map((item) => item.category).filter(Boolean))], [items]);
  const filtered = useMemo(() => items.filter((item) => {
    const matchesQuery = [item.name, item.sku, item.category, item.supplier].join(" ").toLowerCase().includes(query.toLowerCase());
    const matchesCategory = category === "All categories" || item.category === category;
    const matchesTab = activeTab !== "Low stock" || Number(item.quantity) <= Number(item.reorder_level);
    return matchesQuery && matchesCategory && matchesTab;
  }), [items, query, category, activeTab]);

  const totalUnits = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const stockValue = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unit_price || 0), 0);
  const lowStock = items.filter((item) => Number(item.quantity) <= Number(item.reorder_level)).length;
  const categoriesCount = new Set(items.map((item) => item.category).filter(Boolean)).size;

  function openAdd() { setEditing(null); setForm(emptyForm); setError(""); setModalOpen(true); }
  function openEdit(item) {
    setEditing(item);
    setForm({ name: item.name || "", sku: item.sku || "", category: item.category || "General", quantity: String(item.quantity ?? 0), unit_price: String(item.unit_price ?? ""), reorder_level: String(item.reorder_level ?? 5), supplier: item.supplier || "" });
    setError("");
    setModalOpen(true);
  }
  function changeForm(event) { setForm((current) => ({ ...current, [event.target.name]: event.target.value })); }

  async function submitAuth(event) {
    event.preventDefault(); setError(""); setNotice("");
    if (!supabase) return;
    setLoading(true);
    const result = authMode === "login"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
    if (result.error) setError(result.error.message);
    else if (authMode === "signup" && !result.data.session) setNotice("Account created. Check your email to confirm your address, then sign in.");
    setLoading(false);
  }

  async function saveItem(event) {
    event.preventDefault(); if (!supabase) return;
    setSaving(true); setError(""); setNotice("");
    const payload = {
      name: form.name.trim(), sku: form.sku.trim(), category: form.category.trim() || "General",
      quantity: Number(form.quantity), unit_price: Number(form.unit_price), reorder_level: Number(form.reorder_level),
      supplier: form.supplier.trim(), user_id: session.user.id
    };
    const result = editing
      ? await supabase.from("inventory_items").update(payload).eq("id", editing.id).select().single()
      : await supabase.from("inventory_items").insert(payload).select().single();
    if (result.error) setError(result.error.message);
    else { setModalOpen(false); setNotice(editing ? "Item updated successfully." : "Item added to inventory."); await loadItems(); }
    setSaving(false);
  }

  async function deleteItem(item) {
    if (!supabase || !window.confirm(`Delete "${item.name}" from inventory? This cannot be undone.`)) return;
    const { error: deleteError } = await supabase.from("inventory_items").delete().eq("id", item.id);
    if (deleteError) setError(deleteError.message);
    else { setNotice("Item deleted."); await loadItems(); }
  }

  async function signOut() { await supabase?.auth.signOut(); setItems([]); }

  if (!isSupabaseConfigured) return <SetupScreen />;
  if (authLoading) return <div className="center-screen"><div className="loader" /><p>Preparing your workspace…</p></div>;

  if (!session) return (
    <main className="auth-screen">
      <section className="auth-brand">
        <div className="brand-mark"><img src="/gratitude-logo.jpeg" alt="Gratitude Technologies logo" /></div>
        <p className="eyebrow">GRATITUDE TECHNOLOGIES</p>
        <h1>Your inventory.<br /><span>In good hands.</span></h1>
        <p className="auth-copy">A clear view of your stock, product value, and what needs attention next.</p>
        <div className="auth-foot"><ShieldCheck size={16} /> Your inventory is private to your account.</div>
      </section>
      <section className="auth-panel">
        <form className="auth-form" onSubmit={submitAuth}>
          <div className="mobile-brand"><img src="/gratitude-logo.jpeg" alt="" /><span>Gratitude Technologies</span></div>
          <p className="eyebrow">{authMode === "login" ? "WELCOME BACK" : "GET STARTED"}</p>
          <h2>{authMode === "login" ? "Sign in to your workspace" : "Create your workspace login"}</h2>
          <p className="muted">{authMode === "login" ? "Enter your details to manage your inventory." : "Create an account to securely access inventory."}</p>
          {error && <div className="alert error">{error}</div>}{notice && <div className="alert success">{notice}</div>}
          <label>Email address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required autoComplete="email" /></label>
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" required minLength={6} autoComplete={authMode === "login" ? "current-password" : "new-password"} /></label>
          <button className="primary full" disabled={loading}>{loading ? "Please wait…" : authMode === "login" ? "Sign in" : "Create account"}</button>
          <p className="switch-auth">{authMode === "login" ? "New to Gratitude Inventory?" : "Already have an account?"} <button type="button" onClick={() => { setAuthMode(authMode === "login" ? "signup" : "login"); setError(""); setNotice(""); }}>{authMode === "login" ? "Create an account" : "Sign in"}</button></p>
        </form>
      </section>
    </main>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><img src="/gratitude-logo.jpeg" alt="Gratitude Technologies" /><div><strong>Gratitude</strong><span>TECHNOLOGIES</span></div></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav>
          <button className={activeTab === "Overview" ? "nav-item active" : "nav-item"} onClick={() => setActiveTab("Overview")}><LayoutDashboard size={18} /> Overview</button>
          <button className={activeTab === "Inventory" ? "nav-item active" : "nav-item"} onClick={() => setActiveTab("Inventory")}><Package size={18} /> Inventory <span className="nav-count">{items.length}</span></button>
          <button className={activeTab === "Low stock" ? "nav-item active" : "nav-item"} onClick={() => setActiveTab("Low stock")}><AlertTriangle size={18} /> Low stock {lowStock > 0 && <span className="nav-count warning-count">{lowStock}</span>}</button>
        </nav>
        <div className="sidebar-bottom"><div className="profile"><div className="avatar">{session.user.email?.[0]?.toUpperCase() || "G"}</div><div className="profile-text"><strong>{session.user.email?.split("@")[0]}</strong><span>{session.user.email}</span></div><button className="icon-button" title="Sign out" onClick={signOut}><LogOut size={17} /></button></div><div className="secure-note"><ShieldCheck size={15} /> Secure inventory workspace</div></div>
      </aside>
      <main className="main-area">
        <header className="topbar"><div><p className="eyebrow">INVENTORY MANAGEMENT</p><h1>{activeTab === "Overview" ? "Good to see you." : activeTab}</h1><p className="muted">{activeTab === "Overview" ? "Here’s what’s happening with your stock today." : activeTab === "Low stock" ? "Products that have reached their reorder level." : "Keep your products, quantities, and costs up to date."}</p></div><button className="primary" onClick={openAdd}><CirclePlus size={17} /> Add item</button></header>
        {error && <div className="alert error global-alert"><span>{error}</span><button onClick={() => setError("")}><X size={16} /></button></div>}
        {notice && <div className="alert success global-alert"><Check size={16} /> {notice}<button onClick={() => setNotice("")}><X size={16} /></button></div>}
        {activeTab === "Overview" && <section className="stats-grid">
          <StatCard icon={<Boxes size={19} />} label="Products tracked" value={items.length.toLocaleString()} note="Unique inventory items" />
          <StatCard icon={<ClipboardList size={19} />} label="Units in stock" value={totalUnits.toLocaleString()} note="Across all products" />
          <StatCard icon={<TrendingUp size={19} />} label="Stock value" value={money(stockValue)} note="Based on current unit cost" />
          <StatCard icon={<AlertTriangle size={19} />} label="Low stock alerts" value={lowStock.toLocaleString()} note={lowStock ? "Items need a restock check" : "All stock levels look good"} warning={lowStock > 0} />
        </section>}
        {activeTab === "Overview" && <section className="overview-grid">
          <div className="panel stock-panel"><div className="panel-heading"><div><h2>Inventory overview</h2><p className="muted">A snapshot of your product catalogue</p></div><button className="text-button" onClick={() => setActiveTab("Inventory")}>View inventory <span>→</span></button></div>
            <div className="overview-metrics"><div><span className="metric-label">Categories</span><strong>{categoriesCount}</strong><small>Product groups</small></div><div><span className="metric-label">Healthy stock</span><strong>{items.length - lowStock}</strong><small>Above reorder level</small></div><div><span className="metric-label">Needs attention</span><strong className={lowStock ? "text-warning" : ""}>{lowStock}</strong><small>At or below threshold</small></div></div>
            <div className="stock-bar-label"><span>Stock health</span><strong>{items.length ? Math.round(((items.length - lowStock) / items.length) * 100) : 0}% healthy</strong></div><div className="stock-bar"><span style={{ width: `${items.length ? ((items.length - lowStock) / items.length) * 100 : 0}%` }} /></div>
          </div>
          <div className="panel quick-panel"><div className="panel-heading"><div><h2>Quick actions</h2><p className="muted">Get things done faster</p></div><Settings2 size={18} className="subtle-icon" /></div><button className="quick-action" onClick={openAdd}><span className="quick-icon"><CirclePlus size={19} /></span><span><strong>Add a product</strong><small>Create a new inventory record</small></span><span className="quick-arrow">↗</span></button><button className="quick-action" onClick={() => setActiveTab("Low stock")}><span className="quick-icon amber"><AlertTriangle size={19} /></span><span><strong>Review low stock</strong><small>{lowStock} items need attention</small></span><span className="quick-arrow">↗</span></button></div>
        </section>}
        <section className="panel inventory-panel"><div className="panel-heading inventory-heading"><div><h2>{activeTab === "Low stock" ? "Restock watchlist" : activeTab === "Overview" ? "Recently added inventory" : "All inventory"}</h2><p className="muted">{filtered.length} {filtered.length === 1 ? "item" : "items"} shown</p></div><div className="filters"><label className="search-box"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products…" /></label><label className="select-box"><select value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c}>{c}</option>)}</select><ChevronDown size={15} /></label></div></div>
          <div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>SKU</th><th>CATEGORY</th><th>QUANTITY</th><th>UNIT PRICE</th><th>STOCK VALUE</th><th>STATUS</th><th></th></tr></thead><tbody>
            {loading ? <tr><td colSpan="8"><div className="empty-state"><div className="loader" /><p>Loading inventory…</p></div></td></tr> : filtered.length === 0 ? <tr><td colSpan="8"><div className="empty-state"><div className="empty-icon"><Package size={23} /></div><strong>{items.length === 0 ? "Your inventory starts here" : "No matching products"}</strong><p>{items.length === 0 ? "Add your first item to start tracking stock." : "Try changing your search or category filter."}</p>{items.length === 0 && <button className="primary small" onClick={openAdd}><CirclePlus size={16} /> Add first item</button>}</div></td></tr> :
              filtered.slice(0, activeTab === "Overview" ? 6 : undefined).map((item) => {
                const low = Number(item.quantity) <= Number(item.reorder_level);
                return <tr key={item.id}><td><div className="product-cell"><div className="product-icon"><Package size={17} /></div><div><strong>{item.name}</strong><small>{item.supplier || "No supplier added"}</small></div></div></td><td className="sku">{item.sku || "—"}</td><td><span className="category-pill">{item.category || "General"}</span></td><td><strong>{Number(item.quantity).toLocaleString()}</strong><small className="table-sub">Reorder at {item.reorder_level}</small></td><td>{money(item.unit_price)}</td><td><strong>{money(Number(item.quantity) * Number(item.unit_price))}</strong></td><td><span className={low ? "status low" : "status healthy"}><span />{low ? "Low stock" : "In stock"}</span></td><td><div className="row-actions"><button className="icon-button" title="Edit item" onClick={() => openEdit(item)}><Edit3 size={16} /></button><button className="icon-button delete-button" title="Delete item" onClick={() => deleteItem(item)}><Trash2 size={16} /></button></div></td></tr>;
              })}
          </tbody></table></div>
          <div className="table-footer"><span>Inventory is synced with Supabase</span><span><Activity size={14} /> Live database connection</span></div>
        </section>
        <footer className="footer"><span>© {new Date().getFullYear()} Gratitude Technologies</span><span>Built for better stock decisions.</span></footer>
      </main>
      {modalOpen && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}><section className="modal"><div className="modal-heading"><div><p className="eyebrow">{editing ? "UPDATE PRODUCT" : "NEW PRODUCT"}</p><h2>{editing ? "Edit inventory item" : "Add inventory item"}</h2><p className="muted">Product details are saved directly to your database.</p></div><button className="icon-button" onClick={() => setModalOpen(false)}><X size={19} /></button></div>
        <form onSubmit={saveItem}><div className="form-grid"><label className="span-two">Product name *<input name="name" value={form.name} onChange={changeForm} placeholder="e.g. Wireless keyboard" required maxLength={120} /></label><label>SKU / item code<input name="sku" value={form.sku} onChange={changeForm} placeholder="e.g. KB-001" maxLength={80} /></label><label>Category<input name="category" value={form.category} onChange={changeForm} placeholder="e.g. Electronics" required maxLength={80} /></label><label>Quantity in stock *<input type="number" name="quantity" value={form.quantity} onChange={changeForm} min="0" step="1" required /></label><label>Unit price (NGN) *<input type="number" name="unit_price" value={form.unit_price} onChange={changeForm} min="0" step="0.01" placeholder="0.00" required /></label><label>Reorder level *<input type="number" name="reorder_level" value={form.reorder_level} onChange={changeForm} min="0" step="1" required /></label><label>Supplier<input name="supplier" value={form.supplier} onChange={changeForm} placeholder="Supplier or vendor" maxLength={120} /></label></div>
        {error && <div className="alert error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary" onClick={() => setModalOpen(false)}>Cancel</button><button className="primary" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Add to inventory"}</button></div></form></section></div>}
    </div>
  );
}

function StatCard({ icon, label, value, note, warning }) {
  return <article className="stat-card"><div className={warning ? "stat-icon warning" : "stat-icon"}>{icon}</div><div className="stat-label">{label}</div><strong className="stat-value">{value}</strong><div className={warning ? "stat-note note-warning" : "stat-note"}>{note}</div></article>;
}

function SetupScreen() {
  return <main className="setup-screen"><div className="setup-card"><img src="/gratitude-logo.jpeg" alt="Gratitude Technologies logo" /><p className="eyebrow">GRATITUDE TECHNOLOGIES</p><h1>One small setup step.</h1><p className="muted">Add your Supabase project details to <code>.env.local</code> in the project root, then restart the development server.</p><pre>{`NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY`}</pre><p className="muted">Use your project URL and publishable/anon key only. Never put a service-role key in a browser app.</p></div></main>;
}
