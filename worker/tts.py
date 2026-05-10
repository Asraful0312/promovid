import asyncio

import edge_tts

DEFAULT_VOICE = "en-US-AriaNeural"

VOICES = {
    "en-US-AriaNeural": "Aria (US Female)",
    "en-US-GuyNeural": "Guy (US Male)",
    "en-GB-SoniaNeural": "Sonia (UK Female)",
    "en-AU-NatashaNeural": "Natasha (AU Female)",
}


async def synthesize(text: str, out_path: str, voice: str = DEFAULT_VOICE) -> None:
    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(out_path)


def synthesize_sync(text: str, out_path: str, voice: str = DEFAULT_VOICE) -> None:
    asyncio.run(synthesize(text, out_path, voice))
