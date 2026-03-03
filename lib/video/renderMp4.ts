// lib/video/renderMp4.ts
import { bundle } from "@remotion/bundler";
import { renderMedia } from "@remotion/renderer";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import fs from "fs/promises";
import os from "os";

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

export async function renderMp4ForJob(jobId: string) {
  const supabase = getSupabaseAdmin();

  const { data: voiceAsset, error } = await supabase
    .from("video_assets")
    .select("storage_bucket, storage_path")
    .eq("job_id", jobId)
    .eq("asset_type", "audio_voice")
    .eq("status", "completed")
    .maybeSingle();

  if (error || !voiceAsset) {
    throw new Error("Voiceover asset not found.");
  }

  const bucket = voiceAsset.storage_bucket;
  const pathInBucket = voiceAsset.storage_path;

  const { data: signed } = await supabase.storage
    .from(bucket)
    .createSignedUrl(pathInBucket, 60 * 60);

  if (!signed?.signedUrl) {
    throw new Error("Could not create signed URL for voiceover.");
  }

  const audioUrl = signed.signedUrl;

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "render-"));
  const outputPath = path.join(tmpDir, `${jobId}.mp4`);

  const entry = `
    import React from "react";
    import { AbsoluteFill, Audio } from "remotion";

    export const Video = () => {
      return (
        <AbsoluteFill style={{ backgroundColor: "#111", justifyContent: "center", alignItems: "center" }}>
          <div style={{
            color: "white",
            fontSize: 60,
            fontWeight: "bold",
            textAlign: "center",
            padding: 40
          }}>
            Your Product Video
          </div>
          <Audio src="${audioUrl}" />
        </AbsoluteFill>
      );
    };
  `;

  const entryPath = path.join(tmpDir, "index.tsx");
  await fs.writeFile(entryPath, entry);

  const bundleLocation = await bundle({
    entryPoint: entryPath,
    webpackOverride: (config) => config,
  });

  await renderMedia({
    composition: {
      id: "Video",
      width: 1080,
      height: 1080,
      fps: 30,
      durationInFrames: 900, // 30 sec default
    },
    serveUrl: bundleLocation,
    codec: "h264",
    outputLocation: outputPath,
  });

  const fileBuffer = await fs.readFile(outputPath);

  const videoPath = `videos/${jobId}.mp4`;

  await supabase.storage.from("renders").upload(videoPath, fileBuffer, {
    contentType: "video/mp4",
    upsert: true,
  });

  const { data: finalSigned } = await supabase.storage
    .from("renders")
    .createSignedUrl(videoPath, 60 * 60 * 24 * 7);

  await supabase.from("video_assets").insert({
    job_id: jobId,
    asset_type: "video_mp4",
    provider: "remotion",
    status: "completed",
    storage_bucket: "renders",
    storage_path: videoPath,
    public_url: finalSigned?.signedUrl ?? null,
    meta: {},
  });

  return finalSigned?.signedUrl ?? null;
}