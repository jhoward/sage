# Rougher notes: meetings, half-thoughts, open questions. Real vaults are mostly these.
NOTES = {}

NOTES["meetings/2026-08-11-ai-risk-forum.md"] = """# AI risk forum — 11 Aug

Present: legal, security, two product owners, us.

- Recruitment tool: closed out, high-risk stands. [[recruitment-tool-review]]
- Shadow AI amnesty results — 41 systems, 6 need real review. Higher than I guessed.
  [[shadow-ai]]
- Agent pilot in support wants to go live in six weeks. Nothing in
  [[agent-governance]] is ready for that timeline. Flagged, not resolved.
- Legal raised the silent model substitution problem again. [[contract-clauses]].

Action: draft tool permission tiers before next forum → became [[tool-permissions]]
"""

NOTES["meetings/2026-08-18-vendor-review.md"] = """# Vendor review — 18 Aug

Three vendors, short form ([[vendor-assessment]]).

1. Doc summarisation — fine. ISO cert, no training on our data, clean.
2. Support triage — training clause is bad, sub-processor is a black box. Pushing back.
3. "AI-powered" analytics — turns out to be regression from 2019. Not in scope, registered
   anyway for the [[model-inventory]].

Third one is the pattern I keep seeing. Half of what's sold as AI isn't, and a quarter of
what isn't sold as AI is.
"""

NOTES["open-questions.md"] = """# Open questions

Running list. Things I don't have a position on yet.

- Where does fine-tuning make us a provider? [[provider-vs-deployer]] doesn't settle it
  and I keep deferring.
- How do you evaluate an agent pre-deployment in a way that predicts production?
  [[agent-governance]]
- Retention period for [[audit-trail]] — 18 months is argued, not derived
- Is certification ([[iso-42001]]) worth the cost for us, or is it a sales artifact?
- What's the right override-rate threshold before I stop believing
  [[human-oversight]] is real? Currently using 2% as a smell test with no basis.
- Do we need a separate policy for evaluation data, or does [[data-provenance]] cover it?
"""

NOTES["metrics.md"] = """# Programme metrics

What I'd defend as actually meaning something.

Good:
- Median intake time to decision ([[intake-process]]) — proxy for whether people route
  around us
- Shadow AI discovery rate ([[shadow-ai]]) — proxy for whether the front door works
- Override rate per system ([[human-oversight]]) — proxy for whether oversight is real
- Gate failure rate ([[approval-gates]]) — if zero, gates are theatre

Bad, but requested:
- % systems "compliant" — goes up regardless of risk
- Number of policies published — measures writing, not governance
- Training completion — measures clicking

[[board-reporting]] carries two of the good ones and, unavoidably, one of the bad.
"""

NOTES["policy-draft.md"] = """# Internal AI policy — draft

Still a draft. Trying to keep it under two pages, which is the only thing that makes a
policy get read.

Sections:
1. Scope — what counts as an AI system here
2. Register everything ([[intake-process]])
3. Risk tiers and what each requires ([[risk-tiers]])
4. Prohibited uses — short, absolute list
5. Data rules ([[data-provenance]], [[data-minimisation]])
6. Human oversight expectations ([[human-oversight]])
7. Incidents ([[incident-response]])

The prohibited list is the only part with hard edges. Everything else is "assess and
document", which is honest but reads as toothless. Considering adding worked examples
instead of tightening the language — [[policy-examples]] doesn't exist yet.
"""

NOTES["reading/act-recitals.md"] = """# Act recitals worth remembering

The recitals carry the interpretation and nobody reads them.

- Purpose-based scope: same technology, different purpose, different tier
- "Substantial modification" gets colour here that the articles don't give
  ([[provider-vs-deployer]])
- Human oversight recital is explicit that the person must be *able* to override, which
  supports the reading in [[human-oversight]]
- Research exemption is narrower than people hope

Not a legal source on its own but useful when arguing scope internally.
"""

NOTES["reading/nist-profiles.md"] = """# NIST profiles

Underused part of [[nist-ai-rmf]]. A profile is the framework tailored to a use case or
sector.

We should have one per system class — customer-facing generative, internal decision
support, agentic — rather than treating every intake identically. Would cut
[[intake-process]] time and make [[risk-classification-form]] shorter per class.

Haven't done it. Keeps losing to more urgent work, which is probably the wrong call given
it's a force multiplier on everything else.
"""

NOTES["glossary.md"] = """# Glossary

Terms people use to mean different things, which causes half our arguments.

- **AI system** — Act definition is broad; includes plenty of things people call
  "just statistics". [[eu-ai-act]]
- **GPAI** — general-purpose model, obligations attach to the model. [[gpai-obligations]]
- **Provider / deployer** — [[provider-vs-deployer]]
- **High-risk** — a defined term, not a judgement. [[risk-tiers]]
- **Substantial modification** — undefined enough to argue about
- **Meaningful human oversight** — [[human-oversight]]
- **Agentic** — no settled definition; I use "takes actions in a loop without per-step
  approval". [[agent-governance]]
"""
