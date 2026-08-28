# RVM Drop MCP

Control the whole sequencer from Claude Desktop / Cursor via MCP.

## Why this stays in sync

All tools live in [`catalog.ts`](./catalog.ts). Every `src/app/api/**/route.ts` must be listed in a tool’s `covers` array **or** in `ignoreRoutes`.

```bash
pnpm verify:mcp   # also runs inside pnpm verify
```

When you add an API route, add (or ignore) it in the catalog in the same PR — otherwise verify fails.

## Setup (Claude Desktop)

1. Install deps in this repo (`pnpm install`).
2. Copy [`claude_desktop_config.example.json`](./claude_desktop_config.example.json) into Claude’s MCP config and fix `cwd` + secrets.
3. Restart Claude.

Env:

| Var | Purpose |
|---|---|
| `RVM_DROP_BASE_URL` | App origin (prod or local) |
| `RVM_DROP_CRON_SECRET` | `sequencer_drain` |
| `RVM_DROP_WEBHOOK_SECRET` | `delivery_status` |
| `RVM_DROP_BEARER` | Optional global bearer |

## Tools

See `mcpTools` in `catalog.ts` — campaigns, leads, clients/keys, inbox, settings, lines, suppress, scrub, timezone, sequencer drain, delivery status, health.

## Run manually

```bash
RVM_DROP_BASE_URL=http://localhost:3000 pnpm mcp
```
