"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { avatarPath, logoAlt, logoPath, ownerFirstName, ownerName } from "@/lib/brand";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Clock, Globe } from "lucide-react";
import { ShareActions } from "@/components/share-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListboxSelect } from "@/components/ui/pickers";
import { Label } from "@/components/ui/label";
import { MEETINGS, TIME_ZONES, cityName, type MeetingMode, type MeetingSlug } from "@/lib/meetings";
import { civilDateLabel, monthMatrix, monthTitle } from "@/lib/month";
import {
  cachedSlots,
  forgetSlots,
  loadSlots,
  monthInZone,
  neighbourMonths,
  prefetchSlots,
  slotsKey,
  visitorTimeZone,
  type Slot,
} from "@/lib/slots-client";
import { shiftMonth } from "@/lib/time";

const fieldClass = "h-11 rounded-lg px-3 text-base md:text-base";

export function Scheduler({ slug }: { slug: MeetingSlug }) {
  const meeting = MEETINGS[slug];
  const router = useRouter();
  const params = useSearchParams();
  const rescheduleId = params.get("reschedule") ?? "";
  const rescheduleToken = params.get("t") ?? "";
  const unlockKey = params.get("k") ?? "";

  const [timeZone, setTimeZone] = useState("");
  const [month, setMonth] = useState("");
  const [, setLoads] = useState(0);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [pickedDate, setPickedDate] = useState("");
  const [selected, setSelected] = useState<Slot | null>(null);
  const [step, setStep] = useState<"pick" | "form">("pick");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [mode, setMode] = useState<MeetingMode>("meet");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [location, setLocation] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [reload, setReload] = useState(0);
  const timesRef = useRef<HTMLDivElement>(null);

  // On date pick, bring the times into view right away (mobile stacks them below the calendar).
  useEffect(() => {
    if (!pickedDate) return;
    const frame = requestAnimationFrame(() => {
      const panel = timesRef.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const visible = rect.top >= 0 && rect.top < window.innerHeight - 160;
      if (!visible) {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        panel.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [pickedDate]);

  useEffect(() => {
    const detected = visitorTimeZone();
    const handle = window.setTimeout(() => {
      setTimeZone(detected);
      setMonth(monthInZone(detected));
    }, 0);
    return () => window.clearTimeout(handle);
  }, []);

  useEffect(() => {
    if (!rescheduleId || !rescheduleToken) return;
    let cancelled = false;
    fetch(`/api/bookings/${rescheduleId}?t=${encodeURIComponent(rescheduleToken)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "That link is not valid.");
        if (cancelled) return;
        if (body.meetingSlug !== slug) {
          setLinkError("This link is for a different meeting type.");
          return;
        }
        setName(body.name ?? "");
        setEmail(body.email ?? "");
        setCompany(body.company ?? "");
        setMode(body.mode === "phone" ? "phone" : "meet");
        setPhone(body.phone ?? "");
        setNotes(body.notes ?? "");
        setLocation(body.location ?? "");
      })
      .catch((reason: Error) => {
        if (!cancelled) setLinkError(reason.message);
      });
    return () => {
      cancelled = true;
    };
  }, [rescheduleId, rescheduleToken, slug]);

  useEffect(() => {
    if (!timeZone || !month) return;
    let cancelled = false;
    const query = { slug, timeZone, month, unlockKey, rescheduleId, rescheduleToken };
    loadSlots(query)
      .then(() => {
        if (cancelled) return;
        setFailure(null);
        setLoads((count) => count + 1);
      })
      .catch((reason: Error) => {
        if (!cancelled) setFailure({ key: slotsKey(query), message: reason.message });
      });
    // Warm the months one tap away so month switches render from memory.
    for (const nearby of neighbourMonths(month, monthInZone(timeZone))) prefetchSlots({ ...query, month: nearby });
    return () => {
      cancelled = true;
    };
  }, [slug, timeZone, month, reload, unlockKey, rescheduleId, rescheduleToken]);

  // Coming back to the tab refetches the month in the background, so an admin change made meanwhile
  // shows up without a reload. The cached grid stays on screen until the new answer arrives.
  useEffect(() => {
    if (!timeZone || !month) return;
    const query = { slug, timeZone, month, unlockKey, rescheduleId, rescheduleToken };
    function refresh() {
      if (document.visibilityState !== "visible") return;
      loadSlots(query, Date.now(), 0)
        .then(() => setLoads((count) => count + 1))
        .catch(() => undefined);
    }
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [slug, timeZone, month, unlockKey, rescheduleId, rescheduleToken]);

  const zones = useMemo(() => {
    if (timeZone && !TIME_ZONES.includes(timeZone)) return [timeZone, ...TIME_ZONES];
    return TIME_ZONES;
  }, [timeZone]);

  // Render straight from the shared cache: a cached month shows on the same frame as the tap,
  // an uncached one shows the skeleton (never the previous month's grid) until it arrives.
  const query = { slug, timeZone, month, unlockKey, rescheduleId, rescheduleToken };
  const data = timeZone && month ? cachedSlots(query) : null;
  const error = failure?.key === slotsKey(query) ? failure.message : "";
  const loading = !data && !error;
  const byDate = useMemo(() => new Map((data?.days ?? []).map((day) => [day.date, day.slots])), [data]);
  const selectedDate = byDate.has(pickedDate) ? pickedDate : "";
  const cells = month ? monthMatrix(month) : [];
  const today = timeZone
    ? new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
    : "";
  const slots = selectedDate ? byDate.get(selectedDate) ?? [] : [];
  const clock = data?.timeZoneLabel.split("·").pop()?.trim() ?? "";
  const abbr = data?.timeZoneLabel.match(/\(([^)]+)\)/)?.[1] ?? "";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    setFormError("");
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingSlug: slug,
          start: selected.start,
          timeZone,
          name,
          email,
          company,
          mode: meeting.requiresLocation ? "inperson" : mode,
          phone,
          location: meeting.requiresLocation ? location : undefined,
          notes,
          rescheduleId: rescheduleId || undefined,
          rescheduleToken: rescheduleToken || undefined,
          unlockToken: unlockKey || undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (response.status === 409) {
          setStep("pick");
          setSelected(null);
          forgetSlots({ slug, timeZone, month, unlockKey, rescheduleId, rescheduleToken });
          setReload((current) => current + 1);
        }
        throw new Error(body.error || "Could not book that time.");
      }
      const token = body.token || rescheduleToken;
      router.push(`/booking/${body.id}?t=${encodeURIComponent(token)}`);
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : "Could not book that time.");
      setSubmitting(false);
    }
  }

  const range = selected ? formatRange(selected.start, selected.end, timeZone) : null;
  const closed = Boolean(data?.closed);
  // A gated type offers Share only once the server confirms it is open to this visitor.
  const shareable = data ? !closed : !meeting.eveningOnly;

  return (
    <main className="flex flex-1 justify-center px-3 py-6 sm:px-6 sm:py-10">
      <section className="w-full max-w-[980px] overflow-hidden rounded-xl border border-[#e4e7ee] bg-white shadow-[0_10px_40px_rgba(15,23,42,0.04)] md:grid md:min-h-[680px] md:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="border-b border-[#e7e9ee] px-6 py-8 md:border-r md:border-b-0">
          <Link href="/" className="mx-auto flex w-fit">
            {logoPath() ? (
              <Image src={logoPath()} alt={logoAlt()} width={153} height={57} className="h-10 w-auto" />
            ) : (
              <span className="text-[15px] font-medium text-[#4d6f90]">{ownerName()}</span>
            )}
          </Link>
          <div className="my-6 h-px bg-[#e7e9ee]" />
          <Image src={avatarPath()} alt="" width={64} height={64} className="h-16 w-16 rounded-full object-cover" />
          <p className="mt-4 text-[15px] font-medium text-[#4d6f90]">{ownerName()}</p>
          <h1 className="mt-2 text-[28px] leading-tight font-bold tracking-tight text-[#0e1b2c]">{meeting.name}</h1>
          <p className="mt-4 flex items-center gap-2 text-[15px] text-[#3e5168]">
            <Clock className="size-4" aria-hidden />
            {meeting.durationMinutes} min
          </p>
          {shareable ? (
            <div className="mt-5">
              <ShareActions path={meeting.path} name={meeting.name} />
            </div>
          ) : null}
        </aside>

        <div className="px-5 py-7 sm:px-8">
          {linkError ? <p className="mb-4 text-sm text-[#9b3b3b]">{linkError}</p> : null}
          {step === "pick" && formError ? <p className="mb-4 text-sm text-[#9b3b3b]">{formError}</p> : null}
          {rescheduleId && !linkError ? (
            <p className="mb-4 rounded-lg bg-[#f6f7fb] px-3 py-2 text-sm text-[#3e5168]">
              Choose a new time. The current booking stays until you confirm.
            </p>
          ) : null}

          {closed ? (
            <div className="mx-auto max-w-md py-10 text-center">
              <h2 className="text-xl font-bold">This meeting type isn’t open right now</h2>
              <p className="mt-2 text-[15px] text-[#3e5168]">Pick another meeting type to find a time.</p>
              <Link href="/" className="mt-6 inline-block text-sm font-medium text-[#3d6d9a] hover:underline">
                See meeting types
              </Link>
            </div>
          ) : step === "form" && selected && range ? (
            <form onSubmit={submit} className="mx-auto max-w-md">
              <button
                type="button"
                onClick={() => setStep("pick")}
                className="mb-4 text-sm font-medium text-[#3d6d9a] hover:underline"
              >
                ← Back
              </button>
              <h2 className="text-xl font-bold">Enter details</h2>
              <p className="mt-2 text-[15px] text-[#3e5168]">
                <strong className="font-semibold text-[#0e1b2c]">{range.date}</strong>
                <br />
                {range.time}
              </p>
              <div className="mt-6 space-y-4">
                <Field label="Name" htmlFor="name">
                  <Input id="name" required autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} />
                </Field>
                <Field label="Email" htmlFor="email">
                  <Input id="email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className={fieldClass} />
                </Field>
                <Field label="Company or website" htmlFor="company" optional>
                  <Input id="company" autoComplete="organization" value={company} onChange={(event) => setCompany(event.target.value)} className={fieldClass} />
                </Field>
                {meeting.requiresLocation ? (
                  <Field label="Location" htmlFor="location">
                    <Input
                      id="location"
                      required
                      autoComplete="street-address"
                      placeholder="Address or place"
                      value={location}
                      onChange={(event) => setLocation(event.target.value)}
                      className={fieldClass}
                    />
                  </Field>
                ) : (
                  <>
                    <fieldset>
                      <legend className="mb-2 text-sm font-medium">How should we meet?</legend>
                      <div className="grid gap-2">
                        <ModeOption
                          checked={mode === "meet"}
                          onChange={() => setMode("meet")}
                          title="Google Meet"
                          detail="A video link is added to the invite."
                        />
                        <ModeOption
                          checked={mode === "phone"}
                          onChange={() => setMode("phone")}
                          title="Phone call"
                          detail={`${ownerFirstName()} calls the number you enter.`}
                        />
                      </div>
                    </fieldset>
                    {mode === "phone" ? (
                      <Field label="Phone number" htmlFor="phone">
                        <Input id="phone" type="tel" required autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className={fieldClass} />
                      </Field>
                    ) : null}
                  </>
                )}
                <Field label="Anything we should know?" htmlFor="notes" optional>
                  <textarea
                    id="notes"
                    rows={3}
                    maxLength={2000}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Context, questions, or details to share in advance"
                    className="min-h-24 w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                </Field>
              </div>
              {formError ? <p className="mt-4 text-sm text-[#9b3b3b]">{formError}</p> : null}
              <Button type="submit" disabled={submitting} className="mt-6 h-11 w-full text-base">
                {submitting ? "Scheduling…" : rescheduleId ? "Update meeting" : "Schedule meeting"}
              </Button>
            </form>
          ) : (
            <div className={selectedDate ? "md:grid md:grid-cols-[minmax(0,1fr)_220px] md:gap-6" : ""}>
              <div>
                <h2 className="text-[22px] font-bold tracking-tight">Select a Date & Time</h2>
                <div className="mt-5 flex items-center justify-center gap-6">
                  <IconButton label="Previous month" onClick={() => setMonth((current) => shiftMonth(current, -1))}>
                    <ChevronLeft className="size-5" />
                  </IconButton>
                  <p className="min-w-40 text-center text-[16px] font-bold">{month ? monthTitle(month) : "…"}</p>
                  <IconButton label="Next month" onClick={() => setMonth((current) => shiftMonth(current, 1))}>
                    <ChevronRight className="size-5" />
                  </IconButton>
                </div>
                <div className="mt-4 grid grid-cols-7 text-center text-[13px] font-medium text-[#8aa0b5]">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                    <div key={day} className="py-2">{day}</div>
                  ))}
                </div>
                {error && !data ? (
                  <div className="py-10 text-center">
                    <p className="text-sm text-[#9b3b3b]">{error}</p>
                    <Button type="button" variant="outline" className="mt-4" onClick={() => setReload((current) => current + 1)}>
                      Try again
                    </Button>
                  </div>
                ) : loading && !data ? (
                  <div className="grid grid-cols-7" aria-busy="true" aria-label="Loading open times">
                    {Array.from({ length: 35 }).map((_, index) => (
                      <div key={`sk-${index}`} className="flex h-11 items-center justify-center">
                        <span
                          className="h-10 w-10 animate-pulse rounded-full bg-gradient-to-br from-[#e7e9ff] via-[#dbe4ff] to-[#c7d2fe]"
                          style={{ animationDelay: `${(index % 7) * 40}ms` }}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-7" role="grid" aria-label={month ? monthTitle(month) : "Calendar"}>
                    {cells.map((date, index) => {
                      if (!date) return <div key={`empty-${index}`} className="h-11" />;
                      const available = byDate.has(date);
                      const isSelected = date === selectedDate;
                      const isToday = date === today;
                      return (
                        <div key={date} className="flex h-11 items-center justify-center" role="gridcell">
                          <button
                            type="button"
                            disabled={!available}
                            aria-label={civilDateLabel(date)}
                            aria-pressed={isSelected}
                            onClick={() => {
                              setPickedDate(date);
                              setSelected(null);
                            }}
                            className={`relative flex h-10 w-10 items-center justify-center rounded-full text-[15px] transition ${
                              isSelected
                                ? "cursor-pointer bg-[#16324f] font-semibold text-white"
                                : available
                                  ? "cursor-pointer bg-[#e7f1fb] font-medium text-[#3d6d9a] hover:bg-[#d5e6f8]"
                                  : isToday
                                    ? "font-semibold text-[#0e1b2c]"
                                    : "cursor-default text-[#c5cad3]"
                            }`}
                          >
                            {Number(date.slice(-2))}
                            {isToday && !isSelected ? (
                              <span className="absolute bottom-1 h-1 w-1 rounded-full bg-[#16324f]" />
                            ) : null}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {!loading && !error && data && data.days.length === 0 ? (
                  <p className="mt-4 text-center text-sm text-[#6b7c90]">No openings this month. Try the next one.</p>
                ) : null}
                <div className="mt-8 flex items-center gap-2 text-[15px]">
                  <Globe className="size-4 text-[#3e5168]" aria-hidden />
                  <ListboxSelect
                    ariaLabel="Time zone"
                    value={timeZone}
                    onChange={setTimeZone}
                    options={zones.map((zone) => ({ value: zone, label: `${cityName(zone)} time` }))}
                  />
                  <span className="text-[#5d6e80]">
                    {clock ? `(${abbr && abbr !== cityName(timeZone) ? `${abbr} ` : ""}${clock})` : null}
                  </span>
                </div>
              </div>

              {selectedDate ? (
                <div
                  ref={timesRef}
                  key={selectedDate}
                  className="mt-6 scroll-mt-4 border-t border-[#e7e9ee] pt-4 animate-in fade-in slide-in-from-bottom-2 duration-200 md:mt-0 md:border-t-0 md:border-l md:pt-0 md:pl-4"
                >
                  <p className="mb-3 text-sm font-semibold">{civilDateLabel(selectedDate).replace(/, \d{4}$/, "")}</p>
                  <div className="flex max-h-[460px] flex-col gap-2 overflow-y-auto pr-1">
                    {slots.map((slot) => (
                      <button
                        key={slot.start}
                        type="button"
                        onClick={() => {
                          setSelected(slot);
                          setStep("form");
                          setFormError("");
                        }}
                        className="cursor-pointer rounded-md border border-[#d9dee8] px-3 py-3 text-[15px] font-semibold text-[#0e1b2c] hover:border-[#6f4cff] hover:text-[#5b3ee6]"
                      >
                        {slot.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function Field({
  label,
  htmlFor,
  optional,
  children,
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {optional ? <span className="font-normal text-[#7d92a8]">optional</span> : null}
      </Label>
      {children}
    </div>
  );
}

function ModeOption({
  checked,
  onChange,
  title,
  detail,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onChange}
      className={`flex w-full cursor-pointer gap-3 rounded-xl border px-3 py-3 text-left transition ${
        checked ? "border-[#6f4cff] bg-[#f7f5ff] shadow-sm" : "border-[#e6e8ee] hover:border-[#cfc6ff]"
      }`}
    >
      <span
        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${
          checked ? "border-[#6f4cff]" : "border-[#c5cdd8]"
        }`}
      >
        {checked ? <span className="size-2.5 rounded-full bg-[#6f4cff]" /> : null}
      </span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-[#6b7c90]">{detail}</span>
      </span>
    </button>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="cursor-pointer rounded-full p-2 text-[#0e1b2c] hover:bg-[#f3f5f8]">
      {children}
    </button>
  );
}

function formatRange(startIso: string, endIso: string, timeZone: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(start);
  const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone });
  const abbr =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(start)
      .find((part) => part.type === "timeZoneName")?.value ?? "";
  return { date, time: `${clock.format(start)} – ${clock.format(end)} ${abbr}`.trim() };
}
