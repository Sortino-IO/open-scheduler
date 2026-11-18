"use client";

import { useState } from "react";
import { DatePickerField, FancyCheck, SegmentedControl, TimePickerField } from "@/components/ui/pickers";
import {
  CLOSURE_MEETINGS,
  MAX_CLOSURE_RANGES,
  describeClosure,
  type ClosureMeeting,
  type ClosureRange,
  type RegularClosure,
} from "@/lib/closures";

export type ClosureFields = Omit<RegularClosure, "id">;

type Applies = "both" | ClosureMeeting;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function toMinutes(clock: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes <= 24 * 60 ? minutes : null;
}

type ClockRange = { start: string; end: string };

const FIRST_RANGE: ClockRange = { start: "11:00", end: "13:00" };

const BLANK = {
  weekdays: [] as number[],
  wholeDay: true,
  ranges: [FIRST_RANGE],
  applies: "both" as Applies,
  from: "",
  until: "",
};

/** A sensible next range: two hours starting where the last one ends, kept inside the day. */
function nextRange(last: ClockRange): ClockRange {
  const start = Math.min(toMinutes(last.end) ?? 13 * 60, 22 * 60);
  return { start: toClock(start), end: toClock(Math.min(start + 120, 24 * 60)) };
}

/** Form ranges as minutes, sorted, or a message for the first problem found. */
function rangesOf(clocks: ClockRange[]): ClosureRange[] | string {
  const ranges: ClosureRange[] = [];
  for (const clock of clocks) {
    const startMinute = toMinutes(clock.start);
    const endMinute = toMinutes(clock.end);
    if (startMinute == null || endMinute == null || endMinute <= startMinute) {
      return "Each time range needs a start before its end.";
    }
    ranges.push({ startMinute, endMinute });
  }
  ranges.sort((a, b) => a.startMinute - b.startMinute);
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i].startMinute < ranges[i - 1].endMinute) return "Time ranges in one rule can't overlap.";
  }
  return ranges;
}

/**
 * Admin screen for blanket weekly closures. Rules are listed in the order they were added; the form
 * below the list adds a rule, or edits one after "Edit". Saving is optimistic in the parent.
 */
export function ClosuresSection({
  closures,
  isPending,
  onAdd,
  onUpdate,
  onRemove,
  onInvalid,
}: {
  closures: RegularClosure[];
  isPending: (id: string) => boolean;
  onAdd: (fields: ClosureFields) => void;
  onUpdate: (id: string, fields: ClosureFields) => void;
  onRemove: (id: string) => void;
  onInvalid: (message: string) => void;
}) {
  const [form, setForm] = useState(BLANK);
  const [editing, setEditing] = useState<string | null>(null);

  function edit(closure: RegularClosure) {
    setEditing(closure.id);
    setForm({
      weekdays: closure.weekdays,
      wholeDay: closure.ranges.length === 0,
      ranges:
        closure.ranges.length === 0
          ? [FIRST_RANGE]
          : closure.ranges.map((range) => ({ start: toClock(range.startMinute), end: toClock(range.endMinute) })),
      applies: closure.meetings.length === CLOSURE_MEETINGS.length ? "both" : closure.meetings[0],
      from: closure.from ?? "",
      until: closure.until ?? "",
    });
  }

  function reset() {
    setEditing(null);
    setForm(BLANK);
  }

  function submit() {
    if (form.weekdays.length === 0) return onInvalid("Pick at least one weekday.");
    const ranges = form.wholeDay ? [] : rangesOf(form.ranges);
    if (typeof ranges === "string") return onInvalid(ranges);
    if (form.from && form.until && form.until < form.from) return onInvalid("The end date is before the start date.");
    const fields: ClosureFields = {
      weekdays: [...form.weekdays].sort((a, b) => a - b),
      ranges,
      meetings: form.applies === "both" ? [...CLOSURE_MEETINGS] : [form.applies],
      from: form.from || null,
      until: form.until || null,
    };
    if (editing) onUpdate(editing, fields);
    else onAdd(fields);
    reset();
  }

  return (
    <div className="space-y-5">
      {closures.length === 0 ? (
        <p className="text-[14px] text-[#86868b]">No regular closures yet. Add one below.</p>
      ) : (
        <ul className="space-y-2">
          {closures.map((closure) => {
            const pending = isPending(closure.id);
            return (
              <li
                key={closure.id}
                className={`flex animate-in items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-[14px] transition-opacity duration-200 fade-in ${
                  editing === closure.id ? "bg-[#ebe9ff] ring-1 ring-[#5856d6]/30" : "bg-[#f5f5f7]"
                } ${pending ? "opacity-60" : ""}`}
              >
                <span className="min-w-0">{describeClosure(closure)}</span>
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => edit(closure)}
                    className="h-11 rounded-full px-3.5 text-[14px] font-medium text-[#5856d6] transition-colors hover:bg-white disabled:cursor-wait"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (editing === closure.id) reset();
                      onRemove(closure.id);
                    }}
                    className="h-11 rounded-full px-3.5 text-[14px] font-medium text-[#b42318] transition-colors hover:bg-white disabled:cursor-wait"
                  >
                    Remove
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-3 border-t border-black/5 pt-5">
        <p className="text-[15px] font-semibold">{editing ? "Edit closure" : "Add a closure"}</p>
        <div role="group" aria-label="Weekdays" className="grid grid-cols-7 gap-[3px] sm:gap-1.5">
          {WEEKDAYS.map((label, day) => {
            const on = form.weekdays.includes(day);
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setForm((f) => ({ ...f, weekdays: on ? f.weekdays.filter((d) => d !== day) : [...f.weekdays, day] }))
                }
                className={`h-11 rounded-xl text-[13px] font-semibold transition-colors ${
                  on ? "bg-[#5856d6] text-white shadow-sm" : "bg-[#f5f4fa] text-[#1d1d1f] hover:bg-[#efeef8]"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <FancyCheck checked={form.wholeDay} onChange={(wholeDay) => setForm((f) => ({ ...f, wholeDay }))} label="Whole day" />
        {!form.wholeDay ? (
          <div className="space-y-2">
            {form.ranges.map((range, index) => {
              const setRange = (patch: Partial<ClockRange>) =>
                setForm((f) => ({ ...f, ranges: f.ranges.map((r, i) => (i === index ? { ...r, ...patch } : r)) }));
              return (
                <div key={index} className="flex animate-in items-center gap-2 duration-200 fade-in">
                  <div className="grid flex-1 grid-cols-2 gap-2">
                    <TimePickerField value={range.start} onChange={(start) => setRange({ start })} ariaLabel={`Closed from (range ${index + 1})`} />
                    <TimePickerField value={range.end} onChange={(end) => setRange({ end })} ariaLabel={`Closed until (range ${index + 1})`} />
                  </div>
                  {form.ranges.length > 1 ? (
                    <button
                      type="button"
                      aria-label={`Remove time range ${index + 1}`}
                      onClick={() => setForm((f) => ({ ...f, ranges: f.ranges.filter((_, i) => i !== index) }))}
                      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[20px] leading-none text-[#b42318] transition-colors hover:bg-[#fff2f2]"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              );
            })}
            {form.ranges.length < MAX_CLOSURE_RANGES ? (
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, ranges: [...f.ranges, nextRange(f.ranges[f.ranges.length - 1])] }))}
                className="inline-flex min-h-11 items-center text-[14px] font-medium text-[#5856d6]"
              >
                + Add another time range
              </button>
            ) : null}
          </div>
        ) : null}
        <div>
          <p className="mb-1.5 text-[13px] text-[#6e6e73]">Applies to</p>
          <SegmentedControl
            ariaLabel="Applies to"
            value={form.applies}
            onChange={(applies) => setForm((f) => ({ ...f, applies }))}
            options={[
              { value: "both", label: "Both" },
              { value: "intro", label: "Intro" },
              { value: "45", label: "45-minute" },
            ]}
          />
        </div>
        <details className="group text-[13px]" open={Boolean(form.from || form.until) || undefined}>
          <summary className="flex min-h-11 cursor-pointer items-center text-[14px] text-[#5856d6]">Only between certain dates (optional)</summary>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <DatePickerField value={form.from} onChange={(from) => setForm((f) => ({ ...f, from }))} label="Starts" placeholder="Now" />
            <DatePickerField value={form.until} onChange={(until) => setForm((f) => ({ ...f, until }))} label="Ends" min={form.from || undefined} />
          </div>
        </details>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={submit}
            className="h-12 flex-1 rounded-2xl bg-[#5856d6] px-4 text-[14px] font-semibold text-white shadow-sm shadow-[#5856d6]/25"
          >
            {editing ? "Save changes" : "Add closure"}
          </button>
          {editing ? (
            <button type="button" onClick={reset} className="h-12 rounded-2xl px-4 text-[14px] font-semibold text-[#1d1d1f] ring-1 ring-black/10">
              Cancel
            </button>
          ) : null}
        </div>
        <p className="text-[12px] text-[#86868b]">
          Israel time. Calendar events, buffers, holidays, and day blocks still apply. A day you switch on with “Open this day
          once” or “Open US evening slots on this day” overrides a closure for that window on that date. In-person meetings
          are not affected.
        </p>
      </div>
    </div>
  );
}
