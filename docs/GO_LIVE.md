# What you need to make RVM Drop live

Short answer: **API keys + Railway (HTTPS + Postgres + cron)**. Default deposit is **Slybroadcast** (your Twilio DID as `c_callerID`).

**Railway project:** [RVM Drop](https://railway.com/project/83482725-c189-4aa8-8f6f-529e89a272f7)  
**Live URL:** https://rvm-drop-production.up.railway.app  

## 1. Accounts & API keys

| Service | Env var | Purpose | Without it |
|---|---|---|---|
| **Slybroadcast** | `SLYBROADCAST_UID`, `SLYBROADCAST_PASSWORD` | RVM deposit + explicit CID | Falls back to mock |
| **Hosted audio** | Campaign `audioUrl` | Public WAV/MP3 ≥5s | Launch blocked |
| **The DNC Project** | `DNC_PROJECT_API_TOKEN` | Scrub | Dev mock only |
| **Twilio** | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Lines + inbound callbacks | Demo pool only |
| **Forward** | `CALL_FORWARD_TO_E164` | Dial after inbound | Voice says unavailable |
| **App URL** | `NEXT_PUBLIC_APP_URL` | Webhooks | Local-only |

Optional: `RVM_PROVIDER=mock` for dry runs without Slybroadcast.  
MCP: see [`mcp/README.md`](../mcp/README.md).

## 2. Infra

Postgres, Redis, volume `/data`, cron → `POST /api/sequencer/tick` with `CRON_SECRET`.  
Twilio Voice/SMS → `/api/webhooks/twilio/inbound`.  
Slybroadcast `c_dispo_url` → `/api/webhooks/rvm-status?secret=…`.

## 3. First 100 drops

1. Paste Slybroadcast + Twilio + DNC keys.
2. Host audio URL; set on campaign Sequence tab.
3. Attach Twilio lines; set call-forward; launch.
4. Confirm cron drain; test callback → Inbox + suppress.

## 4. Claude MCP

```bash
pnpm mcp   # stdio server; configure Claude Desktop from mcp/claude_desktop_config.example.json
pnpm verify:mcp   # fails if a new API route isn't in mcp/catalog.ts
```
