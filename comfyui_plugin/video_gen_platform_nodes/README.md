# VideoGen Platform Nodes

这是面向 ComfyUI `custom_nodes` 的轻量插件包，用于把平台业务参数和平台归档回调沉淀为可复用节点。

## 安装

将 `comfyui_plugin/video_gen_platform_nodes` 目录复制到 ComfyUI 的 `custom_nodes/video_gen_platform_nodes`，重启 ComfyUI。

## 节点

- `平台业务输入` / `PlatformBusinessInput`：接收平台传入的 `prompt`、`width`、`height`、`seed`、负面提示词和业务 metadata，并把它们输出给后续模型节点。平台 workflow adapter 可稳定引用该节点，避免让前端直接提交任意节点图。
- `平台归档回调` / `PlatformArchiveCallback`：作为输出节点调用平台 API，同步任务或触发归档流程。生产环境建议通过内网地址访问平台 API，并配置平台访问令牌。
- `平台镜头输入` / `PlatformShotInput`：规范化分镜 ID、旁白、画面描述、景别、角色列表、首帧 URL、时长和 fps，并输出合并后的镜头提示词与 metadata，适合图像和视频 workflow 复用。
- `平台配音输入` / `PlatformTtsInput`：规范化 TTS 文本、音色、语速、音高和分镜 ID，并把 voice/shot 信息写入 metadata，适合配音 workflow 复用。
- `平台合成清单` / `PlatformComposeManifest`：校验项目 ID、时间线 JSON、字幕 JSON、BGM 和画幅，并输出合成 manifest，适合字幕、配音、镜头片段合成 workflow 复用。

## 安全边界

- 插件只处理平台业务字段，不暴露任意 ComfyUI 节点图提交入口。
- 角色、时间线、字幕和 metadata 必须使用 JSON 对象或数组，格式错误会在节点层以中文错误提前失败。
- 回调节点仅发送指定任务 ID 和输出 payload；平台侧仍以 workflow registry 的输出节点映射和任务权限为准。
- 若平台启用了 `PLATFORM_API_TOKEN`，回调节点需要传入相同令牌。
