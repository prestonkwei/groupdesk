import { TIME_ZONE } from "@/lib/utils";

/**
 * Reply targets, measured in school hours: Mon–Fri, 8am–4pm in TIME_ZONE by
 * default (NEXT_PUBLIC_SCHOOL_HOURS="08:00-16:00" to change). Holidays aren't
 * modelled; a target that falls in a break just shows as overdue.
 */
const [openMin, closeMin] = (process.env.NEXT_PUBLIC_SCHOOL_HOURS || "08:00-16:00")
  .split("-")
  .map((t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  });
const WORKDAY = closeMin - openMin;

/** Target time to reply, in school hours, by priority. "none" = 1 school day. */
export const SLA_TARGET_HOURS: Record<string, number> = {
  p0: 2,
  p1: 4,
  p2: WORKDAY / 60,
  none: WORKDAY / 60,
  p3: (2 * WORKDAY) / 60,
};

export function slaTargetLabel(priority: string) {
  const h = SLA_TARGET_HOURS[priority] ?? SLA_TARGET_HOURS.none;
  const days = h / (WORKDAY / 60);
  return Number.isInteger(days) && days >= 1 ? `${days} school day${days === 1 ? "" : "s"}` : `${h} school hours`;
}

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  weekday: "short",
  hour: "numeric",
  minute: "numeric",
  hourCycle: "h23",
});

function local(date: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    weekday: p.weekday as string,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

/** The UTC instant of a wall-clock time in TIME_ZONE (DST-safe). */
function zoned(y: number, m: number, d: number, minutes: number) {
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  const l = local(new Date(guess));
  const asUtc = Date.UTC(l.y, l.m - 1, l.d, 0, l.minutes);
  return new Date(guess - (asUtc - guess));
}

function isSchoolDay(weekday: string) {
  return weekday !== "Sat" && weekday !== "Sun";
}

/** Open/close instants for the local day containing `date`, or null on weekends. */
function windowOf(date: Date) {
  const l = local(date);
  if (!isSchoolDay(l.weekday)) return { l, win: null };
  return { l, win: [zoned(l.y, l.m, l.d, openMin), zoned(l.y, l.m, l.d, closeMin)] as const };
}

function nextDayStart(l: { y: number; m: number; d: number }) {
  const next = new Date(Date.UTC(l.y, l.m - 1, l.d + 1));
  return zoned(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0);
}

/** `from` plus `minutes` of school time. */
export function addSchoolMinutes(from: Date, minutes: number): Date {
  let cursor = new Date(from);
  let remaining = minutes;
  for (let i = 0; i < 400; i++) {
    const { l, win } = windowOf(cursor);
    if (win) {
      const [open, close] = win;
      if (cursor < open) cursor = open;
      if (cursor < close) {
        const available = (close.getTime() - cursor.getTime()) / 60000;
        if (remaining <= available) return new Date(cursor.getTime() + remaining * 60000);
        remaining -= available;
      }
    }
    cursor = nextDayStart(l);
  }
  return cursor;
}

/** School time between two instants, in seconds. */
export function schoolSecondsBetween(a: Date, b: Date): number {
  if (b <= a) return 0;
  let total = 0;
  let cursor = new Date(a);
  for (let i = 0; i < 400 && cursor < b; i++) {
    const { l, win } = windowOf(cursor);
    if (win) {
      const start = Math.max(cursor.getTime(), win[0].getTime());
      const end = Math.min(b.getTime(), win[1].getTime());
      if (end > start) total += (end - start) / 1000;
    }
    cursor = nextDayStart(l);
  }
  return total;
}

/** When a reply is due for a ticket that has been waiting since `since`. */
export function replyDueAt(since: Date, priority: string) {
  return addSchoolMinutes(since, (SLA_TARGET_HOURS[priority] ?? SLA_TARGET_HOURS.none) * 60);
}

export type SlaState = { tone: "overdue" | "soon" | "ok"; label: string; title: string };

/** "Overdue" / "Due 2:30 PM" / "Due Mon 9 AM", for a ticket waiting on us. */
export function slaState(dueAt: Date, now = new Date()): SlaState {
  const title = `Reply due ${dueAt.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  })}`;
  if (dueAt <= now) return { tone: "overdue", label: "Overdue", title };
  const sameDay = local(dueAt).d === local(now).d && dueAt.getTime() - now.getTime() < 86_400_000;
  const time = dueAt.toLocaleString("en-US", {
    hour: "numeric",
    minute: dueAt.getMinutes() ? "2-digit" : undefined,
    timeZone: TIME_ZONE,
  });
  const label = sameDay
    ? `Due ${time}`
    : `Due ${dueAt.toLocaleString("en-US", { weekday: "short", timeZone: TIME_ZONE })} ${time}`;
  // "Soon" = inside the last school hour before the target.
  const soon = schoolSecondsBetween(now, dueAt) <= 3600;
  return { tone: soon ? "soon" : "ok", label, title };
}
