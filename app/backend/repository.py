from __future__ import annotations

import json
import re
from dataclasses import fields
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, TypeVar

from .models import (
    Asset,
    AssetType,
    Character,
    CreditAccount,
    CreditTransaction,
    CreditTransactionType,
    GenerationTask,
    InteractionType,
    Interaction,
    PaymentOrder,
    PaymentOrderStatus,
    Project,
    ProjectGraph,
    ProjectStatus,
    PublishedWork,
    Script,
    StoryboardShot,
    SubtitleCue,
    TaskStatus,
    TaskType,
    TimelineItem,
    User,
    WorkReviewStatus,
    WorkTemplate,
    RevenueShare,
    SubscriptionPlan,
    WithdrawalRequest,
    to_jsonable,
)


T = TypeVar("T")


class JsonFileRepository:
    collections = {
        "users": User,
        "projects": Project,
        "project_graphs": ProjectGraph,
        "scripts": Script,
        "characters": Character,
        "shots": StoryboardShot,
        "subtitles": SubtitleCue,
        "timeline_items": TimelineItem,
        "templates": WorkTemplate,
        "works": PublishedWork,
        "interactions": Interaction,
        "tasks": GenerationTask,
        "assets": Asset,
        "credit_accounts": CreditAccount,
        "credit_transactions": CreditTransaction,
        "revenue_shares": RevenueShare,
        "payment_orders": PaymentOrder,
        "subscriptions": SubscriptionPlan,
        "withdrawal_requests": WithdrawalRequest,
    }

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        for name in self.collections:
            setattr(self, name, {})
        self.load()

    def load(self) -> None:
        if not self.path.exists():
            return
        data = json.loads(self.path.read_text(encoding="utf-8"))
        for name, model in self.collections.items():
            items = data.get(name, {})
            setattr(self, name, {item_id: _from_dict(model, payload) for item_id, payload in items.items()})

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            name: {item_id: to_jsonable(item) for item_id, item in getattr(self, name).items()}
            for name in self.collections
        }
        temp_path = self.path.with_suffix(f"{self.path.suffix}.tmp")
        temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
        temp_path.replace(self.path)


class PostgresJsonRepository:
    collections = JsonFileRepository.collections

    def __init__(
        self,
        database_url: str,
        *,
        table_name: str = "video_gen_records",
        connect_fn: Callable[[str], Any] | None = None,
    ) -> None:
        self.database_url = database_url.strip()
        if not self.database_url:
            raise ValueError("PostgreSQL 数据库地址不能为空。")
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", table_name):
            raise ValueError("PostgreSQL 表名只能包含字母、数字和下划线，且不能以数字开头。")
        self.table_name = table_name
        self.relation_table_name = f"{table_name}_relations"
        self._connect_fn = connect_fn or _psycopg_connect
        for name in self.collections:
            setattr(self, name, {})
        self.load()

    def load(self) -> None:
        with self._connect() as connection:
            self._ensure_schema(connection)
            rows = self._fetch_rows(connection)
        grouped: dict[str, dict[str, Any]] = {name: {} for name in self.collections}
        for row in rows:
            collection = str(_row_value(row, "collection"))
            item_id = str(_row_value(row, "item_id"))
            payload = _row_value(row, "payload")
            if collection not in self.collections or not item_id:
                continue
            if isinstance(payload, str):
                payload = json.loads(payload)
            if isinstance(payload, dict):
                grouped[collection][item_id] = _from_dict(self.collections[collection], payload)
        for name in self.collections:
            setattr(self, name, grouped[name])

    def save(self) -> None:
        with self._connect() as connection:
            self._ensure_schema(connection)
            with connection.cursor() as cursor:
                for collection_name in self.collections:
                    items = getattr(self, collection_name)
                    item_ids = list(items)
                    for item_id, item in items.items():
                        payload = json.dumps(to_jsonable(item), ensure_ascii=False)
                        cursor.execute(
                            f"""
                            INSERT INTO {self.table_name} (collection, item_id, payload, updated_at)
                            VALUES (%s, %s, %s::jsonb, now())
                            ON CONFLICT (collection, item_id)
                            DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()
                            """,
                            (collection_name, item_id, payload),
                        )
                        cursor.execute(
                            f"DELETE FROM {self.relation_table_name} WHERE collection = %s AND item_id = %s",
                            (collection_name, item_id),
                        )
                        for relation_type, relation_id in _extract_relations(collection_name, item):
                            cursor.execute(
                                f"""
                                INSERT INTO {self.relation_table_name}
                                    (collection, item_id, relation_type, relation_id, updated_at)
                                VALUES (%s, %s, %s, %s, now())
                                ON CONFLICT (collection, item_id, relation_type, relation_id)
                                DO UPDATE SET updated_at = now()
                                """,
                                (collection_name, item_id, relation_type, relation_id),
                            )
                    if item_ids:
                        cursor.execute(
                            f"DELETE FROM {self.table_name} WHERE collection = %s AND item_id <> ALL(%s)",
                            (collection_name, item_ids),
                        )
                        cursor.execute(
                            f"DELETE FROM {self.relation_table_name} WHERE collection = %s AND item_id <> ALL(%s)",
                            (collection_name, item_ids),
                        )
                    else:
                        cursor.execute(f"DELETE FROM {self.table_name} WHERE collection = %s", (collection_name,))
                        cursor.execute(
                            f"DELETE FROM {self.relation_table_name} WHERE collection = %s",
                            (collection_name,),
                        )
            commit = getattr(connection, "commit", None)
            if callable(commit):
                commit()

    def _connect(self) -> Any:
        return self._connect_fn(self.database_url)

    def _ensure_schema(self, connection: Any) -> None:
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {self.table_name} (
                    collection text NOT NULL,
                    item_id text NOT NULL,
                    payload jsonb NOT NULL,
                    updated_at timestamptz NOT NULL DEFAULT now(),
                    PRIMARY KEY (collection, item_id)
                )
                """
            )
            cursor.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {self.relation_table_name} (
                    collection text NOT NULL,
                    item_id text NOT NULL,
                    relation_type text NOT NULL,
                    relation_id text NOT NULL,
                    updated_at timestamptz NOT NULL DEFAULT now(),
                    PRIMARY KEY (collection, item_id, relation_type, relation_id)
                )
                """
            )
            for index_sql in self._index_statements():
                cursor.execute(index_sql)

    def _index_statements(self) -> list[str]:
        return [
            f"CREATE INDEX IF NOT EXISTS {self.table_name}_collection_updated_idx ON {self.table_name} (collection, updated_at DESC)",
            f"CREATE INDEX IF NOT EXISTS {self.table_name}_payload_gin_idx ON {self.table_name} USING gin (payload)",
            f"CREATE INDEX IF NOT EXISTS {self.table_name}_projects_owner_idx ON {self.table_name} ((payload->>'owner_id')) WHERE collection = 'projects'",
            f"CREATE INDEX IF NOT EXISTS {self.table_name}_tasks_project_status_idx ON {self.table_name} ((payload->>'project_id'), (payload->>'status')) WHERE collection = 'tasks'",
            f"CREATE INDEX IF NOT EXISTS {self.table_name}_works_review_category_idx ON {self.table_name} ((payload->>'review_status'), (payload->>'category')) WHERE collection = 'works'",
            f"CREATE INDEX IF NOT EXISTS {self.relation_table_name}_lookup_idx ON {self.relation_table_name} (relation_type, relation_id, collection)",
            f"CREATE INDEX IF NOT EXISTS {self.relation_table_name}_item_idx ON {self.relation_table_name} (collection, item_id)",
        ]

    def _fetch_rows(self, connection: Any) -> list[Any]:
        with connection.cursor() as cursor:
            cursor.execute(f"SELECT collection, item_id, payload FROM {self.table_name}")
            fetchall = getattr(cursor, "fetchall", None)
            return list(fetchall()) if callable(fetchall) else []


def _from_dict(model: type[T], payload: dict[str, Any]) -> T:
    allowed = {field.name for field in fields(model)}
    values = {key: _restore_field(model, key, value) for key, value in payload.items() if key in allowed}
    return model(**values)


def _extract_relations(collection: str, item: Any) -> list[tuple[str, str]]:
    payload = to_jsonable(item)
    relations: list[tuple[str, str]] = []

    def add(relation_type: str, value: Any) -> None:
        if value is None:
            return
        relation_id = str(value).strip()
        if relation_id:
            relations.append((relation_type, relation_id))

    add("status", payload.get("status"))
    if collection == "users":
        add("role", payload.get("role"))
        add("author_level", payload.get("author_level"))
    elif collection == "projects":
        add("owner", payload.get("owner_id"))
        add("template", payload.get("template_id"))
        add("workflow", payload.get("workflow_key"))
        add("script", payload.get("script_id"))
    elif collection == "project_graphs":
        add("project", payload.get("project_id"))
    elif collection in {"scripts", "characters", "shots", "subtitles", "timeline_items"}:
        add("project", payload.get("project_id"))
        add("shot", payload.get("shot_id"))
    elif collection == "templates":
        add("author", payload.get("author_id"))
        add("category", payload.get("category"))
        add("workflow", payload.get("workflow_key"))
    elif collection == "works":
        add("project", payload.get("project_id"))
        add("author", payload.get("author_id"))
        add("template", payload.get("template_id"))
        add("category", payload.get("category"))
        add("review_status", payload.get("review_status"))
    elif collection == "interactions":
        add("user", payload.get("user_id"))
        add("target", f"{payload.get('target_type')}:{payload.get('target_id')}")
        add("interaction_type", payload.get("interaction_type"))
    elif collection == "tasks":
        add("project", payload.get("project_id"))
        add("shot", payload.get("shot_id"))
        add("workflow", payload.get("workflow_key"))
        add("task_type", payload.get("task_type"))
        add("prompt", payload.get("prompt_id"))
    elif collection == "assets":
        add("asset_type", payload.get("asset_type"))
        add("source_task", payload.get("source_task_id"))
        add("content_hash", payload.get("content_hash"))
    elif collection == "credit_accounts":
        add("user", payload.get("user_id"))
    elif collection == "credit_transactions":
        add("user", payload.get("user_id"))
        add("transaction_type", payload.get("transaction_type"))
        add("related", f"{payload.get('related_type')}:{payload.get('related_id')}")
    elif collection == "revenue_shares":
        add("work", payload.get("work_id"))
        add("author", payload.get("author_id"))
        add("transaction", payload.get("transaction_id"))
    elif collection == "payment_orders":
        add("user", payload.get("user_id"))
        add("channel", payload.get("channel"))
        add("external_order", payload.get("external_order_id"))
    return relations


_ENUM_FIELDS = {
    Project: {"status": ProjectStatus},
    StoryboardShot: {"generation_status": TaskStatus},
    GenerationTask: {"task_type": TaskType, "status": TaskStatus},
    Asset: {"asset_type": AssetType},
    PublishedWork: {"review_status": WorkReviewStatus},
    Interaction: {"interaction_type": InteractionType},
    CreditTransaction: {"transaction_type": CreditTransactionType},
    PaymentOrder: {"status": PaymentOrderStatus},
}


def _restore_field(model: type[Any], key: str, value: Any) -> Any:
    if key in {"created_at", "updated_at", "last_login_at"} and isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return value
    enum_type = _ENUM_FIELDS.get(model, {}).get(key)
    if enum_type is not None and isinstance(value, str):
        return enum_type(value)
    return value


def _psycopg_connect(database_url: str) -> Any:
    try:
        import psycopg
    except ImportError as exc:  # pragma: no cover - 取决于生产依赖
        raise RuntimeError("未安装 psycopg，请先安装 PostgreSQL 依赖。") from exc
    return psycopg.connect(database_url)


def _row_value(row: Any, key: str) -> Any:
    if isinstance(row, dict):
        return row[key]
    mapping = {"collection": 0, "item_id": 1, "payload": 2}
    return row[mapping[key]]
