/* Os dois adapters gravando num repo de mentira em diretório temporário,
   pelo servidor de verdade (HTTP em 127.0.0.1), que é o caminho da barra. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vercelStegaCombine } from '@vercel/stega';
import { criarServidor } from '../server/nucleo.mjs';
import { criar as htmlJson } from '../adapters/html-json.mjs';
import { criar as nextIntl } from '../adapters/next-intl.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'copy-edit-repo-'));

/* Um lint de mentira com a mesma saída do copy-lint da skill: acusa travessão. */
const LINT = `import { readFileSync } from 'node:fs';
const arq = process.argv[2];
const plano = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
  typeof v === 'string' ? [[p + k, v]] : plano(v, p + k + '.'));
const ruins = plano(JSON.parse(readFileSync(arq, 'utf8'))).filter(([, v]) => v.includes('—'));
if (!ruins.length) process.exit(0);
for (const [k] of ruins) console.log('  travessao              ' + k);
console.log('Como consertar:');
console.log('  travessao: troca por vírgula');
process.exit(1);
`;

async function subir(root, adapter) {
  const server = criarServidor(root, adapter);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, corpo) =>
    fetch(base + url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    }).then(async (r) => ({ status: r.status, corpo: await r.json() }));
  return { base, post, fechar: () => new Promise((r) => server.close(r)) };
}

test('html-json: salva no copy.json, roda o build, devolve o lint; injeta a barra', async () => {
  const root = tmp();
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, 'copy.json'), JSON.stringify({ 'hero.titulo': 'Velho', 'hero.sub': 'Sub' }, null, 2) + '\n');
  writeFileSync(join(root, 'index.html'), '<html><body><h1 data-copy="hero.titulo">Velho</h1></body></html>');
  writeFileSync(join(root, 'scripts', 'lint.mjs'), LINT);
  /* O "build" de mentira regera o HTML a partir do JSON, como o copy:build. */
  writeFileSync(
    join(root, 'scripts', 'build.mjs'),
    `import { readFileSync, writeFileSync } from 'node:fs';
const c = JSON.parse(readFileSync('copy.json', 'utf8'));
writeFileSync('index.html', '<html><body><h1 data-copy="hero.titulo">' + c['hero.titulo'] + '</h1></body></html>');
`
  );
  writeFileSync(join(root, 'styles.css'), '.hero {\n  color: red;\n}\n');
  const adapter = htmlJson(root, {
    paginas: [{ copy: 'copy.json', html: 'index.html' }],
    build: ['scripts/build.mjs'],
    lint: 'scripts/lint.mjs',
    css: 'styles.css',
  });
  const s = await subir(root, adapter);
  try {
    const html = await fetch(s.base + '/').then((r) => r.text());
    assert.match(html, /<script src="\/__copy\/editor.js" defer><\/script>\n<\/body>/);
    assert.doesNotMatch(await fetch(s.base + '/?ce=preview').then((r) => r.text()), /__copy/);
    const barra = await fetch(s.base + '/__copy/editor.js');
    assert.equal(barra.status, 200);
    assert.match(await barra.text(), /ce-barra/);

    const chaves = await fetch(s.base + '/__copy/chaves?pagina=/').then((r) => r.json());
    assert.equal(chaves.chaves['hero.titulo'], 'Velho');

    /* Escrita cega: a tela tinha outro valor. Nada é gravado. */
    const cega = await s.post('/__copy/salvar', { pagina: '/', chave: 'hero.titulo', valor: 'X', antes: 'Outro' });
    assert.equal(cega.status, 400);
    assert.match(cega.corpo.erro, /mudou no disco/);

    const r = await s.post('/__copy/salvar', { pagina: '/', chave: 'hero.titulo', valor: 'Novo — já', antes: 'Velho' });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.ok, true);
    assert.deepEqual(r.corpo.lint, [{ regra: 'travessao', chave: 'hero.titulo', conserto: 'troca por vírgula' }]);
    /* Diff de UMA linha: a ordem e o formato do JSON sobrevivem. */
    assert.equal(
      readFileSync(join(root, 'copy.json'), 'utf8'),
      JSON.stringify({ 'hero.titulo': 'Novo — já', 'hero.sub': 'Sub' }, null, 2) + '\n'
    );
    assert.match(readFileSync(join(root, 'index.html'), 'utf8'), />Novo — já</);

    assert.equal((await s.post('/__copy/salvar', { pagina: '/nada', chave: 'x', valor: 'y' })).status, 404);
    assert.equal((await s.post('/__copy/salvar', { pagina: '/', chave: 'nao.existe', valor: 'y' })).status, 400);

    /* Estilo: só seletor e propriedade da lista. */
    assert.equal((await s.post('/__copy/estilo', { seletor: '.text-sm', prop: 'position', valor: 'x' })).status, 400);
    const e = await s.post('/__copy/estilo', { seletor: '.hero', prop: 'max-width', valor: '40ch' });
    assert.equal(e.status, 200);
    assert.equal(readFileSync(join(root, 'styles.css'), 'utf8'), '.hero {\n  color: red;\n  max-width: 40ch;\n}\n');
    const k = await s.post('/__copy/estilo', { seletor: '[data-copy="hero.titulo"]', prop: 'max-width', valor: '20ch' });
    assert.equal(k.status, 200);
    assert.match(readFileSync(join(root, 'styles.css'), 'utf8'), /\[data-copy="hero.titulo"\] \{\n {2}max-width: 20ch;\n\}\n$/);

    /* Caminho vindo da rede não sai da raiz. */
    const fora = await fetch(s.base + '/..%2f..%2fetc%2fpasswd');
    assert.notEqual(fora.status, 200);
  } finally {
    await s.fechar();
  }
});

test('next-intl: chave do stega vira caminho no JSON aninhado, com \\r\\n preservado', async () => {
  const root = tmp();
  mkdirSync(join(root, 'copy'));
  mkdirSync(join(root, 'scripts'));
  writeFileSync(join(root, 'scripts', 'lint.mjs'), LINT);
  const conta = { pagina: { titulo: 'Sua conta', sub: 'Dados' } };
  writeFileSync(join(root, 'copy', 'conta.json'), (JSON.stringify(conta, null, 2) + '\n').replace(/\n/g, '\r\n'));
  writeFileSync(join(root, 'copy', 'comum.json'), JSON.stringify({ menu: { buscar: 'Buscar' } }, null, 2) + '\n');
  const adapter = nextIntl(root, {
    pasta: 'copy',
    compartilhados: ['comum'],
    lint: 'scripts/lint.mjs',
    dev: false,
  });
  const s = await subir(root, adapter);
  try {
    const ch = await fetch(s.base + '/__copy/chaves?pagina=/conta').then((r) => r.json());
    assert.equal(ch.arquivo, 'copy/conta.json');
    assert.equal(ch.chaves['conta.pagina.titulo'], 'Sua conta');
    assert.equal(ch.chaves['comum.menu.buscar'], 'Buscar');
    /* Rota sem JSON próprio cai no compartilhado; sem nada, arquivo null (a ponte não sobe). */
    assert.equal((await fetch(s.base + '/__copy/chaves?pagina=/entrar').then((r) => r.json())).arquivo, 'copy/comum.json');

    for (const f of ['/__copy/ponte-stega.js', '/__copy/stega.mjs', '/__copy/editor.css']) {
      assert.equal((await fetch(s.base + f)).status, 200, f);
    }

    /* A tela manda texto e `antes` com a chave invisível junto. */
    const sujo = vercelStegaCombine('Sua conta', { k: 'conta.pagina.titulo' });
    const r = await s.post('/__copy/salvar', {
      pagina: '/conta',
      chave: 'conta.pagina.titulo',
      antes: sujo,
      valor: vercelStegaCombine('Tua conta — já', { k: 'conta.pagina.titulo' }),
    });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.valor, 'Tua conta — já');
    assert.deepEqual(r.corpo.lint, [{ regra: 'travessao', chave: 'conta.pagina.titulo', conserto: 'troca por vírgula' }]);
    const disco = readFileSync(join(root, 'copy', 'conta.json'), 'utf8');
    assert.equal(
      disco,
      (JSON.stringify({ pagina: { titulo: 'Tua conta — já', sub: 'Dados' } }, null, 2) + '\n').replace(/\n/g, '\r\n')
    );

    const cega = await s.post('/__copy/salvar', { chave: 'conta.pagina.sub', antes: 'Outro', valor: 'x' });
    assert.equal(cega.status, 400);
    assert.match(cega.corpo.erro, /mudou no disco/);
    assert.equal((await s.post('/__copy/salvar', { chave: 'conta.pagina', valor: 'x' })).status, 400);
    assert.equal((await s.post('/__copy/salvar', { chave: '../x.y', valor: 'x' })).status, 400);

    /* Token e estilo ainda não gravam aqui: responde como o servidor antigo do Club. */
    assert.equal((await s.post('/__copy/estilo', { seletor: '[data-copy="conta.pagina.titulo"]', prop: 'max-width', valor: '20ch' })).status, 400);
    assert.deepEqual(await fetch(s.base + '/__copy/tokens').then((r) => r.json()), { tokens: [] });

    /* Comentário sai sem a chave invisível. */
    const c = await s.post('/__copy/comentar', { pagina: '/conta', seletor: 'h1', trecho: sujo, texto: 'maior' });
    assert.equal(c.status, 200);
    assert.match(readFileSync(join(root, 'docs', 'COMENTARIOS-IA.md'), 'utf8'), /· "Sua conta" · maior\n$/);
  } finally {
    await s.fechar();
  }
});
