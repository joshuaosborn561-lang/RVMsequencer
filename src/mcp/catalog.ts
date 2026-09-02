/**
 * Single source of truth for MCP tools and HTTP API.
 *
 * RULE: Every src/app/api route.ts must appear in `covers` (or `ignoreRoutes`).
 * `pnpm verify:mcp` / `pnpm verify` enforces this so future API changes stay in the MCP.
 */
export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type McpToolDef = {
  name: string;
  description: string;
  method: HttpMethod;
  /** Path template; `{id}` filled from args */
  path: string;
  /** JSON Schema for tool arguments (MCP inputSchema) */
  inputSchema: Record<string, unknown>;
  /** Args that become path params (removed from JSON body / query) */
  pathParams?: string[];
  /** If true, send remaining args as query string (GET) or JSON body */
  body?: boolean;
  /** Auth: none | cron (x-cron-secret) | webhook (Bearer / x-webhook-secret) */
  auth?: "none" | "cron" | "webhook";
  /** Route file globs / paths this tool covers (for coverage check) */
  covers: string[];
};

/** Routes intentionally not exposed as MCP tools (Twilio form posts, etc.) */
export const ignoreRoutes: string[] = [
  "src/app/api/webhooks/twilio/inbound/route.ts",
  "src/app/api/webhooks/twilio/status/route.ts",
  "src/app/api/webhooks/twilio/forward-screen/route.ts",
  "src/app/api/voice/render/route.ts", // TTS removed
  "src/app/api/mcp/route.ts", // remote MCP endpoint itself
  "src/app/api/supabase/refresh-outcomes/route.ts", // cron helper; covered by sequencer_drain ops
];

export const mcpTools: McpToolDef[] = [
  {
    name: "health",
    description: "Check app health (postgres, redis, claim path).",
    method: "GET",
    path: "/api/health",
    inputSchema: { type: "object", properties: {} },
    covers: ["src/app/api/health/route.ts"],
  },
  {
    name: "campaigns_list",
    description: "List all campaigns.",
    method: "GET",
    path: "/api/campaigns",
    inputSchema: { type: "object", properties: {} },
    covers: ["src/app/api/campaigns/route.ts"],
  },
  {
    name: "campaigns_create",
    description: "Create a campaign.",
    method: "POST",
    path: "/api/campaigns",
    body: true,
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        clientId: { type: "string" },
      },
    },
    covers: ["src/app/api/campaigns/route.ts"],
  },
  {
    name: "campaigns_get",
    description: "Get one campaign and its leads.",
    method: "GET",
    path: "/api/campaigns/{id}",
    pathParams: ["id"],
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
    },
    covers: ["src/app/api/campaigns/[id]/route.ts"],
  },
  {
    name: "campaigns_update",
    description:
      "Patch campaign (sequence, lines, schedule, ramp, audioUrl, status). Set status=ACTIVE to launch after leads+lines+audio are set. Then call sequencer_drain once to start sending immediately.",
    method: "PATCH",
    path: "/api/campaigns/{id}",
    pathParams: ["id"],
    body: true,
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        status: {
          type: "string",
          enum: ["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"],
        },
        audioUrl: {
          type: "string",
          description: "Hosted WAV/MP3/M4A URL for Slybroadcast (from audio_upload or external host)",
        },
        lineIds: {
          type: "array",
          items: { type: "string" },
          description: "Line ids or E.164 DIDs to use as c_callerID",
        },
        steps: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "position", "delayDays", "scriptTemplate"],
            properties: {
              id: { type: "string" },
              position: { type: "integer" },
              delayDays: { type: "integer", description: "Days after prior step (0 = day 0)" },
              scriptTemplate: { type: "string" },
              audioUrl: { type: "string" },
            },
          },
        },
        schedule: {
          type: "object",
          properties: {
            sendWindowStart: { type: "integer", description: "Local hour 0–23" },
            sendWindowEnd: { type: "integer", description: "Local hour 1–24" },
            sendDays: {
              type: "array",
              items: { type: "integer" },
              description: "0=Sun … 6=Sat (default Mon–Fri 1–5)",
            },
            timezoneMode: { type: "string", enum: ["RECIPIENT_LOCAL", "FIXED"] },
            fixedTimezone: { type: "string" },
            newLeadsPerDay: {
              type: "integer",
              description:
                "Deprecated — ignored. Volume is limited by per-line dailyCap only.",
            },
            requireConsent: { type: "boolean" },
            stopOnCallback: { type: "boolean" },
            stopOnOptOut: { type: "boolean" },
          },
        },
        ramp: {
          type: "object",
          description:
            "Deprecated — ignored. Per-line warmup dailyCap is the only volume limit.",
          properties: {
            enabled: { type: "boolean" },
            startPerDay: { type: "integer" },
            incrementPerDay: { type: "integer" },
            ceilingPerDay: { type: "integer" },
          },
        },
      },
    },
    covers: ["src/app/api/campaigns/[id]/route.ts"],
  },
  {
    name: "campaigns_send_now",
    description:
      "Activate campaign and immediately drain (test drop / start sending without waiting for cron).",
    method: "POST",
    path: "/api/campaigns/{id}/send-now",
    pathParams: ["id"],
    body: true,
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        audioUrl: { type: "string" },
        limit: { type: "integer" },
      },
    },
    covers: ["src/app/api/campaigns/[id]/send-now/route.ts"],
  },
  {
    name: "campaigns_preview",
    description: "Preview personalized script + send-window for a campaign lead.",
    method: "POST",
    path: "/api/campaigns/{id}/preview",
    pathParams: ["id"],
    body: true,
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        leadId: { type: "string" },
        stepPosition: { type: "integer", description: "1-based sequence step" },
      },
    },
    covers: ["src/app/api/campaigns/[id]/preview/route.ts"],
  },
  {
    name: "leads_list",
    description: "List leads for a campaign.",
    method: "GET",
    path: "/api/campaigns/{id}/leads",
    pathParams: ["id"],
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string", description: "Campaign id" } },
    },
    covers: ["src/app/api/campaigns/[id]/leads/route.ts"],
  },
  {
    name: "leads_import",
    description: "Import leads (JSON array or CSV + mapping). Scrubs DNC.",
    method: "POST",
    path: "/api/campaigns/{id}/leads",
    pathParams: ["id"],
    body: true,
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        mode: { type: "string", enum: ["append", "replace"] },
        leads: {
          type: "array",
          items: {
            type: "object",
            properties: {
              phone: { type: "string" },
              firstName: { type: "string" },
              lastName: { type: "string" },
              company: { type: "string" },
              email: { type: "string" },
              custom: { type: "object" },
            },
          },
        },
        csv: { type: "string" },
        mapping: { type: "object" },
      },
    },
    covers: ["src/app/api/campaigns/[id]/leads/route.ts"],
  },
  {
    name: "leads_import_from_url",
    description:
      "Import leads from an HTTPS Supabase CSV URL (public storage, signed URL, or edge feed). Prefer over pasting large CSVs. Auto-guesses column mapping when omitted.",
    method: "POST",
    path: "/api/campaigns/{id}/leads/from-url",
    pathParams: ["id"],
    body: true,
    inputSchema: {
      type: "object",
      required: ["id", "url"],
      properties: {
        id: { type: "string", description: "Campaign id" },
        url: {
          type: "string",
          description: "HTTPS CSV URL on *.supabase.co (public or signed)",
        },
        mode: { type: "string", enum: ["append", "replace"] },
        mapping: {
          type: "object",
          properties: {
            phone: { type: "string" },
            firstName: { type: "string" },
            lastName: { type: "string" },
            company: { type: "string" },
            email: { type: "string" },
          },
        },
      },
    },
    covers: ["src/app/api/campaigns/[id]/leads/from-url/route.ts"],
  },
  {
    name: "clients_list",
    description: "List clients (HubSpot opt-in flags included).",
    method: "GET",
    path: "/api/clients",
    inputSchema: { type: "object", properties: {} },
    covers: ["src/app/api/clients/route.ts"],
  },
  {
    name: "clients_create",
    description: "Create a client.",
    method: "POST",
    path: "/api/clients",
    body: true,
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        hubspotOptIn: { type: "boolean" },
        hubspotOwnerId: { type: "string" },
      },
    },
    covers: ["src/app/api/clients/route.ts"],
  },
  {
    name: "clients_update",
    description: "Update client (name, HubSpot opt-in).",
    method: "PATCH",
    path: "/api/clients",
    body: true,
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        hubspotOptIn: { type: "boolean" },
        hubspotOwnerId: { type: "string", nullable: true },
      },
    },
    covers: ["src/app/api/clients/route.ts"],
  },
  {
    name: "api_keys_list",
    description: "List API keys (hashes/prefixes only).",
    method: "GET",
    path: "/api/clients/keys",
    inputSchema: {
      type: "object",
      properties: { clientId: { type: "string" } },
    },
    covers: ["src/app/api/clients/keys/route.ts"],
  },
  {
    name: "api_keys_create",
    description: "Create API key (secret returned once).",
    method: "POST",
    path: "/api/clients/keys",
    body: true,
    inputSchema: {
      type: "object",
      required: ["clientId", "name"],
      properties: {
        clientId: { type: "string" },
        name: { type: "string" },
      },
    },
    covers: ["src/app/api/clients/keys/route.ts"],
  },
  {
    name: "api_keys_revoke",
    description: "Revoke an API key.",
    method: "DELETE",
    path: "/api/clients/keys",
    body: true,
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
    },
    covers: ["src/app/api/clients/keys/route.ts"],
  },
  {
    name: "inbox_list",
    description: "List Master Inbox messages (callbacks, SMS).",
    method: "GET",
    path: "/api/inbox",
    inputSchema: {
      type: "object",
      properties: { clientId: { type: "string" } },
    },
    covers: ["src/app/api/inbox/route.ts"],
  },
  {
    name: "inbox_update",
    description: "Update inbox message category (CALLBACK/DNC/…) or mark read.",
    method: "PATCH",
    path: "/api/inbox",
    body: true,
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        category: {
          type: "string",
          enum: ["UNREAD", "INTERESTED", "NOT_INTERESTED", "CALLBACK", "DNC", "OTHER"],
        },
        readAt: { type: "string" },
      },
    },
    covers: ["src/app/api/inbox/route.ts"],
  },
  {
    name: "settings_get",
    description: "Get workspace settings + effective call-forward.",
    method: "GET",
    path: "/api/settings",
    inputSchema: { type: "object", properties: {} },
    covers: ["src/app/api/settings/route.ts"],
  },
  {
    name: "settings_update",
    description: "Update call-forward, hard cap, line min-gap.",
    method: "PATCH",
    path: "/api/settings",
    body: true,
    inputSchema: {
      type: "object",
      properties: {
        callForwardToE164: { type: ["string", "null"] },
        callForwardTimeoutSec: {
          type: "number",
          description:
            "Dial ring timeout; use ≥90 so Allo can finish ringing (Twimlets default ~20s drops mid-ring)",
        },
        callForwardRequireAccept: {
          type: "boolean",
          description:
            "Opt-in. When true, Allo must press 1 after answer before bridge",
        },
        hardCapDailySends: {
          type: "number",
          description: "Deprecated — ignored; per-line dailyCap limits volume",
        },
        lineMinGapSec: { type: "number" },
        requireFcrRegistration: { type: "boolean" },
        maxAttemptsPerContactPerDay: {
          type: "integer",
          description: "Max RVM attempts per phone per UTC day (default 2)",
        },
        seedInjectPerCampaignPerDay: { type: "integer" },
      },
    },
    covers: ["src/app/api/settings/route.ts"],
  },
  {
    name: "lines_list",
    description:
      "List Twilio DID pool (caps, sent today, reputation label/score/source/report count/last check, and spam-likelihood hint).",
    method: "GET",
    path: "/api/lines",
    inputSchema: { type: "object", properties: {} },
    covers: ["src/app/api/lines/route.ts"],
  },
  {
    name: "lines_ensure",
    description: "Add/ensure a Twilio DID in the line pool (default dailyCap 80).",
    method: "POST",
    path: "/api/lines",
    body: true,
    inputSchema: {
      type: "object",
      required: ["e164"],
      properties: {
        e164: { type: "string", description: "E.164 or 10-digit US number" },
      },
    },
    covers: ["src/app/api/lines/route.ts"],
  },
  {
    name: "lines_update",
    description:
      "Update a line's dailyCap, status, warmupDay, minGapSec, or registeredFcr. Ask the user how many drops/day per DID.",
    method: "PATCH",
    path: "/api/lines",
    body: true,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        e164: { type: "string" },
        dailyCap: { type: "integer", description: "Max deposits/day on this DID" },
        status: {
          type: "string",
          enum: ["PROVISIONING", "WARMING", "HEALTHY", "DEGRADED", "QUARANTINED", "RETIRED"],
        },
        warmupDay: { type: "integer" },
        minGapSec: { type: "integer", description: "Min seconds between deposits on this DID" },
        registeredFcr: {
          type: "boolean",
          description: "Mark Free Caller Registry / Voice Integrity complete",
        },
      },
    },
    covers: ["src/app/api/lines/route.ts"],
  },
  {
    name: "audio_list",
    description:
      "List saved voicemail audio assets. Offer these when the user can reuse a prior recording.",
    method: "GET",
    path: "/api/audio",
    inputSchema: { type: "object", properties: {} },
    covers: ["src/app/api/audio/route.ts"],
  },
  {
    name: "audio_upload",
    description:
      "Save voicemail audio: pass url (already hosted) OR base64 (user recorded/uploaded file). Returns public url to set on campaign.audioUrl.",
    method: "POST",
    path: "/api/audio",
    body: true,
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Label e.g. 'Q1 intro RVM'" },
        url: { type: "string", description: "Existing public WAV/MP3/M4A URL" },
        base64: {
          type: "string",
          description: "Raw base64 or data:audio/...;base64,... from user file",
        },
        contentType: { type: "string", description: "audio/wav | audio/mpeg | audio/mp4" },
      },
    },
    covers: ["src/app/api/audio/route.ts", "src/app/api/audio/[id]/file/route.ts"],
  },
  {
    name: "create_recording_link",
    description:
      "Returns a signed browser link the operator opens (phone or desktop) to record voicemail audio onto the campaign. Pass script / scriptTemplate to put the read-aloud script on that page. After they save, poll campaigns_get until audioUrl is set. Does not change campaign status.",
    method: "POST",
    path: "/api/campaigns/{id}/recording-link",
    pathParams: ["id"],
    body: true,
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Campaign id" },
        scriptTemplate: {
          type: "string",
          description:
            "Voicemail script shown on the recorder page (merge tags like {{first_name}} ok)",
        },
        script: {
          type: "string",
          description: "Alias for scriptTemplate",
        },
        ttlHours: {
          type: "integer",
          description: "Link lifetime in hours (default 168 = 7 days)",
        },
      },
    },
    covers: [
      "src/app/api/campaigns/[id]/recording-link/route.ts",
      "src/app/api/audio/record/route.ts",
    ],
  },
  {
    name: "preferences_get",
    description:
      "Load saved Claude defaults (lines, audio, schedule, caps). Call first in a new chat to skip re-asking.",
    method: "GET",
    path: "/api/preferences",
    inputSchema: { type: "object", properties: {} },
    covers: ["src/app/api/preferences/route.ts"],
  },
  {
    name: "preferences_update",
    description:
      "Save defaults after a successful setup so the next Claude session can reuse them (skill memory).",
    method: "PATCH",
    path: "/api/preferences",
    body: true,
    inputSchema: {
      type: "object",
      properties: {
        defaultClientId: { type: "string" },
        defaultLineIds: { type: "array", items: { type: "string" } },
        defaultAudioUrl: { type: "string" },
        defaultAudioAssetId: { type: "string" },
        defaultNewLeadsPerDay: { type: "integer" },
        defaultHardCapDailySends: { type: "integer" },
        defaultLineDailyCap: { type: "integer" },
        defaultSchedule: {
          type: "object",
          properties: {
            sendWindowStart: { type: "integer" },
            sendWindowEnd: { type: "integer" },
            sendDays: { type: "array", items: { type: "integer" } },
            timezoneMode: { type: "string", enum: ["RECIPIENT_LOCAL", "FIXED"] },
            fixedTimezone: { type: "string" },
            requireConsent: { type: "boolean" },
            stopOnCallback: { type: "boolean" },
            stopOnOptOut: { type: "boolean" },
          },
        },
        lastCampaignId: { type: "string" },
        notes: { type: "string" },
      },
    },
    covers: ["src/app/api/preferences/route.ts"],
  },
  {
    name: "suppress_phone",
    description: "Globally suppress a phone (cancel queue, optional DNC).",
    method: "POST",
    path: "/api/suppress",
    body: true,
    inputSchema: {
      type: "object",
      required: ["phone"],
      properties: {
        phone: { type: "string" },
        reason: { type: "string" },
        markDnc: { type: "boolean" },
        optOut: { type: "boolean" },
      },
    },
    covers: ["src/app/api/suppress/route.ts"],
  },
  {
    name: "suppression_sync_status",
    description:
      "Allo → RVM suppression sync status: last run, calls scanned, per-rule counts (allo_dnc / allo_tag / allo_conversation), undetermined count, cursor. Never returns phone numbers.",
    method: "GET",
    path: "/api/allo/sync",
    auth: "cron",
    inputSchema: { type: "object", properties: {} },
    covers: ["src/app/api/allo/sync/route.ts"],
  },
  {
    name: "suppression_sync_run",
    description:
      "Run Allo → RVM suppression sync now (hourly or full backfill). Requires cron secret. Prefer backfill once after deploy.",
    method: "POST",
    path: "/api/allo/sync",
    body: true,
    auth: "cron",
    inputSchema: {
      type: "object",
      properties: {
        backfill: {
          type: "boolean",
          description: "Walk full Allo history from 2020-01-01",
        },
        force: {
          type: "boolean",
          description: "Bypass hourly gate",
        },
      },
    },
    covers: ["src/app/api/allo/sync/route.ts"],
  },
  {
    name: "scrub_phones",
    description: "Run DNC scrub on a list of phones.",
    method: "POST",
    path: "/api/scrub",
    body: true,
    inputSchema: {
      type: "object",
      required: ["numbers"],
      properties: {
        numbers: { type: "array", items: { type: "string" } },
        internalBlocked: { type: "array", items: { type: "string" } },
      },
    },
    covers: ["src/app/api/scrub/route.ts"],
  },
  {
    name: "timezone_lookup",
    description: "Guess timezone from phone number.",
    method: "GET",
    path: "/api/timezone",
    inputSchema: {
      type: "object",
      required: ["phone"],
      properties: { phone: { type: "string" } },
    },
    covers: ["src/app/api/timezone/route.ts"],
  },
  {
    name: "sequencer_drain",
    description:
      "Run sequencer tick (reconcile + drain ACTIVE campaigns, then poll Slybroadcast campaign_result for pending receipts). Also runs the daily from-number spam/blacklist check if due. Requires cron secret.",
    method: "POST",
    path: "/api/sequencer/tick",
    body: true,
    auth: "cron",
    inputSchema: {
      type: "object",
      properties: {
        drain: { type: "boolean", default: true },
        limit: { type: "number", description: "Max claims this tick (1–200)" },
        forceReputation: {
          type: "boolean",
          description: "Force daily reputation/spam check even if already ran today",
        },
      },
    },
    covers: ["src/app/api/sequencer/tick/route.ts"],
  },
  {
    name: "reputation_check",
    description:
      "Spam check for Twilio from-numbers (DIDs). CallTracer crowd score by default; optional Hiya if HIYA_API_KEY is set. Callback rates are metrics only (never MIXED_HIGH). Quarantines FLAGGED / degrades MIXED_HIGH from external labels. GET returns persisted score/source/reports; POST or GET ?refresh=1 force-refreshes. Requires cron secret.",
    method: "POST",
    path: "/api/reputation/check",
    body: true,
    auth: "cron",
    inputSchema: {
      type: "object",
      properties: {
        force: {
          type: "boolean",
          description: "Run even if already checked in the last ~20 hours",
        },
        e164: {
          type: "string",
          description: "Check a single DID (E.164). Skips the daily gate.",
        },
      },
    },
    covers: ["src/app/api/reputation/check/route.ts"],
  },
  {
    name: "quiet_hours_list",
    description:
      "List federal + US state quiet-hours clamps applied to campaign send windows.",
    method: "GET",
    path: "/api/quiet-hours",
    inputSchema: { type: "object", properties: {} },
    covers: ["src/app/api/quiet-hours/route.ts"],
  },
  {
    name: "audit_list",
    description: "List append-only audit events (sends, skips, suppressions, seeds, FCR, receipt health).",
    method: "GET",
    path: "/api/audit",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer" },
        campaignId: { type: "string" },
      },
    },
    covers: ["src/app/api/audit/route.ts"],
  },
  {
    name: "seeds_list",
    description: "List seed/canary numbers used to verify RVM delivery.",
    method: "GET",
    path: "/api/seeds",
    inputSchema: { type: "object", properties: {} },
    covers: ["src/app/api/seeds/route.ts"],
  },
  {
    name: "seeds_upsert",
    description: "Add or update a seed/canary phone number for delivery verification.",
    method: "POST",
    path: "/api/seeds",
    body: true,
    inputSchema: {
      type: "object",
      required: ["e164"],
      properties: {
        e164: { type: "string" },
        label: { type: "string" },
        carrier: { type: "string" },
        active: { type: "boolean" },
      },
    },
    covers: ["src/app/api/seeds/route.ts"],
  },
  {
    name: "delivery_status",
    description:
      "Post a delivery status event into the attempt ledger (Slybroadcast / normalized).",
    method: "POST",
    path: "/api/webhooks/rvm-status",
    body: true,
    auth: "webhook",
    inputSchema: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          enum: ["SLYBROADCAST", "TWILIO", "UNKNOWN"],
        },
        providerMessageId: { type: "string" },
        drop_id: { type: "string" },
        foreignId: { type: "string" },
        foreign_id: { type: "string" },
        status: {
          type: "string",
          enum: [
            "queued",
            "sent",
            "delivered",
            "failed",
            "rejected",
            "human_answered",
            "success",
            "failure",
          ],
        },
        reason: { type: "string" },
        errorDetail: { type: "string" },
      },
    },
    covers: ["src/app/api/webhooks/rvm-status/route.ts"],
  },
];

export function coveredRouteSet(): Set<string> {
  const s = new Set<string>();
  for (const t of mcpTools) for (const c of t.covers) s.add(c);
  for (const i of ignoreRoutes) s.add(i);
  return s;
}
