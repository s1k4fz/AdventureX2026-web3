import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import AsyncSessionLocal, get_db
from core.security import CurrentUser, get_current_user, require_admin
from models.policy import Policy
from schemas.policy import (
    PolicyConfirmOpenIn,
    PolicyConfirmMintIn,
    PolicyDetailOut,
    PolicyFundingPlanOut,
    PolicyIntakeAnswersIn,
    PolicyListItemOut,
    PolicyMarksOut,
    PolicyNFTMetadataOut,
    PolicyOracleStatusOut,
    PolicyResearchOut,
    PolicySelectIn,
    RiskQuestionnaireOut,
)
from services import (
    policy_planning_service,
    policy_search_service,
    policy_service,
)

logger = logging.getLogger("lemma.api.policies")

router = APIRouter(prefix="/policies", tags=["policies"])

_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND, detail="policy_not_found"
)


@router.get(
    "/nft/metadata/{token_id}",
    response_model=PolicyNFTMetadataOut,
    response_model_by_alias=True,
)
async def get_policy_nft_metadata(
    token_id: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> PolicyNFTMetadataOut:
    """Public ERC-721 tokenURI target keyed by canonical decimal tokenId."""
    from services.policy_nft_service import get_public_metadata  # noqa: PLC0415

    metadata = await get_public_metadata(db, token_id=token_id)
    if metadata is None:
        raise _NOT_FOUND
    # Active metadata can later become settled; keep public caches bounded.
    response.headers["Cache-Control"] = "public, max-age=300"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return metadata


@router.post(
    "/demo/pending-settlement",
    response_model=PolicyDetailOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_demo_pending_settlement(
    current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> PolicyDetailOut:
    """One-click demo: open a real testnet policy already awaiting settlement.

    Registered above the /{policy_id} routes so "demo" is never parsed as a
    UUID. Slow by nature (2-3 chain txs, ~1 min); the demo button waits.
    """
    from services.policy_demo_service import (  # noqa: PLC0415
        DemoPolicyError,
        create_pending_settlement_policy,
    )

    try:
        policy_id = await create_pending_settlement_policy(db, user_id=current_user.id)
    except DemoPolicyError as exc:
        if exc.code == "busy":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="demo_policy_busy"
            ) from exc
        logger.exception("demo policy creation failed: %s", exc.code)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    detail = await policy_service.get_policy_detail(
        db, user_id=current_user.id, policy_id=policy_id
    )
    if detail is None:
        raise _NOT_FOUND
    return detail


@router.post(
    "/{policy_id}/intake",
    response_model=PolicyDetailOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def submit_intake(
    policy_id: uuid.UUID,
    payload: PolicyIntakeAnswersIn,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PolicyDetailOut:
    answers = {answer.question_id: answer.answer for answer in payload.answers}
    detail = await policy_planning_service.submit_answers(
        db, current_user, policy_id=policy_id, answers=answers
    )
    if detail is None:
        raise _NOT_FOUND
    return detail


@router.get("", response_model=list[PolicyListItemOut])
async def list_policies(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[PolicyListItemOut]:
    return await policy_service.list_policies(
        db, user_id=current_user.id, limit=limit, offset=offset
    )


@router.get("/{policy_id}", response_model=PolicyDetailOut)
async def get_policy(
    policy_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PolicyDetailOut:
    detail = await policy_service.get_policy_detail(
        db, user_id=current_user.id, policy_id=policy_id
    )
    if detail is None:
        raise _NOT_FOUND
    return detail


@router.get("/{policy_id}/questionnaire", response_model=RiskQuestionnaireOut)
async def get_questionnaire(
    policy_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RiskQuestionnaireOut:
    questionnaire = await policy_service.get_questionnaire(
        db, user_id=current_user.id, policy_id=policy_id
    )
    if questionnaire is None:
        raise _NOT_FOUND
    return questionnaire


@router.get(
    "/{policy_id}/research",
    response_model=PolicyResearchOut,
    response_model_by_alias=True,
)
async def get_policy_research(
    policy_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PolicyResearchOut:
    """Auditable market-research snapshot: ranked candidates + selection marks."""
    research = await policy_search_service.get_policy_research(
        db, user_id=current_user.id, policy_id=policy_id
    )
    if research is None:
        raise _NOT_FOUND
    return research


@router.get("/{policy_id}/compose/stream")
async def stream_compose(
    policy_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Deprecated: compose progress streams via Agent Task events only.

    Frontend clients must subscribe to GET /agent-tasks/by-policy/{id} events.
    Kept as an explicit 410 so stale callers fail fast without Redis fan-out.
    """
    async with AsyncSessionLocal() as db:
        detail = await policy_service.get_policy_detail(
            db, user_id=current_user.id, policy_id=policy_id
        )
    if detail is None:
        raise _NOT_FOUND
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail={
            "code": "compose_stream_gone",
            "message": (
                "GET /policies/{id}/compose/stream is removed. "
                "Subscribe to Agent Task events for research/compose progress."
            ),
        },
    )


# =============================================================================
# M2 — 出资端点
# =============================================================================


@router.post(
    "/{policy_id}/select",
    response_model=PolicyFundingPlanOut,
    status_code=status.HTTP_200_OK,
)
async def select_portfolio(
    policy_id: uuid.UUID,
    payload: PolicySelectIn,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PolicyFundingPlanOut:
    """Record portfolio selection, validate positions, return funding plan."""
    from services.policy_chain_service import build_funding_plan  # noqa: PLC0415

    result = await build_funding_plan(
        db,
        user_id=current_user.id,
        policy_id=policy_id,
        portfolio_id=payload.portfolio_id,
        premium_override=payload.premium,
        position_overrides=(
            [
                {"market_ref": o.market_ref, "weight_bps": o.weight_bps}
                for o in payload.position_overrides
            ]
            if payload.position_overrides
            else None
        ),
    )
    if result is None:
        raise _NOT_FOUND
    return result


@router.get("/{policy_id}/marks", response_model=PolicyMarksOut)
async def get_policy_marks(
    policy_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PolicyMarksOut:
    """Batch-fetch Polymarket live prices for policy positions."""
    from services.policy_marks_service import get_policy_marks as fetch_marks  # noqa: PLC0415

    result = await fetch_marks(
        db, user_id=current_user.id, policy_id=policy_id
    )
    if result is None:
        raise _NOT_FOUND
    return result


@router.post(
    "/{policy_id}/confirm-open",
    response_model=PolicyDetailOut,
    status_code=status.HTTP_200_OK,
)
async def confirm_open(
    policy_id: uuid.UUID,
    payload: PolicyConfirmOpenIn,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PolicyDetailOut:
    """Confirm on-chain openPolicy and activate the policy."""
    from services.policy_chain_service import confirm_policy_open  # noqa: PLC0415

    result = await confirm_policy_open(
        db,
        user_id=current_user.id,
        policy_id=policy_id,
        on_chain_policy_id=payload.on_chain_policy_id,
        open_tx=payload.open_tx,
    )
    if result is None:
        raise _NOT_FOUND
    return result


# =============================================================================
# M4 — Policy NFT metadata / confirmation
# =============================================================================


@router.get("/{policy_id}/nft/preview")
async def preview_policy_nft(
    policy_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Return an authenticated, owner-scoped SVG preview."""
    from services.policy_nft_service import get_preview_svg  # noqa: PLC0415

    svg = await get_preview_svg(
        db, user_id=current_user.id, policy_id=policy_id
    )
    if svg is None:
        raise _NOT_FOUND
    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={
            "Cache-Control": "private, max-age=300",
            "Content-Security-Policy": (
                "default-src 'none'; style-src 'unsafe-inline'; sandbox"
            ),
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post(
    "/{policy_id}/nft/confirm-mint",
    response_model=PolicyDetailOut,
    status_code=status.HTTP_200_OK,
)
async def confirm_policy_nft_mint(
    policy_id: uuid.UUID,
    payload: PolicyConfirmMintIn,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PolicyDetailOut:
    """Verify committed ownerOf state and persist an idempotent projection."""
    from services.policy_nft_service import (  # noqa: PLC0415
        confirm_policy_nft_mint as confirm_mint,
    )

    detail = await confirm_mint(
        db,
        user_id=current_user.id,
        policy_id=policy_id,
        nft_token_id=payload.nft_token_id,
        mint_tx=payload.mint_tx,
    )
    if detail is None:
        raise _NOT_FOUND
    return detail


# =============================================================================
# M3 — Oracle 状态查询 (前端可观测性)
# =============================================================================


@router.get(
    "/{policy_id}/oracle-status",
    response_model=PolicyOracleStatusOut,
    response_model_by_alias=True,
)
async def get_oracle_status(
    policy_id: uuid.UUID,
    current_user: CurrentUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PolicyOracleStatusOut:
    """Per-leg oracle assertion state for real-time settlement observability."""
    from services.policy_oracle_status_service import (  # noqa: PLC0415
        OracleStatusError,
        get_oracle_status as fetch_status,
    )

    try:
        result = await fetch_status(db, user_id=current_user.id, policy_id=policy_id)
    except OracleStatusError as exc:
        if exc.code == "not_found":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="policy_not_found",
            ) from exc
        if exc.code == "chain_error":
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="oracle_chain_unavailable",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="oracle_status_unavailable",
        ) from exc
    return PolicyOracleStatusOut(**result)


# =============================================================================
# M3 — 管理端“加速/手动结算”
# =============================================================================


@router.post(
    "/{policy_id}/settle",
    status_code=status.HTTP_202_ACCEPTED,
)
async def trigger_settle(
    policy_id: uuid.UUID,
    _current_user: CurrentUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Enqueue settlement for an active policy (admin/demo accelerator)."""
    policy = await db.get(Policy, policy_id)
    if policy is None:
        raise _NOT_FOUND
    if policy.status != "active":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="policy_not_active",
        )
    # Enqueue the Celery task (>2s work, not in API path)
    from tasks.policy_settle import settle_policy_task  # noqa: PLC0415

    settle_policy_task.delay(str(policy_id))
    return {"status": "queued"}
