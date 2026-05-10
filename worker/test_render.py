"""
Local pipeline test — no Convex needed.
Usage: python test_render.py https://example.com
Output: ./test_output.mp4
"""
import asyncio
import os
import sys
import tempfile

from dotenv import load_dotenv

load_dotenv()

import composer
import scraper
import scriptgen
import tts


async def main():
    url = sys.argv[1] if len(sys.argv) > 1 else "https://stripe.com"
    print(f"Testing pipeline for: {url}")

    with tempfile.TemporaryDirectory() as tmp:
        print("1. Scraping...")
        page = await scraper.scrape(url, tmp)
        print(f"   title={page.title!r}, screenshots={len(page.screenshot_paths)}")

        print("2. Generating script...")
        scenes = scriptgen.generate_script(page.title, page.description, page.body_text)
        print(f"   {len(scenes)} scenes generated")
        for s in scenes:
            print(f"   [{s['order']}] {s['narration'][:60]!r}")

        print("3. TTS...")
        for i, scene in enumerate(scenes):
            audio_path = os.path.join(tmp, f"audio_{i:03d}.mp3")
            await tts.synthesize(scene["narration"], audio_path)
            scene["audio_path"] = audio_path

        for i, scene in enumerate(scenes):
            scene["image_path"] = page.screenshot_paths[i % len(page.screenshot_paths)]

        # Assign rotating background presets
        for i, scene in enumerate(scenes):
            scene["bg_style"] = composer.PRESET_KEYS[i % len(composer.PRESET_KEYS)]

        print("4. Rendering video...")
        output_path = os.path.abspath("test_output.mp4")
        composer.render_video(
            scenes=[{
                "image_path": s["image_path"],
                "audio_path": s["audio_path"],
                "caption":    s["caption"],
                "narration":  s["narration"],
                "duration_ms": s["duration_ms"],
                "bg_style":   s["bg_style"],
            } for s in scenes],
            output_path=output_path,
            tmp_dir=tmp,
        )

    print(f"\nDone! Video saved to: {output_path}")


if __name__ == "__main__":
    asyncio.run(main())
