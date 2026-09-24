"""Prometheus metrics (exposed at ``/metrics``)."""

from prometheus_client import Counter, Gauge, Histogram

LATENCY_BUCKETS = (0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 8, 13)

ACTIVE_INGESTS = Gauge("captionlive_active_ingests", "Stages currently streaming audio")
AUDIENCE = Gauge("captionlive_audience_connections", "Open audience connections on this node")
AUDIO_SECONDS = Counter("captionlive_audio_seconds_total", "Audio processed", ["session"])
CAPTIONS = Counter("captionlive_captions_total", "Final captions published", ["session", "lang"])
MT_CHARS = Counter("captionlive_mt_characters_total", "Characters sent to translation")
MT_ERRORS = Counter("captionlive_mt_errors_total", "Failed / timed out translations")
ASR_RECONNECTS = Counter("captionlive_asr_reconnects_total", "ASR connection rotations/retries")
FIRST_CAPTION = Histogram(
    "captionlive_first_caption_seconds",
    "Speech onset -> first on-screen caption (interim)",
    buckets=LATENCY_BUCKETS,
)
MT_LATENCY = Histogram(
    "captionlive_translation_seconds",
    "Committed source text -> translated caption published",
    buckets=LATENCY_BUCKETS,
)
