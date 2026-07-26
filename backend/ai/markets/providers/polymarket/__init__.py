"""Polymarket Gamma provider (self-built, free, anonymous).

httpx lives only inside this package; the rest of ai/markets/ sees
PolymarketGammaProvider and the boundary MarketCandidate.
"""

from ai.markets.providers.polymarket.provider import (
    PolymarketGammaProvider,
    to_candidate,
)

__all__ = ["PolymarketGammaProvider", "to_candidate"]
