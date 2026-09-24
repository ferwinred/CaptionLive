import { $, api, applyTheme, CaptionStream, CaptionView, downloadTranscript, esc, pageUrl, params, staticBanner, store } from "./common.js";

const sessionId = params.get("session");
applyTheme(store.get("theme", "dark"));
staticBanner();
for (const a of document.querySelectorAll('a[href="./"]')) a.href = pageUrl("index");

if (!sessionId) showPicker();
else showViewer(sessionId);

async function showPicker() {
  $("#picker").hidden = false;
  const render = async () => {
    const sessions = await api("/api/sessions");
    $("#sessions").innerHTML = sessions.length
      ? sessions.map((s) => `
        <a class="card" href="${pageUrl("index", { session: s.id })}">
          <div class="row"><h3>${esc(s.title || s.id)}</h3><span class="spacer"></span>
            ${s.status.live ? '<span class="badge live">En vivo</span>' : '<span class="badge">Offline</span>'}</div>
          ${s.speaker ? `<div>${esc(s.speaker)}</div>` : ""}
          ${s.room ? `<div class="muted">${esc(s.room)}</div>` : ""}
          <div class="muted">${s.languages.map((l) => esc(l.name)).join(" · ")}</div>
        </a>`).join("")
      : '<p class="muted">Todavía no hay sesiones configuradas.</p>';
  };
  await render();
  setInterval(render, 10000);
}

async function showViewer(id) {
  const session = await api(`/api/sessions/${encodeURIComponent(id)}`).catch(() => null);
  if (!session) { $("#picker").hidden = false; $("#sessions").innerHTML = `<p>Sesión no encontrada. <a href="${pageUrl("index")}">Ver sesiones</a></p>`; return; }
  document.title = `${session.title || session.id} · CaptionLive`;
  $("#title").textContent = [session.title || session.id, session.speaker].filter(Boolean).join(" — ");
  $("#viewer").hidden = false; $("#toolbar").hidden = false;

  const langSel = $("#lang");
  langSel.innerHTML = session.languages.map((l) => `<option value="${l.code}">${esc(l.name)}${l.original ? " (original)" : ""}</option>`).join("");
  const browser = (navigator.language || "es").slice(0, 2);
  const preferred = params.get("lang") || store.get("lang:" + id) ||
    (session.languages.find((l) => l.code === browser) ? browser : session.languages.find((l) => !l.original)?.code) || "source";
  langSel.value = session.languages.some((l) => l.code === preferred) ? preferred : "source";

  const size = $("#size"); size.value = String(store.get("size", 32));
  const theme = $("#theme"); theme.value = store.get("theme", "dark");
  $("#dual").checked = store.get("dual", false);
  $("#liveorig").checked = store.get("liveorig", true);
  const applySize = () => document.documentElement.style.setProperty("--caption-size", size.value + "px");
  applySize();
  size.onchange = () => { store.set("size", +size.value); applySize(); };
  theme.onchange = () => { store.set("theme", theme.value); applyTheme(theme.value); };

  let stream, view;
  let following = true;
  const followBtn = $("#follow");
  window.addEventListener("scroll", () => {
    following = window.innerHeight + window.scrollY >= document.body.scrollHeight - 80;
    followBtn.classList.toggle("show", !following);
  }, { passive: true });
  followBtn.onclick = () => { following = true; window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); };

  const speakQueue = [];
  const speak = (text, lang) => {
    if (!$("#speak").checked || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === "source" ? session.source_lang : lang;
    u.rate = 1.1;
    speechSynthesis.speak(u);
    speakQueue.push(u);
  };

  function connect() {
    stream?.close();
    const lang = langSel.value;
    store.set("lang:" + id, lang);
    const url = new URL(location); url.searchParams.set("lang", lang); history.replaceState(null, "", url);
    const el = $("#captions");
    view = new CaptionView(el, { lang, showOriginal: $("#dual").checked, liveOriginal: $("#liveorig").checked });
    view.onChange = () => {
      $("#empty").hidden = el.childElementCount > 0;
      if (following) window.scrollTo({ top: document.body.scrollHeight });
    };
    view.render();
    const langs = lang === "source" ? ["source"] : [lang, "source"];
    let firstBatch = true;
    setTimeout(() => (firstBatch = false), 1500);
    stream = new CaptionStream(id, langs, {
      final: (ev) => { view.final(ev); if (ev.lang === lang && !firstBatch) speak(ev.text, lang); },
      interim: (ev) => view.interimEvent(ev),
      status: (ev) => { $("#live").hidden = !ev.data?.live; if (!ev.data?.live) view.interimEvent({ lang: "source", text: "" }); },
    });
  }
  langSel.onchange = connect;
  $("#dual").onchange = () => { store.set("dual", $("#dual").checked); connect(); };
  $("#liveorig").onchange = () => { store.set("liveorig", $("#liveorig").checked); connect(); };
  $("#speak").onchange = () => { if (!$("#speak").checked) speechSynthesis?.cancel(); };
  connect();

  const menu = $("#menu");
  for (const b of document.querySelectorAll("[data-dl]")) b.onclick = () => downloadTranscript(id, langSel.value, b.dataset.dl);
  $("#more").onclick = () => menu.showModal();
  $("#close-menu").onclick = () => menu.close();
  $("#fullscreen").onclick = () => { menu.close(); document.documentElement.requestFullscreen?.(); };
  $("#summary").onclick = async () => {
    const out = $("#summary-out");
    out.textContent = "Generando resumen…";
    const lang = langSel.value === "source" ? session.source_lang : langSel.value;
    try { out.textContent = (await api(`/api/sessions/${encodeURIComponent(id)}/summary?lang=${lang}`, { method: "POST" })).summary || "Todavía no hay contenido."; }
    catch (e) { out.textContent = "No se pudo generar: " + e.message; }
  };
}
