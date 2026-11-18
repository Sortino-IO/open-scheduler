import { jsonError } from "@/lib/http";
import { MEETINGS } from "@/lib/meetings";
import { readStore } from "@/lib/store";
import { resolveAccess } from "@/lib/unlocks";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const store = await readStore();
    const bookingId = url.searchParams.get("reschedule") ?? url.searchParams.get("booking");
    const bookingToken = url.searchParams.get("t");
    const booking =
      bookingId && bookingToken ? store.bookings.find((item) => item.id === bookingId) ?? null : null;

    const access = resolveAccess({
      admin: store.admin,
      unlocks: store.admin.unlocks,
      unlockToken: url.searchParams.get("k"),
      booking,
      bookingToken,
    });

    const meetings = [
      { slug: MEETINGS.intro.slug, name: MEETINGS.intro.name, path: MEETINGS.intro.path },
      { slug: MEETINGS["45"].slug, name: MEETINGS["45"].name, path: MEETINGS["45"].path },
    ];
    if (access.inPersonOpen) {
      meetings.push({
        slug: MEETINGS.inperson.slug,
        name: MEETINGS.inperson.name,
        path: MEETINGS.inperson.path,
      });
    }

    const withKey = (path: string) => {
      const k = url.searchParams.get("k");
      if (!k) return path;
      return `${path}${path.includes("?") ? "&" : "?"}k=${encodeURIComponent(k)}`;
    };

    return Response.json({
      meetings: meetings.map((m) => ({ ...m, path: withKey(m.path) })),
      inPersonOpen: access.inPersonOpen,
      usSlotsOpen: access.usSlotsOpen,
      personal: Boolean(access.unlock),
    });
  } catch (error) {
    return jsonError(error);
  }
}
