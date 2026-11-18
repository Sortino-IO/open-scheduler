/** Sunday-first cells for a Gregorian month. `null` pads the leading/trailing week. */
export function monthMatrix(month: string): (string | null)[] {
  const [year, mon] = month.split("-").map(Number);
  if (!year || !mon || mon < 1 || mon > 12) return [];
  const firstDow = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let day = 1; day <= days; day++) {
    cells.push(`${month}-${String(day).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function monthTitle(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, mon - 1, 1)));
}

export function civilDateLabel(isoDate: string): string {
  const [year, mon, day] = isoDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, mon - 1, day)));
}
