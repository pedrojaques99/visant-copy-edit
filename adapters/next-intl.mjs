/* Adapter de app Next + next-intl: JSON aninhado e a chave escondida no texto
 * pelo @vercel/stega.
 *
 * COMO FUNCIONA (visant-club/docs/PLANO-EDITOR-LOCAL.md)
 *
 * Com COPY_EDIT=1, o request config do next-intl (i18n/request.ts) esconde a
 * chave dentro de cada texto (@vercel/stega), o layout carrega
 * /__copy/ponte-stega.js, que põe `data-copy` no elemento e sobe a barra. O
 * Next repassa o /__copy/* pra este processo (rewrite no next.config, só com
 * COPY_EDIT=1). Esses três pontos moram no APP e não aqui: são o lado do
 * framework que nenhum pacote alcança sem virar plugin de build.
 *
 * DOIS FORMATOS DE MENSAGEM
 *
 *   formato 'rota'    (Club)  <pasta>/<rota>.json, um por rota, e a chave de
 *                             cima é o nome do arquivo (`conta.perfil.titulo`
 *                             → copy/conta.json). Os `compartilhados` (shell,
 *                             catálogo) entram no painel de toda página.
 *   formato 'locale'  (site de cliente, visant-site-template)
 *                             <pasta>/<locale>.json, um por idioma, e a chave é
 *                             o caminho dentro dele (`hero.tagline`). O idioma
 *                             sai do primeiro pedaço da URL (/pt-BR/...), que é
 *                             o `localePrefix: 'always'` do next-intl; sem ele,
 *                             o `localePadrao`.
 *
 * Ao salvar: grava o valor com a guarda de escrita cega (o `antes` da tela tem
 * que bater com o disco), roda o copy-lint no arquivo, e o `next dev` vê o JSON
 * mudar e recarrega a tela sozinho.
 *
 * TOKEN E ESTILO (writers/css-token)
 *
 * Com `tokens` na config, /__copy/tokens lê os blocos de topo da folha e
 * /__copy/token troca o valor, roda o portão e desfaz se reprovar. Estilo aqui
 * SEMPRE vira pedido na fila docs/COMENTARIOS-IA.md, nunca regra CSS: o
 * `data-copy` só existe com o editor ligado (o porquê inteiro está no writer).
 *
 * O QUE É DO REPO (vem do copy-edit.config.mjs, ou da detecção)
 *
 *   formato          'rota' | 'locale'                ('rota')
 *   pasta            onde moram os JSON                ('copy')
 *   compartilhados   (rota) JSON que aparecem em toda tela
 *   locales          (locale) os idiomas com arquivo   (os <pasta>/*.json)
 *   localePadrao     (locale) idioma da URL sem prefixo (o primeiro)
 *   lint             script do copy-lint; padrão o do pacote, false desliga
 *   tokens           { css, checar, origem, aoGravar } (writers/css-token.mjs)
 *   porta            porta deste servidor              (5280)
 *   portaDev         porta do `next dev`               (5273)
 *   dev              false pra não subir o next (teste)
 *   rotaInicial      a URL que o terminal mostra       ('/' ou '/<localePadrao>')
 *   avisoEstilo      o erro de token quando não há `tokens`
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { vercelStegaClean } from '@vercel/stega';
import {
  guardaEscritaCega,
  normalizarValor,
  rodarLint,
  cabecalhoComentarios,
} from '../server/nucleo.mjs';
import { listarTokens, salvarToken, estiloNaFila } from '../writers/css-token.mjs';

function achatar(no, prefixo, saida = {}) {
  for (const [k, v] of Object.entries(no)) {
    const chave = prefixo ? `${prefixo}.${k}` : k;
    if (typeof v === 'string') saida[chave] = v;
    else if (v && typeof v === 'object') achatar(v, chave, saida);
  }
  return saida;
}

export function criar(root, op = {}) {
  const FORMATO = op.formato || 'rota';
  const PASTA = op.pasta || (FORMATO === 'locale' ? 'messages' : 'copy');
  const COPY = join(root, PASTA);
  /* Os arquivos que não são rota (07/10/2026, o app inteiro editável): o
     shell e o catálogo aparecem em toda tela, então entram no painel de qualquer
     página junto com o JSON da rota. A gravação não muda: quem diz o arquivo é o
     primeiro pedaço da chave (`comum.menu.buscar` → copy/comum.json). */
  const COMPARTILHADOS = op.compartilhados || [];

  const arquivoDe = (nome) => (/^[A-Za-z0-9_-]+$/.test(nome) ? join(COPY, `${nome}.json`) : null);
  const ler = (arq) => JSON.parse(readFileSync(arq, 'utf8'));

  /* ── idioma (formato 'locale') ───────────────────────────────────────── */
  const LOCALES =
    op.locales ||
    (FORMATO === 'locale' && existsSync(COPY)
      ? readdirSync(COPY)
          .filter((f) => f.endsWith('.json'))
          .map((f) => f.slice(0, -5))
      : []);
  const LOCALE_PADRAO = op.localePadrao || LOCALES[0];
  const RAIZ = FORMATO === 'locale' && LOCALE_PADRAO ? `/${LOCALE_PADRAO}` : '/';
  const localeDe = (pagina) => {
    const primeiro = String(pagina || '/').split('?')[0].split('/').filter(Boolean)[0];
    return LOCALES.includes(primeiro) ? primeiro : LOCALE_PADRAO;
  };

  /* ── onde mora cada chave ────────────────────────────────────────────────
     Devolve { arq, rel, caminho, prefixo } pro par (chave, página), ou null.
     `prefixo` é o que o lint não sabe: no formato 'rota' a chave relativa ao
     arquivo (`perfil.titulo`) ganha a rota na frente. */
  function localizar(chave, pagina) {
    const partes = String(chave).split('.');
    if (FORMATO === 'locale') {
      const locale = localeDe(pagina);
      const arq = locale && arquivoDe(locale);
      if (!arq || !existsSync(arq)) return null;
      return { arq, rel: `${PASTA}/${locale}.json`, caminho: partes, prefixo: '' };
    }
    const [rota, ...caminho] = partes;
    const arq = arquivoDe(rota);
    if (!arq || !existsSync(arq) || !caminho.length) return null;
    return { arq, rel: `${PASTA}/${rota}.json`, caminho, prefixo: rota };
  }

  function chaveExiste(chave, pagina) {
    const l = localizar(chave, pagina);
    if (!l) return false;
    let no = ler(l.arq);
    for (const p of l.caminho) no = no?.[p];
    return typeof no === 'string';
  }

  /* A rota da página vira o arquivo: /conta → copy/conta.json. Rota sem JSON
     ainda (não migrou) devolve vazio, e a ponte nem sobe a barra. No formato
     'locale' o arquivo do idioma tem a copy do site inteiro: toda página
     mostra todas as chaves dele. */
  function chaves(pagina) {
    if (FORMATO === 'locale') {
      const locale = localeDe(pagina);
      const arq = locale && arquivoDe(locale);
      if (!arq || !existsSync(arq)) return { status: 200, corpo: { arquivo: null, chaves: {} } };
      return { status: 200, corpo: { arquivo: `${PASTA}/${locale}.json`, chaves: achatar(ler(arq), '') } };
    }
    const rota = String(pagina).split('?')[0].split('/').filter(Boolean)[0] || '';
    const todas = {};
    let arquivo = null;
    for (const nome of [rota, ...COMPARTILHADOS]) {
      const arq = arquivoDe(nome);
      if (!arq || !existsSync(arq)) continue;
      Object.assign(todas, achatar(ler(arq), nome));
      if (nome === rota) arquivo = `${PASTA}/${rota}.json`;
    }
    /* Rota sem JSON próprio ainda abre a barra se o shell tem texto editável. */
    if (!arquivo && Object.keys(todas).length && COMPARTILHADOS.length) {
      arquivo = `${PASTA}/${COMPARTILHADOS[0]}.json`;
    }
    return { status: 200, corpo: { arquivo, chaves: todas } };
  }

  function gravar(chave, valor, antes, pagina) {
    const l = localizar(chave, pagina);
    if (!l) return { erro: `chave "${chave}" não mora em nenhum ${PASTA}/*.json` };
    const bruto = readFileSync(l.arq, 'utf8');
    const json = JSON.parse(bruto);
    let pai = json;
    for (const p of l.caminho.slice(0, -1)) pai = pai?.[p];
    const folha = l.caminho.at(-1);
    if (!pai || typeof pai[folha] !== 'string') {
      return { erro: `chave "${chave}" não existe em ${l.rel}` };
    }
    const erro = guardaEscritaCega(chave, pai[folha], antes);
    if (erro) return { erro };
    pai[folha] = valor;
    /* O fim de linha do arquivo manda: JSON gravado com \n num repo que tem
       \r\n vira diff do arquivo inteiro. */
    const nl = bruto.includes('\r\n') ? '\r\n' : '\n';
    writeFileSync(l.arq, (JSON.stringify(json, null, 2) + '\n').replace(/\n/g, nl));
    return l;
  }

  async function salvar(d) {
    /* A tela manda o texto com a chave invisível junto: limpa antes de comparar e gravar. */
    const valor = normalizarValor(vercelStegaClean(String(d.valor ?? '')));
    const antes = d.antes === undefined ? undefined : vercelStegaClean(String(d.antes));
    const r = gravar(vercelStegaClean(String(d.chave ?? '')), valor, antes, d.pagina);
    if (r.erro) return { status: 400, corpo: { erro: r.erro } };
    return {
      status: 200,
      corpo: {
        ok: true,
        erro: '',
        arquivo: r.rel,
        lint: rodarLint(root, op.lint, r.arq, r.prefixo),
        vocab: [],
        valor,
      },
    };
  }

  /* ── token e estilo ──────────────────────────────────────────────────── */
  const T = op.tokens || {};
  const CSS = T.css ? join(root, T.css) : null;
  const AVISO =
    op.avisoEstilo ||
    'token ainda não grava neste repo (falta `tokens.css` na copy-edit.config.mjs). Deixa um comentário (Alt+clique).';
  const dica = op.dicaComentarios ?? `Texto muda no ${PASTA}/*.json, nunca no .tsx.`;

  /* Em que página a barra lista o pedido de estilo: onde ela lista os
     comentários. No formato 'rota' é a rota da chave (compartilhado vai pra
     raiz); no 'locale', a raiz do idioma padrão. */
  const paginaDe = (chave) => {
    if (FORMATO === 'locale') return RAIZ;
    const rota = chave.split('.')[0];
    return COMPARTILHADOS.includes(rota) ? '/' : '/' + rota;
  };

  function tokens() {
    if (!CSS || !existsSync(CSS)) return [];
    return listarTokens({ css: CSS, origem: T.origem });
  }

  function token(dados) {
    if (!CSS) return { erro: AVISO };
    return salvarToken(dados, { root, css: CSS, origem: T.origem, aoGravar: T.aoGravar, checar: T.checar });
  }

  function estilo(dados) {
    return estiloNaFila(dados, {
      css: CSS && existsSync(CSS) ? CSS : null,
      fila: join(root, 'docs', 'COMENTARIOS-IA.md'),
      cabecalho: cabecalhoComentarios(dica),
      /* A barra não manda a página no estilo; no formato 'locale' a chave
         vale pra qualquer idioma, então confere no padrão. */
      chaveExiste: (k) => chaveExiste(k, RAIZ),
      paginaDe,
    });
  }

  const porta = op.porta || 5280;
  const portaDev = op.portaDev || 5273;

  /* O `next dev` vem junto, com a flag que liga a chave invisível e o rewrite. */
  function aoSubir(p, sair) {
    let next = null;
    if (op.dev !== false) {
      next = spawn(
        process.execPath,
        [join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', String(portaDev)],
        {
          cwd: root,
          stdio: 'inherit',
          env: { ...process.env, COPY_EDIT: '1', COPY_EDIT_PORTA: String(p) },
        }
      );
      next.on('exit', sair);
    }
    console.log('');
    console.log(`  Editor de copy no ar: http://localhost:${portaDev}${op.rotaInicial || RAIZ}`);
    if (FORMATO === 'rota') console.log(`  Só as rotas que já têm ${PASTA}/<rota>.json ficam editáveis.`);
    else console.log(`  A copy mora em ${PASTA}/<idioma>.json; o idioma é o da URL.`);
    console.log(
      '  Clique no texto pra editar. Enter salva, Esc desfaz. Alt+clique deixa comentário pra IA.'
    );
    console.log('  Trocar de página pelo menu não reinicia a barra: navegue com F5.');
    console.log('  Cada save escreve o json e passa o copy-lint. Commit é teu.');
    console.log('');
    return () => next && next.kill();
  }

  return {
    nome: 'next-intl',
    porta,
    limpar: vercelStegaClean,
    dicaComentarios: dica,
    chaves,
    salvar,
    tokens,
    token,
    estilo,
    aoSubir,
    portaOcupada: (pt) => `A porta ${pt} está ocupada. Rode com COPY_EDIT_PORTA=<outra>.`,
  };
}
