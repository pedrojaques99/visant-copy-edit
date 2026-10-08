/* Detecção: `copy-edit` num repo SEM copy-edit.config.mjs descobre sozinho
 * qual adapter usar e com quais opções, e escreve a config que achou.
 *
 * Ordem, a primeira que casar ganha:
 *   1. Next + next-intl  → acha o request config (o caminho passado ao
 *      createNextIntlPlugin no next.config, ou i18n/request.ts e
 *      src/i18n/request.ts) e LÊ dele onde moram as mensagens:
 *        import(`@/messages/${locale}.json`)  → formato 'locale' (site de cliente)
 *        import { COPY } from '@/copy'        → formato 'rota' (Club), quando a
 *                                               pasta tem um JSON por rota
 *   2. i18next / react-i18next (deps + locales/<idioma>/<ns>.json) → i18n-objeto
 *   3. i18n próprio de objeto: pasta locales|i18n|lang com um arquivo por idioma
 *      E um provider que importa eles (o board) → i18n-objeto, com o acessor
 *      que os componentes usam (pro migrar)
 *   4. HTML estático com `data-copy` + copy*.json na raiz (visantismo).
 *   5. Nada disso → não sobe: oferece o `copy-edit migrar` (fase 3).
 *
 * POR QUE ESCREVER A CONFIG em vez de detectar toda vez: um editor que GRAVA
 * arquivo não pode mudar de ideia entre uma subida e outra porque alguém criou
 * um JSON novo. A detecção é o primeiro rascunho; a config é o contrato, fica no
 * git e o dono corrige à mão o que ela errou. Com config no repo, ela manda e a
 * detecção nem roda.
 *
 * Nada aqui grava, sobe processo ou dá exit: devolve o que achou, e o bin
 * decide. É o que deixa testar com fixture em diretório temporário.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, basename } from 'node:path';

const lerTexto = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
};
const lerJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};
const ehDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const barra = (p) => p.replace(/\\/g, '/');
const rel = (root, p) => barra(relative(root, p)) || '.';
const primeiro = (root, lista) => lista.map((p) => join(root, p)).find((p) => existsSync(p));

/* ── next-intl ─────────────────────────────────────────────────────────── */

const EXT_TS = ['.ts', '.tsx', '.js', '.mjs', '.jsx'];

/* `@/x` vira caminho pelo `paths` do tsconfig (o `@/*` dos dois repos aponta
   pra raiz, mas `src/` é comum em projeto novo); relativo, pelo arquivo. O
   tsconfig pode ter comentário, então regex e não JSON.parse. */
function resolverEspec(root, deArquivo, espec) {
  if (espec.startsWith('@/')) {
    const ts = lerTexto(join(root, 'tsconfig.json')) || lerTexto(join(root, 'jsconfig.json'));
    const m = ts.match(/"@\/\*"\s*:\s*\[\s*"([^"]+)"/);
    const base = m ? m[1].replace(/\*$/, '') : './';
    return resolve(root, base, espec.slice(2));
  }
  if (espec.startsWith('.')) return resolve(dirname(deArquivo), espec);
  return null;
}

function acharRequestConfig(root) {
  for (const nome of ['next.config.ts', 'next.config.mjs', 'next.config.js', 'next.config.cjs']) {
    const txt = lerTexto(join(root, nome));
    if (!txt) continue;
    /* createNextIntlPlugin('./lib/i18n/request.ts') ou ({ requestConfig: '...' }) */
    const m =
      txt.match(/createNextIntlPlugin\(\s*['"`]([^'"`]+)['"`]/) ||
      txt.match(/createNextIntlPlugin\(\s*\{[^}]*requestConfig\s*:\s*['"`]([^'"`]+)['"`]/);
    if (m) {
      const p = resolve(root, m[1]);
      if (existsSync(p)) return { arquivo: p, via: `${nome} (createNextIntlPlugin)` };
    }
  }
  for (const base of ['i18n/request', 'src/i18n/request']) {
    const p = primeiro(root, EXT_TS.map((e) => base + e));
    if (p) return { arquivo: p, via: 'caminho padrão do next-intl' };
  }
  return null;
}

/* As rotas de topo do app: as pastas de `app/` (ou `src/app/`), atravessando
   grupo `(x)`, sem `api`, `_privada` e segmento dinâmico. É contra isso que um
   JSON do formato 'rota' se diz rota ou compartilhado. */
function rotasDoApp(root) {
  const app = [join(root, 'app'), join(root, 'src', 'app')].find(ehDir);
  if (!app) return [];
  const rotas = new Set();
  const andar = (dir) => {
    for (const n of readdirSync(dir)) {
      if (!ehDir(join(dir, n))) continue;
      if (/^\(.+\)$/.test(n)) andar(join(dir, n));
      else if (!/^[_[@]/.test(n) && n !== 'api') rotas.add(n);
    }
  };
  andar(app);
  return [...rotas];
}

function localePadraoDe(arquivoRequest, locales) {
  const pasta = dirname(arquivoRequest);
  for (const n of readdirSync(pasta)) {
    const m = lerTexto(join(pasta, n)).match(/defaultLocale\s*:\s*['"]([^'"]+)['"]/);
    if (m && locales.includes(m[1])) return m[1];
  }
  return locales.includes('pt-BR') ? 'pt-BR' : locales[0];
}

const jsonsDe = (dir) =>
  ehDir(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.slice(0, -5))
        .sort()
    : [];

function nextIntl(root, pkg) {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps.next || !deps['next-intl']) return null;
  const notas = ['Next + next-intl no package.json.'];
  const req = acharRequestConfig(root);
  if (!req) {
    return {
      adapter: null,
      motivo:
        'é um app Next + next-intl, mas não achei o request config (nem no createNextIntlPlugin do next.config, nem em i18n/request.ts ou src/i18n/request.ts).',
    };
  }
  const fonte = lerTexto(req.arquivo);
  notas.push(`request config: ${rel(root, req.arquivo)} (${req.via}).`);

  let opcoes = null;
  /* 1. import(`<pasta>/${locale}.json`) */
  const dinamico = fonte.match(/import\(\s*`([^`]*?)\$\{[^}]+\}\.json`\s*\)/);
  if (dinamico) {
    const dir = resolverEspec(root, req.arquivo, dinamico[1].replace(/\/$/, '') || '.');
    const locales = dir ? jsonsDe(dir) : [];
    if (locales.length) {
      opcoes = {
        formato: 'locale',
        pasta: rel(root, dir),
        locales,
        localePadrao: localePadraoDe(req.arquivo, locales),
      };
      notas.push(`mensagens em ${opcoes.pasta}/<idioma>.json (${locales.join(', ')}).`);
    }
  }
  /* 2. import estático: pasta com um JSON por rota, ou um JSON só. */
  if (!opcoes) {
    for (const m of fonte.matchAll(/import\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/g)) {
      const alvo = resolverEspec(root, req.arquivo, m[1]);
      if (!alvo) continue;
      if (ehDir(alvo) && jsonsDe(alvo).length) {
        const jsons = jsonsDe(alvo);
        const rotas = rotasDoApp(root);
        opcoes = {
          formato: 'rota',
          pasta: rel(root, alvo),
          compartilhados: jsons.filter((j) => !rotas.includes(j)),
        };
        notas.push(
          `mensagens em ${opcoes.pasta}/<rota>.json (${jsons.length} arquivos); ` +
            `os que não são rota do app viram compartilhados: ${opcoes.compartilhados.join(', ') || 'nenhum'}.`
        );
        break;
      }
      const arqJson = alvo.endsWith('.json') ? alvo : alvo + '.json';
      if (existsSync(arqJson)) {
        const locale = basename(arqJson, '.json');
        opcoes = { formato: 'locale', pasta: rel(root, dirname(arqJson)), locales: [locale], localePadrao: locale };
        notas.push(`mensagens num arquivo só: ${rel(root, arqJson)}.`);
        break;
      }
    }
  }
  if (!opcoes) {
    return {
      adapter: null,
      motivo: `é um app Next + next-intl, mas o ${rel(root, req.arquivo)} não importa as mensagens de um JSON que eu reconheça.`,
    };
  }

  if (!/@vercel\/stega/.test(fonte)) {
    notas.push(
      `ATENÇÃO: o ${rel(root, req.arquivo)} ainda não esconde a chave no texto (@vercel/stega com COPY_EDIT=1). ` +
        'Sem isso a barra não acha o texto: veja o README do pacote, "Ligar num app next-intl".'
    );
  }

  const css = primeiro(root, ['app/globals.css', 'src/app/globals.css', 'styles/globals.css', 'src/styles/globals.css']);
  if (css && /^(@theme|:root)\s*\{/m.test(lerTexto(css))) {
    opcoes.tokens = { css: rel(root, css) };
    if (pkg.scripts?.['tokens:check']) opcoes.tokens.checar = 'npm run tokens:check';
    notas.push(
      `tokens nos blocos de topo do ${opcoes.tokens.css}` +
        (opcoes.tokens.checar ? `, com o portão ${opcoes.tokens.checar}.` : ', sem portão.')
    );
  }
  const lint = primeiro(root, ['scripts/vendor/copy-lint.mjs', 'scripts/copy-lint.mjs']);
  if (lint) opcoes.lint = rel(root, lint);

  return { adapter: 'next-intl', opcoes, notas };
}

/* ── HTML estático ─────────────────────────────────────────────────────── */

/* `node scripts/x.mjs build` → ['scripts/x.mjs', 'build'], que é a forma que
   o html-json roda (sem shell). Script que não é `node <arquivo>` fica de fora. */
const argsNode = (cmd) => {
  const m = String(cmd || '').match(/^node\s+(\S+\.m?js)((?:\s+[^\s&|;]+)*)\s*$/);
  return m ? [m[1], ...m[2].trim().split(/\s+/).filter(Boolean)] : null;
};

function htmlJson(root, pkg) {
  const nomes = readdirSync(root);
  const jsons = nomes.filter((f) => /^copy([.-][\w-]+)?\.json$/.test(f));
  const htmls = nomes.filter((f) => f.endsWith('.html'));
  if (!jsons.length || !htmls.length) return null;

  const chavesDe = Object.fromEntries(jsons.map((j) => [j, new Set(Object.keys(lerJson(join(root, j)) || {}))]));
  const paginas = [];
  for (const html of htmls) {
    const usadas = [...lerTexto(join(root, html)).matchAll(/data-copy="([^"]+)"/g)].map((m) => m[1]);
    if (!usadas.length) continue;
    /* O JSON da página é o que mais cobre as chaves que ela usa. */
    let melhor = null;
    let nota = 0;
    for (const j of jsons) {
      const n = usadas.filter((k) => chavesDe[j].has(k)).length;
      if (n > nota) [melhor, nota] = [j, n];
    }
    if (melhor) paginas.push({ copy: melhor, html });
  }
  if (!paginas.length) return null;

  const opcoes = { paginas };
  const notas = [
    `HTML estático com data-copy: ${paginas.map((p) => `${p.html} → ${p.copy}`).join(', ')}.`,
  ];
  const build = argsNode(pkg.scripts?.['copy:build']);
  if (build) {
    opcoes.build = build;
    notas.push(`build de copy: node ${build.join(' ')}.`);
  } else {
    notas.push('ATENÇÃO: sem `copy:build` no package.json, o save grava o JSON e NÃO regera o HTML.');
  }
  const lint = primeiro(root, ['scripts/copy-lint.mjs', 'scripts/vendor/copy-lint.mjs']);
  if (lint) opcoes.lint = rel(root, lint);
  if (existsSync(join(root, 'styles.css'))) opcoes.css = 'styles.css';
  const tokens = lerJson(join(root, 'tokens.json'));
  const buildTokens = argsNode(pkg.scripts?.['tokens:build']);
  if (Array.isArray(tokens?.grupos) && buildTokens) {
    opcoes.tokens = { arquivo: 'tokens.json', build: buildTokens };
    notas.push('tokens no tokens.json (grupos), com tokens:build.');
  }
  return { adapter: 'html-json', opcoes, notas };
}

/* ── i18n próprio: i18next e objeto de mensagens ───────────────────────── */

/* Onde repo costuma guardar arquivo de idioma. A ordem importa pouco: vale a
   primeira pasta que tem cara de idioma (arquivo ou subpasta com nome de locale). */
const PASTAS_IDIOMA = [
  'locales', 'src/locales', 'public/locales', 'i18n', 'src/i18n', 'i18n/locales', 'src/i18n/locales',
  'lang', 'src/lang', 'public/lang', 'translations', 'src/translations', 'messages', 'src/messages',
  'assets/locales', 'src/assets/locales',
];
const NOME_IDIOMA = /^[a-z]{2,3}([-_][A-Za-z]{2,4})?$/;
const EXT_IDIOMA = /\.(ts|js|mjs|json)$/;

/* { pasta, locales: { idioma: rel(arquivo|pasta) }, modo: 'arquivo'|'pasta' } ou null */
function pastaDeIdiomas(root) {
  for (const p of PASTAS_IDIOMA) {
    const dir = join(root, p);
    if (!ehDir(dir)) continue;
    const nomes = readdirSync(dir);
    const subpastas = nomes.filter((n) => NOME_IDIOMA.test(n) && ehDir(join(dir, n)) && readdirSync(join(dir, n)).some((f) => f.endsWith('.json')));
    if (subpastas.length) return { pasta: p, modo: 'pasta', locales: Object.fromEntries(subpastas.sort().map((l) => [l, `${p}/${l}`])) };
    const arquivos = nomes.filter((n) => EXT_IDIOMA.test(n) && NOME_IDIOMA.test(n.replace(EXT_IDIOMA, '')) && !/\.d\.ts$/.test(n));
    if (arquivos.length) return { pasta: p, modo: 'arquivo', locales: Object.fromEntries(arquivos.sort().map((f) => [f.replace(EXT_IDIOMA, ''), `${p}/${f}`])) };
  }
  return null;
}

/* O idioma do texto escrito no JSX: a casa é brasileira, então pt-* quando
   existe; senão o que a config do i18n diz (fallbackLng, lng, defaultLocale);
   senão o primeiro. É nele que o `migrar` grava e o save sem idioma cai. */
function idiomaPadrao(locales, textos = []) {
  const ls = Object.keys(locales);
  const pt = ls.find((l) => /^pt([-_]br)?$/i.test(l)) || ls.find((l) => /^pt/i.test(l));
  if (pt) return pt;
  for (const t of textos) {
    const m = t.match(/(?:fallbackLng|defaultLocale|lng)\s*:\s*['"]([^'"]+)['"]/);
    if (m && ls.includes(m[1])) return m[1];
  }
  return ls[0];
}

/* Os fontes do repo (sem node_modules, build, public), pra achar quem importa
   os arquivos de idioma e como os componentes leem a copy. Teto de arquivos
   pra a detecção nunca virar uma varredura de minutos. */
const FORA_DA_VARREDURA = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'out', 'public', 'coverage', '.vercel', '.turbo', 'tmp', '.tmp']);
function fontes(root, teto = 6000) {
  const saida = [];
  const andar = (dir) => {
    if (saida.length >= teto) return;
    let nomes;
    try {
      nomes = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const n of nomes) {
      if (n.name.startsWith('.') && n.isDirectory()) continue;
      if (n.isDirectory()) {
        if (!FORA_DA_VARREDURA.has(n.name)) andar(join(dir, n.name));
      } else if (/\.(tsx?|jsx?|mjs)$/.test(n.name) && !/\.d\.ts$/.test(n.name)) saida.push(join(dir, n.name));
    }
  };
  andar(root);
  return saida;
}

const semExt = (p) => p.replace(/\.(tsx?|jsx?|mjs|json)$/, '');
const IMPORT = /import\s+([^'"]*?)\s+from\s+['"]([^'"]+)['"]/g;

/* Quem importa os arquivos de idioma (o provider) e com qual nome de export. */
function acharProvider(root, idiomas, arquivosFonte) {
  const alvos = new Map(Object.entries(idiomas.locales).map(([l, r]) => [semExt(resolve(root, r)), l]));
  const candidatos = [];
  for (const f of arquivosFonte) {
    const txt = lerTexto(f);
    if (!/locale|lang|i18n|messages|translation/i.test(txt)) continue;
    const imports = [];
    for (const m of txt.matchAll(IMPORT)) {
      const alvo = resolverEspec(root, f, m[2]);
      if (alvo && alvos.has(semExt(alvo))) imports.push({ clausula: m[1], locale: alvos.get(semExt(alvo)) });
    }
    if (!imports.length) continue;
    /* `import { messages as en }` → export 'messages'; `import en from` → default */
    const nomeado = imports[0].clausula.match(/\{\s*([A-Za-z_$][\w$]*)/);
    const locales = [...new Set(imports.map((i) => i.locale))];
    /* Um componente que importa só o pt-br pra ler um texto não é o provider
       (no board, o BriefingQuestionsEditor): o provider é quem junta os idiomas
       e exporta contexto ou hook. */
    const nota = locales.length * 10 + (/createContext|Provider|export\s+(function|const)\s+use[A-Z]/.test(txt) ? 5 : 0);
    candidatos.push({ arquivo: f, texto: txt, exportar: nomeado ? nomeado[1] : 'default', locales, nota });
  }
  return candidatos.sort((x, y) => y.nota - x.nota)[0] || null;
}

/* Como os componentes leem a copy: o hook que o provider exporta, o campo que
   sai dele e a forma de uso. `const { messages } = useI18n()` + `messages.a.b`
   é forma 'objeto'; `const { t } = useI18n()` + `t('a.b')` é 'funcao'. Só
   devolve quando a contagem não deixa dúvida; senão o dono escreve na config. */
function acharAcessor(root, provider, arquivosFonte) {
  const hooks = [...provider.texto.matchAll(/export\s+(?:function|const)\s+(use[A-Z]\w*)/g)].map((m) => m[1]);
  if (!hooks.length) return null;
  const votos = new Map(); // `${hook}|${campo}|${forma}` → n
  const specs = new Map();
  for (const f of arquivosFonte) {
    if (f === provider.arquivo) continue;
    const txt = lerTexto(f);
    for (const hook of hooks) {
      if (!txt.includes(hook + '(')) continue;
      const imp = [...txt.matchAll(IMPORT)].find((m) => new RegExp(`\\b${hook}\\b`).test(m[1]));
      if (imp) specs.set(imp[2], (specs.get(imp[2]) || 0) + 1);
      for (const m of txt.matchAll(new RegExp(`const\\s*\\{([^}]*)\\}\\s*=\\s*${hook}\\(\\s*\\)`, 'g'))) {
        for (const parte of m[1].split(',')) {
          const [prop, local = prop] = parte.split(':').map((s) => s.trim());
          if (!/^[A-Za-z_$][\w$]*$/.test(prop) || !/^[A-Za-z_$][\w$]*$/.test(local)) continue;
          const objeto = (txt.match(new RegExp(`\\b${local}\\.[A-Za-z_$][\\w$]*\\.[A-Za-z_$]`, 'g')) || []).length;
          const funcao = (txt.match(new RegExp(`\\b${local}\\(\\s*['"\`]`, 'g')) || []).length;
          if (objeto) votos.set(`${hook}|${prop}|objeto`, (votos.get(`${hook}|${prop}|objeto`) || 0) + objeto);
          if (funcao) votos.set(`${hook}|${prop}|funcao`, (votos.get(`${hook}|${prop}|funcao`) || 0) + funcao);
        }
      }
    }
  }
  const ord = [...votos].sort((a, b) => b[1] - a[1]);
  if (!ord.length || (ord[1] && ord[1][1] * 3 > ord[0][1])) return null; // empate não é detecção
  const [hook, campo, forma] = ord[0][0].split('|');
  const de = [...specs].sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    hook,
    campo,
    forma,
    /* `@/x` vale de qualquer arquivo; relativo só vale de onde foi escrito, então
       o migrar calcula o caminho a partir do arquivo do provider. */
    de: de && !de.startsWith('.') ? de : undefined,
    arquivo: rel(root, provider.arquivo),
    usos: ord[0][1],
  };
}

const portaDoDev = (pkg) => {
  const m = String(pkg.scripts?.dev || '').match(/(?:-p|--port)\s+(\d+)/);
  return m ? Number(m[1]) : undefined;
};

function comumAoObjeto(root, pkg, opcoes, notas) {
  const porta = portaDoDev(pkg);
  if (porta) opcoes.portaDev = porta;
  const lint = primeiro(root, ['scripts/vendor/copy-lint.mjs', 'scripts/copy-lint.mjs']);
  if (lint) opcoes.lint = rel(root, lint);
  notas.push(`idioma padrão ${opcoes.localePadrao}: é nele que o \`migrar\` escreve e o save sem idioma cai (o texto da casa é pt-BR).`);
}

function i18next(root, pkg) {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const lib = ['next-i18next', 'react-i18next', 'i18next'].find((d) => deps[d]);
  if (!lib) return null;
  const idiomas = pastaDeIdiomas(root);
  if (!idiomas) {
    return { adapter: null, motivo: `o repo usa ${lib}, mas não achei os arquivos de idioma (locales/<idioma>/<ns>.json, public/locales/..., locales/<idioma>.json).` };
  }
  const configs = ['next-i18next.config.js', 'next-i18next.config.mjs', 'i18n.ts', 'i18n.js', 'src/i18n.ts', 'src/i18n.js', 'i18n/index.ts', 'src/i18n/index.ts', 'lib/i18n.ts', 'src/lib/i18n.ts']
    .map((p) => lerTexto(join(root, p)))
    .filter(Boolean);
  const localePadrao = idiomaPadrao(idiomas.locales, configs);
  const opcoes = { locales: idiomas.locales, localePadrao };
  const notas = [`${lib} no package.json; idiomas em ${idiomas.pasta}: ${Object.keys(idiomas.locales).join(', ')}${idiomas.modo === 'pasta' ? ' (um JSON por namespace; a 1ª parte da chave é o namespace)' : ''}.`];
  /* namespace onde o migrar escreve: common, senão translation (o padrão do i18next) */
  let ns;
  if (idiomas.modo === 'pasta') {
    const nss = jsonsDe(join(root, idiomas.locales[localePadrao]));
    ns = nss.includes('common') ? 'common' : nss.includes('translation') ? 'translation' : nss[0];
  }
  opcoes.acessor = { hook: 'useTranslation', de: lib === 'next-i18next' ? 'next-i18next' : 'react-i18next', campo: 't', forma: 'funcao', interpolacao: 'i18next', ...(ns ? { ns } : {}) };
  notas.push(`acessor do migrar: \`const { t } = useTranslation(${ns ? `'${ns}'` : ''})\` + \`t('chave')\`.`);
  const fonteTxt = fontes(root).map(lerTexto).join('\n');
  if (!/marcarLocales|marcarMensagens/.test(fonteTxt)) {
    notas.push('ATENÇÃO: os `resources` ainda não passam pelo `marcarLocales` (stega com o editor ligado). Rode `copy-edit ligar`. Se as traduções chegam por http-backend, não há onde marcar: a barra só edita pelo painel de chaves.');
  }
  comumAoObjeto(root, pkg, opcoes, notas);
  return { adapter: 'i18n-objeto', opcoes, notas };
}

function objetoProprio(root, pkg) {
  const idiomas = pastaDeIdiomas(root);
  if (!idiomas || idiomas.modo !== 'arquivo') return null;
  const arquivosFonte = fontes(root);
  const provider = acharProvider(root, idiomas, arquivosFonte);
  /* Pasta com cara de idioma e ninguém importando não é i18n: pode ser dado. */
  if (!provider) return null;
  const locales = Object.fromEntries(Object.entries(idiomas.locales).filter(([l]) => provider.locales.includes(l)));
  const localePadrao = idiomaPadrao(locales, [provider.texto]);
  const opcoes = { locales, localePadrao };
  if (provider.exportar !== 'default') opcoes.exportar = provider.exportar;
  const notas = [
    `i18n próprio: ${Object.values(locales).join(', ')}, lidos por ${rel(root, provider.arquivo)} (export \`${provider.exportar}\`).`,
  ];
  const acessor = acharAcessor(root, provider, arquivosFonte);
  if (acessor) {
    const { usos, ...resto } = acessor;
    opcoes.acessor = resto;
    notas.push(
      `acessor do migrar: \`const { ${acessor.campo} } = ${acessor.hook}()\` + ${acessor.forma === 'objeto' ? `\`${acessor.campo}.a.b\`` : `\`${acessor.campo}('a.b')\``} (${usos} usos no repo).`
    );
  } else {
    notas.push('ATENÇÃO: não deu pra saber com segurança como os componentes leem a copy. Antes do `migrar`, escreva `acessor: { hook, de, campo, forma }` nesta config.');
  }
  if (!/marcarLocales|marcarMensagens/.test(provider.texto)) {
    notas.push(`ATENÇÃO: ${rel(root, provider.arquivo)} ainda não passa as mensagens pelo \`marcarLocales\` (stega com o editor ligado). Sem isso a barra não acha o texto: rode \`copy-edit ligar\`.`);
  }
  comumAoObjeto(root, pkg, opcoes, notas);
  return { adapter: 'i18n-objeto', opcoes, notas };
}

/* ── a ordem ───────────────────────────────────────────────────────────── */

export const MIGRAR =
  'Não reconheci onde mora a copy deste repo (nem next-intl, nem HTML com data-copy + copy*.json).\n' +
  '    Num app Next, `copy-edit migrar --dry` mostra a migração do texto do JSX pra next-intl\n' +
  '    + copy/<rota>.json, e `copy-edit migrar` faz. Fora disso, escreva um\n' +
  '    copy-edit.config.mjs à mão (ver o README do pacote).';

export function detectar(root) {
  const pkg = lerJson(join(root, 'package.json')) || {};
  const achado = nextIntl(root, pkg) || i18next(root, pkg) || objetoProprio(root, pkg) || htmlJson(root, pkg);
  if (achado) return achado;
  return { adapter: null, motivo: MIGRAR };
}

/* A config sugerida, comentada e comitável. As chaves saem sem aspas pra
   parecer escrita à mão (é isso que o dono vai editar). */
export function textoConfig(achado, data = new Date().toISOString().slice(0, 10)) {
  const corpo = JSON.stringify({ adapter: achado.adapter, opcoes: achado.opcoes }, null, 2).replace(
    /^(\s*)"([A-Za-z_$][\w$]*)":/gm,
    '$1$2:'
  );
  /* `*` + `/` numa nota fecharia este comentário e quebraria a config inteira. */
  const notas = achado.notas.map((n) => ` *   · ${n.replaceAll('*/', '* /')}`).join('\n');
  return `/* Config do editor local de copy (\`npm run copy:edit\`, pacote @visant/copy-edit).
 *
 * Escrita pela detecção automática em ${data}. O que ela achou:
${notas}
 *
 * Comite este arquivo: com ele no repo a próxima subida lê daqui e não adivinha
 * de novo. Se a detecção errou, corrija à mão; as opções de cada adapter estão
 * no cabeçalho de adapters/<adapter>.mjs no pacote.
 */
export default ${corpo}
`;
}
