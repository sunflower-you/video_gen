import type { ReactNode } from "react";

const navItems = [
  { label: "作品广场", href: "/" },
  { label: "开始创作", href: "/create" },
  { label: "模板市场", href: "/templates" },
  { label: "积分充值", href: "/billing" },
  { label: "账号令牌", href: "/account" }
];

const quickStartItems = [
  { label: "创作者挑战赛", href: "/create?quick=creator-challenge" },
  { label: "Seedance 2.0", href: "/create?quick=seedance2" },
  { label: "TV Show", href: "/create?quick=tv-show" }
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen grid-cols-[220px_minmax(0,1fr)] bg-canvas">
      <aside className="bg-[#111827] px-4 py-5 text-white">
        <div className="mb-7 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent font-bold">影</span>
          <div>
            <strong className="block">漫剧工坊</strong>
            <small className="text-slate-300">AI 创作社区</small>
          </div>
        </div>
        <nav className="grid gap-1 text-sm text-slate-200">
          {navItems.map((item) => (
            <a key={item.href} className="rounded-md px-3 py-2 hover:bg-slate-700" href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="mt-6 border-t border-white/10 pt-4">
          <p className="px-3 text-xs text-slate-400">快捷创作</p>
          <nav className="mt-2 grid gap-1 text-sm text-slate-200">
            {quickStartItems.map((item) => (
              <a key={item.href} className="rounded-md px-3 py-2 hover:bg-slate-700" href={item.href}>
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      </aside>
      <section className="min-w-0 p-5">{children}</section>
    </main>
  );
}
