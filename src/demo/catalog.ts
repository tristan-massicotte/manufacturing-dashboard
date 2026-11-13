// The fictional companies, suppliers, parts, products and customers behind the demo. Same three companies as the
// Sales Dashboard demo (github.com/tristan-massicotte/sales-dashboard): Halden Canada assembles the products and
// buys the parts; Halden Industrial (CAD) and Halden Inc. (USD) sell them. Every name here is made up.

import { Rng } from "./random";

export const COMPANIES = [
  { code: "CAN", name: "Halden Canada", short: "Canada", currency: "CAD" },
  { code: "IND", name: "Halden Industrial", short: "Industrial", currency: "CAD" },
  { code: "INC", name: "Halden Inc.", short: "Inc.", currency: "USD" },
] as const;
export type CompanyCode = (typeof COMPANIES)[number]["code"];

/** Yearly sales in the Sales Dashboard demo (before taxes, own currency): what the plant has to supply. */
export const YEARLY_SALES = { CAN: 45_700_000, IND: 9_700_000, INC: 50_600_000 };
export const USD_CAD = 1.37; // fixed demo rate, only used to size USD sales in plant terms

export type Supplier = { name: string; currency: "CAD" | "USD"; tax: number; factor: number };

export const SUPPLIERS: Supplier[] = [
  { name: "Northline Machining", currency: "CAD", tax: 14.975, factor: 1 },
  { name: "Precision Sheet Metal Co.", currency: "CAD", tax: 14.975, factor: 1 },
  { name: "Lakeview Aluminum", currency: "CAD", tax: 13, factor: 1 },
  { name: "Rivermark Electronics", currency: "USD", tax: 0, factor: 1 },
  { name: "Atlas Fasteners & Supply", currency: "CAD", tax: 14.975, factor: 1 },
  { name: "Lakeside Plastics", currency: "CAD", tax: 13, factor: 1 },
  { name: "Summit Powder Coating", currency: "CAD", tax: 14.975, factor: 1 },
  { name: "Mapleton Wire & Cable", currency: "CAD", tax: 13, factor: 1 },
  { name: "Industrial Hardware Direct", currency: "USD", tax: 0, factor: 1.08 }, // distributor: a bit dearer
  { name: "Polar Rubber Products", currency: "CAD", tax: 14.975, factor: 1 },
  { name: "Cedar Castings", currency: "CAD", tax: 13, factor: 1 },
  { name: "Keystone Bearings", currency: "USD", tax: 0, factor: 1 },
  { name: "Pinewood Packaging", currency: "CAD", tax: 14.975, factor: 1 },
  { name: "Beacon Hydraulics", currency: "CAD", tax: 13, factor: 1 },
  { name: "Granite Tooling", currency: "CAD", tax: 14.975, factor: 1 },
  { name: "Bayshore Labels", currency: "CAD", tax: 14.975, factor: 1 },
];
const supplierOf = (name: string) => SUPPLIERS.find((s) => s.name === name)!;

// Part families: who makes them (main supplier first), typical unit cost (CAD) and how many of them.
const FAMILIES: { kind: string; names: string[]; suppliers: string[]; cost: number; count: number; perProduct: [number, number] }[] = [
  { kind: "Sheet metal", names: ["Side panel", "Top panel", "Base plate", "Gusset", "Door panel", "Back panel", "Mounting plate", "Bracket"],
    suppliers: ["Precision Sheet Metal Co.", "Northline Machining"], cost: 38, count: 70, perProduct: [2, 6] },
  { kind: "Machined", names: ["Shaft", "Hub", "Spacer", "Pivot block", "Clamp block", "Adapter plate", "Pin"],
    suppliers: ["Northline Machining", "Granite Tooling"], cost: 55, count: 45, perProduct: [1, 3] },
  { kind: "Extrusion", names: ["Profile 40x40", "Profile 40x80", "Rail", "Upright", "Cross member"],
    suppliers: ["Lakeview Aluminum", "Northline Machining"], cost: 46, count: 30, perProduct: [1, 4] },
  { kind: "Electronics", names: ["Control board", "Sensor", "Power supply", "Switch", "Indicator light", "Relay module"],
    suppliers: ["Rivermark Electronics", "Industrial Hardware Direct"], cost: 64, count: 30, perProduct: [0, 3] },
  { kind: "Cable", names: ["Wire harness", "Power cord", "Cable gland M20", "Cable chain"],
    suppliers: ["Mapleton Wire & Cable"], cost: 18, count: 18, perProduct: [0, 2] },
  { kind: "Hardware", names: ["Bolt kit M8", "Hinge, stainless", "Latch", "Handle", "Caster 100 mm", "Leveling foot", "Gas spring"],
    suppliers: ["Atlas Fasteners & Supply", "Industrial Hardware Direct"], cost: 7, count: 45, perProduct: [3, 8] },
  { kind: "Plastic", names: ["Window, polycarbonate", "Cover", "End cap", "Knob", "Grommet"],
    suppliers: ["Lakeside Plastics"], cost: 11, count: 25, perProduct: [1, 3] },
  { kind: "Rubber", names: ["Gasket", "Bumper", "Seal strip"], suppliers: ["Polar Rubber Products"], cost: 4, count: 12, perProduct: [1, 2] },
  { kind: "Casting", names: ["Base casting", "Arm casting", "Knuckle"], suppliers: ["Cedar Castings"], cost: 34, count: 10, perProduct: [0, 2] },
  { kind: "Bearing", names: ["Bearing 6204", "Linear bearing", "Bushing"], suppliers: ["Keystone Bearings"], cost: 16, count: 10, perProduct: [0, 2] },
  { kind: "Hydraulic", names: ["Cylinder", "Pump", "Valve"], suppliers: ["Beacon Hydraulics", "Industrial Hardware Direct"], cost: 48, count: 6, perProduct: [0, 1] },
  { kind: "Packaging", names: ["Crate", "Carton", "Foam insert"], suppliers: ["Pinewood Packaging"], cost: 22, count: 8, perProduct: [1, 1] },
  { kind: "Label", names: ["Label set", "Rating plate"], suppliers: ["Bayshore Labels"], cost: 3, count: 6, perProduct: [1, 1] },
];

export type Part = {
  id: string; sku: string; name: string; kind: string; cost: number;
  sources: { supplier: string; share: number }[]; // where it is bought (one or two suppliers)
  inHouse: boolean; // sub-assembly made at the plant: not bought
  obsolete: boolean; // no longer used: only old stock left
  supersededDays?: number; // an old revision replaced this many days ago (its leftover stock ages from there)
};

export type Product = {
  id: string; code: string; sku: string; description: string; family: string;
  price: number; cost: number; bom: { part: string; qty: number }[]; weight: number;
};

const PRODUCT_LINES: { family: string; prefix: string; items: string[] }[] = [
  { family: "Enclosures", prefix: "EN", items: ["Control enclosure, 600 mm", "Control enclosure, 800 mm", "Wall enclosure, stainless", "Floor enclosure, double door", "Junction box kit"] },
  { family: "Workstations", prefix: "WS", items: ["Workstation frame, 1.5 m", "Workstation frame, 1.8 m", "Height-adjustable bench", "Packing station", "Inspection table"] },
  { family: "Carts", prefix: "CT", items: ["Utility cart, 3 shelves", "Heavy-duty cart, 500 kg", "Tool cart, lockable", "Kitting cart", "Bin cart"] },
  { family: "Guarding", prefix: "GD", items: ["Machine guard panel, 1 m", "Machine guard panel, 2 m", "Guard door, sliding", "Safety fence post", "Light-curtain mount"] },
  { family: "Racks", prefix: "RK", items: ["Tool rack", "Bin rack, 4 levels", "Cable reel stand", "Sheet storage rack", "Pallet rack upright"] },
  { family: "Arms and mounts", prefix: "AM", items: ["Swivel arm, single joint", "Swivel arm, dual joint", "Ceiling column, 2 m", "Display mount", "Tool balancer arm", "Rail mount kit"] },
  { family: "Lifts", prefix: "LF", items: ["Lift table, 300 kg", "Scissor lift, 800 kg", "Tilt platform"] },
  { family: "Accessories", prefix: "AC", items: ["Cable management kit", "Caster kit", "Lighting kit", "Power strip mount", "Shelf, add-on"] },
];

export type Catalog = { parts: Part[]; products: Product[] };

export function catalog(): Catalog {
  const rng = new Rng("catalog");
  const parts: Part[] = [];
  let n = 1000;
  for (const f of FAMILIES) {
    for (let i = 0; i < f.count; i++) {
      const id = `p${++n}`;
      const second = f.suppliers.length > 1 && rng.chance(f.cost > 30 ? 0.55 : 0.3);
      const main = rng.chance(0.8) ? f.suppliers[0] : f.suppliers[f.suppliers.length - 1];
      const other = f.suppliers.find((s) => s !== main) ?? SUPPLIERS[rng.int(0, SUPPLIERS.length - 1)].name;
      parts.push({
        id, sku: `PRT-${n}`, kind: f.kind, name: `${rng.pick(f.names)}, ${f.kind.toLowerCase()} ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26) + 1}`,
        cost: Math.round(rng.logNormal(f.cost, 0.55) * 100) / 100,
        sources: second ? [{ supplier: main, share: rng.between(0.55, 0.85) }, { supplier: other, share: 0 }] : [{ supplier: main, share: 1 }],
        inHouse: false, obsolete: rng.chance(0.06),
      });
      const p = parts[parts.length - 1];
      if (p.sources.length === 2) p.sources[1].share = 1 - p.sources[0].share;
    }
  }
  // Engineering changes: some parts were replaced by a new revision; the old revision's stock is left over.
  for (const p of rng.shuffle(parts.filter((x) => !x.obsolete)).slice(0, 40)) {
    parts.push({ ...p, id: `${p.id}a`, sku: `${p.sku}-A`, name: `${p.name} (rev. A)`, obsolete: true, supersededDays: rng.int(190, 720) });
  }
  // A few sub-assemblies are made at the plant (welded frames, wired panels): not bought from anyone.
  for (let i = 0; i < 14; i++) {
    const id = `p${++n}`;
    parts.push({ id, sku: `SUB-${n}`, kind: "Sub-assembly", name: rng.pick(["Welded frame", "Wired control panel", "Door assembly", "Base assembly"]) + ` ${i + 1}`,
      cost: Math.round(rng.logNormal(180, 0.4) * 100) / 100, sources: [], inHouse: true, obsolete: false });
  }

  const active = parts.filter((p) => !p.obsolete);
  const products: Product[] = [];
  let k = 0;
  for (const line of PRODUCT_LINES) {
    for (const item of line.items) {
      k++;
      const bom: { part: string; qty: number }[] = [];
      const used = new Set<string>();
      for (const f of FAMILIES) {
        const count = rng.int(f.perProduct[0], f.perProduct[1]);
        const pool = active.filter((p) => p.kind === f.kind);
        for (let j = 0; j < count; j++) {
          const p = rng.pick(pool);
          if (used.has(p.id)) continue;
          used.add(p.id);
          bom.push({ part: p.id, qty: f.kind === "Hardware" ? rng.int(2, 12) : rng.int(1, 4) });
        }
      }
      if (rng.chance(0.4)) {
        const sub = rng.pick(parts.filter((p) => p.inHouse));
        bom.push({ part: sub.id, qty: 1 });
      }
      const material = bom.reduce((s, b) => s + parts.find((p) => p.id === b.part)!.cost * b.qty, 0);
      const cost = material / 0.78; // material + labour + overhead (FIFO cost of the assembled product)
      products.push({
        id: `f${100 + k}`, code: `${line.prefix}-${100 + k * 10}`, sku: `FG-${2000 + k}`, description: item, family: line.family,
        cost: Math.round(cost * 100) / 100, price: Math.round((material / 0.45) / 5) * 5, bom,
        weight: Math.pow(rng.next(), 1.8) * 10 + 0.4, // a few best-sellers, a long tail
      });
    }
  }
  return { parts, products };
}

export const supplierCurrency = (name: string) => supplierOf(name).currency;
export const supplierTax = (name: string) => supplierOf(name).tax;
export const supplierFactor = (name: string) => supplierOf(name).factor;

// ---- customers (same naming style as the Sales Dashboard demo) -------------------------------------

const PLACES = ["Riverside", "Northgate", "Summit Ridge", "Bayview", "Cedar Point", "Lakeshore", "Granite Falls", "Maple Grove",
  "Harbor Light", "Prairie Wind", "Silverline", "Redwood", "Aurora", "Pinecrest", "Westbrook", "Eastfield", "Bluewater",
  "Ironwood", "Highland", "Clearwater", "Stonebridge", "Oakridge", "Brightwater", "Falcon Crest", "Keystone", "Meridian",
  "Pioneer", "Sterling", "Trillium", "Willow Creek", "Copperfield", "Elmstead", "Foxhollow", "Glenmore", "Hawthorne"];
const KINDS: Record<CompanyCode, string[]> = {
  CAN: ["Fleet Services", "Industrial Supply", "Equipment Ltd.", "Logistics", "Fabrication", "Transit Authority", "Utilities", "Rentals"],
  IND: ["Automation", "Controls Ltd.", "Machine Works", "Robotics", "Packaging", "Systems Integration"],
  INC: ["Fleet Solutions", "Industrial Group", "Equipment Co.", "Logistics Inc.", "Supply Corp.", "Machinery Co.", "Services Group", "Municipal Fleet"],
};

export function customers(company: CompanyCode, n: number): { name: string; weight: number }[] {
  const rng = new Rng("customers", company);
  const used = new Set<string>();
  const out = [];
  for (let i = 0; i < n; i++) {
    let name = "";
    do name = `${rng.pick(PLACES)} ${rng.pick(KINDS[company])}`; while (used.has(name));
    used.add(name);
    out.push({ name, weight: Math.pow(rng.next(), 2) * 10 + 0.3 });
  }
  return out;
}
