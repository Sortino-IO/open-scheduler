import { NextResponse } from "next/server";

// Password login removed — admin is Google sign-in only.
export async function POST() {
  return NextResponse.json({ error: "Password login is disabled. Use Sign in with Google." }, { status: 410 });
}
