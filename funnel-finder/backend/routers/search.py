from datetime import datetime
from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from backend.database import get_db
from backend.models import SearchJob, Ad, LandingPage
from backend.schemas import SearchRequest, JobResponse
from backend import scrapers
from backend.analyzers import tech_stack as ts, copy_extractor as ce, winning_score as ws

router = APIRouter(prefix="/api", tags=["search"])


@router.post("/search", response_model=JobResponse)
async def create_search(req: SearchRequest, bg: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    job = SearchJob(
        query=req.query,
        query_type=req.query_type,
        platform=req.platform,
        status="pending",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    bg.add_task(_run_job, job.id, req)
    return job


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: int, db: AsyncSession = Depends(get_db)):
    job = await db.get(SearchJob, job_id)
    if not job:
        from fastapi import HTTPException
        raise HTTPException(404, "Job not found")
    return job


async def _run_job(job_id: int, req: SearchRequest):
    from backend.database import AsyncSessionLocal
    from backend.scrapers import facebook as fb, google as gg
    from backend.scrapers import landing_page as lp

    async with AsyncSessionLocal() as db:
        job = await db.get(SearchJob, job_id)
        job.status = "running"
        await db.commit()

        try:
            raw_ads: list[dict] = []

            # Collect from platforms
            if req.platform in ("facebook", "both"):
                try:
                    if req.query_type == "keyword":
                        raw_ads += await fb.search_by_keyword(req.query)
                    elif req.query_type == "domain":
                        raw_ads += await fb.search_by_domain(req.query)
                    elif req.query_type == "advertiser":
                        raw_ads += await fb.search_by_advertiser(req.query)
                    elif req.query_type == "trending":
                        raw_ads += await fb.get_trending()
                except Exception as e:
                    if "FB_ACCESS_TOKEN" in str(e):
                        job.error = str(e)

            if req.platform in ("google", "both"):
                try:
                    if req.query_type == "keyword":
                        raw_ads += await gg.search_by_keyword(req.query)
                    elif req.query_type == "domain":
                        raw_ads += await gg.search_by_domain(req.query)
                    elif req.query_type == "advertiser":
                        raw_ads += await gg.search_by_advertiser(req.query)
                    elif req.query_type == "trending":
                        raw_ads += await gg.get_trending()
                except Exception as e:
                    pass

            total = len(raw_ads)
            for i, raw in enumerate(raw_ads):
                job.progress = int((i / max(total, 1)) * 90)
                await db.commit()

                ad = Ad(
                    job_id=job.id,
                    platform=raw["platform"],
                    external_id=raw.get("external_id"),
                    advertiser_name=raw["advertiser_name"],
                    page_id=raw.get("page_id"),
                    creative_text=raw.get("creative_text"),
                    creative_image_url=raw.get("creative_image_url"),
                    ad_snapshot_url=raw.get("ad_snapshot_url"),
                    landing_page_url=raw.get("landing_page_url"),
                    days_active=raw.get("days_active", 0),
                    variation_count=raw.get("variation_count", 1),
                    social_proof_score=0.0,
                    winning_score=ws.score_from_ad(raw),
                    first_seen=raw.get("first_seen"),
                    last_seen=raw.get("last_seen"),
                    raw_data=raw.get("raw_data"),
                )
                db.add(ad)
                await db.flush()

                # Analyze landing page if URL available
                lp_url = raw.get("landing_page_url")
                if lp_url:
                    try:
                        page_result = await lp.analyze(lp_url)
                        html = page_result.get("html", "")
                        tech = ts.detect(html) if html else {}
                        copy = ce.extract(html) if html else {}

                        landing = LandingPage(
                            ad_id=ad.id,
                            url=lp_url,
                            final_url=page_result.get("final_url"),
                            screenshot_path=page_result.get("screenshot_path"),
                            html_path=page_result.get("html_path"),
                            headline=copy.get("headline"),
                            subheadline=copy.get("subheadline"),
                            ctas=copy.get("ctas"),
                            tech_stack=tech,
                            offer_angle=copy.get("offer_angle"),
                            has_vsl=tech.get("has_vsl", False),
                        )
                        db.add(landing)
                        await db.flush()

                        # Update winning score with landing page signals
                        ad.winning_score = ws.score_from_ad(raw, {"tech_stack": tech})
                    except Exception:
                        pass

            job.status = "done"
            job.progress = 100
            job.results_count = total
            job.completed_at = datetime.utcnow()
            await db.commit()

        except Exception as e:
            job.status = "failed"
            job.error = str(e)
            await db.commit()
