# What you need to make RVM Drop live

Short answer: **API keys + Railway (HTTPS + Postgres + cron)**. The Smartlead-style campaign/inbox/API-key UI is in the app; engines (DNC, local windows, Drop.co, ElevenLabs) are wired — they light up when the keys below are set.

**Railway project:** [RVM Drop](https://railway.com/project/83482725-c189-4aa8-8f6f-529e89a272f7)  
**Live URL:** https://rvm-drop-production.up.railway.app  

Infra items 2–4 (host, Postgres, cron) are live on Railway. You still paste vendor API keys (item 1) and auth (item 5).

## 1. Accounts & API keys (you provide)

| Service | Env var | Purpose | Without it |
|---|---|---|---|
| **Drop.co** | `DROP_CO_API_KEY`, `DROP_CO_CAMPAIGN_TOKEN` | PAYG RVM deposit (~$0.05/drop) | Falls back to mock delivery |
| **ElevenLabs** | `ELEVENLABS_API_KEY`, `ELEVENLABS_DEFAULT_VOICE_ID` | Voice (generate once, reuse URL) | Voice render API no-ops / fails |
| **The DNC Project** | `DNC_PROJECT_API_TOKEN` | Federal/state/litigator scrub | Dev uses mock scrub; prod should not ship without this |
| **Twilio** | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Buy/sync lines; inbound → Master Inbox | Demo line pool only |
| **Your direct line** | `CALL_FORWARD_TO_E164` (or UI under Go live) | Callbacks on campaign DIDs Dial this number | Voice says unavailable |
| **App URL** | `NEXT_PUBLIC_APP_URL` | Public URL so Drop.co can fetch audio | Local-only; deposits can't pull audio |

Optional later: Slybroadcast backup deposit, Hiya/Voice Integrity for spam labels, Clerk (or similar) for login.

Copy from `.env.example` → `.env` (or Vercel/Railway env UI).

## 2. Infrastructure checklist (Railway)

1. **Postgres** — Railway `Postgres` service; app gets `DATABASE_URL=${{Postgres.DATABASE_URL}}`. Schema pushed on deploy via `prisma db push`.
2. **Host** — Railway web service **RVM Drop** with public HTTPS domain. `NEXT_PUBLIC_APP_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}`. Campaign/inbox state persists on a volume at `/data` (`DATA_DIR=/data`) until the store is fully on Postgres.
3. **Cron** — Railway cron service every **5 minutes** (platform minimum) →  
   `POST /api/sequencer/tick` with header `x-cron-secret: $CRON_SECRET` and body `{"drain":true,"limit":50}`.
4. **Twilio webhooks + call forwarding** — set your direct line under **Go live** (or `CALL_FORWARD_TO_E164`). Point each DID's Voice URL / Messaging URL to:  
   `POST $NEXT_PUBLIC_APP_URL/api/webhooks/twilio/inbound`  
   Inbound voice → Master Inbox + `<Dial>` to your line (lead shown as caller ID when allowed).
5. **Auth** — still needed before real client data. Per-client API keys live under **Clients / API**.

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
| Call forwarding to direct line | Done (TwiML Dial) |
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
