import { supabaseAdmin } from "@/lib/supabaseClient";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("presenters")
      .select("id, created_at, name, title, bio")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    return Response.json({ presenters: data || [] });
  } catch (e: any) {
    console.error("GET /api/presenters error:", e);
    return Response.json({ error: "Failed to load presenters" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Expect a presenter object with fields you already generate
    const presenter = body.presenter;

    if (!presenter?.name || !presenter?.title) {
      return Response.json({ error: "Missing presenter fields" }, { status: 400 });
    }

    const payload = {
  name: presenter.name,
  title: presenter.title,
  bio: presenter.bio ?? "",
  image_url: presenter.image_url ?? presenter.image ?? null,
  image_path: presenter.image_path ?? null,
};

    const { data, error } = await supabaseAdmin
      .from("presenters")
      .insert(payload)
      .select("id, created_at, name, title, bio")
      .single();

    if (error) throw error;

    return Response.json({ presenter: data });
  } catch (e: any) {
    console.error("POST /api/presenters error:", e);
    return Response.json({ error: "Failed to save presenter" }, { status: 500 });
  }
}
