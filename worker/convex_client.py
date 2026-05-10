import hashlib
import hmac
import json
import time

import httpx


class ConvexWorkerClient:
    def __init__(self, site_url: str, secret: str):
        self.site_url = site_url.rstrip("/")
        self.secret = secret
        self._client = httpx.AsyncClient(timeout=120.0)

    def _sign(self, body: str) -> dict:
        ts = str(int(time.time() * 1000))
        msg = f"{ts}.{body}".encode()
        sig = hmac.new(self.secret.encode(), msg, hashlib.sha256).hexdigest()
        return {
            "X-Worker-Timestamp": ts,
            "X-Worker-Signature": sig,
            "Content-Type": "application/json",
        }

    async def issue_upload(self, render_id: str) -> str:
        body = json.dumps({"renderId": render_id})
        resp = await self._client.post(
            f"{self.site_url}/worker/issue-upload",
            content=body,
            headers=self._sign(body),
        )
        resp.raise_for_status()
        return resp.json()["uploadUrl"]

    async def upload_file(self, upload_url: str, path: str, content_type: str = "video/mp4") -> str:
        with open(path, "rb") as f:
            data = f.read()
        resp = await self._client.post(
            upload_url,
            content=data,
            headers={"Content-Type": content_type},
        )
        resp.raise_for_status()
        return resp.json()["storageId"]

    async def complete(self, render_id: str, clips: list) -> None:
        body = json.dumps({
            "renderId": render_id,
            "clips": clips,
        })
        resp = await self._client.post(
            f"{self.site_url}/worker/complete",
            content=body,
            headers=self._sign(body),
        )
        resp.raise_for_status()

    async def fail(self, render_id: str, error: str) -> None:
        body = json.dumps({"renderId": render_id, "error": error[:2000]})
        resp = await self._client.post(
            f"{self.site_url}/worker/fail",
            content=body,
            headers=self._sign(body),
        )
        resp.raise_for_status()

    async def aclose(self):
        await self._client.aclose()
