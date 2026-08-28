# What you need to make RVM Drop live

Short answer: **API keys + Railway (HTTPS + Postgres + cron)**. Engines (DNC, local windows, Drop Cowboy) light up when the keys below are set.

**Railway project:** [RVM Drop](https://railway.com/project/83482725-c189-4aa8-8f6f-529e89a272f7)  
**Live URL:** https://rvm-drop-production.up.railway.app  

## 1. Accounts & API keys (you provide)

| Service | Env var | Purpose | Without it |
|---|---|---|---|
| **Drop Cowboy** | `DROPCOWBOY_TEAM_ID`, `DROPCOWBOY_SECRET`, `DROPCOWBOY_BRAND_ID` | RVM deposit via `/v1/rvm` | Falls back to mock delivery |
| **Recording** | `DROPCOWBOY_RECORDING_ID` or campaign field | Approved audio GUID | Launch blocked |
| **The DNC Project** | `DNC_PROJECT_API_TOKEN` | Federal/state/litigator scrub | Dev uses mock scrub; prod should not ship without this |
| **Twilio** | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Lines + inbound callbacks | Demo line pool only |
| **Your direct line** | `CALL_FORWARD_TO_E164` (or UI under Go live) | Dial target after inbound | Voice says unavailable |
| **App URL** | `NEXT_PUBLIC_APP_URL` | Webhooks + Drop Cowboy `callback_url` | Local-only |

Optional: `DROPCOWBOY_POOL_ID`, `DROPCOWBOY_BYOC_CALLER_ID=1` (BYOC only), HubSpot token, Slybroadcast backup.

## 2. Infrastructure checklist (Railway)

1. **Postgres** — `DATABASE_URL`; schema pushed on deploy via `prisma db push`.
2. **Host** — web service with HTTPS; `DATA_DIR=/data` volume for file store.
3. **Cron** — every **5 minutes** → `POST /api/sequencer/tick` with `CRON_SECRET`.
4. **Twilio webhooks** — Voice + Messaging → `POST $NEXT_PUBLIC_APP_URL/api/webhooks/twilio/inbound`
5. **Drop Cowboy webhook** — `callback_url` → `POST $NEXT_PUBLIC_APP_URL/api/webhooks/rvm-status?secret=$RVM_STATUS_WEBHOOK_SECRET`

## 3. Minimum path to first real 100 drops

1. Create Drop Cowboy + DNC Project (+ Twilio) accounts; paste keys into env.
2. Upload audio in Drop Cowboy → Recordings; approve; copy recording GUID onto the campaign.
3. Sync/buy Twilio numbers; point inbound webhooks; set call-forward.
4. **Campaigns → Create → Leads/CSV → Sequence (recording id) → Lines → Schedule → Launch**.
5. Enable sequencer cron; watch **Master Inbox** for callbacks (`stopOnCallback` cancels remaining drops).

## 4. Cost reality

- Drop Cowboy deposit is the bill (plan rate per successful drop).
- No in-app TTS — reuse one approved recording across the campaign.
- Twilio DIDs + warmup time are the other hard costs.
