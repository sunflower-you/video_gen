from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .errors import NotFoundError, WorkflowValidationError
from .models import AssetType, TaskType, WorkflowSpec, to_jsonable


class WorkflowRegistry:
    def __init__(self) -> None:
        self._items: dict[str, WorkflowSpec] = {}

    def register(self, spec: WorkflowSpec) -> None:
        if not spec.workflow_key:
            raise WorkflowValidationError("工作流 key 不能为空。")
        if not spec.input_schema:
            raise WorkflowValidationError(f"工作流 {spec.workflow_key} 缺少输入参数定义。")
        if not spec.output_nodes:
            raise WorkflowValidationError(f"工作流 {spec.workflow_key} 缺少输出节点映射。")
        unknown_defaults = set(spec.default_params) - set(spec.input_schema)
        if unknown_defaults:
            raise WorkflowValidationError(f"工作流 {spec.workflow_key} 默认参数未在输入 schema 中声明：{', '.join(sorted(unknown_defaults))}")
        for name, value in spec.default_params.items():
            if _has_value(value):
                try:
                    _validate_type(name, value, spec.input_schema[name])
                except WorkflowValidationError as exc:
                    raise WorkflowValidationError(f"工作流 {spec.workflow_key} 默认参数无效：{exc.message}") from exc
        self._items[spec.workflow_key] = spec

    def get(self, workflow_key: str) -> WorkflowSpec:
        try:
            return self._items[workflow_key]
        except KeyError as exc:
            raise NotFoundError(f"未找到工作流：{workflow_key}") from exc

    def list(self) -> list[WorkflowSpec]:
        return sorted(self._items.values(), key=lambda item: item.workflow_key)

    def validate_params(self, workflow_key: str, params: dict[str, Any]) -> dict[str, Any]:
        spec = self.get(workflow_key)
        unknown_params = set(params) - set(spec.input_schema)
        if unknown_params:
            raise WorkflowValidationError(f"工作流参数未在输入 schema 中声明：{', '.join(sorted(unknown_params))}")
        merged = dict(spec.default_params)
        merged.update(params)
        for name, rule in spec.input_schema.items():
            if rule.get("required", False) and not _has_value(merged.get(name)):
                label = rule.get("label", name)
                raise WorkflowValidationError(f"参数“{label}”不能为空。")
            if name in merged and _has_value(merged[name]):
                _validate_type(name, merged[name], rule)
        return merged

    def to_payload(self) -> list[dict[str, Any]]:
        return [to_jsonable(item) for item in self.list()]


def load_registry(path: str | Path, *, fallback_to_default: bool = True) -> WorkflowRegistry:
    registry = WorkflowRegistry()
    root = Path(path)
    files = [root] if root.is_file() else sorted(root.rglob("*.registry.json"))
    for file_path in files:
        data = json.loads(file_path.read_text(encoding="utf-8"))
        workflow_path, workflow_data = _load_workflow_adapter(file_path, data)
        registry.register(
            WorkflowSpec(
                workflow_key=data["workflow_key"],
                version=data.get("version", "1.0.0"),
                display_name=data["display_name"],
                generation_type=TaskType(data["generation_type"]),
                workflow_path=str(workflow_path),
                input_schema=data["input_schema"],
                default_params=data.get("default_params", {}),
                output_nodes={key: AssetType(value) for key, value in data["output_nodes"].items()},
                description=data.get("description", ""),
                applicable_scenarios=list(data.get("applicable_scenarios", [])),
                failure_hint=data.get("failure_hint", "请检查工作流参数、模型文件和 ComfyUI 队列状态后重试。"),
            )
        )
        _validate_workflow_adapter(data, workflow_data)
    if not registry.list() and fallback_to_default:
        return default_registry()
    return registry


def default_registry() -> WorkflowRegistry:
    registry = WorkflowRegistry()
    registry.register(
        WorkflowSpec(
            workflow_key="platform/script_analysis",
            version="1.0.0",
            display_name="平台脚本分镜分析",
            generation_type=TaskType.SCRIPT_ANALYSIS,
            workflow_path="workflows/platform/script_analysis.json",
            input_schema={
                "script": {"type": "string", "required": True, "label": "脚本文本"},
                "style": {"type": "string", "required": False, "label": "风格"},
                "target_duration_seconds": {"type": "integer", "required": False, "label": "目标时长"},
                "main_character": {"type": "string", "required": False, "label": "主角名称"},
                "reference_image_url": {"type": "string", "required": False, "label": "参考图 URL"},
            },
            default_params={
                "style": "电影感国漫短剧",
                "target_duration_seconds": 60,
                "main_character": "主角",
                "reference_image_url": "",
            },
            output_nodes={"storyboard": AssetType.OTHER},
            description="把短视频或漫剧脚本拆解为角色设定和可编辑分镜草稿。",
            applicable_scenarios=["脚本拆解", "分镜草稿", "角色设定"],
        )
    )
    registry.register(
        WorkflowSpec(
            workflow_key="selfhost/image_flux",
            version="1.0.0",
            display_name="Flux 分镜图生成",
            generation_type=TaskType.IMAGE,
            workflow_path="workflows/selfhost/image_flux.json",
            input_schema={
                "prompt": {"type": "string", "required": True, "label": "画面提示词"},
                "negative_prompt": {"type": "string", "required": False, "label": "负面提示词"},
                "width": {"type": "integer", "required": True, "label": "宽度"},
                "height": {"type": "integer", "required": True, "label": "高度"},
                "seed": {"type": "integer", "required": False, "label": "随机种子"},
            },
            default_params={"negative_prompt": "", "width": 768, "height": 1344, "seed": -1},
            output_nodes={"9": AssetType.IMAGE},
            description="根据分镜画面描述生成竖屏漫剧首帧或分镜图。",
            applicable_scenarios=["分镜首帧", "角色海报", "概念设计"],
        )
    )
    registry.register(
        WorkflowSpec(
            workflow_key="selfhost/video_wan2.1_fusionx",
            version="1.0.0",
            display_name="Wan2.1 镜头视频生成",
            generation_type=TaskType.VIDEO,
            workflow_path="workflows/selfhost/video_wan2.1_fusionx.json",
            input_schema={
                "prompt": {"type": "string", "required": True, "label": "动作描述"},
                "negative_prompt": {"type": "string", "required": False, "label": "负面提示词"},
                "first_frame_url": {"type": "string", "required": True, "label": "首帧图片"},
                "duration": {"type": "number", "required": True, "label": "时长"},
                "fps": {"type": "integer", "required": True, "label": "帧率"},
            },
            default_params={"negative_prompt": "", "duration": 4, "fps": 16},
            output_nodes={"18": AssetType.VIDEO},
            description="基于首帧和动作描述生成单个镜头视频。",
            applicable_scenarios=["镜头视频", "动画短片", "短片剧集"],
        )
    )
    registry.register(
        WorkflowSpec(
            workflow_key="selfhost/tts_edge",
            version="1.0.0",
            display_name="中文旁白配音",
            generation_type=TaskType.TTS,
            workflow_path="workflows/selfhost/tts_edge.json",
            input_schema={
                "text": {"type": "string", "required": True, "label": "旁白文本"},
                "voice": {"type": "string", "required": True, "label": "音色"},
                "rate": {"type": "number", "required": False, "label": "语速"},
            },
            default_params={"voice": "zh-CN-XiaoxiaoNeural", "rate": 1.0},
            output_nodes={"6": AssetType.AUDIO},
            description="为分镜旁白生成中文音频。",
            applicable_scenarios=["旁白配音", "字幕口播", "角色独白"],
        )
    )
    registry.register(
        WorkflowSpec(
            workflow_key="platform/compose",
            version="1.0.0",
            display_name="平台成片合成",
            generation_type=TaskType.COMPOSE,
            workflow_path="workflows/platform/compose.json",
            input_schema={
                "project_id": {"type": "string", "required": True, "label": "项目 ID"},
                "shot_ids": {"type": "array", "required": True, "label": "分镜列表"},
                "timeline": {"type": "array", "required": True, "label": "时间线"},
                "subtitles": {"type": "array", "required": True, "label": "字幕列表"},
                "subtitle": {"type": "boolean", "required": False, "label": "字幕"},
                "voice": {"type": "string", "required": False, "label": "音色"},
                "bgm_url": {"type": "string", "required": False, "label": "背景音乐"},
            },
            default_params={"subtitle": True, "voice": "zh-CN-XiaoxiaoNeural", "bgm_url": ""},
            output_nodes={"30": AssetType.VIDEO},
            description="把镜头视频、旁白、字幕和背景音乐合成为最终成片。",
            applicable_scenarios=["成片合成", "字幕压制", "批量导出"],
        )
    )
    return registry


def _has_value(value: Any) -> bool:
    return value is not None and value != ""


def _load_workflow_adapter(file_path: Path, data: dict[str, Any]) -> tuple[Path, dict[str, Any]]:
    raw_workflow_path = data.get("workflow_path")
    if not raw_workflow_path:
        raise WorkflowValidationError(f"工作流 registry 缺少 workflow_path：{file_path}")
    workflow_path = Path(raw_workflow_path)
    candidates = [workflow_path]
    if not workflow_path.is_absolute():
        candidates.append(file_path.parent / workflow_path)
    for candidate in candidates:
        if candidate.exists():
            return candidate, json.loads(candidate.read_text(encoding="utf-8"))
    raise WorkflowValidationError(f"工作流文件不存在：{raw_workflow_path}")


def _validate_workflow_adapter(data: dict[str, Any], workflow_data: dict[str, Any]) -> None:
    workflow_key = data["workflow_key"]
    if workflow_data.get("workflow_key") != workflow_key:
        raise WorkflowValidationError(f"工作流 {workflow_key} 的 adapter 文件 workflow_key 不一致。")
    adapter_inputs = set(workflow_data.get("inputs", {}))
    registry_inputs = set(data.get("input_schema", {}))
    if adapter_inputs != registry_inputs:
        missing = sorted(registry_inputs - adapter_inputs)
        extra = sorted(adapter_inputs - registry_inputs)
        details = []
        if missing:
            details.append(f"adapter 缺少输入：{', '.join(missing)}")
        if extra:
            details.append(f"adapter 存在未声明输入：{', '.join(extra)}")
        raise WorkflowValidationError(f"工作流 {workflow_key} 输入定义不一致：{'；'.join(details)}")
    adapter_outputs = set(workflow_data.get("outputs", {}))
    missing_outputs = sorted(set(data.get("output_nodes", {})) - adapter_outputs)
    if missing_outputs:
        raise WorkflowValidationError(f"工作流 {workflow_key} 输出节点未在 adapter 文件声明：{', '.join(missing_outputs)}")


def _validate_type(name: str, value: Any, rule: dict[str, Any]) -> None:
    expected = rule.get("type")
    label = rule.get("label", name)
    if expected == "string" and not isinstance(value, str):
        raise WorkflowValidationError(f"参数“{label}”必须是文本。")
    if expected == "integer" and (not isinstance(value, int) or isinstance(value, bool)):
        raise WorkflowValidationError(f"参数“{label}”必须是整数。")
    if expected == "number" and (not isinstance(value, (int, float)) or isinstance(value, bool)):
        raise WorkflowValidationError(f"参数“{label}”必须是数字。")
    if expected == "array" and not isinstance(value, list):
        raise WorkflowValidationError(f"参数“{label}”必须是列表。")
    if expected == "boolean" and not isinstance(value, bool):
        raise WorkflowValidationError(f"参数“{label}”必须是布尔值。")
