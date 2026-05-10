# PromoVid – Full Build Plan

> Solo founder, budget-first. Target: free or near-zero cost at MVP scale.

---

## What This App Does

User pastes a website URL → AI scrapes the site, writes a script, takes
screenshots, synthesizes voice narration, and assembles an MP4 promo video.
The user then edits clips (reorder, swap images, trim duration, change text,
add music) and re-renders.

---

## What Is Already Built

The repo has a solid foundation — do not re-implement these.

### Convex Backend (complete)
| File | What it does |
|------|-------------|
| `convex/schema.ts` | Tables: `projects`, `renders`, `assets`, `timelineClips` |
| `convex/projects.ts` | Create / list / delete / setMusic / patchMeta |
| `convex/renders.ts` | Enqueue render, status mutations, `getKickoffPayload` query |
| `convex/assets.ts` | Generate upload URL, finalize upload, list by project |
| `convex/timeline.ts` | List clips, updateClip, reorderClips, deleteClip |
| `convex/kickoff.ts` | Fires a POST to `WORKER_URL/jobs` with the render payload |
| `convex/worker.ts` | Mutations called by worker: `issueUpload`, `complete`, `fail` |
| `convex/http.ts` | HTTP callbacks for worker: `/worker/issue-upload`, `/worker/complete`, `/worker/fail` |

### Worker Contract (already wired)
Convex kicks off the Python worker by POSTing to `WORKER_URL/jobs`:
```json
{
  "renderId": "...",
  "projectId": "...",
  "sourceUrl": "https://example.com",
  "mode": "initial",
  "clips": [],
  "renderParams": { "voice": "en-US-AriaNeural", "aspectRatio": "16:9", "musicGain": 0.3 },
  "musicUrl": null,
  "includeMusic": false,
  "convexSiteUrl": "https://xxx.convex.site"
}
```
Worker signs callbacks with HMAC-SHA256 (`X-Worker-Timestamp` + `X-Worker-Signature`).

### Frontend (partial)
- `app/page.tsx` — homepage: URL input + project list (done)
- `app/sign-in/` + `app/sign-up/` — WorkOS AuthKit routes (done)
- Auth via WorkOS AuthKit (done)

---

## What Needs to Be Built

### 1. Python Worker Service  ← most critical
### 2. Frontend: `/project/[id]` editor page
### 3. Deployment wiring

---

## Architecture Diagram

```
Browser (Next.js)
    │  create project / enqueue render
    ▼
Convex (DB + Realtime)
    │  kickoffWorker action → POST /jobs
    ▼
Python Worker (FastAPI)
    │  scrape → AI script → TTS → FFmpeg render
    │  POST /worker/issue-upload  →  get Convex upload URL
    │  PUT video to Convex storage
    │  POST /worker/complete      →  save clips + mark ready
    ▼
Convex Storage (video MP4 + screenshots + audio)
    │
    ▼
Browser (video player + clip editor)
```

---

## Service Choices (free / cheap first)

| Concern | Service | Cost |
|---------|---------|------|
| Frontend hosting | Vercel | Free |
| Backend / DB | Convex | Free tier |
| Auth | WorkOS AuthKit | Free (1M MAU) |
| Web scraping + screenshots | Playwright (self-hosted) | Free |
| AI script generation | Google Gemini 2.5 Flash (free tier) | $0 |
| Text-to-speech | `edge-tts` (MS Edge TTS library) | Free, no API key |
| Video composition | FFmpeg (self-hosted) | Free |
| Worker hosting | Railway Hobby (or Fly.io free) | $5/mo or free tier |
| Payments (later) | Creem | — |

**TTS alternatives if edge-tts quality isn't good enough:**
- ElevenLabs free tier: 10k chars/month
- Google Cloud TTS: $4 / 1M chars (very cheap at scale)

**Video complexity note:** FFmpeg handles everything. No Remotion Lambda needed.

---

## Phase 1 — Python Worker Service

### Directory structure
```
worker/
├── main.py           # FastAPI app, POST /jobs endpoint
├── scraper.py        # Playwright scraping + screenshots
├── scriptgen.py      # Claude API → scene list
├── tts.py            # edge-tts → per-scene MP3
├── composer.py       # FFmpeg → final MP4
├── convex_client.py  # signed HTTP calls back to Convex
├── requirements.txt
├── Dockerfile
└── .env.example
```

### Step 1-A: Scraper (`scraper.py`)

Use Playwright (async) to:
1. Open URL, wait for `networkidle`
2. Extract: `<title>`, `<meta description>`, `<h1>`–`<h3>` headings, first 800 words of body text, `og:image`
3. Take a full-page screenshot (PNG, 1280×800 viewport)
4. Scroll to 25%, 50%, 75% and capture section screenshots
5. Return `{title, description, body_text, screenshots: [path, ...]}`

```python
# requirements
playwright>=1.40
```

### Step 1-B: Script Generator (`scriptgen.py`)

Call **Gemini 2.0 Flash** (free tier: 1,500 req/day, 1M tokens/min) with
scraped content. Prompt asks for 5–8 scenes. Each scene:
```json
{
  "order": 0,
  "narration": "Welcome to Acme — the easiest way to…",
  "caption": "Acme – Simplify your workflow",
  "duration_ms": 4000
}
```
Keep narration short (≤25 words per scene) so TTS stays under ~5 seconds.
Use Gemini's `response_mime_type="application/json"` for reliable structured output.

```python
import google.generativeai as genai
import json, os

genai.configure(api_key=os.environ["GEMINI_API_KEY"])
model = genai.GenerativeModel(
    "gemini-2.0-flash",
    generation_config={"response_mime_type": "application/json"},
)

def generate_script(title: str, description: str, body_text: str) -> list[dict]:
    prompt = f"""
You are a video scriptwriter. Given website content, write a promotional video script
as a JSON array of 5-8 scenes. Each scene:
  "order": integer starting at 0
  "narration": ≤25 words spoken aloud by narrator
  "caption": short text overlay (≤8 words)
  "duration_ms": how long to show this scene (3000–6000)

Website title: {title}
Description: {description}
Content: {body_text[:1500]}

Return ONLY the JSON array, nothing else.
"""
    response = model.generate_content(prompt)
    return json.loads(response.text)
```

**Free tier limits** (as of 2025): 15 RPM, 1,500 requests/day, 1M tokens/min.
More than enough for MVP. Get a free API key at aistudio.google.com.

```python
# requirements
google-generativeai>=0.8
```

### Step 1-C: TTS (`tts.py`)

```python
import edge_tts, asyncio, tempfile, os

async def synthesize(text: str, voice: str, out_path: str):
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(out_path)
```

Voice default: `en-US-AriaNeural` (natural, female).
Other voices to expose: `en-US-GuyNeural`, `en-GB-SoniaNeural`.

```python
# requirements
edge-tts>=6.1
```

### Step 1-D: Video Composer (`composer.py`)

For each scene:
- Input: image file + audio file + duration_ms + caption text
- FFmpeg filter chain per scene:
  - `scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080`
  - Ken Burns zoom: `zoompan=z='min(zoom+0.0015,1.5)':d=<frames>`
  - Caption: `drawtext=text='<caption>':fontsize=36:fontcolor=white:box=1:boxcolor=black@0.5:x=(w-tw)/2:y=h-th-40`
  - Pad audio if image duration > audio duration (apad + atrim)
- Concatenate all scene videos with `concat` filter
- If music: mix with `amix=inputs=2:duration=first:weights=1 <musicGain>`
- Output: `output.mp4` (H.264 + AAC, crf 23)

```python
# requirements
# ffmpeg-python or subprocess calls to ffmpeg binary
ffmpeg-python>=0.2
```

### Step 1-E: Main job handler (`main.py`)

```python
@app.post("/jobs")
async def run_job(payload: JobPayload, background_tasks: BackgroundTasks):
    # verify bearer token
    background_tasks.add_task(process_job, payload)
    return {"status": "accepted"}

async def process_job(payload):
    try:
        if payload.mode == "initial":
            await run_initial(payload)
        else:
            await run_timeline(payload)
    except Exception as e:
        await convex.fail(payload.render_id, str(e))
```

**Initial mode:**
1. `scraper.scrape(url)` → text + screenshots
2. `scriptgen.generate(text)` → scenes list
3. For each scene: `tts.synthesize(scene.narration)` → audio file
4. Assign screenshots round-robin to scenes (or best-match by scene index)
5. `composer.render(scenes)` → `output.mp4`
6. `convex.issue_upload()` → get Convex upload URL
7. PUT `output.mp4` to that URL → get `storageId`
8. `convex.complete(render_id, storage_id, clips)`

**Timeline mode (re-render):**
1. Download existing clip images from `imageUrl` fields
2. Re-run TTS only for clips whose `narrationText` changed
3. `composer.render(clips_from_payload)` → new `output.mp4`
4. Upload + complete

### Step 1-F: Convex client (`convex_client.py`)

```python
import hmac, hashlib, time, httpx

class ConvexWorkerClient:
    def __init__(self, site_url: str, secret: str): ...

    def _sign(self, body: str) -> dict:
        ts = str(int(time.time() * 1000))
        sig = hmac.new(secret.encode(), f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()
        return {"X-Worker-Timestamp": ts, "X-Worker-Signature": sig}

    async def issue_upload(self, render_id): ...
    async def complete(self, render_id, output_storage_id, clips): ...
    async def fail(self, render_id, error): ...
```

### Step 1-G: Dockerfile

```dockerfile
FROM python:3.12-slim
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
RUN playwright install chromium --with-deps
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Step 1-H: Environment variables for worker
```
WORKER_SHARED_SECRET=<same as Convex env>
GEMINI_API_KEY=<your key>
PORT=8000
```

---

## Phase 2 — Frontend: Project Editor Page

### Route: `app/project/[id]/page.tsx`

Three states based on `project.status`:
- `draft` → "Generate video" button (triggers `renders.enqueue`)
- `queued` / `rendering` → spinner + status message
- `failed` → error message + retry button
- `ready` → video player + timeline editor

### Components to build

#### `components/VideoPlayer.tsx`
Simple HTML5 `<video>` with controls. Accepts `src` (Convex storage URL).
Add download button (`<a href={src} download>`).

#### `components/Timeline.tsx`
Horizontal scrollable row of `ClipCard` components.
- Each card: screenshot thumbnail + duration badge + narration preview (2 lines)
- Click to select → passes clip to `ClipEditor`
- Drag-to-reorder using `@dnd-kit/core` (lightweight, ~10KB)
- "Add clip" button (inserts blank clip from uploaded assets)

#### `components/ClipEditor.tsx`
Right panel shown when a clip is selected:
- Narration text: `<textarea>` → `timeline.updateClip`
- Caption text: `<input>` → `timeline.updateClip`
- Duration: number input (seconds) → convert to startMs/endMs → `timeline.updateClip`
- Image: grid of project assets + "Upload image" button
  - Upload: `assets.generateUploadUrl` → PUT → `assets.finalizeUpload` → `timeline.updateClip`
- Delete clip button → `timeline.deleteClip`

#### `components/RenderControls.tsx`
- Voice selector: `<select>` (4–5 edge-tts voices)
- Aspect ratio: 16:9 / 9:16 toggle
- Music toggle + upload music file (same upload flow as images)
- Music gain slider (0.1–1.0)
- **Re-render button** → `renders.enqueue({ projectId, params })`

### Data flow for re-render
```
User edits clips (saved live to Convex via mutations)
→ Clicks "Re-render"
→ renders.enqueue() → Convex kicks off worker
→ Worker reads updated clips from getKickoffPayload (mode: "timeline")
→ Worker re-TTS + re-compose → uploads new video
→ Project status goes: queued → rendering → ready
→ UI auto-updates via Convex reactive query
```

### Packages to add (all small, free)
```bash
npm install @dnd-kit/core @dnd-kit/sortable
```

---

## Phase 3 — Deployment

### Convex (already)
```bash
npx convex deploy
```
Set environment variables on Convex dashboard:
```
WORKER_URL=https://your-worker.railway.app
WORKER_SHARED_SECRET=<random 32 char hex>
CONVEX_SITE_URL=https://xxx.convex.site  # auto-set by Convex
```

### Worker: Railway (cheapest reliable option)
1. Push `worker/` directory to its own GitHub repo (or monorepo subfolder)
2. Create Railway project → connect repo → set root to `worker/`
3. Railway auto-detects Dockerfile
4. Set env vars: `WORKER_SHARED_SECRET`, `GEMINI_API_KEY`
5. Cost: ~$5/month on Hobby plan (or free 500hr/month on Trial)

**Alternative: Fly.io**
```bash
cd worker && fly launch --name promovid-worker
fly secrets set WORKER_SHARED_SECRET=... GEMINI_API_KEY=...
fly deploy
```
Free tier: 3 shared-CPU VMs, 256MB RAM each (enough for sequential jobs).

### Next.js: Vercel (free)
```bash
vercel deploy --prod
```
Set env vars on Vercel dashboard (WorkOS keys, Convex URL, etc).

---

## Implementation Order (MVP sprint)

```
Week 1 – Worker core
  [ ] Set up FastAPI + Dockerfile
  [ ] scraper.py: Playwright scrape + screenshots
  [ ] scriptgen.py: Claude haiku → scene JSON
  [ ] tts.py: edge-tts synthesis
  [ ] composer.py: FFmpeg scene assembly (no music first)
  [ ] convex_client.py: issue-upload + complete + fail
  [ ] main.py: /jobs endpoint, initial mode
  [ ] Test end-to-end locally with ngrok

Week 2 – Frontend editor
  [ ] /project/[id] page: status states
  [ ] VideoPlayer component
  [ ] Timeline component with drag reorder
  [ ] ClipEditor component
  [ ] Image upload flow
  [ ] RenderControls + re-render flow

Week 3 – Polish + deploy
  [ ] Music mixing in composer (timeline mode)
  [ ] Deploy worker to Railway
  [ ] Deploy Next.js to Vercel
  [ ] End-to-end test with real URLs
  [ ] Error handling + retry UI
  [ ] Loading skeletons

Week 4 – Launch prep
  [ ] Landing page copy + demo video
  [ ] Usage limits (max 3 projects on free tier)
  [ ] Creem payment integration
  [ ] Rate limiting on /jobs endpoint
```

---

## Local Development Setup

### 1. Convex + Next.js
```bash
# Already working
npm run dev   # runs: convex dev --start 'next dev'
```

### 2. Worker (local)
```bash
cd worker
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
cp .env.example .env   # fill in secrets
uvicorn main:app --reload --port 8000
```

### 3. Expose worker to Convex during dev
```bash
ngrok http 8000
# Copy https URL → set WORKER_URL in Convex dashboard (dev deployment)
```

### 4. Env vars checklist
```
# Convex dashboard (dev + prod)
WORKER_URL=https://...
WORKER_SHARED_SECRET=<hex32>

# Worker .env
WORKER_SHARED_SECRET=<same>
GEMINI_API_KEY=<your key from aistudio.google.com>

# Vercel / .env.local
WORKOS_CLIENT_ID=...
WORKOS_API_KEY=...
WORKOS_REDIRECT_URI=...
NEXT_PUBLIC_CONVEX_URL=...
```

---

## Cost Estimate at MVP Scale (100 videos/month)

| Item | Cost |
|------|------|
| Convex free tier | $0 |
| Vercel free tier | $0 |
| WorkOS free tier | $0 |
| Gemini 2.0 Flash (free tier) | $0 |
| edge-tts (Microsoft, free) | $0 |
| Railway worker (Hobby) | $5 |
| **Total** | **~$5/month** |

Upgrade triggers:
- **ElevenLabs** ($5/mo) if voice quality becomes a selling point
- **Convex paid** ($25/mo) if storage exceeds 1GB or function calls exceed free tier
- **Railway scale-up** if job queue becomes a bottleneck

---

## Key Decisions Explained

**Why Gemini over Claude/GPT?**
Gemini 2.0 Flash has a generous free tier (1,500 req/day) — script generation
costs $0 at MVP scale. The structured JSON output (`response_mime_type`) makes
parsing reliable. Easy to swap models later by changing one line in `scriptgen.py`.

**Why edge-tts over ElevenLabs?**
Free, no API key, 400+ voices, quality is good enough for MVP demos.
Easy to swap later: just change `tts.py`.

**Why FFmpeg over Remotion/Creatomate?**
Remotion Lambda costs $0.003/min rendered; 100 videos × 60s = ~$18/month.
FFmpeg runs on the worker VM for free. The trade-off is the editor is
scene-based (not frame-level) which is fine for promo videos.

**Why separate Python worker?**
Playwright + FFmpeg + ML libraries are too heavy for Vercel serverless functions
(250MB limit, 30s timeout). A persistent Python service handles long jobs
cleanly and can be scaled independently.

**Why not use a video API (Shotstack, Creatomate)?**
Both cost $0.05–$0.20 per render. At scale that becomes significant. FFmpeg
gives full control for free and the worker already needs to run Python for
scraping anyway.

**Why not store video on Cloudflare R2?**
Convex storage is already wired and free up to 1GB. Switch to R2 ($0.015/GB)
only if storage becomes a cost concern at scale.
