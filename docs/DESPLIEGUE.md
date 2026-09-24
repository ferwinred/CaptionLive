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

## 3. Google Cloud Run con los créditos de Google (recomendado)

**Paso 0: créditos y proyecto (una sola vez, ~5 min)**

1. Canjeá los créditos de Google Developers Platform en una **cuenta de facturación** de
   Google Cloud (el mail de la Vibeathon trae el enlace).
2. Creá un proyecto (<https://console.cloud.google.com/projectcreate>) y **vinculalo a esa
   cuenta de facturación**, así Cloud Run y Gemini se descuentan de los créditos.
3. Creá la API key de Gemini **en ese mismo proyecto**: <https://aistudio.google.com/apikey>
   → *Create API key* → elegir el proyecto.

**Paso 1: desplegar desde Cloud Shell (gratis, ya trae `gcloud`)**

Abrí <https://shell.cloud.google.com> y ejecutá:

```bash
gcloud config set project TU_PROYECTO
git clone https://github.com/ferwinred/CaptionLive && cd CaptionLive
./deploy/cloudrun.sh            # pide la API key de Gemini y genera el token de admin
```

El script habilita las APIs, guarda los secretos en Secret Manager, construye la imagen,
despliega en `southamerica-east1` (São Paulo, cerca de Buenos Aires) e imprime:

- la URL del backend (`https://captionlive-xxxx.run.app`) y el **token de admin**;
- los enlaces a la web en GitHub Pages ya conectada al backend (`...github.io/CaptionLive/?api=...`).

**Paso 2 (opcional): dejar Pages apuntando siempre al backend.** En GitHub: *Settings →
Secrets and variables → Actions → Variables → New variable* `CAPTIONLIVE_API_URL` = URL del
backend, y luego *Actions → Deploy web to GitHub Pages → Run workflow*. Los QR que genera el
backend ya incluyen `?api=` automáticamente.

**Cómo cuida los créditos**

| Modo | Comando | Costo aproximado |
|---|---|---|
| Fuera del evento | `./deploy/cloudrun.sh` | Escala a cero: ~US$ 0 sin uso; se paga solo mientras hay audio o espectadores conectados |
| Día del evento | `EVENT_MODE=1 ./deploy/cloudrun.sh` | 1 instancia siempre lista (sin arranque en frío): ~US$ 1–2 por día |
| Gemini | — | ≈ US$ 0,60 por hora de charla por sala (original + 2 idiomas) |

Los US$ 25 alcanzan para ~40 horas de charla subtitulada. Configurá una **alerta de
presupuesto** en *Billing → Budgets & alerts* (por ejemplo al 50 % y 90 %).

**Notas**

- Sin Redis corre una sola instancia (suficiente para decenas de salas). Las sesiones del
  YAML se recrean al iniciar y las **claves de ingesta son estables** (derivadas del token de
  admin), así que los enlaces de escenario no cambian aunque el servicio se reinicie. Las
  sesiones creadas desde el panel se pierden si la instancia escala a cero: para el evento
  usá `EVENT_MODE=1`, o agregá un Redis gratuito (p. ej. Upstash) con
  `REDIS_URL=rediss://... ./deploy/cloudrun.sh`.
- Las conexiones de Cloud Run duran hasta 60 min; el escenario y la audiencia se reconectan
  solos sin perder subtítulos.
- Para actualizar después de cambios en el código: `git pull && ./deploy/cloudrun.sh`.

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

## 6. Front estático (GitHub Pages / Vercel / Netlify) + backend aparte

La web (audiencia, escenario, panel, overlay) también se puede publicar como sitio estático:

```bash
python scripts/build_static.py --out site                                   # modo demo
python scripts/build_static.py --out site --api https://captions.example.org  # con backend
```

- **Sin backend** el sitio corre en **modo demo**: simula 3 salas en vivo en el navegador
  (sincronizadas por reloj entre dispositivos), con panel, overlay, exportación y resumen.
- **Con backend**: `?api=https://tu-backend` en cualquier URL (se recuerda en el navegador) o el
  botón *Conectar a un servidor…*. El backend ya permite CORS (`CL_CORS_ORIGINS`).
- **GitHub Pages**: el workflow `.github/workflows/pages.yml` construye y publica en la rama
  `gh-pages` (activar en *Settings → Pages → Deploy from a branch → gh-pages*). La variable del
  repositorio `CAPTIONLIVE_API_URL` fija el backend por defecto.
- **Vercel**: importar el repositorio; `vercel.json` ya define el build y la carpeta de salida.

El **backend no puede correr en Pages ni en funciones serverless** (Vercel/Netlify): necesita
conexiones largas (WebSocket de audio de hasta horas, SSE) y un proceso vivo por sala.
Opciones recomendadas:

| Plataforma | Por qué | Notas |
|---|---|---|
| **Google Cloud Run** (recomendado, ver §3) | Usa los créditos de Google; WebSocket/SSE; escala a cero fuera del evento; `deploy/cloudrun.sh` | Conexiones de hasta 60 min (se reconectan solas) |
| **Railway** | `railway.json` incluido (Dockerfile + healthcheck). Variables: `GEMINI_API_KEY`, `CL_ADMIN_TOKEN`, `CL_SESSIONS_FILE=examples/sessions.yaml`, `CL_PUBLIC_URL` | ~US$ 5/mes (plan Hobby); WebSocket OK |
| **Render** / **Koyeb** | Deploy desde el repo con el `Dockerfile`, WebSocket OK | Los planes gratis se duermen: usar plan pago el día del evento |
| **Fly.io** | Contenedores cerca de la audiencia (región `gru`/`eze`), WebSocket OK | `fly launch` detecta el Dockerfile |
| **Hugging Face Spaces (Docker)** | Gratis para demos | Puerto 7860 (`PORT=7860`), se duerme |
| **VM** (e2-small, Droplet, Lightsail) | `docker compose up -d` con Redis y nginx | Control total, costo fijo bajo |

## Referencia de configuración

Todas las variables llevan el prefijo `CL_` (también se leen de un archivo `.env`).

| Variable | Default | Descripción |
|---|---|---|
| `CL_ADMIN_TOKEN` | `change-me` | Token del panel/API de administración. **Cambialo.** |
| `CL_INGEST_SECRET` | = admin token | Secreto del que se derivan claves de ingesta estables |
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
