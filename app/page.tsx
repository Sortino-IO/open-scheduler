import type { Metadata } from "next";
import { avatarPath, logoAlt, logoPath, ownerName } from "@/lib/brand";
import { shareMetadata, homeShare } from "@/lib/share-meta";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { HomeMeetings } from "@/components/home-meetings";

export const metadata: Metadata = shareMetadata(homeShare());

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center px-3 py-8 sm:px-6 sm:py-14">
      <section className="flex w-full max-w-[760px] flex-col items-center rounded-xl border border-[#e4e7ee] bg-white px-5 py-10 shadow-[0_10px_40px_rgba(15,23,42,0.04)] sm:min-h-[640px] sm:px-10 sm:py-14">
        {logoPath() ? (
          <Image src={logoPath()} alt={logoAlt()} width={153} height={57} className="mb-10 h-10 w-auto" />
        ) : null}
        <Image
          src={avatarPath()}
          alt={ownerName()}
          width={88}
          height={88}
          className="h-[88px] w-[88px] rounded-full object-cover"
        />
        <h1 className="mt-4 text-[18px] font-semibold text-[#4d6f90]">{ownerName()}</h1>
        <h2 className="mt-5 text-center text-[24px] font-bold tracking-tight text-[#0e1b2c]">Let’s talk 👋</h2>
        <p className="mt-2 max-w-[280px] text-center text-[15px] leading-relaxed text-[#7d92a8]">
          Pick a meeting type and grab a time that works for you.
        </p>
        <Suspense fallback={null}><HomeMeetings /></Suspense>
      </section>
      <Link href="/privacy" className="mt-5 text-[13px] text-[#7d92a8] hover:text-[#3d6d9a]">
        Privacy
      </Link>
    </main>
  );
}
