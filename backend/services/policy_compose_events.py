"""Search payload helpers shared by search/compose workers.

Historical note: compose progress used to fan out over Redis
`policy:compose:{policy_id}` pub/sub. Progress is now durable Agent events only;
this module keeps `build_search_payload` for the wire shape projected into those
events.
"""

from typing import Any

from ai.markets.types import MarketCandidate
from ai.policygen.ranking import rank


def build_search_payload(candidates: list[MarketCandidate]) -> dict[str, Any]:
    """The `search` event body: per-platform hit counts + full ranked markets.

    camelCase for the wire; ranking reuses ai.policygen.ranking.
    Downstream compose already receives the full candidate pool separately;
    this payload is for UI observability and must not truncate.
    """
    counts: dict[str, int] = {}
    for candidate in candidates:
        platform = candidate.platform.value
        counts[platform] = counts.get(platform, 0) + 1
    ordered = rank(candidates)
    return {
        "platforms": [
            {"platform": platform, "count": count}
            for platform, count in counts.items()
        ],
        "totalCount": len(ordered),
        "items": [
            {
                "platform": candidate.platform.value,
                "question": candidate.question,
                "volume": candidate.volume,
                "liquidity": candidate.liquidity,
                "conditionId": candidate.condition_id,
                "url": candidate.url,
                "endDate": (
                    candidate.end_date.isoformat() if candidate.end_date else None
                ),
            }
            for candidate in ordered
        ],
    }
