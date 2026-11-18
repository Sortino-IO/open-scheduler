import { emailFooter, ownerFirstName, ownerName } from "./brand";
import { MEETINGS, type MeetingMode, type MeetingSlug } from "./meetings";
import { HOST_TZ, formatWhen } from "./time";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[char] ?? char;
  });
}

export function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

type Links = { confirmUrl: string; rescheduleUrl: string; cancelUrl: string };

type GuestFacts = {
  name: string;
  meetingSlug: MeetingSlug;
  start: Date;
  end: Date;
  guestTimeZone: string;
  mode: MeetingMode;
  phone: string;
  location?: string;
  meetLink: string | null;
  links: Links;
  eveningBefore?: boolean;
};

function shell(paragraphs: string): string {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f5f7;">
  <div style="max-width:560px;margin:0 auto;padding:32px 22px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:17px;line-height:1.5;color:#1c2430;">
    ${paragraphs}
    <p style="margin:28px 0 0;font-size:14px;line-height:1.45;color:#6b7c90;">${escapeHtml(emailFooter())}</p>
  </div>
</body>
</html>`;
}

function p(html: string): string {
  return `<p style="margin:0 0 16px;">${html}</p>`;
}

function button(href: string, label: string, primary: boolean): string {
  const style = primary
    ? "display:inline-block;margin:4px 10px 4px 0;padding:12px 18px;background:#102033;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:16px;"
    : "display:inline-block;margin:4px 10px 4px 0;padding:11px 16px;background:#ffffff;color:#102033;text-decoration:none;border-radius:8px;border:1px solid #cfd6e0;font-weight:700;font-size:16px;";
  return `<a href="${escapeHtml(href)}" style="${style}">${escapeHtml(label)}</a>`;
}

function modeLine(facts: GuestFacts): { html: string; text: string } {
  if (facts.mode === "inperson") {
    const loc = facts.location?.trim() || "Location shared on the calendar invite";
    return {
      html: `<strong>In person</strong><br>${escapeHtml(loc)}`,
      text: `In person: ${loc}`,
    };
  }
  if (facts.mode === "meet") {
    if (facts.meetLink) {
      return {
        html: `<strong>Google Meet</strong><br><a href="${escapeHtml(facts.meetLink)}">${escapeHtml(facts.meetLink)}</a>`,
        text: `Google Meet: ${facts.meetLink}`,
      };
    }
    return {
      html: `<strong>Google Meet</strong><br>The video link is added to the calendar invite.`,
      text: "Google Meet: the video link is added to the calendar invite.",
    };
  }
  return {
    html: `<strong>Phone call</strong><br>${escapeHtml(ownerFirstName())} will call <strong>${escapeHtml(facts.phone)}</strong>.`,
    text: `Phone call. ${ownerFirstName()} will call ${facts.phone}.`,
  };
}

function whenLine(start: Date, timeZone: string): string {
  return formatWhen(start, timeZone);
}

export function guestConfirmation(facts: GuestFacts): { subject: string; html: string; text: string } {
  const meeting = MEETINGS[facts.meetingSlug].name;
  const when = whenLine(facts.start, facts.guestTimeZone);
  const mode = modeLine(facts);
  const subject = `Booked: ${meeting} with ${ownerName()}`;
  const text = [
    `Hi ${facts.name},`,
    "",
    `You're booked with ${ownerName()}.`,
    "",
    meeting,
    when,
    mode.text,
    "",
    `Change the time: ${facts.links.rescheduleUrl}`,
    `Cancel: ${facts.links.cancelUrl}`,
  ].join("\n");
  const html = shell(
    [
      p(`Hi ${escapeHtml(facts.name)},`),
      p(`You're booked with ${ownerName()}.`),
      p(`<strong>${escapeHtml(meeting)}</strong><br><strong>${escapeHtml(when)}</strong>`),
      p(mode.html),
      `<p style="margin:8px 0 0;">${button(facts.links.rescheduleUrl, "Change time", false)}${button(facts.links.cancelUrl, "Cancel", false)}</p>`,
    ].join(""),
  );
  return { subject, html, text };
}

export function guestReminder(facts: GuestFacts): { subject: string; html: string; text: string } {
  const meeting = MEETINGS[facts.meetingSlug].name;
  const when = whenLine(facts.start, facts.guestTimeZone);
  const mode = modeLine(facts);
  const lead = facts.eveningBefore ? "See you tomorrow." : "See you in a few hours.";
  const subject = facts.eveningBefore
    ? `Tomorrow: ${meeting} with ${ownerName()}`
    : `Reminder: ${meeting} with ${ownerName()}`;
  const text = [
    `Hi ${facts.name},`,
    "",
    lead,
    "",
    meeting,
    when,
    mode.text,
    "",
    `Confirm: ${facts.links.confirmUrl}`,
    `Need another time: ${facts.links.rescheduleUrl}`,
  ].join("\n");
  const html = shell(
    [
      p(`Hi ${escapeHtml(facts.name)},`),
      p(lead),
      p(`<strong>${escapeHtml(meeting)}</strong><br><strong>${escapeHtml(when)}</strong>`),
      p(mode.html),
      `<p style="margin:8px 0 0;">${button(facts.links.confirmUrl, "Confirm", true)}${button(facts.links.rescheduleUrl, "Need another time", false)}</p>`,
    ].join(""),
  );
  return { subject, html, text };
}

export function guestUpdated(facts: GuestFacts): { subject: string; html: string; text: string } {
  const meeting = MEETINGS[facts.meetingSlug].name;
  const when = whenLine(facts.start, facts.guestTimeZone);
  const mode = modeLine(facts);
  const subject = `Updated: ${meeting} with ${ownerName()}`;
  const text = [
    `Hi ${facts.name},`,
    "",
    "Your meeting time was updated.",
    "",
    meeting,
    when,
    mode.text,
    "",
    `Change again: ${facts.links.rescheduleUrl}`,
    `Cancel: ${facts.links.cancelUrl}`,
  ].join("\n");
  const html = shell(
    [
      p(`Hi ${escapeHtml(facts.name)},`),
      p("Your meeting time was updated."),
      p(`<strong>${escapeHtml(meeting)}</strong><br><strong>${escapeHtml(when)}</strong>`),
      p(mode.html),
      `<p style="margin:8px 0 0;">${button(facts.links.rescheduleUrl, "Change time", false)}${button(facts.links.cancelUrl, "Cancel", false)}</p>`,
    ].join(""),
  );
  return { subject, html, text };
}

export function guestCancelled(facts: Pick<GuestFacts, "name" | "meetingSlug" | "start" | "guestTimeZone"> & { bookUrl: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const meeting = MEETINGS[facts.meetingSlug].name;
  const when = whenLine(facts.start, facts.guestTimeZone);
  const subject = `Cancelled: ${meeting} with ${ownerName()}`;
  const text = [
    `Hi ${facts.name},`,
    "",
    `Your ${meeting} on ${when} is cancelled.`,
    "",
    `Book another time: ${facts.bookUrl}`,
  ].join("\n");
  const html = shell(
    [
      p(`Hi ${escapeHtml(facts.name)},`),
      p(`Your <strong>${escapeHtml(meeting)}</strong> on <strong>${escapeHtml(when)}</strong> is cancelled.`),
      p(`<a href="${escapeHtml(facts.bookUrl)}">Book another time</a>`),
    ].join(""),
  );
  return { subject, html, text };
}

export function internalNotice(input: {
  kind: "new" | "updated" | "cancelled" | "reminder";
  name: string;
  email: string;
  company: string;
  phone: string;
  location?: string;
  notes?: string;
  meetingSlug: MeetingSlug;
  mode: MeetingMode;
  start: Date;
  meetLink: string | null;
}): { subject: string; html: string; text: string } {
  const meeting = MEETINGS[input.meetingSlug].name;
  const when = `${formatWhen(input.start, HOST_TZ)} Israel time`;
  const mode =
    input.mode === "meet" ? "Google Meet" : input.mode === "inperson" ? "In person" : "Phone call";
  const verb = input.kind === "new" ? "New booking" : input.kind === "updated" ? "Rescheduled" : input.kind === "cancelled" ? "Cancelled" : "Reminder queued";
  const subject = `${verb}: ${oneLine(input.name)} — ${meeting}`;
  const rows: [string, string][] = [
    ["Who", input.name],
    ["Email", input.email],
    ["Company", input.company || "—"],
    ["Phone", input.phone || "—"],
    ["Meeting", meeting],
    ["When", when],
    ["Mode", mode],
  ];
  if (input.location) rows.push(["Location", input.location]);
  if (input.meetLink) rows.push(["Meet", input.meetLink]);
  if (input.notes) rows.push(["Notes", input.notes]);
  const text = [subject, "", ...rows.map(([label, value]) => `${label}: ${value}`)].join("\n");
  const html = shell(
    [
      p(`<strong>${escapeHtml(verb)}</strong>`),
      ...rows.map(([label, value]) => p(`<strong>${escapeHtml(label)}:</strong> ${escapeHtml(value).replace(/\n/g, "<br>")}`)),
    ].join(""),
  );
  return { subject, html, text };
}


export function guestUnlockNotice(input: {
  name: string;
  usSlots: boolean;
  inPerson: boolean;
  linkUrl: string;
}): { subject: string; html: string; text: string } {
  const who = input.name?.trim() ? input.name.trim().split(/\s+/)[0] : "there";
  const parts: string[] = [];
  if (input.usSlots) parts.push("US evening times (Mon–Wed, 21:00–24:00 Israel time)");
  if (input.inPerson) parts.push("in-person evening meetings (from 21:30, with a location)");
  const opened = parts.length === 2 ? `${parts[0]} and ${parts[1]}` : parts[0] || "additional times";
  const subject = "Additional times are open for you";
  const text = [
    `Hi ${who},`,
    "",
    `Good news — ${opened} ${parts.length > 1 ? "are" : "is"} now available on your personal scheduling link.`,
    "",
    `Open your link: ${input.linkUrl}`,
    "",
    "If you already booked, you can also use the “Need another time” link from your confirmation email — it will show the same options.",
    "",
    `— ${ownerFirstName()}`,
  ].join("\n");
  const html = shell(
    [
      p(`Hi ${escapeHtml(who)},`),
      p(
        `Good news — <strong>${escapeHtml(opened)}</strong> ${
          parts.length > 1 ? "are" : "is"
        } now available on your personal scheduling link.`,
      ),
      `<p style="margin:8px 0 20px;">${button(input.linkUrl, "View available times", true)}</p>`,
      p(
        "If you already booked, you can also use the “Need another time” link from your confirmation email — it will show the same options.",
      ),
    ].join(""),
  );
  return { subject, html, text };
}

export function calendarDisconnectedAlert(input: { reason: string; adminUrl: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = "scheduler alert: calendar disconnected";
  const lead = `Google refused the scheduler's calendar access (${input.reason}). The public booking pages show no times until the calendar is connected again.`;
  const step = "Open the admin, then tap “Connect Google calendar” and approve with the same Google account.";
  const text = [subject, "", lead, "", step, input.adminUrl].join("\n");
  const html = shell(
    [
      p(`<strong>${escapeHtml(subject)}</strong>`),
      p(escapeHtml(lead)),
      p(escapeHtml(step)),
      `<p style="margin:8px 0 20px;">${button(input.adminUrl, "Open admin", true)}</p>`,
    ].join(""),
  );
  return { subject, html, text };
}
