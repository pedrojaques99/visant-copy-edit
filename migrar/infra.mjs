/* A infra do next-intl que o `migrar` monta num repo que ainda não tem:
 * request config, copy/index.ts, as chaves tipadas, o plugin no next.config,
 * o provider no layout raiz, a ponte e o rewrite do editor. É o desenho do
 * Club (um idioma, sem rota de idioma, um JSON por rota), que é o que o
 * adapter `next-intl` formato `rota` já sabe editar.
 *
 * Tudo aqui devolve TEXTO (caminho → conteúdo novo) e nunca grava: o
 * migrar/index.mjs junta com as edições do codemod e grava tudo de uma vez,
 * com o snapshot pra desfazer.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Project, Node, SyntaxKind } from 'ts-morph';
import { camel } from './texto.mjs';

const ler = (p) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};

export const REQUEST_TS = `import { getRequestConfig } from 'next-intl/server'
import { vercelStegaCombine } from '@vercel/stega'
import { COPY } from '../copy'

/**
 * Copy lida por next-intl SEM rota de idioma: um idioma só, e o JSON de
 * copy/<rota>.json é a fonte da verdade do texto (montado por
 * \`copy-edit migrar\`, pacote @visant/copy-edit).
 *
 * Com o editor local ligado (\`npm run copy:edit\` liga COPY_EDIT=1), cada texto
 * sai com a própria chave escondida em caractere invisível (@vercel/stega). É
 * assim que a barra sabe qual chave a pessoa clicou sem \`data-copy\` no HTML.
 * Fora do editor, nada disso roda.
 */
type Arvore = { [k: string]: string | Arvore }

function marcar(no: Arvore, prefixo: string): Arvore {
  return Object.fromEntries(
    Object.entries(no).map(([k, v]) => {
      const chave = prefixo ? \`\${prefixo}.\${k}\` : k
      return [k, typeof v === 'string' ? vercelStegaCombine(v, { k: chave }) : marcar(v, chave)]
    }),
  )
}

export default getRequestConfig(async () => ({
  locale: 'pt-BR',
  timeZone: 'America/Sao_Paulo',
  messages: process.env.COPY_EDIT === '1' ? marcar(COPY, '') : COPY,
}))
`;

/* copy/index.ts: import estático de cada JSON (entra no bundle e o `next dev`
   recarrega quando o editor grava). */
export function indexTs(namespaces) {
  const ids = namespaces.map((ns) => [ns, identificador(ns)]);
  return `/* Um JSON por rota, e a chave de cima é o nome da rota (\`conta.perfil.titulo\`).
   \`comum\` é o que se repete em mais de uma rota (componente compartilhado).
   Import estático e não leitura de disco: entra no bundle e o \`next dev\`
   recarrega quando o editor grava. Montado por \`copy-edit migrar\`. */
${ids.map(([ns, id]) => `import ${id} from './${ns}.json'`).join('\n')}

export const COPY = {
${ids.map(([ns, id]) => `  ${ns === id ? id : `'${ns}': ${id}`},`).join('\n')}
}
`;
}

export const identificador = (ns) => {
  const c = camel(ns) || 'copy';
  return ['default', 'delete', 'new', 'class', 'function', 'import', 'export', 'var', 'let', 'const', 'in', 'do', 'if', 'for', 'while', 'switch', 'case', 'return', 'this', 'typeof', 'void', 'with', 'yield', 'enum', 'super', 'try', 'catch', 'finally', 'throw', 'break', 'continue', 'else', 'extends', 'instanceof', 'debugger'].includes(c) ? c + 'Copy' : c;
};

export const GLOBAL_D_TS = (deOnde) => `import type { COPY } from '${deOnde}'

/* Chave de copy tipada: \`t('rota.secao.nome')\` que não existe no JSON é erro de TS. */
declare module 'next-intl' {
  interface AppConfig {
    Locale: 'pt-BR'
    Messages: typeof COPY
  }
}
`;

/* Acrescenta namespaces novos num copy/index.ts que já existe (o do Club):
   import + propriedade no objeto COPY. Devolve null se o arquivo não tem a
   forma esperada (aí o migrar para e manda pra revisão, sem chutar). */
export function acrescentarIndex(texto, novos) {
  if (!novos.length) return texto;
  const p = new Project({ useInMemoryFileSystem: true });
  const sf = p.createSourceFile('index.ts', texto);
  const decl = sf.getVariableDeclaration('COPY');
  const obj = decl?.getInitializer();
  if (!obj || !Node.isObjectLiteralExpression(obj)) return null;
  const eol = texto.includes('\r\n') ? '\r\n' : '\n';
  const usados = new Set(sf.getDescendantsOfKind(SyntaxKind.Identifier).map((i) => i.getText()));
  const linhasImport = [];
  const props = [];
  for (const ns of novos) {
    let id = identificador(ns);
    while (usados.has(id)) id += 'Json';
    usados.add(id);
    linhasImport.push(`import ${id} from './${ns}.json'`);
    props.push(ns === id ? id : `'${ns}': ${id}`);
  }
  const imports = sf.getImportDeclarations();
  const posImport = imports.length ? imports[imports.length - 1].getEnd() : 0;
  const fecha = obj.getEnd() - 1; // o `}`
  const ultimo = obj.getProperties().at(-1);
  const recuo = ultimo ? texto.slice(texto.lastIndexOf('\n', ultimo.getStart() - 1) + 1).match(/^[ \t]*/)[0] : '  ';
  const virgula = ultimo && !/,\s*$/.test(texto.slice(ultimo.getEnd(), fecha)) ? ',' : '';
  let novo = texto.slice(0, fecha);
  novo = novo.replace(/\s*$/, '') + virgula + props.map((x) => `${eol}${recuo}${x},`).join('') + eol + texto.slice(fecha);
  novo = novo.slice(0, posImport) + linhasImport.map((l) => eol + l).join('') + novo.slice(posImport);
  return novo;
}

/* ── next.config ───────────────────────────────────────────────────────── */

export function editarNextConfig(root, requestRel) {
  const nome = ['next.config.ts', 'next.config.mjs', 'next.config.js', 'next.config.cjs'].find((n) => existsSync(join(root, n)));
  if (!nome) return { erro: 'não achei next.config.*' };
  const texto = ler(join(root, nome));
  if (/createNextIntlPlugin/.test(texto)) return { arquivo: nome, texto, nota: 'next.config já tinha o plugin do next-intl' };
  const p = new Project({ useInMemoryFileSystem: true });
  const sf = p.createSourceFile('c.' + (nome.endsWith('.ts') ? 'ts' : 'js'), texto);
  const eol = texto.includes('\r\n') ? '\r\n' : '\n';
  const ts = nome.endsWith('.ts');
  let alvo = sf.getExportAssignment((e) => !e.isExportEquals())?.getExpression();
  let cjs = false;
  if (!alvo) {
    const st = sf.getStatements().find((s) => Node.isExpressionStatement(s) && /^module\.exports\s*=/.test(s.getText()));
    if (st) {
      alvo = st.getExpression().getRight();
      cjs = true;
    }
  }
  if (!alvo) return { erro: `${nome} não tem \`export default\` nem \`module.exports =\` que eu reconheça` };
  if (Node.isArrowFunction(alvo) || Node.isFunctionExpression(alvo)) return { erro: `${nome} exporta uma função (config por fase): plugin e rewrite à mão` };

  const req = `./${requestRel}`;
  const tipo = ts ? ': NextConfig' : '';
  const cabeca = [
    cjs ? `const createNextIntlPlugin = require('next-intl/plugin')` : `import createNextIntlPlugin from 'next-intl/plugin'`,
    ...(ts && !/\bNextConfig\b/.test(texto) ? [`import type { NextConfig } from 'next'`] : []),
  ];
  const corpo = `
/* Copy em JSON (copy/<rota>.json) lida por next-intl: ${req}. */
const withNextIntl = createNextIntlPlugin('${req}')

/* Editor local de copy (\`npm run copy:edit\`, pacote @visant/copy-edit). Com
   COPY_EDIT=1, que só o copy:edit liga, o Next repassa /__copy/* pro servidor
   do editor em 127.0.0.1. Fora disso, a config sai intacta. */
const comEditor = (config${tipo})${tipo} =>
  process.env.COPY_EDIT !== '1'
    ? config
    : {
        ...config,
        async rewrites() {
          const antes = config.rewrites ? await config.rewrites() : []
          const editor = [
            { source: '/__copy/:caminho*', destination: \`http://127.0.0.1:\${process.env.COPY_EDIT_PORTA || 5280}/__copy/:caminho*\` },
          ]
          return Array.isArray(antes) ? [...editor, ...antes] : { ...antes, beforeFiles: [...editor, ...(antes.beforeFiles || [])] }
        },
      }
`.replace(/\n/g, eol);
  const imports = sf.getImportDeclarations();
  const posCabeca = imports.length ? imports[imports.length - 1].getEnd() : 0;
  const ini = alvo.getStart();
  const fim = alvo.getEnd();
  let novo = texto.slice(0, ini) + `withNextIntl(comEditor(${texto.slice(ini, fim)}))` + texto.slice(fim);
  /* O corpo entra antes do statement que exporta (as variáveis do config já existem ali). */
  const stExport = alvo.getFirstAncestor((a) => a.getParent() === sf) || alvo;
  const posCorpo = stExport.getStart();
  novo = novo.slice(0, posCorpo) + corpo.replace(/^\r?\n/, '') + eol + novo.slice(posCorpo);
  novo = novo.slice(0, posCabeca) + (posCabeca ? eol : '') + cabeca.join(eol) + (posCabeca ? '' : eol) + novo.slice(posCabeca);
  const notas = [];
  if (/frame-ancestors|X-Frame-Options/i.test(texto))
    notas.push(`${nome} manda frame-ancestors/X-Frame-Options: a régua de 375px da barra é um iframe da própria rota; afrouxe só com COPY_EDIT=1 em dev (como o next.config.mjs do visant-club).`);
  return { arquivo: nome, texto: novo, notas };
}

/* ── layout raiz ───────────────────────────────────────────────────────── */

export function editarLayout(root, base) {
  const rel = ['tsx', 'jsx', 'js'].map((e) => `${base}app/layout.${e}`).find((r) => existsSync(join(root, r)));
  if (!rel) return { erro: 'não achei o layout raiz (app/layout.tsx)' };
  const texto = ler(join(root, rel));
  if (/NextIntlClientProvider/.test(texto)) return { arquivo: rel, texto, nota: 'layout já tinha o NextIntlClientProvider' };
  const p = new Project({ useInMemoryFileSystem: true });
  const sf = p.createSourceFile('layout.tsx', texto);
  const filhos = sf
    .getDescendantsOfKind(SyntaxKind.JsxExpression)
    .find((e) => e.getExpression()?.getText() === 'children' && e.getFirstAncestor((a) => Node.isJsxElement(a) && a.getOpeningElement().getTagNameNode().getText() === 'body'));
  if (!filhos) return { erro: `${rel}: não achei \`{children}\` dentro do <body>` };
  const eol = texto.includes('\r\n') ? '\r\n' : '\n';
  const recuo = texto.slice(texto.lastIndexOf('\n', filhos.getStart() - 1) + 1).match(/^[ \t]*/)[0];
  const novoFilhos =
    `<NextIntlClientProvider>{children}</NextIntlClientProvider>` +
    `${eol}${recuo}{/* Editor local de copy: só existe com \`npm run copy:edit\` (@visant/copy-edit). */}` +
    `${eol}${recuo}{process.env.COPY_EDIT === '1' && <script type="module" async src="/__copy/ponte-stega.js" />}`;
  let novo = texto.slice(0, filhos.getStart()) + novoFilhos + texto.slice(filhos.getEnd());
  const imports = sf.getImportDeclarations();
  const pos = imports.length ? imports[imports.length - 1].getEnd() : 0;
  const semi = /^import [^\n]*;\r?$/m.test(texto) ? ';' : '';
  novo = novo.slice(0, pos) + (pos ? eol : '') + `import { NextIntlClientProvider } from 'next-intl'${semi}` + (pos ? '' : eol) + novo.slice(pos);
  return { arquivo: rel, texto: novo };
}

/* Tudo o que um repo sem next-intl ganha. `namespaces` vem do codemod. */
export function montarInfra(root, namespaces) {
  const base = existsSync(join(root, 'src', 'app')) ? 'src/' : '';
  const arquivos = new Map();
  const notas = [];
  const erros = [];
  const requestRel = `${base}i18n/request.ts`;
  if (existsSync(join(root, requestRel))) erros.push(`${requestRel} já existe e não é do next-intl: não sobrescrevo`);
  else arquivos.set(requestRel, REQUEST_TS);
  arquivos.set(`${base}copy/index.ts`, indexTs(namespaces));
  const dts = existsSync(join(root, 'global.d.ts')) ? `${base}copy/next-intl.d.ts` : 'global.d.ts';
  arquivos.set(dts, GLOBAL_D_TS(dts === 'global.d.ts' ? `./${base}copy` : './index'));
  const nc = editarNextConfig(root, requestRel);
  if (nc.erro) erros.push(nc.erro);
  else {
    arquivos.set(nc.arquivo, nc.texto);
    notas.push(...(nc.notas || []));
  }
  const ly = editarLayout(root, base);
  if (ly.erro) erros.push(ly.erro);
  else arquivos.set(ly.arquivo, ly.texto);
  const pkgTxt = ler(join(root, 'package.json'));
  const pkg = JSON.parse(pkgTxt);
  if (!pkg.scripts?.['copy:edit']) {
    pkg.scripts = { ...pkg.scripts, 'copy:edit': 'npx --yes github:pedrojaques99/visant-copy-edit' };
    const eol = pkgTxt.includes('\r\n') ? '\r\n' : '\n';
    arquivos.set('package.json', JSON.stringify(pkg, null, 2).replace(/\n/g, eol) + eol);
  }
  if (existsSync(join(root, `${base}middleware.ts`)) || existsSync(join(root, 'middleware.ts')))
    notas.push('o repo tem middleware: se ele redireciona toda rota (login, idioma), tire `__copy` do matcher, senão a barra não carrega.');
  return { arquivos, notas, erros, base };
}
