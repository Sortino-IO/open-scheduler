"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Link2, Trash2 } from "lucide-react";
import { calendarDetail } from "@/lib/calendar-label";

type Cal = { id: string; summary: string; primary: boolean; checkConflicts: boolean };
/** Server-checked grant: "disconnected" means Google rejected the saved access. */
type Account = {
  id: string;
  email: string;
  obtainedAt: string;
  calendars: Cal[];
  status?: "ok" | "disconnected" | "unknown";
};
type State = {
  accounts: Account[];
  bookingTarget: { accountId: string; calendarId: string } | null;
  maxAccounts: number;
  connectUrl: string;
};

const UNAPPROVED_MSG =
  "This Google account isn't approved yet. Ask your assistant to approve it.";

const CONNECT_ERRORS: Record<string, string> = {
  unapproved: UNAPPROVED_MSG,
  failed: "Couldn't connect that Google account. Try again, or ask your assistant for help.",
};

/** One-shot result of the Google connect redirect. The card only renders in the browser. */
function connectError(): string {
  if (typeof window === "undefined") return "";
  return CONNECT_ERRORS[new URLSearchParams(window.location.search).get("connectError") || ""] || "";
}

export function CalendarsCard({ flash }: { flash: (msg: string) => void }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(connectError);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/calendars");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not load calendars.");
    return body as State;
  }, []);

  useEffect(() => {
    load().then(setState, (e: Error) => setError(e.message));
  }, [load]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    let dirty = false;
    if (url.searchParams.has("connectError")) {
      url.searchParams.delete("connectError");
      dirty = true;
    }
    if (url.searchParams.get("connected") === "1") {
      flash("Google calendar connected");
      url.searchParams.delete("connected");
      dirty = true;
      load().then(setState, () => {});
    }
    if (dirty) {
      const qs = url.searchParams.toString();
      window.history.replaceState(null, "", url.pathname + (qs ? `?${qs}` : ""));
    }
  }, [flash, load]);

  async function post(payload: Record<string, unknown>, ok: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/calendars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save.");
      setState((prev) =>
        prev
          ? {
              ...prev,
              // POST answers without the grant check; keep the status the last GET measured.
              accounts: (body.accounts as Account[]).map((account) => ({
                ...account,
                status: prev.accounts.find((old) => old.id === account.id)?.status,
              })),
              bookingTarget: body.bookingTarget,
              maxAccounts: body.maxAccounts,
            }
          : body,
      );
      flash(ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <div className="rounded-[24px] bg-white p-6 text-[14px] text-[#6e6e73] ring-1 ring-black/5">
        Loading calendars…
      </div>
    );
  }

  const atCap = state.accounts.length >= state.maxAccounts;
  const destinations = state.accounts.flatMap((account) =>
    account.calendars.map((cal) => ({ account, cal })),
  );
  const isTarget = (accountId: string, calendarId: string) =>
    state.bookingTarget?.accountId === accountId && state.bookingTarget?.calendarId === calendarId;

  return (
    <section aria-labelledby="calendars-title" className="space-y-4">
      <div className="rounded-[28px] bg-gradient-to-br from-[#eef4ff] via-white to-[#f3eeff] p-5 ring-1 ring-[#5856d6]/10 sm:p-7">
        <p className="inline-flex items-center gap-2 text-[12px] font-semibold tracking-wide text-[#2563eb] uppercase">
          <CalendarDays className="size-3.5" />
          Google Calendar
        </p>
        <h2 id="calendars-title" className="mt-1 text-[24px] font-semibold tracking-tight sm:text-[28px]">
          Connected calendars
        </h2>
        <p className="mt-1 max-w-2xl text-[14px] text-[#6e6e73]">
          Switch on the calendars that should block times. Pick one calendar for new bookings. Up to{" "}
          {state.maxAccounts} Google accounts.
        </p>
        <a
          href={state.connectUrl}
          aria-disabled={atCap}
          className={`mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full px-5 text-[14px] font-semibold text-white shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5856d6] sm:w-auto ${
            atCap ? "pointer-events-none bg-[#d2d2d7]" : "bg-[#5856d6] shadow-[#5856d6]/25"
          }`}
        >
          <Link2 className="size-4" />
          {atCap ? "Account limit reached" : "Connect Google calendar"}
        </a>
        {error ? <p className="mt-4 text-[13px] font-medium text-[#b42318]">{error}</p> : null}
      </div>

      {state.accounts.length === 0 ? (
        <div className="rounded-[24px] bg-white p-8 text-center text-[14px] text-[#86868b] ring-1 ring-black/5">
          No Google accounts connected yet.
        </div>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
          <div className="grid min-w-0 gap-4">
            {state.accounts.map((account) => {
              const disconnected = account.status === "disconnected";
              return (
                <div key={account.id} className="rounded-[24px] bg-white p-4 ring-1 ring-black/5 sm:p-6">
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden
                      className={`flex size-10 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold text-white ${
                        disconnected ? "bg-[#b42318]" : "bg-gradient-to-br from-[#5856d6] to-[#2563eb]"
                      }`}
                    >
                      {account.email.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[16px] font-semibold [overflow-wrap:anywhere]">{account.email}</p>
                      {disconnected ? (
                        <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-[#fff2f2] px-2.5 py-1 text-[12px] font-semibold text-[#b42318]">
                          <span className="size-1.5 rounded-full bg-[#b42318]" />
                          Disconnected
                        </p>
                      ) : account.status === "unknown" ? (
                        <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-[#fff7e6] px-2.5 py-1 text-[12px] font-semibold text-[#9a5b00]">
                          <span className="size-1.5 rounded-full bg-[#d98e04]" />
                          Couldn&apos;t check connection
                        </p>
                      ) : (
                        <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-[#e8f8ee] px-2.5 py-1 text-[12px] font-semibold text-[#1a7f37]">
                          <span className="size-1.5 rounded-full bg-[#1a7f37]" />
                          Connected {new Date(account.obtainedAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>

                  {disconnected ? (
                    <div className="mt-4 rounded-2xl bg-[#fff2f2] p-4 ring-1 ring-[#b42318]/15">
                      <p className="text-[13px] text-[#7a271a]">
                        Google stopped accepting this account, so booking pages show no times.
                      </p>
                      <a
                        href={state.connectUrl}
                        className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#b42318] px-4 text-[14px] font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b42318] sm:w-auto"
                      >
                        <Link2 className="size-4" />
                        Reconnect
                      </a>
                    </div>
                  ) : null}

                  <p className="mt-5 text-[12px] font-semibold tracking-wide text-[#86868b] uppercase">Block times from</p>
                  <ul className="mt-2 divide-y divide-[#eeedf5] overflow-hidden rounded-2xl bg-[#f8f7fc]">
                    {account.calendars.map((cal) => (
                      <li key={cal.id}>
                        <ToggleRow
                          checked={cal.checkConflicts}
                          disabled={busy}
                          title={cal.summary}
                          detail={rowDetail(cal)}
                          onChange={(next) =>
                            post(
                              { setCheck: { accountId: account.id, calendarId: cal.id, checkConflicts: next } },
                              next ? "Checking this calendar" : "Stopped checking this calendar",
                            )
                          }
                        />
                      </li>
                    ))}
                  </ul>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => post({ disconnectAccountId: account.id }, "Account disconnected")}
                    className="mt-4 inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-[#b42318] hover:bg-[#fff2f2] focus-visible:outline-2 focus-visible:outline-[#b42318]/40 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" />
                    Remove this account
                  </button>
                </div>
              );
            })}
          </div>

          <div className="min-w-0 rounded-[24px] bg-gradient-to-br from-[#f3eeff] via-white to-[#eef4ff] p-4 ring-1 ring-[#5856d6]/15 sm:p-6">
            <p id="booking-target-label" className="text-[16px] font-semibold">New bookings go to</p>
            <p className="mt-0.5 text-[13px] text-[#6e6e73]">One calendar receives every new booking invite.</p>
            <RadioList
              labelledBy="booking-target-label"
              disabled={busy}
              options={destinations.map(({ account, cal }) => ({
                key: `${account.id}:${cal.id}`,
                title: cal.summary,
                detail: cal.summary === account.email ? rowDetail(cal) : `${account.email} · ${rowDetail(cal)}`,
                checked: isTarget(account.id, cal.id),
                onSelect: () =>
                  post({ setBookingTarget: { accountId: account.id, calendarId: cal.id } }, "Booking destination updated"),
              }))}
            />
          </div>
        </div>
      )}
    </section>
  );
}

/** Second line that tells same-named calendars apart without repeating the title. */
function rowDetail(cal: Cal): string {
  if (cal.primary) return "Primary calendar";
  const detail = calendarDetail(cal.id);
  return detail === cal.summary ? "Calendar" : detail;
}

const focusRing = "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#5856d6]";

function RowText({ title, detail }: { title: string; detail: string }) {
  return (
    <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
      <span className="block text-[14px] font-medium text-[#1d1d1f]">{title}</span>
      <span className="block text-[12px] text-[#6e6e73]">{detail}</span>
    </span>
  );
}

function ToggleRow(props: {
  checked: boolean;
  disabled: boolean;
  title: string;
  detail: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      className={`flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition hover:bg-[#efeef8] disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`}
    >
      <RowText title={props.title} detail={props.detail} />
      <span
        aria-hidden
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${props.checked ? "bg-[#34c759]" : "bg-[#d9d8e3]"}`}
      >
        <span
          className={`absolute top-0.5 size-6 rounded-full bg-white shadow-sm transition-all ${
            props.checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}

/** Single-select list: one tab stop, arrow keys move and select, like a native radio group. */
function RadioList(props: {
  labelledBy: string;
  disabled: boolean;
  options: { key: string; title: string; detail: string; checked: boolean; onSelect: () => void }[];
}) {
  const { options } = props;
  const current = Math.max(0, options.findIndex((o) => o.checked));
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (!step || props.disabled || options.length === 0) return;
    event.preventDefault();
    const next = (current + step + options.length) % options.length;
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]");
    buttons[next]?.focus();
    options[next].onSelect();
  }
  return (
    <div role="radiogroup" aria-labelledby={props.labelledBy} onKeyDown={onKeyDown} className="mt-3 grid gap-2">
      {options.map((option, index) => (
        <button
          key={option.key}
          type="button"
          role="radio"
          aria-checked={option.checked}
          tabIndex={index === current ? 0 : -1}
          disabled={props.disabled}
          onClick={() => {
            if (!option.checked) option.onSelect();
          }}
          className={`flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-2xl px-4 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${focusRing} ${
            option.checked ? "bg-[#5856d6]/10 ring-2 ring-[#5856d6]" : "bg-white ring-1 ring-black/5 hover:bg-[#f5f4fa]"
          }`}
        >
          <span
            aria-hidden
            className={`flex size-5 shrink-0 items-center justify-center rounded-full ${
              option.checked ? "bg-[#5856d6]" : "bg-white ring-2 ring-[#c7c6d3]"
            }`}
          >
            {option.checked ? <span className="size-2 rounded-full bg-white" /> : null}
          </span>
          <RowText title={option.title} detail={option.detail} />
        </button>
      ))}
    </div>
  );
}
