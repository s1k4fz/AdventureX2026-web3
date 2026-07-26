"""Lemma-owned control frames for the StepFun Realtime WebSocket proxy.

After authentication, StepFun client/server events retain their official JSON
shape. Only the proxy.auth/proxy.ready/proxy.error control frames are ours.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class RealtimeProxyAuth(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )

    type: Literal["proxy.auth"]
    access_token: str = Field(min_length=1, max_length=16_384)
