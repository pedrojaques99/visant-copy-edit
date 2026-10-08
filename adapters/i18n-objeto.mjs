/* Adapter de repo com i18n PRÓPRIO: a copy mora em arquivos de idioma que
 * exportam objeto, e o editor trabalha em cima deles sem converter nada pra
 * next-intl. Os dois casos reais:
 *
 *   objeto TS/JS   locales/pt-br.ts + locales/en.ts (`export const messages = {}`),
 *                  lidos por um provider do repo (o `useI18n()` do visant-board)
 *   i18next        public/locales/<idioma>/<namespace>.json (ou locales/<idioma>.json),
 *                  e a 1ª parte da chave é o namespace (`common.title`)
 *
 * COMO A CHAVE CHEGA NA TELA
 *
 * O provider do repo passa as mensagens pelo `marcarLocales` (trecho que o
 * `copy-edit ligar` escreve no repo, ver server/marcar.mjs): com o editor
 * ligado, cada texto leva escondido `{ k: chave, l: idioma }`. A ponte
 * (client/ponte-stega.js) põe `data-copy` + `data-copy-l` no elemento e diz à
 * barra o idioma da página; o save chega aqui com `locale`, e é ele que escolhe
 * o arquivo. Sem `locale` (barra velha), vale o `localePadrao`.
 *
 * Ao salvar: troca SÓ o literal daquela chave no arquivo daquele idioma
 * (writers/objeto.mjs, diff de uma linha), com a guarda de escrita cega. Chave
 * que não existe é recusada, como nos outros adapters: chave nasce no código.
 *
 * O QUE É DO REPO (copy-edit.config.mjs, ou a detecção)
 *
 *   locales        { idioma: arquivo | pasta }   arquivo = um objeto por idioma;
 *                                                pasta = um JSON por namespace
 *   localePadrao   o idioma do texto escrito no JSX (o `migrar` grava nele) e o
 *                  do save que chega sem idioma
 *   exportar       (TS) qual export é o objeto: 'messages', 'default'... (o
 *                  default do arquivo, senão o primeiro objeto exportado)
 *   acessor        (só o migrar) como o componente lê a copy, ver migrar/
 *   lint           script do copy-lint (padrão: o do pacote; false desliga).
 *                  Roda nos idiomas de `lintLocales` (padrão: só o padrão, que é
 *                  a voz da casa em pt-BR; o lint não sabe inglês)
 *   tokens         { css, checar, origem, aoGravar } (writers/css-token.mjs)
 *   porta, portaDev, dev, rotaInicial   como no next-intl
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { vercelStegaClean } from '@vercel/stega';
import { guardaEscritaCega, normalizarValor, rodarLint, cabecalhoComentarios, subirNextDev } from '../server/nucleo.mjs';
import { lerObjeto, trocarValor, achatar } from '../writers/objeto.mjs';
import { listarTokens, salvarToken, estiloNaFila } from '../writers/css-token.mjs';

const ehPasta = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

export function criar(root, op = {}) {
  const LOCALES = op.locales || {};
  const IDIOMAS = Object.keys(LOCALES);
  if (!IDIOMAS.length) throw new Error('i18n-objeto: falta `locales` na config ({ idioma: arquivo | pasta })');
  const PADRAO = op.localePadrao && LOCALES[op.localePadrao] ? op.localePadrao : IDIOMAS[0];
  const LINT_EM = op.lintLocales || [PADRAO];

  const idiomaDe = (l) => (l && LOCALES[l] ? l : null);

  /* Os arquivos de um idioma: [{ rel, abs, ns }]. Pasta = um JSON por
     namespace (i18next), e o namespace vira a 1ª parte da chave. */
  function arquivosDe(locale) {
    const rel = LOCALES[locale];
    const abs = join(root, rel);
    if (ehPasta(abs)) {
      return readdirSync(abs)
        .filter((f) => /\.(json|ts|js|mjs)$/.test(f))
        .sort()
        .map((f) => ({ rel: `${rel}/${f}`, abs: join(abs, f), ns: f.replace(/\.\w+$/, '') }));
    }
    return existsSync(abs) ? [{ rel, abs, ns: null }] : [];
  }

  function ler(arq) {
    const lido = lerObjeto(readFileSync(arq.abs, 'utf8'), arq.rel, { exportar: op.exportar });
    if (lido.erro) throw new Error(lido.erro);
    return lido;
  }

  /* Onde mora a chave naquele idioma: { arq, caminho } ou null. */
  function localizar(chave, locale) {
    const arqs = arquivosDe(locale);
    if (!arqs.length) return null;
    if (arqs[0].ns === null) return { arq: arqs[0], caminho: chave };
    const [ns, ...resto] = chave.split('.');
    const arq = arqs.find((a) => a.ns === ns);
    return arq && resto.length ? { arq, caminho: resto.join('.') } : null;
  }

  /* Todas as chaves do idioma da página. A copy de um i18n de objeto é do site
     inteiro (não tem arquivo por rota), então toda página mostra todas. */
  function chaves(pagina, { locale } = {}) {
    const l = idiomaDe(locale) || PADRAO;
    const todas = {};
    for (const arq of arquivosDe(l)) {
      const planas = achatar(ler(arq));
      for (const [k, v] of Object.entries(planas)) todas[arq.ns ? `${arq.ns}.${k}` : k] = v;
    }
    return {
      status: 200,
      corpo: { arquivo: Object.keys(todas).length ? LOCALES[l] : null, locale: l, locales: IDIOMAS, chaves: todas },
    };
  }

  /* O copy-lint lê JSON aninhado; o arquivo do idioma pode ser .ts. Vai uma
     cópia da árvore pra um JSON temporário, e o prefixo (namespace) volta na
     chave que o lint devolve. */
  function lint(arq) {
    if (op.lint === false) return [];
    const dir = mkdtempSync(join(tmpdir(), 'copy-edit-lint-'));
    try {
      const tmp = join(dir, 'copy.json');
      writeFileSync(tmp, JSON.stringify(ler(arq).arvore, null, 2));
      return rodarLint(root, op.lint, tmp, arq.ns || '');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async function salvar(d) {
    const valor = normalizarValor(vercelStegaClean(String(d.valor ?? '')));
    const antes = d.antes === undefined ? undefined : vercelStegaClean(String(d.antes));
    const chave = vercelStegaClean(String(d.chave ?? ''));
    /* Idioma pedido e desconhecido é erro, não "cai no padrão": gravar o texto
       em inglês no arquivo em português é o pior jeito de errar em silêncio. */
    if (d.locale !== undefined && d.locale !== null && d.locale !== '' && !idiomaDe(d.locale)) {
      return { status: 400, corpo: { erro: `idioma "${d.locale}" não tem arquivo na config (${IDIOMAS.join(', ')})` } };
    }
    const locale = idiomaDe(d.locale) || PADRAO;
    const l = localizar(chave, locale);
    if (!l) return { status: 400, corpo: { erro: `chave "${chave}" não mora em nenhum arquivo de ${locale} (${LOCALES[locale]})` } };
    const bruto = readFileSync(l.arq.abs, 'utf8');
    const r = trocarValor(bruto, l.arq.rel, l.caminho, valor, {
      exportar: op.exportar,
      guarda: (noDisco) => guardaEscritaCega(chave, noDisco, antes),
    });
    if (r.erro) return { status: 400, corpo: { erro: r.erro } };
    writeFileSync(l.arq.abs, r.texto);
    return {
      status: 200,
      corpo: {
        ok: true,
        erro: '',
        arquivo: l.arq.rel,
        locale,
        lint: LINT_EM.includes(locale) ? lint(l.arq) : [],
        vocab: [],
        valor,
      },
    };
  }

  /* ── token e estilo: o mesmo do next-intl ─────────────────────────────── */
  const T = op.tokens || {};
  const CSS = T.css ? join(root, T.css) : null;
  const AVISO =
    op.avisoEstilo ||
    'token ainda não grava neste repo (falta `tokens.css` na copy-edit.config.mjs). Deixa um comentário (Alt+clique).';
  const dica = op.dicaComentarios ?? `Texto muda em ${Object.values(LOCALES).join(' / ')}, nunca no .tsx.`;

  const porta = op.porta || 5280;
  const portaDev = op.portaDev || 5273;
  const RAIZ = op.rotaInicial || '/';

  function aoSubir(p, sair) {
    const parar = op.dev === false ? () => {} : subirNextDev(root, { porta: p, portaDev, sair });
    console.log('');
    console.log(`  Editor de copy no ar: http://localhost:${portaDev}${RAIZ}`);
    console.log(`  A copy mora em ${IDIOMAS.map((l) => `${LOCALES[l]} (${l})`).join(', ')}.`);
    console.log('  O idioma é o que a página está mostrando: trocar de idioma no site troca o arquivo onde grava.');
    console.log('  Clique no texto pra editar. Enter salva, Esc desfaz. Alt+clique deixa comentário pra IA.');
    console.log('  Cada save troca uma linha no arquivo do idioma e passa o copy-lint. Commit é teu.');
    console.log('');
    return parar;
  }

  return {
    nome: 'i18n-objeto',
    porta,
    limpar: vercelStegaClean,
    dicaComentarios: dica,
    chaves,
    salvar,
    tokens: () => (CSS && existsSync(CSS) ? listarTokens({ css: CSS, origem: T.origem }) : []),
    token: (dados) => (CSS ? salvarToken(dados, { root, css: CSS, origem: T.origem, aoGravar: T.aoGravar, checar: T.checar }) : { erro: AVISO }),
    estilo: (dados) =>
      estiloNaFila(dados, {
        css: CSS && existsSync(CSS) ? CSS : null,
        fila: join(root, 'docs', 'COMENTARIOS-IA.md'),
        cabecalho: cabecalhoComentarios(dica),
        chaveExiste: (k) => !!localizar(k, PADRAO) && Object.hasOwn(chaves('/', {}).corpo.chaves, k),
        paginaDe: () => RAIZ,
      }),
    aoSubir,
    portaOcupada: (pt) => `A porta ${pt} está ocupada. Rode com COPY_EDIT_PORTA=<outra>.`,
  };
}
