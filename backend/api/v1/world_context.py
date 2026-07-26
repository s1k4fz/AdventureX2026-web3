"""WorldMonitor global-context API (Agent + policy UI)."""

from fastapi import APIRouter, Depends

from core.security import CurrentUser, get_current_user
from schemas.world_context import WorldContextOut

router = APIRouter(prefix="/world-context", tags=["world-context"])


@router.get("", response_model=WorldContextOut)
async def get_world_context(
    current_user: CurrentUser = Depends(get_current_user),
) -> WorldContextOut:
    """Return a normalized WorldMonitor snapshot for Agent/UI consumption."""
    del current_user  # auth gate only
    from ai.worldmonitor import fetch_world_context  # noqa: PLC0415

    ctx = await fetch_world_context()
    return WorldContextOut.model_validate(ctx.model_dump())
