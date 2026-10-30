#!/usr/bin/env python3
"""Crop the real UI gallery and compose the README theme overviews.

Requires Pillow. Geometry comes from tests/theme-gallery.html and uses document
CSS coordinates; ``scale`` converts them to screenshot pixels. Accepted JSON:

    {"theme": "ocean", "scale": 2, "panels": [
      {"id": "01-providers", "rect": {"x": 0, "y": 48,
                                     "width": 1440, "height": 1250}}, ...]}

A shared manifest can instead contain {"themes": {"ocean": {...}, ...}}.
Each entry may specify an image path relative to --input-dir. Without
--manifest, the script looks for a JSON sidecar beside each gallery PNG.
For fixed pixel crops, omit the manifest and pass ten --rect x,y,width,height
arguments in page order; --scale defaults to 1 in that mode.

Examples:
    python3 scripts/compose-theme-screenshots.py \
        --input-dir /tmp/pagelingo-theme-gallery
    python3 scripts/compose-theme-screenshots.py \
        --image /tmp/ocean.png --manifest /tmp/ocean.json --theme ocean

Every theme produces overview.png (2400 px wide) and overview-thumb.png
(1200 px wide). Ocean also produces ten separate full-resolution page images
and an additional toolbar close-up when captureRect is available. Use
--detail-theme to select another detailed theme, repeating it for multiple themes.
No screenshot is stretched. Each overview panel fits a bounded area while
preserving its aspect ratio, keeping compact interfaces readable as well.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    raise SystemExit("Pillow is required. Run this script with a Python environment that includes Pillow.")


ROOT = Path(__file__).resolve().parents[1]
PAGES = (
    ("01-providers", "AI 服务商"),
    ("02-preferences", "翻译偏好"),
    ("03-performance", "速度与缓存"),
    ("04-appearance", "外观主题"),
    ("05-usage", "用量统计"),
    ("06-popup", "插件弹窗"),
    ("07-manual-floating", "手动翻译浮窗"),
    ("08-selection", "划词翻译浮窗"),
    ("09-page-toolbar", "整页翻译工具栏"),
    ("10-translator", "独立翻译兼容页"),
)
ALIASES = {
    "07-manual": "07-manual-floating",
    "09-page": "09-page-toolbar",
    "10-compatibility": "10-translator",
}
THEMES = {
    "midnight": {"name": "午夜深色", "canvas": "#101823", "surface": "#172230", "text": "#e4ecf7", "muted": "#b0bfd2", "line": "#35475d", "accent": "#a8c7ff"},
    "sage": {"name": "草木绿", "canvas": "#fafbf8", "surface": "#ffffff", "text": "#283020", "muted": "#66735a", "line": "#dfe6d5", "accent": "#c7ef65"},
    "ocean": {"name": "海盐蓝", "canvas": "#f4f8fc", "surface": "#ffffff", "text": "#1f3448", "muted": "#526b81", "line": "#d8e3ee", "accent": "#b2dcff"},
    "lavender": {"name": "柔雾紫", "canvas": "#f9f6fc", "surface": "#fffdff", "text": "#382849", "muted": "#70617f", "line": "#e4d9ee", "accent": "#dcc7f7"},
    "sand": {"name": "暖纸棕", "canvas": "#fbf7ee", "surface": "#fffcf6", "text": "#493723", "muted": "#7a664b", "line": "#e7d9bf", "accent": "#f3d493"},
}
FONT_CANDIDATES = (
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/PingFang.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
)
# The trusted local gallery can be tall enough to exceed Pillow's default warning.
Image.MAX_IMAGE_PIXELS = 250_000_000


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input-dir", type=Path, default=Path("/tmp/pagelingo-theme-gallery"))
    parser.add_argument("--output-dir", type=Path, default=ROOT / "screenshots" / "themes")
    parser.add_argument("--manifest", type=Path, help="One gallery geometry JSON or a themes map")
    parser.add_argument("--image", type=Path, help="Process one image; requires --theme")
    parser.add_argument("--theme", action="append", choices=THEMES, help="Limit to one or more themes")
    parser.add_argument("--detail-theme", action="append", choices=THEMES, help="Also save individual full-resolution pages; defaults to ocean; repeat for multiple themes")
    parser.add_argument("--scale", type=float, help="Override CSS-to-image scale from the manifest")
    parser.add_argument("--rect", action="append", default=[], metavar="X,Y,W,H", help="Static crop in page order, without a geometry manifest")
    parser.add_argument("--width", type=int, default=2400, help="Overview image width")
    parser.add_argument("--thumb-width", type=int, default=1200, help="Overview thumbnail width")
    parser.add_argument("--font", type=Path, help="Optional font with Chinese glyphs")
    args = parser.parse_args()
    if args.image and (not args.theme or len(args.theme) != 1):
        parser.error("--image requires exactly one --theme")
    if args.scale is not None and (not math.isfinite(args.scale) or args.scale <= 0):
        parser.error("--scale must be a positive finite number")
    if args.width < 800 or not 1 <= args.thumb_width <= args.width:
        parser.error("--width must be at least 800, and --thumb-width must be between 1 and --width")
    if args.rect and len(args.rect) != len(PAGES):
        parser.error(f"Pass exactly {len(PAGES)} --rect arguments, in page order")
    return args


def load_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ValueError(f"Cannot read geometry {path}: {error}") from error


def theme_manifest(manifest, theme):
    if not manifest:
        return None
    if "themes" in manifest:
        entry = manifest["themes"].get(theme)
        return {"theme": theme, **entry} if entry else None
    if "panels" in manifest:
        declared_theme = manifest.get("theme")
        return manifest if not declared_theme or declared_theme == theme else None
    # Also accept a direct {midnight: {...}, sage: {...}} map.
    entry = manifest.get(theme)
    return {"theme": theme, **entry} if isinstance(entry, dict) else None


def find_image(args, theme, manifest):
    if args.image:
        return args.image
    if manifest and manifest.get("image"):
        path = Path(manifest["image"])
        return path if path.is_absolute() else args.input_dir / path
    candidates = (
        args.input_dir / f"{theme}.png",
        args.input_dir / f"{theme}-gallery.png",
        args.input_dir / f"gallery-{theme}.png",
        args.input_dir / theme / "gallery.png",
    )
    return next((path for path in candidates if path.is_file()), None)


def load_geometry(args, theme, image_path, manifest):
    if args.rect:
        panels = []
        for (page_id, title), value in zip(PAGES, args.rect):
            try:
                values = [float(part) for part in value.split(",")]
                if len(values) != 4:
                    raise ValueError()
            except ValueError:
                raise ValueError(f"Invalid --rect: {value!r}; expected x,y,width,height")
            panels.append({"id": page_id, "title": title, "rect": dict(zip(("x", "y", "width", "height"), values))})
        return {"theme": theme, "scale": args.scale or 1, "panels": panels}
    if manifest:
        return manifest
    candidates = (
        image_path.with_suffix(".json"),
        args.input_dir / f"{theme}.json",
        args.input_dir / f"{theme}-geometry.json",
        args.input_dir / f"geometry-{theme}.json",
        args.input_dir / "manifest.json",
    )
    for path in candidates:
        if path.is_file():
            geometry = theme_manifest(load_json(path), theme)
            if geometry:
                return geometry
    raise ValueError(f"No geometry for {theme}: provide a JSON sidecar, --manifest, or ten --rect values")


def crop_pages(image_path, geometry, scale_override):
    scale = scale_override if scale_override is not None else geometry.get("scale", 1)
    if geometry.get("pixelCoordinates") and scale_override is None:
        scale = 1
    if not isinstance(scale, (float, int)) or not math.isfinite(scale) or scale <= 0:
        raise ValueError(f"Invalid gallery scale: {scale!r}")
    panels = {}
    for panel in geometry.get("panels", []):
        page_id = ALIASES.get(panel.get("id"), panel.get("id"))
        if page_id not in dict(PAGES):
            raise ValueError(f"Unknown panel ID: {page_id!r}")
        if page_id in panels:
            raise ValueError(f"Duplicate panel ID: {page_id}")
        panels[page_id] = panel
    missing = [page_id for page_id, _ in PAGES if page_id not in panels]
    if missing:
        raise ValueError(f"Incomplete gallery; missing {', '.join(missing)}")
    with Image.open(image_path) as source:
        source.load()

        def crop_rectangle(page_id, rect):
            if not isinstance(rect, dict):
                raise ValueError(f"{page_id} has no captureRect/rect/frame object")
            values = [rect.get(key) for key in ("x", "y", "width", "height")]
            if not all(isinstance(value, (float, int)) and math.isfinite(value) for value in values):
                raise ValueError(f"{page_id} has an invalid rectangle: {rect!r}")
            x, y, width, height = values
            if width <= 0 or height <= 0:
                raise ValueError(f"{page_id} has an empty rectangle")
            box = (math.floor(x * scale), math.floor(y * scale), math.ceil((x + width) * scale), math.ceil((y + height) * scale))
            if box[0] < -1 or box[1] < -1 or box[2] > source.width + 1 or box[3] > source.height + 1:
                raise ValueError(f"{page_id} crop {box} exceeds {source.size} in {image_path}; check the full-page capture and --scale")
            box = (max(0, box[0]), max(0, box[1]), min(source.width, box[2]), min(source.height, box[3]))
            return source.crop(box).convert("RGB")

        crops, details = [], []
        for page_id, title in PAGES:
            panel = panels[page_id]
            rect = panel.get("captureRect") or panel.get("rect") or panel.get("frame")
            if page_id == "09-page-toolbar":
                # Include the article and its bilingual text in the main image.
                # Keep the original focused toolbar capture as a separate detail.
                rect = panel.get("frameRect") or panel.get("frame") or panel.get("rect") or rect
                if panel.get("captureRect"):
                    details.append(("09-page-toolbar-detail", crop_rectangle("09-page-toolbar-detail", panel["captureRect"])))
            crops.append((page_id, title, crop_rectangle(page_id, rect)))
        return crops, details


def load_fonts(args, sizes):
    candidates = [str(args.font)] if args.font else []
    candidates.extend(FONT_CANDIDATES)
    for path in candidates:
        if Path(path).is_file():
            return [ImageFont.truetype(path, max(8, int(size))) for size in sizes]
    raise ValueError("No Chinese font found; pass --font /path/to/font.ttc")


def compose_overview(theme, crops, args):
    palette = THEMES[theme]
    # Dimensions scale with the requested overview width, never with source DPR.
    ratio = args.width / 2400
    margin, gutter, inset = (round(value * ratio) for value in (64, 32, 20))
    card_width = (args.width - 2 * margin - gutter) // 2
    label_height = round(82 * ratio)
    content_width = card_width - 2 * inset
    max_panel_height = round(1080 * ratio)
    rendered = []
    for page_id, title, crop in crops:
        content_scale = min(1, content_width / crop.width, max_panel_height / crop.height)
        size = (max(1, round(crop.width * content_scale)), max(1, round(crop.height * content_scale)))
        rendered.append((page_id, title, crop.resize(size, Image.Resampling.LANCZOS)))
    row_heights = [max(item[2].height for item in rendered[index:index + 2]) + label_height + 2 * inset for index in range(0, len(rendered), 2)]
    header_height = round(192 * ratio)
    footer_height = round(66 * ratio)
    height = header_height + sum(row_heights) + gutter * (len(row_heights) - 1) + footer_height + margin
    canvas = Image.new("RGB", (args.width, height), palette["canvas"])
    draw = ImageDraw.Draw(canvas)
    title_font, subtitle_font, card_font, number_font, footer_font = load_fonts(args, (48 * ratio, 23 * ratio, 27 * ratio, 24 * ratio, 19 * ratio))
    draw.rounded_rectangle((margin, round(42 * ratio), margin + round(54 * ratio), round(48 * ratio)), radius=round(3 * ratio), fill=palette["accent"])
    draw.text((margin, round(65 * ratio)), f"PageLingo · {palette['name']}", font=title_font, fill=palette["text"])
    draw.text((margin, round(128 * ratio)), "全部页面总览  /  10 个界面  /  同一主题，完整呈现", font=subtitle_font, fill=palette["muted"])
    top = header_height
    for index, (page_id, title, screenshot) in enumerate(rendered):
        row, column = divmod(index, 2)
        left = margin + column * (card_width + gutter)
        if column == 0 and row:
            top += row_heights[row - 1] + gutter
        bottom = top + row_heights[row]
        draw.rounded_rectangle((left, top, left + card_width, bottom), radius=max(4, round(14 * ratio)), fill=palette["surface"], outline=palette["line"], width=max(1, round(2 * ratio)))
        label_y = top + round(27 * ratio)
        draw.text((left + inset + round(5 * ratio), label_y), page_id[:2], font=number_font, fill=palette["muted"])
        draw.text((left + inset + round(61 * ratio), label_y - round(2 * ratio)), title, font=card_font, fill=palette["text"])
        image_x = left + (card_width - screenshot.width) // 2
        image_y = top + label_height + inset
        canvas.paste(screenshot, (image_x, image_y))
        draw.rectangle((image_x - 1, image_y - 1, image_x + screenshot.width, image_y + screenshot.height), outline=palette["line"], width=1)
    draw.text((margin, height - footer_height + round(12 * ratio)), "真实界面截图 · 模拟翻译内容 · 未使用 API Key", font=footer_font, fill=palette["muted"])
    return canvas


def save_theme(args, theme, image_path, geometry):
    crops, details = crop_pages(image_path, geometry, args.scale)
    destination = args.output_dir / theme
    destination.mkdir(parents=True, exist_ok=True)
    output = []
    if theme in (args.detail_theme or ["ocean"]):
        for page_id, _, crop in crops:
            path = destination / f"{page_id}.png"
            crop.save(path, optimize=True)
            output.append({"file": str(path), "width": crop.width, "height": crop.height})
        for page_id, crop in details:
            path = destination / f"{page_id}.png"
            crop.save(path, optimize=True)
            output.append({"file": str(path), "width": crop.width, "height": crop.height})
    overview = compose_overview(theme, crops, args)
    path = destination / "overview.png"
    overview.save(path, optimize=True)
    thumb_size = (args.thumb_width, round(overview.height * args.thumb_width / overview.width))
    thumbnail = overview.resize(thumb_size, Image.Resampling.LANCZOS)
    thumb_path = destination / "overview-thumb.png"
    thumbnail.save(thumb_path, optimize=True)
    output.extend(({"file": str(path), "width": overview.width, "height": overview.height}, {"file": str(thumb_path), "width": thumbnail.width, "height": thumbnail.height}))
    return {"theme": theme, "source": str(image_path), "outputs": output}


def main():
    args = parse_args()
    manifest = load_json(args.manifest) if args.manifest else None
    themes = args.theme or list(THEMES)
    jobs = []
    # Resolve all requested input paths before writing any output images.
    for theme in themes:
        entry = theme_manifest(manifest, theme)
        image_path = find_image(args, theme, entry)
        if not image_path or not image_path.is_file():
            if args.theme or args.manifest:
                raise ValueError(f"No gallery PNG for requested theme {theme}")
            continue
        geometry = load_geometry(args, theme, image_path, entry)
        jobs.append((theme, image_path, geometry))
    if not jobs:
        raise ValueError(f"No gallery PNG files found in {args.input_dir}")
    for theme, image_path, geometry in jobs:
        print(json.dumps(save_theme(args, theme, image_path, geometry), ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as error:
        print(f"Screenshot composition failed: {error}", file=sys.stderr)
        raise SystemExit(1)
