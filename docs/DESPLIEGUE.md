# Despliegue

CaptionLive es **un solo servicio** (imagen Docker o paquete Python) + **Redis opcional**.
No hay build de frontend, servidores de medios ni GPUs (salvo en modo local).

## Requisitos

- API key de Gemini ([Google AI Studio](https://aistudio.google.com/apikey)) → `GEMINI_API_KEY`.
  Alternativa empresarial: Vertex AI con `GOOGLE_GENAI_USE_VERTEXAI=true`,
  `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` y credenciales de servicio.
- HTTPS en producción (el navegador exige contexto seguro para usar el micrófono en `/stage`).

## 1. Local (desarrollo)

```bash
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
export GEMINI_API_KEY=... CL_ADMIN_TOKEN=secret
captionlive serve                 # http://localhost:8000
```

Sin API key: `CL_ASR_PROVIDER=mock CL_MT_PROVIDER=mock captionlive serve`.

## 2. Docker Compose (una VM, varias réplicas)

```bash
cp .env.example .env              # completar GEMINI_API_KEY y CL_ADMIN_TOKEN
docker compose up -d --build      # 2 réplicas + Redis + nginx → http://localhost:8080
docker compose up -d --scale app=4   # más réplicas
```

`deploy/nginx.conf` ya tiene la configuración correcta para WebSocket (ingesta) y SSE
(sin buffering, timeouts de 1 h). Poné delante tu terminador TLS (Caddy, Traefik, un LB).

## 3. Google Cloud Run (recomendado para el evento)

```bash
export PROJECT=mi-proyecto GEMINI_API_KEY=... CL_ADMIN_TOKEN=...
./deploy/cloudrun.sh
```

- Crea los secretos en Secret Manager, despliega desde el código fuente con timeouts de
  60 min (WebSocket/SSE), `--no-cpu-throttling` y `min-instances=1` (sin arranques en frío
  durante las charlas), y configura `CL_PUBLIC_URL`.
- **Una instancia** (broker en memoria) alcanza para decenas de salas y cientos/miles de
  espectadores. Para más, creá un **Memorystore for Redis** + conector VPC y pasá
  `REDIS_URL=redis://IP:6379/0 VPC_CONNECTOR=mi-conector MAX_INSTANCES=10`.
- Las conexiones duran como máximo 60 min en Cloud Run: el navegador y `captionlive ingest`
  se reconectan solos y la audiencia reanuda sin perder subtítulos (`Last-Event-ID`).

## 4. Kubernetes

```bash
kubectl create secret generic captionlive \
  --from-literal=GEMINI_API_KEY=... --from-literal=CL_ADMIN_TOKEN=...
kubectl apply -f deploy/kubernetes.yaml    # Redis + 3 réplicas + Service
```

Exponé el Service con tu Ingress asegurando timeouts largos y sin buffering para
`/api/sessions/*/stream` (p. ej. `nginx.ingress.kubernetes.io/proxy-buffering: "off"`,
`proxy-read-timeout: "3600"`). Métricas en `:8000/metrics` (anotaciones Prometheus incluidas).

## 5. 100 % local (sin nube): Whisper + Gemma

```bash
pip install -e ".[local]"                   # faster-whisper
ollama pull gemma3:4b                       # o gemma3:12b con más GPU
export CL_ASR_PROVIDER=whisper CL_WHISPER_MODEL=small \
       CL_MT_PROVIDER=openai CL_OPENAI_BASE_URL=http://localhost:11434/v1 CL_OPENAI_MODEL=gemma3:4b
captionlive serve
```

- `CL_WHISPER_MODEL`: `small` (CPU, pocas salas), `medium`/`large-v3` (GPU, mejor calidad).
- Cualquier servidor OpenAI-compatible sirve para traducir: Ollama, vLLM, llama.cpp, LM Studio.
- Se puede mezclar: ASR en Gemini y traducción local (o al revés).

## Referencia de configuración

Todas las variables llevan el prefijo `CL_` (también se leen de un archivo `.env`).

| Variable | Default | Descripción |
|---|---|---|
| `CL_ADMIN_TOKEN` | `change-me` | Token del panel/API de administración. **Cambialo.** |
| `CL_PUBLIC_URL` | — | URL pública (QR y enlaces del panel) |
| `CL_HOST` / `CL_PORT` | `0.0.0.0` / `8000` | Bind del servidor (`PORT` en la imagen Docker) |
| `CL_CORS_ORIGINS` | `["*"]` | Orígenes permitidos (JSON) |
| `CL_BROKER` | `memory` | `memory` (1 proceso) o `redis` (N réplicas/workers) |
| `CL_REDIS_URL` | `redis://localhost:6379/0` | Conexión Redis |
| `CL_HISTORY_SIZE` | `2000` | Subtítulos guardados por sesión e idioma |
| `CL_SESSIONS_FILE` | — | YAML con sesiones a crear al iniciar |
| `CL_ASR_PROVIDER` | `gemini` | `gemini`, `whisper`, `mock` |
| `GEMINI_API_KEY` / `CL_GEMINI_API_KEY` | — | API key de Gemini |
| `CL_GEMINI_ASR_MODEL` | `gemini-3.5-transcribe-live` | Modelo Live de transcripción |
| `CL_GEMINI_ASR_ROTATE_SECONDS` | `540` | Rotación preventiva de la conexión Live |
| `CL_GEMINI_ASR_SMART_MODE` | `false` | Modo SMART (quita muletillas; algo más de latencia) |
| `CL_WHISPER_MODEL` / `CL_WHISPER_DEVICE` | `small` / `auto` | Modo local |
| `CL_MT_PROVIDER` | `gemini` | `gemini`, `openai`, `mock`, `none` |
| `CL_GEMINI_MT_MODEL` | `gemini-2.5-flash-lite` | Modelo de traducción |
| `CL_OPENAI_BASE_URL` / `CL_OPENAI_MODEL` / `CL_OPENAI_API_KEY` | Ollama / `gemma3:4b` / `ollama` | Traducción OpenAI-compatible |
| `CL_MT_CONTEXT_SEGMENTS` | `3` | Oraciones previas enviadas como contexto |
| `CL_MT_TIMEOUT_SECONDS` | `8` | Luego se muestra el original (fallback) |
| `CL_EARLY_COMMIT` | `true` | Traducir oraciones estables sin esperar la pausa |
| `CL_ASR_COST_PER_MINUTE` / `CL_MT_COST_PER_1K_CHARS` | `0.009` / `0.0001` | Estimación de costos del panel |

## Operación y checklist de producción

- [ ] `CL_ADMIN_TOKEN` largo y secreto; claves de ingesta rotadas si se filtraron.
- [ ] HTTPS; `CL_PUBLIC_URL` configurado; QR impresos.
- [ ] Cuota de la API de Gemini acorde a salas × idiomas (ver ARQUITECTURA §6).
- [ ] `min-instances ≥ 1` y sin throttling de CPU.
- [ ] Prometheus/Grafana (opcional) scrapeando `/metrics`; alertas sobre
      `captionlive_mt_errors_total` y `captionlive_first_caption_seconds`.
- [ ] Ensayo en cada sala con el panel abierto.
