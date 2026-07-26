"""Tool declaration registry (既有注册位风格，仿 ai/config 路由表 / ai/agents).

Declarations (name / description / parameters / result_kind) are DATA registered
here, not hardcoded in business code. HANDLERS are injected by services at call
time (ai/ never imports services). Adding a tool = register a ToolSpec here +
write a service handler + bind them; the tool loop is untouched.

Parameter schemas are deliberately LOOSE top-level shapes: providers don't
strictly enforce FunctionDeclaration schemas (and deep $ref/anyOf nesting is a
compatibility minefield), so the schema is a hint for the model — the thick
field rules live in the skill body, and the VERDICT is the Pydantic validation
in the service handler (FC schema 是提示、skill 是教材、Pydantic 是法律).
"""

from functools import lru_cache

from ai.skills import catalog
from ai.tools.types import ToolSpec

# Tool names (the model calls these by name; keep stable).
LOAD_SKILL = "load_skill"
WEB_SEARCH = "web_search"

_REGISTRY: dict[str, ToolSpec] = {
    WEB_SEARCH: ToolSpec(
        name=WEB_SEARCH,
        description=(
            "博查全网网页搜索（Web Search）。当需要最新公开信息、新闻、政策、"
            "公司公告、宏观事件背景，或用户询问训练数据之外的事实时主动调用。"
            "支持自然语言查询、时间范围 freshness、站点范围 include/exclude、"
            "长摘要 summary，以及最多 50 条结果。结果会同步到 Agent Task 工作台画布。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "自然语言搜索词",
                },
                "freshness": {
                    "type": "string",
                    "description": (
                        "时间范围：noLimit | oneDay | oneWeek | oneMonth | oneYear | "
                        "YYYY-MM-DD | YYYY-MM-DD..YYYY-MM-DD"
                    ),
                },
                "count": {
                    "type": "integer",
                    "description": "返回条数 1-50，默认 8",
                },
                "summary": {
                    "type": "boolean",
                    "description": "是否返回长文本摘要，默认 true",
                },
                "include": {
                    "type": "string",
                    "description": "限定站点，多个域名用 | 或 , 分隔",
                },
                "exclude": {
                    "type": "string",
                    "description": "排除站点，多个域名用 | 或 , 分隔",
                },
            },
            "required": ["query"],
        },
    ),
}


def tool_spec(name: str) -> ToolSpec:
    if name == LOAD_SKILL:
        return _load_skill_spec()
    spec = _REGISTRY.get(name)
    if spec is None:
        raise KeyError(f"unknown tool declaration '{name}'")
    return spec


@lru_cache(maxsize=1)
def _load_skill_spec() -> ToolSpec:
    """The skill-activation tool, built from the registry at first use.

    Level-1 progressive disclosure: the CATALOG (name + description per skill)
    is embedded in this tool's description — the single injection point, so no
    prompt template ever grows a skills section. The `skill` parameter is an
    enum over discovered names (官方实现指南: constrain to valid names so the
    model can't hallucinate a skill).
    """
    skills = catalog()
    lines = "\n".join(
        f"- {skill.name}: {skill.description}" for skill in skills
    )
    return ToolSpec(
        name=LOAD_SKILL,
        description=(
            "加载一项技能的完整使用说明。以下技能可用；当任务匹配某项技能的"
            "描述时，先调用本工具加载其说明，再按说明行动：\n" + lines
        ),
        parameters={
            "type": "object",
            "properties": {
                "skill": {
                    "type": "string",
                    "enum": [skill.name for skill in skills],
                    "description": "要加载的技能名",
                }
            },
            "required": ["skill"],
        },
    )
