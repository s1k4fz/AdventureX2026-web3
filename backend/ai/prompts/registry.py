"""Prompt loading and variable filling.

Prompt text lives only in ai/prompts/templates/ (rules 第八章: no hardcoded
prompts in business code). Templates use $placeholders; unknown placeholders
are left untouched so adding a variable never breaks existing templates.

Prompt version = sha256 of template bytes (first 12 hex chars) for audit trails.
"""

from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path
from string import Template

from ai.errors import AIConfigError
from ai.types import AIUseCase

_TEMPLATES_DIR = Path(__file__).parent / "templates"


@lru_cache(maxsize=None)
def _load(name: str) -> tuple[Template, str]:
    path = _TEMPLATES_DIR / f"{name}.system.txt"
    if not path.is_file():
        raise AIConfigError(f"prompt template not found: {path.name}")
    raw = path.read_text(encoding="utf-8").strip()
    version = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]
    return Template(raw), version


def prompt_version(use_case: AIUseCase) -> str:
    _, version = _load(use_case.value)
    return version


def render_system_prompt_meta(
    use_case: AIUseCase, variables: dict[str, str] | None = None
) -> tuple[str, str]:
    """Return (rendered_text, prompt_version)."""
    template, version = _load(use_case.value)
    return template.safe_substitute(variables or {}), version


def render_system_prompt(
    use_case: AIUseCase, variables: dict[str, str] | None = None
) -> str:
    text, _ = render_system_prompt_meta(use_case, variables)
    return text
