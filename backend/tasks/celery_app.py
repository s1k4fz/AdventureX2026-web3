"""Celery application — policy background work only."""

from celery import Celery

from core.config import settings

celery_app = Celery(
    "lemma",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=[
        "tasks.policy_search",
        "tasks.policy_compose",
        "tasks.policy_settle",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    worker_concurrency=4,
    result_expires=60 * 60 * 24,
    beat_schedule={
        "settle-mature-policies": {
            "task": "policy.settle_scan",
            "schedule": 300.0,
        },
    },
)
