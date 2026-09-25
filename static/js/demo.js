// In-browser demo backend used when the web app is hosted statically (GitHub Pages) without a
// CaptionLive server. It simulates live stages from scripted talks. The timeline is derived
// from the wall clock, so every tab and device shows the same captions at the same time.

const LANGS = {
  en: "English", es: "Español", pt: "Português", fr: "Français", de: "Deutsch", it: "Italiano",
  ja: "日本語", zh: "中文", ko: "한국어", hi: "हिन्दी", ar: "العربية", ru: "Русский", nl: "Nederlands",
  pl: "Polski", tr: "Türkçe", uk: "Українська", ca: "Català", gn: "Avañe'ẽ", qu: "Runasimi",
};

// [source, {lang: translation}]
const KEYNOTE = [
  ["Welcome to Nerdearla! Today we are going to talk about Kubernetes operators.",
    { es: "¡Bienvenidos a Nerdearla! Hoy vamos a hablar de operadores de Kubernetes.", pt: "Bem-vindos à Nerdearla! Hoje vamos falar sobre operadores do Kubernetes." }],
  ["An operator encodes the knowledge of a human operator into software.",
    { es: "Un operador codifica en software el conocimiento de un operador humano.", pt: "Um operador codifica em software o conhecimento de um operador humano." }],
  ["It watches the cluster state and reconciles it with the desired state.",
    { es: "Observa el estado del clúster y lo reconcilia con el estado deseado.", pt: "Ele observa o estado do cluster e o reconcilia com o estado desejado." }],
  ["The reconcile loop must be idempotent, because it can run many times.",
    { es: "El bucle de reconciliación debe ser idempotente, porque puede ejecutarse muchas veces.", pt: "O loop de reconciliação deve ser idempotente, porque pode ser executado muitas vezes." }],
  ["We store our custom resources as CRDs and version them like any other API.",
    { es: "Guardamos nuestros recursos personalizados como CRDs y los versionamos como cualquier otra API.", pt: "Armazenamos nossos recursos personalizados como CRDs e os versionamos como qualquer outra API." }],
  ["For observability we export metrics with OpenTelemetry and scrape them with Prometheus.",
    { es: "Para la observabilidad exportamos métricas con OpenTelemetry y las recolectamos con Prometheus.", pt: "Para observabilidade exportamos métricas com OpenTelemetry e as coletamos com o Prometheus." }],
  ["The hardest part was handling upgrades without downtime.",
    { es: "La parte más difícil fue manejar las actualizaciones sin tiempo de inactividad.", pt: "A parte mais difícil foi lidar com atualizações sem tempo de inatividade." }],
  ["So remember: start small, test your reconcilers, and automate everything.",
    { es: "Así que recuerden: empiecen de a poco, prueben sus reconciliadores y automaticen todo.", pt: "Então lembrem-se: comecem pequeno, testem seus reconciliadores e automatizem tudo." }],
  ["Thank you very much! Now let's take some questions.",
    { es: "¡Muchas gracias! Ahora pasemos a algunas preguntas.", pt: "Muito obrigado! Agora vamos para algumas perguntas." }],
];

const OTEL = [
  ["Buenas tardes a todos, hoy vamos a hablar de observabilidad con OpenTelemetry.",
    { en: "Good afternoon everyone, today we are going to talk about observability with OpenTelemetry.", pt: "Boa tarde a todos, hoje vamos falar sobre observabilidade com OpenTelemetry." }],
  ["La observabilidad se apoya en tres pilares: métricas, logs y trazas.",
    { en: "Observability rests on three pillars: metrics, logs and traces.", pt: "A observabilidade se apoia em três pilares: métricas, logs e traces." }],
  ["Con el SDK instrumentamos la aplicación una sola vez y exportamos a cualquier backend.",
    { en: "With the SDK we instrument the application once and export to any backend.", pt: "Com o SDK instrumentamos a aplicação uma única vez e exportamos para qualquer backend." }],
  ["En nuestro caso usamos Grafana, Loki para los logs y Tempo para las trazas.",
    { en: "In our case we use Grafana, Loki for logs and Tempo for traces.", pt: "No nosso caso usamos Grafana, Loki para os logs e Tempo para os traces." }],
  ["El collector nos permite filtrar y muestrear antes de enviar los datos.",
    { en: "The collector lets us filter and sample before sending the data.", pt: "O collector nos permite filtrar e amostrar antes de enviar os dados." }],
  ["Así bajamos los costos de almacenamiento casi un cuarenta por ciento.",
    { en: "That way we cut storage costs by almost forty percent.", pt: "Assim reduzimos os custos de armazenamento em quase quarenta por cento." }],
  ["Gracias por venir, las diapositivas están en el repositorio.",
    { en: "Thanks for coming, the slides are in the repository.", pt: "Obrigado por virem, os slides estão no repositório." }],
];

const RUST = [
  ["Rust gives Python developers memory safety without a garbage collector.",
    { es: "Rust les da a los developers de Python seguridad de memoria sin recolector de basura." }],
  ["With PyO3 and maturin you can ship a native extension in minutes.",
    { es: "Con PyO3 y maturin pueden publicar una extensión nativa en minutos." }],
  ["The borrow checker feels strict at first, but it catches real bugs.",
    { es: "El borrow checker parece estricto al principio, pero atrapa bugs reales." }],
  ["We rewrote our parser in Rust and it became thirty times faster.",
    { es: "Reescribimos nuestro parser en Rust y se volvió treinta veces más rápido." }],
  ["Cargo makes dependency management and testing really pleasant.",
    { es: "Cargo hace que la gestión de dependencias y las pruebas sean realmente agradables." }],
  ["Start by moving one hot loop to Rust, measure, and iterate.",
    { es: "Empiecen moviendo un solo bucle crítico a Rust, midan e iteren." }],
];

const BUILTIN = [
  { id: "main-stage", title: "Keynote: Kubernetes operators en producción", room: "Escenario principal",
    speaker: "Ada Lovelace", source_lang: "en", target_langs: ["es", "pt"],
    glossary: ["Nerdearla", "Kubernetes", "CRD", "OpenTelemetry", "Prometheus"], script: KEYNOTE, offset: 0 },
  { id: "sala-2", title: "Observabilidad con OpenTelemetry", room: "Sala 2", speaker: "Grace Hopper",
    source_lang: "es", target_langs: ["en", "pt"], glossary: ["OpenTelemetry", "Grafana", "Loki", "Tempo"],
    script: OTEL, offset: 7 },
  { id: "sala-3", title: "Rust para developers de Python", room: "Sala 3", speaker: "Linus Torvalds",
    source_lang: "en", target_langs: ["es"], glossary: ["Rust", "PyO3", "maturin", "Cargo"], script: RUST, offset: 13 },
];

const WORD_S = 0.33; // speaking rate
const PAUSE_S = 1.2;
const MT_DELAY_S = 0.7;
const EPOCH = Date.UTC(2026, 8, 24) / 1000;

function customSessions() {
  try { return JSON.parse(localStorage.getItem("cl:demo:sessions")) || []; } catch { return []; }
}
function saveCustom(list) { try { localStorage.setItem("cl:demo:sessions", JSON.stringify(list)); } catch {} }

function allSessions() {
  return [...BUILTIN, ...customSessions().map((s, i) => ({ ...s, script: KEYNOTE, offset: 3 + i * 5 }))];
}
function getSession(id) { return allSessions().find((s) => s.id === id); }

/** Precomputed timeline of one loop of the script. */
function timeline(s) {
  let t = 0;
  const items = s.script.map(([src, tr]) => {
    const words = src.split(" ");
    const start = t;
    const end = start + words.length * WORD_S;
    t = end + PAUSE_S;
    return { src, tr, words, start, end };
  });
  return { items, loop: t };
}

function translate(s, item, lang) {
  if (lang === "source") return item.src;
  return item.tr[lang] || `[${lang}] ${item.src}`;
}

/** State of a session at wall-clock time `now` (seconds). */
function stateAt(s, now) {
  const { items, loop } = timeline(s);
  const t = now - EPOCH + s.offset;
  const loopIndex = Math.floor(t / loop);
  const inLoop = t - loopIndex * loop;
  const n = items.length;
  const finals = []; // {seq, segment, text, ts, lang}
  let interim = "";
  // finals of the previous loop + current loop up to now
  for (const li of [loopIndex - 1, loopIndex]) {
    items.forEach((it, i) => {
      const base = li * loop + EPOCH - s.offset;
      const seq = li * n + i + 1;
      if (li < loopIndex || it.end <= inLoop) finals.push({ seq, item: it, srcTs: base + it.end, mtTs: base + it.end + MT_DELAY_S });
    });
  }
  const cur = items.find((it) => inLoop >= it.start && inLoop < it.end);
  if (cur) interim = cur.words.slice(0, Math.max(1, Math.floor((inLoop - cur.start) / WORD_S) + 1)).join(" ");
  return { finals, interim, secondsLive: t % 3600 };
}

function sessionPublic(s, admin) {
  const now = Date.now() / 1000;
  const st = stateAt(s, now);
  const { script, offset, ...rest } = s;
  const data = {
    ...rest,
    created_at: EPOCH,
    languages: ["source", ...s.target_langs.filter((l) => l !== s.source_lang)].map((code) => ({
      code, name: LANGS[code === "source" ? s.source_lang : code] || code, original: code === "source",
    })),
    audience_here: 40 + ((s.id.length * 37 + Math.floor(now / 30)) % 90),
    status: {
      live: true, level_db: st.interim ? -18 - (Math.floor(now * 3) % 8) : -52,
      audio_seconds: st.secondsLive, started_at: now - st.secondsLive, asr_reconnects: Math.floor(st.secondsLive / 540),
      first_caption_ms: 380 + (Math.floor(now) % 5) * 20, translation_ms: 520 + (Math.floor(now) % 7) * 30,
      mt_chars: Math.floor(st.secondsLive * 14), mt_errors: 0, asr_errors: 0, last_error: "",
      est_cost_usd: +(st.secondsLive / 60 * 0.009 + st.secondsLive * 14 / 1000 * 0.0001).toFixed(4),
    },
  };
  if (admin) data.ingest_key = "demo-" + s.id;
  return data;
}

function finalsFor(s, lang, now) {
  const out = [];
  for (const f of stateAt(s, now).finals) {
    const ts = lang === "source" ? f.srcTs : f.mtTs;
    if (ts > now) continue;
    out.push({ type: "final", session: s.id, lang, text: translate(s, f.item, lang), seq: f.seq, segment: f.seq,
      source_lang: s.source_lang, ts, latency_ms: lang === "source" ? null : MT_DELAY_S * 1000, data: null });
  }
  return out;
}

const ok = (x) => JSON.parse(JSON.stringify(x));

export async function api(path, { method = "GET", body } = {}) {
  const url = new URL(path, "https://demo.local");
  const p = url.pathname;
  let m;
  if (p === "/api/config") return { languages: LANGS, public_url: "", sample_rate: 16000 };
  if (p === "/api/health") return { ok: true, demo: true };
  if (p === "/api/sessions") return allSessions().map((s) => sessionPublic(s));
  if (p === "/api/admin/sessions" && method === "GET") return allSessions().map((s) => sessionPublic(s, true));
  if (p === "/api/admin/sessions" && method === "POST") {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(body.id || "")) throw new Error("id must be lowercase letters, digits and dashes");
    if (BUILTIN.some((s) => s.id === body.id)) throw new Error("Las sesiones de ejemplo no se pueden editar en el demo");
    const list = customSessions().filter((s) => s.id !== body.id);
    list.push({ ...body, target_langs: body.target_langs?.length ? body.target_langs : ["es"] });
    saveCustom(list);
    return sessionPublic(getSession(body.id), true);
  }
  if ((m = p.match(/^\/api\/admin\/sessions\/([^/]+)(\/.*)?$/))) {
    const id = decodeURIComponent(m[1]);
    if (method === "DELETE") {
      if (BUILTIN.some((s) => s.id === id)) throw new Error("Las sesiones de ejemplo no se pueden eliminar en el demo");
      saveCustom(customSessions().filter((s) => s.id !== id));
      return { deleted: id };
    }
    return sessionPublic(getSession(id), true); // clear / rotate-key: no-op in the demo
  }
  if ((m = p.match(/^\/api\/sessions\/([^/]+)(\/[a-z.]+)?$/))) {
    const s = getSession(decodeURIComponent(m[1]));
    if (!s) throw new Error("session not found");
    const lang = url.searchParams.get("lang") || "source";
    const code = lang === s.source_lang ? "source" : lang;
    if (!m[2]) return sessionPublic(s);
    if (m[2] === "/history") return ok(finalsFor(s, code, Date.now() / 1000));
    if (m[2] === "/summary") return { summary: summary(s, lang), segments: s.script.length };
  }
  throw new Error("No disponible en modo demo");
}

function summary(s, lang) {
  const items = s.script.slice(0, 4).map(([src, tr]) => "• " + (tr[lang] || src));
  return items.join("\n");
}

export function transcript(sessionId, lang, fmt) {
  const s = getSession(sessionId);
  const events = finalsFor(s, lang === s.source_lang ? "source" : lang, Date.now() / 1000);
  const t0 = events[0]?.ts || 0;
  const tc = (x, sep) => {
    const ms = Math.round((x - t0) * 1000), h = Math.floor(ms / 3600000), mi = Math.floor(ms / 60000) % 60;
    const se = Math.floor(ms / 1000) % 60, r = ms % 1000;
    return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}:${String(se).padStart(2, "0")}${sep}${String(r).padStart(3, "0")}`;
  };
  if (fmt === "txt") return events.map((e) => e.text).join("\n") + "\n";
  const cues = events.map((e, i) => {
    const end = Math.min(e.ts + Math.max(1.5, Math.min(7, e.text.length / 15)), events[i + 1]?.ts ?? Infinity);
    return [e, end];
  });
  if (fmt === "vtt") return "WEBVTT\n\n" + cues.map(([e, end]) => `${tc(e.ts, ".")} --> ${tc(end, ".")}\n${e.text}\n`).join("\n");
  return cues.map(([e, end], i) => `${i + 1}\n${tc(e.ts, ",")} --> ${tc(end, ",")}\n${e.text}\n`).join("\n");
}

/** Emulates the SSE stream: backlog, then live interim/final/status events. */
export function subscribe(sessionId, langs, handlers) {
  const s = getSession(sessionId);
  if (!s) return { close() {} };
  const wanted = langs.map((l) => (l === s.source_lang ? "source" : l));
  const last = {};
  let lastInterim = null, tick = 0;
  const emit = (first) => {
    const now = Date.now() / 1000;
    if (tick++ % 10 === 0) handlers.status?.({ type: "status", session: s.id, lang: "*", data: sessionPublic(s).status });
    for (const lang of wanted) {
      let events = finalsFor(s, lang, now).filter((e) => e.seq > (last[lang] || 0));
      if (first) events = events.slice(-30);
      for (const e of events) { handlers.final?.(e); last[lang] = e.seq; }
    }
    if (wanted.includes("source")) {
      const interim = stateAt(s, now).interim;
      if (interim !== lastInterim) {
        lastInterim = interim;
        handlers.interim?.({ type: "interim", session: s.id, lang: "source", text: interim, source_lang: s.source_lang });
      }
    }
  };
  setTimeout(() => { handlers.connection?.(true); emit(true); }, 0);
  const timer = setInterval(() => emit(false), 150);
  return { close() { clearInterval(timer); } };
}
