// Plain SVG/HTML charts, no library. Marks follow the dataviz rules: thin marks, 4px rounded data ends,
// 2px gaps, recessive axes, a hover tooltip on every chart.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

// ---- helpers --------------------------------------------------------------------------

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Counts up from the previous value to the new one. */
export function AnimatedNumber({ value, format, duration = 1100 }: { value: number; format: (v: number) => string; duration?: number }) {
  const [shown, setShown] = useState(reduced() ? value : 0);
  const from = useRef(shown);
  useEffect(() => {
    // Background tab: animation frames don't run, so show the final value at once.
    if (reduced() || document.hidden) { setShown(value); from.current = value; return; }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const e = 1 - Math.pow(1 - p, 4);
      setShown(a + (value - a) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    // Safety net: where animation frames don't run (hidden or throttled page), still land on the value.
    const done = setTimeout(() => { cancelAnimationFrame(raf); setShown(value); from.current = value; }, duration + 400);
    return () => { cancelAnimationFrame(raf); clearTimeout(done); from.current = value; };
  }, [value, duration]);
  return <>{format(shown)}</>;
}

/** True one frame after mount: lets bars grow from their baseline with a CSS transition. */
export function useMounted(delay = 60) {
  const [m, setM] = useState(false);
  useEffect(() => { const t = setTimeout(() => setM(true), delay); return () => clearTimeout(t); }, [delay]);
  return m;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

export function Tooltip({ x, y, children, width }: { x: number; y: number; children: ReactNode; width: number }) {
  const left = Math.max(4, Math.min(x, width - 4));
  return (
    <div className="tip" style={{ left, top: y }}>
      {children}
    </div>
  );
}

// ---- column chart ---------------------------------------------------------------------

export interface Col { label: string; value: number; stack?: number; detail?: ReactNode }

/** Vertical bars. `stack` draws a second segment (e.g. dormant stock) at the base, in gray.
 *  The last column can be marked "in progress" (paler). */
export function ColumnChart({
  data, format, height = 150, avg, avgLabel, lastPartial = false, stackLabel, valueLabel,
}: {
  data: Col[]; format: (v: number) => string; height?: number; avg?: number; avgLabel?: string;
  lastPartial?: boolean; stackLabel?: string; valueLabel?: string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const mounted = useMounted();
  const padL = 44, padB = 22, padT = 8;
  const max = niceMax(Math.max(...data.map((d) => d.value), avg ?? 0));
  const ih = height - padB - padT;
  const iw = Math.max(0, w - padL);
  const slot = data.length ? iw / data.length : 0;
  const bw = Math.max(4, Math.min(28, slot - 2 * Math.max(2, slot * 0.18)));
  const y = (v: number) => padT + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];
  const every = Math.ceil(data.length / Math.max(1, Math.floor(iw / 44)));

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      {w > 0 && (
        <svg width={w} height={height} role="img">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={w} y1={y(t)} y2={y(t)} className={t === 0 ? "axis" : "gridline"} />
              <text x={padL - 8} y={y(t) + 4} className="tick" textAnchor="end">{format(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = padL + i * slot + (slot - bw) / 2;
            const h = (d.value / max) * ih;
            const sh = d.stack ? (d.stack / max) * ih : 0;
            const partial = lastPartial && i === data.length - 1;
            return (
              <g key={i} className={`col ${hover === i ? "on" : ""} ${hover !== null && hover !== i ? "dim" : ""}`}>
                <g style={{ transform: `scaleY(${mounted ? 1 : 0})`, transformOrigin: `0 ${padT + ih}px`, transition: `transform .9s cubic-bezier(.2,.8,.2,1) ${i * 35}ms` }}>
                  <rect x={x} y={y(d.value)} width={bw} height={Math.max(0, h - sh - (sh ? 2 : 0))} rx={Math.min(4, bw / 2)}
                    className={partial ? "bar partial" : "bar"} />
                  {sh > 0 && <rect x={x} y={padT + ih - sh} width={bw} height={sh} rx={Math.min(3, bw / 2)} className="bar-gray" />}
                </g>
                {i % every === 0 && <text x={x + bw / 2} y={height - 6} className="tick" textAnchor="middle">{d.label}</text>}
                <rect x={padL + i * slot} y={0} width={slot} height={height} fill="transparent" onMouseEnter={() => setHover(i)} />
              </g>
            );
          })}
          {avg !== undefined && (
            <g className="ref">
              <line x1={padL} x2={w} y1={y(avg)} y2={y(avg)} />
              <text x={w - 2} y={y(avg) - 5} textAnchor="end">{avgLabel ?? "avg."} {format(avg)}</text>
            </g>
          )}
        </svg>
      )}
      {hover !== null && w > 0 && (
        <Tooltip x={padL + hover * slot + slot / 2} y={y(data[hover].value) - 8} width={w}>
          <div className="tip-h">{data[hover].label}{lastPartial && hover === data.length - 1 ? " (en cours)" : ""}</div>
          <div className="tip-r"><i className="sw sw-blue" />{valueLabel ?? "Value"}<b>{format(data[hover].value)}</b></div>
          {data[hover].stack !== undefined && (
            <div className="tip-r"><i className="sw sw-gray" />{stackLabel}<b>{format(data[hover].stack!)}</b></div>
          )}
          {data[hover].detail}
        </Tooltip>
      )}
    </div>
  );
}

// ---- line chart ------------------------------------------------------------------------

export function LineChart({
  data, format, height = 150, target, targetLabel, min = 0, max = 100,
}: {
  data: { label: string; value: number }[]; format: (v: number) => string; height?: number;
  target?: number; targetLabel?: string; min?: number; max?: number;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 40, padB = 22, padT = 10, padR = 8;
  const iw = Math.max(0, w - padL - padR), ih = height - padB - padT;
  const x = (i: number) => padL + (data.length > 1 ? (i / (data.length - 1)) * iw : iw / 2);
  const y = (v: number) => padT + ih - ((v - min) / (max - min)) * ih;
  const path = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join("");
  const area = `${path}L${x(data.length - 1)},${padT + ih}L${x(0)},${padT + ih}Z`;
  const ticks = [min, (min + max) / 2, max];
  const every = Math.ceil(data.length / Math.max(1, Math.floor(iw / 44)));
  const pick = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect();
    const i = Math.round(((clientX - r.left - padL) / iw) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  };

  return (
    <div className="chart" ref={ref}>
      {w > 0 && (
        <svg width={w} height={height} onMouseMove={(e) => pick(e.clientX, e.currentTarget)} onMouseLeave={() => setHover(null)}>
          <defs>
            <linearGradient id="area-g" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--series-1)" stopOpacity=".28" />
              <stop offset="1" stopColor="var(--series-1)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} className={t === min ? "axis" : "gridline"} />
              <text x={padL - 8} y={y(t) + 4} className="tick" textAnchor="end">{format(t)}</text>
            </g>
          ))}
          {target !== undefined && (
            <g className="ref ref-good">
              <line x1={padL} x2={w - padR} y1={y(target)} y2={y(target)} />
              <text x={w - padR} y={y(target) - 5} textAnchor="end">{targetLabel ?? "target"} {format(target)}</text>
            </g>
          )}
          <path d={area} fill="url(#area-g)" className="area" />
          <path d={path} className="line draw" pathLength={1} />
          {data.map((d, i) => (
            i % every === 0 ? <text key={i} x={x(i)} y={height - 6} className="tick" textAnchor="middle">{d.label}</text> : null
          ))}
          <circle cx={x(data.length - 1)} cy={y(data[data.length - 1].value)} r={4} className="dot-end" />
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + ih} className="crosshair" />
              <circle cx={x(hover)} cy={y(data[hover].value)} r={5} className="dot-hover" />
            </g>
          )}
        </svg>
      )}
      {hover !== null && w > 0 && (
        <Tooltip x={x(hover)} y={y(data[hover].value) - 12} width={w}>
          <div className="tip-h">{data[hover].label}</div>
          <div className="tip-r"><i className="sw sw-blue" />Value<b>{format(data[hover].value)}</b></div>
          {target !== undefined && <div className="tip-r muted">Vs target<b>{(data[hover].value - target > 0 ? "+" : "") + format(data[hover].value - target)}</b></div>}
        </Tooltip>
      )}
    </div>
  );
}

// ---- trend (line + area, one point per month) ---------------------------------------------

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Month-by-month trend: soft area under a line, a dot per month, the high point as a ring, the latest
 *  point emphasised with its change vs the previous month. `base` (optional) is drawn as a gray area at
 *  the bottom (e.g. dormant stock, which is part of the total). */
export function TrendChart({
  data, format, height = 230, valueLabel = "Total", baseLabel, lastLabel = "today", extraTip,
}: {
  data: { date: string; value: number; base?: number }[]; format: (v: number) => string; height?: number;
  valueLabel?: string; baseLabel?: string; lastLabel?: string; extraTip?: (i: number) => ReactNode;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 52, padR = 22, padT = 18, padB = 40;
  const iw = Math.max(0, w - padL - padR), ih = height - padT - padB;
  // Round steps (0,5 M$, 250 k$…) so the axis reads like the reference: 0 · 0,5 · 1 · 1,5 · 2 M$.
  const top = Math.max(...data.map((d) => d.value)) * 1.04 || 1;
  const raw = top / 6, p10 = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p10).find((s) => s >= raw)!;
  const max = Math.ceil(top / step) * step;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, k) => k * step);
  const x = (i: number) => padL + (data.length > 1 ? (i / (data.length - 1)) * iw : iw / 2);
  const y = (v: number) => padT + ih - (v / max) * ih;
  const last = data.length - 1;
  const months = data.map((d) => new Date(d.date + "T12:00:00"));

  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join("");
  const area = `${line}L${x(last)},${y(0)}L${x(0)},${y(0)}Z`;
  const hasBase = data.some((d) => d.base !== undefined);
  const baseLine = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.base ?? 0).toFixed(1)}`).join("");
  const baseArea = `${baseLine}L${x(last)},${y(0)}L${x(0)},${y(0)}Z`;

  let peak = 0;
  data.forEach((d, i) => { if (d.value > data[peak].value) peak = i; });
  const showPeak = peak !== last;
  const delta = last > 0 && data[last - 1].value ? (data[last].value / data[last - 1].value - 1) * 100 : null;
  const deltaAbs = delta === null ? 0 : Math.abs(delta);
  const deltaNum = deltaAbs < 1 ? deltaAbs.toFixed(1) : String(Math.round(deltaAbs));
  const deltaText = delta === null ? "" : `≈ ${delta >= 0 ? "+" : "−"}${deltaNum}% vs ${MONTHS_ABBR[months[last - 1].getMonth()]}`;
  // Month labels: every other one when space is tight; the latest is always shown.
  const every = iw / Math.max(1, last) < 36 ? 2 : 1;
  // Annotation goes on the side of the point with more room.
  const annBelow = y(data[last].value) < padT + ih * 0.55;
  const annY = annBelow ? y(data[last].value) + 30 : y(data[last].value) - 18;

  const pick = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect();
    const i = Math.round(((clientX - r.left - padL) / iw) * last);
    setHover(Math.max(0, Math.min(last, i)));
  };
  const monthName = (i: number) => (i === last ? lastLabel : `${MONTHS_LONG[months[i].getMonth()]} ${months[i].getFullYear()}`);

  return (
    <div className="chart trend" ref={ref}>
      {w > 0 && (
        <svg width={w} height={height} onMouseMove={(e) => pick(e.clientX, e.currentTarget)} onMouseLeave={() => setHover(null)}
          role="img" aria-label={`${valueLabel}, last ${data.length} months. Latest value ${format(data[last].value)}${deltaText ? ", " + deltaText : ""}.`}>
          {ticks.map((t, k) => (
            <g key={k}>
              <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} className={k === 0 ? "t-axis" : "t-grid"} />
              <text x={padL - 10} y={y(t) + 4} className="t-tick" textAnchor="end">{format(t)}</text>
            </g>
          ))}
          <path d={area} className="t-area" />
          {hasBase && <path d={baseArea} className="t-base" />}
          {hasBase && <path d={baseLine} className="t-base-line" />}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={y(0)} className="t-cross" />}
          <path d={line} className="t-line" pathLength={1} />
          {data.map((d, i) => {
            if (i === last || (showPeak && i === peak)) return null;
            return <circle key={i} cx={x(i)} cy={y(d.value)} r={hover === i ? 6 : 4.5} className="t-dot" style={{ animationDelay: `${300 + i * 70}ms` }} />;
          })}
          {showPeak && (
            <g className="t-pop" style={{ animationDelay: `${300 + peak * 70}ms` }}>
              <circle cx={x(peak)} cy={y(data[peak].value)} r={8} className="t-peak" />
              <text x={x(peak)} y={y(data[peak].value) - 15} textAnchor="middle" className="t-peak-l">Peak</text>
            </g>
          )}
          <g className="t-pop" style={{ animationDelay: `${300 + last * 70}ms` }}>
            <circle cx={x(last)} cy={y(data[last].value)} r={9} className="t-last" />
            {deltaText && <text x={x(last) + 6} y={annY} textAnchor="end" className="t-ann">{deltaText}</text>}
          </g>
          {data.map((_, i) => ((last - i) % every !== 0 ? null :
            <g key={i}>
              <text x={x(i)} y={y(0) + 20} textAnchor="middle" className={`t-month ${i === last ? "on" : ""}`}>{MONTHS_SHORT[months[i].getMonth()]}</text>
              {(i < every || months[i].getMonth() < every) && (
                <text x={x(i)} y={y(0) + 34} textAnchor="middle" className="t-year">{months[i].getFullYear()}</text>
              )}
            </g>
          ))}
        </svg>
      )}
      {hover !== null && w > 0 && (
        <Tooltip x={x(hover)} y={y(data[hover].value) - 16} width={w}>
          <div className="tip-h">{monthName(hover)}</div>
          <div className="tip-r"><i className="sw sw-blue" />{valueLabel}<b>{format(data[hover].value)}</b></div>
          {data[hover].base !== undefined && (
            <>
              <div className="tip-r"><i className="sw sw-gray" />{baseLabel}<b>{format(data[hover].base!)}</b></div>
              <div className="tip-r muted">Dormant share<b>{Math.round((data[hover].base! / data[hover].value) * 100)}%</b></div>
            </>
          )}
          {extraTip?.(hover)}
          {hover > 0 && (
            <div className="tip-r muted">vs previous month<b>{(() => { const p = (data[hover].value / data[hover - 1].value - 1) * 100; return `${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(1)}%`; })()}</b></div>
          )}
        </Tooltip>
      )}
      {hasBase && (
        <div className="t-legend">
          <span><i className="lg-line" />{valueLabel}</span>
          <span><i className="lg-gray" />{baseLabel}</span>
        </div>
      )}
    </div>
  );
}

// ---- segmented (100 %) horizontal bar ---------------------------------------------------

export interface Seg { key: string; label: string; value: number; color: string; note?: string }

export function SegmentBar({ segs, format, height = 14, legend = true }: { segs: Seg[]; format: (v: number) => string; height?: number; legend?: boolean }) {
  const total = segs.reduce((s, x) => s + x.value, 0) || 1;
  const [hover, setHover] = useState<string | null>(null);
  const mounted = useMounted(120);
  return (
    <div className="segbar-wrap">
      <div className="segbar" style={{ height }}>
        {segs.map((s, i) => (
          <div key={s.key} className={`seg ${hover && hover !== s.key ? "dim" : ""}`}
            style={{ flexGrow: mounted ? s.value / total : 0.0001, background: s.color, transitionDelay: `${i * 80}ms` }}
            onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)}
            title={`${s.label}: ${format(s.value)} (${Math.round((s.value / total) * 100)}%)`} />
        ))}
      </div>
      {legend && (
        <div className="seg-legend">
          {segs.map((s) => (
            <div key={s.key} className={`seg-l ${hover === s.key ? "on" : ""}`} onMouseEnter={() => setHover(s.key)} onMouseLeave={() => setHover(null)}>
              <i style={{ background: s.color }} />
              <span className="seg-name">{s.label}</span>
              <b>{format(s.value)}</b>
              <span className="muted">{Math.round((s.value / total) * 100)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- small meter -------------------------------------------------------------------------

export function Meter({ value, max, tone }: { value: number; max: number; tone: string }) {
  const mounted = useMounted(150);
  return (
    <div className="meter">
      <div className="meter-fill" style={{ width: mounted ? `${Math.min(100, (value / max) * 100)}%` : 0, background: `var(--${tone})` }} />
    </div>
  );
}

// ---- donut (part of a whole, ≤ 7 slices) -----------------------------------------------------

export interface Slice { key: string; label: string; value: number; colour: string }

/** Ring of slices with the total in the middle; hovering a slice (or its legend row, via `active`) shows
 *  that slice's value and share in the middle instead. 2px gaps between slices, grows in on load. */
export function Donut({ slices, total, format, centerLabel, active, onActive, size = 188 }: {
  slices: Slice[]; total: number; format: (v: number) => string; centerLabel: string;
  active: string | null; onActive: (k: string | null) => void; size?: number;
}) {
  const mounted = useMounted(120);
  const stroke = 22, r = (size - stroke) / 2 - 4, c = 2 * Math.PI * r;
  const sum = slices.reduce((t, x) => t + x.value, 0) || 1;
  const gap = slices.length > 1 ? 2.5 : 0;
  let start = 0;
  const hit = active ? slices.find((x) => x.key === active) : undefined;
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
        aria-label={`${centerLabel}: ${format(total)}. ` + slices.map((x) => `${x.label} ${Math.round((x.value / sum) * 100)}%`).join(", ")}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-hi)" strokeWidth={stroke} />
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {slices.map((x, i) => {
            const len = (x.value / sum) * c;
            const dash = Math.max(0, len - gap);
            const el = (
              <circle key={x.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={x.colour}
                strokeWidth={active === x.key ? stroke + 6 : stroke}
                strokeDasharray={`${mounted ? dash : 0} ${c}`} strokeDashoffset={-start}
                className={`donut-seg ${active && active !== x.key ? "dim" : ""}`}
                style={{ transitionDelay: mounted ? `${i * 70}ms` : "0ms" }}
                onMouseEnter={() => onActive(x.key)} onMouseLeave={() => onActive(null)} />
            );
            start += len;
            return el;
          })}
        </g>
      </svg>
      <div className="donut-mid">
        {hit ? (
          <>
            <b>{format(hit.value)}</b>
            <span>{Math.round((hit.value / sum) * 1000) / 10}%</span>
            <small title={hit.label}>{hit.label}</small>
          </>
        ) : (
          <>
            <b><AnimatedNumber value={total} format={format} /></b>
            <small>{centerLabel}</small>
          </>
        )}
      </div>
    </div>
  );
}
