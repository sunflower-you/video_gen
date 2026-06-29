from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from comfyui_plugin.installer import install_plugin, main as installer_main, validate_plugin_source
from comfyui_plugin.video_gen_platform_nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS


class ComfyUiPluginTest(unittest.TestCase):
    def test_plugin_exposes_required_comfyui_node_mappings(self) -> None:
        self.assertIn("PlatformBusinessInput", NODE_CLASS_MAPPINGS)
        self.assertIn("PlatformArchiveCallback", NODE_CLASS_MAPPINGS)
        self.assertIn("PlatformShotInput", NODE_CLASS_MAPPINGS)
        self.assertIn("PlatformTtsInput", NODE_CLASS_MAPPINGS)
        self.assertIn("PlatformComposeManifest", NODE_CLASS_MAPPINGS)
        self.assertEqual(NODE_DISPLAY_NAME_MAPPINGS["PlatformBusinessInput"], "平台业务输入")
        self.assertEqual(NODE_DISPLAY_NAME_MAPPINGS["PlatformShotInput"], "平台镜头输入")
        self.assertEqual(NODE_DISPLAY_NAME_MAPPINGS["PlatformTtsInput"], "平台配音输入")
        self.assertEqual(NODE_DISPLAY_NAME_MAPPINGS["PlatformComposeManifest"], "平台合成清单")
        business_node = NODE_CLASS_MAPPINGS["PlatformBusinessInput"]
        callback_node = NODE_CLASS_MAPPINGS["PlatformArchiveCallback"]
        shot_node = NODE_CLASS_MAPPINGS["PlatformShotInput"]
        tts_node = NODE_CLASS_MAPPINGS["PlatformTtsInput"]
        compose_node = NODE_CLASS_MAPPINGS["PlatformComposeManifest"]
        self.assertIn("prompt", business_node.INPUT_TYPES()["required"])
        self.assertIn("platform_api_url", callback_node.INPUT_TYPES()["required"])
        self.assertIn("visual_description", shot_node.INPUT_TYPES()["required"])
        self.assertIn("voice", tts_node.INPUT_TYPES()["required"])
        self.assertIn("timeline_json", compose_node.INPUT_TYPES()["required"])
        self.assertTrue(callback_node.OUTPUT_NODE)

    def test_plugin_installer_validates_and_copies_custom_nodes_package(self) -> None:
        node_keys = validate_plugin_source()
        self.assertIn("PlatformBusinessInput", node_keys)
        self.assertIn("PlatformComposeManifest", node_keys)
        with tempfile.TemporaryDirectory() as temp_dir:
            report = install_plugin(temp_dir)
            target = Path(report.target_dir)
            self.assertTrue(target.is_dir())
            self.assertTrue((target / "__init__.py").is_file())
            self.assertTrue((target / "README.md").is_file())
            self.assertEqual(report.plugin_name, "video_gen_platform_nodes")
            self.assertIn("PlatformArchiveCallback", report.node_keys)
            self.assertIn("重启 ComfyUI", report.message)
            with self.assertRaisesRegex(FileExistsError, "已存在"):
                install_plugin(temp_dir)
            forced = install_plugin(temp_dir, force=True)
            self.assertTrue(Path(forced.target_dir).is_dir())

    def test_plugin_installer_rejects_incomplete_source_and_cli_check(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            bad_source = Path(temp_dir) / "bad_plugin"
            bad_source.mkdir()
            (bad_source / "__init__.py").write_text("NODE_CLASS_MAPPINGS = {}\nNODE_DISPLAY_NAME_MAPPINGS = {}\n", encoding="utf-8")
            (bad_source / "README.md").write_text("bad", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "缺少必需节点"):
                validate_plugin_source(bad_source)
        with patch("builtins.print") as printed:
            exit_code = installer_main(["--check"])
        self.assertEqual(exit_code, 0)
        self.assertTrue(printed.called)

    def test_platform_business_input_forwards_business_fields_and_validates_metadata(self) -> None:
        node = NODE_CLASS_MAPPINGS["PlatformBusinessInput"]()
        result = node.forward(
            prompt="雨夜车站",
            width=768,
            height=1344,
            seed=42,
            negative_prompt="低清",
            metadata_json='{"project_id":"project_001"}',
        )
        self.assertEqual(result, ("雨夜车站", 768, 1344, 42, "低清", '{"project_id":"project_001"}'))
        with self.assertRaisesRegex(ValueError, "JSON 参数格式"):
            node.forward("提示词", 768, 1344, -1, metadata_json="{bad")
        with self.assertRaisesRegex(ValueError, "JSON 参数必须是对象"):
            node.forward("提示词", 768, 1344, -1, metadata_json="[]")

    def test_platform_archive_callback_posts_sync_payload_with_token(self) -> None:
        node = NODE_CLASS_MAPPINGS["PlatformArchiveCallback"]()
        captured = {}

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback) -> None:
                return None

            def read(self) -> bytes:
                return b'{"status":"completed"}'

        def fake_urlopen(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            return Response()

        with patch("urllib.request.urlopen", fake_urlopen):
            result = node.notify(
                platform_api_url="http://platform.local/",
                task_id="task_001",
                output_node="9",
                output_payload_json='{"filename":"shot.png"}',
                platform_api_token="platform-token",
                timeout_seconds=7,
            )

        self.assertEqual(result, ('{"status":"completed"}',))
        self.assertEqual(captured["request"].full_url, "http://platform.local/api/comfy/tasks/task_001/sync")
        self.assertEqual(captured["timeout"], 7)
        headers = {key.lower(): value for key, value in captured["request"].header_items()}
        self.assertEqual(headers["authorization"], "Bearer platform-token")
        self.assertIn(b'"output_node": "9"', captured["request"].data)
        with self.assertRaisesRegex(ValueError, "平台任务 ID"):
            node.notify("http://platform.local", "", "9", "{}")

    def test_platform_shot_input_normalizes_prompt_and_metadata(self) -> None:
        node = NODE_CLASS_MAPPINGS["PlatformShotInput"]()
        result = node.forward(
            shot_id="shot_001",
            narration="她低声说出真相",
            visual_description="雨夜车站，角色回头",
            shot_size="近景",
            characters_json='["林夏"]',
            prompt="电影感光影",
            negative_prompt="低清",
            first_frame_url="/storage/first.png",
            duration=5.5,
            fps=24,
            metadata_json='{"project_id":"project_001"}',
        )
        self.assertEqual(result[0], "shot_001")
        self.assertEqual(result[5], "电影感光影，雨夜车站，角色回头，近景，她低声说出真相")
        self.assertEqual(result[6], "/storage/first.png")
        self.assertEqual(result[7], 5.5)
        self.assertEqual(result[8], 24)
        metadata = json.loads(result[9])
        self.assertEqual(metadata["project_id"], "project_001")
        self.assertEqual(metadata["shot_id"], "shot_001")
        self.assertEqual(metadata["shot_size"], "近景")
        self.assertEqual(metadata["negative_prompt"], "低清")
        with self.assertRaisesRegex(ValueError, "角色列表 JSON 必须是数组"):
            node.forward("shot_001", "旁白", "画面", "中景", "{}", "提示词", "")
        with self.assertRaisesRegex(ValueError, "JSON 参数格式"):
            node.forward("shot_001", "旁白", "画面", "中景", "[]", "提示词", "", metadata_json="{bad")

    def test_platform_tts_input_validates_text_and_merges_metadata(self) -> None:
        node = NODE_CLASS_MAPPINGS["PlatformTtsInput"]()
        result = node.forward(
            text="欢迎来到新的城市。",
            voice="zh-CN-YunxiNeural",
            rate=1.1,
            pitch=0.95,
            shot_id="shot_002",
            metadata_json='{"project_id":"project_001"}',
        )
        self.assertEqual(result[:5], ("欢迎来到新的城市。", "zh-CN-YunxiNeural", 1.1, 0.95, "shot_002"))
        metadata = json.loads(result[5])
        self.assertEqual(metadata["project_id"], "project_001")
        self.assertEqual(metadata["shot_id"], "shot_002")
        self.assertEqual(metadata["voice"], "zh-CN-YunxiNeural")
        with self.assertRaisesRegex(ValueError, "配音文本不能为空"):
            node.forward("", "zh-CN-XiaoxiaoNeural", 1.0, 1.0)

    def test_platform_compose_manifest_validates_timeline_and_subtitles(self) -> None:
        node = NODE_CLASS_MAPPINGS["PlatformComposeManifest"]()
        timeline_json = '[{"shot_id":"shot_001","video_asset_id":"asset_video"}]'
        subtitle_json = '[{"start_seconds":0,"end_seconds":4,"text":"第一句"}]'
        result = node.forward(
            project_id="project_001",
            timeline_json=timeline_json,
            subtitle_json=subtitle_json,
            bgm_url="/storage/bgm.mp3",
            aspect_ratio="9:16",
            metadata_json='{"work_id":"work_001"}',
        )
        self.assertEqual(result[:5], ("project_001", timeline_json, subtitle_json, "/storage/bgm.mp3", "9:16"))
        metadata = json.loads(result[5])
        self.assertEqual(metadata["project_id"], "project_001")
        self.assertEqual(metadata["work_id"], "work_001")
        self.assertEqual(metadata["bgm_url"], "/storage/bgm.mp3")
        with self.assertRaisesRegex(ValueError, "平台项目 ID 不能为空"):
            node.forward("", "[]", "[]")
        with self.assertRaisesRegex(ValueError, "时间线 JSON 必须是数组"):
            node.forward("project_001", "{}", "[]")
        with self.assertRaisesRegex(ValueError, "字幕 JSON 格式不正确"):
            node.forward("project_001", "[]", "{bad")


if __name__ == "__main__":
    unittest.main()
