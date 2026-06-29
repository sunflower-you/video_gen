
"use client";

import { useEffect, useMemo, useState, type ChangeEvent as ReactChangeEvent, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
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
import { AlertTriangle, AlignHorizontalDistributeCenter, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd, AlignHorizontalJustifyStart, AlignVerticalDistributeCenter, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart, Ban, Boxes, BringToFront, CheckSquare, Clapperboard, ClipboardCopy, ClipboardPaste, Copy, Download, FileText, Focus, GitBranch, Image, LayoutGrid, Library, ListTree, Lock, Map as MapIcon, Maximize2, Minimize2, Music, Play, Plus, Redo2, RefreshCcw, RotateCcw, Save, Scissors, Search, SendToBack, Sparkles, Trash2, Undo2, Unlock, Upload, Video, Wand2, XSquare, ZoomIn, ZoomOut } from "lucide-react";
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

const nodeMarkerColors: { value: string; label: string; className: string }[] = [
  { value: "", label: "跟随类型", className: "" },
  { value: "blue", label: "蓝色", className: "border-blue-400 bg-blue-950/80" },
  { value: "emerald", label: "绿色", className: "border-emerald-400 bg-emerald-950/80" },
  { value: "amber", label: "黄色", className: "border-amber-400 bg-amber-950/80" },
  { value: "rose", label: "红色", className: "border-rose-400 bg-rose-950/80" },
  { value: "violet", label: "紫色", className: "border-violet-400 bg-violet-950/80" }
];

const nodeMarkerColorByValue = new Map(nodeMarkerColors.map((item) => [item.value, item]));

const edgeMarkerColors: { value: string; label: string; stroke: string }[] = [
  { value: "", label: "默认", stroke: "" },
  { value: "blue", label: "蓝色", stroke: "#60a5fa" },
  { value: "emerald", label: "绿色", stroke: "#34d399" },
  { value: "amber", label: "黄色", stroke: "#fbbf24" },
  { value: "rose", label: "红色", stroke: "#fb7185" },
  { value: "violet", label: "紫色", stroke: "#a78bfa" }
];

const edgeMarkerColorByValue = new Map(edgeMarkerColors.map((item) => [item.value, item]));

const edgeLineStyles: { value: string; label: string; strokeDasharray?: string; strokeWidth?: number }[] = [
  { value: "", label: "默认实线" },
  { value: "dashed", label: "虚线参考", strokeDasharray: "8 5" },
  { value: "bold", label: "重点主链路", strokeWidth: 3 }
];

const edgeLineStyleByValue = new Map(edgeLineStyles.map((item) => [item.value, item]));

type NodePort = {
  id: string;
  label: string;
  side: "input" | "output";
  tone?: "text" | "image" | "video" | "audio" | "final";
};

const portColors: Record<NonNullable<NodePort["tone"]> | "default", string> = {
  text: "!bg-sky-500",
  image: "!bg-emerald-500",
  video: "!bg-violet-500",
  audio: "!bg-amber-500",
  final: "!bg-rose-500",
  default: "!bg-slate-600"
};

function semanticPortsForType(type: string): NodePort[] {
  const common: NodePort[] = [
    { id: "input", label: "输入", side: "input" },
    { id: "output", label: "输出", side: "output" }
  ];
  const map: Record<string, NodePort[]> = {
    text: [
      { id: "input", label: "参考", side: "input", tone: "text" },
      { id: "output", label: "文本", side: "output", tone: "text" }
    ],
    image: [
      { id: "input", label: "参考", side: "input", tone: "image" },
      { id: "output", label: "图片", side: "output", tone: "image" }
    ],
    video: [
      { id: "input", label: "参考", side: "input", tone: "video" },
      { id: "output", label: "视频", side: "output", tone: "video" }
    ],
    audio: [
      { id: "input", label: "参考", side: "input", tone: "audio" },
      { id: "output", label: "音频", side: "output", tone: "audio" }
    ],
    script: [
      { id: "input", label: "参考", side: "input", tone: "text" },
      { id: "output", label: "脚本", side: "output", tone: "text" }
    ],
    image_generation: [
      { id: "input", label: "提示词", side: "input", tone: "text" },
      { id: "reference", label: "参考图", side: "input", tone: "image" },
      { id: "output", label: "分镜图", side: "output", tone: "image" }
    ],
    video_generation: [
      { id: "input", label: "提示词", side: "input", tone: "text" },
      { id: "first_frame", label: "首帧", side: "input", tone: "image" },
      { id: "output", label: "镜头视频", side: "output", tone: "video" }
    ],
    tts_generation: [
      { id: "input", label: "旁白", side: "input", tone: "text" },
      { id: "output", label: "配音", side: "output", tone: "audio" }
    ],
    compose_generation: [
      { id: "input", label: "输入", side: "input", tone: "final" },
      { id: "video", label: "视频", side: "input", tone: "video" },
      { id: "audio", label: "音频", side: "input", tone: "audio" },
      { id: "subtitle", label: "字幕", side: "input", tone: "text" },
      { id: "output", label: "成片", side: "output", tone: "final" }
    ]
  };
  return map[type] || common;
}

function semanticPortsForNode(node: Node | null, side: NodePort["side"]) {
  if (!node) return [];
  const type = String((node.data as Record<string, unknown>).nodeType || "text");
  return semanticPortsForType(type).filter((port) => port.side === side);
}

function portTop(index: number, total: number) {
  return `${Math.round(((index + 1) * 100) / (total + 1))}%`;
}

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

function isNodeDisabled(node: Node) {
  return (node.data as Record<string, unknown>).disabled === true;
}

function isEdgeDisabled(edge: Edge) {
  return (edge.data as Record<string, unknown> | undefined)?.disabled === true;
}

function activeGraphEdges(edges: Edge[]) {
  return edges.filter((edge) => !isEdgeDisabled(edge));
}

function edgeWithDefaultHandles(edge: Edge): Edge {
  const disabled = isEdgeDisabled(edge);
  const data = (edge.data as Record<string, unknown> | undefined) || {};
  const edgeColor = edgeMarkerColorByValue.get(String(data.edge_color || ""));
  const lineStyle = edgeLineStyleByValue.get(String(data.edge_style || "")) || edgeLineStyleByValue.get("");
  const style = {
    ...(edgeColor?.stroke ? { stroke: edgeColor.stroke } : {}),
    ...(lineStyle?.strokeDasharray ? { strokeDasharray: lineStyle.strokeDasharray } : {}),
    ...(lineStyle?.strokeWidth ? { strokeWidth: lineStyle.strokeWidth } : {}),
    ...(disabled ? { strokeDasharray: "6 4", opacity: 0.45 } : {})
  };
  return {
    ...edge,
    sourceHandle: edge.sourceHandle || "output",
    targetHandle: edge.targetHandle || "input",
    animated: !disabled,
    style: Object.keys(style).length ? style : undefined
  };
}

function connectionEndpointKey(connection: Pick<Edge, "source" | "target"> & { sourceHandle?: string | null; targetHandle?: string | null }) {
  return `${connection.source}:${connection.sourceHandle || "output"}->${connection.target}:${connection.targetHandle || "input"}`;
}

function connectionIssueMessage(connection: { source?: string | null; target?: string | null; sourceHandle?: string | null; targetHandle?: string | null }, edges: Edge[], excludeEdgeId = "") {
  const source = connection.source || "";
  const target = connection.target || "";
  if (!source || !target) return "连线缺少起点或终点，请从节点输出连接桩拖到目标输入连接桩。";
  if (source === target) return "不能把节点连接到自身，请选择另一个目标节点。";
  const candidateKey = connectionEndpointKey({ source, target, sourceHandle: connection.sourceHandle, targetHandle: connection.targetHandle });
  const duplicated = edges.some((edge) => edge.id !== excludeEdgeId && connectionEndpointKey(edge) === candidateKey);
  return duplicated ? "这两个端口已经存在连线，请勿重复连接。" : "";
}

function mediaUrlFromData(data: Record<string, unknown>) {
  return String(data.image_url || data.video_url || data.audio_url || data.first_frame_url || data.output_url || data.result_url || data.final_video_url || "");
}

function mediaKindFromData(data: Record<string, unknown>, fallbackType = "") {
  if (data.image_url || data.first_frame_url) return "image";
  if (data.video_url || data.final_video_url) return "video";
  if (data.audio_url) return "audio";
  const url = mediaUrlFromData(data).toLowerCase();
  if (/\.(mp4|mov|webm|m4v)(\?|$)/.test(url)) return "video";
  if (/\.(mp3|wav|m4a|aac|ogg)(\?|$)/.test(url)) return "audio";
  if (/\.(png|jpe?g|webp|gif|avif)(\?|$)/.test(url)) return "image";
  return fallbackType === "video" || fallbackType === "audio" ? fallbackType : "image";
}

function MediaPreview({ data, title, compact = false }: { data: Record<string, unknown>; title: string; compact?: boolean }) {
  const url = mediaUrlFromData(data);
  if (!url) return null;
  const kind = mediaKindFromData(data, String(data.nodeType || ""));
  if (kind === "video") {
    return <video src={url} controls={!compact} muted={compact} className={`${compact ? "aspect-video" : "max-h-52"} w-full rounded-md bg-black object-cover`} />;
  }
  if (kind === "audio") {
    return <audio src={url} controls className="w-full" />;
  }
  return <img src={url} alt={title} className={`${compact ? "aspect-video" : "max-h-52"} w-full rounded-md bg-black object-cover`} />;
}

function PlatformNode({ data, selected }: NodeProps) {
  const payload = data as Record<string, unknown>;
  const type = String(payload.nodeType || "text");
  const ports = semanticPortsForType(type);
  const inputPorts = ports.filter((port) => port.side === "input");
  const outputPorts = ports.filter((port) => port.side === "output");
  const title = String(payload.title || nodeLabels[type] || "节点");
  const summary = String(payload.text || payload.script || payload.prompt || payload.narration || payload.result_summary || payload.workflow_key || "等待编辑参数");
  const status = String(payload.status || "draft");
  const locked = payload.locked === true;
  const disabled = payload.disabled === true;
  const groupTitle = String(payload.group_title || "");
  const note = String(payload.note || "");
  const markerColor = nodeMarkerColorByValue.get(String(payload.node_color || ""));
  const colorClassName = markerColor?.className || nodeColors[type] || nodeColors.demo;
  const collapsed = payload.collapsed === true;
  return (
    <div className={`relative w-[240px] rounded-lg border p-3 text-white shadow-xl ${colorClassName} ${selected ? "ring-2 ring-white" : ""} ${disabled ? "opacity-60 grayscale" : ""}`}>
      {inputPorts.map((port, index) => (
        <Handle
          key={port.id}
          id={port.id}
          type="target"
          position={Position.Left}
          title={port.label}
          style={{ top: portTop(index, inputPorts.length) }}
          className={`!h-4 !w-4 !border-2 !border-white ${portColors[port.tone || "default"]}`}
        />
      ))}
      {outputPorts.map((port, index) => (
        <Handle
          key={port.id}
          id={port.id}
          type="source"
          position={Position.Right}
          title={port.label}
          style={{ top: portTop(index, outputPorts.length) }}
          className={`!h-4 !w-4 !border-2 !border-white ${portColors[port.tone || "default"]}`}
        />
      ))}
      <div className="flex items-center justify-between gap-2">
        <strong className="truncate text-sm">{title}</strong>
        <span className="inline-flex items-center gap-1 rounded bg-black/30 px-2 py-1 text-[11px]">{disabled ? <Ban size={11} /> : locked ? <Lock size={11} /> : null}{disabled ? "已禁用" : statusText(status)}</span>
      </div>
      {collapsed && <p className="mt-2 inline-flex rounded border border-white/10 bg-black/25 px-2 py-1 text-[11px] text-slate-100">已折叠</p>}
      {markerColor?.value && <p className="mt-2 inline-flex rounded border border-white/10 bg-black/25 px-2 py-1 text-[11px] text-slate-100">标记：{markerColor.label}</p>}
      {groupTitle && <p className="mt-2 truncate rounded border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-slate-200">组：{groupTitle}</p>}
      {!collapsed && mediaUrlFromData(payload) && <div className="mt-2 overflow-hidden rounded-md border border-white/10 bg-black/30"><MediaPreview data={payload} title={title} compact /></div>}
      {!collapsed && <p className="mt-2 line-clamp-3 text-xs text-slate-200">{summary}</p>}
      {!collapsed && note && <p className="mt-2 line-clamp-2 rounded border border-white/10 bg-white/10 px-2 py-1 text-[11px] text-slate-100">备注：{note}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/10 pt-2 text-[10px] text-slate-200">
        <div className="flex min-w-0 flex-wrap gap-1">
          {inputPorts.map((port) => <span key={port.id} className="rounded bg-black/25 px-1.5 py-0.5">{port.label}</span>)}
        </div>
        <div className="flex min-w-0 flex-wrap justify-end gap-1">
          {outputPorts.map((port) => <span key={port.id} className="rounded bg-white/10 px-1.5 py-0.5">{port.label}</span>)}
        </div>
      </div>
      {String(payload.task_id || "") && <p className="mt-2 truncate text-[11px] text-slate-300">任务：{String(payload.task_id)}</p>}
    </div>
  );
}

const nodeTypes = { platform: PlatformNode };

function toFlowNode(item: ProjectGraphNode): Node {
  const layerZ = Number(item.data?.layer_z);
  return {
    id: item.id,
    type: "platform",
    position: item.position,
    zIndex: Number.isFinite(layerZ) ? layerZ : 0,
    draggable: item.data?.locked !== true,
    data: { ...item.data, nodeType: item.type, graphNodeId: item.id, status: item.status || "draft" }
  };
}

function fromFlowNode(item: Node): ProjectGraphNode {
  const data = { ...(item.data as Record<string, unknown>) };
  if (typeof item.zIndex === "number" && Number.isFinite(item.zIndex)) data.layer_z = item.zIndex;
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
  const data = edge.data || {};
  const label = typeof data.label === "string" ? data.label : "";
  return edgeWithDefaultHandles({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle || undefined,
    targetHandle: edge.targetHandle || undefined,
    label,
    data
  });
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
  const activeEdges = activeGraphEdges(edges);
  const visited = new Set<string>();
  const walk = (nodeId: string) => {
    for (const edge of activeEdges) {
      if (edge.target !== nodeId || visited.has(edge.source)) continue;
      visited.add(edge.source);
      walk(edge.source);
    }
  };
  walk(targetId);
  return visited;
}

function downstreamNodeIds(sourceId: string, edges: Edge[]) {
  const activeEdges = activeGraphEdges(edges);
  const visited = new Set<string>();
  const walk = (nodeId: string) => {
    for (const edge of activeEdges) {
      if (edge.source !== nodeId || visited.has(edge.target)) continue;
      visited.add(edge.target);
      walk(edge.target);
    }
  };
  walk(sourceId);
  return visited;
}

function orderedChainNodes(targetId: string, nodes: Node[], edges: Edge[]) {
  const activeEdges = activeGraphEdges(edges);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const ordered: Node[] = [];
  const walk = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    for (const edge of activeEdges) {
      if (edge.target === nodeId) walk(edge.source);
    }
    const node = nodeById.get(nodeId);
    if (node) ordered.push(node);
  };
  walk(targetId);
  return ordered;
}

function terminalNodeIds(nodes: Node[], edges: Edge[]) {
  const sourceIds = new Set(activeGraphEdges(edges).map((edge) => edge.source));
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
  const activeEdges = activeGraphEdges(edges);
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const edge of activeEdges) {
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
  return activeGraphEdges(edges)
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

type UpstreamInputEntry = {
  key: string;
  label: string;
  value: string;
};

function upstreamInputEntries(nodeType: string, incoming: Record<string, unknown>[]) {
  const specs = nodeType === "image_generation"
    ? [
        { key: "shot_id", label: "分镜", keys: ["shot_id"] },
        { key: "prompt", label: "提示词", keys: ["prompt", "text", "script", "narration"] }
      ]
    : nodeType === "video_generation"
      ? [
          { key: "shot_id", label: "分镜", keys: ["shot_id"] },
          { key: "prompt", label: "动作提示词", keys: ["prompt", "text", "script", "narration"] },
          { key: "first_frame_url", label: "首帧图片", keys: ["image_url", "first_frame_url"] }
        ]
      : nodeType === "tts_generation"
        ? [{ key: "text", label: "旁白文本", keys: ["narration", "text", "script"] }]
        : nodeType === "compose_generation"
          ? [
              { key: "video_url", label: "视频输入", keys: ["video_url", "output_url", "final_video_url"] },
              { key: "audio_url", label: "音频输入", keys: ["audio_url"] }
            ]
          : [
              { key: "text", label: "文本", keys: ["text", "prompt", "script", "narration"] },
              { key: "image_url", label: "图片", keys: ["image_url", "first_frame_url"] },
              { key: "video_url", label: "视频", keys: ["video_url", "final_video_url"] },
              { key: "audio_url", label: "音频", keys: ["audio_url"] }
            ];
  return specs.flatMap((spec) => {
    const value = firstNonEmpty(incoming, ...spec.keys);
    return value ? [{ key: spec.key, label: spec.label, value }] : [];
  }) satisfies UpstreamInputEntry[];
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
  const activeEdges = activeGraphEdges(edges);
  const issues: GraphValidationIssue[] = [];
  for (const edge of edges) {
    const connectionIssue = connectionIssueMessage(edge, edges, edge.id);
    if (connectionIssue) {
      issues.push({
        id: `invalid-edge-${edge.id}`,
        level: "error",
        title: "连线规则冲突",
        detail: `${connectionIssue} 连线 ${edge.id} 暂不能参与稳定运行。`
      });
    }
    if (isEdgeDisabled(edge)) {
      issues.push({
        id: `disabled-edge-${edge.id}`,
        level: "warning",
        title: "连线已禁用",
        detail: `连线 ${edge.id} 会保留在画布中，但不会参与上游输入、整理和运行。`
      });
    }
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
    const incoming = incomingNodeData(node.id, nodes, activeEdges);
    const title = String(data.title || nodeLabels[type] || node.id);
    const hasIncoming = activeEdges.some((edge) => edge.target === node.id);
    const hasOutgoing = activeEdges.some((edge) => edge.source === node.id);
    if (data.disabled === true) {
      issues.push({ id: `disabled-${node.id}`, level: "warning", nodeId: node.id, title: "节点已禁用", detail: `${title} 会保留在画布中，但运行链路和全图时会跳过。` });
      continue;
    }
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

type GraphHistorySnapshot = {
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string;
  selectedEdgeId: string;
};

type CanvasViewport = { x: number; y: number; zoom: number };
type CanvasViewBookmark = { key: string; title: string; viewport: CanvasViewport; created_at: string };
type CanvasGraphVersion = { key: string; title: string; nodes: ProjectGraphNode[]; edges: ProjectGraph["edges"]; viewport: CanvasViewport; created_at: string };

const customPresetStorageKey = "video_gen_canvas_custom_presets";
const recentNodeStorageKey = "video_gen_canvas_recent_nodes";
const viewBookmarkStoragePrefix = "video_gen_canvas_view_bookmarks";
const graphVersionStoragePrefix = "video_gen_canvas_graph_versions";
const paletteNodeDragType = "application/x-video-gen-node-type";
const defaultCanvasViewport: CanvasViewport = { x: 0, y: 0, zoom: 1 };

export function CanvasWorkspace({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState("");
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [initialViewport, setInitialViewport] = useState<CanvasViewport>(defaultCanvasViewport);
  const [copiedSelection, setCopiedSelection] = useState<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [status, setStatus] = useState("正在加载全画幅创作画布...");
  const [showAssets, setShowAssets] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const [showShots, setShowShots] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const [showViewBookmarks, setShowViewBookmarks] = useState(false);
  const [showGraphVersions, setShowGraphVersions] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [showPalette, setShowPalette] = useState(true);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [commandQuery, setCommandQuery] = useState("");
  const [outlineQuery, setOutlineQuery] = useState("");
  const [outlineIssuesOnly, setOutlineIssuesOnly] = useState(false);
  const [assetTypeFilter, setAssetTypeFilter] = useState("all");
  const [taskStatusFilter, setTaskStatusFilter] = useState("all");
  const [assetQuery, setAssetQuery] = useState("");
  const [taskQuery, setTaskQuery] = useState("");
  const [shotStatusFilter, setShotStatusFilter] = useState("all");
  const [shotQuery, setShotQuery] = useState("");
  const [shotSort, setShotSort] = useState("index-asc");
  const [shotWorkflowFilter, setShotWorkflowFilter] = useState("all");
  const [selectedShotIds, setSelectedShotIds] = useState<string[]>([]);
  const [importText, setImportText] = useState("");
  const [customWorkflowPresets, setCustomWorkflowPresets] = useState<CustomWorkflowPreset[]>([]);
  const [recentNodeTypes, setRecentNodeTypes] = useState<string[]>([]);
  const [presetTitle, setPresetTitle] = useState("自定义工作流");
  const [viewBookmarks, setViewBookmarks] = useState<CanvasViewBookmark[]>([]);
  const [viewBookmarkTitle, setViewBookmarkTitle] = useState("当前视图");
  const [graphVersions, setGraphVersions] = useState<CanvasGraphVersion[]>([]);
  const [graphVersionTitle, setGraphVersionTitle] = useState("当前画布版本");
  const [selectedRenamePrefix, setSelectedRenamePrefix] = useState("镜头节点");
  const [nodeContextMenu, setNodeContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [edgeContextMenu, setEdgeContextMenu] = useState<{ edgeId: string; x: number; y: number } | null>(null);
  const [graphPast, setGraphPast] = useState<GraphHistorySnapshot[]>([]);
  const [graphFuture, setGraphFuture] = useState<GraphHistorySnapshot[]>([]);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [selectionOnDrag, setSelectionOnDrag] = useState(false);
  const [linkedNodeIdHandled, setLinkedNodeIdHandled] = useState("");
  const [linkedEdgeIdHandled, setLinkedEdgeIdHandled] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedNode = useMemo(() => nodes.find((item) => item.id === selectedNodeId) || null, [nodes, selectedNodeId]);
  const selectedEdge = useMemo(() => edges.find((item) => item.id === selectedEdgeId) || null, [edges, selectedEdgeId]);
  const selectedNodes = useMemo(() => {
    const picked = nodes.filter((item) => item.selected);
    if (picked.length) return picked;
    return selectedNode ? [selectedNode] : [];
  }, [nodes, selectedNode]);
  const selectedNodeIds = useMemo(() => new Set(selectedNodes.map((item) => item.id)), [selectedNodes]);
  const selectedEdges = useMemo(() => {
    const picked = edges.filter((item) => item.selected);
    if (picked.length) return picked;
    return selectedEdge ? [selectedEdge] : [];
  }, [edges, selectedEdge]);
  const selectedSelectionEdges = useMemo(() => edges.filter((edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target)), [edges, selectedNodeIds]);
  const selectedGroupTitles = useMemo(() => {
    const titles = new Set(selectedNodes.map((node) => String((node.data as Record<string, unknown>).group_title || "")).filter(Boolean));
    return [...titles];
  }, [selectedNodes]);
  const selectedGroupIds = useMemo(() => {
    const ids = new Set(selectedNodes.map((node) => String((node.data as Record<string, unknown>).group_id || "")).filter(Boolean));
    return ids;
  }, [selectedNodes]);
  const selectedGroupTitleValue = selectedGroupTitles.length === 1 ? selectedGroupTitles[0] : "";
  const shotOptions = useMemo(() => project?.shots || [], [project]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const selectedTask = useMemo(() => {
    const taskId = String((selectedNode?.data as Record<string, unknown> | undefined)?.task_id || "");
    return taskId ? taskById.get(taskId) || null : null;
  }, [selectedNode, taskById]);
  const selectedIncomingData = useMemo(() => selectedNode ? incomingNodeData(selectedNode.id, nodes, edges) : [], [selectedNode, nodes, edges]);
  const selectedUpstreamInputs = useMemo(() => selectedNode ? upstreamInputEntries(String((selectedNode.data as Record<string, unknown>).nodeType || "text"), selectedIncomingData) : [], [selectedNode, selectedIncomingData]);
  const taskStatusCounts = useMemo(() => tasks.reduce<Record<string, number>>((counts, task) => {
    counts[task.status] = (counts[task.status] || 0) + 1;
    return counts;
  }, {}), [tasks]);
  const shotStatusCounts = useMemo(() => shotOptions.reduce<Record<string, number>>((counts, shot) => {
    const shotStatus = shot.generation_status || "draft";
    counts[shotStatus] = (counts[shotStatus] || 0) + 1;
    return counts;
  }, {}), [shotOptions]);
  const assetTypeCounts = useMemo(() => assets.reduce<Record<string, number>>((counts, asset) => {
    counts[asset.asset_type] = (counts[asset.asset_type] || 0) + 1;
    return counts;
  }, {}), [assets]);
  const assetTypeFilterOptions = useMemo(() => ["all", ...Object.keys(assetTypeCounts).sort()], [assetTypeCounts]);
  const taskStatusFilterOptions = useMemo(() => ["all", ...Object.keys(taskStatusCounts).sort()], [taskStatusCounts]);
  const shotStatusFilterOptions = useMemo(() => ["all", ...Object.keys(shotStatusCounts).sort()], [shotStatusCounts]);
  const shotWorkflowShotIds = useMemo(() => new Set(nodes.map((node) => String((node.data as Record<string, unknown>).shot_id || "")).filter(Boolean)), [nodes]);
  const shotWorkflowCounts = useMemo(() => {
    const linked = shotOptions.filter((shot) => shotWorkflowShotIds.has(shot.id)).length;
    return { linked, unlinked: shotOptions.length - linked };
  }, [shotOptions, shotWorkflowShotIds]);
  const filteredShots = useMemo(() => {
    const keyword = shotQuery.trim().toLowerCase();
    const statusRank: Record<string, number> = { failed: 0, running: 1, pending: 2, draft: 3, completed: 4, cancelled: 5 };
    const result = shotOptions.filter((shot) => {
      const shotStatus = shot.generation_status || "draft";
      const matchesStatus = shotStatusFilter === "all" || shotStatus === shotStatusFilter;
      const isLinked = shotWorkflowShotIds.has(shot.id);
      const matchesWorkflow = shotWorkflowFilter === "all" || (shotWorkflowFilter === "linked" ? isLinked : !isLinked);
      const text = `${shot.index} ${shot.id} ${shot.narration || ""} ${shot.visual_description || ""} ${shot.prompt || ""} ${shot.negative_prompt || ""} ${(shot.characters || []).join(" ")}`.toLowerCase();
      return matchesStatus && matchesWorkflow && (!keyword || text.includes(keyword));
    });
    return [...result].sort((left, right) => {
      if (shotSort === "index-desc") return right.index - left.index;
      if (shotSort === "status") {
        const leftRank = statusRank[left.generation_status || "draft"] ?? 99;
        const rightRank = statusRank[right.generation_status || "draft"] ?? 99;
        return leftRank === rightRank ? left.index - right.index : leftRank - rightRank;
      }
      return left.index - right.index;
    });
  }, [shotOptions, shotQuery, shotSort, shotStatusFilter, shotWorkflowFilter, shotWorkflowShotIds]);
  const selectedFilteredShots = useMemo(() => {
    if (!selectedShotIds.length) return filteredShots;
    const selected = new Set(selectedShotIds);
    return filteredShots.filter((shot) => selected.has(shot.id));
  }, [filteredShots, selectedShotIds]);
  const filteredAssets = useMemo(() => {
    const keyword = assetQuery.trim().toLowerCase();
    return assets.filter((asset) => {
      const matchesType = assetTypeFilter === "all" || asset.asset_type === assetTypeFilter;
      const text = `${asset.asset_type} ${asset.id} ${asset.url || ""} ${asset.workflow_key || ""} ${asset.source_task_type || ""} ${asset.shot_index || ""}`.toLowerCase();
      return matchesType && (!keyword || text.includes(keyword));
    });
  }, [assetQuery, assetTypeFilter, assets]);
  const filteredTasks = useMemo(() => {
    const keyword = taskQuery.trim().toLowerCase();
    return tasks.filter((task) => {
      const matchesStatus = taskStatusFilter === "all" || task.status === taskStatusFilter;
      const text = `${task.task_type} ${task.status} ${task.workflow_key || ""} ${task.prompt_id || ""} ${task.id} ${task.error_message || ""} ${task.retry_advice || ""}`.toLowerCase();
      return matchesStatus && (!keyword || text.includes(keyword));
    });
  }, [taskQuery, taskStatusFilter, tasks]);
  const activeEdges = useMemo(() => activeGraphEdges(edges), [edges]);
  const graphValidation = useMemo(() => validateCanvasGraph(nodes, edges), [nodes, edges]);
  const selectedRunBlockingIssues = useMemo(() => selectedNode ? graphValidation.issues.filter((issue) => issue.level === "error" && issue.nodeId === selectedNode.id) : [], [graphValidation, selectedNode]);
  const graphOutlineNodes = useMemo(() => orderedGraphNodes(nodes, edges), [nodes, edges]);
  const outlineIssueNodeIds = useMemo(() => new Set(graphValidation.issues.map((issue) => issue.nodeId || "").filter(Boolean)), [graphValidation]);
  const filteredGraphOutlineNodes = useMemo(() => {
    const keyword = outlineQuery.trim().toLowerCase();
    return graphOutlineNodes.filter((node) => {
      const data = node.data as Record<string, unknown>;
      const type = String(data.nodeType || "text");
      const text = `${data.title || ""} ${nodeLabels[type] || type} ${data.status || ""} ${data.group_title || ""} ${data.note || ""}`.toLowerCase();
      const matchesKeyword = !keyword || text.includes(keyword);
      const matchesIssues = !outlineIssuesOnly || outlineIssueNodeIds.has(node.id);
      return matchesKeyword && matchesIssues;
    });
  }, [graphOutlineNodes, outlineIssueNodeIds, outlineIssuesOnly, outlineQuery]);
  const terminalNodeIdSet = useMemo(() => new Set(terminalNodeIds(nodes, edges)), [nodes, edges]);
  const filteredAddableNodes = useMemo(() => {
    const keyword = paletteQuery.trim().toLowerCase();
    return addableNodes.filter((item) => {
      const text = `${item.label} ${item.category} ${item.description} ${nodeLabels[item.type]}`.toLowerCase();
      return !keyword || text.includes(keyword);
    });
  }, [paletteQuery]);
  const recentAddableNodes = useMemo(() => recentNodeTypes.flatMap((type) => {
    const node = addableNodes.find((item) => item.type === type);
    if (!node) return [];
    if (paletteQuery.trim() && !filteredAddableNodes.some((item) => item.type === type)) return [];
    return [node];
  }), [filteredAddableNodes, paletteQuery, recentNodeTypes]);
  const viewBookmarkStorageKey = useMemo(() => `${viewBookmarkStoragePrefix}:${projectId}`, [projectId]);
  const graphVersionStorageKey = useMemo(() => `${graphVersionStoragePrefix}:${projectId}`, [projectId]);

  function cloneGraphSnapshot(snapshotNodes = nodes, snapshotEdges = edges, snapshotSelectedNodeId = selectedNodeId, snapshotSelectedEdgeId = selectedEdgeId): GraphHistorySnapshot {
    return {
      nodes: snapshotNodes.map((node) => ({ ...node, position: { ...node.position }, data: { ...(node.data as Record<string, unknown>) } })),
      edges: snapshotEdges.map((edge) => ({ ...edge, data: { ...(edge.data as Record<string, unknown> | undefined) } })),
      selectedNodeId: snapshotSelectedNodeId,
      selectedEdgeId: snapshotSelectedEdgeId
    };
  }

  function rememberGraphHistory() {
    setGraphPast((items) => [...items.slice(-19), cloneGraphSnapshot()]);
    setGraphFuture([]);
  }

  function restoreGraphSnapshot(snapshot: GraphHistorySnapshot) {
    setNodes(snapshot.nodes.map((node) => ({ ...node, position: { ...node.position }, data: { ...(node.data as Record<string, unknown>) } })));
    setEdges(snapshot.edges.map((edge) => ({ ...edge, data: { ...(edge.data as Record<string, unknown> | undefined) } })));
    setSelectedNodeId(snapshot.selectedNodeId);
    setSelectedEdgeId(snapshot.selectedEdgeId || "");
    setNodeContextMenu(null);
    setEdgeContextMenu(null);
  }

  function undoGraphChange() {
    if (!graphPast.length) {
      setStatus("暂无可撤销的画布操作。");
      return;
    }
    const previous = graphPast[graphPast.length - 1];
    setGraphPast(graphPast.slice(0, -1));
    setGraphFuture([cloneGraphSnapshot(), ...graphFuture].slice(0, 20));
    restoreGraphSnapshot(previous);
    setStatus("已撤销上一步画布操作。");
  }

  function redoGraphChange() {
    if (!graphFuture.length) {
      setStatus("暂无可重做的画布操作。");
      return;
    }
    const next = graphFuture[0];
    setGraphFuture(graphFuture.slice(1));
    setGraphPast([...graphPast.slice(-19), cloneGraphSnapshot()]);
    restoreGraphSnapshot(next);
    setStatus("已重做画布操作。");
  }

  useEffect(() => {
    void refreshAll();
  }, [projectId]);

  useEffect(() => {
    setLinkedNodeIdHandled("");
    setLinkedEdgeIdHandled("");
  }, [projectId]);

  useEffect(() => {
    if (!flowInstance) return;
    void flowInstance.setViewport(initialViewport, { duration: 0 });
  }, [flowInstance, initialViewport]);

  useEffect(() => {
    if (!flowInstance || !nodes.length) return;
    const linkedNodeId = new URLSearchParams(window.location.search).get("node") || "";
    if (!linkedNodeId || linkedNodeId === linkedNodeIdHandled) return;
    const linkedNode = nodes.find((node) => node.id === linkedNodeId);
    setLinkedNodeIdHandled(linkedNodeId);
    if (!linkedNode) {
      setStatus("节点链接已打开，但当前画布没有找到对应节点。");
      return;
    }
    setSelectedNodeId(linkedNode.id);
    setSelectedEdgeId("");
    setNodeContextMenu(null);
    setEdgeContextMenu(null);
    setNodes((items) => items.map((node) => ({ ...node, selected: node.id === linkedNode.id })));
    setEdges((items) => items.map((edge) => ({ ...edge, selected: false })));
    void flowInstance.setCenter(linkedNode.position.x + 120, linkedNode.position.y + 80, { duration: 420, zoom: 1 });
    setStatus("已通过节点链接定位到画布节点。");
  }, [flowInstance, linkedNodeIdHandled, nodes]);

  useEffect(() => {
    if (!flowInstance || !edges.length) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("node")) return;
    const linkedEdgeId = params.get("edge") || "";
    if (!linkedEdgeId || linkedEdgeId === linkedEdgeIdHandled) return;
    const linkedEdge = edges.find((edge) => edge.id === linkedEdgeId);
    setLinkedEdgeIdHandled(linkedEdgeId);
    if (!linkedEdge) {
      setStatus("连线链接已打开，但当前画布没有找到对应连线。");
      return;
    }
    setSelectedNodeId("");
    setSelectedEdgeId(linkedEdge.id);
    setNodeContextMenu(null);
    setEdgeContextMenu(null);
    setNodes((items) => items.map((node) => ({ ...node, selected: false })));
    setEdges((items) => items.map((edge) => ({ ...edge, selected: edge.id === linkedEdge.id })));
    const edgeNodes = nodes.filter((node) => node.id === linkedEdge.source || node.id === linkedEdge.target);
    if (edgeNodes.length) void flowInstance.fitView({ nodes: edgeNodes.map((node) => ({ id: node.id })), padding: 0.3, duration: 420, maxZoom: 1.1 });
    setStatus("已通过连线链接定位到画布连线。");
  }, [edges, flowInstance, linkedEdgeIdHandled, nodes]);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(customPresetStorageKey) || "[]");
      if (Array.isArray(saved)) setCustomWorkflowPresets(saved);
    } catch {
      window.localStorage.removeItem(customPresetStorageKey);
    }
  }, []);

  useEffect(() => {
    try {
      const allowed = new Set(addableNodes.map((item) => item.type));
      const saved = JSON.parse(window.localStorage.getItem(recentNodeStorageKey) || "[]");
      if (Array.isArray(saved)) setRecentNodeTypes(saved.map(String).filter((type) => allowed.has(type)).slice(0, 6));
    } catch {
      window.localStorage.removeItem(recentNodeStorageKey);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(viewBookmarkStorageKey) || "[]");
      if (Array.isArray(saved)) setViewBookmarks(saved.filter((item) => item?.viewport && Number.isFinite(item.viewport.x) && Number.isFinite(item.viewport.y) && Number.isFinite(item.viewport.zoom)));
    } catch {
      window.localStorage.removeItem(viewBookmarkStorageKey);
    }
  }, [viewBookmarkStorageKey]);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(graphVersionStorageKey) || "[]");
      if (Array.isArray(saved)) setGraphVersions(saved.filter((item) => Array.isArray(item?.nodes) && Array.isArray(item?.edges) && item?.viewport));
    } catch {
      window.localStorage.removeItem(graphVersionStorageKey);
    }
  }, [graphVersionStorageKey]);

  useEffect(() => {
    const handleCanvasKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowCommandPalette((value) => !value);
        setCommandQuery("");
        return;
      }
      if (event.key === "Escape" && showCommandPalette) {
        setShowCommandPalette(false);
        setCommandQuery("");
        return;
      }
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "Escape") {
        clearCanvasSelection();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        if (event.shiftKey) {
          invertCanvasSelection();
          return;
        }
        selectAllCanvasNodes();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveGraph();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undoGraphChange();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey))) {
        event.preventDefault();
        redoGraphChange();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
        event.preventDefault();
        if (selectedNodes.length > 1) copySelectedNodes();
        else copySelectedChain();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
        event.preventDefault();
        pasteCopiedSelection();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "x") {
        event.preventDefault();
        void cutSelectedNodes();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelectedNodes();
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
      if ((event.metaKey || event.ctrlKey) && (event.key === "+" || event.key === "=" || event.code === "NumpadAdd")) {
        event.preventDefault();
        zoomCanvas("in");
        return;
      }
      if ((event.metaKey || event.ctrlKey) && (event.key === "-" || event.code === "NumpadSubtract")) {
        event.preventDefault();
        zoomCanvas("out");
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "0") {
        event.preventDefault();
        resetCanvasViewport();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "1") {
        event.preventDefault();
        fitGraphView();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "2") {
        event.preventDefault();
        fitSelectedNodeView();
        return;
      }
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        const step = event.shiftKey ? 32 : snapToGrid ? 24 : 8;
        nudgeSelectedNodes(
          event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0,
          event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0
        );
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedNodes.length > 1) {
        event.preventDefault();
        void deleteSelectedNodes();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedNode) {
        event.preventDefault();
        void deleteSelectedNode();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedEdge) {
        event.preventDefault();
        deleteSelectedEdge();
      }
    };
    window.addEventListener("keydown", handleCanvasKeyDown);
    return () => window.removeEventListener("keydown", handleCanvasKeyDown);
  });

  function onNodesChange(changes: NodeChange[]) {
    if (changes.some((change) => change.type !== "select" && change.type !== "dimensions")) rememberGraphHistory();
    setNodes((items) => applyNodeChanges(changes, items));
  }

  function onEdgesChange(changes: EdgeChange[]) {
    if (changes.some((change) => change.type !== "select")) rememberGraphHistory();
    setEdges((items) => applyEdgeChanges(changes, items));
  }

  function onConnect(connection: Connection) {
    const issue = connectionIssueMessage(connection, edges);
    if (issue) {
      setStatus(issue);
      return;
    }
    rememberGraphHistory();
    const source = connection.source || "";
    const target = connection.target || "";
    setEdges((items) => addEdge(edgeWithDefaultHandles({
      source,
      target,
      id: `edge-${source}-${target}-${Date.now()}`,
      sourceHandle: connection.sourceHandle || "output",
      targetHandle: connection.targetHandle || "input",
      data: { label: "" }
    } satisfies Edge), items));
    setStatus("连线已创建，可在右侧面板编辑标签或禁用。");
  }

  function normalizedViewport(viewport: ProjectGraph["viewport"] | undefined): CanvasViewport {
    if (
      viewport &&
      Number.isFinite(viewport.x) &&
      Number.isFinite(viewport.y) &&
      Number.isFinite(viewport.zoom) &&
      viewport.zoom > 0
    ) {
      return { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
    }
    return defaultCanvasViewport;
  }

  function currentCanvasViewport(): CanvasViewport {
    return flowInstance?.getViewport() || initialViewport;
  }

  function currentViewportCenter() {
    const viewport = currentCanvasViewport();
    const zoom = viewport.zoom || 1;
    return {
      x: (window.innerWidth / 2 - viewport.x) / zoom,
      y: (window.innerHeight / 2 - viewport.y) / zoom
    };
  }

  function restoreCanvasViewport(viewport: ProjectGraph["viewport"] | undefined) {
    setInitialViewport(normalizedViewport(viewport));
  }

  function selectEdge(edgeId: string) {
    setSelectedEdgeId(edgeId);
    setSelectedNodeId("");
    setNodeContextMenu(null);
    setNodes((items) => items.map((node) => ({ ...node, selected: false })));
    setEdges((items) => items.map((edge) => ({ ...edge, selected: edge.id === edgeId })));
  }

  function openNodeContextMenu(event: ReactMouseEvent, nodeId: string) {
    event.preventDefault();
    setSelectedNodeId(nodeId);
    setSelectedEdgeId("");
    setEdgeContextMenu(null);
    setNodeContextMenu({ nodeId, x: event.clientX, y: event.clientY });
  }

  function openEdgeContextMenu(event: ReactMouseEvent, edgeId: string) {
    event.preventDefault();
    selectEdge(edgeId);
    setEdgeContextMenu({ edgeId, x: event.clientX, y: event.clientY });
  }

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
      restoreCanvasViewport(graphData?.viewport);
      setSelectedEdgeId("");
      setGraphPast([]);
      setGraphFuture([]);
      setAssets(assetResponse.ok ? await assetResponse.json() : []);
      setTasks(taskResponse.ok ? await taskResponse.json() : []);
      setStatus("全画幅创作画布已同步。");
    } catch (error) {
      const cached = window.localStorage.getItem(`project_graph_${projectId}`);
      if (cached) {
        const graph = JSON.parse(cached) as ProjectGraph;
        setNodes((graph.nodes || []).map(toFlowNode));
        setEdges((graph.edges || []).map(toFlowEdge));
        restoreCanvasViewport(graph.viewport);
        setSelectedEdgeId("");
        setGraphPast([]);
        setGraphFuture([]);
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
      viewport: currentCanvasViewport(),
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
      draggable: extraData.locked !== true,
      data: { ...buildNodeData(type), ...extraData, nodeType: type, graphNodeId: id, status: String(extraData.status || "draft") }
    };
    return node;
  }

  function rememberRecentNodeType(type: string) {
    if (!nodeLabels[type]) return;
    setRecentNodeTypes((items) => {
      const next = [type, ...items.filter((item) => item !== type)].slice(0, 6);
      window.localStorage.setItem(recentNodeStorageKey, JSON.stringify(next));
      return next;
    });
  }

  function addNodeAtPosition(type: string, position: { x: number; y: number }, extraData: Record<string, unknown> = {}) {
    const node = createFlowNode(type, position, extraData);
    rememberGraphHistory();
    setNodes((items) => [...items, node]);
    setSelectedNodeId(node.id);
    rememberRecentNodeType(type);
    return node;
  }

  function addNode(type: string) {
    const node = addNodeAtPosition(type, { x: 160 + nodes.length * 36, y: 120 + nodes.length * 28 });
    setShowPalette(false);
    setStatus(`已添加${nodeLabels[String(node.data.nodeType)] || "节点"}。`);
  }

  function addConnectedNodeFromSelected(type: string) {
    if (!selectedNode) return;
    const outgoingCount = edges.filter((edge) => edge.source === selectedNode.id).length;
    const position = {
      x: selectedNode.position.x + 320,
      y: selectedNode.position.y + outgoingCount * 96
    };
    const node = createFlowNode(type, position, { title: `下游${nodeLabels[type] || "节点"}` });
    rememberGraphHistory();
    setNodes((items) => [...items.map((item) => ({ ...item, selected: false })), { ...node, selected: true }]);
    setEdges((items) => addEdge(edgeWithDefaultHandles({
      id: `edge-downstream-${selectedNode.id}-${node.id}`,
      source: selectedNode.id,
      target: node.id,
      sourceHandle: "output",
      targetHandle: "input",
      animated: true,
      data: { label: "下游节点" }
    } satisfies Edge), items));
    setSelectedNodeId(node.id);
    setSelectedEdgeId("");
    setNodeContextMenu(null);
    setShowPalette(false);
    rememberRecentNodeType(type);
    setStatus(`已从当前节点添加并连接${nodeLabels[type] || "下游节点"}。`);
  }

  function addUpstreamNodeForSelected(type: string) {
    if (!selectedNode) return;
    const incomingCount = edges.filter((edge) => edge.target === selectedNode.id).length;
    const position = {
      x: selectedNode.position.x - 320,
      y: selectedNode.position.y + incomingCount * 96
    };
    const node = createFlowNode(type, position, { title: `上游${nodeLabels[type] || "节点"}` });
    rememberGraphHistory();
    setNodes((items) => [...items.map((item) => ({ ...item, selected: false })), { ...node, selected: true }]);
    setEdges((items) => addEdge(edgeWithDefaultHandles({
      id: `edge-upstream-${node.id}-${selectedNode.id}`,
      source: node.id,
      target: selectedNode.id,
      sourceHandle: "output",
      targetHandle: "input",
      animated: true,
      data: { label: "上游输入" }
    } satisfies Edge), items));
    setSelectedNodeId(node.id);
    setSelectedEdgeId("");
    setNodeContextMenu(null);
    setShowPalette(false);
    rememberRecentNodeType(type);
    setStatus(`已为当前节点添加并连接${nodeLabels[type] || "上游节点"}。`);
  }

  function handlePaletteNodeDragStart(event: ReactDragEvent, type: string) {
    event.dataTransfer.setData(paletteNodeDragType, type);
    event.dataTransfer.setData("text/plain", nodeLabels[type] || type);
    event.dataTransfer.effectAllowed = "copy";
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
    const draggedNodeType = event.dataTransfer.getData(paletteNodeDragType);
    if (draggedNodeType && nodeLabels[draggedNodeType]) {
      const node = addNodeAtPosition(draggedNodeType, position);
      setShowPalette(false);
      setStatus(`已在落点添加${nodeLabels[String(node.data.nodeType)] || "节点"}。`);
      return;
    }
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
      target: createdNodes[targetIndex].id,
      sourceHandle: "output",
      targetHandle: "input",
      animated: true,
      data: { label: "" }
    } satisfies Edge));
    rememberGraphHistory();
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
      return [edgeWithDefaultHandles({
        id: `edge-custom-${preset.key}-${timestamp}-${index}`,
        source,
        target,
        sourceHandle: edge.sourceHandle || "output",
        targetHandle: edge.targetHandle || "input",
        data: edge.data || {}
      } satisfies Edge)];
    });
    rememberGraphHistory();
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

  function saveSelectedWorkflowAsPreset() {
    if (!selectedNodes.length) {
      setStatus("请先框选或点选节点，再保存选区为预设。");
      return;
    }
    const left = Math.min(...selectedNodes.map((node) => node.position.x));
    const top = Math.min(...selectedNodes.map((node) => node.position.y));
    const title = selectedGroupTitles[0] || presetTitle.trim() || `${project?.title || "自定义工作流"} 选区`;
    const normalizedNodes = selectedNodes.map((node) => fromFlowNode({
      ...node,
      position: {
        x: node.position.x - left,
        y: node.position.y - top
      }
    }));
    const preset: CustomWorkflowPreset = {
      key: `custom-selection-${Date.now()}`,
      title,
      description: `选区片段：${selectedNodes.length} 个节点、${selectedSelectionEdges.length} 条连线，可在任意项目画布复用。`,
      nodes: normalizedNodes,
      edges: selectedSelectionEdges.map(fromFlowEdge),
      created_at: new Date().toISOString()
    };
    const next = [preset, ...customWorkflowPresets].slice(0, 12);
    setCustomWorkflowPresets(next);
    window.localStorage.setItem(customPresetStorageKey, JSON.stringify(next));
    setPresetTitle(title);
    setStatus(`已保存选区为预设：${title}。`);
  }

  function deleteCustomWorkflowPreset(presetKey: string) {
    const next = customWorkflowPresets.filter((item) => item.key !== presetKey);
    setCustomWorkflowPresets(next);
    window.localStorage.setItem(customPresetStorageKey, JSON.stringify(next));
    setStatus("自定义预设已删除。");
  }

  async function exportCustomWorkflowPreset(presetKey: string) {
    const preset = customWorkflowPresets.find((item) => item.key === presetKey);
    if (!preset) {
      setStatus("未找到要导出的自定义预设。");
      return;
    }
    const graph = {
      id: `preset-export-${preset.key}-${Date.now()}`,
      project_id: projectId,
      title: preset.title,
      description: preset.description,
      exported_at: new Date().toISOString(),
      nodes: preset.nodes,
      edges: preset.edges,
      viewport: currentCanvasViewport(),
      status: "draft"
    };
    const text = JSON.stringify(graph, null, 2);
    downloadJsonFile(text, `${preset.title || "custom-workflow-preset"}.json`);
    const copiedToClipboard = await copyTextToSystemClipboard(text, `project_graph_preset_export_${projectId}`);
    setStatus(copiedToClipboard ? `已导出并复制预设 ProjectGraph JSON：${preset.title}。` : "已导出预设 ProjectGraph JSON；浏览器剪贴板不可用，已把内容暂存到本地。");
  }

  async function importCustomWorkflowPresetFromClipboard() {
    let text = "";
    const fallbackText = () => window.localStorage.getItem(`project_graph_preset_export_${projectId}`) || window.localStorage.getItem(`project_graph_selection_export_${projectId}`) || window.localStorage.getItem(`project_graph_workflow_export_${projectId}`) || "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = fallbackText();
    }
    if (!text.trim()) text = fallbackText();
    if (!text.trim()) {
      setStatus("剪贴板中没有可导入为预设的 ProjectGraph JSON，请先复制或导出预设。");
      return;
    }
    let graph: Partial<ProjectGraph> & { title?: unknown; description?: unknown; nodes?: unknown; edges?: unknown };
    try {
      graph = JSON.parse(text);
    } catch {
      setStatus("预设 JSON 解析失败，请检查内容格式。");
      return;
    }
    if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      setStatus("预设 JSON 需要包含 nodes 和 edges。");
      return;
    }
    if (!graph.nodes.length) {
      setStatus("预设 JSON 中没有节点，无法导入为我的预设。");
      return;
    }
    const preset: CustomWorkflowPreset = {
      key: `custom-import-${Date.now()}`,
      title: String(graph.title || presetTitle.trim() || "导入的工作流预设"),
      description: String(graph.description || `导入预设：${graph.nodes.length} 个节点、${graph.edges.length} 条连线，可在任意项目画布复用。`),
      nodes: graph.nodes as ProjectGraphNode[],
      edges: graph.edges as ProjectGraph["edges"],
      created_at: new Date().toISOString()
    };
    const next = [preset, ...customWorkflowPresets].slice(0, 12);
    setCustomWorkflowPresets(next);
    window.localStorage.setItem(customPresetStorageKey, JSON.stringify(next));
    setPresetTitle(preset.title);
    setStatus(`已导入预设到我的工作流：${preset.title}。`);
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
      target: createdNodes[targetIndex].id,
      sourceHandle: "output",
      targetHandle: "input",
      animated: true,
      data: { label: "" }
    } satisfies Edge));
    return { createdNodes, createdEdges };
  }

  function addShotWorkflow(shot: StoryboardShot) {
    const timestamp = Date.now();
    const { createdNodes, createdEdges } = buildShotWorkflow(shot, timestamp, 220 + nodes.length * 28, 140 + nodes.length * 18);
    rememberGraphHistory();
    setNodes((items) => [...items, ...createdNodes]);
    setEdges((items) => [...items, ...createdEdges]);
    setSelectedNodeId(createdNodes[0]?.id || "");
    setShowShots(false);
    setStatus(`已为分镜 ${shot.index} 添加生成链路。`);
  }

  function addAllShotWorkflows() {
    if (!selectedFilteredShots.length) {
      setStatus("当前筛选结果没有可添加的分镜。");
      return;
    }
    const timestamp = Date.now();
    const groups = selectedFilteredShots.map((shot, index) => buildShotWorkflow(shot, timestamp + index, 220, 120 + index * 280));
    const createdNodes = groups.flatMap((group) => group.createdNodes);
    const createdEdges = groups.flatMap((group) => group.createdEdges);
    rememberGraphHistory();
    setNodes((items) => [...items, ...createdNodes]);
    setEdges((items) => [...items, ...createdEdges]);
    setSelectedNodeId(createdNodes[0]?.id || "");
    setShowShots(false);
    setStatus(`已为 ${selectedFilteredShots.length} 个分镜添加生成链路。`);
  }

  function toggleShotSelection(shotId: string) {
    setSelectedShotIds((items) => items.includes(shotId) ? items.filter((item) => item !== shotId) : [...items, shotId]);
  }

  function selectFilteredShots() {
    setSelectedShotIds(filteredShots.map((shot) => shot.id));
    setStatus(`已选中当前 ${filteredShots.length} 个分镜。`);
  }

  function selectUnlinkedFilteredShots() {
    const unlinkedShots = filteredShots.filter((shot) => !shotWorkflowShotIds.has(shot.id));
    setSelectedShotIds(unlinkedShots.map((shot) => shot.id));
    setStatus(`已选中当前 ${unlinkedShots.length} 个未铺设分镜。`);
  }

  function clearShotSelection() {
    setSelectedShotIds([]);
    setStatus("已清空分镜选择。");
  }

  function focusShotWorkflow(shot: StoryboardShot) {
    const linkedNodes = nodes.filter((node) => String((node.data as Record<string, unknown>).shot_id || "") === shot.id);
    if (!linkedNodes.length) {
      setStatus(`分镜 ${shot.index} 暂未铺设生成链路。`);
      return;
    }
    selectCanvasNodesByIds(linkedNodes.map((node) => node.id), `分镜 ${shot.index} 已铺设链路`);
    setShowShots(false);
  }

  function updateSelectedData(key: string, value: string | boolean) {
    if (!selectedNode) return;
    setNodes((items) => items.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, [key]: value } } : node));
  }

  function rememberSelectedNodeEdit() {
    if (selectedNode) rememberGraphHistory();
  }

  function applySelectedNodePreset(label: string, patch: Record<string, string | boolean>) {
    if (!selectedNode) return;
    rememberGraphHistory();
    setNodes((items) => items.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, ...patch } } : node));
    setStatus(`已应用参数预设：${label}。`);
  }

  function updateSelectedNodeType(nextType: string) {
    if (!selectedNode || nextType === selectedType || !nodeLabels[nextType]) return;
    const currentData = selectedNode.data as Record<string, unknown>;
    const defaults = buildNodeData(nextType);
    rememberGraphHistory();
    setNodes((items) => items.map((node) => node.id === selectedNode.id ? {
      ...node,
      data: {
        ...defaults,
        ...currentData,
        nodeType: nextType,
        graphNodeId: selectedNode.id,
        title: String(currentData.title || (defaults as Record<string, unknown>).title || nodeLabels[nextType])
      }
    } : node));
    setStatus(`节点类型已切换为${nodeLabels[nextType]}，连线和已有参数已保留。`);
  }

  function toggleSelectedNodeLock() {
    if (!selectedNode) return;
    const nextLocked = (selectedNode.data as Record<string, unknown>).locked !== true;
    rememberGraphHistory();
    setNodes((items) => items.map((node) => node.id === selectedNode.id ? { ...node, draggable: !nextLocked, data: { ...node.data, locked: nextLocked } } : node));
    setStatus(nextLocked ? "节点已锁定，防止误拖动和误删。" : "节点已解锁，可继续编辑位置和结构。");
  }

  function toggleSelectedNodeDisabled() {
    if (!selectedNode) return;
    const nextDisabled = (selectedNode.data as Record<string, unknown>).disabled !== true;
    rememberGraphHistory();
    setNodes((items) => items.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, disabled: nextDisabled } } : node));
    setStatus(nextDisabled ? "节点已禁用，运行链路和全图时会跳过。" : "节点已启用，可继续参与运行。");
  }

  function toggleSelectedNodeCollapsed() {
    if (!selectedNode) return;
    const nextCollapsed = (selectedNode.data as Record<string, unknown>).collapsed !== true;
    rememberGraphHistory();
    setNodes((items) => items.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, collapsed: nextCollapsed } } : node));
    setStatus(nextCollapsed ? "节点已折叠，仅保留标题、状态和端口。" : "节点已展开，可查看预览、摘要和备注。");
  }

  function fillSelectedFromUpstream() {
    if (!selectedNode) return;
    if (!selectedUpstreamInputs.length) {
      setStatus("当前节点没有可填充的上游输入。");
      return;
    }
    const patch = Object.fromEntries(selectedUpstreamInputs.map((item) => [item.key, item.value]));
    rememberGraphHistory();
    setNodes((items) => items.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, ...patch } } : node));
    setStatus(`已从上游填充 ${selectedUpstreamInputs.length} 个参数。`);
  }

  function updateSelectedEdgeLabel(label: string) {
    if (!selectedEdge) return;
    const selectedEdgeIds = new Set(selectedEdges.map((edge) => edge.id));
    setEdges((items) => items.map((edge) => selectedEdgeIds.has(edge.id) ? {
      ...edge,
      label,
      data: { ...(edge.data as Record<string, unknown> | undefined), label }
    } : edge));
    setStatus(label.trim() ? `已更新 ${selectedEdgeIds.size} 条连线标签。` : `已清空 ${selectedEdgeIds.size} 条连线标签。`);
  }

  function updateSelectedEdgeColor(color: string) {
    if (!selectedEdge) return;
    const markerColor = edgeMarkerColorByValue.get(color) || edgeMarkerColorByValue.get("");
    const selectedEdgeIds = new Set(selectedEdges.map((edge) => edge.id));
    rememberGraphHistory();
    setEdges((items) => items.map((edge) => selectedEdgeIds.has(edge.id) ? edgeWithDefaultHandles({
      ...edge,
      data: { ...(edge.data as Record<string, unknown> | undefined), edge_color: markerColor?.value || "" }
    }) : edge));
    setStatus(markerColor?.value ? `已将 ${selectedEdgeIds.size} 条连线颜色标记设置为${markerColor.label}。` : `已清空 ${selectedEdgeIds.size} 条连线颜色标记。`);
  }

  function updateSelectedEdgeStyle(style: string) {
    if (!selectedEdge) return;
    const lineStyle = edgeLineStyleByValue.get(style) || edgeLineStyleByValue.get("");
    const selectedEdgeIds = new Set(selectedEdges.map((edge) => edge.id));
    rememberGraphHistory();
    setEdges((items) => items.map((edge) => selectedEdgeIds.has(edge.id) ? edgeWithDefaultHandles({
      ...edge,
      data: { ...(edge.data as Record<string, unknown> | undefined), edge_style: lineStyle?.value || "" }
    }) : edge));
    setStatus(lineStyle?.value ? `已将 ${selectedEdgeIds.size} 条连线样式设置为${lineStyle.label}。` : `已将 ${selectedEdgeIds.size} 条连线恢复为默认实线。`);
  }

  function toggleSelectedEdgeDisabled() {
    if (!selectedEdge) return;
    const nextDisabled = !isEdgeDisabled(selectedEdge);
    const selectedEdgeIds = new Set(selectedEdges.map((edge) => edge.id));
    rememberGraphHistory();
    setEdges((items) => items.map((edge) => selectedEdgeIds.has(edge.id) ? edgeWithDefaultHandles({
      ...edge,
      data: { ...(edge.data as Record<string, unknown> | undefined), disabled: nextDisabled }
    }) : edge));
    setStatus(nextDisabled ? `已禁用 ${selectedEdgeIds.size} 条连线，运行和上游输入会跳过。` : `已启用 ${selectedEdgeIds.size} 条连线，可继续参与上游输入和运行。`);
  }

  function updateSelectedEdgePort(side: "source" | "target", handleId: string) {
    if (!selectedEdge) return;
    const nextConnection = {
      ...selectedEdge,
      sourceHandle: side === "source" ? handleId : selectedEdge.sourceHandle || "output",
      targetHandle: side === "target" ? handleId : selectedEdge.targetHandle || "input"
    };
    const issue = connectionIssueMessage(nextConnection, edges, selectedEdge.id);
    if (issue) {
      setStatus(issue);
      return;
    }
    rememberGraphHistory();
    setEdges((items) => items.map((edge) => edge.id === selectedEdge.id ? edgeWithDefaultHandles({
      ...edge,
      sourceHandle: nextConnection.sourceHandle,
      targetHandle: nextConnection.targetHandle
    }) : edge));
    setStatus(side === "source" ? "连线输出端口已更新。" : "连线输入端口已更新。");
  }

  function reverseSelectedEdge() {
    if (!selectedEdge) return;
    const reversed = {
      ...selectedEdge,
      source: selectedEdge.target,
      target: selectedEdge.source,
      sourceHandle: "output",
      targetHandle: "input"
    };
    const issue = connectionIssueMessage(reversed, edges, selectedEdge.id);
    if (issue) {
      setStatus(`反转连线失败：${issue}`);
      return;
    }
    rememberGraphHistory();
    setEdges((items) => items.map((edge) => edge.id === selectedEdge.id ? edgeWithDefaultHandles(reversed) : edge));
    setStatus("已反转连线方向，并重置为默认输出/输入端口。");
  }

  function deleteSelectedEdge() {
    if (!selectedEdge) return;
    const selectedEdgeIds = new Set(selectedEdges.map((edge) => edge.id));
    rememberGraphHistory();
    setEdges((items) => items.filter((edge) => !selectedEdgeIds.has(edge.id)));
    setSelectedEdgeId("");
    setEdgeContextMenu(null);
    setStatus(`已删除 ${selectedEdgeIds.size} 条连线。`);
  }

  function insertNodeOnSelectedEdge(type: string) {
    if (!selectedEdge) return;
    const sourceNode = nodes.find((node) => node.id === selectedEdge.source);
    const targetNode = nodes.find((node) => node.id === selectedEdge.target);
    if (!sourceNode || !targetNode) {
      setStatus("连线两端节点已丢失，暂不能插入节点。");
      return;
    }
    const position = {
      x: Math.round((sourceNode.position.x + targetNode.position.x) / 2),
      y: Math.round((sourceNode.position.y + targetNode.position.y) / 2)
    };
    const node = createFlowNode(type, position, { title: `插入${nodeLabels[type] || "节点"}` });
    const timestamp = Date.now();
    const edgeData = { ...((selectedEdge.data as Record<string, unknown> | undefined) || {}) };
    const inheritedLabel = String(edgeData.label || "");
    rememberGraphHistory();
    setNodes((items) => [...items.map((item) => ({ ...item, selected: false })), { ...node, selected: true }]);
    setEdges((items) => [
      ...items.filter((edge) => edge.id !== selectedEdge.id),
      edgeWithDefaultHandles({
        id: `edge-insert-a-${timestamp}`,
        source: selectedEdge.source,
        target: node.id,
        sourceHandle: selectedEdge.sourceHandle || "output",
        targetHandle: "input",
        label: inheritedLabel,
        data: { ...edgeData, label: inheritedLabel }
      } satisfies Edge),
      edgeWithDefaultHandles({
        id: `edge-insert-b-${timestamp}`,
        source: node.id,
        target: selectedEdge.target,
        sourceHandle: "output",
        targetHandle: selectedEdge.targetHandle || "input",
        label: inheritedLabel,
        data: { ...edgeData, label: inheritedLabel }
      } satisfies Edge)
    ]);
    setSelectedNodeId(node.id);
    setSelectedEdgeId("");
    setEdgeContextMenu(null);
    rememberRecentNodeType(type);
    setStatus(`已在连线上插入${nodeLabels[type] || "节点"}，原连线已自动拆成两段。`);
  }

  function focusEdgeNode(direction: "source" | "target") {
    if (!selectedEdge) return;
    const nodeId = direction === "source" ? selectedEdge.source : selectedEdge.target;
    focusCanvasNode(nodeId);
    setEdgeContextMenu(null);
  }

  function selectCanvasEdgesByIds(edgeIds: string[], label: string) {
    const idSet = new Set(edgeIds);
    const matchedEdges = edges.filter((edge) => idSet.has(edge.id));
    if (!matchedEdges.length) {
      setStatus(`${label}暂无可选连线。`);
      return;
    }
    setNodes((items) => items.map((node) => ({ ...node, selected: false })));
    setEdges((items) => items.map((edge) => ({ ...edge, selected: idSet.has(edge.id) })));
    setSelectedNodeId("");
    setSelectedEdgeId(matchedEdges[0].id);
    setNodeContextMenu(null);
    setEdgeContextMenu(null);
    setStatus(`已选中${label}：${matchedEdges.length} 条连线，可继续禁用、标记、改样式或删除。`);
  }

  function selectSameSourceEdges() {
    if (!selectedEdge) {
      setStatus("请先选择一条连线，再选中同起点连线。");
      return;
    }
    selectCanvasEdgesByIds(edges.filter((edge) => edge.source === selectedEdge.source).map((edge) => edge.id), "同起点连线");
  }

  function selectSameTargetEdges() {
    if (!selectedEdge) {
      setStatus("请先选择一条连线，再选中同终点连线。");
      return;
    }
    selectCanvasEdgesByIds(edges.filter((edge) => edge.target === selectedEdge.target).map((edge) => edge.id), "同终点连线");
  }

  function selectSameLabelEdges() {
    if (!selectedEdge) {
      setStatus("请先选择一条连线，再选中同标签连线。");
      return;
    }
    const label = String((selectedEdge.data as Record<string, unknown> | undefined)?.label || "").trim();
    if (!label) {
      setStatus("当前连线没有标签，无法选中同标签连线。");
      return;
    }
    selectCanvasEdgesByIds(edges.filter((edge) => String((edge.data as Record<string, unknown> | undefined)?.label || "").trim() === label).map((edge) => edge.id), "同标签连线");
  }

  function selectSameColorEdges() {
    if (!selectedEdge) {
      setStatus("请先选择一条连线，再选中同颜色连线。");
      return;
    }
    const color = String((selectedEdge.data as Record<string, unknown> | undefined)?.edge_color || "");
    const markerColor = edgeMarkerColorByValue.get(color) || edgeMarkerColorByValue.get("");
    selectCanvasEdgesByIds(edges.filter((edge) => String((edge.data as Record<string, unknown> | undefined)?.edge_color || "") === color).map((edge) => edge.id), `${markerColor?.label || "同颜色"}连线`);
  }

  function selectSameStyleEdges() {
    if (!selectedEdge) {
      setStatus("请先选择一条连线，再选中同样式连线。");
      return;
    }
    const style = String((selectedEdge.data as Record<string, unknown> | undefined)?.edge_style || "");
    const lineStyle = edgeLineStyleByValue.get(style) || edgeLineStyleByValue.get("");
    selectCanvasEdgesByIds(edges.filter((edge) => String((edge.data as Record<string, unknown> | undefined)?.edge_style || "") === style).map((edge) => edge.id), `${lineStyle?.label || "同样式"}连线`);
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
    setSelectedEdgeId("");
    flowInstance?.setCenter(node.position.x + 120, node.position.y + 80, { duration: 420, zoom: 1 });
    setStatus("已定位到自检问题节点。");
  }

  function selectCanvasNodesByIds(nodeIds: string[], label: string) {
    const idSet = new Set(nodeIds);
    const matchedNodes = nodes.filter((node) => idSet.has(node.id));
    if (!matchedNodes.length) {
      setStatus(`${label}暂无可选节点。`);
      return;
    }
    setNodes((items) => items.map((node) => ({ ...node, selected: idSet.has(node.id) })));
    setSelectedNodeId(matchedNodes[matchedNodes.length - 1].id);
    setSelectedEdgeId("");
    setNodeContextMenu(null);
    setEdgeContextMenu(null);
    void flowInstance?.fitView({ nodes: matchedNodes.map((node) => ({ id: node.id })), padding: 0.22, duration: 420, maxZoom: 1.15 });
    setStatus(`已选中${label}：${matchedNodes.length} 个节点，可继续整理、打组、复制或运行链路。`);
  }

  function selectFilteredOutlineNodes() {
    selectCanvasNodesByIds(filteredGraphOutlineNodes.map((node) => node.id), "当前大纲结果");
  }

  function selectIssueOutlineNodes() {
    selectCanvasNodesByIds(graphOutlineNodes.filter((node) => outlineIssueNodeIds.has(node.id)).map((node) => node.id), "全部问题节点");
  }

  function selectValidationIssueNodes(level: GraphValidationIssue["level"]) {
    const issueNodeIds = new Set(graphValidation.issues.filter((issue) => issue.level === level && issue.nodeId).map((issue) => issue.nodeId || ""));
    const label = level === "error" ? "错误节点" : "提醒节点";
    if (!issueNodeIds.size) {
      setStatus(level === "error" ? "画布暂无错误节点。" : "画布暂无提醒节点。");
      return;
    }
    selectCanvasNodesByIds(nodes.filter((node) => issueNodeIds.has(node.id)).map((node) => node.id), label);
  }

  function selectTaskStatusNodes(taskStatus: string) {
    const label = taskStatus === "running" ? "运行中任务节点" : taskStatus === "failed" ? "失败任务节点" : `${statusText(taskStatus)}任务节点`;
    const matchedNodes = nodes.filter((node) => {
      const data = node.data as Record<string, unknown>;
      const taskId = String(data.task_id || "");
      const task = taskId ? taskById.get(taskId) : null;
      return (task?.status || String(data.status || "")) === taskStatus;
    });
    if (!matchedNodes.length) {
      setStatus(taskStatus === "running" ? "画布暂无运行中任务节点。" : taskStatus === "failed" ? "画布暂无失败任务节点。" : `画布暂无${label}。`);
      return;
    }
    selectCanvasNodesByIds(matchedNodes.map((node) => node.id), label);
  }

  function selectSelectedUpstreamChain() {
    if (!selectedNode) {
      setStatus("请先选择一个节点，再选中上游链路。");
      return;
    }
    selectCanvasNodesByIds([selectedNode.id, ...upstreamNodeIds(selectedNode.id, edges)], "当前上游链路");
  }

  function selectSelectedDownstreamChain() {
    if (!selectedNode) {
      setStatus("请先选择一个节点，再选中下游链路。");
      return;
    }
    selectCanvasNodesByIds([selectedNode.id, ...downstreamNodeIds(selectedNode.id, edges)], "当前下游链路");
  }

  function selectSameTypeNodes() {
    if (!selectedNode) {
      setStatus("请先选择一个节点，再选中同类型节点。");
      return;
    }
    const type = String((selectedNode.data as Record<string, unknown>).nodeType || "text");
    const typeNodes = nodes.filter((node) => String((node.data as Record<string, unknown>).nodeType || "text") === type);
    selectCanvasNodesByIds(typeNodes.map((node) => node.id), `${nodeLabels[type] || "同类型"}节点`);
  }

  function selectSameStatusNodes() {
    if (!selectedNode) {
      setStatus("请先选择一个节点，再选中同状态节点。");
      return;
    }
    const nodeStatus = String((selectedNode.data as Record<string, unknown>).status || "draft");
    const statusNodes = nodes.filter((node) => String((node.data as Record<string, unknown>).status || "draft") === nodeStatus);
    selectCanvasNodesByIds(statusNodes.map((node) => node.id), `${statusText(nodeStatus)}节点`);
  }

  function selectSameColorNodes() {
    if (!selectedNode) {
      setStatus("请先选择一个节点，再选中同标记节点。");
      return;
    }
    const color = String((selectedNode.data as Record<string, unknown>).node_color || "");
    const markerColor = nodeMarkerColorByValue.get(color) || nodeMarkerColorByValue.get("");
    const colorNodes = nodes.filter((node) => String((node.data as Record<string, unknown>).node_color || "") === color);
    selectCanvasNodesByIds(colorNodes.map((node) => node.id), `${markerColor?.label || "同标记"}节点`);
  }

  function selectDisabledNodes() {
    const disabledNodes = nodes.filter(isNodeDisabled);
    if (!disabledNodes.length) {
      setStatus("画布暂无禁用节点。");
      return;
    }
    selectCanvasNodesByIds(disabledNodes.map((node) => node.id), "禁用节点");
  }

  function selectIsolatedNodes() {
    const activeEdges = activeGraphEdges(edges);
    const isolatedNodes = nodes.filter((node) => {
      if (isNodeDisabled(node) || nodes.length <= 1) return false;
      return !activeEdges.some((edge) => edge.source === node.id || edge.target === node.id);
    });
    if (!isolatedNodes.length) {
      setStatus("画布暂无孤立节点。");
      return;
    }
    selectCanvasNodesByIds(isolatedNodes.map((node) => node.id), "孤立节点");
  }

  function selectSourceNodes() {
    const activeEdges = activeGraphEdges(edges);
    const sourceNodes = nodes.filter((node) => !isNodeDisabled(node) && !activeEdges.some((edge) => edge.target === node.id));
    if (!sourceNodes.length) {
      setStatus("画布暂无可选起点节点。");
      return;
    }
    selectCanvasNodesByIds(sourceNodes.map((node) => node.id), "起点节点");
  }

  function selectTerminalNodes() {
    const activeEdges = activeGraphEdges(edges);
    const terminalNodes = nodes.filter((node) => !isNodeDisabled(node) && !activeEdges.some((edge) => edge.source === node.id));
    if (!terminalNodes.length) {
      setStatus("画布暂无可选终点节点。");
      return;
    }
    selectCanvasNodesByIds(terminalNodes.map((node) => node.id), "终点节点");
  }

  function selectSelectedGroups() {
    if (!selectedGroupIds.size) {
      setStatus("当前选区没有已打组节点。");
      return;
    }
    const groupNodes = nodes.filter((node) => selectedGroupIds.has(String((node.data as Record<string, unknown>).group_id || "")));
    selectCanvasNodesByIds(groupNodes.map((node) => node.id), selectedGroupIds.size > 1 ? "当前多个分组" : "当前分组");
  }

  function selectAllCanvasNodes() {
    if (!nodes.length) {
      setStatus("画布暂无节点，无法全选。");
      return;
    }
    setNodes((items) => items.map((node) => ({ ...node, selected: true })));
    setSelectedNodeId(nodes[nodes.length - 1].id);
    setSelectedEdgeId("");
    setNodeContextMenu(null);
    setEdgeContextMenu(null);
    setStatus(`已全选画布节点：${nodes.length} 个，可继续批量整理、打组、复制或运行链路。`);
  }

  function invertCanvasSelection() {
    if (!nodes.length) {
      setStatus("画布暂无节点，无法反选。");
      return;
    }
    const nextSelectedNodes = nodes.filter((node) => !selectedNodeIds.has(node.id));
    if (!nextSelectedNodes.length) {
      clearCanvasSelection();
      setStatus("已反选画布节点：当前没有剩余节点，已清空选区。");
      return;
    }
    const nextSelectedIds = new Set(nextSelectedNodes.map((node) => node.id));
    setNodes((items) => items.map((node) => ({ ...node, selected: nextSelectedIds.has(node.id) })));
    setSelectedNodeId(nextSelectedNodes[nextSelectedNodes.length - 1].id);
    setSelectedEdgeId("");
    setNodeContextMenu(null);
    setEdgeContextMenu(null);
    setStatus(`已反选画布节点：${nextSelectedNodes.length} 个，可继续批量整理、打组、复制或运行链路。`);
  }

  function clearCanvasSelection() {
    setNodes((items) => items.map((node) => ({ ...node, selected: false })));
    setSelectedNodeId("");
    setSelectedEdgeId("");
    setNodeContextMenu(null);
    setEdgeContextMenu(null);
    setStatus("已清空当前节点和连线选区。");
  }

  function fitGraphView() {
    if (!nodes.length) {
      setStatus("画布暂无节点，无法适配视图。");
      return;
    }
    void flowInstance?.fitView({ padding: 0.18, duration: 420, maxZoom: 1.15 });
    setStatus("已适配全部节点到当前视图。");
  }

  function fitSelectedNodeView() {
    if (!selectedNodes.length) {
      setStatus("请先选择一个或多个节点，再适配选区视图。");
      return;
    }
    void flowInstance?.fitView({ nodes: selectedNodes.map((node) => ({ id: node.id })), padding: 0.22, duration: 420, maxZoom: 1.2 });
    setStatus(`已适配选区视图：${selectedNodes.length} 个节点。`);
  }

  function resetCanvasViewport() {
    void flowInstance?.setViewport(defaultCanvasViewport, { duration: 420 });
    setInitialViewport(defaultCanvasViewport);
    setStatus("已重置画布视口。");
  }

  function zoomCanvas(direction: "in" | "out") {
    const viewport = currentCanvasViewport();
    const currentZoom = viewport.zoom || 1;
    const nextZoom = Math.min(1.8, Math.max(0.25, Number((currentZoom * (direction === "in" ? 1.18 : 0.82)).toFixed(3))));
    const screenCenter = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const flowCenter = {
      x: (screenCenter.x - viewport.x) / currentZoom,
      y: (screenCenter.y - viewport.y) / currentZoom
    };
    const nextViewport = {
      x: screenCenter.x - flowCenter.x * nextZoom,
      y: screenCenter.y - flowCenter.y * nextZoom,
      zoom: nextZoom
    };
    void flowInstance?.setViewport(nextViewport, { duration: 240 });
    setInitialViewport(nextViewport);
    setStatus(direction === "in" ? `已放大画布到 ${Math.round(nextZoom * 100)}%。` : `已缩小画布到 ${Math.round(nextZoom * 100)}%。`);
  }

  function persistViewBookmarks(next: CanvasViewBookmark[]) {
    setViewBookmarks(next);
    window.localStorage.setItem(viewBookmarkStorageKey, JSON.stringify(next));
  }

  function saveCurrentViewBookmark() {
    const title = viewBookmarkTitle.trim() || `视图 ${viewBookmarks.length + 1}`;
    const bookmark: CanvasViewBookmark = {
      key: `view-${Date.now()}`,
      title,
      viewport: currentCanvasViewport(),
      created_at: new Date().toISOString()
    };
    persistViewBookmarks([bookmark, ...viewBookmarks].slice(0, 8));
    setShowViewBookmarks(true);
    setStatus(`已保存画布视图书签：${title}。`);
  }

  function restoreViewBookmark(bookmark: CanvasViewBookmark) {
    void flowInstance?.setViewport(bookmark.viewport, { duration: 420 });
    setInitialViewport(bookmark.viewport);
    setStatus(`已恢复画布视图书签：${bookmark.title}。`);
  }

  function deleteViewBookmark(bookmarkKey: string) {
    const next = viewBookmarks.filter((item) => item.key !== bookmarkKey);
    persistViewBookmarks(next);
    setStatus("已删除画布视图书签。");
  }

  function persistGraphVersions(next: CanvasGraphVersion[]) {
    setGraphVersions(next);
    window.localStorage.setItem(graphVersionStorageKey, JSON.stringify(next));
  }

  function saveCurrentGraphVersion() {
    if (!nodes.length) {
      setStatus("画布暂无节点，无法保存版本快照。");
      return;
    }
    const title = graphVersionTitle.trim() || `${project?.title || "画布"} 版本 ${graphVersions.length + 1}`;
    const version: CanvasGraphVersion = {
      key: `graph-version-${Date.now()}`,
      title,
      nodes: nodes.map(fromFlowNode),
      edges: edges.map(fromFlowEdge),
      viewport: currentCanvasViewport(),
      created_at: new Date().toISOString()
    };
    persistGraphVersions([version, ...graphVersions].slice(0, 12));
    setGraphVersionTitle(title);
    setShowGraphVersions(true);
    setStatus(`已保存画布版本快照：${title}。`);
  }

  function restoreGraphVersion(version: CanvasGraphVersion) {
    rememberGraphHistory();
    setNodes(version.nodes.map(toFlowNode));
    setEdges(version.edges.map(toFlowEdge));
    restoreCanvasViewport(version.viewport);
    setSelectedNodeId(version.nodes[0]?.id || "");
    setSelectedEdgeId("");
    setShowGraphVersions(false);
    setStatus(`已恢复画布版本快照：${version.title}。`);
  }

  function deleteGraphVersion(versionKey: string) {
    const next = graphVersions.filter((item) => item.key !== versionKey);
    persistGraphVersions(next);
    setStatus("已删除画布版本快照。");
  }

  async function exportGraphVersion(version: CanvasGraphVersion) {
    const graph = {
      id: `graph-version-export-${version.key}-${Date.now()}`,
      project_id: projectId,
      title: version.title,
      exported_at: new Date().toISOString(),
      nodes: version.nodes,
      edges: version.edges,
      viewport: version.viewport,
      status: "draft"
    };
    const text = JSON.stringify(graph, null, 2);
    downloadJsonFile(text, `${version.title || "canvas-graph-version"}.json`);
    const copiedToClipboard = await copyTextToSystemClipboard(text, `project_graph_version_export_${projectId}`);
    setStatus(copiedToClipboard ? `已导出并复制画布版本 ProjectGraph JSON：${version.title}。` : "已导出画布版本 ProjectGraph JSON；浏览器剪贴板不可用，已把内容暂存到本地。");
  }

  function toggleSnapToGrid() {
    setSnapToGrid((value) => {
      const next = !value;
      setStatus(next ? "已开启网格吸附，拖动节点会按 24px 网格落位。" : "已关闭网格吸附，可自由摆放节点。");
      return next;
    });
  }

  function toggleMiniMap() {
    setShowMiniMap((value) => {
      const next = !value;
      setStatus(next ? "已开启画布导航器，可在迷你地图中查看全局节点结构。" : "已隐藏画布导航器，释放右下角预览空间。");
      return next;
    });
  }

  function toggleSelectionOnDrag() {
    setSelectionOnDrag((value) => {
      const next = !value;
      setStatus(next ? "已开启拖拽框选模式，拖动画布空白处可直接框选节点。" : "已关闭拖拽框选模式，空白处拖动恢复为平移画布。");
      return next;
    });
  }

  function blockingValidationIssues(nodeIds: string[], includeGlobalIssues = false) {
    const nodeIdSet = new Set(nodeIds);
    return graphValidation.issues.filter((issue) => issue.level === "error" && ((issue.nodeId && nodeIdSet.has(issue.nodeId)) || (includeGlobalIssues && !issue.nodeId)));
  }

  function showRunBlockingIssue(issues: GraphValidationIssue[], scope: string) {
    const issue = issues[0];
    if (!issue) return false;
    setShowValidation(true);
    if (issue.nodeId) focusCanvasNode(issue.nodeId);
    setStatus(`${scope}前需要先处理：${issue.title}。${issue.detail}`);
    return true;
  }

  async function runSelectedNode() {
    if (!selectedNode) return;
    if (isNodeDisabled(selectedNode)) {
      setStatus("节点已禁用，请先启用再运行。");
      return;
    }
    if (showRunBlockingIssue(blockingValidationIssues([selectedNode.id]), "运行节点")) return;
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
    await runNodeChain(selectedNode.id);
  }

  async function runNodeChain(nodeId: string) {
    const targetNode = nodes.find((node) => node.id === nodeId);
    if (!targetNode) {
      setStatus("画布中暂未找到要运行的节点。");
      return;
    }
    setSelectedNodeId(nodeId);
    const upstream = upstreamNodeIds(nodeId, edges);
    const orderedNodes = orderedChainNodes(nodeId, nodes, edges);
    if (showRunBlockingIssue(blockingValidationIssues(orderedNodes.map((node) => node.id)), "运行链路")) return;
    await saveGraph();
    const runnableNodes = orderedNodes.filter((node) => !isNodeDisabled(node));
    const skippedCount = orderedNodes.length - runnableNodes.length;
    if (!runnableNodes.length) {
      setStatus("当前链路节点均已禁用，未执行运行。");
      return;
    }
    setBusy(true);
    setStatus(`正在运行链路，上游 ${upstream.size} 个，共 ${runnableNodes.length} 个节点${skippedCount ? `，跳过 ${skippedCount} 个禁用节点` : ""}...`);
    try {
      for (const node of runnableNodes) {
        const response = await postJson<{ node?: ProjectGraphNode; task?: GenerationTask; message?: string }>(`/api/projects/${projectId}/graph/nodes/${node.id}/run`, {
          user_id: currentUserId()
        });
        if (response.node) {
          setNodes((items) => items.map((item) => item.id === node.id ? toFlowNode(response.node as ProjectGraphNode) : item));
        }
      }
      setStatus(`链路运行完成：${runnableNodes.length} 个节点已处理${skippedCount ? `，已跳过 ${skippedCount} 个禁用节点` : ""}。`);
      await refreshAll();
    } catch (error) {
      setStatus(error instanceof Error ? `链路运行失败：${error.message}` : "链路运行失败。请检查节点参数后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function runSelectedNodes() {
    if (!selectedNodes.length) {
      setStatus("请先框选或点选节点，再运行选区。");
      return;
    }
    const selectedIds = new Set(selectedNodes.map((node) => node.id));
    const selectedEdges = activeEdges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target));
    const orderedNodes = orderedGraphNodes(selectedNodes, selectedEdges);
    if (showRunBlockingIssue(blockingValidationIssues(orderedNodes.map((node) => node.id)), "运行选区")) return;
    const runnableNodes = orderedNodes.filter((node) => !isNodeDisabled(node));
    const skippedCount = orderedNodes.length - runnableNodes.length;
    if (!runnableNodes.length) {
      setStatus("选区节点均已禁用，未执行运行。");
      return;
    }
    await saveGraph();
    setBusy(true);
    setStatus(`正在运行选区：${runnableNodes.length} 个节点${skippedCount ? `，跳过 ${skippedCount} 个禁用节点` : ""}...`);
    try {
      for (const node of runnableNodes) {
        const response = await postJson<{ node?: ProjectGraphNode; task?: GenerationTask; message?: string }>(`/api/projects/${projectId}/graph/nodes/${node.id}/run`, {
          user_id: currentUserId()
        });
        if (response.node) {
          setNodes((items) => items.map((item) => item.id === node.id ? toFlowNode(response.node as ProjectGraphNode) : item));
        }
      }
      setStatus(`选区运行完成：${runnableNodes.length} 个节点已按依赖顺序处理${skippedCount ? `，已跳过 ${skippedCount} 个禁用节点` : ""}。`);
      await refreshAll();
    } catch (error) {
      setStatus(error instanceof Error ? `选区运行失败：${error.message}` : "选区运行失败。请检查节点参数后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function runCanvasGraph() {
    if (showRunBlockingIssue(graphValidation.issues.filter((issue) => issue.level === "error"), "运行全图")) return;
    const orderedNodes = orderedGraphNodes(nodes, edges);
    const terminals = terminalNodeIds(nodes, edges);
    const runnableNodes = orderedNodes.filter((node) => !isNodeDisabled(node));
    const skippedCount = orderedNodes.length - runnableNodes.length;
    if (!orderedNodes.length) {
      setStatus("画布暂无可运行节点，请先添加节点或工作流。");
      return;
    }
    if (!runnableNodes.length) {
      setStatus("画布节点均已禁用，未执行运行。");
      return;
    }
    await saveGraph();
    setBusy(true);
    setStatus(`正在运行全画布：${terminals.length || 1} 条终点链路，共 ${runnableNodes.length} 个节点${skippedCount ? `，跳过 ${skippedCount} 个禁用节点` : ""}...`);
    try {
      for (const node of runnableNodes) {
        const response = await postJson<{ node?: ProjectGraphNode; task?: GenerationTask; message?: string }>(`/api/projects/${projectId}/graph/nodes/${node.id}/run`, {
          user_id: currentUserId()
        });
        if (response.node) {
          setNodes((items) => items.map((item) => item.id === node.id ? toFlowNode(response.node as ProjectGraphNode) : item));
        }
      }
      setStatus(`全画布运行完成：${runnableNodes.length} 个节点已按依赖顺序处理${skippedCount ? `，已跳过 ${skippedCount} 个禁用节点` : ""}。`);
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
    rememberGraphHistory();
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
      draggable: true,
      position: { x: selectedNode.position.x + 40, y: selectedNode.position.y + 40 },
      data: { ...(selectedNode.data as Record<string, unknown>), graphNodeId: id, title: `${String(selectedData.title || nodeLabels[selectedType] || "节点")} 副本`, status: "draft", locked: false, disabled: false }
    };
    rememberGraphHistory();
    setNodes((items) => [...items, duplicated]);
    setSelectedNodeId(id);
    setStatus("节点已复制，可继续编辑参数或接入连线。");
  }

  function duplicateSelectedNodes() {
    if (selectedNodes.length <= 1) {
      duplicateSelectedNode();
      return;
    }
    const timestamp = Date.now();
    const idMap = new Map<string, string>();
    const duplicatedNodes = selectedNodes.map((node, index) => {
      const data = node.data as Record<string, unknown>;
      const type = String(data.nodeType || "text");
      const id = `copy-${node.id}-${timestamp}-${index}`;
      idMap.set(node.id, id);
      return {
        ...node,
        id,
        selected: true,
        draggable: true,
        position: { x: node.position.x + 56, y: node.position.y + 56 },
        data: { ...data, graphNodeId: id, title: `${String(data.title || nodeLabels[type] || "节点")} 副本`, status: "draft", locked: false, disabled: false }
      } satisfies Node;
    });
    const duplicatedEdges = selectedSelectionEdges.flatMap((edge, index) => {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      if (!source || !target) return [];
      return [edgeWithDefaultHandles({
        ...edge,
        id: `edge-copy-${timestamp}-${index}`,
        source,
        target
      } satisfies Edge)];
    });
    rememberGraphHistory();
    setNodes((items) => [...items.map((node) => ({ ...node, selected: false })), ...duplicatedNodes]);
    setEdges((items) => [...items, ...duplicatedEdges]);
    setSelectedNodeId(duplicatedNodes[duplicatedNodes.length - 1]?.id || "");
    setSelectedEdgeId("");
    setStatus(`已复制选区：${duplicatedNodes.length} 个节点、${duplicatedEdges.length} 条连线。`);
  }

  function copySelectedNodes() {
    if (!selectedNodes.length) {
      setStatus("请先框选或点选节点，再复制选区。");
      return;
    }
    const snapshot = { nodes: selectedNodes, edges: selectedSelectionEdges };
    setCopiedSelection(snapshot);
    window.localStorage.setItem(`project_graph_clipboard_${projectId}`, JSON.stringify(snapshot));
    setStatus(`已复制选区：${selectedNodes.length} 个节点、${selectedSelectionEdges.length} 条连线。`);
  }

  async function cutSelectedNodes() {
    if (!selectedNodes.length) {
      setStatus("请先框选或点选节点，再剪切选区。");
      return;
    }
    const unlockedNodes = selectedNodes.filter((node) => (node.data as Record<string, unknown>).locked !== true);
    if (!unlockedNodes.length) {
      setStatus("选区节点均已锁定，请先解锁再剪切。");
      return;
    }
    const unlockedIds = new Set(unlockedNodes.map((node) => node.id));
    const snapshot = { nodes: unlockedNodes, edges: selectedSelectionEdges.filter((edge) => unlockedIds.has(edge.source) && unlockedIds.has(edge.target)) };
    setCopiedSelection(snapshot);
    window.localStorage.setItem(`project_graph_clipboard_${projectId}`, JSON.stringify(snapshot));
    await deleteSelectedNodes();
    setStatus(`已剪切选区到画布剪贴板：${snapshot.nodes.length} 个节点、${snapshot.edges.length} 条连线${unlockedNodes.length < selectedNodes.length ? "，已跳过锁定节点" : ""}。`);
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

  async function copyTextToSystemClipboard(text: string, fallbackKey: string) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      window.localStorage.setItem(fallbackKey, text);
      return false;
    }
  }

  async function copySelectedNodeId() {
    if (!selectedNode) {
      setStatus("请先选择一个节点，再复制节点 ID。");
      return;
    }
    const copiedToClipboard = await copyTextToSystemClipboard(selectedNode.id, `project_graph_node_id_${projectId}`);
    setStatus(copiedToClipboard ? "已复制节点 ID 到系统剪贴板。" : "浏览器剪贴板不可用，已把节点 ID 暂存到本地。");
  }

  async function copySelectedNodeParams() {
    if (!selectedNode) {
      setStatus("请先选择一个节点，再复制节点参数 JSON。");
      return;
    }
    const payload = JSON.stringify(fromFlowNode(selectedNode), null, 2);
    const copiedToClipboard = await copyTextToSystemClipboard(payload, `project_graph_node_params_${projectId}`);
    setStatus(copiedToClipboard ? "已复制节点参数 JSON 到系统剪贴板。" : "浏览器剪贴板不可用，已把节点参数 JSON 暂存到本地。");
  }

  async function copySelectedNodeLink() {
    if (!selectedNode) {
      setStatus("请先选择一个节点，再复制节点定位链接。");
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("node", selectedNode.id);
    url.hash = "";
    const copiedToClipboard = await copyTextToSystemClipboard(url.toString(), `project_graph_node_link_${projectId}`);
    setStatus(copiedToClipboard ? "已复制节点定位链接到系统剪贴板。" : "浏览器剪贴板不可用，已把节点定位链接暂存到本地。");
  }

  async function copySelectedEdgeId() {
    if (!selectedEdge) {
      setStatus("请先选择一条连线，再复制连线 ID。");
      return;
    }
    const copiedToClipboard = await copyTextToSystemClipboard(selectedEdge.id, `project_graph_edge_id_${projectId}`);
    setStatus(copiedToClipboard ? "已复制连线 ID 到系统剪贴板。" : "浏览器剪贴板不可用，已把连线 ID 暂存到本地。");
  }

  async function copySelectedEdgeParams() {
    if (!selectedEdge) {
      setStatus("请先选择一条连线，再复制连线参数 JSON。");
      return;
    }
    const payload = JSON.stringify(fromFlowEdge(selectedEdge), null, 2);
    const copiedToClipboard = await copyTextToSystemClipboard(payload, `project_graph_edge_params_${projectId}`);
    setStatus(copiedToClipboard ? "已复制连线参数 JSON 到系统剪贴板。" : "浏览器剪贴板不可用，已把连线参数 JSON 暂存到本地。");
  }

  async function copySelectedEdgeLink() {
    if (!selectedEdge) {
      setStatus("请先选择一条连线，再复制连线定位链接。");
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("node");
    url.searchParams.set("edge", selectedEdge.id);
    url.hash = "";
    const copiedToClipboard = await copyTextToSystemClipboard(url.toString(), `project_graph_edge_link_${projectId}`);
    setStatus(copiedToClipboard ? "已复制连线定位链接到系统剪贴板。" : "浏览器剪贴板不可用，已把连线定位链接暂存到本地。");
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
    const cachedNodes = cached.nodes as Node[];
    const left = Math.min(...cachedNodes.map((node) => node.position.x));
    const right = Math.max(...cachedNodes.map((node) => node.position.x));
    const top = Math.min(...cachedNodes.map((node) => node.position.y));
    const bottom = Math.max(...cachedNodes.map((node) => node.position.y));
    const center = currentViewportCenter();
    const offsetX = Number.isFinite(left) && Number.isFinite(right) ? center.x - (left + right) / 2 : 72;
    const offsetY = Number.isFinite(top) && Number.isFinite(bottom) ? center.y - (top + bottom) / 2 : 72;
    const pastedNodes = cachedNodes.map((node, index) => {
      const id = `paste-${node.id}-${timestamp}-${index}`;
      idMap.set(node.id, id);
      const data: Record<string, unknown> = { ...(node.data as Record<string, unknown>), graphNodeId: id, status: "draft" };
      return {
        ...node,
        id,
        selected: false,
        draggable: data.locked !== true,
        position: { x: node.position.x + offsetX, y: node.position.y + offsetY },
        data
      } satisfies Node;
    });
    const pastedEdges = ((cached.edges || []) as Edge[]).flatMap((edge, index) => {
      const source = idMap.get(edge.source);
      const target = idMap.get(edge.target);
      if (!source || !target) return [];
      return [edgeWithDefaultHandles({
        ...edge,
        id: `edge-paste-${timestamp}-${index}`,
        source,
        target
      } satisfies Edge)];
    });
    rememberGraphHistory();
    setNodes((items) => [...items, ...pastedNodes]);
    setEdges((items) => [...items, ...pastedEdges]);
    setSelectedNodeId(pastedNodes[pastedNodes.length - 1]?.id || "");
    setStatus(`已粘贴链路到当前视图中心：${pastedNodes.length} 个节点、${pastedEdges.length} 条连线。`);
  }

  function autoLayoutSelectedNodes() {
    if (selectedNodes.length <= 1) {
      setStatus("请先框选多个节点，再整理选区。");
      return;
    }
    const selectedEdges = edges.filter((edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target));
    const laidOut = layoutGraphNodes(selectedNodes, selectedEdges);
    const laidOutById = new Map(laidOut.map((node) => [node.id, node]));
    rememberGraphHistory();
    setNodes((items) => items.map((node) => laidOutById.get(node.id) || node));
    setStatus(`已整理选区：${selectedNodes.length} 个节点。`);
  }

  function connectSelectedNodesInOrder() {
    if (selectedNodes.length <= 1) {
      setStatus("请先框选多个节点，再串联选区。");
      return;
    }
    const ordered = [...selectedNodes].sort((first, second) => first.position.x - second.position.x || first.position.y - second.position.y);
    const timestamp = Date.now();
    const nextEdges: Edge[] = [];
    for (let index = 0; index < ordered.length - 1; index += 1) {
      const source = ordered[index].id;
      const target = ordered[index + 1].id;
      const connection = { source, target, sourceHandle: "output", targetHandle: "input" };
      if (connectionIssueMessage(connection, [...edges, ...nextEdges])) continue;
      nextEdges.push(edgeWithDefaultHandles({
        id: `edge-selection-chain-${timestamp}-${index}`,
        ...connection,
        animated: true,
        data: { label: "选区串联" }
      } satisfies Edge));
    }
    if (!nextEdges.length) {
      setStatus("选区节点已存在顺序连线，无需重复串联。");
      return;
    }
    rememberGraphHistory();
    setEdges((items) => [...items, ...nextEdges]);
    setStatus(`已按从左到右顺序串联选区：新增 ${nextEdges.length} 条连线。`);
  }

  function alignSelectedNodes(mode: "left" | "centerX" | "right" | "top" | "centerY" | "bottom" | "horizontal" | "vertical") {
    if (selectedNodes.length <= 1) {
      setStatus("请先框选多个节点，再对齐或分布选区。");
      return;
    }
    const sortedByX = [...selectedNodes].sort((a, b) => a.position.x - b.position.x);
    const sortedByY = [...selectedNodes].sort((a, b) => a.position.y - b.position.y);
    const left = Math.min(...selectedNodes.map((node) => node.position.x));
    const right = Math.max(...selectedNodes.map((node) => node.position.x));
    const top = Math.min(...selectedNodes.map((node) => node.position.y));
    const bottom = Math.max(...selectedNodes.map((node) => node.position.y));
    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;
    const horizontalGap = sortedByX.length > 1 ? (sortedByX[sortedByX.length - 1].position.x - sortedByX[0].position.x) / (sortedByX.length - 1) : 0;
    const verticalGap = sortedByY.length > 1 ? (sortedByY[sortedByY.length - 1].position.y - sortedByY[0].position.y) / (sortedByY.length - 1) : 0;
    const nextPositionById = new Map<string, { x: number; y: number }>();
    if (mode === "left") {
      for (const node of selectedNodes) nextPositionById.set(node.id, { ...node.position, x: left });
    }
    if (mode === "centerX") {
      for (const node of selectedNodes) nextPositionById.set(node.id, { ...node.position, x: centerX });
    }
    if (mode === "right") {
      for (const node of selectedNodes) nextPositionById.set(node.id, { ...node.position, x: right });
    }
    if (mode === "top") {
      for (const node of selectedNodes) nextPositionById.set(node.id, { ...node.position, y: top });
    }
    if (mode === "centerY") {
      for (const node of selectedNodes) nextPositionById.set(node.id, { ...node.position, y: centerY });
    }
    if (mode === "bottom") {
      for (const node of selectedNodes) nextPositionById.set(node.id, { ...node.position, y: bottom });
    }
    if (mode === "horizontal") {
      sortedByX.forEach((node, index) => nextPositionById.set(node.id, { ...node.position, x: sortedByX[0].position.x + horizontalGap * index }));
    }
    if (mode === "vertical") {
      sortedByY.forEach((node, index) => nextPositionById.set(node.id, { ...node.position, y: sortedByY[0].position.y + verticalGap * index }));
    }
    rememberGraphHistory();
    setNodes((items) => items.map((node) => nextPositionById.has(node.id) ? { ...node, position: nextPositionById.get(node.id) || node.position } : node));
    const label = mode === "left" ? "左对齐" : mode === "centerX" ? "水平居中对齐" : mode === "right" ? "右对齐" : mode === "top" ? "顶部对齐" : mode === "centerY" ? "垂直居中对齐" : mode === "bottom" ? "底部对齐" : mode === "horizontal" ? "水平等距分布" : "垂直等距分布";
    setStatus(`已${label}选区：${selectedNodes.length} 个节点。`);
  }

  function nudgeSelectedNodes(deltaX: number, deltaY: number) {
    if (!selectedNodes.length) {
      setStatus("请先选择节点，再用方向键微调位置。");
      return;
    }
    const movableIds = new Set(selectedNodes.filter((node) => (node.data as Record<string, unknown>).locked !== true).map((node) => node.id));
    if (!movableIds.size) {
      setStatus("选区节点均已锁定，请先解锁再移动。");
      return;
    }
    rememberGraphHistory();
    setNodes((items) => items.map((node) => movableIds.has(node.id) ? { ...node, position: { x: node.position.x + deltaX, y: node.position.y + deltaY } } : node));
    const direction = deltaX < 0 ? "左" : deltaX > 0 ? "右" : deltaY < 0 ? "上" : "下";
    const distance = Math.abs(deltaX || deltaY);
    setStatus(`已向${direction}微调选区 ${distance}px：${movableIds.size} 个节点${movableIds.size < selectedNodes.length ? "，已跳过锁定节点" : ""}。`);
  }

  function nodeLayerValue(node: Node) {
    if (typeof node.zIndex === "number" && Number.isFinite(node.zIndex)) return node.zIndex;
    const dataLayer = Number((node.data as Record<string, unknown>).layer_z);
    return Number.isFinite(dataLayer) ? dataLayer : 0;
  }

  function setSelectedNodesLayer(mode: "front" | "back") {
    if (!selectedNodes.length) {
      setStatus("请先选择节点，再调整层级。");
      return;
    }
    const layerValues = nodes.map(nodeLayerValue);
    const maxLayer = layerValues.length ? Math.max(...layerValues) : 0;
    const minLayer = layerValues.length ? Math.min(...layerValues) : 0;
    const selectedByLayer = [...selectedNodes].sort((a, b) => mode === "front" ? nodeLayerValue(a) - nodeLayerValue(b) : nodeLayerValue(b) - nodeLayerValue(a));
    const nextLayerById = new Map<string, number>();
    selectedByLayer.forEach((node, index) => nextLayerById.set(node.id, mode === "front" ? maxLayer + index + 1 : minLayer - index - 1));
    rememberGraphHistory();
    setNodes((items) => items.map((node) => {
      const nextLayer = nextLayerById.get(node.id);
      return nextLayer === undefined ? node : { ...node, zIndex: nextLayer, data: { ...(node.data as Record<string, unknown>), layer_z: nextLayer } };
    }));
    setStatus(`已${mode === "front" ? "置顶" : "置底"}选区：${nextLayerById.size} 个节点。`);
  }

  function setSelectedNodesLocked(locked: boolean) {
    if (!selectedNodes.length) return;
    rememberGraphHistory();
    setNodes((items) => items.map((node) => selectedNodeIds.has(node.id) ? { ...node, draggable: !locked, data: { ...(node.data as Record<string, unknown>), locked } } : node));
    setStatus(locked ? `已锁定选区：${selectedNodes.length} 个节点。` : `已解锁选区：${selectedNodes.length} 个节点。`);
  }

  function setSelectedNodesDisabled(disabled: boolean) {
    if (!selectedNodes.length) return;
    rememberGraphHistory();
    setNodes((items) => items.map((node) => selectedNodeIds.has(node.id) ? { ...node, data: { ...(node.data as Record<string, unknown>), disabled } } : node));
    setStatus(disabled ? `已禁用选区：${selectedNodes.length} 个节点，运行时会跳过。` : `已启用选区：${selectedNodes.length} 个节点。`);
  }

  function setSelectedNodesCollapsed(collapsed: boolean) {
    if (!selectedNodes.length) return;
    rememberGraphHistory();
    setNodes((items) => items.map((node) => selectedNodeIds.has(node.id) ? { ...node, data: { ...(node.data as Record<string, unknown>), collapsed } } : node));
    setStatus(collapsed ? `已折叠选区：${selectedNodes.length} 个节点。` : `已展开选区：${selectedNodes.length} 个节点。`);
  }

  function setSelectedNodesColor(color: string) {
    if (!selectedNodes.length) return;
    const markerColor = nodeMarkerColorByValue.get(color) || nodeMarkerColorByValue.get("");
    rememberGraphHistory();
    setNodes((items) => items.map((node) => selectedNodeIds.has(node.id) ? { ...node, data: { ...(node.data as Record<string, unknown>), node_color: markerColor?.value || "" } } : node));
    setStatus(markerColor?.value ? `已设置选区颜色标记：${markerColor.label}，共 ${selectedNodes.length} 个节点。` : `已清空选区颜色标记：${selectedNodes.length} 个节点。`);
  }

  function renameSelectedNodesWithPrefix() {
    if (!selectedNodes.length) return;
    const prefix = selectedRenamePrefix.trim();
    if (!prefix) {
      setStatus("请输入选区批量命名前缀。");
      return;
    }
    const orderedIds = [...selectedNodes]
      .sort((first, second) => first.position.y - second.position.y || first.position.x - second.position.x)
      .map((node) => node.id);
    const indexById = new Map(orderedIds.map((id, index) => [id, index + 1]));
    const width = String(selectedNodes.length).length < 2 ? 2 : String(selectedNodes.length).length;
    rememberGraphHistory();
    setNodes((items) => items.map((node) => {
      const index = indexById.get(node.id);
      if (!index) return node;
      return { ...node, data: { ...(node.data as Record<string, unknown>), title: `${prefix} ${String(index).padStart(width, "0")}` } };
    }));
    setStatus(`已按前缀 ${prefix} 重命名选区：${selectedNodes.length} 个节点。`);
  }

  function setSelectedSelectionEdgesDisabled(disabled: boolean) {
    if (!selectedSelectionEdges.length) {
      setStatus("当前选区没有内部连线可批量操作。");
      return;
    }
    const edgeIds = new Set(selectedSelectionEdges.map((edge) => edge.id));
    rememberGraphHistory();
    setEdges((items) => items.map((edge) => edgeIds.has(edge.id) ? edgeWithDefaultHandles({
      ...edge,
      data: { ...(edge.data as Record<string, unknown> | undefined), disabled }
    }) : edge));
    setStatus(disabled ? `已禁用选区内部连线：${selectedSelectionEdges.length} 条。` : `已启用选区内部连线：${selectedSelectionEdges.length} 条。`);
  }

  function deleteSelectedSelectionEdges() {
    if (!selectedSelectionEdges.length) {
      setStatus("当前选区没有内部连线可删除。");
      return;
    }
    const edgeIds = new Set(selectedSelectionEdges.map((edge) => edge.id));
    rememberGraphHistory();
    setEdges((items) => items.filter((edge) => !edgeIds.has(edge.id)));
    setSelectedEdgeId("");
    setStatus(`已删除选区内部连线：${selectedSelectionEdges.length} 条，节点仍保留。`);
  }

  function disconnectSelectedNodes() {
    if (!selectedNodes.length) return;
    const incidentEdges = edges.filter((edge) => selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target));
    if (!incidentEdges.length) {
      setStatus(selectedNodes.length > 1 ? "当前选区没有可断开的连线。" : "当前节点没有可断开的连线。");
      return;
    }
    const edgeIds = new Set(incidentEdges.map((edge) => edge.id));
    rememberGraphHistory();
    setEdges((items) => items.filter((edge) => !edgeIds.has(edge.id)));
    setSelectedEdgeId("");
    setStatus(selectedNodes.length > 1 ? `已断开选区相关连线：${incidentEdges.length} 条，节点仍保留。` : `已断开当前节点相关连线：${incidentEdges.length} 条，节点仍保留。`);
  }

  function setSelectedSelectionEdgesColor(color: string) {
    if (!selectedSelectionEdges.length) {
      setStatus("当前选区没有内部连线可设置颜色。");
      return;
    }
    const markerColor = edgeMarkerColorByValue.get(color) || edgeMarkerColorByValue.get("");
    const edgeIds = new Set(selectedSelectionEdges.map((edge) => edge.id));
    rememberGraphHistory();
    setEdges((items) => items.map((edge) => edgeIds.has(edge.id) ? edgeWithDefaultHandles({
      ...edge,
      data: { ...(edge.data as Record<string, unknown> | undefined), edge_color: markerColor?.value || "" }
    }) : edge));
    setStatus(markerColor?.value ? `已设置选区内部连线颜色：${markerColor.label}，共 ${selectedSelectionEdges.length} 条。` : `已清空选区内部连线颜色：${selectedSelectionEdges.length} 条。`);
  }

  function setSelectedSelectionEdgesStyle(style: string) {
    if (!selectedSelectionEdges.length) {
      setStatus("当前选区没有内部连线可设置样式。");
      return;
    }
    const lineStyle = edgeLineStyleByValue.get(style) || edgeLineStyleByValue.get("");
    const edgeIds = new Set(selectedSelectionEdges.map((edge) => edge.id));
    rememberGraphHistory();
    setEdges((items) => items.map((edge) => edgeIds.has(edge.id) ? edgeWithDefaultHandles({
      ...edge,
      data: { ...(edge.data as Record<string, unknown> | undefined), edge_style: lineStyle?.value || "" }
    }) : edge));
    setStatus(lineStyle?.value ? `已设置选区内部连线样式：${lineStyle.label}，共 ${selectedSelectionEdges.length} 条。` : `已恢复选区内部连线为默认实线：${selectedSelectionEdges.length} 条。`);
  }

  function groupSelectedNodes() {
    if (selectedNodes.length <= 1) {
      setStatus("请先框选多个节点，再打组为工作流片段。");
      return;
    }
    const groupId = `group-${Date.now()}`;
    const groupTitle = `工作流组 ${selectedNodes.length} 节点`;
    rememberGraphHistory();
    setNodes((items) => items.map((node) => selectedNodeIds.has(node.id) ? {
      ...node,
      data: { ...(node.data as Record<string, unknown>), group_id: groupId, group_title: groupTitle }
    } : node));
    setStatus(`已打组选区：${groupTitle}，可继续复制、整理或保存为我的工作流预设。`);
  }

  function updateSelectedGroupTitle(title: string, announce = false) {
    if (!selectedGroupIds.size) {
      if (announce) setStatus("当前选区没有已打组节点。");
      return;
    }
    setNodes((items) => items.map((node) => {
      const groupId = String((node.data as Record<string, unknown>).group_id || "");
      if (!selectedGroupIds.has(groupId)) return node;
      return { ...node, data: { ...(node.data as Record<string, unknown>), group_title: title } };
    }));
    if (announce) setStatus(`已更新分组名称：${title || "未命名分组"}。`);
  }

  function ungroupSelectedNodes() {
    if (!selectedNodes.length) return;
    const groupedCount = selectedNodes.filter((node) => String((node.data as Record<string, unknown>).group_id || "")).length;
    if (!groupedCount) {
      setStatus("当前选区没有已打组节点。");
      return;
    }
    rememberGraphHistory();
    setNodes((items) => items.map((node) => {
      if (!selectedNodeIds.has(node.id)) return node;
      const data = { ...(node.data as Record<string, unknown>) };
      delete data.group_id;
      delete data.group_title;
      return { ...node, data };
    }));
    setStatus(`已取消 ${groupedCount} 个节点的分组。`);
  }

  async function deleteSelectedNodes() {
    if (!selectedNodes.length) return;
    const unlockedIds = new Set(selectedNodes.filter((node) => (node.data as Record<string, unknown>).locked !== true).map((node) => node.id));
    if (!unlockedIds.size) {
      setStatus("选区节点均已锁定，请先解锁再删除。");
      return;
    }
    rememberGraphHistory();
    setNodes((items) => items.filter((node) => !unlockedIds.has(node.id)));
    setEdges((items) => items.filter((edge) => !unlockedIds.has(edge.source) && !unlockedIds.has(edge.target)));
    setSelectedNodeId("");
    setSelectedEdgeId("");
    const remoteNodeIds = [...unlockedIds].filter((nodeId) => !nodeId.startsWith("local-"));
    if (remoteNodeIds.length) {
      const userId = currentUserId();
      await Promise.allSettled(remoteNodeIds.map((nodeId) => deleteJson(`/api/projects/${projectId}/graph/nodes/${nodeId}`, { user_id: userId })));
    }
    setStatus(`已删除选区：${unlockedIds.size} 个节点${unlockedIds.size < selectedNodes.length ? "，已跳过锁定节点" : ""}。`);
  }

  async function deleteSelectedNode() {
    if (!selectedNode) return;
    const nodeId = selectedNode.id;
    if ((selectedNode.data as Record<string, unknown>).locked === true) {
      setStatus("节点已锁定，请先解锁再删除。");
      return;
    }
    rememberGraphHistory();
    setNodes((items) => items.filter((node) => node.id !== nodeId));
    setEdges((items) => items.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setSelectedEdgeId("");
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
    rememberGraphHistory();
    setNodes((items) => [...items, {
      id,
      type: "platform",
      draggable: true,
      position: { x: 260 + items.length * 32, y: 220 + items.length * 24 },
      data: { title: `素材 ${asset.asset_type}`, nodeType: type, graphNodeId: id, status: "completed", [dataKey]: asset.url, text: asset.workflow_key || asset.source_task_type || "项目素材" }
    }]);
    setStatus("素材已拖入画布。 ");
  }

  function downloadJsonFile(text: string, filename: string) {
    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function exportWorkflowJson() {
    const graph = {
      id: `export-${projectId}-${Date.now()}`,
      project_id: projectId,
      title: project?.title || "全画幅工作流",
      exported_at: new Date().toISOString(),
      nodes: nodes.map(fromFlowNode),
      edges: edges.map(fromFlowEdge),
      viewport: currentCanvasViewport(),
      status: "draft"
    };
    const text = JSON.stringify(graph, null, 2);
    downloadJsonFile(text, `${project?.title || "video-gen-workflow"}.json`);
    const copiedToClipboard = await copyTextToSystemClipboard(text, `project_graph_workflow_export_${projectId}`);
    setStatus(copiedToClipboard ? `已下载并复制工作流 ProjectGraph JSON：${graph.nodes.length} 个节点、${graph.edges.length} 条连线。` : "已下载工作流 ProjectGraph JSON；浏览器剪贴板不可用，已把内容暂存到本地。");
  }

  async function exportSelectedWorkflowJson() {
    if (!selectedNodes.length) {
      setStatus("请先框选或点选节点，再导出选区 JSON。");
      return;
    }
    const graph = {
      id: `export-selection-${projectId}-${Date.now()}`,
      project_id: projectId,
      title: `${project?.title || "全画幅工作流"} 选区`,
      exported_at: new Date().toISOString(),
      nodes: selectedNodes.map(fromFlowNode),
      edges: selectedSelectionEdges.map(fromFlowEdge),
      viewport: currentCanvasViewport(),
      status: "draft"
    };
    const text = JSON.stringify(graph, null, 2);
    downloadJsonFile(text, `${project?.title || "video-gen-workflow"}-选区.json`);
    const copiedToClipboard = await copyTextToSystemClipboard(text, `project_graph_selection_export_${projectId}`);
    setStatus(copiedToClipboard ? `已下载并复制选区 ProjectGraph JSON：${graph.nodes.length} 个节点、${graph.edges.length} 条连线。` : "已下载选区 ProjectGraph JSON；浏览器剪贴板不可用，已把内容暂存到本地。");
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
      return [edgeWithDefaultHandles({
        id: `edge-import-${timestamp}-${index}`,
        source,
        target,
        sourceHandle: edge.sourceHandle || "output",
        targetHandle: edge.targetHandle || "input",
        data: edge.data || {}
      } satisfies Edge)];
    });
    rememberGraphHistory();
    setNodes((items) => [...items, ...importedNodes]);
    setEdges((items) => [...items, ...importedEdges]);
    restoreCanvasViewport(graph.viewport);
    setSelectedNodeId(importedNodes[0]?.id || "");
    setShowImport(false);
    setImportText("");
    setStatus(`已导入工作流：${importedNodes.length} 个节点、${importedEdges.length} 条连线。`);
  }

  async function loadImportJsonFile(event: ReactChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.type && file.type !== "application/json" && !file.name.toLowerCase().endsWith(".json")) {
      setStatus("请选择从画布导出的 JSON 文件。");
      return;
    }
    try {
      const text = await file.text();
      if (!text.trim()) {
        setStatus("导入文件为空，请选择有效的 ProjectGraph JSON 文件。");
        return;
      }
      setImportText(text);
      setStatus(`已读取导入文件：${file.name}，确认后会追加到当前画布。`);
    } catch {
      setStatus("导入文件读取失败，请重新选择 JSON 文件。");
    }
  }

  async function loadImportJsonFromClipboard() {
    let text = "";
    const fallbackText = () => window.localStorage.getItem(`project_graph_selection_export_${projectId}`) || window.localStorage.getItem(`project_graph_workflow_export_${projectId}`) || "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = fallbackText();
    }
    if (!text.trim()) text = fallbackText();
    if (!text.trim()) {
      setStatus("剪贴板中没有可导入的 ProjectGraph JSON，请先复制或导出工作流。");
      return;
    }
    setImportText(text);
    setStatus("已从剪贴板读取 ProjectGraph JSON，确认后会追加到当前画布。");
  }

  const selectedData = (selectedNode?.data || {}) as Record<string, unknown>;
  const selectedType = String(selectedData.nodeType || "text");
  const selectedEdgeSource = selectedEdge ? nodes.find((node) => node.id === selectedEdge.source) || null : null;
  const selectedEdgeTarget = selectedEdge ? nodes.find((node) => node.id === selectedEdge.target) || null : null;
  const selectedEdgeLabel = String((selectedEdge?.data as Record<string, unknown> | undefined)?.label || "");
  const selectedEdgeColor = String((selectedEdge?.data as Record<string, unknown> | undefined)?.edge_color || "");
  const selectedEdgeStyle = String((selectedEdge?.data as Record<string, unknown> | undefined)?.edge_style || "");
  const selectedEdgeDisabled = selectedEdge ? isEdgeDisabled(selectedEdge) : false;
  const selectedEdgeSourcePorts = semanticPortsForNode(selectedEdgeSource, "output");
  const selectedEdgeTargetPorts = semanticPortsForNode(selectedEdgeTarget, "input");
  const commandPaletteItems: { key: string; title: string; description: string; shortcut?: string; disabled?: boolean; run: () => void }[] = [
    { key: "save", title: "保存画布", description: "同步当前节点、连线和视口", shortcut: "Ctrl/⌘ S", disabled: busy, run: () => void saveGraph() },
    { key: "run-graph", title: "运行全图", description: "运行所有终点链路", shortcut: "Ctrl/⌘ R", disabled: busy || !nodes.length, run: () => void runCanvasGraph() },
    { key: "layout", title: "整理画布", description: "按依赖关系自动整理节点", shortcut: "Ctrl/⌘ L", disabled: busy || !nodes.length, run: autoLayoutGraph },
    { key: "validate", title: "画布自检", description: "检查断线、缺参、禁用和运行阻断问题", disabled: busy || !nodes.length, run: () => setShowValidation(true) },
    { key: "import", title: "导入工作流 JSON", description: "把外部 ProjectGraph 追加到当前画布", disabled: busy, run: () => setShowImport(true) },
    { key: "export", title: "导出工作流 JSON", description: "下载并复制当前完整工作流", disabled: busy || !nodes.length, run: () => void exportWorkflowJson() },
    { key: "export-selection", title: "导出选区 JSON", description: "下载并复制当前选区节点和连线", disabled: busy || !selectedNodes.length, run: () => void exportSelectedWorkflowJson() },
    { key: "save-preset", title: "保存当前画布为预设", description: "保存到我的工作流预设", disabled: !nodes.length, run: saveCurrentWorkflowAsPreset },
    { key: "save-version", title: "保存画布版本快照", description: "保存当前节点、连线和视口，便于回滚", disabled: !nodes.length, run: saveCurrentGraphVersion },
    { key: "export-version", title: "导出最新画布版本", description: "下载并复制最近保存的版本快照 JSON", disabled: !graphVersions.length, run: () => { if (graphVersions[0]) void exportGraphVersion(graphVersions[0]); } },
    { key: "show-versions", title: "打开画布版本历史", description: "恢复或删除本项目的本地画布快照", run: () => setShowGraphVersions(true) },
    { key: "show-palette", title: "打开节点面板", description: "搜索添加平台生成、素材和基础节点", run: () => setShowPalette(true) },
    { key: "show-outline", title: "打开节点大纲", description: "搜索、定位和批量选择节点", disabled: !nodes.length, run: () => setShowOutline(true) },
    { key: "show-shots", title: "打开项目分镜面板", description: "按分镜铺设文本、画面、视频、配音和合成链路", run: () => setShowShots(true) },
    { key: "show-assets", title: "打开素材库", description: "筛选并拖入项目图片、视频和音频素材", run: () => setShowAssets(true) },
    { key: "show-tasks", title: "打开任务队列", description: "筛选、定位、同步、重试和取消生成任务", run: () => setShowTasks(true) },
    { key: "select-all", title: "全选画布节点", description: "选中当前画布所有节点", shortcut: "Ctrl/⌘ A", disabled: !nodes.length, run: selectAllCanvasNodes },
    { key: "invert-selection", title: "反选画布节点", description: "反转当前节点选区", shortcut: "Ctrl/⌘ Shift A", disabled: !nodes.length, run: invertCanvasSelection },
    { key: "clear-selection", title: "清空当前选区", description: "取消节点和连线选择", shortcut: "Esc", disabled: !selectedNodes.length && !selectedEdge, run: clearCanvasSelection },
    { key: "fit-graph", title: "适配全部节点", description: "把完整节点图适配到当前视图", shortcut: "Ctrl/⌘ 1", disabled: !nodes.length, run: fitGraphView },
    { key: "fit-selection", title: "适配选中节点", description: "把当前选区适配到视图中心", shortcut: "Ctrl/⌘ 2", disabled: !selectedNodes.length, run: fitSelectedNodeView },
    { key: "reset-view", title: "重置画布视口", description: "恢复默认缩放和平移", shortcut: "Ctrl/⌘ 0", run: resetCanvasViewport },
    { key: "view-bookmark", title: "打开画布视图书签", description: "保存和恢复常用画布视角", run: () => setShowViewBookmarks(true) }
  ];
  const filteredCommandPaletteItems = commandPaletteItems.filter((item) => {
    const query = commandQuery.trim().toLowerCase();
    if (!query) return true;
    return [item.title, item.description, item.shortcut || ""].some((value) => value.toLowerCase().includes(query));
  });

  return (
    <main className="h-screen overflow-hidden bg-[#0b1020] text-white">
      <header className="absolute left-4 right-4 top-3 z-20 flex items-center justify-between rounded-lg border border-white/10 bg-slate-950/85 px-4 py-3 shadow-2xl backdrop-blur">
        <div>
          <a className="text-xs text-slate-400 hover:text-white" href="/create">返回创作入口</a>
          <h1 className="mt-1 text-lg font-semibold">{project?.title || "全画幅创作画布"}</h1>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="max-w-[420px] truncate rounded border border-white/10 bg-white/5 px-3 py-2 text-slate-300">{status}</span>
          <button className="inline-flex items-center gap-2 rounded-md border border-white/15 px-3 py-2 text-slate-100 hover:bg-white/10" onClick={() => { setShowCommandPalette(true); setCommandQuery(""); }}><Search size={16} />命令</button>
          <button disabled={busy} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-3 py-2 disabled:opacity-50" onClick={() => void refreshAll()}><RefreshCcw size={16} />刷新</button>
          <button disabled={busy || !graphPast.length} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-3 py-2 disabled:opacity-50" onClick={undoGraphChange}><Undo2 size={16} />撤销</button>
          <button disabled={busy || !graphFuture.length} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-3 py-2 disabled:opacity-50" onClick={redoGraphChange}><Redo2 size={16} />重做</button>
          <button disabled={busy || !nodes.length} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-3 py-2 disabled:opacity-50" onClick={() => void exportWorkflowJson()}><Download size={16} />导出工作流</button>
          <button disabled={busy} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-3 py-2 disabled:opacity-50" onClick={() => setShowImport((value) => !value)}><Upload size={16} />导入工作流</button>
          <button title={snapToGrid ? "关闭网格吸附" : "开启网格吸附"} disabled={busy} className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 disabled:opacity-50 ${snapToGrid ? "border-blue-400/40 bg-blue-500/10 text-blue-50" : "border-white/15"}`} onClick={toggleSnapToGrid}><LayoutGrid size={16} />网格吸附</button>
          <button disabled={busy || !nodes.length} className="inline-flex items-center gap-2 rounded-md border border-amber-400/40 bg-amber-500/10 px-3 py-2 disabled:opacity-50" onClick={() => setShowValidation((value) => !value)}><AlertTriangle size={16} />画布自检 {graphValidation.errorCount ? graphValidation.errorCount : ""}</button>
          <button disabled={busy || !nodes.length} className="inline-flex items-center gap-2 rounded-md border border-white/15 px-3 py-2 disabled:opacity-50" onClick={autoLayoutGraph}><LayoutGrid size={16} />整理画布</button>
          <button disabled={busy || !nodes.length} className="inline-flex items-center gap-2 rounded-md border border-blue-400/40 bg-blue-500/10 px-3 py-2 disabled:opacity-50" onClick={() => void runCanvasGraph()}><GitBranch size={16} />运行全图</button>
          <button disabled={busy} className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 disabled:opacity-50" onClick={() => void saveGraph()}><Save size={16} />保存画布</button>
        </div>
      </header>

      {showCommandPalette && <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm" onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          setShowCommandPalette(false);
          setCommandQuery("");
        }
      }}>
        <section className="mx-auto mt-24 w-[min(560px,calc(100vw-32px))] overflow-hidden rounded-lg border border-white/10 bg-slate-950/95 shadow-2xl">
          <div className="border-b border-white/10 p-3">
            <label className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm">
              <Search size={16} className="text-slate-400" />
              <input autoFocus className="w-full bg-transparent outline-none placeholder:text-slate-500" placeholder="搜索命令、面板、导入导出、运行或视图操作" value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} />
              <span className="rounded border border-white/10 px-2 py-1 text-[11px] text-slate-400">Ctrl/⌘ K</span>
            </label>
          </div>
          <div className="max-h-[520px] overflow-auto p-2">
            {filteredCommandPaletteItems.map((item) => <button key={item.key} disabled={item.disabled} className="flex w-full items-start justify-between gap-4 rounded-md px-3 py-3 text-left hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => {
              if (item.disabled) return;
              setShowCommandPalette(false);
              setCommandQuery("");
              item.run();
            }}>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-white">{item.title}</span>
                <span className="mt-1 block text-xs leading-5 text-slate-400">{item.description}</span>
              </span>
              {item.shortcut && <span className="shrink-0 rounded border border-white/10 px-2 py-1 text-[11px] text-slate-400">{item.shortcut}</span>}
            </button>)}
            {!filteredCommandPaletteItems.length && <p className="rounded-md border border-white/10 px-3 py-4 text-sm text-slate-400">没有匹配的画布命令，请换一个关键词。</p>}
          </div>
        </section>
      </div>}

      <aside className="absolute left-4 top-28 z-20 grid gap-2 rounded-lg border border-white/10 bg-slate-950/85 p-2 shadow-2xl backdrop-blur">
        <button title="添加节点" className="grid h-10 w-10 place-items-center rounded-md bg-blue-600 text-white hover:bg-blue-500" onClick={() => setShowPalette((value) => !value)}><Plus size={18} /></button>
        <button title="节点大纲" className="grid h-10 w-10 place-items-center rounded-md text-slate-200 hover:bg-white/10" onClick={() => setShowOutline((value) => !value)}><ListTree size={18} /></button>
        <button title={selectionOnDrag ? "关闭拖拽框选" : "开启拖拽框选"} disabled={!nodes.length} className={`grid h-10 w-10 place-items-center rounded-md hover:bg-white/10 disabled:opacity-40 ${selectionOnDrag ? "bg-blue-500/15 text-blue-50" : "text-slate-200"}`} onClick={toggleSelectionOnDrag}><CheckSquare size={18} /></button>
        <button title="全选画布节点" disabled={!nodes.length} className="grid h-10 w-10 place-items-center rounded-md text-slate-200 hover:bg-white/10 disabled:opacity-40" onClick={selectAllCanvasNodes}><CheckSquare size={18} /></button>
        <button title="反选画布节点" disabled={!nodes.length} className="grid h-10 w-10 place-items-center rounded-md text-slate-200 hover:bg-white/10 disabled:opacity-40" onClick={invertCanvasSelection}><CheckSquare size={18} /></button>
        <button title="清空当前选区" disabled={!selectedNodes.length && !selectedEdge} className="grid h-10 w-10 place-items-center rounded-md text-slate-200 hover:bg-white/10 disabled:opacity-40" onClick={clearCanvasSelection}><XSquare size={18} /></button>
        <button title="放大画布 Ctrl/⌘ +" className="grid h-10 w-10 place-items-center rounded-md text-slate-200 hover:bg-white/10" onClick={() => zoomCanvas("in")}><ZoomIn size={18} /></button>
        <button title="缩小画布 Ctrl/⌘ -" className="grid h-10 w-10 place-items-center rounded-md text-slate-200 hover:bg-white/10" onClick={() => zoomCanvas("out")}><ZoomOut size={18} /></button>
        <button title="适配全部节点" disabled={!nodes.length} className="grid h-10 w-10 place-items-center rounded-md text-slate-200 hover:bg-white/10 disabled:opacity-40" onClick={fitGraphView}><Maximize2 size={18} /></button>
        <button title="适配选中节点" disabled={!selectedNodes.length} className="grid h-10 w-10 place-items-center rounded-md text-slate-200 hover:bg-white/10 disabled:opacity-40" onClick={fitSelectedNodeView}><Focus size={18} /></button>
        <button title="重置画布视口" className="grid h-10 w-10 place-items-center rounded-md text-slate-200 hover:bg-white/10" onClick={resetCanvasViewport}><RotateCcw size={18} /></button>
        <button title="视图书签" className="grid h-10 w-10 place-items-center rounded-md text-slate-200 hover:bg-white/10" onClick={() => setShowViewBookmarks((value) => !value)}><Save size={18} /></button>
        <button title="画布版本历史" className="grid h-10 w-10 place-items-center rounded-md text-slate-200 hover:bg-white/10" onClick={() => setShowGraphVersions((value) => !value)}><RotateCcw size={18} /></button>
        <button title={showMiniMap ? "隐藏画布导航器" : "显示画布导航器"} className={`grid h-10 w-10 place-items-center rounded-md hover:bg-white/10 ${showMiniMap ? "bg-blue-500/15 text-blue-50" : "text-slate-200"}`} onClick={toggleMiniMap}><MapIcon size={18} /></button>
        <button title="分镜列表" className="grid h-10 w-10 place-items-center rounded-md text-slate-200 hover:bg-white/10" onClick={() => setShowShots((value) => !value)}><Clapperboard size={18} /></button>
        <button title="素材库" className="grid h-10 w-10 place-items-center rounded-md text-slate-200 hover:bg-white/10" onClick={() => setShowAssets((value) => !value)}><Library size={18} /></button>
        <button title="任务队列" className="grid h-10 w-10 place-items-center rounded-md text-slate-200 hover:bg-white/10" onClick={() => setShowTasks((value) => !value)}><Boxes size={18} /></button>
      </aside>

      {showViewBookmarks && <aside className="absolute left-20 top-28 z-30 w-[340px] rounded-lg border border-white/10 bg-slate-950/95 p-4 shadow-2xl backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-400">视图导航</p>
            <h2 className="font-semibold">画布视图书签</h2>
          </div>
          <span className="rounded border border-white/10 px-2 py-1 text-xs text-slate-400">{viewBookmarks.length}/8</span>
        </div>
        <label className="mt-3 grid gap-1 text-xs text-slate-400">
          书签名称
          <input className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none" value={viewBookmarkTitle} onChange={(event) => setViewBookmarkTitle(event.target.value)} />
        </label>
        <button className="mt-2 w-full rounded-md border border-blue-400/30 bg-blue-500/10 px-3 py-2 text-left text-sm text-white hover:bg-blue-500/20" onClick={saveCurrentViewBookmark}>保存当前视图</button>
        <div className="mt-3 grid gap-2 text-sm">
          {viewBookmarks.map((bookmark) => <article key={bookmark.key} className="rounded-md border border-white/10 bg-white/[0.03] p-2">
            <button className="w-full text-left" onClick={() => restoreViewBookmark(bookmark)}>
              <span className="block truncate font-medium text-white">{bookmark.title}</span>
              <span className="mt-1 block text-xs text-slate-400">缩放 {bookmark.viewport.zoom.toFixed(2)} · x {Math.round(bookmark.viewport.x)} / y {Math.round(bookmark.viewport.y)}</span>
            </button>
            <button className="mt-2 inline-flex items-center gap-1 rounded border border-red-400/30 px-2 py-1 text-xs text-red-100" onClick={() => deleteViewBookmark(bookmark.key)}><Trash2 size={12} />删除书签</button>
          </article>)}
          {!viewBookmarks.length && <p className="rounded-md border border-white/10 px-3 py-2 text-slate-400">暂无视图书签，可先保存当前视图。</p>}
        </div>
      </aside>}

      {showGraphVersions && <aside className="absolute left-20 top-28 z-30 max-h-[620px] w-[380px] overflow-auto rounded-lg border border-white/10 bg-slate-950/95 p-4 shadow-2xl backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-400">版本回滚</p>
            <h2 className="font-semibold">画布版本历史</h2>
          </div>
          <span className="rounded border border-white/10 px-2 py-1 text-xs text-slate-400">{graphVersions.length}/12</span>
        </div>
        <label className="mt-3 grid gap-1 text-xs text-slate-400">
          版本名称
          <input className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none" value={graphVersionTitle} onChange={(event) => setGraphVersionTitle(event.target.value)} />
        </label>
        <button disabled={!nodes.length} className="mt-2 w-full rounded-md border border-blue-400/30 bg-blue-500/10 px-3 py-2 text-left text-sm text-white hover:bg-blue-500/20 disabled:opacity-50" onClick={saveCurrentGraphVersion}>保存当前版本快照</button>
        <div className="mt-3 grid gap-2 text-sm">
          {graphVersions.map((version) => <article key={version.key} className="rounded-md border border-white/10 bg-white/[0.03] p-2">
            <button className="w-full text-left" onClick={() => restoreGraphVersion(version)}>
              <span className="block truncate font-medium text-white">{version.title}</span>
              <span className="mt-1 block text-xs text-slate-400">{version.nodes.length} 个节点 / {version.edges.length} 条连线 · 缩放 {version.viewport.zoom.toFixed(2)}</span>
            </button>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <button className="rounded border border-blue-400/30 px-2 py-1 text-blue-100 hover:bg-blue-500/10" onClick={() => restoreGraphVersion(version)}>恢复版本</button>
              <button className="rounded border border-white/10 px-2 py-1 text-slate-200 hover:bg-white/10" onClick={() => void exportGraphVersion(version)}>导出版本</button>
              <button className="rounded border border-red-400/30 px-2 py-1 text-red-100" onClick={() => deleteGraphVersion(version.key)}>删除版本</button>
            </div>
          </article>)}
          {!graphVersions.length && <p className="rounded-md border border-white/10 px-3 py-2 text-slate-400">暂无画布版本快照，可先保存当前版本。</p>}
        </div>
      </aside>}

      {showOutline && <aside className="absolute left-20 top-28 z-30 max-h-[620px] w-[390px] overflow-auto rounded-lg border border-white/10 bg-slate-950/95 p-4 shadow-2xl backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-400">流程导航</p>
            <h2 className="font-semibold">节点大纲</h2>
          </div>
          <span className="rounded border border-white/10 px-2 py-1 text-xs text-slate-400">{filteredGraphOutlineNodes.length}/{nodes.length} 个节点</span>
        </div>
        <label className="mt-3 flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm">
          <Search size={16} className="text-slate-400" />
          <input className="w-full bg-transparent outline-none placeholder:text-slate-500" placeholder="搜索节点标题、类型、状态" value={outlineQuery} onChange={(event) => setOutlineQuery(event.target.value)} />
        </label>
        <label className="mt-2 flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
          <span>只看问题节点</span>
          <input type="checkbox" checked={outlineIssuesOnly} onChange={(event) => setOutlineIssuesOnly(event.target.checked)} />
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
          <button disabled={!filteredGraphOutlineNodes.length} className="rounded-md border border-white/10 px-3 py-2 text-slate-200 hover:bg-white/10 disabled:opacity-40" onClick={selectFilteredOutlineNodes}>选中当前结果</button>
          <button disabled={!outlineIssueNodeIds.size} className="rounded-md border border-amber-400/30 px-3 py-2 text-amber-100 hover:bg-amber-500/10 disabled:opacity-40" onClick={selectIssueOutlineNodes}>选中问题节点</button>
        </div>
        <div className="mt-3 grid gap-2 text-sm">
          {filteredGraphOutlineNodes.map((node, index) => {
            const data = node.data as Record<string, unknown>;
            const type = String(data.nodeType || "text");
            const incomingCount = activeEdges.filter((edge) => edge.target === node.id).length;
            const outgoingCount = activeEdges.filter((edge) => edge.source === node.id).length;
            const taskId = String(data.task_id || "");
            const task = taskId ? taskById.get(taskId) : null;
            const issueCount = graphValidation.issues.filter((issue) => issue.nodeId === node.id).length;
            return <article key={node.id} className={`rounded-md border px-3 py-2 ${selectedNodeId === node.id ? "border-blue-400/50 bg-blue-500/10" : "border-white/10 bg-white/[0.03]"}`}>
              <button className="w-full text-left" onClick={() => focusCanvasNode(node.id)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="block truncate text-white">{index + 1}. {String(data.title || nodeLabels[type] || "节点")}</strong>
                    <span className="mt-1 block truncate text-xs text-slate-400">{nodeLabels[type] || type} · 入 {incomingCount} / 出 {outgoingCount}</span>
                  </div>
                  <span className="shrink-0 rounded bg-black/30 px-2 py-1 text-[11px] text-slate-300">{task ? statusText(task.status) : statusText(String(data.status || "draft"))}</span>
                </div>
              </button>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                <span className={issueCount ? "text-amber-100" : "text-slate-500"}>{issueCount ? `问题 ${issueCount}` : terminalNodeIdSet.has(node.id) ? "终点节点" : incomingCount ? "链路中节点" : "起点节点"}</span>
                <div className="flex gap-1">
                  <button className="rounded border border-white/10 px-2 py-1 text-slate-200 hover:bg-white/10" onClick={() => focusCanvasNode(node.id)}>定位</button>
                  <button disabled={busy} className="rounded border border-blue-400/30 px-2 py-1 text-blue-100 hover:bg-blue-500/10 disabled:opacity-50" onClick={() => void runNodeChain(node.id)}>运行链路</button>
                </div>
              </div>
            </article>;
          })}
          {!nodes.length && <p className="rounded-md border border-white/10 px-3 py-2 text-slate-400">暂无节点，请先添加节点或工作流预设。</p>}
          {!!nodes.length && !filteredGraphOutlineNodes.length && <p className="rounded-md border border-white/10 px-3 py-2 text-slate-400">没有匹配的大纲节点，请调整搜索或关闭问题筛选。</p>}
        </div>
      </aside>}

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
        {!!recentAddableNodes.length && <section className="mt-4 grid gap-2 rounded-md border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-medium text-slate-400">最近使用节点</h3>
            <span className="rounded border border-white/10 px-2 py-1 text-[11px] text-slate-400">{recentAddableNodes.length} 个</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {recentAddableNodes.map((item) => {
              const Icon = item.icon;
              return <button key={item.type} draggable title={`添加${item.label}`} className="flex items-center gap-2 rounded-md border border-white/10 bg-black/15 px-2 py-2 text-left text-sm text-slate-100 hover:bg-white/10" onClick={() => addNode(item.type)} onDragStart={(event) => handlePaletteNodeDragStart(event, item.type)}>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-white/10"><Icon size={15} /></span>
                <span className="min-w-0 truncate">{item.label}</span>
              </button>;
            })}
          </div>
        </section>}
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
          <div className="grid grid-cols-2 gap-2">
            <button disabled={!nodes.length} className="rounded-md border border-blue-400/30 bg-blue-500/10 px-3 py-2 text-left text-sm text-white hover:bg-blue-500/20 disabled:opacity-50" onClick={saveCurrentWorkflowAsPreset}>保存当前画布为预设</button>
            <button className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm text-slate-100 hover:bg-white/10" onClick={() => void importCustomWorkflowPresetFromClipboard()}>从剪贴板导入预设</button>
          </div>
          {customWorkflowPresets.map((preset) => <article key={preset.key} className="rounded-md border border-white/10 bg-black/15 p-2">
            <button className="w-full text-left" onClick={() => addCustomWorkflowPreset(preset.key)}>
              <span className="block text-sm font-medium text-white">{preset.title}</span>
              <span className="mt-1 block text-xs leading-5 text-slate-400">{preset.description}</span>
            </button>
            <div className="mt-2 flex gap-2">
              <button className="rounded border border-white/10 px-2 py-1 text-xs text-slate-200 hover:bg-white/10" onClick={() => void exportCustomWorkflowPreset(preset.key)}>导出预设</button>
              <button className="rounded border border-red-400/30 px-2 py-1 text-xs text-red-100" onClick={() => deleteCustomWorkflowPreset(preset.key)}>删除预设</button>
            </div>
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
                return <button key={item.type} draggable className="flex items-start gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-3 text-left hover:bg-white/10" onClick={() => addNode(item.type)} onDragStart={(event) => handlePaletteNodeDragStart(event, item.type)}>
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
        <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-md border border-dashed border-white/15 bg-white/[0.03] px-3 py-2 text-sm text-slate-200 hover:bg-white/[0.06]">
          <span>选择 JSON 文件导入</span>
          <span className="inline-flex items-center gap-2 rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300"><Upload size={14} />读取文件</span>
          <input className="sr-only" type="file" accept="application/json,.json" onChange={(event) => void loadImportJsonFile(event)} />
        </label>
        <button className="mt-2 flex w-full items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-200 hover:bg-white/[0.06]" onClick={() => void loadImportJsonFromClipboard()}>
          <span>从剪贴板读取 ProjectGraph JSON</span>
          <span className="inline-flex items-center gap-2 rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300"><ClipboardPaste size={14} />读取剪贴板</span>
        </button>
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
        onNodeClick={(_, node) => {
          setSelectedNodeId(node.id);
          setSelectedEdgeId("");
          setNodeContextMenu(null);
          setEdgeContextMenu(null);
        }}
        onNodeContextMenu={(event, node) => openNodeContextMenu(event, node.id)}
        onEdgeClick={(_, edge) => {
          selectEdge(edge.id);
          setEdgeContextMenu(null);
        }}
        onEdgeContextMenu={(event, edge) => openEdgeContextMenu(event, edge.id)}
        onPaneClick={() => {
          setNodeContextMenu(null);
          setEdgeContextMenu(null);
        }}
        fitView
        snapToGrid={snapToGrid}
        snapGrid={[24, 24]}
        selectionOnDrag={selectionOnDrag}
        panOnDrag={!selectionOnDrag}
        className="h-full w-full"
      >
        <Background color="#334155" gap={24} />
        <Controls className="!bottom-6 !left-1/2 !-translate-x-1/2 !rounded-lg !border !border-white/10 !bg-slate-950/90 !shadow-2xl" />
        {showMiniMap && <MiniMap className="!bottom-6 !right-6 !rounded-lg !border !border-white/10 !bg-slate-950/90" nodeColor="#2563eb" />}
      </ReactFlow>

      {edgeContextMenu && selectedEdge && <div
        className="fixed z-40 w-52 rounded-lg border border-white/10 bg-slate-950/95 p-2 text-sm text-slate-200 shadow-2xl backdrop-blur"
        style={{ left: edgeContextMenu.x, top: edgeContextMenu.y }}
      >
        <div className="border-b border-white/10 px-2 pb-2">
          <p className="text-xs text-slate-500">连线快捷菜单</p>
          <strong className="mt-1 block truncate text-white">{selectedEdgeSource ? String((selectedEdgeSource.data as Record<string, unknown>).title || selectedEdgeSource.id) : selectedEdge.source} → {selectedEdgeTarget ? String((selectedEdgeTarget.data as Record<string, unknown>).title || selectedEdgeTarget.id) : selectedEdge.target}</strong>
        </div>
        <div className="mt-2 grid gap-1">
          <button className="rounded px-2 py-2 text-left hover:bg-white/10" onClick={() => { toggleSelectedEdgeDisabled(); setEdgeContextMenu(null); }}>{selectedEdgeDisabled ? "启用连线" : "禁用连线"}</button>
          <button className="rounded px-2 py-2 text-left hover:bg-white/10" onClick={() => { reverseSelectedEdge(); setEdgeContextMenu(null); }}>反转连线方向</button>
          <button className="rounded px-2 py-2 text-left hover:bg-white/10" onClick={() => { void copySelectedEdgeId(); setEdgeContextMenu(null); }}>复制连线 ID</button>
          <button className="rounded px-2 py-2 text-left hover:bg-white/10" onClick={() => { void copySelectedEdgeParams(); setEdgeContextMenu(null); }}>复制连线参数 JSON</button>
          <button className="rounded px-2 py-2 text-left hover:bg-white/10" onClick={() => { void copySelectedEdgeLink(); setEdgeContextMenu(null); }}>复制连线定位链接</button>
          <button className="rounded px-2 py-2 text-left hover:bg-white/10" onClick={() => insertNodeOnSelectedEdge("text")}>插入文本节点</button>
          <button className="rounded px-2 py-2 text-left hover:bg-white/10" onClick={() => insertNodeOnSelectedEdge("image_generation")}>插入分镜图节点</button>
          <button className="rounded px-2 py-2 text-left hover:bg-white/10" onClick={() => insertNodeOnSelectedEdge("tts_generation")}>插入配音节点</button>
          <button className="rounded px-2 py-2 text-left hover:bg-white/10" onClick={() => focusEdgeNode("source")}>定位起点节点</button>
          <button className="rounded px-2 py-2 text-left hover:bg-white/10" onClick={() => focusEdgeNode("target")}>定位终点节点</button>
          <button className="rounded px-2 py-2 text-left hover:bg-white/10" onClick={() => selectSameSourceEdges()}>选中同起点连线</button>
          <button className="rounded px-2 py-2 text-left hover:bg-white/10" onClick={() => selectSameTargetEdges()}>选中同终点连线</button>
          <button className="rounded px-2 py-2 text-left hover:bg-white/10" onClick={() => selectSameLabelEdges()}>选中同标签连线</button>
          <button className="rounded px-2 py-2 text-left hover:bg-white/10" onClick={() => selectSameColorEdges()}>选中同颜色连线</button>
          <button className="rounded px-2 py-2 text-left hover:bg-white/10" onClick={() => selectSameStyleEdges()}>选中同样式连线</button>
          <button className="rounded px-2 py-2 text-left text-red-100 hover:bg-red-500/10" onClick={deleteSelectedEdge}>删除连线</button>
        </div>
      </div>}

      {nodeContextMenu && selectedNode && <div
        className="fixed z-40 w-56 rounded-lg border border-white/10 bg-slate-950/95 p-2 text-sm text-slate-200 shadow-2xl backdrop-blur"
        style={{ left: nodeContextMenu.x, top: nodeContextMenu.y }}
      >
        <div className="border-b border-white/10 px-2 pb-2">
          <p className="text-xs text-slate-500">{selectedNodes.length > 1 ? "选区快捷菜单" : "节点快捷菜单"}</p>
          <strong className="mt-1 block truncate text-white">{selectedNodes.length > 1 ? `已选择 ${selectedNodes.length} 个节点` : String((selectedNode.data as Record<string, unknown>).title || "节点")}</strong>
        </div>
        <div className="mt-2 grid gap-1">
          {selectedNodes.length > 1 ? <>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { setNodeContextMenu(null); void runSelectedNodes(); }}>运行选区</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { copySelectedNodes(); setNodeContextMenu(null); }}>复制选区</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { setNodeContextMenu(null); void cutSelectedNodes(); }}>剪切选区</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { saveSelectedWorkflowAsPreset(); setNodeContextMenu(null); }}>保存选区为预设</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { void exportSelectedWorkflowJson(); setNodeContextMenu(null); }}>导出选区 JSON</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { duplicateSelectedNodes(); setNodeContextMenu(null); }}>生成选区副本</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { autoLayoutSelectedNodes(); setNodeContextMenu(null); }}>整理选区</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { setSelectedNodesLayer("front"); setNodeContextMenu(null); }}>置顶选区</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { setSelectedNodesLayer("back"); setNodeContextMenu(null); }}>置底选区</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { connectSelectedNodesInOrder(); setNodeContextMenu(null); }}>串联选区</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { groupSelectedNodes(); setNodeContextMenu(null); }}>打组选区</button>
            <button disabled={busy || !selectedGroupIds.size} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { selectSelectedGroups(); setNodeContextMenu(null); }}>选中同组节点</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { ungroupSelectedNodes(); setNodeContextMenu(null); }}>取消分组</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { setSelectedNodesDisabled(true); setNodeContextMenu(null); }}>禁用选区</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { setSelectedNodesDisabled(false); setNodeContextMenu(null); }}>启用选区</button>
            <button disabled={busy || !selectedSelectionEdges.length} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { setSelectedSelectionEdgesDisabled(true); setNodeContextMenu(null); }}>禁用内部连线</button>
            <button disabled={busy || !selectedSelectionEdges.length} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { setSelectedSelectionEdgesDisabled(false); setNodeContextMenu(null); }}>启用内部连线</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { disconnectSelectedNodes(); setNodeContextMenu(null); }}>断开选区连线</button>
            <button disabled={busy || !selectedSelectionEdges.length} className="rounded px-2 py-2 text-left text-red-100 hover:bg-red-500/10 disabled:opacity-50" onClick={() => { deleteSelectedSelectionEdges(); setNodeContextMenu(null); }}>删除内部连线</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { setSelectedNodesCollapsed(true); setNodeContextMenu(null); }}>折叠选区</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { setSelectedNodesCollapsed(false); setNodeContextMenu(null); }}>展开选区</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { setSelectedNodesLocked(true); setNodeContextMenu(null); }}>锁定选区</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { setSelectedNodesLocked(false); setNodeContextMenu(null); }}>解锁选区</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left text-red-100 hover:bg-red-500/10 disabled:opacity-50" onClick={() => { setNodeContextMenu(null); void deleteSelectedNodes(); }}>删除选区</button>
          </> : <>
            <button disabled={busy || (selectedNode.data as Record<string, unknown>).disabled === true} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { setNodeContextMenu(null); void runSelectedNode(); }}>运行节点</button>
            <button disabled={busy || !selectedUpstreamInputs.length} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { fillSelectedFromUpstream(); setNodeContextMenu(null); }}>填充上游参数</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { setNodeContextMenu(null); void cutSelectedNodes(); }}>剪切节点</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { duplicateSelectedNode(); setNodeContextMenu(null); }}>复制节点</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { void copySelectedNodeId(); setNodeContextMenu(null); }}>复制节点 ID</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { void copySelectedNodeParams(); setNodeContextMenu(null); }}>复制节点参数 JSON</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { void copySelectedNodeLink(); setNodeContextMenu(null); }}>复制节点定位链接</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { setSelectedNodesLayer("front"); setNodeContextMenu(null); }}>置顶节点</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { setSelectedNodesLayer("back"); setNodeContextMenu(null); }}>置底节点</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => addUpstreamNodeForSelected("text")}>添加上游文本</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => addUpstreamNodeForSelected("image")}>添加上游图片</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => addUpstreamNodeForSelected("audio")}>添加上游音频</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => addConnectedNodeFromSelected("image_generation")}>添加下游分镜图</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => addConnectedNodeFromSelected("video_generation")}>添加下游视频</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => addConnectedNodeFromSelected("compose_generation")}>添加下游合成</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { selectSelectedUpstreamChain(); setNodeContextMenu(null); }}>选中上游链路</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { selectSelectedDownstreamChain(); setNodeContextMenu(null); }}>选中下游链路</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { selectSameTypeNodes(); setNodeContextMenu(null); }}>选中同类型节点</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { selectSameStatusNodes(); setNodeContextMenu(null); }}>选中同状态节点</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { selectSameColorNodes(); setNodeContextMenu(null); }}>选中同标记节点</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { selectDisabledNodes(); setNodeContextMenu(null); }}>选中禁用节点</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { selectIsolatedNodes(); setNodeContextMenu(null); }}>选中孤立节点</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { selectSourceNodes(); setNodeContextMenu(null); }}>选中起点节点</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { selectTerminalNodes(); setNodeContextMenu(null); }}>选中终点节点</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { selectValidationIssueNodes("error"); setNodeContextMenu(null); }}>选中错误节点</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { selectValidationIssueNodes("warning"); setNodeContextMenu(null); }}>选中提醒节点</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { selectTaskStatusNodes("running"); setNodeContextMenu(null); }}>选中运行中任务节点</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { selectTaskStatusNodes("failed"); setNodeContextMenu(null); }}>选中失败任务节点</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { copySelectedChain(); setNodeContextMenu(null); }}>复制上游链路</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { void runSelectedChain(); setNodeContextMenu(null); }}>运行上游链路</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { disconnectSelectedNodes(); setNodeContextMenu(null); }}>断开节点连线</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { toggleSelectedNodeDisabled(); setNodeContextMenu(null); }}>{(selectedNode.data as Record<string, unknown>).disabled === true ? "启用节点" : "禁用节点"}</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { toggleSelectedNodeCollapsed(); setNodeContextMenu(null); }}>{(selectedNode.data as Record<string, unknown>).collapsed === true ? "展开节点" : "折叠节点"}</button>
            <button disabled={busy} className="rounded px-2 py-2 text-left hover:bg-white/10 disabled:opacity-50" onClick={() => { toggleSelectedNodeLock(); setNodeContextMenu(null); }}>{(selectedNode.data as Record<string, unknown>).locked === true ? "解锁节点" : "锁定节点"}</button>
            <button disabled={busy || (selectedNode.data as Record<string, unknown>).locked === true} className="rounded px-2 py-2 text-left text-red-100 hover:bg-red-500/10 disabled:opacity-50" onClick={() => { setNodeContextMenu(null); void deleteSelectedNode(); }}>删除节点</button>
          </>}
        </div>
      </div>}

      <section className="absolute right-4 top-28 z-20 w-[360px] rounded-lg border border-white/10 bg-slate-950/90 p-4 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-400">参数面板</p>
            <h2 className="font-semibold">{selectedNodes.length > 1 ? "选区操作" : selectedNode ? nodeLabels[selectedType] || "节点" : "未选择节点"}</h2>
          </div>
          {selectedNode && selectedNodes.length <= 1 && <div className="flex items-center gap-2">
            <button title={selectedData.disabled === true ? "启用节点" : "禁用节点"} className="rounded-md border border-white/10 p-2 text-slate-300 hover:bg-white/10" onClick={toggleSelectedNodeDisabled}><Ban size={16} /></button>
            <button title={selectedData.collapsed === true ? "展开节点" : "折叠节点"} className="rounded-md border border-white/10 p-2 text-slate-300 hover:bg-white/10" onClick={toggleSelectedNodeCollapsed}>{selectedData.collapsed === true ? <Maximize2 size={16} /> : <Minimize2 size={16} />}</button>
            <button title={selectedData.locked === true ? "解锁节点" : "锁定节点"} className="rounded-md border border-white/10 p-2 text-slate-300 hover:bg-white/10" onClick={toggleSelectedNodeLock}>{selectedData.locked === true ? <Unlock size={16} /> : <Lock size={16} />}</button>
            <button title="删除节点" disabled={selectedData.locked === true} className="rounded-md border border-white/10 p-2 text-slate-300 hover:bg-white/10 disabled:opacity-50" onClick={() => void deleteSelectedNode()}><Trash2 size={16} /></button>
          </div>}
        </div>
        {selectedNodes.length > 1 ? <div className="mt-4 grid gap-3 text-sm">
          <section className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <p className="text-xs text-slate-400">批量节点操作</p>
            <h3 className="mt-1 font-semibold text-white">已选择 {selectedNodes.length} 个节点</h3>
            <p className="mt-2 text-xs leading-5 text-slate-400">选区内包含 {selectedSelectionEdges.length} 条内部连线，可批量复制、整理、打组、锁定、禁用或删除。</p>
            {!!selectedGroupTitles.length && <p className="mt-2 truncate text-xs text-blue-100">已在组：{selectedGroupTitles.join("、")}</p>}
          </section>
          {!!selectedGroupIds.size && <label className="grid gap-1 rounded-md border border-white/10 bg-white/[0.03] p-3">
            <span className="text-xs text-slate-400">分组名称</span>
            <input className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" placeholder={selectedGroupTitles.length > 1 ? "多个分组，将统一改名" : "输入分组名称"} value={selectedGroupTitleValue} onFocus={rememberGraphHistory} onChange={(event) => updateSelectedGroupTitle(event.target.value)} onBlur={(event) => updateSelectedGroupTitle(event.target.value, true)} />
          </label>}
          <section className="grid gap-2 rounded-md border border-white/10 bg-white/[0.03] p-3">
            <span className="text-xs text-slate-400">选区批量命名</span>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input className="min-w-0 rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" placeholder="输入节点标题前缀" value={selectedRenamePrefix} onChange={(event) => setSelectedRenamePrefix(event.target.value)} />
              <button disabled={busy || !selectedRenamePrefix.trim()} className="inline-flex items-center justify-center rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={renameSelectedNodesWithPrefix}>应用</button>
            </div>
          </section>
          <section className="grid gap-2 rounded-md border border-white/10 bg-white/[0.03] p-3">
            <span className="text-xs text-slate-400">选区颜色标记</span>
            <div className="grid grid-cols-3 gap-2">
              {nodeMarkerColors.map((item) => <button key={item.value || "default"} className={`rounded-md border px-2 py-1.5 text-xs ${item.value ? `${item.className} text-white` : "border-white/10 bg-white/5 text-slate-200"} hover:ring-1 hover:ring-white/60`} onClick={() => setSelectedNodesColor(item.value)}>{item.label}</button>)}
            </div>
          </section>
          <section className="grid gap-2 rounded-md border border-white/10 bg-white/[0.03] p-3">
            <span className="text-xs text-slate-400">选区内部连线</span>
            <div className="grid grid-cols-2 gap-2">
              <button disabled={busy || !selectedSelectionEdges.length} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs disabled:opacity-50" onClick={() => setSelectedSelectionEdgesDisabled(true)}><Ban size={14} />禁用内部连线</button>
              <button disabled={busy || !selectedSelectionEdges.length} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs disabled:opacity-50" onClick={() => setSelectedSelectionEdgesDisabled(false)}><Play size={14} />启用内部连线</button>
              <button disabled={busy || !selectedSelectionEdges.length} className="col-span-2 inline-flex items-center justify-center gap-2 rounded-md border border-red-400/30 px-3 py-2 text-xs text-red-100 disabled:opacity-50" onClick={deleteSelectedSelectionEdges}><Trash2 size={14} />删除内部连线</button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {edgeMarkerColors.map((item) => <button key={item.value || "default"} disabled={busy || !selectedSelectionEdges.length} className={`rounded-md border px-2 py-1.5 text-xs disabled:opacity-50 ${item.value ? "text-white" : "border-white/10 bg-white/5 text-slate-200"} hover:ring-1 hover:ring-white/60`} style={item.value ? { borderColor: item.stroke, backgroundColor: `${item.stroke}33` } : undefined} onClick={() => setSelectedSelectionEdgesColor(item.value)}>{item.label}</button>)}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {edgeLineStyles.map((item) => <button key={item.value || "default"} disabled={busy || !selectedSelectionEdges.length} className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50" onClick={() => setSelectedSelectionEdgesStyle(item.value)}>{item.label}</button>)}
            </div>
          </section>
          <section className="grid gap-2 rounded-md border border-white/10 bg-white/[0.03] p-3">
            <span className="text-xs text-slate-400">对齐与分布</span>
            <div className="grid grid-cols-4 gap-2">
              <button title="左对齐选区" disabled={busy} className="grid h-9 place-items-center rounded-md border border-white/10 text-slate-200 hover:bg-white/10 disabled:opacity-50" onClick={() => alignSelectedNodes("left")}><AlignHorizontalJustifyStart size={16} /></button>
              <button title="水平居中对齐选区" disabled={busy} className="grid h-9 place-items-center rounded-md border border-white/10 text-slate-200 hover:bg-white/10 disabled:opacity-50" onClick={() => alignSelectedNodes("centerX")}><AlignHorizontalJustifyCenter size={16} /></button>
              <button title="右对齐选区" disabled={busy} className="grid h-9 place-items-center rounded-md border border-white/10 text-slate-200 hover:bg-white/10 disabled:opacity-50" onClick={() => alignSelectedNodes("right")}><AlignHorizontalJustifyEnd size={16} /></button>
              <button title="顶部对齐选区" disabled={busy} className="grid h-9 place-items-center rounded-md border border-white/10 text-slate-200 hover:bg-white/10 disabled:opacity-50" onClick={() => alignSelectedNodes("top")}><AlignVerticalJustifyStart size={16} /></button>
              <button title="垂直居中对齐选区" disabled={busy} className="grid h-9 place-items-center rounded-md border border-white/10 text-slate-200 hover:bg-white/10 disabled:opacity-50" onClick={() => alignSelectedNodes("centerY")}><AlignVerticalJustifyCenter size={16} /></button>
              <button title="底部对齐选区" disabled={busy} className="grid h-9 place-items-center rounded-md border border-white/10 text-slate-200 hover:bg-white/10 disabled:opacity-50" onClick={() => alignSelectedNodes("bottom")}><AlignVerticalJustifyEnd size={16} /></button>
              <button title="水平等距分布选区" disabled={busy} className="grid h-9 place-items-center rounded-md border border-white/10 text-slate-200 hover:bg-white/10 disabled:opacity-50" onClick={() => alignSelectedNodes("horizontal")}><AlignHorizontalDistributeCenter size={16} /></button>
              <button title="垂直等距分布选区" disabled={busy} className="grid h-9 place-items-center rounded-md border border-white/10 text-slate-200 hover:bg-white/10 disabled:opacity-50" onClick={() => alignSelectedNodes("vertical")}><AlignVerticalDistributeCenter size={16} /></button>
            </div>
          </section>
          <div className="grid grid-cols-2 gap-2">
            <button disabled={busy} className="col-span-2 inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 disabled:opacity-50" onClick={() => void runSelectedNodes()}><Play size={16} />运行选区</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={copySelectedNodes}><ClipboardCopy size={16} />复制选区</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={() => void cutSelectedNodes()}><Scissors size={16} />剪切选区</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={saveSelectedWorkflowAsPreset}><Save size={16} />存为预设</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={() => void exportSelectedWorkflowJson()}><Download size={16} />导出 JSON</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={duplicateSelectedNodes}><Copy size={16} />生成副本</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={pasteCopiedSelection}><ClipboardPaste size={16} />粘贴选区</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={autoLayoutSelectedNodes}><LayoutGrid size={16} />整理选区</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={() => setSelectedNodesLayer("front")}><BringToFront size={16} />置顶选区</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={() => setSelectedNodesLayer("back")}><SendToBack size={16} />置底选区</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={connectSelectedNodesInOrder}><GitBranch size={16} />串联选区</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={groupSelectedNodes}><Boxes size={16} />打组选区</button>
            <button disabled={busy || !selectedGroupIds.size} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={selectSelectedGroups}><Boxes size={16} />选中同组</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={ungroupSelectedNodes}><Boxes size={16} />取消分组</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={() => setSelectedNodesDisabled(true)}><Ban size={16} />禁用选区</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={() => setSelectedNodesDisabled(false)}><Play size={16} />启用选区</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={() => setSelectedNodesCollapsed(true)}><Minimize2 size={16} />折叠选区</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={() => setSelectedNodesCollapsed(false)}><Maximize2 size={16} />展开选区</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={() => setSelectedNodesLocked(true)}><Lock size={16} />锁定选区</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={() => setSelectedNodesLocked(false)}><Unlock size={16} />解锁选区</button>
            <button disabled={busy} className="col-span-2 inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={disconnectSelectedNodes}><XSquare size={16} />断开选区连线</button>
            <button disabled={busy} className="col-span-2 inline-flex items-center justify-center gap-2 rounded-md border border-red-400/30 px-3 py-2 text-red-100 disabled:opacity-50" onClick={() => void deleteSelectedNodes()}><Trash2 size={16} />删除选区</button>
          </div>
        </div> : selectedNode ? <div className="mt-4 grid gap-3 text-sm">
          {!!selectedRunBlockingIssues.length && <section className="rounded-md border border-red-400/30 bg-red-500/10 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-red-100/80">运行前缺口</p>
                <strong className="text-sm text-white">当前节点暂不能直接运行</strong>
              </div>
              <button className="shrink-0 rounded border border-red-200/20 px-2 py-1 text-xs text-red-50" onClick={() => setShowValidation(true)}>查看自检</button>
            </div>
            <div className="mt-2 grid gap-1 text-xs text-red-50">
              {selectedRunBlockingIssues.slice(0, 3).map((issue) => <p key={issue.id} className="rounded border border-red-200/20 bg-black/20 px-2 py-1">{issue.title}：{issue.detail}</p>)}
            </div>
          </section>}
          {mediaUrlFromData(selectedData) && <section className="rounded-md border border-white/10 bg-black/25 p-2">
            <div className="mb-2 flex items-center justify-between gap-2 text-xs text-slate-400">
              <span>素材预览</span>
              <span>{mediaKindFromData(selectedData, selectedType) === "video" ? "视频" : mediaKindFromData(selectedData, selectedType) === "audio" ? "音频" : "图片"}</span>
            </div>
            <MediaPreview data={selectedData} title={String(selectedData.title || "节点预览")} />
            <p className="mt-2 truncate text-xs text-slate-500">{mediaUrlFromData(selectedData)}</p>
          </section>}
          <section className="grid gap-2 rounded-md border border-white/10 bg-white/[0.03] p-3">
            <p className="text-xs text-slate-400">链路选择</p>
            <div className="grid grid-cols-3 gap-2">
              <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50" onClick={selectSelectedUpstreamChain}><GitBranch size={14} />选中上游</button>
              <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50" onClick={selectSelectedDownstreamChain}><GitBranch size={14} />选中下游</button>
              <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50" onClick={selectSameTypeNodes}><CheckSquare size={14} />同类型</button>
              <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50" onClick={selectSameStatusNodes}><CheckSquare size={14} />同状态</button>
              <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50" onClick={selectSameColorNodes}><CheckSquare size={14} />同标记</button>
              <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50" onClick={selectDisabledNodes}><Ban size={14} />禁用节点</button>
              <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50" onClick={selectIsolatedNodes}><AlertTriangle size={14} />孤立节点</button>
              <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50" onClick={selectSourceNodes}><GitBranch size={14} />起点节点</button>
              <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50" onClick={selectTerminalNodes}><GitBranch size={14} />终点节点</button>
              <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-red-400/30 px-3 py-2 text-xs text-red-100 hover:bg-red-500/10 disabled:opacity-50" onClick={() => selectValidationIssueNodes("error")}><AlertTriangle size={14} />错误节点</button>
              <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-amber-400/30 px-3 py-2 text-xs text-amber-100 hover:bg-amber-500/10 disabled:opacity-50" onClick={() => selectValidationIssueNodes("warning")}><AlertTriangle size={14} />提醒节点</button>
              <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-400/30 px-3 py-2 text-xs text-blue-100 hover:bg-blue-500/10 disabled:opacity-50" onClick={() => selectTaskStatusNodes("running")}><Boxes size={14} />运行中</button>
              <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-red-400/30 px-3 py-2 text-xs text-red-100 hover:bg-red-500/10 disabled:opacity-50" onClick={() => selectTaskStatusNodes("failed")}><Boxes size={14} />失败任务</button>
            </div>
          </section>
          <section className="grid gap-2 rounded-md border border-white/10 bg-white/[0.03] p-3">
            <p className="text-xs text-slate-400">快速添加上游</p>
            <div className="grid grid-cols-2 gap-2">
              {addableNodes.filter((item) => ["text", "image", "video", "audio", "script"].includes(item.type)).map((item) => {
                const Icon = item.icon;
                return <button key={item.type} disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-2 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50" onClick={() => addUpstreamNodeForSelected(item.type)}><Icon size={14} />{item.label}</button>;
              })}
            </div>
          </section>
          <section className="grid gap-2 rounded-md border border-white/10 bg-white/[0.03] p-3">
            <p className="text-xs text-slate-400">快速添加下游</p>
            <div className="grid grid-cols-2 gap-2">
              {addableNodes.filter((item) => ["text", "image_generation", "video_generation", "tts_generation", "compose_generation"].includes(item.type)).map((item) => {
                const Icon = item.icon;
                return <button key={item.type} disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-2 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50" onClick={() => addConnectedNodeFromSelected(item.type)}><Icon size={14} />{item.label}</button>;
              })}
            </div>
          </section>
          {!!selectedIncomingData.length && <section className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-slate-400">连线输入</p>
                <strong className="text-sm text-white">上游输入</strong>
              </div>
              <button disabled={!selectedUpstreamInputs.length} className="rounded border border-blue-400/30 px-2 py-1 text-xs text-blue-100 disabled:opacity-50" onClick={fillSelectedFromUpstream}>填充参数</button>
            </div>
            <div className="mt-2 grid gap-1 text-xs">
              {selectedUpstreamInputs.map((item) => <p key={`${item.key}-${item.value}`} className="truncate rounded border border-white/10 bg-black/20 px-2 py-1 text-slate-300">{item.label}：{item.value}</p>)}
              {!selectedUpstreamInputs.length && <p className="rounded border border-white/10 px-2 py-1 text-slate-400">已连接上游节点，但没有可直接填充的字段。</p>}
            </div>
          </section>}
          <label className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
            <span className="text-slate-300">锁定节点位置</span>
            <input type="checkbox" checked={selectedData.locked === true} onChange={toggleSelectedNodeLock} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
            <span className="text-slate-300">禁用节点运行</span>
            <input type="checkbox" checked={selectedData.disabled === true} onChange={toggleSelectedNodeDisabled} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
            <span className="text-slate-300">折叠节点内容</span>
            <input type="checkbox" checked={selectedData.collapsed === true} onChange={toggleSelectedNodeCollapsed} />
          </label>
          <label className="grid gap-1"><span className="text-slate-400">节点类型</span><select className="rounded-md border border-white/10 bg-slate-900 px-3 py-2 outline-none" value={selectedType} onChange={(event) => updateSelectedNodeType(event.target.value)}>
            {addableNodes.map((item) => <option key={item.type} value={item.type}>{item.category} · {nodeLabels[item.type] || item.label}</option>)}
          </select></label>
          <label className="grid gap-1"><span className="text-slate-400">标题</span><input className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" onFocus={rememberSelectedNodeEdit} value={String(selectedData.title || "")} onChange={(event) => updateSelectedData("title", event.target.value)} /></label>
          <label className="grid gap-1"><span className="text-slate-400">节点颜色标记</span><select className="rounded-md border border-white/10 bg-slate-900 px-3 py-2 outline-none" onFocus={rememberSelectedNodeEdit} value={String(selectedData.node_color || "")} onChange={(event) => updateSelectedData("node_color", event.target.value)}>
            {nodeMarkerColors.map((item) => <option key={item.value || "default"} value={item.value}>{item.label}</option>)}
          </select></label>
          <label className="grid gap-1"><span className="text-slate-400">节点备注</span><textarea className="min-h-20 rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" placeholder="记录节点用途、模型选择或后续修改点。" onFocus={rememberSelectedNodeEdit} value={String(selectedData.note || "")} onChange={(event) => updateSelectedData("note", event.target.value)} /></label>
          {(selectedType === "text" || selectedType === "demo") && <label className="grid gap-1"><span className="text-slate-400">文本内容</span><textarea className="min-h-28 rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" onFocus={rememberSelectedNodeEdit} value={String(selectedData.text || "")} onChange={(event) => updateSelectedData("text", event.target.value)} /></label>}
          {selectedType === "script" && <label className="grid gap-1"><span className="text-slate-400">脚本</span><textarea className="min-h-40 rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" onFocus={rememberSelectedNodeEdit} value={String(selectedData.script || "")} onChange={(event) => updateSelectedData("script", event.target.value)} /></label>}
          {(selectedType === "image_generation" || selectedType === "video_generation") && <label className="grid gap-1"><span className="text-slate-400">提示词</span><textarea className="min-h-28 rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" onFocus={rememberSelectedNodeEdit} value={String(selectedData.prompt || "")} onChange={(event) => updateSelectedData("prompt", event.target.value)} /></label>}
          {selectedType === "tts_generation" && <label className="grid gap-1"><span className="text-slate-400">旁白文本</span><textarea className="min-h-28 rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" onFocus={rememberSelectedNodeEdit} value={String(selectedData.text || "")} onChange={(event) => updateSelectedData("text", event.target.value)} /></label>}
          {selectedType === "image_generation" && <section className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <p className="text-xs text-slate-400">分镜图参数预设</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button className="rounded border border-white/10 px-2 py-1.5 text-xs text-slate-200 hover:bg-white/10" onClick={() => applySelectedNodePreset("竖屏 9:16", { width: "768", height: "1344" })}>竖屏 9:16</button>
              <button className="rounded border border-white/10 px-2 py-1.5 text-xs text-slate-200 hover:bg-white/10" onClick={() => applySelectedNodePreset("横屏 16:9", { width: "1344", height: "768" })}>横屏 16:9</button>
              <button className="rounded border border-white/10 px-2 py-1.5 text-xs text-slate-200 hover:bg-white/10" onClick={() => applySelectedNodePreset("方图 1:1", { width: "1024", height: "1024" })}>方图 1:1</button>
              <button className="rounded border border-white/10 px-2 py-1.5 text-xs text-slate-200 hover:bg-white/10" onClick={() => applySelectedNodePreset("随机 seed", { seed: String(Math.floor(Math.random() * 100000000)) })}>随机 seed</button>
            </div>
          </section>}
          {selectedType === "video_generation" && <section className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <p className="text-xs text-slate-400">镜头视频参数预设</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <button className="rounded border border-white/10 px-2 py-1.5 text-xs text-slate-200 hover:bg-white/10" onClick={() => applySelectedNodePreset("快切 3 秒", { duration: "3", fps: "16" })}>快切 3 秒</button>
              <button className="rounded border border-white/10 px-2 py-1.5 text-xs text-slate-200 hover:bg-white/10" onClick={() => applySelectedNodePreset("标准 5 秒", { duration: "5", fps: "16" })}>标准 5 秒</button>
              <button className="rounded border border-white/10 px-2 py-1.5 text-xs text-slate-200 hover:bg-white/10" onClick={() => applySelectedNodePreset("流畅 24fps", { fps: "24" })}>流畅 24fps</button>
            </div>
          </section>}
          {selectedType === "tts_generation" && <section className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <p className="text-xs text-slate-400">配音参数预设</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <button className="rounded border border-white/10 px-2 py-1.5 text-xs text-slate-200 hover:bg-white/10" onClick={() => applySelectedNodePreset("女声常速", { voice: "zh-CN-XiaoxiaoNeural", rate: "1" })}>女声常速</button>
              <button className="rounded border border-white/10 px-2 py-1.5 text-xs text-slate-200 hover:bg-white/10" onClick={() => applySelectedNodePreset("男声常速", { voice: "zh-CN-YunxiNeural", rate: "1" })}>男声常速</button>
              <button className="rounded border border-white/10 px-2 py-1.5 text-xs text-slate-200 hover:bg-white/10" onClick={() => applySelectedNodePreset("慢速旁白", { rate: "0.85" })}>慢速旁白</button>
            </div>
          </section>}
          {selectedType === "compose_generation" && <section className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <p className="text-xs text-slate-400">合成参数预设</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button className="rounded border border-white/10 px-2 py-1.5 text-xs text-slate-200 hover:bg-white/10" onClick={() => applySelectedNodePreset("带字幕成片", { subtitle: true })}>带字幕成片</button>
              <button className="rounded border border-white/10 px-2 py-1.5 text-xs text-slate-200 hover:bg-white/10" onClick={() => applySelectedNodePreset("无字幕成片", { subtitle: false })}>无字幕成片</button>
            </div>
          </section>}
          {selectedType === "image" && <label className="grid gap-1"><span className="text-slate-400">图片 URL</span><input className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" onFocus={rememberSelectedNodeEdit} value={String(selectedData.image_url || "")} onChange={(event) => updateSelectedData("image_url", event.target.value)} /></label>}
          {selectedType === "video" && <label className="grid gap-1"><span className="text-slate-400">视频 URL</span><input className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" onFocus={rememberSelectedNodeEdit} value={String(selectedData.video_url || "")} onChange={(event) => updateSelectedData("video_url", event.target.value)} /></label>}
          {selectedType === "audio" && <label className="grid gap-1"><span className="text-slate-400">音频 URL</span><input className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" onFocus={rememberSelectedNodeEdit} value={String(selectedData.audio_url || "")} onChange={(event) => updateSelectedData("audio_url", event.target.value)} /></label>}
          {selectedType.includes("generation") && selectedType !== "compose_generation" && <label className="grid gap-1"><span className="text-slate-400">绑定分镜</span><select className="rounded-md border border-white/10 bg-slate-900 px-3 py-2 outline-none" onFocus={rememberSelectedNodeEdit} value={String(selectedData.shot_id || "")} onChange={(event) => updateSelectedData("shot_id", event.target.value)}>
            <option value="">从连线或运行时补全</option>
            {shotOptions.map((shot) => <option key={shot.id} value={shot.id}>分镜 {shot.index} · {shot.visual_description || shot.narration || shot.id}</option>)}
          </select></label>}
          {selectedType === "image_generation" && <div className="grid grid-cols-3 gap-2">
            <label className="grid gap-1"><span className="text-slate-400">宽度</span><input type="number" className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" onFocus={rememberSelectedNodeEdit} value={String(selectedData.width || "768")} onChange={(event) => updateSelectedData("width", event.target.value)} /></label>
            <label className="grid gap-1"><span className="text-slate-400">高度</span><input type="number" className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" onFocus={rememberSelectedNodeEdit} value={String(selectedData.height || "1344")} onChange={(event) => updateSelectedData("height", event.target.value)} /></label>
            <label className="grid gap-1"><span className="text-slate-400">种子</span><input type="number" className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" onFocus={rememberSelectedNodeEdit} value={String(selectedData.seed || "-1")} onChange={(event) => updateSelectedData("seed", event.target.value)} /></label>
          </div>}
          {selectedType === "video_generation" && <label className="grid gap-1"><span className="text-slate-400">首帧图片 URL</span><input className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" onFocus={rememberSelectedNodeEdit} value={String(selectedData.first_frame_url || "")} onChange={(event) => updateSelectedData("first_frame_url", event.target.value)} /></label>}
          {selectedType === "video_generation" && <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1"><span className="text-slate-400">时长</span><input type="number" step="0.5" className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" onFocus={rememberSelectedNodeEdit} value={String(selectedData.duration || "4")} onChange={(event) => updateSelectedData("duration", event.target.value)} /></label>
            <label className="grid gap-1"><span className="text-slate-400">帧率</span><input type="number" className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" onFocus={rememberSelectedNodeEdit} value={String(selectedData.fps || "16")} onChange={(event) => updateSelectedData("fps", event.target.value)} /></label>
          </div>}
          {selectedType === "tts_generation" && <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1"><span className="text-slate-400">音色</span><select className="rounded-md border border-white/10 bg-slate-900 px-3 py-2 outline-none" onFocus={rememberSelectedNodeEdit} value={String(selectedData.voice || "zh-CN-XiaoxiaoNeural")} onChange={(event) => updateSelectedData("voice", event.target.value)}>
              <option value="zh-CN-XiaoxiaoNeural">晓晓</option>
              <option value="zh-CN-YunxiNeural">云希</option>
              <option value="zh-CN-XiaoyiNeural">晓伊</option>
            </select></label>
            <label className="grid gap-1"><span className="text-slate-400">语速</span><input type="number" step="0.1" className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" onFocus={rememberSelectedNodeEdit} value={String(selectedData.rate || "1")} onChange={(event) => updateSelectedData("rate", event.target.value)} /></label>
          </div>}
          {selectedType === "compose_generation" && <label className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/5 px-3 py-2"><span className="text-slate-300">合成字幕</span><input type="checkbox" checked={selectedData.subtitle !== false} onFocus={rememberSelectedNodeEdit} onChange={(event) => updateSelectedData("subtitle", event.target.checked)} /></label>}
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
            <button disabled={busy || selectedData.disabled === true} className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 disabled:opacity-50" onClick={() => void runSelectedNode()}><Play size={16} />运行节点</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={() => void runSelectedChain()}><GitBranch size={16} />运行链路</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={duplicateSelectedNode}><Copy size={16} />复制节点</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={() => void cutSelectedNodes()}><Scissors size={16} />剪切节点</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={() => void copySelectedNodeId()}><ClipboardCopy size={16} />复制 ID</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={() => void copySelectedNodeParams()}><FileText size={16} />复制参数</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={() => void copySelectedNodeLink()}><ClipboardCopy size={16} />复制链接</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={copySelectedChain}><ClipboardCopy size={16} />复制链路</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={pasteCopiedSelection}><ClipboardPaste size={16} />粘贴链路</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={() => setSelectedNodesLayer("front")}><BringToFront size={16} />置顶节点</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={() => setSelectedNodesLayer("back")}><SendToBack size={16} />置底节点</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 disabled:opacity-50" onClick={disconnectSelectedNodes}><XSquare size={16} />断开连线</button>
            <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 text-slate-300 disabled:opacity-50" onClick={() => void deleteSelectedNode()}><Trash2 size={16} />删除节点</button>
          </div>
        </div> : selectedEdge ? <div className="mt-4 grid gap-3 text-sm">
          <section className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <p className="text-xs text-slate-400">连线编辑</p>
            <h3 className="mt-1 truncate font-semibold text-white">{selectedEdgeSource ? String((selectedEdgeSource.data as Record<string, unknown>).title || selectedEdgeSource.id) : selectedEdge.source} → {selectedEdgeTarget ? String((selectedEdgeTarget.data as Record<string, unknown>).title || selectedEdgeTarget.id) : selectedEdge.target}</h3>
            <p className="mt-2 text-xs leading-5 text-slate-400">{selectedEdges.length > 1 ? `当前已选中 ${selectedEdges.length} 条连线，可继续批量定位、标记或删除。` : selectedEdgeDisabled ? "这条连线已禁用，不参与上游输入、整理和运行。" : "为连线添加用途说明，保存后会随工作流 JSON 和项目画布持久化。"}</p>
          </section>
          <label className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2">
            <span className="text-slate-300">禁用这条连线</span>
            <input type="checkbox" checked={selectedEdgeDisabled} onChange={toggleSelectedEdgeDisabled} />
          </label>
          <label className="grid gap-1"><span className="text-slate-400">连线标签</span><input className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" placeholder="例如：提示词、首帧、配音输入" value={selectedEdgeLabel} onChange={(event) => updateSelectedEdgeLabel(event.target.value)} /></label>
          <label className="grid gap-1"><span className="text-slate-400">连线颜色标记</span><select className="rounded-md border border-white/10 bg-slate-900 px-3 py-2 outline-none" value={selectedEdgeColor} onChange={(event) => updateSelectedEdgeColor(event.target.value)}>
            {edgeMarkerColors.map((item) => <option key={item.value || "default"} value={item.value}>{item.label}</option>)}
          </select></label>
          <label className="grid gap-1"><span className="text-slate-400">连线样式</span><select className="rounded-md border border-white/10 bg-slate-900 px-3 py-2 outline-none" value={selectedEdgeStyle} onChange={(event) => updateSelectedEdgeStyle(event.target.value)}>
            {edgeLineStyles.map((item) => <option key={item.value || "default"} value={item.value}>{item.label}</option>)}
          </select></label>
          <section className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <p className="text-xs text-slate-400">端口映射</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="grid gap-1"><span className="text-slate-400">输出端口</span><select className="rounded-md border border-white/10 bg-slate-900 px-2 py-2 outline-none" value={selectedEdge.sourceHandle || "output"} onChange={(event) => updateSelectedEdgePort("source", event.target.value)}>
                {selectedEdgeSourcePorts.map((port) => <option key={port.id} value={port.id}>{port.label}</option>)}
              </select></label>
              <label className="grid gap-1"><span className="text-slate-400">输入端口</span><select className="rounded-md border border-white/10 bg-slate-900 px-2 py-2 outline-none" value={selectedEdge.targetHandle || "input"} onChange={(event) => updateSelectedEdgePort("target", event.target.value)}>
                {selectedEdgeTargetPorts.map((port) => <option key={port.id} value={port.id}>{port.label}</option>)}
              </select></label>
            </div>
          </section>
          <section className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <p className="text-xs text-slate-400">连线选择</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button className="rounded-md border border-white/10 px-2 py-2 text-xs text-slate-200 hover:bg-white/10" onClick={selectSameSourceEdges}>同起点</button>
              <button className="rounded-md border border-white/10 px-2 py-2 text-xs text-slate-200 hover:bg-white/10" onClick={selectSameTargetEdges}>同终点</button>
              <button className="rounded-md border border-white/10 px-2 py-2 text-xs text-slate-200 hover:bg-white/10" onClick={selectSameLabelEdges}>同标签</button>
              <button className="rounded-md border border-white/10 px-2 py-2 text-xs text-slate-200 hover:bg-white/10" onClick={selectSameColorEdges}>同颜色</button>
              <button className="rounded-md border border-white/10 px-2 py-2 text-xs text-slate-200 hover:bg-white/10" onClick={selectSameStyleEdges}>同样式</button>
            </div>
          </section>
          <section className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <p className="text-xs text-slate-400">插入节点</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <button className="rounded-md border border-white/10 px-2 py-2 text-xs text-slate-200 hover:bg-white/10" onClick={() => insertNodeOnSelectedEdge("text")}>文本</button>
              <button className="rounded-md border border-white/10 px-2 py-2 text-xs text-slate-200 hover:bg-white/10" onClick={() => insertNodeOnSelectedEdge("image_generation")}>分镜图</button>
              <button className="rounded-md border border-white/10 px-2 py-2 text-xs text-slate-200 hover:bg-white/10" onClick={() => insertNodeOnSelectedEdge("video_generation")}>视频</button>
              <button className="rounded-md border border-white/10 px-2 py-2 text-xs text-slate-200 hover:bg-white/10" onClick={() => insertNodeOnSelectedEdge("tts_generation")}>配音</button>
              <button className="rounded-md border border-white/10 px-2 py-2 text-xs text-slate-200 hover:bg-white/10" onClick={() => insertNodeOnSelectedEdge("compose_generation")}>合成</button>
              <button className="rounded-md border border-white/10 px-2 py-2 text-xs text-slate-200 hover:bg-white/10" onClick={() => insertNodeOnSelectedEdge("demo")}>演示</button>
            </div>
          </section>
          <div className="grid grid-cols-2 gap-2">
            <button className="rounded-md border border-white/10 px-3 py-2 text-slate-200 hover:bg-white/10" onClick={() => focusEdgeNode("source")}>定位起点</button>
            <button className="rounded-md border border-white/10 px-3 py-2 text-slate-200 hover:bg-white/10" onClick={() => focusEdgeNode("target")}>定位终点</button>
            <button className="rounded-md border border-white/10 px-3 py-2 text-slate-200 hover:bg-white/10" onClick={() => void copySelectedEdgeId()}>复制 ID</button>
            <button className="rounded-md border border-white/10 px-3 py-2 text-slate-200 hover:bg-white/10" onClick={() => void copySelectedEdgeParams()}>复制参数</button>
            <button className="col-span-2 rounded-md border border-white/10 px-3 py-2 text-slate-200 hover:bg-white/10" onClick={() => void copySelectedEdgeLink()}>复制连线定位链接</button>
            <button className="col-span-2 rounded-md border border-white/10 px-3 py-2 text-slate-200 hover:bg-white/10" onClick={reverseSelectedEdge}>反转连线方向</button>
            <button className="col-span-2 rounded-md border border-red-400/30 px-3 py-2 text-red-100 hover:bg-red-500/10" onClick={deleteSelectedEdge}>删除连线</button>
          </div>
        </div> : <p className="mt-4 rounded-md border border-white/10 bg-white/5 p-3 text-sm text-slate-400">点击画布节点或连线后可编辑参数、运行生成或删除节点。</p>}
      </section>

      {showAssets && <aside className="absolute bottom-6 left-24 z-20 max-h-[320px] w-[360px] overflow-auto rounded-lg border border-white/10 bg-slate-950/90 p-4 shadow-2xl backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-400">素材筛选</p>
            <h2 className="font-semibold">项目素材库</h2>
          </div>
          <span className="rounded border border-white/10 px-2 py-1 text-xs text-slate-400">{filteredAssets.length}/{assets.length}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1 text-[11px]">
          {assetTypeFilterOptions.map((type) => <button
            key={type}
            className={`rounded border px-2 py-1 ${assetTypeFilter === type ? "border-blue-400/50 bg-blue-500/15 text-blue-50" : "border-white/10 text-slate-300 hover:bg-white/10"}`}
            onClick={() => setAssetTypeFilter(type)}
          >{type === "all" ? `全部 ${assets.length}` : `${type} ${assetTypeCounts[type] || 0}`}</button>)}
        </div>
        <label className="mt-3 flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm">
          <Search size={15} className="text-slate-400" />
          <input className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-500" placeholder="搜索素材 URL、工作流、分镜" value={assetQuery} onChange={(event) => setAssetQuery(event.target.value)} />
        </label>
        <div className="mt-3 grid gap-2 text-sm">
          {filteredAssets.map((asset) => {
            const type = asset.asset_type === "video" ? "video" : asset.asset_type === "audio" ? "audio" : "image";
            const dataKey = type === "video" ? "video_url" : type === "audio" ? "audio_url" : "image_url";
            const previewData = { nodeType: type, [dataKey]: asset.url };
            return <button key={asset.id} className="rounded-md border border-white/10 px-3 py-2 text-left text-slate-300 hover:bg-white/10" onClick={() => addAssetNode(asset)}>
              <div className="flex gap-3">
                <div className="h-16 w-20 shrink-0 overflow-hidden rounded border border-white/10 bg-black/30">
                  <MediaPreview data={previewData} title={`素材 ${asset.asset_type}`} compact />
                </div>
                <div className="min-w-0">
                  <span className="block text-white">{asset.asset_type} · {asset.shot_index ? `分镜 ${asset.shot_index}` : "项目素材"}</span>
                  <span className="mt-1 block truncate text-xs text-slate-400">{asset.workflow_key || asset.source_task_type || asset.id}</span>
                  <span className="mt-1 block truncate text-xs text-slate-500">{asset.url || asset.id}</span>
                </div>
              </div>
            </button>;
          })}
          {!assets.length && <p className="rounded-md border border-white/10 px-3 py-2 text-slate-400">暂无素材，可先运行生成节点。</p>}
          {!!assets.length && !filteredAssets.length && <p className="rounded-md border border-white/10 px-3 py-2 text-slate-400">没有匹配素材，请调整类型或关键词。</p>}
        </div>
      </aside>}

      {showShots && <aside className="absolute bottom-6 left-24 z-20 max-h-[420px] w-[440px] overflow-auto rounded-lg border border-white/10 bg-slate-950/90 p-4 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-400">项目分镜</p>
            <h2 className="font-semibold">分镜生成链路</h2>
          </div>
          <span className="rounded border border-white/10 px-2 py-1 text-xs text-slate-400">{filteredShots.length}/{shotOptions.length}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1 text-[11px]">
          {shotStatusFilterOptions.map((shotStatus) => <button
            key={shotStatus}
            className={`rounded border px-2 py-1 ${shotStatusFilter === shotStatus ? "border-blue-400/50 bg-blue-500/15 text-blue-50" : "border-white/10 text-slate-300 hover:bg-white/10"}`}
            onClick={() => setShotStatusFilter(shotStatus)}
          >{shotStatus === "all" ? `全部 ${shotOptions.length}` : `${statusText(shotStatus)} ${shotStatusCounts[shotStatus] || 0}`}</button>)}
        </div>
        <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
          {[
            { value: "all", label: `全部链路 ${shotOptions.length}` },
            { value: "unlinked", label: `未铺设 ${shotWorkflowCounts.unlinked}` },
            { value: "linked", label: `已铺设 ${shotWorkflowCounts.linked}` }
          ].map((item) => <button
            key={item.value}
            className={`rounded border px-2 py-1 ${shotWorkflowFilter === item.value ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-50" : "border-white/10 text-slate-300 hover:bg-white/10"}`}
            onClick={() => setShotWorkflowFilter(item.value)}
          >{item.label}</button>)}
        </div>
        <label className="mt-3 flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm">
          <Search size={15} className="text-slate-400" />
          <input className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-500" placeholder="搜索分镜描述、旁白、角色" value={shotQuery} onChange={(event) => setShotQuery(event.target.value)} />
        </label>
        <label className="mt-3 grid gap-1 text-xs text-slate-400">
          分镜排序
          <select className="rounded-md border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none" value={shotSort} onChange={(event) => setShotSort(event.target.value)}>
            <option value="index-asc">按分镜序号升序</option>
            <option value="index-desc">按分镜序号降序</option>
            <option value="status">按生成状态优先</option>
          </select>
        </label>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <button disabled={!filteredShots.length} className="rounded-md border border-white/10 px-3 py-2 text-slate-200 hover:bg-white/10 disabled:opacity-50" onClick={selectFilteredShots}>选择当前分镜</button>
          <button disabled={!filteredShots.some((shot) => !shotWorkflowShotIds.has(shot.id))} className="rounded-md border border-white/10 px-3 py-2 text-slate-200 hover:bg-white/10 disabled:opacity-50" onClick={selectUnlinkedFilteredShots}>选择未铺设</button>
          <button disabled={!selectedShotIds.length} className="rounded-md border border-white/10 px-3 py-2 text-slate-200 hover:bg-white/10 disabled:opacity-50" onClick={clearShotSelection}>清空分镜选择</button>
        </div>
        <button disabled={!selectedFilteredShots.length} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-blue-400/40 bg-blue-500/10 px-3 py-2 text-sm text-white hover:bg-blue-500/20 disabled:opacity-50" onClick={addAllShotWorkflows}><GitBranch size={15} />{selectedShotIds.length ? `添加选中分镜链路 ${selectedFilteredShots.length}` : "添加当前分镜链路"}</button>
        <div className="mt-3 grid gap-2 text-sm">
          {filteredShots.map((shot) => <article key={shot.id} className="rounded-md border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-start justify-between gap-3">
              <label className="mt-1 flex shrink-0 items-center gap-2 text-xs text-slate-400">
                <input type="checkbox" checked={selectedShotIds.includes(shot.id)} onChange={() => toggleShotSelection(shot.id)} />
                选择
              </label>
              <div className="min-w-0 flex-1">
                <strong className="block text-white">分镜 {shot.index}</strong>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-300">{shot.visual_description || "暂无画面描述"}</p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{shot.narration || "暂无旁白"}</p>
              </div>
              <div className="grid shrink-0 gap-1 text-right">
                <span className="rounded bg-black/30 px-2 py-1 text-[11px] text-slate-300">{statusText(shot.generation_status || "draft")}</span>
                <span className={`rounded px-2 py-1 text-[11px] ${shotWorkflowShotIds.has(shot.id) ? "bg-emerald-500/10 text-emerald-100" : "bg-amber-500/10 text-amber-100"}`}>{shotWorkflowShotIds.has(shot.id) ? "已铺设" : "未铺设"}</span>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-xs text-white hover:bg-blue-500" onClick={() => addShotWorkflow(shot)}><GitBranch size={14} />添加分镜链路</button>
              <button disabled={!shotWorkflowShotIds.has(shot.id)} className="inline-flex items-center justify-center gap-2 rounded-md border border-white/10 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-50" onClick={() => focusShotWorkflow(shot)}><Focus size={14} />定位已有链路</button>
            </div>
          </article>)}
          {!shotOptions.length && <p className="rounded-md border border-white/10 px-3 py-2 text-slate-400">暂无分镜，请先从创作入口生成脚本分镜。</p>}
          {!!shotOptions.length && !filteredShots.length && <p className="rounded-md border border-white/10 px-3 py-2 text-slate-400">没有匹配分镜，请调整状态或关键词。</p>}
        </div>
      </aside>}

      {showTasks && <aside className="absolute bottom-6 left-[500px] z-20 max-h-[320px] w-[380px] overflow-auto rounded-lg border border-white/10 bg-slate-950/90 p-4 shadow-2xl backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-400">生成过程追踪</p>
            <h2 className="font-semibold">任务队列</h2>
          </div>
          <span className="rounded border border-white/10 px-2 py-1 text-xs text-slate-400">{filteredTasks.length}/{tasks.length}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-1 text-[11px]">
          {taskStatusFilterOptions.map((taskStatus) => <button
            key={taskStatus}
            className={`rounded border px-2 py-1 ${taskStatusFilter === taskStatus ? "border-blue-400/50 bg-blue-500/15 text-blue-50" : "border-white/10 text-slate-300 hover:bg-white/10"}`}
            onClick={() => setTaskStatusFilter(taskStatus)}
          >{taskStatus === "all" ? `全部 ${tasks.length}` : `${statusText(taskStatus)} ${taskStatusCounts[taskStatus] || 0}`}</button>)}
        </div>
        <label className="mt-3 flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm">
          <Search size={15} className="text-slate-400" />
          <input className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-500" placeholder="搜索任务类型、工作流、错误" value={taskQuery} onChange={(event) => setTaskQuery(event.target.value)} />
        </label>
        <div className="mt-3 grid gap-2 text-sm">
          {filteredTasks.map((task) => <article key={task.id} className="rounded-md border border-white/10 px-3 py-2 text-slate-300">
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
          {!!tasks.length && !filteredTasks.length && <p className="rounded-md border border-white/10 px-3 py-2 text-slate-400">没有匹配任务，请调整状态或关键词。</p>}
        </div>
      </aside>}
    </main>
  );
}
