# What you need to make Dropseq live

Short answer: **API keys + a public HTTPS host + Postgres + a one-minute cron**. The Smartlead-style campaign/inbox/API-key UI is in the app; engines (DNC, local windows, Drop.co, ElevenLabs) are wired — they light up when the keys below are set.

## 1. Accounts & API keys (you provide)

| Service | Env var | Purpose | Without it |
|---|---|---|---|
| **Drop.co** | `DROP_CO_API_KEY`, `DROP_CO_CAMPAIGN_TOKEN` | PAYG RVM deposit (~$0.05/drop) | Falls back to mock delivery |
| **ElevenLabs** | `ELEVENLABS_API_KEY`, `ELEVENLABS_DEFAULT_VOICE_ID` | Voice (generate once, reuse URL) | Voice render API no-ops / fails |
| **The DNC Project** | `DNC_PROJECT_API_TOKEN` | Federal/state/litigator scrub | Dev uses mock scrub; prod should not ship without this |
| **Twilio** | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Buy/sync lines; inbound → Master Inbox | Demo line pool only |
| **App URL** | `NEXT_PUBLIC_APP_URL` | Public URL so Drop.co can fetch audio | Local-only; deposits can't pull audio |

Optional later: Slybroadcast backup deposit, Hiya/Voice Integrity for spam labels, Clerk (or similar) for login.

Copy from `.env.example` → `.env` (or Vercel/Railway env UI).

## 2. Infrastructure checklist

1. **Postgres** — set `DATABASE_URL` (Neon / Supabase / Railway). Run `pnpm db:push`. Until then the app uses a local file store under `.data/` (fine for demos, not multi-instance prod).
2. **Host the Next app** — Vercel or Railway with a **public HTTPS URL**. Drop.co must reach `audioUrl` on that host.
3. **Worker / cron** — every minute while campaigns are ACTIVE, call:
   ```bash
   curl -X POST "$NEXT_PUBLIC_APP_URL/api/sequencer/tick" \
     -H "content-type: application/json" \
     -d '{"limit": 50}'
   ```
   (Vercel Cron, Railway cron, or any scheduler.)
4. **Twilio webhooks** — point each DID's Voice URL / Messaging URL to:
   `POST $NEXT_PUBLIC_APP_URL/api/webhooks/twilio/inbound`
   Those events land in **Master Inbox**.
5. **Auth** — lock the UI before real client data. Per-client API keys are already in `/clients` for programmatic access once you gate routes on key hash.

## 3. Smartlead-parity surface — status

| Feature | Status |
|---|---|
| Sidebar app shell (Campaigns, Inbox, Lines, Clients, …) | Done |
| Campaign list + create | Done |
| CSV import + column map → `{{variables}}` | Done |
| Sequence step (RVM script) | Done |
| Schedule (local TZ windows, days, daily new-lead cap) | Done (UI + engine) |
| Preview personalized script + in-window check | Done |
| Attach line / CID pool | Done |
| Launch / pause | Done |
| Per-client API keys | Done (file store; Prisma models ready) |
| Master Inbox (triage + Twilio ingest) | Done |
| Warmup / deliverability pages | Done (demo metrics until live webhooks) |
| Live Drop.co / ElevenLabs / DNC | Engines ready — need keys |
| Multi-tenant auth + Postgres persistence | Next after keys + host |
| Multi-step sequences + A/B | Not yet |
| Billing / client portals | Not yet |

## 4. Minimum path to first real 100 drops

1. Create Drop.co + ElevenLabs + DNC Project (+ Twilio) accounts; paste keys into env.
2. Deploy app; set `NEXT_PUBLIC_APP_URL` to the deploy URL.
3. Render voice once (`POST /api/voice/render`) → create Drop.co campaign with that audio URL → set `DROP_CO_CAMPAIGN_TOKEN`.
4. Sync/buy Twilio numbers; register FCR / Voice Integrity; start warmup caps on **Lines**.
5. In UI: **Campaigns → Create → Leads/CSV → Sequence → Lines → Schedule → Preview → Launch**.
6. Enable the sequencer cron; watch **Master Inbox** for callbacks.

## 5. Cost reality (your ~2k under $100 target)

- Drop.co PAYG ≈ **$0.05/drop** → ~$100 for 2k (deposit only).
- ElevenLabs: generate the campaign audio **once** (pennies), reuse the URL — do not TTS per lead.
- Twilio DIDs + warmup time are the other hard costs; buy only what you can warm.
