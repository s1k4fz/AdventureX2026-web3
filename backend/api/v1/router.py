from fastapi import APIRouter

from api.v1 import (
    agent_tasks,
    health,
    hud,
    panda_context,
    policies,
    realtime,
    schedule_watch_items,
    users,
    world_context,
)

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(users.router)
api_router.include_router(policies.router)
api_router.include_router(agent_tasks.router)
api_router.include_router(schedule_watch_items.router)
api_router.include_router(world_context.router)
api_router.include_router(panda_context.router)
api_router.include_router(hud.router)
api_router.include_router(realtime.router)
