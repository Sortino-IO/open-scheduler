import type { Metadata } from "next";
import { shareMetadata, fortyFiveShare } from "@/lib/share-meta";
import { Suspense } from "react";
import { Scheduler } from "@/components/scheduler";

export const metadata: Metadata = shareMetadata(fortyFiveShare());

export default function FortyFivePage() {
  return (
    <Suspense fallback={<div className="mx-auto mt-16 h-[640px] w-full max-w-[980px] rounded-xl border border-[#e4e7ee] bg-white" />}>
      <Scheduler slug="45" />
    </Suspense>
  );
}
