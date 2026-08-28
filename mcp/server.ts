#!/usr/bin/env node
/**
 * RVM Drop MCP server — stdio transport for Claude Desktop / Cursor.
 *
 * Env:
 *   RVM_DROP_BASE_URL   (required) e.g. https://rvm-drop-production.up.railway.app
 *   RVM_DROP_CRON_SECRET  for sequencer_drain
 *   RVM_DROP_WEBHOOK_SECRET  for delivery_status (RVM_STATUS_WEBHOOK_SECRET)
 *   RVM_DROP_BEARER     optional Authorization bearer for all calls
 *
 * Tools are defined in ./catalog.ts — keep that file in sync with API routes
 * (`pnpm verify:mcp`).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { mcpTools, type McpToolDef } from "./catalog";

function baseUrl(): string {
  const u = process.env.RVM_DROP_BASE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!u) {
    throw new Error("Set RVM_DROP_BASE_URL (or NEXT_PUBLIC_APP_URL)");
  }
  return u.replace(/\/$/, "");
}

function fillPath(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = args[key];
    if (v == null || v === "") throw new Error(`Missing path param: ${key}`);
    return encodeURIComponent(String(v));
  });
}

async function invokeTool(
  tool: McpToolDef,
  args: Record<string, unknown>,
): Promise<unknown> {
  const pathParams = new Set(tool.pathParams ?? []);
  const path = fillPath(tool.path, args);
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (!pathParams.has(k) && v !== undefined) rest[k] = v;
  }

  let url = `${baseUrl()}${path}`;
  const headers: Record<string, string> = {
    accept: "application/json",
  };
  const bearer = process.env.RVM_DROP_BEARER?.trim();
  if (bearer) headers.authorization = `Bearer ${bearer}`;

  if (tool.auth === "cron") {
    const secret = process.env.RVM_DROP_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim();
    if (!secret) throw new Error("Set RVM_DROP_CRON_SECRET for sequencer_drain");
    headers["x-cron-secret"] = secret;
    headers.authorization = `Bearer ${secret}`;
  }
  if (tool.auth === "webhook") {
    const secret =
      process.env.RVM_DROP_WEBHOOK_SECRET?.trim() ||
      process.env.RVM_STATUS_WEBHOOK_SECRET?.trim();
    if (!secret) throw new Error("Set RVM_DROP_WEBHOOK_SECRET for delivery_status");
    headers["x-webhook-secret"] = secret;
    headers.authorization = `Bearer ${secret}`;
  }

  const init: RequestInit = { method: tool.method, headers };

  if (tool.method === "GET" || tool.method === "DELETE") {
    if (Object.keys(rest).length && tool.method === "GET") {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(rest)) {
        if (v == null) continue;
        qs.set(k, typeof v === "string" ? v : JSON.stringify(v));
      }
      const q = qs.toString();
      if (q) url += `?${q}`;
    }
    if (tool.method === "DELETE" && tool.body) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(rest);
    }
  } else if (tool.body !== false) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(
      Object.keys(rest).length ? rest : tool.method === "POST" ? { drain: true } : {},
    );
  }

  const res = await fetch(url, init);
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      url,
      error: data,
    };
  }
  return data;
}

async function main() {
  const server = new Server(
    { name: "rvm-drop", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: mcpTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = mcpTools.find((t) => t.name === req.params.name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
        isError: true,
      };
    }
    try {
      const args = (req.params.arguments ?? {}) as Record<string, unknown>;
      const result = await invokeTool(tool, args);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: err instanceof Error ? err.message : String(err),
          },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
