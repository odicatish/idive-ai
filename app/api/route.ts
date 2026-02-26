import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";  // ⭐⭐⭐ ASTA E FIXUL

export async function GET(request: Request) {
  return NextResponse.json({
    ok: true,
    message: "API root alive",
    time: Date.now(),
  });
}