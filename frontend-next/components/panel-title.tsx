import type { ReactNode } from "react";

export function PanelTitle({ icon, title, extra }: { icon: ReactNode; title: string; extra: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <span className="text-sm text-muted">{extra}</span>
    </div>
  );
}
