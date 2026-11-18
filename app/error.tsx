"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-20 text-center">
      <div>
        <h1 className="text-2xl font-bold">Something went wrong</h1>
        <p className="mt-2 text-[#5d6e80]">The page did not load. You can try it again.</p>
        <button type="button" onClick={reset} className="mt-6 font-semibold text-[#3d6d9a]">
          Try again
        </button>
      </div>
    </main>
  );
}
