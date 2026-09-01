/** Browser-side WAV: 16-bit PCM mono 8 kHz for Slybroadcast / telephony. */

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function encodeWavPcm16Mono(
  samples: Float32Array,
  sampleRate: number,
): Blob {
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const len = buffer.length;
  const out = new Float32Array(len);
  const channels = buffer.numberOfChannels;
  if (channels === 1) {
    out.set(buffer.getChannelData(0));
    return out;
  }
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) {
      out[i]! += data[i]! / channels;
    }
  }
  return out;
}

async function resampleMono(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Promise<Float32Array> {
  if (fromRate === toRate) return samples;
  const duration = samples.length / fromRate;
  const frames = Math.max(1, Math.ceil(duration * toRate));
  const offline = new OfflineAudioContext(1, frames, toRate);
  const buffer = offline.createBuffer(1, samples.length, fromRate);
  const channel = new Float32Array(samples.length);
  channel.set(samples);
  buffer.copyToChannel(channel, 0);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0).slice(0);
}

/**
 * Decode MediaRecorder blob → 8 kHz mono 16-bit WAV.
 */
export async function blobToTelephonyWav(blob: Blob): Promise<{
  wav: Blob;
  durationSeconds: number;
}> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const mono = mixToMono(decoded);
    const at8k = await resampleMono(mono, decoded.sampleRate, 8000);
    const wav = encodeWavPcm16Mono(at8k, 8000);
    const durationSeconds = at8k.length / 8000;
    return { wav, durationSeconds };
  } finally {
    await ctx.close();
  }
}

export const RECORDER_MIN_SEC = 3;
export const RECORDER_MAX_SEC = 60;
export const RECORDER_MAX_BYTES = 10 * 1024 * 1024;
