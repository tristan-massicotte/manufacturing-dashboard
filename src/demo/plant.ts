// The Halden Canada plant, simulated week by week: products are sold (shipped to customers and to the two sister
// companies), assembled to replace what was sold, and assembling consumes parts that suppliers deliver. Every unit
// goes through FIFO lots, like an ERP's "FIFO cost lot tracking" report: a lot is a supplier receipt (bill) or an
// assembly (bundle), and lists where its units went (bundle = used in an assembly, invoice = shipped).
// Inventory value and age, purchases by supplier, parts used and units shipped all come from these lots, so they
// stay consistent with each other. Volumes are sized to the Sales Dashboard demo's yearly sales.

import { addDays, toDay, toIso } from "./dates";
import { Catalog, catalog, Part, Product, supplierCurrency, supplierFactor, supplierTax, USD_CAD, YEARLY_SALES } from "./catalog";
import { Rng } from "./random";

export type Txn = { transaction_type: "bundle" | "invoice"; date: string; quantity_out: number };
export type Lot = {
  id: string; item_id: string; item_name: string; sku: string; date: string;
  transaction_type: "bill" | "bundle" | "inventory_adjustment_by_quantity";
  contact_name: string; quantity_in: number; cost_price_per_unit: number; total: number; transactions: Txn[];
};

/** A purchase order line: what was ordered, what is still to receive, and when it was promised. */
export type PoLine = { amount: number; ordered: number; remaining: number; date: string | null };
export type Po = { number: string; org: string; supplier: string; currency: string; date: string; status: "draft" | "issued" | "closed";
  total: number; lines: PoLine[] };

export type Plant = { today: string; cat: Catalog; lots: Lot[]; pos: Po[]; weeklySold: Map<string, number[]>; weeks: string[] };

const MONTHS_OF_HISTORY = 15; // the 12-month windows plus room for FIFO
const SEASON = [0.8, 0.92, 1.08, 1.1, 1.12, 1.04, 0.84, 0.9, 1.08, 1.14, 1.1, 0.86];
const LEAD_DAYS = [10, 35]; // supplier lead time, order to receipt

/** What the plant ships in a year, in CAD at selling price: the three companies' sales. */
const YEARLY_CAD = YEARLY_SALES.CAN + YEARLY_SALES.IND + YEARLY_SALES.INC * USD_CAD;

export function simulate(today: string): Plant {
  const cat = catalog();
  const first = toIso(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - MONTHS_OF_HISTORY, 1) / 86400000);
  const weeks: string[] = [];
  for (let d = toDay(first); toIso(d) <= today; d += 7) weeks.push(toIso(d));
  const future: string[] = [];
  for (let i = 1; i <= 8; i++) future.push(addDays(weeks[weeks.length - 1], 7 * i));

  // Units sold per product per week: share of sales by popularity, seasonality, slow growth, noise.
  const weeklySold = new Map<string, number[]>();
  const discontinued = new Set(cat.products.filter((_, i) => i % 13 === 7).map((p) => p.id)); // 3 products no longer sold
  const totalWeight = cat.products.reduce((s, p) => s + (discontinued.has(p.id) ? 0 : p.weight), 0);
  const unitsAt = (p: Product, week: string, r: Rng) => {
    if (discontinued.has(p.id)) return 0;
    const month = Number(week.slice(5, 7)) - 1;
    const growth = 1 + 0.1 * ((toDay(week) - toDay(today)) / 365 + 0.5); // 10%/yr; the last 12 months average 1
    const cad = (YEARLY_CAD / 52) * (p.weight / totalWeight) * SEASON[month] * growth * r.between(0.75, 1.25);
    const units = cad / p.price;
    return Math.floor(units) + (r.chance(units % 1) ? 1 : 0);
  };
  for (const p of cat.products) {
    const r = new Rng("sold", p.id, first);
    weeklySold.set(p.id, [...weeks, ...future].map((w) => unitsAt(p, w, r)));
  }

  // Assembly: each week rebuilds what was sold, steering the stock toward a target cover (months of sales).
  const medianWeight = [...cat.products.map((p) => p.weight)].sort((a, b) => a - b)[Math.floor(cat.products.length / 2)];
  const lots: Lot[] = [];
  const outs = new Map<string, { date: string; qty: number; type: Txn["transaction_type"] }[]>();
  const out = (item: string, date: string, qty: number, type: Txn["transaction_type"]) => {
    if (qty > 0) outs.set(item, [...(outs.get(item) ?? []), { date, qty, type }]);
  };
  const usage = new Map<string, number[]>(); // part → units used per week (past and planned)
  const all = [...weeks, ...future];
  for (const p of cat.products) {
    const r = new Rng("build", p.id);
    const sold = weeklySold.get(p.id)!;
    const avgMonthly = (sold.slice(-30).reduce((s, x) => s + x, 0) / 30) * 4.33;
    // Target cover: most products 0.5–2 months, a few run short (critical), a few are overstocked.
    // Slow sellers are built closer to order: they keep a fraction of the cover.
    const slowSeller = p.weight < medianWeight;
    const cover = (slowSeller ? 0.2 : 1) * (discontinued.has(p.id) ? 0 : r.weighted([[r.between(0.3, 0.75), 2], [r.between(0.75, 1.35), 4], [r.between(1.35, 2.2), 3], [r.between(4, 5), 1]] as const));
    let stock = Math.round(avgMonthly * cover) + (discontinued.has(p.id) ? Math.round(r.between(50000, 140000) / p.cost) : 0);
    // Opening stock: assembled before the window (older for slow movers).
    lots.push(lotOf(p, "bundle", "", addDays(first, -r.int(discontinued.has(p.id) ? 760 : 20, discontinued.has(p.id) ? 1000 : 160)), stock, p.cost));
    all.forEach((w, i) => {
      const target = Math.round(avgMonthly * cover);
      const built = Math.max(0, Math.round(sold[i] * r.between(0.85, 1.15) + (target - stock) * 0.25));
      for (const b of p.bom) {
        const u = usage.get(b.part) ?? new Array(all.length).fill(0);
        u[i] += built * b.qty;
        usage.set(b.part, u);
      }
      if (i >= weeks.length) return; // planned weeks: only the parts plan matters
      stock += built - sold[i];
      if (built > 0) lots.push(lotOf(p, "bundle", "", addDays(w, 2), built, Math.round(p.cost * r.between(0.97, 1.03) * 100) / 100));
      out(p.id, addDays(w, r.int(1, 4)), sold[i], "invoice");
    });
  }
  // Sub-assemblies are made in-house from the same plan; they don't consume tracked parts here.

  // Parts: received from suppliers ahead of use, two weeks at a time; used in assemblies each week.
  const pos: Po[] = [];
  const pending: { supplier: string; poDate: string; date: string; part: Part; qty: number; cost: number; late: boolean; partial: number }[] = [];
  for (const part of cat.parts) {
    const r = new Rng("part", part.id);
    const u = usage.get(part.id) ?? new Array(all.length).fill(0);
    const monthly = (u.slice(weeks.length - 26, weeks.length).reduce((s, x) => s + x, 0) / 26) * 4.33;
    if (part.obsolete || monthly === 0) {
      // No longer used: what is left was bought before the part was dropped or replaced by a new revision.
      if (part.obsolete && !part.inHouse) {
        const qty = Math.round(r.logNormal(part.supersededDays ? 22000 : 14000, 0.7) / part.cost) + 1;
        const date = part.supersededDays ? addDays(today, -part.supersededDays) : addDays(first, -r.int(760, 1400));
        lots.push(lotOf(part, "bill", part.sources[0].supplier, date, qty, part.cost));
      }
      continue;
    }
    const cover = r.logNormal(1.0, 0.45); // months of use on hand at the start
    const opening = Math.round(monthly * cover);
    const source = (rr: Rng) => rr.weighted(part.sources.map((s) => [s.supplier, s.share] as const));
    lots.push(lotOf(part, part.inHouse ? "bundle" : "bill", part.inHouse ? "" : part.sources[0].supplier,
      addDays(first, -r.int(20, 120)), opening, part.cost));
    // Now and then a bulk buy (price break): months of use received at once, then used up slowly.
    const bulkAt = r.chance(0.18) ? weeks.length - r.int(26, 50) : -1;
    let bulked = false;
    // Reorder rule: every two weeks, if the stock won't cover the next four weeks, order up to that plus a margin.
    let projected = opening;
    for (let i = 0; i < all.length; i += 2) {
      const need = (u[i] ?? 0) + (u[i + 1] ?? 0);
      const ahead = need + (u[i + 2] ?? 0) + (u[i + 3] ?? 0);
      const bulk: boolean = bulkAt >= 0 && i >= bulkAt && !bulked;
      if (projected >= ahead && !bulk) {
        projected -= need;
        continue;
      }
      bulked ||= bulk;
      const qty = Math.max(1, Math.round((Math.max(0, ahead - projected) + need * 0.15) * r.between(0.85, 1.15) + (bulk ? monthly * r.between(4, 9) : 0)));
      projected += qty - need;
      const date = addDays(all[i], -r.int(1, 6));
      if (part.inHouse) {
        if (date <= today) lots.push(lotOf(part, "bundle", "", date, qty, part.cost));
        continue;
      }
      const supplier = source(r);
      const cost = Math.round(part.cost * supplierFactor(supplier) * r.between(0.94, 1.06) * 100) / 100;
      const poDate = addDays(date, -r.int(LEAD_DAYS[0], LEAD_DAYS[1]));
      // Recent receipts sometimes haven't arrived yet (late) or came in part (partial): those stay on open POs.
      const recent = date <= today && toDay(today) - toDay(date) <= 21;
      const late = recent && r.chance(0.12);
      const partial = recent && !late && r.chance(0.1) ? r.between(0.3, 0.8) : 1;
      if (date <= today && !late) lots.push(lotOf(part, "bill", supplier, date, Math.round(qty * partial), cost));
      if (poDate <= today) pending.push({ supplier, poDate, date, part, qty, cost, late, partial });
    }
    // Cycle counts now and then find a few extra units.
    if (r.chance(0.1)) lots.push(lotOf(part, "inventory_adjustment_by_quantity", "", addDays(today, -r.int(10, 300)), r.int(1, 20), part.cost));
    u.slice(0, weeks.length).forEach((q, i) => out(part.id, addDays(weeks[i], r.int(0, 4)), q, "bundle"));
  }

  // FIFO: each out takes units from the oldest lots received by then.
  const byItem = new Map<string, Lot[]>();
  for (const l of lots) byItem.set(l.item_id, [...(byItem.get(l.item_id) ?? []), l]);
  for (const [item, list] of byItem) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const left = list.map((l) => l.quantity_in);
    for (const o of (outs.get(item) ?? []).filter((o) => o.date <= today).sort((a, b) => a.date.localeCompare(b.date))) {
      let need = o.qty;
      for (let i = 0; i < list.length && need > 0; i++) {
        if (list[i].date > o.date || left[i] <= 0) continue;
        const take = Math.min(left[i], need);
        left[i] -= take;
        need -= take;
        list[i].transactions.push({ transaction_type: o.type, date: o.date, quantity_out: take });
      }
      // Not enough received yet: the shortfall is simply not shipped/used in the demo.
    }
  }

  // Purchase orders: receipts grouped by supplier and order date. Closed once received; open while anything is due.
  const rng2 = new Rng("pos", today);
  const groups = new Map<string, typeof pending>();
  for (const x of pending) {
    const key = `${x.supplier}|${x.poDate.slice(0, 8)}${Number(x.poDate.slice(8)) < 15 ? "a" : "b"}`;
    groups.set(key, [...(groups.get(key) ?? []), x]);
  }
  let seq = 4200;
  const sorted = [...groups.values()].sort((a, b) => a[0].poDate.localeCompare(b[0].poDate));
  for (const g of sorted) {
    const supplier = g[0].supplier;
    const cur = supplierCurrency(supplier);
    const rate = cur === "USD" ? 1 / USD_CAD : 1;
    const lines: PoLine[] = g.map((x) => {
      const received = x.date <= today && !x.late ? Math.round(x.qty * x.partial) : 0;
      return { amount: round(x.qty * x.cost * rate), ordered: x.qty, remaining: x.qty - received, date: x.date };
    });
    const goods = lines.reduce((s, l) => s + l.amount, 0);
    const open = lines.some((l) => l.remaining > 0);
    pos.push({ number: `PO-${++seq}`, org: "Halden Canada", supplier, currency: cur, date: g.reduce((m, x) => (x.poDate < m ? x.poDate : m), g[0].poDate),
      status: open ? "issued" : "closed", total: round(goods * (1 + supplierTax(supplier) / 100)), lines });
  }
  // Drafts: orders being prepared for the weeks after the plan.
  for (let i = 0; i < rng2.int(8, 14); i++) {
    const supplier = rng2.pick(["Precision Sheet Metal Co.", "Northline Machining", "Lakeview Aluminum", "Atlas Fasteners & Supply", "Rivermark Electronics", "Lakeside Plastics"]);
    const cur = supplierCurrency(supplier);
    const goods = rng2.logNormal(cur === "USD" ? 22000 : 38000, 0.6);
    pos.push({ number: `PO-${++seq}`, org: "Halden Canada", supplier, currency: cur, date: addDays(today, -rng2.int(0, 9)), status: "draft",
      total: round(goods * (1 + supplierTax(supplier) / 100)), lines: [] });
  }
  pos.push(...industrialPos(today));
  return { today, cat, lots, pos, weeklySold, weeks };
}

function lotOf(item: Part | Product, kind: Lot["transaction_type"], supplier: string, date: string, qty: number, cost: number): Lot {
  const isProduct = "code" in item;
  return {
    id: `${item.id}-${date}-${kind}-${qty}`, item_id: item.id, item_name: isProduct ? item.code : item.name, sku: item.sku, date,
    transaction_type: kind, contact_name: supplier, quantity_in: qty, cost_price_per_unit: cost, total: round(qty * cost), transactions: [],
  };
}

/** Halden Industrial buys its own resale items and service parts from distributors. */
function industrialPos(today: string): Po[] {
  const out: Po[] = [];
  const first = toDay(today) - 400;
  let seq = 880;
  for (let d = first; toIso(d) <= today; d += 1) {
    const date = toIso(d);
    const r = new Rng("ind-po", date);
    if (!r.chance(0.55) || [0, 6].includes(new Date(d * 86400000).getUTCDay())) continue;
    const supplier = r.weighted([["Atlas Fasteners & Supply", 4], ["Industrial Hardware Direct", 3], ["Mapleton Wire & Cable", 2], ["Rivermark Electronics", 2]] as const);
    const cur = supplierCurrency(supplier);
    const goods = r.logNormal(cur === "USD" ? 6500 : 9000, 0.7);
    const due = addDays(date, r.int(10, 30));
    const age = toDay(today) - d;
    const remaining = age < 45 ? (due > today ? 1 : r.chance(0.35) ? r.between(0.3, 1) : 0) : 0;
    out.push({ number: `PO-I-${++seq}`, org: "Halden Industrial", supplier, currency: cur, date, status: remaining > 0 ? "issued" : "closed",
      total: round(goods * (1 + supplierTax(supplier) / 100)),
      lines: [{ amount: round(goods), ordered: 10, remaining: Math.round(10 * remaining), date: due }] });
  }
  for (let i = 0; i < 3; i++) {
    out.push({ number: `PO-I-${++seq}`, org: "Halden Industrial", supplier: "Atlas Fasteners & Supply", currency: "CAD",
      date: addDays(today, -i), status: "draft", total: round(4000 + i * 2700), lines: [] });
  }
  return out;
}

export const round = (v: number) => Math.round(v * 100) / 100;

