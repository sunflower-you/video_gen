# 漫剧工坊

基于 ComfyUI 的中文短视频/漫剧制作平台 MVP。当前版本先完成“ComfyUI 外接闭环和平台骨架”：平台编排层、工作流注册、任务状态、输出归档、中文错误、一个可直接打开的静态前端原型，以及 Next.js + TypeScript + Tailwind 的生产前端组件化路由初版。

## 运行方式

- 前端原型：可直接在浏览器打开 `frontend/index.html`，也可由 FastAPI 默认托管为 `/`；若后端 API 正在运行，作品广场会读取已发布作品并支持短片剧集、动画短片、概念设计、经典衍生、AI 漫剧、广告短片和精选画布分类筛选、排序、详情视频播放、模板来源展示、点赞/收藏和作者主页，模板市场会读取真实模板，展示分类、适用场景、示例输入、默认参数、成片示例和使用次数，并支持模板复刻创建项目，创作工作台会展示项目草稿列表并可恢复已有项目，创作表单支持脚本成片、图片成片、模板复刻和空白项目；脚本成片会拆解多分镜，图片成片会基于画面描述和参考图 URL 生成单镜头草稿，空白项目可先保存草稿后手动新增分镜。角色设定和分镜旁白/画面提示词可编辑保存，分镜列表可手动新增分镜并创建、提交单镜头图像、镜头视频和旁白配音任务，同步任务进度并展示任务日志，工作台可批量创建分镜图/旁白配音任务并查看项目任务队列，队列中可同步运行中任务、取消运行任务并重试失败/已取消任务，时间线与字幕面板可按分镜生成剪辑草稿、编辑字幕并导出 SRT 字幕文件，项目素材库会展示和删除已归档素材，工作台可创建并提交成片合成任务、刷新导出状态并预览成片，然后填写发布标题、分类、标签、封面和简介后提交发布审核，发布审核区会展示平台健康、运营概览、清理孤儿素材文件、读取待审核作品并提交通过/驳回/下架操作。
- Next 前端：`frontend-next/` 使用 Next.js App Router、TypeScript 和 Tailwind CSS，首屏直接呈现作品广场、创作工作台、模板市场、积分充值、账号令牌和发布审核，不做营销页。该目录已拆分 `AppShell`、作品广场、作品详情、作者主页、创作工作台、独立项目工作台、模板市场、积分充值、账号令牌、发布审核等组件，并提供 `/create`、`/workspace/[projectId]`、`/templates`、`/billing`、`/account`、`/account/oauth/callback`、`/works/[id]`、`/users/[id]`、`/admin/review` 核心路由；作品广场卡片展示封面、成片标记、模板来源、标签和互动计数，并已将分类筛选、关键词搜索和排序接入 `/api/works` 查询参数，首页工作台已接入项目草稿列表、快速创建空白项目和项目工作台跳转，首页发布导出区会读取当前用户最近项目，并提供合成、字幕导出、提交审核和审核队列导航，无项目时回到创建入口；`/create` 已接入项目创建、脚本分析、图片成片参考图、空白项目创建、模板列表读取、模板选择、目标画幅、分镜图生成、批量生成、时间线和合成任务 API，`/workspace/[projectId]` 已接入项目详情、角色设定编辑、分镜、手动新增分镜、分镜修订、分镜删除、任务队列、素材库、素材删除、时间线、字幕编辑、字幕导出、生成任务提交/同步/取消/重试、成片合成和提交发布审核 API，`/templates` 已接入模板列表接口并支持模板复刻创建项目，复刻时可填写项目标题和目标画幅，模板卡片展示适用场景、默认参数、示例输入、封面、成片示例和使用次数，`/works/[id]` 已接入作品详情、视频预览、点赞和收藏接口，`/users/[id]` 已接入作者聚合主页和关注接口，`/admin/review` 已接入未发布作品队列、作品审核通过/驳回/下架、待审核提现队列、打款通知待处理队列、提现通过/驳回、打款通知重试、运营概览、部署自检、平台健康、存储读写探针、工作流注册表探针、支付回调探针、告警 Webhook 探针、打款 Webhook 探针、存储清理和运行中任务同步 API，`/billing` 已接入积分账户、支付订单、支付收银台入口、会员订阅、创作者提现、运营提现审核、运营积分调账和作品收益分账 API，`/account` 已接入注册、登录、第三方登录发起、第三方登录回调保存会话、会话刷新和本地令牌管理；类型化 API client 会统一透传 `platform_api_token`、`platform_user_session` 和当前用户 ID。`frontend-next/package-lock.json` 固定前端依赖版本，可通过根目录 `npm run check:next` 执行 TypeScript 检查、Next 生产构建和运行时 smoke。
- 后端 API：安装依赖后运行 `uvicorn app.backend.api:app --reload`。Next 前端独立运行时会通过 `PLATFORM_API_BASE_URL` 将 `/api/*` 和 `/storage/*` 代理到 FastAPI，默认目标为 `http://127.0.0.1:8000`。
- ComfyUI 地址：默认 `http://127.0.0.1:8188`，可通过 `COMFYUI_BASE_URL` 覆盖；若内网代理需要鉴权，可设置 `COMFYUI_API_KEY`，平台会以 `Authorization: Bearer <key>` 调用 ComfyUI。
- 平台数据：默认保存到 `storage/platform-data.json`，可通过 `PLATFORM_DATA_PATH` 覆盖；生产可设置 `PLATFORM_REPOSITORY_DRIVER=postgres`、`PLATFORM_DATABASE_URL` 和 `PLATFORM_DATABASE_TABLE` 使用 PostgreSQL JSONB 仓储、关系投影表和高频查询索引。安装可选依赖可使用 `pip install -e ".[postgres]"`。
- 归档存储：默认使用 `storage/`，可通过 `PLATFORM_STORAGE_ROOT` 覆盖；同步 ComfyUI history 时默认从 `${PLATFORM_STORAGE_ROOT}/comfy-output` 读取输出，也可通过 `COMFYUI_OUTPUT_ROOT` 指向真实 ComfyUI 输出目录。若本地输出目录缺文件且 history 输出路径合法，平台会通过 ComfyUI `/view` 下载远端输出后再归档，适合 ComfyUI 与平台不共享磁盘的部署。本地模式可设置 `PLATFORM_STORAGE_PUBLIC_BASE_URL` 生成 CDN 风格公开 URL；生产可设置 `PLATFORM_STORAGE_DRIVER=s3` 启用 S3/OSS/COS/MinIO 兼容上传，同时保留本地 `local_path` 供同步、清理和审计。对象存储配置包括 `PLATFORM_S3_VENDOR`、`PLATFORM_S3_ENDPOINT_URL`、`PLATFORM_S3_BUCKET`、`PLATFORM_S3_ACCESS_KEY`、`PLATFORM_S3_SECRET_KEY`、`PLATFORM_S3_REGION`、`PLATFORM_S3_PREFIX`、`PLATFORM_S3_PUBLIC_BASE_URL`、`PLATFORM_S3_FORCE_PATH_STYLE`、`PLATFORM_S3_UPLOAD_TIMEOUT_SECONDS` 和 `PLATFORM_S3_ALLOW_INSECURE_ENDPOINT`；除 MinIO 或显式允许外，生产 endpoint 需要使用 HTTPS。运营后台可通过 `/api/admin/storage/probe` 写入一个极小探针文件并清理本地归档副本；S3 模式会同时尝试 DELETE 清理远端探针对象。
- 工作流注册：默认递归读取 `workflows/**/*.registry.json`，可通过 `WORKFLOW_REGISTRY_PATH` 指定目录或单个注册文件；目录为空时回退到内置默认工作流。内置注册表包含 `platform/script_analysis`、`selfhost/image_flux`、`selfhost/video_wan2.1_fusionx`、`selfhost/tts_edge` 和 `platform/compose`。运营后台可通过 `/api/admin/workflows/probe` 校验注册表 schema、adapter 输出节点映射、生成类型覆盖和 ComfyUI 提交 payload 构建，适合上线前发现 workflow 文件缺失、参数不匹配或输出节点漏配。
- ComfyUI 插件：仓库内 `comfyui_plugin/video_gen_platform_nodes` 提供可安装到 ComfyUI `custom_nodes` 的基础插件包，包含“平台业务输入、平台镜头输入、平台配音输入、平台合成清单、平台归档回调”节点，用于承接平台业务参数和回调平台同步/归档接口。可先运行 `python -m comfyui_plugin.installer --check` 校验节点包，再运行 `python -m comfyui_plugin.installer --comfyui-root /path/to/ComfyUI --force` 安装到 `custom_nodes/video_gen_platform_nodes`。
- API 限流：默认关闭；设置 `PLATFORM_RATE_LIMIT_PER_MINUTE` 为正整数后，会对 `/api/*` 按客户端 IP 做分钟级限流，超限返回“请求过于频繁，请稍后重试。”。
- API 访问令牌：默认关闭；设置 `PLATFORM_API_TOKEN` 后，写接口和 `/api/admin/*` 后台接口必须带 `Authorization: Bearer <token>`，否则返回中文鉴权错误。静态前端会从浏览器 `localStorage.platform_api_token` 读取令牌并自动透传。
- 账号与会话：默认关闭；设置 `PLATFORM_SESSION_SECRET` 后，可通过 `POST /api/auth/register` 注册账号、`POST /api/auth/login` 密码登录、`POST /api/auth/session/refresh` 刷新会话，前端会把返回的 token 保存到 `localStorage.platform_user_session` 并作为 `X-User-Session` 透传。`POST /api/auth/session` 仍保留为开发期按用户 ID 签发会话的过渡入口，`GET /api/auth/session/me` 可校验当前会话。可通过 `PLATFORM_SESSION_TTL_SECONDS` 配置会话有效期。常见创作、任务、互动、发布和后台审核接口已支持在缺少 `user_id` 或 `owner_id` 时从会话补齐身份；若请求体或 query 中显式用户与会话用户不一致，API 会拒绝请求。
- 第三方登录：提供通用 OAuth/OIDC 入口 `GET /api/auth/oauth/{provider}/start` 和 `GET /api/auth/oauth/{provider}/callback`，Next `/account` 页面可输入渠道并发起授权跳转，`/account/oauth/callback` 会保存后端签发的平台会话。以 `github` 为例，需要配置 `PLATFORM_OAUTH_GITHUB_AUTHORIZE_URL`、`PLATFORM_OAUTH_GITHUB_TOKEN_URL`、`PLATFORM_OAUTH_GITHUB_USERINFO_URL`、`PLATFORM_OAUTH_GITHUB_CLIENT_ID`、`PLATFORM_OAUTH_GITHUB_CLIENT_SECRET`、`PLATFORM_OAUTH_GITHUB_REDIRECT_URI` 和可选 `PLATFORM_OAUTH_GITHUB_SCOPE`。平台会校验签名 state、防止 CSRF，并把第三方用户映射为平台用户后签发 `X-User-Session` 会话。
- 积分账本：平台内置用户积分账户，新用户默认获得初始积分；生成任务提交到 ComfyUI 前会按任务类型预检余额，提交成功后扣除积分并写入流水。运营账号可通过后台接口调整积分，也可为已发布作品记录收益分账；用户可创建支付订单，后端可通过 `PLATFORM_PAYMENT_CHECKOUT_URL_TEMPLATE` 或 `PLATFORM_PAYMENT_{CHANNEL}_CHECKOUT_URL_TEMPLATE` 生成渠道收银台链接，订单返回 `checkout_url` 时前端会展示收银台入口，第三方支付渠道通过 HMAC 签名 Webhook 确认支付后幂等入账积分；运营后台可通过 `/api/admin/billing/payment-webhook/probe` 创建小额测试订单并使用同一套签名确认路径验证支付回调入账链路；用户可用积分开通会员订阅，也可提交提现申请冻结积分，运营审核通过后可通过 `PLATFORM_PAYOUT_WEBHOOK_URL` 通知外部打款系统并记录回执、失败原因和渠道流水号，驳回时自动退回冻结积分。运营后台可通过 `/api/admin/billing/payout-webhook/probe` 构造无资金变动的测试提现 payload，验证打款 Webhook 签名、渠道 payload 和回执 ID 解析。真实微信/支付宝/Stripe 账号和提现打款渠道仍作为后续外部平台联调。
- 任务队列：默认 `PLATFORM_TASK_QUEUE_DRIVER=inline`，提交任务时同步调用 ComfyUI；设置 `PLATFORM_TASK_QUEUE_DRIVER=arq`、`PLATFORM_REDIS_URL` 和 `PLATFORM_TASK_QUEUE_NAME` 后，`POST /api/tasks/{task_id}/submit` 会先投递到 Redis/arq 队列并记录“任务已加入后台队列。”事件。安装可选依赖可使用 `pip install -e ".[queue]"`，常驻 worker 命令为 `arq app.backend.worker.WorkerSettings`。
- 部署模板：`deploy/docker-compose.yml` 提供 API、arq worker、巡检 worker、Redis 和 PostgreSQL 的组合示例；`deploy/systemd/` 提供 API、arq worker、巡检 worker timer 的 systemd 单元；`deploy/env.example` 汇总生产环境变量。仓库根目录 `Dockerfile` 会安装 `queue/postgres` 可选依赖，供 API 和 worker 共用镜像。
- 监控与告警：`GET /api/metrics` 返回 Prometheus 文本指标，包含 ComfyUI 连接、队列长度、项目/任务/素材/作品计数、待审核、存储占用、缺失素材和状态分布；设置 `PLATFORM_API_TOKEN` 后该端点也需要访问令牌。worker 支持 `--notify-alerts` 主动推送健康检查告警，可配置 `PLATFORM_ALERT_WEBHOOK_URL`、`PLATFORM_ALERT_WEBHOOK_SECRET`、`PLATFORM_ALERT_CHANNEL`、`PLATFORM_ALERT_TIMEOUT_SECONDS`、`PLATFORM_ALERT_COOLDOWN_SECONDS` 和 `PLATFORM_ALERT_STATE_PATH`，`PLATFORM_ALERT_CHANNEL` 支持 `generic`、`feishu`/`lark`、`dingtalk`、`slack` Webhook payload；有 secret 时会在 `X-Video-Gen-Signature` 中写入 HMAC-SHA256 签名；同一组告警在冷却窗口内会基于指纹跳过重复通知。运营后台可通过 `/api/admin/alerts/probe` 发送一条唯一测试告警，验证机器人地址、渠道 payload 和签名配置。
- 前端托管和跨域：默认会把仓库内 `frontend/` 托管到 `/`；可通过 `PLATFORM_FRONTEND_DIR` 指向其他构建目录，通过 `PLATFORM_ENABLE_STATIC_FRONTEND=false` 关闭静态托管，通过 `PLATFORM_CORS_ORIGINS=https://example.com,https://studio.example` 配置允许跨域访问 API 的前端域名。

## 已实现接口

- `GET /api/comfy/status`：检查 ComfyUI 连接、队列和系统信息。
- `GET /api/health`：平台健康检查，汇总 ComfyUI、失败任务、缺失素材和待审核积压。
- `GET /api/metrics`：Prometheus 文本指标，用于部署后监控 ComfyUI 连接、队列、任务状态、审核积压和存储风险。
- `GET /api/workflows`：读取平台注册的 ComfyUI 工作流。
- `POST /api/auth/register` / `POST /api/auth/login` / `POST /api/auth/session/refresh` / `GET /api/auth/session/me`：注册账号、密码登录、刷新和校验轻量会话令牌，需要配置 `PLATFORM_SESSION_SECRET`；密码使用 PBKDF2 摘要存储，不在 API 响应中返回。
- `POST /api/auth/session`：开发期按用户 ID 签发轻量会话令牌的过渡入口。
- `GET /api/auth/oauth/{provider}/start` / `GET /api/auth/oauth/{provider}/callback`：通用 OAuth/OIDC 第三方登录入口，完成授权码换取用户信息后签发平台会话。
- `GET /api/billing/account`：查询当前用户积分余额和最近流水；启用会话后可直接从 `X-User-Session` 识别用户。
- `POST /api/billing/payment-orders`：创建积分充值支付订单，记录渠道、金额、积分、币种和可选 checkout URL；可通过通用或渠道专用 checkout URL 模板生成收银台入口。
- `POST /api/billing/payment-webhook/{channel}`：第三方支付回调入口，使用 `PLATFORM_PAYMENT_WEBHOOK_SECRET` 对请求体做 HMAC-SHA256 签名校验，支付成功后幂等给订单用户入账积分。
- `GET /api/billing/subscriptions` / `POST /api/billing/subscriptions`：查询和开通会员订阅，开通时从积分账户扣费并写入流水。
- `GET /api/billing/withdrawals` / `POST /api/billing/withdrawals`：查询和提交创作者提现申请，申请时冻结积分并进入待审核状态。
- `POST /api/admin/billing/credits`：运营账号为目标用户充值、扣减或修正积分，并写入审计流水。
- `POST /api/admin/billing/works/{work_id}/revenue`：运营账号为已发布作品记录收益，按 70% 作者收益和 30% 平台收益拆分。
- `POST /api/admin/billing/payment-webhook/probe`：运营账号创建小额测试支付订单，生成平台签名并走真实支付回调确认逻辑，用于验证支付密钥、签名和入账链路。
- `POST /api/admin/billing/withdrawals/{withdrawal_id}/review`：运营账号审核提现申请，通过时记录打款回执；若配置 `PLATFORM_PAYOUT_WEBHOOK_URL`，会向外部打款系统发送签名 Webhook，并把通知状态、失败原因和渠道流水号写回提现记录；驳回时自动退回冻结积分。
- `POST /api/admin/billing/withdrawals/{withdrawal_id}/retry-payout`：运营账号重试已通过提现的外部打款通知，适用于 `payout_dispatch_status=failed` 或 `not_configured` 的待处理记录。
- `POST /api/admin/billing/payout-webhook/probe`：运营账号发送一条无资金变动的打款 Webhook 探针，用于验证打款系统地址、签名、渠道 payload 和回执解析。
- `POST /api/projects`：创建项目，支持从模板复刻工作流和默认参数；后续分镜图、镜头视频或配音生成会继承匹配类型的模板参数，并允许请求参数覆盖。
- `GET /api/projects` / `GET /api/projects/{project_id}`：查询项目列表和详情。
- `GET /api/projects/{project_id}/assets`：查询项目素材库，聚合分镜图、镜头视频、音频、字幕和成片等已归档素材。
- `DELETE /api/projects/{project_id}/assets/{asset_id}`：删除项目归档素材，清理任务/分镜引用和本地存储文件。
- `GET /api/projects/{project_id}/tasks`：查询项目任务队列，包含任务状态、进度和事件日志，支持 `status=pending/running/completed/failed/cancelled` 筛选。
- `GET /storage/{path}`：开发期读取本地归档素材，只允许访问平台存储根目录内的文件。
- `POST /api/projects/{project_id}/script/analyze`：分析脚本，生成角色和分镜草稿，并记录一个已完成的 `script_analysis` 任务用于队列追踪。
- `PATCH /api/projects/{project_id}/characters/{character_id}`：更新项目角色名称、设定和统一风格提示词。
- `POST /api/projects/{project_id}/shots`：手动新增分镜，适合空白项目或补充分镜。
- `PATCH /api/projects/{project_id}/shots/{shot_id}`：更新分镜旁白、画面描述、提示词和角色；更新后会清空旧时间线，避免字幕与分镜不一致。
- `DELETE /api/projects/{project_id}/shots/{shot_id}`：删除分镜，清理该分镜任务、素材和时间线草稿。
- `POST /api/projects/{project_id}/shots/{shot_id}/generate-image`：为单个分镜创建图像生成任务。
- `POST /api/projects/{project_id}/shots/{shot_id}/generate-video`：为单个分镜创建镜头视频生成任务。
- `POST /api/projects/{project_id}/shots/{shot_id}/generate-tts`：为单个分镜创建旁白配音任务。
- `POST /api/projects/{project_id}/batch-generate`：为全部分镜批量创建分镜图或旁白配音任务；传入 `submit: true` 时会立即提交到 ComfyUI。
- `POST /api/projects/{project_id}/timeline/build`：按分镜顺序生成时间线草稿和字幕 cue，绑定已归档的镜头视频与配音素材。
- `PATCH /api/projects/{project_id}/subtitles/{subtitle_id}`：编辑字幕文本和起止时间。
- `POST /api/projects/{project_id}/subtitles/export`：导出项目 SRT 字幕文件并归档为字幕素材。
- `POST /api/projects/{project_id}/compose`：创建字幕、配音、BGM 和镜头素材合成任务；前端会提交任务并在任务队列同步归档。
- `POST /api/tasks`：根据 `workflow_key` 和业务参数创建生成任务，必须传入 `user_id`。
- `GET /api/tasks/{task_id}`：查询任务状态，必须传入 `user_id`；项目任务只允许项目作者查看，独立任务只允许创建者或运营角色查看。
- `POST /api/tasks/{task_id}/submit`：把任务提交到 ComfyUI，必须传入 `user_id`；平台只接受已创建任务的业务载荷校验，实际使用任务的 `workflow_key` 和业务参数构造提交载荷，拒绝直接提交 ComfyUI 节点图。
- `POST /api/tasks/{task_id}/cancel`：取消待处理或运行中的任务，必须传入 `user_id`。
- `POST /api/tasks/{task_id}/retry`：将失败或已取消的任务重置为可重试状态，必须传入 `user_id`。
- `POST /api/comfy/tasks/{task_id}/sync`：同步 ComfyUI 任务状态，必须传入 `user_id`。
- `GET /api/templates`：读取可复刻模板市场，返回封面、成片示例、适用场景、示例输入、默认参数和使用次数；`platform/script_analysis` 等内部编排 workflow 只保留在 `/api/workflows` 和后台注册表探针中，不作为项目模板复刻。
- `GET /api/users/{user_id}`：作者主页，聚合公开作品、模板、点赞、收藏、浏览和粉丝统计。
- `GET /api/admin/overview`：后台运营概览，统计项目、任务、素材、存储占用、待审核和最近失败任务，`user_id` 需要具备 `admin/operator/reviewer` 角色。
- `GET /api/admin/runtime-config`：后台部署自检，脱敏返回 ComfyUI、ComfyUI 平台插件、工作流注册表、仓储、存储、队列、鉴权、告警、支付、打款和前端托管配置状态，并给出生产就绪检查项、阻塞项和警告项；`user_id` 需要具备 `admin/operator/reviewer` 角色。
- `POST /api/admin/workflows/probe`：运营账号执行工作流注册表探针，验证注册表参数 schema、adapter 输出节点、生成类型覆盖和 ComfyUI 提交 payload 构建；`operator_id` 需要具备 `admin/operator/reviewer` 角色。
- `POST /api/admin/alerts/probe`：运营账号发送一条告警 Webhook 探针，用于验证告警机器人地址、渠道格式和签名配置。
- `POST /api/admin/comfyui/plugin/install`：后台安装平台 ComfyUI 自定义节点插件到 `COMFYUI_ROOT/custom_nodes/video_gen_platform_nodes`，支持 `force` 覆盖安装，`operator_id` 需要具备 `admin/operator/reviewer` 角色。
- `POST /api/works/{project_id}/publish`：提交作品进入待审核；必须已有成片导出，或显式传入 `video_url`。
- `POST /api/admin/review/{work_id}`：运营账号审核通过、驳回或下架作品，`user_id` 需要具备 `admin/operator/reviewer` 角色。
- `POST /api/admin/storage/probe`：运营账号执行一次存储读写探针，验证本地归档写入、S3 兼容上传和探针清理链路。
- `POST /api/admin/storage/cleanup`：运营账号清理 `storage/assets` 下未被素材记录引用的孤儿文件，支持 `dry_run` 预检并返回缺失素材列表。
- `POST /api/admin/tasks/sync-running`：运营账号批量同步运行中的 ComfyUI 任务，支持 `dry_run` 预检和 `limit` 数量限制，用于 Redis/arq 接入前的人工巡检或定时任务。
- `GET /api/works`：作品广场，默认展示已发布内容，支持 `category`、`keyword` 和 `sort_by`；`include_unpublished=true` 仅允许运营/审核账号查看审核队列。
- `GET /api/works/{work_id}`：公开作品详情，读取时递增浏览计数，待审核作品不可见。
- `POST /api/interactions`：点赞、收藏和关注类互动。

创建项目必须传入 `owner_id`，或在启用 `PLATFORM_SESSION_SECRET` 后通过 `X-User-Session` 自动补齐；项目草稿列表需要按 `owner_id` 查询，也可使用会话身份；项目详情、素材库、任务队列以及编辑、生成、合成、任务控制、互动、发布和审核接口必须传入 `user_id`，常见接口已支持从会话补齐身份并拦截用户冒用。未传入创建作者时返回“请先登录后再创建项目。”；未传入编辑用户时返回“请先登录后再编辑项目。”；未传入任务用户时返回“请先登录后再操作任务。”；未传入互动用户时返回“请先登录后再互动作品。”；传入用户不是项目作者时返回“非作者不能编辑项目。”。未登录用户只能浏览公开作品、模板和作者主页等公开内容。生产部署可先用 `PLATFORM_API_TOKEN` 对写接口和后台接口做统一入口保护，再逐步把业务接口迁移到 `X-User-Session` 会话鉴权。

任务会记录事件日志，包括创建、积分扣除、入队、提交、同步、失败、取消、重试和输出归档，`GET /api/tasks/{task_id}` 会返回 `events` 便于追踪生成过程。任务同步完成后会解析 ComfyUI history 中的 `outputs`，按照工作流输出节点映射把文件归档为平台 `Asset`，并写入 MIME、hash、图片尺寸和音视频时长等素材元数据。默认从 `storage/comfy-output/{type}/{subfolder}/{filename}` 读取 ComfyUI 输出文件；普通缺文件时会尝试通过 ComfyUI `/view` 下载远端输出，路径不合法或下载仍失败时任务会进入 `failed`，并返回中文错误“ComfyUI 输出文件未找到。”。平台合成任务会使用 `platform/compose` 注册表，输入参数包含 `timeline` 和 `subtitles`，最终视频归档后会回写项目 `final_video_url`，发布审核默认带入该成片地址。若启用 S3/OSS 兼容存储，归档文件会先保存本地审计副本，再通过 AWS SigV4 PUT 上传到配置的 bucket/prefix，回写给项目和作品的成片/封面 URL 使用对象存储公开域名。运营账号可通过 `/api/admin/tasks/sync-running` 批量巡检运行中任务，也可用 `python -m app.backend.worker --user-id system_admin --sync-running --cleanup-storage --notify-alerts --limit 20` 交给 cron/systemd 定时执行；启用 arq 后，`submit_generation_task` worker 函数会执行队列中的 ComfyUI 提交任务，`worker_runtime_config()` 可用于部署自检当前队列驱动、Redis 地址和 worker 入口。

当前 MVP 默认使用 JSON 文件仓储持久化项目、脚本、角色、分镜、字幕、时间线、任务、资产、模板、作品和互动数据；也可切换到 PostgreSQL JSONB 仓储，服务层接口保持不变。PostgreSQL 模式会在主表中按 `collection + item_id` 存储各业务实体 payload，并同步维护 `{PLATFORM_DATABASE_TABLE}_relations` 关系投影表与 GIN/表达式索引，覆盖项目作者、任务项目/状态、作品审核/分类、模板 workflow、互动目标、素材来源任务等高频查询入口。

脚本拆解、角色描述、分镜画面提示词、手动分镜默认提示词和负面提示词集中在 `app/backend/generation_config.py` 管理，页面组件和服务流程只引用这些模板函数，避免生成策略散落。

工作流注册文件需要声明 `workflow_key`、`generation_type`、业务化 `input_schema`、默认参数、适用场景和 ComfyUI 输出节点映射，并指向可审计的工作流 JSON。平台前端和 API 只使用这些业务字段，不直接依赖或提交 ComfyUI 节点图细节。

`comfyui_plugin/video_gen_platform_nodes` 是首个 ComfyUI 自定义节点包：`PlatformBusinessInput` 承接通用平台业务输入，`PlatformShotInput` 规范化分镜图/视频字段，`PlatformTtsInput` 规范化配音字段，`PlatformComposeManifest` 校验时间线和字幕合成清单，`PlatformArchiveCallback` 可从 ComfyUI workflow 内调用平台同步接口。后续可继续把具体模型适配、字幕烧录和素材归档能力沉淀为更多节点。

插件安装辅助命令：

```bash
python -m comfyui_plugin.installer --check
python -m comfyui_plugin.installer --comfyui-root /path/to/ComfyUI --force
```

## 测试

```bash
npm run check
```

Next.js 生产前端构建校验：

```bash
npm install --prefix frontend-next
npm run check:next
```

该命令会运行：

- Python 后端核心单元测试。
- Python 模块编译检查。
- Node 前端结构测试，包括静态前端和 Next.js 组件化路由。
- Next 运行时 smoke 联调：临时启动 API 兼容测试服务和 Next，验证 `/api/*` 代理、项目创建/读取、模板复刻、OAuth、支付订单、会员订阅、提现申请、后台提现队列、打款通知重试、支付回调探针、告警 Webhook 探针、打款 Webhook 探针、工作流注册表探针、部署自检、存储读写探针、作品查询参数和核心页面可访问。
