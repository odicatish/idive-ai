import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type Params = { params: { id: string } };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { data, error } = await supabaseAdmin
      .from("presenters")
      .select("*")
      .eq("id", params.id)
      .single();

    if (error) throw error;

    return Response.json({ presenter: data });
  } catch (e: any) {
    console.error("GET /api/presenters/[id] error:", e);
    return Response.json({ error: "Failed to load presenter" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: Params) {
  try {
    const body = await req.json();

    // allow updating name/title/bio
    const patch: any = {};
    if (typeof body.name === "string") patch.name = body.name;
    if (typeof body.title === "string") patch.title = body.title;
    if (typeof body.bio === "string") patch.bio = body.bio;

    if (Object.keys(patch).length === 0) {
      return Response.json({ error: "No fields to update" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("presenters")
      .update(patch)
      .eq("id", params.id)
      .select("*")
      .single();

    if (error) throw error;

    return Response.json({ presenter: data });
  } catch (e: any) {
    console.error("PATCH /api/presenters/[id] error:", e);
    return Response.json({ error: "Failed to update presenter" }, { status: 500 });
  }
}
