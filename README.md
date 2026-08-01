# Dropseq

**Smartlead for ringless voicemail** — a sequencer that manages Twilio line pools, warmup/caps, AI voice generation, campaigns, and burned-line detection.

> Twilio alone cannot deposit true ringless voicemail. Dropseq owns the control plane; an RVM provider (or Twilio AMD fallback) owns deposit. See [`docs/RESEARCH.md`](./docs/RESEARCH.md).

## Why this exists

Tools like [Topa.io](https://topa.io) are excellent RVM channel bolt-ons (AI voices, Instantly/Smartlead webhooks, ~$0.025/drop). What’s missing is mailbox-grade infrastructure for **phone lines**:

- Per-line daily caps + automated warmup ramps  
- Pool rotation / local presence  
- Deliverability monitoring + quarantine when a DID is burned  
- Multi-step campaigns with consent / DNC / timezone gates  

## Stack (scaffold)

- Next.js App Router UI (demo data for now)
- Prisma schema for workspaces, lines, campaigns, voices, attempts
- Pure TS engines: warmup, line picker, compliance, reputation, cost estimator
- Pluggable delivery providers (`MOCK`, VoiceDrop, Drop Cowboy, Slybroadcast, Twilio AMD)

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
pnpm verify   # runs core engine assertions (no DB required)
pnpm build
```

## Architecture

```
Campaign sequencer
  → compliance gates (consent / DNC / window)
  → line picker (cap + local presence + health)
  → voice render (Cartesia / ElevenLabs / upload)
  → delivery adapter (RVM provider or Twilio AMD)
  → webhooks → reputation / quarantine
```

Full research, cost models, warmup schedule, and open product decisions: **`docs/RESEARCH.md`**.

## Compliance

FCC 22-85: ringless voicemail to wireless phones is a TCPA “call.” Default product posture is **consent required**. This repo is not a consent-evasion toolkit.
