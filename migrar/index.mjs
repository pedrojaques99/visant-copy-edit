/* `copy-edit migrar`: transforma um app Next (App Router) com texto escrito no
 * JSX num app next-intl com a copy em JSON, do jeito que os 8 agentes fizeram
 * à mão no Club em 07/10/2026.
 *
 *   1. infra: se o repo não tem next-intl, monta a do Club (migrar/infra.mjs)
 *      e instala next-intl + @vercel/stega NO REPO (são dependências do site);
 *   2. codemod: varre app/** e components/** (.tsx) (migrar/codemod.mjs);
 *   3. o que não é óbvio vai pra copy-edit-migrar.md com arquivo:linha;
 *   4. checa tipo EM MEMÓRIA antes de gravar: arquivo que ficaria com erro
 *      novo volta pro original e vai pra revisão (melhor migrar 95% que zero);
 *   5. grava, roda os portões do repo (tsc, eslint nos arquivos mexidos,
 *      copy-lint nos JSON) e, se tsc ou eslint reprovarem, DESFAZ TUDO.
 *
 * `--dry` faz 1–4, escreve o diff e a revisão numa pasta temporária, e não
 * toca no repo.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { join, relative, dirname, basename, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { Project, Node, ts } from 'ts-morph';
import { createTwoFilesPatch } from 'diff';
import { detectar } from '../server/detectar.mjs';
import { analisarArquivo, literaisSobrando, motivoDeLiteral, Mensagens, ATRIBUTOS_HTML, ATRIBUTOS_COMPONENTE } from './codemod.mjs';
import { montarInfra, acrescentarIndex, identificador } from './infra.mjs';
import { camel } from './texto.mjs';
import { LINT_PADRAO } from '../server/nucleo.mjs';

const barra = (p) => p.replace(/\\/g, '/');

/* Texto que é SÓ uma marca não é copy: não muda com a voz, e os agentes não
   migraram. `--marca "Nome"` acrescenta as do repo. */
const MARCAS = ['Visant', 'Visant Club', 'Visant Labs', 'Visant Supply', 'Stripe', 'Substack', 'Discord', 'YouTube', 'Figma', 'WhatsApp', 'Instagram', 'Google', 'GitHub', 'Notion', 'Vercel', 'Cloudflare', 'LinkedIn', 'Behance'];
const ler = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};
const lerJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

/* Arquivo que o migrar não abre: rota de API, teste, story, imagem gerada
   (ImageResponse), e o global-error (fica FORA do layout raiz, então fora do
   provider do next-intl). */
const CATALOGO = /(Card|Poster|Rail|Capa|Billboard|Catalogo|Trilho|Vitrine|Deck)/;

const FORA = [/\/api\//, /\.(test|spec|stories)\.tsx$/, /\/(opengraph-image|twitter-image|icon|apple-icon)\.tsx$/, /\/global-error\.tsx$/];

function listar(dir, ext, saida = []) {
  if (!existsSync(dir)) return saida;
  for (const n of readdirSync(dir, { withFileTypes: true })) {
    if (n.name === 'node_modules' || n.name.startsWith('.')) continue;
    const p = join(dir, n.name);
    if (n.isDirectory()) listar(p, ext, saida);
    else if (ext.includes(extname(n.name))) saida.push(p);
  }
  return saida;
}

/* Rota (namespace) e seção de um arquivo dentro de app/. Grupo `(x)`, slot
   `@x`, pasta privada `_x` e segmento dinâmico `[x]` não contam. A página da
   rota fica sem seção (`biblioteca.titulo`, como os agentes fizeram); subpasta
   e arquivo que não é page viram seção (`admin.membros.titulo`). */
export function lugarNoApp(relApp) {
  const segs = relApp.split('/');
  const arq = segs.pop();
  const base = arq.replace(/\.[jt]sx?$/, '');
  const est = segs.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('@') && !/^\[.*\]$/.test(s) && !s.startsWith('_'));
  const rota = est[0] || null;
  const secoes = est.slice(1);
  if (base !== 'page') secoes.push(base === 'loading' ? 'carregando' : base === 'not-found' ? 'naoEncontrado' : base);
  let secao = secoes.length ? camel(secoes.join('-')) : null;
  if (!rota) return { ns: base === 'page' ? 'inicio' : 'comum', secao: base === 'page' ? null : secao };
  /* `definir-senha/DefinirSenha.tsx` não vira `definirSenha.definirSenha`. */
  if (secao && secao.toLowerCase() === camel(rota).toLowerCase()) secao = null;
  return { ns: rota, secao };
}

export async function migrar(root, opcoes = {}) {
  const log = opcoes.log || (() => {});
  const dry = !!opcoes.dry;
  const pkg = lerJson(join(root, 'package.json'));
  if (!pkg) return { ok: false, erro: 'sem package.json na raiz' };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps.next) return { ok: false, erro: 'o migrar é pra app Next (App Router), e este package.json não tem `next`' };
  const base = existsSync(join(root, 'src', 'app')) ? 'src/' : '';
  const appDir = join(root, base + 'app');
  if (!existsSync(appDir)) return { ok: false, erro: 'não achei app/ (o migrar é pro App Router)' };

  /* ── modo: next-intl já existe (só migra texto) ou monta a infra ─────── */
  const achado = detectar(root);
  let setup = false;
  let formato, pasta, arqLocale;
  if (achado.adapter === 'next-intl') {
    ({ formato, pasta } = achado.opcoes);
    if (formato === 'locale') arqLocale = `${pasta}/${achado.opcoes.localePadrao}.json`;
  } else if (deps['next-intl']) {
    return { ok: false, erro: `o repo tem next-intl, mas: ${achado.motivo}` };
  } else {
    setup = true;
    formato = 'rota';
    pasta = `${base}copy`;
  }
  log(setup ? 'sem next-intl: monto a infra do Club (um idioma, copy/<rota>.json)' : `next-intl já existe: formato ${formato}, mensagens em ${pasta}`);

  /* Instalar vem ANTES da análise quando grava: a checagem de tipo em
     memória precisa dos tipos do next-intl. No --dry nada é instalado. */
  const snapshot = new Map(); // caminho relativo → texto original | null (criado)
  const guardar = (rel) => {
    if (!snapshot.has(rel)) snapshot.set(rel, ler(join(root, rel)));
  };
  const instalado = () => existsSync(join(root, 'node_modules', 'next-intl', 'package.json'));
  if (setup && !dry && opcoes.instalar !== false) {
    guardar('package.json');
    guardar('package-lock.json');
    log('instalando next-intl e @vercel/stega no repo…');
    const r = (opcoes.instalar || instalarNpm)(root);
    if (!r.ok) {
      restaurar(root, snapshot);
      return { ok: false, erro: `npm install falhou:\n${r.saida}` };
    }
  }

  /* ── projeto ts-morph ───────────────────────────────────────────────── */
  const tsconfig = join(root, 'tsconfig.json');
  const project = existsSync(tsconfig)
    ? new Project({ tsConfigFilePath: tsconfig, skipAddingFilesFromTsConfig: false })
    : new Project({ compilerOptions: { jsx: ts.JsxEmit.Preserve, strict: true, esModuleInterop: true, resolveJsonModule: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler } });
  const dirsComp = [join(root, base + 'components')].filter(existsSync);
  const ignorar = (opcoes.ignorar || []).map((g) => barra(g).replace(/\/$/, ''));
  const relDe = (abs) => barra(relative(root, abs));
  const alvos = [appDir, ...dirsComp]
    .flatMap((d) => listar(d, ['.tsx']))
    .filter((abs) => {
      const r = '/' + relDe(abs);
      if (FORA.some((rx) => rx.test(r))) return false;
      return !ignorar.some((g) => r.startsWith('/' + g + '/') || r === '/' + g);
    });
  for (const a of alvos) if (!project.getSourceFile(a)) project.addSourceFileAtPath(a);
  const foraDoMigrar = [appDir, ...dirsComp].flatMap((d) => listar(d, ['.tsx'])).filter((abs) => FORA.some((rx) => rx.test('/' + relDe(abs))) && !/\.(test|spec|stories)\.tsx$/.test(abs));

  /* ── namespace de cada arquivo ───────────────────────────────────────── */
  const ehApp = (abs) => relDe(abs).startsWith(base + 'app/');
  const lugar = new Map();
  for (const abs of alvos) if (ehApp(abs)) lugar.set(abs, lugarNoApp(relDe(abs).slice((base + 'app/').length)));
  /* Componente fora de app/: as rotas de quem importa (subindo pelos
     componentes intermediários). Uma rota só → ela; mais de uma → comum, ou
     `catalogo` quando o nome do arquivo diz que é peça de vitrine (Card,
     Poster, Rail, Capa...), como os agentes separaram no Club. */
  const memo = new Map();
  const rotasDe = (sf, pilha = new Set()) => {
    const abs = sf.getFilePath();
    if (memo.has(abs)) return memo.get(abs);
    if (ehApp(abs)) {
      const l = lugarNoApp(relDe(abs).slice((base + 'app/').length));
      return new Set([l.ns]);
    }
    if (pilha.has(abs)) return new Set();
    pilha.add(abs);
    const r = new Set();
    for (const quem of sf.getReferencingSourceFiles()) for (const x of rotasDe(quem, pilha)) r.add(x);
    pilha.delete(abs);
    memo.set(abs, r);
    return r;
  };
  for (const abs of alvos) {
    if (lugar.has(abs)) continue;
    const rotas = rotasDe(project.getSourceFile(abs));
    const ns = rotas.size === 1 ? [...rotas][0] : CATALOGO.test(basename(abs)) ? 'catalogo' : 'comum';
    const sec = camel(basename(abs).replace(/\.[jt]sx?$/, ''));
    lugar.set(abs, { ns, secao: sec.toLowerCase() === camel(ns).toLowerCase() ? null : sec });
  }

  /* ── mensagens que já existem ────────────────────────────────────────── */
  const baseMsgs = {};
  const nsExistentes = new Set();
  if (formato === 'rota' && existsSync(join(root, pasta))) {
    for (const f of readdirSync(join(root, pasta)).filter((f) => f.endsWith('.json'))) {
      const ns = f.slice(0, -5);
      baseMsgs[ns] = lerJson(join(root, pasta, f)) || {};
      nsExistentes.add(ns);
    }
  } else if (formato === 'locale') {
    Object.assign(baseMsgs, lerJson(join(root, arqLocale)) || {});
  }

  /* ── o codemod, com a checagem de tipo em memória ────────────────────── */
  const originais = new Map(alvos.map((a) => [a, project.getSourceFile(a).getFullText()]));
  const marcas = new Set([...MARCAS, ...(opcoes.marcas || [])].map((m) => m.toLowerCase()));
  const atributosHtml = new Set(ATRIBUTOS_HTML);
  const atributosComponente = new Set(ATRIBUTOS_COMPONENTE);
  const barrados = new Map(); // abs → motivo (não compilou em memória)
  let rodada;
  const checar = opcoes.checarTipos !== false && (instalado() || !setup) && existsSync(join(root, 'node_modules', 'next-intl'));
  for (let volta = 0; volta < 4; volta++) {
    rodada = rodar();
    if (!checar) break;
    log(`checando tipo em memória (${rodada.mudados.size} arquivos)…`);
    const ruins = checarEmMemoria(rodada);
    if (!ruins.size) break;
    for (const [abs, msg] of ruins) barrados.set(abs, msg);
    log(`  ${ruins.size} arquivo(s) não compilariam; voltam pro original e vão pra revisão`);
  }

  function rodar() {
    const msgs = new Mensagens(baseMsgs);
    const revisao = [];
    const mudados = new Map(); // abs → texto novo
    const porNs = {};
    let migrados = 0;
    const editadosPorArq = new Map();
    for (const abs of alvos) {
      const sf = project.getSourceFile(abs);
      if (sf.getFullText() !== originais.get(abs)) sf.replaceWithText(originais.get(abs));
      if (barrados.has(abs)) {
        revisao.push({ arq: relDe(abs), linha: 1, motivo: 'Arquivo inteiro: a migração automática não compilaria (erro de tipo abaixo); migrar à mão', trecho: barrados.get(abs) });
        editadosPorArq.set(abs, new Set());
        continue;
      }
      const { ns, secao } = lugar.get(abs);
      const antes = msgs.novas + msgs.reusos;
      const r = analisarArquivo(sf, {
        ns,
        secao,
        msgs,
        marcas,
        atributosHtml,
        atributosComponente,
        revisao: (no, motivo, trecho) => revisao.push({ arq: relDe(abs), linha: no.getStartLineNumber(), motivo, trecho }),
      });
      editadosPorArq.set(abs, r.editados);
      /* A string que sobrou e parece copy vai pra revisão AQUI, no mesmo AST
         da análise: depois da checagem em memória o ts-morph recria os nós e
         a posição deixa de bater. */
      const servidor = /^['"]use server['"]/m.test(originais.get(abs));
      for (const lit of literaisSobrando(sf, r.editados))
        revisao.push({ arq: relDe(abs), linha: lit.getStartLineNumber(), motivo: motivoDeLiteral(lit, { servidor }), trecho: textoDe(lit) });
      if (!r.edicoes.length) continue;
      r.edicoes.push(...editarImports(sf, r.imports, r.eol, r.pontoVirgula));
      mudados.set(abs, aplicar(originais.get(abs), r.edicoes));
      migrados += r.migrados;
      porNs[ns] = (porNs[ns] || 0) + (msgs.novas + msgs.reusos - antes);
    }
    return { msgs, revisao, mudados, porNs, migrados, editadosPorArq };
  }

  /* Arquivo a arquivo: tsx novo + JSON novo + index.ts novo no projeto em
     memória, erro de tipo NOVO (que o original não tinha) barra o arquivo. */
  function checarEmMemoria(r) {
    const saidas = montarSaidas(r, true);
    const trocados = [];
    const trocar = (abs, texto) => {
      let sf = project.getSourceFile(abs);
      if (sf) {
        trocados.push([sf, sf.getFullText()]);
        sf.replaceWithText(texto);
      } else {
        sf = project.createSourceFile(abs, texto, { overwrite: true });
        trocados.push([sf, null]);
      }
    };
    /* Erros que já existiam (o original também tinha) não contam. */
    const antes = new Map();
    const chaveErro = (d) => `${d.getCode()}:${ts.flattenDiagnosticMessageText(d.getMessageText()?.compilerObject ?? d.getMessageText(), ' ').slice(0, 200)}`;
    const erros = (sf) => sf.getPreEmitDiagnostics().filter((d) => d.getCategory() === ts.DiagnosticCategory.Error);
    for (const abs of r.mudados.keys()) antes.set(abs, new Set(erros(project.getSourceFile(abs)).map(chaveErro)));
    for (const [rel, texto] of saidas) {
      const abs = join(root, rel);
      if (r.mudados.has(abs)) continue;
      if (/\.(json|ts)$/.test(rel)) trocar(abs, texto);
    }
    for (const [abs, texto] of r.mudados) trocar(abs, texto);
    const ruins = new Map();
    for (const abs of r.mudados.keys()) {
      const novos = erros(project.getSourceFile(abs)).filter((d) => !antes.get(abs).has(chaveErro(d)));
      if (novos.length) {
        const d = novos[0];
        ruins.set(abs, `linha ${d.getLineNumber() ?? '?'}: ${ts.flattenDiagnosticMessageText(d.getMessageText()?.compilerObject ?? d.getMessageText(), ' ').slice(0, 240)}`);
      }
    }
    for (const [sf, txt] of trocados.reverse()) {
      if (txt === null) project.removeSourceFile(sf);
      else sf.replaceWithText(txt);
    }
    return ruins;
  }

  /* Todos os arquivos que mudam (relativo → texto): tsx, JSON, index.ts, infra. */
  function montarSaidas(r, emMemoria = false) {
    const saidas = new Map();
    for (const [abs, texto] of r.mudados) saidas.set(relDe(abs), texto);
    const tocados = [...r.msgs.tocados];
    if (formato === 'rota') {
      for (const ns of tocados) {
        const p = `${pasta}/${ns}.json`;
        const eolJ = (ler(join(root, p)) || '').includes('\r\n') ? '\r\n' : '\n';
        saidas.set(p, JSON.stringify(r.msgs.arvore[ns], null, 2).replace(/\n/g, eolJ) + eolJ);
      }
      const novos = tocados.filter((ns) => !nsExistentes.has(ns)).sort();
      if (setup) {
        const infra = montarInfra(root, [...new Set([...nsExistentes, ...tocados])].sort());
        r.infra = infra;
        for (const [rel, texto] of infra.arquivos) saidas.set(rel, texto);
      } else if (novos.length) {
        const idx = `${pasta}/index.ts`;
        const txt = ler(join(root, idx));
        const novo = txt && acrescentarIndex(txt, novos);
        if (!novo) r.erroIndex = `${idx} não tem a forma esperada (export const COPY = { ... }): acrescente à mão os namespaces ${novos.join(', ')}`;
        else saidas.set(idx, novo);
      }
    } else if (tocados.length) {
      const eolJ = (ler(join(root, arqLocale)) || '').includes('\r\n') ? '\r\n' : '\n';
      saidas.set(arqLocale, JSON.stringify(r.msgs.arvore, null, 2).replace(/\n/g, eolJ) + eolJ);
    }
    return saidas;
  }

  /* ── revisão: o que sobrou de texto que parece copy ──────────────────── */
  const r = rodada;
  const saidas = montarSaidas(r);
  /* .ts do app (action, route handler) e lib/: nunca migrados, só listados. */
  const extras = [
    ...listar(appDir, ['.ts']).map((a) => [a, { servidor: true }]),
    ...listar(join(root, base + 'lib'), ['.ts', '.tsx']).map((a) => [a, { lib: true }]),
  ];
  for (const [abs, tipo] of extras) {
    if (/\.(test|spec)\.ts$/.test(abs) || /\.d\.ts$/.test(abs)) continue;
    const sf = project.getSourceFile(abs) || project.addSourceFileAtPath(abs);
    for (const lit of literaisSobrando(sf, new Set())) r.revisao.push({ arq: relDe(abs), linha: lit.getStartLineNumber(), motivo: motivoDeLiteral(lit, tipo), trecho: textoDe(lit) });
  }
  for (const abs of foraDoMigrar) r.revisao.push({ arq: relDe(abs), linha: 1, motivo: 'Arquivo fora do migrar (global-error fica fora do provider; imagem gerada / ícone): texto à mão', trecho: '' });
  if (r.erroIndex) r.revisao.push({ arq: `${pasta}/index.ts`, linha: 1, motivo: 'Infra', trecho: r.erroIndex });
  if (r.infra) for (const e of r.infra.erros) r.revisao.push({ arq: '(infra)', linha: 1, motivo: 'Infra do next-intl que não montei sozinho', trecho: e });
  if (formato === 'locale' && achado.opcoes.locales.length > 1)
    r.revisao.push({ arq: arqLocale, linha: 1, motivo: 'Outros idiomas', trecho: `as chaves novas entraram só em ${arqLocale}; ${achado.opcoes.locales.filter((l) => l !== achado.opcoes.localePadrao).join(', ')} precisam da tradução` });

  const resumo = {
    modo: setup ? 'infra + texto' : 'texto',
    arquivos: r.mudados.size,
    migrados: r.migrados,
    chavesNovas: r.msgs.novas,
    reusos: r.msgs.reusos,
    revisao: r.revisao.length,
    barrados: barrados.size,
    porNs: r.porNs,
    namespacesNovos: [...r.msgs.tocados].filter((ns) => !nsExistentes.has(ns)).sort(),
    notas: [...(achado.notas || []).filter((n) => /ATENÇÃO/.test(n)), ...(r.infra?.notas || [])],
  };
  const md = relatorio(resumo, r.revisao, dry);

  /* ── seco: diff e revisão numa pasta temporária ──────────────────────── */
  if (dry) {
    const dir = mkdtempSync(join(tmpdir(), 'copy-edit-migrar-'));
    let patch = '';
    for (const [rel, novo] of saidas) {
      const antigo = ler(join(root, rel)) ?? '';
      patch += createTwoFilesPatch('a/' + rel, 'b/' + rel, antigo.replace(/\r\n/g, '\n'), novo.replace(/\r\n/g, '\n'), '', '', { context: 2 });
    }
    writeFileSync(join(dir, 'migrar.diff'), patch);
    writeFileSync(join(dir, 'copy-edit-migrar.md'), md);
    return { ok: true, dry: true, resumo, diff: join(dir, 'migrar.diff'), revisaoArq: join(dir, 'copy-edit-migrar.md'), patch, saidas };
  }

  if (r.infra?.erros.length) {
    restaurar(root, snapshot);
    return { ok: false, erro: `não montei a infra do next-intl:\n  · ${r.infra.erros.join('\n  · ')}`, resumo };
  }

  /* ── grava ──────────────────────────────────────────────────────────── */
  const tocadosTsx = [...r.mudados.keys()].map(relDe);
  const lintAntes = opcoes.eslint === false ? null : eslint(root, tocadosTsx, opcoes.eslint);
  for (const [rel, texto] of saidas) {
    guardar(rel);
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), texto);
  }

  /* ── portões ────────────────────────────────────────────────────────── */
  const portoes = [];
  const tsc = opcoes.tsc === false ? null : rodarCmd(root, opcoes.tsc || ['npx', '--no-install', 'tsc', '--noEmit']);
  if (tsc) portoes.push({ nome: 'tsc --noEmit', ok: tsc.ok, saida: tsc.saida });
  let lintDepois = null;
  if (lintAntes) {
    lintDepois = eslint(root, tocadosTsx, opcoes.eslint);
    const novos = lintDepois.erros - lintAntes.erros;
    portoes.push({ nome: `eslint (${tocadosTsx.length} arquivos mexidos)`, ok: novos <= 0, saida: novos > 0 ? lintDepois.saida : `${lintDepois.erros} erro(s), ${lintAntes.erros} já existiam` });
  }
  const jsons = [...saidas.keys()].filter((k) => k.endsWith('.json') && k !== 'package.json' && k !== 'package-lock.json');
  if (jsons.length && opcoes.copyLint !== false) {
    const cl = rodarCmd(root, [process.execPath, LINT_PADRAO, ...jsons]);
    /* copy-lint só informa: migração não é reescrita, o vício que o texto já
       tinha continua lá e é trabalho do dono, não motivo pra desfazer. */
    portoes.push({ nome: 'copy-lint (só informa)', ok: true, aviso: !cl.ok, saida: cl.saida });
  }
  const reprovou = portoes.find((p) => !p.ok);
  if (reprovou) {
    restaurar(root, snapshot);
    let jaReprovava = false;
    if (reprovou.nome.startsWith('tsc')) jaReprovava = !rodarCmd(root, opcoes.tsc || ['npx', '--no-install', 'tsc', '--noEmit']).ok;
    const dir = mkdtempSync(join(tmpdir(), 'copy-edit-migrar-'));
    writeFileSync(join(dir, 'copy-edit-migrar.md'), md);
    return { ok: false, desfeito: true, erro: `${reprovou.nome} reprovou; desfiz tudo, o repo voltou como estava.${jaReprovava ? ' (o tsc JÁ reprovava antes da migração: conserte isso primeiro)' : ''}`, portoes, resumo, revisaoArq: join(dir, 'copy-edit-migrar.md') };
  }
  writeFileSync(join(root, 'copy-edit-migrar.md'), md);
  return { ok: true, resumo, portoes, revisaoArq: join(root, 'copy-edit-migrar.md'), gravados: [...saidas.keys()] };
}

/* ── peças ────────────────────────────────────────────────────────────── */

function textoDe(lit) {
  const t = Node.isTemplateExpression(lit) ? lit.getText().slice(1, -1) : lit.getLiteralValue();
  return t.length > 90 ? t.slice(0, 87) + '…' : t;
}

/* Edições de trás pra frente. Sobreposição é bug do codemod: a segunda (a de
   fora) é descartada inteira, nunca aplicada pela metade. */
export function aplicar(texto, edicoes) {
  const ord = [...edicoes].sort((a, b) => b.ini - a.ini || b.fim - a.fim);
  let out = texto;
  let limite = Infinity;
  for (const e of ord) {
    if (e.fim > limite) continue;
    out = out.slice(0, e.ini) + e.texto + out.slice(e.fim);
    limite = e.ini;
  }
  return out;
}

/* import { useTranslations } from 'next-intl' / { getTranslations } from
   'next-intl/server': junta no import que já existe, senão linha nova depois
   do último import (ou depois do 'use client'). */
function editarImports(sf, nomes, eol, semi) {
  const ed = [];
  for (const nome of nomes) {
    const mod = nome === 'getTranslations' ? 'next-intl/server' : 'next-intl';
    const existente = sf.getImportDeclarations().find((d) => d.getModuleSpecifierValue() === mod && !d.isTypeOnly());
    if (existente?.getNamedImports().some((n) => n.getName() === nome)) continue;
    const ni = existente?.getNamedImports();
    if (existente && ni.length) {
      ed.push({ ini: ni.at(-1).getEnd(), fim: ni.at(-1).getEnd(), texto: `, ${nome}` });
      continue;
    }
    const linha = `import { ${nome} } from '${mod}'${semi ? ';' : ''}`;
    const imps = sf.getImportDeclarations();
    if (imps.length) ed.push({ ini: imps.at(-1).getEnd(), fim: imps.at(-1).getEnd(), texto: eol + linha });
    else {
      const dir = sf.getStatements()[0];
      if (dir && Node.isExpressionStatement(dir) && Node.isStringLiteral(dir.getExpression())) ed.push({ ini: dir.getEnd(), fim: dir.getEnd(), texto: eol + eol + linha + eol });
      else ed.push({ ini: 0, fim: 0, texto: linha + eol });
    }
  }
  return ed;
}

function restaurar(root, snapshot) {
  for (const [rel, txt] of snapshot) {
    const abs = join(root, rel);
    if (txt === null) rmSync(abs, { force: true });
    else writeFileSync(abs, txt);
  }
}

function rodarCmd(root, cmd) {
  if (typeof cmd === 'function') return cmd(root);
  /* shell só pro npm/npx (no Windows são .cmd); o node vai direto, senão o
     espaço de "C:\Program Files" quebra a linha de comando. */
  const shell = process.platform === 'win32' && /^(npm|npx)$/.test(cmd[0]);
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: root, encoding: 'utf8', shell, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, saida: ((r.stdout || '') + (r.stderr || '')).trim() };
}

function instalarNpm(root) {
  return rodarCmd(root, ['npm', 'install', 'next-intl', '@vercel/stega']);
}

/* ESLint só nos arquivos mexidos, contado antes e depois: o erro que já
   existia não é culpa da migração. */
function eslint(root, arquivos, cmd) {
  const temConfig = readdirSync(root).some((f) => /^(eslint\.config\.\w+|\.eslintrc(\.\w+)?)$/.test(f));
  if (!temConfig || !arquivos.length) return null;
  if (typeof cmd === 'function') return cmd(root, arquivos);
  const r = rodarCmd(root, ['npx', '--no-install', 'eslint', '--format', 'json', ...arquivos.map((a) => `"${a}"`)]);
  try {
    const j = JSON.parse(r.saida.slice(r.saida.indexOf('[')));
    const erros = j.reduce((s, f) => s + f.errorCount, 0);
    const linhas = j.flatMap((f) => f.messages.filter((m) => m.severity === 2).map((m) => `${barra(relative(root, f.filePath))}:${m.line} ${m.ruleId}: ${m.message}`));
    return { erros, saida: linhas.slice(0, 40).join('\n') };
  } catch {
    return { erros: r.ok ? 0 : 1, saida: r.saida.slice(0, 4000) };
  }
}

/* "Frase cortada por elemento (<strong>): t.rich à mão" → o título do grupo
   sem o caso, e o caso vai pra linha do item. Sem isso cada variável virava
   um grupo de um item só e a revisão não se lia. */
function separarDetalhe(motivo) {
  for (let i = motivo.indexOf(' ('); i >= 0; i = motivo.indexOf(' (', i + 1)) {
    let prof = 0;
    let j = i + 1;
    for (; j < motivo.length; j++) {
      if (motivo[j] === '(') prof++;
      else if (motivo[j] === ')' && --prof === 0) break;
    }
    const dentro = motivo.slice(i + 2, j);
    if (/[`<]/.test(dentro)) return { motivo: motivo.slice(0, i) + motivo.slice(j + 1), detalhe: dentro };
  }
  return { motivo, detalhe: '' };
}

function relatorio(resumo, revisao, dry) {
  const porMotivo = new Map();
  for (const it of revisao) {
    const { motivo, detalhe } = separarDetalhe(it.motivo);
    if (!porMotivo.has(motivo)) porMotivo.set(motivo, []);
    porMotivo.get(motivo).push({ ...it, detalhe });
  }
  const grupos = [...porMotivo].sort((a, b) => b[1].length - a[1].length);
  const ns = Object.entries(resumo.porNs).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
  let md = `# copy-edit migrar: revisão

${dry ? 'Rodada seca (`--dry`): nada foi gravado.' : 'Gerado pelo `copy-edit migrar` (pacote @visant/copy-edit).'}

- ${resumo.migrados} textos migrados em ${resumo.arquivos} arquivos (${resumo.chavesNovas} chaves novas, ${resumo.reusos} reaproveitadas)
- por namespace: ${ns || 'nenhum'}
- ${resumo.revisao} itens pra revisão (abaixo), ${resumo.barrados} arquivo(s) barrados pela checagem de tipo
${resumo.namespacesNovos.length ? `- namespaces novos: ${resumo.namespacesNovos.join(', ')}\n` : ''}${resumo.notas.map((n) => `- ${n}\n`).join('')}
O que está aqui NÃO foi migrado de propósito: não é óbvio, e chutar é pior que deixar.
Mesma régua dos agentes de 07/10: texto de lib/, mensagem de servidor, mapa compartilhado,
condicional que não é plural, frase cortada por elemento com conteúdo.

`;
  for (const [motivo, itens] of grupos) {
    md += `## ${motivo} (${itens.length})\n\n`;
    for (const it of itens) md += `- \`${it.arq}:${it.linha}\`${it.trecho ? ` ${JSON.stringify(it.trecho)}` : ''}${it.detalhe ? ` (${it.detalhe})` : ''}\n`;
    md += '\n';
  }
  return md;
}
