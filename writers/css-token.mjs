/* Token e estilo do editor: o que a barra manda pelos endpoints
 * /__copy/tokens, /__copy/token e /__copy/estilo, gravado num repo qualquer.
 *
 * Nasceu no Club (branch `editor-tokens`, scripts/copy-edit/tokens-estilo.mjs)
 * e virou genérico: o que era do Club (o tokens.map.json com espelha, diverge e
 * soDoClub) saiu daqui e entra pelos GANCHOS da config do repo. Aqui mora só o
 * que vale pra qualquer folha com `@theme {` ou `:root {` de topo.
 *
 * TOKEN
 *
 *   listarTokens()  lê os blocos de TOPO `@theme {` e `:root {` (coluna zero).
 *                   Regra aninhada que redeclara variável (o `--lift` de um
 *                   card) não é token, é estado local. Valor com `url(` (grão em
 *                   SVG inline) fica fora: não é escolha de paleta.
 *   salvarToken()   troca o VALOR de um token que já existe, e só ele: o
 *                   comentário da linha e o resto do arquivo ficam como estão.
 *                   Depois roda o portão do repo (comando na config); se
 *                   reprovar, TODO arquivo tocado volta como estava. Portão que
 *                   reprova depois do arquivo sujo deixa a árvore suja pra quem
 *                   nem sabe que o editor mexeu.
 *
 *   Ganchos (vêm da config do repo, todos opcionais):
 *     origem(nome)            rótulo de quem manda no token ('espelha', 'club'...);
 *                             vai na listagem e chega no aoGravar
 *     aoGravar({ nome, origem, antes, depois, root })
 *                             → { erro }  recusa sem tocar em nada
 *                             → { arquivos: [{ arquivo, conteudo }] }  grava
 *                               junto (e desfaz junto) outros arquivos que
 *                               guardam o mesmo valor
 *     checar                  o portão: string (comando de shell), array (args
 *                             do node) ou função () => { code, out }
 *
 * ESTILO, DOIS CAMINHOS
 *
 *   estiloNaFolha  HTML estático (visantismo): grava `prop: valor` na regra de
 *                  topo do seletor na folha do site. A classe existe no HTML
 *                  publicado, então o que o dono vê no editor é o que vai pro ar.
 *   estiloNaFila   app React com a ponte do stega (Club, sites de cliente): NÃO
 *                  grava CSS, vira pedido na fila docs/COMENTARIOS-IA.md. Ali o
 *                  `data-copy` só existe com o editor ligado (a ponte põe depois
 *                  da hidratação; em produção o HTML não tem), e o elemento só
 *                  tem utilitário do Tailwind. Uma regra `[data-copy="x"]` na
 *                  folha mudaria a tela do editor e NADA em produção: o dono
 *                  aprovaria o que vê, e o que vê não iria pro ar. O conserto real
 *                  é trocar a classe no componente, e isso é código com commit.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join, relative } from 'node:path';

/* ── leitura ───────────────────────────────────────────────────────────── */

const BLOCO = /^(@theme|:root)\s*\{\r?\n([\s\S]*?)^\}/gm;
const DECL = /^[ \t]*(--[a-z0-9-]+)[ \t]*:[ \t]*([^;]*);/gim;

function declaracoes(css) {
  const achadas = [];
  for (const b of css.matchAll(BLOCO)) {
    const inicioCorpo = b.index + b[0].indexOf(b[2]);
    for (const d of b[2].matchAll(DECL)) {
      const fimValor = inicioCorpo + d.index + d[0].length - 1;
      achadas.push({ nome: d[1].slice(2), bruto: d[2], ini: fimValor - d[2].length, fim: fimValor });
    }
  }
  return achadas;
}

const limpo = (v) => v.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();

export function grupoDe(nome) {
  if (nome.startsWith('color-')) return 'cor';
  if (nome.startsWith('font-')) return 'fonte';
  if (nome.startsWith('radius')) return 'raio';
  if (/^(ease|dur)-/.test(nome)) return 'movimento';
  return 'outros';
}

const abs = (root, p) => (isAbsolute(p) ? p : join(root, p));
const rel = (root, p) => relative(root, p).replace(/\\/g, '/');

/* `{ grupo, nome, valor }` é o contrato da barra (nome sem `--`, ela monta o
   `var(--nome)`). `origem` vai a mais quando o repo tem o gancho: a barra
   ignora, e quem chama o endpoint à mão sabe antes de tentar. A última
   declaração vence, igual à cascata. */
export function listarTokens({ css, origem }) {
  const porNome = new Map();
  for (const d of declaracoes(readFileSync(css, 'utf8'))) porNome.set(d.nome, limpo(d.bruto));
  return [...porNome]
    .filter(([, valor]) => !valor.includes('url('))
    .map(([nome, valor]) => {
      const t = { grupo: grupoDe(nome), nome, valor };
      if (origem) t.origem = origem(nome);
      return t;
    });
}

/* ── token ─────────────────────────────────────────────────────────────── */

/* O portão do repo. String roda no shell (é o que a pessoa escreveria no
   terminal), array é `node <args>`, função é pro teste. Sem portão, passa. */
export function rodarPortao(root, checar) {
  if (!checar) return { code: 0, out: '' };
  if (typeof checar === 'function') return checar();
  const r = Array.isArray(checar)
    ? spawnSync(process.execPath, checar, { cwd: root, encoding: 'utf8' })
    : spawnSync(checar, { cwd: root, encoding: 'utf8', shell: true });
  return { code: r.status, out: (r.stderr || '') + (r.stdout || '') };
}

export function salvarToken(dados, { root, css, origem, aoGravar, checar }) {
  const nome = String(dados.nome || '').replace(/^--/, '');
  const valor = String(dados.valor || '').trim();
  const arqCss = rel(root, css);
  /* Mesmas guardas do visantismo, mais quebra de linha e comentário: o valor
     entra no meio de uma declaração e não pode fechar nem abrir outra. */
  if (!valor || /[;{}<>\r\n]|\/\*/.test(valor) || valor.length > 200) return { erro: 'valor inválido' };

  const cssAntes = readFileSync(css, 'utf8');
  const alvo = declaracoes(cssAntes)
    .filter((d) => d.nome === nome)
    .at(-1);
  if (!alvo) return { erro: `token --${nome} não existe no ${arqCss}` };
  const antes = limpo(alvo.bruto);
  if (antes === valor) return { ok: true, arquivo: arqCss, antes, depois: valor };

  const quem = origem ? origem(nome) : undefined;
  const extra = aoGravar ? aoGravar({ nome, origem: quem, antes, depois: valor, root }) || {} : {};
  if (extra.erro) return { erro: extra.erro };

  /* Foto de tudo que vai ser tocado ANTES de escrever qualquer coisa: o
     desfazer restaura a foto, não tenta recalcular o valor antigo. */
  const outros = (extra.arquivos || []).map((a) => ({ ...a, caminho: abs(root, a.arquivo) }));
  const fotos = [[css, cssAntes], ...outros.map((a) => [a.caminho, readFileSync(a.caminho, 'utf8')])];
  const desfazer = () => fotos.forEach(([p, t]) => writeFileSync(p, t));

  writeFileSync(css, cssAntes.slice(0, alvo.ini) + valor + cssAntes.slice(alvo.fim));
  for (const a of outros) writeFileSync(a.caminho, a.conteudo);

  const r = rodarPortao(root, checar);
  if (r.code !== 0) {
    desfazer();
    const motivo = String(r.out || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(' · ');
    return { erro: 'o portão de tokens reprovou, desfiz a troca: ' + motivo };
  }
  return {
    ok: true,
    arquivo: [arqCss, ...outros.map((a) => rel(root, a.caminho))].join(' + '),
    antes,
    depois: valor,
  };
}

/* ── estilo ────────────────────────────────────────────────────────────── */

/* A lista fechada. Cor e fonte só entram como token: a amostra do editor é a
   paleta da marca, não um hex solto. Um editor visual que escreve CSS
   arbitrário vira gerador de regra morta. */
export const PROPS_ESTILO = {
  'max-width': /^\d{1,4}(\.\d+)?(px|ch|rem|em|%|vw)$/,
  color: /^var\(--[a-z0-9-]+\)$/i,
  'font-family': /^var\(--font-[a-z0-9-]+\)$/i,
  'font-size': /^var\(--[a-z0-9-]+\)$/i,
};

/* .classe, ou [data-copy="chave"] pro texto que não tem classe. */
const SELETOR_FOLHA = /^(\.[a-z][a-z0-9-]*|\[data-copy="[a-z0-9._-]+"\])$/i;

/* Grava na PRIMEIRA regra de topo `seletor {` da folha (a de base, fora de
   @media). Sem regra de topo pro seletor, nasce uma no fim do arquivo. Valor
   vazio remove a declaração: é o desfazer de quem não tinha a propriedade. */
export function estiloNaFolha(dados, { root, css }) {
  const arq = rel(root, css);
  const seletor = String(dados.seletor || (dados.classe ? '.' + dados.classe : ''));
  const prop = String(dados.prop || '');
  const valor = String(dados.valor || '');
  if (!SELETOR_FOLHA.test(seletor)) return { erro: 'seletor inválido' };
  if (!PROPS_ESTILO[prop]) return { erro: 'propriedade fora da lista' };
  if (valor && !PROPS_ESTILO[prop].test(valor)) return { erro: 'valor inválido' };
  const texto = readFileSync(css, 'utf8');
  const nl = texto.includes('\r\n') ? '\r\n' : '\n';
  const esc = seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = texto.match(new RegExp('^' + esc + ' \\{\\r?\\n([\\s\\S]*?)^\\}', 'm'));
  if (!m) {
    if (!valor) return { ok: true, arquivo: arq, antes: '', depois: '' };
    const sep = texto.endsWith(nl) ? '' : nl;
    writeFileSync(css, texto + sep + `${seletor} {${nl}  ${prop}: ${valor};${nl}}${nl}`);
    return { ok: true, arquivo: arq, antes: '', depois: `${prop}: ${valor};` };
  }
  const decl = new RegExp('^(\\s*)' + prop + ':[^;]*;', 'm');
  const corpo = !valor
    ? m[1].replace(new RegExp('^\\s*' + prop + ':[^;]*;\\r?\\n', 'm'), '')
    : decl.test(m[1])
      ? m[1].replace(decl, `$1${prop}: ${valor};`)
      : m[1] + `  ${prop}: ${valor};${nl}`;
  const antes = (m[1].match(decl) || [''])[0].trim();
  writeFileSync(css, texto.replace(m[0], `${seletor} {${nl}${corpo}}`));
  return { ok: true, arquivo: arq, antes, depois: valor ? `${prop}: ${valor};` : '' };
}

const SELETOR_CHAVE = /^\[data-copy="([A-Za-z0-9._-]+)"\]$/;

/* O utilitário do Tailwind que o componente deve ganhar, quando existe um
   óbvio: é o que a IA vai escrever no className. */
function classeTailwind(prop, nome) {
  if (prop === 'color' && nome.startsWith('color-')) return 'text-' + nome.slice(6);
  if (prop === 'font-family' && nome.startsWith('font-')) return nome;
  return '';
}

/* `fila` é o docs/COMENTARIOS-IA.md; `cabecalho` é o mesmo do Alt+clique;
   `chaveExiste(chave)` diz se a chave mora na copy; `paginaDe(chave)` diz em
   que rota a barra lista o pedido (é onde ela lista os comentários);
   `css` (opcional) valida o token do var(). */
export function estiloNaFila(dados, { css, fila, cabecalho = '', chaveExiste, paginaDe }) {
  const seletor = String(dados.seletor || '');
  const prop = String(dados.prop || '');
  const valor = String(dados.valor || '').trim();
  const s = seletor.match(SELETOR_CHAVE);
  if (!s) {
    return {
      erro:
        `aqui o estilo vai pela chave do texto ([data-copy="..."]), e veio "${seletor || 'nada'}". ` +
        'Classe aqui é utilitário do Tailwind, que serve a dezenas de elementos. Alt+clique e peça pra IA.',
    };
  }
  const chave = s[1];
  if (!chaveExiste(chave)) return { erro: `chave "${chave}" não mora na copy deste repo` };
  if (!PROPS_ESTILO[prop]) return { erro: 'propriedade fora da lista' };
  if (valor && !PROPS_ESTILO[prop].test(valor)) return { erro: 'valor inválido' };

  let token = '';
  if (valor.startsWith('var(')) {
    token = valor.slice(6, -1);
    if (css) {
      const t = listarTokens({ css }).find((k) => k.nome === token);
      if (!t) return { erro: `token --${token} não existe na folha` };
      if (prop === 'color' && t.grupo !== 'cor') return { erro: `--${token} não é cor` };
    }
  }

  const pagina = paginaDe ? paginaDe(chave) : '/';
  const cabeca = `- [ ] \`${pagina}\` \`${seletor}\` · estilo ${prop}:`;
  const classe = token ? classeTailwind(prop, token) : '';
  const linha = valor
    ? `${cabeca} ${valor}` +
      (classe ? ` (no componente, a classe \`${classe}\` no lugar da de ${prop} atual)` : '') +
      '. Mude o className do elemento desta chave, não a folha de estilo.\n'
    : '';

  /* Um pedido por chave e propriedade: aplicar de novo SUBSTITUI o pedido
     aberto, e valor vazio (o desfazer da barra) apaga. Pedido já feito ([x])
     fica, é histórico. */
  const atual = existsSync(fila) ? readFileSync(fila, 'utf8') : cabecalho;
  const linhas = atual.split(/(?<=\n)/);
  const i = linhas.findIndex((l) => l.startsWith(cabeca));
  const antes = i >= 0 ? (linhas[i].slice(cabeca.length).match(/^ (\S+?)[.]? /) || ['', ''])[1] : '';
  if (i >= 0) linhas.splice(i, 1, linha);
  else if (linha) linhas.push((linhas.at(-1)?.endsWith('\n') || !linhas.at(-1) ? '' : '\n') + linha);
  else return { ok: true, arquivo: 'docs/COMENTARIOS-IA.md', antes: '', depois: '' };
  mkdirSync(dirname(fila), { recursive: true });
  writeFileSync(fila, linhas.join(''));
  return {
    ok: true,
    arquivo: 'docs/COMENTARIOS-IA.md',
    antes: antes ? `${prop}: ${antes};` : '',
    depois: valor ? `${prop}: ${valor};` : '',
    fila: true,
  };
}
