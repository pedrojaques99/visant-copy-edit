/* Detecção com fixtures mínimas em diretório temporário: os três formatos que
   existem (Club, site de cliente, visantismo), o repo que não casa com nada, e a
   subida de verdade do bin sem config (escreve a config e sobe com ela). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { detectar, textoConfig } from '../server/detectar.mjs';
import { caminhoTranca } from '../server/nucleo.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'copy-edit.mjs');

function repo(arquivos) {
  const root = mkdtempSync(join(tmpdir(), 'copy-edit-detectar-'));
  for (const [p, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo, null, 2));
  }
  return root;
}

const NEXT = { dependencies: { next: '16.0.0', 'next-intl': '4.0.0' } };

/* A config escrita tem que ser JS válido e devolver o mesmo que foi achado. */
async function importarConfig(achado) {
  const dir = mkdtempSync(join(tmpdir(), 'copy-edit-config-'));
  const arq = join(dir, 'copy-edit.config.mjs');
  writeFileSync(arq, textoConfig(achado));
  return (await import(pathToFileURL(arq).href)).default;
}

test('next-intl formato rota (Club): copy/<rota>.json com index, compartilhado = JSON que não é rota', async () => {
  const root = repo({
    'package.json': { ...NEXT, scripts: { 'tokens:check': 'node scripts/tokens.mjs check' } },
    'next.config.mjs': "import createNextIntlPlugin from 'next-intl/plugin'\nconst w = createNextIntlPlugin()\n",
    'tsconfig.json': '{\n  // comentário de tsconfig\n  "compilerOptions": { "paths": { "@/*": ["./*"] } }\n}\n',
    'i18n/request.ts':
      "import { getRequestConfig } from 'next-intl/server'\nimport { vercelStegaCombine } from '@vercel/stega'\nimport { COPY } from '@/copy'\n",
    'copy/index.ts': "import conta from './conta.json'\n",
    'copy/conta.json': { titulo: 'Conta' },
    'copy/comum.json': { menu: 'Menu' },
    'app/(club)/conta/page.tsx': '',
    'app/api/x/route.ts': '',
    'app/globals.css': '@theme {\n  --color-fg: #fff;\n}\n',
    'scripts/vendor/copy-lint.mjs': '',
  });
  const a = detectar(root);
  assert.equal(a.adapter, 'next-intl');
  assert.deepEqual(a.opcoes, {
    formato: 'rota',
    pasta: 'copy',
    compartilhados: ['comum'],
    tokens: { css: 'app/globals.css', checar: 'npm run tokens:check' },
    lint: 'scripts/vendor/copy-lint.mjs',
  });
  assert.ok(!a.notas.some((n) => n.includes('ATENÇÃO')), 'stega já ligado: sem aviso');
  assert.deepEqual(await importarConfig(a), { adapter: a.adapter, opcoes: a.opcoes });
});

test('next-intl formato locale (site de cliente): caminho do createNextIntlPlugin e import dinâmico', async () => {
  const root = repo({
    'package.json': NEXT,
    'next.config.ts': "const withNextIntl = createNextIntlPlugin('./lib/i18n/request.ts')\n",
    'tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./*"] } } }',
    'lib/i18n/request.ts': 'messages: (await import(`@/messages/${locale}.json`)).default,\n',
    'lib/i18n/routing.ts': "export const routing = defineRouting({ locales: ['en', 'pt-BR'], defaultLocale: 'pt-BR' })\n",
    'messages/en.json': { hero: { tagline: 'Hi' } },
    'messages/pt-BR.json': { hero: { tagline: 'Oi' } },
  });
  const a = detectar(root);
  assert.equal(a.adapter, 'next-intl');
  assert.deepEqual(a.opcoes, { formato: 'locale', pasta: 'messages', locales: ['en', 'pt-BR'], localePadrao: 'pt-BR' });
  /* Request config sem stega: detecta, mas avisa que a barra não vai achar texto. */
  assert.ok(a.notas.some((n) => n.startsWith('ATENÇÃO') && n.includes('lib/i18n/request.ts')));
  assert.deepEqual(await importarConfig(a), { adapter: a.adapter, opcoes: a.opcoes });
});

test('next-intl em src/: caminho padrão src/i18n/request.ts e alias @/ apontando pra src', () => {
  const root = repo({
    'package.json': NEXT,
    'tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
    'src/i18n/request.ts': 'const m = await import(`@/messages/${locale}.json`)\n',
    'src/messages/pt.json': { a: 'b' },
  });
  const a = detectar(root);
  assert.equal(a.opcoes.pasta, 'src/messages');
  assert.deepEqual(a.opcoes.locales, ['pt']);
  assert.equal(a.opcoes.localePadrao, 'pt');
});

test('next-intl sem request config reconhecível: não sobe, diz por quê', () => {
  const root = repo({ 'package.json': NEXT });
  const a = detectar(root);
  assert.equal(a.adapter, null);
  assert.match(a.motivo, /request config/);
});

test('HTML estático: cada página casa com o copy*.json que mais cobre as chaves dela', async () => {
  const root = repo({
    'package.json': { scripts: { 'copy:build': 'node scripts/copy.mjs build', 'tokens:build': 'node scripts/tokens.mjs build' } },
    'copy.json': { 'hero.titulo': 'A', 'hero.sub': 'B' },
    'copy.lote.json': { 'lote.titulo': 'C' },
    'index.html': '<h1 data-copy="hero.titulo">A</h1><p data-copy="hero.sub">B</p>',
    'lote.html': '<h1 data-copy="lote.titulo">C</h1>',
    'sem-copy.html': '<h1>nada</h1>',
    'styles.css': '.a{}',
    'tokens.json': { grupos: [] },
    'scripts/copy-lint.mjs': '',
  });
  const a = detectar(root);
  assert.equal(a.adapter, 'html-json');
  assert.deepEqual(a.opcoes, {
    paginas: [
      { copy: 'copy.json', html: 'index.html' },
      { copy: 'copy.lote.json', html: 'lote.html' },
    ],
    build: ['scripts/copy.mjs', 'build'],
    lint: 'scripts/copy-lint.mjs',
    css: 'styles.css',
    tokens: { arquivo: 'tokens.json', build: ['scripts/tokens.mjs', 'build'] },
  });
  assert.deepEqual(await importarConfig(a), { adapter: a.adapter, opcoes: a.opcoes });
});

test('nada reconhecido: oferece o migrar', () => {
  const root = repo({ 'package.json': { dependencies: { vite: '6' } }, 'index.html': '<h1>Oi</h1>' });
  const a = detectar(root);
  assert.equal(a.adapter, null);
  assert.match(a.motivo, /copy-edit migrar/);
});

const parar = (p) =>
  new Promise((r) => {
    if (p.exitCode !== null) return r();
    p.once('exit', r);
    p.kill();
  });

/* O bin de verdade: sem config, detecta, ESCREVE a config e sobe com ela. */
function rodarBin(root, args = []) {
  const p = spawn(process.execPath, [BIN, ...args], { cwd: root });
  let saida = '';
  const pronto = new Promise((ok, falha) => {
    p.stdout.on('data', (d) => {
      saida += d;
      if (/Editor de copy no ar/.test(saida) && /127\.0\.0\.1:(\d+)/.test(saida)) ok();
    });
    p.stderr.on('data', (d) => (saida += d));
    p.on('exit', (code) => falha(new Error(`saiu com ${code}: ${saida}`)));
  });
  return { p, pronto, saida: () => saida };
}

test('bin sem config: detecta, escreve copy-edit.config.mjs e sobe com ela; com config, ela manda', async () => {
  const root = repo({
    'package.json': {},
    'copy.json': { 'hero.titulo': 'A' },
    'index.html': '<html><body><h1 data-copy="hero.titulo">A</h1></body></html>',
  });
  const b = rodarBin(root);
  try {
    await b.pronto;
    assert.ok(existsSync(join(root, 'copy-edit.config.mjs')));
    assert.match(b.saida(), /Escrevi copy-edit\.config\.mjs/);
    const porta = b.saida().match(/127\.0\.0\.1:(\d+)/)[1];
    const r = await fetch(`http://127.0.0.1:${porta}/__copy/chaves?pagina=/`).then((x) => x.json());
    assert.equal(r.chaves['hero.titulo'], 'A');
  } finally {
    await parar(b.p);
  }

  /* Segunda subida: a config existe e não é reescrita (a detecção nem roda). */
  const escrita = readFileSync(join(root, 'copy-edit.config.mjs'), 'utf8');
  const b2 = rodarBin(root);
  try {
    await b2.pronto;
    assert.doesNotMatch(b2.saida(), /Escrevi/);
    assert.equal(readFileSync(join(root, 'copy-edit.config.mjs'), 'utf8'), escrita);
  } finally {
    await parar(b2.p);
    /* kill no Windows não roda o `exit` do processo: a tranca fica pra trás. */
    rmSync(caminhoTranca(root), { force: true });
  }
});

test('bin num repo sem formato reconhecido: não escreve config, sai com a mensagem do migrar', async () => {
  const root = repo({ 'package.json': {} });
  const p = spawn(process.execPath, [BIN], { cwd: root });
  let err = '';
  p.stderr.on('data', (d) => (err += d));
  const code = await new Promise((r) => p.on('exit', r));
  assert.equal(code, 1);
  assert.match(err, /copy-edit migrar/);
  assert.equal(existsSync(join(root, 'copy-edit.config.mjs')), false);
});
