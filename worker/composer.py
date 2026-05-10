"""
Video composer.
Each scene = gradient background + text panel (left/bottom) + screenshot panel that slides in.
All text is rendered via Pillow; FFmpeg handles animation + audio + concat.
"""
import json
import os
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFont

# ── Background presets ───────────────────────────────────────────────────────

BG_PRESETS: dict[str, tuple[str, str]] = {
    "ocean":    ("#0a1628", "#1a3a5c"),
    "purple":   ("#1a0035", "#5b21b6"),
    "midnight": ("#0d0d1a", "#1e1b4b"),
    "forest":   ("#0a1f0a", "#14532d"),
    "fire":     ("#1c0500", "#7c2d12"),
    "sunset":   ("#1a0a00", "#78350f"),
    "slate":    ("#0f172a", "#1e293b"),
}
PRESET_KEYS = list(BG_PRESETS.keys())
DEFAULT_BG = "ocean"


def get_bg_colors(style: str | None) -> tuple[str, str]:
    return BG_PRESETS.get(style or DEFAULT_BG, BG_PRESETS[DEFAULT_BG])


# ── Color / image helpers ────────────────────────────────────────────────────

def _hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def create_gradient(w: int, h: int, c1: str, c2: str) -> Image.Image:
    r1, g1, b1 = _hex_rgb(c1)
    r2, g2, b2 = _hex_rgb(c2)
    img = Image.new("RGB", (w, h))
    draw = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        draw.line(
            [(0, y), (w, y)],
            fill=(int(r1 + (r2 - r1) * t), int(g1 + (g2 - g1) * t), int(b1 + (b2 - b1) * t)),
        )
    return img


def fit_and_crop(img: Image.Image, w: int, h: int) -> Image.Image:
    img = img.convert("RGB")
    src_r = img.width / img.height
    dst_r = w / h
    if src_r > dst_r:
        new_w, new_h = int(img.width * h / img.height), h
    else:
        new_w, new_h = w, int(img.height * w / img.width)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    left, top = (new_w - w) // 2, (new_h - h) // 2
    return img.crop((left, top, left + w, top + h))


def add_rounded_corners(img: Image.Image, radius: int = 22) -> Image.Image:
    img = img.convert("RGBA")
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, img.width - 1, img.height - 1], radius=radius, fill=255
    )
    img.putalpha(mask)
    return img


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFNS.ttf",
        "/Library/Fonts/Arial.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    ]:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def _wrap(text: str, font: ImageFont.FreeTypeFont | ImageFont.ImageFont, max_w: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    cur = ""
    for word in words:
        test = (cur + " " + word).strip()
        try:
            tw = font.getbbox(test)[2]
        except Exception:
            tw = len(test) * 10
        if tw > max_w and cur:
            lines.append(cur)
            cur = word
        else:
            cur = test
    if cur:
        lines.append(cur)
    return lines or [text[:40]]


def _draw_text_block(
    frame: Image.Image,
    narration: str,
    caption: str,
    rx: int, ry: int, rw: int, rh: int,
) -> None:
    draw = ImageDraw.Draw(frame, "RGBA")

    narr_sz = max(28, rw // 14)
    cap_sz  = max(18, rw // 22)
    narr_font = _load_font(narr_sz)
    cap_font  = _load_font(cap_sz)

    lines = _wrap(narration, narr_font, rw - 60)
    try:
        line_h = narr_font.getbbox("Ag")[3] + 10
    except Exception:
        line_h = narr_sz + 10

    total_h = len(lines) * line_h
    start_y = ry + (rh - total_h - 70) // 2

    for i, line in enumerate(lines):
        try:
            lw = narr_font.getbbox(line)[2]
        except Exception:
            lw = len(line) * narr_sz // 2
        lx = rx + (rw - lw) // 2
        ly = start_y + i * line_h
        # subtle shadow
        draw.text((lx + 2, ly + 2), line, font=narr_font, fill=(0, 0, 0, 90))
        draw.text((lx, ly), line, font=narr_font, fill=(255, 255, 255, 255))

    # Caption pill badge
    if caption.strip():
        try:
            cw = cap_font.getbbox(caption)[2]
            ch = cap_font.getbbox(caption)[3]
        except Exception:
            cw, ch = len(caption) * cap_sz // 2, cap_sz
        px, py = 18, 8
        bx = rx + (rw - cw) // 2 - px
        by = ry + rh - ch - py * 2 - 24
        draw.rounded_rectangle([bx, by, bx + cw + px * 2, by + ch + py * 2],
                                radius=ch, fill=(255, 255, 255, 45))
        draw.text((bx + px, by + py), caption, font=cap_font, fill=(255, 255, 255, 230))


# ── Frame builders ───────────────────────────────────────────────────────────

def _build_16x9(
    screenshot_path: str, narration: str, caption: str, bg_style: str,
    tmp_dir: str, idx: int, w: int = 1920, h: int = 1080,
) -> tuple[str, str, int, int]:
    """Returns (base_path, panel_path, panel_x, panel_y)."""
    c1, c2 = get_bg_colors(bg_style)
    frame = create_gradient(w, h, c1, c2).convert("RGBA")

    # Soft dark vignette on right edge for depth
    vig = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    vd = ImageDraw.Draw(vig)
    for i in range(300):
        a = int(55 * (1 - i / 300))
        vd.line([(w - 300 + i, 0), (w - 300 + i, h)], fill=(0, 0, 0, a))
    frame = Image.alpha_composite(frame, vig)

    # Text block in left 52%
    tx, tw_avail = 60, int(w * 0.50) - 60
    _draw_text_block(frame, narration, caption, tx, 0, tw_avail, h)

    base_path = os.path.join(tmp_dir, f"base_{idx:03d}.png")
    frame.convert("RGB").save(base_path, "PNG")

    # Screenshot panel: right 44%
    panel_w = int(w * 0.42)
    panel_h = int(h * 0.80)
    panel_x = int(w * 0.545)
    panel_y = (h - panel_h) // 2

    ss = fit_and_crop(Image.open(screenshot_path), panel_w, panel_h)
    ss_r = add_rounded_corners(ss, radius=18)

    # Thin white glow border
    border = Image.new("RGBA", ss_r.size, (0, 0, 0, 0))
    ImageDraw.Draw(border).rounded_rectangle(
        [0, 0, ss_r.width - 1, ss_r.height - 1], radius=18,
        outline=(255, 255, 255, 55), width=2
    )
    panel_img = Image.alpha_composite(ss_r, border)

    panel_path = os.path.join(tmp_dir, f"panel_{idx:03d}.png")
    panel_img.save(panel_path, "PNG")

    return base_path, panel_path, panel_x, panel_y


def _build_9x16(
    screenshot_path: str, narration: str, caption: str, bg_style: str,
    tmp_dir: str, idx: int, w: int = 1080, h: int = 1920,
) -> tuple[str, str, int, int]:
    c1, c2 = get_bg_colors(bg_style)
    frame = create_gradient(w, h, c1, c2)

    # Text in bottom 40%
    tz_y = int(h * 0.60)
    _draw_text_block(frame, narration, caption, 40, tz_y, w - 80, h - tz_y - 40)

    base_path = os.path.join(tmp_dir, f"base_{idx:03d}.png")
    frame.save(base_path, "PNG")

    # Screenshot panel: top area
    panel_w = w - 80
    panel_h = int(h * 0.52)
    panel_x = 40
    panel_y = 50

    ss = fit_and_crop(Image.open(screenshot_path), panel_w, panel_h)
    ss_r = add_rounded_corners(ss, radius=24)

    panel_path = os.path.join(tmp_dir, f"panel_{idx:03d}.png")
    ss_r.save(panel_path, "PNG")

    return base_path, panel_path, panel_x, panel_y


# ── Audio helpers ────────────────────────────────────────────────────────────

def get_audio_duration(path: str) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", path],
        capture_output=True, text=True,
    )
    data = json.loads(result.stdout)
    for s in data.get("streams", []):
        if s.get("codec_type") == "audio":
            return float(s.get("duration", 0))
    return 0.0


# ── Scene renderer ───────────────────────────────────────────────────────────

def compose_scene(
    image_path: str,
    audio_path: str,
    caption: str,
    narration: str,
    duration_ms: int,
    bg_style: str,
    aspect_ratio: str,
    out_path: str,
    tmp_dir: str,
    scene_idx: int = 0,
) -> None:
    audio_dur = get_audio_duration(audio_path)
    dur = max(audio_dur + 0.5, duration_ms / 1000.0)

    if aspect_ratio == "9:16":
        w, h = 1080, 1920
        base_p, panel_p, px, py = _build_9x16(
            image_path, narration, caption, bg_style, tmp_dir, scene_idx, w, h
        )
        # Panel slides down from above
        panel_h = Image.open(panel_p).height
        start_y = -(panel_h + 60)
        x_expr = str(px)
        y_expr = f"if(lt(t,0.45),{py}+pow(1-t/0.45,2)*({start_y}-{py}),{py})"
    else:
        w, h = 1920, 1080
        base_p, panel_p, px, py = _build_16x9(
            image_path, narration, caption, bg_style, tmp_dir, scene_idx, w, h
        )
        # Panel slides in from the right
        start_x = w + 80
        x_expr = f"if(lt(t,0.45),{px}+pow(1-t/0.45,2)*({start_x}-{px}),{px})"
        y_expr = str(py)

    filter_complex = (
        f"[0:v][1:v]overlay=x='{x_expr}':y='{y_expr}':eval=frame,format=yuv420p[comp];"
        f"[comp]fade=t=in:st=0:d=0.25[v];"
        f"[2:a]apad,atrim=end={dur:.3f}[a]"
    )

    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-framerate", "25", "-i", base_p,
        "-loop", "1", "-framerate", "25", "-i", panel_p,
        "-i", audio_path,
        "-filter_complex", filter_complex,
        "-map", "[v]", "-map", "[a]",
        "-t", f"{dur:.3f}",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-ar", "44100",
        "-pix_fmt", "yuv420p",
        out_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg scene {scene_idx} failed:\n{result.stderr[-800:]}")


# ── Concat + music ───────────────────────────────────────────────────────────

def concatenate_scenes(
    scene_paths: list[str],
    output_path: str,
    music_path: str | None = None,
    music_gain: float = 0.3,
) -> None:
    list_file = output_path + ".list.txt"
    with open(list_file, "w") as f:
        for p in scene_paths:
            f.write(f"file '{p}'\n")

    concat_path = output_path + ".concat.mp4" if music_path else output_path

    result = subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_file, "-c", "copy", concat_path],
        capture_output=True, text=True,
    )
    os.unlink(list_file)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg concat failed:\n{result.stderr[-800:]}")

    if music_path:
        cmd2 = [
            "ffmpeg", "-y",
            "-i", concat_path, "-i", music_path,
            "-filter_complex",
            f"[0:a][1:a]amix=inputs=2:duration=first:weights=1 {music_gain}[aout]",
            "-map", "0:v", "-map", "[aout]",
            "-c:v", "copy", "-c:a", "aac", "-ar", "44100",
            output_path,
        ]
        result2 = subprocess.run(cmd2, capture_output=True, text=True)
        os.unlink(concat_path)
        if result2.returncode != 0:
            raise RuntimeError(f"FFmpeg music mix failed:\n{result2.stderr[-800:]}")


# ── Top-level render ─────────────────────────────────────────────────────────

def render_video(
    scenes: list[dict],
    output_path: str,
    music_path: str | None = None,
    music_gain: float = 0.3,
    aspect_ratio: str = "16:9",
    tmp_dir: str | None = None,
) -> None:
    own_tmp = tmp_dir is None
    if own_tmp:
        tmp_dir = tempfile.mkdtemp()

    try:
        scene_paths = []
        for i, scene in enumerate(scenes):
            scene_out = os.path.join(tmp_dir, f"scene_{i:03d}.mp4")
            compose_scene(
                image_path=scene["image_path"],
                audio_path=scene["audio_path"],
                caption=scene.get("caption", ""),
                narration=scene.get("narration", scene.get("caption", "")),
                duration_ms=scene["duration_ms"],
                bg_style=scene.get("bg_style", DEFAULT_BG),
                aspect_ratio=aspect_ratio,
                out_path=scene_out,
                tmp_dir=tmp_dir,
                scene_idx=i,
            )
            scene_paths.append(scene_out)

        concatenate_scenes(scene_paths, output_path, music_path=music_path, music_gain=music_gain)
    finally:
        if own_tmp:
            import shutil
            shutil.rmtree(tmp_dir, ignore_errors=True)
