// Full-screen detail of "On-time shipping" ("More info"): every late order of the period, with how late and how
// much of it was late. Data: GET /api/otd/late?months=N.
import { useEffect, useMemo, useState } from "react";
import { fetchOtdLate, type OtdLate } from "./api";
import { dec1, num, shortDate, timeOf } from "./format";

const PAGE = 50;
const ZOHO_NOTE = "In the production version, clicking this opens the order directly in Zoho, in a new tab.";
const BUCKET_RANGES: Record<string, [number, number]> = { "1-7": [1, 7], "8-15": [8, 15], "16-30": [16, 30], "30+": [31, Infinity] };
const inBucket = (days: number, key: string) => { const r = BUCKET_RANGES[key]; return !!r && days >= r[0] && days <= r[1]; };
export const LATE_TONES = ["var(--warning)", "var(--serious)", "var(--critical)", "var(--critical-2)"];
type SortKey = "days" | "shipped" | "lines";

export default function OtdDetail({ initialMonths, onClose }: { initialMonths: number; onClose: () => void }) {
  const [months, setMonths] = useState(initialMonths);
  const [data, setData] = useState<OtdLate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [org, setOrg] = useState("all");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "days", desc: true });
  const [shown, setShown] = useState(PAGE);
  const [view, setView] = useState<"late" | "excluded">("late");
  const [bucket, setBucket] = useState<string | null>(null);  // delay card clicked: filters the late list

  useEffect(() => {
    setData(null);
    fetchOtdLate(months).then(setData).catch((e) => setError(String(e.message ?? e)));
  }, [months]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const orgs = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.org))].sort(), [data]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const val = (r: OtdLate["rows"][number]) => ({ days: r.days_late, shipped: Date.parse(r.shipped), lines: r.late_lines }[sort.key]);
    return (data?.rows ?? [])
      .filter((r) => org === "all" || r.org === org)
      .filter((r) => !bucket || inBucket(r.days_late, bucket))
      .filter((r) => !needle || `${r.so} ${r.customer}`.toLowerCase().includes(needle))
      .sort((a, b) => (sort.desc ? val(b) - val(a) : val(a) - val(b)));
  }, [data, q, org, sort, bucket]);

  const head = (key: SortKey, label: string) => (
    <button className={`th-sort ${sort.key === key ? "on" : ""}`} onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}>
      {label}{sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
    </button>
  );

  const excluded = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.excluded_rows ?? [])
      .filter((r) => org === "all" || r.org === org)
      .filter((r) => !needle || `${r.so} ${r.customer}`.toLowerCase().includes(needle));
  }, [data, q, org]);

  const exportExcluded = () => {
    const cols = ["Order", "Customer", "Company", "Order date = expected date", "Limit (+ 7 days)", "Shipped", "Lines", "Result"];
    const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = excluded.map((r) => [r.so, r.customer, r.org, r.date, r.limit, r.shipped, r.lines, r.counted ? "Counted on time" : "Left out"].map(esc).join(","));
    const blob = new Blob(["\ufeff" + [cols.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `orders-without-promised-date-${months}m-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportCsv = () => {
    const cols = ["Order", "Customer", "Company", "Expected", "Shipped", "Days late", "Late lines", "Lines", "Late share %"];
    const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = list.map((r) => [r.so, r.customer, r.org, r.promised, r.shipped, r.days_late, r.late_lines, r.lines,
      String(Math.round(r.share_late * 100))].map(esc).join(","));
    const blob = new Blob(["﻿" + [cols.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `late-orders-${months}m-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const lateTotal = data ? data.late_buckets.reduce((t, b) => t + b.orders, 0) : 0;

  return (
    <div className="full-bg" role="dialog" aria-modal="true" aria-label="On-time shipping, late orders">
      <div className="full">
        <header className="full-h">
          <button className="btn ghost back" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M9 2 4 7l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Back
          </button>
          <div className="full-t">
            <h2>On-time shipping: late orders</h2>
            <p className="muted">{data?.as_of ? `Data as of ${shortDate(data.as_of)}, ${timeOf(data.as_of)} · ` : ""}expected = the order's expected ship date</p>
          </div>
          <div className="seg-ctl" role="tablist" aria-label="Period">
            {[3, 6, 12].map((m) => (
              <button key={m} role="tab" aria-selected={months === m} className={months === m ? "on" : ""} onClick={() => { setMonths(m); setShown(PAGE); }}>{m} months</button>
            ))}
          </div>
        </header>

        {error && <div className="banner">Could not load the details ({error}).</div>}
        {!data && !error && <div className="tile-wait"><span className="spinner" /><p>Loading…</p></div>}
        {data && (
          <>
            {data.no_date > 0 && (
              <div className="note warn-note">
                <span className="note-ic" aria-hidden>!</span>
                <span>
                  <b>{num(data.no_date)} orders have no real promised date</b> in this period: their expected ship date was left equal
                  to the order date, so there is no way to tell whether they shipped on time (in production, one such order showed as
                  "452 days late" although it shipped and was paid). Rule applied:
                  <b> {num(data.no_date_counted)} shipped within {data.lead_days} days of the order count as on time</b>;
                  <b> the other {num(data.excluded)} are left out</b> of the rate (neither on time nor late). For them to count, the
                  promised date has to be entered with the order. They are listed in the "No promised date" tab below.
                </span>
              </div>
            )}
            <section className="full-sec">
              <h3 className="full-sec-h">Delays since {shortDate(data.from)} <span className="muted">: {dec1(data.late)} of {num(data.orders)} orders</span></h3>
              <div className="late-cards">
                {data.late_buckets.map((b, i) => (
                  <button className={`kcard kcard-btn ${bucket === b.key ? "on" : ""} ${bucket && bucket !== b.key ? "dim" : ""}`} key={b.key}
                    aria-pressed={bucket === b.key} title={bucket === b.key ? "Remove the filter" : `Show only orders ${b.label} late`}
                    onClick={() => { setBucket(bucket === b.key ? null : b.key); setView("late"); setShown(PAGE); }}>
                    <span className="kcard-l"><i className="kdot" style={{ background: LATE_TONES[i] }} />{b.label} late</span>
                    <b className="kcard-v">{dec1(b.orders)}</b>
                    <span className="kcard-s">orders · {lateTotal ? Math.round((b.orders / lateTotal) * 100) : 0}% of delays</span>
                  </button>
                ))}
              </div>
              <p className="foot">Click a card to filter the list below (a second click removes the filter). An order partly late counts for its share of late lines (2 of 4 lines = 0.5), by each package's delay; in the list, an order is placed by its latest package.</p>
            </section>

            <section className="full-sec">
              <div className="seg-ctl view-tabs" role="tablist" aria-label="List">
                <button role="tab" aria-selected={view === "late"} className={view === "late" ? "on" : ""} onClick={() => { setView("late"); setShown(PAGE); }}>
                  Late ({num(data.rows.length)})
                </button>
                <button role="tab" aria-selected={view === "excluded"} className={view === "excluded" ? "on" : ""} onClick={() => { setView("excluded"); setShown(PAGE); }}>
                  No promised date ({num(data.no_date)})
                </button>
              </div>
              <div className="dorm-tools">
                <label className="search">
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="m9.2 9.2 3.3 3.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  <input value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder="Search an order or a customer…" aria-label="Search" />
                </label>
                <div className="seg-ctl" role="tablist" aria-label="Company">
                  {["all", ...orgs].map((o) => (
                    <button key={o} role="tab" aria-selected={org === o} className={org === o ? "on" : ""} onClick={() => { setOrg(o); setShown(PAGE); }}>
                      {o === "all" ? "All" : o.replace("Halden ", "")}
                    </button>
                  ))}
                </div>
                <button className="btn sm" onClick={view === "late" ? exportCsv : exportExcluded} disabled={!(view === "late" ? list : excluded).length}>
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M7 1.5v8M3.8 6.5 7 9.7l3.2-3.2M2 12.5h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  Export ({num((view === "late" ? list : excluded).length)})
                </button>
              </div>
              {view === "excluded" ? (
                <>
                  <p className="muted small">{num(excluded.length)} orders whose expected ship date = the order date: on time if shipped by the limit (order + {data.lead_days} days), otherwise left out</p>
                  <div className="table excl-table">
                    <div className="tr th"><span>Order</span><span>Customer</span><span>Company</span><span className="r">Ordered</span><span className="r">Limit</span><span className="r">Shipped</span><span className="r">Result</span></div>
                    {excluded.slice(0, shown).map((r, i) => (
                      <div className="tr row-in" key={`${r.org}-${r.so}`} style={{ animationDelay: `${Math.min(i, 20) * 20}ms` }}>
                        <span className="prod" title={ZOHO_NOTE}><b>{r.so}</b></span>
                        <span className="ellip" title={r.customer}>{r.customer}</span>
                        <span className="muted small">{r.org.replace("Halden ", "")}</span>
                        <span className="r num muted">{shortDate(r.date)} {r.date.slice(2, 4)}</span>
                        <span className="r num muted">{shortDate(r.limit)} {r.limit.slice(2, 4)}</span>
                        <span className="r num">{shortDate(r.shipped)} {r.shipped.slice(2, 4)}</span>
                        <span className="r">{r.counted
                          ? <span className="status st-good"><span className="st-ic">✓</span>Counted on time</span>
                          : <span className="status st-neutral"><span className="st-ic">–</span>Left out</span>}</span>
                      </div>
                    ))}
                    {!excluded.length && <p className="empty">No orders for this filter.</p>}
                  </div>
                  {shown < excluded.length && (
                    <div className="more-rows"><button className="btn sm" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, excluded.length - shown)} more</button></div>
                  )}
                </>
              ) : (<>
              <p className="muted small">
                {num(list.length)} late orders
                {bucket && <> · filter: {data.late_buckets.find((b) => b.key === bucket)?.label} late <button className="link-btn" onClick={() => setBucket(null)}>remove</button></>}
              </p>
              <div className="table late-table">
                <div className="tr th">
                  <span>Order</span><span>Customer</span><span>Company</span><span className="r">Expected</span>
                  <span className="r">{head("shipped", "Shipped")}</span><span className="r">{head("days", "Delay")}</span>
                  <span className="r">{head("lines", "Late lines")}</span>
                </div>
                {list.slice(0, shown).map((r, i) => (
                  <div className="tr row-in" key={`${r.org}-${r.so}`} style={{ animationDelay: `${Math.min(i, 20) * 20}ms` }}>
                    <span className="prod" title={ZOHO_NOTE}><b>{r.so}</b></span>
                    <span className="ellip" title={r.customer}>{r.customer}</span>
                    <span className="muted small">{r.org.replace("Halden ", "")}</span>
                    <span className="r num muted">{shortDate(r.promised)} {r.promised.slice(2, 4)}</span>
                    <span className="r num">{shortDate(r.shipped)} {r.shipped.slice(2, 4)}</span>
                    <span className="r"><span className={`late-pill ${r.days_late > 30 ? "l4" : r.days_late > 15 ? "l3" : r.days_late > 7 ? "l2" : "l1"}`}>{num(r.days_late)} d</span></span>
                    <span className="r num">{num(r.late_lines)} / {num(r.lines)}</span>
                  </div>
                ))}
                {!list.length && <p className="empty">No late orders for this filter.</p>}
              </div>
              {shown < list.length && (
                <div className="more-rows"><button className="btn sm" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more</button></div>
              )}
              </>)}
              <p className="foot">Delay = ship date of the latest package − the order's expected ship date. Shipped = last package in the period.</p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
