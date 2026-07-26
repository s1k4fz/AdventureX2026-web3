"""Deterministic, privacy-safe Policy NFT metadata and mint confirmation."""

from __future__ import annotations

import base64
import html
import math
import re
import uuid
from collections.abc import Sequence
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import anyio
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.config import settings
from models.policy import Policy, PolicyPortfolio, PolicyPosition
from schemas.policy import (
    PolicyDetailOut,
    PolicyNFTAttributeOut,
    PolicyNFTMetadataOut,
)
from services import policy_service
from services.policy_chain_service import derive_on_chain_policy_id

_UINT128_MAX = (1 << 128) - 1
_ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
_EVM_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
_ELIGIBLE_STATUSES = frozenset({"active", "settled"})
_TIER_LABELS = {
    "conservative": "Conservative",
    "balanced": "Balanced",
    "aggressive": "Aggressive",
}
# Accent colors are dark-on-light: text sits on the warm photographic
# background and its translucent vellum stat panel, not a dark glass card.
_TIER_COLORS = {
    "conservative": {
        "accent": "#2F6BA8",
        "accent2": "#4A90D9",
    },
    "balanced": {
        "accent": "#2E7D5B",
        "accent2": "#4FAE85",
    },
    "aggressive": {
        "accent": "#B04A22",
        "accent2": "#D96B3F",
    },
}
_POSITION_COLORS = (
    "#61E5A1", "#72A7FF", "#F59B61", "#C187FF", "#F1D35C",
    "#FF6B9D", "#4ECDC4", "#A78BFA", "#F472B6", "#34D399",
)
_SVG_SIZE_LIMIT = 32_000
# Warm silk background, pre-processed offline from /nft-bg.png: center-cropped
# to the 5:7 card ratio, resized to 500x700 (1.25x density), contrast softened
# for text overlay and saved as a progressive JPEG small enough to inline.
_BG_ASSET_PATH = Path(__file__).resolve().parent.parent / "assets" / "nft_bg.jpg"


def policy_token_id(policy_id: uuid.UUID) -> str:
    """Canonical decimal ERC-721 tokenId for a UUID-backed policy."""
    return str(policy_id.int)


def token_id_to_policy_id(token_id: str) -> uuid.UUID:
    """Strictly reverse a canonical decimal tokenId into its UUID policy key."""
    if not token_id or not token_id.isascii() or not token_id.isdecimal():
        raise ValueError("token_id must be a canonical decimal integer")
    if len(token_id) > 39:
        raise ValueError("token_id exceeds UUID range")
    value = int(token_id)
    if token_id != str(value):
        raise ValueError("token_id must not have leading zeroes")
    if value > _UINT128_MAX:
        raise ValueError("token_id exceeds UUID range")
    return uuid.UUID(int=value)


def public_nft_uri_for_token(token_id: str) -> str | None:
    base = settings.nft_public_base_url.strip().rstrip("/")
    return f"{base}/{token_id}" if base else None


def _selected_portfolio(policy: Policy) -> PolicyPortfolio | None:
    if policy.selected_portfolio_id is None:
        return None
    return next(
        (p for p in policy.portfolios if p.id == policy.selected_portfolio_id),
        None,
    )


def _finite_amount(value: object, *, fallback: float = 0.0) -> float:
    if value is None:
        return fallback
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError, OverflowError):
        return fallback
    return number if math.isfinite(number) else fallback


def _display_amount(value: float) -> str:
    return f"{value:,.2f}"[:24]


def _amount_em_width(text: str) -> float:
    """Approximate width in em units for bold system-ui numeric glyphs."""
    return sum(0.38 if ch in ",." else 0.68 for ch in text)


def _amount_font_size(text: str, *, budget: float = 100.0) -> int:
    """Largest 10-26px font keeping a numeric string inside its stat column.

    The default budget leaves room for the trailing USDC unit within a
    ~150px column half.
    """
    em_width = _amount_em_width(text)
    if em_width <= 0:
        return 26
    return max(10, min(26, int(budget / em_width)))


def _max_payout(policy: Policy, portfolio: PolicyPortfolio | None) -> float:
    if portfolio is not None:
        return _finite_amount(portfolio.expected_payout)
    return 0.0


def _display_payout(policy: Policy, portfolio: PolicyPortfolio | None) -> float:
    if policy.status == "settled" and policy.payout is not None:
        return _finite_amount(policy.payout)
    return _max_payout(policy, portfolio)


def _unix_timestamp(value: datetime) -> int:
    normalized = (
        value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
    )
    return int(normalized.timestamp())


def _hit_rate(policy: Policy) -> int | None:
    if policy.status != "settled":
        return None
    rows = (policy.intake_json or {}).get("settlementOutcomes")
    if not isinstance(rows, list) or not rows:
        return None
    hits = [item.get("hit") for item in rows if isinstance(item, dict)]
    known = [value for value in hits if isinstance(value, bool)]
    if not known:
        return None
    return round(100 * sum(known) / len(known))


def _safe_weight(position: PolicyPosition) -> int:
    try:
        return min(10_000, max(0, int(position.weight_bps)))
    except (TypeError, ValueError):
        return 0


def _escape_svg_text(value: object) -> str:
    return html.escape(str(value), quote=True)


def _weight_bar(
    positions: Sequence[PolicyPosition],
) -> str:
    """Generate a thin horizontal weight distribution bar."""
    if not positions:
        return ""
    total = sum(_safe_weight(pos) for pos in positions) or 1
    parts: list[str] = []
    bar_width = 308.0
    x_offset = 0.0
    for index, pos in enumerate(positions[:24]):
        fraction = _safe_weight(pos) / total
        seg_w = max(1.0, bar_width * fraction - 1.0)
        color = _POSITION_COLORS[index % len(_POSITION_COLORS)]
        opacity = "0.85" if pos.side == "YES" else "0.4"
        parts.append(
            f'<rect x="{x_offset:.1f}" y="0" width="{seg_w:.1f}" height="3" '
            f'rx="1.5" fill="{color}" fill-opacity="{opacity}"/>'
        )
        x_offset += bar_width * fraction
    return "".join(parts)


@lru_cache(maxsize=1)
def _background_data_uri() -> str | None:
    """Inline the processed warm-silk photo once per process; None if absent."""
    try:
        raw = _BG_ASSET_PATH.read_bytes()
    except OSError:
        return None
    return "data:image/jpeg;base64," + base64.b64encode(raw).decode()


def _card_background_defs() -> str:
    """Reusable <image> def; referenced by the card fill and the frost panel."""
    uri = _background_data_uri()
    if uri is None:
        return ""
    # A single def keeps the inlined JPEG payload counted once against the
    # 32KB budget even though the photo is drawn twice (sharp + blurred).
    return (
        f'<image id="bg-img" x="0" y="0" width="400" height="560" '
        f'preserveAspectRatio="xMidYMid slice" xlink:href="{uri}"/>'
    )


def generate_nft_svg(
    policy: Policy,
    portfolio: PolicyPortfolio | None,
    positions: Sequence[PolicyPosition],
) -> str:
    """Card SVG over the warm-silk photo with a three-level type hierarchy.

    Level 1: serif display (hero status + italic subline).
    Level 2: sans-serif structure (eyebrow, stat labels, numbers, badge).
    Level 3: monospace metadata (token id, chain footer).
    """
    tier_key = portfolio.tier if portfolio is not None else "balanced"
    tier = _TIER_LABELS.get(tier_key, "Balanced")
    colors = _TIER_COLORS.get(tier_key, _TIER_COLORS["balanced"])
    premium = _finite_amount(policy.premium)
    payout = _display_payout(policy, portfolio)
    payout_label = "PAID OUT" if policy.status == "settled" else "MAX PAYOUT"
    premium_text = _display_amount(premium)
    payout_text = _display_amount(payout)
    premium_size = _amount_font_size(premium_text)
    payout_size = _amount_font_size(payout_text)
    # textLength pins glyph advances so column math holds across renderers
    # (browser system-ui vs. server-side fallback fonts).
    premium_width = _amount_em_width(premium_text) * premium_size
    payout_width = _amount_em_width(payout_text) * payout_size
    premium_unit_x = premium_width + 10.0
    token_short = f"{policy.id.int:032x}"[-8:].upper()

    status_label = policy.status.upper()
    is_settled = policy.status == "settled"
    pos_count = len(positions)
    ratio = payout / premium if premium > 0 else 0.0
    subline = f"Payout ratio {ratio:.2f}x \u00b7 {pos_count} positions"

    weight_bar = _weight_bar(positions)
    bg_defs = _card_background_defs()
    # Sharp photo behind the card; a second blurred, panel-clipped pass gives
    # the stat container a frosted-glass depth. Renderers without filter
    # support degrade to the sharp photo under the translucent vellum fill.
    bg_layer = (
        '<g clip-path="url(#card-clip)"><use xlink:href="#bg-img"/></g>'
        if bg_defs
        else ""
    )
    panel_frost = (
        '<g clip-path="url(#panel-clip)" filter="url(#frost)">'
        '<use xlink:href="#bg-img"/></g>'
        if bg_defs
        else ""
    )

    # Settled pill (L2 badge) sits above the serif hero.
    settled_el = (
        f'<rect x="2" y="-58" width="78" height="22" rx="11" '
        f'fill="{colors["accent"]}" fill-opacity="0.14"/>'
        f'<rect x="2" y="-58" width="78" height="22" rx="11" fill="none" '
        f'stroke="{colors["accent"]}" stroke-opacity="0.45" stroke-width="0.8"/>'
        f'<text x="41" y="-43" text-anchor="middle" class="badge">SETTLED</text>'
        if is_settled
        else ""
    )

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="400" height="560" viewBox="0 0 400 560" role="img" aria-labelledby="title desc">
<title id="title">xEngine Policy NFT {_escape_svg_text(token_short)}</title>
<desc id="desc">Privacy-safe visualization of public policy economics</desc>
<defs>
<linearGradient id="base" x1="0" y1="0" x2="0.5" y2="1">
<stop offset="0%" stop-color="#F5E8D8"/>
<stop offset="50%" stop-color="#E8C8B0"/>
<stop offset="100%" stop-color="#D4A890"/>
</linearGradient>
<linearGradient id="scrim-top" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#FFF9F2" stop-opacity="0.72"/>
<stop offset="100%" stop-color="#FFF9F2" stop-opacity="0"/>
</linearGradient>
<linearGradient id="scrim-bottom" x1="0" y1="0" x2="0" y2="1">
<stop offset="0%" stop-color="#FFF6EC" stop-opacity="0"/>
<stop offset="100%" stop-color="#FFF6EC" stop-opacity="0.65"/>
</linearGradient>
<clipPath id="card-clip"><rect width="400" height="560" rx="24"/></clipPath>
<clipPath id="panel-clip"><rect x="28" y="352" width="344" height="128" rx="14"/></clipPath>
<filter id="frost" x="-15%" y="-15%" width="130%" height="130%"><feGaussianBlur stdDeviation="9"/></filter>
{bg_defs}
</defs>
<style>
.hero{{font:600 46px Georgia,'Times New Roman',serif;letter-spacing:1px;fill:#241A12}}
.hero-sub{{font:italic 400 13px Georgia,'Times New Roman',serif;fill:#5C4A38;fill-opacity:0.9}}
.eyebrow{{font:700 9px system-ui,'Segoe UI',sans-serif;letter-spacing:4px;fill:{colors["accent"]}}}
.wordmark{{font:800 15px system-ui,'Segoe UI',sans-serif;letter-spacing:0.3px;fill:#241A12}}
.lbl{{font:600 8px system-ui,'Segoe UI',sans-serif;letter-spacing:2.5px;fill:#8A7660}}
.num{{font-family:system-ui,'Segoe UI',sans-serif;font-weight:800;fill:#2B2018}}
.unit{{font:500 10px system-ui,'Segoe UI',sans-serif;fill:#6B5A4A}}
.badge{{font:700 9px system-ui,'Segoe UI',sans-serif;letter-spacing:2px;fill:{colors["accent"]}}}
.pos-lbl{{font:600 8px system-ui,'Segoe UI',sans-serif;letter-spacing:2px;fill:#7A6650}}
.id{{font:400 9px ui-monospace,'SF Mono',Menlo,monospace;letter-spacing:1.5px;fill:#4A3828;fill-opacity:0.72}}
.foot{{font:400 7.5px ui-monospace,'SF Mono',Menlo,monospace;letter-spacing:1.2px;fill:#5C4A38;fill-opacity:0.85}}
</style>
<rect width="400" height="560" rx="24" fill="url(#base)"/>
{bg_layer}
<g clip-path="url(#card-clip)">
<rect width="400" height="110" fill="url(#scrim-top)"/>
<rect y="440" width="400" height="120" fill="url(#scrim-bottom)"/>
</g>
<rect x="0.5" y="0.5" width="399" height="559" rx="23.5" fill="none" stroke="#FFFFFF" stroke-opacity="0.55" stroke-width="1"/>
<rect x="14" y="14" width="372" height="532" rx="12" fill="none" stroke="#8A6A4A" stroke-opacity="0.28" stroke-width="0.6"/>
<rect x="17.5" y="17.5" width="365" height="525" rx="9.5" fill="none" stroke="#8A6A4A" stroke-opacity="0.14" stroke-width="0.5"/>
<g fill="none" stroke="#6B5138" stroke-opacity="0.6" stroke-width="1.3" stroke-linecap="round">
<path d="M14 38 L14 24 Q14 14 24 14 L38 14"/>
<path d="M362 14 L376 14 Q386 14 386 24 L386 38"/>
<path d="M386 522 L386 536 Q386 546 376 546 L362 546"/>
<path d="M38 546 L24 546 Q14 546 14 536 L14 522"/>
</g>
<g transform="translate(36 32)">
<rect width="20" height="20" rx="6" fill="#2B2018"/>
<path d="M6.2 6.2 L13.8 13.8 M13.8 6.2 L6.2 13.8" stroke="#FFF9F2" stroke-width="2.2" stroke-linecap="round"/>
<circle cx="20" cy="0" r="2.4" fill="{colors["accent"]}"/>
<text x="28" y="15" class="wordmark">xEngine</text>
<text x="0" y="36" class="id">{_escape_svg_text(token_short)}</text>
</g>
<g transform="translate(364 50)" text-anchor="end">
<text class="id">POLICY NFT</text>
<text y="18" class="id">INJECTIVE</text>
</g>
<line x1="36" y1="82" x2="364" y2="82" stroke="#8A6A4A" stroke-opacity="0.25" stroke-width="0.5"/>
<g transform="translate(40 236)">
{settled_el}
<text class="eyebrow">{_escape_svg_text(tier.upper())} PORTFOLIO</text>
<text x="-2" y="52" class="hero">{_escape_svg_text(status_label)}</text>
<text x="1" y="78" class="hero-sub">{_escape_svg_text(subline)}</text>
</g>
<g>
{panel_frost}
<rect x="28" y="352" width="344" height="128" rx="14" fill="#FFF9F2" fill-opacity="0.52"/>
<rect x="28" y="352" width="344" height="128" rx="14" fill="none" stroke="#FFFFFF" stroke-opacity="0.7" stroke-width="0.9"/>
</g>
<g transform="translate(50 380)">
<text class="lbl">PREMIUM</text>
<text y="28" class="num" font-size="{premium_size}" textLength="{premium_width:.1f}" lengthAdjust="spacingAndGlyphs">{_escape_svg_text(premium_text)}</text>
<text x="{premium_unit_x:.1f}" y="28" class="unit">USDC</text>
</g>
<g transform="translate(350 380)" text-anchor="end">
<text class="lbl">{payout_label}</text>
<text x="-33" y="28" class="num" font-size="{payout_size}" textLength="{payout_width:.1f}" lengthAdjust="spacingAndGlyphs">{_escape_svg_text(payout_text)}</text>
<text y="28" class="unit">USDC</text>
</g>
<line x1="50" y1="432" x2="350" y2="432" stroke="#8A6A4A" stroke-opacity="0.18" stroke-width="0.5"/>
<g transform="translate(50 452)">
<text class="pos-lbl">{pos_count} POSITIONS</text>
<g transform="translate(0 12)">{weight_bar}</g>
</g>
<g transform="translate(40 526)">
<text class="foot">ERC-721 \u00b7 ON-CHAIN \u00b7 DETERMINISTIC</text>
</g>
<circle cx="360" cy="523" r="3.5" fill="{colors["accent"]}" fill-opacity="0.75"/>
</svg>'''
    if len(svg.encode("utf-8")) > _SVG_SIZE_LIMIT:
        raise RuntimeError("generated Policy NFT SVG exceeds size limit")
    return svg


def generate_metadata(policy: Policy) -> PolicyNFTMetadataOut:
    """Generate deterministic ERC-721 JSON without user text or identity."""
    portfolio = _selected_portfolio(policy)
    positions = list(portfolio.positions) if portfolio is not None else []
    token_id = policy_token_id(policy.id)
    premium = round(_finite_amount(policy.premium), 2)
    payout = round(_max_payout(policy, portfolio), 2)
    tier = _TIER_LABELS.get(
        portfolio.tier if portfolio is not None else "balanced", "Balanced"
    )
    svg = generate_nft_svg(policy, portfolio, positions)
    image = "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()
    attributes = [
        PolicyNFTAttributeOut(trait_type="Tier", value=tier),
        PolicyNFTAttributeOut(
            trait_type="Premium (USDC)", value=premium, display_type="number"
        ),
        PolicyNFTAttributeOut(
            trait_type="Max Payout (USDC)", value=payout, display_type="number"
        ),
        PolicyNFTAttributeOut(
            trait_type="Positions", value=len(positions), display_type="number"
        ),
        PolicyNFTAttributeOut(trait_type="Status", value=policy.status.title()),
    ]
    if policy.coverage_end is not None:
        attributes.append(
            PolicyNFTAttributeOut(
                trait_type="Coverage End",
                value=_unix_timestamp(policy.coverage_end),
                display_type="date",
            )
        )
    ratio = payout / premium if premium > 0 else 0.0
    attributes.append(
        PolicyNFTAttributeOut(trait_type="Payout Ratio", value=f"{ratio:.2f}x")
    )
    hit_rate = _hit_rate(policy)
    if hit_rate is not None:
        attributes.append(
            PolicyNFTAttributeOut(
                trait_type="Hit Rate", value=hit_rate, display_type="number"
            )
        )
    if policy.status == "settled" and policy.payout is not None:
        attributes.append(
            PolicyNFTAttributeOut(
                trait_type="Payout (USDC)",
                value=round(_finite_amount(policy.payout), 2),
                display_type="number",
            )
        )

    return PolicyNFTMetadataOut(
        name=f"xEngine Policy #{policy.id.hex[-8:].upper()}",
        description=(
            "A privacy-safe on-chain representation of an xEngine \u5dee\u5206\u673a "
            "prediction-market risk policy. Metadata includes product economics only."
        ),
        image=image,
        # Prefer the unauthenticated visual landing page. The public metadata
        # endpoint remains a safe relative fallback for local/offline previews;
        # deployment validation treats NFT_PUBLIC_BASE_URL as a hard gate.
        external_url=(
            public_nft_uri_for_token(token_id)
            or f"/api/v1/policies/nft/metadata/{token_id}"
        ),
        attributes=attributes,
    )


async def _is_token_minted_on_chain(policy_id_int: int) -> bool:
    """Fail closed unless PolicyNFT.ownerOf confirms this UUID-backed token."""
    if not settings.policy_nft_address:
        return False

    from services import chain_service  # noqa: PLC0415

    try:
        owner = await anyio.to_thread.run_sync(
            chain_service.read_policy_nft_owner, policy_id_int
        )
    except Exception:
        return False
    return bool(
        _EVM_ADDRESS_RE.fullmatch(owner) and owner.lower() != _ZERO_ADDRESS
    )


async def get_public_metadata(
    db: AsyncSession, *, token_id: str
) -> PolicyNFTMetadataOut | None:
    """Resolve decimal tokenId to a public eligible policy, or return None."""
    try:
        policy_id = token_id_to_policy_id(token_id)
    except ValueError:
        return None
    result = await db.execute(
        select(Policy)
        .where(Policy.id == policy_id, Policy.status.in_(_ELIGIBLE_STATUSES))
        .options(
            selectinload(Policy.portfolios).selectinload(PolicyPortfolio.positions)
        )
    )
    policy = result.scalar_one_or_none()
    if policy is None or policy.status not in _ELIGIBLE_STATUSES:
        return None
    # Do not publish metadata for a locally active row that was never mapped to
    # the deterministic bytes32 representation expected by PolicyNFT.
    if policy.on_chain_policy_id != derive_on_chain_policy_id(policy.id):
        return None
    # The request-scoped session starts a transaction for the SELECT above.
    # Release its connection before the potentially slow external RPC so a
    # small Supabase pool cannot be exhausted by concurrent public tokenURI
    # recovery requests. Capture every value needed after rollback so this is
    # safe even if the session's expiration policy changes later.
    policy_snapshot = generate_metadata(policy)
    policy_id_int = policy.id.int
    token_id = policy_token_id(policy.id)
    locally_confirmed = policy.nft_token_id == token_id
    await db.rollback()
    # Product economics become public only with the ERC-721. A known/leaked
    # policy UUID must not expose metadata before minting. Chain state is the
    # recovery path when mint succeeded but the authenticated DB projection did
    # not yet complete.
    if not locally_confirmed and not await _is_token_minted_on_chain(policy_id_int):
        return None
    return policy_snapshot


async def get_preview_svg(
    db: AsyncSession, *, user_id: uuid.UUID, policy_id: uuid.UUID
) -> str | None:
    """Return an owned eligible policy preview; None preserves IDOR semantics."""
    result = await db.execute(
        select(Policy)
        .where(Policy.id == policy_id, Policy.user_id == user_id)
        .options(
            selectinload(Policy.portfolios).selectinload(PolicyPortfolio.positions)
        )
    )
    policy = result.scalar_one_or_none()
    if policy is None:
        return None
    if policy.status not in _ELIGIBLE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="policy_not_nft_eligible",
        )
    portfolio = _selected_portfolio(policy)
    positions = list(portfolio.positions) if portfolio is not None else []
    return generate_nft_svg(policy, portfolio, positions)


async def _lock_owned_policy(
    db: AsyncSession, *, user_id: uuid.UUID, policy_id: uuid.UUID
) -> Policy | None:
    """Lock and refresh a policy only after slow chain reads have completed."""
    result = await db.execute(
        select(Policy)
        .where(Policy.id == policy_id, Policy.user_id == user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def confirm_policy_nft_mint(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    policy_id: uuid.UUID,
    nft_token_id: str,
    mint_tx: str | None,
) -> PolicyDetailOut | None:
    """Verify committed ``ownerOf`` state and idempotently project it to DB."""
    from services import chain_service  # noqa: PLC0415

    result = await db.execute(
        select(Policy).where(Policy.id == policy_id, Policy.user_id == user_id)
    )
    policy = result.scalar_one_or_none()
    if policy is None:
        return None
    if policy.status not in _ELIGIBLE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="policy_not_nft_eligible",
        )
    expected_token_id = policy_token_id(policy.id)
    if nft_token_id != expected_token_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="nft_token_id_mismatch",
        )
    if policy.on_chain_policy_id != derive_on_chain_policy_id(policy.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="policy_chain_id_not_confirmed",
        )
    if policy.nft_token_id is not None and policy.nft_token_id != expected_token_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="policy_nft_token_conflict",
        )
    token_id_int = policy.id.int

    # Already projected: return idempotently without making availability of a
    # later ownerOf call a requirement. Validate an optional display hash before
    # acquiring the short DB row lock so a slow receipt RPC never holds it.
    if policy.nft_token_id == expected_token_id:
        should_validate_receipt = mint_tx is not None and policy.nft_mint_tx is None
        already_timestamped = policy.nft_minted_at is not None
        receipt_valid = False
        if should_validate_receipt:
            # End the initial read transaction before receipt RPC. The row is
            # locked and revalidated below if the optional hash is accepted.
            await db.rollback()
            receipt_valid = await anyio.to_thread.run_sync(
                chain_service.validate_policy_nft_mint_tx,
                mint_tx,
                token_id_int,
            )
        if already_timestamped and not receipt_valid:
            detail = await policy_service.get_policy_detail(
                db, user_id=user_id, policy_id=policy_id
            )
            if detail is None:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="policy_refresh_failed",
                )
            return detail

        policy = await _lock_owned_policy(
            db, user_id=user_id, policy_id=policy_id
        )
        if policy is None:
            return None
        if policy.nft_token_id != expected_token_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="policy_nft_token_conflict",
            )
        changed = False
        if receipt_valid and policy.nft_mint_tx is None:
            policy.nft_mint_tx = mint_tx.lower()  # type: ignore[union-attr]
            changed = True
        if policy.nft_minted_at is None:
            policy.nft_minted_at = datetime.now(timezone.utc)
            changed = True
        if changed:
            await db.commit()
        detail = await policy_service.get_policy_detail(
            db, user_id=user_id, policy_id=policy_id
        )
        if detail is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="policy_refresh_failed",
            )
        return detail

    if not settings.policy_nft_address:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="policy_nft_not_configured",
        )

    # Do not retain a database connection while waiting on ownerOf (and an
    # optional receipt). A new short transaction is opened by _lock_owned_policy
    # after all network I/O and repeats every mutable eligibility check.
    should_validate_receipt = mint_tx is not None and policy.nft_mint_tx is None
    await db.rollback()
    try:
        owner = await anyio.to_thread.run_sync(
            chain_service.read_policy_nft_owner, token_id_int
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="policy_nft_not_confirmed",
        ) from exc
    except Exception as exc:  # network/config/JSON-RPC shape
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="policy_nft_chain_unavailable",
        ) from exc
    # ERC-721 ownerOf must never return zero. Do not require the original vault
    # user: a transferred NFT remains valid and confirmation must be recoverable.
    if not _EVM_ADDRESS_RE.fullmatch(owner) or owner.lower() == _ZERO_ADDRESS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="policy_nft_not_confirmed",
        )

    receipt_valid = False
    if should_validate_receipt:
        # The token state is already confirmed above. Receipt verification is
        # best-effort and only gates whether the untrusted display hash is kept.
        receipt_valid = await anyio.to_thread.run_sync(
            chain_service.validate_policy_nft_mint_tx,
            mint_tx,
            token_id_int,
        )

    # Serialize only the local projection. This avoids duplicate timestamps or
    # last-writer surprises without holding a database lock during RPC calls.
    policy = await _lock_owned_policy(db, user_id=user_id, policy_id=policy_id)
    if policy is None:
        return None
    if policy.status not in _ELIGIBLE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="policy_not_nft_eligible",
        )
    if policy.on_chain_policy_id != derive_on_chain_policy_id(policy.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="policy_chain_id_not_confirmed",
        )
    if policy.nft_token_id not in {None, expected_token_id}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="policy_nft_token_conflict",
        )

    changed = False
    if policy.nft_token_id is None:
        policy.nft_token_id = expected_token_id
        changed = True
    if receipt_valid and policy.nft_mint_tx is None:
        policy.nft_mint_tx = mint_tx.lower()  # type: ignore[union-attr]
        changed = True
    if policy.nft_minted_at is None:
        policy.nft_minted_at = datetime.now(timezone.utc)
        changed = True
    if changed:
        await db.commit()

    detail = await policy_service.get_policy_detail(
        db, user_id=user_id, policy_id=policy_id
    )
    if detail is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="policy_refresh_failed",
        )
    return detail
