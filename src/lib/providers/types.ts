import { z } from "zod";

export const DeliveryResultSchema = z.object({
  ok: z.boolean(),
  providerMessageId: z.string().optional(),
  status: z.enum([
    "queued",
    "sent",
    "delivered",
    "failed",
    "human_answered",
    "rejected",
  ]),
  raw: z.unknown().optional(),
  errorCode: z.string().optional(),
  errorDetail: z.string().optional(),
  costEstimateUsd: z.number().optional(),
});

export type DeliveryResult = z.infer<typeof DeliveryResultSchema>;

export type SendRvmInput = {
  toE164: string;
  fromE164: string;
  /** Hosted audio URL (Slybroadcast c_url) */
  audioUrl?: string;
  foreignId: string;
  callbackUrl?: string;
  /** Contact postal code for TCPA window accuracy */
  postalCode?: string;
  /** Optional pre-rendered TTS body for providers that accept text + voice_id */
  ttsBody?: string;
  voiceExternalId?: string;
};

export type RvmDeliveryProvider = {
  id:
    | "VOICEDROP"
    | "DROP_CO"
    | "SLYBROADCAST"
    | "LEADSRAIN"
    | "TWILIO_AMD"
    | "MOCK";
  supportsTrueRingless: boolean;
  send(input: SendRvmInput): Promise<DeliveryResult>;
};

export type VoiceRenderInput = {
  text: string;
  voiceExternalId: string;
  /** Output format hint */
  format?: "mp3" | "wav";
};

export type VoiceRenderResult = {
  audioUrl: string;
  durationMs?: number;
  charCount: number;
  costEstimateUsd?: number;
};

export type VoiceProviderClient = {
  id: "CARTESIA" | "ELEVENLABS" | "UPLOAD" | "STOCK";
  render(input: VoiceRenderInput): Promise<VoiceRenderResult>;
  clone?(sampleUrl: string, name: string): Promise<{ voiceExternalId: string }>;
};
