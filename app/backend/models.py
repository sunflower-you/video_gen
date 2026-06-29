from __future__ import annotations

from dataclasses import asdict, dataclass, field, is_dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4

from .generation_config import DEFAULT_NEGATIVE_PROMPT


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TaskType(str, Enum):
    SCRIPT_ANALYSIS = "script_analysis"
    IMAGE = "image"
    VIDEO = "video"
    TTS = "tts"
    COMPOSE = "compose"


class AssetType(str, Enum):
    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"
    SUBTITLE = "subtitle"
    COVER = "cover"
    OTHER = "other"


class ProjectStatus(str, Enum):
    DRAFT = "draft"
    GENERATING = "generating"
    COMPLETED = "completed"
    FAILED = "failed"


class WorkReviewStatus(str, Enum):
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    PUBLISHED = "published"
    REJECTED = "rejected"
    OFFLINE = "offline"


class InteractionType(str, Enum):
    LIKE = "like"
    FAVORITE = "favorite"
    FOLLOW = "follow"


class CreditTransactionType(str, Enum):
    GRANT = "grant"
    CONSUME = "consume"
    REFUND = "refund"
    REVENUE = "revenue"


class PaymentOrderStatus(str, Enum):
    PENDING = "pending"
    PAID = "paid"
    FAILED = "failed"
    CANCELLED = "cancelled"


class WithdrawalStatus(str, Enum):
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    REJECTED = "rejected"


@dataclass
class AuditFields:
    created_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)
    created_by: str = "system"
    status: str = "draft"

    def touch(self) -> None:
        self.updated_at = utc_now()


@dataclass
class User(AuditFields):
    id: str = field(default_factory=lambda: new_id("user"))
    nickname: str = ""
    email: str = ""
    avatar_url: str = ""
    bio: str = ""
    author_level: str = "普通"
    role: str = "creator"
    follower_count: int = 0
    password_hash: str = ""
    last_login_at: datetime | None = None
    status: str = "active"


@dataclass
class WorkflowSpec:
    workflow_key: str
    version: str
    display_name: str
    generation_type: TaskType
    workflow_path: str
    input_schema: dict[str, dict[str, Any]]
    default_params: dict[str, Any]
    output_nodes: dict[str, AssetType]
    description: str = ""
    applicable_scenarios: list[str] = field(default_factory=list)
    failure_hint: str = "请检查工作流参数、模型文件和 ComfyUI 队列状态后重试。"


@dataclass
class Project(AuditFields):
    id: str = field(default_factory=lambda: new_id("project"))
    title: str = ""
    project_type: str = "脚本成片"
    aspect_ratio: str = "9:16"
    owner_id: str = "system"
    current_step: str = "script"
    template_id: str | None = None
    workflow_key: str = ""
    default_params: dict[str, Any] = field(default_factory=dict)
    cover_url: str = ""
    final_video_url: str = ""
    script_id: str | None = None
    character_ids: list[str] = field(default_factory=list)
    shot_ids: list[str] = field(default_factory=list)
    subtitle_ids: list[str] = field(default_factory=list)
    timeline_item_ids: list[str] = field(default_factory=list)
    status: ProjectStatus = ProjectStatus.DRAFT


@dataclass
class Script(AuditFields):
    id: str = field(default_factory=lambda: new_id("script"))
    project_id: str = ""
    raw_text: str = ""
    rewritten_text: str = ""
    style: str = "漫剧"
    target_duration_seconds: int = 60
    language: str = "zh-CN"
    status: str = "draft"


@dataclass
class Character(AuditFields):
    id: str = field(default_factory=lambda: new_id("character"))
    project_id: str = ""
    name: str = ""
    description: str = ""
    reference_image_url: str = ""
    style_prompt: str = ""
    model_config: dict[str, Any] = field(default_factory=dict)
    status: str = "draft"


@dataclass
class StoryboardShot(AuditFields):
    id: str = field(default_factory=lambda: new_id("shot"))
    project_id: str = ""
    index: int = 1
    narration: str = ""
    visual_description: str = ""
    shot_size: str = "中景"
    characters: list[str] = field(default_factory=list)
    prompt: str = ""
    negative_prompt: str = DEFAULT_NEGATIVE_PROMPT
    generation_status: TaskStatus = TaskStatus.PENDING
    asset_ids: list[str] = field(default_factory=list)
    status: str = "draft"


@dataclass
class SubtitleCue(AuditFields):
    id: str = field(default_factory=lambda: new_id("subtitle"))
    project_id: str = ""
    shot_id: str = ""
    index: int = 1
    start_seconds: float = 0
    end_seconds: float = 4
    text: str = ""
    style: str = "底部白字黑描边"
    status: str = "draft"


@dataclass
class TimelineItem(AuditFields):
    id: str = field(default_factory=lambda: new_id("timeline"))
    project_id: str = ""
    shot_id: str = ""
    index: int = 1
    start_seconds: float = 0
    end_seconds: float = 4
    video_asset_id: str = ""
    audio_asset_id: str = ""
    subtitle_id: str = ""
    transition: str = "cut"
    status: str = "draft"


@dataclass
class WorkTemplate(AuditFields):
    id: str = field(default_factory=lambda: new_id("template"))
    name: str = ""
    description: str = ""
    category: str = "AI 漫剧"
    author_id: str = "system"
    cover_url: str = ""
    sample_video_url: str = ""
    workflow_key: str = ""
    parameter_schema: dict[str, Any] = field(default_factory=dict)
    default_params: dict[str, Any] = field(default_factory=dict)
    example_inputs: dict[str, Any] = field(default_factory=dict)
    applicable_scenarios: list[str] = field(default_factory=list)
    usage_count: int = 0
    status: str = "published"


@dataclass
class ProjectGraph(AuditFields):
    id: str = field(default_factory=lambda: new_id("graph"))
    project_id: str = ""
    nodes: list[dict[str, Any]] = field(default_factory=list)
    edges: list[dict[str, Any]] = field(default_factory=list)
    viewport: dict[str, Any] = field(default_factory=lambda: {"x": 0, "y": 0, "zoom": 1})
    status: str = "draft"


@dataclass
class GenerationTask(AuditFields):
    id: str = field(default_factory=lambda: new_id("task"))
    task_type: TaskType = TaskType.IMAGE
    workflow_key: str = ""
    project_id: str = ""
    shot_id: str | None = None
    status: TaskStatus = TaskStatus.PENDING
    progress: int = 0
    prompt_id: str = ""
    input_params: dict[str, Any] = field(default_factory=dict)
    output_asset_ids: list[str] = field(default_factory=list)
    error_message: str = ""
    provider_error: str = ""
    retry_advice: str = ""
    events: list[dict[str, Any]] = field(default_factory=list)
    credit_cost: int = 0
    billing_transaction_id: str = ""


@dataclass
class PublishedWork(AuditFields):
    id: str = field(default_factory=lambda: new_id("work"))
    project_id: str = ""
    title: str = ""
    description: str = ""
    cover_url: str = ""
    video_url: str = ""
    category: str = "AI 漫剧"
    tags: list[str] = field(default_factory=list)
    author_id: str = "system"
    template_id: str = ""
    template_name: str = ""
    review_status: WorkReviewStatus = WorkReviewStatus.DRAFT
    like_count: int = 0
    favorite_count: int = 0
    view_count: int = 0


@dataclass
class Interaction(AuditFields):
    id: str = field(default_factory=lambda: new_id("interaction"))
    user_id: str = ""
    target_type: str = "work"
    target_id: str = ""
    interaction_type: InteractionType = InteractionType.LIKE


@dataclass
class Asset(AuditFields):
    id: str = field(default_factory=lambda: new_id("asset"))
    asset_type: AssetType = AssetType.OTHER
    url: str = ""
    local_path: str = ""
    mime_type: str = ""
    width: int | None = None
    height: int | None = None
    duration_seconds: float | None = None
    content_hash: str = ""
    source_task_id: str = ""


@dataclass
class CreditAccount(AuditFields):
    id: str = field(default_factory=lambda: new_id("credit_account"))
    user_id: str = ""
    balance: int = 0
    total_granted: int = 0
    total_consumed: int = 0
    total_earned: int = 0
    status: str = "active"


@dataclass
class CreditTransaction(AuditFields):
    id: str = field(default_factory=lambda: new_id("credit_txn"))
    user_id: str = ""
    transaction_type: CreditTransactionType = CreditTransactionType.GRANT
    amount: int = 0
    balance_after: int = 0
    related_type: str = ""
    related_id: str = ""
    description: str = ""
    status: str = "posted"


@dataclass
class RevenueShare(AuditFields):
    id: str = field(default_factory=lambda: new_id("revenue"))
    work_id: str = ""
    author_id: str = ""
    gross_credits: int = 0
    author_credits: int = 0
    platform_credits: int = 0
    transaction_id: str = ""
    source: str = "manual"
    status: str = "posted"


@dataclass
class PaymentOrder(AuditFields):
    id: str = field(default_factory=lambda: new_id("payment"))
    user_id: str = ""
    channel: str = "manual"
    external_order_id: str = ""
    credits: int = 0
    amount_cents: int = 0
    currency: str = "CNY"
    checkout_url: str = ""
    transaction_id: str = ""
    provider_payload: dict[str, Any] = field(default_factory=dict)
    status: PaymentOrderStatus = PaymentOrderStatus.PENDING


@dataclass
class SubscriptionPlan(AuditFields):
    id: str = field(default_factory=lambda: new_id("subscription"))
    user_id: str = ""
    plan_code: str = "creator_pro"
    plan_name: str = "创作者专业版"
    billing_cycle: str = "monthly"
    credit_cost: int = 0
    benefits: dict[str, Any] = field(default_factory=dict)
    transaction_id: str = ""
    starts_at: datetime = field(default_factory=utc_now)
    ends_at: datetime | None = None
    status: str = "active"


@dataclass
class WithdrawalRequest(AuditFields):
    id: str = field(default_factory=lambda: new_id("withdrawal"))
    user_id: str = ""
    amount_credits: int = 0
    payout_channel: str = "manual"
    payout_account: str = ""
    applicant_note: str = ""
    reviewer_id: str = ""
    review_note: str = ""
    transaction_id: str = ""
    provider_payout_id: str = ""
    provider_payload: dict[str, Any] = field(default_factory=dict)
    payout_dispatch_status: str = "not_configured"
    payout_dispatch_message: str = ""
    status: WithdrawalStatus = WithdrawalStatus.PENDING_REVIEW


@dataclass
class ComfyStatus:
    connected: bool
    message: str
    queue_running: int = 0
    queue_pending: int = 0
    system: dict[str, Any] = field(default_factory=dict)


def to_jsonable(value: Any) -> Any:
    if is_dataclass(value):
        return {key: to_jsonable(item) for key, item in asdict(value).items()}
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, list):
        return [to_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {key: to_jsonable(item) for key, item in value.items()}
    return value
