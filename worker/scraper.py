import asyncio
import os
from dataclasses import dataclass, field

from playwright.async_api import async_playwright

_DISABLE_ANIMATIONS_CSS = """
*, *::before, *::after {
  animation-duration:   0.001ms !important;
  animation-delay:      0.001ms !important;
  transition-duration:  0.001ms !important;
  transition-delay:     0.001ms !important;
  scroll-behavior:      auto !important;
}
"""

_HIDE_OVERLAYS_JS = """() => {
  const patterns = [
    'cookie','consent','gdpr','onetrust','cookielaw',
    'popup','banner','modal','overlay','intercom',
    'chat-widget','chat_widget','helpscout','drift',
    'crisp','tawk','freshchat','hubspot','zendesk',
    'notification','announcement','toast','alert',
    'newsletter','subscribe',
  ];
  document.querySelectorAll('*').forEach(el => {
    const id = (el.id || '').toLowerCase();
    const cls = (el.className && typeof el.className === 'string')
      ? el.className.toLowerCase() : '';
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (patterns.some(p => id.includes(p) || cls.includes(p)) ||
        role === 'dialog' || role === 'alertdialog') {
      el.style.setProperty('display','none','important');
      el.style.setProperty('visibility','hidden','important');
      el.style.setProperty('opacity','0','important');
    }
  });
}"""

_WAIT_FOR_IMAGES_JS = """() =>
  Array.from(document.images).every(img => img.complete && img.naturalWidth > 0)
"""


@dataclass
class ScrapedPage:
    title: str
    description: str
    body_text: str
    screenshot_paths: list[str] = field(default_factory=list)


async def scrape(url: str, tmp_dir: str) -> ScrapedPage:
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(
            viewport={"width": 1440, "height": 900},
            extra_http_headers={
                "Accept-Language": "en-US,en;q=0.9",
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
            },
        )

        try:
            await page.goto(url, wait_until="networkidle", timeout=35_000)
        except Exception:
            await page.goto(url, wait_until="domcontentloaded", timeout=35_000)

        # Freeze all animations immediately
        await page.add_style_tag(content=_DISABLE_ANIMATIONS_CSS)
        await page.evaluate(_HIDE_OVERLAYS_JS)

        # Wait for images to load
        try:
            await page.wait_for_function(_WAIT_FOR_IMAGES_JS, timeout=8_000)
        except Exception:
            pass

        # Settle time for initial render / hero animations
        await asyncio.sleep(1.5)

        # Re-run overlay hiding (some load dynamically after JS runs)
        await page.evaluate(_HIDE_OVERLAYS_JS)

        title = await page.title()
        description = await page.evaluate("""() => {
            const m = document.querySelector('meta[name="description"]') ||
                      document.querySelector('meta[property="og:description"]');
            return m ? m.getAttribute('content') : '';
        }""")

        body_text = await page.evaluate("""() => {
            ['script','style','nav','footer','header','aside','iframe','noscript']
                .forEach(t => document.querySelectorAll(t).forEach(el => el.remove()));
            return (document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 2000);
        }""")

        screenshots: list[str] = []

        # Hero screenshot (top of page)
        await page.evaluate("window.scrollTo(0, 0)")
        await asyncio.sleep(0.8)
        p0 = os.path.join(tmp_dir, "screen_0.png")
        await page.screenshot(path=p0, full_page=False)
        screenshots.append(p0)

        # Section screenshots at 25%, 50%, 75% scroll depth
        total_h: int = await page.evaluate("document.body.scrollHeight")
        for i, pct in enumerate([0.25, 0.5, 0.75]):
            target_y = int(total_h * pct)
            await page.evaluate(f"window.scrollTo(0, {target_y})")
            # Wait for scroll-triggered animations and lazy images to settle
            await asyncio.sleep(1.2)
            try:
                await page.wait_for_function(_WAIT_FOR_IMAGES_JS, timeout=4_000)
            except Exception:
                pass
            await page.evaluate(_HIDE_OVERLAYS_JS)
            path = os.path.join(tmp_dir, f"screen_{i + 1}.png")
            await page.screenshot(path=path, full_page=False)
            screenshots.append(path)

        await browser.close()

        return ScrapedPage(
            title=title or url,
            description=description or "",
            body_text=body_text,
            screenshot_paths=screenshots,
        )
