# Open Scheduler

A small, self-hosted scheduling page you can brand as your own. Visitors pick a meeting type, choose a time in their own zone, and book a Google Meet, a phone call, or an in-person meeting.

This is a reusable template. Nothing in the default configuration points at a previous operator's email, calendar, or domain. Until you set your own environment variables, the app runs in a safe demo mode: bookings are stored locally, calendar writes stay on a mock calendar, and email is queued instead of sent.

## Features

- Public pages for an intro call (30 minutes), a 45-minute meeting, and an optional in-person meeting
- Availability is decided in `Asia/Jerusalem` and shown in the visitor's time zone
- Same-day booking is closed; Friday and Saturday are closed; Israeli holidays are closed automatically via [Hebcal](https://www.hebcal.com)
- Optional US evening window, opened globally or for a single day
- Regular closures, one-off blocked hours, and one-off "open once" days, including more than one hour block in a single closure
- Personal unlock links that can offer evening or in-person times to a specific guest
- Admin panel with Google sign-in, optimistic updates, and a mobile / iPad-friendly layout
- Google Calendar busy checks and event creation, or a mock calendar when credentials are absent
- Confirmation, reminder, update, and cancellation emails through [Resend](https://resend.com), or a dry-run queue
- Change and cancel links on the confirmation page

## Stack

- Next.js (App Router) and React
- TypeScript
- Tailwind CSS
- Vercel (optional Blob store and Cron)
- Google Calendar API (OAuth or a service account)
- Resend for email

## Run locally

```bash
cp .env.example .env.local
# Fill in at least NEXT_PUBLIC_SCHEDULER_OWNER_NAME and, for a live site, APP_ORIGIN and ADMIN_GOOGLE_EMAIL.
npm install
npm run dev
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123).

```bash
npm test
npm run lint
```

With no secrets, calendar writes and email are dry-run: bookings are stored, and the email payloads show up in admin. Local admin password, only when `ADMIN_SECRET` is unset and you are not in production: `dev-admin-secret`. Prefer Google sign-in even in development once `ADMIN_GOOGLE_EMAIL` and the OAuth client are set.

## Environment

Copy `.env.example` to `.env.local`. The file lists every variable with placeholder values only. The important groups:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SCHEDULER_OWNER_NAME` | Public display name. Default in code is `Host` if unset. |
| `NEXT_PUBLIC_SCHEDULER_OWNER_FIRST_NAME` | Short name used in phrases such as "Alex will call…". |
| `NEXT_PUBLIC_SCHEDULER_ORGANIZATION` | Optional organization shown in emails and social images. |
| `NEXT_PUBLIC_SCHEDULER_SITE_NAME` | Browser title and PWA name. Defaults to `{name} · Schedule`. |
| `NEXT_PUBLIC_SCHEDULER_AVATAR` | Path under `/public` for the profile photo. Default `/avatar.webp`. |
| `NEXT_PUBLIC_SCHEDULER_LOGO` | Optional logo path. Leave blank to hide the logo. |
| `ADMIN_GOOGLE_EMAIL` | The only Google account that can sign in to `/admin`. Required for Google admin sign-in. |
| `ADMIN_SECRET` | Admin cookie secret. Required in production. |
| `APP_ORIGIN` | Canonical origin for email links and OAuth redirects. Required in production. Example: `https://schedule.example.com`. |
| `NOTIFY_EMAIL` | Internal notice recipient. Guest mail is never copied here. There is no default; notices are skipped if this is blank. |
| `EMAIL_FROM` | Resend from-address. Required to send mail. The domain must be verified in Resend. |
| `SCHEDULER_PRIVACY_EMAIL` | Contact on the privacy page. Defaults to `NOTIFY_EMAIL`. |
| `RESEND_API_KEY` | Sends mail. Blank = dry-run queue. |
| `EMAIL_DRY_RUN` | `true` forces the queue even if a key is set. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | OAuth for Calendar. Preferred. |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` / `GOOGLE_IMPERSONATE_USER` | Service-account alternative. `GOOGLE_IMPERSONATE_USER` is required for that path. |
| `GOOGLE_CALENDAR_IDS` | Calendars to read. Comma-separated. No default. |
| `GOOGLE_CALENDAR_OWNER` | Address treated as the host when deciding which events are theirs. |
| `GOOGLE_BOOKING_CALENDAR_ID` | Calendar that receives the new event, unless you pick one in admin. |
| `CALENDAR_FREE_KEYWORDS` | Optional comma-separated phrases. Matching events do not block slots. |
| `CALENDAR_FREE_EMAIL_DOMAINS` | Optional comma-separated domains. Events from those domains do not block slots. |
| `CALENDAR_DRY_RUN` | `true` keeps the mock calendar. |
| `BLOB_READ_WRITE_TOKEN` or `BLOB_STORE_ID` | Private Vercel Blob store for admin state, bookings, and the queue. |
| `CRON_SECRET` | Authorizes the reminder cron. |

Replace the placeholder avatar at `public/avatar.webp` (and `public/avatar.jpg`, used for social images) with your own photo, or point `NEXT_PUBLIC_SCHEDULER_AVATAR` at another file in `/public`.

## Meeting rules

Times below are decided in `Asia/Jerusalem`. The page shows them in the visitor's zone and labels that zone. Same-day booking is closed; the earliest day is tomorrow. Friday and Saturday are closed.

| | Intro call | 45 Minute Meeting |
| --- | --- | --- |
| Length | 30 min | 45 min |
| Standard window | Sun–Thu, 11:00–15:00 | Mon, Tue, Thu, 11:00–15:00 |
| US evening, toggle on | Mon–Wed, 21:00–24:00, last start 23:30 | Mon–Wed, 21:00–24:00, last start 23:15 |

A meeting has to finish by the end of the window. The US evening window is hidden until **Open US slots** is on. Wednesday can appear on the 45-minute calendar only for those evening times.

## What blocks a slot

A slot is blocked when it overlaps a timed event on the configured Google calendars:

- Timed events the host organized, whether or not they are marked free
- Timed events someone else organized, only if the host accepted
- All-day events titled Blocked, no meetings, or out of office, and Google out-of-office events

These do not block time:

- Ordinary all-day events
- Anything that mentions Calendly
- Events that match `CALENDAR_FREE_KEYWORDS` or `CALENDAR_FREE_EMAIL_DOMAINS`, if you set them
- Tentative, needs-action, and declined events

Confirmed bookings in this app also block time. Without Google credentials, a mock calendar is used. It keeps one writing block on the next Monday, 12:00–13:00 Israel, and ignores sample events that match the free rules above.

## Holidays

Israeli dates come from [Hebcal](https://www.hebcal.com) with `i=on` (Israel, not the diaspora schedule). The app closes:

- Yom tov
- Erev chag (the full civil day before a yom tov, including the day before the last day of Pesach)
- Purim, Yom HaShoah, Yom HaZikaron, and Yom HaAtzmaut

Chol HaMoed, Chanukah, and minor commemorations stay open. Shabbat is already closed by the Friday/Saturday rule. Admin lists the upcoming auto-blocked days. A manual block cannot reopen a holiday.

## Admin

`/admin` is not indexed.

Set `ADMIN_GOOGLE_EMAIL` to the Google account that should manage the page. Only that exact, verified address can sign in. In production also set `ADMIN_SECRET` (used to sign the admin cookie) and `APP_ORIGIN`.

From admin you can:

1. Open US slots or in-person meetings
2. Block or unblock whole Israel days, add blocked hours, and set regular closures
3. Review upcoming holidays, bookings, and the email queue
4. Connect Google calendars and choose which ones are checked, and which one receives new events
5. Issue personal links and send them to a guest

On Vercel, reminders run from the cron in `vercel.json` (`/api/cron/reminders`, hourly at minute 15) when `CRON_SECRET` is set. Hobby plans may only allow a daily cron; the admin button **Send due reminders** runs the same job on demand.

## Google Calendar OAuth

1. In [Google Cloud Console](https://console.cloud.google.com/), create or pick a project and enable the Google Calendar API.
2. Configure the OAuth consent screen. Add the Calendar scope `https://www.googleapis.com/auth/calendar`, plus `openid` and `email` for admin sign-in.
3. Create an OAuth client of type Web application. Add authorized redirect URIs for:
   - `{APP_ORIGIN}/api/oauth/google/callback` (calendar connect and, by default, admin sign-in)
   - `{APP_ORIGIN}/api/admin/oauth/google/callback` if you set `ADMIN_GOOGLE_REDIRECT_PATH` to that path
4. Put the client ID and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
5. Set `APP_ORIGIN` to your public https origin and `ADMIN_GOOGLE_EMAIL` to your Google address.
6. Sign in to `/admin`, then use **Connect Google calendar** and approve access with the same account (or another account you want to read). Choose the calendars to check and the calendar that should receive bookings.

A service account with domain-wide delegation is an alternative. In that case set `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, and `GOOGLE_IMPERSONATE_USER`. There is no default impersonation user; the app will refuse to mint a token without it.

If these variables are missing, the app stays in demo mode and will not write to anyone else's calendar.

## Resend

1. Create an account at [Resend](https://resend.com) and verify the domain you will send from.
2. Create an API key and set `RESEND_API_KEY`.
3. Set `EMAIL_FROM` to a from-address on that verified domain, for example `Your Name <bookings@example.com>`.
4. Set `NOTIFY_EMAIL` to the inbox that should receive internal booking notices.

A confirmation goes to the guest only. Internal notices are a separate message, never a Cc on the guest mail, with the time in Israel. A reminder is sent about three hours before; if that moment is before 08:00 in the guest's zone, it goes at 19:00 the evening before.

If `RESEND_API_KEY` is blank, or `EMAIL_DRY_RUN=true`, messages are stored in the admin queue instead of being sent. `EMAIL_FROM` is required to actually send mail; the app will not invent a from-address.

## Deploy on Vercel

1. Fork or clone this repository and import it into [Vercel](https://vercel.com) as a new project.
2. Add the environment variables from `.env.example`, using your real values. At minimum set `APP_ORIGIN`, `ADMIN_GOOGLE_EMAIL`, `ADMIN_SECRET`, and the branding variables. Add Google and Resend values when you are ready to go live.
3. Connect a private Vercel Blob store to the project and provide `BLOB_READ_WRITE_TOKEN` or `BLOB_STORE_ID`. Locally the file is `.data/store.json`; on Vercel, without Blob, state lives in process memory and does not survive a new instance.
4. Set `CRON_SECRET` so the reminder cron can run.
5. Add your custom domain in the Vercel project, then create the DNS record Vercel shows (usually a CNAME to `cname.vercel-dns.com`).
6. Set `APP_ORIGIN` to `https://your-domain` so email links and OAuth redirects use that host. Add the same origin's callback URLs in Google Cloud.
7. Deploy. Every page sends `noindex, nofollow`, and `robots.txt` disallows `/` until you decide to open indexing. To open indexing later, drop the `X-Robots-Tag` header in `next.config.ts`, the `robots` metadata in `app/layout.tsx`, and the disallow rule in `app/robots.ts`.

Do not reuse another project's production credentials. Create your own Google OAuth client, Resend domain, and Blob store.

## License

MIT. See [LICENSE](LICENSE).
