# Guía de uso

Tres roles: **producción** (configura y monitorea), **técnica de sala** (envía el audio) y
**audiencia** (lee los subtítulos).

## Antes del evento (producción)

1. **Crear las sesiones** (una por sala/escenario) en `/admin` → **+ Nueva sesión**, o en un
   YAML cargado al iniciar (`CL_SESSIONS_FILE`, ver [`examples/sessions.yaml`](../examples/sessions.yaml)):
   - **ID**: aparece en la URL (`main-stage`, `sala-2`).
   - **Idioma hablado**: el del orador, o *Detectar automáticamente* si hay charlas en varios idiomas.
   - **Idiomas de traducción**: por ejemplo español y portugués para charlas en inglés; inglés
     para charlas en español.
   - **Glosario**: productos, tecnologías, siglas y nombres de oradores/empresas, uno por línea
     (`Kubernetes`, `eBPF`, `Nerdearla`, `OpenTelemetry`, `Grafana Loki`…). Mejora el
     reconocimiento y la traducción los mantiene tal cual. Actualizalo entre charlas con los
     términos de la próxima (se aplica al iniciar la siguiente transmisión).
2. **Imprimir / proyectar el QR** de cada sala (botón *QR* del panel). Apunta a la vista de
   audiencia de esa sesión. Configurá `CL_PUBLIC_URL` para que el QR use el dominio público.
3. **Ensayo**: en cada sala, abrir el enlace *Escenario (con clave)*, transmitir 1 minuto y
   verificar en el panel el nivel de audio, la latencia y la vista de audiencia.

## Durante el evento

### Técnica de sala: enviar el audio

**Opción A — navegador (lo más simple):** abrir el enlace *Escenario (con clave)* del panel
en la notebook de la sala → elegir la entrada de audio → **Empezar a transmitir**.

- Preferí la **salida de línea de la consola** (vía placa USB) antes que el micrófono de la
  notebook: más limpia = mejor transcripción.
- Deja la pestaña abierta. Si se corta la red, se reconecta sola y el audio del corte se
  reenvía (hasta 60 s).
- *Reemplazar otra fuente activa* permite tomar la sala desde otra computadora.

**Opción B — línea de comandos (consolas, streams, sin navegador):**

```bash
# Feed SRT/RTMP/HLS del equipo de streaming
captionlive ingest --server https://captions.example.org --session sala-2 --key <clave> \
  --input "srt://10.0.0.5:9000"

# Placa de audio en Linux / macOS / Windows
captionlive ingest ... --ffmpeg-input-args "-f alsa" --input "hw:1"
captionlive ingest ... --ffmpeg-input-args "-f avfoundation" --input ":1"
captionlive ingest ... --ffmpeg-input-args "-f dshow" --input "audio=Line In (USB Audio)"

# Probar con una grabación (se envía a velocidad real)
captionlive ingest ... --input charla.mp4
```

### Producción: monitorear (`/admin`)

El panel se actualiza cada 2 s y muestra por sesión:

| Columna | Qué mirar |
|---|---|
| Estado | *En vivo* + tiempo transmitido. **¿Sin audio?** si el nivel está por debajo de −55 dBFS (micrófono muteado, cable suelto). |
| Nivel | Vúmetro de la señal que llega al servidor. |
| Latencia | *1º*: inicio de habla → primer subtítulo. *MT*: oración confirmada → traducción publicada. |
| Audiencia | Espectadores conectados a este nodo. |
| Errores | Errores de ASR / traducción, reconexiones y el último mensaje de error. |
| Costo est. | Costo estimado acumulado de la sesión. |

Entre charlas: **Borrar texto** limpia la transcripción de la sala (exportala antes si la
necesitás). **Editar** actualiza título, orador y glosario.

### Audiencia

- Escanear el QR o entrar a la web y elegir la sesión.
- Elegir idioma (se recuerda por sesión). *Original* muestra el idioma del orador.
- **A−/A/A+/A++** tamaño de letra; tema **oscuro / claro / alto contraste**.
- **Más…**:
  - *Mostrar también el texto original* (modo dual, útil para aprender o verificar términos).
  - *Ver original en vivo mientras se traduce* (en gris, antes de que llegue la traducción).
  - *Leer en voz alta*: el navegador lee la traducción (útil con auriculares).
  - *Resumen de lo dicho hasta ahora*: resumen IA en tu idioma (para quien llega tarde).
  - Descargar la transcripción TXT / SRT / VTT.
- Si el celular pierde conexión, al volver se recuperan los subtítulos que faltaban.

## Integración con OBS / vMix (subtítulos "quemados" en el stream)

### Overlay (OBS Browser Source / vMix Web Browser input)

Desde el panel, *Overlay OBS/vMix* → copiar la URL del idioma deseado, por ejemplo:

```
https://captions.example.org/overlay?session=main-stage&lang=es&lines=2&size=42
```

- **OBS**: *Fuentes → + → Navegador*, pegar la URL, 1920×1080, sin CSS personalizado. El fondo
  es transparente.
- **vMix**: *Add Input → Web Browser*, pegar la URL, y usarlo como overlay.

Parámetros de la URL:

| Parámetro | Default | Descripción |
|---|---|---|
| `lang` | `source` | Idioma (`source` = original, `es`, `pt`, `en`…) |
| `lines` | `2` | Líneas visibles |
| `size` | `42` | Tamaño de letra en px |
| `color` / `bg` | `#ffffff` / `rgba(0,0,0,.72)` | Colores del texto y la caja |
| `pos` | `bottom` | `bottom` o `top` |
| `margin` | `6` | Distancia al borde (% de alto) |
| `align` | `center` | `center` o `left` |
| `font` | Inter/sistema | Tipografía CSS |
| `hide` | `8` | Ocultar tras N segundos sin texto nuevo (`0` = nunca) |
| `shadow` | `1` | Sombra del texto |

Tip: con varios idiomas, un overlay por idioma en escenas distintas del stream (o en
streams distintos por idioma).

### Fuente de texto / Data Source (vMix títulos, tickers, OBS Text)

```
https://captions.example.org/api/sessions/main-stage/now.txt?lang=es&lines=2
https://captions.example.org/api/sessions/main-stage/now.json?lang=es
```

En vMix: *Settings → Data Sources → Add → Text/JSON*, con la URL de arriba y refresco de 1 s,
y enlazar el campo al título.

## Después del evento

- Exportar desde el panel (o desde la vista de audiencia) cada idioma en **SRT/VTT** para
  adjuntar a los videos publicados, o **TXT** para notas/blog. Los tiempos son relativos al
  primer subtítulo de la sesión (ajustar el offset en el editor de video si hace falta).
- API: `GET /api/sessions/{id}/transcript.srt?lang=es`.
