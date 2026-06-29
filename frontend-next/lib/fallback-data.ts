import type { Template, Work } from "./api";

export const categories = ["全部", "TV Show", "精选画布", "短片剧集", "AI 漫剧", "动画短片", "概念设计", "经典衍生", "广告短片"];

export const fallbackWorks: Work[] = [
  { id: "demo_1", title: "雨夜车站", category: "AI 漫剧", author_id: "青禾工作室", cover_url: "/storage/covers/rain-station.jpg", video_url: "/storage/final/rain-station.mp4", template_name: "Flux 分镜图生成", tags: ["悬疑", "雨夜", "漫剧"], view_count: 28000, like_count: 310, favorite_count: 88 },
  { id: "demo_2", title: "赛博巷口", category: "概念设计", author_id: "镜头实验室", cover_url: "/storage/covers/cyber-alley.jpg", video_url: "/storage/final/cyber-alley.mp4", template_name: "Wan2.1 镜头视频生成", tags: ["赛博", "霓虹", "短片"], view_count: 14000, like_count: 176, favorite_count: 52 },
  { id: "demo_3", title: "山海旧梦", category: "经典衍生", author_id: "神话改编组", cover_url: "/storage/covers/shanhai-dream.jpg", template_name: "中文旁白配音", tags: ["神话", "国风", "旁白"], view_count: 19000, like_count: 238, favorite_count: 76 }
];

export const fallbackTemplates: Template[] = [
  { id: "selfhost/image_flux", name: "Flux 分镜图生成", category: "AI 漫剧", workflow_key: "selfhost/image_flux", description: "根据分镜画面描述生成竖屏首帧。", cover_url: "/storage/templates/flux-storyboard-cover.jpg", sample_video_url: "/storage/templates/flux-storyboard-sample.mp4", default_params: { width: 768, height: 1344, seed: -1 }, example_inputs: { prompt: "雨夜车站，女主回头看见旧护身符" }, applicable_scenarios: ["分镜首帧", "角色海报"], usage_count: 12 },
  { id: "selfhost/video_wan2.1_fusionx", name: "Wan2.1 镜头视频生成", category: "短片剧集", workflow_key: "selfhost/video_wan2.1_fusionx", description: "基于首帧和动作描述生成镜头视频。", cover_url: "/storage/templates/wan-motion-cover.jpg", sample_video_url: "/storage/templates/wan-motion-sample.mp4", default_params: { duration: 4, fps: 16 }, example_inputs: { prompt: "主角穿过霓虹雨巷", first_frame_url: "/storage/examples/rain-alley-first-frame.png" }, applicable_scenarios: ["镜头视频", "动画短片"], usage_count: 8 },
  { id: "selfhost/tts_edge", name: "中文旁白配音", category: "旁白配音", workflow_key: "selfhost/tts_edge", description: "为分镜旁白生成中文音频。", cover_url: "/storage/templates/tts-narration-cover.jpg", sample_video_url: "/storage/templates/tts-narration-sample.mp4", default_params: { voice: "zh-CN-XiaoxiaoNeural", rate: 1 }, example_inputs: { text: "她终于在雨声里听见了那句迟来的告别。" }, applicable_scenarios: ["旁白配音", "字幕口播"], usage_count: 6 }
];
