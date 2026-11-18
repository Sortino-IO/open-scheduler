import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { eventsToBusy, isPhysicalEvent, shouldBlock, type RawEvent } from "../lib/busy";

const owners = new Set(["owner@example.com"]);
const env = process.env as Record<string, string | undefined>;
const savedFreeKeywords = env.CALENDAR_FREE_KEYWORDS;
const savedFreeDomains = env.CALENDAR_FREE_EMAIL_DOMAINS;

afterEach(() => {
  if (savedFreeKeywords === undefined) delete env.CALENDAR_FREE_KEYWORDS;
  else env.CALENDAR_FREE_KEYWORDS = savedFreeKeywords;
  if (savedFreeDomains === undefined) delete env.CALENDAR_FREE_EMAIL_DOMAINS;
  else env.CALENDAR_FREE_EMAIL_DOMAINS = savedFreeDomains;
});

function event(overrides: Partial<RawEvent>): RawEvent {
  return {
    summary: "Sync",
    allDay: false,
    start: "2026-11-09T10:00:00.000Z",
    end: "2026-11-09T10:30:00.000Z",
    status: "confirmed",
    organizerEmail: "guest@example.com",
    attendees: [{ email: "owner@example.com", responseStatus: "accepted", self: true }],
    ...overrides,
  };
}

test("accepted events organized by someone else are busy", () => {
  assert.equal(shouldBlock(event({}), owners), true);
});

test("the host's own timed events block even when marked free", () => {
  const own = event({
    organizerEmail: "owner@example.com",
    organizerSelf: true,
    transparency: "transparent",
    attendees: [],
  });
  assert.equal(shouldBlock(own, owners), true);
});

test("tentative, needsAction, and declined events are free", () => {
  for (const responseStatus of ["tentative", "needsAction", "declined"]) {
    assert.equal(shouldBlock(event({ attendees: [{ email: "owner@example.com", responseStatus, self: true }] }), owners), false);
  }
  assert.equal(shouldBlock(event({ status: "tentative" }), owners), false);
});

test("all-day events are free unless they are an explicit block", () => {
  assert.equal(shouldBlock(event({ allDay: true, summary: "Cousin wedding", start: "2026-11-10", end: "2026-11-11" }), owners), false);
  assert.equal(shouldBlock(event({ allDay: true, summary: "Blocked", start: "2026-11-10", end: "2026-11-11" }), owners), true);
  assert.equal(shouldBlock(event({ allDay: true, summary: "No meetings", start: "2026-11-10", end: "2026-11-11" }), owners), true);
  assert.equal(shouldBlock(event({ allDay: true, summary: "Out of office", start: "2026-11-10", end: "2026-11-11" }), owners), true);
  assert.equal(shouldBlock(event({ allDay: true, summary: "Team day", eventType: "outOfOffice", start: "2026-11-10", end: "2026-11-11" }), owners), true);
});

test("Calendly meetings are ignored, and configured free keywords or domains do not block", () => {
  assert.equal(shouldBlock(event({ summary: "Calendly: intro with Dana" }), owners), false);
  assert.equal(shouldBlock(event({ description: "Booked in Calendly" }), owners), false);
  assert.equal(shouldBlock(event({ summary: "Partner weekly sync" }), owners), true);
  env.CALENDAR_FREE_KEYWORDS = "partner weekly";
  env.CALENDAR_FREE_EMAIL_DOMAINS = "partners.example.com";
  assert.equal(shouldBlock(event({ summary: "Partner weekly sync" }), owners), false);
  assert.equal(
    shouldBlock(event({ organizerEmail: "ops@partners.example.com", summary: "Weekly" }), owners),
    false,
  );
});

test("an all-day block covers that Israel date and nothing else", () => {
  const busy = eventsToBusy(
    [event({ allDay: true, summary: "Blocked", start: "2026-11-12", end: "2026-11-13" })],
    ["owner@example.com"],
  );
  assert.equal(busy.length, 1);
  assert.equal(busy[0].start.toISOString(), "2026-11-11T22:00:00.000Z");
  assert.equal(busy[0].end.toISOString(), "2026-11-12T22:00:00.000Z");
});

test("physical vs online: address or explicit in-person only; Meet/Zoom in location is online", () => {
  assert.equal(isPhysicalEvent(event({ location: undefined, summary: "Catch-up" })), false);
  assert.equal(isPhysicalEvent(event({ location: "", summary: "Catch-up" })), false);
  assert.equal(isPhysicalEvent(event({ location: "https://meet.google.com/abc-defg-hij", summary: "Vaccine appointment" })), false);
  assert.equal(isPhysicalEvent(event({ location: "https://us02web.zoom.us/j/123456789", summary: "Sync" })), false);
  assert.equal(isPhysicalEvent(event({ location: "Tel Aviv", summary: "Coffee" })), false);
  assert.equal(isPhysicalEvent(event({ location: "12 Rothschild Boulevard, Tel Aviv", summary: "Client" })), true);
  assert.equal(isPhysicalEvent(event({ location: "123 Main Street, New York, NY", summary: "Visit" })), true);
  assert.equal(isPhysicalEvent(event({ location: "רחוב דיזנגוף 50, תל אביב", summary: "פגישה" })), true);
  assert.equal(isPhysicalEvent(event({ summary: "In-person workshop", location: "" })), true);
  assert.equal(isPhysicalEvent(event({ description: "This is a frontal meeting at the office", location: "" })), true);
  assert.equal(isPhysicalEvent(event({ location: "https://meet.google.com/abc-defg-hij", summary: "In-person kickoff" })), true);

  const busy = eventsToBusy(
    [
      event({ id: "catchup", summary: "Catch-up", location: "", start: "2026-11-17T10:00:00.000Z", end: "2026-11-17T11:00:00.000Z" }),
      event({
        id: "clinic",
        summary: "Clinic",
        location: "45 Herzl Street, Tel Aviv",
        start: "2026-11-17T12:00:00.000Z",
        end: "2026-11-17T13:00:00.000Z",
      }),
    ],
    ["owner@example.com"],
  );
  const catchup = busy.find((interval) => interval.eventId === "catchup");
  const clinic = busy.find((interval) => interval.eventId === "clinic");
  assert.equal(catchup?.dayRules, true);
  assert.equal(catchup?.physical, false);
  assert.equal(clinic?.dayRules, true);
  assert.equal(clinic?.physical, true);
});
