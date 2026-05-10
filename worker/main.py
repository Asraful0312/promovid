import asyncio
import json
import logging
import os
import shutil
import subprocess
import tempfile

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from pydantic import BaseModel

load_dotenv()

import scraper
import scriptgen
import tts
from convex_client import ConvexWorkerClient


def _audio_duration_ms(path: str) -> int:
    """Return audio file duration in milliseconds via ffprobe."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", path],
            capture_output=True, text=True, timeout=10,
        )
        data = json.loads(result.stdout)
        for s in data.get("streams", []):
            if s.get("codec_type") == "audio":
                return int(float(s.get("duration", 0)) * 1000)
    except Exception:
        pass
    return 0

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

WORKER_SHARED_SECRET = os.environ.get("WORKER_SHARED_SECRET", "")

app = FastAPI()


class RenderParams(BaseModel):
    voice: str | None = None
    aspectRatio: str | None = None
    musicGain: float | None = None


class JobPayload(BaseModel):
    renderId: str
    projectId: str
    sourceUrl: str
    mode: str
    renderParams: RenderParams = RenderParams()
    convexSiteUrl: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/jobs")
async def create_job(
    payload: JobPayload,
    background_tasks: BackgroundTasks,
    authorization: str | None = Header(default=None),
):
    if not WORKER_SHARED_SECRET:
        raise HTTPException(status_code=500, detail="WORKER_SHARED_SECRET not configured")
    if authorization != f"Bearer {WORKER_SHARED_SECRET}":
        raise HTTPException(status_code=401, detail="Unauthorized")
    background_tasks.add_task(process_job, payload)
    return {"status": "accepted"}


async def process_job(payload: JobPayload):
    convex = ConvexWorkerClient(payload.convexSiteUrl, WORKER_SHARED_SECRET)
    tmp_dir = tempfile.mkdtemp(prefix="promovid_")
    try:
        log.info(f"[{payload.renderId}] mode={payload.mode} url={payload.sourceUrl}")
        await run_scrape_and_tts(payload, convex, tmp_dir)
        log.info(f"[{payload.renderId}] Done")
    except Exception as exc:
        log.error(f"[{payload.renderId}] Failed: {exc}", exc_info=True)
        try:
            await convex.fail(payload.renderId, str(exc))
        except Exception as fe:
            log.error(f"[{payload.renderId}] Could not report failure: {fe}")
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        await convex.aclose()


async def run_scrape_and_tts(payload: JobPayload, convex: ConvexWorkerClient, tmp_dir: str):
    voice = payload.renderParams.voice or tts.DEFAULT_VOICE

    import composer

    log.info(f"[{payload.renderId}] Scraping")
    page = await scraper.scrape(payload.sourceUrl, tmp_dir)

    log.info(f"[{payload.renderId}] Generating script")
    scenes = await asyncio.to_thread(
        scriptgen.generate_script, page.title, page.description, page.body_text
    )

    # Assign rotating background presets
    for i, scene in enumerate(scenes):
        scene["bg_style"] = composer.PRESET_KEYS[i % len(composer.PRESET_KEYS)]

    log.info(f"[{payload.renderId}] TTS for {len(scenes)} scenes")
    for i, scene in enumerate(scenes):
        audio_path = os.path.join(tmp_dir, f"audio_{i:03d}.mp3")
        await tts.synthesize(scene["narration"], audio_path, voice)
        scene["audio_path"] = audio_path

    screenshots = page.screenshot_paths
    for i, scene in enumerate(scenes):
        scene["image_path"] = screenshots[i % len(screenshots)]

    log.info(f"[{payload.renderId}] Uploading screenshots")
    img_storage_ids: list[str] = []
    for path in screenshots:
        img_url = await convex.issue_upload(payload.renderId)
        sid = await convex.upload_file(img_url, path, "image/png")
        img_storage_ids.append(sid)

    log.info(f"[{payload.renderId}] Uploading audio clips")
    audio_storage_ids: list[str] = []
    for i, scene in enumerate(scenes):
        audio_url = await convex.issue_upload(payload.renderId)
        sid = await convex.upload_file(audio_url, scene["audio_path"], "audio/mpeg")
        audio_storage_ids.append(sid)

    clips = []
    start_ms = 0
    for i, scene in enumerate(scenes):
        # Use actual TTS audio length so clip never cuts off mid-sentence
        audio_ms = _audio_duration_ms(scene["audio_path"])
        dur_ms = max(scene["duration_ms"], audio_ms + 600) if audio_ms > 0 else scene["duration_ms"]
        clips.append({
            "order":          i,
            "startMs":        start_ms,
            "endMs":          start_ms + dur_ms,
            "narrationText":  scene["narration"],
            "captionText":    scene["caption"],
            "imageStorageId": img_storage_ids[i % len(img_storage_ids)],
            "audioStorageId": audio_storage_ids[i],
            "bgStyle":        scene["bg_style"],
        })
        start_ms += dur_ms

    await convex.complete(payload.renderId, clips)
