"use client";

import { useEffect, useRef, useState } from "react";
import {
  blobToTelephonyWav,
  RECORDER_MAX_BYTES,
  RECORDER_MAX_SEC,
  RECORDER_MIN_SEC,
} from "@/lib/audio/wav-encode";

type Props = {
  campaignId: string;
  token: string;
  campaignName: string;
  scriptDisplay: string;
  existingAudioUrl?: string | null;
};

export function CampaignRecorder(props: Props) {
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);

  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [takeUrl, setTakeUrl] = useState<string | null>(null);
  const [takeBlob, setTakeBlob] = useState<Blob | null>(null);
  const [takeDuration, setTakeDuration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; url: string } | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (takeUrl) URL.revokeObjectURL(takeUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup on unmount only
  }, []);

  function clearTake() {
    if (takeUrl) URL.revokeObjectURL(takeUrl);
    setTakeUrl(null);
    setTakeBlob(null);
    setTakeDuration(0);
    setSaved(null);
  }

  async function startRecording() {
    setError(null);
    setSaved(null);
    clearTake();
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      streamRef.current = stream;

      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : MediaRecorder.isTypeSupported("audio/mp4")
            ? "audio/mp4"
            : "";

      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      mediaRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const raw = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        void (async () => {
          try {
            const { wav, durationSeconds } = await blobToTelephonyWav(raw);
            if (durationSeconds < RECORDER_MIN_SEC) {
              setError(`Too short (${durationSeconds.toFixed(1)}s). Aim for ~22s.`);
              return;
            }
            if (durationSeconds > RECORDER_MAX_SEC) {
              setError(`Too long (${durationSeconds.toFixed(1)}s). Max ${RECORDER_MAX_SEC}s.`);
              return;
            }
            if (wav.size > RECORDER_MAX_BYTES) {
              setError("File too large (max 10 MB).");
              return;
            }
            setTakeBlob(wav);
            setTakeDuration(durationSeconds);
            setTakeUrl(URL.createObjectURL(wav));
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not encode WAV");
          }
        })();
      };

      recorder.start(250);
      setRecording(true);
      startedAtRef.current = performance.now();
      setElapsed(0);
      timerRef.current = window.setInterval(() => {
        setElapsed((performance.now() - startedAtRef.current) / 1000);
      }, 100);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Microphone permission denied. Allow mic access and try again.",
      );
    }
  }

  function stopRecording() {
    mediaRef.current?.stop();
    mediaRef.current = null;
    setRecording(false);
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function save() {
    if (!takeBlob) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("campaignId", props.campaignId);
      body.set("token", props.token);
      body.set("file", takeBlob, "recording.wav");

      const res = await fetch("/api/audio/record", {
        method: "POST",
        body,
      });
      const json = (await res.json()) as {
        id?: string;
        url?: string;
        error?: string;
        hint?: string;
        reason?: string;
      };
      if (!res.ok || !json.id || !json.url) {
        setError(
          json.hint ||
            json.error ||
            json.reason ||
            `Save failed (${res.status})`,
        );
        return;
      }
      setSaved({ id: json.id, url: json.url });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-5 py-6">
      <header>
        <p className="text-xs uppercase tracking-wider text-[var(--muted)]">
          RVM Drop · Record
        </p>
        <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl text-[var(--ink)]">
          {props.campaignName}
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Target length ~22 seconds. Speak clearly. You can re-record before
          saving.
        </p>
      </header>

      <section className="rounded-xl border border-[var(--line)] bg-white p-4">
        <h2 className="text-sm font-medium text-[var(--ink)]">Script</h2>
        <pre className="mt-2 whitespace-pre-wrap font-[family-name:var(--font-body)] text-sm leading-relaxed text-[var(--ink)]">
          {props.scriptDisplay || "(No script on step 1)"}
        </pre>
      </section>

      {props.existingAudioUrl && !saved ? (
        <section className="rounded-xl border border-[var(--line)] bg-white p-4">
          <h2 className="text-sm font-medium text-[var(--ink)]">
            Current audio
          </h2>
          <audio
            className="mt-3 w-full"
            controls
            src={props.existingAudioUrl}
            preload="metadata"
          />
          <p className="mt-2 break-all font-[family-name:var(--font-mono)] text-[11px] text-[var(--muted)]">
            {props.existingAudioUrl}
          </p>
        </section>
      ) : null}

      <section className="rounded-xl border border-[var(--line)] bg-white p-4">
        <p className="font-[family-name:var(--font-mono)] text-sm text-[var(--muted)]">
          {recording
            ? `Recording… ${elapsed.toFixed(1)}s`
            : takeBlob
              ? `Take ready · ${takeDuration.toFixed(1)}s`
              : "Mic idle"}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {!recording ? (
            <button
              type="button"
              className="sl-btn sl-btn-primary"
              onClick={() => void startRecording()}
            >
              {takeBlob ? "Re-record" : "Start"}
            </button>
          ) : (
            <button type="button" className="sl-btn" onClick={stopRecording}>
              Stop
            </button>
          )}
          {takeBlob && !recording ? (
            <button
              type="button"
              className="sl-btn sl-btn-primary"
              disabled={busy || !takeBlob}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          ) : null}
        </div>

        {takeUrl ? (
          <audio className="mt-4 w-full" controls src={takeUrl} />
        ) : null}

        {error ? (
          <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>
        ) : null}

        {saved ? (
          <div className="mt-4 rounded-lg bg-[var(--accent-soft)] p-3 text-sm text-[var(--ink)]">
            <p className="font-medium">Saved to campaign.</p>
            <p className="mt-1 font-[family-name:var(--font-mono)] text-xs">
              Asset id: {saved.id}
            </p>
            <p className="mt-1 break-all font-[family-name:var(--font-mono)] text-[11px] text-[var(--muted)]">
              {saved.url}
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
