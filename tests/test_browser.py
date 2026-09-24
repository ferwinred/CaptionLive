"""Browser end-to-end: fake microphone -> stage page (AudioWorklet) -> server -> audience page.

Runs only when Playwright + Chromium are available (``pip install playwright``).
Set ``CL_TEST_CHROMIUM`` to use a specific Chromium binary.
"""

import os

import pytest

from .test_e2e import Server, make_session

playwright = pytest.importorskip("playwright.async_api")
CHROMIUM = os.environ.get("CL_TEST_CHROMIUM") or (
    "/opt/pw-browsers/chromium" if os.path.exists("/opt/pw-browsers/chromium") else None
)
FAKE_MIC = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]


async def test_stage_to_audience_in_real_browser(settings):
    async with Server(settings) as srv, playwright.async_playwright() as p:
        key = await make_session(srv.base)
        try:
            browser = await p.chromium.launch(executable_path=CHROMIUM, args=FAKE_MIC)
        except Exception as exc:  # noqa: BLE001
            pytest.skip(f"chromium not available: {exc}")
        errors = []
        page_stage = await browser.new_page()
        page_stage.on("pageerror", lambda e: errors.append(str(e)))
        await page_stage.goto(f"{srv.base}/stage?session=main&key={key}")
        audience = await browser.new_page()
        audience.on("pageerror", lambda e: errors.append(str(e)))
        await audience.goto(f"{srv.base}/?session=main&lang=es")

        await page_stage.click("#start")
        await page_stage.wait_for_function(
            "document.querySelector('#state').textContent.includes('Transmitiendo')"
        )
        await audience.wait_for_function(
            "document.querySelectorAll('#captions p:not(.interim)').length >= 1", timeout=20000
        )
        text = await audience.inner_text("#captions")
        assert text.startswith("[es] Welcome to Nerdearla")
        assert await audience.is_visible("#live")

        overlay = await browser.new_page()
        await overlay.goto(f"{srv.base}/overlay?session=main&lang=es&lines=1")
        await overlay.wait_for_function("document.querySelector('#box').innerText.length > 0")
        assert (await overlay.inner_text("#box")).startswith("[es]")

        admin = await browser.new_page()
        await admin.goto(f"{srv.base}/admin")
        await admin.fill("#token", "test-token")
        await admin.click("#enter")
        await admin.wait_for_selector("#rows .badge.live", timeout=5000)

        await page_stage.click("#stop")
        assert errors == []
        await browser.close()
