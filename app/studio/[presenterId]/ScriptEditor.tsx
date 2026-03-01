"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type ScriptDTO = {
  id: string;
  presenterId: string; // may be missing/unstable after merges; DO NOT use for URLs
  content: string;
  language: string;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
};

type PresenterDTO = {
  id: string;
  name: string;
  context: Record<string, any>;
};

type SaveStatus =
  | "idle"
  | "saving"
  | "saved"
  | "conflict"
  | "transforming"
  | "error"
  | "offline";

type VersionRow = {
  id: string;
  script_id: string;
  version: number;
  source: string;
  meta: any;
  created_at: string;
  created_by: string;
  content?: string | null;
};

type ConfirmState =
  | null
  | {
      versionId: string;
      version: number;
    };

type VideoJobDTO = {
  id: string;
  status: string;
  progress: number;
  provider?: string | null;
  providerJobId?: string | null;
  videoUrl?: string | null;
  error?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

function useDebouncedCallback(fn: () => void, ms: number) {
  const t = useRef<number | null>(null);
  return () => {
    if (t.current) window.clearTimeout(t.current);
    t.current = window.setTimeout(() => fn(), ms);
  };
}

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function isTerminalJobStatus(s: string) {
  const v = String(s || "").toLowerCase();
  return v === "completed" || v === "failed";
}

export default function ScriptEditor({
  initialScript,
  initialPresenter,
}: {
  initialScript: ScriptDTO;
  initialPresenter: PresenterDTO;
}) {
  const [presenter, setPresenter] = useState<PresenterDTO>(initialPresenter);

  const [script, setScript] = useState<ScriptDTO>(initialScript);
  const [draft, setDraft] = useState(initialScript.content);

  const [status, setStatus] = useState<SaveStatus>("idle");

  const [conflict, setConflict] = useState<{
    serverContent: string;
    serverVersion: number;
  } | null>(null);

  const suppressNextAutosave = useRef(false);

  const dirty = useMemo(() => draft !== script.content, [draft, script.content]);

  // ✅ History drawer state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [restoreBusyId, setRestoreBusyId] = useState<string | null>(null);

  // ✅ History preview state
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const selected = useMemo(
    () => versions.find((v) => v.id === selectedVersionId) ?? null,
    [versions, selectedVersionId]
  );

  const [previewMode, setPreviewMode] = useState<"preview" | "diff">("preview");

  // ✅ preview load states
  const [previewText, setPreviewText] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string>("");

  const [confirm, setConfirm] = useState<ConfirmState>(null);

  // cache preview content by versionId
  const previewCache = useRef<Map<string, string>>(new Map());
  const previewAbortRef = useRef<AbortController | null>(null);

  // 🔒 IMPORTANT: use presenter.id for ALL API URLs (script.presenterId can become undefined)
  const presenterId = presenter?.id;

  // =========================
  // ✅ VIDEO POLLING (2s)
  // =========================
  const POLL_MS = 2000;
  const pollRef = useRef<number | null>(null);

  const stopVideoPolling = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startVideoPolling = () => {
    if (pollRef.current) return;
    // run once immediately
    void checkVideoStatus();
    pollRef.current = window.setInterval(() => {
      void checkVideoStatus();
    }, POLL_MS);
  };

  // ✅ Render job UI state
  const [rendering, setRendering] = useState(false);
  const [renderJob, setRenderJob] = useState<VideoJobDTO | null>(null);

  // ✅ helper: kick worker once (best-effort) so user sees progress immediately
  const kickWorkerOnce = async () => {
    try {
      // allow GET or POST (we made server accept both)
      await fetch(`/api/video-jobs/run-worker`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      }).catch(() => {});
    } catch {
      // ignore — cron will still process later
    }
  };

  const checkVideoStatus = async (): Promise<VideoJobDTO | null> => {
    if (!presenterId) return null;

    try {
      const res = await fetch(`/api/presenters/${presenterId}/video-status`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      if (res.status === 401) {
        stopVideoPolling();
        return null;
      }

      const payload = await safeJson(res);

      // if no job yet, stop polling quietly
      if (res.status === 404) {
        return null;
      }

      if (!res.ok) {
        return null;
      }

      const job: any = payload?.job ?? null;
      if (!job) return null;

      const normalized: VideoJobDTO = {
        id: String(job.id),
        status: String(job.status ?? "unknown"),
        progress: Number(job.progress ?? 0),
        provider: job.provider ?? null,
        providerJobId: job.providerJobId ?? job.provider_job_id ?? null,
        videoUrl: job.videoUrl ?? job.video_url ?? null,
        error: job.error ?? null,
        createdAt: job.createdAt ?? job.created_at ?? undefined,
        updatedAt: job.updatedAt ?? job.updated_at ?? undefined,
      };

      setRenderJob(normalized);

      // stop polling on terminal states
      if (isTerminalJobStatus(normalized.status)) {
        stopVideoPolling();
      }

      return normalized;
    } catch (e) {
      console.error("VIDEO_STATUS_THROW", e);
      return null;
    }
  };

  // cleanup polling on unmount
  useEffect(() => {
    return () => stopVideoPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // hydrate video banner on load, and start polling only if needed (based on returned status)
  useEffect(() => {
    if (!presenterId) return;

    void (async () => {
      const j = await checkVideoStatus();
      if (j && !isTerminalJobStatus(j.status)) startVideoPolling();
    })();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenterId]);

  const loadVersions = async () => {
    if (!presenterId) return;

    setVersionsLoading(true);
    try {
      const res = await fetch(`/api/presenters/${presenterId}/versions?limit=60`, {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      });

      if (!res.ok) {
        console.error("VERSIONS_LOAD_ERROR", await safeJson(res));
        return;
      }

      const data = await safeJson(res);
      const list = Array.isArray(data.versions) ? (data.versions as VersionRow[]) : [];

      setVersions(list);

      if (list.length > 0) {
        const stillExists = selectedVersionId ? list.some((v) => v.id === selectedVersionId) : false;
        if (!selectedVersionId || !stillExists) {
          setSelectedVersionId(list[0].id);
        }
      }
    } catch (e) {
      console.error("VERSIONS_LOAD_THROW", e);
    } finally {
      setVersionsLoading(false);
    }
  };

  const createSnapshot = async () => {
    if (status === "offline") return;
    if (!presenterId) return;

    try {
      const res = await fetch(`/api/presenters/${presenterId}/versions`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });

      if (!res.ok) {
        console.error("SNAPSHOT_ERROR", await safeJson(res));
        return;
      }

      await loadVersions();
    } catch (e) {
      console.error("SNAPSHOT_THROW", e);
    }
  };

  const restoreVersion = async (versionId: string) => {
    if (status === "offline") return;
    if (!presenterId) return;

    setRestoreBusyId(versionId);

    try {
      const res = await fetch(`/api/presenters/${presenterId}/versions/${versionId}/restore`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });

      if (!res.ok) {
        console.error("RESTORE_UI_ERROR", await safeJson(res));
        return;
      }

      const data = await safeJson(res);
      const restored = data?.script;

      if (restored?.content != null) {
        suppressNextAutosave.current = true;

        setConflict(null);
        setStatus("idle");

        setScript((prev) => ({
          ...prev,
          ...(restored ?? {}),
          id: restored.id ?? prev.id,
          presenterId: restored.presenterId ?? prev.presenterId ?? presenterId,
          language: restored.language ?? prev.language,
          content: restored.content ?? prev.content,
          version: restored.version ?? prev.version,
          updatedAt: restored.updatedAt ?? prev.updatedAt,
          updatedBy: restored.updatedBy ?? prev.updatedBy,
        }));

        setDraft(restored.content);
      }

      await loadVersions();
    } catch (e) {
      console.error("RESTORE_UI_THROW", e);
    } finally {
      setRestoreBusyId(null);
    }
  };

  // ✅ load versions when drawer opens
  useEffect(() => {
    if (!historyOpen) return;
    void loadVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyOpen, presenterId]);

  // ✅ ESC closes drawer (and confirm modal)
  useEffect(() => {
    if (!historyOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setConfirm(null);
        setHistoryOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [historyOpen]);

  // ✅ offline awareness
  useEffect(() => {
    const onOnline = () => setStatus((s) => (s === "offline" ? (dirty ? "idle" : "saved") : s));
    const onOffline = () => setStatus("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    if (!navigator.onLine) setStatus("offline");
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ local draft fallback (stable key)
  const lsKey = `idive:draft:${presenterId || "unknown"}`;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(lsKey);
      if (saved && saved !== script.content) {
        setDraft(saved);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lsKey]);

  useEffect(() => {
    try {
      localStorage.setItem(lsKey, draft);
    } catch {}
  }, [draft, lsKey]);

  const save = async (opts?: { force?: boolean }) => {
    if (status === "offline") return;
    if (!presenterId) return;
    if (!dirty && !opts?.force) return;

    setStatus("saving");
    setConflict(null);

    try {
      const res = await fetch(`/api/presenters/${presenterId}/script`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          content: draft,
          version: script.version,
          force: opts?.force === true,
        }),
      });

      if (res.status === 409) {
        const data = await safeJson(res);
        setStatus("conflict");
        setConflict({
          serverContent: data.serverContent ?? "",
          serverVersion: data.serverVersion ?? script.version,
        });
        return;
      }

      if (!res.ok) {
        console.error("SAVE_ERROR", await safeJson(res));
        setStatus("error");
        return;
      }

      const data = await safeJson(res);

      suppressNextAutosave.current = true;

      setScript((prev) => ({
        ...prev,
        ...(data.script ?? {}),
        presenterId: (data.script?.presenterId ?? prev.presenterId ?? presenterId) as any,
      }));

      setDraft(data.script?.content ?? draft);
      setStatus("saved");

      window.setTimeout(() => {
        setStatus((s) => (s === "saved" ? "idle" : s));
      }, 900);
    } catch (e) {
      console.error("SAVE_THROW", e);
      setStatus("error");
    }
  };

  const debouncedSave = useDebouncedCallback(() => {
    if (dirty) void save();
  }, 950);

  useEffect(() => {
    if (suppressNextAutosave.current) {
      suppressNextAutosave.current = false;
      return;
    }
    if (dirty && status !== "offline") debouncedSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isSave = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s";
      if (isSave) {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, draft, script.version, status, presenterId]);

  // ✅ context form state (right inspector)
  const [ctx, setCtx] = useState(() => ({
    location: presenter.context?.location ?? "",
    domain: presenter.context?.domain ?? "",
    audience: presenter.context?.audience ?? "",
    tone: presenter.context?.tone ?? "premium",
    visual: presenter.context?.visual ?? "apple-cinematic",
    notes: presenter.context?.notes ?? "",
  }));

  const ctxDirty = useMemo(() => {
    const prev = presenter.context ?? {};
    return (
      (prev.location ?? "") !== ctx.location ||
      (prev.domain ?? "") !== ctx.domain ||
      (prev.audience ?? "") !== ctx.audience ||
      (prev.tone ?? "premium") !== ctx.tone ||
      (prev.visual ?? "apple-cinematic") !== ctx.visual ||
      (prev.notes ?? "") !== ctx.notes
    );
  }, [ctx, presenter.context]);

  const saveContext = async () => {
    if (status === "offline") return;
    if (!presenterId) return;

    try {
      const res = await fetch(`/api/presenters/${presenterId}/context`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ context: ctx }),
      });

      const debug = await safeJson(res);

      if (!res.ok) {
        console.error("CONTEXT_SAVE_ERROR", debug);
        return;
      }

      setPresenter((p) => ({ ...p, context: debug.context ?? ctx }));
    } catch (e) {
      console.error("CONTEXT_SAVE_THROW", e);
    }
  };

  const debouncedSaveContext = useDebouncedCallback(() => {
    if (ctxDirty) void saveContext();
  }, 800);

  useEffect(() => {
    if (ctxDirty && status !== "offline") debouncedSaveContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  // ✅ Generate (AI) — updated to send language:"auto"
  const generateScript = async () => {
    if (status === "offline") return;
    if (!presenterId) return;

    setStatus("transforming");
    setConflict(null);

    try {
      const res = await fetch(`/api/presenters/${presenterId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          content: draft,
          context: ctx,
          language: "auto",
        }),
      });

      const payload = await safeJson(res);

      if (res.status === 422) {
        console.warn("GENERATE_WARN_422", payload);
        setStatus("idle");
        return;
      }

      if (!res.ok) {
        console.error("GENERATE_ERROR", payload);
        setStatus("error");
        return;
      }

      const next = payload?.script;
      if (!next || typeof next?.content !== "string") {
        console.error("GENERATE_BAD_PAYLOAD", payload);
        setStatus("error");
        return;
      }

      suppressNextAutosave.current = true;
      setConflict(null);
      setStatus("idle");

      setScript((prev) => ({
        ...prev,
        ...(next ?? {}),
        presenterId: next.presenterId ?? prev.presenterId ?? presenterId,
        content: next.content ?? prev.content,
        version: next.version ?? prev.version,
        language: next.language ?? prev.language,
        updatedAt: next.updatedAt ?? prev.updatedAt,
        updatedBy: next.updatedBy ?? prev.updatedBy,
      }));

      setDraft(next.content);

      if (historyOpen) void loadVersions();
    } catch (e) {
      console.error("GENERATE_THROW", e);
      setStatus("error");
    }
  };

  // ✅ Render Video (queue job + kick worker + start polling)
  const renderVideo = async () => {
    if (status === "offline") return;
    if (!presenterId) return;

    setRendering(true);

    try {
      const res = await fetch(`/api/presenters/${presenterId}/render`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
      });

      const payload = await safeJson(res);

      if (res.status === 422) {
        console.warn("RENDER_WARN_422", payload);
        alert("Script is too short for rendering a video. Add more text and try again.");
        return;
      }

      if (!res.ok) {
        console.error("RENDER_ERROR", payload);
        alert(payload?.error ?? "Render failed");
        return;
      }

      // Works for both {existing:true, job:{...}} and {existing:false, job:{...}}
      const j = payload?.job ?? null;
      if (j?.id) {
        setRenderJob({
          id: String(j.id),
          status: String(j.status ?? "queued"),
          progress: Number(j.progress ?? 0),
          createdAt: j.createdAt ?? j.created_at ?? undefined,
          updatedAt: j.updatedAt ?? j.updated_at ?? undefined,
          videoUrl: j.videoUrl ?? j.video_url ?? null,
          error: j.error ?? null,
        });
      } else {
        setRenderJob((prev) => prev ?? { id: "unknown", status: "queued", progress: 0 });
      }

      // ✅ kick worker once (best-effort) so user sees movement without waiting cron
      void kickWorkerOnce();

      // start polling immediately
      startVideoPolling();
    } catch (e) {
      console.error("RENDER_THROW", e);
      alert("Render failed (network error).");
    } finally {
      setRendering(false);
    }
  };

  // ✅ Fetch preview content for selected version
  useEffect(() => {
    if (!historyOpen) return;
    if (!selected) return;
    if (!presenterId) return;

    const versionId = selected.id;

    setPreviewError("");

    if (typeof selected.content === "string") {
      setPreviewText(selected.content);
      previewCache.current.set(versionId, selected.content);
      return;
    }

    const cached = previewCache.current.get(versionId);
    if (typeof cached === "string") {
      setPreviewText(cached);
      return;
    }

    previewAbortRef.current?.abort();
    const ac = new AbortController();
    previewAbortRef.current = ac;

    setPreviewLoading(true);
    setPreviewText("");

    (async () => {
      try {
        const url = `/api/presenters/${presenterId}/versions/${versionId}`;
        const res = await fetch(url, {
          method: "GET",
          credentials: "include",
          signal: ac.signal,
          cache: "no-store",
        });

        const payload = await safeJson(res);

        if (!res.ok) {
          const apiErr =
            typeof payload?.error === "string"
              ? payload.error
              : typeof payload?.message === "string"
              ? payload.message
              : payload?.text
              ? String(payload.text)
              : "unknown_error";

          setPreviewError(`GET ${url} → ${res.status} • ${apiErr}`);
          setPreviewText("");
          return;
        }

        const txt =
          typeof payload?.version?.content === "string"
            ? payload.version.content
            : typeof payload?.content === "string"
            ? payload.content
            : "";

        if (!txt) {
          setPreviewError("Preview unavailable (endpoint didn’t return content).");
          setPreviewText("");
          return;
        }

        previewCache.current.set(versionId, txt);
        setPreviewText(txt);
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setPreviewError(`Couldn’t load preview. ${String(e?.message ?? e)}`);
        setPreviewText("");
      } finally {
        setPreviewLoading(false);
      }
    })();

    return () => {
      ac.abort();
    };
  }, [historyOpen, selected, presenterId]);

  const statusLabel = (() => {
    if (status === "offline") return "Offline — changes kept locally";
    if (status === "saving") return "Saving…";
    if (status === "saved") return "Saved";
    if (status === "transforming") return "AI working…";
    if (status === "conflict") return "Conflict";
    if (status === "error") return "Error";
    return dirty ? "Unsaved changes" : "Up to date";
  })();

  const diffRows = useMemo(() => {
    const a = normalizeLines(draft);
    const b = normalizeLines(previewText);

    const max = Math.max(a.length, b.length);
    const rows: Array<{ i: number; left?: string; right?: string; changed: boolean }> = [];
    for (let i = 0; i < max; i++) {
      const left = a[i];
      const right = b[i];
      const changed = (left ?? "") !== (right ?? "");
      rows.push({ i, left, right, changed });
    }
    return rows;
  }, [draft, previewText]);

  return (
    <div className="min-h-screen">
      {/* Top bar */}
      <div className="sticky top-0 z-20 border-b border-white/10 bg-neutral-950/70 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-5 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-widest text-white/50">iDive Studio</div>
            <div className="truncate text-lg font-semibold">{presenter.name}</div>

            {renderJob && (
              <div className="mt-1 text-xs text-purple-300/80">
                Video job: <span className="text-purple-200">{renderJob.status}</span>{" "}
                <span className="text-white/30">•</span>{" "}
                <span className="text-purple-200">{renderJob.progress ?? 0}%</span>
                {renderJob.videoUrl ? (
                  <>
                    {" "}
                    <span className="text-white/30">•</span>{" "}
                    <a
                      className="text-purple-200 underline underline-offset-2 hover:opacity-90"
                      href={renderJob.videoUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open video
                    </a>
                  </>
                ) : null}
                {renderJob.error ? (
                  <>
                    {" "}
                    <span className="text-white/30">•</span>{" "}
                    <span className="text-rose-300">{renderJob.error}</span>
                  </>
                ) : null}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <StatusPill status={status} label={statusLabel} />

            <button
              onClick={() => setHistoryOpen(true)}
              className="rounded-full px-4 py-2 text-sm font-semibold transition border border-white/12 bg-white/5 hover:bg-white/10"
              type="button"
            >
              History
            </button>

            <button
              onClick={() => void generateScript()}
              disabled={status === "saving" || status === "transforming" || status === "offline"}
              className={cx(
                "rounded-full px-4 py-2 text-sm font-semibold transition",
                "border border-white/12 bg-white/8 hover:bg-white/12",
                (status === "saving" || status === "transforming" || status === "offline") &&
                  "opacity-50 cursor-not-allowed"
              )}
              type="button"
            >
              Generate Text
            </button>

            <button
              onClick={() => void renderVideo()}
              disabled={rendering || status === "transforming" || status === "offline"}
              className={cx(
                "rounded-full px-4 py-2 text-sm font-semibold transition",
                "border border-purple-400/25 bg-purple-500/20 hover:bg-purple-500/25 text-white",
                (rendering || status === "transforming" || status === "offline") &&
                  "opacity-50 cursor-not-allowed"
              )}
              type="button"
            >
              {rendering ? "Queueing…" : "Render Video"}
            </button>

            <button
              onClick={() => void save({ force: true })}
              disabled={status === "saving" || status === "transforming" || status === "offline"}
              className={cx(
                "rounded-full px-4 py-2 text-sm font-semibold transition",
                "border border-white/12 bg-white/8 hover:bg-white/12",
                (status === "saving" || status === "transforming" || status === "offline") &&
                  "opacity-50 cursor-not-allowed"
              )}
              type="button"
            >
              Save
            </button>
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="mx-auto max-w-6xl px-5 py-8 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        {/* Editor Card */}
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] shadow-[0_20px_80px_rgba(0,0,0,0.55)] overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <div className="text-sm text-white/70">
              Script • <span className="text-white/90">{script.language?.toUpperCase?.() ?? ""}</span>{" "}
              <span className="text-white/30">•</span>{" "}
              <span className="text-white/50">v{script.version}</span>
            </div>

            <div className="text-xs text-white/40">Tip: Cmd/Ctrl+S</div>
          </div>

          {status === "conflict" && conflict && (
            <div className="m-5 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4">
              <div className="text-sm font-semibold mb-1">Conflict detectat</div>
              <div className="text-sm text-white/70 mb-3">
                Alt tab/device a salvat o versiune mai nouă (server v{conflict.serverVersion}).
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="rounded-full px-4 py-2 text-sm font-semibold border border-white/12 bg-white/8 hover:bg-white/12 transition"
                  onClick={() => {
                    suppressNextAutosave.current = true;
                    setDraft(conflict.serverContent);
                    setScript((prev) => ({
                      ...prev,
                      content: conflict.serverContent,
                      version: conflict.serverVersion,
                    }));
                    setStatus("idle");
                    setConflict(null);
                  }}
                  type="button"
                >
                  Load server version
                </button>
                <button
                  className="rounded-full px-4 py-2 text-sm font-semibold border border-white/12 bg-white/8 hover:bg-white/12 transition"
                  onClick={() => void save({ force: true })}
                  type="button"
                >
                  Overwrite (force)
                </button>
              </div>
            </div>
          )}

          <div className="p-5">
            <textarea
              className={cx(
                "min-h-[520px] w-full rounded-2xl border border-white/10 bg-neutral-950/40",
                "p-5 outline-none resize-y leading-relaxed",
                "focus:border-white/20 focus:bg-neutral-950/55 transition"
              )}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write your script… (premium, natural, spoken)"
            />

            <div className="mt-3 flex items-center justify-between text-xs text-white/40">
              <span>Autosave: {dirty ? "pending" : "ok"}</span>
              <span>
                {script.updatedAt ? `Last update: ${new Date(script.updatedAt).toLocaleString()}` : ""}
              </span>
            </div>
          </div>
        </div>

        {/* Inspector */}
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] shadow-[0_20px_80px_rgba(0,0,0,0.55)] overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10">
            <div className="text-sm font-semibold">Scene / Context</div>
            <div className="text-xs text-white/50 mt-1">
              Set the location, domain, and tone. AI becomes more “director-like”.
            </div>
          </div>

          <div className="p-5 space-y-4">
            <Field
              label="Location"
              value={ctx.location}
              onChange={(v) => setCtx((p) => ({ ...p, location: v }))}
              placeholder='e.g. "modern studio", "corporate conference", "sunset rooftop"'
            />
            <Field
              label="Industry / Domain"
              value={ctx.domain}
              onChange={(v) => setCtx((p) => ({ ...p, domain: v }))}
              placeholder='e.g. "fintech", "real estate", "healthcare"'
            />
            <Field
              label="Audience"
              value={ctx.audience}
              onChange={(v) => setCtx((p) => ({ ...p, audience: v }))}
              placeholder='e.g. "CFOs", "SMB owners", "students"'
            />

            <div>
              <div className="text-xs uppercase tracking-widest text-white/50 mb-2">Tone</div>
              <div className="flex flex-wrap gap-2">
                {["premium", "friendly", "authoritative", "cinematic"].map((t) => (
                  <Chip key={t} active={ctx.tone === t} onClick={() => setCtx((p) => ({ ...p, tone: t }))} text={t} />
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs uppercase tracking-widest text-white/50 mb-2">Visual vibe</div>
              <div className="flex flex-wrap gap-2">
                {["apple-cinematic", "ultra-minimal", "dark-studio"].map((v) => (
                  <Chip key={v} active={ctx.visual === v} onClick={() => setCtx((p) => ({ ...p, visual: v }))} text={v} />
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs uppercase tracking-widest text-white/50 mb-2">Notes (optional)</div>
              <textarea
                className="w-full rounded-2xl border border-white/10 bg-neutral-950/40 p-4 outline-none min-h-[110px] focus:border-white/20 focus:bg-neutral-950/55 transition"
                value={ctx.notes}
                onChange={(e) => setCtx((p) => ({ ...p, notes: e.target.value }))}
                placeholder='e.g. "static shot, soft light, calm pace, clear CTA"'
              />
            </div>

            <div className="text-xs text-white/45">{ctxDirty ? "Saving context…" : "Context up to date"}</div>

            <div className="pt-2">
              <div className="rounded-2xl border border-white/10 bg-neutral-950/30 p-4">
                <div className="text-xs uppercase tracking-widest text-white/50 mb-2">AI highlight</div>
                <div className="text-sm text-white/75 leading-relaxed">
                  Use context as “set & direction”. When you regenerate, the prompt stays consistent and cinematic.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* History Drawer */}
      {historyOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setHistoryOpen(false)} />

          <div className="absolute right-0 top-0 h-full w-full lg:w-[920px] border-l border-white/10 bg-neutral-950/85 backdrop-blur-xl shadow-[0_30px_120px_rgba(0,0,0,0.7)]">
            <div className="p-5 border-b border-white/10 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold">Version History</div>
                <div className="text-xs text-white/50 mt-1">Click a version for preview. Restore requires confirmation.</div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => void createSnapshot()}
                  className="rounded-full px-4 py-2 text-sm font-semibold border border-white/12 bg-white/8 hover:bg-white/12 transition"
                  type="button"
                  disabled={status === "offline" || !presenterId}
                >
                  Create snapshot
                </button>

                <button
                  onClick={() => setHistoryOpen(false)}
                  className="rounded-full px-4 py-2 text-sm font-semibold border border-white/12 bg-white/5 hover:bg-white/10 transition"
                  type="button"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="h-[calc(100%-76px)] grid grid-cols-1 lg:grid-cols-[360px_1fr]">
              <div className="border-b lg:border-b-0 lg:border-r border-white/10 overflow-auto">
                <div className="p-4">
                  {versionsLoading ? (
                    <div className="text-sm text-white/60">Loading…</div>
                  ) : versions.length === 0 ? (
                    <div className="text-sm text-white/60">No versions yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {versions.map((v) => {
                        const active = v.id === selectedVersionId;
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => {
                              setSelectedVersionId(v.id);
                              setPreviewMode("preview");
                            }}
                            className={cx(
                              "w-full text-left rounded-2xl border p-4 transition",
                              active ? "border-white/20 bg-white/[0.07]" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.05]"
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-semibold">
                                  v{v.version} <span className="text-white/40 font-normal">• {v.source}</span>
                                </div>
                                <div className="text-xs text-white/50 mt-1">{new Date(v.created_at).toLocaleString()}</div>

                                {v?.meta?.reason && (
                                  <div className="text-xs text-white/45 mt-1">reason: {String(v.meta.reason)}</div>
                                )}

                                {String(v?.meta?.reason) === "restore" && v?.meta?.from_version && (
                                  <div className="text-xs text-white/45 mt-1">restored from v{String(v.meta.from_version)}</div>
                                )}
                              </div>

                              <div className="shrink-0">
                                <span
                                  className={cx(
                                    "inline-flex items-center rounded-full px-2 py-1 text-[11px] border",
                                    active ? "border-white/20 text-white/70" : "border-white/10 text-white/50"
                                  )}
                                >
                                  select
                                </span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="overflow-auto">
                <div className="p-5">
                  {!selected ? (
                    <div className="text-sm text-white/60">Select a version.</div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold">
                            Preview v{selected.version} <span className="text-white/40 font-normal">• {selected.source}</span>
                          </div>
                          <div className="text-xs text-white/50 mt-1">{new Date(selected.created_at).toLocaleString()}</div>
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="rounded-full border border-white/10 bg-white/5 p-1 flex items-center">
                            <button
                              type="button"
                              onClick={() => setPreviewMode("preview")}
                              className={cx(
                                "px-3 py-2 text-xs font-semibold rounded-full transition",
                                previewMode === "preview" ? "bg-white text-black" : "text-white/70 hover:bg-white/10"
                              )}
                            >
                              Preview
                            </button>
                            <button
                              type="button"
                              onClick={() => setPreviewMode("diff")}
                              className={cx(
                                "px-3 py-2 text-xs font-semibold rounded-full transition",
                                previewMode === "diff" ? "bg-white text-black" : "text-white/70 hover:bg-white/10"
                              )}
                            >
                              Diff
                            </button>
                          </div>

                          <button
                            type="button"
                            disabled={restoreBusyId === selected.id || status === "offline" || !presenterId}
                            onClick={() => setConfirm({ versionId: selected.id, version: selected.version })}
                            className={cx(
                              "rounded-full px-4 py-2 text-sm font-semibold transition border",
                              "border-white/12 bg-white/8 hover:bg-white/12",
                              (restoreBusyId === selected.id || status === "offline" || !presenterId) && "opacity-50 cursor-not-allowed"
                            )}
                          >
                            Restore
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 rounded-3xl border border-white/10 bg-white/[0.04] overflow-hidden">
                        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
                          <div className="text-xs uppercase tracking-widest text-white/50">
                            {previewMode === "preview" ? "Preview content" : "Diff vs current draft"}
                          </div>
                          <div className="text-xs text-white/40">
                            {previewMode === "diff"
                              ? "left = current • right = selected"
                              : previewLoading
                              ? "Loading…"
                              : previewText
                              ? `${Math.max(0, previewText.length)} chars`
                              : "—"}
                          </div>
                        </div>

                        <div className="p-5">
                          {previewMode === "preview" ? (
                            previewLoading ? (
                              <div className="text-sm text-white/60">Loading preview…</div>
                            ) : previewText ? (
                              <pre className="whitespace-pre-wrap text-sm leading-relaxed text-white/80">{previewText}</pre>
                            ) : (
                              <div className="text-sm text-white/60">
                                {previewError ? (
                                  <>
                                    Couldn’t load preview.
                                    <div className="mt-2 text-xs text-white/45 break-words">{previewError}</div>
                                  </>
                                ) : (
                                  "Preview unavailable (endpoint didn’t return content)."
                                )}
                              </div>
                            )
                          ) : (
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                              <div className="rounded-2xl border border-white/10 bg-neutral-950/40 p-4">
                                <div className="text-xs uppercase tracking-widest text-white/50 mb-2">Current draft</div>
                                <DiffBlock rows={diffRows} side="left" />
                              </div>
                              <div className="rounded-2xl border border-white/10 bg-neutral-950/40 p-4">
                                <div className="text-xs uppercase tracking-widest text-white/50 mb-2">Selected version</div>
                                <DiffBlock rows={diffRows} side="right" />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 text-xs text-white/45">
                        Tip: Restore creates a new version (safety net). Snapshot = manual checkpoint.
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {confirm && (
              <div className="fixed inset-0 z-[60]">
                <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={() => setConfirm(null)} />
                <div className="absolute left-1/2 top-1/2 w-[92%] max-w-md -translate-x-1/2 -translate-y-1/2">
                  <div className="rounded-3xl border border-white/10 bg-neutral-950/90 backdrop-blur-xl shadow-[0_30px_120px_rgba(0,0,0,0.7)] overflow-hidden">
                    <div className="p-5 border-b border-white/10">
                      <div className="text-sm font-semibold">Restore v{confirm.version}?</div>
                      <div className="text-xs text-white/50 mt-1">
                        The current script will be replaced, but a new version is created automatically.
                      </div>
                    </div>

                    <div className="p-5 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirm(null)}
                        className="rounded-full px-4 py-2 text-sm font-semibold border border-white/12 bg-white/5 hover:bg-white/10 transition"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={restoreBusyId === confirm.versionId || status === "offline" || !presenterId}
                        onClick={async () => {
                          const v = confirm;
                          setConfirm(null);
                          if (!v) return;
                          await restoreVersion(v.versionId);
                        }}
                        className={cx(
                          "rounded-full px-4 py-2 text-sm font-semibold border transition",
                          "border-white/12 bg-white text-black hover:opacity-90",
                          (restoreBusyId === confirm.versionId || status === "offline" || !presenterId) &&
                            "opacity-60 cursor-not-allowed"
                        )}
                      >
                        {restoreBusyId === confirm.versionId ? "Restoring…" : "Restore"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="h-10" />
    </div>
  );
}

function StatusPill({ status, label }: { status: SaveStatus; label: string }) {
  const dotClass =
    status === "saving" || status === "transforming" ? "animate-pulse" : status === "error" || status === "conflict" ? "" : "";

  const dotColor =
    status === "saving" || status === "transforming"
      ? "bg-white/80"
      : status === "saved"
      ? "bg-emerald-400"
      : status === "error"
      ? "bg-rose-400"
      : status === "conflict"
      ? "bg-amber-400"
      : status === "offline"
      ? "bg-sky-400"
      : "bg-white/40";

  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2">
      <span className={cx("h-2 w-2 rounded-full", dotColor, dotClass)} />
      <span className="text-xs text-white/70">{label}</span>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-white/50 mb-2">{label}</div>
      <input
        className="w-full rounded-2xl border border-white/10 bg-neutral-950/40 px-4 py-3 outline-none focus:border-white/20 focus:bg-neutral-950/55 transition"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function Chip({ text, active, onClick }: { text: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "rounded-full px-3 py-2 text-xs font-semibold transition border",
        active ? "bg-white text-black border-white" : "border-white/12 bg-white/5 text-white/70 hover:bg-white/10"
      )}
      type="button"
    >
      {text}
    </button>
  );
}

function DiffBlock({
  rows,
  side,
}: {
  rows: Array<{ i: number; left?: string; right?: string; changed: boolean }>;
  side: "left" | "right";
}) {
  return (
    <div className="text-xs font-mono leading-relaxed">
      {rows.map((r) => {
        const txt = side === "left" ? r.left : r.right;
        const show = txt ?? "";
        const changed = r.changed;
        return (
          <div key={r.i} className={cx("px-2 py-0.5 rounded-md", changed ? "bg-white/5" : "")}>
            <span className="text-white/30 select-none mr-2">{String(r.i + 1).padStart(3, " ")}</span>
            <span className={cx(changed ? "text-white/85" : "text-white/55")}>{show.length ? show : " "}</span>
          </div>
        );
      })}
    </div>
  );
}

function normalizeLines(t: string) {
  return (t ?? "").replace(/\r\n/g, "\n").split("\n");
}

async function safeJson(res: Response) {
  const contentType = res.headers.get("content-type") || "";
  const status = res.status;

  try {
    if (contentType.includes("application/json")) {
      const j = await res.json();
      return { ...j, _debug: { status, contentType } };
    }

    const text = await res.text().catch(() => "");
    return {
      _debug: { status, contentType },
      text: text.slice(0, 2000),
    };
  } catch {
    return { _debug: { status, contentType } };
  }
}