# Pruebas

```bash
pip install -e ".[dev]"
pytest                                                   # todo lo que no requiere servicios
CL_TEST_REDIS_URL=redis://localhost:6379/0 pytest        # + Redis y multinodo
pip install playwright && pytest tests/test_browser.py   # + navegador real (Chromium)
```

Las pruebas usan proveedores falsos (`mock`) o dobles del SDK de Gemini, así que corren
**sin API key, sin red y en segundos**. CI (GitHub Actions) corre todo, incluido Redis y
Chromium, más lint (`ruff`) y el build de la imagen Docker.

## Suites (49 pruebas)

| Archivo | Qué verifica |
|---|---|
| `test_audio.py` (3) | Remuestreo 48k/44.1k → 16k conserva duración; nivel dBFS; entradas vacías/impares |
| `test_segmenter.py` (5) | División en oraciones (inglés/español, decimales, abreviaturas); early commit solo con hipótesis estables; el final descuenta lo ya confirmado; varias oraciones en orden |
| `test_export.py` (4) | SRT/VTT con tiempos correctos, recorte de solapamientos, TXT, vacíos |
| `test_broker.py` (11) | Memory **y Redis**: CRUD de sesiones, historial acotado y filtrable, contadores, fan-out a varios suscriptores, lock de ingesta (dueño, refresco, liberación), estado con TTL, clientes lentos no bloquean |
| `test_pipeline.py` (7) | Flujo completo ASR→segmenter→MT; traducciones **en orden** con latencias aleatorias; fallback al original si la MT falla o excede el timeout; sin MT; no traduce al mismo idioma; contexto y glosario llegan al traductor |
| `test_gemini_asr.py` (5) | Contra un Live API falso: parciales/finales, configuración (`custom_vocabulary`, `language_codes`, modalidad TEXT); **rotación sin pérdida** (todos los bloques de audio llegan, cada conexión se drena); reintentos con buffer y reenvío del audio; unión de finales incrementales |
| `test_mt.py` (4) | Prompt con glosario/contexto; limpieza de salida; cliente OpenAI-compatible (Gemma/Ollama) con transporte simulado; traductor Gemini (sin thinking, temperatura, instrucción de sistema) |
| `test_api.py` (6) | Páginas y salud; autenticación admin; CRUD y validaciones; clave de ingesta inválida (4401); ingesta WebSocket a 48 kHz → historial original/es/pt → export SRT/VTT/TXT, `now.txt/json`, QR, resumen, limpiar; segunda fuente rechazada (4409) y `takeover` |
| `test_e2e.py` (3) | **Servidor uvicorn real**: SSE en vivo (status, interim, final), reanudación con `Last-Event-ID` sin duplicados, `backlog=0`; **multinodo**: audio en el nodo A, audiencia en el nodo B vía Redis, lock compartido entre nodos |
| `test_browser.py` (1) | **Chromium real** con micrófono simulado: página de escenario (AudioWorklet → WebSocket) → subtítulos traducidos en la vista de audiencia, overlay OBS y panel en vivo, sin errores de JavaScript |

## Prueba de carga

Herramienta incluida: `captionlive simulate` crea N sesiones y transmite audio sintético a
tiempo real; `mock` como proveedores para medir **nuestro** overhead (el trabajo pesado de
ASR/MT ocurre en Google).

```bash
CL_ASR_PROVIDER=mock CL_MT_PROVIDER=mock CL_ADMIN_TOKEN=secret captionlive serve &
captionlive simulate --admin-token secret --sessions 30 --seconds 30 --langs es,pt
```

Resultado en un solo proceso (1 worker, 4 vCPU disponibles), **30 escenarios simultáneos
(original + 2 idiomas) y 600 espectadores SSE**:

| Métrica | Valor |
|---|---|
| CPU del servidor | **~4 % de un core** |
| Memoria (RSS) | **~95 MB** |
| Subtítulos entregados | 19.200 finales, todos los espectadores recibieron todos (mín. = máx. por cliente) |
| Errores de traducción | 0 |

Conclusión: un nodo chico sostiene un evento del tamaño de Nerdearla (30+ salas); las
réplicas extra con Redis son para alta disponibilidad y audiencias de miles.

## Prueba manual con Gemini

Con `GEMINI_API_KEY` configurada:

```bash
captionlive serve &
# crear la sesión en /admin y usar su clave:
captionlive ingest --session main-stage --key <clave> --input charla-de-ejemplo.mp4
```

Verificar en `/admin`: latencia *1º* y *MT*, errores en 0; y en `/?session=main-stage&lang=es`
la calidad de los términos del glosario. (En el entorno donde se desarrolló este proyecto no
había API key disponible, por eso la integración con Gemini está cubierta con dobles del SDK
que reproducen su protocolo; conviene hacer este ensayo con una charla real antes del evento.)
