import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const backendPort = Number(process.env.NEXT_SMOKE_BACKEND_PORT || 8128);
const frontendPort = Number(process.env.NEXT_SMOKE_FRONTEND_PORT || 3128);
const backendUrl = `http://127.0.0.1:${backendPort}`;
const frontendUrl = `http://127.0.0.1:${frontendPort}`;
const children = [];
const projects = [];
const workRequests = [];
const oauthStartRequests = [];
const paymentOrderRequests = [];
const subscriptionRequests = [];
const withdrawalRequests = [];
const payoutRetryRequests = [];
const paymentWebhookProbeRequests = [];
const alertProbeRequests = [];
const payoutWebhookProbeRequests = [];
const workflowProbeRequests = [];
const works = [
  { id: "work_a", title: "雨夜重逢", category: "AI 漫剧", author_id: "runtime_author", tags: ["雨夜"], view_count: 12, like_count: 5, favorite_count: 1 },
  { id: "work_b", title: "赛博街区", category: "概念设计", author_id: "runtime_author", tags: ["赛博"], view_count: 30, like_count: 2, favorite_count: 8 }
];

function startProcess(command, args, options) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...options.env },
    windowsHide: true,
    detached: process.platform !== "win32"
  });
  child.output = "";
  child.stdout.on("data", (chunk) => {
    child.output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    child.output += chunk.toString();
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (!child.expectedExit && code !== null && code !== 0) {
      process.stderr.write(`${command} ${args.join(" ")} 退出：${code || signal}\n${child.output}\n`);
    }
  });
  return child;
}

function waitForExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function closeServer(server, timeoutMs = 2_000) {
  server.closeAllConnections?.();
  server.closeIdleConnections?.();
  return Promise.race([
    new Promise((resolve) => server.close(resolve)),
    new Promise((resolve) => setTimeout(resolve, timeoutMs))
  ]);
}

function stopProcess(child, signal) {
  try {
    if (process.platform === "win32") {
      child.kill(signal);
    } else {
      process.kill(-child.pid, signal);
    }
  } catch {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

async function waitFor(url, label) {
  const startedAt = Date.now();
  let lastError = "";
  while (Date.now() - startedAt < 30_000) {
    try {
      const response = await fetchWithTimeout(url, {}, 3_000);
      if (response.ok) return response;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} 未在 30 秒内就绪：${lastError}`);
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, init) {
  const response = await fetchWithTimeout(url, init);
  const data = await response.json().catch(() => ({}));
  assert.equal(response.ok, true, `${url} 请求失败：${response.status} ${JSON.stringify(data)}`);
  return data;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function startApiServer() {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || "/", backendUrl);
    if (request.method === "GET" && url.pathname === "/api/templates") {
      sendJson(response, 200, []);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/auth/oauth/github/start") {
      oauthStartRequests.push({ nextUrl: url.searchParams.get("next_url") || "" });
      sendJson(response, 200, {
        authorization_url: "https://github.example.com/oauth/authorize?client_id=runtime",
        state: "runtime-state"
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/billing/payment-orders") {
      const payload = await readJson(request);
      paymentOrderRequests.push(payload);
      sendJson(response, 200, {
        id: `pay_runtime_${paymentOrderRequests.length}`,
        user_id: "runtime_smoke_user",
        channel: String(payload.channel || "stripe"),
        amount_cents: Number(payload.amount_cents || 0),
        credits: Number(payload.credits || 0),
        currency: String(payload.currency || "CNY"),
        status: "pending",
        checkout_url: "https://pay.example.com/checkout/pay_runtime_1",
        provider_order_id: "",
        created_at: "2026-06-29T00:00:00Z",
        updated_at: "2026-06-29T00:00:00Z",
        paid_at: ""
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/billing/subscriptions") {
      sendJson(response, 200, []);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/billing/subscriptions") {
      const payload = await readJson(request);
      subscriptionRequests.push(payload);
      sendJson(response, 200, {
        id: `sub_runtime_${subscriptionRequests.length}`,
        user_id: "runtime_smoke_user",
        plan_code: String(payload.plan_code || "creator_pro"),
        plan_name: "创作者专业版",
        billing_cycle: String(payload.billing_cycle || "monthly"),
        credit_cost: 299,
        status: "active"
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/billing/withdrawals") {
      sendJson(response, 200, []);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/billing/withdrawals") {
      const payload = await readJson(request);
      withdrawalRequests.push(payload);
      sendJson(response, 200, {
        id: `withdrawal_runtime_${withdrawalRequests.length}`,
        user_id: "runtime_smoke_user",
        amount_credits: Number(payload.amount_credits || 0),
        payout_channel: String(payload.payout_channel || "manual"),
        payout_account: String(payload.payout_account || ""),
        status: "pending_review"
      });
      return;
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/admin/billing/withdrawals/") && url.pathname.endsWith("/review")) {
      const payload = await readJson(request);
      sendJson(response, 200, {
        id: url.pathname.split("/").at(-2),
        user_id: "runtime_smoke_user",
        amount_credits: 100,
        payout_channel: "alipay",
        payout_account: "creator@example.com",
        provider_payout_id: String(payload.provider_payout_id || ""),
        status: payload.action === "reject" ? "rejected" : "approved"
      });
      return;
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/admin/billing/withdrawals/") && url.pathname.endsWith("/retry-payout")) {
      const payload = await readJson(request);
      payoutRetryRequests.push({ id: url.pathname.split("/").at(-2), payload });
      sendJson(response, 200, {
        id: url.pathname.split("/").at(-2),
        user_id: "runtime_smoke_user",
        amount_credits: 100,
        payout_channel: "alipay",
        payout_account: "creator@example.com",
        payout_dispatch_status: "dispatched",
        payout_dispatch_message: "提现打款通知已发送。",
        status: "approved"
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/admin/billing/payment-webhook/probe") {
      const payload = await readJson(request);
      paymentWebhookProbeRequests.push(payload);
      sendJson(response, 200, {
        ok: true,
        channel: String(payload.channel || "stripe"),
        order_id: "payment_probe_runtime",
        external_order_id: "payment_probe_external_runtime",
        transaction_id: "credit_tx_runtime_probe",
        user_id: String(payload.operator_id || "system_admin"),
        credits: 1,
        amount_cents: 1,
        account_balance_after: 1001,
        signature_verified: true,
        message: "支付回调探针完成，测试订单已签名确认并入账。"
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/admin/alerts/probe") {
      const payload = await readJson(request);
      alertProbeRequests.push(payload);
      sendJson(response, 200, {
        ok: true,
        probe_id: "alert_probe_runtime",
        operator_id: String(payload.operator_id || "system_admin"),
        health_status: "degraded",
        delivered: true,
        skipped: false,
        alert_count: 1,
        status_code: 200,
        message: "告警通知已发送。"
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/admin/billing/payout-webhook/probe") {
      const payload = await readJson(request);
      payoutWebhookProbeRequests.push(payload);
      sendJson(response, 200, {
        ok: true,
        probe_id: "payout_probe_runtime",
        operator_id: String(payload.operator_id || "system_admin"),
        payout_channel: String(payload.payout_channel || "manual"),
        payout_account: String(payload.payout_account || "probe-system_admin"),
        amount_credits: Number(payload.amount_credits || 1),
        dispatched: true,
        skipped: false,
        status_code: 202,
        message: "测试打款系统已受理。",
        provider_payout_id: "provider_payout_runtime_probe"
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/admin/workflows/probe") {
      const payload = await readJson(request);
      workflowProbeRequests.push(payload);
      sendJson(response, 200, {
        ok: true,
        workflow_count: 5,
        covered_generation_types: ["compose", "image", "script_analysis", "tts", "video"],
        missing_generation_types: [],
        items: [
          {
            workflow_key: "selfhost/image_flux",
            display_name: "Flux 分镜图生成",
            generation_type: "image",
            workflow_path: "workflows/selfhost/image_flux.json",
            input_count: 5,
            output_nodes: ["image"],
            adapter_output_nodes: ["image"],
            payload_node_count: 3,
            ok: true,
            checks: ["参数 schema 已通过。", "输出节点映射已通过。", "ComfyUI 提交 payload 已构建。"],
            errors: []
          }
        ],
        message: "工作流注册表探针通过。"
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/admin/billing/withdrawals") {
      const status = url.searchParams.get("status") || "pending_review";
      const payoutStatus = url.searchParams.get("payout_status") || "";
      if (status === "approved" && payoutStatus === "failed") {
        sendJson(response, 200, [
          {
            id: "withdrawal_runtime_failed_payout",
            user_id: "runtime_smoke_user",
            amount_credits: 100,
            payout_channel: "alipay",
            payout_account: "creator@example.com",
            payout_dispatch_status: "failed",
            payout_dispatch_message: "提现打款通知失败：timeout",
            status: "approved"
          }
        ]);
        return;
      }
      if (status === "approved" && payoutStatus === "not_configured") {
        sendJson(response, 200, []);
        return;
      }
      sendJson(response, 200, [
        {
          id: "withdrawal_runtime_queued",
          user_id: "runtime_smoke_user",
          amount_credits: 100,
          payout_channel: "alipay",
          payout_account: "creator@example.com",
          payout_dispatch_status: "not_configured",
          status
        }
      ]);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/admin/runtime-config") {
      sendJson(response, 200, {
        comfyui: { base_url: "http://comfyui:8188", api_key_configured: true, output_root: "/data/comfy-output" },
        comfyui_plugin: { package_name: "video_gen_platform_nodes", root_configured: true, installed: true, entry_file_present: true, readme_present: true, target_dir: "/opt/ComfyUI/custom_nodes/video_gen_platform_nodes", installer_command: "python -m comfyui_plugin.installer --comfyui-root $COMFYUI_ROOT --force" },
        workflow_registry: { path: "workflows", loaded: true, workflow_count: 5, workflow_keys: ["platform/script_analysis", "selfhost/image_flux", "selfhost/video_wan2.1_fusionx", "selfhost/tts_edge", "platform/compose"], load_error: "" },
        repository: { driver: "postgres", postgres_enabled: true, database_url_configured: true, table_name: "video_gen_records" },
        storage: { driver: "s3", s3_enabled: true, s3_bucket_configured: true, s3_endpoint_configured: true, public_base_url_configured: true },
        queue: { driver: "arq", arq_enabled: true, queue_name: "video_gen" },
        security: { api_token_configured: true, session_secret_configured: true, rate_limit_per_minute: 120 },
        alerts: { webhook_configured: true, channel: "feishu", cooldown_seconds: 1800 },
        payments: { webhook_secret_configured: true, checkout_template_configured: true, stripe_checkout_template_configured: true },
        payouts: { webhook_configured: true, provider: "finance-system" },
        readiness: { production_ready: true, blocker_count: 0, warning_count: 0, checks: [] }
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/admin/comfyui/plugin/install") {
      const payload = await readJson(request);
      sendJson(response, 200, {
        plugin_name: "video_gen_platform_nodes",
        source_dir: "/repo/comfyui_plugin/video_gen_platform_nodes",
        target_dir: payload.comfyui_root ? `${payload.comfyui_root}/custom_nodes/video_gen_platform_nodes` : "/opt/ComfyUI/custom_nodes/video_gen_platform_nodes",
        installed: true,
        node_keys: ["PlatformBusinessInput", "PlatformArchiveCallback", "PlatformShotInput", "PlatformTtsInput", "PlatformComposeManifest"],
        message: "ComfyUI 插件已安装，请重启 ComfyUI 后生效。"
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/admin/storage/probe") {
      sendJson(response, 200, {
        ok: true,
        driver: "s3",
        probe_id: "storage_probe_runtime",
        bytes_written: 64,
        url: "https://cdn.example.com/video-gen/prod/assets/storage_probe_runtime/probe.txt",
        local_copy_removed: true,
        remote_copy_removed: true,
        message: "存储读写探针完成。"
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/projects") {
      const payload = await readJson(request);
      const project = {
        id: `proj_runtime_${projects.length + 1}`,
        title: String(payload.title || "运行时联调项目"),
        project_type: String(payload.project_type || "空白项目"),
        owner_id: String(payload.owner_id || "runtime_smoke_user"),
        template_id: String(payload.template_id || ""),
        current_step: "草稿",
        aspect_ratio: String(payload.aspect_ratio || "9:16"),
        characters: [],
        shots: [],
        subtitles: [],
        timeline: []
      };
      projects.unshift(project);
      sendJson(response, 200, project);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/projects") {
      const ownerId = url.searchParams.get("owner_id") || "";
      sendJson(response, 200, projects.filter((project) => !ownerId || project.owner_id === ownerId));
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/api/projects/")) {
      const projectId = decodeURIComponent(url.pathname.split("/").pop() || "");
      const project = projects.find((item) => item.id === projectId);
      sendJson(response, project ? 200 : 404, project || { detail: "未找到项目" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(response, 200, { status: "healthy", message: "运行时联调 API 已连接", alerts: [] });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/works") {
      workRequests.push({
        category: url.searchParams.get("category") || "",
        keyword: url.searchParams.get("keyword") || "",
        sortBy: url.searchParams.get("sort_by") || ""
      });
      let result = [...works];
      const category = url.searchParams.get("category") || "";
      const keyword = url.searchParams.get("keyword") || "";
      const sortBy = url.searchParams.get("sort_by") || "latest";
      if (category) result = result.filter((work) => work.category === category);
      if (keyword) result = result.filter((work) => `${work.title}${work.category}${work.tags.join("")}`.includes(keyword));
      if (sortBy === "most_viewed") result.sort((left, right) => right.view_count - left.view_count);
      if (sortBy === "most_liked") result.sort((left, right) => right.like_count - left.like_count);
      if (sortBy === "most_favorited") result.sort((left, right) => right.favorite_count - left.favorite_count);
      sendJson(response, 200, result);
      return;
    }
    sendJson(response, 404, { detail: "未找到测试接口" });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(backendPort, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

let apiServer;

try {
  console.log("启动 API 兼容测试服务...");
  apiServer = await startApiServer();
  await waitFor(`${backendUrl}/api/templates`, "API 测试服务");

  console.log("启动 Next 生产服务...");
  startProcess("npm", ["--prefix", "frontend-next", "run", "start", "--", "--hostname", "127.0.0.1", "--port", String(frontendPort)], {
    env: {
      PLATFORM_API_BASE_URL: backendUrl,
      PORT: String(frontendPort)
    }
  });
  await waitFor(frontendUrl, "Next");

  console.log("验证 Next /api 代理写入和读取...");
  const project = await fetchJson(`${frontendUrl}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "运行时联调项目",
      project_type: "空白项目",
      owner_id: "runtime_smoke_user"
    })
  });
  assert.match(project.id, /^proj_/);
  assert.equal(project.title, "运行时联调项目");

  const projects = await fetchJson(`${frontendUrl}/api/projects?owner_id=runtime_smoke_user`);
  assert.equal(projects[0].id, project.id);

  console.log("验证 Next /api 代理提交模板复刻参数...");
  const templateProject = await fetchJson(`${frontendUrl}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "运行时模板复刻",
      project_type: "模板复刻",
      aspect_ratio: "16:9",
      owner_id: "runtime_smoke_user",
      template_id: "selfhost/image_flux"
    })
  });
  assert.equal(templateProject.title, "运行时模板复刻");
  assert.equal(templateProject.project_type, "模板复刻");
  assert.equal(templateProject.aspect_ratio, "16:9");
  assert.equal(templateProject.template_id, "selfhost/image_flux");

  console.log("验证 Next /api 代理发起第三方登录...");
  const oauthStart = await fetchJson(`${frontendUrl}/api/auth/oauth/github/start?next_url=${encodeURIComponent("/account/oauth/callback")}`);
  assert.match(oauthStart.authorization_url, /github\.example\.com\/oauth\/authorize/);
  assert.deepEqual(oauthStartRequests.at(-1), { nextUrl: "/account/oauth/callback" });

  console.log("验证 Next /api 代理创建支付订单...");
  const paymentOrder = await fetchJson(`${frontendUrl}/api/billing/payment-orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channel: "stripe",
      credits: 500,
      amount_cents: 4500,
      currency: "CNY"
    })
  });
  assert.equal(paymentOrder.id, "pay_runtime_1");
  assert.equal(paymentOrder.checkout_url, "https://pay.example.com/checkout/pay_runtime_1");
  assert.deepEqual(paymentOrderRequests.at(-1), {
    channel: "stripe",
    credits: 500,
    amount_cents: 4500,
    currency: "CNY"
  });

  console.log("验证 Next /api 代理创建会员订阅和提现申请...");
  const subscription = await fetchJson(`${frontendUrl}/api/billing/subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      plan_code: "creator_pro",
      billing_cycle: "monthly"
    })
  });
  assert.equal(subscription.status, "active");
  assert.deepEqual(subscriptionRequests.at(-1), { plan_code: "creator_pro", billing_cycle: "monthly" });

  const withdrawal = await fetchJson(`${frontendUrl}/api/billing/withdrawals`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      amount_credits: 100,
      payout_channel: "alipay",
      payout_account: "creator@example.com"
    })
  });
  assert.equal(withdrawal.status, "pending_review");
  assert.deepEqual(withdrawalRequests.at(-1), {
    amount_credits: 100,
    payout_channel: "alipay",
    payout_account: "creator@example.com"
  });

  const retriedPayout = await fetchJson(`${frontendUrl}/api/admin/billing/withdrawals/withdrawal_runtime_failed_payout/retry-payout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operator_id: "system_admin" })
  });
  assert.equal(retriedPayout.payout_dispatch_status, "dispatched");
  assert.deepEqual(payoutRetryRequests.at(-1), {
    id: "withdrawal_runtime_failed_payout",
    payload: { operator_id: "system_admin" }
  });
  const paymentWebhookProbe = await fetchJson(`${frontendUrl}/api/admin/billing/payment-webhook/probe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operator_id: "system_admin", channel: "stripe" })
  });
  assert.equal(paymentWebhookProbe.ok, true);
  assert.equal(paymentWebhookProbe.signature_verified, true);
  assert.deepEqual(paymentWebhookProbeRequests.at(-1), { operator_id: "system_admin", channel: "stripe" });
  const alertProbe = await fetchJson(`${frontendUrl}/api/admin/alerts/probe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operator_id: "system_admin" })
  });
  assert.equal(alertProbe.ok, true);
  assert.equal(alertProbe.delivered, true);
  assert.deepEqual(alertProbeRequests.at(-1), { operator_id: "system_admin" });
  const payoutWebhookProbe = await fetchJson(`${frontendUrl}/api/admin/billing/payout-webhook/probe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operator_id: "system_admin", payout_channel: "manual", payout_account: "probe-system_admin" })
  });
  assert.equal(payoutWebhookProbe.ok, true);
  assert.equal(payoutWebhookProbe.dispatched, true);
  assert.deepEqual(payoutWebhookProbeRequests.at(-1), {
    operator_id: "system_admin",
    payout_channel: "manual",
    payout_account: "probe-system_admin"
  });
  const workflowProbe = await fetchJson(`${frontendUrl}/api/admin/workflows/probe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operator_id: "system_admin" })
  });
  assert.equal(workflowProbe.ok, true);
  assert.equal(workflowProbe.workflow_count, 5);
  assert.deepEqual(workflowProbeRequests.at(-1), { operator_id: "system_admin" });

  const runtimeConfig = await fetchJson(`${frontendUrl}/api/admin/runtime-config?user_id=system_admin`);
  assert.equal(runtimeConfig.queue.driver, "arq");
  assert.equal(runtimeConfig.comfyui_plugin.installed, true);
  assert.equal(runtimeConfig.workflow_registry.workflow_count, 5);
  assert.equal(runtimeConfig.payouts.webhook_configured, true);
  assert.equal(runtimeConfig.storage.driver, "s3");
  assert.equal(runtimeConfig.readiness.production_ready, true);
  const pluginInstall = await fetchJson(`${frontendUrl}/api/admin/comfyui/plugin/install`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operator_id: "system_admin", force: true })
  });
  assert.equal(pluginInstall.installed, true);
  assert.equal(pluginInstall.plugin_name, "video_gen_platform_nodes");
  const storageProbe = await fetchJson(`${frontendUrl}/api/admin/storage/probe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: "system_admin" })
  });
  assert.equal(storageProbe.ok, true);
  assert.equal(storageProbe.driver, "s3");
  assert.equal(storageProbe.remote_copy_removed, true);

  console.log("验证 Next /api 代理透传作品查询参数...");
  const filteredWorks = await fetchJson(`${frontendUrl}/api/works?category=${encodeURIComponent("AI 漫剧")}&keyword=${encodeURIComponent("雨夜")}&sort_by=most_liked`);
  assert.equal(filteredWorks.length, 1);
  assert.equal(filteredWorks[0].id, "work_a");
  assert.deepEqual(workRequests.at(-1), { category: "AI 漫剧", keyword: "雨夜", sortBy: "most_liked" });

  console.log("验证核心页面路由...");
  for (const route of ["/", "/create", "/templates", `/workspace/${project.id}`, "/billing", "/account", "/account/oauth/callback", "/admin/review"]) {
    const response = await fetchWithTimeout(`${frontendUrl}${route}`);
    const html = await response.text();
    assert.equal(response.ok, true, `${route} 页面返回 ${response.status}`);
    assert.match(html, /漫剧工坊|创作|模板|项目工作台|发布审核|积分|账号/);
  }
  console.log("Next 运行时 smoke 通过。");
} finally {
  for (const child of children.reverse()) {
    child.expectedExit = true;
    if (child.exitCode === null && child.signalCode === null) stopProcess(child, "SIGTERM");
  }
  await Promise.all(children.map((child) => waitForExit(child, 2_000)));
  for (const child of children.reverse()) {
    if (child.exitCode === null && child.signalCode === null) stopProcess(child, "SIGKILL");
  }
  if (apiServer) {
    await closeServer(apiServer);
  }
}
