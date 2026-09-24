import math

import numpy as np
import pytest

from captionlive.config import Settings

RATE = 16000


def tone(seconds: float, rate: int = RATE, freq: float = 220.0, amp: float = 0.3) -> bytes:
    t = np.arange(int(seconds * rate)) / rate
    return (amp * np.sin(2 * math.pi * freq * t) * 32767).astype("<i2").tobytes()


def silence(seconds: float, rate: int = RATE) -> bytes:
    return b"\x00\x00" * int(seconds * rate)


def chunks(data: bytes, ms: int = 100, rate: int = RATE):
    size = rate * 2 * ms // 1000
    for i in range(0, len(data), size):
        yield data[i : i + size]


@pytest.fixture
def settings() -> Settings:
    return Settings(
        asr_provider="mock",
        mt_provider="mock",
        broker="memory",
        admin_token="test-token",
        mt_timeout_seconds=2.0,
        _env_file=None,
    )
