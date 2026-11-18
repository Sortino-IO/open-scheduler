import { HOST_TZ, addDays } from "./time";

export type HebcalItem = {
  title: string;
  date: string;
  category?: string;
  hebrew?: string;
  yomtov?: boolean;
  subcat?: string;
};

export type HolidayBlock = {
  date: string;
  name: string;
  hebrew?: string;
  kind: "yomtov" | "erev" | "closure";
};

/**
 * Israel calendar (Hebcal `i=on`, diaspora off).
 * Block yom tov, the full civil day of erev chag, and a short list of
 * Israeli closures (Purim, Yom HaShoah, Yom HaZikaron, Yom HaAtzmaut).
 * Chol HaMoed, Chanukah, and minor commemorations stay open.
 */
const CLOSURE = [/^Purim$/i, /^Yom HaShoah/i, /^Yom HaZikaron/i, /^Yom HaAtzma/i];

export function blockedDaysFromHebcal(items: HebcalItem[]): HolidayBlock[] {
  const holidays = items.filter((item) => item.category === "holiday" && item.date);
  const yomtovDates = new Set(holidays.filter((item) => item.yomtov).map((item) => item.date));
  const blocks = new Map<string, HolidayBlock>();

  for (const item of holidays) {
    if (!item.yomtov) continue;
    blocks.set(item.date, {
      date: item.date,
      name: item.title,
      hebrew: item.hebrew,
      kind: "yomtov",
    });
  }

  for (const item of holidays) {
    if (!/^Erev\b/i.test(item.title)) continue;
    const next = addDays(item.date, 1, HOST_TZ);
    if (!yomtovDates.has(next) || blocks.has(item.date)) continue;
    blocks.set(item.date, {
      date: item.date,
      name: item.title,
      hebrew: item.hebrew,
      kind: "erev",
    });
  }

  for (const date of yomtovDates) {
    const previous = addDays(date, -1, HOST_TZ);
    if (yomtovDates.has(previous) || blocks.has(previous)) continue;
    const yom = holidays.find((item) => item.date === date && item.yomtov);
    blocks.set(previous, {
      date: previous,
      name: `Erev ${yom?.title ?? "Yom Tov"}`,
      kind: "erev",
    });
  }

  for (const item of holidays) {
    if (blocks.has(item.date)) continue;
    if (!CLOSURE.some((pattern) => pattern.test(item.title))) continue;
    blocks.set(item.date, {
      date: item.date,
      name: item.title,
      hebrew: item.hebrew,
      kind: "closure",
    });
  }

  return [...blocks.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchHebcalItems(start: string, end: string): Promise<HebcalItem[]> {
  const url = new URL("https://www.hebcal.com/hebcal");
  url.searchParams.set("v", "1");
  url.searchParams.set("cfg", "json");
  url.searchParams.set("maj", "on");
  url.searchParams.set("mod", "on");
  url.searchParams.set("min", "off");
  url.searchParams.set("nx", "off");
  url.searchParams.set("mf", "off");
  url.searchParams.set("ss", "off");
  url.searchParams.set("s", "off");
  url.searchParams.set("i", "on");
  url.searchParams.set("geo", "none");
  url.searchParams.set("start", start);
  url.searchParams.set("end", end);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Hebcal responded ${response.status}`);
  const data = (await response.json()) as { items?: HebcalItem[] };
  return data.items ?? [];
}

export function kindLabel(kind: HolidayBlock["kind"]): string {
  if (kind === "yomtov") return "Yom Tov";
  if (kind === "erev") return "Erev chag";
  return "Israel closure";
}
