 "use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertTriangle, ArrowDownToLine, Boxes, Check, ChevronDown,
  CirclePlus, ClipboardList, Edit3, LayoutDashboard, LogOut, Package, Receipt,
  Search, Settings2, ShieldCheck, ShoppingCart, Trash2, TrendingUp, X
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { endPresence, flushEvents, startPresence, tracked } from "@/lib/tracker";

const emptyForm = { name: "", sku: "", category: "General", quantity: "0", unit_price: "", reorder_level: "5", supplier: "" };
const emptySale = { quantity: "1", discountType: "percent", discountValue: "" };
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
  const [isAdmin, setIsAdmin] = useState(false);
  const viewRef = useRef("Overview");
  const [sales, setSales] = useState([]);
  const [salesError, setSalesError] = useState("");
  const [sellItem, setSellItem] = useState(null);
  const [saleForm, setSaleForm] = useState(emptySale);
  const [selling, setSelling] = useState(false);
  const [saleError, setSaleError] = useState("");

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => { viewRef.current = activeTab; }, [activeTab]);

  // Heartbeat so the admin dashboard can see who is online.
  useEffect(() => {
    if (!session?.user) return;
    return startPresence(() => viewRef.current);
  }, [session?.user?.id]);

  // Show the Admin link only to users listed in the admins table.
  useEffect(() => {
    if (!supabase || !session?.user) { setIsAdmin(false); return; }
    let cancelled = false;
    supabase.from("admins").select("user_id").eq("user_id", session.user.id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setIsAdmin(Boolean(data)); });
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  const loadItems = useCallback(async () => {
    if (!supabase || !session?.user) return;
    setLoading(true);
    setError("");
    const { data, error: loadError } = await tracked("inventory.select", "GET", () => supabase
      .from("inventory_items")
      .select("*")
      .order("created_at", { ascending: false }));
    if (loadError) setError(loadError.message);
    else setItems(data || []);
    setLoading(false);
  }, [session]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const loadSales = useCallback(async () => {
    if (!supabase || !session?.user) return;
    const { data, error: salesLoadError } = await tracked("sales.select", "GET", () => supabase
      .from("sales")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500));
    if (salesLoadError) setSalesError(salesLoadError.message);
    else { setSalesError(""); setSales(data || []); }
  }, [session]);

  useEffect(() => { loadSales(); }, [loadSales]);

  const revenue = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const unitsSold = sales.reduce((sum, sale) => sum + Number(sale.quantity || 0), 0);
  const discountsGiven = sales.reduce((sum, sale) => sum + Number(sale.discount_amount || 0), 0);

  // Live preview of the sale being entered
  const salePreview = useMemo(() => {
    if (!sellItem) return null;
    const qty = Number(saleForm.quantity) || 0;
    const subtotal = qty * Number(sellItem.unit_price || 0);
    const raw = Math.max(Number(saleForm.discountValue) || 0, 0);
    const discount = saleForm.discountType === "percent" ? subtotal * (Math.min(raw, 100) / 100) : Math.min(raw, subtotal);
    return { qty, subtotal, discount, total: subtotal - discount };
  }, [sellItem, saleForm]);

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
    const result = await tracked(authMode === "login" ? "auth.login" : "auth.signup", "AUTH", () => authMode === "login"
      ? supabase.auth.signInWithPassword({ email, password })
      : supabase.auth.signUp({ email, password }), { email });
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
    const result = await tracked(editing ? "inventory.update" : "inventory.insert", editing ? "PATCH" : "POST", () => editing
      ? supabase.from("inventory_items").update(payload).eq("id", editing.id).select().single()
      : supabase.from("inventory_items").insert(payload).select().single());
    if (result.error) setError(result.error.message);
    else { setModalOpen(false); setNotice(editing ? "Item updated successfully." : "Item added to inventory."); await loadItems(); }
    setSaving(false);
  }

  async function deleteItem(item) {
    if (!supabase || !window.confirm(`Delete "${item.name}" from inventory? This cannot be undone.`)) return;
    const { error: deleteError } = await tracked("inventory.delete", "DELETE", () => supabase.from("inventory_items").delete().eq("id", item.id));
    if (deleteError) setError(deleteError.message);
    else { setNotice("Item deleted."); await loadItems(); }
  }

  function openSell(item) { setSellItem(item); setSaleForm(emptySale); setSaleError(""); }
  function changeSale(event) { setSaleForm((current) => ({ ...current, [event.target.name]: event.target.value })); }

  async function submitSale(event) {
    event.preventDefault(); if (!supabase || !sellItem) return;
    const qty = Number(saleForm.quantity);
    const value = saleForm.discountValue === "" ? 0 : Number(saleForm.discountValue);
    if (!Number.isInteger(qty) || qty < 1) return setSaleError("Enter a whole number of 1 or more.");
    if (qty > sellItem.quantity) return setSaleError(`Only ${sellItem.quantity} in stock.`);
    if (Number.isNaN(value) || value < 0) return setSaleError("Discount can't be negative.");
    if (saleForm.discountType === "percent" && value > 100) return setSaleError("Percent discount can't be above 100.");
    if (saleForm.discountType === "amount" && salePreview && value > salePreview.subtotal) return setSaleError("Discount is more than the sale total.");
    setSelling(true); setSaleError("");
    // record_sale checks stock, lowers the quantity and logs the sale in one database transaction
    const { error: rpcError } = await tracked("sales.record", "POST", () => supabase.rpc("record_sale", {
      p_item_id: sellItem.id,
      p_quantity: qty,
      p_discount_type: value > 0 ? saleForm.discountType : "none",
      p_discount_value: value,
    }));
    if (rpcError) setSaleError(rpcError.message);
    else { setSellItem(null); setNotice("Sale recorded. Stock updated."); await Promise.all([loadItems(), loadSales()]); }
    setSelling(false);
  }

  async function signOut() {
    await flushEvents();
    await endPresence();
    await supabase?.auth.signOut();
    setItems([]);
    setSales([]);
  }

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
          <button className={activeTab === "Sales" ? "nav-item active" : "nav-item"} onClick={() => setActiveTab("Sales")}><Receipt size={18} /> Sales {sales.length > 0 && <span className="nav-count">{sales.length}</span>}</button>
          {isAdmin && <a className="nav-item" href="/admin"><ShieldCheck size={18} /> Admin dashboard</a>}
        </nav>
        <div className="sidebar-bottom"><div className="profile"><div className="avatar">{session.user.email?.[0]?.toUpperCase() || "G"}</div><div className="profile-text"><strong>{session.user.email?.split("@")[0]}</strong><span>{session.user.email}</span></div><button className="icon-button" title="Sign out" onClick={signOut}><LogOut size={17} /></button></div><div className="secure-note"><ShieldCheck size={15} /> Secure inventory workspace</div></div>
      </aside>
      <main className="main-area">
        <header className="topbar"><div><p className="eyebrow">INVENTORY MANAGEMENT</p><h1>{activeTab === "Overview" ? "Good to see you." : activeTab}</h1><p className="muted">{activeTab === "Overview" ? "Here’s what’s happening with your stock today." : activeTab === "Low stock" ? "Products that have reached their reorder level." : activeTab === "Sales" ? "Every sale recorded, with discounts applied." : "Keep your products, quantities, and costs up to date."}</p></div><button className="primary" onClick={openAdd}><CirclePlus size={17} /> Add item</button></header>
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
        {activeTab === "Sales" && <>
          <section className="stats-grid">
            <StatCard icon={<TrendingUp size={19} />} label="Sales revenue" value={money(revenue)} note="Amount paid after discounts" />
            <StatCard icon={<ShoppingCart size={19} />} label="Units sold" value={unitsSold.toLocaleString()} note="Across all sales" />
            <StatCard icon={<Receipt size={19} />} label="Sales recorded" value={sales.length.toLocaleString()} note="Number of transactions" />
            <StatCard icon={<ArrowDownToLine size={19} />} label="Discounts given" value={money(discountsGiven)} note="Total taken off sales" />
          </section>
          <section className="panel inventory-panel">
            <div className="panel-heading inventory-heading"><div><h2>Sales history</h2><p className="muted">Most recent first. Use the cart icon on any product to record a sale.</p></div></div>
            {salesError && <div className="alert error" style={{ margin: "0 22px 16px" }}>Couldn’t load sales: {salesError}. Make sure you ran supabase/sales.sql in the Supabase SQL Editor.</div>}
            <div className="table-wrap"><table><thead><tr><th>DATE</th><th>PRODUCT</th><th>QTY</th><th>UNIT PRICE</th><th>DISCOUNT</th><th>PAID</th></tr></thead><tbody>
              {sales.length === 0 ? <tr><td colSpan="6"><div className="empty-state"><div className="empty-icon"><Receipt size={23} /></div><strong>No sales yet</strong><p>Sales you record will show up here.</p></div></td></tr> :
                sales.map((sale) => <tr key={sale.id}><td>{new Date(sale.created_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</td><td><strong>{sale.item_name}</strong></td><td>{Number(sale.quantity).toLocaleString()}</td><td>{money(sale.unit_price)}</td><td>{Number(sale.discount_amount) > 0 ? `${money(sale.discount_amount)}${sale.discount_type === "percent" ? ` (${Number(sale.discount_value)}%)` : ""}` : "—"}</td><td><strong>{money(sale.total)}</strong></td></tr>)}
            </tbody></table></div>
          </section>
        </>}
        {activeTab !== "Sales" && <section className="panel inventory-panel"><div className="panel-heading inventory-heading"><div><h2>{activeTab === "Low stock" ? "Restock watchlist" : activeTab === "Overview" ? "Recently added inventory" : "All inventory"}</h2><p className="muted">{filtered.length} {filtered.length === 1 ? "item" : "items"} shown</p></div><div className="filters"><label className="search-box"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search products…" /></label><label className="select-box"><select value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c}>{c}</option>)}</select><ChevronDown size={15} /></label></div></div>
          <div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>SKU</th><th>CATEGORY</th><th>QUANTITY</th><th>UNIT PRICE</th><th>STOCK VALUE</th><th>STATUS</th><th></th></tr></thead><tbody>
            {loading ? <tr><td colSpan="8"><div className="empty-state"><div className="loader" /><p>Loading inventory…</p></div></td></tr> : filtered.length === 0 ? <tr><td colSpan="8"><div className="empty-state"><div className="empty-icon"><Package size={23} /></div><strong>{items.length === 0 ? "Your inventory starts here" : "No matching products"}</strong><p>{items.length === 0 ? "Add your first item to start tracking stock." : "Try changing your search or category filter."}</p>{items.length === 0 && <button className="primary small" onClick={openAdd}><CirclePlus size={16} /> Add first item</button>}</div></td></tr> :
              filtered.slice(0, activeTab === "Overview" ? 6 : undefined).map((item) => {
                const low = Number(item.quantity) <= Number(item.reorder_level);
                return <tr key={item.id}><td><div className="product-cell"><div className="product-icon"><Package size={17} /></div><div><strong>{item.name}</strong><small>{item.supplier || "No supplier added"}</small></div></div></td><td className="sku">{item.sku || "—"}</td><td><span className="category-pill">{item.category || "General"}</span></td><td><strong>{Number(item.quantity).toLocaleString()}</strong><small className="table-sub">Reorder at {item.reorder_level}</small></td><td>{money(item.unit_price)}</td><td><strong>{money(Number(item.quantity) * Number(item.unit_price))}</strong></td><td><span className={low ? "status low" : "status healthy"}><span />{low ? "Low stock" : "In stock"}</span></td><td><div className="row-actions"><button className="icon-button sell-button" title={Number(item.quantity) > 0 ? "Sell item" : "Out of stock"} disabled={Number(item.quantity) < 1} onClick={() => openSell(item)}><ShoppingCart size={16} /></button><button className="icon-button" title="Edit item" onClick={() => openEdit(item)}><Edit3 size={16} /></button><button className="icon-button delete-button" title="Delete item" onClick={() => deleteItem(item)}><Trash2 size={16} /></button></div></td></tr>;
              })}
          </tbody></table></div>
          <div className="table-footer"><span>Inventory is synced with Supabase</span><span><Activity size={14} /> Live database connection</span></div>
        </section>}
        <footer className="footer"><span>© {new Date().getFullYear()} Gratitude Technologies</span><span>Built for better stock decisions.</span></footer>
      </main>
      {modalOpen && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}><section className="modal"><div className="modal-heading"><div><p className="eyebrow">{editing ? "UPDATE PRODUCT" : "NEW PRODUCT"}</p><h2>{editing ? "Edit inventory item" : "Add inventory item"}</h2><p className="muted">Product details are saved directly to your database.</p></div><button className="icon-button" onClick={() => setModalOpen(false)}><X size={19} /></button></div>
        <form onSubmit={saveItem}><div className="form-grid"><label className="span-two">Product name *<input name="name" value={form.name} onChange={changeForm} placeholder="e.g. Wireless keyboard" required maxLength={120} /></label><label>SKU / item code<input name="sku" value={form.sku} onChange={changeForm} placeholder="e.g. KB-001" maxLength={80} /></label><label>Category<input name="category" value={form.category} onChange={changeForm} placeholder="e.g. Electronics" required maxLength={80} /></label><label>Quantity in stock *<input type="number" name="quantity" value={form.quantity} onChange={changeForm} min="0" step="1" required /></label><label>Unit price (NGN) *<input type="number" name="unit_price" value={form.unit_price} onChange={changeForm} min="0" step="0.01" placeholder="0.00" required /></label><label>Reorder level *<input type="number" name="reorder_level" value={form.reorder_level} onChange={changeForm} min="0" step="1" required /></label><label>Supplier<input name="supplier" value={form.supplier} onChange={changeForm} placeholder="Supplier or vendor" maxLength={120} /></label></div>
        {error && <div className="alert error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary" onClick={() => setModalOpen(false)}>Cancel</button><button className="primary" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Add to inventory"}</button></div></form></section></div>}
      {sellItem && salePreview && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setSellItem(null); }}><section className="modal"><div className="modal-heading"><div><p className="eyebrow">RECORD SALE</p><h2>Sell {sellItem.name}</h2><p className="muted">{Number(sellItem.quantity).toLocaleString()} in stock at {money(sellItem.unit_price)} each. Stock goes down automatically.</p></div><button className="icon-button" onClick={() => setSellItem(null)}><X size={19} /></button></div>
        <form onSubmit={submitSale}><div className="form-grid"><label className="span-two">Quantity sold<input type="number" name="quantity" value={saleForm.quantity} onChange={changeSale} min="1" max={sellItem.quantity} step="1" required /></label><label>Discount type<select name="discountType" value={saleForm.discountType} onChange={changeSale}><option value="percent">Percent (%)</option><option value="amount">Amount (NGN)</option></select></label><label>Discount<input type="number" name="discountValue" value={saleForm.discountValue} onChange={changeSale} min="0" step="0.01" placeholder="0" /></label></div>
          <div className="sale-summary"><div><span>Subtotal</span><strong>{money(salePreview.subtotal)}</strong></div><div><span>Discount</span><strong>− {money(salePreview.discount)}</strong></div><div className="sale-total"><span>Customer pays</span><strong>{money(salePreview.total)}</strong></div></div>
          {saleError && <div className="alert error">{saleError}</div>}
          <div className="modal-actions"><button type="button" className="secondary" onClick={() => setSaleForm((f) => ({ ...f, quantity: String(sellItem.quantity) }))}>Sell all stock</button><button type="button" className="secondary" onClick={() => setSellItem(null)}>Cancel</button><button className="primary" disabled={selling}>{selling ? "Recording…" : "Confirm sale"}</button></div></form></section></div>}
    </div>
  );
}

function StatCard({ icon, label, value, note, warning }) {
  return <article className="stat-card"><div className={warning ? "stat-icon warning" : "stat-icon"}>{icon}</div><div className="stat-label">{label}</div><strong className="stat-value">{value}</strong><div className={warning ? "stat-note note-warning" : "stat-note"}>{note}</div></article>;
}

function SetupScreen() {
  return <main className="setup-screen"><div className="setup-card"><img src="/gratitude-logo.jpeg" alt="Gratitude Technologies logo" /><p className="eyebrow">GRATITUDE TECHNOLOGIES</p><h1>One small setup step.</h1><p className="muted">Add your Supabase project details to <code>.env.local</code> in the project root, then restart the development server.</p><pre>{`NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY`}</pre><p className="muted">Use your project URL and publishable/anon key only. Never put a service-role key in a browser app.</p></div></main>;
}
