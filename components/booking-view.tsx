"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { logoAlt, logoPath, ownerFirstName, ownerName } from "@/lib/brand";
import { useSearchParams } from "next/navigation";
import { ShareActions } from "@/components/share-actions";
import { Button } from "@/components/ui/button";
import { MEETINGS } from "@/lib/meetings";

type Booking = {
  id: string;
  status: "confirmed" | "cancelled";
  meetingSlug: "intro" | "45" | "inperson";
  meetingName: string;
  startUtc: string;
  endUtc: string;
  visitorTimeZone: string;
  name: string;
  mode: "meet" | "phone" | "inperson";
  phone: string;
  location?: string;
  meetLink: string | null;
  calendarDryRun: boolean;
  emailDryRun: boolean;
};

export function BookingView({ id, intent }: { id: string; intent: "view" | "cancel" }) {
  const params = useSearchParams();
  const token = params.get("t") ?? "";
  const confirmed = params.get("confirmed") === "1";
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bookings/${id}?t=${encodeURIComponent(token)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "That booking link is not valid.");
        if (!cancelled) setBooking(body);
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, token]);

  async function cancel() {
    setWorking(true);
    setError("");
    try {
      const response = await fetch(`/api/bookings/${id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not cancel.");
      setBooking(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not cancel.");
    } finally {
      setWorking(false);
    }
  }

  const when = booking ? formatRange(booking.startUtc, booking.endUtc, booking.visitorTimeZone) : null;
  const path = booking ? MEETINGS[booking.meetingSlug].path : "/";

  return (
    <main className="flex flex-1 justify-center px-3 py-10 sm:py-16">
      <section className="w-full max-w-[640px] rounded-xl border border-[#e4e7ee] bg-white px-6 py-10 shadow-[0_10px_40px_rgba(15,23,42,0.04)] sm:px-10">
        {logoPath() ? (
          <Image src={logoPath()} alt={logoAlt()} width={153} height={57} className="mb-8 h-9 w-auto" />
        ) : null}
        {loading ? <p className="text-[#6b7c90]">Loading your meeting…</p> : null}
        {!loading && error && !booking ? <p className="text-[#9b3b3b]">{error}</p> : null}
        {booking && when ? (
          <>
            <h1 className="text-[28px] font-bold tracking-tight">
              {booking.status === "cancelled" ? "Meeting cancelled" : intent === "cancel" ? "Cancel this meeting?" : "You are booked"}
            </h1>
            {confirmed && booking.status === "confirmed" ? (
              <p className="mt-3 text-[17px]">Thanks. You are confirmed.</p>
            ) : null}
            <p className="mt-5 text-[17px] leading-relaxed">
              <strong>{booking.meetingName}</strong> with {ownerName()}
              <br />
              <strong>{when.date}</strong>
              <br />
              {when.time}
            </p>
            <p className="mt-4 text-[17px]">
              {booking.mode === "inperson" ? (
                <>
                  <strong>In person.</strong>
                  {booking.location ? (
                    <>
                      <br />
                      {booking.location}
                    </>
                  ) : null}
                </>
              ) : booking.mode === "meet" ? (
                booking.meetLink ? (
                  <>
                    <strong>Google Meet</strong>
                    <br />
                    <a className="text-[#3d6d9a] underline" href={booking.meetLink}>
                      {booking.meetLink}
                    </a>
                  </>
                ) : (
                  <>
                    <strong>Google Meet.</strong> The video link is added when the calendar invite is created.
                  </>
                )
              ) : (
                <>
                  <strong>Phone call.</strong> {ownerFirstName()} will call {booking.phone}.
                </>
              )}
            </p>
            {booking.calendarDryRun || booking.emailDryRun ? (
              <p className="mt-5 rounded-lg bg-[#f6f7fb] px-3 py-3 text-sm leading-relaxed text-[#3e5168]">
                {booking.calendarDryRun ? "Dry-run: nothing was written to Google Calendar. " : null}
                {booking.emailDryRun ? "Dry-run: the email was queued, not sent." : null}
              </p>
            ) : (
              <p className="mt-5 text-[17px]">A confirmation email is on its way.</p>
            )}
            <div className="mt-6 rounded-2xl bg-[#f4f2ff] px-4 py-4">
              <p className="text-[13px] font-semibold text-[#3d3bb8]">Share this meeting</p>
              <p className="mt-1 text-[13px] leading-relaxed text-[#5c5c70]">
                Sends the public booking page, not this private confirmation.
              </p>
              <div className="mt-3">
                <ShareActions path={path} name={booking.meetingName} />
              </div>
            </div>
            {error ? <p className="mt-4 text-sm text-[#9b3b3b]">{error}</p> : null}
            {booking.status === "confirmed" ? (
              <div className="mt-8 flex flex-wrap gap-3">
                {intent === "cancel" ? (
                  <Button type="button" onClick={cancel} disabled={working} className="h-11 px-4 text-base">
                    {working ? "Cancelling…" : "Cancel meeting"}
                  </Button>
                ) : (
                  <Button variant="outline" className="h-11 px-4" render={<Link href={`/booking/${id}/cancel?t=${encodeURIComponent(token)}`} />}>
                    Cancel
                  </Button>
                )}
                <Button variant="outline" className="h-11 px-4" render={<Link href={`${path}?reschedule=${id}&t=${encodeURIComponent(token)}`} />}>
                  Change time
                </Button>
              </div>
            ) : (
              <Button className="mt-8 h-11" render={<Link href={path} />}>
                Book another time
              </Button>
            )}
          </>
        ) : null}
      </section>
    </main>
  );
}

function formatRange(startIso: string, endIso: string, timeZone: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone,
  }).format(start);
  const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone });
  const abbr =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(start)
      .find((part) => part.type === "timeZoneName")?.value ?? "";
  return { date, time: `${clock.format(start)} – ${clock.format(end)} ${abbr}`.trim() };
}
