NOTES = {}

NOTES["vendor-assessment.md"] = """# Vendor assessment

What we ask before buying anything with a model in it.

Short form (most purchases):
- ISO 42001 or equivalent? ([[iso-42001]])
- Are you a provider under the Act for this system? ([[provider-vs-deployer]])
- Documentation available? ([[gpai-obligations]])
- Where is inference run, what is retained, is our data used for training?
- Incident notification commitment?

Long form triggers on high-risk, customer data, or anything customer-facing.

The single most useful question is the training one, and the answer is often buried in a
sub-processor list rather than the contract. [[contract-clauses]].

Vendors increasingly answer these well. The gap now is sub-processors — the vendor is
fine, their embedded model provider is a black box.
"""

NOTES["contract-clauses.md"] = """# Contract clauses

The ones I insist on for anything model-shaped.

- **No training on our data** without separate written consent
- **Documentation**: provider will supply what we need for our own obligations
- **Notification**: material model change, and incidents, within a defined window
- **Audit or evidence**: certification acceptable in lieu
- **IP indemnity** covering training data ([[data-provenance]])
- **Exit**: data deletion, and confirmation

"Material model change" is the hardest to draft. Vendors swap underlying models silently
and it can move behaviour enough to invalidate our evaluations. Language that names the
underlying model and requires notice on substitution is worth the negotiation.

That silent-swap problem is also why [[drift-monitoring]] can't be optional for
third-party systems.
"""

NOTES["shadow-ai.md"] = """# Shadow AI

Systems in use that aren't in [[model-inventory]].

Sources, roughly in order of volume:
- Browser extensions
- Personal accounts on free tiers
- Features switched on inside tools we already own (this is the big one now)
- Scripts someone wrote

The third is genuinely hard. A SaaS vendor ships an AI feature in a product we approved
two years ago, and nothing about our procurement process notices.

What's worked: network-level discovery, an amnesty window, and making [[intake-process]]
fast enough that compliance is easier than evasion. What hasn't: policy statements,
training modules, threatening emails.

Amnesty was uncomfortable to propose and surfaced about forty systems. Worth it.
"""

NOTES["drift-monitoring.md"] = """# Drift monitoring

Post-deployment. Nothing evaluated once stays evaluated ([[evals-overview]]).

What we watch:
- Input distribution vs the evaluation set
- Output distribution, especially rate of the consequential class
- Human override rate ([[human-oversight]]) — the best single signal we have
- Latency and error rates, because degradation often shows here first

For third-party models, add: did the underlying model change? Vendors substitute silently.
[[contract-clauses]] tries to force notice; monitoring is the backstop that catches it
when notice doesn't come.

Thresholds are set per system and are mostly guesses refined by experience. I'd rather a
noisy alert we tune down than a silent one we never set.
"""

NOTES["incident-response.md"] = """# Incident response

An AI incident is not automatically a security incident and the existing runbook didn't
fit, so this exists.

Triggers: harmful output reaching a person, a decision made on clearly wrong grounds,
material unexpected behaviour change, discovered bias, data leakage through a model.

Steps:
1. Contain — usually disable the feature, not the whole system
2. Assess scope: how many affected, over what period
3. Decide notification: regulator, customers, affected people
4. Remediate, retest ([[red-teaming]])
5. [[postmortem-template]]

Serious incident reporting under the Act has defined windows, and the clock starts at
awareness, not at confirmation. That distinction is the thing to drill.

The containment step deserves more design than it usually gets — a kill switch that takes
an engineer forty minutes to find is not a control.
"""

NOTES["postmortem-template.md"] = """# Postmortem template

Blameless, same as any other incident review.

- Timeline, including when we became aware vs when it started
- What the system did, and what it was supposed to do
- Why the pre-deployment evaluation didn't catch it ([[evals-overview]])
- Whether oversight had a chance to catch it ([[human-oversight]])
- Remediation, with owners
- What changes in the process, not just the system

The evaluation question is the one that improves the programme. Most incidents are not
novel failures; they're failures we could have tested for and didn't think to.

Feeds back into [[risk-classification-form]] when a whole class of risk was missed.
"""

NOTES["agent-governance.md"] = """# Agent governance

Where our existing controls fit worst, and the area I'm least confident about.

An agent isn't a model producing an output for review — it's a loop taking actions. The
review point we designed for ([[human-oversight]]) doesn't exist in the same way.

What changes:
- Risk moves from the output to the **tools**. [[tool-permissions]].
- Blast radius is the thing to bound, not accuracy
- Logging has to capture the action sequence, not just input/output ([[audit-trail]])
- Red teaming targets tool use and injection, not prompts ([[red-teaming]])

What I currently require: enumerated tools, least privilege, human confirmation on
anything irreversible or outbound, hard spend and step limits.

Genuinely unresolved: how to evaluate an agent before deployment in a way that predicts
production behaviour. Benchmarks are worse here than anywhere else.
"""

NOTES["tool-permissions.md"] = """# Tool permissions

For agentic systems. The actual control surface — see [[agent-governance]].

Classify every tool:

- **Read, internal** — low
- **Read, external** — medium, exfiltration path
- **Write, reversible** — medium
- **Write, irreversible or outbound** — high, requires confirmation
- **Spend** — high, hard cap regardless

Rules: enumerate explicitly (no wildcard tool access), least privilege per task not per
agent, confirmation on high, and log every invocation with arguments.

Prompt injection makes this a security boundary rather than a UX preference. If the model
can be talked into calling a tool, then the tool's permissions are the only thing standing
between an attacker and the action. That reframing is what finally made this land with
the security team.
"""
