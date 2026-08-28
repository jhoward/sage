NOTES = {}

NOTES["evals-overview.md"] = """# Evaluations

What we require before a high-risk system passes [[approval-gates]].

Four categories, and a system needs something in each:

- **Capability**: does it do the task, measured on data that looks like production
- **Robustness**: does it degrade gracefully on edge cases, adversarial input
- **Fairness**: [[bias-testing]]
- **Safety**: refusals, harmful output, [[red-teaming]]

The recurring failure is evaluating on a benchmark that has nothing to do with the actual
deployment. A model scoring well on a public leaderboard tells you close to nothing about
whether it summarises *our* tickets correctly. Held-out production-shaped data or it
doesn't count.

Second recurring failure: evaluating once. Nothing here is a one-time gate —
[[drift-monitoring]].
"""

NOTES["red-teaming.md"] = """# Red teaming

Structured adversarial testing. Distinct from [[bias-testing]], which is statistical;
this is people trying to make it misbehave.

What we ask for:

- Scope written down before starting, including what's out of scope
- Attempts logged, not just findings — the negative results matter
- Severity rating with a defined scale
- Retest after remediation

For third-party models we mostly rely on the provider's own red teaming and ask for the
report ([[vendor-assessment]]). For anything we fine-tune, we do our own — fine-tuning can
undo safety training, which is not intuitive to most stakeholders and worth stating
explicitly every time.

Agentic systems need a different approach entirely; the attack surface is the tools, not
the prompt. [[agent-governance]].
"""

NOTES["bias-testing.md"] = """# Bias testing

Statistical, on protected characteristics, before deployment and periodically after.

Metrics we use depend on the decision type:

- Selection decisions: selection rate ratio, four-fifths as a screening heuristic not a
  legal standard
- Scoring: calibration by group, error rate balance
- Generation: harder, mostly qualitative plus targeted probes

The measurement problem nobody enjoys: you often don't hold the protected attribute, and
collecting it to test for bias sits awkwardly with data minimisation. Proxy methods exist
and are all contested. We document the limitation rather than pretending.

Four-fifths gets cited as though it's dispositive. It isn't — it's a screening threshold
from a US enforcement context, not a definition of fairness, and definitely not an EU
standard. [[eu-ai-act]] doesn't set a numeric threshold at all.
"""

NOTES["human-oversight.md"] = """# Human oversight

What actually counts, as opposed to what people claim in [[risk-classification-form]].

Meaningful oversight requires the reviewer to:

- Understand the system's capabilities and limits
- Be able to interpret the output, including its uncertainty
- Have the authority and the *time* to override
- Not be subject to automation bias

The last two are where it falls apart in practice. A reviewer with a queue of 300 and a
target handle time is not exercising oversight, they're providing legal cover. If the
override rate is under about 2% I want to know why before I believe the control.

Design patterns that help: surfacing confidence, requiring a reason on override *and* on
approval, sampling audits of approved cases.

Related: [[approval-gates]], [[recruitment-tool-review]].
"""

NOTES["model-cards.md"] = """# Model cards

Our documentation artifact. Serves double duty as Act technical documentation and as the
thing we hand to customers.

Sections:

- Intended purpose, and explicitly out-of-scope uses
- Training/fine-tuning data provenance ([[data-provenance]])
- Evaluation results ([[evals-overview]]) with dates
- Known limitations
- Oversight design ([[human-oversight]])
- Version and change history

The out-of-scope section is the one that saves you. Writing down what the system is *not*
for is how you defend against the eventual "well someone used it for X".

Generated from the inventory record where possible so it can't drift from
[[model-inventory]]. Manual sections are the ones that go stale.
"""

NOTES["data-provenance.md"] = """# Data provenance

Where training and fine-tuning data came from, and whether we had the right to use it.

For our own fine-tuning: source system, extraction date, legal basis, whether it contains
personal data, retention. Straightforward but tedious, and nobody records it at the time,
so it becomes archaeology.

For third-party models: mostly opaque. The [[gpai-obligations]] training-content summary
helps a little but is high-level by design. What we actually rely on is contractual —
[[contract-clauses]].

The copyright question is unsettled and I've stopped trying to have a firm position.
Practically: we require the vendor to indemnify, and we don't build anything whose value
depends on the answer going one particular way.
"""

NOTES["transparency-notices.md"] = """# Transparency notices

Where we have to tell someone they're interacting with, or affected by, an AI system.

Three cases:

- Direct interaction (chat, voice) — disclose unless obvious
- Emotion recognition or biometric categorisation — always disclose
- Synthetic content — mark it machine-readable

Plus the deployer duty to inform people subject to a high-risk system's decisions.

We got the wording wrong the first time by writing it like a legal notice. Nobody read it.
Second version is one sentence at the point of interaction, with a link. Comprehension
beats completeness — a notice nobody reads satisfies the letter and none of the point.

[[eu-ai-act]], [[risk-tiers]].
"""

NOTES["audit-trail.md"] = """# Audit trail

Logging obligations, and what we keep beyond them.

Act minimum for high-risk: automatically generated logs over the system's lifetime,
retained appropriately, enough to trace how an output came about.

What we actually log:

- Input reference (not always the input itself — [[data-minimisation]])
- Model and version
- Output
- Whether a human reviewed, who, and the decision
- Override reason where given

The override reason field is the one that pays for itself. It's the only direct evidence
that [[human-oversight]] is real rather than nominal.

Retention is unresolved between "long enough to investigate" and data minimisation.
Currently 18 months, argued rather than derived.
"""
