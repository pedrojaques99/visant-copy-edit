/* Núcleo do servidor do editor: o que os dois `copy-edit.mjs` (visantismo e
 * Club) tinham escrito duas vezes, à mão, e agora mora uma vez só.
 *
 * O que é do REPO (onde mora a copy, como o HTML é gerado, qual lint roda) fica
 * no adapter (adapters/*.mjs), alimentado pelo `copy-edit.config.mjs` do repo.
 * O que é da FERRAMENTA fica aqui: http em 127.0.0.1, a tranca por repo, a
 * leitura do corpo, a guarda de escrita cega, a fila de comentários, o parse da
 * saída do copy-lint e os arquivos do cliente (barra, ponte, stega).
 *
 * O QUE ELE NÃO FAZ, DE PROPÓSITO
 *
 * · Não cria chave nova. Chave nasce junto com o `data-copy` no HTML (ou com o
 *   `t()` no componente), e o portão do repo reprova chave sem uso. Um editor
 *   que cria chave solta produz exatamente o lixo que o portão existe pra barrar.
 * · Não commita. Quem decide o que entra no repo é quem escreve o commit.
 * · Não escuta fora de 127.0.0.1. Ele grava arquivo no teu disco.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, isAbsolute } from 'node:path';

const PACOTE = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENTE = join(PACOTE, 'client');

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/* O stega vai pro browser como ESM puro (a ponte faz `import` dele). O
   package.json do @vercel/stega não tem `exports`, e o `main` é o CJS: o
   caminho do .mjs sai do diretório do pacote, resolvido a partir DESTE pacote
   (e não do repo), pra que o repo nem precise ter o stega instalado. */
function caminhoStega() {
  try {
    const req = createRequire(import.meta.url);
    return join(dirname(req.resolve('@vercel/stega/package.json')), 'dist', 'index.mjs');
  } catch {
    return null;
  }
}

/* As URLs da barra continuam `/__copy/editor.js|css`, que é o que o HTML
   injetado no visantismo e a ponte do Club sempre pediram. O arquivo mudou de
   nome (client/barra.js), o contrato com a página não. */
export const ARQUIVOS_CLIENTE = {
  '/__copy/editor.js': join(CLIENTE, 'barra.js'),
  '/__copy/editor.css': join(CLIENTE, 'barra.css'),
  '/__copy/ponte-stega.js': join(CLIENTE, 'ponte-stega.js'),
  '/__copy/stega.mjs': caminhoStega(),
};

/* ── um editor por repo ────────────────────────────────────────────────────
   Dois `copy:edit` de pé no mesmo repo é a receita da escrita cega: cada um
   serve uma cópia da página em memória do browser e cada save reescreve o JSON
   inteiro, então o segundo a apertar Enter apaga o trabalho do primeiro sem
   avisar ninguém. Aconteceu de verdade nesta máquina.

   A tranca mora no diretório temporário do sistema e não no repo: arquivo de
   estado dentro da pasta versionada vira ou lixo no `git status` ou linha nova
   no `.vercelignore`, e nenhum dos dois é problema que valha a pena ter.

   PID vivo é a condição, não a existência do arquivo: matar o processo com
   Ctrl+C não roda o `finally` de todo jeito (kill -9, terminal fechado), e uma
   tranca que sobrevive ao próprio dono trava a ferramenta de vez.

   O nome do arquivo é o mesmo que os dois servidores antigos usavam (sha1 da
   raiz do repo), então um editor velho e um novo no mesmo repo ainda se veem. */
export function caminhoTranca(root, pasta = tmpdir()) {
  return join(
    pasta,
    'visant-copy-edit-' + createHash('sha1').update(root).digest('hex').slice(0, 12) + '.pid'
  );
}

export function vivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/* Devolve { ok: true, soltar } ou { ok: false, dono }. Quem chama decide o que
   dizer e se sai: o núcleo não dá process.exit, pra poder ser testado. */
export function trancar(root, { pasta, pid = process.pid } = {}) {
  const arq = caminhoTranca(root, pasta);
  if (existsSync(arq)) {
    const dono = Number(readFileSync(arq, 'utf8').trim());
    if (dono && dono !== pid && vivo(dono)) return { ok: false, dono, arquivo: arq };
  }
  writeFileSync(arq, String(pid));
  const soltar = () => {
    try {
      if (readFileSync(arq, 'utf8').trim() === String(pid)) unlinkSync(arq);
    } catch {
      /* já saiu */
    }
  };
  return { ok: true, soltar, arquivo: arq };
}

/* Buffer.concat antes de decodificar, e não `corpo += chunk`. Um "ç" ou
   um "é" ocupa dois bytes em UTF-8, e o corpo chega em pedaços: se a
   quebra cair no MEIO do caractere, cada metade é decodificada sozinha e
   as duas viram U+FFFD. O defeito é intermitente por natureza (depende do
   tamanho do texto e do MTU), e o estrago é silencioso: o acento sai da
   copy, o build passa, e o site publica "voc?" numa headline. */
export async function lerCorpo(req) {
  const pedacos = [];
  for await (const c of req) pedacos.push(c);
  return JSON.parse(Buffer.concat(pedacos).toString('utf8'));
}

export function json(res, status, dados) {
  res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(dados));
}

/* \r vindo de colagem do Word/Notion viraria diferença invisível entre o
   JSON e o HTML gerado, e o copy:check reprovaria sem dizer por quê. */
export const normalizarValor = (v) =>
  String(v ?? '')
    .replace(/\r/g, '')
    .replace(/[ \t]+$/gm, '');

/* GUARDA DE ESCRITA CEGA. O save é read-modify-write do arquivo inteiro, e
   quem abriu a página há dez minutos tem na tela o valor de dez minutos
   atrás. Sem esta comparação, salvar uma linha sobrescreve com o valor VELHO
   qualquer mudança que tenha chegado no meio tempo (outra aba, outro editor
   aberto na mesma máquina, um `git pull`, ou o próprio dono do repo editando
   em paralelo). O `antes` é o valor que o cliente tinha; se o disco não bate
   com ele, quem decide é a pessoa, e não o último a apertar Enter.

   `antes === undefined` pula a checagem, e isso é só pro desfazer, que por
   definição está restaurando um valor que ele mesmo acabou de escrever.

   Devolve a mensagem de erro, ou null quando pode gravar. */
export function guardaEscritaCega(chave, noDisco, antes) {
  if (antes === undefined || noDisco === antes) return null;
  return (
    `"${chave}" mudou no disco desde que esta página abriu, então não sobrescrevi.\n` +
    `no disco: ${noDisco}\n` +
    `na tela:  ${antes}\n` +
    `Recarrega a página pra pegar o valor novo (F5) e reescreve por cima se ainda quiser.`
  );
}

export function rodarNode(root, args) {
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

/* A saída do copy-lint é feita pra humano no terminal. Duas formas importam:

     travessao              plans.garantia
       <a frase>
       ↑ casou: "—"

   e o rodapé "Como consertar:" com `regra: o que fazer`. O editor mostra a
   regra na frase e o conserto embaixo, que é a informação que faz alguém
   reescrever em vez de só apagar o caractere.

   `prefixo` existe pro JSON aninhado por rota (next-intl): o lint devolve a
   chave relativa ao arquivo (`perfil.titulo`) e a tela conhece ela com a rota
   na frente (`conta.perfil.titulo`). */
export function parseLint(out, prefixo = '') {
  const consertos = {};
  for (const l of out.split('\n')) {
    const m = l.match(/^ {2}([a-z0-9-]+): (.+)$/);
    if (m) consertos[m[1]] = m[2];
  }
  const achados = [];
  for (const l of out.split('\n')) {
    const m = l.match(/^ {2}([a-z0-9-]+) {2,}(\S+)$/);
    if (m) achados.push({ regra: m[1], chave: prefixo ? `${prefixo}.${m[2]}` : m[2] });
  }
  return achados.map((a) => ({ ...a, conserto: consertos[a.regra] || '' }));
}

/* O LINT É A PARTE QUE PAGA A CONTA

   A regra da casa (sem travessão, sem "não é x, é y") não é preferência: é o
   que separa a voz falada do texto que soa gerado. O linter já existia e só
   rodava no `npm run check`, ou seja, minutos ou dias depois da frase ter sido
   escrita. Aqui ele responde no segundo seguinte, que é quando ainda dá pra
   reescrever sem custo. O padrão é a cópia da skill visant-copy que mora
   neste pacote (lint/copy-lint.mjs, `npm run vendor:lint`); a config do repo
   pode apontar outro (caminho relativo à raiz do repo) ou `false` pra desligar. */
export const LINT_PADRAO = join(PACOTE, 'lint', 'copy-lint.mjs');

export function rodarLint(root, script, arquivo, prefixo = '') {
  if (script === undefined) script = LINT_PADRAO;
  if (!script) return [];
  const { code, out } = rodarNode(root, [isAbsolute(script) ? script : join(root, script), arquivo]);
  if (code === 0) return [];
  return parseLint(out, prefixo);
}

/* ── comentário pra IA ─────────────────────────────────────────────────────
   O que não é copy (layout, foto, motion, token) vira linha de checklist em
   docs/COMENTARIOS-IA.md, com rota e seletor do elemento. O Claude lê o
   arquivo, faz a tarefa, roda o check e marca [x]. Markdown e não JSON porque
   a fila é pra humano ler também, e fica no git. */
export const LINHA_COMENTARIO =
  /^- \[( |~|x)\] (?:#(\d+) )?`([^`]*)` `([^`]*)`(?: @(\d{1,3}),(\d{1,3}))?(?: · "([^"]*)")? · (.*)$/;
const ESTADO = { ' ': 'aberto', '~': 'lido', x: 'feito' };
const MARCA = { aberto: ' ', lido: '~', feito: 'x' };
/* Resposta da thread: sub-item indentado logo abaixo do comentário. */
export const LINHA_RESPOSTA = /^ {2,}- (designer|ia): (.*)$/;

export const cabecalhoComentarios = (dica) => `# Comentários pra IA

Fila escrita pelo \`npm run copy:edit\` (tecla C ou Alt+clique em qualquer elemento).
Cada linha: estado, número, rota, seletor CSS, ponto do pin (@x,y em %), trecho e o pedido.
Estado: \`[ ]\` aberto, \`[~]\` o agente leu e está fazendo, \`[x]\` feito.
Respostas ficam indentadas embaixo (\`  - ia: ...\` / \`  - designer: ...\`).
Pra rodar, peça ao Claude "processa os comentários": ele faz cada \`[ ]\`,
roda o \`npm run check\`, responde na thread e marca \`[x]\`.
Com o editor no ar, o agente também usa a API: GET /__copy/comentarios?todas=1&agente=1
(marca os abertos como lidos, e o designer vê na barra que o agente pegou),
POST /__copy/comentario/responder {id, autor: "ia", texto} e
POST /__copy/comentario/status {id, estado: "lido"|"feito"|"aberto", autor: "ia", texto}. ${dica}

`;

/* `limpar` tira a chave invisível do stega (next-intl): o texto do elemento
   chega com ela junto, e no .md ela vira lixo que ninguém vê mas o diff vê.

   Formato v3: cada comentário tem número (`#7`) e thread. Linha antiga, sem
   número, ganha o número da posição na leitura e é reescrita com ele na
   primeira mudança, então fila velha continua valendo. */
export function filaComentarios(root, { dica = '', limpar = (t) => t } = {}) {
  const arquivo = join(root, 'docs', 'COMENTARIOS-IA.md');

  /* Uma linha só, sem crase: a crase é o delimitador do formato. */
  const umaLinha = (t, n) =>
    limpar(String(t ?? ''))
      .replace(/\s+/g, ' ')
      .replace(/`/g, "'")
      .trim()
      .slice(0, n);

  /* O arquivo inteiro: cabeçalho (tudo antes do 1º comentário) e os itens. */
  function parse() {
    if (!existsSync(arquivo)) return { cabecalho: cabecalhoComentarios(dica), itens: [] };
    const linhas = readFileSync(arquivo, 'utf8').split(/\r?\n/);
    const itens = [];
    let cabecalho = null;
    for (let i = 0; i < linhas.length; i++) {
      const m = linhas[i].match(LINHA_COMENTARIO);
      if (m) {
        if (cabecalho === null) cabecalho = linhas.slice(0, i).join('\n') + '\n';
        itens.push({
          id: m[2] ? Number(m[2]) : null,
          estado: ESTADO[m[1]],
          feito: m[1] === 'x',
          pagina: m[3],
          seletor: m[4],
          pos: m[5] ? { x: Number(m[5]), y: Number(m[6]) } : null,
          trecho: m[7] || '',
          texto: m[8],
          respostas: [],
        });
        continue;
      }
      const r = linhas[i].match(LINHA_RESPOSTA);
      if (r && itens.length) itens[itens.length - 1].respostas.push({ autor: r[1], texto: r[2] });
    }
    if (cabecalho === null) cabecalho = linhas.join('\n').replace(/\n*$/, '\n\n');
    let max = itens.reduce((n, c) => Math.max(n, c.id || 0), 0);
    for (const c of itens) if (!c.id) c.id = ++max;
    return { cabecalho, itens };
  }

  function escrever({ cabecalho, itens }) {
    const corpo = itens
      .map(
        (c) =>
          `- [${MARCA[c.estado] || ' '}] #${c.id} \`${c.pagina}\` \`${c.seletor}\`` +
          (c.pos ? ` @${c.pos.x},${c.pos.y}` : '') +
          (c.trecho ? ` · "${c.trecho}"` : '') +
          ` · ${c.texto}\n` +
          c.respostas.map((r) => `  - ${r.autor}: ${r.texto}\n`).join('')
      )
      .join('');
    mkdirSync(dirname(arquivo), { recursive: true });
    writeFileSync(arquivo, cabecalho + corpo);
  }

  const autorDe = (a) => (a === 'ia' ? 'ia' : 'designer');
  const achar = (fila, id) => fila.itens.find((c) => c.id === Number(id));

  const pct = (n) => Math.max(0, Math.min(100, Math.round(Number(n))));
  const posDe = (p) =>
    p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)) ? { x: pct(p.x), y: pct(p.y) } : null;
  const mudarEstado = (c, estado) => {
    c.estado = estado;
    c.feito = estado === 'feito';
  };

  /* O que a barra e o agente recebem: id, estado (aberto|lido|feito), feito, pagina,
     seletor, pos, trecho, texto, respostas.

     `agente: true` é o agente lendo a fila: o que estava aberto vira lido, e é assim que
     o designer vê na barra, sem ninguém responder nada, que o pedido foi pego. */
  function ler({ agente = false } = {}) {
    const fila = parse();
    if (agente && fila.itens.some((c) => c.estado === 'aberto')) {
      for (const c of fila.itens) if (c.estado === 'aberto') mudarEstado(c, 'lido');
      escrever(fila);
    }
    return fila.itens;
  }

  function comentar(dados) {
    const texto = umaLinha(dados.texto, 2000);
    const seletor = umaLinha(dados.seletor, 300);
    if (!texto || !seletor) return { erro: 'comentário vazio' };
    const fila = parse();
    const id = fila.itens.reduce((n, c) => Math.max(n, c.id), 0) + 1;
    const comentario = {
      id,
      estado: 'aberto',
      feito: false,
      pagina: umaLinha(dados.pagina, 80) || '/',
      seletor,
      pos: posDe(dados.pos),
      trecho: umaLinha(dados.trecho, 80).replace(/"/g, "'"),
      texto,
      respostas: [],
    };
    fila.itens.push(comentario);
    escrever(fila);
    return { ok: true, id, comentario, arquivo: 'docs/COMENTARIOS-IA.md' };
  }

  /* Resposta na thread. `autor` é 'ia' (o agente) ou 'designer' (a barra). */
  function responder(dados) {
    const texto = umaLinha(dados.texto, 2000);
    if (!texto) return { erro: 'resposta vazia' };
    const fila = parse();
    const c = achar(fila, dados.id);
    if (!c) return { erro: `comentário #${dados.id} não existe` };
    c.respostas.push({ autor: autorDe(dados.autor), texto });
    /* Designer respondendo depois que o agente pegou: volta pra fila dele. */
    if (autorDe(dados.autor) === 'designer' && c.estado === 'lido') mudarEstado(c, 'aberto');
    escrever(fila);
    return { ok: true, comentario: c };
  }

  /* O designer corrige o próprio pedido. Volta pra aberto: o agente precisa ler de novo. */
  function editar(dados) {
    const texto = umaLinha(dados.texto, 2000);
    if (!texto) return { erro: 'comentário vazio' };
    const fila = parse();
    const c = achar(fila, dados.id);
    if (!c) return { erro: `comentário #${dados.id} não existe` };
    c.texto = texto;
    if (c.estado === 'lido') mudarEstado(c, 'aberto');
    escrever(fila);
    return { ok: true, comentario: c };
  }

  function apagar(dados) {
    const fila = parse();
    const c = achar(fila, dados.id);
    if (!c) return { erro: `comentário #${dados.id} não existe` };
    fila.itens = fila.itens.filter((x) => x !== c);
    escrever(fila);
    return { ok: true, id: c.id };
  }

  /* Feito/aberto. Normalmente o agente marca feito e o designer reabre ("ainda
     não"). Com `texto`, a mudança já vem explicada na thread. */
  function status(dados) {
    const fila = parse();
    const c = achar(fila, dados.id);
    if (!c) return { erro: `comentário #${dados.id} não existe` };
    const estado = ESTADO[MARCA[dados.estado]] ? dados.estado : dados.feito ? 'feito' : 'aberto';
    mudarEstado(c, estado);
    const texto = umaLinha(dados.texto, 2000);
    if (texto) c.respostas.push({ autor: autorDe(dados.autor), texto });
    escrever(fila);
    return { ok: true, comentario: c };
  }

  return { ler, comentar, responder, editar, apagar, status, arquivo };
}

/* O `next dev` do repo, com as flags do editor. `COPY_EDIT=1` liga o stega no
   servidor (request config do next-intl) e o rewrite do /__copy;
   `NEXT_PUBLIC_COPY_EDIT=1` é a mesma flag vista do BROWSER, que é onde mora o
   provider de um i18n client-only (o do board): sem o prefixo a variável não
   entra no bundle e o browser desmarcaria na hidratação o que o servidor marcou.
   Devolve a função que derruba o filho. */
export function subirNextDev(root, { porta, portaDev, sair }) {
  const next = spawn(
    process.execPath,
    [join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', String(portaDev)],
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, COPY_EDIT: '1', NEXT_PUBLIC_COPY_EDIT: '1', COPY_EDIT_PORTA: String(porta) },
    }
  );
  if (sair) next.on('exit', sair);
  return () => next.kill();
}

/* ── o servidor ──────────────────────────────────────────────────────────────
   Prefixo /__copy pra nunca colidir com rota do site. As rotas comuns moram
   aqui; o que muda de repo pra repo pergunta ao adapter:

     adapter.servir(req, res, url)  → true se atendeu (estático, barra do hero)
     adapter.chaves(pagina, {locale}) → { status, corpo }
     adapter.salvar(dados)          → { status, corpo }
     adapter.tokens()               → [{ grupo, nome, valor }]
     adapter.token(dados)           → { erro } | { ok, ... }   (async)
     adapter.estilo(dados)          → { erro } | { ok, ... }
     adapter.limpar(texto)          → texto sem chave invisível (opcional)
     adapter.dicaComentarios        → última frase do cabeçalho da fila */
export function criarServidor(root, adapter) {
  const fila = filaComentarios(root, {
    dica: adapter.dicaComentarios,
    limpar: adapter.limpar,
  });

  return createServer(async (req, res) => {
    const url = req.url || '/';
    const caminho = url.split('?')[0];

    if (adapter.servirAntes && (await adapter.servirAntes(caminho, res))) return;

    if (!url.startsWith('/__copy/')) {
      if (adapter.servir && (await adapter.servir(req, res, url))) return;
      res.writeHead(404).end('404');
      return;
    }

    if (ARQUIVOS_CLIENTE[caminho] !== undefined) {
      const f = ARQUIVOS_CLIENTE[caminho];
      try {
        if (!f) throw new Error('ausente');
        const corpo = await readFile(f);
        res.writeHead(200, { 'content-type': MIME[extname(f)], 'cache-control': 'no-store' });
        res.end(corpo);
      } catch {
        res.writeHead(404).end('ausente');
      }
      return;
    }

    const pagina = new URL(url, 'http://x').searchParams.get('pagina') || '/';

    if (caminho === '/__copy/chaves') {
      /* `locale` é o idioma que a página está mostrando (a ponte lê do stega).
         Só o i18n-objeto usa; os outros adapters ignoram o 2º argumento. */
      const locale = new URL(url, 'http://x').searchParams.get('locale') || undefined;
      const r = adapter.chaves(pagina, { locale });
      return json(res, r.status, r.corpo);
    }
    if (caminho === '/__copy/comentarios') {
      /* `todas=1` é a fila inteira, o que o agente lê; sem ele, só a página. */
      const q = new URL(url, 'http://x').searchParams;
      const todas = q.get('todas') === '1';
      const itens = fila.ler({ agente: q.get('agente') === '1' });
      return json(res, 200, { itens: todas ? itens : itens.filter((c) => c.pagina === pagina) });
    }
    if (caminho === '/__copy/tokens') {
      return json(res, 200, { tokens: adapter.tokens() });
    }
    if (req.method !== 'POST') {
      res.writeHead(404).end('não existe');
      return;
    }

    let dados;
    try {
      dados = await lerCorpo(req);
    } catch {
      return json(res, 400, { erro: 'json inválido' });
    }

    if (caminho === '/__copy/comentar') {
      const r = fila.comentar(dados);
      return json(res, r.erro ? 400 : 200, r);
    }
    if (caminho === '/__copy/comentario/responder') {
      const r = fila.responder(dados);
      return json(res, r.erro ? 400 : 200, r);
    }
    if (caminho === '/__copy/comentario/editar') {
      const r = fila.editar(dados);
      return json(res, r.erro ? 400 : 200, r);
    }
    if (caminho === '/__copy/comentario/apagar') {
      const r = fila.apagar(dados);
      return json(res, r.erro ? 400 : 200, r);
    }
    if (caminho === '/__copy/comentario/status') {
      const r = fila.status(dados);
      return json(res, r.erro ? 400 : 200, r);
    }
    if (caminho === '/__copy/token') {
      let r;
      try {
        r = await adapter.token(dados);
      } catch (e) {
        r = { erro: e.message };
      }
      return json(res, r.erro ? 400 : 200, r);
    }
    if (caminho === '/__copy/estilo') {
      let r;
      try {
        r = adapter.estilo(dados);
      } catch (e) {
        r = { erro: e.message };
      }
      return json(res, r.erro ? 400 : 200, r);
    }
    if (caminho === '/__copy/salvar') {
      const r = await adapter.salvar(dados);
      return json(res, r.status, r.corpo);
    }
    res.writeHead(404).end('não existe');
  });
}
