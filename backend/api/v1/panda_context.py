"""PandaAI financial-context API (Agent + policy UI)."""

from fastapi import APIRouter, Depends, Query

from core.security import CurrentUser, get_current_user
from schemas.panda_context import PandaContextOut, PandaStatusOut

router = APIRouter(prefix="/panda-context", tags=["panda-context"])


@router.get("/status", response_model=PandaStatusOut)
async def get_panda_status(
    current_user: CurrentUser = Depends(get_current_user),
) -> PandaStatusOut:
    """Return enablement + available module catalog for Settings UI."""
    del current_user
    from ai.pandaai import pandaai_status  # noqa: PLC0415

    return PandaStatusOut.from_status(pandaai_status())


@router.get("", response_model=PandaContextOut)
async def get_panda_context(
    modules: str | None = Query(
        default=None,
        description=(
            "Comma-separated module override for UI toggles. "
            "Omit to use server defaults; empty string selects none."
        ),
    ),
    current_user: CurrentUser = Depends(get_current_user),
) -> PandaContextOut:
    """Return a normalized PandaAI snapshot for Agent/UI consumption."""
    del current_user
    from ai.pandaai import fetch_panda_context, parse_modules  # noqa: PLC0415

    if modules is None:
        override = None
    elif modules.strip() == "":
        override = []
    else:
        override = parse_modules(modules)
    ctx = await fetch_panda_context(modules=override)
    return PandaContextOut.model_validate(ctx.model_dump())
