import json
import os
import re

from google import genai
from google.genai import types

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    return _client


def generate_script(title: str, description: str, body_text: str) -> list[dict]:
    prompt = f"""You are a video scriptwriter. Given website content, write a short promotional video script.

Return a JSON array of 5 to 8 scenes. Each scene must have exactly these fields:
  "order": integer starting at 0
  "narration": spoken narration, 10-20 words, compelling and natural-sounding
  "caption": short text overlay, 4-6 words
  "duration_ms": integer milliseconds to show this scene, between 3000 and 6000

Website title: {title}
Description: {description}
Content: {body_text[:1500]}

Return ONLY the JSON array. No markdown fences, no explanation."""

    client = _get_client()
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
        ),
    )

    text = response.text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    # Remove trailing commas before ] or } (common Gemini quirk)
    text = re.sub(r",\s*([}\]])", r"\1", text)

    try:
        scenes = json.loads(text)
    except json.JSONDecodeError:
        # Extract the first JSON array found in the response
        m = re.search(r"\[.*\]", text, re.DOTALL)
        if not m:
            raise ValueError(f"No JSON array found in Gemini response:\n{text[:500]}")
        scenes = json.loads(re.sub(r",\s*([}\]])", r"\1", m.group()))

    result = []
    for i, s in enumerate(scenes):
        result.append({
            "order": i,
            "narration": str(s.get("narration", "")).strip(),
            "caption": str(s.get("caption", "")).strip(),
            "duration_ms": max(2000, min(8000, int(s.get("duration_ms", 4000)))),
        })

    return result
