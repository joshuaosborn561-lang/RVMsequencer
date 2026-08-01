# Dropseq Research: RVM Sequencer (Smartlead for Voicemail)

Research compiled August 2026 from carrier docs, FCC rulings, provider pricing pages, and outbound deliverability operators. **Do not treat this as legal advice.**

---

## 1. Critical constraint: Twilio ≠ ringless voicemail

**Twilio does not natively support true ringless voicemail (RVM).** Their Programmable Voice product places normal PSTN calls that ring the handset. Carrier voicemail deposit without ringing requires specialized server-to-server / gateway technology that Twilio’s ToS and product design do not provide.

To use Twilio numbers you buy as caller IDs for RVM, you need one of:

| Approach | Ringless? | Who delivers | Notes |
|---|---|---|---|
| **RVM provider + BYOC Twilio** (e.g. Drop Cowboy BYOC) | Yes | Provider’s RVM stack, routed via your Twilio account/numbers | Best match for “I own a bunch of Twilio lines” |
| **RVM provider standard delivery** (VoiceDrop, Slybroadcast, LeadsRain, Drop Co) | Yes | Provider’s carriers | Simpler ops; may not use *your* Twilio DIDs as CID |
| **Twilio AMD voicemail drop** (`MachineDetection=DetectMessageEnd`) | **No** — phone rings | You / Twilio | TOS-compatible; hang up on human or leave message after beep; not true RVM |

**Product implication:** Dropseq is the **sequencer + line reputation layer**. Delivery is a pluggable provider. Default architecture: Twilio for number inventory + optional AMD fallback; VoiceDrop / Drop Cowboy / Slybroadcast for true RVM.

---

## 2. How true RVM works (technical)

Unlike a normal call:

1. Platform prepares audio (WAV/MP3) within carrier format limits.
2. Signaling targets the **carrier voicemail store** (SIP / partner gateways / carrier APIs), not a full handset ring path.
3. Carrier accepts or rejects the deposit. Rejection reasons: landline/VoIP, full inbox, carrier policy, spam filters, regional rules.
4. “Delivered” usually means **accepted by carrier infrastructure**, not guaranteed listen/playback.

This is why DIY “RVM on Twilio alone” is a dead end — you would need carrier deposit agreements Twilio does not expose.

---

## 3. Legal / compliance (product posture)

**There is a federal FCC action on this.** On Nov 21, 2022 the FCC issued Declaratory Ruling **FCC 22-85** finding that ringless voicemail to wireless phones is a “call” under TCPA §227(b)(1)(A)(iii) and requires prior express consent. That is not “no federal ruling.”

Where it gets grey (and why operators disagree):

- How courts apply consent form (oral vs written), marketing vs informational, and platform vs sender liability still varies by circuit/case.
- Enforcement and private TCPA litigation risk are uneven; some businesses treat it as grey and accept risk.
- Statutory damages commonly cited at **$500–$1,500 per violation** when plaintiffs win.

Operator posture in this project: treat RVM more like cold-call risk (grey / uneven enforcement) than email-style 1:1 written consent. Dropseq keeps **DNC + send-window** hard gates; **consent is warn/soft** by default so the sequencer can run cold lists. That is a product choice, not legal advice.

---

## 4. Cost model: 2,000 drops under $100

### Market RVM delivery (static vs AI) — prefer API + cheap over Cowboy

Drop Cowboy is optional/overkill if you only need deposit + API. Cheaper documented APIs:

| Provider | Approx 2026 unit economics | 2,000 drops | API notes |
|---|---|---|---|
| **Slybroadcast** ⭐ default | Monthly **$100 / 2,000**; PAYG ~$0.07 @ 1k pack, ~$0.05 @ 5k | **~$100** on monthly plan | JSON form API (`vmb.json.php`), **`c_callerID`**, status webhooks (`c_dispo_url`). Free API w/ account. |
| **Drop.co** | **$0.05** @ 1k → $0.035 @ 10k → $0.012 @ 100k; no monthly fee | **~$100** at Simple tier | Customer API (`apidocs.drop.co`): create campaign → post records; webhooks. |
| **LeadsRain** | ~**$0.015–$0.02** + ~$0.002 DNC scrub | **~$44** | API at leadsrain.com/apidocs (legacy). Credits expire ~90d. |
| **Topa.io** | AI RVM ~**$0.025**/drop bundled | **~$50** | Webhooks/integrations; less Twilio-CID fleet control. |
| **VoiceDrop** | Static cheaper at scale; AI units pricier | Often >$100 for AI | Modern REST; premium positioning. |
| **Drop Cowboy** | Platform ~$125+ / BYOC wholesale claims | Higher TCO unless huge volume | Full suite; skip unless you need BYOC/dialer CRM. |

### Twilio AMD path (not ringless)

US local outbound ~**$0.014/min** + AMD **$0.0075/answered call**. A ~45–90s attempt ≈ **$0.02–$0.04** attempt cost before TTS. Feasible under $100 for 2k **attempts**, but:

- Phone **rings** (different product / different spam dynamics).
- Humans answered → hangup or talk (compliance + reputation).
- Voicemail hit rate is not 100%.

### AI voice — generate once, reuse (recommended)

If you are **not** regenerating per lead, TTS cost is negligible vs deposit:

- ~30–45s script ≈ **300–500 characters**
- **ElevenLabs Multilingual v2/v3** (highest quality tier they publish for TTS): ~$0.10 / 1k chars → **~$0.03–$0.05 to render the campaign audio once**
- **Professional Voice Clone**: Creator plan ~$22/mo (or Pro ~$99 for more PVC slots + 44.1kHz). Training itself isn’t the expensive part; monthly plan unlocks PVC. One render of your script on that clone is still pennies.
- Then host the WAV/MP3 and pass the same URL to every Drop.co / Slybroadcast send.

Only regenerate when the script/voice changes. Full 1:1 per-lead TTS is optional later and is what blows budgets.

**Winning cost strategy for <$100 / 2k:**

1. **Deposit via Slybroadcast monthly 2k ($100 flat)** or Drop.co PAYG ($0.05 → $100) or LeadsRain (~$44 static).
2. **Static or lightly templated audio** + Cartesia/ElevenLabs clone rendered once (or Part1/Part2 splice) so TTS ≠ budget killer.
3. Skip Drop Cowboy unless you specifically need their BYOC/dialer stack.
4. Full 1:1 AI personalization on VoiceDrop-style metering often **breaks** the $100 target.

### PAYG pick (user preference)

| Rank | Provider | PAYG for ~2k | Why |
|---|---|---|---|
| **1** | **Drop.co** | **$100** ($0.05/drop, no monthly fee) | True PAYG, modern Customer API (`apidocs.drop.co`), webhooks, pacing, post-records for sequencer. Scales to $0.012 @ 100k. |
| **2** | **Slybroadcast PAYG** | ~**$140** if two $70/1k packs; **$250** for 5k pack @ $0.05 | Credits **never expire**; JSON API + `c_callerID`. Slightly worse $/2k than Drop.co unless you buy the 5k pack. |
| **3** | **LeadsRain** | **~$40–44** | Cheapest cents + API, but legacy surface + 90-day credit expiry. |

`myringlessvoicemail.com` advertises **1.85¢** PAYG but **no public developer API** — fine for manual UI, wrong for Dropseq.

**Default adapter for PAYG: Drop.co.** Keep Slybroadcast wired as alt (better if you care most about never-expire credits + explicit caller ID field).

---

## 5. Line warmup (what it actually looks like for Twilio DIDs)

Warmup research is strongest for **outbound dialing reputation**, not a separate “RVM-only reputation DB.” Caller ID / spam labeling still matters for RVM because:

- Analytics engines (Hiya → T-Mobile, TNS → AT&T, First Orion → T-Mobile ecosystem, Verizon Call Filter) score **DIDs** on volume, pattern, short durations, spam reports.
- Recycled DIDs can arrive **pre-burned**.
- STIR/SHAKEN **A-level** attestation is a positive floor; B/C is a handicap.

### Recommended default ramp (campaign target 75–100 RVM/day/line)

Synthesized from LineShield / SIPNEX-style guidance + conservative LienSuite caps (75–100/day/number before analytics scrutiny):

| Phase | Days | Max RVM (or AMD attempts) / line / day | Notes |
|---|---|---|---|
| Seed | 1–3 | 15–25 | Prefer opted-in / high answer likelihood; jitter send times |
| Early | 4–6 | 30–40 | +20–30% every 2–3 days |
| Mid | 7–9 | 45–55 | Monitor labels on AT&T / T-Mobile / Verizon test handsets |
| Late | 10–12 | 60–75 | Pause ramp on any spam label |
| Steady | 13+ | 75–100 (config cap) | Rest days / rotation after spikes |

Also:

- Register numbers **before** first send: Free Caller Registry + Twilio **Voice Integrity** (Trust Hub) + SHAKEN/STIR.
- CNAM where available.
- Local presence matching destination area code when pool allows.
- Never blast a cold DID at full campaign volume day one.
- Space sends (human-like jitter); avoid multi-touch same lead same day from same DID.
- Toll-free can ramp faster (~5–7 days) but loses local presence.

**RVM-specific caveat:** True RVM may generate weaker “answered duration” reputation signals than live answered calls. Warmup policy should optionally include a small share of **live AMD / short human-friendly calls** or inbound-capable DIDs so analytics see normal call behavior — configurable, not mandatory for v1.

---

## 6. Deliverability / “burned line” monitoring

Signals Dropseq should track per DID:

| Signal | Source | Burn heuristic |
|---|---|---|
| Delivery success rate | RVM provider webhooks | Rolling 24–72h success &lt; threshold (e.g. &lt;50% on clean mobiles) |
| Carrier reject codes | Provider | Spike in reject/spam/policy |
| Spam label status | Hiya Reputation API / Twilio Voice Integrity (reputation monitoring) / manual carrier handset checks | `flagged` / `mixed_high` → quarantine |
| Callback rate | Inbound to DID or tracking number | Collapse vs campaign baseline |
| Complaint / opt-out rate | STOP / verbal / webhook | Spike → pause |
| Short-duration AMD hangs | Twilio call events (AMD mode) | Pattern resembling robocall |

**States:** `provisioning` → `warming` → `healthy` → `degraded` → `quarantined` → `retired`.

Auto actions: pause DID on campaign rotation, open remediation checklist (Free Caller Registry / Hiya / TNS / First Orion), replace with warm spare from pool.

---

## 7. Smartlead → Dropseq feature mapping

| Smartlead (email) | Dropseq (RVM) |
|---|---|
| Connected inboxes | Twilio (or BYOC) phone lines |
| Inbox warmup network | Line warmup ramp + optional reputation activity |
| Per-inbox daily send cap | Per-line daily RVM cap |
| Account rotation | Line pool rotation / local presence picker |
| Campaigns + multi-step sequences | Campaigns + RVM steps (delay days, stop on callback/opt-out) |
| Spintax / variants | Script variants + A/B voices |
| Bounce / spam monitoring | Delivery + spam-label + callback health |
| Unibox replies | Callback / SMS reply inbox (phase 2) |
| Lead import + variables | Lead CSV + `{first_name}` etc. for TTS |

Topa today is closer to “RVM as a channel bolt-on to Instantly/Smartlead.” Dropseq’s wedge: **own the line pool, warmup, and deliverability** the way Smartlead owns mailboxes — not just fire API drops.

---

## 8. Topa.io snapshot (user’s current tool)

- AI voicemails delivered to voicemail service; stock voices + clone-your-voice; Instantly/Smartlead/webhook integrations.
- Credits: enrichment ~1–1.5; AI voicemail advertised **0.5 credit** on homepage ($0.05/credit → ~$0.025/drop).
- Daily voicemail limits on auto campaigns; Part1 (variable) + Part2 (pre-generated) audio pattern for personalization efficiency.
- Does **not** appear to give you Smartlead-grade multi-line warmup / burned-line fleet control over **your** Twilio DIDs.

---

## 9. Recommended Dropseq architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Dropseq Control Plane                                      │
│  Campaigns · Sequences · Leads · Consent/DNC · Schedules    │
├─────────────────────────────────────────────────────────────┤
│  Line Manager                                               │
│  Twilio sync · Warmup engine · Caps · Rotation · Health     │
├──────────────────┬──────────────────────┬───────────────────┤
│  Voice Engine    │  Delivery Adapters   │  Reputation       │
│  Cartesia /      │  VoiceDrop           │  Voice Integrity  │
│  ElevenLabs /    │  DropCowboy (BYOC)   │  Hiya (optional)  │
│  Upload WAV      │  Slybroadcast        │  Webhook metrics  │
│                  │  Twilio AMD fallback │  Handset probes   │
└──────────────────┴──────────────────────┴───────────────────┘
```

**v1 build order**

1. Domain model + provider interfaces (this scaffold)
2. Twilio line sync + warmup scheduler + daily caps
3. Voice: stock + clone via Cartesia/ElevenLabs; audio asset store
4. One RVM adapter (VoiceDrop **or** Drop Cowboy BYOC) + webhook ingest
5. Campaign sequencer (queue, timezone, rotation, stop conditions)
6. Deliverability dashboard + quarantine automation
7. AMD fallback mode for testing / markets without RVM

---

## 10. Locked decisions

1. **Delivery: Drop.co PAYG**
2. **Voice: ElevenLabs Multilingual / PVC, generate once**
3. **Send windows: recipient-local** via Google libphonenumber timezone prefix map (NPA → IANA)
4. **DNC: The DNC Project API** + internal suppression list (hard gate)
5. **Consent: soft/warn** — cold-call posture

Wired APIs: `POST /api/scrub`, `GET /api/timezone`, `POST /api/voice/render`, `POST /api/sequencer/tick`.

---

## Sources (primary)

- FCC 22-85 / FCC press DOC-389372A1 — RVM = TCPA call, consent required
- Twilio docs: Answering Machine Detection, Voice pricing US, Voice Integrity
- Voice.ai hub: Twilio does not support native RVM
- Drop Cowboy: BYOC Twilio RVM explainers + developer API
- VoiceDrop: 2026 RVM cost comparison + API
- Topa.io homepage + help center credit/billing articles
- LineShield (2026): DID warmup schedules; LienSuite calling deliverability guide
- ElevenLabs / Cartesia public pricing pages
- Smartlead API docs: email accounts, warmup, campaign setup
- Hiya developer: number reputation status values
