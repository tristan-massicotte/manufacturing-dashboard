import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { fetchDashboard, type Dashboard } from "./api";
import { AnimatedNumber } from "./charts";
import { dec1, money, moneyCur, num, pct, timeOf } from "./format";
import { loadLayout, loadTheme, saveLayout, saveTheme, type Layout } from "./layout";
import InventoryDetail from "./InventoryDetail";
import OtdDetail from "./OtdDetail";
import { PoMonthlyModal, TILES, type TileDef } from "./tiles";

// Default columns: Supplier breakdown beside Inventory value, Purchase Orders right below Sales Orders.
const DEFAULT_LAYOUT: Layout = {
  cols: [["inventory", "stock", "otd"], ["suppliers", "so", "po"]],
  hidden: [],
};
const COL_IDS = ["col-0", "col-1"];
const REFRESH_MS = 5 * 60 * 1000;

/** The period a tile last showed (same storage as usePeriod in tiles.tsx), so its detail view opens on it. */
function readMonths(key: string, fallback: number): number {
  try { const v = Number(localStorage.getItem(key)); if ([3, 6, 12].includes(v)) return v; } catch { /* ignore */ }
  return fallback;
}

export default function App() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [layout, setLayout] = useState<Layout>(() => loadLayout(DEFAULT_LAYOUT));
  const [theme, setTheme] = useState(loadTheme);
  const [panel, setPanel] = useState(false);
  const [modal, setModal] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [full, setFull] = useState<string | null>(null);  // tile shown full screen ("More info")
  const [focused, setFocused] = useState<string | null>(null);  // clicked tile; the rest of the page greys out

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchDashboard());
      setError(null);
    } catch (e) {
      setError(`Could not load the data (${(e as Error).message}).`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, REFRESH_MS); return () => clearInterval(t); }, [load]);
  useEffect(() => { document.documentElement.dataset.theme = theme; saveTheme(theme); }, [theme]);
  useEffect(() => { saveLayout(layout); }, [layout]);
  useEffect(() => {
    // A click anywhere but on a tile (or in a window opened from one) ends the focus.
    const outside = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest(".tile, .modal-bg, .full-bg, .panel")) setFocused(null);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setModal(null); setPanel(false); setFull(null); setFocused(null); } };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const byId = useMemo(() => Object.fromEntries(TILES.map((t) => [t.id, t])), []);
  const visibleCols = layout.cols.map((c) => c.filter((id) => !layout.hidden.includes(id) && byId[id]));

  // Two sortable columns: moving over the other column moves the tile there (onDragOver), dropping
  // reorders within the column (onDragEnd).
  const colOf = (l: Layout, id: string) => {
    const i = COL_IDS.indexOf(id);
    return i >= 0 ? i : l.cols.findIndex((c) => c.includes(id));
  };
  const onDragStart = (e: DragStartEvent) => setDragging(String(e.active.id));
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    setLayout((l) => {
      const a = String(active.id), o = String(over.id);
      const from = colOf(l, a), to = colOf(l, o);
      if (from < 0 || to < 0 || from === to) return l;
      const cols = l.cols.map((c) => c.filter((x) => x !== a)) as [string[], string[]];
      const at = COL_IDS.includes(o) ? cols[to].length : Math.max(0, cols[to].indexOf(o));
      cols[to].splice(at, 0, a);
      return { ...l, cols };
    });
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    if (!over || active.id === over.id) return;
    setLayout((l) => {
      const a = String(active.id), o = String(over.id), c = colOf(l, a);
      if (c < 0 || c !== colOf(l, o) || COL_IDS.includes(o)) return l;
      const cols = [...l.cols] as [string[], string[]];
      cols[c] = arrayMove(cols[c], cols[c].indexOf(a), cols[c].indexOf(o));
      return { ...l, cols };
    });
  };
  const toggleHidden = (id: string) =>
    setLayout((l) => ({ ...l, hidden: l.hidden.includes(id) ? l.hidden.filter((x) => x !== id) : [...l.hidden, id] }));

  const today = new Date().toLocaleDateString("en-CA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className={`app ${dragging ? "dragging" : ""} ${focused ? "focus-mode" : ""}`}>
      <div className="backdrop" aria-hidden />
      <header className="top">
        <div className="brand">
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden className="logo">
            <rect x="7" y="17" width="4" height="8" rx="1.5" /><rect x="14" y="11" width="4" height="14" rx="1.5" /><rect x="21" y="6" width="4" height="19" rx="1.5" className="hi" />
          </svg>
          <div>
            <h1>Manufacturing Dashboard</h1>
            <p className="date">{today} <span className="demo-badge" title="Fictional companies; data simulated in your browser">Demo data</span></p>
          </div>
        </div>
        <div className="top-actions">
          {data && <span className="updated"><span className={`live-dot ${loading ? "busy" : ""}`} />Updated {timeOf(data.generated_at)}</span>}
          <button className="btn ghost" onClick={load} disabled={loading} title="Refresh">
            <svg width="16" height="16" viewBox="0 0 16 16" className={loading ? "spin" : ""} aria-hidden><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <button className="btn ghost" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} title="Light / dark theme">
            {theme === "dark"
              ? <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9 13 13M3 13l1.1-1.1M11.9 4.1 13 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              : <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>}
          </button>
          <button className={`btn ${panel ? "on" : ""}`} onClick={() => setPanel(!panel)}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><rect x="2" y="2" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.5" /><rect x="9" y="2" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.5" /><rect x="2" y="9" width="12" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            Customize
          </button>
        </div>
      </header>

      {panel && <CustomizePanel layout={layout} toggle={toggleHidden} reset={() => setLayout(DEFAULT_LAYOUT)} close={() => setPanel(false)} />}

      {error && <div className="banner">{error}</div>}

      {data ? (
        <>
          <Pulse d={data} />
          <p className="hint">Drag a tile by its handle <span className="grip-inline">⠿</span> to move it, within its column or to the other one. Click a tile to bring it forward; Esc or a click beside it to go back.</p>
          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
            <main className="cols">
              {visibleCols.map((ids, c) => (
                <Column key={COL_IDS[c]} id={COL_IDS[c]} items={ids}>
                  {ids.map((id, i) => (
                    <SortableTile key={id} def={byId[id]} d={data} index={i * 2 + c}
                      onHide={() => toggleHidden(id)} open={setModal} onMore={() => setFull(id)}
                      focused={focused === id} onFocus={() => setFocused(id)} />
                  ))}
                </Column>
              ))}
            </main>
            <DragOverlay dropAnimation={{ duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" }}>
              {dragging ? <div className="tile overlay"><TileHeader def={byId[dragging]} d={data} /></div> : null}
            </DragOverlay>
          </DndContext>
          <footer className="foot-page">
            <p>
              <strong>Demo.</strong> Halden Canada, Halden Industrial and Halden Inc. are fictional (the same companies as the{" "}
              <a href="https://tristan-massicotte.github.io/sales-dashboard/" target="_blank" rel="noreferrer">Sales Dashboard demo ↗</a>).
              Orders, stock, purchases and suppliers are simulated in your browser, sized to those sales. The production version reads the
              ERP every weekday at 7:00. CAD and USD are never added.
            </p>
            <p>
              Built by Tristan Massicotte ·{" "}
              <a href="https://github.com/tristan-massicotte/manufacturing-dashboard" target="_blank" rel="noreferrer">Source and write-up on GitHub ↗</a>
            </p>
          </footer>
        </>
      ) : !error ? <Skeleton /> : null}

      {full === "inventory" && <InventoryDetail onClose={() => setFull(null)} />}
      {full === "otd" && <OtdDetail initialMonths={readMonths("md-otd-months", data?.otd.default_months ?? 6)} onClose={() => setFull(null)} />}

      {modal === "po-monthly" && data && (
        <div className="modal-bg" onClick={() => setModal(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-label="POs issued by month" onClick={(e) => e.stopPropagation()}>
            <div className="modal-h">
              <div><h3>Purchase orders issued by month</h3><p className="muted">Last 12 months · Halden Canada + Halden Industrial · current month paler</p></div>
              <button className="btn ghost" onClick={() => setModal(null)} aria-label="Close">✕</button>
            </div>
            <PoMonthlyModal d={data} />
          </div>
        </div>
      )}
    </div>
  );
}

function Pulse({ d }: { d: Dashboard }) {
  const items = [
    { label: "Inventory", value: d.inventory.total, f: money, sub: d.inventory.source === "live" ? `${money(d.inventory.dormant)} dormant · Canada + Industrial` : "loading…" },
    (() => {
      const so = d.sales_orders, cad = so.currencies.find((c) => c.currency === "CAD"), usd = so.currencies.find((c) => c.currency === "USD");
      return { label: "Left to ship", value: cad?.remaining ?? 0, f: (v: number) => moneyCur(v, "CAD"),
        sub: so.source !== "error" ? `${usd ? `+ ${moneyCur(usd.remaining, "USD")} · ` : ""}${so.count} orders` : "order app unreachable" };
    })(),
    (() => {
      const p = d.otd.periods?.[String(d.otd.default_months ?? 6)];
      return { label: "On-time shipping", value: p?.pct ?? 0, f: pct,
        sub: p ? `target ${p.target}% · ${dec1(p.on_time)} of ${num(p.orders)} orders · ${p.months} months` : "loading…" };
    })(),
  ];
  return (
    <section className="pulse">
      {items.map((it, i) => (
        <div className="pulse-item" key={it.label} style={{ animationDelay: `${i * 70}ms` }}>
          <span className="pulse-l">{it.label}</span>
          <b className="pulse-v"><AnimatedNumber value={it.value} format={it.f} /></b>
          <span className="pulse-s">{it.sub}</span>
        </div>
      ))}
    </section>
  );
}

function TileHeader({ def, d, handle }: { def: TileDef; d: Dashboard; handle?: Record<string, unknown> }) {
  const live = d.sources[def.source] === "live";
  return (
    <div className="tile-h">
      <button className="grip" aria-label={`Move the ${def.title} tile`} {...handle}>
        <svg width="12" height="18" viewBox="0 0 12 18" aria-hidden>{[3, 9].map((x) => [3, 9, 15].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.5" />))}</svg>
      </button>
      <div className="tile-t">
        <h2>{def.title}</h2>
        <p>{def.subtitle}</p>
      </div>
      <div className="badges">
        {!def.core && <span className="badge badge-new">Proposed</span>}
        {live && <span className="badge badge-live" title="Simulated data, refreshed with the page"><span className="live-dot" />Demo</span>}
      </div>
    </div>
  );
}

function Column({ id, items, children }: { id: string; items: string[]; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <SortableContext id={id} items={items} strategy={verticalListSortingStrategy}>
      <div ref={setNodeRef} className={`tile-col ${isOver ? "over" : ""}`}>{children}</div>
    </SortableContext>
  );
}

function SortableTile({ def, d, index, onHide, open, onMore, focused, onFocus }: {
  def: TileDef; d: Dashboard; index: number; onHide: () => void; open: (k: string) => void; onMore: () => void;
  focused: boolean; onFocus: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: def.id });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform), transition,
    animationDelay: `${120 + index * 60}ms`,
  };
  return (
    <section ref={setNodeRef} style={style} className={`tile ${isDragging ? "ghost" : ""} ${focused ? "focused" : ""}`} aria-label={def.title} onClick={onFocus}>
      <TileHeader def={def} d={d} handle={{ ...attributes, ...listeners }} />
      {def.detail && (
        <button className="more-btn" onClick={onMore}>
          More info
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><path d="M7 1.5h3.5V5M10.5 1.5 6.5 5.5M5 10.5H1.5V7M1.5 10.5l4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      )}
      <div className={`tile-tools ${def.detail ? "with-more" : ""}`}>
        <button onClick={onHide} title="Hide" aria-label="Hide the tile">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        </button>
      </div>
      <div className="tile-b">{def.render(d, open)}</div>
    </section>
  );
}

function CustomizePanel({ layout, toggle, reset, close }: { layout: Layout; toggle: (id: string) => void; reset: () => void; close: () => void }) {
  return (
    <div className="panel" role="dialog" aria-label="Customize">
      <div className="panel-h"><b>Tiles shown</b><button className="btn ghost sm" onClick={close} aria-label="Close">✕</button></div>
      {[true, false].filter((core) => TILES.some((t) => t.core === core)).map((core) => (
        <div key={String(core)}>
          {TILES.some((t) => !t.core) && <p className="panel-sec">{core ? "Core" : "Proposed"}</p>}
          {TILES.filter((t) => t.core === core).map((t) => (
            <label key={t.id} className="switch-row">
              <span>{t.title}</span>
              <input type="checkbox" checked={!layout.hidden.includes(t.id)} onChange={() => toggle(t.id)} />
              <span className="switch" aria-hidden />
            </label>
          ))}
        </div>
      ))}
      <button className="btn sm full" onClick={reset}>Reset the layout</button>
    </div>
  );
}

function Skeleton() {
  return (
    <>
      <section className="pulse">{[0, 1, 2].map((i) => <div key={i} className="pulse-item sk" />)}</section>
      <main className="cols">{[0, 1].map((c) => <div key={c} className="tile-col">{[0, 1].map((i) => <div key={i} className="tile sk sk-tile" />)}</div>)}</main>
    </>
  );
}
