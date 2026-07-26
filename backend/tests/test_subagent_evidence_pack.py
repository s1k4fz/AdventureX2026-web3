"""Offline coverage for EvidencePack prompt rendering."""

from ai.runtime.subagents.types import Citation, EvidencePack, SourceBrief


def test_evidence_pack_prompt_block_includes_sources_and_brief() -> None:
    pack = EvidencePack(
        brief="宏观风险升温，关注利率路径。",
        sources=[
            SourceBrief(
                kind="polymarket",
                status="succeeded",
                summary="候选 12 个",
                item_count=12,
            ),
            SourceBrief(
                kind="news",
                status="succeeded",
                summary="8 条新闻",
                item_count=8,
            ),
        ],
        citations=[
            Citation(
                title="Fed holds rates",
                url="https://example.com/a",
                kind="news",
            )
        ],
    )
    block = pack.as_prompt_block()
    assert "EvidencePack" in block or "多源情报" in block
    assert "宏观风险" in block
    assert "行情侦察" in block
    assert "新闻猎手" in block
    assert "Fed holds rates" in block


def test_pack_from_intake_roundtrip() -> None:
    from ai.runtime.subagents.types import pack_from_intake

    pack = EvidencePack(brief="hello", sources=[])
    restored = pack_from_intake({"evidencePack": pack.as_dict()})
    assert restored is not None
    assert restored.brief == "hello"
