NOTES = {}

NOTES["nist-ai-rmf.md"] = """# NIST AI RMF

Voluntary, US, and structured as four functions: Govern, Map, Measure, Manage.

Useful because it's process-shaped rather than obligation-shaped — it tells you how to
organise the work, where the [[eu-ai-act]] tells you what the work must produce. We use
RMF as the internal operating model and map its outputs onto Act obligations.
[[framework-mapping]] is that crosswalk.

Govern is the one people skip and the one that actually matters. Without a named owner
and an escalation path, Map/Measure/Manage produce artifacts nobody acts on. See
[[raci]] and [[escalation-path]].

The profiles concept is underused. We should have a written profile per system class
rather than treating every intake the same.
"""

NOTES["iso-42001.md"] = """# ISO 42001

AI management system standard. Certifiable, which is the point — it's the one you can
put in front of a customer's procurement team.

Structure will be familiar from 27001: context, leadership, planning, support, operation,
evaluation, improvement. If you already run an ISMS the incremental cost is lower than it
looks.

Where it earns its keep for us is [[vendor-assessment]] — asking a vendor whether they're
certified is a much shorter conversation than asking them forty questions.

Not a substitute for Act compliance. Certification does not mean conformity.
People conflate these constantly. [[framework-mapping]].
"""

NOTES["framework-mapping.md"] = """# Framework mapping

The crosswalk between [[nist-ai-rmf]], [[iso-42001]] and [[eu-ai-act]] obligations.

Rough shape:

| Act obligation | RMF function | ISO clause |
|---|---|---|
| Risk management system | Map, Measure | 6.1, 8.2 |
| Data governance | Map | 7.5, 8.3 |
| Technical documentation | Govern | 7.5 |
| Logging | Manage | 8.4 |
| Human oversight | Manage | 8.4 |
| Accuracy/robustness/security | Measure | 8.2, 9.1 |

The point of the table isn't the mapping itself, it's avoiding three parallel programmes
producing three sets of near-identical evidence. One artifact, tagged against all three.

Still unmapped: post-market monitoring. [[drift-monitoring]] covers the technical half but
not the reporting half.
"""

NOTES["model-inventory.md"] = """# Model inventory

The foundation. You cannot govern what you cannot enumerate, and every programme that
skipped this ended up doing archaeology eighteen months later.

Fields we actually keep:

- System name, owner, business function
- Provider vs deployer ([[provider-vs-deployer]])
- Risk tier and the reasoning ([[risk-classification-form]])
- Underlying model(s) and version
- Data sources
- Whether it's customer-facing
- Which obligations bite and when ([[act-timelines]])
- Last review date

The hard part is not the schema, it's keeping it current. Anything that relies on people
volunteering entries decays. Ours is fed from [[intake-process]] at the front and
procurement at the side, and we still find things we didn't know about —
[[shadow-ai]].
"""

NOTES["intake-process.md"] = """# Intake process

Front door for anything that touches a model. Deliberately lightweight — a heavy intake
just pushes people around it, which is how you get [[shadow-ai]].

1. Requester fills [[risk-classification-form]] (10 min, mostly dropdowns)
2. Auto-triage: minimal risk → registered and done
3. Anything else → review queue
4. High-risk → full assessment, [[approval-gates]]

The auto-triage step is what makes this survivable. If everything went to a human queue
we'd be the bottleneck and people would route around us within a quarter.

Median time to decision is the metric I care about. Currently sitting around four days,
which is tolerable. Above ten and the process stops being real.
"""

NOTES["risk-classification-form.md"] = """# Risk classification form

Ten questions, mostly closed. The output is a tier plus a written rationale, and the
rationale matters more than the tier — it's the evidence if a derogation is challenged
([[risk-tiers]]).

Questions that do the most work:

- Does it inform a decision about a person? (employment, credit, access, services)
- Can a person's outcome change based on the output?
- Is there meaningful human review before the outcome is applied?
- Does it process biometric or special-category data?
- Is the output shown to someone outside the company?

Q3 is the one people answer optimistically. "A human reviews it" is not meaningful review
if the human sees 300 a day and approves 298. [[human-oversight]] is the note on what
counts.
"""

NOTES["approval-gates.md"] = """# Approval gates

Where a high-risk system has to stop and get a decision.

- **Design**: intended purpose, risk assessment, data plan
- **Pre-deployment**: evaluation results ([[evals-overview]]), documentation
  ([[model-cards]]), oversight design ([[human-oversight]])
- **Post-deployment**: monitoring in place ([[drift-monitoring]]), incident path
  ([[incident-response]])

Gates are approved by the owner named in [[raci]], not by us. We assemble the evidence
and say whether it's complete; the business owns the risk. That split has been the single
most useful thing in keeping the function from becoming a rubber stamp *or* a blocker.

Failed gates should be normal. If nothing ever fails a gate the gate isn't doing anything.
"""
