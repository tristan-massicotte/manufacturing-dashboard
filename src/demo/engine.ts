// The tile calculations, ported from the production app's Python modules (one function per tile). Pure: data in,
// tile figures out. In production the inputs come from the ERP's reports; here they come from the simulation.

import { addDays, toDay } from "./dates";
import type { Lot, Po, PoLine } from "./plant";
import type { OpenSo, ShipEvent } from "./orders";

const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const r1 = (v: number) => Math.round((v + Number.EPSILON) * 10) / 10;

/** First day of each of the last n months, oldest first, current month last. */
export function monthStarts(today: string, n: number): string[] {
  const out: string[] = [];
  let y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}-01`);
    if (m === 1) { y--; m = 12; } else m--;
  }
  return out.reverse();
}

/** Same day n months back (day capped at 28): start of a rolling window. */
export function windowStart(today: string, months: number): string {
  let y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)) - months;
  while (m <= 0) { y--; m += 12; }
  return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(Number(today.slice(8, 10)), 28)).padStart(2, "0")}`;
}

// ---- inventory value and age (ERP "Inventory Aging Summary": FIFO cost, by time in stock) ---------------------

export const AGING_MONTHS = 6;
export const DORMANT_MONTHS = 24;

export function bucketLabels() {
  const n = DORMANT_MONTHS / AGING_MONTHS;
  const out = Array.from({ length: n }, (_, i) => ({
    key: `${i * AGING_MONTHS}-${(i + 1) * AGING_MONTHS}`,
    label: i ? `${i * AGING_MONTHS + 1}–${(i + 1) * AGING_MONTHS} months` : `< ${AGING_MONTHS} months`,
  }));
  out.push({ key: `${DORMANT_MONTHS}+`, label: `> ${DORMANT_MONTHS} months (dormant)` });
  return out;
}

const ageBucket = (lotDate: string, asOf: string) => {
  const months = (toDay(asOf) - toDay(lotDate)) / 30.44;
  return Math.min(DORMANT_MONTHS / AGING_MONTHS, Math.floor(months / AGING_MONTHS));
};

/** Value and quantity per age bucket of every item still in stock on `asOf`, from its FIFO lots. */
export function agingByItem(lots: Lot[], asOf: string): Map<string, { values: number[]; qty: number[] }> {
  const n = DORMANT_MONTHS / AGING_MONTHS + 1;
  const out = new Map<string, { values: number[]; qty: number[] }>();
  for (const lot of lots) {
    if (lot.date > asOf) continue;
    const used = lot.transactions.reduce((s, t) => (t.date <= asOf ? s + t.quantity_out : s), 0);
    const left = lot.quantity_in - used;
    if (left <= 0) continue;
    const row = out.get(lot.item_id) ?? { values: new Array(n).fill(0), qty: new Array(n).fill(0) };
    const b = ageBucket(lot.date, asOf);
    row.values[b] += left * lot.cost_price_per_unit;
    row.qty[b] += left;
    out.set(lot.item_id, row);
  }
  return out;
}

export function bucketTotals(items: Iterable<{ values: number[] }>): number[] {
  const t = new Array(DORMANT_MONTHS / AGING_MONTHS + 1).fill(0);
  for (const it of items) it.values.forEach((v, i) => (t[i] += v));
  return t.map(r2);
}

/** Inventory turns on sales: sales over the last 12 months ÷ average inventory value over those months (the 11
 * month-ends and today); days on hand = 365 ÷ turns. (Turns on cost of goods sold would be lower by the margin.) */
export function turnover(sales12m: number, values: number[]) {
  const avg = values.reduce((s, v) => s + v, 0) / (values.length || 1);
  const turns = avg ? sales12m / avg : 0;
  return { sales: r2(sales12m), avg_value: r2(avg), turns: r1(turns), days: turns ? Math.round(365 / turns) : null };
}

/** Value at selling price of the products shipped between two dates. */
export function salesShipped(lots: Lot[], price: Map<string, number>, from: string, to: string): number {
  let sales = 0;
  for (const lot of lots) for (const t of lot.transactions) {
    if (t.transaction_type === "invoice" && t.date > from && t.date <= to) sales += t.quantity_out * (price.get(lot.item_id) ?? 0);
  }
  return sales;
}

/** The last n month-ends before today, oldest first. */
export function monthEnds(today: string, n: number): string[] {
  const out: string[] = [];
  let d = addDays(`${today.slice(0, 7)}-01`, -1);
  for (let i = 0; i < n; i++) {
    out.push(d);
    d = addDays(`${d.slice(0, 7)}-01`, -1);
  }
  return out.reverse();
}

// ---- sales orders (open orders, by how late their planned shipment is) ---------------------------------------

const SO_LATE_BUCKETS: [string, string, number | null, number | null][] = [
  ["ontime", "On time", null, 0], ["1-15", "Late 1–15 d", 1, 15], ["16-30", "Late 16–30 d", 16, 30], ["30+", "Late > 30 d", 31, null],
];

export function salesOrders(sos: OpenSo[], today: string) {
  const late = (s: OpenSo) => (s.shipment_date ? toDay(today) - toDay(s.shipment_date.slice(0, 10)) : 0);
  const currencies = [...new Set(sos.map((s) => s.currency))].sort((a, b) => (a === "CAD" ? -1 : b === "CAD" ? 1 : a.localeCompare(b)));
  const out = currencies.map((cur) => {
    const mine = sos.filter((s) => s.currency === cur);
    const buckets = SO_LATE_BUCKETS.map(([key, label, lo, hi]) => {
      const sel = mine.filter((s) => (lo === null || late(s) >= lo) && (hi === null || late(s) <= hi));
      return { key, label, count: sel.length, value: r2(sel.reduce((t, s) => t + s.remaining, 0)) };
    });
    const lateOnes = mine.filter((s) => late(s) > 0);
    const orgs = new Map<string, { name: string; count: number; remaining: number }>();
    for (const s of mine) {
      const o = orgs.get(s.org_name) ?? { name: s.org_name, count: 0, remaining: 0 };
      o.count++;
      o.remaining = r2(o.remaining + s.remaining);
      orgs.set(s.org_name, o);
    }
    return {
      currency: cur, count: mine.length, remaining: r2(mine.reduce((t, s) => t + s.remaining, 0)),
      total: r2(mine.reduce((t, s) => t + s.total, 0)), partial_count: mine.filter((s) => s.shipped_status === "partially_shipped").length,
      late_count: lateOnes.length, late_value: r2(lateOnes.reduce((t, s) => t + s.remaining, 0)), buckets,
      orgs: [...orgs.values()].sort((a, b) => b.remaining - a.remaining),
    };
  });
  return {
    count: sos.length, partial_count: out.reduce((t, c) => t + c.partial_count, 0), late_count: out.reduce((t, c) => t + c.late_count, 0),
    unchecked_count: 0, currencies: out,
  };
}

// ---- purchase orders (drafts; issued = value still to receive; monthly totals) --------------------------------

/** Value still to receive on one open PO, and the late part of it (taxes follow the goods). */
export function openValue(total: number, lines: PoLine[], today: string) {
  const goods = lines.filter((l) => l.amount > 0 && l.ordered > 0);
  const base = goods.reduce((s, l) => s + l.amount, 0);
  if (!base) return { remaining: total, late: 0, undated: false };
  const share = goods.reduce((s, l) => s + (l.amount * l.remaining) / l.ordered, 0) / base;
  const lateShare = goods.filter((l) => l.remaining > 0 && l.date && l.date < today).reduce((s, l) => s + (l.amount * l.remaining) / l.ordered, 0) / base;
  return { remaining: r2(total * share), late: r2(total * lateShare), undated: goods.some((l) => l.remaining > 0 && !l.date) };
}

export function purchaseOrders(pos: Po[], today: string) {
  const keys = monthStarts(today, 12).map((d) => d.slice(0, 7));
  const cur = new Map<string, {
    currency: string; draft: { count: number; value: number }; issued: { count: number; value: number };
    late: { count: number; value: number }; undated_count: number; monthly: Map<string, { value: number; count: number }>;
  }>();
  const block = (c: string) => {
    if (!cur.has(c)) cur.set(c, { currency: c, draft: { count: 0, value: 0 }, issued: { count: 0, value: 0 }, late: { count: 0, value: 0 },
      undated_count: 0, monthly: new Map(keys.map((k) => [k, { value: 0, count: 0 }])) });
    return cur.get(c)!;
  };
  for (const p of pos) {
    if (p.status === "draft") {
      const b = block(p.currency);
      b.draft.count++;
      b.draft.value += p.total;
      continue;
    }
    if (p.status === "issued") {
      const v = openValue(p.total, p.lines, today);
      if (v.remaining > 0) {
        const b = block(p.currency);
        b.issued.count++;
        b.issued.value += v.remaining;
        if (v.late > 0) { b.late.count++; b.late.value += v.late; }
        b.undated_count += v.undated ? 1 : 0;
      }
    }
    const m = block(p.currency).monthly.get(p.date.slice(0, 7));
    if (m) { m.value += p.total; m.count++; }
  }
  return [...cur.values()].sort((a, b) => (a.currency === "CAD" ? -1 : b.currency === "CAD" ? 1 : 0)).map((b) => {
    const monthly = keys.map((k) => ({ month: k, value: r2(b.monthly.get(k)!.value), count: b.monthly.get(k)!.count }));
    const complete = monthly.slice(0, -1);
    return {
      currency: b.currency,
      draft: { count: b.draft.count, value: r2(b.draft.value) }, issued: { count: b.issued.count, value: r2(b.issued.value) },
      late: { count: b.late.count, value: r2(b.late.value) }, undated_count: b.undated_count, monthly,
      avg_monthly: r2(complete.reduce((s, m) => s + m.value, 0) / complete.length),
    };
  });
}

// ---- suppliers (purchases by supplier; parts used in assemblies, by the supplier of their lot) ---------------

export const IN_HOUSE = "Assembled in-house";
const SOURCE_LABELS: Record<string, string> = { bundle: IN_HOUSE, inventory_adjustment_by_quantity: "Inventory adjustment" };
const NOT_SUPPLIERS = new Set(["Inventory adjustment", "Customer return"]);

const lotSource = (lot: Lot) => (lot.transaction_type === "bill" && lot.contact_name ? lot.contact_name : SOURCE_LABELS[lot.transaction_type] ?? "Unknown");

export function suppliers(lots: Lot[], today: string, months: number, top = 10) {
  const start = windowStart(today, months);
  const buys = new Map<string, { value: number; lots: number }>();
  const parts = new Map<string, { id: string; name: string; sku: string; qty: number; value: number; by: Map<string, number> }>();
  for (const lot of lots) {
    const src = lotSource(lot);
    if (lot.transaction_type === "bill" && start <= lot.date && lot.date <= today) {
      const b = buys.get(src) ?? { value: 0, lots: 0 };
      b.value += lot.total;
      b.lots++;
      buys.set(src, b);
    }
    for (const t of lot.transactions) {
      if (t.transaction_type !== "bundle" || t.date < start || t.date > today || src === IN_HOUSE) continue;
      const p = parts.get(lot.item_id) ?? { id: lot.item_id, name: lot.item_name, sku: lot.sku, qty: 0, value: 0, by: new Map() };
      p.qty += t.quantity_out;
      p.value += t.quantity_out * lot.cost_price_per_unit;
      p.by.set(src, (p.by.get(src) ?? 0) + t.quantity_out);
      parts.set(lot.item_id, p);
    }
  }
  const total = [...buys.values()].reduce((s, b) => s + b.value, 0);
  const list = [...buys.entries()].map(([name, v]) => ({ name, value: r2(v.value), lots: v.lots, pct: total ? r1((v.value / total) * 100) : 0 }))
    .sort((a, b) => b.value - a.value);
  const real = [...parts.values()].filter((p) => [...p.by].some(([s, v]) => v > 0 && !NOT_SUPPLIERS.has(s)));
  const topParts = [...real].sort((a, b) => b.value - a.value).slice(0, top).map((p) => {
    const split = [...p.by].filter(([, v]) => v > 0).map(([source, q]) => ({ source, qty: r2(q), pct: r1((q / p.qty) * 100) })).sort((a, b) => b.qty - a.qty);
    return { id: p.id, name: p.name, sku: p.sku, qty: r2(p.qty), value: r2(p.value), split, url: "",
      suppliers: split.filter((x) => !NOT_SUPPLIERS.has(x.source)).length };
  });
  return {
    from: start, to: today, months, purchases_total: r2(total), suppliers: list, parts: topParts, parts_count: real.length,
    multi_source_parts: real.filter((p) => [...p.by].filter(([s, v]) => v > 0 && !NOT_SUPPLIERS.has(s)).length > 1).length,
  };
}

// ---- stock of the best-selling products ----------------------------------------------------------------------

/** (item, units shipped in the window), most first. */
export function topSold(lots: Lot[], today: string, months: number, n: number): [string, number][] {
  const start = windowStart(today, months);
  const sold = new Map<string, number>();
  for (const lot of lots) for (const t of lot.transactions) {
    if (t.transaction_type === "invoice" && start <= t.date && t.date <= today) sold.set(lot.item_id, (sold.get(lot.item_id) ?? 0) + t.quantity_out);
  }
  return [...sold].filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]).slice(0, n);
}

export function stockRow(item: { id: string; name: string; sku: string; description: string; usable: number; committed: number }, sold: number, months: number) {
  const available = item.usable - item.committed;
  const monthly = months ? sold / months : 0;
  return {
    id: item.id, name: item.name, sku: item.sku, description: item.description.slice(0, 120), sold: r2(sold), avg_monthly: r1(monthly),
    on_hand: r2(item.usable), committed: r2(item.committed), available: r2(available),
    months_cover: monthly ? r1(available / monthly) : null, url: "",
  };
}

// ---- on-time shipping (by line, shown in orders) ---------------------------------------------------------------

const OTD_LATE_BUCKETS: [string, string, number, number | null][] = [["1-7", "1–7 d", 1, 7], ["8-15", "8–15 d", 8, 15], ["16-30", "16–30 d", 16, 30], ["30+", "> 30 d", 31, null]];
export const OTD_TARGET = 80;
export const DEFAULT_LEAD_DAYS = 7;

const noPromise = (e: ShipEvent) => !!e.so_date && e.so_date === e.promised;

export function onTime(events: ShipEvent[], today: string, months: number) {
  const keys = monthStarts(today, months).map((d) => d.slice(0, 7));
  const shipped = events.filter((e) => keys.includes(e.ship.slice(0, 7)) && e.ship <= today);
  const leftOut = new Map<string, { so: string; customer: string; org: string; date: string; limit: string; shipped: string; lines: number; counted: boolean; url: string }>();
  const keyOf = (e: ShipEvent) => `${e.org_id}:${e.so_id}`;
  for (const e of shipped) {
    if (!noPromise(e)) continue;
    const limit = addDays(e.so_date, DEFAULT_LEAD_DAYS);
    const o = leftOut.get(keyOf(e)) ?? { so: e.so, customer: e.customer, org: e.org, date: e.so_date, limit, shipped: e.ship, lines: 0, counted: true, url: "" };
    o.shipped = o.shipped > e.ship ? o.shipped : e.ship;
    o.lines += e.lines;
    o.counted = o.counted && e.ship <= limit;
    leftOut.set(keyOf(e), o);
  }
  const inside: ShipEvent[] = [];
  for (const e of shipped) {
    if (noPromise(e)) {
      if (!leftOut.get(keyOf(e))!.counted) continue;
      inside.push({ ...e, promised: e.ship }); // shipped within the lead days: on time
    } else inside.push(e);
  }
  const daysLate = (e: ShipEvent) => toDay(e.ship) - toDay(e.promised);
  type Order = { org: string; so: string; customer: string; promised: string; lines: number; late_lines: number; days_late: number; last_ship: string; late: [number, number][] };
  const ordersOf = (evs: ShipEvent[]) => {
    const out = new Map<string, Order>();
    for (const e of evs) {
      const o = out.get(keyOf(e)) ?? { org: e.org, so: e.so, customer: e.customer, promised: e.promised, lines: 0, late_lines: 0, days_late: 0, last_ship: e.ship, late: [] };
      o.lines += e.lines;
      o.last_ship = o.last_ship > e.ship ? o.last_ship : e.ship;
      const d = daysLate(e);
      if (d > 0) {
        o.late_lines += e.lines;
        o.days_late = Math.max(o.days_late, d);
        o.late.push([d, e.lines]);
      }
      out.set(keyOf(e), o);
    }
    return out;
  };
  const rate = (evs: ShipEvent[]): [number, number] => {
    const os = [...ordersOf(evs).values()];
    return [os.length, os.reduce((s, o) => s + 1 - o.late_lines / o.lines, 0)];
  };
  const pct = (total: number, ok: number) => (total ? r1((ok / total) * 100) : null);
  const orders = ordersOf(inside);
  const n = orders.size;
  const onTimeCount = [...orders.values()].reduce((s, o) => s + 1 - o.late_lines / o.lines, 0);
  const buckets = new Map(OTD_LATE_BUCKETS.map(([k]) => [k, 0]));
  for (const o of orders.values()) for (const [d, lines] of o.late) {
    const b = OTD_LATE_BUCKETS.find(([, , lo, hi]) => d >= lo && (hi === null || d <= hi))!;
    buckets.set(b[0], buckets.get(b[0])! + lines / o.lines);
  }
  const lateOrders = [...orders.values()].filter((o) => o.late_lines).sort((a, b) => b.days_late - a.days_late || a.so.localeCompare(b.so));
  const lateDays = lateOrders.map((o) => o.days_late).sort((a, b) => a - b);
  const byOrg = [...new Set(inside.map((e) => e.org))].sort().map((org) => {
    const [gn, gok] = rate(inside.filter((e) => e.org === org));
    return { name: org, orders: gn, on_time: r1(gok), pct: pct(gn, gok) };
  }).sort((a, b) => b.orders - a.orders);
  return {
    months, from: monthStarts(today, months)[0], orders: n, on_time: r1(onTimeCount), late: r1(n - onTimeCount), pct: pct(n, onTimeCount),
    median_days_late: lateDays.length ? lateDays[Math.floor(lateDays.length / 2)] : null,
    late_buckets: OTD_LATE_BUCKETS.map(([key, label]) => ({ key, label, orders: r1(buckets.get(key)!) })),
    late_orders: lateOrders.map((o) => ({ so: o.so, customer: o.customer, org: o.org, promised: o.promised, shipped: o.last_ship,
      days_late: o.days_late, lines: o.lines, late_lines: o.late_lines, share_late: r2(o.late_lines / o.lines), url: "" })),
    monthly: keys.map((k) => {
      const [mn, mok] = rate(inside.filter((e) => e.ship.slice(0, 7) === k));
      return { month: k, orders: mn, on_time: r1(mok), pct: pct(mn, mok) };
    }),
    by_org: byOrg, target: OTD_TARGET, lead_days: DEFAULT_LEAD_DAYS, no_date: leftOut.size,
    no_date_counted: [...leftOut.values()].filter((o) => o.counted).length,
    excluded: [...leftOut.values()].filter((o) => !o.counted).length,
    excluded_orders: [...leftOut.values()].sort((a, b) => b.shipped.localeCompare(a.shipped)),
  };
}

