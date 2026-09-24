"""PCM helpers. All audio inside CaptionLive is 16-bit little-endian mono PCM."""

from __future__ import annotations

import math

import numpy as np


def pcm16_to_float(data: bytes) -> np.ndarray:
    if len(data) % 2:
        data = data[:-1]
    return np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768.0


def float_to_pcm16(samples: np.ndarray) -> bytes:
    clipped = np.clip(samples, -1.0, 1.0)
    return (clipped * 32767.0).astype("<i2").tobytes()


def resample_pcm16(data: bytes, src_rate: int, dst_rate: int) -> bytes:
    """Linear-interpolation resampler; good enough for speech going into ASR."""
    if src_rate == dst_rate or not data:
        return data
    samples = pcm16_to_float(data)
    if samples.size == 0:
        return b""
    duration = samples.size / src_rate
    n_out = max(1, round(duration * dst_rate))
    x_old = np.linspace(0.0, duration, num=samples.size, endpoint=False)
    x_new = np.linspace(0.0, duration, num=n_out, endpoint=False)
    return float_to_pcm16(np.interp(x_new, x_old, samples).astype(np.float32))


def level_dbfs(data: bytes) -> float:
    """RMS level in dBFS (0 = full scale, -90 = silence). Used for VU meters / VAD."""
    samples = pcm16_to_float(data)
    if samples.size == 0:
        return -90.0
    rms = float(np.sqrt(np.mean(samples * samples)))
    if rms <= 1e-9:
        return -90.0
    return max(-90.0, 20.0 * math.log10(rms))


def duration_seconds(data: bytes, rate: int) -> float:
    return len(data) / 2 / rate
