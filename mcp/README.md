# RVM Drop MCP (Claude)

## Claude Connectors (HTTPS — Railway)

Paste this URL into Claude → Settings → Connectors:

```
https://rvm-drop-production.up.railway.app/api/mcp
```

Optional auth: set Railway env `MCP_HTTP_TOKEN`, then in the connector send:

```
Authorization: Bearer <MCP_HTTP_TOKEN>
```

Transport: Streamable HTTP (stateless JSON). Tools match the app API 1:1 (campaigns, leads, sequences, enrollments, audio, analytics, inbox, Twilio numbers).

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
        "CRON_SECRET": "same-as-app"
      }
    }
  }
}
```

## Verify

```bash
pnpm verify:mcp
```
