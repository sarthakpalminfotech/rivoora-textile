import { addDays, istDay } from '@rivoora/shared';

/**
 * Sprint 26 — demo time. Everything is placed on a forward timeline `x` = days since IST midnight of the first demo day
 * (≈ 14 months ago); `H` is now. An event with `x > H` has not happened yet. Dates are relative to the day the seed runs.
 */
export const DAY_MS = 86_400_000;
const IST_MS = 330 * 60_000;

export class Clock {
  readonly startDay: string;
  readonly startMs: number;
  /** Now, on the timeline. */
  readonly H: number;
  readonly today: string;

  constructor(readonly now: Date, days: number) {
    this.today = istDay(now);
    this.startDay = addDays(this.today, -days);
    this.startMs = Date.parse(`${this.startDay}T00:00:00Z`) - IST_MS;
    this.H = (now.getTime() - this.startMs) / DAY_MS;
  }

  iso(x: number): string {
    return new Date(this.startMs + x * DAY_MS).toISOString();
  }

  /** The IST day of a moment. */
  day(x: number): string {
    return addDays(this.startDay, Math.floor(x));
  }

  /** The moment `hour` (IST, fractional) on the IST day of `x`. */
  at(x: number, hour: number): number {
    return Math.floor(x) + hour / 24;
  }

  /** x of a calendar day (IST midnight). */
  xOfDay(day: string): number {
    return (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${this.startDay}T00:00:00Z`)) / DAY_MS;
  }

  happened(x: number | null | undefined): x is number {
    return x !== null && x !== undefined && x <= this.H;
  }
}

/** Deterministic random numbers (mulberry32), so every demo seed gives the same data for the same day. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  u(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return Math.floor(this.u(a, b + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length)];
  }
  weighted<T>(list: readonly T[], weight: (t: T) => number): T {
    const total = list.reduce((s, t) => s + weight(t), 0);
    let r = this.next() * total;
    for (const t of list) {
      r -= weight(t);
      if (r <= 0) return t;
    }
    return list[list.length - 1];
  }
  sample<T>(list: readonly T[], n: number): T[] {
    const copy = [...list];
    const out: T[] = [];
    while (out.length < n && copy.length) out.push(copy.splice(Math.floor(this.next() * copy.length), 1)[0]);
    return out;
  }
}
