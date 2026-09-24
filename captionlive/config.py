"""Runtime configuration. Every setting can be overridden with a ``CL_`` env var."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CL_", env_file=".env", extra="ignore")

    # --- HTTP ---------------------------------------------------------------
    host: str = "0.0.0.0"
    port: int = 8000
    public_url: str = ""  # e.g. https://captions.nerdearla.com (used for QR codes)
    admin_token: str = "change-me"  # protects /api/admin/* and the operator UI
    # New sessions get an ingest key derived from this secret (default: the admin token), so
    # stage links survive restarts even without Redis (e.g. Cloud Run scaling to zero).
    ingest_secret: str = ""
    cors_origins: list[str] = Field(default_factory=lambda: ["*"])

    # --- State / fan-out ----------------------------------------------------
    # "memory" = single process (dev, small events). "redis" = horizontal scaling.
    broker: Literal["memory", "redis"] = "memory"
    redis_url: str = "redis://localhost:6379/0"
    history_size: int = 2000  # final captions kept per session+language (export/late joiners)
    sessions_file: str = ""  # optional YAML with sessions to bootstrap on start-up

    # --- Speech recognition (ASR) -------------------------------------------
    asr_provider: Literal["gemini", "whisper", "mock"] = "gemini"
    gemini_api_key: str = ""  # falls back to GEMINI_API_KEY / GOOGLE_API_KEY
    gemini_asr_model: str = "gemini-3.5-transcribe-live"
    # Live sessions are capped (10 min for transcribe-live). We rotate before the cap,
    # overlapping the old and new connections so no audio is lost.
    gemini_asr_rotate_seconds: float = 540.0
    gemini_asr_smart_mode: bool = False  # SMART = removes filler words ("eh", "um")
    whisper_model: str = "small"  # faster-whisper model for 100% local mode
    whisper_device: str = "auto"

    # --- Translation (MT) ---------------------------------------------------
    mt_provider: Literal["gemini", "openai", "mock", "none"] = "gemini"
    gemini_mt_model: str = "gemini-2.5-flash-lite"
    # OpenAI-compatible endpoint: Ollama (Gemma), vLLM, llama.cpp server, LM Studio...
    openai_base_url: str = "http://localhost:11434/v1"
    openai_api_key: str = "ollama"
    openai_model: str = "gemma3:4b"
    mt_context_segments: int = 3  # previous sentences sent as context for coherence
    mt_timeout_seconds: float = 8.0
    # Translate a sentence as soon as it is stable in the interim hypothesis,
    # instead of waiting for the speaker to pause (lower latency).
    early_commit: bool = True

    # --- Audio ----------------------------------------------------------------
    sample_rate: int = 16000  # what the ASR expects; ingest is resampled to this

    # --- Cost estimation (USD, shown in the operator dashboard) -------------
    asr_cost_per_minute: float = 0.009
    mt_cost_per_1k_chars: float = 0.0001


@lru_cache
def get_settings() -> Settings:
    return Settings()
