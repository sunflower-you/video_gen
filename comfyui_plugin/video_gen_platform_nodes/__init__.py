from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any


class PlatformBusinessInput:
    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        return {
            "required": {
                "prompt": ("STRING", {"multiline": True, "default": ""}),
                "width": ("INT", {"default": 768, "min": 64, "max": 4096, "step": 8}),
                "height": ("INT", {"default": 1344, "min": 64, "max": 4096, "step": 8}),
                "seed": ("INT", {"default": -1, "min": -1, "max": 2**31 - 1}),
            },
            "optional": {
                "negative_prompt": ("STRING", {"multiline": True, "default": ""}),
                "metadata_json": ("STRING", {"multiline": True, "default": "{}"}),
            },
        }

    RETURN_TYPES = ("STRING", "INT", "INT", "INT", "STRING", "STRING")
    RETURN_NAMES = ("prompt", "width", "height", "seed", "negative_prompt", "metadata_json")
    FUNCTION = "forward"
    CATEGORY = "VideoGen/Platform"

    def forward(
        self,
        prompt: str,
        width: int,
        height: int,
        seed: int,
        negative_prompt: str = "",
        metadata_json: str = "{}",
    ) -> tuple[str, int, int, int, str, str]:
        _validate_metadata(metadata_json)
        return (
            str(prompt),
            int(width),
            int(height),
            int(seed),
            str(negative_prompt),
            metadata_json or "{}",
        )


class PlatformArchiveCallback:
    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        return {
            "required": {
                "platform_api_url": ("STRING", {"default": "http://127.0.0.1:8000"}),
                "task_id": ("STRING", {"default": ""}),
                "output_node": ("STRING", {"default": ""}),
                "output_payload_json": ("STRING", {"multiline": True, "default": "{}"}),
            },
            "optional": {
                "platform_api_token": ("STRING", {"default": ""}),
                "timeout_seconds": ("INT", {"default": 10, "min": 1, "max": 120}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("response_json",)
    FUNCTION = "notify"
    CATEGORY = "VideoGen/Platform"
    OUTPUT_NODE = True

    def notify(
        self,
        platform_api_url: str,
        task_id: str,
        output_node: str,
        output_payload_json: str,
        platform_api_token: str = "",
        timeout_seconds: int = 10,
    ) -> tuple[str]:
        if not task_id.strip():
            raise ValueError("平台任务 ID 不能为空。")
        payload = {
            "output_node": output_node,
            "output": _json_object(output_payload_json),
        }
        endpoint = f"{platform_api_url.rstrip('/')}/api/comfy/tasks/{task_id}/sync"
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = {"Content-Type": "application/json; charset=utf-8"}
        if platform_api_token.strip():
            headers["Authorization"] = f"Bearer {platform_api_token.strip()}"
        request = urllib.request.Request(endpoint, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=int(timeout_seconds)) as response:
                response_body = response.read().decode("utf-8")
        except urllib.error.URLError as exc:
            raise RuntimeError(f"平台归档回调失败：{exc}") from exc
        return (response_body or "{}",)


class PlatformShotInput:
    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        return {
            "required": {
                "shot_id": ("STRING", {"default": ""}),
                "narration": ("STRING", {"multiline": True, "default": ""}),
                "visual_description": ("STRING", {"multiline": True, "default": ""}),
                "shot_size": ("STRING", {"default": "中景"}),
                "characters_json": ("STRING", {"multiline": True, "default": "[]"}),
                "prompt": ("STRING", {"multiline": True, "default": ""}),
                "negative_prompt": ("STRING", {"multiline": True, "default": ""}),
            },
            "optional": {
                "first_frame_url": ("STRING", {"default": ""}),
                "duration": ("FLOAT", {"default": 4.0, "min": 1.0, "max": 30.0, "step": 0.5}),
                "fps": ("INT", {"default": 16, "min": 1, "max": 60}),
                "metadata_json": ("STRING", {"multiline": True, "default": "{}"}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING", "STRING", "STRING", "STRING", "FLOAT", "INT", "STRING")
    RETURN_NAMES = (
        "shot_id",
        "narration",
        "visual_description",
        "shot_size",
        "characters_json",
        "prompt",
        "first_frame_url",
        "duration",
        "fps",
        "metadata_json",
    )
    FUNCTION = "forward"
    CATEGORY = "VideoGen/Platform"

    def forward(
        self,
        shot_id: str,
        narration: str,
        visual_description: str,
        shot_size: str,
        characters_json: str,
        prompt: str,
        negative_prompt: str,
        first_frame_url: str = "",
        duration: float = 4.0,
        fps: int = 16,
        metadata_json: str = "{}",
    ) -> tuple[str, str, str, str, str, str, str, float, int, str]:
        _json_list(characters_json or "[]", field_name="角色列表")
        _validate_metadata(metadata_json)
        normalized_prompt = _join_prompt_parts(prompt, visual_description, shot_size, narration)
        normalized_metadata = _merge_metadata(
            metadata_json,
            {
                "shot_id": str(shot_id),
                "shot_size": str(shot_size),
                "negative_prompt": str(negative_prompt),
            },
        )
        return (
            str(shot_id),
            str(narration),
            str(visual_description),
            str(shot_size),
            characters_json or "[]",
            normalized_prompt,
            str(first_frame_url),
            float(duration),
            int(fps),
            normalized_metadata,
        )


class PlatformTtsInput:
    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        return {
            "required": {
                "text": ("STRING", {"multiline": True, "default": ""}),
                "voice": ("STRING", {"default": "zh-CN-XiaoxiaoNeural"}),
                "rate": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 2.0, "step": 0.05}),
                "pitch": ("FLOAT", {"default": 1.0, "min": 0.5, "max": 2.0, "step": 0.05}),
            },
            "optional": {
                "shot_id": ("STRING", {"default": ""}),
                "metadata_json": ("STRING", {"multiline": True, "default": "{}"}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "FLOAT", "FLOAT", "STRING", "STRING")
    RETURN_NAMES = ("text", "voice", "rate", "pitch", "shot_id", "metadata_json")
    FUNCTION = "forward"
    CATEGORY = "VideoGen/Platform"

    def forward(
        self,
        text: str,
        voice: str,
        rate: float,
        pitch: float,
        shot_id: str = "",
        metadata_json: str = "{}",
    ) -> tuple[str, str, float, float, str, str]:
        if not str(text).strip():
            raise ValueError("配音文本不能为空。")
        normalized_metadata = _merge_metadata(metadata_json, {"shot_id": str(shot_id), "voice": str(voice)})
        return (str(text), str(voice), float(rate), float(pitch), str(shot_id), normalized_metadata)


class PlatformComposeManifest:
    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        return {
            "required": {
                "project_id": ("STRING", {"default": ""}),
                "timeline_json": ("STRING", {"multiline": True, "default": "[]"}),
                "subtitle_json": ("STRING", {"multiline": True, "default": "[]"}),
            },
            "optional": {
                "bgm_url": ("STRING", {"default": ""}),
                "aspect_ratio": ("STRING", {"default": "9:16"}),
                "metadata_json": ("STRING", {"multiline": True, "default": "{}"}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("project_id", "timeline_json", "subtitle_json", "bgm_url", "aspect_ratio", "metadata_json")
    FUNCTION = "forward"
    CATEGORY = "VideoGen/Platform"

    def forward(
        self,
        project_id: str,
        timeline_json: str,
        subtitle_json: str,
        bgm_url: str = "",
        aspect_ratio: str = "9:16",
        metadata_json: str = "{}",
    ) -> tuple[str, str, str, str, str, str]:
        if not str(project_id).strip():
            raise ValueError("平台项目 ID 不能为空。")
        _json_list(timeline_json or "[]", field_name="时间线")
        _json_list(subtitle_json or "[]", field_name="字幕")
        normalized_metadata = _merge_metadata(
            metadata_json,
            {
                "project_id": str(project_id),
                "aspect_ratio": str(aspect_ratio),
                "bgm_url": str(bgm_url),
            },
        )
        return (
            str(project_id),
            timeline_json or "[]",
            subtitle_json or "[]",
            str(bgm_url),
            str(aspect_ratio),
            normalized_metadata,
        )


NODE_CLASS_MAPPINGS = {
    "PlatformBusinessInput": PlatformBusinessInput,
    "PlatformArchiveCallback": PlatformArchiveCallback,
    "PlatformShotInput": PlatformShotInput,
    "PlatformTtsInput": PlatformTtsInput,
    "PlatformComposeManifest": PlatformComposeManifest,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PlatformBusinessInput": "平台业务输入",
    "PlatformArchiveCallback": "平台归档回调",
    "PlatformShotInput": "平台镜头输入",
    "PlatformTtsInput": "平台配音输入",
    "PlatformComposeManifest": "平台合成清单",
}


def _validate_metadata(value: str) -> None:
    _json_object(value or "{}")


def _json_object(value: str) -> dict[str, Any]:
    try:
        payload = json.loads(value or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError("JSON 参数格式不正确。") from exc
    if not isinstance(payload, dict):
        raise ValueError("JSON 参数必须是对象。")
    return payload


def _json_list(value: str, *, field_name: str) -> list[Any]:
    try:
        payload = json.loads(value or "[]")
    except json.JSONDecodeError as exc:
        raise ValueError(f"{field_name} JSON 格式不正确。") from exc
    if not isinstance(payload, list):
        raise ValueError(f"{field_name} JSON 必须是数组。")
    return payload


def _merge_metadata(metadata_json: str, extra: dict[str, Any]) -> str:
    metadata = _json_object(metadata_json or "{}")
    metadata.update({key: value for key, value in extra.items() if value not in {None, ""}})
    return json.dumps(metadata, ensure_ascii=False, sort_keys=True)


def _join_prompt_parts(prompt: str, visual_description: str, shot_size: str, narration: str) -> str:
    parts = [str(prompt).strip(), str(visual_description).strip(), str(shot_size).strip(), str(narration).strip()]
    return "，".join(part for part in parts if part)
