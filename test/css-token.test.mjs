/* writers/css-token: os 13 testes da branch `editor-tokens` do Club, agora
   contra uma folha de mentira com o que o globals.css tem de difícil (comentário
   dentro do valor, `url()`, variável redeclarada dentro de regra) e um mapa de
   mentira no papel do tokens.map.json. O que era regra do Club (espelha,
   diverge, soDoClub) entra aqui pelos ganchos `origem` e `aoGravar`, que é
   exatamente como a config do Club liga o writer. */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listarTokens, salvarToken, estiloNaFila } from '../writers/css-token.mjs';

const FOLHA = `@import "tailwindcss";

@theme {
  --color-fg: #ededee;
  --color-muted: #8a8a8f; /* texto de apoio */
  --color-erro: #ff6b6b;
  --color-accent: #52ddeb;
  --font-sans: "Inter", sans-serif;
  --radius-sm: 4px;
}

:root {
  --dur-ceremony: 700ms; /* a entrada do certificado */
  --grao-toque: url("data:image/svg+xml;utf8,<svg/>");
}

.card {
  --lift: 2px;
  color: var(--color-fg);
}
`;

/* Mapa no formato do tokens.map.json do Club: linha em branco entre seções,
   que um JSON.stringify apagaria. */
const MAPA = `{
  "espelha": { "fg": "--color-fg" },

  "soDoClub": {
    "--color-erro": { "valor": "#ff6b6b", "porque": "erro do form" }
  }
}
`;

let dir, css, mapa, fila;
const ok = () => ({ code: 0, out: '' });

/* Os ganchos que a config do Club passa (ali leem o tokens.map.json real). */
const origem = (nome) => {
  const m = JSON.parse(readFileSync(mapa, 'utf8'));
  if (Object.values(m.espelha).includes('--' + nome)) return 'espelha';
  if (m.soDoClub['--' + nome]) return 'soDoClub';
  return 'club';
};
const aoGravar = ({ nome, origem: o, antes, depois }) => {
  if (o === 'espelha') return { erro: `--${nome} espelha a landing: troque lá.` };
  if (o !== 'soDoClub') return {};
  const bruto = readFileSync(mapa, 'utf8');
  return {
    arquivos: [
      {
        arquivo: mapa,
        conteudo: bruto.replace('"valor": ' + JSON.stringify(antes), '"valor": ' + JSON.stringify(depois)),
      },
    ],
  };
};
const ctx = (checar = ok) => ({ root: dir, css, origem, aoGravar, checar });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'copy-edit-tokens-'));
  css = join(dir, 'globals.css');
  mapa = join(dir, 'tokens.map.json');
  fila = join(dir, 'docs', 'COMENTARIOS-IA.md');
  writeFileSync(css, FOLHA);
  writeFileSync(mapa, MAPA);
});

describe('listarTokens', () => {
  test('devolve { grupo, nome, valor } sem o -- e sem comentário no valor', () => {
    const t = listarTokens({ css, origem });
    assert.deepEqual(
      t.find((k) => k.nome === 'color-fg'),
      { grupo: 'cor', nome: 'color-fg', valor: '#ededee', origem: 'espelha' }
    );
    assert.equal(t.find((k) => k.nome === 'color-muted').valor, '#8a8a8f');
    assert.equal(t.find((k) => k.nome === 'color-erro').origem, 'soDoClub');
    assert.equal(t.find((k) => k.nome === 'font-sans').grupo, 'fonte');
    /* Sem o gancho, a listagem é o contrato puro da barra. */
    assert.equal('origem' in listarTokens({ css })[0], false);
  });

  test('fica fora: valor com url() e variável redeclarada dentro de regra (estado local)', () => {
    const nomes = listarTokens({ css }).map((k) => k.nome);
    assert.ok(!nomes.includes('grao-toque'));
    assert.ok(!nomes.includes('lift'));
  });
});

describe('salvarToken', () => {
  test('troca só o valor na folha, mantém o comentário da linha', () => {
    const r = salvarToken({ nome: 'dur-ceremony', valor: '800ms' }, ctx());
    assert.deepEqual(r, { ok: true, antes: '700ms', depois: '800ms', arquivo: 'globals.css' });
    const depois = readFileSync(css, 'utf8');
    assert.ok(depois.includes('--dur-ceremony: 800ms; /* a entrada do certificado */'));
    assert.equal(depois.length, FOLHA.length);
  });

  test('o gancho grava outro arquivo junto (o soDoClub do Club), uma linha só', () => {
    const r = salvarToken({ nome: 'color-erro', valor: '#ff5555' }, ctx());
    assert.equal(r.arquivo, 'globals.css + tokens.map.json');
    assert.ok(readFileSync(css, 'utf8').includes('--color-erro: #ff5555;'));
    assert.equal(JSON.parse(readFileSync(mapa, 'utf8')).soDoClub['--color-erro'].valor, '#ff5555');
    const a = MAPA.split('\n');
    const b = readFileSync(mapa, 'utf8').split('\n');
    assert.equal(a.length, b.length);
    assert.equal(a.filter((l, i) => l !== b[i]).length, 1);
  });

  test('o gancho recusa (o espelha do Club), sem tocar no arquivo', () => {
    const r = salvarToken({ nome: 'color-fg', valor: '#ffffff' }, ctx());
    assert.match(r.erro, /espelha a landing/);
    assert.equal(readFileSync(css, 'utf8'), FOLHA);
  });

  test('recusa token que não existe e valor que fecha a declaração', () => {
    assert.match(salvarToken({ nome: 'color-roxo', valor: '#800080' }, ctx()).erro, /não existe/);
    for (const valor of ['', 'red; color: blue', '}', '<script>', 'a\nb', '1px /* x */', 'x'.repeat(201)]) {
      assert.equal(salvarToken({ nome: 'dur-ceremony', valor }, ctx()).erro, 'valor inválido', valor);
    }
  });

  test('portão reprovou: os dois arquivos voltam como estavam', () => {
    const r = salvarToken(
      { nome: 'color-erro', valor: '#52ddeb' },
      ctx(() => ({ code: 1, out: '✖ token: 1 divergência(s)\n  --color-erro: ...' }))
    );
    assert.match(r.erro, /portão de tokens reprovou/);
    assert.match(r.erro, /divergência/);
    assert.equal(readFileSync(css, 'utf8'), FOLHA);
    assert.equal(readFileSync(mapa, 'utf8'), MAPA);
  });

  test('portão como comando de shell e como args do node', () => {
    writeFileSync(join(dir, 'reprova.mjs'), "console.log('nao'); process.exit(1)\n");
    const r1 = salvarToken({ nome: 'radius-sm', valor: '6px' }, { root: dir, css, checar: ['reprova.mjs'] });
    assert.match(r1.erro, /reprovou, desfiz a troca: nao$/);
    const r2 = salvarToken({ nome: 'radius-sm', valor: '6px' }, { root: dir, css, checar: 'node -e "process.exit(0)"' });
    assert.equal(r2.ok, true);
    assert.ok(readFileSync(css, 'utf8').includes('--radius-sm: 6px;'));
  });
});

describe('estiloNaFila', () => {
  const cabecalho = '# Comentários pra IA\n';
  const chaveExiste = (k) => k === 'conta.perfil.titulo' || k === 'comum.menu.buscar';
  const paginaDe = (k) => (k.startsWith('comum.') ? '/' : '/' + k.split('.')[0]);
  const opts = () => ({ css, fila, cabecalho, chaveExiste, paginaDe });

  test('vira pedido na fila com a classe do Tailwind, e NÃO toca na folha', () => {
    const r = estiloNaFila(
      { seletor: '[data-copy="conta.perfil.titulo"]', prop: 'color', valor: 'var(--color-muted)' },
      opts()
    );
    assert.equal(r.ok, true);
    assert.equal(r.arquivo, 'docs/COMENTARIOS-IA.md');
    assert.equal(r.depois, 'color: var(--color-muted);');
    const md = readFileSync(fila, 'utf8');
    assert.ok(md.startsWith(cabecalho));
    assert.ok(md.includes('- [ ] `/conta` `[data-copy="conta.perfil.titulo"]` · estilo color: var(--color-muted)'));
    assert.ok(md.includes('`text-muted`'));
    assert.equal(readFileSync(css, 'utf8'), FOLHA);
  });

  test('aplicar de novo substitui o pedido aberto, e valor vazio apaga', () => {
    const sel = '[data-copy="conta.perfil.titulo"]';
    estiloNaFila({ seletor: sel, prop: 'color', valor: 'var(--color-muted)' }, opts());
    const r = estiloNaFila({ seletor: sel, prop: 'color', valor: 'var(--color-fg)' }, opts());
    assert.equal(r.antes, 'color: var(--color-muted);');
    assert.equal(readFileSync(fila, 'utf8').match(/estilo color:/g).length, 1);
    estiloNaFila({ seletor: sel, prop: 'max-width', valor: '12.5rem' }, opts());
    assert.equal(estiloNaFila({ seletor: sel, prop: 'max-width', valor: '20ch' }, opts()).antes, 'max-width: 12.5rem;');
    estiloNaFila({ seletor: sel, prop: 'color', valor: '' }, opts());
    const md = readFileSync(fila, 'utf8');
    assert.ok(!md.includes('estilo color:'));
    assert.ok(md.includes('estilo max-width: 20ch'));
  });

  test('chave compartilhada vai pra página que o repo diz (a raiz)', () => {
    estiloNaFila({ seletor: '[data-copy="comum.menu.buscar"]', prop: 'font-family', valor: 'var(--font-sans)' }, opts());
    assert.ok(readFileSync(fila, 'utf8').includes('- [ ] `/` `[data-copy="comum.menu.buscar"]` · estilo font-family'));
  });

  test('recusa classe, chave inexistente, propriedade fora da lista, cor solta e token que não existe', () => {
    const t = (d) => estiloNaFila(d, opts()).erro;
    assert.match(t({ seletor: '.text-fg', prop: 'color', valor: 'var(--color-muted)' }), /chave do texto/);
    assert.match(t({ seletor: '[data-copy="conta.nada"]', prop: 'color', valor: 'var(--color-muted)' }), /não mora/);
    const sel = '[data-copy="conta.perfil.titulo"]';
    assert.equal(t({ seletor: sel, prop: 'background', valor: 'var(--color-fg)' }), 'propriedade fora da lista');
    assert.equal(t({ seletor: sel, prop: 'color', valor: '#ff0000' }), 'valor inválido');
    assert.match(t({ seletor: sel, prop: 'color', valor: 'var(--color-roxo)' }), /não existe/);
    assert.match(t({ seletor: sel, prop: 'color', valor: 'var(--radius-sm)' }), /não é cor/);
    assert.equal(existsSync(fila), false);
  });

  test('a linha que grava é lida pelo mesmo formato do Alt+clique (barra lista na página)', () => {
    estiloNaFila({ seletor: '[data-copy="conta.perfil.titulo"]', prop: 'color', valor: 'var(--color-muted)' }, opts());
    const LINHA = /^- \[( |x)\] `([^`]*)` `([^`]*)`(?: · "([^"]*)")? · (.*)$/;
    const linhas = readFileSync(fila, 'utf8').split('\n').filter((l) => LINHA.test(l));
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].match(LINHA)[2], '/conta');
  });

  /* Pedido já feito ([x]) é histórico: não é substituído nem apagado. */
  test('não mexe em pedido marcado [x]', () => {
    const linhaFeita = '- [x] `/conta` `[data-copy="conta.perfil.titulo"]` · estilo color: var(--color-fg). feito\n';
    mkdirSync(join(dir, 'docs'));
    writeFileSync(fila, '# Comentários pra IA\n' + linhaFeita);
    estiloNaFila(
      { seletor: '[data-copy="conta.perfil.titulo"]', prop: 'color', valor: '' },
      { ...opts(), chaveExiste: () => true }
    );
    assert.ok(readFileSync(fila, 'utf8').includes(linhaFeita));
  });
});
