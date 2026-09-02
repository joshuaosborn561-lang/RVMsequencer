# RVM Drop Canon

**Source of truth for whether a drop is allowed.**  
If something here conflicts with UI copy, old docs, or chat memory, **this file wins** until it is deliberately updated.

Use it as a compliance checklist: every ACTIVE campaign and every outbound deposit must satisfy the **HARD** rows. Soft rows are defaults or ops preferences — not send blockers unless noted.

---

## 1. Every drop — pre-send gate order

A deposit may leave the sequencer only if all of these pass, in order:

| # | Gate | HARD? | Fail behavior |
|---|---|---|---|
| 1 | Lead not `dnc` | YES | Skip `DNC` |
| 2 | Lead not `OPTED_OUT` | YES | Skip `OPTED_OUT` |
| 3 | Phone not on global suppression | YES | Skip `SUPPRESSED` |
| 4 | Phone not on client exclusion | YES | Skip `SUPPRESSED` |
| 5 | Not halted by prior CALLBACK suppress | YES | Skip `CALLBACK_HALT` |
| 6 | Contact attempts today &lt; max (default **2** UTC day) | YES | Defer ~6h (not permanent) |
| 7 | External DNC scrub (when configured) | YES | Skip `SCRUB_BLOCKED` |
| 8 | Local day in effective `sendDays` | YES | Skip `OUTSIDE_SEND_DAYS` |
| 9 | Local hour in effective send window | YES | Skip `OUTSIDE_SEND_WINDOW` |
| 10 | Consent (only if `requireConsent`) | CONDITIONAL | Skip `MISSING_CONSENT` |
| 11 | Eligible line available (status, cap, gap, reputation, FCR) | YES | Defer `NO_LINE_CAPACITY` |
| 12 | Hosted audio URL on campaign or step | YES | Fail `NO_AUDIO_URL` |

Code: `src/lib/compliance/suppression-order.ts` → scrub → `gates.ts` / `send-window.ts` → `line-picker.ts` → provider.

---

## 2. Quiet hours & windows (legal floor)

**Federal floor (always):** local **08:00–21:00**.

Campaign window is **clamped**, never expanded:

- Effective start = max(campaign start, federal, state)
- Effective end = min(campaign end, federal, state)
- Effective days = intersection with state `allowedDays` when present

**Default campaign schedule:** 09–20, Mon–Fri, `RECIPIENT_LOCAL`.

**Stricter state clamps (when lead state known):**

| State | Rule |
|---|---|
| AL, FL, LA, MA, MS, WY | End 20:00 |
| KY | Start 10:00 |
| NV | 09:00–20:00 |
| NM, OR, SD, TX | Start 09:00 |
| RI | 09:00–18:00 |
| NJ, OK | No Sunday |

Timezone resolution: FIXED schedule TZ → lead timezone → US state TZ → phone NPA.

Code: `src/lib/compliance/quiet-hours.ts`, `src/lib/sequencer/send-window.ts`.

---

## 3. Launch blockers (before ACTIVE)

Cannot set `status: ACTIVE` without all of:

- [ ] ≥1 sendable lead (`!dnc`, not opted out, not SUPPRESSED/SENT)
- [ ] ≥1 line on the campaign
- [ ] Hosted `audioUrl` (campaign or step 1)
- [ ] Non-empty `sendDays`

Runtime auto-pause (not launch): `NO_SEQUENCE_STEP`, `NO_LINES_CONFIGURED`, `PROVIDER_HARD_FAIL`.

---

## 4. Lines / DIDs (volume & health)

### Volume canon (current)

- **Only per-line `dailyCap` limits volume.**
- Campaign `ramp` and `newLeadsPerDay` are **deprecated / ignored** for drain budget.
- Org hard cap is tracked but **not** a send gate.

### Default line warmup

| Day band | Cap (approx) |
|---|---|
| Day 1–2 | **20** (seed) |
| …ramps +25% / 2 days… | |
| Day 15+ | **80** target |

Profile: seed 20, ×1.25 every 2 days, `minWarmDays` 12, `targetCap` 80.  
(`ATTESTED_WARMUP_PROFILE` optional: target 100.)

### Line pick HARD filters

Line must be:

- Status `WARMING` | `HEALTHY` | `DEGRADED` (not PROVISIONING / QUARANTINED / RETIRED)
- `sentToday < dailyCap`
- `reputationLabel !== FLAGGED`
- Min gap elapsed (default **600s** between sends on same DID)
- If `requireFcrRegistration`: `registeredFcr === true`

### Reputation → status

| Signal | Action |
|---|---|
| FLAGGED (CallTracer score≥70 or reports≥10, etc.) | Quarantine |
| MIXED_HIGH | Degrade |
| Low delivery / opt-out / weak callback rates | Soft degrade → can become hard |

Sticky DID preferred when still eligible. Weighted pick is soft preference only.

Code: `src/lib/warmup/schedule.ts`, `src/lib/sequencer/line-picker.ts`, `src/lib/reputation/*`.

---

## 5. Suppression canon

### Always suppress + cancel queued attempts

| Trigger | Source / reason | DNC flag? |
|---|---|---|
| `suppress_phone` / MCP | `MANUAL` (or `SMS_STOP` if optOut) | If `markDnc` |
| SMS STOP / unsubscribe / cancel / end / quit | `SMS_STOP` | YES + OPTED_OUT |
| Voice callback when any campaign `stopOnCallback` | `CALLBACK` | YES |
| Inbox tagged DNC | `INBOX` / `INBOX_DNC` | YES |
| Inbox tagged CALLBACK | `INBOX` / `INBOX_CALLBACK` | — |
| Provider give-up after **8** send attempts | suppress lead | — |

### Allo → RVM sync (Rules A → B → C, first match wins)

Hourly on sequencer tick when `ALLO_API_KEY` is set. First successful run backfills history. Upserts through the same `suppressLeadByPhone` path.

| Rule | When | Reason | Notes |
|---|---|---|---|
| **A** | Tag `do_not_call` **or** removal language in summary/transcript | `allo_dnc` | Inbound + outbound; **no duration gate**; sets DNC |
| **B** | Tags: `not_interested`, `interested`, `meeting_booked`, `demo`, `follow_up_later` | `allo_tag:<tag>` | **Never** `to_call_back`; no duration gate |
| **C** | Outbound, duration **&gt; 15s**, not a voicemail drop | `allo_conversation` | Voicemail ladder below |

**DNC text (Rule A):**  
`/\b(take me off|remove me|stop calling|don'?t call|do not call|off your list|unsubscribe)\b/i`

**Voicemail ladder (Rule C only):**

1. `result === "VOICEMAIL"` → voicemail  
2. Summary matches voicemail / left a message / vm left / went to vm → voicemail  
3. Transcript: 1 distinct speaker → voicemail; ≥2 → conversation  
4. Undetermined → **do not suppress** (bias to keep contact)

Transcript `extend=` only for expensive rungs; verdict cached by call id. Scope: `ALLO_SUPPRESSION_SCOPE` = `global` (default) | `salesglider`.

**Ops prerequisite:** create Allo team tag **`do_not_call`**. Until reps use it, Rule A leans on weak text inference.

Code: `src/lib/allo/*`, MCP `suppression_sync_status`.

---

## 6. Seeds / canaries

| Rule | HARD? |
|---|---|
| Active seeds inject into ACTIVE campaigns with audio | Soft (default 2/campaign/day) |
| Seeds **always claim/send before** regular leads | YES (queue priority) |
| Seeds **skip jitter defer** | YES |
| Seed not yet dropped today (UTC) preferred for inject | Soft |

---

## 7. Sequencer / pacing

| Rule | Value | HARD? |
|---|---|---|
| Only `ACTIVE` campaigns drain | — | YES |
| Max ACTIVE campaigns considered / tick | 50 | Soft concurrency |
| Default drain batch | 25 (API 1–200) | Soft |
| Campaign lease | 4 min | Soft concurrency |
| Stale CLAIMED reclaim | 15 min | Soft |
| Step N&gt;1 needs prior delivery `delivered`\|`sent` | — | YES |
| Humanized jitter | Soft; seeds exempt | Soft |
| Failure backoff | 5m × 2^(n−1), cap 6h; give up at 8 | YES at give-up |
| Tick also runs reputation + Allo sync | Non-blocking | Soft |

---

## 8. Audio

| Rule | HARD? |
|---|---|
| Public hosted audio URL for Slybroadcast `c_url` | YES (launch + send) |
| TTS removed — real file only | YES |
| In-app recorder: 8 kHz mono 16-bit WAV, 3–60s, ≤10MB | YES for recorder path |
| Product guidance: ≥ ~5s for provider | Soft for URL paste |

---

## 9. Callbacks (inbound on campaign DIDs)

| Rule | HARD? |
|---|---|
| Forward target set (`CALL_FORWARD_TO_E164` or settings) | YES for usable callback UX |
| Dial timeout ≥ **90s** (clamped 45–120); Twimlets ~20s drops mid-ring | Ops HARD |
| Env forward overrides UI | — |
| `stopOnCallback` default true → suppress on voice callback | YES when enabled |
| Pass lead caller ID through (do not overwrite with DID) | Ops HARD (Allo screening) |
| Allo DND off on receiving VOIP | Ops HARD (one-ring → VM otherwise) |

Outbound RVM deposit itself does **not** require forward to be configured; callbacks do.

---

## 10. Explicitly NOT send gates

Do **not** treat these as reasons to block a drop:

- Campaign `ramp` / `newLeadsPerDay` (removed as volume gates)
- Org daily hard cap (counted only)
- `requireConsent` when false (default)
- `requireFcrRegistration` when false (default)
- `stopOnOptOut` UI flag (SMS STOP always suppresses regardless)
- Missing Allo API key (sync disabled; drops still send)
- Allo undetermined voicemail ladder rung (keep contact)

---

## 11. Compliance checklist (operator)

Before / during a live campaign:

### Once per workspace
- [ ] Slybroadcast + Twilio + `NEXT_PUBLIC_APP_URL` + `CRON_SECRET`
- [ ] `DNC_PROJECT_API_TOKEN` for national scrub (else internal-only)
- [ ] `CALL_FORWARD_TO_E164` → Allo VOIP; Allo DND **off**; dial timeout ≥90
- [ ] `ALLO_API_KEY` + Allo tag `do_not_call` (suppression sync)
- [ ] Seed/canary numbers upserted if delivery verification wanted
- [ ] Lines FCR-registered before enabling `requireFcrRegistration`

### Per campaign launch
- [ ] Sendable leads scrubbed / imported
- [ ] Audio attached (URL or in-app recorder)
- [ ] Lines attached; per-line caps understood (20→80 warmup)
- [ ] Send days + window set; quiet-hours clamp accepted
- [ ] Explicit confirm before `ACTIVE`
- [ ] `sequencer_drain` once after launch

### Ongoing
- [ ] `suppression_sync_status` healthy (if Allo enabled)
- [ ] Reputation check: no unexpected FLAGGED / quarantined DIDs
- [ ] Callbacks land in Allo / Inbox; STOP texts suppress
- [ ] Seeds still dropping first when configured
- [ ] No campaign-day budget expected — only line caps

---

## 12. Constants quick table

| Constant | Value | Gate? |
|---|---|---|
| Federal quiet hours | 08–21 local | YES |
| Default campaign window | 09–20, Mon–Fri | Soft default |
| Max attempts / contact / UTC day | 2 | YES |
| Line min gap | 600s | YES |
| Line warmup | 20 → 80 / ~12–15d | Cap becomes YES |
| Max provider send attempts | 8 | YES (give-up) |
| Allo Rule C duration | &gt; 15s outbound | YES for C |
| Seed inject / campaign / day | 2 | Soft |
| Call forward timeout floor | 90s | Ops YES |
| Campaign ramp / newLeadsPerDay | ignored | NO |
| Org hard cap | unused | NO |

---

## 13. Change control

When changing send behavior:

1. Update **this file** in the same PR as the code.
2. Keep HARD vs soft labels honest.
3. Prefer additive suppression and bias to **keep** contacts on undetermined Allo voicemail.
4. Never reintroduce a campaign-day volume cap without an explicit canon change.

Primary code mirrors: `src/lib/compliance/*`, `src/lib/sequencer/*`, `src/lib/allo/*`, `src/lib/hardening/constants.ts`, `src/lib/warmup/schedule.ts`.
