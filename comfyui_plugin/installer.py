from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any


PLUGIN_PACKAGE_NAME = "video_gen_platform_nodes"
REQUIRED_NODE_KEYS = {
    "PlatformBusinessInput",
    "PlatformArchiveCallback",
    "PlatformShotInput",
    "PlatformTtsInput",
    "PlatformComposeManifest",
}


@dataclass
class PluginInstallReport:
    plugin_name: str
    source_dir: str
    target_dir: str
    installed: bool
    node_keys: list[str]
    message: str

    def to_payload(self) -> dict[str, Any]:
        return {
            "plugin_name": self.plugin_name,
            "source_dir": self.source_dir,
            "target_dir": self.target_dir,
            "installed": self.installed,
            "node_keys": self.node_keys,
            "message": self.message,
        }


def plugin_source_dir() -> Path:
    return Path(__file__).resolve().parent / PLUGIN_PACKAGE_NAME


def validate_plugin_source(source_dir: str | Path | None = None) -> list[str]:
    source = Path(source_dir) if source_dir is not None else plugin_source_dir()
    init_file = source / "__init__.py"
    readme_file = source / "README.md"
    if not source.is_dir():
        raise FileNotFoundError(f"插件源码目录不存在：{source}")
    if not init_file.is_file():
        raise FileNotFoundError(f"插件缺少入口文件：{init_file}")
    if not readme_file.is_file():
        raise FileNotFoundError(f"插件缺少安装说明：{readme_file}")

    module = _load_module(init_file)
    mappings = getattr(module, "NODE_CLASS_MAPPINGS", {})
    display_names = getattr(module, "NODE_DISPLAY_NAME_MAPPINGS", {})
    node_keys = set(mappings)
    missing = REQUIRED_NODE_KEYS - node_keys
    if missing:
        raise ValueError(f"插件缺少必需节点：{', '.join(sorted(missing))}")
    missing_names = REQUIRED_NODE_KEYS - set(display_names)
    if missing_names:
        raise ValueError(f"插件缺少节点中文名称：{', '.join(sorted(missing_names))}")
    return sorted(node_keys)


def install_plugin(comfyui_root: str | Path, *, source_dir: str | Path | None = None, force: bool = False) -> PluginInstallReport:
    source = Path(source_dir) if source_dir is not None else plugin_source_dir()
    node_keys = validate_plugin_source(source)
    custom_nodes = Path(comfyui_root) / "custom_nodes"
    target = custom_nodes / PLUGIN_PACKAGE_NAME
    if target.exists() and not force:
        raise FileExistsError(f"插件目录已存在：{target}，如需覆盖请传入 force=True。")
    custom_nodes.mkdir(parents=True, exist_ok=True)
    if target.exists():
        shutil.rmtree(target)
    ignore = shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store")
    shutil.copytree(source, target, ignore=ignore)
    return PluginInstallReport(
        plugin_name=PLUGIN_PACKAGE_NAME,
        source_dir=str(source),
        target_dir=str(target),
        installed=True,
        node_keys=node_keys,
        message="ComfyUI 插件已安装，请重启 ComfyUI 后生效。",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="安装或校验 VideoGen ComfyUI 自定义节点插件。")
    parser.add_argument("--comfyui-root", default="", help="ComfyUI 根目录，安装时会写入 custom_nodes/video_gen_platform_nodes。")
    parser.add_argument("--source-dir", default="", help="插件源码目录，默认使用仓库内 comfyui_plugin/video_gen_platform_nodes。")
    parser.add_argument("--check", action="store_true", help="只校验插件源码，不复制文件。")
    parser.add_argument("--force", action="store_true", help="目标目录已存在时覆盖安装。")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    source_dir = args.source_dir or None
    if args.check:
        node_keys = validate_plugin_source(source_dir)
        print(json.dumps({"plugin_name": PLUGIN_PACKAGE_NAME, "node_keys": node_keys, "message": "插件源码校验通过。"}, ensure_ascii=False, indent=2))
        return 0
    if not args.comfyui_root.strip():
        raise SystemExit("安装插件需要传入 --comfyui-root。")
    report = install_plugin(args.comfyui_root, source_dir=source_dir, force=args.force)
    print(json.dumps(report.to_payload(), ensure_ascii=False, indent=2))
    return 0


def _load_module(init_file: Path) -> Any:
    spec = importlib.util.spec_from_file_location("_video_gen_platform_nodes_check", init_file)
    if spec is None or spec.loader is None:
        raise ImportError(f"无法加载插件入口：{init_file}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
