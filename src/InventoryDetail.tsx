// Full-screen detail of the inventory tile ("More info"): assembled products vs parts on hand, and the list of
// dormant items (aging bucket "> 24 months"). Data: GET /api/inventory/detail.
import { useEffect, useMemo, useState } from "react";
import { fetchInventoryDetail, type InvItem, type InventoryDetail as Detail } from "./api";
import { AnimatedNumber, useMounted } from "./charts";
import { money, moneyFull, moneyHero, num, shortDate, timeOf } from "./format";

export const AGE_TONES = ["var(--seq-500)", "var(--series-1)", "var(--seq-300)", "var(--seq-200)", "var(--gray-mark)"];
const PAGE = 50;

/** Why the figures can differ from an item's "cost price" in the ERP. */
export function FifoNote() {
  return (
    <p className="note">
      <span className="note-ic" aria-hidden>i</span>
      <span>
        Values at FIFO cost, the inventory's book value. They can differ from the "cost price" on an item's record: FIFO uses
        the real cost of each supplier bill or assembly, while the cost price is typed in by hand.
      </span>
    </p>
  );
}

type Row = InvItem & { org: string; orgShort: string; url: string; total: number; dormant: number; dormantQty: number; stockQty: number };
type SortKey = "dormant" | "qty" | "total";

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const qtyFmt = (v: number) => num(Math.round(v * 100) / 100);

export default function InventoryDetail({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [org, setOrg] = useState("all");

  useEffect(() => {
    fetchInventoryDetail().then(setData).catch((e) => setError(String(e.message ?? e)));
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    return data.orgs.filter((o) => org === "all" || o.id === org).flatMap((o) => o.items.map((it) => ({
      ...it, org: o.name, orgShort: o.short, url: o.item_url.replace("{id}", it.id),
      total: sum(it.buckets), dormant: it.buckets[it.buckets.length - 1] ?? 0,
      dormantQty: it.qty[it.qty.length - 1] ?? 0, stockQty: sum(it.qty),
    })));
  }, [data, org]);

  return (
    <div className="full-bg" role="dialog" aria-modal="true" aria-label="Inventory value, details">
      <div className="full">
        <header className="full-h">
          <button className="btn ghost back" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M9 2 4 7l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Back
          </button>
          <div className="full-t">
            <h2>Inventory value: details</h2>
            <p className="muted">{data?.as_of ? `Data as of ${shortDate(data.as_of)}, ${timeOf(data.as_of)} · refreshed every weekday at 7:00 in production` : ""}</p>
          </div>
          {data && (
            <div className="seg-ctl" role="tablist" aria-label="Company">
              {[{ id: "all", name: "Both" }, ...data.orgs].map((o) => (
                <button key={o.id} role="tab" aria-selected={org === o.id} className={org === o.id ? "on" : ""} onClick={() => setOrg(o.id)}>{o.name}</button>
              ))}
            </div>
          )}
        </header>

        {error && <div className="banner">Could not load the details ({error}).</div>}
        {!data && !error && <div className="tile-wait"><span className="spinner" /><p>Loading the details…</p></div>}
        {data && data.source !== "live" && <div className="tile-wait"><span className="spinner" /><p>Reading items…</p></div>}
        {data && data.source === "live" && (
          <>
            <FifoNote />
            <Split rows={rows} labels={data.buckets.map((b) => b.label)} dormantMonths={data.dormant_months} />
            <DormantTable key={org} rows={rows} showOrg={org === "all"} dormantMonths={data.dormant_months} />
          </>
        )}
      </div>
    </div>
  );
}

// ---- 1. assembled products vs parts on hand ------------------------------------------------------

function Split({ rows, labels, dormantMonths }: { rows: Row[]; labels: string[]; dormantMonths: number }) {
  const mounted = useMounted(150);
  const groups = [
    { key: "asm", title: "Assembled products", note: "assembled items in stock", list: rows.filter((r) => r.assembled) },
    { key: "prt", title: "Parts in stock", note: "bought parts and components", list: rows.filter((r) => !r.assembled) },
  ].map((g) => ({
    ...g,
    total: sum(g.list.map((r) => r.total)),
    dormant: sum(g.list.map((r) => r.dormant)),
    buckets: labels.map((_, i) => sum(g.list.map((r) => r.buckets[i] ?? 0))),
  }));
  const total = groups[0].total + groups[1].total;
  const widest = Math.max(groups[0].total, groups[1].total) || 1;

  return (
    <section className="full-sec">
      <h3 className="full-sec-h">Assembled products and parts</h3>
      <div className="split-cards">
        <div className="kcard">
          <span className="kcard-l">Total inventory</span>
          <b className="kcard-v"><AnimatedNumber value={total} format={moneyHero} /></b>
          <span className="kcard-s">{num(rows.length)} items with a value</span>
        </div>
        {groups.map((g, gi) => (
          <div className="kcard" key={g.key}>
            <span className="kcard-l"><i className={`kdot ${gi ? "kdot-prt" : "kdot-asm"}`} />{g.title}</span>
            <b className="kcard-v"><AnimatedNumber value={g.total} format={moneyHero} /></b>
            <span className="kcard-s">{total ? Math.round((g.total / total) * 100) : 0}% of inventory · {num(g.list.length)} {g.note}</span>
            <span className="kcard-d"><span className="gray-dot" />{money(g.dormant)} dormant ({g.total ? Math.round((g.dormant / g.total) * 100) : 0}%)</span>
          </div>
        ))}
      </div>

      <div className="age-rows">
        {groups.map((g) => (
          <div className="age-row" key={g.key}>
            <span className="age-name">{g.title}</span>
            <div className="age-track">
              <div className="segbar age-bar" style={{ width: mounted ? `${(g.total / widest) * 100}%` : "0%" }}>
                {g.buckets.map((v, i) => v > 0 && (
                  <div key={i} className="seg" style={{ flexGrow: v, background: AGE_TONES[i] ?? "var(--gray-mark)" }}
                    title={`${labels[i]}: ${moneyFull(v)} (${Math.round((v / g.total) * 100)}%)`} />
                ))}
              </div>
            </div>
            <b className="age-v">{money(g.total)}</b>
          </div>
        ))}
        <div className="legend age-legend">
          {labels.map((l, i) => <span className="lg" key={l}><i style={{ background: AGE_TONES[i] ?? "var(--gray-mark)" }} />{l}</span>)}
        </div>
      </div>
      <p className="foot">
        Age = time since receipt (FIFO, transfers don't reset it). An assembly enters stock on its own date: a product assembled
        recently looks young even if its parts were old. Dormant = in stock for over {dormantMonths} months.
      </p>
    </section>
  );
}

// ---- 2. dormant items -------------------------------------------------------------------------------

function DormantTable({ rows, showOrg, dormantMonths }: { rows: Row[]; showOrg: boolean; dormantMonths: number }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState<"all" | "asm" | "prt">("all");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "dormant", desc: true });
  const [shown, setShown] = useState(PAGE);

  const dormantAll = useMemo(() => rows.filter((r) => r.dormant > 0), [rows]);
  const dormantTotal = sum(dormantAll.map((r) => r.dormant));
  const top20 = sum([...dormantAll].sort((a, b) => b.dormant - a.dormant).slice(0, 20).map((r) => r.dormant));

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const val = (r: Row) => ({ dormant: r.dormant, qty: r.dormantQty, total: r.total }[sort.key]);
    return dormantAll
      .filter((r) => type === "all" || (type === "asm") === r.assembled)
      .filter((r) => !needle || `${r.sku} ${r.name} ${r.description} ${r.vendor} ${r.category}`.toLowerCase().includes(needle))
      .sort((a, b) => (sort.desc ? val(b) - val(a) : val(a) - val(b)));
  }, [dormantAll, q, type, sort]);
  const listValue = sum(list.map((r) => r.dormant));

  const head = (key: SortKey, label: string) => (
    <button className={`th-sort ${sort.key === key ? "on" : ""}`} onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }))}>
      {label}{sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
    </button>
  );

  const exportCsv = () => {
    const cols = ["SKU", "Name", "Description", "Type", "Company", "Supplier", "Category",
      "Dormant qty", "Qty in stock", "Dormant value", "Total value", "Dormant share %"];
    const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const dec = (v: number) => v.toFixed(2);
    const lines = list.map((r) => [r.sku, r.name, r.description, r.assembled ? "Assembled product" : "Part", r.org, r.vendor, r.category,
      dec(r.dormantQty), dec(r.stockQty), dec(r.dormant), dec(r.total), dec(r.total ? (r.dormant / r.total) * 100 : 0)].map(esc).join(","));
    const blob = new Blob(["﻿" + [cols.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `dormant-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section className="full-sec">
      <h3 className="full-sec-h">Dormant items <span className="muted">: in stock for over {dormantMonths} months</span></h3>
      <div className="dorm-sum">
        <div><b><AnimatedNumber value={dormantTotal} format={moneyHero} /></b><span>dormant value</span></div>
        <div><b>{num(dormantAll.length)}</b><span>items affected</span></div>
        <div><b>{dormantTotal ? Math.round((top20 / dormantTotal) * 100) : 0}%</b><span>of the dormant value in the top 20 items</span></div>
      </div>

      <div className="dorm-tools">
        <label className="search">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="m9.2 9.2 3.3 3.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          <input value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder="Search a SKU or description…" aria-label="Search" />
        </label>
        <div className="seg-ctl" role="tablist" aria-label="Item type">
          {([["all", "All"], ["asm", "Assembled"], ["prt", "Parts"]] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={type === k} className={type === k ? "on" : ""} onClick={() => { setType(k); setShown(PAGE); }}>{l}</button>
          ))}
        </div>
        <button className="btn sm" onClick={exportCsv} disabled={!list.length}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M7 1.5v8M3.8 6.5 7 9.7l3.2-3.2M2 12.5h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Export ({num(list.length)})
        </button>
      </div>
      <p className="muted small">{num(list.length)} items · {moneyFull(listValue)} dormant</p>

      <div className={`table dorm-table ${showOrg ? "with-org" : ""}`}>
        <div className="tr th">
          <span>Item</span><span>Type</span>{showOrg && <span>Co.</span>}
          <span className="r">{head("qty", "Dormant qty")}</span>
          <span className="r">{head("dormant", "Dormant value")}</span>
          <span />
        </div>
        {list.slice(0, shown).map((r, i) => {
          // Primary line: SKU (or the name when the item has no SKU); second line: what the item is, without repeating it.
          const main = r.sku || r.name;
          const sub = [r.description, r.name].find((t) => t && !t.startsWith(main) && !main.startsWith(t)) ?? "";
          return (
            <div className="tr row-in" key={`${r.org}-${r.id}`} style={{ animationDelay: `${Math.min(i, 20) * 20}ms` }}>
              <span className="prod"><b title={main}>{main}</b>{sub && <small title={sub}>{sub}</small>}</span>
              <span><span className={`type-pill ${r.assembled ? "asm" : "prt"}`}>{r.assembled ? "Assembled" : "Part"}</span></span>
              {showOrg && <span className="muted">{r.orgShort}</span>}
              <span className="r num">{qtyFmt(r.dormantQty)}<small className="muted"> / {qtyFmt(r.stockQty)}</small></span>
              <span className="r num"><b>{moneyFull(r.dormant)}</b></span>
              <span className="zlink" title="In the production version, this opens the item directly in Zoho, in a new tab." aria-hidden>
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M4 2h6v6M10 2 3 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              </span>
            </div>
          );
        })}
        {!list.length && <p className="empty">No dormant items for this filter.</p>}
      </div>
      {shown < list.length && (
        <div className="more-rows"><button className="btn sm" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more</button></div>
      )}
      <p className="foot">Dormant qty / qty in stock: units that entered stock over {dormantMonths} months ago, out of the total in stock (every location). Export: CSV for Excel.</p>
    </section>
  );
}
