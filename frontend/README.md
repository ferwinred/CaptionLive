# CaptionLive Web (Next.js)

Frontend profesional de CaptionLive: sesiones en vivo, visor de subtítulos, consola de escenario,
panel de producción y overlay para OBS/vMix. Se conecta al backend FastAPI por HTTP/SSE/WebSocket.

| Ruta | Para quién | Qué hace |
|---|---|---|
| `/` | Audiencia | Landing + salas en vivo con búsqueda |
| `/s/[id]` | Audiencia | Subtítulos en vivo: idioma, tamaño, temas (oscuro/claro/alto contraste), original debajo, modo proyector, lectura en voz alta, resumen IA, QR, descarga SRT/VTT/TXT |
| `/stage` | Técnica de sala | Captura de micrófono/consola (AudioWorklet → PCM 16 kHz → WebSocket), vúmetro, métricas, vista previa |
| `/admin` | Producción | KPIs, estado de cada sala (nivel, latencias, errores, costo), CRUD de sesiones con glosario, enlaces, QR, exportación |
| `/overlay/[id]` | Streaming | Browser source transparente para OBS/vMix (`?lang=es&lines=2&size=42&pos=bottom`) |

## Desarrollo

```bash
cd frontend
npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev   # backend local: captionlive serve
npm test && npx tsc --noEmit && npm run build
```

El backend se elige con `NEXT_PUBLIC_API_URL` (build) y se puede cambiar en runtime con
`?api=https://...` o desde el ícono de servidor del encabezado (se guarda en el navegador).

## Deploy en Vercel

Importar el repo en Vercel con **Root Directory = `frontend`** (framework Next.js detectado) y la
variable `NEXT_PUBLIC_API_URL` apuntando al backend. El backend ya permite CORS.

Stack: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · lucide · next-themes · sonner · qrcode.react.
