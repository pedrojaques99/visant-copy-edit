/* Adapter so-comentario: proxy na frente de um app de mentira, barra injetada, texto
   recusado, e o rabisco (PNG) indo e voltando pela fila. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarServidor } from '../server/nucleo.mjs';
import { criar } from '../adapters/so-comentario.mjs';

/* PNG 1×1 válido. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function ouvir(server) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${server.address().port}`;
}

async function subir() {
  const app = createServer((req, res) => {
    if (req.url === '/dados.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"ok":true}');
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><body><main><h1>Estúdio</h1></main></body></html>');
  });
  const alvo = await ouvir(app);
  const root = mkdtempSync(join(tmpdir(), 'copy-edit-so-'));
  const server = criarServidor(root, criar(root, { alvo }));
  const base = await ouvir(server);
  const post = (url, corpo) =>
    fetch(base + url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    }).then(async (r) => ({ status: r.status, corpo: await r.json() }));
  const fechar = () => Promise.all([server, app].map((s) => new Promise((r) => s.close(r))));
  return { root, base, post, fechar };
}

test('so-comentario: sem alvo, explica o que falta', () => {
  assert.throws(() => criar('/x', {}), /alvo/);
});

test('so-comentario: injeta a barra no HTML do app e deixa o resto passar', async () => {
  const s = await subir();
  try {
    const html = await fetch(s.base + '/projeto/orelhao').then((r) => r.text());
    assert.match(html, /<h1>Estúdio<\/h1>/);
    assert.match(html, /\/__copy\/editor\.js/);
    const prev = await fetch(s.base + '/?ce=preview').then((r) => r.text());
    assert.doesNotMatch(prev, /__copy/);
    assert.deepEqual(await fetch(s.base + '/dados.json').then((r) => r.json()), { ok: true });
  } finally {
    await s.fechar();
  }
});

test('so-comentario: a barra nasce no modo comentário e o texto é recusado', async () => {
  const s = await subir();
  try {
    const js = await fetch(s.base + '/__copy/editor.js').then((r) => r.text());
    assert.ok(js.startsWith('window.__copyEditModo = "comentario";'));
    const r = await s.post('/__copy/salvar', { pagina: '/', chave: 'a', valor: 'b' });
    assert.equal(r.status, 409);
    assert.match(r.corpo.erro, /só comentário/);
    for (const f of ['/__copy/freehand.mjs', '/__copy/screenshot.mjs'])
      assert.equal((await fetch(s.base + f)).status, 200, f);
  } finally {
    await s.fechar();
  }
});

test('rabisco: grava o PNG, a linha da fila aponta pra ele, lê de volta e apaga junto', async () => {
  const s = await subir();
  try {
    const r = await s.post('/__copy/comentar', { pagina: '/', seletor: 'main > h1', texto: '', png: PNG, pos: { x: 50, y: 50 } });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.comentario.rabisco, 'docs/comentarios/1.png');
    assert.ok(existsSync(join(s.root, 'docs/comentarios/1.png')));
    const md = readFileSync(join(s.root, 'docs/COMENTARIOS-IA.md'), 'utf8');
    assert.match(md, /#1 `\/` `main > h1` @50,50 · \(rabisco, sem texto\) !\[rabisco\]\(comentarios\/1\.png\)/);

    const fila = await fetch(s.base + '/__copy/comentarios?todas=1').then((x) => x.json());
    assert.equal(fila.itens[0].texto, '(rabisco, sem texto)');
    assert.equal(fila.itens[0].rabisco, 'docs/comentarios/1.png');
    const img = await fetch(s.base + '/__copy/rabisco?id=1');
    assert.equal(img.headers.get('content-type'), 'image/png');

    /* responder reescreve a fila: o rabisco continua na linha */
    await s.post('/__copy/comentario/responder', { id: 1, autor: 'ia', texto: 'feito' });
    assert.match(readFileSync(join(s.root, 'docs/COMENTARIOS-IA.md'), 'utf8'), /!\[rabisco\]\(comentarios\/1\.png\)/);

    await s.post('/__copy/comentario/apagar', { id: 1 });
    assert.ok(!existsSync(join(s.root, 'docs/comentarios/1.png')));
  } finally {
    await s.fechar();
  }
});

test('rabisco: recusa o que não é PNG', async () => {
  const s = await subir();
  try {
    const r = await s.post('/__copy/comentar', {
      pagina: '/',
      seletor: 'main',
      texto: 'x',
      png: 'data:image/png;base64,' + Buffer.from('<svg/>').toString('base64'),
    });
    assert.equal(r.status, 400);
    assert.match(r.corpo.erro, /PNG/);
  } finally {
    await s.fechar();
  }
});
