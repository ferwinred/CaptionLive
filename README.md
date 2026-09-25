# CaptionLive

**Subtítulos en vivo, multilingües y open source para conferencias a escala.**

CaptionLive toma el audio de cada escenario y publica, en tiempo real, subtítulos en el
idioma original y traducidos (español, inglés, portugués y más) para muchas sesiones en
paralelo. La audiencia los sigue desde el celular (escaneando un QR), en la pantalla de la
sala o "quemados" en el stream vía OBS/vMix.

Construido para la **Vibeathon de Nerdearla 2026** sobre las capacidades de audio de
**Gemini**, con un modo **100 % local** (Whisper + **Gemma**) para eventos sin nube.

```
 🎙️ Escenario ──audio──▶ CaptionLive ──subtítulos──▶ 📱 Audiencia (web)
   (navegador,            ASR Gemini Live            🖥️ Pantalla de sala
    consola, SRT/RTMP)    + traducción Gemini        🎬 OBS / vMix (overlay)
                          + Redis (escala)           📄 SRT / VTT / TXT
```

## Qué incluye

| Requisito | Cómo lo resuelve CaptionLive |
|---|---|
| Audio en vivo → subtítulos en tiempo real | `gemini-3.5-transcribe-live` por streaming (resultados parciales en cientos de ms), traducción por oración con `gemini-2.5-flash-lite` |
| Idioma original + español (+ español→inglés) | Cualquier idioma de origen (o detección automática) → N idiomas destino por sesión |
| Varias sesiones al mismo tiempo | Un pipeline asíncrono por escenario; nodos stateless + Redis para escalar horizontalmente |
| Licencia OSI + documentación | Apache-2.0 · [docs/](docs/) con arquitectura, despliegue, uso, API y pruebas |
| Vista para la audiencia | Web responsive: elegir sesión e idioma, tamaño de letra, alto contraste, modo dual, lectura en voz alta |
| **Opcionales** | ✅ Más idiomas (pt, fr, de, it, ja…) · ✅ Glosario técnico por sesión · ✅ Exportar SRT/VTT/TXT · ✅ Panel de producción (estado, latencia, errores, costo) · ✅ Overlay para OBS/vMix + fuente de texto para vMix |
| Extras | Resumen IA de la charla, QR por sesión, *early commit* para bajar latencia, rotación sin pérdida de las sesiones Live, modo 100 % local, métricas Prometheus, simulador de carga |

## Probalo en 1 minuto (sin API key)

```bash
pip install -e .
CL_ASR_PROVIDER=mock CL_MT_PROVIDER=mock CL_ADMIN_TOKEN=secret \
CL_SESSIONS_FILE=examples/sessions.yaml captionlive serve
```

- Audiencia: <http://localhost:8000>
- Panel de producción: <http://localhost:8000/admin> (token `secret`)
- Escenario: desde el panel, “Escenario (con clave)” → **Empezar a transmitir**

El modo `mock` genera una charla de ejemplo a partir del audio recibido, así podés probar
todo el flujo (y las pruebas de carga) sin gastar créditos.

## Con Gemini (producción)

```bash
cp .env.example .env        # GEMINI_API_KEY y CL_ADMIN_TOKEN
docker compose up -d --build   # 2 réplicas + Redis + nginx en http://localhost:8080
```

O en Google Cloud Run con un comando: `PROJECT=mi-proyecto ./deploy/cloudrun.sh`.
Ver [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md).

Enviar audio desde la consola de sonido / un feed SRT del streaming:

```bash
captionlive ingest --server https://captions.example.org --session main-stage --key <clave> \
  --input "srt://10.0.0.5:9000"            # o rtmp://, un archivo, o una placa de audio
```

## Web (Next.js)

`frontend/` contiene la web profesional (Next.js 16 + Tailwind 4): landing con salas en vivo, visor de
subtítulos, consola de escenario, panel de producción y overlay OBS/vMix. Se despliega en Vercel
(Root Directory = `frontend`). Ver [frontend/README.md](frontend/README.md). El backend sigue sirviendo
además una versión liviana sin build en `/`, `/stage`, `/admin` y `/overlay`.

## Documentación

- [Arquitectura y stack](docs/ARQUITECTURA.md) — por qué cada pieza, diagramas de flujo, escalabilidad, costos
- [Guía de uso](docs/USO.md) — antes, durante y después del evento; OBS/vMix
- [Despliegue](docs/DESPLIEGUE.md) — local, Docker Compose, Cloud Run, Kubernetes, 100 % local
- [API](docs/API.md) — REST, SSE, protocolo de ingesta
- [Pruebas](docs/PRUEBAS.md) — estrategia, cómo correrlas y resultados (incl. carga)

## Desarrollo

```bash
pip install -e ".[dev]"
pytest                                     # 49 pruebas (unitarias, API, e2e, navegador)
CL_TEST_REDIS_URL=redis://localhost:6379/0 pytest   # + pruebas multinodo con Redis
ruff check captionlive tests
```

## Licencia

[Apache License 2.0](LICENSE).
