/**
 * Second line that tells same-named calendars apart: the owner address, or a short id for
 * shared and subscribed calendars, whose ids are long random strings.
 */
export function calendarDetail(id: string): string {
  const generated = id.match(/^([^@]+)@(group|import)\.calendar\.google\.com$/);
  if (!generated) return id;
  return `${generated[2] === "group" ? "Shared" : "Subscribed"} calendar · ${generated[1].slice(0, 10)}`;
}
