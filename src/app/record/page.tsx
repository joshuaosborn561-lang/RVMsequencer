"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";

/** Encode AudioBuffer → 16-bit mono WAV (Slybroadcast-friendly). */
function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = 1;
  const sampleRate = buffer.sampleRate;
  const samples = buffer.getChannelData(0);
  const dataLength = samples.length * 2;
  const header = 44;
  const array = new ArrayBuffer(header + dataLength);
  const view = new DataView(array);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([array], { type: "audio/wav" });
}

async function blobToWav(blob: Blob): Promise<Blob> {
  if (blob.type.includes("wav")) return blob;
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    return audioBufferToWav(buf);
  } finally {
    await ctx.close();
  }
}

async function blobToBase64(b: Blob): Promise<string> {
  const buf = await b.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function RecordInner() {
  const params = useSearchParams();
  const campaignId = params.get("campaignId") || "";
  const toPhone = params.get("to") || "";

  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [dropped, setDropped] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  const start = useCallback(async () => {
    setMessage(null);
    setDropped(false);
    setAudioUrl(null);
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null);
    setBlob(null);
    chunksRef.current = [];

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    mediaRef.current = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const b = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      setBlob(b);
      setBlobUrl(URL.createObjectURL(b));
    };
    recorder.start(250);
    setRecording(true);
    setSeconds(0);
    timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
  }, [blobUrl]);

  const stop = useCallback(() => {
    mediaRef.current?.stop();
    setRecording(false);
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  async function onFile(file: File) {
    setMessage(null);
    setDropped(false);
    setAudioUrl(null);
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlob(file);
    setBlobUrl(URL.createObjectURL(file));
    setSeconds(Math.max(5, Math.round(file.size / 16000)));
  }

  async function uploadAndAttach() {
    if (!blob) {
      setMessage("Record or upload something first.");
      return;
    }
    setBusy(true);
    setMessage("Converting to WAV + uploading…");
    try {
      const wav = await blobToWav(blob);
      if (wav.size < 1000) {
        setMessage("Audio too short. Record at least ~5 seconds.");
        return;
      }
      const base64 = await blobToBase64(wav);
      const up = await fetch("/api/audio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: toPhone ? `Test RVM → ${toPhone}` : "Test RVM",
          base64,
          contentType: "audio/wav",
        }),
      }).then((r) => r.json());

      if (!up.asset?.url) {
        setMessage(up.error || up.hint || "Upload failed");
        return;
      }
      setAudioUrl(up.asset.url);

      if (campaignId) {
        const patch = await fetch(`/api/campaigns/${campaignId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ audioUrl: up.asset.url }),
        }).then((r) => r.json());
        if (patch.error) {
          setMessage(`Saved audio, but campaign update failed: ${JSON.stringify(patch.error)}`);
          return;
        }
      }
      setMessage("Audio saved as WAV. Click Drop now to send via Slybroadcast.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function dropNow() {
    if (!campaignId) {
      setMessage("Missing campaignId.");
      return;
    }
    setBusy(true);
    setMessage("Launching + draining…");
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/send-now`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ audioUrl: audioUrl || undefined }),
      }).then(async (r) => ({ status: r.status, body: await r.json() }));
      if (res.status >= 400) {
        setMessage(`Failed: ${JSON.stringify(res.body)}`);
        return;
      }
      setDropped(true);
      setMessage(`Queued/sent. ${JSON.stringify(res.body.drain || res.body)}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Drop failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      title="Record RVM"
      subtitle={
        toPhone
          ? `Record the voicemail for ${toPhone} (5 seconds–3 minutes).`
          : "Record a short voicemail (5s–3 min)."
      }
    >
      <div className="mx-auto flex max-w-lg flex-col gap-6 py-4">
        <div className="rounded-xl border border-black/10 bg-white p-6 shadow-sm">
          <p className="font-mono text-sm text-black/60">
            {recording ? `Recording… ${seconds}s` : blob ? `Ready · ~${seconds}s` : "Mic idle"}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {!recording ? (
              <button
                type="button"
                onClick={() => void start()}
                className="rounded-lg bg-[#e11d48] px-4 py-2 text-sm font-medium text-white"
              >
                {blob ? "Re-record" : "Start recording"}
              </button>
            ) : (
              <button
                type="button"
                onClick={stop}
                className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white"
              >
                Stop
              </button>
            )}
            <label className="cursor-pointer rounded-lg border border-black/15 px-4 py-2 text-sm font-medium">
              Upload WAV/MP3
              <input
                type="file"
                accept="audio/wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/webm,.wav,.mp3,.m4a"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                }}
              />
            </label>
            {blob && !recording ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void uploadAndAttach()}
                className="rounded-lg bg-[#0f766e] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? "Working…" : "Save audio"}
              </button>
            ) : null}
            {audioUrl && campaignId ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void dropNow()}
                className="rounded-lg bg-[#1d4ed8] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? "Dropping…" : "Drop now"}
              </button>
            ) : null}
          </div>
          {blobUrl ? <audio className="mt-4 w-full" controls src={blobUrl} /> : null}
          {audioUrl ? (
            <p className="mt-3 break-all font-mono text-xs text-black/50">{audioUrl}</p>
          ) : null}
          {message ? <p className="mt-3 text-sm text-black/80">{message}</p> : null}
          {dropped && campaignId ? (
            <p className="mt-2 text-sm font-medium text-[#0f766e]">
              Test live —{" "}
              <a className="underline" href={`/campaigns/${campaignId}`}>
                view campaign
              </a>
            </p>
          ) : null}
        </div>
        <p className="text-sm text-black/50">
          From: +1 (817) 632-4821 → To: {toPhone || "lead on campaign"}. Allow mic access when
          prompted. Audio is converted to WAV for Slybroadcast.
        </p>
      </div>
    </AppShell>
  );
}

export default function RecordPage() {
  return (
    <Suspense
      fallback={
        <AppShell title="Record RVM" subtitle="Loading…">
          <p className="text-sm text-black/50">Loading recorder…</p>
        </AppShell>
      }
    >
      <RecordInner />
    </Suspense>
  );
}
