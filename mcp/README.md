# RVM Drop MCP (Claude)

## Claude Connectors (HTTPS — Railway)

Paste this URL into Claude → Settings → Connectors:

```
https://rvm-drop-production.up.railway.app/api/mcp
```

Then add the guided skill from [`CLAUDE_SKILL.md`](./CLAUDE_SKILL.md) as a Claude Project instruction / custom skill so Claude walks you through leads → audio → DIDs → daily caps → launch and saves preferences.

Optional auth: set Railway env `MCP_HTTP_TOKEN`, then in the connector send:

```
Authorization: Bearer <MCP_HTTP_TOKEN>
```

Transport: Streamable HTTP (stateless JSON).

### Tools for the full chat flow
- Campaigns / leads / launch: `campaigns_*`, `leads_*`
- Audio library: `audio_list`, `audio_upload`
- Twilio DIDs + per-line daily caps: `lines_list`, `lines_ensure`, `lines_update`
- Workspace caps / forward: `settings_*`
- Saved skill defaults: `preferences_get`, `preferences_update`
- Start sending now: `sequencer_drain` (after `status=ACTIVE`)

## Local stdio (Claude Desktop / Cursor)

```bash
pnpm mcp
```

```json
{
  "mcpServers": {
    "rvm-drop": {
      "command": "pnpm",
      "args": ["--dir", "/absolute/path/to/RVMsequencer", "mcp"],
      "env": {
        "DATABASE_URL": "postgresql://...",
        "CRON_SECRET": "same-as-app",
        "RVM_DROP_BASE_URL": "https://rvm-drop-production.up.railway.app"
      }
    }
  }
}
```

## Verify

```bash
pnpm verify:mcp
```
