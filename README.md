# Dropseq

**Smartlead for ringless voicemail** — a sequencer that manages Twilio line pools, warmup/caps, AI voice generation, campaigns, and burned-line detection.

> Twilio alone cannot deposit true ringless voicemail. Dropseq owns the control plane; deposit defaults to **Drop.co PAYG** (alts: Slybroadcast PAYG, LeadsRain). Voice = ElevenLabs highest quality, **generate once**. See [`docs/RESEARCH.md`](./docs/RESEARCH.md).

## Why this exists

Tools like [Topa.io](https://topa.io) are excellent RVM channel bolt-ons (AI voices, Instantly/Smartlead webhooks, ~$0.025/drop). What’s missing is mailbox-grade infrastructure for **phone lines**:

- Per-line daily caps + automated warmup ramps  
- Pool rotation / local presence  
- Deliverability monitoring + quarantine when a DID is burned  
- Multi-step campaigns with consent / DNC / timezone gates  

## Stack

- Next.js App Router UI — Smartlead-style campaigns, CSV wizard, Master Inbox, per-client API keys
- File store (`.data/`) until Postgres is linked; Prisma schema includes Client / ApiKey / Inbox
- Pure TS engines: warmup, line picker, compliance, reputation, cost estimator, local send windows
- Pluggable delivery (`MOCK`, **Drop.co**, Slybroadcast, VoiceDrop, Twilio AMD, …)

**Go live:** see [`docs/GO_LIVE.md`](./docs/GO_LIVE.md) for keys, cron, Twilio webhooks, and first-100-drops path.

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

FCC 22-85: ringless voicemail to wireless phones is a TCPA “call.” Product default is **soft consent** (cold-call style) with **hard DNC + recipient-local send windows**. Operators are responsible for their own compliance posture.
