/* gerado por npm run vendor:ditado a partir de jaques-os/frontend/public/gravador/ditado.mjs; não edite. */
/* Ditado pelo Gravador: o ÚNICO cliente de navegador do microfone (SSoT).
 *
 * MediaRecorder → blob webm/opus + duração → POST no Gravador (backend/gravador.js).
 * Quem usa (barra da copy-edit, Estúdio) copia este arquivo, não reescreve: a
 * copy-edit tem `npm run vendor:ditado`. A guarda de Origin do Gravador recusa o
 * browser, então cada app passa em `base` o relay do PRÓPRIO servidor, que repassa
 * sem Origin pro jaques-api (:3003/api/gravador).
 *
 *   const d = criarDitado({ base: '/__copy/gravador', onEstado });
 *   await d.alternar();   // 1ª vez grava; 2ª para, manda e resolve com o texto
 *
 * estado: 'parado' | 'gravando' | 'pausado' | 'mandando' | 'erro'. Erro sai como Error com a
 * mensagem em pt-BR, pronta pra mostrar.
 *
 * Tempo real: `onPcm(Int16Array)` recebe o áudio cru em 16 kHz mono enquanto grava (e não
 * enquanto pausa), pra quem quer acompanhar a fala ao vivo (o teleprompter do Estúdio).
 */
const MIMES = ['audio/webm;codecs=opus', 'audio/webm'];

/* AudioWorklet que entrega Int16 a 16 kHz (o AudioContext reamostra o microfone). */
const WORKLET = `registerProcessor('pcm16', class extends AudioWorkletProcessor {
  process([entrada]) {
    const c = entrada && entrada[0];
    if (c) { const o = new Int16Array(c.length); for (let i = 0; i < c.length; i++) o[i] = Math.max(-1, Math.min(1, c[i])) * 32767; this.port.postMessage(o, [o.buffer]); }
    return true;
  }
});`;
async function ligarPcm(stream, onPcm, ativo) {
  const ctx = new AudioContext({ sampleRate: 16000 });
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
  const no = new AudioWorkletNode(ctx, 'pcm16');
  no.port.onmessage = (e) => ativo() && onPcm(e.data);
  ctx.createMediaStreamSource(stream).connect(no);
  return () => ctx.close();
}

function gravador(rota, extra, { base = '/api/gravador', onEstado, onPcm } = {}) {
  let mr = null;
  let t0 = 0;
  let pausadoEm = 0;
  let pausas = 0;
  let pronto = null;
  const api = {
    estado: 'parado',
    alternar() {
      if (api.estado === 'mandando') return pronto;
      if (mr) return (mr.state !== 'inactive' && mr.stop(), pronto);
      pronto = comecar();
      return pronto;
    },
    cancelar() {
      if (!mr) return;
      mr.cancelado = true;
      if (mr.state !== 'inactive') mr.stop();
    },
    /* Pausa sem cortar a tomada: o tempo pausado não conta na duração. */
    pausar() {
      if (!mr || mr.state !== 'recording') return;
      mr.pause();
      pausadoEm = Date.now();
      mudar('pausado');
    },
    retomar() {
      if (!mr || mr.state !== 'paused') return;
      mr.resume();
      pausas += Date.now() - pausadoEm;
      mudar('gravando');
    },
  };
  const mudar = (e) => ((api.estado = e), onEstado && onEstado(e));

  async function comecar() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      mudar('erro');
      const negado = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      throw new Error(negado ? 'microfone negado: libere no cadeado da barra de endereço' : 'sem microfone: ' + (e.message || e));
    }
    const mime = MIMES.find((m) => MediaRecorder.isTypeSupported(m)) || '';
    const pedacos = [];
    mr = new MediaRecorder(stream, { mimeType: mime || undefined, audioBitsPerSecond: 96000 });
    mr.ondataavailable = (e) => e.data.size && pedacos.push(e.data);
    const parou = new Promise((r) => (mr.onstop = r));
    t0 = Date.now();
    pausas = 0;
    const desligarPcm = onPcm ? await ligarPcm(stream, onPcm, () => mr && mr.state === 'recording').catch(() => null) : null;
    mr.start();
    mudar('gravando');
    await parou;
    if (desligarPcm) desligarPcm();
    const dur = Date.now() - t0 - pausas - (api.estado === 'pausado' ? Date.now() - pausadoEm : 0);
    const cancelado = mr.cancelado;
    stream.getTracks().forEach((t) => t.stop());
    mr = null;
    if (cancelado) return mudar('parado'), null;
    const blob = new Blob(pedacos, { type: pedacos[0]?.type || 'audio/webm' });
    if (!blob.size || dur < 300) return mudar('parado'), null;
    mudar('mandando');
    try {
      // O webm do MediaRecorder sai sem duração no cabeçalho: ela vai por header.
      const r = await fetch(`${base}/${rota}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Duration': String(dur), ...extra },
        body: blob,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erro || j.error || (r.status === 502 || r.status === 503 ? 'Gravador desligado' : `Gravador respondeu ${r.status}`));
      mudar('parado');
      return j;
    } catch (e) {
      mudar('erro');
      throw new Error(/fetch/i.test(e.message) ? 'Gravador desligado' : e.message);
    }
  }
  return api;
}

/* Ditado curto: resolve com o texto (ou null, se a gravação saiu vazia ou foi cancelada). */
export function criarDitado(op = {}) {
  const g = gravador('dictate', {}, op);
  const alternar = g.alternar;
  g.alternar = () => alternar().then((j) => (j ? String(j.text || '').trim() : null));
  return g;
}

/* Tomada longa: vira sessão do Gravador (transcrição em segundo plano). Resolve com { id }. */
export function gravarTomada(op = {}) {
  const g = gravador('session', { 'X-Kind': 'audio' }, op);
  const alternar = g.alternar;
  g.alternar = () => alternar().then((j) => (j ? { id: j.id } : null));
  return g;
}

/* Espera a sessão terminar: GET /session/:id até status done ou error. */
export async function esperarSessao(base, id, { intervalo = 1500, onProgresso } = {}) {
  for (;;) {
    const r = await fetch(`${base}/session/${encodeURIComponent(id)}`);
    const s = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(s.erro || s.error || `Gravador respondeu ${r.status}`);
    if (s.status === 'done') return s;
    if (s.status === 'error') throw new Error(s.error || 'a transcrição falhou');
    if (onProgresso) onProgresso(s);
    await new Promise((ok) => setTimeout(ok, intervalo));
  }
}
