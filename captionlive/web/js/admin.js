import { $, api, esc } from "./common.js";

let token = sessionStorage.getItem("cl:admin") || "";
let config, sessions = [];

async function enter() {
  try {
    config = await api("/api/config");
    sessions = await api("/api/admin/sessions", { token });
    sessionStorage.setItem("cl:admin", token);
    $("#login").hidden = true; $("#panel").hidden = false; $("#logout").hidden = false;
    fillLangs(); render();
    setInterval(refresh, 2000);
  } catch (e) {
    $("#login").hidden = false; $("#login-err").textContent = token ? e.message : "";
  }
}

async function refresh() {
  try { sessions = await api("/api/admin/sessions", { token }); render(); } catch {}
}

function fillLangs() {
  const opts = Object.entries(config.languages);
  $("select[name=source_lang]").innerHTML = '<option value="auto">Detectar automáticamente</option>' +
    opts.map(([c, n]) => `<option value="${c}">${esc(n)}</option>`).join("");
  $("#targets").innerHTML = opts.map(([c, n]) => `<label><input type="checkbox" value="${c}"> ${esc(n)}</label>`).join("");
}

const origin = () => (config.public_url || location.origin).replace(/\/$/, "");
const fmtMs = (v) => (v == null ? "—" : `${v} ms`);

function render() {
  const live = sessions.filter((s) => s.status.live);
  const audience = sessions.reduce((a, s) => a + s.audience_here, 0);
  const cost = sessions.reduce((a, s) => a + (s.status.est_cost_usd || 0), 0);
  $("#totals").textContent = `${live.length}/${sessions.length} en vivo · ${audience} espectadores (este nodo) · US$ ${cost.toFixed(3)}`;
  $("#rows").innerHTML = sessions.map((s) => {
    const st = s.status, base = origin(), id = encodeURIComponent(s.id);
    const level = st.live ? Math.max(0, Math.min(100, (st.level_db + 60) / 60 * 100)) : 0;
    const silent = st.live && st.level_db < -55;
    const langs = s.languages.map((l) => l.code);
    return `<tr>
      <td><strong>${esc(s.title || s.id)}</strong><div class="muted">${esc(s.id)} · ${esc(s.source_lang)} → ${esc(s.target_langs.join(", ") || "—")}</div>
          ${s.speaker ? `<div class="muted">${esc(s.speaker)}</div>` : ""}</td>
      <td>${st.live ? '<span class="badge live">En vivo</span>' : '<span class="badge">Offline</span>'}
          ${st.live ? `<div class="muted kpi">${Math.floor(st.audio_seconds / 60)}:${String(Math.floor(st.audio_seconds % 60)).padStart(2, "0")}</div>` : ""}
          ${silent ? '<div class="err">¿Sin audio?</div>' : ""}</td>
      <td><div class="meter"><i style="width:${level}%"></i></div><div class="muted kpi">${st.live ? st.level_db + " dB" : ""}</div></td>
      <td class="kpi">1º: ${fmtMs(st.first_caption_ms)}<br>MT: ${fmtMs(st.translation_ms)}</td>
      <td class="kpi">${s.audience_here}</td>
      <td class="kpi">${st.live ? `ASR ${st.asr_errors} · MT ${st.mt_errors} · reconex. ${st.asr_reconnects}` : "—"}
          ${st.last_error ? `<div class="err" title="${esc(st.last_error)}">${esc(st.last_error.slice(0, 60))}</div>` : ""}</td>
      <td class="kpi">${st.est_cost_usd != null ? "US$ " + st.est_cost_usd.toFixed(3) : "—"}</td>
      <td><div class="links">
        <a href="${base}/?session=${id}" target="_blank">Audiencia</a>
        <a href="#" data-qr="${esc(s.id)}">QR</a>
        <a href="${base}/stage?session=${id}&key=${encodeURIComponent(s.ingest_key)}" target="_blank">Escenario (con clave)</a>
        <span>Overlay OBS/vMix: ${langs.map((l) => `<a href="${base}/overlay?session=${id}&lang=${l}" target="_blank">${l}</a>`).join(" ")}</span>
        <span>Texto vMix: ${langs.map((l) => `<a href="${base}/api/sessions/${id}/now.txt?lang=${l}" target="_blank">${l}</a>`).join(" ")}</span>
        <span>Exportar: ${langs.map((l) => `${l} <a href="/api/sessions/${id}/transcript.srt?lang=${l}">srt</a>/<a href="/api/sessions/${id}/transcript.vtt?lang=${l}">vtt</a>/<a href="/api/sessions/${id}/transcript.txt?lang=${l}">txt</a>`).join(" · ")}</span>
        <code title="Clave de ingesta">key: ${esc(s.ingest_key)}</code>
      </div></td>
      <td><div class="row" style="flex-direction:column;align-items:stretch">
        <button data-edit="${esc(s.id)}">Editar</button>
        <button data-rotate="${esc(s.id)}">Nueva clave</button>
        <button data-clear="${esc(s.id)}">Borrar texto</button>
        <button class="danger" data-delete="${esc(s.id)}">Eliminar</button>
      </div></td>
    </tr>`;
  }).join("") || '<tr><td colspan="9" class="muted">No hay sesiones. Creá una con “Nueva sesión”.</td></tr>';
}

function openForm(s) {
  const f = $("#form");
  f.hidden = false;
  $("#form-title").textContent = s ? `Editar ${s.id}` : "Nueva sesión";
  f.elements.id.value = s?.id || ""; f.elements.id.readOnly = !!s;
  f.elements.title.value = s?.title || ""; f.elements.speaker.value = s?.speaker || ""; f.elements.room.value = s?.room || "";
  f.elements.source_lang.value = s?.source_lang || "en";
  const targets = s?.target_langs || ["es"];
  document.querySelectorAll("#targets input").forEach((i) => (i.checked = targets.includes(i.value)));
  f.elements.glossary.value = (s?.glossary || []).join("\n");
  f.scrollIntoView({ behavior: "smooth" });
}

$("#form").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = {
    id: f.elements.id.value.trim(), title: f.elements.title.value.trim(), speaker: f.elements.speaker.value.trim(), room: f.elements.room.value.trim(),
    source_lang: f.elements.source_lang.value,
    target_langs: [...document.querySelectorAll("#targets input:checked")].map((i) => i.value),
    glossary: f.elements.glossary.value.split(/\n|,/).map((t) => t.trim()).filter(Boolean),
  };
  try { await api("/api/admin/sessions", { method: "POST", body, token }); f.hidden = true; $("#form-err").textContent = ""; refresh(); }
  catch (err) { $("#form-err").textContent = err.message; }
};

document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-edit],[data-delete],[data-clear],[data-rotate],[data-qr]");
  if (!t) return;
  e.preventDefault();
  const id = t.dataset.edit || t.dataset.delete || t.dataset.clear || t.dataset.rotate || t.dataset.qr;
  const path = `/api/admin/sessions/${encodeURIComponent(id)}`;
  if (t.dataset.edit) openForm(sessions.find((s) => s.id === id));
  if (t.dataset.delete && confirm(`¿Eliminar la sesión ${id} y su transcripción?`)) await api(path, { method: "DELETE", token });
  if (t.dataset.clear && confirm(`¿Borrar la transcripción de ${id}? (útil entre charlas)`)) await api(path + "/clear", { method: "POST", token });
  if (t.dataset.rotate && confirm("La fuente actual deberá usar la nueva clave. ¿Continuar?")) await api(path + "/rotate-key", { method: "POST", token });
  if (t.dataset.qr) {
    $("#qr-body").innerHTML = `<img alt="QR" style="width:min(360px,80vw);background:#fff" src="/api/sessions/${encodeURIComponent(id)}/qr.svg"><p>${esc(origin())}/?session=${esc(id)}</p>`;
    $("#qr").showModal();
  }
  refresh();
});

$("#new").onclick = () => openForm(null);
$("#cancel").onclick = () => ($("#form").hidden = true);
$("#enter").onclick = () => { token = $("#token").value.trim(); enter(); };
$("#token").onkeydown = (e) => e.key === "Enter" && $("#enter").click();
$("#logout").onclick = () => { sessionStorage.removeItem("cl:admin"); location.reload(); };

enter();
