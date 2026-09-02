/**
 * Allo suppression rules + voicemail ladder — unit checks for Done criteria.
 */
import assert from "node:assert/strict";
import {
  isRuleCCandidate,
  matchRuleA,
  matchRuleB,
  matchRuleAB,
} from "../src/lib/allo/rules";
import {
  classifyVoicemailCheap,
  classifyVoicemailFromTranscript,
} from "../src/lib/allo/voicemail";
import { normalizeContactPhone } from "../src/lib/allo/sync";
import { maskPhone } from "../src/lib/allo/client";
import type { AlloConversationItem } from "../src/lib/allo/client";

function item(partial: Partial<AlloConversationItem>): AlloConversationItem {
  return {
    id: partial.id ?? "call_test",
    type: "CALL",
    ...partial,
  };
}

// --- Done #2: known voicemail (91s ANSWERED, summary says VM, to_call_back) NOT Rule B/C suppress via tags
{
  const vm = item({
    id: "vm91",
    direction: "OUTBOUND",
    duration: 91,
    result: "ANSWERED",
    summary: "Voicemail left after outbound call",
    tags: ["to_call_back"],
    contact_number: "+15551234567",
  });
  assert.equal(matchRuleAB(vm), null, "to_call_back must not suppress via A/B");
  assert.equal(isRuleCCandidate(vm), true, "duration>15 outbound is C candidate");
  const cheap = classifyVoicemailCheap(vm);
  assert.equal(cheap?.kind, "voicemail", "summary must classify as voicemail (rung 2)");
}

// --- Done #3: short inbound with removal language → Rule A
{
  const dnc = item({
    id: "dnc_in",
    direction: "INBOUND",
    duration: 6,
    result: "ANSWERED",
    summary: null,
    tags: [],
    contact_number: "+15559876543",
    transcript: [
      { source: "EXTERNAL", text: "Please take me off your list and don't call again" },
      { source: "USER", text: "Understood, sorry about that" },
    ],
  });
  const a = matchRuleA(dnc);
  assert.ok(a && a.rule === "allo_dnc", "inbound removal language → allo_dnc");
}

// --- Done #4: not_interested @ 34s → Rule B
{
  const ni = item({
    id: "ni34",
    direction: "OUTBOUND",
    duration: 34,
    result: "ANSWERED",
    tags: ["not_interested"],
    contact_number: "+15551112222",
  });
  const b = matchRuleB(ni);
  assert.ok(b && b.rule === "allo_tag");
  if (b?.rule === "allo_tag") {
    assert.equal(b.tagKey, "not_interested");
    assert.equal(b.reason, "allo_tag:not_interested");
  }
}

// --- Done #5: to_call_back never Rule B regardless of duration
{
  const cb = item({
    direction: "OUTBOUND",
    duration: 120,
    tags: ["to_call_back"],
    summary: "Reached receptionist, will try again",
  });
  assert.equal(matchRuleB(cb), null);
  assert.equal(matchRuleAB(cb), null);
}

// --- Rule A tag do_not_call
{
  const tagged = item({ tags: ["do_not_call"], duration: 3, direction: "INBOUND" });
  assert.equal(matchRuleA(tagged)?.rule, "allo_dnc");
}

// --- Rule B suppress tags
for (const tag of [
  "interested",
  "meeting_booked",
  "demo",
  "follow_up_later",
] as const) {
  const m = matchRuleB(item({ tags: [tag] }));
  assert.ok(m && m.rule === "allo_tag" && m.tagKey === tag, `tag ${tag}`);
}

// --- Voicemail ladder rung 1
{
  const v = classifyVoicemailCheap(item({ result: "VOICEMAIL", summary: "hi" }));
  assert.equal(v?.kind, "voicemail");
  assert.equal(v?.rung, 1);
}

// --- Transcript speakers: 1 = VM, 2 = conversation
{
  assert.equal(
    classifyVoicemailFromTranscript([{ source: "USER", text: "Hey leave a message" }])
      .kind,
    "voicemail",
  );
  assert.equal(
    classifyVoicemailFromTranscript([
      { source: "USER", text: "Hi this is Josh" },
      { source: "EXTERNAL", text: "Oh hey" },
    ]).kind,
    "conversation",
  );
  assert.equal(classifyVoicemailFromTranscript([]).kind, "undetermined");
}

// --- Phone normalize + mask
{
  assert.equal(normalizeContactPhone("+1 (555) 123-4567"), "+15551234567");
  assert.equal(normalizeContactPhone("bad"), null);
  assert.equal(maskPhone("+15551234567"), "***4567");
  assert.ok(!maskPhone("+15551234567").includes("555123"));
}

// --- A beats B when both present
{
  const both = item({
    tags: ["do_not_call", "not_interested"],
    summary: "not interested",
  });
  assert.equal(matchRuleAB(both)?.rule, "allo_dnc");
}

console.log("allo-suppression-rules: ok");
