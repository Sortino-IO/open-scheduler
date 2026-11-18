import type { AdminState } from "./store";

/** The per-date availability lists. Shared by the admin API (to save) and the admin panel (to show the change at once). */
export type DaySettings = Pick<AdminState, "manualBlocks" | "manualOpens" | "usOpenDates">;

function withDate(list: string[], date: string, on: boolean): string[] {
  const rest = list.filter((item) => item !== date);
  return on ? [...rest, date].sort() : rest;
}

/** Blocking a day clears its one-off opens; they could never apply under a block. */
export function withDayBlocked<T extends DaySettings>(settings: T, date: string, blocked: boolean): T {
  return {
    ...settings,
    manualBlocks: withDate(settings.manualBlocks, date, blocked),
    manualOpens: blocked ? withDate(settings.manualOpens, date, false) : settings.manualOpens,
    usOpenDates: blocked ? withDate(settings.usOpenDates, date, false) : settings.usOpenDates,
  };
}

/** Opening a day once (daytime) lifts a manual block on it. */
export function withDayOpen<T extends DaySettings>(settings: T, date: string, open: boolean): T {
  return {
    ...settings,
    manualOpens: withDate(settings.manualOpens, date, open),
    manualBlocks: open ? withDate(settings.manualBlocks, date, false) : settings.manualBlocks,
  };
}

/** Opening US evenings on a day lifts a manual block on it. */
export function withDayUsOpen<T extends DaySettings>(settings: T, date: string, open: boolean): T {
  return {
    ...settings,
    usOpenDates: withDate(settings.usOpenDates, date, open),
    manualBlocks: open ? withDate(settings.manualBlocks, date, false) : settings.manualBlocks,
  };
}
