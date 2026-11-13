// English (Canada) formatting. CAD shows as "$", USD as "US$"; the two are never added.

const L = "en-CA";
const compact = new Intl.NumberFormat(L, { style: "currency", currency: "CAD", notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat(L, { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
const int = new Intl.NumberFormat(L, { maximumFractionDigits: 0 });
const one = new Intl.NumberFormat(L, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const money = (v: number) => compact.format(v);
const compact2 = new Intl.NumberFormat(L, { style: "currency", currency: "CAD", notation: "compact", maximumFractionDigits: 2 });
/** Headline figures: "$1.55M" (one more digit than `money`). */
export const moneyHero = (v: number) => compact2.format(v);

const PREFIX: Record<string, string> = { CAD: "$", USD: "US$" };
const plain2 = new Intl.NumberFormat(L, { notation: "compact", maximumFractionDigits: 2 });
const plain0 = new Intl.NumberFormat(L, { maximumFractionDigits: 0 });
/** Amount that always names its currency (two currencies on screen): "$1.09M", "US$806K". */
export const moneyCur = (v: number, cur: string) => `${PREFIX[cur] ?? `${cur} `}${plain2.format(v)}`;
export const moneyCurFull = (v: number, cur: string) => `${PREFIX[cur] ?? `${cur} `}${plain0.format(v)}`;
/** Axis ticks like "$1.5M", "$500K", "0". */
export const moneyAxis = (v: number) => {
  if (v === 0) return "0";
  if (Math.abs(v) >= 1e6) return `$${one.format(v / 1e6).replace(/\.0$/, "")}M`;
  return `$${int.format(v / 1e3)}K`;
};
export const moneyFull = (v: number) => full.format(v);
export const num = (v: number) => int.format(v);
export const dec1 = (v: number) => one.format(v);
export const pct = (v: number) => `${one.format(v)}%`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDate(iso: string) {
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
/** "7:00 AM" (no trailing period, so it can end a sentence). */
export function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
