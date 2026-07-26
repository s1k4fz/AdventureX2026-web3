"""Typed errors for A2A skill / bridge failure paths."""

from __future__ import annotations


class A2ASkillError(Exception):
    """Raised when a skill/bridge path fails and the A2A task must be FAILED."""
