from __future__ import annotations

import os
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.backend.api import create_service
from app.backend.errors import WorkflowValidationError
from app.backend.models import ComfyStatus
from app.backend.workflows import load_registry


class FakeComfy:
    def __init__(self) -> None:
        self.submitted_workflow = {}

    def status(self) -> ComfyStatus:
        return ComfyStatus(connected=True, message="ComfyUI 已连接")

    def submit_prompt(self, workflow, client_id: str) -> str:
        self.submitted_workflow = workflow
        return "prompt_custom_001"


class WorkflowRegistryTest(unittest.TestCase):
    def test_load_registry_reads_nested_registry_files(self) -> None:
        registry = load_registry("workflows")
        keys = {item["workflow_key"] for item in registry.to_payload()}
        self.assertEqual(
            keys,
            {
                "platform/script_analysis",
                "selfhost/image_flux",
                "selfhost/video_wan2.1_fusionx",
                "selfhost/tts_edge",
                "platform/compose",
            },
        )
        script_analysis = registry.get("platform/script_analysis")
        self.assertEqual(script_analysis.output_nodes["storyboard"].value, "other")
        params = registry.validate_params(
            "platform/script_analysis",
            {"script": "第一幕，主角在雨夜车站等待。", "target_duration_seconds": 45},
        )
        self.assertEqual(params["script"], "第一幕，主角在雨夜车站等待。")
        self.assertEqual(params["target_duration_seconds"], 45)
        tts = registry.get("selfhost/tts_edge")
        self.assertEqual(tts.output_nodes["6"].value, "audio")
        self.assertIn("旁白配音", tts.applicable_scenarios)
        compose = registry.get("platform/compose")
        self.assertEqual(compose.output_nodes["30"].value, "video")
        params = registry.validate_params(
            "platform/compose",
            {
                "project_id": "project_001",
                "shot_ids": ["shot_001"],
                "timeline": [{"shot_id": "shot_001"}],
                "subtitles": [{"shot_id": "shot_001", "text": "测试字幕"}],
                "subtitle": True,
            },
        )
        self.assertEqual(params["shot_ids"], ["shot_001"])
        self.assertEqual(params["timeline"][0]["shot_id"], "shot_001")

    def test_registry_rejects_boolean_values_for_numeric_fields(self) -> None:
        registry = load_registry("workflows")
        with self.assertRaisesRegex(WorkflowValidationError, "宽度.*整数"):
            registry.validate_params("selfhost/image_flux", {"prompt": "测试", "width": True, "height": 1344})
        with self.assertRaisesRegex(WorkflowValidationError, "时长.*数字"):
            registry.validate_params(
                "selfhost/video_wan2.1_fusionx",
                {"prompt": "测试", "first_frame_url": "/storage/first.png", "duration": False, "fps": 16},
            )
        params = registry.validate_params(
            "platform/compose",
            {
                "project_id": "project_001",
                "shot_ids": ["shot_001"],
                "timeline": [{"shot_id": "shot_001"}],
                "subtitles": [{"shot_id": "shot_001", "text": "测试字幕"}],
                "subtitle": False,
            },
        )
        self.assertFalse(params["subtitle"])

    def test_registry_files_declare_required_product_fields(self) -> None:
        required_fields = {
            "workflow_key",
            "version",
            "display_name",
            "generation_type",
            "workflow_path",
            "description",
            "applicable_scenarios",
            "input_schema",
            "default_params",
            "output_nodes",
            "failure_hint",
        }
        for file_path in Path("workflows").rglob("*.registry.json"):
            data = json.loads(file_path.read_text(encoding="utf-8"))
            self.assertFalse(required_fields - set(data), file_path)
            self.assertTrue(data["applicable_scenarios"], file_path)
            workflow_path = Path(data["workflow_path"])
            self.assertTrue(workflow_path.exists(), workflow_path)
            workflow = json.loads(workflow_path.read_text(encoding="utf-8"))
            self.assertEqual(workflow["workflow_key"], data["workflow_key"])
            self.assertEqual(set(workflow["inputs"]), set(data["input_schema"]), file_path)
            self.assertTrue(set(data["output_nodes"]) <= set(workflow["outputs"]), file_path)

    def test_load_registry_falls_back_to_default_when_directory_empty(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            registry = load_registry(temp_dir)
            keys = {item["workflow_key"] for item in registry.to_payload()}
            self.assertIn("platform/script_analysis", keys)
            self.assertIn("selfhost/image_flux", keys)
            self.assertIn("selfhost/video_wan2.1_fusionx", keys)
            self.assertIn("selfhost/tts_edge", keys)
            self.assertIn("platform/compose", keys)

    def test_registry_rejects_default_params_outside_schema(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            workflow_path = root / "bad.json"
            workflow_path.write_text(
                json.dumps(
                    {
                        "workflow_key": "custom/bad",
                        "inputs": {"prompt": "{{prompt}}"},
                        "outputs": {"1": {"asset_type": "image"}},
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (root / "bad.registry.json").write_text(
                json.dumps(
                    {
                        "workflow_key": "custom/bad",
                        "version": "1.0.0",
                        "display_name": "坏工作流",
                        "generation_type": "image",
                        "workflow_path": str(workflow_path),
                        "applicable_scenarios": ["测试"],
                        "input_schema": {
                            "prompt": {"type": "string", "required": True, "label": "提示词"},
                        },
                        "default_params": {"prompt": "测试", "node_graph": {}},
                        "output_nodes": {"1": "image"},
                        "failure_hint": "请检查参数后重试。",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(WorkflowValidationError, "默认参数未在输入 schema 中声明"):
                load_registry(root)

    def test_registry_rejects_default_params_with_wrong_type(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            workflow_path = root / "bad_type.json"
            workflow_path.write_text(
                json.dumps(
                    {
                        "workflow_key": "custom/bad_type",
                        "inputs": {"prompt": "{{prompt}}", "width": "{{width}}"},
                        "outputs": {"1": {"asset_type": "image"}},
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (root / "bad_type.registry.json").write_text(
                json.dumps(
                    {
                        "workflow_key": "custom/bad_type",
                        "version": "1.0.0",
                        "display_name": "默认值类型错误工作流",
                        "generation_type": "image",
                        "workflow_path": str(workflow_path),
                        "applicable_scenarios": ["测试"],
                        "input_schema": {
                            "prompt": {"type": "string", "required": True, "label": "提示词"},
                            "width": {"type": "integer", "required": True, "label": "宽度"},
                        },
                        "default_params": {"width": "768"},
                        "output_nodes": {"1": "image"},
                        "failure_hint": "请检查参数后重试。",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(WorkflowValidationError, "默认参数无效"):
                load_registry(root)

    def test_registry_rejects_workflow_adapter_schema_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            workflow_path = root / "bad_adapter.json"
            workflow_path.write_text(
                json.dumps(
                    {
                        "workflow_key": "custom/bad_adapter",
                        "inputs": {"prompt": "{{prompt}}", "node_graph": {}},
                        "outputs": {"1": {"asset_type": "image"}},
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (root / "bad_adapter.registry.json").write_text(
                json.dumps(
                    {
                        "workflow_key": "custom/bad_adapter",
                        "version": "1.0.0",
                        "display_name": "坏适配工作流",
                        "generation_type": "image",
                        "workflow_path": str(workflow_path),
                        "applicable_scenarios": ["测试"],
                        "input_schema": {
                            "prompt": {"type": "string", "required": True, "label": "提示词"},
                        },
                        "default_params": {},
                        "output_nodes": {"2": "image"},
                        "failure_hint": "请检查参数后重试。",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(WorkflowValidationError, "输入定义不一致"):
                load_registry(root)

    def test_create_service_uses_workflow_registry_path_env(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            registry_dir = root / "custom"
            registry_dir.mkdir()
            workflow_path = registry_dir / "test_image.json"
            workflow_path.write_text(
                """
                {
                  "workflow_key": "custom/test_image",
                  "adapter_type": "comfyui",
                  "inputs": {
                    "prompt": "{{prompt}}"
                  },
                  "outputs": {
                    "1": {"asset_type": "image", "field": "images"}
                  },
                  "comfy_workflow": {
                    "1": {
                      "class_type": "CustomPromptInput",
                      "inputs": {
                        "prompt": "{{prompt}}"
                      }
                    }
                  }
                }
                """,
                encoding="utf-8",
            )
            (registry_dir / "custom.registry.json").write_text(
                """
                {
                  "workflow_key": "custom/test_image",
                  "version": "1.0.0",
                  "display_name": "测试图像工作流",
                  "generation_type": "image",
                  "workflow_path": "test_image.json",
                  "applicable_scenarios": ["测试场景"],
                  "input_schema": {
                    "prompt": {"type": "string", "required": true, "label": "提示词"}
                  },
                  "default_params": {},
                  "output_nodes": {"1": "image"}
                }
                """,
                encoding="utf-8",
            )
            data_path = root / "data.json"
            with patch.dict(
                os.environ,
                {"WORKFLOW_REGISTRY_PATH": str(registry_dir), "PLATFORM_DATA_PATH": str(data_path)},
                clear=False,
            ):
                service = create_service()
            workflows = service.workflows()
            self.assertEqual(len(workflows), 1)
            self.assertEqual(workflows[0]["workflow_key"], "custom/test_image")
            self.assertEqual(workflows[0]["applicable_scenarios"], ["测试场景"])
            self.assertEqual(Path(workflows[0]["workflow_path"]), workflow_path)

            fake_comfy = FakeComfy()
            service.comfy = fake_comfy
            task = service.create_generation_task("custom/test_image", {"prompt": "自定义相对路径"})
            submitted = service.submit_task(task["id"], {})
            self.assertEqual(submitted["prompt_id"], "prompt_custom_001")
            self.assertEqual(fake_comfy.submitted_workflow["1"]["class_type"], "CustomPromptInput")
            self.assertEqual(fake_comfy.submitted_workflow["1"]["inputs"]["prompt"], "自定义相对路径")


if __name__ == "__main__":
    unittest.main()
