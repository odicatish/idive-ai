// app/api/export/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPORT_BUCKET = "exports";

export async function POST(req: Request) {
  const cookieStore = await cookies();

  // session-aware supabase client (pt auth user)
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set() {},
        remove() {},
      },
    }
  );

  //////////////////////////////////////////////////
  // 1) AUTH
  //////////////////////////////////////////////////
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth?.user) {
    return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
  }
  const userId = auth.user.id;

  //////////////////////////////////////////////////
  // 2) PRO CHECK (subscriptions)
  //////////////////////////////////////////////////
  const { data: sub, error: subError } = await supabaseAdmin
    .from("subscriptions")
    .select("status")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subError) {
    return NextResponse.json({ error: subError.message }, { status: 500 });
  }

  const isPro = sub?.status === "active" || sub?.status === "trialing";
  if (!isPro) {
    return NextResponse.json({ error: "PRO_REQUIRED" }, { status: 403 });
  }

  //////////////////////////////////////////////////
  // 3) BODY
  //////////////////////////////////////////////////
  const body = await req.json().catch(() => null);
  if (!body?.presenter) {
    return NextResponse.json(
      { error: "Missing presenter data" },
      { status: 400 }
    );
  }

  const presenter = body.presenter as any;
  const presenterId = typeof presenter?.id === "string" ? presenter.id : null;
  const prompt = typeof body?.prompt === "string" ? body.prompt : null;

  //////////////////////////////////////////////////
  // 4) BUILD EXPORT PACKAGE (json)
  //////////////////////////////////////////////////
  const exportPackage = {
    exported_at: new Date().toISOString(),
    user_id: userId,
    presenter: {
      id: presenterId,
      name: presenter.name ?? null,
      title: presenter.title ?? null,
      bio: presenter.bio ?? null,
      script: presenter.script ?? null,
      appearance: presenter.appearance ?? null,
      image: presenter.image ?? null,
      image_path: presenter.image_path ?? null,
      prompt: presenter.prompt ?? prompt ?? null,
    },
  };

  //////////////////////////////////////////////////
  // 5) UPLOAD JSON TO STORAGE
  //////////////////////////////////////////////////
  const fileName = `idive-presenter-${Date.now()}.json`;
  const filePath = `${userId}/${presenterId ?? "no-presenter"}/${fileName}`;

  const bytes = Buffer.from(JSON.stringify(exportPackage, null, 2), "utf-8");

  const up = await supabaseAdmin.storage.from(EXPORT_BUCKET).upload(filePath, bytes, {
    contentType: "application/json",
    upsert: true,
  });

  if (up.error) {
    return NextResponse.json(
      { error: "Storage upload failed", details: up.error.message },
      { status: 500 }
    );
  }

  const signed = await supabaseAdmin.storage
    .from(EXPORT_BUCKET)
    .createSignedUrl(filePath, 60 * 60);

  if (signed.error || !signed.data?.signedUrl) {
    return NextResponse.json(
      { error: "Signed URL failed", details: signed.error?.message ?? "no url" },
      { status: 500 }
    );
  }

  const fileUrl = signed.data.signedUrl;

  //////////////////////////////////////////////////
  // 6) WRITE exports ROW (matches your schema)
  // presenter jsonb is NOT NULL => we must include it
  //////////////////////////////////////////////////
  const ins = await supabaseAdmin
    .from("exports")
    .insert({
      user_id: userId,
      presenter_id: presenterId,
      presenter: exportPackage.presenter, // ✅ required jsonb
      prompt,
      status: "completed",
      progress: 100,
      file_path: filePath,
      file_url: fileUrl,
    })
    .select("id, file_url, file_path, created_at, status, progress")
    .single();

  if (ins.error) {
    console.error("EXPORT DB INSERT FAILED:", ins.error);
    // nu blocăm export-ul dacă insert-ul în DB pică
  }

  return NextResponse.json({
    ok: true,
    export: ins.data ?? null,
    file_url: fileUrl,
    file_path: filePath,
  });
}
