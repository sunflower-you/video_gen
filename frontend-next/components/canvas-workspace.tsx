
"use client";

import { useCallback, useEffect, useMemo, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance
} from "@xyflow/react";
import { AlertTriangle, Boxes, Clapperboard, ClipboardCopy, ClipboardPaste, Copy, Download, FileText, GitBranch, Image, LayoutGrid, Library, Music, Play, Plus, RefreshCcw, Save, Search, Sparkles, Trash2, Upload, Video, Wand2 } from "lucide-react";
import { apiFetch, currentUserId, deleteJson, postJson, type Asset, type GenerationTask, type Project, type ProjectGraph, type ProjectGraphNode, type StoryboardShot } from "../lib/api";

const nodeLabels: Record<string, string> = {
  text: "文本节点",
  image: "图片节点",
  video: "视频节点",
  audio: "音频节点",
  script: "脚本 Beta",
  image_generation: "分镜图生成",
  video_generation: "镜头视频生成",
  tts_generation: "旁白配音",
  compose_generation: "成片合成",
  demo: "演示节点"
};

const nodeColors: Record<string, string> = {
  text: "border-sky-400 bg-sky-950/80",
  image: "border-emerald-400 bg-emerald-950/80",
  video: "border-violet-400 bg-violet-950/80",
  audio: "border-amber-400 bg-amber-950/80",
  script: "border-pink-400 bg-pink-950/80",
  image_generation: "border-blue-400 bg-blue-950/80",
  video_generation: "border-purple-400 bg-purple-950/80",
  tts_generation: "border-orange-400 bg-orange-950/80",
  compose_generation: "border-red-400 bg-red-950/80",
  demo: "border-slate-400 bg-slate-900/80"
};

function statusText(status?: string) {
  const map: Record<string, string> = {
    draft: "草稿",
    pending: "待生成",
    running: "生成中",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消"
  };
  return map[status || "draft"] || status || "草稿";
}

function PlatformNode({ data, selected }: NodeProps) {
  const payload = data as Record<string, unknown>;
  const type = String(payload.nodeType || "text");
  const title = String(payload.title || nodeLabels[type] || "节点");
  const summary = String(payload.text || payload.script || payload.prompt || payload.narration || payload.result_summary || payload.workflow_key || "等待编辑参数");
  const status = String(payload.status || "draft");
  const previewUrl = String(payload.image_url || payload.video_url || payload.audio_url || "");
  return (
    <div className={`w-[240px] rounded-lg border p-3 text-white shadow-xl ${nodeColors[type] || nodeColors.demo} ${selected ? "ring-2 ring-white" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <strong className="truncate text-sm">{title}</strong>
        <span className="rounded bg-black/30 px-2 py-1 text-[11px]">{statusText(status)}</span>
      </div>
      {previewUrl && (type === "image" ? <img src={previewUrl} alt={title} className="mt-2 aspect-video w-full rounded object-cover" /> : <div className="mt-2 truncate rounded bg-black/25 px-2 py-1 text-xs">{previewUrl}</div>)}
      <p className="mt-2 line-clamp-3 text-xs text-slate-200">{summary}</p>
      {String(payload.task_id || "") && <p className="mt-2 truncate text-[11px] text-slate-300">任务：{String(payload.task_id)}</p>}
    </div>
  );
}

const nodeTypes = { platform: PlatformNode };

function toFlowNode(item: ProjectGraphNode): Node {
  return {
    id: item.id,
    type: "platform",
    position: item.position,
    data: { ...item.data, nodeType: item.type, graphNodeId: item.id, status: item.status || "draft" }
  };
}

function fromFlowNode(item: Node): ProjectGraphNode {
  const data = { ...(item.data as Record<string, unknown>) };
  const nodeType = String(data.nodeType || "text");
  delete data.nodeType;
  delete data.graphNodeId;
  const status = String(data.status || "draft");
  delete data.status;
  return {
    id: item.id,
    type: nodeType,
    position: item.position,
    data,
    status
  };
}

function toFlowEdge(edge: ProjectGraph["edges"][number]): Edge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle || undefined,
    targetHandle: edge.targetHandle || undefined,
    data: edge.data || {}
  };
}

function fromFlowEdge(edge: Edge): ProjectGraph["edges"][number] {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle || "",
    targetHandle: edge.targetHandle || "",
    data: (edge.data || {}) as Record<string, unknown>
  };
}

function upstreamNodeIds(targetId: string, edges: Edge[]) {
  const visited = new Set<string>();
  const walk = (nodeId: string) => {
    for (const edge of edges) {
      if (edge.target !== nodeId || visited.has(edge.source)) continue;
      visited.add(edge.source);
      walk(edge.source);
    }
  };
  walk(targetId);
  return visited;
}

function orderedChainNodes(targetId: string, nodes: Node[], edges: Edge[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const ordered: Node[] = [];
  const walk = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    for (const edge of edges) {
      if (edge.target === nodeId) walk(edge.source);
    }
    const node = nodeById.get(nodeId);
    if (node) ordered.push(node);
  };
  walk(targetId);
  return ordered;
}

function terminalNodeIds(nodes: Node[], edges: Edge[]) {
  const sourceIds = new Set(edges.map((edge) => edge.source));
  return nodes.filter((node) => !sourceIds.has(node.id)).map((node) => node.id);
}

function orderedGraphNodes(nodes: Node[], edges: Edge[]) {
  const terminals = terminalNodeIds(nodes, edges);
  const ordered: Node[] = [];
  const seen = new Set<string>();
  for (const terminalId of terminals.length ? terminals : nodes.map((node) => node.id)) {
    for (const node of orderedChainNodes(terminalId, nodes, edges)) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      ordered.push(node);
    }
  }
  return ordered;
}

function layoutGraphNodes(nodes: Node[], edges: Edge[]) {
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) || []), edge.source]);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge.target]);
  }
  const depthById = new Map<string, number>();
  const computeDepth = (nodeId: string, visiting = new Set<string>()): number => {
    if (depthById.has(nodeId)) return depthById.get(nodeId) || 0;
    if (visiting.has(nodeId)) return 0;
    visiting.add(nodeId);
    const parents = incoming.get(nodeId) || [];
    const depth = parents.length ? Math.max(...parents.map((parentId) => computeDepth(parentId, visiting))) + 1 : 0;
    visiting.delete(nodeId);
    depthById.set(nodeId, depth);
    return depth;
  };
  for (const node of nodes) computeDepth(node.id);
  const rowsByDepth = new Map<number, number>();
  return nodes.map((node) => {
    const depth = depthById.get(node.id) || 0;
    const row = rowsByDepth.get(depth) || 0;
    rowsByDepth.set(depth, row + 1);
    const hasOutgoing = (outgoing.get(node.id) || []).length > 0;
    return {
      ...node,
      position: { x: 180 + depth * 310, y: 120 + row * 170 + (hasOutgoing ? 0 : 24) }
    };
  });
}

function incomingNodeData(nodeId: string, nodes: Node[], edges: Edge[]) {
  const dataById = new Map(nodes.map((node) => [node.id, node.data as Record<string, unknown>]));
  return edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => dataById.get(edge.source))
    .filter((data): data is Record<string, unknown> => Boolean(data));
}

function firstNonEmpty(items: Record<string, unknown>[], ...keys: string[]) {
  for (const item of items) {
    for (const key of keys) {
      const value = item[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (value !== undefined && value !== null && value !== "") return String(value);
    }
  }
  return "";
}

type GraphValidationIssue = {
  id: string;
  level: "error" | "warning";
  nodeId?: string;
  title: string;
  detail: string;
};

function validateCanvasGraph(nodes: Node[], edges: Edge[]) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const issues: GraphValidationIssue[] = [];
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push({
        id: `edge-${edge.id}`,
        level: "error",
        title: "连线引用了不存在的节点",
        detail: `连线 ${edge.id} 的起点或终点已丢失。`
      });
    }
  }
  for (const node of nodes) {
    const data = node.data as Record<string, unknown>;
    const type = String(data.nodeType || "text");
    const incoming = incomingNodeData(node.id, nodes, edges);
    const title = String(data.title || nodeLabels[type] || node.id);
    const hasIncoming = edges.some((edge) => edge.target === node.id);
    const hasOutgoing = edges.some((edge) => edge.source === node.id);
    if (!hasIncoming && !hasOutgoing && nodes.length > 1) {
      issues.push({ id: `isolated-${node.id}`, level: "warning", nodeId: node.id, title: "节点未接入链路", detail: `${title} 暂未连接到其他节点。` });
    }
    if (type === "image_generation") {
      if (!String(data.shot_id || firstNonEmpty(incoming, "shot_id")).trim()) issues.push({ id: `shot-${node.id}`, level: "error", nodeId: node.id, title: "分镜图缺少绑定分镜", detail: `${title} 需要绑定分镜或从上游补全 shot_id。` });
      if (!String(data.prompt || firstNonEmpty(incoming, "prompt", "text", "script", "narration")).trim()) issues.push({ id: `prompt-${node.id}`, level: "error", nodeId: node.id, title: "分镜图缺少提示词", detail: `${title} 需要提示词或上游文本。` });
    }
    if (type === "video_generation") {
      if (!String(data.shot_id || firstNonEmpty(incoming, "shot_id")).trim()) issues.push({ id: `shot-${node.id}`, level: "error", nodeId: node.id, title: "视频节点缺少绑定分镜", detail: `${title} 需要绑定分镜或从上游补全 shot_id。` });
      if (!String(data.prompt || firstNonEmpty(incoming, "prompt", "text", "script", "narration")).trim()) issues.push({ id: `prompt-${node.id}`, level: "error", nodeId: node.id, title: "视频节点缺少动作提示词", detail: `${title} 需要提示词或上游文本。` });
      if (!String(data.first_frame_url || firstNonEmpty(incoming, "image_url")).trim()) issues.push({ id: `frame-${node.id}`, level: "warning", nodeId: node.id, title: "视频节点缺少首帧", detail: `${title} 未填写首帧图片，也没有上游图片节点。` });
    }
    if (type === "tts_generation" && !String(data.text || firstNonEmpty(incoming, "narration", "text", "script")).trim()) {
      issues.push({ id: `tts-${node.id}`, level: "error", nodeId: node.id, title: "配音节点缺少文本", detail: `${title} 需要旁白文本或上游文本。` });
    }
    if (type === "compose_generation" && !hasIncoming) {
      issues.push({ id: `compose-${node.id}`, level: "warning", nodeId: node.id, title: "合成节点没有输入", detail: `${title} 建议连接视频和配音节点后再运行。` });
    }
  }
  return {
    issues,
    errorCount: issues.filter((issue) => issue.level === "error").length,
    warningCount: issues.filter((issue) => issue.level === "warning").length
  };
}

const addableNodes = [
  { type: "text", label: "文本", category: "基础节点", description: "承载提示词、旁白、备注。", icon: FileText },
  { type: "image", label: "图片", category: "素材节点", description: "放入参考图或生成图。", icon: Image },
  { type: "video", label: "视频", category: "素材节点", description: "放入镜头视频或成片。", icon: Video },
  { type: "audio", label: "音频", category: "素材节点", description: "放入配音和音效素材。", icon: Music },
  { type: "script", label: "脚本 Beta", category: "平台生成", description: "分析脚本并生成分镜。", icon: Clapperboard },
  { type: "image_generation", label: "分镜图", category: "平台生成", description: "按分镜生成画面。", icon: Wand2 },
  { type: "video_generation", label: "镜头视频", category: "平台生成", description: "由首帧图生成视频。", icon: Video },
  { type: "tts_generation", label: "配音", category: "平台生成", description: "生成中文旁白配音。", icon: Music },
  { type: "compose_generation", label: "合成", category: "平台生成", description: "合成视频、字幕和音轨。", icon: Sparkles },
  { type: "demo", label: "演示", category: "基础节点", description: "验证画布运行状态。", icon: Boxes }
];

const workflowPresets = [
  {
    key: "script_to_storyboard",
    title: "脚本拆解分镜",
    description: "脚本 Beta 连到分镜图、配音和合成节点。",
    nodes: [
      { type: "script", offset: { x: 0, y: 0 }, data: { title: "脚本 Beta", script: "输入短视频脚本，运行后生成角色和分镜。" } },
      { type: "image_generation", offset: { x: 300, y: -70 }, data: { title: "分镜图生成", prompt: "根据脚本分镜生成关键画面", width: "768", height: "1344", seed: "-1" } },
      { type: "tts_generation", offset: { x: 300, y: 150 }, data: { title: "旁白配音", text: "从脚本或分镜旁白生成配音", voice: "zh-CN-XiaoxiaoNeural", rate: "1" } },
      { type: "compose_generation", offset: { x: 620, y: 40 }, data: { title: "成片合成", subtitle: true } }
    ],
    edges: [[0, 1], [0, 2], [1, 3], [2, 3]]
  },
  {
    key: "image_to_video",
    title: "首帧图生视频",
    description: "参考图连到镜头视频节点，再进入成片合成。",
    nodes: [
      { type: "image", offset: { x: 0, y: 0 }, data: { title: "首帧图片", image_url: "" } },
      { type: "video_generation", offset: { x: 310, y: 0 }, data: { title: "镜头视频生成", prompt: "描述镜头运动和角色动作", first_frame_url: "", duration: "4", fps: "16" } },
      { type: "compose_generation", offset: { x: 620, y: 0 }, data: { title: "成片合成", subtitle: true } }
    ],
    edges: [[0, 1], [1, 2]]
  },
  {
    key: "voice_compose",
    title: "旁白字幕合成",
    description: "文本旁白连到配音节点，再连接成片合成。",
    nodes: [
      { type: "text", offset: { x: 0, y: 0 }, data: { title: "旁白文案", text: "输入需要配音的中文旁白。" } },
      { type: "tts_generation", offset: { x: 300, y: 0 }, data: { title: "旁白配音", voice: "zh-CN-XiaoxiaoNeural", rate: "1" } },
      { type: "compose_generation", offset: { x: 610, y: 0 }, data: { title: "成片合成", subtitle: true } }
    ],
    edges: [[0, 1], [1, 2]]
  }
];

type CustomWorkflowPreset = {
  key: string;
  title: string;
  description: string;
  nodes: ProjectGraphNode[];
  edges: ProjectGraph["edges"];
  created_at: string;
};

const customPresetStorageKey = "video_gen_canvas_custom_presets";

export function CanvasWorkspace({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [copiedSelection, setCopiedSelection] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [status, setStatus] = useState("正在加载全画幅创作画布...");
  const [showAssets, setShowAssets] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const [showShots, setShowShots] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [showPalette, setShowPalette] = useState(true);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [importText, setImportText] = useState("");
  const [customWorkflowPresets, setCustomWorkflowPresets] = useState<CustomWorkflowPreset[]>([]);
  const [presetTitle, setPresetTitle] = useState("自定义工作流");
  const [busy, setBusy] = useState(false);

  const selectedNode = useMemo(() => nodes.find((item) => item.id === selectedNodeId) || null, [nodes, selectedNodeId]);
  const shotOptions = useMemo(() => project?.shots || [], [project]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const selectedTask = useMemo(() => {
    const taskId = String((selectedNode?.data as Record<string, unknown> | undefined)?.task_id || "");
    return taskId ? taskById.get(taskId) || null : null;
  }, [selectedNode, taskById]);
  const taskStatusCounts = useMemo(() => tasks.reduce<Record<string, number>>((counts, task) => {
    counts[task.status] = (counts[task.status] || 0) + 1;
    return counts;
  }, {}), [tasks]);
  const graphValidation = useMemo(() => validateCanvasGraph(nodes, edges), [nodes, edges]);
  const filteredAddableNodes = useMemo(() => {
    const keyword = paletteQuery.trim().toLowerCase();
    return addableNodes.filter((item) => {
      const text = `${item.label} ${item.category} ${item.description} ${nodeLabels[item.type]}`.toLowerCase();
      return !keyword || text.includes(keyword);
    });
  }, [paletteQuery]);

  useEffect(() => {
    void refreshAll();
  }, [projectId]);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(customPresetStorageKey) || "[]");
      if (Array.isArray(saved)) setCustomWorkflowPresets(saved);
    } catch {
      window.localStorage.removeItem(customPresetStorageKey);
    }
  }, []);

  useEffect(() => {
    const handleCanvasKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveGraph();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copySelectedChain();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
        event.preventDefault();
        pasteCopiedSelection();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelectedNode();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void runCanvasGraph();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "l") {
        event.preventDefault();
        autoLayoutGraph();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedNode) {
        event.preventDefault();
        void deleteSelectedNode();
      }
    };
    window.addEventListener("keydown", handleCanvasKeyDown);
    return () => window.removeEventListener("keydown", handleCanvasKeyDown);
  });

  const onNodesChange = useCallback((changes: NodeChange[]) => setNodes((items) => applyNodeChanges(changes, items)), []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((items) => applyEdgeChanges(changes, items)), []);
  const onConnect = useCallback((connection: Connection) => setEdges((items) => addEdge({ ...connection, id: `edge-${connection.source}-${connection.target}-${Date.now()}` }, items)), []);

  async function refreshAll() {
    setBusy(true);
    try {
      const userId = currentUserId();
      const [projectResponse, graphResponse, assetResponse, taskResponse] = await Promise.all([
        apiFetch(`/api/projects/${projectId}?user_id=${encodeURIComponent(userId)}`),
        apiFetch(`/api/projects/${projectId}/graph?user_id=${encodeURIComponent(userId)}`),
        apiFetch(`/api/projects/${projectId}/assets?user_id=${encodeURIComponent(userId)}`),
        apiFetch(`/api/projects/${projectId}/tasks?user_id=${encodeURIComponent(userId)}`)
      ]);
      const projectData = await projectResponse.json().catch(() => ({}));
      if (!projectResponse.ok) throw new Error(typeof projectData?.detail === "string" ? projectData.detail : "项目加载失败。");
      const graphData = graphResponse.ok ? ((await graphResponse.json()) as ProjectGraph) : null;
      setProject(projectData as Project);
      setNodes((graphData?.nodes || []).map(toFlowNode));
      setEdges((graphData?.edges || []).map(toFlowEdge));
      setAssets(assetResponse.ok ? await assetResponse.json() : []);
      setTasks(taskResponse.ok ? await taskResponse.json() : []);
      setStatus("全画幅创作画布已同步。");
    } catch (error) {
      const cached = window.localStorage.getItem(`project_graph_${projectId}`);
      if (cached) {
        const graph = JSON.parse(cached) as ProjectGraph;
        setNodes((graph.nodes || []).map(toFlowNode));
        setEdges((graph.edges || []).map(toFlowEdge));
      }
      setStatus(error instanceof Error ? error.message : "创作画布加载失败。");
    } finally {
      setBusy(false);
    }
  }

  async function saveGraph() {
    const payload = {
      user_id: currentUserId(),
      nodes: nodes.map(fromFlowNode),
      edges: edges.map(fromFlowEdge),
      viewport: { x: 0, y: 0, zoom: 1 },
      status: "draft"
    };
    window.localStorage.setItem(`project_graph_${projectId}`, JSON.stringify({ project_id: projectId, ...payload }));
    setBusy(true);
    try {
      const response = await apiFetch(`/api/projects/${projectId}/graph`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data?.detail === "string" ? data.detail : "画布保存失败。");
      setStatus("画布已保存。刷新后会恢复节点位置和连线。");
    } catch (error) {
      setStatus(error instanceof Error ? `${error.message} 画布草稿已保存在本地。` : "画布保存失败，草稿已保存在本地。");
    } finally {
      setBusy(false);
    }
  }

  function buildNodeData(type: string) {
    const firstShotId = shotOptions[0]?.id || "";
    return type === "script"
      ? { title: "脚本 Beta", script: "在这里输入短视频脚本，运行后自动拆解分镜。" }
      : type === "image"
        ? { title: "图片节点", image_url: "/storage/reference/hero.png" }
        : type === "video"
          ? { title: "视频节点", video_url: "" }
          : type === "audio"
            ? { title: "音频节点", audio_url: "" }
            : type === "image_generation"
              ? { title: nodeLabels[type], prompt: "输入生成提示词", shot_id: firstShotId, width: "768", height: "1344", seed: "-1" }
              : type === "video_generation"
                ? { title: nodeLabels[type], prompt: "输入镜头视频提示词", shot_id: firstShotId, first_frame_url: "", duration: "4", fps: "16" }
                : type === "tts_generation"
                  ? { title: nodeLabels[type], text: "输入旁白文本", shot_id: firstShotId, voice: "zh-CN-XiaoxiaoNeural", rate: "1" }
                  : type === "compose_generation"
                    ? { title: nodeLabels[type], subtitle: true }
                    : { title: nodeLabels[type], text: "输入内容" };
  }

  function createFlowNode(type: string, position: { x: number; y: number }, extraData: Record<string, unknown> = {}) {
    const id = `local-${type}-${Date.now()}-${Math.round(position.x)}-${Math.round(position.y)}`;
    const node: Node = {
      id,
      type: "platform",
      position,
      data: { ...buildNodeData(type), ...extraData, nodeType: type, graphNodeId: id, status: String(extraData.status || "draft") }
    };
    return node;
  }

  function addNodeAtPosition(type: string, position: { x: number; y: number }, extraData: Record<string, unknown> = {}) {
    const node = createFlowNode(type, position, extraData);
    setNodes((items) => [...items, node]);
    setSelectedNodeId(node.id);
    return node;
  }

  function addNode(type: string) {
    const node = addNodeAtPosition(type, { x: 160 + nodes.length * 36, y: 120 + nodes.length * 28 });
    setShowPalette(false);
    setStatus(`已添加${nodeLabels[String(node.data.nodeType)] || "节点"}。`);
  }

  function flowPositionFromEvent(event: Pick<ReactMouseEvent, "clientX" | "clientY"> | Pick<ReactDragEvent, "clientX" | "clientY">) {
    return flowInstance?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) || { x: event.clientX - 360, y: event.clientY - 120 };
  }

  function handleCanvasDoubleClick(event: ReactMouseEvent) {
    if ((event.target as HTMLElement | null)?.closest(".react-flow__node, .react-flow__controls, .react-flow__minimap")) return;
    const node = addNodeAtPosition("text", flowPositionFromEvent(event), { title: "新建文本节点", text: "输入提示词、旁白或备注。" });
    setShowPalette(false);
    setStatus(`已在画布空白处创建${nodeLabels[String(node.data.nodeType)]}。`);
  }

  function inferAssetNodeType(value: string, mimeType = "") {
    const text = `${mimeType} ${value}`.toLowerCase();
    if (text.includes("video") || /\.(mp4|mov|webm|m4v)(\?|$)/.test(text)) return "video";
    if (text.includes("audio") || /\.(mp3|wav|m4a|aac|ogg)(\?|$)/.test(text)) return "audio";
    return "image";
  }

  function addDroppedAssetNode(type: string, url: string, position: { x: number; y: number }, title = "") {
    const dataKey = type === "video" ? "video_url" : type === "audio" ? "audio_url" : "image_url";
    const node = addNodeAtPosition(type, position, {
      title: title || `拖入${nodeLabels[type] || "素材"}`,
      [dataKey]: url,
      text: "从画布拖入的素材，可继续接入生成链路。"
    });
    setShowAssets(false);
    setStatus(`已拖入${nodeLabels[String(node.data.nodeType)] || "素材"}。`);
  }

  function handleCanvasDragOver(event: ReactDragEvent) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleCanvasDrop(event: ReactDragEvent) {
    event.preventDefault();
    const position = flowPositionFromEvent(event);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      const type = inferAssetNodeType(file.name, file.type);
      addDroppedAssetNode(type, URL.createObjectURL(file), position, file.name);
      return;
    }
    const url = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
    if (!url.trim()) return;
    const type = inferAssetNodeType(url);
    addDroppedAssetNode(type, url.trim(), position);
  }

  function addWorkflowPreset(presetKey: string) {
    const preset = workflowPresets.find((item) => item.key === presetKey);
    if (!preset) return;
    const firstShotId = shotOptions[0]?.id || "";
    const timestamp = Date.now();
    const baseX = 180 + nodes.length * 28;
    const baseY = 140 + nodes.length * 18;
    const createdNodes = preset.nodes.map((item, index) => {
      const id = `preset-${preset.key}-${timestamp}-${index}`;
      const generationData = item.type.includes("generation") && item.type !== "compose_generation" ? { shot_id: firstShotId } : {};
      return {
        id,
        type: "platform",
        position: { x: baseX + item.offset.x, y: baseY + item.offset.y },
        data: { ...item.data, ...generationData, nodeType: item.type, graphNodeId: id, status: "draft" }
      } satisfies Node;
    });
    const createdEdges = preset.edges.map(([sourceIndex, targetIndex], index) => ({
      id: `edge-${preset.key}-${timestamp}-${index}`,
      source: createdNodes[sourceIndex].id,
      target: createdNodes[targetIndex].id
    }));
    setNodes((items) => [...items, ...createdNodes]);
    setEdges((items) => [...items, ...createdEdges]);
    setSelectedNodeId(createdNodes[0]?.id || "");
    setShowPalette(false);
    setStatus(`已添加工作流预设：${preset.title}。`);
  }

  function addCustomWorkflowPreset(presetKey: string) {
    const preset = customWorkflowPresets.find((item) => item.key === presetKey);
    if (!preset) return;
    const timestamp = Date.now();
    const idMap = new Map<string, string>();
    const importedNodes = preset.nodes.map((item, index) => {
      const id = `custom-${preset.key}-${timestamp}-${index}`;
      idMap.set(item.id, id);
      return toFlowNode({
        ...item,
        id,
        position: {
          x: Number(item.position?.x || 160) + 80 + nodes.length * 12,
          y: Number(item.position?.y || 120) + 80 + nodes.length * 8
        },
        status: "draft",
        data: { ...(item.data || {}), graphNodeId: id }
      });
    });
    const importedEdges = preset.edges.flatMap((edge, index) => {
      const source = idMap.get(String(edge.source));
      const target = idMap.get(String(edge.target));
      if (!source || !target) return [];
      return [{
        id: `edge-custom-${preset.key}-${timestamp}-${index}`,
        source,
        target,
        sourceHandle: edge.sourceHandle || undefined,
        targetHandle: edge.targetHandle || undefined,
        data: edge.data || {}
      } satisfies Edge];
    });
    setNodes((items) => [...items, ...importedNodes]);
    setEdges((items) => [...items, ...importedEdges]);
    setSelectedNodeId(importedNodes[0]?.id || "");
    setShowPalette(false);
    setStatus(`已添加自定义预设：${preset.title}。`);
  }

  function saveCurrentWorkflowAsPreset() {
    if (!nodes.length) {
      setStatus("画布暂无节点，无法保存为预设。");
      return;
    }
    const title = presetTitle.trim() || `${project?.title || "自定义工作流"} 预设`;
    const preset: CustomWorkflowPreset = {
      key: `custom-${Date.now()}`,
      title,
      description: `${nodes.length} 个节点、${edges.length} 条连线，可在任意项目画布复用。`,
      nodes: nodes.map(fromFlowNode),
      edges: edges.map(fromFlowEdge),
      created_at: new Date().toISOString()
    };
    const next = [preset, ...customWorkflowPresets].slice(0, 12);
    setCustomWorkflowPresets(next);
    window.localStorage.setItem(customPresetStorageKey, JSON.stringify(next));
    setPresetTitle(title);
    setStatus(`已保存自定义预设：${title}。`);
  }

  function deleteCustomWorkflowPreset(presetKey: string) {
    const next = customWorkflowPresets.filter((item) => item.key !== presetKey);
    setCustomWorkflowPresets(next);
    window.localStorage.setItem(customPresetStorageKey, JSON.stringify(next));
    setStatus("自定义预设已删除。");
  }

  function buildShotWorkflow(shot: StoryboardShot, timestamp: number, baseX: number, baseY: number) {
    const specs = [
      { type: "text", offset: { x: 0, y: 0 }, data: { title: `分镜 ${shot.index}`, text: shot.visual_description, narration: shot.narration, shot_id: shot.id } },
      { type: "image_generation", offset: { x: 300, y: -80 }, data: { title: `分镜 ${shot.index} 画面`, prompt: shot.prompt || shot.visual_description, shot_id: shot.id, width: "768", height: "1344", seed: "-1" } },
      { type: "video_generation", offset: { x: 610, y: -80 }, data: { title: `分镜 ${shot.index} 视频`, prompt: shot.visual_description, shot_id: shot.id, first_frame_url: "", duration: "4", fps: "16" } },
      { type: "tts_generation", offset: { x: 300, y: 150 }, data: { title: `分镜 ${shot.index} 配音`, text: shot.narration, shot_id: shot.id, voice: "zh-CN-XiaoxiaoNeural", rate: "1" } },
      { type: "compose_generation", offset: { x: 920, y: 30 }, data: { title: `分镜 ${shot.index} 合成`, subtitle: true } }
    ];
    const createdNodes = specs.map((item, index) => {
      const id = `shot-${shot.id}-${timestamp}-${index}`;
      return {
        id,
        type: "platform",
        position: { x: baseX + item.offset.x, y: baseY + item.offset.y },
        data: { ...item.data, nodeType: item.type, graphNodeId: id, status: "draft" }
      } satisfies Node;
    });
    const edgePairs = [[0, 1], [1, 2], [0, 3], [2, 4], [3, 4]];
    const createdEdges = edgePairs.map(([sourceIndex, targetIndex], index) => ({
      id: `edge-shot-${shot.id}-${timestamp}-${index}`,
      source: createdNodes[sourceIndex].id,
      target: createdNodes[targetIndex].id
    }));
    return { createdNodes, createdEdges };
  }

  function addShotWorkflow(shot: StoryboardShot) {
    const timestamp = Date.now();
    const { createdNodes, createdEdges } = buildShotWorkflow(shot, timestamp, 220 + nodes.length * 28, 140 + nodes.length * 18);
    setNodes((items) => [...items, ...createdNodes]);
    setEdges((items) => [...items, ...createdEdges]);
    setSelectedNodeId(createdNodes[0]?.id || "");
    setShowShots(false);
    setStatus(`已为分镜 ${shot.index} 添加生成链路。`);
  }

  function addAllShotWorkflows() {
    if (!shotOptions.length) return;
    const timestamp = Date.now();
    const groups = shotOptions.map((shot, index) => buildShotWorkflow(shot, timestamp + index, 220, 120 + index * 280));
    const createdNodes = groups.flatMap((group) => group.createdNodes);
    const createdEdges = groups.flatMap((group) => group.createdEdges);
    setNodes((items) => [...items, ...createdNodes]);
    setEdges((items) => [...items, ...createdEdges]);
    setSelectedNodeId(createdNodes[0]?.id || "");
    setShowShots(false);
    setStatus(`已为 ${shotOptions.length} 个分镜添加生成链路。`);
  }

  function updateSelectedData(key: string, value: string | boolean) {
    if (!selectedNode) return;
    setNodes((items) => items.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, [key]: value } } : node));
  }

  async function taskAction(taskId: string, action: "submit" | "sync" | "cancel" | "retry") {
    const path = action === "sync" ? `/api/comfy/tasks/${taskId}/sync` : `/api/tasks/${taskId}/${action}`;
    setBusy(true);
    setStatus(action === "submit" ? "正在提交任务到 ComfyUI..." : action === "sync" ? "正在同步任务状态..." : action === "cancel" ? "正在取消任务..." : "正在重试任务...");
    try {
      const task = await postJson<GenerationTask>(path, {
        user_id: currentUserId(),
        reason: "用户在全画幅画布操作。"
      });
      setTasks((items) => items.map((item) => item.id === task.id ? task : item));
      setNodes((items) => items.map((node) => String((node.data as Record<string, unknown>).task_id || "") === task.id ? { ...node, data: { ...node.data, status: task.status } } : node));
      setStatus(`任务状态已更新：${statusText(task.status)}`);
      await refreshAll();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "任务操作失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  function focusTaskNode(taskId: string) {
    const node = nodes.find((item) => String((item.data as Record<string, unknown>).task_id || "") === taskId);
    if (!node) {
      setStatus("画布中暂未找到关联这个任务的节点。");
      return;
    }
    setSelectedNodeId(node.id);
    flowInstance?.setCenter(node.position.x + 120, node.position.y + 80, { duration: 420, zoom: 1 });
    setStatus("已定位到任务关联节点。");
  }

  function focusCanvasNode(nodeId: string) {
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) {
      setStatus("画布中暂未找到这个节点。");
      return;
    }
    setSelectedNodeId(node.id);
    flowInstance?.setCenter(node.position.x + 120, node.position.y + 80, { duration: 420, zoom: 1 });
    setStatus("已定位到自检问题节点。");
  }

  async function runSelectedNode() {
    if (!selectedNode) return;
    await saveGraph();
    setBusy(true);
    setStatus("正在运行节点...");
    try {
      const response = await postJson<{ node?: ProjectGraphNode; task?: GenerationTask; message?: string }>(`/api/projects/${projectId}/graph/nodes/${selectedNode.id}/run`, {
        user_id: currentUserId()
      });
      if (response.node) {
        setNodes((items) => items.map((node) => node.id === selectedNode.id ? toFlowNode(response.node as ProjectGraphNode) : node));
      }
      setStatus(response.task ? `节点已创建任务：${response.task.status}` : response.message || "节点运行完成。");
      await refreshAll();
    } catch (error) {
      setNodes((items) => items.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, status: "failed" } } : node));
      setStatus(error instanceof Error ? error.message : "节点运行失败。请检查参数后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function runSelectedChain() {
    if (!selectedNode) return;
    await saveGraph();
    const upstream = upstreamNodeIds(selectedNode.id, edges);
    const orderedNodes = orderedChainNodes(selectedNode.id, nodes, edges);
    setBusy(true);
    setStatus(`正在运行链路，上游 ${upstream.size} 个，共 ${orderedNodes.length} 个节点...`);
    try {
      for (const node of orderedNodes) {
        const response = await postJson<{ node?: ProjectGraphNode; task?: GenerationTask; message?: string }>(`/api/projects/${projectId}/graph/nodes/${node.id}/run`, {
          user_id: currentUserId()
        });
        if (response.node) {
          setNodes((items) => items.map((item) => item.id === node.id ? toFlowNode(response.node as ProjectGraphNode) : item));
        }
      }
      setStatus(`链路运行完成：${orderedNodes.length} 个节点已处理。`);
      await refreshAll();
    } catch (error) {
      setStatus(error instanceof Error ? `链路运行失败：${error.message}` : "链路运行失败。请检查节点参数后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function runCanvasGraph() {
    const orderedNodes = orderedGraphNodes(nodes, edges);
    const terminals = terminalNodeIds(nodes, edges);
    if (!orderedNodes.length) {
      setStatus("画布暂无可运行节点，请先添加节点或工作流。");
      return;
    }
    await saveGraph();
    setBusy(true);
    setStatus(`正在运行全画布：${terminals.length || 1} 条终点链路，共 ${orderedNodes.length} 个节点...`);
    try {
      for (const node of orderedNodes) {
        const response = await postJson<{ node?: ProjectGraphNode; task?: GenerationTask; message?: string }>(`/api/projects/${projectId}/graph/nodes/${node.id}/run`, {
          user_id: currentUserId()
        });
        if (response.node) {
          setNodes((items) => items.map((item) => item.id === node.id ? toFlowNode(response.node as ProjectGraphNode) : item));
        }
      }
      setStatus(`全画布运行完成：${orderedNodes.length} 个节点已按依赖顺序处理。`);
      await refreshAll();
    } catch (error) {
      setStatus(error instanceof Error ? `全画布运行失败：${error.message}` : "全画布运行失败。请检查节点参数后重试。");
    } finally {
      setBusy(false);
    }
  }

  function autoLayoutGraph() {
    if (!nodes.length) {
      setStatus("画布暂无节点可整理。");
      return;
    }
    setNodes((items) => layoutGraphNodes(items, edges));
    setStatus(`已按连线依赖整理 ${nodes.length} 个节点。`);
  }

  function duplicateSelectedNode() {
    if (!selectedNode) return;
    const id = `copy-${selectedNode.id}-${Date.now()}`;
    const duplicated: Node = {
      ...selectedNode,
      id,
      selected: false,
      position: { x: selectedNode.position.x + 40, y: selectedNode.position.y + 40 },
      data: { ...(selectedNode.data as Record<string, unknown>), graphNodeId: id, title: `${String(selectedData.title || nodeLabels[selectedType] || "节点")} 副本`, status: "draft" }
    };
    setNodes((items) => [...items, duplicated]);
    setSelectedNodeId(id);
    setStatus("节点已复制，可继续编辑参数或接入连线。");
  }

  function copySelectedChain() {
    if (!selectedNode) {
      setStatus("请先选择一个节点，再复制链路。");
      return;
    }
    const chainNodes = orderedChainNodes(selectedNode.id, nodes, edges);
    const nodeIds = new Set(chainNodes.map((node) => node.id));
    const chainEdges = edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
    const snapshot = { nodes: chainNodes, edges: chainEdges };
    setCopiedSelection(snapshot);
    window.localStorage.setItem(`project_graph_clipboard_${projectId}`, JSON.stringify(snapshot));
    setStatus(`已复制链路：${chainNodes.length} 个节点、${chainEdges.length} 条连线。`);
  }

  function pasteCopiedSelection() {
    let cached = copiedSelection;
    if (!cached) {
      try {
        cached = JSON.parse(window.localStorage.getItem(`project_graph_clipboard_${projectId}`) || "null");
      } catch {
        window.localStorage.removeItem(`project_graph_clipboard_${projectId}`);
      }
    }
    if (!cached?.nodes?.length) {
      setStatus("暂无可粘贴的链路。");
      return;
    }
    const timestamp = Date.now();
    const idMap = new Map<string, string>();
    const pastedNodes = (cached.nodes as Node[]).map((node, index) => {
      const id = `paste-${node.id}-${timestamp}-${index}`;
      idMap.set(node.id, id);
      const data = { ...(node.data as Record<string, unknown>), graphNodeId: id, status: "draft" };
      return {
        ...node,
        id,
        selected: false,
        position: { x: node.position.x + 72, y: node.position.y + 72 },
        data
      } satisfies Node;
    });
    const pastedEdges = ((cached.edges || []) as Edge[]).flatMap((edge, index) => {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      if (!source || !target) return [];
      return [{
        ...edge,
        id: `edge-paste-${timestamp}-${index}`,
        source,
        target
      } satisfies Edge];
    });
    setNodes((items) => [...items, ...pastedNodes]);
    setEdges((items) => [...items, ...pastedEdges]);
    setSelectedNodeId(pastedNodes[pastedNodes.length - 1]?.id || "");
    setStatus(`已粘贴链路：${pastedNodes.length} 个节点、${pastedEdges.length} 条连线。`);
  }

  async function deleteSelectedNode() {
    if (!selectedNode) return;
    const nodeId = selectedNode.id;
    setNodes((items) => items.filter((node) => node.id !== nodeId));
    setEdges((items) => items.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setSelectedNodeId("");
    if (!nodeId.startsWith("local-")) {
      try {
        await deleteJson(`/api/projects/${projectId}/graph/nodes/${nodeId}`, { user_id: currentUserId() });
      } catch {
        setStatus("节点已从本地画布删除，远端删除稍后可重试。 ");
      }
    }
  }

  function addAssetNode(asset: Asset) {
    const type = asset.asset_type === "video" ? "video" : asset.asset_type === "audio" ? "audio" : "image";
    const dataKey = type === "video" ? "video_url" : type === "audio" ? "audio_url" : "image_url";
    const id = `asset-${asset.id}`;
    if (nodes.some((node) => node.id === id)) return;
    setNodes((items) => [...items, {
      id,
      type: "platform",
      position: { x: 260 + items.length * 32, y: 220 + items.length * 24 },
      data: { title: `素材 ${asset.asset_type}`, nodeType: type, graphNodeId: id, status: "completed", [dataKey]: asset.url, text: asset.workflow_key || asset.source_task_type || "项目素材" }
    }]);
    setStatus("素材已拖入画布。 ");
  }

  function exportWorkflowJson() {
    const graph = {
      id: `export-${projectId}-${Date.now()}`,
      project_id: projectId,
      title: project?.title || "全画幅工作流",
      exported_at: new Date().toISOString(),
      nodes: nodes.map(fromFlowNode),
      edges: edges.map(fromFlowEdge),
      viewport: { x: 0, y: 0, zoom: 1 },
      status: "draft"
    };
    const text = JSON.stringify(graph, null, 2);
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${project?.title || "video-gen-workflow"}.json`;
    link.click();
    URL.revokeObjectURL(url);
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    setStatus(`已导出工作流：${graph.nodes.length} 个节点、${graph.edges.length} 条连线。`);
  }

  function importWorkflowJson() {
    let graph: Partial<ProjectGraph> & { nodes?: unknown; edges?: unknown };
    try {
      graph = JSON.parse(importText);
    } catch {
      setStatus("工作流 JSON 解析失败，请检查内容格式。");
      return;
    }
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      setStatus("工作流 JSON 需要包含 nodes 和 edges。");
      return;
    }
    const timestamp = Date.now();
    const idMap = new Map<string, string>();
    const importedNodes = (graph.nodes as ProjectGraphNode[]).map((item, index) => {
      const originalId = String(item.id || `node-${index}`);
      const id = `import-${timestamp}-${index}`;
      idMap.set(originalId, id);
      return toFlowNode({
        ...item,
        id,
        position: {
          x: Number(item.position?.x || 160) + 48,
          y: Number(item.position?.y || 120) + 48
        },
        status: "draft",
        data: { ...(item.data || {}), graphNodeId: id }
      });
    });
    const importedEdges = (graph.edges as ProjectGraph["edges"]).flatMap((edge, index) => {
      const source = idMap.get(String(edge.source));
      const target = idMap.get(String(edge.target));
      if (!source || !target) return [];
      return [{
        id: `edge-import-${timestamp}-${index}`,
        source,
        target,
        sourceHandle: edge.sourceHandle || undefined,
        targetHandle: edge.targetHandle || undefined,
        data: edge.data || {}
      } satisfies Edge];
    });
    setNodes((items) => [...items, ...importedNodes]);
    setEdges((items) => [...items, ...importedEdges]);
    setSelectedNodeId(importedNodes[0]?.id || "");
    setShowImport(false);
    setImportText("");
    setStatus(`已导入工作流：${importedNodes.length} 个节点、${importedEdges.length} 条连线。`);
  }

  const selectedData = (selectedNode?.data || {}) as Record<string, unknown>;
  const selectedType = String(selectedData.nodeType || "text");

  return (
    <main className="h-screen overflow-hidden bg-[#0b1020] text-white">
      <header className="absolute left-4 right-4 top-3 z-20 flex items-center justify-between rounded-lg border border-white/10 bg-slate-950/85 px-4 py-3 shadow-2xl backdrop-blur">
        <div>
          <a className="text-xs text-slate-400 hover:text-white" href="/create">返回创作入口</a>
          <h1 className="mt-1 text-lg font-semibold">{project?.title || "全画幅创作画布"}</h1>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="max-w-[420px] truncate rounded border border-white/10 bg-white/5 px-3 py-2 text-slate-300">{status}</span>
          <button disabled={busy} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-3 py-2 disabled:opacity-50" onClick={() => void refreshAll()}><RefreshCcw size={16} />刷新</button>
          <button disabled={busy || !nodes.length} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-3 py-2 disabled:opacity-50" onClick={exportWorkflowJson}><Download size={16} />导出工作流</button>
          <button disabled={busy} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-3 py-2 disabled:opacity-50" onClick={() => setShowImport((value) => !value)}><Upload size={16} />导入工作流</button>
          <button disabled={busy || !nodes.length} className="inline-flex items-center gap-2 rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 disabled:opacity-50" onClick={() => setShowValidation((value) => !value)}><AlertTriangle size={16} />画布自检 {graphValidation.errorCount ? graphValidation.errorCount : ""}</button>
          <button disabled={busy || !nodes.length} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-3 py-2 disabled:opacity-50" onClick={autoLayoutGraph}><LayoutGrid size={16} />整理画布</button>
          <button disabled={busy || !nodes.length} className="inline-flex items-center gap-2 rounded-md border border-blue-400/40 bg-blue-500/10 px-3 py-2 disabled:opacity-50" onClick={() => void runCanvasGraph()}><GitBranch size={16} />运行全图</button>
          <button disabled={busy} className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 disabled:opacity-50" onClick={() => void saveGraph()}><Save size={16} />保存画布</button>
        </div>
      </header>

      <aside className="absolute left-4 top-28 z-20 grid gap-2 rounded-lg border border-white/10 bg-slate-950/85 p-2 shadow-2xl backdrop-blur">
        <button title="添加节点" className="grid h-10 w-10 place-items-center rounded-md bg-blue-600 text-white hover:bg-blue-500" onClick={() => setShowPalette((value) => !value)}><Plus size={18} /></button>
        <button title="分镜列表" className="grid h-10 w-10 place-items-center rounded-md text-slate-200 hover:bg-white/10" onClick={() => setShowShots((value) => !value)}><Clapperboard size={18} /></button>
        <button title="素材库" className="grid h-10 w-10 place-items-center rounded-md text-slate-200 hover:bg-white/10" onClick={() => setShowAssets((value) => !value)}><Library size={18} /></button>
        <button title="任务队列" className="grid h-10 w-10 place-items-center rounded-md text-slate-200 hover:bg-white/10" onClick={() => setShowTasks((value) => !value)}><Boxes size={18} /></button>
      </aside>

      {showPalette && <aside className="absolute left-20 top-28 z-20 max-h-[620px] w-[360px] overflow-auto rounded-lg border border-white/10 bg-slate-950/90 p-4 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-400">添加节点</p>
            <h2 className="font-semibold">节点工作流</h2>
          </div>
          <span className="rounded border border-white/10 px-2 py-1 text-xs text-slate-400">{filteredAddableNodes.length} 个</span>
        </div>
        <label className="mt-3 flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm">
          <Search size={16} className="text-slate-400" />
          <input className="w-full bg-transparent outline-none placeholder:text-slate-500" placeholder="搜索图片、视频、配音、合成" value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} />
        </label>
        <section className="mt-4 grid gap-2">
          <h3 className="text-xs font-medium text-slate-400">工作流预设</h3>
          {workflowPresets.map((preset) => <button key={preset.key} className="rounded-md border border-blue-400/30 bg-blue-500/10 px-3 py-3 text-left hover:bg-blue-500/20" onClick={() => addWorkflowPreset(preset.key)}>
            <span className="block text-sm font-medium text-white">{preset.title}</span>
            <span className="mt-1 block text-xs leading-5 text-slate-300">{preset.description}</span>
          </button>)}
        </section>
        <section className="mt-4 grid gap-2 rounded-md border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-medium text-slate-400">我的工作流预设</h3>
            <span className="rounded border border-white/10 px-2 py-1 text-[11px] text-slate-400">{customWorkflowPresets.length} 个</span>
          </div>
          <label className="grid gap-1 text-xs text-slate-400">
            预设名称
            <input className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none" value={presetTitle} onChange={(event) => setPresetTitle(event.target.value)} />
          </label>
          <button disabled={!nodes.length} className="rounded-md border border-blue-400/30 bg-blue-500/10 px-3 py-2 text-left text-sm text-white hover:bg-blue-500/20 disabled:opacity-50" onClick={saveCurrentWorkflowAsPreset}>保存当前画布为预设</button>
          {customWorkflowPresets.map((preset) => <article key={preset.key} className="rounded-md border border-white/10 bg-black/15 p-2">
            <button className="w-full text-left" onClick={() => addCustomWorkflowPreset(preset.key)}>
              <span className="block text-sm font-medium text-white">{preset.title}</span>
              <span className="mt-1 block text-xs leading-5 text-slate-400">{preset.description}</span>
            </button>
            <button className="mt-2 rounded border border-red-400/30 px-2 py-1 text-xs text-red-100" onClick={() => deleteCustomWorkflowPreset(preset.key)}>删除预设</button>
          </article>)}
          {!customWorkflowPresets.length && <p className="rounded border border-white/10 px-2 py-2 text-xs text-slate-400">暂无自定义预设，可先搭建画布后保存。</p>}
        </section>
        <div className="mt-4 grid gap-4">
          {["平台生成", "素材节点", "基础节点"].map((category) => {
            const items = filteredAddableNodes.filter((item) => item.category === category);
            if (!items.length) return null;
            return <section key={category} className="grid gap-2">
              <h3 className="text-xs font-medium text-slate-400">{category}</h3>
              {items.map((item) => {
                const Icon = item.icon;
                return <button key={item.type} className="flex items-start gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-3 text-left hover:bg-white/10" onClick={() => addNode(item.type)}>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-white/10 text-slate-100"><Icon size={17} /></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-white">{item.label}</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-400">{item.description}</span>
                  </span>
                </button>;
              })}
            </section>;
          })}
        </div>
      </aside>}

      {showImport && <aside className="absolute left-20 top-28 z-30 w-[460px] rounded-lg border border-white/10 bg-slate-950/95 p-4 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-400">工作流复用</p>
            <h2 className="font-semibold">导入工作流 JSON</h2>
          </div>
          <button className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/10" onClick={() => setShowImport(false)}>关闭</button>
        </div>
        <textarea className="mt-3 min-h-64 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500" placeholder="粘贴从画布导出的 ProjectGraph JSON，导入后会追加到当前画布。" value={importText} onChange={(event) => setImportText(event.target.value)} />
        <div className="mt-3 flex items-center justify-between gap-2 text-sm">
          <span className="text-xs text-slate-400">导入会重置节点状态为草稿，并保留参数、位置和连线。</span>
          <button disabled={busy || !importText.trim()} className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 disabled:opacity-50" onClick={importWorkflowJson}><Upload size={15} />确认导入</button>
        </div>
      </aside>}

      {showValidation && <aside className="absolute left-20 top-28 z-30 max-h-[620px] w-[420px] overflow-auto rounded-lg border border-white/10 bg-slate-950/95 p-4 shadow-2xl backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-400">运行前检查</p>
            <h2 className="font-semibold">画布自检</h2>
          </div>
          <button className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/10" onClick={() => setShowValidation(false)}>关闭</button>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-300">
          <span className="rounded border border-white/10 px-2 py-2">节点 {nodes.length}</span>
          <span className="rounded border border-white/10 px-2 py-2">错误 {graphValidation.errorCount}</span>
          <span className="rounded border border-white/10 px-2 py-2">提醒 {graphValidation.warningCount}</span>
        </div>
        <div className="mt-3 grid gap-2 text-sm">
          {graphValidation.issues.map((issue) => <article key={issue.id} className={`rounded-md border px-3 py-2 ${issue.level === "error" ? "border-red-400/30 bg-red-500/10" : "border-amber-400/30 bg-amber-500/10"}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <strong className="block text-white">{issue.title}</strong>
                <span className="mt-1 block text-xs leading-5 text-slate-300">{issue.detail}</span>
              </div>
              {issue.nodeId && <button className="shrink-0 rounded border border-white/10 px-2 py-1 text-xs text-white" onClick={() => focusCanvasNode(issue.nodeId || "")}>定位</button>}
            </div>
          </article>)}
          {!graphValidation.issues.length && <p className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-emerald-100">自检通过，当前画布没有发现阻断性问题。</p>}
        </div>
      </aside>}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={setFlowInstance}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDoubleClick={handleCanvasDoubleClick}
        onDragOver={handleCanvasDragOver}
        onDrop={handleCanvasDrop}
        onNodeClick={(_, node) => setSelectedNodeId(node.id)}
        fitView
        className="h-full w-full"
      >
        <Background color="#334155" gap={24} />
        <Controls className="!bottom-6 !left-1/2 !-translate-x-1/2 !rounded-lg !border !border-white/10 !bg-slate-950/90 !shadow-2xl" />
        <MiniMap className="!bottom-6 !right-6 !rounded-lg !border !border-white/10 !bg-slate-950/90" nodeColor="#2563eb" />
      </ReactFlow>

      <section className="absolute right-4 top-28 z-20 w-[360px] rounded-lg border border-white/10 bg-slate-950/90 p-4 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-400">参数面板</p>
            <h2 className="font-semibold">{selectedNode ? nodeLabels[selectedType] || "节点" : "未选择节点"}</h2>
          </div>
          {selectedNode && <button title="删除节点" className="rounded-md border border-white/10 p-2 text-slate-300 hover:bg-white/10" onClick={() => void deleteSelectedNode()}><Trash2 size={16} /></button>}
        </div>
        {selectedNode ? <div className="mt-4 grid gap-3 text-sm">
          <label className="grid gap-1"><span className="text-slate-400">标题</span><input className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" value={String(selectedData.title || "")} onChange={(event) => updateSelectedData("title", event.target.value)} /></label>
          {(selectedType === "text" || selectedType === "demo") && <label className="grid gap-1"><span className="text-slate-400">文本内容</span><textarea className="min-h-28 rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" value={String(selectedData.text || "")} onChange={(event) => updateSelectedData("text", event.target.value)} /></label>}
          {selectedType === "script" && <label className="grid gap-1"><span className="text-slate-400">脚本</span><textarea className="min-h-40 rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" value={String(selectedData.script || "")} onChange={(event) => updateSelectedData("script", event.target.value)} /></label>}
          {(selectedType === "image_generation" || selectedType === "video_generation") && <label className="grid gap-1"><span className="text-slate-400">提示词</span><textarea className="min-h-28 rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" value={String(selectedData.prompt || "")} onChange={(event) => updateSelectedData("prompt", event.target.value)} /></label>}
          {selectedType === "tts_generation" && <label className="grid gap-1"><span className="text-slate-400">旁白文本</span><textarea className="min-h-28 rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" value={String(selectedData.text || "")} onChange={(event) => updateSelectedData("text", event.target.value)} /></label>}
          {selectedType === "image" && <label className="grid gap-1"><span className="text-slate-400">图片 URL</span><input className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" value={String(selectedData.image_url || "")} onChange={(event) => updateSelectedData("image_url", event.target.value)} /></label>}
          {selectedType === "video" && <label className="grid gap-1"><span className="text-slate-400">视频 URL</span><input className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" value={String(selectedData.video_url || "")} onChange={(event) => updateSelectedData("video_url", event.target.value)} /></label>}
          {selectedType === "audio" && <label className="grid gap-1"><span className="text-slate-400">音频 URL</span><input className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" value={String(selectedData.audio_url || "")} onChange={(event) => updateSelectedData("audio_url", event.target.value)} /></label>}
          {selectedType.includes("generation") && selectedType !== "compose_generation" && <label className="grid gap-1"><span className="text-slate-400">绑定分镜</span><select className="rounded-md border border-white/10 bg-slate-900 px-3 py-2 outline-none" value={String(selectedData.shot_id || "")} onChange={(event) => updateSelectedData("shot_id", event.target.value)}>
            <option value="">从连线或运行时补全</option>
            {shotOptions.map((shot) => <option key={shot.id} value={shot.id}>分镜 {shot.index} · {shot.visual_description || shot.narration || shot.id}</option>)}
          </select></label>}
          {selectedType === "image_generation" && <div className="grid grid-cols-3 gap-2">
            <label className="grid gap-1"><span className="text-slate-400">宽度</span><input type="number" className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" value={String(selectedData.width || "768")} onChange={(event) => updateSelectedData("width", event.target.value)} /></label>
            <label className="grid gap-1"><span className="text-slate-400">高度</span><input type="number" className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" value={String(selectedData.height || "1344")} onChange={(event) => updateSelectedData("height", event.target.value)} /></label>
            <label className="grid gap-1"><span className="text-slate-400">种子</span><input type="number" className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" value={String(selectedData.seed || "-1")} onChange={(event) => updateSelectedData("seed", event.target.value)} /></label>
          </div>}
          {selectedType === "video_generation" && <label className="grid gap-1"><span className="text-slate-400">首帧图片 URL</span><input className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" value={String(selectedData.first_frame_url || "")} onChange={(event) => updateSelectedData("first_frame_url", event.target.value)} /></label>}
          {selectedType === "video_generation" && <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1"><span className="text-slate-400">时长</span><input type="number" step="0.5" className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" value={String(selectedData.duration || "4")} onChange={(event) => updateSelectedData("duration", event.target.value)} /></label>
            <label className="grid gap-1"><span className="text-slate-400">帧率</span><input type="number" className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" value={String(selectedData.fps || "16")} onChange={(event) => updateSelectedData("fps", event.target.value)} /></label>
          </div>}
          {selectedType === "tts_generation" && <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1"><span className="text-slate-400">音色</span><select className="rounded-md border border-white/10 bg-slate-900 px-3 py-2 outline-none" value={String(selectedData.voice || "zh-CN-XiaoxiaoNeural")} onChange={(event) => updateSelectedData("voice", event.target.value)}>
              <option value="zh-CN-XiaoxiaoNeural">晓晓</option>
              <option value="zh-CN-YunxiNeural">云希</option>
              <option value="zh-CN-XiaoyiNeural">晓伊</option>
            </select></label>
            <label className="grid gap-1"><span className="text-slate-400">语速</span><input type="number" step="0.1" className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" value={String(selectedData.rate || "1")} onChange={(event) => updateSelectedData("rate", event.target.value)} /></label>
          </div>}
          {selectedType === "compose_generation" && <label className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/5 px-3 py-2"><span className="text-slate-300">合成字幕</span><input type="checkbox" checked={selectedData.subtitle !== false} onChange={(event) => updateSelectedData("subtitle", event.target.checked)} /></label>}
          {String(selectedData.task_id || "") && <section className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-slate-400">运行诊断</p>
                <strong className="text-sm text-white">{selectedTask ? statusText(selectedTask.status) : "等待同步"}</strong>
              </div>
              <span className="max-w-[160px] truncate rounded bg-black/25 px-2 py-1 text-[11px] text-slate-300">{String(selectedData.task_id)}</span>
            </div>
            {selectedTask ? <div className="mt-3 grid gap-2 text-xs text-slate-300">
              <p>类型：{selectedTask.task_type} · 工作流：{selectedTask.workflow_key || "默认"}</p>
              {typeof selectedTask.progress === "number" && <p>进度：{selectedTask.progress}%</p>}
              {selectedTask.prompt_id && <p className="truncate">ComfyUI：{selectedTask.prompt_id}</p>}
              {selectedTask.error_message && <p className="rounded border border-red-400/30 bg-red-500/10 px-2 py-1 text-red-100">{selectedTask.error_message}</p>}
              {selectedTask.retry_advice && <p className="rounded border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-amber-100">{selectedTask.retry_advice}</p>}
              {!!selectedTask.events?.length && <div className="max-h-24 overflow-auto rounded border border-white/10 bg-black/20 px-2 py-1">
                {selectedTask.events.slice(-4).map((event, index) => <p key={`${event.created_at || "event"}-${index}`} className="truncate">{event.created_at || "刚刚"} · {event.message}</p>)}
              </div>}
              <div className="grid grid-cols-4 gap-1 pt-1">
                <button disabled={busy} className="rounded border border-white/10 px-2 py-1 disabled:opacity-50" onClick={() => void taskAction(selectedTask.id, "submit")}>提交</button>
                <button disabled={busy} className="rounded border border-white/10 px-2 py-1 disabled:opacity-50" onClick={() => void taskAction(selectedTask.id, "sync")}>同步</button>
                <button disabled={busy} className="rounded border border-white/10 px-2 py-1 disabled:opacity-50" onClick={() => void taskAction(selectedTask.id, "retry")}>重试</button>
                <button disabled={busy} className="rounded border border-red-400/30 px-2 py-1 text-red-100 disabled:opacity-50" onClick={() => void taskAction(selectedTask.id, "cancel")}>取消</button>
              </div>
            </div> : <p className="mt-2 text-xs text-slate-400">刷新任务队列后可查看进度、错误和 ComfyUI prompt_id。</p>}
          </section>}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 disabled:opacity-50" onClick={() => void runSelectedNode()}><Play size={16} />运行节点</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={() => void runSelectedChain()}><GitBranch size={16} />运行链路</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={duplicateSelectedNode}><Copy size={16} />复制节点</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={copySelectedChain}><ClipboardCopy size={16} />复制链路</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={pasteCopiedSelection}><ClipboardPaste size={16} />粘贴链路</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 text-slate-300 disabled:opacity-50" onClick={() => void deleteSelectedNode()}><Trash2 size={16} />删除节点</button>
          </div>
        </div> : <p className="mt-4 rounded-md border border-white/10 bg-white/5 p-3 text-sm text-slate-400">点击画布节点后可编辑参数、运行生成或删除节点。</p>}
      </section>

      {showAssets && <aside className="absolute bottom-6 left-24 z-20 max-h-[320px] w-[360px] overflow-auto rounded-lg border border-white/10 bg-slate-950/90 p-4 shadow-2xl backdrop-blur">
        <h2 className="font-semibold">项目素材库</h2>
        <div className="mt-3 grid gap-2 text-sm">
          {assets.map((asset) => <button key={asset.id} className="rounded-md border border-white/10 px-3 py-2 text-left text-slate-300 hover:bg-white/10" onClick={() => addAssetNode(asset)}>{asset.asset_type} · {asset.url || asset.id}</button>)}
          {!assets.length && <p className="rounded-md border border-white/10 px-3 py-2 text-slate-400">暂无素材，可先运行生成节点。</p>}
        </div>
      </aside>}

      {showShots && <aside className="absolute bottom-6 left-24 z-20 max-h-[420px] w-[440px] overflow-auto rounded-lg border border-white/10 bg-slate-950/90 p-4 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-400">项目分镜</p>
            <h2 className="font-semibold">分镜生成链路</h2>
          </div>
          <span className="rounded border border-white/10 px-2 py-1 text-xs text-slate-400">{shotOptions.length} 个</span>
        </div>
        <button disabled={!shotOptions.length} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-blue-400/40 bg-blue-500/10 px-3 py-2 text-sm text-white hover:bg-blue-500/20 disabled:opacity-50" onClick={addAllShotWorkflows}><GitBranch size={15} />添加全部分镜链路</button>
        <div className="mt-3 grid gap-2 text-sm">
          {shotOptions.map((shot) => <article key={shot.id} className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <strong className="block text-white">分镜 {shot.index}</strong>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-300">{shot.visual_description || "暂无画面描述"}</p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{shot.narration || "暂无旁白"}</p>
              </div>
              <span className="shrink-0 rounded bg-black/30 px-2 py-1 text-[11px] text-slate-300">{statusText(shot.generation_status || "draft")}</span>
            </div>
            <button className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-xs text-white hover:bg-blue-500" onClick={() => addShotWorkflow(shot)}><GitBranch size={14} />添加分镜链路</button>
          </article>)}
          {!shotOptions.length && <p className="rounded-md border border-white/10 px-3 py-2 text-slate-400">暂无分镜，请先从创作入口生成脚本分镜。</p>}
        </div>
      </aside>}

      {showTasks && <aside className="absolute bottom-6 left-[500px] z-20 max-h-[320px] w-[380px] overflow-auto rounded-lg border border-white/10 bg-slate-950/90 p-4 shadow-2xl backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-400">生成过程追踪</p>
            <h2 className="font-semibold">任务队列</h2>
          </div>
          <div className="flex flex-wrap justify-end gap-1 text-[11px] text-slate-300">
            {Object.entries(taskStatusCounts).map(([taskStatus, count]) => <span key={taskStatus} className="rounded border border-white/10 px-2 py-1">{statusText(taskStatus)} {count}</span>)}
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-sm">
          {tasks.map((task) => <article key={task.id} className="rounded-md border border-white/10 px-3 py-2 text-slate-300">
            <button className="w-full text-left hover:text-white" onClick={() => focusTaskNode(task.id)}>
              <span className="block text-white">{task.task_type} · {statusText(task.status)}</span>
              <span className="mt-1 block truncate text-xs text-slate-400">{task.workflow_key || "workflow"} · {task.prompt_id || task.id}</span>
              {task.error_message && <span className="mt-1 block rounded border border-red-400/30 bg-red-500/10 px-2 py-1 text-xs text-red-100">{task.error_message}</span>}
            </button>
            <div className="mt-2 grid grid-cols-4 gap-1 text-xs">
              <button disabled={busy} className="rounded border border-white/10 px-2 py-1 disabled:opacity-50" onClick={() => void taskAction(task.id, "submit")}>提交</button>
              <button disabled={busy} className="rounded border border-white/10 px-2 py-1 disabled:opacity-50" onClick={() => void taskAction(task.id, "sync")}>同步</button>
              <button disabled={busy} className="rounded border border-white/10 px-2 py-1 disabled:opacity-50" onClick={() => void taskAction(task.id, "retry")}>重试</button>
              <button disabled={busy} className="rounded border border-red-400/30 px-2 py-1 text-red-100 disabled:opacity-50" onClick={() => void taskAction(task.id, "cancel")}>取消</button>
            </div>
          </article>)}
          {!tasks.length && <p className="rounded-md border border-white/10 px-3 py-2 text-slate-400">暂无生成任务</p>}
        </div>
      </aside>}
    </main>
  );
}
