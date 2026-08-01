# Dropseq

**Smartlead for ringless voicemail** — a sequencer that manages Twilio line pools, warmup/caps, AI voice generation, campaigns, and burned-line detection.

> Twilio alone cannot deposit true ringless voicemail. Dropseq owns the control plane; deposit defaults to **Drop.co PAYG** (alts: Slybroadcast PAYG, LeadsRain). Voice = ElevenLabs highest quality, **generate once**. See [`docs/RESEARCH.md`](./docs/RESEARCH.md).

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
- Pluggable delivery providers (`MOCK`, **Drop.co**, Slybroadcast, VoiceDrop, Twilio AMD, …)

## Quick start

```bash
pnpm install
cp .env.example .env
# fill: DROP_CO_*, ELEVENLABS_*, DNC_PROJECT_API_TOKEN, NEXT_PUBLIC_APP_URL
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
pnpm verify   # warmup, timezone windows, DNC, sequencer tick
pnpm build
```

## Architecture

```
POST /api/sequencer/tick
  → DNC scrub (internal + The DNC Project)
  → recipient-local send window (phone NPA → IANA TZ)
  → line picker (cap + local presence + health)
  → ElevenLabs audio (generate once, cache by hash)
  → Drop.co VMDropPostRecords
```

Also: `POST /api/scrub`, `POST /api/voice/render`, `GET /api/timezone?phone=`

Full research: **`docs/RESEARCH.md`**.

## Compliance

FCC 22-85: ringless voicemail to wireless phones is a TCPA “call.” Default product posture is **consent required**. This repo is not a consent-evasion toolkit.
