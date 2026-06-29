
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  type NodeProps
} from "@xyflow/react";
import { Boxes, Clapperboard, FileText, Image, Library, Music, Play, Plus, RefreshCcw, Save, Sparkles, Trash2, Video, Wand2 } from "lucide-react";
import { apiFetch, currentUserId, deleteJson, postJson, type Asset, type GenerationTask, type Project, type ProjectGraph, type ProjectGraphNode } from "../lib/api";

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

const addableNodes = [
  { type: "text", label: "文本", icon: FileText },
  { type: "image", label: "图片", icon: Image },
  { type: "video", label: "视频", icon: Video },
  { type: "audio", label: "音频", icon: Music },
  { type: "script", label: "脚本 Beta", icon: Clapperboard },
  { type: "image_generation", label: "分镜图", icon: Wand2 },
  { type: "video_generation", label: "镜头视频", icon: Video },
  { type: "tts_generation", label: "配音", icon: Music },
  { type: "compose_generation", label: "合成", icon: Sparkles },
  { type: "demo", label: "演示", icon: Boxes }
];

export function CanvasWorkspace({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [status, setStatus] = useState("正在加载全画幅创作画布...");
  const [showAssets, setShowAssets] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const [busy, setBusy] = useState(false);

  const selectedNode = useMemo(() => nodes.find((item) => item.id === selectedNodeId) || null, [nodes, selectedNodeId]);

  useEffect(() => {
    void refreshAll();
  }, [projectId]);

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

  function addNode(type: string) {
    const id = `local-${type}-${Date.now()}`;
    const baseData = type === "script" ? { title: "脚本 Beta", script: "在这里输入短视频脚本，运行后自动拆解分镜。" } : type === "image" ? { title: "图片节点", image_url: "/storage/reference/hero.png" } : type === "video" ? { title: "视频节点", video_url: "" } : type === "audio" ? { title: "音频节点", audio_url: "" } : type.endsWith("generation") ? { title: nodeLabels[type], prompt: "输入生成提示词" } : { title: nodeLabels[type], text: "输入内容" };
    const node: Node = {
      id,
      type: "platform",
      position: { x: 160 + nodes.length * 36, y: 120 + nodes.length * 28 },
      data: { ...baseData, nodeType: type, graphNodeId: id, status: "draft" }
    };
    setNodes((items) => [...items, node]);
    setSelectedNodeId(id);
    setStatus(`已添加${nodeLabels[type] || "节点"}。`);
  }

  function updateSelectedData(key: string, value: string) {
    if (!selectedNode) return;
    setNodes((items) => items.map((node) => node.id === selectedNode.id ? { ...node, data: { ...node.data, [key]: value } } : node));
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
          <button disabled={busy} className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 disabled:opacity-50" onClick={() => void saveGraph()}><Save size={16} />保存画布</button>
        </div>
      </header>

      <aside className="absolute left-4 top-28 z-20 grid gap-2 rounded-lg border border-white/10 bg-slate-950/85 p-2 shadow-2xl backdrop-blur">
        {addableNodes.map((item) => {
          const Icon = item.icon;
          return <button key={item.type} title={`添加${item.label}`} className="grid h-10 w-10 place-items-center rounded-md text-slate-200 hover:bg-white/10" onClick={() => addNode(item.type)}><Icon size={18} /></button>;
        })}
        <button title="素材库" className="grid h-10 w-10 place-items-center rounded-md text-slate-200 hover:bg-white/10" onClick={() => setShowAssets((value) => !value)}><Library size={18} /></button>
        <button title="任务队列" className="grid h-10 w-10 place-items-center rounded-md text-slate-200 hover:bg-white/10" onClick={() => setShowTasks((value) => !value)}><Boxes size={18} /></button>
      </aside>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
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
          {selectedType.includes("generation") && selectedType !== "compose_generation" && <label className="grid gap-1"><span className="text-slate-400">绑定分镜 ID</span><input className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" value={String(selectedData.shot_id || "")} onChange={(event) => updateSelectedData("shot_id", event.target.value)} /></label>}
          {selectedType === "video_generation" && <label className="grid gap-1"><span className="text-slate-400">首帧图片 URL</span><input className="rounded-md border border-white/10 bg-white/5 px-3 py-2 outline-none" value={String(selectedData.first_frame_url || "")} onChange={(event) => updateSelectedData("first_frame_url", event.target.value)} /></label>}
          <button disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 disabled:opacity-50" onClick={() => void runSelectedNode()}><Play size={16} />运行节点</button>
        </div> : <p className="mt-4 rounded-md border border-white/10 bg-white/5 p-3 text-sm text-slate-400">点击画布节点后可编辑参数、运行生成或删除节点。</p>}
      </section>

      {showAssets && <aside className="absolute bottom-6 left-24 z-20 max-h-[320px] w-[360px] overflow-auto rounded-lg border border-white/10 bg-slate-950/90 p-4 shadow-2xl backdrop-blur">
        <h2 className="font-semibold">项目素材库</h2>
        <div className="mt-3 grid gap-2 text-sm">
          {assets.map((asset) => <button key={asset.id} className="rounded-md border border-white/10 px-3 py-2 text-left text-slate-300 hover:bg-white/10" onClick={() => addAssetNode(asset)}>{asset.asset_type} · {asset.url || asset.id}</button>)}
          {!assets.length && <p className="rounded-md border border-white/10 px-3 py-2 text-slate-400">暂无素材，可先运行生成节点。</p>}
        </div>
      </aside>}

      {showTasks && <aside className="absolute bottom-6 left-[500px] z-20 max-h-[320px] w-[380px] overflow-auto rounded-lg border border-white/10 bg-slate-950/90 p-4 shadow-2xl backdrop-blur">
        <h2 className="font-semibold">任务队列</h2>
        <div className="mt-3 grid gap-2 text-sm">
          {tasks.map((task) => <div key={task.id} className="rounded-md border border-white/10 px-3 py-2 text-slate-300">{task.task_type} · {task.status} · {task.workflow_key || "workflow"}</div>)}
          {!tasks.length && <p className="rounded-md border border-white/10 px-3 py-2 text-slate-400">暂无生成任务</p>}
        </div>
      </aside>}
    </main>
  );
}
