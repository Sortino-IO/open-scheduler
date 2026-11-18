"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { monthMatrix, monthTitle } from "@/lib/month";
import { shiftMonth } from "@/lib/time";

const ACCENT = "#5856d6";

function useOutsideClose(open: boolean, onClose: () => void, refs: RefObject<HTMLElement | null>[]) {
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (refs.every((r) => r.current && !r.current.contains(t))) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, refs]);
}

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const apply = () => setMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return mobile;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  ariaLabel?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex h-[52px] w-full gap-1 rounded-2xl bg-[#efeef8] p-1"
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={`flex-1 cursor-pointer rounded-xl text-[14px] font-semibold transition ${
              active
                ? "bg-white text-[#5856d6] shadow-sm ring-1 ring-black/5"
                : "text-[#5c5c70] hover:text-[#1d1d1f]"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function FancyCheck({
  checked,
  onChange,
  label,
  detail,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  /** Optional second line, e.g. which account a calendar belongs to. */
  detail?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 py-2 text-left text-[14px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-[#ebe9ff] text-[#3d3bb8]" : "bg-[#f5f4fa] text-[#1d1d1f] hover:bg-[#efeef8]"
      }`}
    >
      <span
        className={`flex size-6 shrink-0 items-center justify-center rounded-[8px] transition ${
          checked ? "bg-[#5856d6] text-white" : "bg-white ring-1 ring-black/15"
        }`}
      >
        {checked ? <Check className="size-3.5 stroke-[3]" /> : null}
      </span>
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {label}
        {detail ? <span className="block text-[12px] font-normal text-[#6e6e73]">{detail}</span> : null}
      </span>
    </button>
  );
}

function formatPretty(iso: string) {
  if (!iso) return "";
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function DatePickerField({
  value,
  onChange,
  label,
  placeholder = "No end date",
  min,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
  min?: string;
}) {
  const [open, setOpen] = useState(false);
  const startView = () => (value || min || new Date().toISOString().slice(0, 10)).slice(0, 7);
  const [view, setView] = useState(startView);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const mobile = useIsMobile();
  const listId = useId();

  useOutsideClose(open && !mobile, () => setOpen(false), [btnRef, popRef]);

  const cells = useMemo(() => monthMatrix(view), [view]);

  function pick(date: string) {
    onChange(date);
    setOpen(false);
  }

  const calendar = (
    <div className="p-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setView((c) => shiftMonth(c, -1))}
          className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-black/[0.05]"
        >
          <ChevronLeft className="size-5" />
        </button>
        <p className="text-[16px] font-semibold">{monthTitle(view)}</p>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setView((c) => shiftMonth(c, 1))}
          className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full hover:bg-black/[0.05]"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-7 text-center text-[11px] font-semibold tracking-wide text-[#86868b] uppercase">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={`${d}-${i}`} className="py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((date, index) => {
          if (!date) return <div key={`e-${index}`} className="h-11" />;
          const disabled = Boolean(min && date < min);
          const selected = date === value;
          return (
            <button
              key={date}
              type="button"
              disabled={disabled}
              onClick={() => pick(date)}
              className={`mx-auto flex size-11 cursor-pointer items-center justify-center rounded-full text-[15px] transition disabled:cursor-default disabled:opacity-30 ${
                selected
                  ? "bg-[#5856d6] font-semibold text-white shadow-sm"
                  : "text-[#1d1d1f] hover:bg-[#ebe9ff]"
              }`}
            >
              {Number(date.slice(-2))}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => {
            onChange("");
            setOpen(false);
          }}
          className="h-11 flex-1 cursor-pointer rounded-xl bg-[#f5f4fa] text-[13px] font-semibold text-[#5c5c70]"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="h-11 flex-1 cursor-pointer rounded-xl bg-[#5856d6] text-[13px] font-semibold text-white"
        >
          Done
        </button>
      </div>
    </div>
  );

  return (
    <div className="relative">
      {label ? <p className="mb-1.5 text-[12px] font-medium text-[#6e6e73]">{label}</p> : null}
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          if (!open) setView(startView());
          setOpen(!open);
        }}
        className="flex h-12 w-full cursor-pointer items-center gap-3 rounded-2xl bg-[#f5f4fa] px-3.5 text-left transition hover:bg-[#efeef8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5856d6]/40"
      >
        <span className="flex size-9 items-center justify-center rounded-xl bg-white text-[#5856d6] shadow-sm ring-1 ring-black/5">
          <CalendarDays className="size-4" />
        </span>
        <span className={`flex-1 text-[15px] font-medium ${value ? "text-[#1d1d1f]" : "text-[#86868b]"}`}>
          {value ? formatPretty(value) : placeholder}
        </span>
        <ChevronDown className={`size-4 text-[#86868b] transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && !mobile ? (
        <div
          ref={popRef}
          id={listId}
          role="dialog"
          className="absolute z-50 mt-2 w-[min(100%,340px)] overflow-hidden rounded-[24px] bg-white shadow-[0_20px_60px_rgba(40,30,90,0.18)] ring-1 ring-black/8"
        >
          {calendar}
        </div>
      ) : null}

      {open && mobile ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <button type="button" aria-label="Close" className="absolute inset-0 cursor-pointer" onClick={() => setOpen(false)} />
          <div
            ref={popRef}
            id={listId}
            role="dialog"
            className="relative w-full max-w-md rounded-t-[28px] bg-white shadow-2xl sm:rounded-[28px]"
          >
            <div className="flex justify-center pt-3 sm:hidden">
              <span className="h-1.5 w-12 rounded-full bg-[#d2d2d7]" />
            </div>
            {calendar}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const TIMES = (() => {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += 15) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    out.push(`${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
  }
  return out;
})();

export function TimePickerField({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useOutsideClose(open, () => setOpen(false), [btnRef, popRef]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-time="${value}"]`) as HTMLElement | null;
    if (el) el.scrollIntoView({ block: "center" });
  }, [open, value]);

  const pretty = useMemo(() => {
    const [h, m] = value.split(":").map(Number);
    if (!Number.isFinite(h)) return value;
    const d = new Date();
    d.setHours(h, m || 0, 0, 0);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }, [value]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-12 w-full cursor-pointer items-center gap-1.5 rounded-2xl bg-[#f5f4fa] px-3 text-left transition hover:bg-[#efeef8] sm:gap-2"
      >
        {/* On narrow phones the clock icon gives its room to the time, so "11:00 AM" stays on one line. */}
        <Clock className="hidden size-4 shrink-0 text-[#5856d6] sm:block" />
        <span className="min-w-0 flex-1 text-[15px] font-semibold whitespace-nowrap tabular-nums text-[#1d1d1f]">{pretty}</span>
        <ChevronDown className={`size-4 shrink-0 text-[#86868b] transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div
          ref={popRef}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute z-50 mt-2 w-full overflow-hidden rounded-2xl bg-white shadow-[0_16px_40px_rgba(40,30,90,0.16)] ring-1 ring-black/8"
        >
          <div ref={listRef} className="max-h-56 overflow-y-auto p-1.5">
            {TIMES.map((t) => {
              const active = t === value;
              return (
                <button
                  key={t}
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-time={t}
                  onClick={() => {
                    onChange(t);
                    setOpen(false);
                  }}
                  className={`flex h-11 w-full cursor-pointer items-center justify-between rounded-xl px-3 text-[15px] font-medium tabular-nums ${
                    active ? "bg-[#ebe9ff] text-[#3d3bb8]" : "text-[#1d1d1f] hover:bg-[#f5f4fa]"
                  }`}
                >
                  {(() => {
                    const [h, m] = t.split(":").map(Number);
                    const d = new Date();
                    d.setHours(h, m, 0, 0);
                    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                  })()}
                  {active ? <Check className="size-4" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ListboxSelect({
  value,
  onChange,
  options,
  ariaLabel,
  renderValue,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  ariaLabel: string;
  renderValue?: (label: string) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value)?.label ?? value;

  useOutsideClose(open, () => setOpen(false), [btnRef, popRef]);

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-xl bg-transparent text-[15px] font-semibold text-[#0e1b2c] outline-none"
      >
        {renderValue ? renderValue(current) : <span className="truncate">{current}</span>}
        <ChevronDown className={`size-4 shrink-0 text-[#5d6e80] transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div
          ref={popRef}
          role="listbox"
          className="absolute z-50 mt-2 max-h-64 w-[min(280px,80vw)] overflow-y-auto rounded-2xl bg-white p-1.5 shadow-[0_16px_40px_rgba(14,27,44,0.18)] ring-1 ring-black/8"
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`flex h-11 w-full cursor-pointer items-center justify-between rounded-xl px-3 text-left text-[14px] font-medium ${
                  active ? "bg-[#f3eeff] text-[#5b3ee6]" : "text-[#0e1b2c] hover:bg-[#f5f6f8]"
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {active ? <Check className="size-4 shrink-0" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export { ACCENT };
