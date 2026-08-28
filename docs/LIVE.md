# What you need to make RVM Drop live

Production URL: `https://rvm-drop-production.up.railway.app`  
Project: Railway → **RVM Drop**

---

## 1. Infrastructure (Railway)

| Resource | Why | Status to check |
|---|---|---|
| **Web service** (`RVM Drop`) | App + webhooks | Deploy green, `/api/health` → `ok: true` |
| **Postgres** | `ScheduledSend` SKIP LOCKED claims + org counters | `DATABASE_URL` set; health → `postgres: "up"`, `claimPath: "SKIP_LOCKED"` |
| **Redis** (add if missing) | Shared rate limits + org daily counters across replicas | `REDIS_URL` set; health → `redis: "up"` |
| **Volume** on web (`DATA_DIR=/data`) | File-store UI data + queue mirror | Mounted at `/data` |
| **Cron** `sequencer-cron` | Every 5 min → `POST /api/sequencer/tick` with `CRON_SECRET` | Job succeeding |

Add Redis in Railway: **New → Database → Redis**, then variable reference `REDIS_URL` onto the web service.

---

## 2. Secrets / env vars (web service)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | From Postgres plugin |
| `REDIS_URL` | Strongly recommended | From Redis plugin |
| `DATA_DIR` | Yes | `/data` |
| `CRON_SECRET` | Yes | Same value cron sends as `x-cron-secret` |
| `NEXT_PUBLIC_APP_URL` | Yes | `https://rvm-drop-production.up.railway.app` |
| `RVM_PROVIDER` | Optional | `slybroadcast` (default) \| `dropcowboy` \| `mock` |
| `SLYBROADCAST_UID` | Yes (default provider) | Slybroadcast login email |
| `SLYBROADCAST_PASSWORD` | Yes | Slybroadcast password |
| `DROPCOWBOY_TEAM_ID` / `SECRET` / `BRAND_ID` | If `RVM_PROVIDER=dropcowboy` | Drop Cowboy API |
| `DNC_PROJECT_API_TOKEN` | Recommended | External DNC scrub |
| `TWILIO_ACCOUNT_SID` | Yes for inbound | Number inventory + webhooks |
| `TWILIO_AUTH_TOKEN` | Yes for inbound | Signature validation |
| `CALL_FORWARD_TO_E164` | Yes for callbacks | Your direct line |
| `RVM_STATUS_WEBHOOK_SECRET` | Yes for status reconcile | Bearer for `/api/webhooks/rvm-status` |
| `HUBSPOT_ACCESS_TOKEN` | Optional | Private app token; callbacks sync only for clients with HubSpot opt-in |

---

## 3. Twilio wiring (each campaign DID)

| Webhook | Method | URL |
|---|---|---|
| Voice | HTTP POST | `{APP}/api/webhooks/twilio/inbound` |
| Messaging (SMS STOP) | HTTP POST | same inbound URL |
| Status callback (optional AMD) | HTTP POST | `{APP}/api/webhooks/twilio/status` |

---

## 4. Provider status → ledger

Point Slybroadcast `c_dispo_url` (or Drop Cowboy `callback_url`) at:

`POST {APP}/api/webhooks/rvm-status?secret=$RVM_STATUS_WEBHOOK_SECRET`

Normalized body example:

```json
{
  "provider": "SLYBROADCAST",
  "providerMessageId": "<session_id>",
  "foreignId": "<campaignId>_<leadId>_step1",
  "status": "delivered"
}
```

Statuses: `queued` | `sent` | `delivered` | `failed` | `rejected` | `human_answered`

---

## 5. First live campaign checklist

1. `/api/health` shows `postgres: up` (and ideally `redis: up`)
2. Clients → create API key (copy once)
3. Go live → set forward-to number
4. Campaign wizard: CSV → multi-step sequence → lines → schedule → launch  
   Launch **eager-schedules** all steps into the send queue
5. Confirm cron tick returns `mode: "drain"` with claims/sends
6. Place a test callback to a DID → Inbox + forward
7. Text STOP → global suppression + queue cancel

---

## 6. What “done” looks like

- Multi-replica safe: claims use **Postgres `FOR UPDATE SKIP LOCKED`**
- No double-drop on the same `campaign_lead_step` idempotency key
- Line pool exhaustion **rebalances** `runAt` forward
- Step 2+ fires after `delayDays` **and** prior touch `deliveryStatus` is `delivered`/`sent` (webhook); sticky DID
- Failed / rejected / human_answered prior touches **cancel** later steps
- Org daily hard cap shared via **Redis** (Postgres/file fallback)
- Provider webhooks update delivery status on the attempt ledger
