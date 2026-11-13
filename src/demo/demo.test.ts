// Checks on the simulation and the tile calculations: every figure adds up, FIFO never takes more than a lot held,
// and the volumes stay in line with the Sales Dashboard demo's sales.

import { describe, expect, it } from "vitest";
import { USD_CAD, YEARLY_SALES } from "./catalog";
import { addDays } from "./dates";
import { onTime, purchaseOrders, salesOrders, suppliers } from "./engine";
import { orders } from "./orders";
import { simulate } from "./plant";
import { dashboard, getWorld, otdLate } from "./server";

const TODAY = "2026-11-13";
const plant = simulate(TODAY);
const { events, open } = orders(TODAY);
getWorld(TODAY); // the "server" uses the same fixed day
const d = dashboard();
const close = (a: number, b: number, cents = 2) => expect(Math.abs(a - b)).toBeLessThanOrEqual(cents);

describe("simulation", () => {
  it("is the same for the same day", () => {
    const again = simulate(TODAY);
    expect(again.lots.length).toBe(plant.lots.length);
    expect(again.lots[500]).toEqual(plant.lots[500]);
  });

  it("FIFO never takes more units than a lot received, nor before it arrived", () => {
    for (const lot of plant.lots) {
      expect(lot.transactions.reduce((s, t) => s + t.quantity_out, 0)).toBeLessThanOrEqual(lot.quantity_in);
      for (const t of lot.transactions) expect(t.date >= lot.date).toBe(true);
    }
  });

  it("ships about what the Sales Dashboard demo sells in a year", () => {
    const products = new Map(plant.cat.products.map((p) => [p.id, p]));
    const from = addDays(TODAY, -365);
    let value = 0;
    for (const lot of plant.lots) for (const t of lot.transactions) {
      if (t.transaction_type === "invoice" && t.date > from) value += t.quantity_out * products.get(lot.item_id)!.price;
    }
    const expected = YEARLY_SALES.CAN + YEARLY_SALES.IND + YEARLY_SALES.INC * USD_CAD;
    expect(value / expected).toBeGreaterThan(0.85);
    expect(value / expected).toBeLessThan(1.15);
  });

  it("keeps about a month of sales in open orders, per currency", () => {
    const weeks = (cur: string, yearly: number) => open.filter((s) => s.currency === cur).reduce((t, s) => t + s.remaining, 0) / (yearly / 52);
    expect(weeks("CAD", YEARLY_SALES.CAN + YEARLY_SALES.IND)).toBeGreaterThan(2);
    expect(weeks("CAD", YEARLY_SALES.CAN + YEARLY_SALES.IND)).toBeLessThan(8);
    expect(weeks("USD", YEARLY_SALES.INC)).toBeGreaterThan(2);
    expect(weeks("USD", YEARLY_SALES.INC)).toBeLessThan(8);
  });
});

describe("tiles add up", () => {
  it("inventory: companies and age buckets add up to the total", () => {
    const inv = d.inventory;
    close(inv.orgs.reduce((s, o) => s + o.total, 0), inv.total);
    for (const o of inv.orgs) close(o.buckets.reduce((s, b) => s + b.value, 0), o.total, 5);
    expect(inv.history.length).toBe(12);
    close(inv.history[inv.history.length - 1].total, inv.total);
    expect(inv.dormant / inv.total).toBeLessThan(0.15);
  });

  it("inventory turns: sales ÷ average inventory, about 7 for both companies", () => {
    const t = d.inventory.turnover!;
    expect(t.all.turns).toBeGreaterThan(6.5);
    expect(t.all.turns).toBeLessThan(7.6);
    for (const k of ["all", "CAN", "IND"]) {
      close(t[k].turns, t[k].sales / t[k].avg_value, 0.06);
      expect(t[k].turns).toBeGreaterThan(3);
      expect(t[k].turns).toBeLessThan(10);
      expect(Math.abs(t[k].days! - 365 / t[k].turns)).toBeLessThan(3);
    }
  });

  it("sales orders: late buckets add up per currency", () => {
    for (const c of salesOrders(open, TODAY).currencies) {
      expect(c.buckets.reduce((s, b) => s + b.count, 0)).toBe(c.count);
      close(c.buckets.reduce((s, b) => s + b.value, 0), c.remaining, 5);
    }
  });

  it("purchase orders: still-to-receive never exceeds the open POs' totals", () => {
    for (const c of purchaseOrders(plant.pos, TODAY)) {
      const open = plant.pos.filter((p) => p.status === "issued" && p.currency === c.currency).reduce((s, p) => s + p.total, 0);
      expect(c.issued.value).toBeLessThanOrEqual(open + 0.01);
      expect(c.late.value).toBeLessThanOrEqual(c.issued.value + 0.01);
      expect(c.monthly.length).toBe(12);
    }
  });

  it("suppliers: shares add up to 100% and to the purchases total", () => {
    for (const m of [3, 6, 12]) {
      const s = suppliers(plant.lots, TODAY, m);
      close(s.suppliers.reduce((t, x) => t + x.value, 0), s.purchases_total, 5);
      expect(Math.abs(s.suppliers.reduce((t, x) => t + x.pct, 0) - 100)).toBeLessThan(1);
      for (const p of s.parts) close(p.split.reduce((t, x) => t + x.qty, 0), p.qty, 1);
      expect(s.parts.every((p) => !p.split.some((x) => x.source === "Assembled in-house"))).toBe(true);
    }
  });

  it("on-time shipping: on time + late = orders, companies add up, late list matches", () => {
    for (const m of [3, 6, 12]) {
      const o = onTime(events, TODAY, m);
      close(o.on_time + o.late, o.orders, 0.11);
      expect(o.by_org.reduce((s, g) => s + g.orders, 0)).toBe(o.orders);
      close(o.late_buckets.reduce((s, b) => s + b.orders, 0), o.late, 0.5);
      expect(otdLate(m).rows.length).toBe(o.late_orders.length);
      expect(o.no_date_counted + o.excluded).toBe(o.no_date);
    }
  });

  it("stock: top 10 sorted by units shipped, cover = available ÷ monthly average", () => {
    for (const per of Object.values(d.stock.periods!)) {
      expect(per.rows.length).toBe(10);
      per.rows.forEach((r, i) => i && expect(r.sold).toBeLessThanOrEqual(per.rows[i - 1].sold));
      for (const r of per.rows) if (r.months_cover !== null) close(r.months_cover, r.available / (r.sold / per.months), 0.06);
    }
  });
});
