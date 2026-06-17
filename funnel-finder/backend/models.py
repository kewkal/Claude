from datetime import datetime
from sqlalchemy import String, Integer, Float, DateTime, ForeignKey, JSON, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.database import Base


class SearchJob(Base):
    __tablename__ = "search_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    query: Mapped[str] = mapped_column(String(500))
    query_type: Mapped[str] = mapped_column(String(50))  # keyword|domain|advertiser|trending
    platform: Mapped[str] = mapped_column(String(20))   # facebook|google|both
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|running|done|failed
    progress: Mapped[int] = mapped_column(Integer, default=0)
    results_count: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    ads: Mapped[list["Ad"]] = relationship("Ad", back_populates="job")


class Ad(Base):
    __tablename__ = "ads"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    job_id: Mapped[int] = mapped_column(Integer, ForeignKey("search_jobs.id"))
    platform: Mapped[str] = mapped_column(String(20))
    external_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    advertiser_name: Mapped[str] = mapped_column(String(500))
    page_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    creative_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    creative_image_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    ad_snapshot_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    landing_page_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    days_active: Mapped[int] = mapped_column(Integer, default=0)
    variation_count: Mapped[int] = mapped_column(Integer, default=1)
    social_proof_score: Mapped[float] = mapped_column(Float, default=0.0)
    winning_score: Mapped[float] = mapped_column(Float, default=0.0)
    first_seen: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    raw_data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    job: Mapped["SearchJob"] = relationship("SearchJob", back_populates="ads")
    landing_page: Mapped["LandingPage | None"] = relationship("LandingPage", back_populates="ad", uselist=False)


class LandingPage(Base):
    __tablename__ = "landing_pages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ad_id: Mapped[int] = mapped_column(Integer, ForeignKey("ads.id"), unique=True)
    url: Mapped[str] = mapped_column(String(1000))
    final_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    screenshot_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    html_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    headline: Mapped[str | None] = mapped_column(String(500), nullable=True)
    subheadline: Mapped[str | None] = mapped_column(String(500), nullable=True)
    ctas: Mapped[list | None] = mapped_column(JSON, nullable=True)
    tech_stack: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    offer_angle: Mapped[str | None] = mapped_column(Text, nullable=True)
    has_vsl: Mapped[bool] = mapped_column(Boolean, default=False)
    analyzed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    ad: Mapped["Ad"] = relationship("Ad", back_populates="landing_page")
