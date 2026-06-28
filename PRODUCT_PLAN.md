# 类 Liblib 的中文短视频/漫剧制作平台方案

## 1. 总览

首版按“平台社区优先”建设：既做可用的 AI 创作链路，也做作品广场、作者主页、模板/工作流复用、点赞收藏和发布审核。生成能力接入本机/内网 ComfyUI，优先复用 Pixelle-Video 现有的 ComfyUI 工作流、TTS、图像、视频、任务管理能力。

对标 LibTV/Liblib 的核心形态：专业视频创作工具、作品/模板画布、短片剧集、动画短片、概念设计、经典衍生、AI 漫剧赛道、作者等级、成片展示、点赞收藏、封面和最终视频输出。

## 2. 核心产品模块

- 首页/作品广场：瀑布流展示作品，支持分类筛选：短片剧集、动画短片、概念设计、经典衍生、AI 漫剧、广告短片、精选画布。
- 创作工作台：项目创建、脚本输入、角色设定、分镜拆解、镜头生成、配音字幕、视频合成、导出发布。
- 模板/工作流市场：展示可复用的创作模板，模板包含 ComfyUI 工作流、默认参数、示例输入、封面、成片示例。
- 作者体系：作者主页、作品列表、模板列表、点赞数、收藏数、粉丝数、作者等级：普通、先锋、专业。
- 项目资产库：统一管理脚本、角色图、分镜图、视频片段、音频、字幕、封面、最终成片。
- 审核与发布：作品先进入草稿、待审核、已发布、已下架状态；平台广场只展示已发布内容。

## 3. 技术架构

- 前端：Next.js + TypeScript + Tailwind CSS，所有用户可见文案使用中文；首屏直接进入平台型工作界面，不做营销落地页。
- 后端：FastAPI，提供创作、任务、资源、作品、模板、用户、互动接口。
- 数据库：PostgreSQL 存储用户、项目、分镜、任务、作品、模板、互动数据。
- 队列：Redis + arq，用于 ComfyUI 长任务、视频合成、发布审核。
- 文件存储：开发期本地 `storage/`，生产期抽象为 S3/OSS 兼容存储；数据库只存文件 URL、hash、mime、尺寸、时长。
- AI 能力层：封装 `ComfyProvider`，支持 `selfhost` ComfyUI URL、API Key、workflow JSON、任务状态查询和输出归档。
- 可复用能力：参考 Pixelle-Video 的 `workflows/selfhost/*`、`workflows/runninghub/*`、任务状态模型、TTS/图像/视频生成服务。

## 4. 数据模型

- `User`：昵称、头像、简介、作者等级、角色、状态。
- `Project`：标题、类型、状态、作者、当前步骤、封面、成片地址、创建/更新时间。
- `Script`：原始文本、改写文本、风格、目标时长、语言。
- `Character`：角色名、设定、参考图、统一风格提示词、LoRA/模型配置。
- `StoryboardShot`：镜头序号、旁白、画面描述、景别、角色、提示词、负面提示词、生成状态、关联素材。
- `GenerationTask`：任务类型、状态、进度、错误、ComfyUI prompt_id、输入参数、输出文件。
- `Asset`：类型、URL、本地路径、mime、宽高、时长、hash、来源任务。
- `WorkTemplate`：名称、描述、分类、封面、示例视频、workflow key、参数 schema、发布状态。
- `PublishedWork`：标题、描述、封面、视频、分类标签、作者、审核状态、点赞数、收藏数、浏览数。
- `Interaction`：用户、目标类型、目标 ID、类型：like/favorite/follow。

## 5. API 接口

- `POST /api/projects`：创建项目，输入标题、类型、目标比例、默认模板。
- `GET /api/projects` / `GET /api/projects/{id}`：项目列表和详情。
- `POST /api/projects/{id}/script/analyze`：脚本分析，生成角色、剧情段落和分镜草稿。
- `POST /api/projects/{id}/shots/{shot_id}/generate-image`：生成单个分镜图。
- `POST /api/projects/{id}/shots/{shot_id}/generate-video`：生成单个镜头视频。
- `POST /api/projects/{id}/compose`：合成字幕、配音、BGM、镜头片段，输出成片。
- `GET /api/tasks/{task_id}`：查询生成/合成进度。
- `POST /api/works/{project_id}/publish`：提交发布审核。
- `GET /api/works`：作品广场列表，支持分类、排序、关键词。
- `GET /api/templates`：模板/工作流市场列表。
- `POST /api/interactions`：点赞、收藏、关注。

## 6. ComfyUI 工作流

- 图像生成：默认接 `selfhost/image_flux.json` 或 `selfhost/image_qwen.json`，输入镜头提示词、角色参考图、尺寸、seed。
- 视频生成：默认接 `selfhost/video_wan2.1_fusionx.json`，输入首帧/参考图、动作描述、时长、fps。
- TTS：默认接 `selfhost/tts_edge.json`，输入旁白文本、音色、语速。
- 分析能力：可接 `analyse_image.json`、`analyse_video.json` 做素材理解。
- 每个 workflow 在平台侧注册为 `workflow_key`，并声明参数 schema，避免前端直接依赖 ComfyUI 节点 ID。
- 任务状态映射：`pending/running/completed/failed/cancelled`；失败必须记录中文错误和原始 ComfyUI 错误摘要。

## 7. 前端页面

- `/`：作品广场，顶部分类、搜索、排序，主体作品瀑布流。
- `/create`：创作入口，选择“脚本成片 / 图片成片 / 模板复刻 / 空白项目”。
- `/workspace/:projectId`：三栏工作台：左侧项目结构，中间分镜/时间线，右侧参数面板与生成按钮。
- `/templates`：模板市场，展示示例封面、成片、适用场景、使用次数。
- `/works/:id`：作品详情，视频播放、描述、作者、模板来源、点赞收藏。
- `/users/:id`：作者主页，作品、模板、作者等级、关注按钮。
- `/admin/review`：发布审核队列，支持通过、驳回、下架。

## 8. 交付阶段

- 第 1 阶段：基础平台骨架。初始化 Next.js + FastAPI + PostgreSQL + Redis；完成中文 UI 框架、用户/项目/资产/任务基础模型；接入本地文件存储。
- 第 2 阶段：ComfyUI 生成闭环。实现 ComfyUI provider、workflow 注册、任务队列、任务进度查询；完成分镜图、镜头视频、TTS 三类生成。
- 第 3 阶段：创作工作台。完成脚本拆解、角色设定、分镜表格、单镜头重试、批量生成、成片合成和导出。
- 第 4 阶段：社区和模板。完成作品发布、广场、作品详情、作者主页、点赞收藏、模板市场、模板复刻。
- 第 5 阶段：审核与稳定性。加入发布审核、失败重试、任务取消、生成日志、后台管理、基础限流和存储清理。

## 9. 测试计划

- ComfyUI 健康检查：未启动时显示“ComfyUI 未连接”，启动后能读取系统状态。
- 生成任务：提交图像/视频/TTS 任务后，状态从 `pending` 到 `running` 到 `completed`，失败时返回中文错误。
- 工作台流程：脚本输入后能生成分镜，单个分镜可重试，批量生成不会阻塞页面。
- 合成导出：多镜头视频、字幕、配音、BGM 可合成最终 MP4，并生成可访问 URL。
- 社区流程：草稿作品不可见，审核通过后出现在作品广场；点赞、收藏、浏览计数正确。
- 模板复刻：从模板创建项目后，workflow、默认参数、示例提示词能正确带入。
- 权限测试：非作者不能编辑项目；未登录用户只能浏览公开作品。

## 10. 默认假设

- 首版按“平台社区优先”，但生成链路仍必须先跑通，否则社区内容无法生产。
- 本机 ComfyUI 作为默认生成后端，地址为 `http://127.0.0.1:8188`。
- 首版不做真实支付、积分消耗和商业分账，只预留字段；后续再接会员、点数、创作者收益。
- 用户可见内容全部使用简体中文，代码命名保持英文。
