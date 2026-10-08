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
 *   2. HTML estático com `data-copy` + copy*.json na raiz (visantismo).
 *   3. Nada disso → não sobe: oferece o `copy-edit migrar` (fase 3).
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

/* ── a ordem ───────────────────────────────────────────────────────────── */

export const MIGRAR =
  'Não reconheci onde mora a copy deste repo (nem next-intl, nem HTML com data-copy + copy*.json).\n' +
  '    O caminho é migrar o texto pra JSON: `copy-edit migrar` faz isso (chega na fase 3 do\n' +
  '    @visant/copy-edit, visant-club/docs/PLANO-LIB-COPY-EDIT.md). Até lá, escreva um\n' +
  '    copy-edit.config.mjs à mão (ver o README do pacote).';

export function detectar(root) {
  const pkg = lerJson(join(root, 'package.json')) || {};
  const achado = nextIntl(root, pkg) || htmlJson(root, pkg);
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
