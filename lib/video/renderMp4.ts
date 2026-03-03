// lib/video/renderMp4.ts
import { createClient } from "@supabase/supabase-js";

function requireEnv(name: string) {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getSupabaseAdmin() {
  const url =
    (process.env.SUPABASE_URL || "").trim() ||
    (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!url) throw new Error("Missing SUPABASE_URL");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Render MP4 external (FFmpeg worker)
// Required env in Vercel: VIDEO_RENDERER_URL + VIDEO_RENDERER_SECRET
export async function renderMp4ForJob(jobId: string): Promise<string | null> {
  const rendererUrl = requireEnv("VIDEO_RENDERER_URL"); // e.g. https://your-worker.up.railway.app
  const rendererSecret = requireEnv("VIDEO_RENDERER_SECRET");

  const supabase = getSupabaseAdmin();

  // 1) find voiceover asset
  const { data: voiceAsset, error } = await (supabase as any)
    .from("video_assets")
    .select("storage_bucket, storage_path")
    .eq("job_id", jobId)
    .eq("asset_type", "audio_voice")
    .eq("status", "completed")
    .maybeSingle();

  if (error || !voiceAsset) throw new Error("Voiceover asset not found.");

  // 2) signed URL for mp3 (1h)
  const { data: signed, error: sErr } = await supabase.storage
    .from(voiceAsset.storage_bucket)
    .createSignedUrl(voiceAsset.storage_path, 60 * 60);

  if (sErr) throw new Error(`Could not sign voiceover: ${sErr.message}`);
  if (!signed?.signedUrl) throw new Error("Could not create signed URL for voiceover.");

  // 3) call external renderer (it will upload mp4 to Supabase + insert video_assets)
  const r = await fetch(`${rendererUrl.replace(/\/$/, "")}/render-mp4`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${rendererSecret}`,
    },
    body: JSON.stringify({
      jobId,
      audioUrl: signed.signedUrl,
      // where to upload
      output: {
        bucket: "renders",
        path: `videos/${jobId}.mp4`,
      },
    }),
  });

  const txt = await r.text().catch(() => "");
  if (!r.ok) {
    throw new Error(`renderer_failed_${r.status}: ${txt || "no_body"}`);
  }

  let json: any = null;
  try {
    json = txt ? JSON.parse(txt) : null;
  } catch {
    json = null;
  }

  // optional: renderer can return mp4Url; if not, we sign ourselves
  const mp4UrlFromRenderer = json?.mp4Url && typeof json.mp4Url === "string" ? json.mp4Url : null;
  if (mp4UrlFromRenderer) return mp4UrlFromRenderer;

  // 4) if renderer didn't sign, create signed url (7 days)
  const storagePath = `videos/${jobId}.mp4`;
  const { data: finalSigned, error: signErr } = await supabase.storage
    .from("renders")
    .createSignedUrl(storagePath, 60 * 60 * 24 * 7);

  if (signErr) throw new Error(`mp4_signed_url_failed: ${signErr.message}`);
  return finalSigned?.signedUrl ?? null;
}