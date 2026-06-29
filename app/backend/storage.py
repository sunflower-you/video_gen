from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import hmac
import mimetypes
import shutil
import struct
import urllib.error
import urllib.parse
import urllib.request
import wave
from pathlib import Path

from .models import Asset, AssetType


class LocalStorage:
    def __init__(
        self,
        root: str | Path = "storage",
        comfy_output_root: str | Path | None = None,
        public_base_url: str = "",
    ) -> None:
        self.root = Path(root)
        self.comfy_output_root = Path(comfy_output_root) if comfy_output_root else self.root / "comfy-output"
        self.public_base_url = public_base_url.strip().rstrip("/")
        self.root.mkdir(parents=True, exist_ok=True)
        self.comfy_output_root.mkdir(parents=True, exist_ok=True)

    def archive_file(self, source: str | Path, *, asset_type: AssetType, task_id: str, created_by: str = "system") -> Asset:
        source_path = Path(source)
        if not source_path.exists():
            raise FileNotFoundError(f"输出文件不存在：{source_path}")

        digest = _sha256(source_path)
        target_dir = self.root / "assets" / task_id
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / f"{digest[:16]}{source_path.suffix}"
        if source_path.resolve() != target.resolve():
            shutil.copy2(source_path, target)

        mime_type, _ = mimetypes.guess_type(target.name)
        width, height = _image_size(target)
        duration_seconds = _duration_seconds(target)
        relative_url = f"/assets/{task_id}/{target.name}"
        return Asset(
            asset_type=asset_type,
            url=f"{self.public_base_url}{relative_url}" if self.public_base_url else f"/storage{relative_url}",
            local_path=str(target),
            mime_type=mime_type or "application/octet-stream",
            width=width,
            height=height,
            duration_seconds=duration_seconds,
            content_hash=digest,
            source_task_id=task_id,
            status="available",
            created_by=created_by or "system",
        )

    def delete_file(self, local_path: str | Path) -> None:
        candidate = Path(local_path)
        if not candidate:
            return
        try:
            resolved = candidate.resolve()
            resolved.relative_to(self.root.resolve())
        except (OSError, ValueError):
            return
        if resolved.is_file():
            resolved.unlink()
        parent = resolved.parent
        try:
            if parent != self.root.resolve() and parent.exists() and not any(parent.iterdir()):
                parent.rmdir()
        except OSError:
            return

    def comfy_output_path(self, output: dict[str, object]) -> Path:
        filename = str(output.get("filename", "")).strip()
        if not filename:
            raise FileNotFoundError("ComfyUI 输出缺少文件名。")
        subfolder = str(output.get("subfolder", "")).strip()
        output_type = str(output.get("type", "output")).strip() or "output"
        root = self.comfy_output_root.resolve()
        base = root / output_type
        if subfolder:
            base = base / subfolder
        candidate = (base / filename).resolve()
        try:
            candidate.relative_to(root)
        except ValueError as exc:
            raise FileNotFoundError("ComfyUI 输出路径不合法。") from exc
        return candidate


class S3CompatibleStorage(LocalStorage):
    VENDOR_ALIASES = {
        "s3": "aws-s3",
        "aws": "aws-s3",
        "aws-s3": "aws-s3",
        "oss": "aliyun-oss",
        "aliyun": "aliyun-oss",
        "aliyun-oss": "aliyun-oss",
        "cos": "tencent-cos",
        "tencent": "tencent-cos",
        "tencent-cos": "tencent-cos",
        "minio": "minio",
        "custom": "custom",
    }

    def __init__(
        self,
        root: str | Path = "storage",
        *,
        endpoint_url: str,
        bucket: str,
        access_key: str,
        secret_key: str,
        region: str = "us-east-1",
        prefix: str = "",
        public_base_url: str = "",
        comfy_output_root: str | Path | None = None,
        vendor: str = "custom",
        force_path_style: bool = True,
        upload_timeout_seconds: float = 30.0,
        allow_insecure_endpoint: bool = False,
    ) -> None:
        if not endpoint_url.strip() or not bucket.strip():
            raise ValueError("对象存储 endpoint 和 bucket 不能为空。")
        if not access_key.strip() or not secret_key.strip():
            raise ValueError("对象存储访问密钥不能为空。")
        vendor_name = self._normalize_vendor(vendor)
        _validate_object_storage_config(
            endpoint_url=endpoint_url,
            bucket=bucket,
            prefix=prefix,
            vendor=vendor_name,
            allow_insecure_endpoint=allow_insecure_endpoint,
        )
        super().__init__(root, comfy_output_root=comfy_output_root, public_base_url="")
        self.endpoint_url = endpoint_url.strip().rstrip("/")
        self.bucket = bucket.strip()
        self.access_key = access_key.strip()
        self.secret_key = secret_key.strip()
        self.region = region.strip() or "us-east-1"
        self.prefix = prefix.strip().strip("/")
        self.vendor = vendor_name
        self.force_path_style = force_path_style
        self.upload_timeout_seconds = upload_timeout_seconds
        self.object_public_base_url = (
            public_base_url.strip().rstrip("/")
            if public_base_url.strip()
            else f"{self.endpoint_url}/{urllib.parse.quote(self.bucket)}"
        )

    def archive_file(self, source: str | Path, *, asset_type: AssetType, task_id: str, created_by: str = "system") -> Asset:
        asset = super().archive_file(source, asset_type=asset_type, task_id=task_id, created_by=created_by)
        object_key = self._object_key(task_id, Path(asset.local_path).name)
        self._put_object(
            object_key=object_key,
            source_path=Path(asset.local_path),
            content_type=asset.mime_type,
            content_hash=asset.content_hash,
        )
        asset.url = f"{self.object_public_base_url}/{urllib.parse.quote(object_key)}"
        return asset

    def _object_key(self, task_id: str, filename: str) -> str:
        parts = [item for item in [self.prefix, "assets", task_id, filename] if item]
        return "/".join(parts)

    @classmethod
    def _normalize_vendor(cls, vendor: str) -> str:
        key = (vendor or "custom").strip().lower().replace("_", "-")
        try:
            return cls.VENDOR_ALIASES[key]
        except KeyError as exc:
            raise ValueError(f"不支持的对象存储厂商：{vendor}") from exc

    def diagnostics(self) -> dict[str, object]:
        return {
            "driver": "s3",
            "vendor": self.vendor,
            "endpoint_url": self.endpoint_url,
            "bucket": self.bucket,
            "region": self.region,
            "prefix": self.prefix,
            "force_path_style": self.force_path_style,
            "public_base_url": self.object_public_base_url,
            "upload_timeout_seconds": self.upload_timeout_seconds,
        }

    def _put_object(self, *, object_key: str, source_path: Path, content_type: str, content_hash: str) -> None:
        body = source_path.read_bytes()
        url = self._object_url(object_key)
        timestamp = datetime.now(timezone.utc)
        headers = _s3_signed_headers(
            method="PUT",
            url=url,
            body=body,
            content_type=content_type,
            access_key=self.access_key,
            secret_key=self.secret_key,
            region=self.region,
            timestamp=timestamp,
        )
        headers["Content-Type"] = content_type
        headers["X-Platform-Content-Sha256"] = content_hash
        request = urllib.request.Request(url, data=body, headers=headers, method="PUT")
        try:
            with urllib.request.urlopen(request, timeout=self.upload_timeout_seconds):
                return
        except urllib.error.URLError as exc:
            raise OSError(f"对象存储上传失败：{exc}") from exc

    def _delete_object(self, *, object_key: str) -> None:
        url = self._object_url(object_key)
        timestamp = datetime.now(timezone.utc)
        headers = _s3_signed_headers(
            method="DELETE",
            url=url,
            body=b"",
            content_type="application/octet-stream",
            access_key=self.access_key,
            secret_key=self.secret_key,
            region=self.region,
            timestamp=timestamp,
        )
        headers["Content-Type"] = "application/octet-stream"
        request = urllib.request.Request(url, headers=headers, method="DELETE")
        try:
            with urllib.request.urlopen(request, timeout=self.upload_timeout_seconds):
                return
        except urllib.error.URLError as exc:
            raise OSError(f"对象存储探针清理失败：{exc}") from exc

    def _object_url(self, object_key: str) -> str:
        quoted_key = urllib.parse.quote(object_key)
        if self.force_path_style:
            return f"{self.endpoint_url}/{urllib.parse.quote(self.bucket)}/{quoted_key}"
        parsed = urllib.parse.urlparse(self.endpoint_url)
        endpoint_path = parsed.path.rstrip("/")
        host = f"{urllib.parse.quote(self.bucket)}.{parsed.netloc}"
        return urllib.parse.urlunparse((parsed.scheme, host, f"{endpoint_path}/{quoted_key}", "", "", ""))


def _validate_object_storage_config(
    *,
    endpoint_url: str,
    bucket: str,
    prefix: str,
    vendor: str,
    allow_insecure_endpoint: bool,
) -> None:
    parsed = urllib.parse.urlparse(endpoint_url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("对象存储 endpoint 必须是完整的 HTTP/HTTPS 地址。")
    if parsed.scheme != "https" and vendor != "minio" and not allow_insecure_endpoint:
        raise ValueError("生产对象存储 endpoint 必须使用 HTTPS；本地 MinIO 可使用 HTTP。")
    if "/" in bucket.strip() or "\\" in bucket.strip():
        raise ValueError("对象存储 bucket 不能包含路径。")
    normalized_prefix = prefix.strip().strip("/")
    if any(part in {"", ".", ".."} for part in normalized_prefix.split("/") if normalized_prefix):
        raise ValueError("对象存储 prefix 不能包含空段、当前目录或上级目录。")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _s3_signed_headers(
    *,
    method: str,
    url: str,
    body: bytes,
    content_type: str,
    access_key: str,
    secret_key: str,
    region: str,
    timestamp: datetime,
) -> dict[str, str]:
    parsed = urllib.parse.urlparse(url)
    host = parsed.netloc
    path = parsed.path or "/"
    amz_date = timestamp.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = timestamp.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(body).hexdigest()
    canonical_headers = (
        f"content-type:{content_type}\n"
        f"host:{host}\n"
        f"x-amz-content-sha256:{payload_hash}\n"
        f"x-amz-date:{amz_date}\n"
    )
    signed_headers = "content-type;host;x-amz-content-sha256;x-amz-date"
    canonical_request = "\n".join(
        [
            method,
            path,
            parsed.query,
            canonical_headers,
            signed_headers,
            payload_hash,
        ]
    )
    credential_scope = f"{date_stamp}/{region}/s3/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        ]
    )
    signing_key = _s3_signing_key(secret_key, date_stamp, region)
    signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    return {
        "Authorization": (
            "AWS4-HMAC-SHA256 "
            f"Credential={access_key}/{credential_scope}, "
            f"SignedHeaders={signed_headers}, "
            f"Signature={signature}"
        ),
        "Host": host,
        "X-Amz-Content-Sha256": payload_hash,
        "X-Amz-Date": amz_date,
    }


def _s3_signing_key(secret_key: str, date_stamp: str, region: str) -> bytes:
    date_key = hmac.new(f"AWS4{secret_key}".encode("utf-8"), date_stamp.encode("utf-8"), hashlib.sha256).digest()
    region_key = hmac.new(date_key, region.encode("utf-8"), hashlib.sha256).digest()
    service_key = hmac.new(region_key, b"s3", hashlib.sha256).digest()
    return hmac.new(service_key, b"aws4_request", hashlib.sha256).digest()


def _image_size(path: Path) -> tuple[int | None, int | None]:
    try:
        with path.open("rb") as file:
            header = file.read(32)
            if header.startswith(b"\x89PNG\r\n\x1a\n") and header[12:16] == b"IHDR":
                return struct.unpack(">II", header[16:24])
            if header.startswith(b"\xff\xd8"):
                return _jpeg_size(file)
    except OSError:
        return None, None
    return None, None


def _jpeg_size(file) -> tuple[int | None, int | None]:
    while True:
        marker_start = file.read(1)
        if not marker_start:
            return None, None
        if marker_start != b"\xff":
            continue
        marker = file.read(1)
        while marker == b"\xff":
            marker = file.read(1)
        if marker in {b"\xd8", b"\xd9"}:
            continue
        length_bytes = file.read(2)
        if len(length_bytes) != 2:
            return None, None
        segment_length = struct.unpack(">H", length_bytes)[0]
        if segment_length < 2:
            return None, None
        if marker and 0xC0 <= marker[0] <= 0xCF and marker[0] not in {0xC4, 0xC8, 0xCC}:
            segment = file.read(segment_length - 2)
            if len(segment) >= 5:
                height, width = struct.unpack(">HH", segment[1:5])
                return width, height
            return None, None
        file.seek(segment_length - 2, 1)


def _duration_seconds(path: Path) -> float | None:
    suffix = path.suffix.lower()
    if suffix == ".wav":
        return _wav_duration(path)
    if suffix in {".mp4", ".m4v", ".mov"}:
        return _mp4_duration(path)
    return None


def _wav_duration(path: Path) -> float | None:
    try:
        with wave.open(str(path), "rb") as audio:
            frame_rate = audio.getframerate()
            if frame_rate <= 0:
                return None
            return round(audio.getnframes() / frame_rate, 3)
    except (OSError, EOFError, wave.Error):
        return None


def _mp4_duration(path: Path) -> float | None:
    try:
        data = path.read_bytes()
    except OSError:
        return None
    return _find_mvhd_duration(data, 0, len(data))


def _find_mvhd_duration(data: bytes, start: int, end: int) -> float | None:
    offset = start
    while offset + 8 <= end:
        size = int.from_bytes(data[offset : offset + 4], "big")
        atom_type = data[offset + 4 : offset + 8]
        header_size = 8
        if size == 1 and offset + 16 <= end:
            size = int.from_bytes(data[offset + 8 : offset + 16], "big")
            header_size = 16
        elif size == 0:
            size = end - offset
        if size < header_size or offset + size > end:
            return None
        payload_start = offset + header_size
        payload_end = offset + size
        if atom_type == b"mvhd":
            return _parse_mvhd_duration(data[payload_start:payload_end])
        if atom_type in {b"moov", b"trak", b"mdia"}:
            duration = _find_mvhd_duration(data, payload_start, payload_end)
            if duration is not None:
                return duration
        offset += size
    return None


def _parse_mvhd_duration(payload: bytes) -> float | None:
    if len(payload) < 20:
        return None
    version = payload[0]
    if version == 1:
        if len(payload) < 32:
            return None
        timescale = int.from_bytes(payload[20:24], "big")
        duration = int.from_bytes(payload[24:32], "big")
    else:
        timescale = int.from_bytes(payload[12:16], "big")
        duration = int.from_bytes(payload[16:20], "big")
    if timescale <= 0:
        return None
    return round(duration / timescale, 3)
