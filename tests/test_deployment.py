from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from app.backend.runtime_config import platform_runtime_config
from app.backend.worker import worker_runtime_config


ROOT = Path(__file__).resolve().parents[1]


class DeploymentConfigTest(unittest.TestCase):
    def test_platform_runtime_config_summarizes_deployment_without_secrets(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            plugin_dir = Path(temp_dir) / "custom_nodes" / "video_gen_platform_nodes"
            plugin_dir.mkdir(parents=True)
            (plugin_dir / "__init__.py").write_text("NODE_CLASS_MAPPINGS = {}\n", encoding="utf-8")
            (plugin_dir / "README.md").write_text("插件说明\n", encoding="utf-8")
            config = platform_runtime_config(
                {
                    "COMFYUI_BASE_URL": "http://comfyui:8188",
                    "COMFYUI_API_KEY": "secret-comfy-key",
                    "COMFYUI_ROOT": temp_dir,
                    "WORKFLOW_REGISTRY_PATH": "workflows",
                    "PLATFORM_REPOSITORY_DRIVER": "postgres",
                    "PLATFORM_DATABASE_URL": "postgresql://user:pass@db/video",
                    "PLATFORM_STORAGE_DRIVER": "s3",
                    "PLATFORM_S3_ENDPOINT_URL": "https://oss.example.com",
                    "PLATFORM_S3_BUCKET": "video-gen-prod",
                    "PLATFORM_S3_ACCESS_KEY": "access-key",
                    "PLATFORM_S3_SECRET_KEY": "secret-key",
                    "PLATFORM_TASK_QUEUE_DRIVER": "arq",
                    "PLATFORM_API_TOKEN": "api-token",
                    "PLATFORM_SESSION_SECRET": "session-secret",
                    "PLATFORM_RATE_LIMIT_PER_MINUTE": "120",
                    "PLATFORM_ALERT_WEBHOOK_URL": "https://alerts.example.com/hook",
                    "PLATFORM_PAYMENT_WEBHOOK_SECRET": "payment-secret",
                    "PLATFORM_PAYMENT_CHECKOUT_URL_TEMPLATE": "https://pay.example.com/{order_id}",
                    "PLATFORM_PAYOUT_WEBHOOK_URL": "https://payout.example.com/withdrawals",
                    "PLATFORM_PAYOUT_PROVIDER": "finance-system",
                }
            )

        self.assertEqual(config["comfyui"]["base_url"], "http://comfyui:8188")
        self.assertTrue(config["comfyui"]["api_key_configured"])
        self.assertTrue(config["comfyui_plugin"]["installed"])
        self.assertTrue(config["comfyui_plugin"]["entry_file_present"])
        self.assertTrue(config["workflow_registry"]["loaded"])
        self.assertGreaterEqual(config["workflow_registry"]["workflow_count"], 4)
        self.assertIn("selfhost/image_flux", config["workflow_registry"]["workflow_keys"])
        self.assertEqual(config["repository"]["driver"], "postgres")
        self.assertTrue(config["repository"]["database_url_configured"])
        self.assertNotIn("secret-comfy-key", str(config))
        self.assertNotIn("payment-secret", str(config))
        self.assertTrue(config["storage"]["s3_enabled"])
        self.assertTrue(config["storage"]["s3_bucket_configured"])
        self.assertTrue(config["queue"]["arq_enabled"])
        self.assertTrue(config["alerts"]["webhook_configured"])
        self.assertTrue(config["payments"]["webhook_secret_configured"])
        self.assertTrue(config["payments"]["checkout_template_configured"])
        self.assertTrue(config["payouts"]["webhook_configured"])
        self.assertEqual(config["payouts"]["provider"], "finance-system")
        self.assertTrue(config["readiness"]["production_ready"])
        self.assertEqual(config["readiness"]["blocker_count"], 0)

    def test_platform_runtime_config_reports_readiness_blockers(self) -> None:
        config = platform_runtime_config({})
        checks = {item["id"]: item for item in config["readiness"]["checks"]}

        self.assertFalse(config["readiness"]["production_ready"])
        self.assertGreater(config["readiness"]["blocker_count"], 0)
        self.assertEqual(checks["repository_postgres"]["status"], "blocker")
        self.assertEqual(checks["object_storage"]["status"], "blocker")
        self.assertEqual(checks["api_security"]["status"], "blocker")
        self.assertEqual(checks["payments"]["status"], "blocker")
        self.assertEqual(checks["payouts"]["status"], "blocker")
        self.assertEqual(checks["comfyui_plugin"]["status"], "warning")
        self.assertEqual(checks["queue_arq"]["status"], "warning")

    def test_platform_runtime_config_reports_workflow_registry_errors(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "bad.registry.json").write_text("{bad-json", encoding="utf-8")
            config = platform_runtime_config({"WORKFLOW_REGISTRY_PATH": temp_dir})

        checks = {item["id"]: item for item in config["readiness"]["checks"]}
        self.assertFalse(config["workflow_registry"]["loaded"])
        self.assertIn("load_error", config["workflow_registry"])
        self.assertEqual(checks["workflow_registry"]["status"], "blocker")

    def test_worker_runtime_config_describes_arq_deployment(self) -> None:
        config = worker_runtime_config(
            {
                "PLATFORM_TASK_QUEUE_DRIVER": "arq",
                "PLATFORM_REDIS_URL": "redis://redis:6379/0",
                "PLATFORM_TASK_QUEUE_NAME": "video_gen_prod",
                "PLATFORM_ALERT_CHANNEL": "feishu",
                "PLATFORM_ALERT_COOLDOWN_SECONDS": "900",
                "PLATFORM_ALERT_STATE_PATH": "/data/storage/alert-state.json",
            }
        )

        self.assertTrue(config["arq_enabled"])
        self.assertEqual(config["driver"], "arq")
        self.assertEqual(config["redis_url"], "redis://redis:6379/0")
        self.assertEqual(config["queue_name"], "video_gen_prod")
        self.assertEqual(config["alert_channel"], "feishu")
        self.assertEqual(config["alert_cooldown_seconds"], 900)
        self.assertEqual(config["alert_state_path"], "/data/storage/alert-state.json")
        self.assertEqual(config["functions"], ["submit_generation_task"])
        self.assertEqual(config["api_app"], "app.backend.api:app")
        self.assertEqual(config["arq_worker"], "app.backend.worker.WorkerSettings")
        self.assertIn("python -m app.backend.worker", config["ops_worker_command"])

    def test_docker_compose_wires_api_arq_worker_and_dependencies(self) -> None:
        compose = (ROOT / "deploy" / "docker-compose.yml").read_text(encoding="utf-8")
        self.assertIn("api:", compose)
        self.assertIn("arq-worker:", compose)
        self.assertIn("ops-worker:", compose)
        self.assertIn("redis:", compose)
        self.assertIn("postgres:", compose)
        self.assertIn("uvicorn app.backend.api:app", compose)
        self.assertIn("arq app.backend.worker.WorkerSettings", compose)
        self.assertIn("python -m app.backend.worker --user-id system_admin", compose)
        self.assertIn("PLATFORM_TASK_QUEUE_DRIVER: arq", compose)
        self.assertIn("PLATFORM_REDIS_URL: redis://redis:6379/0", compose)
        self.assertIn("PLATFORM_REPOSITORY_DRIVER: postgres", compose)

    def test_env_example_documents_alert_deduplication(self) -> None:
        env_example = (ROOT / "deploy" / "env.example").read_text(encoding="utf-8")
        self.assertIn("PLATFORM_ALERT_WEBHOOK_URL=", env_example)
        self.assertIn("PLATFORM_ALERT_CHANNEL=generic", env_example)
        self.assertIn("PLATFORM_ALERT_TIMEOUT_SECONDS=10", env_example)
        self.assertIn("PLATFORM_ALERT_COOLDOWN_SECONDS=1800", env_example)
        self.assertIn("PLATFORM_ALERT_STATE_PATH=/data/storage/alert-state.json", env_example)

    def test_env_example_documents_object_storage_profiles(self) -> None:
        env_example = (ROOT / "deploy" / "env.example").read_text(encoding="utf-8")
        self.assertIn("PLATFORM_STORAGE_DRIVER=s3", env_example)
        self.assertIn("PLATFORM_S3_VENDOR=custom", env_example)
        self.assertIn("PLATFORM_S3_FORCE_PATH_STYLE=true", env_example)
        self.assertIn("PLATFORM_S3_UPLOAD_TIMEOUT_SECONDS=30", env_example)
        self.assertIn("PLATFORM_S3_ALLOW_INSECURE_ENDPOINT=false", env_example)

    def test_env_example_documents_payment_webhook_secret(self) -> None:
        env_example = (ROOT / "deploy" / "env.example").read_text(encoding="utf-8")
        self.assertIn("PLATFORM_PAYMENT_WEBHOOK_SECRET=change-me-payment-webhook-secret", env_example)
        self.assertIn("PLATFORM_PAYMENT_CHECKOUT_URL_TEMPLATE=", env_example)
        self.assertIn("PLATFORM_PAYMENT_STRIPE_CHECKOUT_URL_TEMPLATE=", env_example)

    def test_env_example_documents_payout_webhook_config(self) -> None:
        env_example = (ROOT / "deploy" / "env.example").read_text(encoding="utf-8")
        self.assertIn("PLATFORM_PAYOUT_WEBHOOK_URL=", env_example)
        self.assertIn("PLATFORM_PAYOUT_WEBHOOK_SECRET=", env_example)
        self.assertIn("PLATFORM_PAYOUT_PROVIDER=manual", env_example)
        self.assertIn("PLATFORM_PAYOUT_TIMEOUT_SECONDS=10", env_example)

    def test_docs_include_comfyui_plugin_installer_commands(self) -> None:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        env_example = (ROOT / "deploy" / "env.example").read_text(encoding="utf-8")
        self.assertIn("COMFYUI_ROOT=/opt/ComfyUI", env_example)
        self.assertIn("python -m comfyui_plugin.installer --check", readme)
        self.assertIn("python -m comfyui_plugin.installer --comfyui-root", readme)

    def test_docs_and_gitignore_cover_next_runtime_artifacts(self) -> None:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8")

        self.assertIn("工作流注册表探针", readme)
        self.assertIn("*.tsbuildinfo", gitignore)
        self.assertIn(".next/", gitignore)
        self.assertIn("node_modules/", gitignore)

    def test_systemd_units_reference_real_worker_entrypoints(self) -> None:
        api_unit = (ROOT / "deploy" / "systemd" / "video-gen-api.service").read_text(encoding="utf-8")
        arq_unit = (ROOT / "deploy" / "systemd" / "video-gen-arq-worker.service").read_text(encoding="utf-8")
        ops_unit = (ROOT / "deploy" / "systemd" / "video-gen-ops-worker.service").read_text(encoding="utf-8")
        ops_timer = (ROOT / "deploy" / "systemd" / "video-gen-ops-worker.timer").read_text(encoding="utf-8")

        self.assertIn("uvicorn app.backend.api:app", api_unit)
        self.assertIn("arq app.backend.worker.WorkerSettings", arq_unit)
        self.assertIn("Environment=PLATFORM_TASK_QUEUE_DRIVER=arq", arq_unit)
        self.assertIn("python -m app.backend.worker", ops_unit)
        self.assertIn("OnUnitActiveSec=5min", ops_timer)

    def test_dockerfile_installs_queue_and_postgres_extras(self) -> None:
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
        self.assertIn('pip install --no-cache-dir -e ".[queue,postgres]"', dockerfile)
        self.assertIn("CMD [\"uvicorn\", \"app.backend.api:app\"", dockerfile)


if __name__ == "__main__":
    unittest.main()
