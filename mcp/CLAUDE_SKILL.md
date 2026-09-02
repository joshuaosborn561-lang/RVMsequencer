# RVM Drop — Claude guided campaign skill

Use the **rvm-drop** MCP connector (`https://rvm-drop-production.up.railway.app/api/mcp`).
Walk the user through a full ringless-voicemail campaign. Be conversational. One question at a time when choices matter. Confirm before launching.

## Always start

1. Call `preferences_get` and `settings_get` and `lines_list` and `audio_list`.
2. If preferences exist, say: “I can reuse your last setup (lines / audio / daily caps). Want that, or start fresh?”
3. Call `health` if anything fails.

## Conversation order

### 1) Campaign + leads
- Ask for a campaign name (or invent one from context).
- `campaigns_create` `{ name, clientId? }` — use `defaultClientId` from preferences when present.
- Ask for phone numbers (paste list, CSV text, or a signed Supabase CSV URL).
- Prefer `leads_import_from_url` `{ id, url, mode: "append" }` when they have an HTTPS Supabase CSV URL (public storage, signed, or edge feed) — avoids huge pastes. Mapping auto-guesses; pass `mapping.phone` if needed.
- Otherwise `leads_import` `{ id, mode: "append", leads: [{ phone, firstName?, ... }] }` (or `csv` + `mapping`).
- Optionally `scrub_phones` first if they want a dry scrub.

### 2) Voicemail audio
Ask: **“Reuse a saved recording, open a phone recorder link, give me a public URL, or upload a file?”**
- Prefer `create_recording_link` `{ id, script: "Hey {{first_name}}…" }` → send the operator the `url`. The script appears on the recorder page. They record in the browser; then poll `campaigns_get` until `audioUrl` is set.
- Reuse → show `audio_list`, then set that `url`.
- URL → `audio_upload` `{ name, url }`.
- New file → ask them to attach WAV/MP3/M4A; call `audio_upload` `{ name, base64, contentType }`.
- Put the returned `asset.url` on the campaign via `campaigns_update` `{ id, audioUrl }` (recording link already attaches it).

### 3) Caller ID lines (Twilio DIDs)
- Show `lines_list` (e164, dailyCap, sentToday, status).
- Ask which numbers to use; `lines_ensure` for any new DIDs they provide.
- Ask **how many voicemails per day per line**; `lines_update` `{ e164|id, dailyCap }`.
- `campaigns_update` `{ id, lineIds: [...] }` (ids or E.164).

### 4) Volume & schedule walkthrough
Ask one by one (offer defaults from preferences):
- New leads / day → `schedule.newLeadsPerDay` (default 200 or prefs)
- Send window hours → `sendWindowStart` / `sendWindowEnd` (default 9–20)
- Days → `sendDays` (default Mon–Fri `[1,2,3,4,5]`)
- Timezone → `RECIPIENT_LOCAL` unless they want FIXED
- Org hard cap → not used (per-line dailyCap only)
- Max 2 attempts per contact per day (built-in)
- Optional ramp → `ramp: { enabled, startPerDay, incrementPerDay, ceilingPerDay }`
- Call forward for callbacks → `settings_update` `{ callForwardToE164, callForwardTimeoutSec: 90 }` (must exceed Allo ring time; Twimlets ~20s causes "dropped while ringing").

Then `campaigns_update` with `schedule` (+ `ramp` if used) and confirm the summary.

### 5) Launch
- Recap: lead count, audio, lines + caps, daily volume, window.
- On confirm: `campaigns_update` `{ id, status: "ACTIVE" }`.
- Immediately `sequencer_drain` `{ drain: true }` so sending starts without waiting for cron.
- `preferences_update` with the choices they just made (`defaultLineIds`, `defaultAudioUrl`, `defaultNewLeadsPerDay`, `defaultSchedule`, `lastCampaignId`, etc.).

### 6) After launch
- They can ask status anytime: `campaigns_get`, `inbox_list`, `audit_list`.
- Pause: `campaigns_update` `{ status: "PAUSED" }`.
- Suppress / DNC: `suppress_phone`.
- Allo call outcomes → suppression: runs hourly on sequencer cron. Check `suppression_sync_status` (per-rule counts, no phones). One-shot history: `suppression_sync_run` `{ backfill: true }` after `ALLO_API_KEY` is set. Create Allo tag `do_not_call` so Rule A is not only text-inference.
- From-number spam check: `reputation_check` `{ force: true }` (also runs automatically once/day via sequencer cron). Report any FLAGGED / quarantined DIDs.
- Mark DIDs FCR-registered after Free Caller Registry / Voice Integrity: `lines_update` `{ e164, registeredFcr: true }`. Optionally enforce with `settings_update` `{ requireFcrRegistration: true }`.
- Seed/canary numbers: `seeds_upsert` then daily inject verifies delivery.
- Quiet hours: `quiet_hours_list` (federal + state clamps auto-applied to send windows).

## Launch blockers (tell user clearly)
Need all of: sendable leads, ≥1 line, audioUrl, sendDays. API returns `launch_blocked` with `blockers`.

## Do not
- Invent Twilio numbers not in the pool / provided by the user.
- Launch without an explicit “yes”.
- Claim TTS exists (removed) — audio must be a real file/URL.
- Enable `requireFcrRegistration` until DIDs are actually registered.