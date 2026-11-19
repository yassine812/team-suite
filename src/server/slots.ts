/** Free-slot arithmetic for booking pages. Pure, so it is unit tested. */

export interface Window {
  day: number; // 0 Sunday … 6 Saturday
  start: string; // "09:00"
  end: string; // "17:00"
}

/** Minutes the zone is ahead of UTC at an instant. */
function offsetMinutes(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** The UTC instant of a wall-clock time on a date in a zone. */
export function zonedTime(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm] = time.split(":").map(Number) as [number, number];
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const first = new Date(guess.getTime() - offsetMinutes(timeZone, guess) * 60000);
  return new Date(guess.getTime() - offsetMinutes(timeZone, first) * 60000);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function computeSlots(opts: {
  date: string;
  timeZone: string;
  windows: Window[];
  duration: number;
  buffer: number;
  minNotice: number;
  horizonDays: number;
  busy: { start: string; end: string }[];
  now: Date;
}): string[] {
  const [y, m, d] = opts.date.split("-").map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const earliest = opts.now.getTime() + opts.minNotice * 60000;
  const latest = opts.now.getTime() + opts.horizonDays * 86400000;
  const busy = opts.busy.map((b) => [Date.parse(b.start) - opts.buffer * 60000, Date.parse(b.end) + opts.buffer * 60000] as const);
  const out: string[] = [];
  for (const w of opts.windows.filter((w) => w.day === weekday)) {
    const winEnd = zonedTime(opts.date, w.end, opts.timeZone).getTime();
    let s = zonedTime(opts.date, w.start, opts.timeZone).getTime();
    const step = (opts.duration + opts.buffer) * 60000;
    for (; s + opts.duration * 60000 <= winEnd; s += step) {
      const e = s + opts.duration * 60000;
      if (s < earliest || s > latest) continue;
      if (busy.some(([bs, be]) => bs < e && be > s)) continue;
      out.push(new Date(s).toISOString());
    }
  }
  return [...new Set(out)].sort();
}
