/* O núcleo: as quatro coisas que os dois servidores antigos repetiam e que, se
   quebrarem, quebram calado (escrita cega, tranca, lint, fila). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  guardaEscritaCega,
  trancar,
  caminhoTranca,
  parseLint,
  filaComentarios,
  lerCorpo,
  normalizarValor,
} from '../server/nucleo.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'copy-edit-teste-'));

test('guarda de escrita cega: recusa quando o disco mudou, deixa o desfazer passar', () => {
  assert.equal(guardaEscritaCega('a.b', 'igual', 'igual'), null);
  assert.equal(guardaEscritaCega('a.b', 'disco', undefined), null);
  const erro = guardaEscritaCega('a.b', 'disco', 'tela');
  assert.match(erro, /mudou no disco/);
  assert.match(erro, /no disco: disco/);
  assert.match(erro, /na tela: {2}tela/);
});

test('tranca: segundo editor vivo no mesmo repo não sobe; PID morto não trava', () => {
  const pasta = tmp();
  const root = 'Z:\\repo\\de-teste';
  /* O nome é o mesmo dos dois servidores antigos: sha1 da raiz, 12 hex. */
  assert.match(caminhoTranca(root, pasta), /visant-copy-edit-[0-9a-f]{12}\.pid$/);

  const a = trancar(root, { pasta, pid: process.pid });
  assert.equal(a.ok, true);
  /* Outro processo (PID diferente) com o dono vivo: recusado. */
  const b = trancar(root, { pasta, pid: process.pid + 1 });
  assert.equal(b.ok, false);
  assert.equal(b.dono, process.pid);
  a.soltar();
  assert.equal(existsSync(caminhoTranca(root, pasta)), false);

  /* Tranca de um PID que não existe mais (kill -9, terminal fechado) não segura ninguém. */
  writeFileSync(caminhoTranca(root, pasta), '999999');
  const c = trancar(root, { pasta, pid: process.pid });
  assert.equal(c.ok, true);
  c.soltar();
});

test('parse do copy-lint: regra, chave e conserto; prefixo de rota', () => {
  const saida = [
    'copy/conta.json',
    '  travessao              perfil.titulo',
    '    Uma frase — com travessão',
    '    ↑ casou: "—"',
    '  nao-e-x-e-y            perfil.sub',
    '',
    'Como consertar:',
    '  travessao: troca por vírgula ou ponto',
    '  nao-e-x-e-y: diz o que é, sem o contraste',
  ].join('\n');
  assert.deepEqual(parseLint(saida), [
    { regra: 'travessao', chave: 'perfil.titulo', conserto: 'troca por vírgula ou ponto' },
    { regra: 'nao-e-x-e-y', chave: 'perfil.sub', conserto: 'diz o que é, sem o contraste' },
  ]);
  assert.equal(parseLint(saida, 'conta')[0].chave, 'conta.perfil.titulo');
  assert.deepEqual(parseLint('✔ nada'), []);
});

test('fila de comentários: mesmo formato, lê de volta, sem crase e sem chave invisível', () => {
  const root = tmp();
  const fila = filaComentarios(root, {
    dica: 'Dica do repo.',
    limpar: (t) => t.replace(/\u200b/g, ''),
  });
  assert.deepEqual(fila.comentar({ texto: '', seletor: 'x' }), { erro: 'comentário vazio' });
  const r = fila.comentar({
    pagina: '/conta',
    seletor: 'main > h1',
    trecho: 'Olá "mundo"\u200b',
    texto: 'aumenta `isso`\n  aqui',
  });
  assert.equal(r.ok, true);
  const md = readFileSync(join(root, 'docs', 'COMENTARIOS-IA.md'), 'utf8');
  assert.match(md, /^# Comentários pra IA/);
  assert.match(md, /Dica do repo\./);
  assert.match(md, /- \[ \] #1 `\/conta` `main > h1` · "Olá 'mundo'" · aumenta 'isso' aqui\n$/);
  assert.equal(r.id, 1);
  assert.deepEqual(fila.ler(), [
    {
      id: 1,
      estado: 'aberto',
      feito: false,
      pagina: '/conta',
      seletor: 'main > h1',
      pos: null,
      trecho: "Olá 'mundo'",
      texto: "aumenta 'isso' aqui",
      respostas: [],
    },
  ]);
});

test('fila v3: thread, status, e linha antiga sem número continua valendo', () => {
  const root = tmp();
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(
    join(root, 'docs', 'COMENTARIOS-IA.md'),
    '# Comentários pra IA\n\nTexto livre.\n\n' +
      '- [ ] `/` `h1` · "Oi" · troca o título\n' +
      '- [x] `/` `p` · menor\n'
  );
  const fila = filaComentarios(root);
  assert.deepEqual(
    fila.ler().map((c) => [c.id, c.feito]),
    [
      [1, false],
      [2, true],
    ]
  );

  assert.equal(fila.comentar({ pagina: '/', seletor: 'footer', texto: 'mais respiro' }).id, 3);
  assert.deepEqual(fila.responder({ id: 99, texto: 'x' }), { erro: 'comentário #99 não existe' });
  fila.responder({ id: 1, autor: 'ia', texto: 'troquei para "Bem-vindo"' });
  fila.responder({ id: 1, texto: 'curto demais, volta' });
  fila.status({ id: 1, feito: true, autor: 'ia', texto: 'feito no pt-BR.json' });
  fila.status({ id: 2, feito: false });

  const md = readFileSync(join(root, 'docs', 'COMENTARIOS-IA.md'), 'utf8');
  assert.match(md, /^# Comentários pra IA\n\nTexto livre\.\n\n- \[x\] #1 /);
  assert.match(md, /#1 `\/` `h1` · "Oi" · troca o título\n {2}- ia: troquei/);
  assert.match(md, / {2}- designer: curto demais, volta\n {2}- ia: feito no pt-BR\.json\n- \[ \] #2 /);
  const [c1, c2, c3] = fila.ler();
  assert.equal(c1.feito, true);
  assert.equal(c1.respostas.length, 3);
  assert.equal(c2.feito, false);
  assert.equal(c3.texto, 'mais respiro');
});


test('corpo: acento partido entre dois pedaços não vira U+FFFD', async () => {
  const bytes = Buffer.from(JSON.stringify({ valor: 'você ação' }), 'utf8');
  const meio = bytes.indexOf(Buffer.from('ê')) + 1; // corta no meio do "ê"
  const req = Readable.from([bytes.subarray(0, meio), bytes.subarray(meio)]);
  assert.deepEqual(await lerCorpo(req), { valor: 'você ação' });
});

test('valor: \\r e espaço no fim de linha saem', () => {
  assert.equal(normalizarValor('a  \r\nb\t'), 'a\nb');
});

test('cliente: a barra parseia como script e a ponte como módulo', () => {
  const barra = fileURLToPath(new URL('../client/barra.js', import.meta.url));
  assert.doesNotThrow(() => new vm.Script(readFileSync(barra, 'utf8'), { filename: barra }));
  const ponte = fileURLToPath(new URL('../client/ponte-stega.js', import.meta.url));
  const r = spawnSync(process.execPath, ['--check', ponte], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('fila v3.1: pin no ponto, agente lendo vira lido, editar e apagar', () => {
  const root = tmp();
  const fila = filaComentarios(root);
  const a = fila.comentar({ pagina: '/', seletor: 'h1', texto: 'menor', pos: { x: 42.4, y: 180 } });
  fila.comentar({ pagina: '/', seletor: 'p', texto: 'mais leve' });
  let md = readFileSync(join(root, 'docs', 'COMENTARIOS-IA.md'), 'utf8');
  assert.match(md, /- \[ \] #1 `\/` `h1` @42,100 · menor\n/);
  assert.deepEqual(a.comentario.pos, { x: 42, y: 100 });

  // a barra lendo não muda nada; o agente lendo marca os abertos como lidos
  assert.deepEqual(fila.ler().map((c) => c.estado), ['aberto', 'aberto']);
  assert.deepEqual(fila.ler({ agente: true }).map((c) => c.estado), ['lido', 'lido']);
  md = readFileSync(join(root, 'docs', 'COMENTARIOS-IA.md'), 'utf8');
  assert.match(md, /- \[~\] #1 `\/` `h1` @42,100 · menor\n/);

  // designer edita: volta pra aberto (o agente precisa ler de novo)
  fila.editar({ id: 1, texto: 'bem menor' });
  assert.deepEqual(
    fila.ler().map((c) => [c.id, c.estado, c.texto]),
    [
      [1, 'aberto', 'bem menor'],
      [2, 'lido', 'mais leve'],
    ]
  );
  // designer responde num lido: volta pra aberto; o agente responde e não mexe
  fila.responder({ id: 2, autor: 'ia', texto: 'fazendo' });
  assert.equal(fila.ler()[1].estado, 'lido');
  fila.responder({ id: 2, texto: 'e tira o negrito' });
  assert.equal(fila.ler()[1].estado, 'aberto');

  fila.status({ id: 2, estado: 'feito', autor: 'ia' });
  assert.equal(fila.ler()[1].feito, true);
  fila.status({ id: 2, feito: false });
  assert.equal(fila.ler()[1].estado, 'aberto');

  assert.deepEqual(fila.apagar({ id: 1 }), { ok: true, id: 1 });
  assert.deepEqual(fila.ler().map((c) => c.id), [2]);
  assert.equal(fila.comentar({ seletor: 'x', texto: 'y' }).id, 3);
});
