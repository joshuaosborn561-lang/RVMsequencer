import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { VoiceProviderClient, VoiceRenderInput, VoiceRenderResult } from "@/lib/providers/types";

const DEFAULT_MODEL = "eleven_multilingual_v2";
const DEFAULT_FORMAT = "mp3_44100_128";

/**
 * ElevenLabs TTS — highest quality default (Multilingual v2).
 * Generate once per script hash; reuse the same public URL for every drop.
 */
export function createElevenLabsClient(config: {
  apiKey?: string;
  modelId?: string;
  outputFormat?: string;
  /** Directory to persist audio for local/dev (served via /api/audio or public/) */
  storageDir?: string;
  publicBaseUrl?: string;
}): VoiceProviderClient {
  const storageDir = config.storageDir ?? path.join(process.cwd(), "public", "audio");
  const publicBaseUrl = config.publicBaseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "";

  return {
    id: "ELEVENLABS",
    async render(input: VoiceRenderInput): Promise<VoiceRenderResult> {
      if (!config.apiKey) {
        throw new Error("ELEVENLABS_API_KEY not set");
      }

      const modelId = config.modelId ?? DEFAULT_MODEL;
      const outputFormat = config.outputFormat ?? DEFAULT_FORMAT;
      const hash = createHash("sha256")
        .update(`${input.voiceExternalId}|${modelId}|${input.text}`)
        .digest("hex")
        .slice(0, 16);
      const filename = `${hash}.mp3`;
      const filePath = path.join(storageDir, filename);
      const audioUrl = `${publicBaseUrl.replace(/\/$/, "")}/audio/${filename}`;

      // Cache hit — do not regenerate
      try {
        const { access } = await import("node:fs/promises");
        await access(filePath);
        return {
          audioUrl,
          charCount: input.text.length,
          costEstimateUsd: 0,
        };
      } catch {
        // miss — generate
      }

      const url = new URL(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(input.voiceExternalId)}`,
      );
      url.searchParams.set("output_format", outputFormat);

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "xi-api-key": config.apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: input.text,
          model_id: modelId,
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`ElevenLabs TTS failed HTTP ${res.status}: ${detail.slice(0, 300)}`);
      }

      const buf = Buffer.from(await res.arrayBuffer());
      await mkdir(storageDir, { recursive: true });
      await writeFile(filePath, buf);

      // Multilingual ~$0.10 / 1k chars
      const costEstimateUsd = (input.text.length / 1000) * 0.1;

      return {
        audioUrl,
        charCount: input.text.length,
        costEstimateUsd,
      };
    },
  };
}
