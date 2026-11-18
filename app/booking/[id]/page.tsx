import type { Metadata } from "next";
import { Suspense } from "react";
import { BookingView } from "@/components/booking-view";

export const metadata: Metadata = {
  title: "Booking",
  robots: { index: false, follow: false },
};

export default function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="mx-auto mt-16 h-80 w-full max-w-[640px] rounded-xl bg-white" />}>
      <BookingGate params={params} />
    </Suspense>
  );
}

async function BookingGate({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BookingView id={id} intent="view" />;
}
