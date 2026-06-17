from datetime import datetime
from pydantic import BaseModel


class SearchRequest(BaseModel):
    query: str = ""
    query_type: str = "keyword"  # keyword|domain|advertiser|trending
    platform: str = "both"       # facebook|google|both


class JobResponse(BaseModel):
    id: int
    query: str
    query_type: str
    platform: str
    status: str
    progress: int
    results_count: int
    error: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class LandingPageResponse(BaseModel):
    id: int
    url: str
    final_url: str | None
    screenshot_path: str | None
    headline: str | None
    subheadline: str | None
    ctas: list | None
    tech_stack: dict | None
    offer_angle: str | None
    has_vsl: bool

    model_config = {"from_attributes": True}


class AdResponse(BaseModel):
    id: int
    platform: str
    advertiser_name: str
    creative_text: str | None
    creative_image_url: str | None
    ad_snapshot_url: str | None
    landing_page_url: str | None
    days_active: int
    variation_count: int
    winning_score: float
    first_seen: datetime | None
    last_seen: datetime | None
    landing_page: LandingPageResponse | None = None

    model_config = {"from_attributes": True}


class AdListResponse(BaseModel):
    total: int
    page: int
    limit: int
    items: list[AdResponse]
