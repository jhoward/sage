NOTES = {}

NOTES["eu-ai-act.md"] = """# EU AI Act

The anchor regulation. Risk-tiered rather than sector-specific, which is the thing that
trips people up coming from GDPR — obligations attach to *what the system does*, not to
what industry you're in.

Four tiers: unacceptable (banned), high-risk, limited-risk (transparency only), minimal.
See [[risk-tiers]] for how we actually classify.

GPAI models get their own regime bolted on top — [[gpai-obligations]].

Two things I keep having to re-explain internally:

- Being a *deployer* is not the same as being a *provider*. Most of what we do is
  deployment, but the moment we fine-tune and put our name on it the provider obligations
  can attach. [[provider-vs-deployer]] has the details.
- The timelines are staggered, not a single date. [[act-timelines]].

Penalties scale with turnover, which is what got leadership's attention. Not the most
useful framing for actually doing the work.
"""

NOTES["risk-tiers.md"] = """# Risk tiers

How a system lands in a tier, in the order we actually check:

1. Is it a prohibited practice? (social scoring, untargeted scraping for facial
   recognition, emotion inference in work/education). If yes, stop.
2. Is it in an Annex III area? Employment, education, essential services, law
   enforcement, migration, justice, biometrics, critical infrastructure.
3. Is it a safety component of a product already regulated under Annex I?
4. Otherwise: transparency obligations if it interacts with people or generates content,
   else minimal.

The Annex III step is where almost all our real arguments happen. "Used in recruitment"
is broad and people want to argue their tool is only *adjacent* to a hiring decision.
[[recruitment-tool-review]] is the case that set our internal line.

There's a derogation if the system is narrow/preparatory and doesn't materially influence
the outcome — but you have to document the assessment to rely on it, which people forget.
That documentation requirement is the whole reason [[risk-classification-form]] exists.
"""

NOTES["gpai-obligations.md"] = """# GPAI obligations

General-purpose AI models carry obligations regardless of downstream use:

- Technical documentation, kept current
- Information to downstream providers so they can meet their own obligations
- Copyright policy covering training data
- Public summary of training content

Models with "systemic risk" get more: evaluation, adversarial testing, incident
reporting, cybersecurity. The threshold is compute-based, which is a proxy everyone
agrees is imperfect and nobody has a better version of.

For us the practical question is almost always the *downstream* one: we consume GPAI, so
what we need from a vendor is the documentation that lets us meet our obligations. That's
a procurement problem more than a compliance one — [[vendor-assessment]],
[[contract-clauses]].

Open question I haven't resolved: where the line sits when we fine-tune a GPAI model
heavily enough that we're arguably a provider. [[provider-vs-deployer]] doesn't settle it.
"""

NOTES["provider-vs-deployer.md"] = """# Provider vs deployer

The distinction that drives most of our obligations, and the one people get wrong.

**Provider**: develops or has developed a system and places it on the market under its own
name or trademark.

**Deployer**: uses a system under its own authority.

We're mostly a deployer. Deployer obligations are lighter but not nothing — human
oversight, input data relevance, monitoring, log retention, informing affected people.

You become a provider if you:
- put your name/trademark on a high-risk system
- substantially modify one
- change the intended purpose such that it becomes high-risk

"Substantial modification" is undefined enough to be a running argument. My working line:
fine-tuning on our own data for our own narrow use is *usually* not substantial; changing
what the system is for almost always is.

This matters for [[gpai-obligations]] and for anything in [[model-inventory]] flagged
as fine-tuned.
"""

NOTES["act-timelines.md"] = """# AI Act timelines

Staggered, and people plan against the wrong date constantly.

- Prohibitions: earliest, already in force
- GPAI obligations: next
- High-risk (Annex III): the long tail
- High-risk (Annex I safety components): longest

The practical consequence is that our [[model-inventory]] needs a "which obligations bite
when" column, not just a risk tier. Otherwise everything looks equally urgent and nothing
gets prioritised.

Grandfathering exists for systems already on the market, with conditions. Have not read
this closely enough — TODO.
"""
