from __future__ import annotations

import json
import unittest
import urllib.error
import urllib.parse
from unittest.mock import patch

from app.backend.comfy import ComfyClient
from app.backend.errors import PlatformError


class FakeResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def read(self) -> bytes:
        return json.dumps(self.payload).encode("utf-8")


class FakeBinaryResponse:
    def __init__(self, payload: bytes) -> None:
        self.payload = payload

    def __enter__(self) -> "FakeBinaryResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def read(self) -> bytes:
        return self.payload


class FakeHttpError(urllib.error.HTTPError):
    def __init__(self, url: str, code: int, payload: dict[str, object]) -> None:
        super().__init__(url, code, "Bad Request", hdrs={}, fp=None)
        self.payload = payload

    def read(self) -> bytes:
        return json.dumps(self.payload, ensure_ascii=False).encode("utf-8")


class ComfyClientTest(unittest.TestCase):
    def test_api_key_is_sent_to_comfy_requests(self) -> None:
        requests = []

        def fake_urlopen(request, timeout):
            requests.append(request)
            if request.full_url.endswith("/prompt"):
                return FakeResponse({"prompt_id": "prompt_with_key"})
            return FakeResponse({"queue_running": [], "queue_pending": []})

        client = ComfyClient(base_url="http://comfy.local", api_key="secret-token")
        with patch("urllib.request.urlopen", fake_urlopen):
            client._get_json("/queue")
            prompt_id = client.submit_prompt({"workflow_key": "selfhost/image_flux"}, "client_001")

        self.assertEqual(prompt_id, "prompt_with_key")
        self.assertEqual(requests[0].get_header("Authorization"), "Bearer secret-token")
        self.assertEqual(requests[1].get_header("Authorization"), "Bearer secret-token")
        self.assertEqual(requests[1].get_header("Content-type"), "application/json")

    def test_download_output_reads_comfy_view_with_output_metadata(self) -> None:
        requests = []

        def fake_urlopen(request, timeout):
            requests.append(request)
            return FakeBinaryResponse(b"remote image bytes")

        client = ComfyClient(base_url="http://comfy.local", api_key="secret-token")
        with patch("urllib.request.urlopen", fake_urlopen):
            body = client.download_output({"filename": "shot 01.png", "subfolder": "story/a", "type": "output"})

        self.assertEqual(body, b"remote image bytes")
        self.assertEqual(requests[0].get_method(), "GET")
        self.assertEqual(requests[0].get_header("Authorization"), "Bearer secret-token")
        parsed = urllib.parse.urlparse(requests[0].full_url)
        self.assertEqual(parsed.path, "/view")
        query = urllib.parse.parse_qs(parsed.query)
        self.assertEqual(query["filename"], ["shot 01.png"])
        self.assertEqual(query["subfolder"], ["story/a"])
        self.assertEqual(query["type"], ["output"])

    def test_cancel_prompt_deletes_queue_item_and_interrupts_running_task(self) -> None:
        requests = []

        def fake_urlopen(request, timeout):
            requests.append(request)
            return FakeResponse({})

        client = ComfyClient(base_url="http://comfy.local", api_key="secret-token")
        with patch("urllib.request.urlopen", fake_urlopen):
            client.cancel_prompt("prompt_cancel_001")

        self.assertEqual([request.full_url for request in requests], ["http://comfy.local/queue", "http://comfy.local/interrupt"])
        self.assertEqual(requests[0].get_method(), "POST")
        self.assertEqual(json.loads(requests[0].data.decode("utf-8")), {"delete": ["prompt_cancel_001"]})
        self.assertEqual(json.loads(requests[1].data.decode("utf-8")), {})
        self.assertTrue(all(request.get_header("Authorization") == "Bearer secret-token" for request in requests))

    def test_http_error_keeps_comfy_response_as_provider_error(self) -> None:
        def fake_urlopen(request, timeout):
            raise FakeHttpError(request.full_url, 400, {"error": "Prompt outputs failed validation", "node": "9"})

        client = ComfyClient(base_url="http://comfy.local")
        with patch("urllib.request.urlopen", fake_urlopen):
            with self.assertRaises(PlatformError) as context:
                client.submit_prompt({"1": {"inputs": {}}}, "client_001")

        self.assertEqual(context.exception.message, "ComfyUI 请求失败（HTTP 400）。")
        self.assertIn("Prompt outputs failed validation", context.exception.provider_error)
        self.assertIn("工作流节点", context.exception.retry_advice)

    def test_status_reports_http_error_without_raising(self) -> None:
        def fake_urlopen(request, timeout):
            raise FakeHttpError(request.full_url, 500, {"error": "queue crashed"})

        client = ComfyClient(base_url="http://comfy.local")
        with patch("urllib.request.urlopen", fake_urlopen):
            status = client.status()

        self.assertFalse(status.connected)
        self.assertEqual(status.message, "ComfyUI 请求失败（HTTP 500）。")


if __name__ == "__main__":
    unittest.main()
