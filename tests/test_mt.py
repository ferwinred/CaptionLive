import json

import httpx

from captionlive.mt.base import build_prompt, clean_output
from captionlive.mt.gemini import GeminiTranslator
from captionlive.mt.openai_compat import OpenAICompatTranslator


def test_prompt_contains_glossary_context_and_target():
    system, user = build_prompt("It uses eBPF.", "en", "es", ["We talk about Linux."], ["eBPF"])
    assert "Español" in system
    assert "GLOSSARY" in user and "eBPF" in user
    assert "CONTEXT" in user and "We talk about Linux." in user
    assert user.rstrip().endswith("It uses eBPF.")
    _, user2 = build_prompt("x", "auto", "pt", [], [])
    assert "GLOSSARY" not in user2 and "CONTEXT" not in user2 and "auto-detected" in user2


def test_clean_output():
    assert clean_output('  "Hola mundo"  ') == "Hola mundo"
    assert clean_output("Translation: Hola\n mundo") == "Hola mundo"
    assert clean_output("«Hola»") == "«Hola»"  # different open/close chars are kept


async def test_openai_compatible(settings):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.content)
        seen["auth"] = request.headers["authorization"]
        return httpx.Response(200, json={"choices": [{"message": {"content": " Hola mundo. "}}]})

    settings.openai_model = "gemma3:4b"
    tr = OpenAICompatTranslator(settings, transport=httpx.MockTransport(handler))
    out = await tr.translate("Hello world.", "en", "es", [], ["Nerdearla"])
    await tr.close()
    assert out == "Hola mundo."
    assert seen["url"].endswith("/v1/chat/completions")
    assert seen["body"]["model"] == "gemma3:4b"
    assert seen["body"]["messages"][0]["role"] == "system"
    assert "Nerdearla" in seen["body"]["messages"][1]["content"]
    assert seen["auth"] == "Bearer ollama"


class FakeModels:
    def __init__(self):
        self.calls = []

    async def generate_content(self, model, contents, config):
        self.calls.append((model, contents, config))

        class R:
            text = "Hola a todos."

        return R()


class FakeGenai:
    def __init__(self):
        self.models = FakeModels()

        class Aio:
            pass

        self.aio = Aio()
        self.aio.models = self.models


async def test_gemini_translator(settings):
    client = FakeGenai()
    tr = GeminiTranslator(settings, client=client)
    assert await tr.translate("Hello everyone.", "en", "es") == "Hola a todos."
    model, contents, config = client.models.calls[0]
    assert model == "gemini-2.5-flash-lite"
    assert "Hello everyone." in contents
    assert config.thinking_config.thinking_budget == 0
    assert config.temperature == 0.2
    assert "Español" in config.system_instruction
