from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from backend.database import get_db
from backend.models import Ad
from backend.schemas import AdListResponse, AdResponse

router = APIRouter(prefix="/api", tags=["ads"])


@router.get("/ads", response_model=AdListResponse)
async def list_ads(
    job_id: int | None = Query(None),
    platform: str | None = Query(None),
    min_score: float = Query(0),
    sort_by: str = Query("score"),  # score|date|longevity
    page: int = Query(1, ge=1),
    limit: int = Query(20, le=100),
    db: AsyncSession = Depends(get_db),
):
    q = select(Ad).options(selectinload(Ad.landing_page))

    if job_id is not None:
        q = q.where(Ad.job_id == job_id)
    if platform:
        q = q.where(Ad.platform == platform)
    if min_score > 0:
        q = q.where(Ad.winning_score >= min_score)

    order = {
        "score": Ad.winning_score.desc(),
        "date": Ad.created_at.desc(),
        "longevity": Ad.days_active.desc(),
    }.get(sort_by, Ad.winning_score.desc())
    q = q.order_by(order)

    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar_one()

    q = q.offset((page - 1) * limit).limit(limit)
    result = await db.execute(q)
    ads = result.scalars().all()

    return AdListResponse(total=total, page=page, limit=limit, items=list(ads))


@router.get("/ads/{ad_id}", response_model=AdResponse)
async def get_ad(ad_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Ad).options(selectinload(Ad.landing_page)).where(Ad.id == ad_id)
    )
    ad = result.scalar_one_or_none()
    if not ad:
        from fastapi import HTTPException
        raise HTTPException(404, "Ad not found")
    return ad


@router.get("/trending", response_model=AdListResponse)
async def trending(db: AsyncSession = Depends(get_db)):
    q = (
        select(Ad)
        .options(selectinload(Ad.landing_page))
        .order_by(Ad.winning_score.desc())
        .limit(20)
    )
    result = await db.execute(q)
    ads = result.scalars().all()
    return AdListResponse(total=len(ads), page=1, limit=20, items=list(ads))
