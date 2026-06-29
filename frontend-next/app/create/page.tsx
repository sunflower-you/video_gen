import { AppShell } from "../../components/app-shell";
import { CreateWorkbench } from "../../components/create-workbench";

const workflowSteps = ["创建项目", "快速体验 Seedance 2.0", "编辑脚本", "生成分镜", "批量生成素材", "合成导出"];

export default function CreatePage() {
  return (
    <AppShell>
      <header className="mb-4">
        <h1 className="text-xl font-semibold">创作工作台</h1>
        <p className="mt-1 text-sm text-muted">创建项目后会进入全画幅节点画布，可继续添加和修改文本、图片、视频、音频、脚本和生成节点。</p>
      </header>
      <CreateWorkbench />
      <section className="mt-4 rounded-panel border border-line bg-panel p-4">
        <h2 className="font-semibold">创作流程</h2>
        <div className="mt-4 grid grid-cols-6 gap-3">
          {workflowSteps.map((item, index) => (
            <div key={item} className="rounded-md border border-line p-3">
              <small className="text-muted">步骤 {index + 1}</small>
              <strong className="mt-1 block">{item}</strong>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-md border border-line p-3 text-sm text-muted">
          开始创作后进入全画幅画布；节点可保存草稿、运行生成、失败重试，并与项目素材和任务队列联动。
        </div>
      </section>
    </AppShell>
  );
}
