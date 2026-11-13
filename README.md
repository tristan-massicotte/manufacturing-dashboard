# Manufacturing Dashboard (demo)

**Live demo: https://tristan-massicotte.github.io/manufacturing-dashboard/**

A public demo of an executive manufacturing dashboard I built at work for a manufacturer's production director
and CEO. The production version reads the company's ERP (Zoho Inventory) and its order-tracking app. This version
runs the same calculations in your browser on simulated data for three fictional companies: the same "Halden
Canada", "Halden Industrial" and "Halden Inc." as the
[Sales Dashboard demo](https://tristan-massicotte.github.io/sales-dashboard/), with volumes sized to those sales.

## The six tiles

- **Inventory value**: total stock at FIFO cost for the two companies that hold stock, split by age since receipt
  (under 6 months … over 24 months = dormant), with a 12-month trend and inventory turns (sales over 12 months ÷
  average inventory; days on hand = 365 ÷ turns; added for this demo). "More info" opens assembled products vs parts
  and a searchable, exportable list of dormant items.
- **Sales Orders**: open customer orders still to ship, per currency, by how late their planned ship date is.
- **Purchase Orders**: drafts, and the value of issued POs still to receive; a monthly chart of POs issued.
- **Supplier breakdown**: purchases by supplier, and for the parts used most in assemblies, the share of units that
  came from each supplier (3, 6 or 12 months).
- **Stock: top 10 products**: the best sellers, their stock and their cover in months (critical, low, OK,
  overstock).
- **On-time shipping**: share of orders shipped by their promised date, against an 80% target, with delays by size,
  by company and by month. "More info" lists every late order, filterable and exportable.

Tiles can be dragged between two columns, hidden, and brought into focus; the layout and theme are remembered.

## The rules that mattered

- **Inventory at FIFO cost**, the book value, from the ERP's aging report. Age is time since receipt; moving stock
  between locations doesn't reset it. Dormant = in stock for more than 24 months.
- **Purchases are traced through FIFO lots**: every unit used in an assembly is tied to the lot it came from, so the
  supplier tile can say which supplier the parts actually used came from, not only who was paid.
- **On-time is judged per order line and shown in orders**: an order with 3 of its 4 lines shipped on time counts
  as 0.75 on time. Orders with no real promised date (the expected date left equal to the order date) count as on
  time if they shipped within 7 days, and are otherwise left out, with the count shown, rather than reported as
  months late.
- **Open POs count only what is still to receive**, taxes following the goods.
- **CAD and USD are never added.** Each currency gets its own figure.

## How it is built

| | Production | This demo |
|---|---|---|
| Data | Zoho Inventory reports (aging summary, FIFO lot tracking, POs, sales orders, packages) and the order-tracking app, read every weekday at 7:00 | Simulated in the browser (`src/demo/`) |
| Calculations | Python (FastAPI), one module per tile | The same logic ported to TypeScript (`src/demo/engine.ts`) |
| Frontend | React 18 + TypeScript + Vite, plain SVG charts, dnd-kit | Same, translated to English |
| Hosting | Docker on the company's server | GitHub Pages, static |

### The simulation

`src/demo/plant.ts` runs the Halden Canada plant week by week for 15 months: products are sold, assembled to
replace what was sold, and assembling consumes parts that 16 suppliers deliver on a reorder rule (with lead
times, the occasional bulk buy, late and partial deliveries). Every unit goes through FIFO lots, like the ERP's lot
tracking report. Inventory value and age, purchases by supplier, parts used and units shipped all come out of the
same lots, so they agree with each other. Old part revisions left over from engineering changes and a few
discontinued products give the dormant stock.

Plant shipments add up to the yearly sales of the Sales Dashboard demo, and open orders hold about a month of each
currency's sales. `npm test` checks this, along with the tile arithmetic: FIFO never takes more than a lot held,
age buckets add up to the inventory total, supplier shares add up to 100%, and on-time plus late equals the orders
counted.

## Run it locally

```bash
npm install
npm run dev     # http://localhost:5173
npm test
npm run build   # static site in dist/
```

---

Built by Tristan Massicotte · Industrial Engineering, University of Toronto ·
[LinkedIn](https://www.linkedin.com/in/tristan-massicotte) · [Sales Dashboard demo](https://github.com/tristan-massicotte/sales-dashboard)
