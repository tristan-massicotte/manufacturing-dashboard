// Customer orders of the three companies: shipped packages (for on-time shipping) and the orders still open (for
// the Sales Orders tile). Order counts and values follow the Sales Dashboard demo's volumes: about 150 orders a
// month across the three companies, and an open backlog of roughly a month of sales.

import { COMPANIES, CompanyCode, customers, YEARLY_SALES } from "./catalog";
import { addDays, toDay, toIso, weekday } from "./dates";
import { Rng } from "./random";

/** One shipped package of an order: `lines` order lines left in it. */
export type ShipEvent = {
  org: string; org_id: string; so_id: string; so: string; customer: string; package: string;
  so_date: string; ship: string; promised: string; lines: number;
};

/** An open sales order (what an order-tracking app would list). Amounts tax included, order currency. */
export type OpenSo = {
  so: string; org_name: string; customer: string; currency: string; total: number; remaining: number;
  shipment_date: string; shipped_status: "not_shipped" | "partially_shipped";
};

const PER_MONTH: Record<CompanyCode, number> = { CAN: 62, IND: 18, INC: 48 };
// Share of packages shipped on or before the promised date (each company runs a bit differently).
const ON_TIME: Record<CompanyCode, number> = { CAN: 0.76, IND: 0.66, INC: 0.71 };
const PREFIX: Record<CompanyCode, string> = { CAN: "SO", IND: "SO", INC: "SO" }; // number ranges differ by company
const START: Record<CompanyCode, number> = { CAN: 31200, IND: 8400, INC: 19650 };

function businessDays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = toDay(from); d <= toDay(to); d++) if (weekday(toIso(d)) % 6 !== 0) out.push(toIso(d));
  return out;
}

function lateDays(r: Rng): number {
  return r.weighted([[r.int(1, 7), 42], [r.int(8, 15), 22], [r.int(16, 30), 18], [r.int(31, 75), 14], [r.int(76, 160), 4]] as const);
}

/** Orders placed over the last ~14 months; returns their shipped packages and the ones not shipped yet. */
export function orders(today: string): { events: ShipEvent[]; open: OpenSo[] } {
  const events: ShipEvent[] = [];
  const open: OpenSo[] = [];
  for (const c of COMPANIES) {
    const list = customers(c.code, c.code === "IND" ? 36 : 80);
    const weights = list.map((x) => [x.name, x.weight] as const);
    let seq = START[c.code];
    const first = toIso(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 15, 1) / 86400000);
    // Average order value (tax included), so that open orders add up to about a month of sales.
    const avgOrder = YEARLY_SALES[c.code] / (PER_MONTH[c.code] * 12) * (c.currency === "CAD" ? 1.13 : 1.02);
    for (const day of businessDays(first, today)) {
      const r = new Rng("so", c.code, day);
      const month = Number(day.slice(5, 7));
      const n = r.chance((PER_MONTH[c.code] / 21) % 1) ? Math.ceil(PER_MONTH[c.code] / 21) : Math.floor(PER_MONTH[c.code] / 21);
      for (let k = 0; k < n; k++) {
        seq++;
        const so = `${PREFIX[c.code]}-${seq}`;
        const customer = r.weighted(weights);
        const noPromise = r.chance(0.2); // promised date never entered: left equal to the order date
        const promised = noPromise ? day : addDays(day, r.int(7, 42));
        const lines = r.weighted([[1, 30], [2, 22], [3, 16], [4, 12], [5, 8], [6, 6], [8, 4], [12, 2]] as const);
        const split = lines > 1 && r.chance(0.18); // shipped in two packages
        const improve = (month >= 8 ? 0.04 : 0) * (day.slice(0, 4) === today.slice(0, 4) ? 1 : 0);
        const shipOf = () => noPromise ? addDays(day, r.weighted([[r.int(1, 7), 58], [r.int(8, 30), 30], [r.int(31, 120), 12]] as const))
          : r.chance(ON_TIME[c.code] + improve) ? addDays(promised, -r.int(0, 6)) : addDays(promised, lateDays(r));
        const packages = split ? [{ lines: Math.ceil(lines / 2), ship: shipOf() }, { lines: Math.floor(lines / 2), ship: shipOf() }]
          : [{ lines, ship: shipOf() }];
        const total = Math.round(r.logNormal(avgOrder * 0.7, 0.8) * 100) / 100;
        const shipped = packages.filter((p) => p.ship <= today);
        packages.forEach((p, i) => {
          if (p.ship > today) return;
          events.push({ org: c.name, org_id: c.code, so_id: so, so, customer, package: `PKG-${seq}-${i + 1}`, so_date: day,
            ship: p.ship < day ? day : p.ship, promised, lines: p.lines });
        });
        if (shipped.length < packages.length && toDay(today) - toDay(day) < 120) {
          const shippedLines = shipped.reduce((s, p) => s + p.lines, 0);
          open.push({ so, org_name: c.name, customer, currency: c.currency, total,
            remaining: Math.round(total * (1 - shippedLines / lines) * 100) / 100,
            shipment_date: noPromise ? addDays(day, 7) : promised, shipped_status: shippedLines ? "partially_shipped" : "not_shipped" });
        }
      }
    }
  }
  return { events, open };
}

