"use client";

import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || ("standalone" in navigator && Boolean((navigator as { standalone?: boolean }).standalone));
}

function isIos() {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Shown only on /admin. Adds this admin page to the home screen when the OS allows it. */
export function AdminInstall() {
  const [promptEvent, setPromptEvent] = useState<InstallPrompt | null>(null);
  const [ready, setReady] = useState(false);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), 0);
    function onPrompt(event: Event) {
      event.preventDefault();
      setPromptEvent(event as InstallPrompt);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("beforeinstallprompt", onPrompt);
    };
  }, []);

  if (!ready || isStandalone() || added) return null;
  const ios = isIos();

  async function install() {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    setPromptEvent(null);
    if (choice.outcome === "accepted") setAdded(true);
  }

  return (
    <section className="mb-5 rounded-[24px] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-[#312e81]/15 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#312e81] text-white">
          <Smartphone className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold tracking-tight text-[#1d1d1f]">Admin on your home screen</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-[#6e6e73]">
            A separate icon that opens admin directly. The public scheduling shortcut stays unchanged.
          </p>
          {promptEvent ? (
            <button
              type="button"
              onClick={install}
              className="mt-3 inline-flex h-11 w-full cursor-pointer items-center justify-center whitespace-nowrap rounded-full bg-[#312e81] px-4 text-[14px] font-semibold text-white"
            >
              Add admin to Home Screen
            </button>
          ) : ios ? (
            <ol className="mt-3 list-decimal space-y-1 pl-4 text-[13px] leading-relaxed text-[#3c3c43]">
              <li>Tap Share in Safari.</li>
              <li>Choose Add to Home Screen.</li>
            </ol>
          ) : (
            <p className="mt-3 text-[13px] leading-relaxed text-[#3c3c43]">
              Open the browser menu and choose Add to Home screen or Install app.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
