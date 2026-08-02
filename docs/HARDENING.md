# RVM Drop hardening (Warmbly-style) + peer-repo ideas

Implemented in the file-store sequencer (Postgres schema aligned for the Prisma path). Patterns come from Warmbly and peer open-source sequencers/queues.

---

## Implemented in RVM Drop

| Idea | Where |
|---|---|
| Attempt ledger before send (`idempotencyKey`, QUEUED→SENDING→SENT) | `src/lib/store/db.ts` `createAttempt` / drain |
| Per-campaign advisory lease | `acquireCampaignLease` / `releaseCampaignLease` |
| Per-line min gap (~600s) + weighted / sticky / LRU pick | `line-picker.ts`, `LineRecord.minGapSec` |
| Global suppression list | `SuppressionRecord` + claim/import/Twilio STOP|callback |
| Auto-PAUSE on hard provider / empty-line errors | `drain.ts` `autoPause` |
| Campaign ramp ceiling (can only lower volume) | `campaignRampCeiling` + `CampaignRecord.ramp` |
| Humanized jitter inside send window | `humanizeSendAt` |
| Reconciler (stale SENDING + ACTIVE-with-due) | `reconcileCampaigns` on tick |
| Hash API keys at rest (SHA-256 + prefix) | `createApiKey` / Clients UI |
| Org daily hard cap + light API rate limit | `dailySendCounts`, `checkRateLimit` |
| Prisma alignment | `prisma/schema.prisma` Suppression, leases, ramp, minGap, idempotencyKey |

---

## Peer repos — same idea format

### Warmbly (`/tmp/warmbly-audit`)

Go mail warmup/campaign product: Cloud Tasks chains + Postgres advisory locks, SKIP LOCKED claims, ramp/jitter/spacing, suppressions, reconcilers.

| Idea | What they do | Why it matters for RVM Drop | Adopt? |
|---|---|---|---|
| Attempt ledger + reclaimable claim | `ClaimDueEmails` → `sending` via `FOR UPDATE SKIP LOCKED`; stale `sending` >10m → `pending` | Carrier drops/timeouts need claim→outcome so retries don’t double-drop | **Yes** (file claim today; SKIP LOCKED when on Postgres) |
| Per-entity advisory locks | `pg_advisory_xact_lock(hashtext('campaign_task_'…))` | Duplicate due jobs when cron + worker race | **Yes** (campaign lease now) |
| Line/mailbox min spacing + jitter | `resolveConflicts` minWait; campaign ±20m jitter | Metronomic RVM cadence burns DIDs | **Yes** |
| Ramp ceilings | `AdvanceRampLevel` once/UTC day; `min(mailbox_cap, daily_limit, ramp)` | New DIDs must ramp or get blocked | **Yes** |
| Suppression gate before send | `ShouldSuppressRecipient` → skipped | DNC/opt-out before carrier call | **Yes** |
| Auto-pause on no capacity | `autoPauseCampaign` on `ErrNoEmailAccounts` | No healthy lines → pause, don’t spin | **Yes** |
| Reconciler + stale reclaim | Cancel overdue pending tasks; re-seed chains | Lost webhooks leave zombie work | **Yes** |
| Sticky / weighted senders | `campaign_senders` weighted / RR / least_recent | Sticky DID per prospect | **Yes** |
| API key hashing + per-key RPM | SHA-256; Redis minute counters | Never store plaintext keys | **Yes** (hash + in-process RPM) |
| Org rate + mailbox sync caps | Redis Lua by category | Multi-tenant org + per-line caps | **Yes** (org daily hard cap) |

### cold-cli (`/tmp/cold-cli-audit`)

Agent-first Go cold-email sequencer: eager `scheduled_sends` ledger, dialect tick lock, sticky account-per-lead.

| Idea | What they do | Why it matters for RVM Drop | Adopt? |
|---|---|---|---|
| Eager attempt ledger | Precompute steps into `scheduled_sends` + append-only events | Maps to RVM attempt rows | **Yes** (ledger on claim; eager schedule next) |
| Global tick lease | SQLite flock / `pg_try_advisory_lock` — second tick exits | Exactly-one tick under multi-replica | **Yes** (per-campaign + store lock) |
| Sticky sender per lead | Round-robin assign at schedule; all steps same account | Sticky DID across follow-up RVMs | **Yes** (`stickyLineId`) |
| Min/max gap jitter | Step-1 spread with rand gap × lead index | Per-line humanized spacing | **Yes** |
| Capacity rebalance | Rewrite pending `send_at` from daily sent counts | Line hits cap → push queue without double-send | Partial (next: rebalance helper) |
| Terminal suppress | Unsub/bounce/reply cancel pending | Phone DNC cancels all future drops | **Yes** |
| Pre-send re-read | Tick re-reads row; skip if no longer pending | Race-safe under rebalance | **Yes** (idempotency key) |

### seqd (`/tmp/seqd-audit`)

Next.js/Postgres personal sequencer: slot reservation, sticky mailbox, SHA-256 API keys.

| Idea | What they do | Why it matters for RVM Drop | Adopt? |
|---|---|---|---|
| Future slot reservation | Walk ≤60 days counting pending+sent vs dailyLimit | Enroll-time capacity planning | Partial (ramp + line caps now) |
| Tx-guarded slot claim | Insert step-1 in transaction; re-count usage | Concurrent enrollments | **Yes** when on Postgres |
| Window spread + small jitter | Spread slotIndex/dailyLimit across window ±2m | Avoid top-of-hour floods | **Yes** (widen jitter) |
| Sticky mailbox | Bind mailbox at create | Sticky line/DID | **Yes** |
| Contact-level suppression | active/unsubscribed/bounced | DNC before drop | **Yes** |
| Pause with reason | `paused_reason` / `paused_at` | Auto-pause with audit | **Yes** (`lastError`) |
| Weak claim model | SELECT due without SKIP LOCKED | Dual cron = double drop | **No** as-is — we claim → SENDING |

### outbound-tools (`/tmp/outbound-tools-audit`)

IMAP-keyword MCP sequencer: terminal reply tags, Message-ID idempotent Sent append.

| Idea | What they do | Why it matters for RVM Drop | Adopt? |
|---|---|---|---|
| Terminal status tags | do_not_contact / unsubscribed / bounced / wrong_person | Map dispositions → hard suppress | **Yes** |
| Message-ID idempotent append | Skip if Message-ID already in Sent | Provider retry mustn’t duplicate attempts | **Yes** (`idempotencyKey` / CallSid) |
| IMAP mailbox lock | Exclusive lock around folder mutations | Exclusive lease per DID during drop | Conceptual **Yes** |
| Runtime sequence from store | No precomputed job table | Fine for demos; weak for durable RVM | **No** for core |
| Flag-as-ledger | IMAP keywords as audit | Not queryable/atomic enough | **No** — SQL/file ledger |

### River / pg-boss / Temporal (queue patterns — not cloned locally)

| Idea | What they do | Why it matters for RVM Drop | Adopt? |
|---|---|---|---|
| `SKIP LOCKED` job claim (River, pg-boss) | Workers `UPDATE … RETURNING` with skip-locked rows | Safe multi-replica drain without double-send | **Yes** when Postgres worker lands |
| Unique job keys | Insert job with unique `(queue, key)`; ignore conflict | Natural idempotency for `campaign:lead:step` | **Yes** |
| Scheduled / delayed jobs | `run_at` / `startAfter` | Soft skips (window/jitter) become delayed jobs | Partial (we use `nextEligibleAt`) |
| Durable timers + workflows (Temporal) | Timers survive restarts; saga compensations | Multi-step RVM sequences with retries | Later if sequences deepen |
| TX enqueue with business write | Insert attempt + job in same DB transaction | Crash between “mark sending” and “enqueue” can’t orphan | **Yes** on Prisma path |
| Dead-letter / max attempts | Move to DLQ after N fails | Matches our `SUPPRESSED` after max attempts | **Yes** |

### Twilio (inbound / status)

| Idea | What they do | Why it matters for RVM Drop | Adopt? |
|---|---|---|---|
| Signature validation | `X-Twilio-Signature` HMAC of URL+params | Stop spoofed STOP/callback events | **Yes** |
| CallSid / MessageSid idempotency | Treat SID as natural event key | Retried webhooks mustn’t re-suppress / re-inbox | **Yes** (`providerEventId`) |
| Status callbacks | Queue on `completed` / `failed`, not just accept | Reconcile Drop.co/Twilio outcome into attempt ledger | Next |

---

## Shipped upgrades (Postgres / Redis path)

1. `ScheduledSend` queue + `FOR UPDATE SKIP LOCKED` claim (`src/lib/store/scheduled.ts`)
2. Eager multi-step schedule on launch/import
3. Redis shared rate limits + org counters (Postgres/file fallback)
4. Provider status webhooks → attempt reconciler (`/api/webhooks/rvm-status`, Twilio status)
5. Capacity rebalance when line pool exhausted

See **`docs/LIVE.md`** for production wiring.
