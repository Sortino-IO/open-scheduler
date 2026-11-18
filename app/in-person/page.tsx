import type { Metadata } from "next";
import { shareMetadata, inPersonShare } from "@/lib/share-meta";
import { Suspense } from "react";
import { Scheduler } from "@/components/scheduler";

export const metadata: Metadata = shareMetadata(inPersonShare());

export default function InPersonPage() {
  return (
    <Suspense fallback={<SchedulerFallback />}>
      <Scheduler slug="inperson" />
    </Suspense>
  );
}

function SchedulerFallback() {
  return <div className="mx-auto mt-16 h-[640px] w-full max-w-[980px] rounded-xl border border-[#e4e7ee] bg-white" />;
}
