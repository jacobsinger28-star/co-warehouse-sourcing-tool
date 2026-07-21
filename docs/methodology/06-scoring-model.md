# The Scoring Model

Additive and explainable, never a black box. Each signal contributes points, the
score is the sum, and the bands are fixed. Because the model is additive, you can
always answer the only question a principal cares about: why is this one near the
top? You point at the signals that fired.

---

## The bands

| Band | Score | Action |
|---|---|---|
| Priority | 50+ | Direct outreach this week |
| Watch | 25 to 49 | Mail sequence, monitor for score increases |
| Background | under 25 | In the universe, no proactive outreach |

The bands are deliberately simple. A property does not need a high-precision score
to belong on this week's call list. It needs enough signal to justify a credible
first touch, and the band tells you that at a glance.

---

## A worked example (synthetic)

A manufactured-housing park, owned 20+ years by an individual:

- Last sale 20+ years ago: 20 + 10 = 30
- Individual owner: 15
- Subtotal: 45 -> Watch

Now add one public fact, tax delinquency:

- Property tax delinquent: 25
- New total: 70 -> Priority

That single delinquency flag moved the owner from "motivation is possible" to
"call this week," and you can see exactly why. Tenure and individual ownership
alone (45) correctly sit in Watch: motivation is plausible, not confirmed.

This is the whole point of an additive model. The score is not a verdict, it is a
reading you can defend line by line.

---

## Tuning it to your strategy

- **Reweight from your wins.** After your first outreach wave, look at which
  signals the owners who actually engaged had in common, and push those weights
  up. The signals that predicted real conversations are the ones worth trusting.
- **Demote thin-coverage signals.** If a signal is only available in 20% of your
  counties (raw code violations are the classic case), keep its weight low so a
  missing value does not silently penalize a good target.
- **Never let the score replace the human.** The score ranks the universe so you
  spend your hours on the most likely owners first. The decision to mail or dial
  is still yours, after the resolution chain and the review gate.

The model is a flashlight, not a judge. It points you at the owners worth a
credible call this quarter, in an order you can explain.
