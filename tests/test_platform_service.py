from __future__ import annotations

import hashlib
import hmac
import json
import struct
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

from app.backend.alerts import WebhookAlertNotifier, create_alert_notifier_from_env
from app.backend.errors import NotFoundError, WorkflowValidationError
from app.backend.generation_config import DEFAULT_NEGATIVE_PROMPT, manual_shot_prompt, storyboard_prompt
from app.backend.models import Asset, AssetType, ComfyStatus, PaymentOrderStatus, ProjectStatus, PublishedWork, TaskStatus, TaskType, WorkReviewStatus, WorkTemplate
from app.backend.payout import PayoutDispatchResult, WebhookPayoutDispatcher, create_payout_dispatcher_from_env
from app.backend.repository import JsonFileRepository, PostgresJsonRepository
from app.backend.service import PlatformService, payment_signature_payload
from app.backend.storage import LocalStorage, S3CompatibleStorage
from app.backend.worker import execute_job, run_once
from app.backend.workflows import default_registry


class FakeComfy:
    def __init__(self) -> None:
        self.fail_submit = False
        self.history_payload = {}
        self.submitted_workflow = {}
        self.cancelled_prompt_ids = []

    def status(self) -> ComfyStatus:
        return ComfyStatus(
            connected=True,
            message="ComfyUI 已连接",
            queue_running=1,
            queue_pending=2,
            system={"devices": [{"name": "测试 GPU"}]},
        )

    def submit_prompt(self, workflow, client_id: str) -> str:
        self.submitted_workflow = workflow
        if self.fail_submit:
            from app.backend.errors import PlatformError

            raise PlatformError(
                "ComfyUI 任务提交失败。",
                provider_error="mock submit error",
                retry_advice="请检查 ComfyUI 队列后重试。",
            )
        return "prompt_test_001"

    def history(self, prompt_id: str):
        return self.history_payload or {prompt_id: {"status": {"completed": True}}}

    def cancel_prompt(self, prompt_id: str) -> None:
        self.cancelled_prompt_ids.append(prompt_id)


class OfflineComfy(FakeComfy):
    def status(self) -> ComfyStatus:
        return ComfyStatus(connected=False, message="ComfyUI 未连接", queue_running=0, queue_pending=0)


class RemoteOutputComfy(FakeComfy):
    def __init__(self) -> None:
        super().__init__()
        self.downloaded_outputs = []
        self.remote_outputs: dict[tuple[str, str, str], bytes] = {}

    def download_output(self, output):
        self.downloaded_outputs.append(dict(output))
        key = (
            str(output.get("filename", "")),
            str(output.get("subfolder", "")),
            str(output.get("type", "output") or "output"),
        )
        if key not in self.remote_outputs:
            from app.backend.errors import PlatformError

            raise PlatformError("ComfyUI 输出文件下载失败。", provider_error=f"远端输出不存在：{key}")
        return self.remote_outputs[key]


class CapturingAlertNotifier:
    def __init__(self) -> None:
        self.health_payloads = []

    def notify_health(self, health):
        self.health_payloads.append(health)
        from app.backend.alerts import AlertDeliveryResult

        return AlertDeliveryResult(
            delivered=bool(health.get("alerts")),
            skipped=not bool(health.get("alerts")),
            alert_count=len(health.get("alerts") or []),
            status_code=200 if health.get("alerts") else 0,
            message="测试告警通知已处理。",
        )


class CapturingPayoutDispatcher:
    def __init__(self, result: PayoutDispatchResult) -> None:
        self.result = result
        self.withdrawals = []

    def dispatch_withdrawal(self, withdrawal):
        self.withdrawals.append(withdrawal)
        return self.result


class CapturingS3Storage(S3CompatibleStorage):
    def __init__(self, root: str | Path, **kwargs) -> None:
        super().__init__(root, **kwargs)
        self.uploads = []
        self.deletes = []

    def _put_object(self, *, object_key: str, source_path: Path, content_type: str, content_hash: str) -> None:
        self.uploads.append(
            {
                "object_key": object_key,
                "source_path": source_path,
                "content_type": content_type,
                "content_hash": content_hash,
                "body": source_path.read_bytes(),
            }
        )

    def _delete_object(self, *, object_key: str) -> None:
        self.deletes.append(object_key)


class FakePostgresCursor:
    def __init__(self, connection) -> None:
        self.connection = connection

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        return None

    def execute(self, sql: str, params=None) -> None:
        self.connection.statements.append((sql, params))
        normalized = " ".join(sql.split()).upper()
        if normalized.startswith("INSERT INTO") and "_RELATIONS" in normalized:
            collection, item_id, relation_type, relation_id = params[:4]
            self.connection.relation_rows.add((collection, item_id, relation_type, relation_id))
        elif normalized.startswith("INSERT INTO"):
            collection, item_id, payload = params[:3]
            self.connection.rows[(collection, item_id)] = payload
        elif normalized.startswith("DELETE FROM") and "_RELATIONS" in normalized and "ITEM_ID <> ALL" in normalized:
            collection, kept_ids = params
            kept = set(kept_ids)
            for key in list(self.connection.relation_rows):
                if key[0] == collection and key[1] not in kept:
                    self.connection.relation_rows.discard(key)
        elif normalized.startswith("DELETE FROM") and "_RELATIONS" in normalized and "ITEM_ID =" in normalized:
            collection, item_id = params
            for key in list(self.connection.relation_rows):
                if key[0] == collection and key[1] == item_id:
                    self.connection.relation_rows.discard(key)
        elif normalized.startswith("DELETE FROM") and "_RELATIONS" in normalized:
            collection = params[0]
            for key in list(self.connection.relation_rows):
                if key[0] == collection:
                    self.connection.relation_rows.discard(key)
        elif normalized.startswith("DELETE FROM") and "ITEM_ID <> ALL" in normalized:
            collection, kept_ids = params
            kept = set(kept_ids)
            for key in list(self.connection.rows):
                if key[0] == collection and key[1] not in kept:
                    self.connection.rows.pop(key, None)
        elif normalized.startswith("DELETE FROM"):
            collection = params[0]
            for key in list(self.connection.rows):
                if key[0] == collection:
                    self.connection.rows.pop(key, None)

    def fetchall(self):
        return [
            {
                "collection": collection,
                "item_id": item_id,
                "payload": payload,
            }
            for (collection, item_id), payload in self.connection.rows.items()
        ]


class FakePostgresConnection:
    def __init__(self, rows=None) -> None:
        self.rows = dict(rows or {})
        self.relation_rows = set()
        self.statements = []
        self.committed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback) -> None:
        return None

    def cursor(self) -> FakePostgresCursor:
        return FakePostgresCursor(self)

    def commit(self) -> None:
        self.committed = True


def write_png_header(path: Path, width: int, height: int) -> None:
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + struct.pack(">I4sII", 13, b"IHDR", width, height) + b"\x08\x02\x00\x00\x00")


def write_wav(path: Path, *, duration_seconds: float = 1.0, sample_rate: int = 8000) -> None:
    frame_count = int(duration_seconds * sample_rate)
    with wave.open(str(path), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(sample_rate)
        audio.writeframes(b"\x00\x00" * frame_count)


def write_mp4_with_duration(path: Path, *, duration_seconds: float, timescale: int = 1000) -> None:
    duration = int(duration_seconds * timescale)
    mvhd_payload = (
        b"\x00\x00\x00\x00"
        + (0).to_bytes(4, "big")
        + (0).to_bytes(4, "big")
        + timescale.to_bytes(4, "big")
        + duration.to_bytes(4, "big")
        + b"\x00" * 80
    )
    mvhd = (len(mvhd_payload) + 8).to_bytes(4, "big") + b"mvhd" + mvhd_payload
    moov = (len(mvhd) + 8).to_bytes(4, "big") + b"moov" + mvhd
    ftyp_payload = b"isom\x00\x00\x02\x00isomiso2mp41"
    ftyp = (len(ftyp_payload) + 8).to_bytes(4, "big") + b"ftyp" + ftyp_payload
    path.write_bytes(ftyp + moov)


class PlatformServiceTest(unittest.TestCase):
    def make_service(self, comfy: FakeComfy | None = None, storage_root: str | None = None, **kwargs) -> PlatformService:
        return PlatformService(
            registry=default_registry(),
            comfy=comfy or FakeComfy(),
            storage=LocalStorage(storage_root or tempfile.mkdtemp()),
            **kwargs,
        )

    def test_generation_prompt_templates_are_centralized(self) -> None:
        self.assertEqual(DEFAULT_NEGATIVE_PROMPT, "低清晰度，画面畸变，文字水印")
        self.assertIn("竖屏9:16", storyboard_prompt("悬疑漫剧", "主角推门"))
        self.assertIn("电影感光影", manual_shot_prompt("雨夜车站"))

    def test_templates_follow_workflow_registry_contract(self) -> None:
        service = self.make_service()
        workflow_by_key = {item["workflow_key"]: item for item in service.workflows()}
        self.assertIn("platform/script_analysis", workflow_by_key)
        self.assertNotIn("platform/script_analysis", {item["workflow_key"] for item in service.list_templates()})
        for template in service.list_templates():
            spec = workflow_by_key[template["workflow_key"]]
            schema_keys = set(spec["input_schema"])
            required_keys = {
                name for name, rule in spec["input_schema"].items() if rule.get("required", False)
            }
            self.assertEqual(set(template["parameter_schema"]), schema_keys, template["workflow_key"])
            self.assertTrue(set(template["default_params"]) <= schema_keys, template["workflow_key"])
            self.assertTrue(set(template["example_inputs"]) <= schema_keys, template["workflow_key"])
            self.assertTrue(required_keys <= set(template["example_inputs"]), template["workflow_key"])

    def test_comfy_status_returns_chinese_connected_message(self) -> None:
        service = self.make_service()
        status = service.comfy_status()
        self.assertTrue(status["connected"])
        self.assertEqual(status["message"], "ComfyUI 已连接")
        self.assertEqual(status["queue_pending"], 2)

    def test_comfy_output_path_stays_inside_output_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = LocalStorage(Path(temp_dir) / "storage", comfy_output_root=Path(temp_dir) / "comfy-output")
            safe_path = storage.comfy_output_path({"filename": "shot.png", "subfolder": "story", "type": "output"})
            self.assertEqual(safe_path, (Path(temp_dir) / "comfy-output" / "output" / "story" / "shot.png").resolve())

            with self.assertRaisesRegex(FileNotFoundError, "路径不合法"):
                storage.comfy_output_path({"filename": "../../secret.txt", "subfolder": "", "type": "output"})

    def test_workflow_registry_exposes_business_schema(self) -> None:
        service = self.make_service()
        workflows = service.workflows()
        image_workflow = next(item for item in workflows if item["workflow_key"] == "selfhost/image_flux")
        self.assertEqual(image_workflow["display_name"], "Flux 分镜图生成")
        self.assertIn("prompt", image_workflow["input_schema"])
        self.assertEqual(image_workflow["output_nodes"]["9"], "image")
        self.assertIn("分镜首帧", image_workflow["applicable_scenarios"])

    def test_create_task_validates_required_prompt(self) -> None:
        service = self.make_service()
        with self.assertRaisesRegex(WorkflowValidationError, "画面提示词"):
            service.create_generation_task("selfhost/image_flux", {"prompt": ""})

    def test_create_task_rejects_unknown_workflow_params(self) -> None:
        service = self.make_service()
        with self.assertRaisesRegex(WorkflowValidationError, "未在输入 schema 中声明"):
            service.create_generation_task("selfhost/image_flux", {"prompt": "未知参数", "nodes": {"1": {"inputs": {}}}})

    def test_submit_task_moves_to_running_with_prompt_id(self) -> None:
        service = self.make_service()
        task = service.create_generation_task("selfhost/image_flux", {"prompt": "雨夜街头，女主回头"})
        self.assertEqual(task["events"][0]["message"], "任务已创建。")
        submitted = service.submit_task(
            task["id"],
            {
                "workflow_key": task["workflow_key"],
                "task_type": task["task_type"],
                "inputs": task["input_params"],
                "project_id": "",
                "shot_id": "",
            },
        )
        self.assertEqual(submitted["status"], TaskStatus.RUNNING.value)
        self.assertEqual(submitted["prompt_id"], "prompt_test_001")
        self.assertEqual(submitted["progress"], 10)
        self.assertEqual(submitted["events"][-1]["message"], "任务已提交到 ComfyUI。")
        self.assertEqual(submitted["events"][-1]["detail"]["prompt_id"], "prompt_test_001")
        self.assertIn("1", service.comfy.submitted_workflow)
        self.assertEqual(service.comfy.submitted_workflow["1"]["class_type"], "PlatformBusinessInput")
        self.assertEqual(service.comfy.submitted_workflow["1"]["inputs"]["prompt"], "雨夜街头，女主回头")
        self.assertEqual(service.comfy.submitted_workflow["1"]["inputs"]["width"], 768)
        self.assertEqual(service.comfy.submitted_workflow["1"]["inputs"]["height"], 1344)
        self.assertEqual(service.comfy.submitted_workflow["1"]["inputs"]["seed"], -1)
        self.assertEqual(service.comfy.submitted_workflow["9"]["class_type"], "SaveImage")

    def test_submit_task_rejects_raw_comfy_node_payload(self) -> None:
        service = self.make_service()
        task = service.create_generation_task("selfhost/image_flux", {"prompt": "节点图不应直传"})
        with self.assertRaisesRegex(WorkflowValidationError, "不能提交任意 ComfyUI 节点图"):
            service.submit_task(task["id"], {"1": {"inputs": {}}})

    def test_submit_task_builds_default_payload_when_empty(self) -> None:
        comfy = FakeComfy()
        service = self.make_service(comfy)
        task = service.create_generation_task("selfhost/image_flux", {"prompt": "默认提交载荷", "width": 512})
        submitted = service.submit_task(task["id"], {})
        self.assertEqual(submitted["status"], TaskStatus.RUNNING.value)
        self.assertEqual(comfy.submitted_workflow["1"]["class_type"], "PlatformBusinessInput")
        self.assertEqual(comfy.submitted_workflow["1"]["inputs"]["prompt"], "默认提交载荷")
        self.assertEqual(comfy.submitted_workflow["1"]["inputs"]["width"], 512)
        self.assertEqual(comfy.submitted_workflow["1"]["inputs"]["height"], 1344)

    def test_submit_task_rejects_unresolved_workflow_placeholders(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workflow_path = Path(temp_dir) / "bad_placeholder.json"
            workflow_path.write_text(
                """
                {
                  "workflow_key": "selfhost/image_flux",
                  "adapter_type": "comfyui",
                  "inputs": {
                    "prompt": "{{prompt}}",
                    "width": "{{width}}",
                    "height": "{{height}}",
                    "seed": "{{seed}}"
                  },
                  "outputs": {"9": {"asset_type": "image", "field": "images"}},
                  "comfy_workflow": {
                    "1": {
                      "class_type": "PlatformBusinessInput",
                      "inputs": {
                        "prompt": "{{prompt}}",
                        "missing": "{{missing_param}}"
                      }
                    }
                  }
                }
                """,
                encoding="utf-8",
            )
            comfy = FakeComfy()
            service = self.make_service(comfy)
            service.registry.get("selfhost/image_flux").workflow_path = str(workflow_path)
            task = service.create_generation_task("selfhost/image_flux", {"prompt": "缺占位符"})

            with self.assertRaisesRegex(WorkflowValidationError, "missing_param"):
                service.submit_task(task["id"], {})
            self.assertEqual(comfy.submitted_workflow, {})

    def test_submit_failure_records_chinese_error_and_retry_advice(self) -> None:
        comfy = FakeComfy()
        comfy.fail_submit = True
        service = self.make_service(comfy)
        task = service.create_generation_task("selfhost/image_flux", {"prompt": "镜头提示词"})
        failed = service.submit_task(task["id"], {})
        self.assertEqual(failed["status"], TaskStatus.FAILED.value)
        self.assertEqual(failed["error_message"], "ComfyUI 任务提交失败。")
        self.assertIn("mock submit error", failed["provider_error"])
        self.assertIn("重试", failed["retry_advice"])
        self.assertEqual(failed["events"][-1]["status"], TaskStatus.FAILED.value)
        self.assertEqual(failed["events"][-1]["message"], "ComfyUI 任务提交失败。")
        self.assertEqual(failed["events"][-1]["detail"]["workflow_key"], "selfhost/image_flux")
        self.assertEqual(failed["events"][-1]["detail"]["prompt_id"], "")

    def test_cancel_and_retry_task_updates_shot_status(self) -> None:
        service = self.make_service()
        project = service.create_project({"title": "取消重试项目", "owner_id": "author_001"})
        result = service.analyze_script(project["id"], {"script": "主角看向窗外。", "user_id": "author_001"})
        shot = result["shots"][0]
        task = service.generate_shot_image(project["id"], shot["id"], {"user_id": "author_001"})

        submitted = service.submit_task(task["id"], {})
        detail_after_submit = service.get_project(project["id"])
        self.assertEqual(submitted["status"], TaskStatus.RUNNING.value)
        self.assertEqual(detail_after_submit["status"], ProjectStatus.GENERATING.value)
        self.assertEqual(detail_after_submit["current_step"], "image")
        self.assertEqual(detail_after_submit["shots"][0]["generation_status"], TaskStatus.RUNNING.value)

        cancelled = service.cancel_task(task["id"], "用户主动取消。")
        detail_after_cancel = service.get_project(project["id"])
        self.assertEqual(cancelled["status"], TaskStatus.CANCELLED.value)
        self.assertEqual(service.comfy.cancelled_prompt_ids, ["prompt_test_001"])
        self.assertTrue(any(item["message"] == "已向 ComfyUI 发送取消请求。" for item in cancelled["events"]))
        self.assertEqual(cancelled["events"][-1]["message"], "用户主动取消。")
        self.assertEqual(detail_after_cancel["status"], ProjectStatus.DRAFT.value)
        self.assertEqual(detail_after_cancel["current_step"], "image")
        self.assertEqual(detail_after_cancel["shots"][0]["generation_status"], TaskStatus.CANCELLED.value)

        retried = service.retry_task(task["id"])
        detail_after_retry = service.get_project(project["id"])
        self.assertEqual(retried["status"], TaskStatus.PENDING.value)
        self.assertEqual(retried["events"][-1]["message"], "任务已重置为可重试状态。")
        self.assertEqual(detail_after_retry["status"], ProjectStatus.DRAFT.value)
        self.assertEqual(detail_after_retry["current_step"], "image")
        self.assertEqual(detail_after_retry["shots"][0]["generation_status"], TaskStatus.PENDING.value)

    def test_project_status_tracks_task_failure_and_retry(self) -> None:
        comfy = FakeComfy()
        comfy.fail_submit = True
        service = self.make_service(comfy)
        project = service.create_project({"title": "失败可重试项目", "owner_id": "author_001"})
        result = service.analyze_script(project["id"], {"script": "主角推开门。", "user_id": "author_001"})
        shot = result["shots"][0]
        task = service.generate_shot_image(project["id"], shot["id"], {"user_id": "author_001"})

        failed = service.submit_task(task["id"], {})
        detail_after_failure = service.get_project(project["id"])
        self.assertEqual(failed["status"], TaskStatus.FAILED.value)
        self.assertEqual(detail_after_failure["status"], ProjectStatus.FAILED.value)
        self.assertEqual(detail_after_failure["current_step"], "image")
        self.assertEqual(detail_after_failure["shots"][0]["generation_status"], TaskStatus.FAILED.value)

        retried = service.retry_task(task["id"])
        detail_after_retry = service.get_project(project["id"])
        self.assertEqual(retried["status"], TaskStatus.PENDING.value)
        self.assertEqual(detail_after_retry["status"], ProjectStatus.DRAFT.value)
        self.assertEqual(detail_after_retry["shots"][0]["generation_status"], TaskStatus.PENDING.value)

    def test_completed_task_cannot_be_cancelled(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            comfy = FakeComfy()
            output_root = Path(temp_dir) / "comfy-output"
            output_file = output_root / "output" / "story" / "shot.png"
            output_file.parent.mkdir(parents=True)
            output_file.write_bytes(b"completed image")
            service = PlatformService(
                registry=default_registry(),
                comfy=comfy,
                storage=LocalStorage(Path(temp_dir) / "storage", comfy_output_root=output_root),
            )
            task = service.create_generation_task("selfhost/image_flux", {"prompt": "完成后取消测试"})
            service.submit_task(task["id"], {})
            comfy.history_payload = {
                "prompt_test_001": {
                    "status": {"completed": True},
                    "outputs": {"9": {"images": [{"filename": "shot.png", "subfolder": "story", "type": "output"}]}},
                }
            }
            service.sync_task(task["id"])
            with self.assertRaisesRegex(WorkflowValidationError, "已完成"):
                service.cancel_task(task["id"])

    def test_non_author_cannot_edit_project_or_publish(self) -> None:
        service = self.make_service()
        with self.assertRaisesRegex(WorkflowValidationError, "请先登录"):
            service.create_project({"title": "匿名项目"})
        with self.assertRaisesRegex(WorkflowValidationError, "请先登录"):
            service.create_project({"title": "空作者项目", "owner_id": "   "})
        project = service.create_project({"title": "权限项目", "owner_id": "author_001"})
        with self.assertRaisesRegex(WorkflowValidationError, "请先登录"):
            service.analyze_script(project["id"], {"script": "匿名编辑。"})
        with self.assertRaisesRegex(WorkflowValidationError, "非作者"):
            service.analyze_script(project["id"], {"script": "越权编辑。", "user_id": "viewer_001"})
        with self.assertRaisesRegex(WorkflowValidationError, "非作者"):
            service.submit_work_for_review(project["id"], {"title": "越权发布", "user_id": "viewer_001"})

    def test_sync_task_fails_when_completed_history_has_no_archivable_outputs(self) -> None:
        service = self.make_service()
        task = service.create_generation_task("selfhost/image_flux", {"prompt": "无输出完成测试"})
        service.submit_task(task["id"], {})
        synced = service.sync_task(task["id"])
        self.assertEqual(synced["status"], TaskStatus.FAILED.value)
        self.assertEqual(synced["error_message"], "ComfyUI 未返回可归档输出。")
        self.assertEqual(synced["progress"], 0)

    def test_sync_task_fails_when_completed_history_outputs_unknown_nodes(self) -> None:
        service = self.make_service()
        task = service.create_generation_task("selfhost/image_flux", {"prompt": "未知输出节点测试"})
        service.submit_task(task["id"], {})
        service.comfy.history_payload = {
            "prompt_test_001": {
                "status": {"completed": True},
                "outputs": {"999": {"images": [{"filename": "shot.png", "subfolder": "", "type": "output"}]}},
            }
        }
        synced = service.sync_task(task["id"])
        self.assertEqual(synced["status"], TaskStatus.FAILED.value)
        self.assertEqual(synced["error_message"], "ComfyUI 未返回可归档输出。")
        self.assertIn("999", synced["provider_error"])

    def test_sync_task_maps_comfy_interrupted_to_cancelled(self) -> None:
        comfy = FakeComfy()
        service = self.make_service(comfy=comfy)
        project = service.create_project({"title": "同步取消项目", "owner_id": "author_001"})
        analysis = service.analyze_script(project["id"], {"script": "主角停下脚步。", "user_id": "author_001"})
        shot = analysis["shots"][0]
        task = service.generate_shot_image(project["id"], shot["id"], {"user_id": "author_001"})
        service.submit_task(task["id"], {})
        comfy.history_payload = {
            "prompt_test_001": {
                "status": {
                    "completed": False,
                    "status_str": "interrupted",
                    "messages": [["execution_interrupted", {"node_id": "9"}]],
                }
            }
        }

        synced = service.sync_task(task["id"])
        detail = service.get_project(project["id"])
        self.assertEqual(synced["status"], TaskStatus.CANCELLED.value)
        self.assertEqual(synced["progress"], 0)
        self.assertEqual(synced["error_message"], "ComfyUI 任务已取消。")
        self.assertIn("execution_interrupted", synced["provider_error"])
        self.assertEqual(detail["status"], ProjectStatus.DRAFT.value)
        self.assertEqual(detail["shots"][0]["generation_status"], TaskStatus.CANCELLED.value)

    def test_sync_task_archives_comfy_history_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output_root = Path(temp_dir) / "comfy-output"
            output_file = output_root / "output" / "story" / "shot.png"
            output_file.parent.mkdir(parents=True)
            output_file.write_bytes(b"comfy image")

            comfy = FakeComfy()
            service = PlatformService(
                registry=default_registry(),
                comfy=comfy,
                storage=LocalStorage(Path(temp_dir) / "storage", comfy_output_root=output_root),
            )
            project = service.create_project({"title": "自动归档项目", "owner_id": "author_001"})
            analysis = service.analyze_script(project["id"], {"script": "主角看见光。", "user_id": "author_001"})
            shot = analysis["shots"][0]
            task = service.generate_shot_image(project["id"], shot["id"], {"user_id": "author_001"})
            service.submit_task(task["id"], {})
            comfy.history_payload = {
                "prompt_test_001": {
                    "status": {"completed": True},
                    "outputs": {
                        "9": {
                            "images": [
                                {"filename": "shot.png", "subfolder": "story", "type": "output"},
                            ]
                        }
                    },
                }
            }

            synced = service.sync_task(task["id"])
            detail = service.get_project(project["id"])
            self.assertEqual(synced["status"], TaskStatus.COMPLETED.value)
            self.assertEqual(len(synced["output_asset_ids"]), 1)
            self.assertEqual(detail["status"], ProjectStatus.DRAFT.value)
            self.assertEqual(detail["current_step"], "image")
            self.assertEqual(detail["shots"][0]["generation_status"], TaskStatus.COMPLETED.value)
            self.assertEqual(len(detail["shots"][0]["asset_ids"]), 1)

    def test_sync_task_can_archive_remote_comfy_view_output_when_local_file_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            remote_source = Path(temp_dir) / "remote.png"
            write_png_header(remote_source, 640, 960)
            comfy = RemoteOutputComfy()
            comfy.remote_outputs[("remote.png", "story", "output")] = remote_source.read_bytes()
            service = PlatformService(
                registry=default_registry(),
                comfy=comfy,
                storage=LocalStorage(Path(temp_dir) / "storage", comfy_output_root=Path(temp_dir) / "missing-output"),
            )
            project = service.create_project({"title": "远端归档项目", "owner_id": "author_001"})
            analysis = service.analyze_script(project["id"], {"script": "主角看见远处灯光。", "user_id": "author_001"})
            shot = analysis["shots"][0]
            task = service.generate_shot_image(project["id"], shot["id"], {"user_id": "author_001"})
            service.submit_task(task["id"], {})
            comfy.history_payload = {
                "prompt_test_001": {
                    "status": {"completed": True},
                    "outputs": {
                        "9": {
                            "images": [
                                {"filename": "remote.png", "subfolder": "story", "type": "output"},
                            ]
                        }
                    },
                }
            }

            synced = service.sync_task(task["id"])

            self.assertEqual(synced["status"], TaskStatus.COMPLETED.value)
            self.assertEqual(len(synced["output_asset_ids"]), 1)
            self.assertEqual(comfy.downloaded_outputs[0]["filename"], "remote.png")
            asset = service.repository.assets[synced["output_asset_ids"][0]]
            self.assertEqual(asset.mime_type, "image/png")
            self.assertEqual(asset.width, 640)
            self.assertEqual(asset.height, 960)
            self.assertTrue(Path(asset.local_path).exists())
            detail = service.get_project(project["id"])
            self.assertEqual(detail["shots"][0]["asset_ids"], [asset.id])

    def test_sync_task_fails_when_comfy_output_file_missing(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            comfy = FakeComfy()
            service = PlatformService(
                registry=default_registry(),
                comfy=comfy,
                storage=LocalStorage(Path(temp_dir) / "storage", comfy_output_root=Path(temp_dir) / "comfy-output"),
            )
            task = service.create_generation_task("selfhost/image_flux", {"prompt": "缺文件测试"})
            service.submit_task(task["id"], {})
            comfy.history_payload = {
                "prompt_test_001": {
                    "status": {"completed": True},
                    "outputs": {"9": {"images": [{"filename": "missing.png", "subfolder": "", "type": "output"}]}},
                }
            }

            synced = service.sync_task(task["id"])
            self.assertEqual(synced["status"], TaskStatus.FAILED.value)
            self.assertEqual(synced["error_message"], "ComfyUI 输出文件未找到。")
            self.assertIn("missing.png", synced["provider_error"])

    def test_sync_task_fails_when_comfy_output_path_is_unsafe(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            comfy = FakeComfy()
            service = PlatformService(
                registry=default_registry(),
                comfy=comfy,
                storage=LocalStorage(Path(temp_dir) / "storage", comfy_output_root=Path(temp_dir) / "comfy-output"),
            )
            task = service.create_generation_task("selfhost/image_flux", {"prompt": "路径安全测试"})
            service.submit_task(task["id"], {})
            comfy.history_payload = {
                "prompt_test_001": {
                    "status": {"completed": True},
                    "outputs": {"9": {"images": [{"filename": "../../secret.png", "subfolder": "", "type": "output"}]}},
                }
            }

            synced = service.sync_task(task["id"])
            self.assertEqual(synced["status"], TaskStatus.FAILED.value)
            self.assertEqual(synced["error_message"], "ComfyUI 输出文件未找到。")
            self.assertIn("路径不合法", synced["provider_error"])

    def test_archive_output_creates_asset_bound_to_task(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "shot.png"
            write_png_header(source, 720, 1280)
            service = self.make_service(storage_root=str(Path(temp_dir) / "storage"))
            task = service.create_generation_task("selfhost/image_flux", {"prompt": "归档测试"})
            asset = service.archive_output(task["id"], source, "9")
            saved_task = service.get_task(task["id"])
            self.assertEqual(asset["asset_type"], "image")
            self.assertEqual(asset["mime_type"], "image/png")
            self.assertEqual(asset["width"], 720)
            self.assertEqual(asset["height"], 1280)
            self.assertIsNone(asset["duration_seconds"])
            self.assertEqual(len(asset["content_hash"]), 64)
            self.assertEqual(asset["created_by"], "system")
            self.assertTrue(Path(asset["local_path"]).exists())
            self.assertIn(asset["id"], saved_task["output_asset_ids"])
            self.assertEqual(saved_task["events"][-1]["message"], "输出文件已归档。")
            self.assertEqual(saved_task["events"][-1]["detail"]["asset_id"], asset["id"])

    def test_archive_output_can_use_public_storage_base_url(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "shot.png"
            source.write_bytes(b"public storage bytes")
            storage = LocalStorage(
                Path(temp_dir) / "storage",
                public_base_url="https://cdn.example.com/video-gen/",
            )
            service = PlatformService(storage=storage)
            task = service.create_generation_task("selfhost/image_flux", {"prompt": "公开 URL 测试"})
            asset = service.archive_output(task["id"], source, "9")
            asset_path = Path(asset["local_path"])

            self.assertTrue(asset["url"].startswith("https://cdn.example.com/video-gen/assets/"))
            self.assertNotIn("/storage/assets/", asset["url"])
            self.assertTrue(asset_path.exists())
            service.storage.delete_file(asset_path)
            self.assertFalse(asset_path.exists())

    def test_archive_output_can_upload_to_s3_compatible_storage(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "object.png"
            source.write_bytes(b"object storage bytes")
            storage = CapturingS3Storage(
                Path(temp_dir) / "storage",
                endpoint_url="https://s3.example.com",
                bucket="video-gen",
                access_key="access-key",
                secret_key="secret-key",
                region="us-east-1",
                prefix="prod",
                public_base_url="https://cdn.example.com/video-gen",
            )
            service = PlatformService(storage=storage)
            task = service.create_generation_task("selfhost/image_flux", {"prompt": "对象存储归档"})
            asset = service.archive_output(task["id"], source, "9")

            self.assertTrue(Path(asset["local_path"]).exists())
            self.assertEqual(len(storage.uploads), 1)
            self.assertEqual(storage.uploads[0]["body"], b"object storage bytes")
            self.assertEqual(storage.uploads[0]["content_type"], "image/png")
            self.assertTrue(storage.uploads[0]["object_key"].startswith(f"prod/assets/{task['id']}/"))
            self.assertTrue(asset["url"].startswith(f"https://cdn.example.com/video-gen/prod/assets/{task['id']}/"))
            self.assertNotIn("/storage/assets/", asset["url"])

    def test_s3_compatible_storage_validates_vendor_and_endpoint_profiles(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            oss_storage = S3CompatibleStorage(
                Path(temp_dir) / "oss-storage",
                endpoint_url="https://oss-cn-hangzhou.aliyuncs.com",
                bucket="video-gen",
                access_key="access-key",
                secret_key="secret-key",
                region="cn-hangzhou",
                prefix="prod/short-video",
                vendor="oss",
                public_base_url="https://cdn.example.com/video-gen",
                upload_timeout_seconds=7,
            )
            diagnostics = oss_storage.diagnostics()
            self.assertEqual(diagnostics["vendor"], "aliyun-oss")
            self.assertEqual(diagnostics["prefix"], "prod/short-video")
            self.assertEqual(diagnostics["upload_timeout_seconds"], 7)

            minio_storage = S3CompatibleStorage(
                Path(temp_dir) / "minio-storage",
                endpoint_url="http://minio.local:9000",
                bucket="video-gen",
                access_key="access-key",
                secret_key="secret-key",
                vendor="minio",
            )
            self.assertEqual(minio_storage.vendor, "minio")

            with self.assertRaisesRegex(ValueError, "必须使用 HTTPS"):
                S3CompatibleStorage(
                    Path(temp_dir) / "bad-http",
                    endpoint_url="http://oss.example.com",
                    bucket="video-gen",
                    access_key="access-key",
                    secret_key="secret-key",
                    vendor="oss",
                )
            with self.assertRaisesRegex(ValueError, "prefix"):
                S3CompatibleStorage(
                    Path(temp_dir) / "bad-prefix",
                    endpoint_url="https://s3.example.com",
                    bucket="video-gen",
                    access_key="access-key",
                    secret_key="secret-key",
                    prefix="../prod",
                )
            with self.assertRaisesRegex(ValueError, "不支持的对象存储厂商"):
                S3CompatibleStorage(
                    Path(temp_dir) / "bad-vendor",
                    endpoint_url="https://s3.example.com",
                    bucket="video-gen",
                    access_key="access-key",
                    secret_key="secret-key",
                    vendor="unknown-vendor",
                )

    def test_s3_compatible_storage_can_use_virtual_hosted_style_upload_url(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "object.png"
            source.write_bytes(b"virtual hosted bytes")
            storage = S3CompatibleStorage(
                Path(temp_dir) / "storage",
                endpoint_url="https://s3.us-east-1.amazonaws.com",
                bucket="video-gen",
                access_key="access-key",
                secret_key="secret-key",
                region="us-east-1",
                prefix="prod",
                vendor="aws",
                force_path_style=False,
                upload_timeout_seconds=4,
            )
            captured = {}

            class Response:
                def __enter__(self):
                    return self

                def __exit__(self, exc_type, exc, traceback) -> None:
                    return None

            def fake_urlopen(request, timeout):
                captured["url"] = request.full_url
                captured["timeout"] = timeout
                captured["headers"] = {key.lower(): value for key, value in request.header_items()}
                return Response()

            with patch("urllib.request.urlopen", fake_urlopen):
                asset = storage.archive_file(source, asset_type=AssetType.IMAGE, task_id="task_s3", created_by="author_s3")

            self.assertTrue(captured["url"].startswith("https://video-gen.s3.us-east-1.amazonaws.com/prod/assets/task_s3/"))
            self.assertEqual(captured["timeout"], 4)
            self.assertIn("authorization", captured["headers"])
            self.assertTrue(asset.url.startswith("https://s3.us-east-1.amazonaws.com/video-gen/prod/assets/task_s3/"))

    def test_archived_assets_keep_task_and_project_creator(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "shot.png"
            write_png_header(source, 720, 1280)
            service = self.make_service(storage_root=str(Path(temp_dir) / "storage"))
            project = service.create_project({"title": "素材审计项目", "owner_id": "author_001"})
            analysis = service.analyze_script(project["id"], {"script": "主角站在天台。", "user_id": "author_001"})
            shot = analysis["shots"][0]
            task = service.generate_shot_image(project["id"], shot["id"], {"user_id": "author_001"})

            asset = service.archive_output(task["id"], source, "9")
            service.build_project_timeline(project["id"], {"user_id": "author_001"})
            subtitle_asset = service.export_project_subtitles(project["id"], {"user_id": "author_001"})

            self.assertEqual(asset["created_by"], "author_001")
            self.assertEqual(subtitle_asset["created_by"], "author_001")

    def test_project_asset_library_lists_archived_shot_assets(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "shot.png"
            source.write_bytes(b"fake image bytes")
            service = self.make_service(storage_root=str(Path(temp_dir) / "storage"))
            project = service.create_project({"title": "素材库项目", "owner_id": "author_001"})
            analysis = service.analyze_script(
                project["id"],
                {"script": "主角推开车站大门。", "user_id": "author_001"},
            )
            shot = analysis["shots"][0]
            task = service.generate_shot_image(project["id"], shot["id"], {"user_id": "author_001"})

            archived = service.archive_output(task["id"], source, "9")
            assets = service.list_project_assets(project["id"])
            self.assertEqual(len(assets), 1)
            self.assertEqual(assets[0]["id"], archived["id"])
            self.assertEqual(assets[0]["project_id"], project["id"])
            self.assertEqual(assets[0]["source_task_type"], "image")
            self.assertEqual(assets[0]["shot_index"], 1)
            self.assertIn("推开车站大门", assets[0]["shot_narration"])

    def test_delete_project_asset_removes_file_and_references(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "shot.png"
            source.write_bytes(b"fake image bytes")
            service = self.make_service(storage_root=str(Path(temp_dir) / "storage"))
            project = service.create_project({"title": "删除素材项目", "owner_id": "author_001"})
            analysis = service.analyze_script(project["id"], {"script": "主角推门。", "user_id": "author_001"})
            shot = analysis["shots"][0]
            task = service.generate_shot_image(project["id"], shot["id"], {"user_id": "author_001"})
            asset = service.archive_output(task["id"], source, "9")
            work = service.submit_work_for_review(
                project["id"],
                {
                    "title": "删除素材作品",
                    "video_url": "/storage/final/manual.mp4",
                    "cover_url": asset["url"],
                    "user_id": "author_001",
                },
            )
            asset_path = Path(asset["local_path"])
            self.assertTrue(asset_path.exists())

            with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
                service.delete_project_asset(project["id"], asset["id"], {"user_id": "author_001", "node_graph": {}})

            deleted = service.delete_project_asset(project["id"], asset["id"], {"user_id": "author_001"})
            detail = service.get_project(project["id"])
            saved_task = service.get_task(task["id"])
            updated_work = service.repository.works[work["id"]]
            self.assertTrue(deleted["deleted"])
            self.assertFalse(asset_path.exists())
            self.assertEqual(service.list_project_assets(project["id"]), [])
            self.assertNotIn(asset["id"], detail["shots"][0]["asset_ids"])
            self.assertEqual(detail["shots"][0]["generation_status"], TaskStatus.PENDING.value)
            self.assertNotIn(asset["id"], saved_task["output_asset_ids"])
            self.assertEqual(updated_work.cover_url, "")

            with self.assertRaisesRegex(WorkflowValidationError, "非作者"):
                service.delete_project_asset(project["id"], asset["id"], {"user_id": "viewer_001"})

    def test_delete_project_asset_clears_timeline_media_references(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            video_source = Path(temp_dir) / "shot.mp4"
            audio_source = Path(temp_dir) / "voice.wav"
            video_source.write_bytes(b"fake video bytes")
            write_wav(audio_source, duration_seconds=1.0)
            service = self.make_service(storage_root=str(Path(temp_dir) / "storage"))
            project = service.create_project({"title": "删除时间线素材项目", "owner_id": "author_001"})
            analysis = service.analyze_script(project["id"], {"script": "镜头一。", "user_id": "author_001"})
            shot = analysis["shots"][0]
            video_task = service.create_generation_task(
                "selfhost/video_wan2.1_fusionx",
                {"prompt": "镜头运动", "first_frame_url": "/storage/first.png"},
                project_id=project["id"],
                shot_id=shot["id"],
                created_by="author_001",
            )
            audio_task = service.generate_shot_tts(project["id"], shot["id"], {"user_id": "author_001"})
            video_asset = service.archive_output(video_task["id"], video_source, "18")
            audio_asset = service.archive_output(audio_task["id"], audio_source, "6")
            service.build_project_timeline(project["id"], {"user_id": "author_001"})

            service.delete_project_asset(project["id"], video_asset["id"], {"user_id": "author_001"})
            detail_after_video_delete = service.get_project(project["id"])
            self.assertEqual(detail_after_video_delete["timeline"][0]["video_asset_id"], "")
            self.assertEqual(detail_after_video_delete["timeline"][0]["audio_asset_id"], audio_asset["id"])

            service.delete_project_asset(project["id"], audio_asset["id"], {"user_id": "author_001"})
            detail_after_audio_delete = service.get_project(project["id"])
            self.assertEqual(detail_after_audio_delete["timeline"][0]["audio_asset_id"], "")

    def test_delete_project_final_video_asset_clears_published_work_video(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            video_source = Path(temp_dir) / "final.mp4"
            video_source.write_bytes(b"fake final video bytes")
            service = self.make_service(storage_root=str(Path(temp_dir) / "storage"))
            project = service.create_project({"title": "删除成片素材项目", "owner_id": "author_001"})
            task = service.create_generation_task(
                "platform/compose",
                {
                    "project_id": project["id"],
                    "shot_ids": ["shot_001"],
                    "timeline": [{"shot_id": "shot_001"}],
                    "subtitles": [{"shot_id": "shot_001", "text": "字幕"}],
                },
                project_id=project["id"],
                created_by="author_001",
            )
            asset = service.archive_output(task["id"], video_source, "30")
            work = service.submit_work_for_review(project["id"], {"title": "删除成片素材作品", "user_id": "author_001"})

            service.delete_project_asset(project["id"], asset["id"], {"user_id": "author_001"})

            detail = service.get_project(project["id"])
            updated_work = service.repository.works[work["id"]]
            self.assertEqual(detail["final_video_url"], "")
            self.assertEqual(detail["status"], ProjectStatus.DRAFT.value)
            self.assertEqual(updated_work.video_url, "")
            self.assertEqual(updated_work.review_status, WorkReviewStatus.PENDING_REVIEW)

    def test_admin_overview_counts_tasks_assets_reviews_and_storage(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "shot.png"
            source.write_bytes(b"fake image bytes")
            service = self.make_service(storage_root=str(Path(temp_dir) / "storage"))
            project = service.create_project({"title": "概览项目", "owner_id": "author_001"})
            analysis = service.analyze_script(project["id"], {"script": "主角推门。", "user_id": "author_001"})
            task = service.generate_shot_image(project["id"], analysis["shots"][0]["id"], {"user_id": "author_001"})
            service.archive_output(task["id"], source, "9")
            failed = service.create_generation_task("selfhost/image_flux", {"prompt": "失败任务"}, project_id=project["id"])
            service.repository.tasks[failed["id"]].status = TaskStatus.FAILED
            service.repository.tasks[failed["id"]].prompt_id = "prompt_failed_001"
            service.repository.tasks[failed["id"]].error_message = "测试失败"
            service.repository.tasks[failed["id"]].provider_error = "mock provider traceback"
            service.repository.tasks[failed["id"]].retry_advice = "请检查模型后重试。"
            service._record_task_event(service.repository.tasks[failed["id"]], "测试失败", {"provider_error": "mock provider traceback"})
            service.submit_work_for_review(
                project["id"], {"title": "待审核", "video_url": "/storage/final/a.mp4", "user_id": "author_001"}
            )

            overview = service.admin_overview()
            self.assertEqual(overview["project_count"], 1)
            self.assertEqual(overview["asset_count"], 1)
            self.assertEqual(overview["pending_review_count"], 1)
            self.assertGreater(overview["storage_total_bytes"], 0)
            self.assertEqual(overview["task_status_counts"]["pending"], 1)
            self.assertEqual(overview["task_status_counts"]["failed"], 1)
            self.assertEqual(overview["asset_type_counts"]["image"], 1)
            self.assertEqual(overview["latest_failed_tasks"][0]["error_message"], "测试失败")
            self.assertEqual(overview["latest_failed_tasks"][0]["prompt_id"], "prompt_failed_001")
            self.assertEqual(overview["latest_failed_tasks"][0]["provider_error"], "mock provider traceback")
            self.assertEqual(overview["latest_failed_tasks"][0]["retry_advice"], "请检查模型后重试。")
            self.assertEqual(overview["latest_failed_tasks"][0]["last_event"]["message"], "测试失败")

    def test_admin_can_sync_running_tasks_in_batch(self) -> None:
        comfy = FakeComfy()
        service = self.make_service(comfy=comfy)
        first = service.create_generation_task("selfhost/image_flux", {"prompt": "运行中任务一"})
        second = service.create_generation_task("selfhost/image_flux", {"prompt": "运行中任务二"})
        third = service.create_generation_task("selfhost/image_flux", {"prompt": "待处理任务"})
        service.repository.tasks[first["id"]].status = TaskStatus.RUNNING
        service.repository.tasks[first["id"]].prompt_id = "prompt_running_001"
        service.repository.tasks[first["id"]].progress = 10
        service.repository.tasks[second["id"]].status = TaskStatus.RUNNING
        service.repository.tasks[second["id"]].prompt_id = "prompt_error_001"
        service.repository.tasks[second["id"]].progress = 10
        service.repository.tasks[third["id"]].status = TaskStatus.PENDING
        comfy.history_payload = {
            "prompt_running_001": {"status": {"status_str": "executing"}},
            "prompt_error_001": {"status": {"status_str": "error", "messages": ["模型缺失"]}},
        }

        dry_run = service.sync_running_tasks({"user_id": "system_admin", "dry_run": True})
        self.assertTrue(dry_run["dry_run"])
        self.assertEqual(dry_run["candidate_count"], 2)
        self.assertEqual(dry_run["synced_count"], 0)
        self.assertEqual(service.repository.tasks[second["id"]].status, TaskStatus.RUNNING)

        result = service.sync_running_tasks({"user_id": "system_admin", "limit": 2, "dry_run": False})
        self.assertEqual(result["candidate_count"], 2)
        self.assertEqual(result["synced_count"], 2)
        self.assertEqual(result["status_counts"]["running"], 1)
        self.assertEqual(result["status_counts"]["failed"], 1)
        self.assertEqual(service.repository.tasks[first["id"]].status, TaskStatus.RUNNING)
        self.assertEqual(service.repository.tasks[second["id"]].status, TaskStatus.FAILED)
        self.assertIn("运行中任务同步完成", result["message"])

        with self.assertRaisesRegex(WorkflowValidationError, "审核权限"):
            service.sync_running_tasks({"user_id": "viewer_001"})
        with self.assertRaisesRegex(WorkflowValidationError, "同步数量"):
            service.sync_running_tasks({"user_id": "system_admin", "limit": 0})
        with self.assertRaisesRegex(WorkflowValidationError, "预检模式"):
            service.sync_running_tasks({"user_id": "system_admin", "dry_run": "false"})
        with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
            service.sync_running_tasks({"user_id": "system_admin", "node_graph": {}})

    def test_worker_run_once_wraps_sync_and_cleanup_actions(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            comfy = FakeComfy()
            service = self.make_service(comfy=comfy, storage_root=str(Path(temp_dir) / "storage"))
            task = service.create_generation_task("selfhost/image_flux", {"prompt": "worker 同步"})
            service.repository.tasks[task["id"]].status = TaskStatus.RUNNING
            service.repository.tasks[task["id"]].prompt_id = "prompt_worker_running"
            orphan_dir = service.storage.root / "assets" / "orphan"
            orphan_dir.mkdir(parents=True)
            orphan_file = orphan_dir / "unused.bin"
            orphan_file.write_bytes(b"unused")
            comfy.history_payload = {"prompt_worker_running": {"status": {"status_str": "executing"}}}

            dry_run = run_once(
                service,
                user_id="system_admin",
                sync_running=True,
                cleanup_storage=True,
                dry_run=True,
                limit=5,
            )
            self.assertTrue(dry_run["dry_run"])
            self.assertEqual(dry_run["actions"]["sync_running_tasks"]["candidate_count"], 1)
            self.assertEqual(dry_run["actions"]["cleanup_storage"]["orphan_file_count"], 1)
            self.assertTrue(orphan_file.exists())

            result = run_once(
                service,
                user_id="system_admin",
                sync_running=True,
                cleanup_storage=True,
                dry_run=False,
                limit=5,
            )
            self.assertEqual(result["actions"]["sync_running_tasks"]["synced_count"], 1)
            self.assertEqual(result["actions"]["cleanup_storage"]["deleted_file_count"], 1)
            self.assertFalse(orphan_file.exists())
            with self.assertRaisesRegex(ValueError, "运营账号"):
                run_once(service, user_id="")

    def test_worker_execute_job_submits_queued_generation_task(self) -> None:
        service = self.make_service()
        task = service.create_generation_task("selfhost/image_flux", {"prompt": "worker 队列提交"}, created_by="author_001")

        result = execute_job(
            service,
            "submit_generation_task",
            task_id=task["id"],
            workflow_payload={},
            user_id="author_001",
        )

        self.assertEqual(result["status"], TaskStatus.RUNNING.value)
        self.assertEqual(result["prompt_id"], "prompt_test_001")
        self.assertEqual(result["events"][-1]["message"], "任务已提交到 ComfyUI。")
        with self.assertRaisesRegex(ValueError, "不支持的后台任务"):
            execute_job(service, "unknown_job", task_id=task["id"])

    def test_worker_run_once_can_notify_health_alerts(self) -> None:
        service = self.make_service(comfy=OfflineComfy())
        task = service.create_generation_task("selfhost/image_flux", {"prompt": "告警失败任务"})
        service.repository.tasks[task["id"]].status = TaskStatus.FAILED
        notifier = CapturingAlertNotifier()

        result = run_once(
            service,
            user_id="system_admin",
            sync_running=False,
            notify_alerts=True,
            alert_notifier=notifier,
        )

        notify_result = result["actions"]["notify_alerts"]
        self.assertEqual(notify_result["health_status"], "unhealthy")
        self.assertTrue(notify_result["delivered"])
        self.assertGreaterEqual(notify_result["alert_count"], 2)
        self.assertEqual(len(notifier.health_payloads), 1)
        self.assertTrue(any(item["level"] == "error" for item in notifier.health_payloads[0]["alerts"]))

    def test_worker_run_once_skips_alert_notification_when_healthy(self) -> None:
        service = self.make_service()
        notifier = CapturingAlertNotifier()

        result = run_once(
            service,
            user_id="system_admin",
            sync_running=False,
            notify_alerts=True,
            alert_notifier=notifier,
        )

        notify_result = result["actions"]["notify_alerts"]
        self.assertEqual(notify_result["health_status"], "healthy")
        self.assertFalse(notify_result["delivered"])
        self.assertTrue(notify_result["skipped"])
        self.assertEqual(notify_result["alert_count"], 0)

    def test_admin_can_probe_alert_webhook(self) -> None:
        service = self.make_service()
        notifier = CapturingAlertNotifier()

        with self.assertRaisesRegex(WorkflowValidationError, "审核权限"):
            service.probe_alert_webhook({"operator_id": "viewer_001"}, notifier)
        with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
            service.probe_alert_webhook({"operator_id": "system_admin", "node_graph": {}}, notifier)

        result = service.probe_alert_webhook({"operator_id": "system_admin"}, notifier)

        self.assertTrue(result["ok"])
        self.assertTrue(result["delivered"])
        self.assertEqual(result["alert_count"], 1)
        self.assertEqual(result["status_code"], 200)
        self.assertEqual(result["operator_id"], "system_admin")
        self.assertEqual(len(notifier.health_payloads), 1)
        self.assertIn(result["probe_id"], notifier.health_payloads[0]["alerts"][0]["message"])

    def test_admin_can_probe_workflow_registry(self) -> None:
        service = self.make_service()

        with self.assertRaisesRegex(WorkflowValidationError, "审核权限"):
            service.probe_workflow_registry({"operator_id": "viewer_001"})
        with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
            service.probe_workflow_registry({"operator_id": "system_admin", "node_graph": {}})

        result = service.probe_workflow_registry({"operator_id": "system_admin"})

        self.assertTrue(result["ok"])
        self.assertGreaterEqual(result["workflow_count"], 4)
        self.assertEqual(result["missing_generation_types"], [])
        self.assertGreaterEqual(
            set(result["covered_generation_types"]),
            {
                TaskType.SCRIPT_ANALYSIS.value,
                TaskType.IMAGE.value,
                TaskType.VIDEO.value,
                TaskType.TTS.value,
                TaskType.COMPOSE.value,
            },
        )
        self.assertTrue(all(item["ok"] for item in result["items"]))
        self.assertTrue(all(item["payload_node_count"] > 0 for item in result["items"]))

        image_spec = service.registry.get("selfhost/image_flux")
        image_spec.workflow_path = "/tmp/video_gen_missing_workflow_probe.json"
        failed = service.probe_workflow_registry({"operator_id": "system_admin"})

        self.assertFalse(failed["ok"])
        image_item = next(item for item in failed["items"] if item["workflow_key"] == "selfhost/image_flux")
        self.assertFalse(image_item["ok"])
        self.assertTrue(any("不可读取" in error for error in image_item["errors"]))

    def test_credit_account_charges_generation_and_blocks_insufficient_balance(self) -> None:
        service = self.make_service()
        account = service.get_credit_account("author_credits")
        self.assertEqual(account["balance"], 1000)
        task = service.create_generation_task(
            "selfhost/image_flux",
            {"prompt": "积分生成"},
            created_by="author_credits",
        )
        self.assertEqual(task["credit_cost"], 5)

        submitted = service.submit_task(task["id"], {}, user_id="author_credits", require_owner=True)

        self.assertEqual(submitted["status"], TaskStatus.RUNNING.value)
        self.assertEqual(submitted["credit_cost"], 5)
        self.assertTrue(submitted["billing_transaction_id"])
        charged = service.get_credit_account("author_credits")
        self.assertEqual(charged["balance"], 995)
        self.assertEqual(charged["total_consumed"], 5)
        self.assertTrue(any(item["related_id"] == task["id"] for item in charged["transactions"]))

        service.adjust_credits(
            {
                "operator_id": "system_admin",
                "target_user_id": "low_balance_user",
                "amount": -999,
                "reason": "测试低余额",
            }
        )
        video_task = service.create_generation_task(
            "selfhost/video_wan2.1_fusionx",
            {"prompt": "余额不足视频", "first_frame_url": "/storage/first.png"},
            created_by="low_balance_user",
        )
        with self.assertRaisesRegex(WorkflowValidationError, "积分余额不足"):
            service.submit_task(video_task["id"], {}, user_id="low_balance_user", require_owner=True)

    def test_admin_can_adjust_credits_and_record_work_revenue_share(self) -> None:
        service = self.make_service()
        adjustment = service.adjust_credits(
            {
                "operator_id": "system_admin",
                "target_user_id": "author_revenue",
                "amount": 200,
                "reason": "人工充值",
            }
        )
        self.assertEqual(adjustment["amount"], 200)
        self.assertEqual(adjustment["balance_after"], 1200)
        account = service.get_credit_account("author_revenue")
        self.assertEqual(account["balance"], 1200)
        with self.assertRaisesRegex(WorkflowValidationError, "审核权限"):
            service.adjust_credits({"operator_id": "viewer_001", "target_user_id": "author_revenue", "amount": 10})
        with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
            service.adjust_credits(
                {"operator_id": "system_admin", "target_user_id": "author_revenue", "amount": 10, "node_graph": {}}
            )

        project = service.create_project({"title": "分账项目", "owner_id": "author_revenue"})
        work = service.submit_work_for_review(
            project["id"],
            {"title": "分账作品", "video_url": "/storage/final/revenue.mp4", "user_id": "author_revenue"},
        )
        service.review_work(work["id"], "approve", reviewer_id="system_admin")
        share = service.record_work_revenue(
            work["id"],
            {"operator_id": "system_admin", "gross_credits": 100, "source": "manual_settlement"},
        )
        self.assertEqual(share["gross_credits"], 100)
        self.assertEqual(share["author_credits"], 70)
        self.assertEqual(share["platform_credits"], 30)
        self.assertTrue(share["transaction_id"])
        updated = service.get_credit_account("author_revenue")
        self.assertEqual(updated["balance"], 1270)
        self.assertEqual(updated["total_earned"], 70)
        with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
            service.record_work_revenue(
                work["id"],
                {"operator_id": "system_admin", "gross_credits": 10, "node_graph": {}},
            )

    def test_payment_order_webhook_credits_account_and_is_idempotent(self) -> None:
        service = self.make_service()
        order = service.create_payment_order(
            {
                "user_id": "pay_author",
                "channel": "stripe",
                "credits": 300,
                "amount_cents": 3000,
                "currency": "CNY",
                "checkout_url": "https://pay.example.com/checkout/order_001",
            }
        )
        self.assertEqual(order["status"], "pending")
        self.assertEqual(order["credits"], 300)
        account = service.get_credit_account("pay_author")
        self.assertEqual(account["balance"], 1000)
        with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
            service.create_payment_order(
                {"user_id": "pay_author", "credits": 100, "amount_cents": 990, "node_graph": {}}
            )

        templated = service.create_payment_order(
            {
                "user_id": "pay_author",
                "channel": "stripe",
                "credits": 100,
                "amount_cents": 990,
                "currency": "CNY",
                "checkout_url_template": "https://pay.example.com/checkout/{order_id}?amount={amount_cents}&credits={credits}&currency={currency}&channel={channel}&user={user_id}",
            }
        )
        self.assertIn(templated["id"], templated["checkout_url"])
        self.assertIn("amount=990", templated["checkout_url"])
        self.assertIn("channel=stripe", templated["checkout_url"])
        with self.assertRaisesRegex(WorkflowValidationError, "未知占位符"):
            service.create_payment_order(
                {
                    "user_id": "pay_author",
                    "channel": "stripe",
                    "credits": 100,
                    "amount_cents": 990,
                    "checkout_url_template": "https://pay.example.com/{missing}",
                }
            )
        with self.assertRaisesRegex(WorkflowValidationError, "HTTP/HTTPS"):
            service.create_payment_order(
                {
                    "user_id": "pay_author",
                    "channel": "stripe",
                    "credits": 100,
                    "amount_cents": 990,
                    "checkout_url_template": "/checkout/{order_id}",
                }
            )

        payload = {
            "order_id": order["id"],
            "channel": "stripe",
            "external_order_id": "pi_001",
            "status": "paid",
            "paid_amount_cents": 3000,
        }
        payload["signature"] = hmac.new(
            b"pay-secret",
            payment_signature_payload(payload),
            hashlib.sha256,
        ).hexdigest()
        paid = service.confirm_payment_order(payload, webhook_secret="pay-secret")
        self.assertEqual(paid["status"], "paid")
        self.assertTrue(paid["transaction_id"])
        credited = service.get_credit_account("pay_author")
        self.assertEqual(credited["balance"], 1300)
        unknown_webhook = dict(payload)
        unknown_webhook["node_graph"] = {}
        unknown_webhook["signature"] = hmac.new(
            b"pay-secret",
            payment_signature_payload(unknown_webhook),
            hashlib.sha256,
        ).hexdigest()
        with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
            service.confirm_payment_order(unknown_webhook, webhook_secret="pay-secret")

        repeated = service.confirm_payment_order(payload, webhook_secret="pay-secret")
        self.assertEqual(repeated["transaction_id"], paid["transaction_id"])
        self.assertEqual(service.get_credit_account("pay_author")["balance"], 1300)

        bad_signature = dict(payload)
        bad_signature["signature"] = "bad"
        with self.assertRaisesRegex(WorkflowValidationError, "签名无效"):
            service.confirm_payment_order(bad_signature, webhook_secret="pay-secret")

        mismatch = dict(payload)
        mismatch["paid_amount_cents"] = 3100
        mismatch["signature"] = hmac.new(
            b"pay-secret",
            payment_signature_payload(mismatch),
            hashlib.sha256,
        ).hexdigest()
        with self.assertRaisesRegex(WorkflowValidationError, "金额与订单不一致"):
            service.confirm_payment_order(mismatch, webhook_secret="pay-secret")

    def test_admin_can_probe_payment_webhook_with_signed_test_order(self) -> None:
        service = self.make_service()

        with self.assertRaisesRegex(WorkflowValidationError, "审核权限"):
            service.probe_payment_webhook({"operator_id": "viewer_001"}, webhook_secret="pay-secret")
        with self.assertRaisesRegex(WorkflowValidationError, "签名密钥"):
            service.probe_payment_webhook({"operator_id": "system_admin"}, webhook_secret="")
        with self.assertRaisesRegex(WorkflowValidationError, "探针积分"):
            service.probe_payment_webhook({"operator_id": "system_admin", "credits": 0}, webhook_secret="pay-secret")
        with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
            service.probe_payment_webhook({"operator_id": "system_admin", "node_graph": {}}, webhook_secret="pay-secret")

        before = service.get_credit_account("system_admin")
        result = service.probe_payment_webhook(
            {"operator_id": "system_admin", "channel": "stripe", "credits": 3, "amount_cents": 9},
            webhook_secret="pay-secret",
        )
        order = service.repository.payment_orders[result["order_id"]]

        self.assertTrue(result["ok"])
        self.assertTrue(result["signature_verified"])
        self.assertEqual(result["channel"], "stripe")
        self.assertEqual(result["credits"], 3)
        self.assertEqual(result["amount_cents"], 9)
        self.assertEqual(result["account_balance_after"], before["balance"] + 3)
        self.assertEqual(order.status, PaymentOrderStatus.PAID)
        self.assertEqual(order.provider_payload["probe"], True)
        self.assertTrue(order.transaction_id)

    def test_subscription_and_withdrawal_flow_updates_credit_account(self) -> None:
        service = self.make_service()
        subscription = service.create_subscription(
            {
                "user_id": "member_author",
                "plan_code": "creator_pro",
                "billing_cycle": "monthly",
                "credit_cost": 299,
                "benefits": {"concurrency": 2},
            }
        )
        self.assertEqual(subscription["status"], "active")
        self.assertEqual(subscription["credit_cost"], 299)
        self.assertTrue(subscription["transaction_id"])
        account = service.get_credit_account("member_author")
        self.assertEqual(account["balance"], 701)
        self.assertEqual(account["total_consumed"], 299)
        self.assertEqual(service.list_user_subscriptions("member_author")[0]["id"], subscription["id"])
        with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
            service.create_subscription({"user_id": "member_author", "credit_cost": 10, "node_graph": {}})

        withdrawal = service.create_withdrawal_request(
            {
                "user_id": "member_author",
                "amount_credits": 200,
                "payout_channel": "alipay",
                "payout_account": "creator@example.com",
                "applicant_note": "月度结算",
            }
        )
        self.assertEqual(withdrawal["status"], "pending_review")
        self.assertTrue(withdrawal["transaction_id"])
        after_freeze = service.get_credit_account("member_author")
        self.assertEqual(after_freeze["balance"], 501)
        self.assertEqual(service.list_user_withdrawals("member_author")[0]["id"], withdrawal["id"])
        with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
            service.create_withdrawal_request(
                {
                    "user_id": "member_author",
                    "amount_credits": 10,
                    "payout_channel": "manual",
                    "payout_account": "bank-card",
                    "node_graph": {},
                }
            )
        review_queue = service.list_withdrawal_requests({"operator_id": "system_admin", "status": "pending_review"})
        self.assertEqual([item["id"] for item in review_queue], [withdrawal["id"]])
        with self.assertRaisesRegex(WorkflowValidationError, "审核权限"):
            service.list_withdrawal_requests({"operator_id": "viewer_001"})
        with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
            service.list_withdrawal_requests({"operator_id": "system_admin", "node_graph": {}})

        rejected = service.review_withdrawal_request(
            withdrawal["id"],
            {"operator_id": "system_admin", "action": "reject", "review_note": "提现账号待确认"},
        )
        self.assertEqual(rejected["status"], "rejected")
        self.assertEqual(rejected["reviewer_id"], "system_admin")
        self.assertIn("refund_transaction_id", rejected["provider_payload"])
        refunded = service.get_credit_account("member_author")
        self.assertEqual(refunded["balance"], 701)
        with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
            service.review_withdrawal_request(
                withdrawal["id"],
                {"operator_id": "system_admin", "action": "reject", "node_graph": {}},
            )

        approved_withdrawal = service.create_withdrawal_request(
            {
                "user_id": "member_author",
                "amount_credits": 100,
                "payout_channel": "manual",
                "payout_account": "bank-card",
            }
        )
        approved = service.review_withdrawal_request(
            approved_withdrawal["id"],
            {
                "operator_id": "system_admin",
                "action": "approve",
                "provider_payout_id": "payout_001",
                "provider_payload": {"batch_no": "batch_001"},
            },
        )
        self.assertEqual(approved["status"], "approved")
        self.assertEqual(approved["provider_payout_id"], "payout_001")
        self.assertEqual(service.get_credit_account("member_author")["balance"], 601)
        with self.assertRaisesRegex(WorkflowValidationError, "不能重复处理"):
            service.review_withdrawal_request(approved_withdrawal["id"], {"operator_id": "system_admin", "action": "approve"})
        with self.assertRaisesRegex(WorkflowValidationError, "审核权限"):
            service.review_withdrawal_request(approved_withdrawal["id"], {"operator_id": "viewer_001", "action": "reject"})

    def test_withdrawal_approval_dispatches_payout_webhook_and_records_result(self) -> None:
        dispatcher = CapturingPayoutDispatcher(
            PayoutDispatchResult(
                dispatched=True,
                skipped=False,
                status_code=202,
                message="测试打款系统已受理。",
                provider_payout_id="provider_payout_001",
            )
        )
        service = self.make_service(payout_dispatcher=dispatcher)
        withdrawal = service.create_withdrawal_request(
            {
                "user_id": "payout_author",
                "amount_credits": 120,
                "payout_channel": "alipay",
                "payout_account": "creator@example.com",
                "applicant_note": "季度结算",
            }
        )

        approved = service.review_withdrawal_request(
            withdrawal["id"],
            {"operator_id": "system_admin", "action": "approve", "review_note": "资料通过"},
        )

        self.assertEqual(approved["status"], "approved")
        self.assertEqual(approved["payout_dispatch_status"], "dispatched")
        self.assertEqual(approved["provider_payout_id"], "provider_payout_001")
        self.assertEqual(approved["provider_payload"]["payout_dispatch"]["status_code"], 202)
        self.assertEqual(dispatcher.withdrawals[0]["id"], withdrawal["id"])
        self.assertEqual(dispatcher.withdrawals[0]["reviewer_id"], "system_admin")

    def test_withdrawal_payout_dispatch_failure_is_audited_without_refund(self) -> None:
        dispatcher = CapturingPayoutDispatcher(
            PayoutDispatchResult(False, False, message="提现打款通知失败：timeout")
        )
        service = self.make_service(payout_dispatcher=dispatcher)
        withdrawal = service.create_withdrawal_request(
            {
                "user_id": "payout_failure_author",
                "amount_credits": 80,
                "payout_channel": "manual",
                "payout_account": "bank-card",
            }
        )

        approved = service.review_withdrawal_request(
            withdrawal["id"],
            {"operator_id": "system_admin", "action": "approve"},
        )

        self.assertEqual(approved["status"], "approved")
        self.assertEqual(approved["payout_dispatch_status"], "failed")
        self.assertIn("失败", approved["payout_dispatch_message"])
        self.assertEqual(service.get_credit_account("payout_failure_author")["balance"], 920)
        failed_queue = service.list_withdrawal_requests(
            {"operator_id": "system_admin", "status": "approved", "payout_status": "failed"}
        )
        self.assertEqual([item["id"] for item in failed_queue], [withdrawal["id"]])

        dispatcher.result = PayoutDispatchResult(
            True,
            False,
            status_code=200,
            message="提现打款通知已发送。",
            provider_payout_id="retry_payout_001",
        )
        retried = service.retry_withdrawal_payout(
            withdrawal["id"],
            {"operator_id": "system_admin", "review_note": "重试打款通知"},
        )
        self.assertEqual(retried["payout_dispatch_status"], "dispatched")
        self.assertEqual(retried["provider_payout_id"], "retry_payout_001")
        self.assertEqual(dispatcher.withdrawals[-1]["id"], withdrawal["id"])
        with self.assertRaisesRegex(WorkflowValidationError, "不能重复重试"):
            service.retry_withdrawal_payout(withdrawal["id"], {"operator_id": "system_admin"})
        with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
            service.retry_withdrawal_payout(withdrawal["id"], {"operator_id": "system_admin", "node_graph": {}})

        pending = service.create_withdrawal_request(
            {
                "user_id": "payout_failure_author",
                "amount_credits": 10,
                "payout_channel": "manual",
                "payout_account": "bank-card",
            }
        )
        with self.assertRaisesRegex(WorkflowValidationError, "已通过"):
            service.retry_withdrawal_payout(pending["id"], {"operator_id": "system_admin"})

    def test_admin_can_probe_payout_webhook_without_creating_withdrawal(self) -> None:
        dispatcher = CapturingPayoutDispatcher(
            PayoutDispatchResult(
                True,
                False,
                status_code=202,
                message="测试打款系统已受理。",
                provider_payout_id="probe_payout_001",
            )
        )
        service = self.make_service(payout_dispatcher=dispatcher)

        with self.assertRaisesRegex(WorkflowValidationError, "审核权限"):
            service.probe_payout_webhook({"operator_id": "viewer_001"}, dispatcher)
        with self.assertRaisesRegex(WorkflowValidationError, "探针打款积分"):
            service.probe_payout_webhook({"operator_id": "system_admin", "amount_credits": 0}, dispatcher)
        with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
            service.probe_payout_webhook({"operator_id": "system_admin", "node_graph": {}}, dispatcher)

        result = service.probe_payout_webhook(
            {
                "operator_id": "system_admin",
                "amount_credits": 9,
                "payout_channel": "alipay",
                "payout_account": "probe@example.com",
            },
            dispatcher,
        )

        self.assertTrue(result["ok"])
        self.assertTrue(result["dispatched"])
        self.assertEqual(result["status_code"], 202)
        self.assertEqual(result["provider_payout_id"], "probe_payout_001")
        self.assertEqual(result["payout_channel"], "alipay")
        self.assertEqual(result["amount_credits"], 9)
        self.assertEqual(len(service.repository.withdrawal_requests), 0)
        self.assertEqual(dispatcher.withdrawals[-1]["id"], result["probe_id"])
        self.assertEqual(dispatcher.withdrawals[-1]["payout_account"], "probe@example.com")

    def test_webhook_payout_dispatcher_posts_signed_payload(self) -> None:
        withdrawal = {
            "id": "withdrawal_001",
            "user_id": "author_001",
            "amount_credits": 300,
            "payout_channel": "alipay",
            "payout_account": "creator@example.com",
            "reviewer_id": "system_admin",
            "review_note": "通过",
            "applicant_note": "月度结算",
        }
        captured = {}

        class Response:
            status = 202

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback) -> None:
                return None

            def read(self):
                return b'{"payout_id":"payout_remote_001"}'

        def fake_urlopen(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            return Response()

        with patch("urllib.request.urlopen", fake_urlopen):
            result = WebhookPayoutDispatcher(
                "https://payout.example.com/withdrawals",
                secret="payout-secret",
                provider="finance-system",
                timeout_seconds=4,
            ).dispatch_withdrawal(withdrawal)

        self.assertTrue(result.dispatched)
        self.assertEqual(result.status_code, 202)
        self.assertEqual(result.provider_payout_id, "payout_remote_001")
        self.assertEqual(captured["timeout"], 4)
        payload = json.loads(captured["request"].data.decode("utf-8"))
        self.assertEqual(payload["source"], "video-gen-platform")
        self.assertEqual(payload["provider"], "finance-system")
        self.assertEqual(payload["withdrawal_id"], "withdrawal_001")
        headers = {key.lower(): value for key, value in captured["request"].header_items()}
        expected_signature = hmac.new(b"payout-secret", captured["request"].data, hashlib.sha256).hexdigest()
        self.assertEqual(headers["x-video-gen-payout-signature"], expected_signature)

    def test_create_payout_dispatcher_from_env_reads_webhook_config(self) -> None:
        with patch.dict(
            "os.environ",
            {
                "PLATFORM_PAYOUT_WEBHOOK_URL": "https://payout.example.com/withdrawals",
                "PLATFORM_PAYOUT_WEBHOOK_SECRET": "payout-secret",
                "PLATFORM_PAYOUT_PROVIDER": "finance-system",
                "PLATFORM_PAYOUT_TIMEOUT_SECONDS": "3",
            },
        ):
            dispatcher = create_payout_dispatcher_from_env()

        self.assertEqual(dispatcher.webhook_url, "https://payout.example.com/withdrawals")
        self.assertEqual(dispatcher.secret, "payout-secret")
        self.assertEqual(dispatcher.provider, "finance-system")
        self.assertEqual(dispatcher.timeout_seconds, 3)

    def test_admin_can_install_comfyui_plugin_to_configured_root(self) -> None:
        service = self.make_service()
        with tempfile.TemporaryDirectory() as temp_dir:
            report = service.install_comfyui_plugin(
                {"operator_id": "system_admin", "comfyui_root": temp_dir}
            )
            target = Path(report["target_dir"])
            self.assertTrue(report["installed"])
            self.assertTrue((target / "__init__.py").is_file())
            self.assertTrue((target / "README.md").is_file())
            self.assertIn("PlatformBusinessInput", report["node_keys"])
            with self.assertRaisesRegex(WorkflowValidationError, "已存在"):
                service.install_comfyui_plugin({"operator_id": "system_admin", "comfyui_root": temp_dir})
            forced = service.install_comfyui_plugin(
                {"operator_id": "system_admin", "comfyui_root": temp_dir, "force": True}
            )
            self.assertTrue(forced["installed"])
        with self.assertRaisesRegex(WorkflowValidationError, "审核权限"):
            service.install_comfyui_plugin({"operator_id": "viewer_001", "comfyui_root": "/tmp/comfyui"})
        with self.assertRaisesRegex(WorkflowValidationError, "COMFYUI_ROOT"):
            service.install_comfyui_plugin({"operator_id": "system_admin"})
        with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
            service.install_comfyui_plugin({"operator_id": "system_admin", "comfyui_root": "/tmp/comfyui", "node_graph": {}})

    def test_admin_can_probe_storage_and_cleanup_probe_copy(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            service = self.make_service(storage_root=str(Path(temp_dir) / "storage"))

            with self.assertRaisesRegex(WorkflowValidationError, "审核权限"):
                service.probe_storage({"user_id": "viewer_001"})
            with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
                service.probe_storage({"user_id": "system_admin", "node_graph": {}})

            result = service.probe_storage({"user_id": "system_admin"})

            self.assertTrue(result["ok"])
            self.assertEqual(result["driver"], "local")
            self.assertGreater(result["bytes_written"], 0)
            self.assertTrue(result["local_copy_removed"])
            self.assertFalse(result["remote_copy_removed"])
            self.assertEqual(list((service.storage.root / "assets").rglob("*")), [])

    def test_storage_probe_uploads_and_deletes_s3_probe_object(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = CapturingS3Storage(
                Path(temp_dir) / "storage",
                endpoint_url="https://s3.example.com",
                bucket="video-gen",
                access_key="access-key",
                secret_key="secret-key",
                region="us-east-1",
                prefix="prod",
                public_base_url="https://cdn.example.com/video-gen",
            )
            service = PlatformService(storage=storage)

            result = service.probe_storage({"operator_id": "system_admin"})

            self.assertEqual(result["driver"], "s3")
            self.assertTrue(result["remote_copy_removed"])
            self.assertEqual(len(storage.uploads), 1)
            self.assertEqual(len(storage.deletes), 1)
            self.assertEqual(storage.uploads[0]["object_key"], storage.deletes[0])
            self.assertIn("/prod/assets/storage_probe_", result["url"])

    def test_admin_overview_reports_missing_asset_references(self) -> None:
        service = self.make_service()
        project = service.create_project({"title": "失效引用项目", "owner_id": "author_001"})
        analysis = service.analyze_script(project["id"], {"script": "镜头一。", "user_id": "author_001"})
        shot = service.repository.shots[analysis["shots"][0]["id"]]
        task = service.generate_shot_image(project["id"], shot.id, {"user_id": "author_001"})
        service.repository.tasks[task["id"]].output_asset_ids.append("asset_missing_task")
        shot.asset_ids.append("asset_missing_shot")
        timeline = service.build_project_timeline(project["id"], {"user_id": "author_001"})
        service.repository.timeline_items[timeline["timeline"][0]["id"]].video_asset_id = "asset_missing_timeline"
        work = service.submit_work_for_review(
            project["id"],
            {
                "title": "失效作品引用",
                "video_url": "/storage/assets/missing/final.mp4",
                "cover_url": "/storage/assets/missing/cover.png",
                "user_id": "author_001",
            },
        )

        overview = service.admin_overview()
        health = service.platform_health()
        cleanup = service.cleanup_storage({"user_id": "system_admin", "dry_run": True})

        self.assertEqual(overview["missing_asset_reference_count"], 5)
        self.assertTrue(any("asset_missing_task" in item for item in overview["missing_asset_references"]))
        self.assertTrue(any("asset_missing_shot" in item for item in overview["missing_asset_references"]))
        self.assertTrue(any("asset_missing_timeline" in item for item in cleanup["missing_asset_references"]))
        self.assertTrue(any(f"work:{work['id']}:cover_url" in item for item in overview["missing_asset_references"]))
        self.assertTrue(any(f"work:{work['id']}:video_url" in item for item in cleanup["missing_asset_references"]))
        self.assertTrue(any("失效素材引用" in item["message"] for item in health["alerts"]))

    def test_cleanup_storage_removes_orphan_files_and_reports_missing_assets(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "shot.png"
            source.write_bytes(b"fake image bytes")
            service = self.make_service(storage_root=str(Path(temp_dir) / "storage"))
            task = service.create_generation_task("selfhost/image_flux", {"prompt": "保留素材"})
            asset = service.archive_output(task["id"], source, "9")
            kept_path = Path(asset["local_path"])
            orphan_dir = service.storage.root / "assets" / "orphan-task"
            orphan_dir.mkdir(parents=True)
            orphan_file = orphan_dir / "orphan.tmp"
            orphan_file.write_bytes(b"orphan")
            missing_asset = Asset(
                asset_type=AssetType.IMAGE,
                url="/storage/assets/missing/missing.png",
                local_path=str(service.storage.root / "assets" / "missing" / "missing.png"),
                source_task_id="missing",
            )
            service.repository.assets[missing_asset.id] = missing_asset

            with self.assertRaisesRegex(WorkflowValidationError, "审核权限"):
                service.cleanup_storage({"user_id": "viewer_001"})
            with self.assertRaisesRegex(WorkflowValidationError, "预检模式.*布尔值"):
                service.cleanup_storage({"user_id": "system_admin", "dry_run": "false"})
            with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
                service.cleanup_storage({"user_id": "system_admin", "node_graph": {}})

            dry_run = service.cleanup_storage({"user_id": "system_admin", "dry_run": True})
            self.assertEqual(dry_run["orphan_file_count"], 1)
            self.assertEqual(dry_run["deleted_file_count"], 0)
            self.assertTrue(orphan_file.exists())
            self.assertEqual(dry_run["missing_asset_count"], 1)
            self.assertIn(missing_asset.id, dry_run["missing_asset_ids"])

            result = service.cleanup_storage({"user_id": "system_admin"})
            self.assertEqual(result["deleted_file_count"], 1)
            self.assertGreater(result["deleted_bytes"], 0)
            self.assertFalse(orphan_file.exists())
            self.assertTrue(kept_path.exists())

    def test_platform_health_reports_healthy_when_runtime_is_clear(self) -> None:
        service = self.make_service()
        health = service.platform_health()
        self.assertEqual(health["status"], "healthy")
        self.assertEqual(health["message"], "平台运行正常。")
        self.assertTrue(health["comfy"]["connected"])
        self.assertEqual(health["alerts"], [])

    def test_platform_health_reports_alerts_for_failures_storage_and_comfy(self) -> None:
        service = self.make_service(comfy=OfflineComfy())
        project = service.create_project({"title": "健康检查项目", "owner_id": "author_001"})
        failed = service.create_generation_task("selfhost/image_flux", {"prompt": "失败任务"}, project_id=project["id"])
        service.repository.tasks[failed["id"]].status = TaskStatus.FAILED
        service.repository.assets["missing_asset"] = Asset(
            id="missing_asset",
            asset_type=AssetType.IMAGE,
            local_path=str(Path(tempfile.mkdtemp()) / "missing.png"),
            source_task_id=failed["id"],
        )

        health = service.platform_health()
        self.assertEqual(health["status"], "unhealthy")
        self.assertEqual(health["message"], "平台存在阻断性异常。")
        self.assertTrue(any(item["level"] == "error" for item in health["alerts"]))
        self.assertTrue(any(item["message"] == "ComfyUI 未连接" for item in health["alerts"]))
        self.assertTrue(any("失败任务" in item["message"] for item in health["alerts"]))
        self.assertTrue(any("缺失素材" in item["message"] for item in health["alerts"]))

    def test_webhook_alert_notifier_skips_without_webhook_and_signs_payload(self) -> None:
        health = {
            "status": "degraded",
            "message": "平台可用，但存在需要处理的告警。",
            "alerts": [{"level": "warning", "message": "存在 1 个失败任务，请检查生成日志。"}],
            "overview": {"task_status_counts": {"failed": 1}},
        }
        skipped = WebhookAlertNotifier("").notify_health(health)
        self.assertTrue(skipped.skipped)
        self.assertFalse(skipped.delivered)
        self.assertEqual(skipped.alert_count, 1)

        captured = {}

        class Response:
            status = 204

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback) -> None:
                return None

        def fake_urlopen(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            return Response()

        with patch("urllib.request.urlopen", fake_urlopen):
            delivered = WebhookAlertNotifier(
                "https://alerts.example.com/hook",
                secret="alert-secret",
                timeout_seconds=3,
            ).notify_health(health)

        self.assertTrue(delivered.delivered)
        self.assertEqual(delivered.status_code, 204)
        self.assertEqual(captured["timeout"], 3)
        headers = {key.lower(): value for key, value in captured["request"].header_items()}
        self.assertIn("x-video-gen-signature", headers)
        self.assertIn(b"video-gen-platform", captured["request"].data)

    def test_webhook_alert_notifier_deduplicates_alerts_with_cooldown_state(self) -> None:
        health = {
            "status": "degraded",
            "message": "平台可用，但存在需要处理的告警。",
            "alerts": [{"level": "warning", "message": "存在 1 个失败任务，请检查生成日志。"}],
            "overview": {"task_status_counts": {"failed": 1}},
        }
        sent_requests = []
        now = {"value": 100.0}

        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback) -> None:
                return None

        def fake_urlopen(request, timeout):
            sent_requests.append(request)
            return Response()

        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "alert-state.json"
            notifier = WebhookAlertNotifier(
                "https://alerts.example.com/hook",
                cooldown_seconds=60,
                state_path=state_path,
                clock=lambda: now["value"],
            )
            with patch("urllib.request.urlopen", fake_urlopen):
                first = notifier.notify_health(health)
                second = notifier.notify_health(health)
                persisted = WebhookAlertNotifier(
                    "https://alerts.example.com/hook",
                    cooldown_seconds=60,
                    state_path=state_path,
                    clock=lambda: now["value"],
                ).notify_health(health)
                now["value"] = 161.0
                third = notifier.notify_health(health)

        self.assertTrue(first.delivered)
        self.assertTrue(second.skipped)
        self.assertIn("冷却窗口", second.message)
        self.assertTrue(persisted.skipped)
        self.assertTrue(third.delivered)
        self.assertEqual(len(sent_requests), 2)

    def test_webhook_alert_notifier_formats_known_chat_channels(self) -> None:
        health = {
            "status": "degraded",
            "message": "平台可用，但存在需要处理的告警。",
            "alerts": [{"level": "warning", "message": "存在 1 个失败任务，请检查生成日志。"}],
            "overview": {"task_status_counts": {"failed": 1}},
        }
        sent_payloads = {}

        class Response:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback) -> None:
                return None

        def fake_urlopen(request, timeout):
            sent_payloads[request.full_url] = json.loads(request.data.decode("utf-8"))
            return Response()

        with patch("urllib.request.urlopen", fake_urlopen):
            for channel in ("feishu", "dingtalk", "slack"):
                WebhookAlertNotifier(f"https://alerts.example.com/{channel}", channel=channel).notify_health(health)

        feishu_payload = sent_payloads["https://alerts.example.com/feishu"]
        self.assertEqual(feishu_payload["msg_type"], "text")
        self.assertIn("存在 1 个失败任务", feishu_payload["content"]["text"])

        dingtalk_payload = sent_payloads["https://alerts.example.com/dingtalk"]
        self.assertEqual(dingtalk_payload["msgtype"], "markdown")
        self.assertEqual(dingtalk_payload["markdown"]["title"], "漫剧工坊告警")
        self.assertIn("**warning**", dingtalk_payload["markdown"]["text"])

        slack_payload = sent_payloads["https://alerts.example.com/slack"]
        self.assertIn("blocks", slack_payload)
        self.assertIn("*warning*:", slack_payload["blocks"][0]["text"]["text"])

    def test_create_alert_notifier_from_env_reads_cooldown_and_state_path(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, patch.dict(
            "os.environ",
            {
                "PLATFORM_ALERT_WEBHOOK_URL": "https://alerts.example.com/hook",
                "PLATFORM_ALERT_WEBHOOK_SECRET": "secret",
                "PLATFORM_ALERT_CHANNEL": "dingtalk",
                "PLATFORM_ALERT_TIMEOUT_SECONDS": "2",
                "PLATFORM_ALERT_COOLDOWN_SECONDS": "120",
                "PLATFORM_ALERT_STATE_PATH": str(Path(temp_dir) / "state.json"),
            },
        ):
            notifier = create_alert_notifier_from_env()

        self.assertEqual(notifier.webhook_url, "https://alerts.example.com/hook")
        self.assertEqual(notifier.secret, "secret")
        self.assertEqual(notifier.channel, "dingtalk")
        self.assertEqual(notifier.timeout_seconds, 2)
        self.assertEqual(notifier.cooldown_seconds, 120)
        self.assertEqual(notifier.state_path, Path(temp_dir) / "state.json")

    def test_create_project_from_template_carries_workflow_defaults(self) -> None:
        service = self.make_service()
        script_spec = service.registry.get("platform/script_analysis")
        script_template = WorkTemplate(
            name="脚本分析内部流程",
            description=script_spec.description,
            author_id="system",
            workflow_key=script_spec.workflow_key,
            parameter_schema=script_spec.input_schema,
            default_params=script_spec.default_params,
            status="published",
        )
        service.repository.templates[script_template.id] = script_template
        self.assertNotIn(script_template.id, {item["id"] for item in service.list_templates()})
        with self.assertRaisesRegex(WorkflowValidationError, "不能直接作为项目模板复刻"):
            service.create_project(
                {
                    "title": "错误脚本模板项目",
                    "project_type": "模板复刻",
                    "template_id": script_template.id,
                    "owner_id": "user_001",
                }
            )
        with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
            service.create_project({"title": "错误字段项目", "owner_id": "user_001", "node_graph": {}})
        template = next(item for item in service.list_templates() if item["workflow_key"] == "selfhost/image_flux")
        service.repository.templates[template["id"]].default_params.update({"width": 512, "height": 768, "seed": 99})
        template = next(item for item in service.list_templates() if item["id"] == template["id"])
        project = service.create_project(
            {
                "title": "模板复刻项目",
                "project_type": "模板复刻",
                "template_id": template["id"],
                "owner_id": "user_001",
            }
        )
        updated_template = next(item for item in service.list_templates() if item["id"] == template["id"])
        self.assertEqual(project["workflow_key"], template["workflow_key"])
        self.assertEqual(project["default_params"], template["default_params"])
        self.assertEqual(updated_template["usage_count"], 1)
        self.assertIn("cover_url", updated_template)
        self.assertTrue(updated_template["sample_video_url"])
        self.assertIn("prompt", updated_template["example_inputs"])
        self.assertIn("分镜首帧", updated_template["applicable_scenarios"])

        analysis = service.analyze_script(project["id"], {"script": "模板镜头。", "user_id": "user_001"})
        task = service.generate_shot_image(project["id"], analysis["shots"][0]["id"], {"user_id": "user_001"})
        overridden = service.generate_shot_image(
            project["id"],
            analysis["shots"][0]["id"],
            {"user_id": "user_001", "width": 640, "seed": 7},
        )
        self.assertEqual(task["input_params"]["width"], 512)
        self.assertEqual(task["input_params"]["height"], 768)
        self.assertEqual(task["input_params"]["seed"], 99)
        self.assertEqual(overridden["input_params"]["width"], 640)
        self.assertEqual(overridden["input_params"]["height"], 768)
        self.assertEqual(overridden["input_params"]["seed"], 7)
        work = service.submit_work_for_review(
            project["id"], {"title": "模板来源作品", "video_url": "/storage/final/template.mp4", "user_id": "user_001"}
        )
        self.assertEqual(work["template_id"], template["id"])
        self.assertEqual(work["template_name"], template["name"])


    def test_project_graph_can_save_delete_and_run_demo_node(self) -> None:
        service = PlatformService(comfy=FakeComfy())
        project = service.create_project({"title": "节点画布项目", "owner_id": "author_graph"})
        graph = service.get_project_graph(project["id"], user_id="author_graph", require_owner=True)
        self.assertEqual(graph["project_id"], project["id"])
        self.assertEqual(graph["nodes"], [])

        saved = service.save_project_graph(
            project["id"],
            {
                "user_id": "author_graph",
                "nodes": [
                    {"id": "text_1", "type": "text", "position": {"x": 10, "y": 20}, "data": {"title": "文本", "text": "雨夜车站"}, "status": "draft"},
                    {"id": "demo_1", "type": "demo", "position": {"x": 260, "y": 20}, "data": {"title": "演示"}, "status": "draft"},
                ],
                "edges": [{"id": "edge_1", "source": "text_1", "target": "demo_1"}],
                "viewport": {"x": 1, "y": 2, "zoom": 0.8},
            },
        )
        self.assertEqual(len(saved["nodes"]), 2)
        self.assertEqual(len(saved["edges"]), 1)

        result = service.run_project_graph_node(project["id"], "demo_1", {"user_id": "author_graph"})
        self.assertEqual(result["node"]["status"], "completed")
        self.assertIn("演示节点已完成", result["message"])

        deleted = service.delete_project_graph_node(project["id"], "text_1", {"user_id": "author_graph"})
        self.assertTrue(deleted["deleted"])
        graph_after_delete = service.get_project_graph(project["id"], user_id="author_graph", require_owner=True)
        self.assertEqual([node["id"] for node in graph_after_delete["nodes"]], ["demo_1"])
        self.assertEqual(graph_after_delete["edges"], [])

    def test_project_graph_generation_nodes_use_params_and_incoming_edges(self) -> None:
        service = PlatformService(comfy=FakeComfy())
        project = service.create_project({"title": "节点参数项目", "owner_id": "author_graph"})
        shot = service.create_storyboard_shot(
            project["id"],
            {"user_id": "author_graph", "narration": "雨夜旁白", "visual_description": "雨夜车站远景"},
        )
        service.save_project_graph(
            project["id"],
            {
                "user_id": "author_graph",
                "nodes": [
                    {"id": "text_1", "type": "text", "position": {"x": 10, "y": 20}, "data": {"text": "电影感雨夜车站", "shot_id": shot["id"]}},
                    {"id": "image_1", "type": "image_generation", "position": {"x": 260, "y": 20}, "data": {"width": "640", "height": "960", "seed": "42"}},
                    {"id": "image_asset_1", "type": "image", "position": {"x": 510, "y": 20}, "data": {"image_url": "/storage/shot.png", "shot_id": shot["id"]}},
                    {"id": "video_1", "type": "video_generation", "position": {"x": 760, "y": 20}, "data": {"duration": "5.5", "fps": "24"}},
                ],
                "edges": [
                    {"id": "edge_text_image", "source": "text_1", "target": "image_1"},
                    {"id": "edge_image_video", "source": "image_asset_1", "target": "video_1"},
                ],
            },
        )

        image_result = service.run_project_graph_node(project["id"], "image_1", {"user_id": "author_graph"})
        self.assertEqual(image_result["task"]["input_params"]["prompt"], "电影感雨夜车站")
        self.assertEqual(image_result["task"]["input_params"]["width"], 640)
        self.assertEqual(image_result["task"]["input_params"]["height"], 960)
        self.assertEqual(image_result["task"]["input_params"]["seed"], 42)
        self.assertEqual(image_result["node"]["data"]["shot_id"], shot["id"])

        video_result = service.run_project_graph_node(project["id"], "video_1", {"user_id": "author_graph"})
        self.assertEqual(video_result["task"]["input_params"]["first_frame_url"], "/storage/shot.png")
        self.assertEqual(video_result["task"]["input_params"]["duration"], 5.5)
        self.assertEqual(video_result["task"]["input_params"]["fps"], 24)
        self.assertEqual(video_result["node"]["data"]["shot_id"], shot["id"])

    def test_project_graph_character_nodes_drive_generation_references(self) -> None:
        service = PlatformService(comfy=FakeComfy())
        project = service.create_project({"title": "角色节点项目", "owner_id": "author_graph"})
        shot = service.create_storyboard_shot(
            project["id"],
            {"user_id": "author_graph", "narration": "女主抬头看向雨幕", "visual_description": "雨夜街口近景"},
        )
        service.save_project_graph(
            project["id"],
            {
                "user_id": "author_graph",
                "nodes": [
                    {
                        "id": "character_1",
                        "type": "character",
                        "position": {"x": 10, "y": 20},
                        "data": {
                            "character_name": "林夏",
                            "character_description": "红色雨衣、短发、神情紧张",
                            "reference_image_url": "/storage/reference/linxia.png",
                            "style_prompt": "统一悬疑漫剧风格",
                        },
                    },
                    {"id": "image_1", "type": "image_generation", "position": {"x": 260, "y": 20}, "data": {"shot_id": shot["id"]}},
                    {"id": "video_1", "type": "video_generation", "position": {"x": 510, "y": 20}, "data": {"shot_id": shot["id"]}},
                ],
                "edges": [
                    {"id": "edge_character_image", "source": "character_1", "target": "image_1"},
                    {"id": "edge_character_video", "source": "character_1", "target": "video_1"},
                ],
            },
        )

        image_result = service.run_project_graph_node(project["id"], "image_1", {"user_id": "author_graph"})
        self.assertEqual(image_result["task"]["input_params"]["prompt"], "红色雨衣、短发、神情紧张")
        self.assertEqual(image_result["task"]["input_params"]["reference_image_url"], "/storage/reference/linxia.png")
        self.assertEqual(image_result["task"]["input_params"]["style_prompt"], "统一悬疑漫剧风格")

        video_result = service.run_project_graph_node(project["id"], "video_1", {"user_id": "author_graph"})
        self.assertEqual(video_result["task"]["input_params"]["prompt"], "红色雨衣、短发、神情紧张")
        self.assertEqual(video_result["task"]["input_params"]["first_frame_url"], "/storage/reference/linxia.png")

        character_result = service.run_project_graph_node(project["id"], "character_1", {"user_id": "author_graph"})
        self.assertEqual(character_result["node"]["status"], "completed")
        self.assertEqual(character_result["message"], "角色参考节点仅用于传递角色设定，不会提交生成任务。")

    def test_project_graph_rejects_non_author_and_unknown_node_type(self) -> None:
        service = PlatformService(comfy=FakeComfy())
        project = service.create_project({"title": "节点权限项目", "owner_id": "author_graph"})
        with self.assertRaises(WorkflowValidationError):
            service.get_project_graph(project["id"], user_id="other_user", require_owner=True)
        with self.assertRaises(WorkflowValidationError):
            service.save_project_graph(
                project["id"],
                {"user_id": "author_graph", "nodes": [{"id": "raw_1", "type": "raw_comfy", "position": {"x": 0, "y": 0}, "data": {}}], "edges": []},
            )

    def test_script_analysis_creates_characters_and_storyboard_shots(self) -> None:
        service = self.make_service()
        project = service.create_project({"title": "脚本分析项目", "owner_id": "author_001"})
        result = service.analyze_script(
            project["id"],
            {
                "script": "女主在雨夜车站等待。旧出租车停下，熟悉的护身符出现。",
                "style": "悬疑漫剧",
                "main_character": "林夏",
                "user_id": "author_001",
            },
        )
        detail = service.get_project(project["id"])
        self.assertEqual(result["characters"][0]["name"], "林夏")
        self.assertEqual(len(result["shots"]), 2)
        self.assertEqual(result["task"]["task_type"], "script_analysis")
        self.assertEqual(result["task"]["status"], "completed")
        self.assertEqual(result["task"]["progress"], 100)
        self.assertEqual(result["task"]["workflow_key"], "platform/script_analysis")
        self.assertEqual(result["task"]["input_params"]["script"], "女主在雨夜车站等待。旧出租车停下，熟悉的护身符出现。")
        self.assertEqual(result["task"]["input_params"]["main_character"], "林夏")
        self.assertNotIn("script_id", result["task"]["input_params"])
        self.assertNotIn("source", result["task"]["input_params"])
        self.assertEqual(result["task"]["events"][-1]["message"], "脚本分析已完成。")
        script_tasks = service.list_project_tasks(project["id"], status="completed")
        self.assertTrue(any(item["task_type"] == "script_analysis" for item in script_tasks))
        self.assertEqual(detail["current_step"], "storyboard")
        self.assertEqual(detail["shots"][0]["shot_size"], "远景")

        with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
            service.analyze_script(
                project["id"],
                {"script": "新的脚本。", "node_graph": {}, "user_id": "author_001"},
            )

    def test_image_project_analysis_creates_single_reference_shot(self) -> None:
        service = self.make_service()
        project = service.create_project({"title": "图片成片项目", "project_type": "图片成片", "owner_id": "author_001"})
        result = service.analyze_script(
            project["id"],
            {
                "script": "雨夜车站里，女主回头看向镜头",
                "style": "悬疑漫剧",
                "reference_image_url": "/storage/reference/hero.png",
                "user_id": "author_001",
            },
        )
        detail = service.get_project(project["id"])
        self.assertEqual(len(result["shots"]), 1)
        self.assertEqual(result["characters"][0]["name"], "画面主体")
        self.assertEqual(result["characters"][0]["reference_image_url"], "/storage/reference/hero.png")
        self.assertEqual(result["shots"][0]["shot_size"], "中景")
        self.assertIn("参考图：/storage/reference/hero.png", result["shots"][0]["visual_description"])
        self.assertEqual(len(detail["shots"]), 1)

    def test_create_storyboard_shot_adds_manual_shot_for_blank_project(self) -> None:
        service = self.make_service()
        project = service.create_project({"title": "空白项目", "project_type": "空白项目", "owner_id": "author_001"})
        shot = service.create_storyboard_shot(
            project["id"],
            {
                "user_id": "author_001",
                "narration": "主角走进雨夜车站",
                "visual_description": "空荡车站，霓虹反光",
                "prompt": "悬疑漫剧，雨夜车站，电影感",
                "characters": "林夏、司机",
            },
        )
        detail = service.get_project(project["id"])
        self.assertEqual(shot["index"], 1)
        self.assertEqual(shot["characters"], ["林夏", "司机"])
        self.assertEqual(detail["current_step"], "storyboard")
        self.assertEqual(len(detail["shots"]), 1)

        with self.assertRaisesRegex(WorkflowValidationError, "非作者"):
            service.create_storyboard_shot(project["id"], {"user_id": "viewer_001", "narration": "越权", "visual_description": "越权"})
        with self.assertRaisesRegex(WorkflowValidationError, "画面描述"):
            service.create_storyboard_shot(project["id"], {"user_id": "author_001", "narration": "缺画面"})
        with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
            service.create_storyboard_shot(
                project["id"],
                {
                    "user_id": "author_001",
                    "narration": "未知字段",
                    "visual_description": "未知字段",
                    "node_graph": {},
                },
            )

    def test_delete_storyboard_shot_cleans_tasks_assets_and_timeline(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "shot.png"
            write_png_header(source, 720, 1280)
            service = self.make_service(storage_root=str(Path(temp_dir) / "storage"))
            project = service.create_project({"title": "删除分镜项目", "owner_id": "author_001"})
            analysis = service.analyze_script(project["id"], {"script": "镜头一。镜头二。", "user_id": "author_001"})
            first_shot = analysis["shots"][0]
            second_shot = analysis["shots"][1]
            task = service.generate_shot_image(project["id"], first_shot["id"], {"user_id": "author_001"})
            asset = service.archive_output(task["id"], source, "9")
            service.build_project_timeline(project["id"], {"user_id": "author_001"})
            asset_path = Path(asset["local_path"])
            self.assertTrue(asset_path.exists())

            with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
                service.delete_storyboard_shot(project["id"], first_shot["id"], {"user_id": "author_001", "node_graph": {}})

            deleted = service.delete_storyboard_shot(project["id"], first_shot["id"], {"user_id": "author_001"})
            detail = service.get_project(project["id"])
            self.assertTrue(deleted["deleted"])
            self.assertFalse(asset_path.exists())
            self.assertEqual([item["id"] for item in detail["shots"]], [second_shot["id"]])
            self.assertEqual(detail["shots"][0]["index"], 1)
            self.assertEqual(detail["timeline"], [])
            self.assertEqual(detail["subtitles"], [])
            self.assertEqual(service.list_project_assets(project["id"]), [])
            self.assertFalse(any(item["shot_id"] == first_shot["id"] for item in service.list_project_tasks(project["id"])))

            with self.assertRaisesRegex(WorkflowValidationError, "非作者"):
                service.delete_storyboard_shot(project["id"], second_shot["id"], {"user_id": "viewer_001"})

    def test_update_character_and_shot_resets_timeline_for_editing(self) -> None:
        service = self.make_service()
        project = service.create_project({"title": "编辑项目", "owner_id": "author_001"})
        result = service.analyze_script(
            project["id"],
            {"script": "主角推开门。", "main_character": "林夏", "user_id": "author_001"},
        )
        character = result["characters"][0]
        shot = result["shots"][0]
        service.build_project_timeline(project["id"], {"user_id": "author_001"})

        updated_character = service.update_character(
            project["id"],
            character["id"],
            {
                "user_id": "author_001",
                "name": "林夏改",
                "description": "更明确的角色设定",
                "style_prompt": "统一红色雨衣",
            },
        )
        self.assertEqual(updated_character["name"], "林夏改")
        self.assertEqual(service.get_project(project["id"])["shots"][0]["characters"], ["林夏改"])

        updated_shot = service.update_storyboard_shot(
            project["id"],
            shot["id"],
            {
                "user_id": "author_001",
                "narration": "主角猛地推开旧门",
                "visual_description": "旧门后是一条逆光走廊",
                "prompt": "悬疑漫剧，逆光走廊，角色一致",
            },
        )
        detail = service.get_project(project["id"])
        self.assertEqual(updated_shot["narration"], "主角猛地推开旧门")
        self.assertEqual(updated_shot["generation_status"], "pending")
        self.assertEqual(detail["timeline"], [])
        self.assertEqual(detail["subtitles"], [])
        self.assertEqual(detail["current_step"], "storyboard")

        with self.assertRaisesRegex(WorkflowValidationError, "旁白"):
            service.update_storyboard_shot(project["id"], shot["id"], {"user_id": "author_001", "narration": ""})
        with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
            service.update_storyboard_shot(project["id"], shot["id"], {"user_id": "author_001", "node_graph": {}})
        with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
            service.update_character(project["id"], character["id"], {"user_id": "author_001", "node_graph": {}})
        with self.assertRaisesRegex(WorkflowValidationError, "非作者"):
            service.update_character(project["id"], character["id"], {"user_id": "viewer_001", "name": "越权"})

    def test_create_character_for_project(self) -> None:
        service = self.make_service()
        project = service.create_project({"title": "角色新增项目", "owner_id": "author_001"})
        character = service.create_character(
            project["id"],
            {
                "user_id": "author_001",
                "name": "林夏",
                "description": "红色雨衣、短发",
                "reference_image_url": "/storage/reference/linxia.png",
                "style_prompt": "悬疑漫剧统一风格",
            },
        )
        detail = service.get_project(project["id"])
        self.assertEqual(character["name"], "林夏")
        self.assertEqual(character["created_by"], "author_001")
        self.assertEqual(detail["characters"][0]["id"], character["id"])
        self.assertEqual(detail["current_step"], "storyboard")

        with self.assertRaisesRegex(WorkflowValidationError, "角色名称不能为空"):
            service.create_character(project["id"], {"user_id": "author_001", "name": " "})
        with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
            service.create_character(project["id"], {"user_id": "author_001", "name": "阿宁", "node_graph": {}})
        with self.assertRaisesRegex(WorkflowValidationError, "非作者"):
            service.create_character(project["id"], {"user_id": "viewer_001", "name": "越权"})

    def test_generate_shot_image_uses_storyboard_prompt(self) -> None:
        service = self.make_service()
        project = service.create_project({"title": "分镜图项目", "owner_id": "author_001"})
        result = service.analyze_script(project["id"], {"script": "主角推开门。", "user_id": "author_001"})
        shot = result["shots"][0]
        task = service.generate_shot_image(project["id"], shot["id"], {
            "user_id": "author_001",
            "seed": 123,
            "reference_image_url": "/storage/reference/hero.png",
            "model_key": "flux-dev",
            "style_prompt": "电影感国漫",
            "batch_size": 3,
        })
        self.assertEqual(task["workflow_key"], "selfhost/image_flux")
        self.assertEqual(task["input_params"]["prompt"], shot["prompt"])
        self.assertEqual(task["input_params"]["negative_prompt"], shot["negative_prompt"])
        self.assertEqual(task["input_params"]["reference_image_url"], "/storage/reference/hero.png")
        self.assertEqual(task["input_params"]["model_key"], "flux-dev")
        self.assertEqual(task["input_params"]["style_prompt"], "电影感国漫")
        self.assertEqual(task["input_params"]["batch_size"], 3)
        self.assertEqual(task["input_params"]["seed"], 123)

        video_task = service.generate_shot_video(
            project["id"],
            shot["id"],
            {
                "user_id": "author_001",
                "first_frame_url": "/storage/first.png",
                "negative_prompt": "抖动、穿帮、低清",
                "camera_motion": "环绕推进",
                "motion_strength": 0.7,
            },
        )
        self.assertEqual(video_task["input_params"]["negative_prompt"], "抖动、穿帮、低清")
        self.assertEqual(video_task["input_params"]["camera_motion"], "环绕推进")
        self.assertEqual(video_task["input_params"]["motion_strength"], 0.7)

    def test_generation_entrypoints_reject_unknown_business_fields(self) -> None:
        service = self.make_service()
        project = service.create_project({"title": "生成参数边界项目", "owner_id": "author_001"})
        result = service.analyze_script(project["id"], {"script": "主角站在雨里。", "user_id": "author_001"})
        shot = result["shots"][0]
        with self.assertRaisesRegex(WorkflowValidationError, "业务接口"):
            service.generate_shot_image(project["id"], shot["id"], {"user_id": "author_001", "node_graph": {"1": {}}})
        with self.assertRaisesRegex(WorkflowValidationError, "生成数量"):
            service.generate_shot_image(project["id"], shot["id"], {"user_id": "author_001", "batch_size": 0})
        with self.assertRaisesRegex(WorkflowValidationError, "生成数量"):
            service.generate_shot_image(project["id"], shot["id"], {"user_id": "author_001", "batch_size": 9})
        with self.assertRaisesRegex(WorkflowValidationError, "业务接口"):
            service.generate_shot_video(
                project["id"],
                shot["id"],
                {"user_id": "author_001", "first_frame_url": "/storage/first.png", "steps": 20},
            )
        with self.assertRaisesRegex(WorkflowValidationError, "运动强度"):
            service.generate_shot_video(
                project["id"],
                shot["id"],
                {"user_id": "author_001", "first_frame_url": "/storage/first.png", "motion_strength": 1.5},
            )
        with self.assertRaisesRegex(WorkflowValidationError, "业务接口"):
            service.generate_shot_tts(project["id"], shot["id"], {"user_id": "author_001", "speaker_node": "6"})
        with self.assertRaisesRegex(WorkflowValidationError, "业务接口"):
            service.batch_generate_project(project["id"], {"user_id": "author_001", "task_types": ["image"], "node_graph": {}})
        with self.assertRaisesRegex(WorkflowValidationError, "业务接口"):
            service.compose_project(project["id"], {"user_id": "author_001", "node_graph": {}})

    def test_generation_entrypoints_reject_boolean_numeric_values(self) -> None:
        service = self.make_service()
        project = service.create_project({"title": "生成数值边界项目", "owner_id": "author_001"})
        result = service.analyze_script(project["id"], {"script": "主角看向镜头。", "user_id": "author_001"})
        shot = result["shots"][0]
        with self.assertRaisesRegex(WorkflowValidationError, "宽度.*整数"):
            service.generate_shot_image(project["id"], shot["id"], {"user_id": "author_001", "width": True})
        with self.assertRaisesRegex(WorkflowValidationError, "时长.*数字"):
            service.generate_shot_video(
                project["id"],
                shot["id"],
                {"user_id": "author_001", "first_frame_url": "/storage/first.png", "duration": False},
            )
        with self.assertRaisesRegex(WorkflowValidationError, "语速.*数字"):
            service.generate_shot_tts(project["id"], shot["id"], {"user_id": "author_001", "rate": True})
        with self.assertRaisesRegex(WorkflowValidationError, "音调"):
            service.generate_shot_tts(project["id"], shot["id"], {"user_id": "author_001", "pitch": 24})

    def test_workspace_numeric_fields_reject_invalid_values(self) -> None:
        service = self.make_service()
        project = service.create_project({"title": "工作台数值边界项目", "owner_id": "author_001"})
        with self.assertRaisesRegex(WorkflowValidationError, "目标时长.*整数"):
            service.analyze_script(
                project["id"],
                {"script": "主角走进夜色。", "user_id": "author_001", "target_duration_seconds": True},
            )
        analysis = service.analyze_script(project["id"], {"script": "第一句。第二句。", "user_id": "author_001"})
        with self.assertRaisesRegex(WorkflowValidationError, "单镜头时长.*数字"):
            service.build_project_timeline(project["id"], {"user_id": "author_001", "duration_per_shot": True})
        with self.assertRaisesRegex(WorkflowValidationError, "单镜头时长.*数字"):
            service.build_project_timeline(project["id"], {"user_id": "author_001", "duration_per_shot": "abc"})
        timeline = service.build_project_timeline(project["id"], {"user_id": "author_001"})
        subtitle_id = timeline["subtitles"][0]["id"]
        with self.assertRaisesRegex(WorkflowValidationError, "字幕开始时间.*数字"):
            service.update_subtitle(project["id"], subtitle_id, {"user_id": "author_001", "start_seconds": False})
        with self.assertRaisesRegex(WorkflowValidationError, "字幕结束时间.*数字"):
            service.update_subtitle(project["id"], subtitle_id, {"user_id": "author_001", "end_seconds": "bad"})
        self.assertEqual(len(analysis["shots"]), 2)

    def test_generate_shot_video_requires_first_frame(self) -> None:
        service = self.make_service()
        project = service.create_project({"title": "镜头视频项目", "owner_id": "author_001"})
        result = service.analyze_script(project["id"], {"script": "主角转身奔跑。", "user_id": "author_001"})
        shot = result["shots"][0]
        with self.assertRaisesRegex(WorkflowValidationError, "首帧图片"):
            service.generate_shot_video(project["id"], shot["id"], {"user_id": "author_001"})

    def test_generate_shot_tts_uses_narration_and_archives_audio(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "voice.wav"
            write_wav(source, duration_seconds=1.25)
            service = self.make_service(storage_root=str(Path(temp_dir) / "storage"))
            project = service.create_project({"title": "配音项目", "owner_id": "author_001"})
            result = service.analyze_script(
                project["id"],
                {"script": "主角低声说出真相。", "user_id": "author_001"},
            )
            shot = result["shots"][0]
            task = service.generate_shot_tts(
                project["id"],
                shot["id"],
                {"user_id": "author_001", "voice": "zh-CN-YunxiNeural", "emotion": "sad", "pitch": -2},
            )
            self.assertEqual(task["task_type"], "tts")
            self.assertEqual(task["workflow_key"], "selfhost/tts_edge")
            self.assertEqual(task["input_params"]["text"], shot["narration"])
            self.assertEqual(task["input_params"]["voice"], "zh-CN-YunxiNeural")
            self.assertEqual(task["input_params"]["emotion"], "sad")
            self.assertEqual(task["input_params"]["pitch"], -2.0)

            archived = service.archive_output(task["id"], source, "6")
            assets = service.list_project_assets(project["id"])
            self.assertEqual(archived["asset_type"], "audio")
            self.assertIn(archived["mime_type"], {"audio/x-wav", "audio/wav"})
            self.assertEqual(archived["duration_seconds"], 1.25)
            self.assertEqual(assets[0]["asset_type"], "audio")
            self.assertEqual(assets[0]["duration_seconds"], 1.25)

    def test_batch_generate_project_creates_image_and_tts_tasks(self) -> None:
        service = self.make_service()
        project = service.create_project({"title": "批量生成项目", "owner_id": "author_001"})
        service.analyze_script(project["id"], {"script": "镜头一。镜头二。", "user_id": "author_001"})
        result = service.batch_generate_project(
            project["id"],
            {"user_id": "author_001", "task_types": ["image", "tts"], "voice": "zh-CN-YunxiNeural", "emotion": "cheerful", "pitch": 1},
        )
        self.assertEqual(result["shot_count"], 2)
        self.assertEqual(result["task_count"], 4)
        self.assertEqual([item["task_type"] for item in result["tasks"]].count("image"), 2)
        self.assertEqual([item["task_type"] for item in result["tasks"]].count("tts"), 2)
        self.assertTrue(all(item["status"] == "pending" for item in result["tasks"]))
        tts_tasks = [item for item in result["tasks"] if item["task_type"] == "tts"]
        self.assertTrue(all(item["input_params"]["emotion"] == "cheerful" for item in tts_tasks))
        self.assertTrue(all(item["input_params"]["pitch"] == 1.0 for item in tts_tasks))
        self.assertEqual(service.get_project(project["id"])["current_step"], "batch")
        project_tasks = service.list_project_tasks(project["id"])
        self.assertEqual(len(project_tasks), 5)
        pending_project_tasks = service.list_project_tasks(project["id"], status="pending")
        self.assertEqual(len(pending_project_tasks), 4)
        self.assertTrue(all(item["events"][0]["message"] == "任务已创建。" for item in pending_project_tasks))
        self.assertEqual(len(service.list_project_tasks(project["id"], status="pending")), 4)
        self.assertEqual(service.list_project_tasks(project["id"], status="failed"), [])
        with self.assertRaisesRegex(WorkflowValidationError, "任务状态"):
            service.list_project_tasks(project["id"], status="unknown")

        with self.assertRaisesRegex(WorkflowValidationError, "暂不支持"):
            service.batch_generate_project(project["id"], {"user_id": "author_001", "task_types": ["video"]})

    def test_batch_generate_project_can_submit_created_tasks(self) -> None:
        service = self.make_service()
        project = service.create_project({"title": "批量提交项目", "owner_id": "author_001"})
        service.analyze_script(project["id"], {"script": "镜头一。镜头二。", "user_id": "author_001"})
        result = service.batch_generate_project(
            project["id"],
            {"user_id": "author_001", "task_types": ["image"], "submit": True},
        )
        self.assertEqual(result["task_count"], 2)
        self.assertTrue(all(item["status"] == "running" for item in result["tasks"]))
        self.assertTrue(all(item["prompt_id"] == "prompt_test_001" for item in result["tasks"]))
        self.assertTrue(all(item["events"][-1]["message"] == "任务已提交到 ComfyUI。" for item in result["tasks"]))

    def test_compose_project_creates_compose_task_after_storyboard(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "final.mp4"
            write_mp4_with_duration(source, duration_seconds=12.5)
            service = self.make_service(storage_root=str(Path(temp_dir) / "storage"))
            project = service.create_project({"title": "合成项目", "owner_id": "author_001"})
            service.analyze_script(project["id"], {"script": "镜头一。镜头二。", "user_id": "author_001"})
            task = service.compose_project(
                project["id"],
                {
                    "user_id": "author_001",
                    "subtitle": True,
                    "voice": "zh-CN-YunxiNeural",
                    "bgm_url": "/storage/bgm.mp3",
                    "duration_per_shot": 3.5,
                    "subtitle_style": "底部黄字黑描边",
                    "transition": "fade",
                },
            )
            self.assertEqual(task["task_type"], "compose")
            self.assertEqual(task["input_params"]["project_id"], project["id"])
            self.assertTrue(task["input_params"]["subtitle"])
            self.assertEqual(task["input_params"]["voice"], "zh-CN-YunxiNeural")
            self.assertEqual(task["input_params"]["bgm_url"], "/storage/bgm.mp3")
            self.assertEqual(task["input_params"]["duration_per_shot"], 3.5)
            self.assertEqual(task["input_params"]["subtitle_style"], "底部黄字黑描边")
            self.assertEqual(task["input_params"]["transition"], "fade")
            self.assertEqual(len(task["input_params"]["timeline"]), 2)
            self.assertEqual(len(task["input_params"]["subtitles"]), 2)
            self.assertEqual(task["input_params"]["timeline"][0]["end_seconds"], 3.5)
            self.assertEqual(task["input_params"]["timeline"][0]["transition"], "fade")
            self.assertEqual(task["input_params"]["subtitles"][0]["style"], "底部黄字黑描边")
            no_subtitle_task = service.compose_project(project["id"], {"user_id": "author_001", "subtitle": False})
            self.assertFalse(no_subtitle_task["input_params"]["subtitle"])
            self.assertEqual(no_subtitle_task["input_params"]["duration_per_shot"], 3.5)
            self.assertEqual(no_subtitle_task["input_params"]["subtitle_style"], "底部黄字黑描边")
            self.assertEqual(no_subtitle_task["input_params"]["transition"], "fade")
            with self.assertRaisesRegex(WorkflowValidationError, "字幕.*布尔值"):
                service.compose_project(project["id"], {"user_id": "author_001", "subtitle": "false"})
            submitted = service.submit_task(task["id"], {})
            self.assertEqual(submitted["status"], "running")
            self.assertEqual(submitted["workflow_key"], "platform/compose")
            self.assertEqual(submitted["prompt_id"], "prompt_test_001")

            asset = service.archive_output(task["id"], source, "30")
            detail = service.get_project(project["id"])
            self.assertEqual(asset["asset_type"], "video")
            self.assertEqual(asset["mime_type"], "video/mp4")
            self.assertEqual(asset["duration_seconds"], 12.5)
            self.assertEqual(detail["status"], "completed")
            self.assertEqual(detail["current_step"], "export")
            self.assertEqual(detail["final_video_url"], asset["url"])

    def test_compose_project_validates_workflow_registry_key(self) -> None:
        service = self.make_service()
        project = service.create_project({"title": "合成校验项目", "owner_id": "author_001"})
        service.analyze_script(project["id"], {"script": "镜头一。", "user_id": "author_001"})
        with self.assertRaisesRegex(NotFoundError, "未找到工作流"):
            service.compose_project(project["id"], {"user_id": "author_001", "workflow_key": "platform/missing"})

            work = service.submit_work_for_review(project["id"], {"title": "合成发布", "user_id": "author_001"})
            self.assertEqual(work["video_url"], asset["url"])

    def test_build_project_timeline_creates_subtitles_and_asset_bindings(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            video_source = Path(temp_dir) / "clip.mp4"
            audio_source = Path(temp_dir) / "voice.wav"
            video_source.write_bytes(b"fake video bytes")
            audio_source.write_bytes(b"fake audio bytes")
            service = self.make_service(storage_root=str(Path(temp_dir) / "storage"))
            project = service.create_project({"title": "时间线项目", "owner_id": "author_001"})
            analysis = service.analyze_script(project["id"], {"script": "镜头一。镜头二。", "user_id": "author_001"})
            first_shot = analysis["shots"][0]
            video_task = service.generate_shot_video(
                project["id"],
                first_shot["id"],
                {"user_id": "author_001", "first_frame_url": "/storage/assets/first.png"},
            )
            audio_task = service.generate_shot_tts(project["id"], first_shot["id"], {"user_id": "author_001"})
            video_asset = service.archive_output(video_task["id"], video_source, "18")
            audio_asset = service.archive_output(audio_task["id"], audio_source, "6")

            timeline = service.build_project_timeline(
                project["id"],
                {
                    "user_id": "author_001",
                    "duration_per_shot": 3.5,
                    "subtitle_style": "底部黄字黑描边",
                    "transition": "fade",
                },
            )
            detail = service.get_project(project["id"])
            self.assertEqual(timeline["duration_seconds"], 7.0)
            self.assertEqual(len(timeline["timeline"]), 2)
            self.assertEqual(len(timeline["subtitles"]), 2)
            self.assertEqual(timeline["timeline"][0]["video_asset_id"], video_asset["id"])
            self.assertEqual(timeline["timeline"][0]["audio_asset_id"], audio_asset["id"])
            self.assertEqual(timeline["timeline"][0]["transition"], "fade")
            self.assertEqual(timeline["subtitles"][0]["style"], "底部黄字黑描边")
            self.assertEqual(detail["current_step"], "timeline")
            self.assertEqual(detail["timeline"][0]["end_seconds"], 3.5)
            self.assertEqual(detail["subtitles"][0]["text"], "镜头一")

            with self.assertRaisesRegex(WorkflowValidationError, "大于 0"):
                service.build_project_timeline(project["id"], {"user_id": "author_001", "duration_per_shot": 0})
            with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
                service.build_project_timeline(project["id"], {"user_id": "author_001", "node_graph": {}})

    def test_update_and_export_project_subtitles_as_srt_asset(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            service = self.make_service(storage_root=str(Path(temp_dir) / "storage"))
            project = service.create_project({"title": "字幕项目", "owner_id": "author_001"})
            service.analyze_script(project["id"], {"script": "第一句。第二句。", "user_id": "author_001"})
            timeline = service.build_project_timeline(project["id"], {"user_id": "author_001", "duration_per_shot": 2.5})
            subtitle = timeline["subtitles"][0]

            updated = service.update_subtitle(
                project["id"],
                subtitle["id"],
                {
                    "user_id": "author_001",
                    "text": "第一句字幕已修正",
                    "start_seconds": 0.5,
                    "end_seconds": 2.75,
                },
            )
            self.assertEqual(updated["text"], "第一句字幕已修正")
            detail = service.get_project(project["id"])
            self.assertEqual(detail["timeline"][0]["start_seconds"], 0.5)
            self.assertEqual(detail["timeline"][0]["end_seconds"], 2.75)

            asset = service.export_project_subtitles(project["id"], {"user_id": "author_001"})
            self.assertEqual(asset["asset_type"], "subtitle")
            self.assertTrue(Path(asset["local_path"]).exists())
            self.assertIn("00:00:00,500 --> 00:00:02,750", asset["content"])
            self.assertIn("第一句字幕已修正", asset["content"])
            self.assertIn("2\n00:00:02,500 --> 00:00:05,000", asset["content"])
            self.assertEqual(service.list_project_assets(project["id"])[0]["asset_type"], "subtitle")
            with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
                service.export_project_subtitles(project["id"], {"user_id": "author_001", "node_graph": {}})

            with self.assertRaisesRegex(WorkflowValidationError, "不能为空"):
                service.update_subtitle(project["id"], subtitle["id"], {"user_id": "author_001", "text": ""})
            with self.assertRaisesRegex(WorkflowValidationError, "晚于"):
                service.update_subtitle(
                    project["id"],
                    subtitle["id"],
                    {"user_id": "author_001", "start_seconds": 3, "end_seconds": 1},
                )
            with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
                service.update_subtitle(project["id"], subtitle["id"], {"user_id": "author_001", "node_graph": {}})

    def test_draft_work_is_hidden_until_review_approved(self) -> None:
        service = self.make_service()
        project = service.create_project({"title": "待审核作品", "owner_id": "author_001"})
        with self.assertRaisesRegex(WorkflowValidationError, "成片导出"):
            service.submit_work_for_review(project["id"], {"title": "缺少成片作品", "user_id": "author_001"})
        work = service.submit_work_for_review(
            project["id"],
            {
                "title": "雨夜车站",
                "description": "雨夜重逢题材",
                "category": "短片剧集",
                "cover_url": "/storage/covers/rain.png",
                "video_url": "/storage/final/rain.mp4",
                "tags": "短片剧集，雨夜,AI 漫剧",
                "user_id": "author_001",
            },
        )
        self.assertEqual(work["review_status"], "pending_review")
        self.assertEqual(work["category"], "短片剧集")
        self.assertEqual(work["cover_url"], "/storage/covers/rain.png")
        self.assertEqual(work["tags"], ["短片剧集", "雨夜", "AI 漫剧"])
        self.assertEqual(service.list_published_works(), [])

        with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
            service.submit_work_for_review(project["id"], {"title": "错误发布字段", "user_id": "author_001", "node_graph": {}})

        with self.assertRaisesRegex(WorkflowValidationError, "审核权限"):
            service.review_work(work["id"], "approve", reviewer_id="author_001")

        approved = service.review_work(work["id"], "approve", reviewer_id="system_admin")
        self.assertEqual(approved["review_status"], "published")
        visible = service.list_published_works(keyword="雨夜")
        self.assertEqual(len(visible), 1)
        self.assertEqual(visible[0]["title"], "雨夜车站")

        offline = service.review_work(work["id"], "offline", "素材版权待确认", reviewer_id="system_admin")
        self.assertEqual(offline["review_status"], "offline")
        self.assertEqual(service.list_published_works(keyword="雨夜"), [])
        with self.assertRaisesRegex(NotFoundError, "已发布作品"):
            service.get_published_work(work["id"])
        with self.assertRaisesRegex(WorkflowValidationError, "已发布作品"):
            service.create_interaction(
                {"user_id": "viewer_001", "target_type": "work", "target_id": work["id"], "interaction_type": "like"}
            )

        rejected_project = service.create_project({"title": "驳回作品", "owner_id": "author_001"})
        rejected = service.submit_work_for_review(
            rejected_project["id"],
            {"title": "审核驳回作品", "video_url": "/storage/final/reject.mp4", "user_id": "author_001"},
        )
        rejected = service.review_work(rejected["id"], "reject", "画面不完整", reviewer_id="system_admin")
        self.assertEqual(rejected["review_status"], "rejected")
        self.assertIn("审核备注：画面不完整", rejected["description"])
        self.assertEqual(service.list_published_works(keyword="审核驳回"), [])

    def test_submit_work_reuses_project_work_record(self) -> None:
        service = self.make_service()
        project = service.create_project({"title": "重复提交项目", "owner_id": "author_001"})
        first = service.submit_work_for_review(
            project["id"],
            {"title": "第一版标题", "video_url": "/storage/final/v1.mp4", "user_id": "author_001"},
        )
        second = service.submit_work_for_review(
            project["id"],
            {
                "title": "第二版标题",
                "description": "补充简介",
                "category": "动画短片",
                "video_url": "/storage/final/v2.mp4",
                "tags": ["动画短片", "二次提交"],
                "user_id": "author_001",
            },
        )
        review_queue = service.list_published_works(include_unpublished=True)

        self.assertEqual(second["id"], first["id"])
        self.assertEqual(second["title"], "第二版标题")
        self.assertEqual(second["video_url"], "/storage/final/v2.mp4")
        self.assertEqual(second["review_status"], WorkReviewStatus.PENDING_REVIEW.value)
        self.assertEqual([item["id"] for item in review_queue if item["project_id"] == project["id"]], [first["id"]])

    def test_like_and_favorite_are_counted_once_per_user(self) -> None:
        service = self.make_service()
        project = service.create_project({"title": "互动计数作品", "owner_id": "author_001"})
        work = service.submit_work_for_review(
            project["id"], {"title": "互动计数作品", "video_url": "/storage/final/like.mp4", "user_id": "author_001"}
        )
        service.review_work(work["id"], "approve", reviewer_id="system_admin")

        with self.assertRaisesRegex(WorkflowValidationError, "请求参数未在业务接口中声明"):
            service.create_interaction(
                {
                    "user_id": "viewer_001",
                    "target_type": "work",
                    "target_id": work["id"],
                    "interaction_type": "like",
                    "node_graph": {},
                }
            )
        first_like = service.create_interaction(
            {"user_id": "viewer_001", "target_type": "work", "target_id": work["id"], "interaction_type": "like"}
        )
        second_like = service.create_interaction(
            {"user_id": "viewer_001", "target_type": "work", "target_id": work["id"], "interaction_type": "like"}
        )
        favorite = service.create_interaction(
            {"user_id": "viewer_001", "target_type": "work", "target_id": work["id"], "interaction_type": "favorite"}
        )
        self.assertEqual(first_like["like_count"], 1)
        self.assertEqual(second_like["like_count"], 1)
        self.assertEqual(favorite["favorite_count"], 1)

    def test_published_works_support_category_sort_and_view_count(self) -> None:
        service = self.make_service()
        project_a = service.create_project({"title": "分类作品 A", "owner_id": "author_001"})
        project_b = service.create_project({"title": "分类作品 B", "owner_id": "author_001"})
        project_c = service.create_project({"title": "待审核作品 C", "owner_id": "author_001"})
        work_a = service.submit_work_for_review(
            project_a["id"], {"title": "动画短片作品", "category": "动画短片", "video_url": "/storage/final/a.mp4", "user_id": "author_001"}
        )
        work_b = service.submit_work_for_review(
            project_b["id"], {"title": "热门漫剧作品", "category": "AI 漫剧", "video_url": "/storage/final/b.mp4", "user_id": "author_001"}
        )
        pending = service.submit_work_for_review(
            project_c["id"], {"title": "未公开作品", "category": "AI 漫剧", "video_url": "/storage/final/c.mp4", "user_id": "author_001"}
        )
        service.review_work(work_a["id"], "approve", reviewer_id="system_admin")
        service.review_work(work_b["id"], "approve", reviewer_id="system_admin")
        service.create_interaction(
            {"user_id": "viewer_001", "target_type": "work", "target_id": work_b["id"], "interaction_type": "favorite"}
        )

        anime = service.list_published_works(category="动画短片")
        self.assertEqual([item["title"] for item in anime], ["动画短片作品"])
        favorited = service.list_published_works(sort_by="most_favorited")
        self.assertEqual(favorited[0]["title"], "热门漫剧作品")

        detail = service.get_published_work(work_a["id"])
        self.assertEqual(detail["view_count"], 1)
        most_viewed = service.list_published_works(sort_by="most_viewed")
        self.assertEqual(most_viewed[0]["title"], "动画短片作品")
        with self.assertRaisesRegex(NotFoundError, "已发布作品"):
            service.get_published_work(pending["id"])

    def test_author_profile_aggregates_public_works_templates_and_followers(self) -> None:
        service = self.make_service()
        project = service.create_project({"title": "作者主页项目", "owner_id": "author_profile"})
        work = service.submit_work_for_review(
            project["id"],
            {"title": "作者公开作品", "user_id": "author_profile", "video_url": "/storage/final/author.mp4"},
        )
        service.review_work(work["id"], "approve", reviewer_id="system_admin")
        service.create_interaction(
            {"user_id": "viewer_001", "target_type": "work", "target_id": work["id"], "interaction_type": "like"}
        )
        first_follow = service.create_interaction(
            {
                "user_id": "viewer_001",
                "target_type": "author",
                "target_id": "author_profile",
                "interaction_type": "follow",
            }
        )
        second_follow = service.create_interaction(
            {
                "user_id": "viewer_001",
                "target_type": "author",
                "target_id": "author_profile",
                "interaction_type": "follow",
            }
        )

        self.assertEqual(first_follow["follower_count"], 1)
        self.assertEqual(second_follow["follower_count"], 1)
        self.assertEqual(first_follow["work_count"], 1)
        self.assertEqual(first_follow["like_count"], 1)
        self.assertEqual(first_follow["author_level"], "先锋")
        service.review_work(work["id"], "offline", reviewer_id="system_admin")
        offline_profile = service.get_author_profile("author_profile")
        self.assertEqual(offline_profile["work_count"], 0)
        script_spec = service.registry.get("platform/script_analysis")
        script_template = WorkTemplate(
            name="脚本分析内部流程",
            description=script_spec.description,
            author_id="system",
            workflow_key=script_spec.workflow_key,
            parameter_schema=script_spec.input_schema,
            default_params=script_spec.default_params,
            status="published",
        )
        service.repository.templates[script_template.id] = script_template
        system_profile = service.get_author_profile("system")
        self.assertGreaterEqual(system_profile["template_count"], 3)
        self.assertNotIn("platform/script_analysis", {item["workflow_key"] for item in system_profile["templates"]})

    def test_json_repository_persists_project_task_work_and_interaction(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            data_path = Path(temp_dir) / "platform-data.json"
            service = PlatformService(
                registry=default_registry(),
                comfy=FakeComfy(),
                storage=LocalStorage(Path(temp_dir) / "storage"),
                repository=JsonFileRepository(data_path),
            )
            project = service.create_project({"title": "持久化项目", "owner_id": "author_001"})
            analysis = service.analyze_script(
                project["id"],
                {"script": "第一幕开始。第二幕反转。", "user_id": "author_001"},
            )
            task = service.generate_shot_image(project["id"], analysis["shots"][0]["id"], {"user_id": "author_001"})
            timeline = service.build_project_timeline(project["id"], {"user_id": "author_001", "duration_per_shot": 5})
            work = service.submit_work_for_review(
                project["id"],
                {"title": "持久化作品", "user_id": "author_001", "video_url": "/storage/final/persist.mp4"},
            )
            service.review_work(work["id"], "approve", reviewer_id="system_admin")
            service.create_interaction(
                {"user_id": "viewer_001", "target_type": "work", "target_id": work["id"], "interaction_type": "like"}
            )
            service.create_interaction(
                {
                    "user_id": "viewer_001",
                    "target_type": "author",
                    "target_id": "author_001",
                    "interaction_type": "follow",
                }
            )
            payment_order = service.create_payment_order(
                {"user_id": "author_001", "channel": "stripe", "credits": 100, "amount_cents": 1000}
            )

            restored = PlatformService(
                registry=default_registry(),
                comfy=FakeComfy(),
                storage=LocalStorage(Path(temp_dir) / "storage"),
                repository=JsonFileRepository(data_path),
            )
            restored_project = restored.get_project(project["id"])
            restored_task = restored.get_task(task["id"])
            restored_works = restored.list_published_works(keyword="持久化")
            restored_profile = restored.get_author_profile("author_001")
            restored_project_model = restored.repository.projects[project["id"]]
            restored_task_model = restored.repository.tasks[task["id"]]
            restored_work_model = restored.repository.works[work["id"]]
            self.assertEqual(restored_project["title"], "持久化项目")
            self.assertIs(restored_project_model.status, ProjectStatus.DRAFT)
            self.assertTrue(hasattr(restored_project_model.updated_at, "isoformat"))
            self.assertEqual(len(restored_project["shots"]), 2)
            self.assertEqual(len(restored_project["timeline"]), 2)
            self.assertEqual(len(restored_project["subtitles"]), 2)
            self.assertEqual(restored_project["timeline"][0]["end_seconds"], 5.0)
            self.assertEqual(restored_project["subtitles"][0]["id"], timeline["subtitles"][0]["id"])
            self.assertEqual(restored_task["workflow_key"], "selfhost/image_flux")
            self.assertIs(restored_task_model.task_type, TaskType.IMAGE)
            self.assertIs(restored_task_model.status, TaskStatus.PENDING)
            self.assertTrue(restored_task["events"])
            self.assertIs(restored_work_model.review_status, WorkReviewStatus.PUBLISHED)
            self.assertEqual(restored_works[0]["like_count"], 1)
            self.assertEqual(restored_profile["follower_count"], 1)
            self.assertEqual(restored.repository.payment_orders[payment_order["id"]].credits, 100)
            self.assertIs(restored.repository.payment_orders[payment_order["id"]].status, PaymentOrderStatus.PENDING)

            failed_task = restored.repository.tasks[task["id"]]
            failed_task.status = TaskStatus.FAILED
            failed_task.prompt_id = "prompt_persist_001"
            failed_task.error_message = "持久化失败"
            failed_task.provider_error = "provider persisted error"
            failed_task.retry_advice = "请重启 ComfyUI 后重试。"
            restored._record_task_event(
                failed_task,
                "持久化失败",
                {"prompt_id": failed_task.prompt_id, "provider_error": failed_task.provider_error},
            )
            failed_task.touch()
            restored._persist()

            restored_again = PlatformService(
                registry=default_registry(),
                comfy=FakeComfy(),
                storage=LocalStorage(Path(temp_dir) / "storage"),
                repository=JsonFileRepository(data_path),
            )
            restored_failed_task = restored_again.get_task(task["id"])
            failed_overview = restored_again.admin_overview()
            self.assertEqual(restored_failed_task["prompt_id"], "prompt_persist_001")
            self.assertEqual(restored_failed_task["provider_error"], "provider persisted error")
            self.assertEqual(restored_failed_task["retry_advice"], "请重启 ComfyUI 后重试。")
            self.assertEqual(restored_failed_task["events"][-1]["message"], "持久化失败")
            self.assertEqual(failed_overview["latest_failed_tasks"][0]["prompt_id"], "prompt_persist_001")
            self.assertEqual(failed_overview["latest_failed_tasks"][0]["last_event"]["message"], "持久化失败")

            resubmitted = restored.submit_work_for_review(
                project["id"],
                {
                    "title": "持久化作品第二版",
                    "user_id": "author_001",
                    "video_url": "/storage/final/persist-v2.mp4",
                    "tags": ["重提审", "持久化"],
                },
            )
            reopened = PlatformService(
                registry=default_registry(),
                comfy=FakeComfy(),
                storage=LocalStorage(Path(temp_dir) / "storage"),
                repository=JsonFileRepository(data_path),
            )
            review_queue = reopened.list_published_works(include_unpublished=True, keyword="持久化")
            self.assertEqual(resubmitted["id"], work["id"])
            self.assertEqual(resubmitted["review_status"], WorkReviewStatus.PENDING_REVIEW.value)
            self.assertEqual([item["id"] for item in review_queue if item["project_id"] == project["id"]], [work["id"]])

    def test_postgres_json_repository_round_trips_domain_models(self) -> None:
        connection = FakePostgresConnection()
        repository = PostgresJsonRepository(
            "postgresql://example/video_gen",
            table_name="video_gen_test_records",
            connect_fn=lambda url: connection,
        )
        service = PlatformService(repository=repository, comfy=FakeComfy())
        project = service.create_project({"title": "PostgreSQL 项目", "owner_id": "author_pg"})
        task = service.create_generation_task(
            "selfhost/image_flux",
            {"prompt": "PostgreSQL 任务"},
            project_id=project["id"],
            created_by="author_pg",
        )
        payment_order = service.create_payment_order(
            {"user_id": "author_pg", "channel": "stripe", "credits": 200, "amount_cents": 2000}
        )
        service.repository.tasks[task["id"]].status = TaskStatus.FAILED
        service.repository.tasks[task["id"]].provider_error = "postgres provider error"
        service._persist()

        self.assertTrue(connection.committed)
        self.assertIn(("projects", project["id"]), connection.rows)
        self.assertIn(("tasks", task["id"]), connection.rows)
        self.assertTrue(any("ON CONFLICT" in sql for sql, _params in connection.statements))
        self.assertIn(("projects", project["id"], "owner", "author_pg"), connection.relation_rows)
        self.assertIn(("tasks", task["id"], "project", project["id"]), connection.relation_rows)
        self.assertIn(("payment_orders", payment_order["id"], "user", "author_pg"), connection.relation_rows)
        self.assertIn(("payment_orders", payment_order["id"], "channel", "stripe"), connection.relation_rows)
        self.assertTrue(any("CREATE TABLE IF NOT EXISTS video_gen_test_records_relations" in sql for sql, _params in connection.statements))
        self.assertTrue(any("payload_gin_idx" in sql for sql, _params in connection.statements))
        self.assertTrue(any("relation_type, relation_id, collection" in sql for sql, _params in connection.statements))

        restored_repository = PostgresJsonRepository(
            "postgresql://example/video_gen",
            table_name="video_gen_test_records",
            connect_fn=lambda url: connection,
        )
        self.assertEqual(restored_repository.projects[project["id"]].title, "PostgreSQL 项目")
        self.assertIs(restored_repository.projects[project["id"]].status, ProjectStatus.DRAFT)
        self.assertIs(restored_repository.tasks[task["id"]].status, TaskStatus.FAILED)
        self.assertEqual(restored_repository.tasks[task["id"]].provider_error, "postgres provider error")
        self.assertEqual(restored_repository.payment_orders[payment_order["id"]].credits, 200)
        self.assertIs(restored_repository.payment_orders[payment_order["id"]].status, PaymentOrderStatus.PENDING)

        restored_repository.tasks.pop(task["id"])
        restored_repository.save()
        self.assertNotIn(("tasks", task["id"]), connection.rows)
        self.assertFalse(any(row[0] == "tasks" and row[1] == task["id"] for row in connection.relation_rows))

    def test_submit_work_deduplicates_legacy_project_work_records(self) -> None:
        service = self.make_service()
        project = service.create_project({"title": "历史重复作品项目", "owner_id": "author_001"})
        first = service.submit_work_for_review(
            project["id"],
            {"title": "旧作品", "video_url": "/storage/final/old.mp4", "user_id": "author_001"},
        )
        duplicate = PublishedWork(
            project_id=project["id"],
            title="历史重复作品",
            video_url="/storage/final/legacy.mp4",
            author_id="author_001",
            review_status=WorkReviewStatus.PUBLISHED,
            status=WorkReviewStatus.PUBLISHED.value,
            created_by="author_001",
        )
        duplicate.touch()
        service.repository.works[duplicate.id] = duplicate
        service.create_interaction(
            {"user_id": "viewer_001", "target_type": "work", "target_id": duplicate.id, "interaction_type": "like"}
        )

        submitted = service.submit_work_for_review(
            project["id"],
            {"title": "合并后作品", "video_url": "/storage/final/new.mp4", "user_id": "author_001"},
        )

        self.assertEqual(submitted["id"], duplicate.id)
        self.assertNotIn(first["id"], service.repository.works)
        self.assertFalse(any(item.target_id == first["id"] for item in service.repository.interactions.values()))
        self.assertEqual([item["id"] for item in service.list_published_works(include_unpublished=True) if item["project_id"] == project["id"]], [duplicate.id])


if __name__ == "__main__":
    unittest.main()
