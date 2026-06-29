from __future__ import annotations

DEFAULT_NEGATIVE_PROMPT = "低清晰度，画面畸变，文字水印"
DEFAULT_STORYBOARD_STYLE = "漫剧"
DEFAULT_ASPECT_RATIO_PROMPT = "竖屏9:16"
DEFAULT_IMAGE_LIGHTING_PROMPT = "电影感光影"


def character_description(style: str) -> str:
    return f"{style}短片核心角色，围绕脚本冲突推进剧情。"


def character_style_prompt(style: str) -> str:
    return f"{style}风格，角色造型统一，表情清晰"


def narration_for_story_unit(sentence: str, *, is_image_project: bool) -> str:
    return f"围绕画面主体展开镜头：{sentence}" if is_image_project else sentence


def visual_description(sentence: str, *, is_image_project: bool, reference_image_url: str = "") -> str:
    if is_image_project and reference_image_url:
        return f"参考图：{reference_image_url}。{sentence}，生成适合图片成片的动态镜头"
    return f"{sentence}，画面具有短视频漫剧叙事张力"


def storyboard_prompt(style: str, sentence: str) -> str:
    return f"{style}，{sentence}，{DEFAULT_ASPECT_RATIO_PROMPT}，{DEFAULT_IMAGE_LIGHTING_PROMPT}，角色一致"


def manual_shot_prompt(visual_description_text: str) -> str:
    return f"漫剧，{visual_description_text}，{DEFAULT_ASPECT_RATIO_PROMPT}，{DEFAULT_IMAGE_LIGHTING_PROMPT}"
