# Product Scoring Rubric — "Is this worth running organically on IG/FB?"

This rubric turns the two SOPs into one number so products can be ranked against each other.
The SOPs decide *what* to judge; this file decides *how much each thing weighs*. Tune the weights here as
real results come in (see "Calibration" at the bottom).

## Step 0 — Kill Gate (from Hook Archetype SOP, Section 2)
Run G1–G4 first. **Any fail = KILL. Score is 0. Stop.** Do not score killed products "just to see."

| Gate | Kill if |
|---|---|
| G1 Payload | No visible extraction or transformation |
| G2 Zero explanation | Not understandable sound-off in 3s |
| G3 Claim honesty | The demo would be a fabrication, not an amplification |
| G4 Price | Retail ≥ $25, or margin < 3x |

G5 (incumbent) never kills — it feeds the score below.

**Price from AliExpress:** landed cost = real unit cost + shipping. Pass if `3 × landed ≤ $25`. Watch for Welcome Deal
prices (see `docs/aliexpress-scraping.md`).

**If the price couldn't be scraped:** estimate landed cost from comparable AliExpress products. Mark G4 `EST` and
give the verdict as usual, flagged **(price pending)**. Use the **NEEDS DATA** verdict only when the estimate is a coin
flip, meaning it could land on either side of $8.30.

## Step 1 — Score (100 points)

### A. Hook potential — 45 pts (Hook Archetype SOP)
| Criterion | Pts | How to score |
|---|---|---|
| **Archetype fit** | 20 | Rank-1 archetype at **high** confidence = 20, **med** = 13, **low** = 6. If Rank 1 is #9 Costume Interrupt (the fallback), cap at 8. |
| **Montage depth** (surface/context count) | 10 | 1 context = 0 · 2 = 3 · 3 = 5 · 4 = 7 · 5–6 = 9 · 7+ = 10 |
| **Mechanic** | 5 | Extraction = 5 · Transformation = 3 |
| **Enablers** | 6 | 2 pts each: mockable incumbent (G5), portable+instant, distress carrier |
| **Claim safety margin** | 4 | Plainly real, nothing to exaggerate = 4 · exaggerated-but-real = 2 · borderline (passed G3 narrowly) = 0 |

### B. Copy potential — 30 pts (Copy Framework)
| Criterion | Pts | How to score |
|---|---|---|
| **Specific customer** | 6 | Can you name the buyer in one line (age, situation, role)? Sharp = 6, broad = 3, "everyone" = 0 |
| **Existing desire / fear** | 8 | Is there a pain that *already* keeps them up at night? Acute + common = 8, real but mild = 4, has to be invented = 0 (Copy can't create desire) |
| **Headline strength** | 8 | Best headline you can write passes all 4 Headline Test questions = 8, 3 of 4 = 5, 2 or fewer = 2 |
| **Proof available** | 4 | Hard numbers/specs + reviews + visible demo = 4, two of those = 2, one = 1 |
| **Modern selling points** | 4 | 1 pt each it can honestly claim: convenience, speed, time-saving, quality at a fair price |

### C. Market signal — 15 pts (Kalodata data)
| Criterion | Pts | How to score |
|---|---|---|
| **Momentum** | 8 | Revenue/units growing period-over-period = 8, flat = 4, declining = 0. Proven $20k+ sales but trend unknown (the default for AliExpress-link batches) = 6. Nothing known = 3 |
| **Room to enter** | 4 | Proven sales but few creators/videos for the revenue (under-content'd) = 4, average = 2, flooded = 0. Unknown = 2 |
| **Unit economics** | 3 | Retail $15–25 with clear 3x+ = 3, under $15 (thin per-order profit) = 1, unknown = 1 |

### D. Organic IG/FB fit — 10 pts
| Criterion | Pts | How to score |
|---|---|---|
| **Shareability** | 5 | Would someone DM this to a specific person ("you NEED this", "this is so you")? Strong = 5, maybe = 2, no = 0. (SOP metric: shares + DM-sends, not likes) |
| **Audience overlap with IG/FB** | 5 | Buyer skews 25–55, homeowner, pet owner, parent — the core FB/IG Reels audience = 5; mixed = 3; skews Gen-Z/TikTok-only = 1 |

### E. Saturation modifier
Apply the current modifiers from `rubric/saturation.md` (e.g. hair −10, cleaning −5, yard/pet +5). Clamp the final score to 0–100.

## Step 2 — Verdict
| Score | Verdict | Meaning |
|---|---|---|
| Failed gate | **KILL** | Do not make content. |
| 80–100 | **RUN** | Build the content package this week. |
| 65–79 | **TEST** | Make one video on the Rank-1 archetype; run the 10–14 day kill rule. |
| 50–64 | **BENCH** | Park it. Revisit if Kalodata momentum spikes. |
| < 50 | **PASS** | Survived the gate but isn't worth the production slot. |
| G4 unknown | **NEEDS DATA** | Get price/landed cost, then re-score. |

**Tie-breaker:** If two products score within 3 points, prefer the one whose Rank-1 archetype is #8 The Intervention
(SOP default), then prefer extraction over transformation, then the higher Market Signal.

## Calibration
After a product has run 10–14 days, record results in its file (`## Results`: views, shares, DM-sends, saves, sales).
When five or more products have results, compare score vs. actual shares/DM-sends and adjust the weights above.
Log each weight change in `rubric/CHANGELOG.md` with the date and why.
