import type { Metadata } from "next";
import { shareMetadata, introShare } from "@/lib/share-meta";
import { Suspense } from "react";
import { Scheduler } from "@/components/scheduler";

export const metadata: Metadata = shareMetadata(introShare());

export default function IntroPage() {
  return (
    <Suspense fallback={<SchedulerFallback />}>
      <Scheduler slug="intro" />
    </Suspense>
  );
}

function SchedulerFallback() {
  return <div className="mx-auto mt-16 h-[640px] w-full max-w-[980px] rounded-xl border border-[#e4e7ee] bg-white" />;
}
