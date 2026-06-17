"""
Score an ad 0–100 based on signals that correlate with profitability.

Scoring breakdown:
  Longevity       0–40 pts  (days active / 90, capped)
  Variation count 0–30 pts  (num variations / 10, capped)
  Social proof    0–20 pts  (normalized engagement score)
  Tech signals    0–10 pts  (VSL +5, funnel builder +3, pixel +2)
"""


def score(
    days_active: int = 0,
    variation_count: int = 1,
    social_proof: float = 0.0,   # 0–1 normalized
    has_vsl: bool = False,
    has_funnel_builder: bool = False,
    has_pixel: bool = False,
) -> float:
    longevity = min(days_active / 90, 1.0) * 40
    variation = min(variation_count / 10, 1.0) * 30
    social = min(social_proof, 1.0) * 20
    tech = (5 if has_vsl else 0) + (3 if has_funnel_builder else 0) + (2 if has_pixel else 0)
    return round(longevity + variation + social + tech, 1)


def score_from_ad(ad_data: dict, landing_page_data: dict | None = None) -> float:
    tech = landing_page_data.get("tech_stack", {}) if landing_page_data else {}
    return score(
        days_active=ad_data.get("days_active", 0),
        variation_count=ad_data.get("variation_count", 1),
        social_proof=ad_data.get("social_proof_score", 0.0),
        has_vsl=tech.get("has_vsl", False),
        has_funnel_builder=bool(tech.get("funnel_builder")),
        has_pixel=tech.get("has_pixel", False),
    )
