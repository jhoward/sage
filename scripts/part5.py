NOTES = {}

NOTES["raci.md"] = """# RACI

Who owns what. The [[nist-ai-rmf]] Govern function, made concrete.

- **Business owner** — accountable for the risk decision. Signs [[approval-gates]].
- **Governance (us)** — responsible for the process, the evidence, the classification.
  Not accountable for the decision.
- **Engineering** — responsible for controls and monitoring
- **Legal** — consulted on obligations, accountable for regulatory interpretation
- **Security** — consulted, accountable for [[tool-permissions]] boundaries

The split that matters: we assemble evidence and say whether it's complete. The business
owns the risk. Blur it and we become either a rubber stamp or the department of no, and
both end with people routing around us ([[shadow-ai]]).
"""

NOTES["escalation-path.md"] = """# Escalation path

When something can't be resolved at intake.

1. Governance review (weekly)
2. AI risk forum (monthly, cross-functional)
3. Executive risk committee (quarterly, or on demand for a blocking issue)

Anything that would stop a launch goes to the forum within a week, not on the monthly
cadence. The cadence is for the backlog, not for blockers — I got this wrong initially
and it cost us credibility with two product teams.

[[board-reporting]] draws from the forum's minutes.
"""

NOTES["board-reporting.md"] = """# Board reporting

Quarterly. One page, and it has taken three iterations to get useful.

What they want: are we exposed, is it getting better or worse, what would surprise us.

What we report:
- Inventory count by risk tier, with change since last ([[model-inventory]])
- Systems past due for review
- Incidents, with severity ([[incident-response]])
- Regulatory changes affecting us ([[act-timelines]])
- One thing I'd want them to worry about

The last line is the only part anyone reads closely. Currently it's [[shadow-ai]]
discovery rate, because it's the metric that tells you whether the whole programme is
real.

Do not report percentage-complete against a compliance checklist. It goes up and to the
right regardless of whether risk is actually falling.
"""

NOTES["training-program.md"] = """# Training programme

AI literacy is an Act obligation now, not just good practice.

Three audiences:
- **Everyone**: what our policy is, what shadow AI is, how to use intake
- **Builders**: risk classification, evaluation, documentation
- **Reviewers**: [[human-oversight]], automation bias, when to override

The reviewer training is the one with measurable effect. Override rates moved after it,
which is either the training working or people performing for a watched metric — I can't
fully separate those and I'm honest about that in [[board-reporting]].

Generic vendor e-learning did nothing. Specific, our-systems, our-cases material worked.
"""

NOTES["recruitment-tool-review.md"] = """# Recruitment tool review

The case that set our internal line on Annex III scope. Worth keeping as precedent.

Vendor tool that ranked applicants by CV match. Team's position: it doesn't decide
anything, a recruiter reviews every shortlist, so it's preparatory and out of scope.

Our position: the ranking determines who gets looked at, and recruiters looked at the top
of the list. That materially influences the outcome, so it's high-risk under
[[risk-tiers]] regardless of the nominal human step.

Settled by looking at behaviour: the recruiter reviewed 40 profiles a day and the
below-the-fold rate was near zero. That's the [[human-oversight]] test, and it failed.

Outcome: classified high-risk, [[bias-testing]] required, oversight redesigned so the
reviewer sees a random sample outside the ranking. Uncomfortable conversation, right call,
and it made every subsequent scope argument shorter.
"""

NOTES["data-minimisation.md"] = """# Data minimisation

Where governance and privacy pull against each other.

[[audit-trail]] wants everything logged. Minimisation wants nothing kept that isn't
needed. [[bias-testing]] wants protected characteristics we deliberately don't collect.

Positions I've landed on:
- Log references and hashes, not raw inputs, unless the input *is* the evidence
- Keep protected characteristics only in a separated testing dataset with its own basis
  and its own retention
- Argue retention from investigation need, and write the argument down

None of these are clean. All of them are defensible, which is what the job is most days.
"""

NOTES["open-weight-policy.md"] = """# Open-weight model policy

Do we allow self-hosted open-weight models? Currently: yes, with conditions.

For:
- Data never leaves our environment
- No silent vendor substitution ([[contract-clauses]] problem disappears)
- Full control over versioning

Against:
- We inherit provider-side obligations we'd otherwise push to a vendor
- Safety tuning is ours to maintain, and fine-tuning can strip it ([[red-teaming]])
- Provenance of the base model's training data is opaque and there's no one to indemnify
  us ([[data-provenance]])

Conditions: registered in [[model-inventory]] like anything else, own evaluation, named
owner for the deployment. The tempting failure is treating self-hosted as automatically
lower risk because there's no vendor. It's differently risky, not less.
"""

NOTES["us-state-laws.md"] = """# US state AI laws

Patchwork, and the compliance strategy is convergence rather than per-state.

Recurring themes across states: impact assessments for consequential decisions,
notice to affected people, opt-out or human review rights, bias audits in employment.

Our approach: build to the strictest common denominator, which for us is close to
[[eu-ai-act]] high-risk obligations. Per-state divergence handled in
[[transparency-notices]] wording rather than in system design.

Sector rules still bite separately — anything touching health or credit has its own
regime that doesn't care about this framing at all.

Have not written up NYC bias audit requirements properly. TODO.
"""
