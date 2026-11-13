// Tile layout, remembered per browser: two independent columns (each stacks its tiles with no gaps) and the
// hidden tiles. A tile added to the code later shows up at the end of the shorter column.

export interface Layout { cols: [string[], string[]]; hidden: string[] }

const KEY = "md-layout-v3";
const OLD_KEY = "md-layout-v2";  // earlier default order: only its hidden tiles are carried over

export function normalize(saved: Partial<Layout>, defaults: Layout): Layout {
  const known = new Set([...defaults.cols[0], ...defaults.cols[1]]);
  const seen = new Set<string>();
  const base = saved.cols ?? defaults.cols;  // no saved columns (first visit, or the old one-grid layout)
  const cols = [0, 1].map((i) => (base[i] ?? []).filter((id) => known.has(id) && !seen.has(id) && seen.add(id))) as [string[], string[]];
  for (const id of known) {
    if (!seen.has(id)) (cols[0].length <= cols[1].length ? cols[0] : cols[1]).push(id);
  }
  return { cols, hidden: (saved.hidden ?? defaults.hidden).filter((id) => known.has(id)) };
}

export function loadLayout(defaults: Layout): Layout {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalize(JSON.parse(raw) as Partial<Layout>, defaults);
    const old = localStorage.getItem(OLD_KEY);
    if (old) return normalize({ hidden: (JSON.parse(old) as { hidden?: string[] }).hidden ?? [] }, defaults);
  } catch {
    /* unreadable or blocked storage: defaults */
  }
  return defaults;
}

export function saveLayout(l: Layout) {
  try {
    localStorage.setItem(KEY, JSON.stringify(l));
  } catch {
    /* private window: layout simply isn't remembered */
  }
}

export function loadTheme(): "dark" | "light" {
  try {
    const t = localStorage.getItem("md-theme");
    if (t === "dark" || t === "light") return t;
  } catch { /* ignore */ }
  return "light"; // default for a first visit; the toggle choice is remembered
}
export function saveTheme(t: "dark" | "light") {
  try { localStorage.setItem("md-theme", t); } catch { /* ignore */ }
}
