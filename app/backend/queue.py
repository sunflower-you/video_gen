from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, field
from typing import Any, Protocol
from uuid import uuid4


SUBMIT_GENERATION_TASK_JOB = "submit_generation_task"


@dataclass
class QueuedJob:
    id: str
    name: str
    args: list[Any] = field(default_factory=list)
    kwargs: dict[str, Any] = field(default_factory=dict)
    queue_name: str = "video_gen"


class TaskQueue(Protocol):
    def enqueue_submit_task(self, task_id: str, workflow_payload: dict[str, Any], user_id: str = "") -> QueuedJob:
        ...


class InMemoryTaskQueue:
    def __init__(self, queue_name: str = "video_gen") -> None:
        self.queue_name = queue_name
        self.jobs: list[QueuedJob] = []

    def enqueue_submit_task(self, task_id: str, workflow_payload: dict[str, Any], user_id: str = "") -> QueuedJob:
        job = QueuedJob(
            id=f"local_job_{uuid4().hex[:12]}",
            name=SUBMIT_GENERATION_TASK_JOB,
            kwargs={
                "task_id": task_id,
                "workflow_payload": dict(workflow_payload or {}),
                "user_id": str(user_id or ""),
            },
            queue_name=self.queue_name,
        )
        self.jobs.append(job)
        return job


class ArqTaskQueue:
    def __init__(self, redis_url: str, queue_name: str = "video_gen") -> None:
        self.redis_url = redis_url.strip()
        self.queue_name = queue_name.strip() or "video_gen"
        if not self.redis_url:
            raise ValueError("Redis 队列地址不能为空。")

    def enqueue_submit_task(self, task_id: str, workflow_payload: dict[str, Any], user_id: str = "") -> QueuedJob:
        job_id = asyncio.run(
            self._enqueue(
                SUBMIT_GENERATION_TASK_JOB,
                task_id=task_id,
                workflow_payload=dict(workflow_payload or {}),
                user_id=str(user_id or ""),
            )
        )
        return QueuedJob(
            id=job_id,
            name=SUBMIT_GENERATION_TASK_JOB,
            kwargs={"task_id": task_id, "workflow_payload": dict(workflow_payload or {}), "user_id": str(user_id or "")},
            queue_name=self.queue_name,
        )

    async def _enqueue(self, job_name: str, **kwargs: Any) -> str:
        try:
            from arq import create_pool
            from arq.connections import RedisSettings
        except ImportError as exc:  # pragma: no cover - 取决于生产依赖
            raise RuntimeError("未安装 arq，请先安装队列依赖。") from exc

        if hasattr(RedisSettings, "from_dsn"):
            settings = RedisSettings.from_dsn(self.redis_url)
        else:  # pragma: no cover - 兼容旧版本 arq
            settings = RedisSettings(host=self.redis_url)
        redis = await create_pool(settings)
        job = await redis.enqueue_job(job_name, _queue_name=self.queue_name, **kwargs)
        return getattr(job, "job_id", "") or f"arq_job_{uuid4().hex[:12]}"


def create_task_queue_from_env() -> TaskQueue | None:
    driver = os.getenv("PLATFORM_TASK_QUEUE_DRIVER", "inline").strip().lower()
    if driver in {"", "inline", "sync", "none"}:
        return None
    queue_name = os.getenv("PLATFORM_TASK_QUEUE_NAME", "video_gen")
    if driver == "memory":
        return InMemoryTaskQueue(queue_name=queue_name)
    if driver == "arq":
        return ArqTaskQueue(
            redis_url=os.getenv("PLATFORM_REDIS_URL", "redis://127.0.0.1:6379/0"),
            queue_name=queue_name,
        )
    raise ValueError(f"不支持的任务队列驱动：{driver}")
