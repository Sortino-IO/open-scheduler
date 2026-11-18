import type { Metadata } from "next";
import Link from "next/link";
import { ownerName, privacyEmail, siteHost, siteName } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: `How ${siteName()} handles your information.`,
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  const host = siteHost();
  const owner = ownerName();
  const contact = privacyEmail();

  return (
    <main className="flex flex-1 justify-center px-3 py-8 sm:px-6 sm:py-14">
      <article className="w-full max-w-[760px] rounded-xl border border-[#e4e7ee] bg-white px-5 py-10 text-[15px] leading-relaxed text-[#3b4b5c] shadow-[0_10px_40px_rgba(15,23,42,0.04)] sm:px-10 sm:py-14">
        <h1 className="text-[24px] font-bold tracking-tight text-[#0e1b2c]">Privacy policy</h1>
        <p className="mt-1 text-[13px] text-[#7d92a8]">Last updated 18 November 2026</p>
        <p className="mt-5">
          This covers the scheduling site at {host}, run by {owner}. It explains what the site
          does with your information, in plain terms.
        </p>

        <Section title="What you give us">
          When you book, you enter your name and email. Depending on the meeting you may also add your company or
          website, a phone number (for phone calls), a meeting location (for in-person meetings) and notes. The site
          also records the time you picked and your time zone. Visitors never sign in, and the public pages set no
          cookies and use no analytics or ad trackers.
        </Section>

        <Section title="How it is used">
          Only to arrange the meeting. The site adds an event to the host&apos;s Google Calendar with you as a guest, so
          Google sends you the invitation (with a Google Meet link for video calls). It emails you a confirmation,
          usually a reminder before the meeting, and a notice if the meeting is rescheduled or cancelled, and it lets the
          host know about the booking. Your information is never sold or used for advertising.
        </Section>

        <Section title="Services that process it">
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>Google Calendar and Google Meet, for the calendar event and invitation.</li>
            <li>Vercel, which hosts the site and keeps booking records in private Vercel Blob storage.</li>
            <li>Resend, which delivers the emails.</li>
          </ul>
        </Section>

        <Section title="Google Calendar access">
          Only the site operator connects Google accounts, and only their own. The site asks Google for calendar access
          (https://www.googleapis.com/auth/calendar) plus basic sign-in (openid and email); signing in to the admin
          area uses openid and email only. Calendar access is used to list their calendars so they can choose which ones
          to check, to read events on the chosen calendars to work out when they are busy, and to create, update or
          cancel the events for bookings made here. The busy times it works out, including event titles, sit only in a
          short-lived server cache that refreshes about every 45 seconds, and are not saved with bookings. This Google
          data is never sold, never used for ads, and never shared except
          to provide these features.
          <span className="mt-3 block">
            The use and transfer of information received from Google APIs will adhere to the{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              className="font-semibold text-[#3d6d9a] underline-offset-2 hover:underline"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </span>
        </Section>

        <Section title="How long it is kept">
          Booking records, including cancelled ones, stay in the site&apos;s private storage until they are deleted
          on request; there is no automatic deletion. The site keeps copies of only its 40 most recent emails. The
          calendar event stays in the host&apos;s calendar unless the meeting is cancelled, which deletes it. Google,
          Vercel and Resend keep their own records under their own policies.
        </Section>

        <Section title="Deleting your information">
          {contact ? (
            <>
              To see, correct or delete what the site holds about you, email{" "}
              <a href={`mailto:${contact}`} className="font-semibold text-[#3d6d9a] underline-offset-2 hover:underline">
                {contact}
              </a>
              . You can also cancel a booking at any time from the link in your confirmation email.
            </>
          ) : (
            <>
              To see, correct or delete what the site holds about you, contact the host through the details in your
              confirmation email. You can also cancel a booking at any time from the link in that email.
            </>
          )}
        </Section>

        <Link href="/" className="mt-10 inline-block font-semibold text-[#3d6d9a]">
          Back to meetings
        </Link>
      </article>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-[17px] font-semibold text-[#0e1b2c]">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}
