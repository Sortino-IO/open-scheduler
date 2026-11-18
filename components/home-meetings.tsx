"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { ShareActions } from "@/components/share-actions";
import { MEETINGS } from "@/lib/meetings";
import { monthInZone, prefetchSlots, visitorTimeZone } from "@/lib/slots-client";

type Row = { slug: string; name: string; path: string };

const FALLBACK: Row[] = [
  { slug: MEETINGS.intro.slug, name: MEETINGS.intro.name, path: MEETINGS.intro.path },
  { slug: MEETINGS["45"].slug, name: MEETINGS["45"].name, path: MEETINGS["45"].path },
];

export function HomeMeetings() {
  const params = useSearchParams();
  const unlockKey = params.get("k") ?? "";
  const [meetings, setMeetings] = useState<Row[]>(FALLBACK);
  const [personal, setPersonal] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams();
    if (unlockKey) query.set("k", unlockKey);
    fetch(`/api/meetings${query.toString() ? `?${query}` : ""}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || cancelled) return;
        if (!Array.isArray(body.meetings)) return;
        setMeetings(body.meetings);
        setPersonal(Boolean(body.personal));
        // Load this month's times for every listed type now, so tapping one opens a ready calendar.
        const timeZone = visitorTimeZone();
        const month = monthInZone(timeZone);
        for (const meeting of body.meetings as Row[]) {
          prefetchSlots({ slug: meeting.slug, timeZone, month, unlockKey, rescheduleId: "", rescheduleToken: "" });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [unlockKey]);

  return (
    <div className="mt-10 w-full max-w-[460px] border-t border-[#e6e8ee] pt-2">
      {personal ? (
        <p className="mb-3 rounded-xl bg-[#ebe9ff] px-3 py-2 text-[13px] font-medium text-[#3d3bb8]">
          Personal options unlocked for you — including evenings and in-person if enabled.
        </p>
      ) : null}
      {meetings.map((meeting) => {
        const base = meeting.path.split("?")[0] || meeting.path;
        const href = unlockKey ? `${base}?k=${encodeURIComponent(unlockKey)}` : base;
        return (
          <div key={meeting.slug} className="border-b border-[#eef0f4] py-1 last:border-b-0">
            <Link
              href={href}
              className="group flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-2 py-3 transition hover:bg-[#f6f7fb]"
            >
              <span
                className={`h-3.5 w-3.5 shrink-0 rounded-full ${
                  meeting.slug === "inperson" ? "bg-[#ea580c]" : meeting.slug === "45" ? "bg-[#7c3aed]" : "bg-[#2563eb]"
                }`}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-[17px] font-semibold tracking-tight text-[#0e1b2c]">{meeting.name}</span>
              <ChevronRight className="size-5 shrink-0 text-[#0e1b2c]" aria-hidden />
            </Link>
            <div className="px-2 pb-3 pl-8">
              <ShareActions path={meeting.path} name={meeting.name} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
