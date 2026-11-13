// Stand-in for the production app's HTTP API (GET /api/dashboard, /api/inventory/detail, /api/otd/late): the same
// JSON shapes, computed in the browser from the simulation. The pages call these through src/api.ts.

import type { Dashboard, InvItem, InventoryDetail, OtdLate } from "../api";
import { YEARLY_SALES } from "./catalog";
import { addDays, todayIso } from "./dates";
import { agingByItem, bucketLabels, bucketTotals, DORMANT_MONTHS, monthEnds, salesShipped, turnover, onTime, purchaseOrders, salesOrders, stockRow, suppliers, topSold, windowStart } from "./engine";
import { orders, type ShipEvent } from "./orders";
import { round, simulate, type Plant } from "./plant";
import { Rng } from "./random";

const PERIODS = [3, 6, 12];
const ORGS = [
  { id: "CAN", name: "Halden Canada", short: "Canada" },
  { id: "IND", name: "Halden Industrial", short: "Industrial" },
];
export const USABLE_LOCATIONS = ["Main warehouse", "Assembly floor"];

type World = { today: string; asOf: string; plant: Plant; events: ShipEvent[]; open: ReturnType<typeof orders>["open"]; industrial: InvItem[] };
let world: World | null = null;

/** Built once per page load (well under a second). */
export function getWorld(day?: string): World {
  if (world && (!day || world.today === day)) return world; // tests pin a day; the page uses today's
  const today = day ?? todayIso();
  const plant = simulate(today);
  const { events, open } = orders(today);
  world = { today, asOf: `${today}T07:00:00`, plant, events, open, industrial: industrialItems(today) };
  return world;
}

// ---- inventory -------------------------------------------------------------------------------------------------

function canadaItems(w: World): InvItem[] {
  const { cat } = w.plant;
  const parts = new Map(cat.parts.map((p) => [p.id, p]));
  const products = new Map(cat.products.map((p) => [p.id, p]));
  const out: InvItem[] = [];
  for (const [id, row] of agingByItem(w.plant.lots, w.today)) {
    const part = parts.get(id);
    const product = products.get(id);
    out.push({
      id, name: product ? product.code : part!.name, sku: product ? product.sku : part!.sku,
      description: product ? product.description : part!.name, vendor: part?.sources[0]?.supplier ?? "",
      category: product ? product.family : part!.kind, assembled: !!product || !!part?.inHouse,
      buckets: row.values.map(round), qty: row.qty.map((q) => Math.round(q * 100) / 100),
    });
  }
  return out;
}

/** Halden Industrial keeps a smaller stock: products for resale and service parts, mostly recent. */
function industrialItems(today: string): InvItem[] {
  const r = new Rng("industrial-stock", today.slice(0, 7));
  const out: InvItem[] = [];
  for (let i = 0; i < 110; i++) {
    const product = i < 32;
    const dormant = r.chance(0.08);
    const value = r.logNormal(product ? 29000 : 9000, 0.75);
    const unit = product ? r.logNormal(1200, 0.5) : r.logNormal(40, 0.8);
    const shares = dormant ? [0, 0, 0.1, 0.2, 0.7] : [r.between(0.55, 0.9), r.between(0.05, 0.25), r.between(0, 0.1), r.between(0, 0.05), r.chance(0.2) ? r.between(0, 0.08) : 0];
    const sum = shares.reduce((s, x) => s + x, 0);
    const buckets = shares.map((x) => round((value * x) / sum));
    out.push({
      id: `ind-${i}`, name: product ? `R-${3100 + i * 7}` : `SVC-${5200 + i}`, sku: product ? `RS-${4100 + i}` : `SVC-${5200 + i}`,
      description: product ? r.pick(["Resale enclosure kit", "Resale workstation", "Conveyor guard kit", "Robot cell fence kit", "Control panel kit"])
        : r.pick(["Service part, sensor", "Service part, motor", "Service kit, fasteners", "Spare cable set", "Spare door seal"]),
      vendor: product ? "Halden Canada" : r.pick(["Atlas Fasteners & Supply", "Industrial Hardware Direct", "Mapleton Wire & Cable"]),
      category: product ? "Resale" : "Service parts", assembled: product, buckets,
      qty: buckets.map((v) => Math.round((v / unit) * 100) / 100),
    });
  }
  return out;
}

function inventory(w: World): Dashboard["inventory"] {
  const labels = bucketLabels();
  const can = canadaItems(w);
  const current: Record<string, number[]> = {
    CAN: bucketTotals(can.map((i) => ({ values: i.buckets }))),
    IND: bucketTotals(w.industrial.map((i) => ({ values: i.buckets }))),
  };
  const orgs = ORGS.map((o) => {
    const b = current[o.id];
    return { id: o.id, name: o.name, short: o.short, zoho_url: "", total: round(b.reduce((s, x) => s + x, 0)), dormant: b[b.length - 1],
      fetched_at: w.asOf, buckets: labels.map((l, i) => ({ ...l, value: b[i] })) };
  });
  const r = new Rng("industrial-history", w.today.slice(0, 7));
  const indToday = orgs[1];
  const history = monthEnds(w.today, 11).map((d, i, all) => {
    const b = bucketTotals(agingByItem(w.plant.lots, d).values());
    const can = { total: round(b.reduce((s, x) => s + x, 0)), dormant: b[b.length - 1] };
    const f = (1 - 0.034 * (all.length - i)) * r.between(0.97, 1.03); // a growing resale line: stock built up over the year
    const ind = { total: round(indToday.total * f), dormant: round(indToday.dormant * r.between(0.85, 1.1)) };
    return { date: d, by_org: { CAN: can, IND: ind } as Record<string, { total: number; dormant: number }> };
  });
  history.push({ date: w.today, by_org: Object.fromEntries(orgs.map((o) => [o.id, { total: o.total, dormant: o.dormant }])) });
  // Sales over the last 12 months. Halden Canada's plant ships every product the three companies sell, so its
  // shipments (at selling price) are the group's sales, about the Sales Dashboard demo's yearly total. Halden
  // Industrial's own stock turns on its own sales.
  const price = new Map(w.plant.cat.products.map((p) => [p.id, p.price]));
  const groupSales = salesShipped(w.plant.lots, price, addDays(w.today, -365), w.today);
  const series = (id: string) => history.map((h) => h.by_org[id].total);
  const turns = {
    all: turnover(groupSales, history.map((h) => h.by_org.CAN.total + h.by_org.IND.total)),
    CAN: turnover(groupSales, series("CAN")),
    IND: turnover(YEARLY_SALES.IND, series("IND")),
  };
  return {
    turnover: turns,
    source: "live", error: null, refreshing: false, dormant_months: DORMANT_MONTHS, as_of: w.asOf, orgs,
    total: round(orgs.reduce((s, o) => s + o.total, 0)), dormant: round(orgs.reduce((s, o) => s + o.dormant, 0)),
    history: history.map((h) => ({ ...h, total: round(Object.values(h.by_org).reduce((s, v) => s + v.total, 0)),
      dormant: round(Object.values(h.by_org).reduce((s, v) => s + v.dormant, 0)) })),
  };
}

export function inventoryDetail(): InventoryDetail {
  const w = getWorld();
  return {
    source: "live", as_of: w.asOf, dormant_months: DORMANT_MONTHS, buckets: bucketLabels(),
    orgs: [
      { id: "CAN", name: "Halden Canada", short: "Canada", item_url: "", items: canadaItems(w) },
      { id: "IND", name: "Halden Industrial", short: "Industrial", item_url: "", items: w.industrial },
    ],
  };
}

// ---- the other tiles -------------------------------------------------------------------------------------------

function stock(w: World): Dashboard["stock"] {
  const { cat, lots } = w.plant;
  const products = new Map(cat.products.map((p) => [p.id, p]));
  const onHand = agingByItem(lots, w.today);
  const periods = Object.fromEntries(PERIODS.map((m) => {
    const rows = topSold(lots, w.today, m, 10).map(([id, sold]) => {
      const p = products.get(id)!;
      const r = new Rng("stock-row", id, w.today);
      const total = onHand.get(id)?.qty.reduce((s, q) => s + q, 0) ?? 0;
      const usable = Math.round(total * (r.chance(0.3) ? r.between(0.88, 0.98) : 1)); // the rest waits in quality hold
      const committed = Math.round((sold / m) * r.between(0, 0.25));
      return stockRow({ id, name: p.code, sku: p.sku, description: p.description, usable, committed }, sold, m);
    });
    return [String(m), { months: m, from: windowStart(w.today, m), rows }];
  }));
  return { source: "live", error: null, as_of: w.asOf, default_months: 6, periods, locations: USABLE_LOCATIONS };
}

function otd(w: World): Dashboard["otd"] {
  const periods = Object.fromEntries(PERIODS.map((m) => {
    const s = onTime(w.events, w.today, m);
    const { excluded_orders: _, ...rest } = s;
    return [String(m), { ...rest, late_orders: rest.late_orders.slice(0, 5) }];
  }));
  return { source: "live", error: null, as_of: w.asOf, default_months: 6, orgs: ["Halden Canada", "Halden Industrial", "Halden Inc."], periods };
}

export function otdLate(months: number): OtdLate {
  const w = getWorld();
  const m = PERIODS.includes(months) ? months : 6;
  const s = onTime(w.events, w.today, m);
  return { as_of: w.asOf, months: m, from: s.from, late_buckets: s.late_buckets, excluded: s.excluded, excluded_rows: s.excluded_orders,
    lead_days: s.lead_days, no_date: s.no_date, no_date_counted: s.no_date_counted, orders: s.orders, late: s.late, rows: s.late_orders };
}

export function dashboard(): Dashboard {
  const w = getWorld();
  return {
    generated_at: new Date().toISOString(),
    currency: "CAD",
    sources: { inventory: "live", sales_orders: "live", purchase_orders: "live", suppliers: "live", stock: "live", otd: "live" },
    inventory: inventory(w),
    sales_orders: { source: "live", error: null, link: "", computed_at: w.asOf, ...salesOrders(w.open, w.today) },
    purchase_orders: { source: "live", error: null, as_of: w.asOf, link: "", orgs: ["Halden Canada", "Halden Industrial"],
      currencies: purchaseOrders(w.plant.pos, w.today) },
    suppliers: { source: "live", error: null, as_of: w.asOf, default_months: 6,
      periods: Object.fromEntries(PERIODS.map((m) => [String(m), suppliers(w.plant.lots, w.today, m)])) },
    stock: stock(w),
    otd: otd(w),
  };
}
