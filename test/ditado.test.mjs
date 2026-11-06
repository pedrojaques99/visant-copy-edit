/* Ditado (microfone): o relay /__copy/gravador repassa áudio e headers pro Gravador sem o
   Origin do browser, diz "Gravador desligado" quando o jaques-api não está de pé, e o
   cliente /__copy/ditado.mjs (vendor do jaques-os) é servido. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarServidor } from '../server/nucleo.mjs';

async function ouvir(server) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${server.address().port}`;
}
const fechar = (...ss) => Promise.all(ss.map((s) => new Promise((r) => s.close(r))));

async function subirEditor() {
  const root = mkdtempSync(join(tmpdir(), 'copy-edit-ditado-'));
  const server = criarServidor(root, {});
  return { server, base: await ouvir(server) };
}

test('relay do Gravador: repassa corpo grande e headers, e tira o Origin', async () => {
  let visto;
  const gravador = createServer(async (req, res) => {
    const pedacos = [];
    for await (const c of req) pedacos.push(c);
    const corpo = Buffer.concat(pedacos);
    visto = { metodo: req.method, url: req.url, headers: req.headers, n: corpo.length, sha: createHash('sha1').update(corpo).digest('hex') };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'abc', text: 'ditado ok' }));
  });
  const ed = await subirEditor();
  process.env.GRAVADOR_URL = (await ouvir(gravador)) + '/api/gravador';
  try {
    /* 13 MB: passa do limite do lerCorpo (12 MB), prova que o relay não usa ele. */
    const audio = Buffer.alloc(13 * 1024 * 1024, 7);
    const r = await fetch(ed.base + '/__copy/gravador/dictate', {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-duration': '4200',
        'x-kind': 'audio',
        origin: 'http://127.0.0.1:4318',
      },
      body: audio,
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { id: 'abc', text: 'ditado ok' });
    assert.equal(visto.metodo, 'POST');
    assert.equal(visto.url, '/api/gravador/dictate');
    assert.equal(visto.headers['content-type'], 'application/octet-stream');
    assert.equal(visto.headers['x-duration'], '4200');
    assert.equal(visto.headers['x-kind'], 'audio');
    assert.equal(visto.headers.origin, undefined);
    assert.equal(visto.n, audio.length);
    assert.equal(visto.sha, createHash('sha1').update(audio).digest('hex'));

    /* GET com query (o polling da sessão) e o status do Gravador voltam como vieram. */
    const g = await fetch(ed.base + '/__copy/gravador/session/abc?x=1');
    assert.equal(g.status, 200);
    assert.equal(visto.metodo, 'GET');
    assert.equal(visto.url, '/api/gravador/session/abc?x=1');
  } finally {
    delete process.env.GRAVADOR_URL;
    await fechar(ed.server, gravador);
  }
});

test('relay do Gravador: devolve o status de erro do Gravador sem mexer', async () => {
  const gravador = createServer((req, res) => {
    req.resume();
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end('{"error":"origem recusada"}');
  });
  const ed = await subirEditor();
  process.env.GRAVADOR_URL = (await ouvir(gravador)) + '/api/gravador';
  try {
    const r = await fetch(ed.base + '/__copy/gravador/keys');
    assert.equal(r.status, 403);
    assert.deepEqual(await r.json(), { error: 'origem recusada' });
  } finally {
    delete process.env.GRAVADOR_URL;
    await fechar(ed.server, gravador);
  }
});

test('relay do Gravador: 502 "Gravador desligado" quando o jaques-api não responde', async () => {
  /* Uma porta que acabou de ser liberada: ninguém escuta nela. */
  const morto = createServer();
  const url = await ouvir(morto);
  await fechar(morto);
  const ed = await subirEditor();
  process.env.GRAVADOR_URL = url + '/api/gravador';
  try {
    const r = await fetch(ed.base + '/__copy/gravador/dictate', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-duration': '900' },
      body: Buffer.from('webm'),
    });
    assert.equal(r.status, 502);
    assert.match((await r.json()).erro, /Gravador desligado/);
  } finally {
    delete process.env.GRAVADOR_URL;
    await fechar(ed.server);
  }
});

test('ditado: /__copy/ditado.mjs é servido como ESM, com o cabeçalho do vendor', async () => {
  const ed = await subirEditor();
  try {
    const r = await fetch(ed.base + '/__copy/ditado.mjs');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /javascript/);
    const js = await r.text();
    assert.match(js, /^\/\* gerado por npm run vendor:ditado/);
    assert.match(js, /export function criarDitado/);
    assert.match(js, /export function gravarTomada/);
    assert.match(js, /export async function esperarSessao/);
  } finally {
    await fechar(ed.server);
  }
});
