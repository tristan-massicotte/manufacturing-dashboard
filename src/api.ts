// Shape of GET /api/dashboard (one module per tile in the production app).
import * as server from "./demo/server";

export type Source = "live" | "pending";

export interface StockRow {
  id: string; sku: string; name: string; description: string; sold: number; on_hand: number; committed: number;
  available: number; avg_monthly: number; months_cover: number | null; url: string;
}
export interface Bucket { key: string; label: string; value: number; count?: number }
export interface MonthValue { month: string; date?: string; value: number; count?: number; dormant?: number }

export interface SupplierPeriod {
  from: string; to: string; months: number; purchases_total: number; parts_count: number; multi_source_parts: number;
  suppliers: { name: string; value: number; pct: number; lots: number }[];
  parts: { id: string; name: string; sku: string; qty: number; value: number; split: { source: string; qty: number; pct: number }[]; suppliers: number; url: string }[];
}

export interface LateOrder {
  so: string; customer: string; org: string; promised: string; shipped: string; days_late: number;
  lines: number; late_lines: number; share_late: number; url: string;
}
export interface OtdPeriod {
  months: number; from: string; orders: number; on_time: number; late: number; pct: number | null; median_days_late: number | null;
  late_buckets: { key: string; label: string; orders: number }[]; late_orders: LateOrder[];
  monthly: { month: string; orders: number; on_time: number; pct: number | null }[];
  by_org: { name: string; orders: number; on_time: number; pct: number | null }[];
  target: number; excluded: number; lead_days: number; no_date: number; no_date_counted: number;
}
export interface OtdLate {
  as_of: string | null; months: number; from: string; orders: number; late: number;
  late_buckets: { key: string; label: string; orders: number }[]; rows: LateOrder[];
  excluded: number; lead_days: number; no_date: number; no_date_counted: number;
  excluded_rows: { so: string; customer: string; org: string; date: string; limit: string; shipped: string; lines: number; counted: boolean; url: string }[];
}

export interface Dashboard {
  generated_at: string;
  currency: string;
  sources: { inventory: Source; sales_orders: Source; purchase_orders: Source; suppliers: Source; stock: Source; otd: Source };
  stock: {
    source: "live" | "loading" | "error"; error: string | null; as_of?: string; default_months: number;
    periods?: Record<string, { months: number; from: string; rows: StockRow[] }>; locations?: string[];
  };
  suppliers: {
    source: "live" | "loading" | "error"; error: string | null; as_of?: string; default_months?: number;
    periods?: Record<string, SupplierPeriod>;
  };
  inventory: {
    source: "live" | "loading" | "error"; error: string | null; refreshing: boolean; dormant_months: number;
    as_of: string | null; total: number; dormant: number;
    orgs: { id: string; name: string; short: string; zoho_url: string; total: number; dormant: number; fetched_at: string; buckets: Bucket[] }[];
    history: { date: string; total: number; dormant: number; by_org: Record<string, { total: number; dormant: number }> }[];
    /** Inventory turns on sales over the last 12 months, for both companies ("all") and each one. */
    turnover?: Record<string, { sales: number; avg_value: number; turns: number; days: number | null }>;
  };
  purchase_orders: {
    source: "live" | "loading" | "error"; error: string | null; as_of: string | null; link: string; orgs: string[];
    currencies: {
      currency: string; draft: { count: number; value: number }; issued: { count: number; value: number };
      late: { count: number; value: number }; undated_count: number; avg_monthly: number;
      monthly: { month: string; value: number; count: number }[];
    }[];
  };
  sales_orders: {
    source: "live" | "stale" | "error"; error: string | null; link: string; computed_at?: string;
    count: number; partial_count?: number; late_count?: number; unchecked_count?: number;
    currencies: {
      currency: string; count: number; remaining: number; total: number; partial_count: number;
      late_count: number; late_value: number; buckets: (Bucket & { count: number })[];
      orgs: { name: string; count: number; remaining: number }[];
    }[];
  };
  otd: {
    source: "live" | "loading" | "error"; error: string | null; as_of?: string; default_months: number; orgs?: string[];
    periods?: Record<string, OtdPeriod>;
  };
}

export interface InvItem {
  id: string; name: string; sku: string; description: string; vendor: string; category: string;
  assembled: boolean; buckets: number[]; qty: number[];
}
export interface InventoryDetail {
  source: "live" | "loading"; as_of: string | null; dormant_months: number;
  buckets: { key: string; label: string }[];
  orgs: { id: string; name: string; short: string; item_url: string; items: InvItem[] }[];
}

// Production: fetch("/api/dashboard"), "/api/inventory/detail", "/api/otd/late?months=N" on a FastAPI server.
// Demo: the same payloads, built in the browser from simulated data (src/demo/server.ts).
const local = <T,>(fn: () => T) => new Promise<T>((resolve, reject) => setTimeout(() => { try { resolve(fn()); } catch (e) { reject(e); } }, 0));

export const fetchDashboard = () => local(() => server.dashboard());
export const fetchInventoryDetail = () => local(() => server.inventoryDetail());
export const fetchOtdLate = (months: number) => local(() => server.otdLate(months));
