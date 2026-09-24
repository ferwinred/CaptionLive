import { $, CaptionStream, CaptionView, params, store } from "./common.js";

const sessionIn = $("#session"), keyIn = $("#key");
sessionIn.value = params.get("session") || store.get("stage:session", "");
keyIn.value = params.get("key") || store.get("stage:key", "");
if (params.get("key")) history.replaceState(null, "", `/stage?session=${encodeURIComponent(sessionIn.value)}`);

let ctx, stream, node, ws, preview, stopping = false, retry = 0;
const state = (text, live = false) => { $("#state").textContent = text; $("#state").classList.toggle("live", live); };

async function listDevices() {
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
    const sel = $("#device"), current = sel.value || store.get("stage:device", "");
    sel.innerHTML = '<option value="">Micrófono por defecto</option>' +
      devices.map((d) => `<option value="${d.deviceId}">${d.label || "Entrada " + d.deviceId.slice(0, 6)}</option>`).join("");
    sel.value = current;
  } catch {}
}
listDevices();
navigator.mediaDevices?.addEventListener?.("devicechange", listDevices);

function connectWs() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const q = new URLSearchParams({ key: keyIn.value.trim(), rate: "16000" });
  if ($("#takeover").checked || retry > 0) q.set("takeover", "1");
  ws = new WebSocket(`${proto}://${location.host}/ws/ingest/${encodeURIComponent(sessionIn.value.trim())}?${q}`);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => state("Conectando…");
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "ready") { retry = 0; state("Transmitiendo", true); }
    if (msg.type === "status") {
      $("#stats").textContent =
        `Audio: ${fmtTime(msg.audio_seconds)} · 1er subtítulo: ${msg.first_caption_ms ?? "—"} ms · traducción: ${msg.translation_ms ?? "—"} ms · reconexiones ASR: ${msg.asr_reconnects} · errores: ${msg.asr_errors + msg.mt_errors} · costo est.: US$ ${msg.est_cost_usd.toFixed(3)}`;
    }
  };
  ws.onclose = (e) => {
    if (stopping) return;
    if (e.code === 4401 || e.code === 4409) { state(e.reason || "Rechazado"); stop(); alert(e.reason); return; }
    retry++;
    const wait = Math.min(1000 * 2 ** retry, 10000);
    state(`Reconectando en ${Math.round(wait / 1000)}s…`);
    setTimeout(() => !stopping && connectWs(), wait);
  };
}

async function start() {
  const session = sessionIn.value.trim(), key = keyIn.value.trim();
  if (!session || !key) return alert("Completá sesión y clave de ingesta.");
  store.set("stage:session", session); store.set("stage:key", key); store.set("stage:device", $("#device").value);
  stopping = false;
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: $("#device").value ? { exact: $("#device").value } : undefined,
      channelCount: 1, echoCancellation: false,
      autoGainControl: $("#agc").checked, noiseSuppression: $("#ns").checked,
    },
  });
  listDevices();
  ctx = new AudioContext();
  await ctx.audioWorklet.addModule("/static/js/pcm-worklet.js");
  const src = ctx.createMediaStreamSource(stream);
  node = new AudioWorkletNode(ctx, "pcm-worklet", { processorOptions: { targetRate: 16000 } });
  node.port.onmessage = ({ data }) => {
    $("#meter").style.width = Math.min(100, Math.max(0, (20 * Math.log10(data.peak || 1e-5) + 60) / 60 * 100)) + "%";
    if (ws?.readyState === WebSocket.OPEN) ws.send(data.pcm);
  };
  src.connect(node);
  connectWs();
  $("#start").disabled = true; $("#stop").disabled = false;
  $("#open-audience").href = `/?session=${encodeURIComponent(session)}`;
  preview?.close();
  const view = new CaptionView($("#preview"), { lang: "source", maxLines: 30 });
  view.onChange = () => ($("#preview").scrollTop = $("#preview").scrollHeight);
  preview = new CaptionStream(session, ["source"], { final: (e) => view.final(e), interim: (e) => view.interimEvent(e) });
}

function stop() {
  stopping = true;
  ws?.close(); node?.disconnect(); ctx?.close(); stream?.getTracks().forEach((t) => t.stop());
  preview?.close();
  $("#start").disabled = false; $("#stop").disabled = true; $("#meter").style.width = "0";
  state("Detenido");
}

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
$("#start").onclick = () => start().catch((e) => { alert("No se pudo iniciar el audio: " + e.message); stop(); });
$("#stop").onclick = stop;
window.addEventListener("beforeunload", (e) => { if (!stopping && ws) { e.preventDefault(); } });
