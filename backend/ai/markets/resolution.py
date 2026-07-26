"""Market resolution lookup (差分机 / Difference Engine, M3).

Minimal read-only helper that checks whether a Polymarket market (by conditionId)
has resolved, and if so what the outcome is. Reuses the existing httpx pattern and
Gamma base URL from settings. Does NOT go through the full search routing chain
(this is a single-item lookup, not a search).
"""

import logging
from typing import Any

import httpx

from ai.markets.normalize import maybe_json_list, parse_float
from core.config import settings

logger = logging.getLogger("lemma.ai.markets.resolution")


async def get_market_resolution(condition_id: str) -> dict[str, Any] | None:
    """Query Polymarket Gamma for a single market by conditionId.

    Returns:
        {
            "resolved": bool,
            "outcome_yes": bool | None,  # True if YES won, False if NO won, None if unresolved
            "closed": bool,
            "condition_id": str,
        }
    or None if the market is not found on Gamma.

    Logic:
    - Gamma /markets?condition_id=X returns the market.
    - A resolved market has closed=true and the winning outcome's price == 1.0
      (or very close). We check outcomePrices: if outcomes=["Yes","No"] and
      outcomePrices=[1.0, 0.0] → YES won.
    """
    timeout = httpx.Timeout(15.0)
    try:
        async with httpx.AsyncClient(timeout=timeout) as http:
            resp = await http.get(
                f"{settings.polymarket_gamma_base_url}/markets",
                # Gamma filters by `condition_ids` (plural); `condition_id`
                # (singular) is IGNORED and returns an unrelated default page.
                # A resolved market is `closed`, and closed markets are excluded
                # by default, so `closed=true` is required to fetch it.
                params={"condition_ids": condition_id, "closed": "true"},
            )
    except httpx.HTTPError as exc:
        logger.warning("Gamma resolution lookup failed for %s: %s", condition_id, exc)
        return None

    if resp.status_code != 200:
        logger.warning("Gamma returned %d for conditionId %s", resp.status_code, condition_id)
        return None

    try:
        items = resp.json()
    except ValueError:
        return None

    if not isinstance(items, list) or len(items) == 0:
        # No closed market for this conditionId -> not resolved yet (or unknown).
        return {
            "resolved": False,
            "outcome_yes": None,
            "closed": False,
            "condition_id": condition_id,
        }

    item = items[0]
    closed = item.get("closed", False)
    if isinstance(closed, str):
        closed = closed.lower() == "true"

    outcomes = maybe_json_list(item.get("outcomes"))
    outcome_prices = maybe_json_list(item.get("outcomePrices"))

    # Parse prices
    prices: list[float] = []
    for p in outcome_prices:
        val = parse_float(p)
        prices.append(val if val is not None else 0.0)

    # Determine resolution
    resolved = False
    outcome_yes: bool | None = None

    if closed and len(outcomes) >= 2 and len(prices) >= 2:
        # Standard binary market: outcomes = ["Yes", "No"]
        # Resolved if one price is ~1.0 (winner) and other is ~0.0
        yes_idx = None
        no_idx = None
        for i, o in enumerate(outcomes):
            if o.lower() == "yes":
                yes_idx = i
            elif o.lower() == "no":
                no_idx = i

        if yes_idx is not None and no_idx is not None:
            yes_price = prices[yes_idx] if yes_idx < len(prices) else 0.0
            no_price = prices[no_idx] if no_idx < len(prices) else 0.0
            # A resolved market has winner=1.0, loser=0.0
            if yes_price >= 0.95 and no_price <= 0.05:
                resolved = True
                outcome_yes = True
            elif no_price >= 0.95 and yes_price <= 0.05:
                resolved = True
                outcome_yes = False
            elif yes_price >= 0.95:
                # Edge case: some markets only set winner to 1
                resolved = True
                outcome_yes = True
            elif no_price >= 0.95:
                resolved = True
                outcome_yes = False
        elif len(prices) == 2:
            # Fallback for non-standard outcome labels
            if prices[0] >= 0.95 and prices[1] <= 0.05:
                resolved = True
                outcome_yes = True  # first outcome won
            elif prices[1] >= 0.95 and prices[0] <= 0.05:
                resolved = True
                outcome_yes = False  # second outcome won

    return {
        "resolved": resolved,
        "outcome_yes": outcome_yes,
        "closed": closed,
        "condition_id": condition_id,
    }
