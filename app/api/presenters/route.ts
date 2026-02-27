// app/api/presenters/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getSignedUrl(path: string) {
  return supabaseAdmin.storage.from("presenters").createSignedUrl(path, 60 * 60);
}

export async function GET() {
  try {
    const cookieStore = await cookies();

    // session-aware client (RLS) — ca să listăm DOAR presenterii userului
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

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // folosim clientul user-based ca să respecte RLS
    const { data, error } = await supabase
      .from("presenters")
      .select("id, created_at, name, title, bio, image_path, prompt, context")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    // best-effort: dacă există image_path, dăm și un signed URL "image"
    const presenters = await Promise.all(
      (data ?? []).map(async (p: any) => {
        if (!p?.image_path) return { ...p, image: null };

        const signed = await getSignedUrl(p.image_path);
        if (signed.error || !signed.data?.signedUrl) return { ...p, image: null };

        return { ...p, image: signed.data.signedUrl };
      })
    );

    return NextResponse.json({ presenters });
  } catch (e: any) {
    console.error("GET /api/presenters error:", e);
    return NextResponse.json({ error: "Failed to load presenters" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const cookieStore = await cookies();

    // session-aware client (RLS) — pentru user_id + ownership
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

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const userId = auth.user.id;

    const body = await req.json().catch(() => ({}));
    const presenter = body?.presenter ?? null;

    if (!presenter?.name || !presenter?.title) {
      return NextResponse.json({ error: "Missing presenter fields" }, { status: 400 });
    }

    // Source of truth pentru imagine: image_path
    const payload = {
      user_id: userId,
      name: String(presenter.name),
      title: String(presenter.title),
      bio: typeof presenter.bio === "string" ? presenter.bio : "",
      appearance: typeof presenter.appearance === "string" ? presenter.appearance : null,
      prompt: typeof presenter.prompt === "string" ? presenter.prompt : null,
      context:
        presenter.context && typeof presenter.context === "object" ? presenter.context : {},
      image_path: typeof presenter.image_path === "string" ? presenter.image_path : null,

      // legacy/compat: NU mai scriem image_url/image în DB implicit
      // (dacă vrei să le păstrezi, le setăm doar dacă vin explicit)
      image_url: typeof presenter.image_url === "string" ? presenter.image_url : null,
      image: typeof presenter.image === "string" ? presenter.image : null,
      script: typeof presenter.script === "string" ? presenter.script : null,
    };

    // insert via admin ca să nu depinzi de RLS (dar owner-ul e setat de noi)
    const { data, error } = await supabaseAdmin
      .from("presenters")
      .insert(payload)
      .select("id, created_at, name, title, bio, image_path, prompt, context")
      .single();

    if (error) throw error;

    // best-effort signed URL în response
    let image: string | null = null;
    if (data?.image_path) {
      const signed = await getSignedUrl(data.image_path);
      if (!signed.error && signed.data?.signedUrl) image = signed.data.signedUrl;
    }

    return NextResponse.json({ presenter: { ...data, image } });
  } catch (e: any) {
    console.error("POST /api/presenters error:", e);
    return NextResponse.json({ error: "Failed to save presenter" }, { status: 500 });
  }
}