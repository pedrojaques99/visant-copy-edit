/* O núcleo: as quatro coisas que os dois servidores antigos repetiam e que, se
   quebrarem, quebram calado (escrita cega, tranca, lint, fila). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
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
  assert.match(md, /- \[ \] `\/conta` `main > h1` · "Olá 'mundo'" · aumenta 'isso' aqui\n$/);
  assert.deepEqual(fila.ler(), [
    { feito: false, pagina: '/conta', seletor: 'main > h1', texto: "aumenta 'isso' aqui" },
  ]);
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
