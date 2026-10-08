/* Adapter de app Next + next-intl (o Club): copy/<rota>.json aninhado e a chave
 * escondida no texto pelo @vercel/stega.
 *
 * COMO FUNCIONA (visant-club/docs/PLANO-EDITOR-LOCAL.md)
 *
 * A copy mora em <pasta>/<rota>.json e chega na tela por next-intl. Com
 * COPY_EDIT=1, o i18n/request.ts do app esconde a chave dentro de cada texto
 * (@vercel/stega), o layout raiz carrega /__copy/ponte-stega.js, que põe
 * `data-copy` no elemento e sobe a barra. O Next repassa o /__copy/* pra este
 * processo (rewrite no next.config.mjs, só com COPY_EDIT=1). Esses três pontos
 * moram no APP e não aqui: são o lado do framework que nenhum pacote alcança
 * sem virar plugin de build.
 *
 * Ao salvar, este processo:
 *   1. escreve o valor em <pasta>/<rota>.json, com a mesma guarda de escrita
 *      cega do HTML estático (o `antes` da tela tem que bater com o disco);
 *   2. roda o copy-lint do repo no arquivo;
 *   3. o `next dev` vê o JSON mudar e recarrega a tela sozinho.
 *
 * O QUE ELE NÃO FAZ (ainda)
 *
 * · Token e estilo: a barra mostra a paleta, mas gravar no globals.css é outra
 *   fase. Os dois endpoints respondem erro dizendo isso.
 * · Criar chave nova. Chave nasce no JSON junto com o `t()` no componente.
 *
 * O QUE É DO REPO (vem do copy-edit.config.mjs)
 *
 *   pasta            onde moram os JSON          ('copy')
 *   compartilhados   JSON que não são rota mas aparecem em toda tela
 *   lint             script do copy-lint          ('scripts/vendor/copy-lint.mjs')
 *   porta            porta deste servidor         (5280)
 *   portaDev         porta do `next dev`          (5273)
 *   dev              false pra não subir o next (teste)
 *   rotaInicial      a URL que o terminal mostra  ('/conta')
 *   avisoEstilo      o erro de token/estilo
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { vercelStegaClean } from '@vercel/stega';
import { guardaEscritaCega, normalizarValor, rodarLint } from '../server/nucleo.mjs';

export function criar(root, op = {}) {
  const PASTA = op.pasta || 'copy';
  const COPY = join(root, PASTA);
  /* Os arquivos que não são rota (07/10/2026, o app inteiro editável): o
     shell e o catálogo aparecem em toda tela, então entram no painel de qualquer
     página junto com o JSON da rota. A gravação não muda: quem diz o arquivo é o
     primeiro pedaço da chave (`comum.menu.buscar` → copy/comum.json). */
  const COMPARTILHADOS = op.compartilhados || [];

  /* ── <pasta>/<rota>.json ───────────────────────────────────────────── */
  const arquivoDe = (rota) => (/^[a-z0-9-]+$/.test(rota) ? join(COPY, `${rota}.json`) : null);

  function achatar(no, prefixo, saida = {}) {
    for (const [k, v] of Object.entries(no)) {
      const chave = `${prefixo}.${k}`;
      if (typeof v === 'string') saida[chave] = v;
      else achatar(v, chave, saida);
    }
    return saida;
  }

  /* A rota da página vira o arquivo: /conta → copy/conta.json. Rota sem JSON
     ainda (não migrou) devolve vazio, e a ponte nem sobe a barra. */
  function chaves(pagina) {
    const rota = String(pagina).split('?')[0].split('/').filter(Boolean)[0] || '';
    const todas = {};
    let arquivo = null;
    for (const nome of [rota, ...COMPARTILHADOS]) {
      const arq = arquivoDe(nome);
      if (!arq || !existsSync(arq)) continue;
      Object.assign(todas, achatar(JSON.parse(readFileSync(arq, 'utf8')), nome));
      if (nome === rota) arquivo = `${PASTA}/${rota}.json`;
    }
    /* Rota sem JSON próprio ainda abre a barra se o shell tem texto editável. */
    if (!arquivo && Object.keys(todas).length && COMPARTILHADOS.length) {
      arquivo = `${PASTA}/${COMPARTILHADOS[0]}.json`;
    }
    return { status: 200, corpo: { arquivo, chaves: todas } };
  }

  function gravar(chave, valor, antes) {
    const [rota, ...caminho] = String(chave).split('.');
    const arq = arquivoDe(rota);
    if (!arq || !existsSync(arq) || !caminho.length) {
      return { erro: `chave "${chave}" não mora em nenhum ${PASTA}/*.json` };
    }
    const bruto = readFileSync(arq, 'utf8');
    const json = JSON.parse(bruto);
    let pai = json;
    for (const p of caminho.slice(0, -1)) pai = pai?.[p];
    const folha = caminho.at(-1);
    if (!pai || typeof pai[folha] !== 'string') {
      return { erro: `chave "${chave}" não existe em ${PASTA}/${rota}.json` };
    }
    const erro = guardaEscritaCega(chave, pai[folha], antes);
    if (erro) return { erro };
    pai[folha] = valor;
    /* O fim de linha do arquivo manda: JSON gravado com \n num repo que tem
       \r\n vira diff do arquivo inteiro. */
    const nl = bruto.includes('\r\n') ? '\r\n' : '\n';
    writeFileSync(arq, (JSON.stringify(json, null, 2) + '\n').replace(/\n/g, nl));
    return { arquivo: `${PASTA}/${rota}.json`, rota };
  }

  async function salvar(d) {
    /* A tela manda o texto com a chave invisível junto: limpa antes de comparar e gravar. */
    const valor = normalizarValor(vercelStegaClean(String(d.valor ?? '')));
    const antes = d.antes === undefined ? undefined : vercelStegaClean(String(d.antes));
    const r = gravar(vercelStegaClean(String(d.chave ?? '')), valor, antes);
    if (r.erro) return { status: 400, corpo: { erro: r.erro } };
    return {
      status: 200,
      corpo: {
        ok: true,
        erro: '',
        arquivo: r.arquivo,
        /* A chave do lint vem relativa ao arquivo (`perfil.titulo`) e ganha a
           rota na frente. */
        lint: rodarLint(root, op.lint, join(COPY, `${r.rota}.json`), r.rota),
        vocab: [],
        valor,
      },
    };
  }

  const AVISO =
    op.avisoEstilo ||
    'token e estilo ainda não gravam neste repo. Deixa um comentário (Alt+clique).';

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
    console.log(`  Editor de copy no ar: http://localhost:${portaDev}${op.rotaInicial || '/'}`);
    console.log(`  Só as rotas que já têm ${PASTA}/<rota>.json ficam editáveis.`);
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
    dicaComentarios: op.dicaComentarios ?? `Texto muda no ${PASTA}/*.json, nunca no .tsx.`,
    chaves,
    salvar,
    tokens: () => [],
    token: () => ({ erro: AVISO }),
    estilo: () => ({ erro: AVISO }),
    aoSubir,
    portaOcupada: (pt) => `A porta ${pt} está ocupada. Rode com COPY_EDIT_PORTA=<outra>.`,
  };
}
