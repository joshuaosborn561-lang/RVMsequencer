import { mcpTools, type McpToolDef } from "@/mcp/catalog";

function appBaseUrl(): string {
  const u =
    process.env.RVM_DROP_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : "") ||
    "http://127.0.0.1:3000";
  return u.replace(/\/$/, "");
}

function fillPath(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = args[key];
    if (v == null || v === "") throw new Error(`Missing path param: ${key}`);
    return encodeURIComponent(String(v));
  });
}

export async function invokeMcpTool(
  tool: McpToolDef,
  args: Record<string, unknown>,
): Promise<unknown> {
  const pathParams = new Set(tool.pathParams ?? []);
  const path = fillPath(tool.path, args);
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (!pathParams.has(k) && v !== undefined) rest[k] = v;
  }

  let url = `${appBaseUrl()}${path}`;
  const headers: Record<string, string> = { accept: "application/json" };
  const bearer = process.env.RVM_DROP_BEARER?.trim();
  if (bearer) headers.authorization = `Bearer ${bearer}`;

  if (tool.auth === "cron") {
    const secret =
      process.env.RVM_DROP_CRON_SECRET?.trim() || process.env.CRON_SECRET?.trim();
    if (!secret) throw new Error("Set CRON_SECRET / RVM_DROP_CRON_SECRET");
    headers["x-cron-secret"] = secret;
    headers.authorization = `Bearer ${secret}`;
  }
  if (tool.auth === "webhook") {
    const secret =
      process.env.RVM_DROP_WEBHOOK_SECRET?.trim() ||
      process.env.RVM_STATUS_WEBHOOK_SECRET?.trim();
    if (!secret) throw new Error("Set RVM_STATUS_WEBHOOK_SECRET");
    headers["x-webhook-secret"] = secret;
    headers.authorization = `Bearer ${secret}`;
  }

  const init: RequestInit = { method: tool.method, headers };

  if (tool.method === "GET") {
    if (Object.keys(rest).length) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(rest)) {
        if (v == null) continue;
        qs.set(k, typeof v === "string" ? v : JSON.stringify(v));
      }
      const q = qs.toString();
      if (q) url += `?${q}`;
    }
  } else if (tool.method === "DELETE" && tool.body) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(rest);
  } else if (tool.body !== false) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(
      Object.keys(rest).length
        ? rest
        : tool.method === "POST"
          ? { drain: true }
          : {},
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
  if (!res.ok) return { ok: false, status: res.status, url, error: data };
  return data;
}

export { mcpTools };
