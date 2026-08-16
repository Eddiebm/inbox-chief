# LLM on call — product review

Discussion capture for Eddie to review. Goal: let a patron call Inbox Chief and ask an LLM a question, grounded in their inbox (and optionally general knowledge), without turning the product into a generic “call ChatGPT” app.

**Status:** Proposal / open decisions. Related voice work (compose/send, calendar, address book) is in progress separately.

---

## Vision

Patron dials their Inbox Chief number and asks a question out loud. The assistant answers using:

1. **Inbox-grounded context** — what they have mail about, who wrote, what needs attention, drafts, follow-ups (tenant-scoped tools already on the call path).
2. **Optional general knowledge** — when the question is not mail-specific (definitions, how-to, light reasoning), via a chosen LLM provider.

The call remains an **accessibility-first inbox companion**. LLM Q&A is a capability on that path, not a standalone voice chatbot product.

Constraints that do not change:

- Never auto-send email from a call.
- Do not invent mail content; if tools lack data, say so.
- Draft + confirm for any outbound action (compose/send when that ships).

---

## Claude vs ChatGPT vs Gemini

| Dimension | Claude (Anthropic) | ChatGPT (OpenAI) | Gemini (Google) |
| --------- | ------------------ | ---------------- | --------------- |
| Strengths | Careful, instruction-following; strong for grounded / policy-heavy answers | Broad brand recognition; strong general Q&A; wide tool ecosystem | Strong multimodal / Google stack fit; competitive latency/cost in some tiers |
| Risks | Less “household name” for some patrons | Expectation of unrestricted ChatGPT behavior; brand confusion with ChatGPT apps | Overlap with Gmail ecosystem may raise “Google reading my mail” concerns if not disclosed clearly |
| Fit for Inbox Chief | Good default for cautious, inbox-safe answers | Good if patrons ask for “ChatGPT”-style general help | Worth evaluating if Gmail-adjacent features deepen |

**Cost, latency, and quality** will need a short bake-off on real call transcripts (briefing + “what does this mean?” + general questions). Provider choice for MVP should be driven by that, not by offering three menus on day one.

---

## Recommendation (MVP)

- **One default model** for MVP. No Claude / ChatGPT / Gemini picker in the call UX or settings for the first ship.
- Name the capability in product language (“ask a question,” “explain this email”), not “pick your LLM.”
- **Pro (or later):** optional multi-provider choice is fine as a differentiator — after trust, cost controls, and privacy copy are solid.
- Keep voice tier (Standard / Premium TTS) separate from LLM provider; do not conflate them in UI.

---

## Trust rules

Non-negotiable for any LLM-on-call ship:

1. **Never auto-send.** Voice may draft; sending requires explicit confirm (and app confirmation path where we already require it).
2. **Draft + confirm** for compose, replies, and any action that leaves the tenant’s mailbox.
3. **Don’t invent mail.** LLM answers about the inbox must be grounded in tool results; if unknown, say unknown. No fabricated senders, subjects, or bodies.
4. **Disclose providers** in privacy / terms: which model vendors may process call audio transcripts or question text, and that mail context used for answers stays tenant-scoped and is not used to train third-party models unless a vendor contract says otherwise (align copy with actual API settings).
5. **Scope the prompt.** System instructions: inbox tools first when the question is about mail; general knowledge only when appropriate; never claim to have sent mail from the call.

---

## Suggested MVP call phrases

Examples the assistant should recognize (exact wording can vary):

- “What does this email mean?” / “Explain that last one in plain language.”
- “Do I need to reply to this?” / “What’s the ask?”
- “Summarize what Jordan wants.”
- “What’s the deadline in that message?”
- “Quick question — what’s [general topic]?” (optional general knowledge)
- “Don’t send anything — just explain.”

Out of MVP scope until compose/send lands: “Reply that I’ll call them tomorrow and send it.”

---

## Positioning vs generic “call ChatGPT” apps

| Generic voice LLM apps | Inbox Chief |
| ---------------------- | ----------- |
| Open-ended chatbot on a phone number | Phone path into **your** Primary inbox |
| No (or weak) mail identity | Caller matched to `CallInIdentity`; tenant-scoped tools |
| Send / act with weak controls | No send from call; draft + confirm |
| “Talk to ChatGPT” brand | “Call your inbox” brand; LLM is assistive, not the product name |

Marketing line of thought: *Call in, hear what’s new, ask what it means — without handing your mailbox to a random chatbot.*

---

## Related work (in progress)

Separate agent workstreams (do not block this review doc):

- **Voice compose / send** — draft on call, confirm before send.
- **Calendar** — speak / query schedule from the call path.
- **Address book** — resolve people by name for read / draft context.

LLM-on-call should assume those land with the same trust rules (especially compose/send).

---

## Open decisions (Eddie markup)

Mark each: **yes / no / later / need bake-off**.

- [ ] Ship general-knowledge Q&A on call for MVP, or inbox-grounded explanations only first?
- [ ] Default provider for MVP: Claude / OpenAI / Gemini / bake-off first?
- [ ] Pro multi-provider settings: which plan gate, and when?
- [ ] Should the assistant disclose which model answered (“According to…”) or stay silent?
- [ ] Cap free-form LLM turns per call / per month for cost control?
- [ ] Log question text + model response for support/debug? Retention and privacy implications?
- [ ] Any patron-facing name for the feature (e.g. “Ask,” “Explain”) vs no special name?
- [ ] Align privacy/terms update with this feature before GA, or with Pro multi-provider?

---

## Notes for engineering (when building)

- Reuse existing VAPI tool + webhook path; add a narrow “answer_question” (or similar) tool with strict system prompt and mail grounding.
- Prefer tool results over model memory for any claim about the patron’s mail.
- Meter token cost separately from voice minutes if overage becomes material.
- Privacy page and Settings copy must list the default provider before GA.

---

*Document for review only. Not committed as product commitment until Eddie decides.*
