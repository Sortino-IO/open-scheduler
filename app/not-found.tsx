import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-20 text-center">
      <div>
        <h1 className="text-2xl font-bold">That page is not here</h1>
        <p className="mt-2 text-[#5d6e80]">The scheduling page is the place to book a time.</p>
        <Link href="/" className="mt-6 inline-block font-semibold text-[#3d6d9a]">
          Back to meetings
        </Link>
      </div>
    </main>
  );
}
