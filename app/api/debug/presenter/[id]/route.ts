import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  // /api/debug/presenter/<id>
  const parts = url.pathname.split("/").filter(Boolean);
  const id = parts[parts.length - 1] ?? null;

  return NextResponse.json({
    ok: true,
    pathname: url.pathname,
    id,
  });
}
