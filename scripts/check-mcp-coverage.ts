/**
 * Fails if any API route.ts under src/app/api is missing from src/mcp/catalog.ts.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { coveredRouteSet, mcpTools } from "../src/mcp/catalog";

function walkRoutes(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walkRoutes(full, acc);
    else if (name === "route.ts") acc.push(full.replace(/\\/g, "/"));
  }
  return acc;
}

function main() {
  const root = path.join(process.cwd(), "src/app/api");
  const routes = walkRoutes(root).map((p) =>
    path.relative(process.cwd(), p).replace(/\\/g, "/"),
  );
  const covered = coveredRouteSet();
  const missing = routes.filter((r) => !covered.has(r));
  const phantom = [...covered].filter((c) => {
    if (!c.startsWith("src/app/api/")) return false;
    try {
      statSync(path.join(process.cwd(), c));
      return false;
    } catch {
      return true;
    }
  });

  if (missing.length || phantom.length) {
    console.error("MCP catalog out of sync with API routes.");
    for (const m of missing) console.error(`  missing: ${m}`);
    for (const m of phantom) console.error(`  phantom: ${m}`);
    process.exit(1);
  }
  console.log(
    `verify-mcp: ok — ${mcpTools.length} tools cover ${routes.length} API routes`,
  );
}

main();
