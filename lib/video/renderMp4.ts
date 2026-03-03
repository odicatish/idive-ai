// lib/video/renderMp4.ts
import { bundle } from "@remotion/bundler";
import { getCompositions, renderMedia } from "@remotion/renderer";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import fs from "fs/promises";
import os from "os";

type SupabaseAdmin = ReturnType<typeof createClient>;

function requireEnv(name: string) {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getSupabaseAdmin(): SupabaseAdmin {
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

async function getVoiceoverSignedUrl(supabase: SupabaseAdmin, jobId: string) {
  const { data: voiceAsset, error } = await supabase
    .from("video_assets")
    .select("storage_bucket, storage_path")
    .eq("job_id", jobId)
    .eq("asset_type", "audio_voice")
    .eq("status", "completed")
    .maybeSingle();

  if (error || !voiceAsset) throw new Error("Voiceover asset not found.");

  const { data: signed, error: sErr } = await supabase.storage
    .from(voiceAsset.storage_bucket)
    .createSignedUrl(voiceAsset.storage_path, 60 * 60);

  if (sErr) throw new Error(`Could not sign voiceover: ${sErr.message}`);
  if (!signed?.signedUrl) throw new Error("Could not create signed URL for voiceover.");

  return signed.signedUrl;
}

export async function renderMp4ForJob(jobId: string): Promise<string | null> {
  // env guard (helps catch missing deps early)
  requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const supabase = getSupabaseAdmin();

  // 1) signed URL for mp3
  const audioUrl = await getVoiceoverSignedUrl(supabase, jobId);

  // 2) temp workdir
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "remotion-"));
  const entryPath = path.join(tmpDir, "index.tsx");

  // 3) write a minimal Remotion project on the fly (one composition)
  const entry = `
    import React from "react";
    import { Composition, AbsoluteFill, Audio } from "remotion";

    const Video: React.FC<{ audioUrl: string }> = ({ audioUrl }) => {
      return (
        <AbsoluteFill style={{ backgroundColor: "#111", justifyContent: "center", alignItems: "center" }}>
          <div style={{ color: "white", fontSize: 64, fontWeight: 800, textAlign: "center", padding: 60 }}>
            Your Product Video
          </div>
          <Audio src={audioUrl} />
        </AbsoluteFill>
      );
    };

    export const RemotionRoot: React.FC = () => {
      return (
        <>
          <Composition
            id="Ad"
            component={Video}
            width={1080}
            height={1080}
            fps={30}
            durationInFrames={900}
            defaultProps={{ audioUrl: "${audioUrl}" }}
          />
        </>
      );
    };
  `;
  await fs.writeFile(entryPath, entry, "utf8");

  // 4) bundle
  const serveUrl = await bundle({
    entryPoint: entryPath,
    webpackOverride: (config) => config,
  });

  // 5) get composition metadata
  const comps = await getCompositions(serveUrl, {
    inputProps: {},
  });

  const comp = comps.find((c) => c.id === "Ad");
  if (!comp) throw new Error('Remotion composition "Ad" not found.');

  // 6) render mp4
  const outputPath = path.join(tmpDir, `${jobId}.mp4`);
  await renderMedia({
    serveUrl,
    composition: comp,
    codec: "h264",
    outputLocation: outputPath,
    inputProps: {},
  });

  // 7) upload mp4 to renders bucket
  const fileBuffer = await fs.readFile(outputPath);
  const storagePath = `videos/${jobId}.mp4`;

  const { error: upErr } = await supabase.storage.from("renders").upload(storagePath, fileBuffer, {
    contentType: "video/mp4",
    upsert: true,
    cacheControl: "3600",
  });

  if (upErr) throw new Error(`mp4_upload_failed: ${upErr.message}`);

  // 8) signed URL for mp4 (7 days)
  const { data: finalSigned, error: signErr } = await supabase.storage
    .from("renders")
    .createSignedUrl(storagePath, 60 * 60 * 24 * 7);

  if (signErr) throw new Error(`mp4_signed_url_failed: ${signErr.message}`);

  const mp4Url = finalSigned?.signedUrl ?? null;

  // 9) insert asset row
  const { error: assetErr } = await supabase.from("video_assets").insert({
    job_id: jobId,
    asset_type: "video_mp4",
    provider: "remotion",
    status: "completed",
    storage_bucket: "renders",
    storage_path: storagePath,
    public_url: mp4Url,
    meta: { kind: "remotion_minimal_ad_v1" },
  });

  if (assetErr) throw new Error(`mp4_asset_insert_failed: ${assetErr.message}`);

  return mp4Url;
}