#!/usr/bin/env node
/**
 * RVM Drop MCP server (stdio) for local Claude Desktop / Cursor.
 * For Claude Connectors over HTTPS, use: https://<your-railway-app>/api/mcp
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRvmMcpServer } from "../src/mcp/create-server";

async function main() {
  const server = createRvmMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("MCP server failed:", err);
  process.exit(1);
});
