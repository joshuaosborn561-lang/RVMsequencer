# RVM Drop Canon

**Source of truth for how RVM Drop must behave and whether a drop is allowed.**  
If this conflicts with UI copy, old docs (`HARDENING.md`, chat memory), **this file wins** until deliberately updated.

- **HARD** = blocks send, launch, or violates correct sequencing  
- **Soft** = default / preference / concurrency — not a compliance fail by itself  

Update this file in the **same PR** as any send or sequencer behavior change.

---

# Part A — How the app should function

## A1. Product shape

RVM Drop is a **ringless-voicemail sequencer**:

1. Import leads → attach **hosted audio** + **Twilio DIDs** → set schedule → launch `ACTIVE`
2. Cron drains the queue → **Slybroadcast** deposits using the DID as `c_callerID`
3. Inbound voice/SMS on those DIDs → Inbox + optional forward to **Allo** + suppression
4. Allo call outcomes sync into the **same** suppression list the sequencer respects

There is **no TTS**. Audio is a real hosted file (URL or in-app recorder).

Live: `https://rvm-drop-production.up.railway.app`  
Cron: Railway `sequencer-cron` → `POST /api/sequencer/tick` every **5 minutes** with `CRON_SECRET`.

---

## A2. Campaign lifecycle

| Status | Meaning | Who sets it |
|---|---|---|
| `DRAFT` | Editing; not drained | Create default |
| `SCHEDULED` | Allowed in API; **not drained** | Manual (unused by cron) |
| `ACTIVE` | Sequencer will claim/send | Launch after blockers pass |
| `PAUSED` | Stopped; queue kept | Manual or auto-pause |
| `COMPLETED` | No pending work left after sends | Drain when queue empty |
| `ARCHIVED` | Dead; not drained | Manual |

**Launch → `ACTIVE` HARD blockers:**

- [ ] ≥1 sendable lead (`!dnc`, not `OPTED_OUT`, status not `SUPPRESSED`/`SENT`)
- [ ] ≥1 line on the campaign
- [ ] Hosted `audioUrl` (campaign **or** step 1)
- [ ] Non-empty `sendDays`

**Auto-pause (runtime):** `NO_SEQUENCE_STEP` | `NO_LINES_CONFIGURED` | `PROVIDER_HARD_FAIL`.

**Completed:** drain sees zero pending/claimed/failed scheduled rows **and** something sent today or this tick → `COMPLETED`.

**Operator rule:** confirm explicitly before launch; call `sequencer_drain` once after `ACTIVE` so sending does not wait solely on cron.

---

## A3. End-to-end sequence (happy path)

```
Import leads
    → (optional) DNC scrub on import
    → if campaign already ACTIVE: eagerScheduleCampaign
Launch ACTIVE
    → eagerScheduleCampaign: 1 ScheduledSend per lead × step
Cron tick (every 5m)
    → reputation (daily) → Allo sync (hourly) → reconcile → drain → receipt poll
Drain
    → advance line warmups (once/UTC day)
    → inject seeds → bump seed runAt to now
    → for each ACTIVE campaign (≤50):
         lease → claim due rows (seeds first) → runAttempt → advance
Receipt poll (tick, after drain)
    → Slybroadcast `c_option=campaign_result` for accepted sends still Pending/queued
    → settle ~3m, batch cap 40; OK → delivered, Failure → failed
Webhook rvm-status (same mapping)
    → deliveryStatus delivered|sent unlocks next step
    → failed|rejected|human_answered cancels later steps
```

### Eager schedule

- Skip leads: `dnc`, `OPTED_OUT`, `SUPPRESSED`
- Step 1 `runAt = now` (+ soft jitter except seeds)
- Step N>1: `runAt = now + Σ delayDays` (cumulative, ms; + same enqueue jitter)
- Idempotency key: `{campaignId}_{leadId}_step{N}` — re-schedule is safe

### Claim → send → advance

1. Claim `PENDING` with `runAt <= now` (Postgres `SKIP LOCKED` or file lock)
2. Create attempt → `SENDING` → `runAttempt` (all compliance gates)
3. Success: scheduled + attempt `SENT`; lead `currentStepPosition` updated; sticky DID stored
4. Last step → lead `SENT`; else lead stays `PENDING` for later steps

Default batch per tick: **25** (API 1–200). Volume ceiling = **sum of line remaining caps only**.

---

## A4. Multi-step sequencing rules

| Rule | HARD? |
|---|---|
| Step 1 claimable when due | YES |
| Step N>1 claimable only if prior `deliveryStatus` ∈ `{delivered, sent}` | YES |
| Prior `FAILED` / `CANCELLED` / `SUPPRESSED` → cancel later (`PRIOR_STEP_NOT_DELIVERED`) | YES |
| Prior delivery `failed` / `rejected` / `human_answered` → cancel later | YES |
| Provider **accept** alone is not enough for step 2 — wait for webhook `delivered`\|`sent` **or** tick `campaign_result` with `dial_status=OK` | YES |
| Confirmed drop = `dial_status` **OK** (or webhook `delivered`/`sent`). `Pending` is **not** confirmed | YES |
| `delayDays` only offsets eager `runAt`; unlock still needs prior delivery | YES |

Accept-time drain often sets `deliveryStatus: "queued"` and Supabase `rvm_drops.dial_status=Pending` until `/api/webhooks/rvm-status` **or** the tick receipt poll (`campaign_result`) updates them.

---

## A5. Sticky DID

1. Prefer `scheduled.stickyLineId ?? lead.stickyLineId` if that line is still eligible
2. Else weighted pick (local presence, reputation, remaining cap, warmup day, HEALTHY vs DEGRADED, FCR)
3. On successful send, sticky = winning line on lead + scheduled row

Eligible = `WARMING|HEALTHY|DEGRADED`, under `dailyCap`, not `FLAGGED`, min-gap OK, FCR if required.

Default min gap between sends on the **same** DID: **600 seconds**.

---

## A6. Tick loop (what “running” means)

Every **5 minutes**, `POST /api/sequencer/tick`:

1. **Daily reputation** (~once / 20h unless forced) — may quarantine / degrade DIDs  
2. **Allo suppression sync** (if key set; skip if last run &lt; ~55m) — never blocks drain on failure  
3. **Reconcile** — surface ACTIVE work; stale claims reclaimed inside claim  
4. **Drain** — warmups → seeds → claim/send  
5. **Receipts** — poll Slybroadcast `campaign_result` for recent accepted sends still `Pending` / `queued` (settle ~3m so the gateway can settle; batch cap 40). Maps **OK → delivered**, **Failure → failed** via `reconcileProviderDelivery` (and patches `rvm_drops.dial_status`). Tick JSON includes `{ refreshed, ok, failed, stillPending }` under `receipts`. **Does not auto-pause.** May set `receipts.flag = RECEIPT_HEALTH` (and an audit event) if Failure rate is high (≥30% with ≥10 settled) or many rows stay Pending &gt;30m.  

**Healthy day-to-day signals:**

- Tick returns `mode: "drain"`; campaigns show fresh `lastDrainAt` / `lastDrainStats`
- Queue moves `PENDING → CLAIMED → SENT`; receipts/webhooks move `queued → sent|delivered`
- Confirmed drop = `dial_status` OK; `Pending` is not confirmed and should age out mid-day
- Multi-step advances only after delivery unlock + `delayDays`
- Seeds (if configured) appear first in the batch; once/UTC day per seed
- Lines climb warmup caps once/UTC day (20→80); pool not mass-quarantined
- Outside window/gap/cap → **defer**, not tight spin
- Failures back off then give up at 8 attempts; hard provider errors **pause** the campaign
- No campaign-day or org hard-cap gating — only **line caps** + **2 attempts/contact/UTC day**

---

## A7. Defer / jitter / rebalance

| Situation | Behavior |
|---|---|
| Outside send window / days | Skip / defer to next eligible |
| Daily frequency cap (default 2) | Defer **~6h** (not permanent suppress) |
| Line min gap / pool empty | Defer; rebalance pending `runAt` (≥60s, often gap+5s or **15m**) |
| Humanized jitter | Soft pace **at eager schedule / first enqueue**; **seeds and send-now skip**. Drain does **not** re-defer already-due rows (`runAt <= now`) for jitter. |
| Mid-batch no line | Defer **15m** `NO_LINE_CAPACITY` |

Jitter: applied once when creating the ScheduledSend (~40% of `(windowHours×3600 / dailyCap)`, clamped 30s–45m; fallback max 90s; avoid exact :00/:30). Already-due claimed rows send (still respect window, DNC, line gap, caps).

---

## A8. Failure / retry / give-up

| Outcome | What happens |
|---|---|
| DNC / opt-out / scrub / global suppress | Terminal skip; lead suppressed as appropriate |
| Provider fail, attempts &lt; **8** | Exponential backoff `5m × 2^(n−1)`, cap **6h**; reschedule `PENDING` |
| Attempts ≥ **8** | Lead + scheduled suppressed; later steps cancelled `PRIOR_STEP_MAX_ATTEMPTS` |
| Hard provider/config error | Auto-pause `PROVIDER_HARD_FAIL` |
| Webhook `human_answered` | Cancel subsequent steps |

---

## A9. Seeds relative to drain

On **every** drain, before regular claims:

1. Inject up to **N** active seeds not dropped today UTC (default N=2) into each ACTIVE campaign that has audio  
2. Eager-schedule + **bump seed `runAt` to now**  
3. Claim with `priorityPhones` = seed phones  
4. Seeds **skip jitter** and send first  

---

## A10. Inbound: callbacks, STOP, inbox

| Event | Expected behavior |
|---|---|
| Voice inbound on campaign DID | Inbox `CALLBACK`; Dial forward to Allo (≥**90s** timeout); pass **lead From** (do not substitute DID) |
| `stopOnCallback` (default true) | Global suppress source `CALLBACK` + DNC + cancel queue |
| SMS STOP / unsubscribe / cancel / end / quit | Always suppress `SMS_STOP` + OPTED_OUT + DNC + cancel queue |
| Allo DND on receiving VOIP | Ops fail — one ring → VM (not an app bug) |
| Twimlets / dial timeout ~20s | Ops fail — “dropped while ringing” |

Outbound RVM does **not** require forward configured; **usable callbacks do**.

---

# Part B — Compliance gates (every deposit)

## B1. Pre-send gate order

A deposit may leave only if all pass, in order:

| # | Gate | HARD? | Fail |
|---|---|---|---|
| 1 | Lead not `dnc` | YES | `DNC` |
| 2 | Lead not `OPTED_OUT` | YES | `OPTED_OUT` |
| 3 | Phone not on global suppression | YES | `SUPPRESSED` |
| 4 | Phone not on client exclusion | YES | `SUPPRESSED` |
| 5 | Not halted by CALLBACK suppress | YES | `CALLBACK_HALT` |
| 6 | Attempts today &lt; max (default **2** UTC) | YES | Defer ~6h |
| 7 | External DNC scrub (when configured) | YES | `SCRUB_BLOCKED` |
| 8 | Local day in effective `sendDays` | YES | `OUTSIDE_SEND_DAYS` |
| 9 | Local hour in effective window | YES | `OUTSIDE_SEND_WINDOW` |
| 10 | Consent if `requireConsent` | CONDITIONAL | `MISSING_CONSENT` |
| 11 | Eligible line (status, cap, gap, reputation, FCR) | YES | Defer `NO_LINE_CAPACITY` |
| 12 | Hosted audio URL | YES | `NO_AUDIO_URL` |

Code: `suppression-order.ts` → scrub → `gates.ts` / `send-window.ts` → `line-picker.ts` → provider.

---

## B2. Quiet hours & windows

**Federal floor (always):** local **08:00–21:00**.

Campaign window is **clamped**, never expanded:

- start = max(campaign, federal, state)  
- end = min(campaign, federal, state)  
- days = intersection with state `allowedDays` when set  

**End is exclusive:** local hour must be `< sendWindowEnd` (end 13 = last send 12:59).

**Friday optional shorter window:** `fridaySendWindowStart` / `fridaySendWindowEnd`. When the recipient-local day is Friday (`getDay() === 5`) and either override is set, those hours are clamped instead of the main window. When both are absent, Friday uses `sendWindowStart` / `sendWindowEnd` (existing campaigns keep one window all send days).

**Default schedule (SalesGlider):** Mon–Thu 09–17, Friday 09–13, weekdays, `RECIPIENT_LOCAL`.

| State | Stricter rule |
|---|---|
| AL, FL, LA, MA, MS, WY | End 20:00 |
| KY | Start 10:00 |
| NV | 09:00–20:00 |
| NM, OR, SD, TX | Start 09:00 |
| RI | 09:00–18:00 |
| NJ, OK | No Sunday |

TZ order: FIXED → lead TZ → state TZ → phone NPA.

---

## B3. Lines / volume / reputation

### Volume canon

- **Only per-line `dailyCap` limits volume**
- Campaign `ramp` / `newLeadsPerDay` → **ignored**
- Org hard cap → counted, **not** a send gate

### Default warmup

| Band | Cap |
|---|---|
| Day 1–2 | **20** |
| …×1.25 every 2 days… | |
| Day 15+ | **80** |

`minWarmDays` 12, `targetCap` 80. Optional attested profile target 100.

### Line pick HARD

- Status `WARMING` | `HEALTHY` | `DEGRADED`
- `sentToday < dailyCap`
- Not `FLAGGED`
- Min gap elapsed (default 600s)
- `registeredFcr` if `requireFcrRegistration`

| Reputation signal | Action |
|---|---|
| FLAGGED (external) | Quarantine |
| MIXED_HIGH (external) | Degrade |

**Where labels come from:** CallTracer crowd spam score (free default) and optional Hiya when `HIYA_API_KEY` is set. Worst external label wins. Operators see **label, score, source, report count, last check**, plus a plain-English hint (`Likely spam` / `Elevated` / `Clean` / `Unknown`).

**Not a spam label:** 7-day callback rate vs pool average is a **monitoring metric only**. It must not become `MIXED_HIGH` / `FLAGGED` and must not degrade or quarantine a line. Never-sent DIDs (`attempts7d === 0`, no `lastSentAt`) stay `UNKNOWN` / `UNFLAGGED` until an external check says otherwise — they are never auto-degraded for sitting idle.

Manual label edits are source `manual`. Nomorobo / other paid lookup APIs are not required.

---

## B4. Suppression

### Always suppress + cancel queue

| Trigger | Source | DNC? |
|---|---|---|
| `suppress_phone` | `MANUAL` / `SMS_STOP` | If markDnc / optOut |
| SMS STOP keywords | `SMS_STOP` | YES + OPTED_OUT |
| Voice callback + `stopOnCallback` | `CALLBACK` | YES |
| Inbox DNC | `INBOX` | YES |
| Inbox CALLBACK | `INBOX` | — |
| Provider give-up (8 attempts) | — | — |

### Allo sync (A → B → C, first match wins)

Runs on tick when `ALLO_API_KEY` set; first run backfills; same `suppressLeadByPhone` path.

| Rule | When | Reason | Notes |
|---|---|---|---|
| **A** | Tag `do_not_call` **or** removal language | `allo_dnc` | In+out; no duration gate; sets DNC |
| **B** | `not_interested` \| `interested` \| `meeting_booked` \| `demo` \| `follow_up_later` | `allo_tag:<tag>` | Never `to_call_back` |
| **C** | Outbound, duration **&gt; 15s**, not voicemail | `allo_conversation` | Ladder below |

**DNC text:**  
`/\b(take me off|remove me|stop calling|don'?t call|do not call|off your list|unsubscribe)\b/i`

**Voicemail ladder (C only):** `VOICEMAIL` result → summary VM language → transcript speaker count (1=VM, ≥2=conversation) → undetermined = **do not suppress**.

Scope: `ALLO_SUPPRESSION_SCOPE` = `global` (default) | `salesglider`.  
Ops: create Allo tag **`do_not_call`**.

---

## B5. Audio

| Rule | HARD? |
|---|---|
| Public hosted URL for Slybroadcast | YES |
| No TTS — real file only | YES |
| In-app recorder: 8 kHz mono 16-bit WAV, 3–60s, ≤10MB | YES for recorder |
| Guidance ≥ ~5s | Soft for URL paste |

---

## B6. Explicitly NOT send gates

- Campaign `ramp` / `newLeadsPerDay`
- Org daily hard cap
- `requireConsent` when false (default)
- `requireFcrRegistration` when false (default)
- `stopOnOptOut` UI flag (STOP always suppresses anyway)
- Missing `ALLO_API_KEY` (sync off; drops still send)
- Allo undetermined voicemail rung (keep contact)

---

# Part C — Operator checklist

### Once per workspace
- [ ] Slybroadcast + Twilio + `NEXT_PUBLIC_APP_URL` + `CRON_SECRET`
- [ ] `DNC_PROJECT_API_TOKEN` (else internal-only scrub)
- [ ] `CALL_FORWARD_TO_E164` → Allo; DND **off**; dial timeout ≥90; lead caller ID preserved
- [ ] `ALLO_API_KEY` + Allo tag `do_not_call`
- [ ] Seeds upserted if canary verification wanted
- [ ] FCR on DIDs before enabling `requireFcrRegistration`

### Per launch
- [ ] Sendable leads scrubbed/imported
- [ ] Audio attached
- [ ] Lines attached; warmup caps understood (20→80)
- [ ] Send days + window accepted under quiet-hours clamp
- [ ] Explicit confirm → `ACTIVE` → `sequencer_drain` once

### Ongoing (healthy)
- [ ] Tick every 5m; `lastDrainAt` moving
- [ ] Receipts / webhooks unlocking multi-step (`dial_status` OK; Pending is not confirmed)
- [ ] `suppression_sync_status` OK if Allo on
- [ ] No surprise FLAGGED / quarantined pool (external CallTracer/Hiya only; unused DIDs not MIXED_HIGH)
- [ ] Callbacks → Allo/Inbox; STOP suppresses
- [ ] Seeds first when configured
- [ ] Volume = line caps only

---

# Part D — Constants

| Constant | Value | Gate? |
|---|---|---|
| Cron interval | 5m | Soft |
| Drain batch default | 25 | Soft |
| Max ACTIVE / tick | 50 | Soft |
| Campaign lease | 4m | Soft |
| Stale CLAIMED reclaim | 15m | Soft |
| Line min gap | 600s | YES |
| Line warmup | 20 → 80 | Cap = YES |
| Max attempts / contact / UTC day | 2 | YES |
| Max provider send attempts | 8 | YES |
| Federal quiet hours | 08–21 | YES |
| Default campaign window | 09–17 Mon–Thu, 09–13 Fri | Soft default |
| Seed inject / campaign / day | 2 | Soft |
| Allo Rule C duration | &gt; 15s | YES for C |
| Call forward timeout floor | 90s | Ops YES |
| Campaign ramp / newLeadsPerDay | ignored | NO |
| Org hard cap | unused | NO |
| Receipt settle | 3m | Soft |
| Receipt batch / tick | 40 | Soft |
| Receipt lookback | 48h | Soft |
| RECEIPT_HEALTH failure rate | ≥30% with ≥10 samples | Soft (flag only; no auto-pause) |
| RECEIPT_HEALTH stale Pending | >30m on ≥10 rows this batch | Soft (flag only; no auto-pause) |

---

# Part E — Change control

1. Update **this file** in the same PR as sequencer/compliance code.  
2. Keep HARD vs soft honest.  
3. Bias Allo undetermined toward **keeping** contacts.  
4. Never reintroduce a campaign-day volume cap without an explicit canon change.  
5. Do not change send path, line pool, or campaign status semantics casually — prefer additive gates.

**Code mirrors:** `src/lib/sequencer/*`, `src/lib/store/scheduled.ts`, `src/lib/compliance/*`, `src/lib/allo/*`, `src/lib/warmup/schedule.ts`, `src/lib/hardening/constants.ts`, `src/app/api/sequencer/tick/route.ts`, Twilio inbound + rvm-status webhooks.
