"use client";

import { ownerFirstName, ownerName } from "@/lib/brand";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  CalendarDays,
  CalendarOff,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  LayoutDashboard,
  Link2,
  LogOut,
  MapPin,
  Send,
  KeyRound,
  Sparkles,
  Sun,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePickerField, FancyCheck, SegmentedControl, TimePickerField } from "@/components/ui/pickers";
import { AdminInstall } from "@/components/admin-install";
import { CalendarsCard } from "@/components/calendars-card";
import { ClosuresSection, type ClosureFields } from "@/components/closures-section";
import { describeRecurring, expandBlocks, type RecurringBlock, type TimeBlock } from "@/lib/blocks";
import { closuresOn, describeClosure, type RegularClosure } from "@/lib/closures";
import { revealDayEditor } from "@/lib/day-editor-scroll";
import { withDayBlocked, withDayOpen, withDayUsOpen } from "@/lib/day-settings";
import { minutesLabel } from "@/lib/meetings";
import { monthMatrix, monthTitle } from "@/lib/month";
import { HOST_TZ, shiftMonth, weekdayIndex } from "@/lib/time";

type Holiday = { date: string; name: string; hebrew?: string; kindLabel: string };
type BookingRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  location: string;
  mode: string;
  meeting: string;
  meetingSlug: string;
  when: string;
  reminderSendAt: string | null;
  reminderSentAt: string | null;
};
type ActivityRow = {
  id: string;
  title: string;
  detail: string;
  to: string;
  kind: string;
  status: string;
  when: string;
  createdAt: string;
  error?: string;
};
type LinkRow = { slug: string; name: string; path: string; url: string; gated?: boolean; open?: boolean };
type UnlockRow = {
  id: string;
  email: string;
  name: string;
  usSlots: boolean;
  inPerson: boolean;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  token: string;
  links: { label: string; url: string }[];
};

type State = {
  usSlotsOpen: boolean;
  inPersonOpen: boolean;
  manualBlocks: string[];
  manualOpens: string[];
  usOpenDates: string[];
  timeBlocks: TimeBlock[];
  recurringBlocks: RecurringBlock[];
  regularClosures: RegularClosure[];
  today: string;
  holidays: Holiday[];
  bookings: BookingRow[];
  activity: ActivityRow[];
  links: LinkRow[];
  unlocks: UnlockRow[];
  calendarDryRun: boolean;
  emailDryRun: boolean;
  blob: boolean;
  cron: boolean;
};

type Tab = "overview" | "availability" | "closures" | "bookings" | "activity";

const GOOGLE_ERRORS: Record<string, string> = {
  not_allowed: "That Google account is not allowed here.",
  denied: "Google sign-in was cancelled.",
  expired: "Sign-in link expired. Try again.",
  not_configured: "Google sign-in is not configured.",
  failed: "Google sign-in failed. Try again.",
};

function googleError(): string {
  if (typeof window === "undefined") return "";
  const code = new URLSearchParams(window.location.search).get("google");
  return code ? GOOGLE_ERRORS[code] || "Google sign-in failed." : "";
}

/** Friday or Saturday in Asia/Jerusalem. Noon UTC is the same civil date in Israel. */
function isIsraelWeekend(date: string): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "Asia/Jerusalem",
  }).format(new Date(`${date}T12:00:00Z`));
  return weekday === "Fri" || weekday === "Sat";
}

const TABS: { id: Tab; label: string; short: string; icon: typeof LayoutDashboard }[] = [
  { id: "overview", label: "Overview", short: "Overview", icon: LayoutDashboard },
  { id: "availability", label: "Availability", short: "Days", icon: CalendarDays },
  { id: "closures", label: "Regular closures", short: "Closures", icon: CalendarOff },
  { id: "bookings", label: "Bookings", short: "Bookings", icon: Users },
  { id: "activity", label: "Activity", short: "Activity", icon: Activity },
];

/** Items added on screen before the server has answered carry a temporary id until it does. */
let pendingSequence = 0;
function pendingId(): string {
  pendingSequence += 1;
  return `pending-${pendingSequence}`;
}
function isPending(id: string): boolean {
  return id.startsWith("pending-");
}

export function AdminPanel() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState(() => googleError());
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "overview";
    const q = new URLSearchParams(window.location.search).get("tab");
    if (q === "availability" || q === "closures" || q === "bookings" || q === "activity" || q === "overview") return q;
    return "overview";
  });
  const [month, setMonth] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const dayEditorRef = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState<{ message: string; tone: "info" | "error" } | null>(null);
  const saves = useRef<Promise<unknown>>(Promise.resolve());
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [holidaysOpen, setHolidaysOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [copied, setCopied] = useState("");
  const [rangeStart, setRangeStart] = useState("11:00");
  const [rangeEnd, setRangeEnd] = useState("13:00");
  const [recFreq, setRecFreq] = useState<"weekly" | "monthly" | "yearly">("weekly");
  const [recWholeDay, setRecWholeDay] = useState(true);
  const [recStart, setRecStart] = useState("11:00");
  const [recEnd, setRecEnd] = useState("15:00");
  const [recUntil, setRecUntil] = useState("");
  const [sweepNote, setSweepNote] = useState("");

  function selectDay(date: string) {
    setSelectedDate(date);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const node = dayEditorRef.current;
        if (node) revealDayEditor(node);
      });
    });
  }

  /** Server truth. Used on open, after a failed save (to undo the optimistic change), and after a reminder sweep. */
  async function load() {
    try {
      const response = await fetch("/api/admin/state");
      if (response.status === 401) {
        setState(null);
        return;
      }
      const body = await response.json();
      if (!response.ok) {
        setError(body.error || "Could not load admin.");
        return;
      }
      setState({ ...body, unlocks: Array.isArray(body.unlocks) ? body.unlocks : [] });
      setError("");
      setMonth((current) => current || body.today.slice(0, 7));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load admin.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (window.location.search.includes("google=")) window.history.replaceState(null, "", "/admin");
    // load() only sets state after its fetch resolves, never synchronously inside this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), toast.tone === "error" ? 4500 : 2200);
    return () => window.clearTimeout(id);
  }, [toast]);

  /** A short floating note, visible wherever the admin is scrolled. */
  function flash(message: string, tone: "info" | "error" = "info") {
    setToast({ message, tone });
  }

  function goTab(next: Tab) {
    setTab(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.replaceState(null, "", url.pathname + "?" + url.searchParams.toString());
    }
  }

  /**
   * Optimistic save: `apply` changes the screen at once, the request runs in the background in order
   * (so rapid changes reach the server in the order they were made), and `merge` folds in anything
   * only the server knows, such as a new item's id. On failure the server's state is reloaded, which
   * undoes the change, and a short error is shown.
   */
  function mutate<T = Record<string, unknown>>(
    payload: Record<string, unknown>,
    options: { apply?: (prev: State) => State; merge?: (prev: State, body: T) => State; ok?: string } = {},
  ): Promise<T | null> {
    const { apply, merge, ok } = options;
    if (apply) setState((prev) => (prev ? apply(prev) : prev));
    const run = saves.current.then(async () => {
      const response = await fetch("/api/admin/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Could not save.");
      return body as T;
    });
    saves.current = run.catch(() => undefined);
    return run.then(
      (body) => {
        if (merge) setState((prev) => (prev ? merge(prev, body) : prev));
        if (ok) flash(ok);
        return body;
      },
      async (reason: unknown) => {
        const message = reason instanceof Error ? reason.message : "Could not save.";
        flash(apply ? `${message} Change undone.` : message, "error");
        await saves.current; // let later queued saves land first, so the reload reflects all of them
        await load();
        return null;
      },
    );
  }

  /** New personal links need the server's token, so they wait for it instead of showing a guess. */
  async function createUnlock(
    payload: { email: string; name?: string; usSlots: boolean; inPerson: boolean; expiresInDays: number },
    ok: string,
  ): Promise<boolean> {
    setUnlockBusy(true);
    const body = await mutate<{ unlock: UnlockRow }>(
      { addUnlock: payload },
      { merge: (prev, created) => ({ ...prev, unlocks: [...prev.unlocks, created.unlock] }), ok },
    );
    setUnlockBusy(false);
    return Boolean(body);
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    setState(null);
  }

  async function sweep() {
    setSweepNote("");
    const response = await fetch("/api/admin/reminders", { method: "POST" });
    const body = await response.json();
    setSweepNote(response.ok ? `Sent ${body.sent} reminder${body.sent === 1 ? "" : "s"}.` : body.error);
    await load();
  }

  async function copyLink(url: string, slug: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(slug);
      flash("Link copied");
      window.setTimeout(() => setCopied(""), 1600);
    } catch {
      flash("Could not copy. Select the link and copy manually.", "error");
    }
  }

  function parseClock(value: string): number | null {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return h * 60 + m;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f3f0ff] text-[15px] text-[#6e6e73]">
        Loading…
      </div>
    );
  }

  if (!state) {
    return <LoginScreen error={error} />;
  }

  const holidayDates = new Map(state.holidays.map((h) => [h.date, h]));
  const cells = month ? monthMatrix(month) : [];
  const dayManual = selectedDate ? state.manualBlocks.includes(selectedDate) : false;
  const dayOpenOnce = selectedDate ? state.manualOpens.includes(selectedDate) : false;
  const dayUsOpen = selectedDate ? state.usOpenDates.includes(selectedDate) : false;
  const dayWeekend = selectedDate ? isIsraelWeekend(selectedDate) : false;
  const dayHoliday = selectedDate ? holidayDates.get(selectedDate) : undefined;
  // Hour blocks are expanded here from the saved lists, so an optimistic change shows on the calendar at once.
  const blocksBetween = (from: string, to: string) =>
    expandBlocks({ manualBlocks: [], timeBlocks: state.timeBlocks, recurringBlocks: state.recurringBlocks, from, to }).ranges;
  const monthRanges = month ? blocksBetween(`${month}-01`, `${month}-31`) : [];
  // The add row sits above the list; recurring hours come first, then one-off blocks in the order they were added, so a new block lands at the end.
  const dayRecurring = selectedDate
    ? blocksBetween(selectedDate, selectedDate).filter((r) => r.source === "recurring" && !r.wholeDay)
    : [];
  const dayTimeBlocks = selectedDate ? state.timeBlocks.filter((b) => b.date === selectedDate) : [];
  const dayClosures = selectedDate
    ? state.regularClosures.filter(
        (closure) =>
          closuresOn([closure], "intro", selectedDate, weekdayIndex(selectedDate, HOST_TZ)).length > 0 ||
          closuresOn([closure], "45", selectedDate, weekdayIndex(selectedDate, HOST_TZ)).length > 0,
      )
    : [];

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f3f0ff_0%,#f7f5f2_28%,#f5f5f7_100%)] text-[#1d1d1f]">
      {toast ? (
        <div
          role={toast.tone === "error" ? "alert" : "status"}
          className={`fixed top-[max(1rem,env(safe-area-inset-top))] left-1/2 z-50 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 animate-in rounded-2xl px-4 py-3 text-center text-[14px] font-medium text-white shadow-lg duration-200 fade-in slide-in-from-top-2 ${
            toast.tone === "error" ? "bg-[#b42318]" : "bg-[#1d1d1f]"
          }`}
        >
          {toast.message}
        </div>
      ) : null}

      {/* Top bar — phones & foldables */}
      <header data-admin-sticky-header className="sticky top-0 z-40 border-b border-[#5856d6]/10 bg-white/80 backdrop-blur-xl lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.08em] text-[#86868b] uppercase">Schedule</p>
            <h1 className="text-[17px] font-semibold tracking-tight">Admin</h1>
          </div>
          <button
            type="button"
            onClick={logout}
            className="inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-full bg-white px-3 text-[13px] font-medium shadow-sm ring-1 ring-black/5"
          >
            <LogOut className="size-4" />
            <span className="hidden min-[400px]:inline">Sign out</span>
          </button>
        </div>
        <nav aria-label="Admin sections" className="hidden gap-1.5 overflow-x-auto px-4 pb-3 sm:flex [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => goTab(item.id)}
                className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-full px-4 text-[14px] font-semibold transition ${
                  active ? "bg-[#5856d6] text-white shadow-sm shadow-[#5856d6]/25" : "bg-white text-[#1d1d1f] ring-1 ring-black/5"
                }`}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Bottom tab bar — phones */}
      <nav
        aria-label="Admin sections"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-[#5856d6]/10 bg-white/90 px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:hidden"
      >
        {TABS.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => goTab(item.id)}
              className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-semibold transition-colors ${
                active ? "text-[#5856d6]" : "text-[#6e6e73]"
              }`}
            >
              <span className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${active ? "bg-[#ebe9ff]" : ""}`}>
                <Icon className="size-[18px]" />
              </span>
              {item.short}
            </button>
          );
        })}
      </nav>

      <div className="mx-auto flex w-full max-w-[1400px] gap-0 lg:min-h-screen lg:gap-0">
        {/* Desktop / large iPad landscape sidebar */}
        <aside className="sticky top-0 hidden h-screen w-[240px] shrink-0 flex-col border-r border-[#5856d6]/10 bg-white/75 px-4 py-8 backdrop-blur-xl lg:flex xl:w-[260px]">
          <div className="px-2">
            <p className="text-[11px] font-semibold tracking-[0.1em] text-[#86868b] uppercase">{ownerName()}</p>
            <h1 className="mt-1 text-[22px] font-semibold tracking-tight">Schedule</h1>
          </div>
          <nav className="mt-8 flex flex-1 flex-col gap-1">
            {TABS.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => goTab(item.id)}
                  className={`flex h-12 items-center gap-3 rounded-2xl px-3 text-left text-[15px] font-medium transition ${
                    active ? "bg-[#5856d6] text-white shadow-sm shadow-[#5856d6]/20" : "text-[#1d1d1f] hover:bg-[#ebe9ff]"
                  }`}
                >
                  <Icon className="size-[18px]" />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <button
            type="button"
            onClick={logout}
            className="mt-4 flex h-12 items-center gap-3 rounded-2xl px-3 text-[15px] font-medium text-[#86868b] transition hover:bg-black/[0.04] hover:text-[#1d1d1f]"
          >
            <LogOut className="size-[18px]" />
            Sign out
          </button>
        </aside>

        <main className="min-w-0 flex-1 px-4 pt-5 pb-28 sm:px-6 sm:py-7 lg:px-8 lg:py-10 xl:px-10">
          <AdminInstall />
          {error ? (
            <p className="mb-4 rounded-2xl bg-[#fff2f2] px-4 py-3 text-[14px] text-[#b42318]">{error}</p>
          ) : null}

          {tab === "overview" ? (
            <>
              <Overview
                state={state}
                copied={copied}
                onToggleUs={() => {
                  const open = !state.usSlotsOpen;
                  void mutate({ usSlotsOpen: open }, { apply: (prev) => ({ ...prev, usSlotsOpen: open }) });
                }}
                onToggleInPerson={() => {
                  const open = !state.inPersonOpen;
                  void mutate({ inPersonOpen: open }, { apply: (prev) => ({ ...prev, inPersonOpen: open }) });
                }}
                onCopy={copyLink}
                onGo={(next) => goTab(next)}
              />
              <div className="mt-6">
                <CalendarsCard flash={flash} />
              </div>
              <div className="mt-6">
                <UnlockSection
                  unlocks={state.unlocks || []}
                  busy={unlockBusy}
                  copied={copied}
                  onCopy={copyLink}
                  onCreate={(payload) => createUnlock(payload, "Personal unlock created")}
                  onRevoke={async (id) => {
                    await mutate(
                      { revokeUnlock: id },
                      { apply: (prev) => ({ ...prev, unlocks: prev.unlocks.filter((u) => u.id !== id) }), ok: "Unlock revoked" },
                    );
                  }}
                  onSend={async (id) => {
                    setUnlockBusy(true);
                    await mutate({ sendUnlockEmail: id }, { ok: "Unlock email sent" });
                    setUnlockBusy(false);
                  }}
                />
              </div>
            </>
          ) : null}

          {tab === "availability" ? (
            <section className="space-y-6">
              <header className="overflow-hidden rounded-[28px] bg-gradient-to-br from-[#fff1e8] via-[#f3eeff] to-[#eef4ff] p-6 ring-1 ring-[#5856d6]/10 sm:p-7">
                <div>
                  <p className="text-[13px] font-semibold tracking-wide text-[#ea580c] uppercase">Calendar</p>
                  <h2 className="mt-1 text-[28px] font-semibold tracking-tight sm:text-[32px]">Availability</h2>
                  <p className="mt-1 max-w-xl text-[15px] text-[#6e6e73]">
                    Pick a day, then block it, open a normally-closed day once, or close specific hours. Recurring blocks repeat automatically.
                  </p>
                </div>
              </header>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
                <Card>
                  <div className="flex items-center justify-between gap-3">
                    <IconBtn label="Previous month" onClick={() => setMonth((c) => shiftMonth(c, -1))}>
                      <ChevronLeft className="size-5" />
                    </IconBtn>
                    <p className="text-[17px] font-semibold">{month ? monthTitle(month) : ""}</p>
                    <IconBtn label="Next month" onClick={() => setMonth((c) => shiftMonth(c, 1))}>
                      <ChevronRight className="size-5" />
                    </IconBtn>
                  </div>
                  <div className="mt-4 grid grid-cols-7 text-center text-[11px] font-semibold tracking-wide text-[#86868b] uppercase">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                      <div key={d} className="py-2">
                        {d}
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-y-1">
                    {cells.map((date, index) => {
                      if (!date) return <div key={`e-${index}`} className="h-14 sm:h-16" />;
                      const holiday = holidayDates.get(date);
                      const manual = state.manualBlocks.includes(date);
                      const opened = state.manualOpens.includes(date);
                      const usOpened = state.usOpenDates.includes(date);
                      const hasRange = monthRanges.some((r) => r.date === date && !r.wholeDay);
                      const past = date < state.today;
                      const selected = date === selectedDate;
                      const rangeDot = hasRange && !manual && !opened && !selected;
                      const usDot = usOpened && !manual;
                      return (
                        <button
                          key={date}
                          type="button"
                          disabled={past}
                          title={
                            holiday
                              ? `${holiday.name} · ${holiday.kindLabel}`
                              : manual
                                ? "Manually blocked"
                                : opened
                                  ? "Opened once"
                                  : usOpened
                                    ? "US evening slots opened"
                                    : hasRange
                                      ? "Partially blocked"
                                      : "Open — click to manage"
                          }
                          onClick={() => selectDay(date)}
                          className={`mx-auto flex h-14 w-14 cursor-pointer flex-col items-center justify-center rounded-full text-[15px] transition sm:h-16 sm:w-16 ${
                            selected
                              ? "bg-[#5856d6] font-semibold text-white shadow-sm"
                              : manual
                                ? "bg-[#1d1d1f] font-semibold text-white hover:bg-black"
                                : opened
                                  ? "bg-[#dcfce7] font-semibold text-[#166534] hover:bg-[#bbf7d0]"
                                  : holiday
                                  ? "bg-[#fff3d6] font-medium text-[#8a6116] hover:bg-[#ffe9b0]"
                                  : hasRange
                                    ? "bg-[#ebe9ff] font-medium text-[#5856d6] hover:bg-[#ddd9ff]"
                                    : past
                                      ? "cursor-default text-[#d2d2d7]"
                                      : "text-[#1d1d1f] hover:bg-black/[0.06]"
                          }`}
                        >
                          <span>{Number(date.slice(-2))}</span>
                          {rangeDot || usDot ? (
                            <span className="mt-0.5 flex gap-0.5">
                              {rangeDot ? <span className="h-1 w-1 rounded-full bg-current opacity-70" /> : null}
                              {usDot ? <span className="h-1.5 w-1.5 rounded-full bg-[#0ea5e9]" /> : null}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-[12px] text-[#6e6e73]">
                    <Legend color="bg-[#1d1d1f]" label="Whole day blocked" />
                    <Legend color="bg-[#86efac]" label="Opened once" />
                    <Legend color="bg-[#0ea5e9]" label="US slots opened" />
                    <Legend color="bg-[#ffb84d]" label="Holiday" />
                    <Legend color="bg-[#c7b9ff]" label="Hours blocked" />
                    <Legend color="bg-[#5856d6]" label="Selected" />
                  </div>
                </Card>

                <div ref={dayEditorRef} data-day-editor>
                <Card className="min-h-[420px]">
                  {!selectedDate ? (
                    <div className="flex h-full min-h-[360px] flex-col items-center justify-center text-center">
                      <CalendarDays className="size-10 text-[#d2d2d7]" />
                      <p className="mt-4 text-[17px] font-semibold">Select a day</p>
                      <p className="mt-1 max-w-[240px] text-[14px] text-[#6e6e73]">
                        Click any future day to block it, open it once, or close specific hours.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      <div>
                        <p className="text-[12px] font-semibold tracking-wide text-[#86868b] uppercase">
                          {selectedDate}
                        </p>
                        <h3 id="selected-day-options" className="mt-1 text-[22px] font-semibold tracking-tight">
                          {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", {
                            weekday: "long",
                            month: "long",
                            day: "numeric",
                          })}
                        </h3>
                        {dayHoliday ? (
                          <p className="mt-2 rounded-xl bg-[#fff8e8] px-3 py-2 text-[13px] text-[#8a6116]">
                            Auto-closed: {dayHoliday.name} ({dayHoliday.kindLabel})
                          </p>
                        ) : null}
                      </div>

                      <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#f5f5f7] px-4 py-3">
                        <div>
                          <p className="text-[15px] font-semibold">Block entire day</p>
                          <p className="text-[13px] text-[#6e6e73]">
                            {dayManual ? "No slots will be offered." : "Day is open (except holidays)."}
                          </p>
                        </div>
                        <Toggle
                          checked={dayManual}
                          disabled={Boolean(dayHoliday)}
                          onChange={() => {
                            const date = selectedDate;
                            const blocked = !dayManual;
                            void mutate(
                              { setDayBlocked: { date, blocked } },
                              { apply: (prev) => withDayBlocked(prev, date, blocked) },
                            );
                          }}
                        />
                      </div>

                      <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#f5f5f7] px-4 py-3">
                        <div>
                          <p className="text-[15px] font-semibold">Open this day once</p>
                          <p className="text-[13px] text-[#6e6e73]">
                            {dayWeekend
                              ? "Friday and Saturday stay closed."
                              : dayHoliday
                                ? "Auto-holidays stay closed."
                                : dayOpenOnce
                                  ? "This date can offer the usual 11:00–15:00 hours, even if a meeting type would normally skip it. Calendar events, buffers, and hour blocks still apply."
                                  : "Add this date once for Intro and 45-minute meetings. Events, buffers, holidays, and hour blocks still apply. Friday, Saturday, and auto-holidays stay closed."}
                          </p>
                        </div>
                        <Toggle
                          checked={dayOpenOnce}
                          disabled={Boolean(dayHoliday) || dayWeekend}
                          onChange={() => {
                            const date = selectedDate;
                            const open = !dayOpenOnce;
                            void mutate({ setDayOpen: { date, open } }, { apply: (prev) => withDayOpen(prev, date, open) });
                          }}
                        />
                      </div>

                      <div className="flex items-center justify-between gap-3 rounded-2xl bg-[#f5f5f7] px-4 py-3">
                        <div>
                          <p className="text-[15px] font-semibold">Open US evening slots on this day</p>
                          <p className="text-[13px] text-[#6e6e73]">
                            {dayWeekend
                              ? "Friday and Saturday stay closed."
                              : dayHoliday
                                ? "Auto-holidays stay closed."
                                : dayUsOpen
                                  ? "This date offers 21:00–24:00 for Intro and 45-minute meetings, even with US slots off. Calendar events, buffers, and hour blocks still apply."
                                  : "Offer the 21:00–24:00 US evening hours on this date only, for Intro and 45-minute meetings. Events, buffers, and hour blocks still apply."}
                          </p>
                        </div>
                        <Toggle
                          checked={dayUsOpen}
                          disabled={Boolean(dayHoliday) || dayWeekend}
                          onChange={() => {
                            const date = selectedDate;
                            const open = !dayUsOpen;
                            void mutate({ setDayUsOpen: { date, open } }, { apply: (prev) => withDayUsOpen(prev, date, open) });
                          }}
                        />
                      </div>

                      {dayClosures.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => goTab("closures")}
                          className="block w-full rounded-2xl bg-[#f3f0ff] px-4 py-3 text-left text-[13px] text-[#4b47b8] transition-colors hover:bg-[#ebe6ff]"
                        >
                          <span className="font-semibold">Regular closures on this day</span>
                          {dayClosures.map((closure) => (
                            <span key={closure.id} className="mt-0.5 block">
                              {describeClosure(closure)}
                            </span>
                          ))}
                        </button>
                      ) : null}

                      <div>
                        <p className="text-[15px] font-semibold">Blocked hours</p>
                        <div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2">
                          <TimePickerField value={rangeStart} onChange={setRangeStart} ariaLabel="Block from" />
                          <TimePickerField value={rangeEnd} onChange={setRangeEnd} ariaLabel="Block to" />
                          <button
                            type="button"
                            onClick={() => {
                              const startMinute = parseClock(rangeStart);
                              const endMinute = parseClock(rangeEnd);
                              if (startMinute == null || endMinute == null || endMinute <= startMinute) {
                                flash("Enter a valid time range, e.g. 11:00–13:00.", "error");
                                return;
                              }
                              const draft = { id: pendingId(), date: selectedDate, startMinute, endMinute };
                              void mutate<{ created: TimeBlock }>(
                                { addTimeBlock: { date: draft.date, startMinute, endMinute } },
                                {
                                  apply: (prev) => ({ ...prev, timeBlocks: [...prev.timeBlocks, draft] }),
                                  merge: (prev, body) => ({
                                    ...prev,
                                    timeBlocks: prev.timeBlocks.map((b) => (b.id === draft.id ? body.created : b)),
                                  }),
                                },
                              );
                            }}
                            className="h-12 rounded-2xl bg-[#5856d6] px-4 text-[13px] font-semibold text-white shadow-sm shadow-[#5856d6]/25"
                          >
                            Add
                          </button>
                        </div>
                        {dayTimeBlocks.length === 0 && dayRecurring.length === 0 ? (
                          <p className="mt-3 text-[13px] text-[#86868b]">No partial blocks on this day.</p>
                        ) : (
                          <ul className="mt-3 space-y-2">
                            {dayRecurring.map((block, i) => (
                              <li
                                key={`rec-${block.id}-${i}`}
                                className="rounded-xl bg-[#eef5ff] px-3 py-2.5 text-[14px] text-[#1a73e8]"
                              >
                                {minutesLabel(block.startMinute)} – {minutesLabel(block.endMinute)} · recurring
                              </li>
                            ))}
                            {dayTimeBlocks.map((block) => {
                              const pending = isPending(block.id);
                              return (
                                <li
                                  key={block.id}
                                  className={`flex animate-in items-center justify-between gap-3 rounded-xl bg-[#f5f5f7] px-3 py-2.5 text-[14px] transition-opacity duration-200 fade-in ${pending ? "opacity-60" : ""}`}
                                >
                                  <span>
                                    {minutesLabel(block.startMinute)} – {minutesLabel(block.endMinute)}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={pending}
                                    onClick={() =>
                                      void mutate(
                                        { removeTimeBlock: block.id },
                                        { apply: (prev) => ({ ...prev, timeBlocks: prev.timeBlocks.filter((b) => b.id !== block.id) }) },
                                      )
                                    }
                                    className="h-11 rounded-full px-3.5 text-[14px] font-medium text-[#b42318] transition-colors hover:bg-white disabled:cursor-wait"
                                  >
                                    Remove
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}

                      </div>

                      <div className="border-t border-black/5 pt-5">
                        <p className="text-[15px] font-semibold">Make this recurring</p>
                        <p className="mt-1 text-[13px] text-[#6e6e73]">
                          Repeat this day (or a time range on it) every week, month, or year.
                        </p>
                        <div className="mt-3 space-y-3">
                          <SegmentedControl
                            ariaLabel="Repeat frequency"
                            value={recFreq}
                            onChange={(v) => setRecFreq(v)}
                            options={[
                              { value: "weekly", label: "Week" },
                              { value: "monthly", label: "Month" },
                              { value: "yearly", label: "Year" },
                            ]}
                          />
                          <FancyCheck
                            checked={recWholeDay}
                            onChange={setRecWholeDay}
                            label="Whole day"
                          />
                        </div>
                        {!recWholeDay ? (
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <TimePickerField value={recStart} onChange={setRecStart} ariaLabel="Recurring from" />
                            <TimePickerField value={recEnd} onChange={setRecEnd} ariaLabel="Recurring to" />
                          </div>
                        ) : null}
                        <div className="mt-3">
                          <DatePickerField
                            label="Ends on (optional)"
                            value={recUntil}
                            onChange={setRecUntil}
                            min={selectedDate}
                            placeholder="No end date"
                          />
                        </div>
                        <Button
                          type="button"
                          disabled={!selectedDate}
                          className="mt-3 h-12 w-full rounded-2xl bg-[#5856d6] text-[15px] hover:bg-[#4a48c7]"
                          onClick={() => {
                            let startMinute: number | null = null;
                            let endMinute: number | null = null;
                            if (!recWholeDay) {
                              startMinute = parseClock(recStart);
                              endMinute = parseClock(recEnd);
                              if (startMinute == null || endMinute == null || endMinute <= startMinute) {
                                flash("Enter a valid recurring time range.", "error");
                                return;
                              }
                            }
                            const draft: RecurringBlock = {
                              id: pendingId(),
                              frequency: recFreq,
                              anchorDate: selectedDate,
                              startMinute,
                              endMinute,
                              until: recUntil || null,
                            };
                            void mutate<{ created: RecurringBlock }>(
                              {
                                addRecurring: {
                                  frequency: draft.frequency,
                                  anchorDate: draft.anchorDate,
                                  startMinute,
                                  endMinute,
                                  until: draft.until,
                                },
                              },
                              {
                                apply: (prev) => ({ ...prev, recurringBlocks: [...prev.recurringBlocks, draft] }),
                                merge: (prev, body) => ({
                                  ...prev,
                                  recurringBlocks: prev.recurringBlocks.map((b) => (b.id === draft.id ? body.created : b)),
                                }),
                                ok: "Recurring block added",
                              },
                            );
                          }}
                        >
                          Add recurring block
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
                </div>
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <Card>
                  <h3 className="text-[17px] font-semibold">Recurring blocks</h3>
                  {state.recurringBlocks.length === 0 ? (
                    <p className="mt-2 text-[14px] text-[#86868b]">None yet. Select a day to create one.</p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {state.recurringBlocks.map((block) => (
                        <li
                          key={block.id}
                          className={`flex animate-in items-start justify-between gap-3 rounded-2xl bg-[#f5f5f7] px-4 py-3 transition-opacity duration-200 fade-in ${isPending(block.id) ? "opacity-60" : ""}`}
                        >
                          <div>
                            <p className="text-[14px] font-semibold capitalize">{block.frequency}</p>
                            <p className="text-[13px] text-[#6e6e73]">{describeRecurring(block)}</p>
                            <p className="text-[12px] text-[#86868b]">Starts {block.anchorDate}</p>
                          </div>
                          <button
                            type="button"
                            disabled={isPending(block.id)}
                            onClick={() =>
                              void mutate(
                                { removeRecurring: block.id },
                                {
                                  apply: (prev) => ({
                                    ...prev,
                                    recurringBlocks: prev.recurringBlocks.filter((b) => b.id !== block.id),
                                  }),
                                },
                              )
                            }
                            className="h-11 shrink-0 rounded-full px-3.5 text-[14px] font-medium text-[#b42318] transition-colors hover:bg-white disabled:cursor-wait"
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card>
                  <button
                    type="button"
                    onClick={() => setHolidaysOpen((v) => !v)}
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <div>
                      <h3 className="text-[17px] font-semibold">Auto-blocked holidays</h3>
                      <p className="text-[13px] text-[#6e6e73]">{state.holidays.length} upcoming</p>
                    </div>
                    <ChevronDown className={`size-5 text-[#86868b] transition ${holidaysOpen ? "rotate-180" : ""}`} />
                  </button>
                  {holidaysOpen ? (
                    <ul className="mt-3 max-h-72 divide-y divide-black/5 overflow-y-auto text-[14px]">
                      {state.holidays.map((holiday) => (
                        <li key={`${holiday.date}-${holiday.name}`} className="flex justify-between gap-3 py-2.5">
                          <span>
                            <strong className="font-semibold">{holiday.date}</strong> {holiday.name}
                          </span>
                          <span className="shrink-0 text-[#86868b]">{holiday.kindLabel}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </Card>
              </div>
            </section>
          ) : null}

          {tab === "closures" ? (
            <section>
              <header className="mb-6">
                <h2 className="text-[28px] font-semibold tracking-tight sm:text-[32px]">Regular closures</h2>
                <p className="mt-1 max-w-xl text-[15px] text-[#6e6e73]">
                  Weekly times when Intro or 45-minute meetings are never offered, on top of everything else.
                </p>
              </header>
              <Card className="max-w-2xl max-sm:!p-4">
                <ClosuresSection
                  closures={state.regularClosures}
                  isPending={isPending}
                  onInvalid={(message) => flash(message, "error")}
                  onAdd={(fields: ClosureFields) => {
                    const draft = { id: pendingId(), ...fields };
                    void mutate<{ created: RegularClosure }>(
                      { addClosure: fields },
                      {
                        apply: (prev) => ({ ...prev, regularClosures: [...prev.regularClosures, draft] }),
                        merge: (prev, body) => ({
                          ...prev,
                          regularClosures: prev.regularClosures.map((c) => (c.id === draft.id ? body.created : c)),
                        }),
                      },
                    );
                  }}
                  onUpdate={(id, fields) =>
                    void mutate(
                      { updateClosure: { id, ...fields } },
                      { apply: (prev) => ({ ...prev, regularClosures: prev.regularClosures.map((c) => (c.id === id ? { id, ...fields } : c)) }) },
                    )
                  }
                  onRemove={(id) =>
                    void mutate(
                      { removeClosure: id },
                      { apply: (prev) => ({ ...prev, regularClosures: prev.regularClosures.filter((c) => c.id !== id) }) },
                    )
                  }
                />
              </Card>
            </section>
          ) : null}

          {tab === "bookings" ? (
            <section>
              <header className="mb-6">
                <h2 className="text-[28px] font-semibold tracking-tight sm:text-[32px]">Bookings</h2>
                <p className="mt-1 text-[15px] text-[#6e6e73]">Upcoming confirmed meetings.</p>
              </header>
              {state.bookings.length === 0 ? (
                <Card>
                  <p className="py-10 text-center text-[15px] text-[#86868b]">No upcoming bookings.</p>
                </Card>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {state.bookings.map((booking) => (
                    <Card key={booking.id} className="!p-5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[17px] font-semibold tracking-tight">{booking.name}</p>
                          <p className="text-[13px] text-[#6e6e73]">{booking.email}</p>
                        </div>
                        <Chip>{booking.meeting}</Chip>
                      </div>
                      <p className="mt-4 text-[15px] font-medium">{booking.when}</p>
                      <p className="mt-1 text-[13px] text-[#6e6e73]">
                        {booking.mode === "meet"
                          ? "Google Meet"
                          : booking.mode === "inperson"
                            ? `In person${booking.location ? ` · ${booking.location}` : ""}`
                            : `Phone ${booking.phone}`}
                      </p>
                      {booking.company ? <p className="mt-1 text-[13px] text-[#86868b]">{booking.company}</p> : null}
                      <div className="mt-4 flex flex-wrap gap-2">
                        {booking.reminderSentAt ? (
                          <Chip tone="green">Reminder sent</Chip>
                        ) : booking.reminderSendAt ? (
                          <Chip tone="blue">Reminder scheduled</Chip>
                        ) : (
                          <Chip tone="muted">No reminder</Chip>
                        )}
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={unlockBusy}
                          onClick={() =>
                            void createUnlock(
                              { email: booking.email, name: booking.name, usSlots: true, inPerson: false, expiresInDays: 14 },
                              `US evenings unlocked for ${booking.name}`,
                            ).then((created) => {
                              if (created) goTab("overview");
                            })
                          }
                          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-[#eef4ff] text-[12px] font-semibold text-[#2563eb]"
                        >
                          <KeyRound className="size-3.5" />
                          Unlock US
                        </button>
                        <button
                          type="button"
                          disabled={unlockBusy}
                          onClick={() =>
                            void createUnlock(
                              { email: booking.email, name: booking.name, usSlots: false, inPerson: true, expiresInDays: 14 },
                              `In-person unlocked for ${booking.name}`,
                            ).then((created) => {
                              if (created) goTab("overview");
                            })
                          }
                          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-[#fff1e8] text-[12px] font-semibold text-[#ea580c]"
                        >
                          <KeyRound className="size-3.5" />
                          Unlock in-person
                        </button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {tab === "activity" ? (
            <section>
              <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-[28px] font-semibold tracking-tight sm:text-[32px]">Activity</h2>
                  <p className="mt-1 text-[15px] text-[#6e6e73]">
                    Confirmations and reminders. Cron runs hourly
                    {state.cron ? " (configured)" : ""}.
                  </p>
                </div>
                <details className="rounded-2xl bg-white ring-1 ring-black/5">
                  <summary className="flex h-11 cursor-pointer list-none items-center gap-2 px-4 text-[13px] font-semibold">
                    <Send className="size-4" />
                    Manual fallback
                  </summary>
                  <div className="border-t border-black/5 px-4 py-3">
                    <p className="mb-2 max-w-xs text-[12px] text-[#6e6e73]">
                      Reminders usually send automatically. Use this only if something looks stuck.
                    </p>
                    <Button type="button" variant="outline" className="h-11 rounded-xl text-[14px]" onClick={sweep}>
                      Send due reminders
                    </Button>
                    {sweepNote ? <p className="mt-2 text-[13px] text-[#6e6e73]">{sweepNote}</p> : null}
                  </div>
                </details>
              </header>

              <Card>
                <button
                  type="button"
                  onClick={() => setActivityOpen((v) => !v)}
                  className="flex w-full items-center justify-between gap-3 text-left lg:pointer-events-none"
                >
                  <div>
                    <h3 className="text-[17px] font-semibold">Recent notifications</h3>
                    <p className="text-[13px] text-[#6e6e73]">{state.activity.length} events</p>
                  </div>
                  <ChevronDown className={`size-5 text-[#86868b] transition lg:hidden ${activityOpen ? "rotate-180" : ""}`} />
                </button>
                <ul className={`mt-4 space-y-2 ${activityOpen ? "block" : "hidden lg:block"}`}>
                  {state.activity.length === 0 ? (
                    <li className="py-8 text-center text-[14px] text-[#86868b]">Nothing yet.</li>
                  ) : (
                    state.activity.map((row) => (
                      <li
                        key={row.id + row.createdAt}
                        className="flex flex-col gap-2 rounded-2xl bg-[#f5f5f7] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[14px] font-semibold">{row.title}</p>
                          <p className="truncate text-[12px] text-[#86868b]">{row.detail}</p>
                          <p className="text-[12px] text-[#86868b]">{row.when}</p>
                        </div>
                        <StatusChip status={row.status} />
                      </li>
                    ))
                  )}
                </ul>
              </Card>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}

function Overview({
  state,
  copied,
  onToggleUs,
  onToggleInPerson,
  onCopy,
  onGo,
}: {
  state: State;
  copied: string;
  onToggleUs: () => void;
  onToggleInPerson: () => void;
  onCopy: (url: string, slug: string) => void;
  onGo: (tab: Tab) => void;
}) {
  const hour = typeof window === "undefined" ? 9 : new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const tint: Record<string, { card: string; icon: string; chip: string }> = {
    intro: { card: "bg-gradient-to-br from-[#eef4ff] to-white", icon: "bg-[#dbeafe] text-[#2563eb]", chip: "text-[#2563eb]" },
    "45": { card: "bg-gradient-to-br from-[#f3eeff] to-white", icon: "bg-[#ede9fe] text-[#7c3aed]", chip: "text-[#7c3aed]" },
    inperson: { card: "bg-gradient-to-br from-[#fff1e8] to-white", icon: "bg-[#ffedd5] text-[#ea580c]", chip: "text-[#ea580c]" },
  };

  return (
    <section className="space-y-6">
      <header className="overflow-hidden rounded-[28px] bg-gradient-to-br from-[#5856d6] via-[#6d5ef5] to-[#8b5cf6] p-6 text-white shadow-[0_20px_50px_rgba(88,86,214,0.28)] sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="inline-flex items-center gap-2 text-[13px] font-medium text-white/80">
              <Sun className="size-4" />
              {hello}, {ownerFirstName()}
            </p>
            <h2 className="mt-2 text-[28px] font-semibold tracking-tight sm:text-[34px]">Overview</h2>
            <p className="mt-1 max-w-xl text-[15px] text-white/80">
              Quick links, toggles, and a snapshot of what is coming up.
            </p>
          </div>
          <span className="inline-flex h-10 items-center gap-2 rounded-full bg-white/15 px-4 text-[13px] font-semibold backdrop-blur">
            <Sparkles className="size-4" />
            Scheduling desk
          </span>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {state.links.map((link) => {
          const style = tint[link.slug] || tint.intro;
          return (
            <Card key={link.slug} className={`!p-5 ${style.card}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`flex size-10 items-center justify-center rounded-2xl ${style.icon}`}>
                    {link.slug === "inperson" ? <MapPin className="size-4" /> : <Link2 className="size-4" />}
                  </span>
                  <div>
                    <p className="text-[15px] font-semibold">{link.name}</p>
                    <p className={`text-[12px] font-medium ${style.chip}`}>{link.path}</p>
                  </div>
                </div>
                {link.gated ? (
                  <Chip tone={link.open ? "green" : "muted"}>{link.open ? "Open" : "Closed"}</Chip>
                ) : null}
              </div>
              <div className="mt-4 flex gap-2">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#1d1d1f] text-[13px] font-semibold text-white"
                >
                  <ExternalLink className="size-4" />
                  Open
                </a>
                <button
                  type="button"
                  onClick={() => onCopy(link.url, link.slug)}
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-white/80 text-[13px] font-semibold ring-1 ring-black/5"
                >
                  {copied === link.slug ? <Check className="size-4 text-[#1a7f37]" /> : <Copy className="size-4" />}
                  {copied === link.slug ? "Copied" : "Copy"}
                </button>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="!bg-gradient-to-br !from-[#e8f8ee] !to-white !p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-[17px] font-semibold">US evening slots</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-[#6e6e73]">
                Opens for everyone. Mon–Wed, 21:00–24:00 Israel time. Visitors still see their own zone.
              </p>
              <p className={`mt-2 text-[13px] font-semibold ${state.usSlotsOpen ? "text-[#1a7f37]" : "text-[#86868b]"}`}>
                {state.usSlotsOpen ? "Currently open" : "Currently closed"}
              </p>
            </div>
            <Toggle checked={state.usSlotsOpen} onChange={onToggleUs} />
          </div>
        </Card>
        <Card className="!bg-gradient-to-br !from-[#fff1e8] !to-white !p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-[17px] font-semibold">In-person meetings</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-[#6e6e73]">
                Opens for everyone. Mon–Wed evenings from 21:30. Booker adds a location for the calendar invite.
              </p>
              <p className={`mt-2 text-[13px] font-semibold ${state.inPersonOpen ? "text-[#1a7f37]" : "text-[#86868b]"}`}>
                {state.inPersonOpen ? "Currently open" : "Currently closed"}
              </p>
            </div>
            <Toggle checked={state.inPersonOpen} onChange={onToggleInPerson} />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Upcoming bookings"
          value={String(state.bookings.length)}
          onClick={() => onGo("bookings")}
          tone="blue"
        />
        <StatCard
          label="Manual day blocks"
          value={String(state.manualBlocks.length)}
          onClick={() => onGo("availability")}
          tone="violet"
        />
        <StatCard
          label="Recurring blocks"
          value={String(state.recurringBlocks.length)}
          onClick={() => onGo("availability")}
          tone="peach"
        />
      </div>
    </section>
  );
}

function UnlockSection({
  unlocks,
  busy,
  copied,
  onCopy,
  onCreate,
  onRevoke,
  onSend,
}: {
  unlocks: UnlockRow[];
  busy: boolean;
  copied: string;
  onCopy: (url: string, slug: string) => void;
  onCreate: (payload: {
    email: string;
    name?: string;
    usSlots: boolean;
    inPerson: boolean;
    expiresInDays: number;
  }) => Promise<boolean>;
  onRevoke: (id: string) => Promise<void>;
  onSend: (id: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [usSlots, setUsSlots] = useState(true);
  const [inPerson, setInPerson] = useState(false);
  const [days, setDays] = useState("14");

  return (
    <section className="space-y-4">
      <Card className="!bg-gradient-to-br !from-[#ebe9ff] !via-white !to-[#fff1e8] !p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="inline-flex items-center gap-2 text-[12px] font-semibold tracking-wide text-[#5856d6] uppercase">
              <KeyRound className="size-3.5" />
              Only for one person
            </p>
            <h2 className="mt-1 text-[24px] font-semibold tracking-tight sm:text-[28px]">Unlock for a person</h2>
            <p className="mt-1 max-w-xl text-[14px] text-[#6e6e73]">
              Turn on US evenings and/or in-person for one email. Their personal link (and any booking “Need another time”
              link for that email) will show those options after a refresh — even while the global toggles stay off. Use
              <strong> Send unlock email</strong> when you want to notify them.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-[#6e6e73]">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              autoComplete="email"
              className="h-12 w-full rounded-2xl bg-white px-3.5 text-[16px] outline-none ring-1 ring-black/5 focus:ring-2 focus:ring-[#5856d6]/30"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-[#6e6e73]">Name (optional)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="First name"
              className="h-12 w-full rounded-2xl bg-white px-3.5 text-[16px] outline-none ring-1 ring-black/5 focus:ring-2 focus:ring-[#5856d6]/30"
            />
          </label>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <FancyCheck checked={usSlots} onChange={setUsSlots} label="US evenings (21:00–24:00)" />
          <FancyCheck checked={inPerson} onChange={setInPerson} label="In-person (21:30+)" />
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block w-full max-w-[160px]">
            <span className="mb-1.5 block text-[12px] font-medium text-[#6e6e73]">Expires in (days)</span>
            <input
              value={days}
              onChange={(e) => setDays(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
              inputMode="numeric"
              className="h-12 w-full rounded-2xl bg-white px-3.5 text-[16px] outline-none ring-1 ring-black/5 focus:ring-2 focus:ring-[#5856d6]/30"
            />
          </label>
          <button
            type="button"
            disabled={busy || !email.trim() || (!usSlots && !inPerson)}
            onClick={() =>
              onCreate({
                email: email.trim(),
                name: name.trim() || undefined,
                usSlots,
                inPerson,
                expiresInDays: Number(days) || 14,
              }).then((created) => {
                if (!created) return;
                setEmail("");
                setName("");
              })
            }
            className="h-12 min-w-[180px] flex-1 cursor-pointer rounded-2xl bg-[#5856d6] px-5 text-[14px] font-semibold whitespace-nowrap text-white shadow-sm shadow-[#5856d6]/25 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
          >
            Create personal link
          </button>
        </div>
      </Card>

      {unlocks.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-[14px] text-[#86868b]">No active personal unlocks.</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {unlocks.map((u) => {
            return (
              <Card key={u.id} className="!p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[16px] font-semibold [overflow-wrap:anywhere]">{u.name || u.email}</p>
                    {u.name ? <p className="text-[13px] text-[#6e6e73] [overflow-wrap:anywhere]">{u.email}</p> : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {u.usSlots ? <Chip tone="blue">US evenings</Chip> : null}
                      {u.inPerson ? <Chip tone="green">In-person</Chip> : null}
                      <Chip tone="muted">Until {new Date(u.expiresAt).toLocaleDateString()}</Chip>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onSend(u.id)}
                      className="inline-flex h-11 items-center gap-1.5 rounded-full bg-[#5856d6] px-4 text-[14px] font-semibold text-white shadow-sm shadow-[#5856d6]/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Send className="size-3.5" />
                      Send unlock email
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onRevoke(u.id)}
                      className="h-11 rounded-full px-4 text-[14px] font-medium text-[#b42318] hover:bg-[#fff2f2] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {u.links.map((link) => (
                    <div key={link.url} className="flex min-w-0 flex-col gap-2 rounded-2xl bg-[#f5f4fa] p-2">
                      <div className="min-w-0 flex-1 px-2 py-1.5">
                        <p className="text-[12px] font-semibold text-[#5856d6]">{link.label}</p>
                        <p className="text-[12px] break-all text-[#6e6e73]">{link.url}</p>
                      </div>
                      <div className="flex gap-2">
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-[#1d1d1f] px-3 text-[14px] font-semibold text-white"
                        >
                          Open
                        </a>
                        <button
                          type="button"
                          onClick={() => onCopy(link.url, `${u.id}:${link.label}`)}
                          className="inline-flex h-11 flex-1 items-center justify-center rounded-xl bg-white px-3 text-[14px] font-semibold ring-1 ring-black/5"
                        >
                          {copied === `${u.id}:${link.label}` ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}


function LoginScreen({ error }: { error: string }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f7f5f2] px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(88,86,214,0.18),_transparent_55%),radial-gradient(ellipse_at_bottom_right,_rgba(234,88,12,0.08),_transparent_45%)]" />
      <div className="relative w-full max-w-[420px] rounded-[28px] bg-white/90 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.08)] ring-1 ring-black/5 backdrop-blur sm:p-10">
        <p className="text-center text-[12px] font-semibold tracking-[0.12em] text-[#86868b] uppercase">
          {ownerName()}
        </p>
        <h1 className="mt-3 text-center text-[28px] font-semibold tracking-tight text-[#1d1d1f]">Sign in</h1>
        <p className="mt-2 text-center text-[15px] leading-relaxed text-[#6e6e73]">
          Manage availability, bookings, and meeting types for your scheduling page.
        </p>
        <a
          href="/api/admin/oauth/google/start"
          className="mt-8 flex h-12 w-full items-center justify-center gap-3 rounded-full bg-white text-[15px] font-semibold text-[#1d1d1f] shadow-sm ring-1 ring-black/10 transition hover:bg-[#fafafa]"
        >
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
          </svg>
          Continue with Google
        </a>
        {error ? <p className="mt-4 text-center text-[13px] text-[#b42318]">{error}</p> : null}
        <p className="mt-6 text-center text-[12px] text-[#86868b]">Only the owner Google account can sign in.</p>
        <div className="mt-5">
          <AdminInstall />
        </div>
      </div>
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[24px] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-black/5 sm:p-6 ${className}`}>
      {children}
    </div>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className="relative flex h-11 w-[60px] shrink-0 cursor-pointer items-center justify-center disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        className={`relative h-8 w-[52px] rounded-full transition-colors duration-200 ease-out ${
          checked ? "bg-[#34c759]" : "bg-[#d2d2d7]"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-7 w-7 rounded-full bg-white shadow-md transition-transform duration-200 ease-out ${
            checked ? "translate-x-[20px]" : "translate-x-0"
          }`}
        />
      </span>
      <span className="sr-only">Toggle</span>
    </button>
  );
}

function Chip({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "green" | "blue" | "muted" }) {
  const tones = {
    default: "bg-[#f5f5f7] text-[#1d1d1f]",
    green: "bg-[#e8f8ee] text-[#1a7f37]",
    blue: "bg-[#e8f0fe] text-[#1a73e8]",
    muted: "bg-[#f5f5f7] text-[#86868b]",
  };
  return (
    <span className={`inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );
}

function StatusChip({ status }: { status: string }) {
  if (status === "sent") return <Chip tone="green">Sent</Chip>;
  if (status === "failed") return <Chip tone="default">Failed</Chip>;
  return <Chip tone="blue">Queued</Chip>;
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function StatCard({
  label,
  value,
  onClick,
  tone = "blue",
}: {
  label: string;
  value: string;
  onClick: () => void;
  tone?: "blue" | "violet" | "peach";
}) {
  const tones = {
    blue: "from-[#eef4ff] to-white text-[#2563eb]",
    violet: "from-[#f3eeff] to-white text-[#7c3aed]",
    peach: "from-[#fff1e8] to-white text-[#ea580c]",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[24px] bg-gradient-to-br p-5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-black/5 transition hover:ring-black/10 ${tones[tone]}`}
    >
      <p className="text-[13px] font-medium text-[#6e6e73]">{label}</p>
      <p className="mt-1 text-[32px] font-semibold tracking-tight text-[#1d1d1f]">{value}</p>
    </button>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full hover:bg-black/[0.05]"
    >
      {children}
    </button>
  );
}

