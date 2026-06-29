import type { ReactNode } from "react";

const adminNavItems = [
  { label: "发布审核", href: "/admin/review" },
  { label: "返回用户端", href: "/" }
];

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen grid-cols-[240px_minmax(0,1fr)] bg-canvas">
      <aside className="bg-[#1f2937] px-4 py-5 text-white">
        <div className="mb-7 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-slate-600 font-bold">管</span>
          <div>
            <strong className="block">运营后台</strong>
            <small className="text-slate-300">审核、巡检与结算</small>
          </div>
        </div>
        <nav className="grid gap-1 text-sm text-slate-200">
          {adminNavItems.map((item) => (
            <a key={item.href} className="rounded-md px-3 py-2 hover:bg-slate-700" href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
      </aside>
      <section className="min-w-0 p-5">{children}</section>
    </main>
  );
}
