"use client";

import { useState, type MouseEvent } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { canonicalPublicUrl, isShareCancellation, publicSharePayload } from "@/lib/public-share";

type Status = "idle" | "copied" | "shared" | "failed";

export function ShareActions({ path, name }: { path: string; name: string }) {
  const payload = publicSharePayload(name, path);
  const [status, setStatus] = useState<Status>("idle");
  const [fallbackUrl, setFallbackUrl] = useState("");

  function flash(next: Status) {
    setStatus(next);
    window.setTimeout(() => setStatus("idle"), 1800);
  }

  async function writeClipboard(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(payload.url);
      setFallbackUrl("");
      flash("copied");
      return true;
    } catch {
      setFallbackUrl(payload.url);
      flash("failed");
      return false;
    }
  }

  async function share(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof navigator.share === "function") {
      try {
        await navigator.share(payload);
        setFallbackUrl("");
        flash("shared");
        return;
      } catch (error) {
        if (isShareCancellation(error)) return;
      }
    }
    await writeClipboard();
  }

  async function copy(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    await writeClipboard();
  }

  const live = status === "copied" ? `Copied ${name} link` : status === "shared" ? `Shared ${name}` : status === "failed" ? "Copy the link below" : "";

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap gap-2" role="group" aria-label={`Share ${name}`}>
        <button
          type="button"
          onClick={share}
          className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-full bg-[#5856d6] px-3.5 text-[13px] font-semibold text-white shadow-sm shadow-[#5856d6]/20"
        >
          {status === "shared" ? <Check className="size-4" aria-hidden /> : <Share2 className="size-4" aria-hidden />}
          {status === "shared" ? "Shared" : "Share"}
        </button>
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-full bg-white px-3.5 text-[13px] font-semibold text-[#3d3bb8] ring-1 ring-[#5856d6]/30"
        >
          {status === "copied" ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {status === "copied" ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="sr-only" aria-live="polite">
        {live}
      </p>
      {fallbackUrl ? (
        <p className="mt-2 max-w-full truncate rounded-xl bg-[#f4f2ff] px-3 py-2 text-[12px] text-[#3d3bb8] select-all">
          {canonicalPublicUrl(path)}
        </p>
      ) : null}
    </div>
  );
}
