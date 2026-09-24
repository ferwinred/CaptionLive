# API

Documentación interactiva (OpenAPI) en `/docs` del servidor.

## Modelo de eventos

```json
{
  "type": "final",            // "interim" | "final" | "status"
  "session": "main-stage",
  "lang": "es",               // "source" (idioma original) o código BCP-47; "*" en status
  "text": "Los operadores de Kubernetes son geniales.",
  "seq": 40,                  // correlativo por sesión+idioma (solo finales)
  "segment": 41,              // id de oración, compartido entre idiomas
  "source_lang": "en",
  "ts": 1790280856.81,        // epoch (s)
  "latency_ms": 420,          // traducción: confirmación → publicación
  "data": {"fallback": true}  // traducción falló: se muestra el original
}
```

- `interim`: solo idioma original; **reemplaza** la línea en curso (texto vacío = limpiar).
- `final`: texto confirmado; se guarda en el historial.
- `status`: `data` = `{live, level_db, audio_seconds, first_caption_ms, translation_ms,
  asr_errors, mt_errors, asr_reconnects, last_error, est_cost_usd, ...}`.

## Audiencia (público)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/sessions` | Sesiones con estado (`status.live`) e idiomas |
| GET | `/api/sessions/{id}` | Una sesión |
| GET | `/api/sessions/{id}/stream?langs=es,source&backlog=30` | **SSE** en vivo |
| GET | `/api/sessions/{id}/history?lang=es&after=0&limit=200` | Finales guardados |
| GET | `/api/sessions/{id}/transcript.{txt\|srt\|vtt}?lang=es` | Exportación |
| GET | `/api/sessions/{id}/now.{txt\|json}?lang=es&lines=2` | Últimas líneas (vMix/OBS) |
| GET | `/api/sessions/{id}/qr.svg?lang=es` | QR a la vista de audiencia |
| POST | `/api/sessions/{id}/summary?lang=es` | Resumen IA (cache 60 s) |
| GET | `/api/health` · `/api/config` · `/metrics` | Salud, config pública, Prometheus |

### SSE

```
GET /api/sessions/main-stage/stream?langs=es,source

retry: 2000

event: status
data: {"type":"status","lang":"*","data":{"live":true,...}}

event: final
id: es=40,source=41
data: {"type":"final","lang":"es","seq":40,...}

event: interim
data: {"type":"interim","lang":"source","text":"They also",...}

: ping
```

- Al conectar se envían los últimos `backlog` finales de cada idioma pedido.
- El `id` acumula el último `seq` de cada idioma; al reconectar, el navegador envía
  `Last-Event-ID` y el servidor reenvía **solo lo que faltó** (sin duplicados ni huecos).
- Cliente mínimo:

```js
const es = new EventSource("/api/sessions/main-stage/stream?langs=es");
es.addEventListener("final", (e) => console.log(JSON.parse(e.data).text));
```

## Ingesta de audio (WebSocket)

```
wss://host/ws/ingest/{id}?key=<ingest_key>&rate=16000[&takeover=1]
```

- Frames **binarios**: PCM 16 bits little-endian, **mono**, a `rate` Hz (se remuestrea a
  16 kHz en el servidor). Recomendado: bloques de 100 ms.
- Frame de texto opcional para cambiar la frecuencia: `{"type":"config","rate":48000}`.
- El servidor responde `{"type":"ready"}` y luego `{"type":"status", ...}` cada segundo.
- Códigos de cierre: `4401` clave o sesión inválida · `4409` ya hay otra fuente
  transmitiendo (usar `takeover=1` para reemplazarla).

Ejemplo con `ffmpeg` + `websocat`:

```bash
ffmpeg -re -i charla.mp4 -ac 1 -ar 16000 -f s16le - | \
  websocat --binary "ws://localhost:8000/ws/ingest/main-stage?key=KEY&rate=16000"
```

(o, más simple, `captionlive ingest --input charla.mp4 ...`).

## Administración (`Authorization: Bearer <CL_ADMIN_TOKEN>` o `?token=`)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/admin/sessions` | Sesiones con clave de ingesta y estado |
| POST | `/api/admin/sessions` | Crear/actualizar (conserva la clave) |
| DELETE | `/api/admin/sessions/{id}` | Eliminar sesión e historial |
| POST | `/api/admin/sessions/{id}/clear` | Borrar la transcripción (entre charlas) |
| POST | `/api/admin/sessions/{id}/rotate-key` | Nueva clave de ingesta |

```bash
curl -X POST https://host/api/admin/sessions -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{
    "id": "sala-2", "title": "eBPF en producción", "speaker": "Grace Hopper",
    "source_lang": "en", "target_langs": ["es", "pt"],
    "glossary": ["eBPF", "Cilium", "XDP", "kernel"]
  }'
```
