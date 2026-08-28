import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mcpTools } from "./catalog";
import { invokeMcpTool } from "./invoke";

function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  const type = schema.type;
  if (type === "object" || (!type && schema.properties)) {
    const props = (schema.properties as Record<string, Record<string, unknown>>) || {};
    const required = new Set((schema.required as string[]) || []);
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, prop] of Object.entries(props)) {
      let field = jsonSchemaToZod(prop);
      if (prop.description && typeof prop.description === "string") {
        field = field.describe(prop.description);
      }
      if (!required.has(key)) field = field.optional();
      shape[key] = field;
    }
    return z.object(shape);
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const values = schema.enum as [string, ...string[]];
    return z.enum(values);
  }
  switch (type) {
    case "string":
      return z.string();
    case "integer":
      return z.number().int();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(
        jsonSchemaToZod((schema.items as Record<string, unknown>) || { type: "string" }),
      );
    default:
      return z.unknown();
  }
}

export function createRvmMcpServer() {
  const server = new McpServer({
    name: "rvm-drop",
    version: "1.0.0",
  });

  for (const tool of mcpTools) {
    const inputSchema = jsonSchemaToZod(tool.inputSchema as Record<string, unknown>);
    server.registerTool(
      tool.name,
      {
        title: tool.name,
        description: tool.description,
        inputSchema,
      },
      async (args) => {
        const result = await invokeMcpTool(tool, (args || {}) as Record<string, unknown>);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      },
    );
  }

  return server;
}
