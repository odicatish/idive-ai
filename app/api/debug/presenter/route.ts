import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();

  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  return NextResponse.json({
    authedUser: auth?.user?.id ?? null,
    id,
  });
}
