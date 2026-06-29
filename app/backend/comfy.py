from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from .errors import ComfyConnectionError, PlatformError
from .models import ComfyStatus


class ComfyClient:
    def __init__(self, base_url: str = "http://127.0.0.1:8188", timeout: float = 3.0, api_key: str = "") -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.api_key = api_key.strip()

    def status(self) -> ComfyStatus:
        try:
            system = self._get_json("/system_stats")
            queue = self._get_json("/queue")
        except PlatformError as exc:
            return ComfyStatus(connected=False, message=exc.message)

        running = len(queue.get("queue_running", [])) if isinstance(queue, dict) else 0
        pending = len(queue.get("queue_pending", [])) if isinstance(queue, dict) else 0
        return ComfyStatus(
            connected=True,
            message="ComfyUI 已连接",
            queue_running=running,
            queue_pending=pending,
            system=system if isinstance(system, dict) else {},
        )

    def submit_prompt(self, workflow: dict[str, Any], client_id: str) -> str:
        payload = {"prompt": workflow, "client_id": client_id}
        data = self._post_json("/prompt", payload)
        prompt_id = data.get("prompt_id")
        if not prompt_id:
            raise PlatformError("ComfyUI 未返回任务 ID。", provider_error=json.dumps(data, ensure_ascii=False))
        return str(prompt_id)

    def history(self, prompt_id: str) -> dict[str, Any]:
        data = self._get_json(f"/history/{urllib.parse.quote(prompt_id)}")
        if not isinstance(data, dict):
            raise PlatformError("ComfyUI 历史记录格式异常。")
        return data

    def download_output(self, output: dict[str, object]) -> bytes:
        filename = str(output.get("filename", "")).strip()
        if not filename:
            raise PlatformError("ComfyUI 输出缺少文件名。")
        params = {
            "filename": filename,
            "subfolder": str(output.get("subfolder", "")).strip(),
            "type": str(output.get("type", "output")).strip() or "output",
        }
        query = urllib.parse.urlencode(params)
        return self._get_bytes(f"/view?{query}")

    def cancel_prompt(self, prompt_id: str) -> None:
        prompt_id = str(prompt_id or "").strip()
        if not prompt_id:
            return
        failures: list[PlatformError] = []
        try:
            self._post_json("/queue", {"delete": [prompt_id]})
        except PlatformError as exc:
            failures.append(exc)
        try:
            self._post_json("/interrupt", {})
        except PlatformError as exc:
            failures.append(exc)
        if len(failures) >= 2:
            provider_error = "；".join(item.provider_error or item.message for item in failures)
            raise PlatformError(
                "ComfyUI 取消请求失败。",
                provider_error=provider_error,
                retry_advice="请检查 ComfyUI 队列状态，必要时在 ComfyUI 后台手动中断任务。",
            )

    def _get_json(self, path: str) -> Any:
        request = urllib.request.Request(f"{self.base_url}{path}", method="GET", headers=self._headers())
        return self._open_json(request)

    def _get_bytes(self, path: str) -> bytes:
        request = urllib.request.Request(f"{self.base_url}{path}", method="GET", headers=self._headers())
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            provider_error = _http_error_body(exc)
            raise PlatformError(
                f"ComfyUI 输出文件下载失败（HTTP {exc.code}）。",
                provider_error=provider_error,
                retry_advice="请检查 ComfyUI 输出文件是否仍在历史记录中，或改用共享输出目录。",
            ) from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise ComfyConnectionError(
                "ComfyUI 输出文件下载失败，请确认服务已启动并检查地址配置。",
                provider_error=str(exc),
                retry_advice="启动 ComfyUI 后重试，或检查 COMFYUI_BASE_URL 环境变量。",
            ) from exc

    def _post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=body,
            method="POST",
            headers=self._headers({"Content-Type": "application/json"}),
        )
        data = self._open_json(request)
        if not isinstance(data, dict):
            raise PlatformError("ComfyUI 返回格式异常。")
        return data

    def _open_json(self, request: urllib.request.Request) -> Any:
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            provider_error = _http_error_body(exc)
            raise PlatformError(
                f"ComfyUI 请求失败（HTTP {exc.code}）。",
                provider_error=provider_error,
                retry_advice="请检查工作流节点、模型文件和 ComfyUI 后台错误后重试。",
            ) from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise ComfyConnectionError(
                "ComfyUI 未连接，请确认服务已启动并检查地址配置。",
                provider_error=str(exc),
                retry_advice="启动 ComfyUI 后重试，或检查 COMFYUI_BASE_URL 环境变量。",
            ) from exc
        except json.JSONDecodeError as exc:
            raise PlatformError("ComfyUI 返回了无法解析的数据。", provider_error=str(exc)) from exc

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        headers = dict(extra or {})
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers


def _http_error_body(exc: urllib.error.HTTPError) -> str:
    try:
        body = exc.read().decode("utf-8", errors="replace")
    except OSError:
        body = ""
    body = body.strip()
    if body:
        return body[:2000]
    return str(exc)
