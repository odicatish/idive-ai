import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();

  return NextResponse.json({
    user: data?.user ?? null,
    error: error?.message ?? null,
  });
}
