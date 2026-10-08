/* Adapter de HTML estático com `data-copy` (o visantismo) — a página vira o editor.
 *
 * O PROBLEMA QUE ELE RESOLVE
 *
 * A copy é SSoT em `copy*.json` com chaves planas, e o HTML é uma view gerada.
 * Isso é ótimo pro build e péssimo pra escrever: pra burilar uma linha você
 * precisava achar a chave num JSON, editar sem ver a dobra em volta e rodar o
 * build no escuro. Texto de venda não se julga fora do lugar onde ele vai ser
 * lido: o que decide "essa headline está comprida" é a quebra de linha ao lado
 * da foto, não o número de caracteres.
 *
 * COMO FUNCIONA
 *
 * Um servidor estático local serve os MESMOS arquivos que a Vercel publica e
 * injeta duas tags no <body> de cada HTML: o editor. Nada disso é commitado no
 * site — o index.html no disco continua sendo a view gerada pelo build, e o
 * editor só existe enquanto este processo estiver de pé.
 *
 * Clicar em qualquer texto com `data-copy` abre ele pra edição no lugar. Ao
 * salvar, o servidor:
 *
 *   1. escreve o valor no `copy*.json` certo, preservando a ordem das chaves;
 *   2. roda o build de copy do repo, que regera HTML e COPY.md;
 *   3. roda o `copy-lint` da skill visant-copy no arquivo editado e devolve as
 *      violações com a regra e o conserto (e o vocab, se o repo tiver).
 *
 * Ou seja: o contrato do repo continua inteiro. O SSoT é escrito primeiro, a
 * view é gerada por quem sempre gerou, e o `npm run check` continua sendo a
 * autoridade. O editor não é um segundo caminho de escrita, é um teclado
 * apontando pro caminho que já existia.
 *
 * O QUE É DO REPO (vem do copy-edit.config.mjs)
 *
 *   paginas        [{ copy, html }]  a tabela página↔json (no visantismo, o
 *                  PAGES de scripts/copy.mjs, importado e não copiado)
 *   build          args do node que regeram o HTML  (['scripts/copy.mjs','build'])
 *   lint           script do copy-lint              ('scripts/copy-lint.mjs')
 *   vocab          args do segundo portão, opcional (['scripts/vocab.mjs','check'])
 *   css            folha onde o estilo grava        ('styles.css')
 *   tokens         { arquivo, build, formatar }     token no SSoT + rebuild
 *   injetar(html)  extra no HTML servido (barra do hero), opcional
 *   servirAntes(caminho, res) arquivos extras (o /__hero/*), opcional
 *   dicaComentarios  última frase do cabeçalho da fila
 */
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { MIME, guardaEscritaCega, normalizarValor, rodarLint, rodarNode } from '../server/nucleo.mjs';
import { estiloNaFolha } from '../writers/css-token.mjs';

/* ── injeção ───────────────────────────────────────────────────────────────
   Duas tags e nada mais. O editor vai como ARQUIVO e não como <script> inline
   porque o site roda sob um CSP com `script-src 'self'` mais hashes: inline
   novo aqui passaria no local e morreria no ar, e um editor que só funciona
   onde não importa não serve de teste. */
const TAGS =
  '<link rel="stylesheet" href="/__copy/editor.css">\n<script src="/__copy/editor.js" defer></script>\n';

export function criar(root, op) {
  const ROOT = normalize(root);
  const paginas = op.paginas || [];
  const injetarExtra = op.injetar || ((h) => h);

  /* `cleanUrls: true` no vercel.json: em produção /lote serve lote.html. O
     servidor local repete isso, senão o editor abriria numa URL que não existe
     no ar e a rolagem/âncora divergiria da real. */
  function resolverArquivo(url) {
    let p = decodeURIComponent(url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    if (!extname(p)) p += '.html';
    return normalize(join(ROOT, p));
  }

  const paginaDe = (arquivo) => paginas.find((p) => join(ROOT, p.html) === arquivo);

  /* ── escrita no SSoT ─────────────────────────────────────────────────────
     Reescreve UMA chave. A ordem sobrevive porque V8 preserva ordem de inserção
     de chave string, e o formato sobrevive porque os copy*.json já estão na
     forma que o `JSON.stringify(_, null, 2)` emite, que é a mesma do Prettier
     do visantismo. O efeito prático é o que importa: editar uma frase produz
     um diff de UMA linha, e não de 700. Se um dia o formato divergir, o
     `npm run format:check` reprova antes do commit. */
  function gravar(page, chave, valor, antes) {
    const arq = join(ROOT, page.copy);
    const atual = JSON.parse(readFileSync(arq, 'utf8'));
    if (!(chave in atual)) return { erro: `chave "${chave}" não existe em ${page.copy}` };
    const erro = guardaEscritaCega(chave, atual[chave], antes);
    if (erro) return { erro };
    atual[chave] = valor;
    writeFileSync(arq, JSON.stringify(atual, null, 2) + '\n');
    return {};
  }

  /* O SEGUNDO portão de copy. O vocab:check é quem reprova palavra aposentada
     ("Fundador", "vitalício") na copy pública, e ele existe porque quatro nomes
     pro mesmo produto chegaram em produção em quatro telas seguidas da mesma
     compra. Rodar só o copy-lint aqui deixaria justamente o erro mais caro pro
     CI, que é o que descobre tarde. Ele lê todos os SSoT de uma vez, então a
     resposta vale pra página aberta e pras outras. */
  function vocab() {
    if (!op.vocab) return [];
    const [script, ...args] = op.vocab;
    const { code, out } = rodarNode(ROOT, [join(ROOT, script), ...args]);
    if (code === 0) return [];
    return out
      .split('\n')
      .filter((l) => l.trim().startsWith('✖'))
      .map((l) => l.replace(/^\s*✖\s*/, '').trim())
      .slice(0, 3);
  }

  function injetar(html) {
    const comEditor = html.includes('</body>')
      ? html.replace('</body>', TAGS + '</body>')
      : html + TAGS;
    return injetarExtra(comEditor);
  }

  /* Estilo vindo do editor (alça de largura, amostra de cor): grava na regra
     de topo do seletor na folha do site. O caminho mora no writers/css-token
     (estiloNaFolha), junto do caminho da fila que o app React usa. */
  function estilo(dados) {
    if (!op.css) return { erro: 'este repo não declarou folha de estilo (css) na config' };
    return estiloNaFolha(dados, { root: ROOT, css: join(ROOT, op.css) });
  }

  /* Token: escreve no tokens.json (o SSoT) e roda o build de tokens, que regera
     o :root da folha. Nunca no CSS direto, senão o tokens:check reprova. */
  function tokens() {
    if (!op.tokens) return [];
    const t = JSON.parse(readFileSync(join(ROOT, op.tokens.arquivo), 'utf8'));
    return t.grupos.flatMap((g) =>
      g.tokens.map((k) => ({ grupo: g.titulo, nome: k.nome, valor: k.valor }))
    );
  }

  async function token(dados) {
    if (!op.tokens) return { erro: 'este repo não declarou tokens na config' };
    const TOKENS = join(ROOT, op.tokens.arquivo);
    const nome = String(dados.nome || '');
    const valor = String(dados.valor || '').trim();
    if (!valor || /[;{}<>]/.test(valor) || valor.length > 200) return { erro: 'valor inválido' };
    const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
    const alvo = t.grupos.flatMap((g) => g.tokens).find((k) => k.nome === nome);
    if (!alvo) return { erro: `token --${nome} não existe no ${op.tokens.arquivo}` };
    const antes = alvo.valor;
    alvo.valor = valor;
    /* Formatação com a config do REPO (o visantismo passa o prettier dele),
       senão o diff do json vira o arquivo inteiro reformatado e ninguém acha a
       linha que mudou. Sem formatador, o JSON.stringify de 2 espaços. */
    const texto = op.tokens.formatar
      ? await op.tokens.formatar(JSON.stringify(t), TOKENS)
      : JSON.stringify(t, null, 2) + '\n';
    writeFileSync(TOKENS, texto);
    if (op.tokens.build) {
      const [script, ...args] = op.tokens.build;
      const build = rodarNode(ROOT, [join(ROOT, script), ...args]);
      if (build.code !== 0) {
        return { erro: 'tokens:build falhou: ' + build.out.trim().split('\n')[0] };
      }
    }
    return { ok: true, arquivo: op.tokens.arquivo, antes, depois: valor };
  }

  function chaves(pagina) {
    const page = paginaDe(resolverArquivo(pagina));
    if (!page) return { status: 404, corpo: {} };
    return {
      status: 200,
      corpo: { arquivo: page.copy, chaves: JSON.parse(readFileSync(join(ROOT, page.copy), 'utf8')) },
    };
  }

  async function salvar(dados) {
    const page = paginaDe(resolverArquivo(dados.pagina || '/'));
    if (!page) return { status: 404, corpo: { erro: 'página fora do SSoT' } };
    const valor = normalizarValor(dados.valor);
    const { erro } = gravar(page, dados.chave, valor, dados.antes);
    if (erro) return { status: 400, corpo: { erro } };
    const [script, ...args] = op.build || [];
    const build = script ? rodarNode(ROOT, [join(ROOT, script), ...args]) : { code: 0, out: '' };
    const ok = build.code === 0;
    return {
      status: 200,
      corpo: {
        ok,
        erro: ok ? '' : build.out.trim().split('\n').slice(0, 4).join(' · '),
        arquivo: page.copy,
        lint: ok ? rodarLint(ROOT, op.lint, page.copy) : [],
        vocab: ok ? vocab() : [],
        valor,
      },
    };
  }

  /* Estático, com a mesma proteção de caminho do overflow:check: caminho vindo
     da rede nunca entra em readFile sem passar por normalize + prefixo. */
  async function servir(req, res, url) {
    const alvo = resolverArquivo(url);
    if (!alvo.startsWith(ROOT)) {
      res.writeHead(403).end();
      return true;
    }
    try {
      const info = await stat(alvo);
      if (info.isDirectory()) throw new Error('dir');
      const tipo = MIME[extname(alvo)] || 'application/octet-stream';
      if (extname(alvo) === '.html') {
        const html = await readFile(alvo, 'utf8');
        res.writeHead(200, { 'content-type': tipo, 'cache-control': 'no-store' });
        /* `?ce=preview` é a MESMA página servida sem editor. É o que o painel de
           375px carrega no iframe: com o editor injetado ali dentro, a régua de
           celular teria contorno, barra e painel ocupando a largura que ela
           existe justamente pra medir, e a medida seria uma mentira. */
        res.end(url.includes('ce=preview') ? html : injetar(html));
      } else {
        res.writeHead(200, { 'content-type': tipo, 'cache-control': 'no-store' });
        res.end(await readFile(alvo));
      }
    } catch {
      res.writeHead(404).end('404');
    }
    return true;
  }

  function aoSubir(porta) {
    console.log('');
    console.log('  Editor de copy no ar:');
    for (const page of paginas) {
      const rota = page.html === 'index.html' ? '/' : '/' + page.html.replace(/\.html$/, '');
      console.log(`    http://127.0.0.1:${porta}${rota}`.padEnd(38) + `→ ${page.copy}`);
    }
    console.log('');
    console.log('  Clique em qualquer texto pra editar. Enter salva, Esc desfaz.');
    console.log('  E pausa e retoma a edição; Ctrl+clique faz o que o botão faz no ar.');
    console.log(
      '  Alt+clique em qualquer elemento deixa comentário pra IA (docs/COMENTARIOS-IA.md).'
    );
    for (const l of op.avisos || []) console.log('  ' + l);
    console.log('  Cada save escreve o json, roda o build de copy e passa o copy-lint.');
    console.log('  Ctrl+C encerra. Commit é teu, o editor não commita nada.');
    console.log('');
  }

  return {
    nome: 'html-json',
    porta: op.porta ?? 0,
    dicaComentarios: op.dicaComentarios ?? '',
    servirAntes: op.servirAntes,
    servir,
    chaves,
    salvar,
    tokens,
    token,
    estilo,
    aoSubir,
    /* Porta ocupada é o erro mais provável nesta máquina (o hub local sobe ~22
       serviços). Sem isto o node cospe um stack de EADDRINUSE, que não diz o
       que fazer. */
    portaOcupada: (porta) =>
      `A porta ${porta} já está ocupada. Rode sem número que ele escolhe uma livre:\n    npm run copy:edit`,
  };
}
