export type Work = {
  id: string;
  title: string;
  author_id?: string;
  description?: string;
  cover_url?: string;
  video_url?: string;
  category: string;
  tags?: string[];
  template_id?: string;
  template_name?: string;
  status?: string;
  review_status?: string;
  view_count?: number;
  like_count?: number;
  favorite_count?: number;
  updated_at?: string;
};

export type Template = {
  id: string;
  name: string;
  category: string;
  workflow_key: string;
  description: string;
  cover_url?: string;
  sample_video_url?: string;
  parameter_schema?: Record<string, unknown>;
  default_params?: Record<string, unknown>;
  example_inputs?: Record<string, unknown>;
  applicable_scenarios?: string[];
  usage_count?: number;
};

export type Health = {
  status: "healthy" | "degraded" | "unhealthy";
  message: string;
  alerts: Array<{ level: string; message: string }>;
};

export type AdminOverview = {
  project_count: number;
  task_count: number;
  asset_count: number;
  work_count: number;
  pending_review_count: number;
  storage_total_bytes: number;
  missing_asset_count: number;
  missing_asset_ids: string[];
  missing_asset_reference_count: number;
  missing_asset_references: string[];
  project_status_counts: Record<string, number>;
  task_status_counts: Record<string, number>;
  asset_type_counts: Record<string, number>;
  latest_failed_tasks: Array<{
    id: string;
    task_type: string;
    workflow_key: string;
    prompt_id?: string;
    error_message?: string;
    retry_advice?: string;
    updated_at?: string;
  }>;
};

export type AdminRuntimeConfig = {
  comfyui: {
    base_url: string;
    api_key_configured: boolean;
    output_root: string;
  };
  comfyui_plugin: {
    package_name: string;
    root_configured: boolean;
    installed: boolean;
    entry_file_present: boolean;
    readme_present: boolean;
    target_dir: string;
    installer_command: string;
  };
  workflow_registry: {
    path: string;
    loaded: boolean;
    workflow_count: number;
    workflow_keys: string[];
    load_error: string;
  };
  repository: {
    driver: string;
    postgres_enabled: boolean;
    database_url_configured: boolean;
    table_name: string;
  };
  storage: {
    driver: string;
    s3_enabled: boolean;
    s3_bucket_configured: boolean;
    s3_endpoint_configured: boolean;
    public_base_url_configured: boolean;
  };
  queue: {
    driver: string;
    arq_enabled: boolean;
    queue_name: string;
  };
  security: {
    api_token_configured: boolean;
    session_secret_configured: boolean;
    rate_limit_per_minute: number;
  };
  alerts: {
    webhook_configured: boolean;
    channel: string;
    cooldown_seconds: number;
  };
  payments: {
    webhook_secret_configured: boolean;
    checkout_template_configured: boolean;
    stripe_checkout_template_configured: boolean;
  };
  payouts: {
    webhook_configured: boolean;
    provider: string;
  };
  readiness: {
    production_ready: boolean;
    blocker_count: number;
    warning_count: number;
    checks: Array<{
      id: string;
      label: string;
      status: "pass" | "warning" | "blocker";
      message: string;
    }>;
  };
};

export type ComfyUiPluginInstallReport = {
  plugin_name: string;
  source_dir: string;
  target_dir: string;
  installed: boolean;
  node_keys: string[];
  message: string;
};

export type StorageCleanupResult = {
  dry_run: boolean;
  scanned_file_count: number;
  orphan_file_count: number;
  deleted_file_count: number;
  deleted_bytes: number;
  missing_asset_count: number;
  missing_asset_reference_count: number;
  message: string;
};

export type StorageProbeResult = {
  ok: boolean;
  driver: string;
  probe_id: string;
  bytes_written: number;
  url: string;
  local_copy_removed: boolean;
  remote_copy_removed: boolean;
  message: string;
};

export type PaymentWebhookProbeResult = {
  ok: boolean;
  channel: string;
  order_id: string;
  external_order_id: string;
  transaction_id: string;
  user_id: string;
  credits: number;
  amount_cents: number;
  account_balance_after: number;
  signature_verified: boolean;
  message: string;
};

export type AlertProbeResult = {
  ok: boolean;
  probe_id: string;
  operator_id: string;
  health_status: string;
  delivered: boolean;
  skipped: boolean;
  alert_count: number;
  status_code: number;
  message: string;
};

export type PayoutWebhookProbeResult = {
  ok: boolean;
  probe_id: string;
  operator_id: string;
  payout_channel: string;
  payout_account: string;
  amount_credits: number;
  dispatched: boolean;
  skipped: boolean;
  status_code: number;
  message: string;
  provider_payout_id: string;
};

export type WorkflowRegistryProbeResult = {
  ok: boolean;
  workflow_count: number;
  covered_generation_types: string[];
  missing_generation_types: string[];
  items: Array<{
    workflow_key: string;
    display_name: string;
    generation_type: string;
    workflow_path: string;
    input_count: number;
    output_nodes: string[];
    adapter_output_nodes: string[];
    payload_node_count: number;
    ok: boolean;
    checks: string[];
    errors: string[];
  }>;
  message: string;
};

export type RunningTaskSyncResult = {
  dry_run: boolean;
  candidate_count: number;
  synced_count: number;
  status_counts: Record<string, number>;
  tasks: GenerationTask[];
  message: string;
};

export type StoryboardShot = {
  id: string;
  index: number;
  narration: string;
  visual_description: string;
  shot_size?: string;
  characters?: string[];
  prompt?: string;
  negative_prompt?: string;
  generation_status?: string;
};

export type Character = {
  id: string;
  name: string;
  description: string;
  reference_image_url?: string;
  style_prompt?: string;
};

export type SubtitleCue = {
  id: string;
  index: number;
  start_seconds: number;
  end_seconds: number;
  text: string;
  style?: string;
};

export type TimelineItem = {
  id: string;
  index: number;
  shot_id: string;
  start_seconds: number;
  end_seconds: number;
  video_asset_id?: string;
  audio_asset_id?: string;
  subtitle_id?: string;
  transition?: string;
};

export type Project = {
  id: string;
  title: string;
  project_type: string;
  owner_id: string;
  current_step?: string;
  aspect_ratio?: string;
  cover_url?: string;
  final_video_url?: string;
  characters?: Character[];
  shots?: StoryboardShot[];
  subtitles?: SubtitleCue[];
  timeline?: TimelineItem[];
};


export type GraphNodeData = {
  title?: string;
  text?: string;
  script?: string;
  prompt?: string;
  narration?: string;
  image_url?: string;
  video_url?: string;
  audio_url?: string;
  shot_id?: string;
  task_id?: string;
  workflow_key?: string;
  result_summary?: string;
  [key: string]: unknown;
};

export type ProjectGraphNode = {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: GraphNodeData;
  source_entity_type?: string;
  source_entity_id?: string;
  status?: string;
};

export type ProjectGraphEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  data?: Record<string, unknown>;
};

export type ProjectGraph = {
  id: string;
  project_id: string;
  nodes: ProjectGraphNode[];
  edges: ProjectGraphEdge[];
  viewport?: { x: number; y: number; zoom: number };
  status?: string;
};

export type GenerationTask = {
  id: string;
  task_type: string;
  status: string;
  workflow_key?: string;
  shot_id?: string;
  progress?: number;
  credit_cost?: number;
  error_message?: string;
  retry_advice?: string;
  prompt_id?: string;
  events?: Array<{ message: string; created_at?: string }>;
};

export type Asset = {
  id: string;
  asset_type: string;
  url: string;
  mime_type?: string;
  source_task_type?: string;
  workflow_key?: string;
  shot_id?: string;
  shot_index?: number | null;
  shot_narration?: string;
};

export type DeleteResult = {
  id: string;
  deleted: boolean;
  message: string;
};

export type CreditTransaction = {
  id: string;
  transaction_type: string;
  amount: number;
  balance_after: number;
  description: string;
  created_at: string;
};

export type CreditAccount = {
  user_id: string;
  balance: number;
  total_granted: number;
  total_consumed: number;
  total_earned: number;
  transactions: CreditTransaction[];
};

export type PaymentOrder = {
  id: string;
  channel: string;
  credits: number;
  amount_cents: number;
  currency: string;
  checkout_url?: string;
  status: string;
};

export type RevenueShare = {
  id: string;
  work_id: string;
  author_id: string;
  gross_credits: number;
  author_credits: number;
  platform_credits: number;
  status: string;
};

export type SubscriptionPlan = {
  id: string;
  user_id: string;
  plan_code: string;
  plan_name: string;
  billing_cycle: string;
  credit_cost: number;
  status: string;
};

export type WithdrawalRequest = {
  id: string;
  user_id: string;
  amount_credits: number;
  payout_channel: string;
  payout_account: string;
  reviewer_id?: string;
  review_note?: string;
  provider_payout_id?: string;
  payout_dispatch_status?: string;
  payout_dispatch_message?: string;
  status: string;
};

export type PlatformUser = {
  id: string;
  nickname: string;
  bio?: string;
  role?: string;
  author_level?: string;
  avatar_url?: string;
  follower_count?: number;
};

export type AuthResponse = {
  token: string;
  expires_in: number;
  user: PlatformUser;
};

export type AuthorProfile = PlatformUser & {
  work_count: number;
  template_count: number;
  like_count: number;
  favorite_count: number;
  view_count: number;
  works: Work[];
  templates: Template[];
};

export function platformApiToken(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem("platform_api_token") || "";
}

export function userSessionToken(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem("platform_user_session") || "";
}

export function currentUserId(): string {
  if (typeof window === "undefined") return "demo_viewer";
  return window.localStorage.getItem("platform_user_id") || "demo_viewer";
}

export function savePlatformApiToken(token: string): void {
  if (typeof window === "undefined") return;
  if (token.trim()) {
    window.localStorage.setItem("platform_api_token", token.trim());
  } else {
    window.localStorage.removeItem("platform_api_token");
  }
}

export function saveUserSessionToken(token: string): void {
  if (typeof window === "undefined") return;
  if (token.trim()) {
    window.localStorage.setItem("platform_user_session", token.trim());
  } else {
    window.localStorage.removeItem("platform_user_session");
  }
}

export function saveCurrentUser(user: PlatformUser | null): void {
  if (typeof window === "undefined") return;
  if (user?.id) {
    window.localStorage.setItem("platform_user_id", user.id);
  } else {
    window.localStorage.removeItem("platform_user_id");
  }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const token = platformApiToken();
  const sessionToken = userSessionToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (sessionToken && !headers.has("X-User-Session")) {
    headers.set("X-User-Session", sessionToken);
  }
  return fetch(path, { ...init, headers });
}

export async function postJson<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : "请求失败，请稍后重试。";
    throw new Error(detail);
  }
  return data as T;
}

export async function patchJson<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const response = await apiFetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : "请求失败，请稍后重试。";
    throw new Error(detail);
  }
  return data as T;
}

export async function deleteJson<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const response = await apiFetch(path, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : "请求失败，请稍后重试。";
    throw new Error(detail);
  }
  return data as T;
}
