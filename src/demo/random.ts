// Seeded random numbers: the same seed always gives the same demo data.

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(...parts: (number | string)[]): number {
  let h = 2166136261;
  for (const ch of parts.join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export class Rng {
  private r: () => number;
  constructor(...seed: (number | string)[]) {
    this.r = mulberry32(hash("halden-mfg", ...seed));
  }
  next() { return this.r(); }
  between(lo: number, hi: number) { return lo + this.r() * (hi - lo); }
  int(lo: number, hi: number) { return lo + Math.floor(this.r() * (hi - lo + 1)); }
  chance(p: number) { return this.r() < p; }
  pick<T>(xs: readonly T[]): T { return xs[Math.floor(this.r() * xs.length)]; }
  weighted<T>(xs: readonly (readonly [T, number])[]): T {
    const total = xs.reduce((s, [, w]) => s + w, 0);
    let u = this.r() * total;
    for (const [x, w] of xs) if ((u -= w) < 0) return x;
    return xs[xs.length - 1][0];
  }
  normal() {
    const u = Math.max(1e-9, this.r());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.r());
  }
  logNormal(median: number, sigma: number) { return median * Math.exp(sigma * this.normal()); }
  shuffle<T>(xs: T[]): T[] {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}
