// Tile bodies. Each takes the whole dashboard payload; the registry at the bottom gives title, subtitle and
// which source feeds it.
import { useState, type ReactNode } from "react";
import type { Dashboard } from "./api";
import { AnimatedNumber, ColumnChart, Donut, LineChart, Meter, SegmentBar, TrendChart } from "./charts";
import { AGE_TONES } from "./InventoryDetail";
import { LATE_TONES as OTD_LATE_TONES } from "./OtdDetail";
import { dec1, money, moneyAxis, moneyCur, moneyCurFull, moneyFull, moneyHero, num, pct, shortDate, timeOf } from "./format";

type P = { d: Dashboard };

// Categorical slots, fixed order (dataviz palette). Suppliers keep their slot whatever the filter.
const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)"];

function Status({ tone, children }: { tone: "good" | "warning" | "serious" | "critical" | "neutral"; children: ReactNode }) {
  const icon = { good: "✓", warning: "!", serious: "!", critical: "✕", neutral: "•" }[tone];
  return <span className={`status st-${tone}`}><span className="st-ic" aria-hidden>{icon}</span>{children}</span>;
}

function Hero({ value, format, label, sub }: { value: number; format: (v: number) => string; label: string; sub?: ReactNode }) {
  return (
    <div className="hero">
      <div className="hero-v"><AnimatedNumber value={value} format={format} /></div>
      <div className="hero-l">{label}</div>
      {sub && <div className="hero-s">{sub}</div>}
    </div>
  );
}

/** In production this links to another internal app (order tracking, PO tracker, the ERP); the demo says so. */
function MoreLink({ what, children = "More info" }: { what: string; children?: ReactNode }) {
  return (
    <span className="more more-demo" title={`In the production version, this opens ${what} in a new tab.`}>
      {children}
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M4 2h6v6M10 2 3 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      <small>opens {what} in production</small>
    </span>
  );
}

/** Item and order numbers opened the record in Zoho in production. */
const ZOHO_NOTE = "In the production version, clicking this opens the record directly in Zoho, in a new tab.";

// ---- period picker (3 / 6 / 12 months), remembered per browser and per tile ------------------------

function usePeriod(storageKey: string, fallback: number): [number, (m: number) => void] {
  const [months, setState] = useState(() => {
    try { const v = Number(localStorage.getItem(storageKey)); if ([3, 6, 12].includes(v)) return v; } catch { /* ignore */ }
    return fallback;
  });
  const set = (m: number) => { setState(m); try { localStorage.setItem(storageKey, String(m)); } catch { /* ignore */ } };
  return [months, set];
}

function PeriodPicker({ months, onChange, available }: { months: number; onChange: (m: number) => void; available: string[] }) {
  return (
    <div className="seg-ctl" role="tablist" aria-label="Period">
      {[3, 6, 12].filter((m) => available.includes(String(m))).map((m) => (
        <button key={m} role="tab" aria-selected={months === m} className={months === m ? "on" : ""} onClick={() => onChange(m)}>{m} months</button>
      ))}
    </div>
  );
}

// ---- 1. stock of the top products -----------------------------------------------------------

function coverTone(m: number | null): { tone: "good" | "warning" | "critical" | "neutral"; label: string } {
  if (m === null) return { tone: "neutral", label: "—" };
  if (m < 1) return { tone: "critical", label: "Critical" };
  if (m < 2) return { tone: "warning", label: "Low" };
  if (m > 5) return { tone: "neutral", label: "Overstock" };
  return { tone: "good", label: "OK" };
}

export function StockTile({ d }: P) {
  const st = d.stock;
  const [months, setMonths] = usePeriod("md-stock-months", st.default_months ?? 6);
  const periods = st.periods ?? {};
  const per = periods[String(months)] ?? periods[String(st.default_months ?? 6)];
  if (st.source !== "live" || !per) {
    return (
      <div className="tile-wait">
        {st.source === "error"
          ? <><Status tone="critical">ERP unreachable</Status><p className="foot">{st.error}</p></>
          : <><span className="spinner" /><p>Reading sales and stock…</p></>}
      </div>
    );
  }
  const rows = per.rows;
  const critical = rows.filter((r) => (r.months_cover ?? 99) < 1).length;
  return (
    <>
      <div className="period-row">
        <div className="tile-kpis">
          <div><b>{rows.length}</b><span>best-selling products</span></div>
          <div><b className={critical ? "t-critical" : ""}>{critical}</b><span>under 1 month of cover</span></div>
        </div>
        <PeriodPicker months={per.months} onChange={setMonths} available={Object.keys(periods)} />
      </div>
      <div className="table stock-table">
        <div className="tr th">
          <span>Product</span><span className="r">Shipped {per.months} mo</span><span className="r">In stock</span>
          <span>Cover</span>
        </div>
        {rows.map((r, i) => {
          const c = coverTone(r.months_cover);
          const cover = r.months_cover === null ? null : Math.max(0, r.months_cover);
          return (
            <div className="tr row-in" key={`${per.months}-${r.id}`} style={{ animationDelay: `${i * 40}ms` }}>
              <span className="prod" title={ZOHO_NOTE}>
                <b>{r.name}</b>
                <small title={r.description || r.sku}>{r.description || r.sku}</small>
              </span>
              <span className="r num" title={`${dec1(r.avg_monthly)} a month`}>{num(r.sold)}</span>
              <span className="r num" title={r.committed ? `${num(r.committed)} of them committed to orders` : undefined}>{num(r.on_hand)}</span>
              <span className="cover">
                <Meter value={cover ?? 0} max={6} tone={c.tone === "neutral" ? "muted" : c.tone} />
                <span className="cover-v">{cover === null ? "—" : `${dec1(cover)} mo`}</span>
                <Status tone={c.tone}>{c.label}</Status>
              </span>
            </div>
          );
        })}
      </div>
      <p className="foot">
        Ranking: units shipped from the Halden Canada plant (to customers and to the sister companies) over {per.months} months, from the
        FIFO lots. In stock: {st.locations?.join(" + ") ?? "usable locations"}. Cover = (in stock − units committed to orders) ÷ average
        shipped per month; critical &lt; 1 month, low &lt; 2, overstock &gt; 5.
        {st.as_of ? ` Data as of ${shortDate(st.as_of)}, ${timeOf(st.as_of)}.` : ""}
      </p>
    </>
  );
}

// ---- 2. suppliers (ERP "FIFO Cost Lot Tracking" report, Halden Canada) ---------------------------------

const TOP_SUPPLIERS = 6;


export function SuppliersTile({ d }: P) {
  const all = d.suppliers;
  const [hover, setHover] = useState<string | null>(null);
  const [months, setMonths] = usePeriod("md-suppliers-months", all.default_months ?? 6);
  const periods = all.periods ?? {};
  const s = periods[String(months)] ?? periods[String(all.default_months ?? 6)];
  if (all.source !== "live" || !s) {
    return (
      <div className="tile-wait">
        {all.source === "error"
          ? <><Status tone="critical">ERP unreachable</Status><p className="foot">{all.error}</p></>
          : <><span className="spinner" /><p>Reading FIFO lots…</p></>}
      </div>
    );
  }
  // One colour per supplier, the same in both sections (biggest purchases first, then the others seen in
  // the parts); beyond the palette, "Others" in gray. Colour never carries meaning alone: names are shown.
  // Built from the longest window, so a supplier keeps its colour when the period changes.
  const ref = periods["12"] ?? s;
  const order: string[] = [];
  for (const x of ref.suppliers) if (!order.includes(x.name)) order.push(x.name);
  const partTotals = new Map<string, number>();
  for (const per of Object.values(periods)) for (const p of per.parts) for (const x of p.split) partTotals.set(x.source, (partTotals.get(x.source) ?? 0) + x.qty);
  for (const [k] of [...partTotals].sort((a, b) => b[1] - a[1])) if (!order.includes(k)) order.push(k);
  const IN_HOUSE = "Assembled in-house";
  const colourOf = (name: string) => {
    if (name === IN_HOUSE) return "var(--inhouse)";
    const i = order.filter((n) => n !== IN_HOUSE).indexOf(name);
    return i >= 0 && i < SERIES.length ? SERIES[i] : "var(--gray-mark)";
  };

  const shown = s.suppliers.slice(0, TOP_SUPPLIERS);
  const rest = s.suppliers.slice(TOP_SUPPLIERS);
  const restValue = rest.reduce((t, x) => t + x.value, 0);
  const slices = [...shown.map((x) => ({ key: x.name, label: x.name, value: x.value, colour: colourOf(x.name) })),
    ...(rest.length ? [{ key: "__rest", label: `Others (${rest.length} suppliers)`, value: restValue, colour: "var(--gray-mark)" }] : [])];
  const total = s.purchases_total ?? 0;

  return (
    <>
      <div className="period-row">
        <h4 className="sub-h first">Purchases by supplier</h4>
        <PeriodPicker months={months} onChange={setMonths} available={Object.keys(periods)} />
      </div>
      <div className="donut-wrap">
        <Donut key={months} slices={slices} total={total} format={moneyHero} centerLabel={`${s.suppliers.length} suppliers`}
          active={hover} onActive={setHover} />
        <div className="donut-legend">
          {slices.map((x, i) => (
            <div className={`dl-row row-in ${hover && hover !== x.key ? "dim" : ""} ${hover === x.key ? "on" : ""}`} key={x.key}
              style={{ animationDelay: `${i * 40}ms` }} onMouseEnter={() => setHover(x.key)} onMouseLeave={() => setHover(null)}>
              <i style={{ background: x.colour }} />
              <span className="dl-name" title={x.label}>{x.label}</span>
              <b className="num">{money(x.value)}</b>
              <span className="muted num">{(Math.round((x.value / (total || 1)) * 1000) / 10).toLocaleString("en-CA")}%</span>
            </div>
          ))}
        </div>
      </div>

      <h4 className="sub-h">Most-used parts: share from each supplier</h4>
      <div className="split-rows">
        {s.parts.map((p, i) => (
          <div className="split-row row-in" key={p.id} style={{ animationDelay: `${i * 45}ms` }}>
            <span className="split-name" title={`${p.name}. ${ZOHO_NOTE}`}>
              <b>{p.sku || p.name}</b>
              <small>{num(p.qty)} u. · {money(p.value)}</small>
            </span>
            <div className="segbar split-bar">
              {p.split.map((x) => (
                <div key={x.source} className={`seg ${hover && hover !== x.source ? "dim" : ""}`}
                  style={{ flexGrow: x.pct, background: colourOf(x.source) }}
                  onMouseEnter={() => setHover(x.source)} onMouseLeave={() => setHover(null)}
                  title={`${x.source}: ${num(x.qty)} u. (${x.pct.toLocaleString("en-CA")}%)`}>
                  {x.pct >= 18 && <span className="seg-pct">{Math.round(x.pct)}%</span>}
                </div>
              ))}
            </div>
            <span className="split-who" title={p.split.map((x) => `${x.source} ${Math.round(x.pct)}%`).join(" · ")}>
              {p.suppliers > 1 ? `${p.suppliers} suppliers` : p.split[0]?.source}
            </span>
          </div>
        ))}
      </div>
      <div className="legend so-legend">
        <span className="lg"><i style={{ background: "var(--gray-mark)" }} />Other suppliers, adjustments</span>
        <span className="muted small">same colours as the purchases</span>
      </div>
      <p className="foot">
        Halden Canada's FIFO lots, last {s.months} months{all.as_of ? ` (as of ${shortDate(all.as_of)}, ${timeOf(all.as_of)})` : ""}.
        Purchases = value received on supplier bills, before taxes, sister companies excluded. Parts = units used in assemblies
        (sub-assemblies made in-house left out), ranked by value; each unit is traced to the supplier of its lot. {s.multi_source_parts} of the {s.parts_count} parts
        used come from more than one supplier.
      </p>
    </>
  );
}

// ---- 3. inventory value (ERP "Inventory Aging Summary": Halden Canada + Halden Industrial) ------------

const ORG_TONES = ["var(--series-1)", "var(--series-3)", "var(--series-4)"];

export function InventoryTile({ d }: P) {
  const inv = d.inventory;
  const [org, setOrg] = useState<string>("all");
  if (inv.source !== "live") {
    return (
      <div className="tile-wait">
        {inv.source === "error"
          ? <><Status tone="critical">ERP unreachable</Status><p className="foot">{inv.error}</p></>
          : <><span className="spinner" /><p>Reading inventory reports…</p></>}
      </div>
    );
  }
  const sel = org === "all" ? null : inv.orgs.find((o) => o.id === org) ?? null;
  const total = sel ? sel.total : inv.total;
  const dormant = sel ? sel.dormant : inv.dormant;
  const buckets = sel ? sel.buckets : inv.orgs[0].buckets.map((b, i) => ({ ...b, value: inv.orgs.reduce((s, o) => s + o.buckets[i].value, 0) }));
  const history = inv.history.map((h) => sel
    ? { date: h.date, value: h.by_org[sel.id]?.total ?? 0, base: h.by_org[sel.id]?.dormant ?? 0 }
    : { date: h.date, value: h.total, base: h.dormant });
  const orgTip = (i: number) => sel ? null : inv.orgs.map((o) => (
    <div className="tip-r muted" key={o.id}>{o.short}<b>{money(inv.history[i].by_org[o.id]?.total ?? 0)}</b></div>
  ));

  return (
    <>
      <div className="seg-ctl" role="tablist" aria-label="Company">
        {[{ id: "all", short: "Both" }, ...inv.orgs].map((o) => (
          <button key={o.id} role="tab" aria-selected={org === o.id} className={org === o.id ? "on" : ""} onClick={() => setOrg(o.id)}>
            {"name" in o ? o.name : o.short}
          </button>
        ))}
      </div>
      <div className="row-2">
        <Hero value={total} format={moneyHero} label={sel ? `Inventory value: ${sel.name}` : "Total inventory value"}
          sub={<><span className="gray-dot" /><span>{money(dormant)} dormant ({Math.round((dormant / (total || 1)) * 100)}%): in stock for over {inv.dormant_months} months</span></>} />
        <div className="inv-side">
          {(() => {
            const t = inv.turnover?.[sel ? sel.id : "all"];
            if (!t) return null;
            const why = `Sales over the last 12 months (${moneyFull(t.sales)}) ÷ average inventory over those months (${moneyFull(t.avg_value)}). Days on hand = 365 ÷ turns.`;
            return (
              <div className="turns" title={why}>
                <div><b>{dec1(t.turns)}×</b><span>inventory turns a year</span></div>
                <div><b>{t.days === null ? "—" : num(t.days)}</b><span>days of inventory on hand</span></div>
              </div>
            );
          })()}
          {!sel && (
            <div className="org-split">
              {inv.orgs.map((o, i) => (
                <button className="org-row" key={o.id} onClick={() => setOrg(o.id)} title={`Show ${o.name} only`}>
                  <i style={{ background: ORG_TONES[i] }} />
                  <span className="org-name">{o.name}</span>
                  <b>{money(o.total)}</b>
                  <span className="muted">{Math.round((o.total / inv.total) * 100)}%</span>
                  <Meter value={o.total} max={inv.total} tone={i === 0 ? "series-1" : "series-3"} />
                  <small className="muted">{money(o.dormant)} dormant</small>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <h4 className="sub-h">Stock age (since receipt)</h4>
      <SegmentBar format={money} segs={buckets.map((b, i) => ({ key: b.key, label: b.label, value: b.value, color: AGE_TONES[i] ?? "var(--gray-mark)" }))} />
      <h4 className="sub-h">Trend: last 12 months</h4>
      <TrendChart key={org} format={moneyAxis} lastLabel={inv.as_of ? `as of ${shortDate(inv.as_of)}` : "latest"} valueLabel="Total value" baseLabel={`Dormant (> ${inv.dormant_months} months)`}
        data={history} extraTip={orgTip} />
      <p className="foot">
        ERP "Inventory Aging Summary" report: FIFO cost, every location, transfers don't reset the age.
        Month-end values; the last point is the latest reading{inv.as_of ? ` (${shortDate(inv.as_of)}, ${timeOf(inv.as_of)})` : ""}.
        Turns = sales over the last 12 months ÷ average inventory over the same months (the plant's shipments for Halden Canada and
        both companies; Halden Industrial's own sales for Halden Industrial); days on hand = 365 ÷ turns. Refreshed every weekday at
        7:00 in production.
      </p>
      {sel && <div className="tile-actions"><MoreLink what="the report in Zoho">Open the report</MoreLink></div>}
    </>
  );
}

// ---- 4. purchase orders (Halden Canada + Halden Industrial) ---------------------------------------------

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTH_ABBR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

/** One figure per currency, CAD (or the first) large, the others below: never added together. */
function CurValues({ items, big }: { items: { currency: string; value: number }[]; big?: boolean }) {
  const shown = items.filter((x, i) => i === 0 || x.value > 0);
  if (!shown.length) return <b className="box-v">$0</b>;
  return (
    <>
      <b className={big ? "box-v" : ""}><AnimatedNumber value={shown[0].value} format={(v) => moneyCur(v, shown[0].currency)} /></b>
      {shown.slice(1).map((x) => <span className="box-v2" key={x.currency}>+ {moneyCur(x.value, x.currency)}</span>)}
    </>
  );
}

export function PurchaseOrdersTile({ d, onOpen }: P & { onOpen: (k: string) => void }) {
  const po = d.purchase_orders;
  if (po.source !== "live") {
    return (
      <div className="tile-wait">
        {po.source === "error"
          ? <><Status tone="critical">ERP unreachable</Status><p className="foot">{po.error}</p></>
          : <><span className="spinner" /><p>Reading purchase orders…</p></>}
      </div>
    );
  }
  const cs = po.currencies;
  const count = (k: "draft" | "issued") => cs.reduce((s, c) => s + c[k].count, 0);
  return (
    <>
      <div className="boxes">
        <div className="box">
          <span className="box-l">Draft POs</span>
          <CurValues big items={cs.map((c) => ({ currency: c.currency, value: c.draft.value }))} />
          <span className="box-s">{count("draft")} purchase orders</span>
        </div>
        <button className="box box-btn" onClick={() => onOpen("po-monthly")}>
          <span className="box-l">Issued POs · still to receive</span>
          <CurValues big items={cs.map((c) => ({ currency: c.currency, value: c.issued.value }))} />
          <span className="box-s">{count("issued")} open purchase orders</span>
          <span className="box-cta">See the monthly average →</span>
        </button>
      </div>
      <p className="foot">
        {po.orgs.join(" + ")} · amounts include taxes · issued = part of open POs not received yet.
        {po.as_of ? ` Data as of ${shortDate(po.as_of)}, ${timeOf(po.as_of)}.` : ""}
      </p>
      <div className="tile-actions"><MoreLink what="the PO tracking app" /></div>
    </>
  );
}

export function PoMonthlyModal({ d }: P) {
  const cs = d.purchase_orders.currencies;
  const [cur, setCur] = useState(cs[0]?.currency ?? "CAD");
  const c = cs.find((x) => x.currency === cur) ?? cs[0];
  if (!c) return <p className="empty">No data.</p>;
  const fmt = (v: number) => moneyCur(v, c.currency);
  return (
    <>
      {cs.length > 1 && (
        <div className="seg-ctl" role="tablist" aria-label="Currency">
          {cs.map((x) => <button key={x.currency} role="tab" aria-selected={x.currency === cur} className={x.currency === cur ? "on" : ""} onClick={() => setCur(x.currency)}>{x.currency}</button>)}
        </div>
      )}
      <p className="modal-lead">Value of POs issued each month (by PO date, taxes included). Average of the 11 complete months: <b>{moneyCurFull(c.avg_monthly, c.currency)}</b>.</p>
      <ColumnChart key={cur} height={260} format={fmt} avg={c.avg_monthly} avgLabel="avg." lastPartial valueLabel="POs issued"
        data={c.monthly.map((m) => ({ label: monthLabel(m.month), value: m.value, detail: <div className="tip-r muted">Count<b>{m.count}</b></div> }))} />
      <div className="tile-actions"><MoreLink what="the PO tracking app" /></div>
    </>
  );
}

// ---- 5. sales orders -----------------------------------------------------------------------

const LATE_TONES = ["var(--series-1)", "var(--warning)", "var(--serious)", "var(--critical)"];

export function SalesOrdersTile({ d }: P) {
  const so = d.sales_orders;
  if (so.source === "error") {
    return (
      <div className="tile-wait">
        <Status tone="critical">Order app unreachable</Status>
        <p className="foot">{so.error}</p>
      </div>
    );
  }
  const labels = so.currencies[0]?.buckets ?? [];
  return (
    <>
      {so.source === "stale" && (
        <div className="inline-alert stale-alert">
          <Status tone="warning">Order app unreachable</Status>
          <span>Last known figures{so.computed_at ? `, computed ${shortDate(so.computed_at)}, ${timeOf(so.computed_at)}` : ""}.</span>
        </div>
      )}
      <div className="so-head">
        <Hero value={so.count} format={num} label="Open sales orders"
          sub={`${so.partial_count} partly shipped: only the rest counts`} />
      </div>
      <div className="cur-blocks">
        {so.currencies.map((c) => (
          <div className="cur-block" key={c.currency}>
            <div className="cur-top">
              <span className="box-l">Left to ship · {c.currency}</span>
              <span className="muted small">{c.count} orders</span>
            </div>
            <b className="cur-v"><AnimatedNumber value={c.remaining} format={(v) => moneyCur(v, c.currency)} /></b>
            <SegmentBar legend={false} height={10} format={(v) => moneyCurFull(v, c.currency)}
              segs={c.buckets.map((b, i) => ({ key: b.key, label: `${b.label} (${b.count})`, value: b.value, color: LATE_TONES[i] }))} />
            <div className="cur-counts">
              {c.buckets.map((b, i) => (
                <span key={b.key} title={`${b.label}: ${b.count} orders, ${moneyCurFull(b.value, c.currency)}`}>
                  <i style={{ background: LATE_TONES[i] }} />{b.count}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="legend so-legend">
        {labels.map((b, i) => <span className="lg" key={b.key}><i style={{ background: LATE_TONES[i] }} />{b.label}</span>)}
        <span className="muted small">by planned ship date</span>
      </div>
      {so.late_count ? (
        <div className="inline-alert">
          <Status tone="critical">{so.late_count} late</Status>
          <span>{so.currencies.filter((c) => c.late_value > 0).map((c) => moneyCurFull(c.late_value, c.currency)).join(" + ")} already due to customers</span>
        </div>
      ) : null}
      <p className="foot">
        Open orders of the three companies, intercompany orders excluded{so.computed_at ? ` (as of ${shortDate(so.computed_at)}, ${timeOf(so.computed_at)})` : ""}.
        Value = part of the order total not shipped yet, taxes and shipping included. CAD and USD are never added.
      </p>
      <div className="tile-actions"><MoreLink what="the order-tracking app" /></div>
    </>
  );
}

// ---- 6. on-time delivery --------------------------------------------------------------

export function OtdTile({ d }: P) {
  const o = d.otd;
  const [months, setMonths] = usePeriod("md-otd-months", o.default_months ?? 6);
  const periods = o.periods ?? {};
  const per = periods[String(months)] ?? periods[String(o.default_months ?? 6)];
  if (o.source !== "live" || !per) {
    return (
      <div className="tile-wait">
        {o.source === "error"
          ? <><Status tone="critical">ERP unreachable</Status><p className="foot">{o.error}</p></>
          : <><span className="spinner" /><p>Reading shipped packages…</p></>}
      </div>
    );
  }
  const points = per.monthly.filter((m) => m.pct !== null).map((m) => ({ label: monthLabel(m.month), value: m.pct as number }));
  return (
    <>
      <div className="period-row">
        <Hero value={per.pct ?? 0} format={pct} label="of orders shipped on time"
          sub={<>
            <Status tone={(per.pct ?? 0) >= per.target ? "good" : "warning"}>target {per.target}%</Status>
            <span>{dec1(per.on_time)} of {num(per.orders)} orders{per.median_days_late ? ` · median delay ${per.median_days_late} d` : ""}</span>
          </>} />
        <PeriodPicker months={per.months} onChange={setMonths} available={Object.keys(periods)} />
      </div>
      {points.length > 1 && (
        <LineChart key={per.months} height={150} format={(v) => `${Math.round(v)}%`} min={0} max={100} data={points}
          target={per.target} targetLabel="target" />
      )}
      {per.no_date > 0 && (
        <p className="excluded-note">
          <span className="st-ic" aria-hidden>!</span>
          {num(per.no_date)} orders without a promised date: {num(per.no_date_counted)} shipped within {per.lead_days} days counted on time, {num(per.excluded)} left out. Details in "More info".
        </p>
      )}

      <h4 className="sub-h">Delays · {dec1(per.late)} orders</h4>
      <SegmentBar format={(v) => `${dec1(v)} orders`}
        segs={per.late_buckets.map((b, i) => ({ key: b.key, label: b.label, value: b.orders, color: OTD_LATE_TONES[i] }))} />
      {per.late_orders.length > 0 && (
        <div className="late-top">
          <span className="late-top-h">Longest delays</span>
          {per.late_orders.map((r) => (
            <div className="late-row" key={`${r.org}-${r.so}`} title={ZOHO_NOTE}>
              <b>{r.so}</b>
              <span className="ellip">{r.customer}</span>
              <span className="muted small">{r.org.replace("Halden ", "")}</span>
              <span className={`late-pill ${r.days_late > 30 ? "l4" : r.days_late > 15 ? "l3" : r.days_late > 7 ? "l2" : "l1"}`}>{num(r.days_late)} d</span>
            </div>
          ))}
        </div>
      )}

      <h4 className="sub-h">By company</h4>
      <div className="org-otd">
        {per.by_org.map((g) => (
          <div className="org-otd-row" key={g.name}>
            <span className="org-name">{g.name}</span>
            <Meter value={g.pct ?? 0} max={100} tone="series-1" />
            <b className="num">{g.pct === null ? "—" : pct(g.pct)}</b>
            <span className="muted num">{dec1(g.on_time)} / {num(g.orders)}</span>
          </div>
        ))}
      </div>
      <p className="foot">
        Each order counts 1, split by its lines: a line is on time if its package shipped on or before the order's expected ship
        date (3 of 4 lines on time = 0.75). No promised date (expected date = order date): on time if shipped within {per.lead_days} days,
        otherwise left out. {(o.orgs ?? []).join(", ")}; void and intercompany orders excluded. Calendar months, the current one
        included.{o.as_of ? ` Data as of ${shortDate(o.as_of)}, ${timeOf(o.as_of)}.` : ""}
      </p>
    </>
  );
}

// ---- registry ------------------------------------------------------------------------------

export interface TileDef {
  id: string; title: string; subtitle: string; core: boolean; source: "inventory" | "sales_orders" | "purchase_orders" | "suppliers" | "stock" | "otd"; detail?: boolean;
  render: (d: Dashboard, open: (k: string) => void) => ReactNode;
}

export const TILES: TileDef[] = [
  { id: "so", title: "Sales Orders", subtitle: "Customer orders still to ship", core: true, source: "sales_orders", render: (d) => <SalesOrdersTile d={d} /> },
  { id: "inventory", title: "Inventory value", subtitle: "Halden Canada and Halden Industrial, active and dormant", core: true, source: "inventory", detail: true, render: (d) => <InventoryTile d={d} /> },
  { id: "po", title: "Purchase Orders", subtitle: "Drafts and issued, Halden Canada and Halden Industrial", core: true, source: "purchase_orders", render: (d, open) => <PurchaseOrdersTile d={d} onOpen={open} /> },
  { id: "stock", title: "Stock: top 10 products", subtitle: "Best sellers from the plant, 3, 6 or 12 months", core: true, source: "stock", render: (d) => <StockTile d={d} /> },
  { id: "suppliers", title: "Supplier breakdown", subtitle: "Purchases and parts by supplier, 3, 6 or 12 months", core: true, source: "suppliers", render: (d) => <SuppliersTile d={d} /> },
  { id: "otd", title: "On-time shipping", subtitle: "Orders shipped by their expected date", core: true, source: "otd", detail: true, render: (d) => <OtdTile d={d} /> },
];
