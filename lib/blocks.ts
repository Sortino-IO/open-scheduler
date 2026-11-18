import { HOST_TZ, addDays, eachDate, weekdayIndex } from "./time";

export type TimeBlock = {
  id: string;
  date: string;
  startMinute: number;
  endMinute: number;
};

export type RecurringFrequency = "weekly" | "monthly" | "yearly";

export type RecurringBlock = {
  id: string;
  frequency: RecurringFrequency;
  /** First occurrence (Israel civil date). */
  anchorDate: string;
  /** Null = block the whole day. */
  startMinute: number | null;
  endMinute: number | null;
  /** Inclusive end date, or null for no end. */
  until: string | null;
};

export type RangeBlock = {
  date: string;
  startMinute: number;
  endMinute: number;
  wholeDay: boolean;
  source: "manual" | "time" | "recurring";
  id?: string;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Next occurrence after `date` for the given frequency (Israel calendar). */
export function nextOccurrence(date: string, frequency: RecurringFrequency): string {
  if (frequency === "weekly") return addDays(date, 7, HOST_TZ);
  const [y, m, d] = date.split("-").map(Number);
  if (frequency === "monthly") {
    let nm = m + 1;
    let ny = y;
    if (nm > 12) {
      nm = 1;
      ny += 1;
    }
    const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    return `${ny}-${pad(nm)}-${pad(Math.min(d, last))}`;
  }
  // yearly — same month/day, Feb 29 → Feb 28 on non-leap years
  const last = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
  return `${y + 1}-${pad(m)}-${pad(Math.min(d, last))}`;
}

export function eachOccurrence(block: RecurringBlock, from: string, to: string): string[] {
  const dates: string[] = [];
  let cursor = block.anchorDate;
  let guard = 0;
  while (cursor < from && guard < 600) {
    cursor = nextOccurrence(cursor, block.frequency);
    guard += 1;
  }
  while (cursor <= to && guard < 1200) {
    if (block.until && cursor > block.until) break;
    if (cursor >= from) dates.push(cursor);
    cursor = nextOccurrence(cursor, block.frequency);
    guard += 1;
  }
  return dates;
}

/** Expand one-off time blocks + recurring into concrete ranges in [from, to]. */
export function expandBlocks(input: {
  manualBlocks: string[];
  timeBlocks: TimeBlock[];
  recurringBlocks: RecurringBlock[];
  from: string;
  to: string;
}): { wholeDays: Set<string>; ranges: RangeBlock[] } {
  const wholeDays = new Set<string>();
  const ranges: RangeBlock[] = [];

  for (const date of input.manualBlocks) {
    if (date < input.from || date > input.to) continue;
    wholeDays.add(date);
    ranges.push({ date, startMinute: 0, endMinute: 24 * 60, wholeDay: true, source: "manual" });
  }

  for (const block of input.timeBlocks) {
    if (block.date < input.from || block.date > input.to) continue;
    if (block.startMinute <= 0 && block.endMinute >= 24 * 60) {
      wholeDays.add(block.date);
      ranges.push({
        date: block.date,
        startMinute: 0,
        endMinute: 24 * 60,
        wholeDay: true,
        source: "time",
        id: block.id,
      });
    } else {
      ranges.push({
        date: block.date,
        startMinute: block.startMinute,
        endMinute: block.endMinute,
        wholeDay: false,
        source: "time",
        id: block.id,
      });
    }
  }

  for (const block of input.recurringBlocks) {
    for (const date of eachOccurrence(block, input.from, input.to)) {
      const whole = block.startMinute == null || block.endMinute == null;
      if (whole) {
        wholeDays.add(date);
        ranges.push({
          date,
          startMinute: 0,
          endMinute: 24 * 60,
          wholeDay: true,
          source: "recurring",
          id: block.id,
        });
      } else {
        ranges.push({
          date,
          startMinute: block.startMinute as number,
          endMinute: block.endMinute as number,
          wholeDay: false,
          source: "recurring",
          id: block.id,
        });
      }
    }
  }

  return { wholeDays, ranges };
}

export function rangesForDate(ranges: RangeBlock[], date: string): RangeBlock[] {
  return ranges.filter((range) => range.date === date);
}

/** True when [startMinute, endMinute) overlaps any non-whole-day range on that date. */
export function overlapsRanges(
  date: string,
  startMinute: number,
  endMinute: number,
  ranges: RangeBlock[],
): boolean {
  return ranges.some(
    (range) =>
      range.date === date &&
      !range.wholeDay &&
      startMinute < range.endMinute &&
      endMinute > range.startMinute,
  );
}

export function describeRecurring(block: RecurringBlock): string {
  const freq =
    block.frequency === "weekly" ? "every week" : block.frequency === "monthly" ? "every month" : "every year";
  const when =
    block.startMinute == null || block.endMinute == null
      ? "all day"
      : `${minutesToClock(block.startMinute)}–${minutesToClock(block.endMinute)}`;
  const until = block.until ? ` until ${block.until}` : "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekdayIndex(block.anchorDate, HOST_TZ)];
  if (block.frequency === "weekly") return `${weekday} ${when}, ${freq}${until}`;
  if (block.frequency === "monthly") return `Day ${Number(block.anchorDate.slice(-2))} ${when}, ${freq}${until}`;
  return `${block.anchorDate.slice(5)} ${when}, ${freq}${until}`;
}

function minutesToClock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Candidate hour starts for the day panel (Israel day, 08:00–24:00 in 30-min steps). */
export function dayPanelHours(): number[] {
  const hours: number[] = [];
  for (let m = 8 * 60; m < 24 * 60; m += 30) hours.push(m);
  return hours;
}

export function horizonDates(today: string, days = 370): { from: string; to: string } {
  return { from: today, to: addDays(today, days, HOST_TZ) };
}

export function allDatesInMonth(month: string): string[] {
  const [year, mon] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return eachDate(`${month}-01`, `${month}-${pad(last)}`, HOST_TZ);
}
