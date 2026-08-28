# RVM Drop

**Smartlead for ringless voicemail** — a sequencer that manages Twilio line pools, warmup/caps, campaigns, and burned-line detection.

> Twilio alone cannot deposit true ringless voicemail. RVM Drop owns the control plane; deposit defaults to **Slybroadcast** (`c_url` + `c_callerID` = your Twilio DID). Optional Drop Cowboy via `RVM_PROVIDER=dropcowboy`. See [`docs/RESEARCH.md`](./docs/RESEARCH.md).

Deploy target: **Railway** project `RVM Drop` (HTTPS + Postgres + 5‑minute sequencer cron).

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
- Pluggable delivery (`MOCK`, **Slybroadcast**, Drop Cowboy, VoiceDrop, Twilio AMD, …)
- **MCP server** for Claude — [`mcp/`](./mcp/) (catalog must cover every API route)

**Go live:** see [`docs/GO_LIVE.md`](./docs/GO_LIVE.md). **Claude MCP:** [`mcp/README.md`](./mcp/README.md).

## Quick start

```bash
pnpm install
cp .env.example .env
# fill: SLYBROADCAST_*, TWILIO_*, DNC_PROJECT_API_TOKEN, NEXT_PUBLIC_APP_URL
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
pnpm verify   # engines + MCP catalog coverage
pnpm mcp      # stdio MCP for Claude Desktop
pnpm build
```

## Sequencer path

```
CSV / API leads
  → DNC scrub + local send window
  → Twilio line pick (sticky / weighted)
  → Slybroadcast (audio URL + c_callerID = DID)
  → webhook → attempt ledger
  → inbound callback on Twilio DID → suppress + cancel queue
  → step N only after prior deliveryStatus delivered|sent
```

Also: `POST /api/scrub`, `GET /api/timezone?phone=`, MCP tools for all of the above.
## Architecture

```
POST /api/sequencer/tick
  → reconcile stale SENDING + campaign leases
  → claim due leads (attempt ledger + org/ramp caps)
  → global suppression + DNC scrub
  → recipient-local send window + send jitter
  → line picker (min gap + sticky + weighted)
  → Slybroadcast (hosted audio URL + c_callerID)
  → webhook → attempt ledger
```

Also: `POST /api/scrub`, `GET /api/timezone?phone=`, `pnpm mcp`

Hardening: **`docs/HARDENING.md`**. Go-live checklist: **`docs/LIVE.md`**. Research: **`docs/RESEARCH.md`**. MCP: **`mcp/README.md`**.

## Compliance

FCC 22-85: ringless voicemail to wireless phones is a TCPA “call.” Product default is **soft consent** (cold-call style) with **hard DNC + recipient-local send windows**. Operators are responsible for their own compliance posture.
