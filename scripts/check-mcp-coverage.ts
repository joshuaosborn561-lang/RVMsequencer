/**
 * Fails if any API route.ts under src/app/api is missing from mcp/catalog.ts
 * covers or ignoreRoutes. Run via `pnpm verify:mcp` (also hooked from verify).
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { coveredRouteSet, mcpTools } from "../mcp/catalog";

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
  const phantom = [...covered].filter(
    (c) =>
      c.startsWith("src/app/api/") &&
      !routes.includes(c) &&
      !c.includes("["), // dynamic ok if file exists — re-check
  );

  // Re-validate phantoms that aren't ignore-only: file must exist
  const realPhantom = phantom.filter((c) => {
    try {
      statSync(path.join(process.cwd(), c));
      return false;
    } catch {
      return true;
    }
  });

  if (missing.length || realPhantom.length) {
    console.error("MCP catalog out of sync with API routes.");
    if (missing.length) {
      console.error("\nMissing from mcp/catalog.ts (add tool covers or ignoreRoutes):");
      for (const m of missing) console.error(`  - ${m}`);
    }
    if (realPhantom.length) {
      console.error("\nCatalog covers non-existent routes:");
      for (const m of realPhantom) console.error(`  - ${m}`);
    }
    console.error(
      `\n${mcpTools.length} MCP tools registered. Fix catalog before merging.`,
    );
    process.exit(1);
  }

  console.log(
    `verify-mcp: ok — ${mcpTools.length} tools cover ${routes.length} API routes`,
  );
}

main();
