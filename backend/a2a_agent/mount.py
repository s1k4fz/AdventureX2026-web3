from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes import create_agent_card_routes, create_jsonrpc_routes
from a2a.server.routes.fastapi_routes import add_a2a_routes_to_fastapi
from a2a.server.tasks import InMemoryTaskStore
from fastapi import FastAPI

from a2a_agent.card import build_agent_card
from a2a_agent.executor import LemmaAgentExecutor
from core.config import settings


def attach_a2a(app: FastAPI) -> None:
    if not settings.a2a_enabled:
        return
    card = build_agent_card(url=settings.a2a_url)
    handler = DefaultRequestHandler(
        agent_executor=LemmaAgentExecutor(),
        task_store=InMemoryTaskStore(),
        agent_card=card,
    )
    add_a2a_routes_to_fastapi(
        app,
        agent_card_routes=create_agent_card_routes(card),
        jsonrpc_routes=create_jsonrpc_routes(handler, "/a2a"),
    )
