import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "漫剧工坊",
  description: "基于 ComfyUI 的中文短视频和漫剧制作平台"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
