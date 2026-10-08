/* Repo com i18n PRÓPRIO, sem converter pra next-intl: o arquivo de idioma que
   exporta objeto (o board: locales/pt-br.ts + locales/en.ts + useI18n) e o
   JSON do i18next. Lê, grava no idioma certo pelo `l` do stega, desfaz, detecta,
   e o `migrar` escreve no locale que já existe com o acessor do repo. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { vercelStegaCombine, vercelStegaDecode, vercelStegaClean } from '@vercel/stega';
import { ts } from 'ts-morph';
import { criarServidor } from '../server/nucleo.mjs';
import { criar } from '../adapters/i18n-objeto.mjs';
import { lerObjeto, trocarValor, inserirChaves } from '../writers/objeto.mjs';
import { marcarMensagens, marcarLocales, TRECHO_TS } from '../server/marcar.mjs';
import { detectar } from '../server/detectar.mjs';
import { ligar } from '../server/ligar.mjs';
import { migrar } from '../migrar/index.mjs';

function repo(arquivos) {
  const root = mkdtempSync(join(tmpdir(), 'copy-edit-objeto-'));
  for (const [p, c] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), typeof c === 'string' ? c : JSON.stringify(c, null, 2) + '\n');
  }
  return root;
}
const ler = (root, p) => readFileSync(join(root, p), 'utf8');
/* Linhas que mudaram entre dois textos de mesmo tamanho em linhas. */
const linhasMudadas = (a, b) => {
  const x = a.split('\n');
  const y = b.split('\n');
  assert.equal(x.length, y.length, 'o número de linhas mudou');
  return x.filter((l, i) => l !== y[i]).length;
};

/* O board em miniatura: dois arquivos TS com comentário, array e aspas duplas. */
const PT = `// Portuguese translations
export const messages = {
  common: {
    home: "Início",
    // o nome da casa não traduz
    club: "Club",
    lista: ["um", "dois"],
  },
  navigation: {
    about: "Sobre",
  },
};
`;
const EN = PT.replace('// Portuguese', '// English').replace('"Início"', '"Home"').replace('"Sobre"', '"About"').replace('"um", "dois"', '"one", "two"');

async function subir(root, adapter) {
  const server = criarServidor(root, adapter);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, corpo) =>
    fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) }).then(async (r) => ({
      status: r.status,
      corpo: await r.json(),
    }));
  return { base, post, fechar: () => new Promise((r) => server.close(r)) };
}

/* ── writer ───────────────────────────────────────────────────────────── */

test('objeto TS: lê folhas (array pelo índice), troca uma linha só com as mesmas aspas, recusa o que não é literal', () => {
  const src = PT.replace('club: "Club",', 'club: "Club",\n    soma: `x ${1}`,');
  const l = lerObjeto(src, 'locales/pt-br.ts');
  assert.deepEqual([...l.folhas.keys()], ['common.home', 'common.club', 'common.lista.0', 'common.lista.1', 'navigation.about']);
  assert.equal(l.nomeExport, 'messages');
  const r = trocarValor(src, 'pt-br.ts', 'common.home', 'Casa "da" gente\nnova');
  assert.equal(linhasMudadas(src, r.texto), 1);
  assert.match(r.texto, /home: "Casa \\"da\\" gente\\nnova",/);
  assert.match(r.texto, /\/\/ o nome da casa não traduz/, 'comentário intacto');
  assert.match(trocarValor(src, 'pt-br.ts', 'common.soma', 'y').erro, /não é texto literal/);
  assert.match(trocarValor(src, 'pt-br.ts', 'common.nada', 'y').erro, /não existe/);
  /* export default e `as const` também */
  assert.equal(lerObjeto("export default { a: { b: 'c' } } as const\n", 'x.ts').folhas.get('a.b').valor, 'c');
});

test('inserir: chave nova no objeto que existe e em objeto novo, sem sobrescrever; JSON sem vírgula sobrando', () => {
  const r = inserirChaves(PT, 'pt-br.ts', [
    ['navigation.contato', 'Contato'],
    ['sobre.titulo', 'Quem somos'],
    ['common.home', 'Outro texto'],
    ['common.lista.x', 'não cabe'],
  ]);
  assert.deepEqual(r.inseridas, ['navigation.contato', 'sobre.titulo']);
  assert.deepEqual(r.conflitos.map((c) => c.chave), ['common.home', 'common.lista.x']);
  const l = lerObjeto(r.texto, 'pt-br.ts');
  assert.equal(l.folhas.get('navigation.contato').valor, 'Contato');
  assert.equal(l.folhas.get('sobre.titulo').valor, 'Quem somos');
  assert.equal(l.folhas.get('common.home').valor, 'Início');
  assert.match(r.texto, /\n    contato: "Contato",\n  \},/, 'mesmo recuo e vírgula final da casa');
  assert.ok(r.linhas.get('sobre.titulo') > 10);

  const json = '{\n  "common": {\n    "title": "Olá"\n  }\n}\n';
  const j = inserirChaves(json, 'pt/common.json', [['common.sub', 'Tchau'], ['home.cta', 'Começar']]);
  assert.deepEqual(JSON.parse(j.texto), { common: { title: 'Olá', sub: 'Tchau' }, home: { cta: 'Começar' } });
});

/* ── a chave na tela ──────────────────────────────────────────────────── */

test('marcarMensagens: chave e idioma no payload, array pelo índice, URL limpa; o trecho do repo marca igual', async () => {
  const msgs = { common: { home: 'Início', lista: ['um'] }, link: 'https://visant.co/club', n: 3 };
  const m = marcarMensagens(msgs, { locale: 'pt-br' });
  assert.deepEqual(vercelStegaDecode(m.common.home), { k: 'common.home', l: 'pt-br' });
  assert.deepEqual(vercelStegaDecode(m.common.lista[0]), { k: 'common.lista.0', l: 'pt-br' });
  assert.equal(m.link, 'https://visant.co/club', 'stega pula URL (skip auto)');
  assert.equal(m.n, 3);
  assert.equal(vercelStegaClean(m.common.home), 'Início');
  const ml = marcarLocales({ en: { a: 'Home' }, 'pt-br': { a: 'Início' } });
  assert.equal(vercelStegaDecode(ml.en.a).l, 'en');

  /* O trecho TS que o repo ganha, transpilado, com o stega do pacote. */
  const js = ts.transpileModule(TRECHO_TS, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const stega = join(dirname(createRequire(import.meta.url).resolve('@vercel/stega/package.json')), 'dist', 'index.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'copy-edit-trecho-'));
  writeFileSync(join(dir, 'trecho.mjs'), js.replace("'@vercel/stega'", JSON.stringify(pathToFileURL(stega).href)));
  const antes = { ...process.env };
  process.env.NEXT_PUBLIC_COPY_EDIT = '1';
  process.env.NODE_ENV = 'development';
  try {
    const t = await import(pathToFileURL(join(dir, 'trecho.mjs')).href);
    assert.deepEqual(t.marcarLocales({ 'pt-br': msgs }), { 'pt-br': m });
  } finally {
    process.env.NEXT_PUBLIC_COPY_EDIT = antes.NEXT_PUBLIC_COPY_EDIT;
    process.env.NODE_ENV = antes.NODE_ENV;
    if (antes.NEXT_PUBLIC_COPY_EDIT === undefined) delete process.env.NEXT_PUBLIC_COPY_EDIT;
    if (antes.NODE_ENV === undefined) delete process.env.NODE_ENV;
  }
  /* desligado (sem a flag), devolve o mesmo objeto */
  const t2 = await import(pathToFileURL(join(dir, 'trecho.mjs')).href + '?2');
  const cru = { a: 'x' };
  assert.equal(t2.marcarMensagens(cru, { locale: 'en' }), cru);
});

test('ligar: escreve o trecho uma vez e não sobrescreve o que foi mexido', () => {
  const root = repo({ 'package.json': { dependencies: {} } });
  const r = ligar(root);
  assert.equal(r.arquivo, 'lib/copy-edit-marcar.ts');
  assert.equal(ler(root, 'lib/copy-edit-marcar.ts'), TRECHO_TS);
  assert.match(r.texto, /npm install @vercel\/stega/);
  writeFileSync(join(root, 'lib/copy-edit-marcar.ts'), '// meu');
  assert.match(ligar(root).texto, /não sobrescrevi/);
});

/* ── o adapter pelo servidor de verdade ───────────────────────────────── */

test('salvar: o `l` do payload escolhe o arquivo; pt grava em pt-br.ts, en em en.ts, desfazer volta ao byte', async () => {
  const root = repo({ 'locales/pt-br.ts': PT, 'locales/en.ts': EN });
  const adapter = criar(root, { locales: { en: 'locales/en.ts', 'pt-br': 'locales/pt-br.ts' }, localePadrao: 'pt-br', exportar: 'messages', lint: false, dev: false });
  const s = await subir(root, adapter);
  try {
    const ch = await fetch(s.base + '/__copy/chaves?pagina=/&locale=en').then((r) => r.json());
    assert.equal(ch.locale, 'en');
    assert.equal(ch.arquivo, 'locales/en.ts');
    assert.equal(ch.chaves['common.home'], 'Home');
    assert.equal((await fetch(s.base + '/__copy/chaves?pagina=/').then((r) => r.json())).locale, 'pt-br', 'sem idioma: o padrão');

    /* a tela manda texto com a chave invisível, e o idioma que a ponte leu */
    const sujo = (v, l) => vercelStegaCombine(v, { k: 'common.home', l });
    let r = await s.post('/__copy/salvar', { pagina: '/', chave: 'common.home', antes: sujo('Início', 'pt-br'), valor: 'Começo', locale: 'pt-br' });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.arquivo, 'locales/pt-br.ts');
    assert.equal(linhasMudadas(PT, ler(root, 'locales/pt-br.ts')), 1);
    assert.equal(ler(root, 'locales/en.ts'), EN, 'o en não foi tocado');

    r = await s.post('/__copy/salvar', { pagina: '/', chave: 'common.home', antes: sujo('Home', 'en'), valor: 'Start', locale: 'en' });
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.arquivo, 'locales/en.ts');
    assert.equal(linhasMudadas(EN, ler(root, 'locales/en.ts')), 1);

    /* guarda cega por idioma: o `antes` do pt não serve pro en */
    const cega = await s.post('/__copy/salvar', { chave: 'common.home', antes: 'Home', valor: 'x', locale: 'en' });
    assert.match(cega.corpo.erro, /mudou no disco/);
    assert.match((await s.post('/__copy/salvar', { chave: 'common.home', valor: 'x', locale: 'fr' })).corpo.erro, /idioma "fr"/);
    assert.match((await s.post('/__copy/salvar', { chave: 'common.nada', valor: 'x', locale: 'en' })).corpo.erro, /não existe/);

    /* desfazer (sem `antes`) */
    await s.post('/__copy/salvar', { chave: 'common.home', valor: 'Início', locale: 'pt-br' });
    await s.post('/__copy/salvar', { chave: 'common.home', valor: 'Home', locale: 'en' });
    assert.equal(ler(root, 'locales/pt-br.ts'), PT);
    assert.equal(ler(root, 'locales/en.ts'), EN);
  } finally {
    await s.fechar();
  }
});

test('i18next: pasta por idioma, 1ª parte da chave é o namespace; lint roda no idioma padrão com o prefixo', async () => {
  const root = repo({
    'public/locales/pt/common.json': { title: 'Olá — mundo' },
    'public/locales/pt/home.json': { cta: 'Começar' },
    'public/locales/en/common.json': { title: 'Hello' },
    'public/locales/en/home.json': { cta: 'Start' },
    'lint.mjs': "console.log('  travessao              title'); console.log('Como consertar:'); console.log('  travessao: vírgula'); process.exit(1)\n",
  });
  const adapter = criar(root, { locales: { en: 'public/locales/en', pt: 'public/locales/pt' }, localePadrao: 'pt', lint: 'lint.mjs', dev: false });
  const s = await subir(root, adapter);
  try {
    const ch = await fetch(s.base + '/__copy/chaves?pagina=/&locale=pt').then((r) => r.json());
    assert.deepEqual(ch.chaves, { 'common.title': 'Olá — mundo', 'home.cta': 'Começar' });
    const antes = ler(root, 'public/locales/en/home.json');
    const r = await s.post('/__copy/salvar', { chave: 'home.cta', antes: 'Start', valor: 'Go', locale: 'en' });
    assert.equal(r.corpo.arquivo, 'public/locales/en/home.json');
    assert.deepEqual(r.corpo.lint, [], 'en não passa pelo lint da voz pt');
    assert.equal(linhasMudadas(antes, ler(root, 'public/locales/en/home.json')), 1);
    const p = await s.post('/__copy/salvar', { chave: 'common.title', antes: 'Olá — mundo', valor: 'Olá — gente', locale: 'pt' });
    assert.deepEqual(p.corpo.lint, [{ regra: 'travessao', chave: 'common.title', conserto: 'vírgula' }]);
  } finally {
    await s.fechar();
  }
});

/* ── detecção ─────────────────────────────────────────────────────────── */

const PROVIDER = `"use client";
import { createContext, useContext, useState } from "react";
import { messages as enMessages } from "../locales/en";
import { messages as ptBrMessages } from "../locales/pt-br";
type Messages = typeof ptBrMessages;
const Ctx = createContext<{ messages: Messages } | null>(null);
const locales: Record<string, Messages> = { en: enMessages, "pt-br": ptBrMessages };
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [messages] = useState<Messages>(locales.en);
  return <Ctx.Provider value={{ messages }}>{children}</Ctx.Provider>;
}
export function useI18n() {
  const c = useContext(Ctx);
  if (!c) throw new Error("sem provider");
  return c;
}
`;

function board(extra = {}) {
  return repo({
    'package.json': { dependencies: { next: '14.2.35', react: '18.2.0' }, scripts: { dev: 'next dev -p 7777' } },
    'tsconfig.json': { compilerOptions: { jsx: 'preserve', strict: true, moduleResolution: 'bundler', module: 'esnext', target: 'es2022', paths: { '@/*': ['./*'] } }, include: ['**/*.ts', '**/*.tsx'] },
    'locales/pt-br.ts': PT,
    'locales/en.ts': EN,
    'context/i18n-context.tsx': PROVIDER,
    /* um componente que lê só o pt-br NÃO é o provider */
    'components/Editor.tsx': '"use client";\nimport { messages } from "@/locales/pt-br";\nexport function Editor() { return <p>{messages.common.home}</p>; }\n',
    'components/Nav.tsx': '"use client";\nimport { useI18n } from "@/context/i18n-context";\nexport function Nav() {\n  const { messages } = useI18n();\n  return <nav>{messages.navigation.about} {messages.common.home}</nav>;\n}\n',
    'app/layout.tsx': 'export default function L({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html> }\n',
    ...extra,
  });
}

test('detecção: i18n próprio de objeto, o provider que junta os idiomas e o acessor que os componentes usam', () => {
  const a = detectar(board());
  assert.equal(a.adapter, 'i18n-objeto');
  assert.deepEqual(a.opcoes.locales, { en: 'locales/en.ts', 'pt-br': 'locales/pt-br.ts' });
  assert.equal(a.opcoes.localePadrao, 'pt-br');
  assert.equal(a.opcoes.exportar, 'messages');
  assert.equal(a.opcoes.portaDev, 7777);
  assert.deepEqual(a.opcoes.acessor, { hook: 'useI18n', campo: 'messages', forma: 'objeto', de: '@/context/i18n-context', arquivo: 'context/i18n-context.tsx' });
  assert.ok(a.notas.some((n) => /context\/i18n-context\.tsx/.test(n)));
  assert.ok(a.notas.some((n) => /copy-edit ligar/.test(n)), 'avisa que falta o marcarLocales');
});

test('detecção: i18next com public/locales/<idioma>/<ns>.json', () => {
  const root = repo({
    'package.json': { dependencies: { next: '14.0.0', 'react-i18next': '15.0.0', i18next: '23.0.0' } },
    'public/locales/en/common.json': { a: 'A' },
    'public/locales/pt-BR/common.json': { a: 'A' },
    'i18n.ts': "i18n.init({ fallbackLng: 'en' })\n",
  });
  const a = detectar(root);
  assert.equal(a.adapter, 'i18n-objeto');
  assert.deepEqual(a.opcoes.locales, { en: 'public/locales/en', 'pt-BR': 'public/locales/pt-BR' });
  assert.equal(a.opcoes.localePadrao, 'pt-BR');
  assert.deepEqual(a.opcoes.acessor, { hook: 'useTranslation', de: 'react-i18next', campo: 't', forma: 'funcao', interpolacao: 'i18next', ns: 'common' });
});

/* ── migrar no formato do repo ────────────────────────────────────────── */

const SEM_PORTOES = { tsc: false, eslint: false, copyLint: false, checarTipos: false };

test('migrar com i18n de objeto: chave no pt-br.ts, mesmo texto no en.ts + "traduzir", acessor do repo, servidor e variável na revisão', async () => {
  const root = board({
    /* reusa o `const { messages } = useI18n()` que já existe */
    'app/about/client.tsx': `"use client";
import { useI18n } from "@/context/i18n-context";

export function AboutClient({ nome }: { nome: string }) {
  const { messages } = useI18n();
  return (
    <main>
      <h1>Quem somos</h1>
      <p>{messages.navigation.about}</p>
      <p>Olá, {nome}.</p>
      <input placeholder="Seu e-mail" />
    </main>
  );
}
`,
    /* client sem o hook ainda: ganha import e declaração; `messages` ocupado vira `copy` */
    'app/contato/Form.tsx': `"use client";
export function Form({ messages }: { messages: string[] }) {
  return <button title="Enviar agora">Enviar {messages.length}</button>;
}
`,
    /* componente de servidor: o hook não roda lá */
    'app/contato/page.tsx': `import { Form } from "./Form";
export default function Page() {
  return (
    <section>
      <h1>Fale com a gente</h1>
      <Form messages={[]} />
    </section>
  );
}
`,
  });
  writeFileSync(join(root, 'copy-edit.config.mjs'), `export default ${JSON.stringify({ adapter: 'i18n-objeto', opcoes: detectar(root).opcoes })}\n`);
  const r = await migrar(root, SEM_PORTOES);
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.resumo.modo, 'texto no i18n do repo');
  assert.equal(existsSync(join(root, 'copy')), false, 'nada de JSON paralelo');
  assert.equal(existsSync(join(root, 'i18n/request.ts')), false, 'nada de next-intl');

  const about = ler(root, 'app/about/client.tsx');
  assert.match(about, /<h1>\{messages\.about\.client\.titulo\}<\/h1>/);
  assert.match(about, /placeholder=\{messages\.about\.client\.campo\.placeholder\}/);
  assert.equal(about.match(/useI18n\(\)/g).length, 1, 'reusou o acesso que existia');
  assert.match(about, /Olá, \{nome\}\./, 'texto com variável fica como está');

  const form = ler(root, 'app/contato/Form.tsx');
  assert.match(form, /import \{ useI18n \} from "@\/context\/i18n-context";|import \{ useI18n \} from '@\/context\/i18n-context';/);
  assert.match(form, /const \{ messages: copy \} = useI18n\(\);/);
  assert.match(form, /title=\{copy\.contato\.form\.enviarAgora\}/);

  assert.doesNotMatch(ler(root, 'app/contato/page.tsx'), /messages\./, 'servidor não foi tocado');

  const pt = lerObjeto(ler(root, 'locales/pt-br.ts'), 'pt-br.ts', { exportar: 'messages' });
  const en = lerObjeto(ler(root, 'locales/en.ts'), 'en.ts', { exportar: 'messages' });
  assert.equal(pt.folhas.get('about.client.titulo').valor, 'Quem somos');
  assert.equal(en.folhas.get('about.client.titulo').valor, 'Quem somos', 'en ganha o texto em pt, não inventa inglês');
  assert.equal(en.folhas.get('common.home').valor, 'Home', 'o que existia no en continua');
  assert.match(ler(root, 'locales/en.ts'), /^\/\/ English/);

  assert.equal(r.resumo.chavesNoLocale, r.resumo.chavesNovas);
  assert.equal(r.resumo.traduzir, r.resumo.chavesNovas);
  const md = ler(root, 'copy-edit-migrar.md');
  assert.match(md, /## Traduzir pro en \(entrou com o texto em pt-br\)/);
  assert.match(md, /`locales\/en\.ts:\d+` "about\.client\.titulo: Quem somos"/);
  assert.match(md, /Componente de servidor e o i18n do repo é só client/);
  assert.match(md, /`app\/contato\/page\.tsx:\d+` "Fale com a gente"/);
  assert.match(md, /Texto com variável: o i18n do repo/);
});

test('migrar com i18next: t(\'rota.chave\') pelo useTranslation do namespace, {{variável}}, o outro idioma com o mesmo texto', async () => {
  const root = repo({
    'package.json': { dependencies: { next: '14.0.0', 'react-i18next': '15.0.0', i18next: '23.0.0' } },
    'tsconfig.json': { compilerOptions: { jsx: 'preserve', strict: true }, include: ['**/*.tsx'] },
    'public/locales/pt/common.json': { ola: 'Olá' },
    'public/locales/en/common.json': { ola: 'Hello' },
    'app/conta/Painel.tsx': `'use client'
export function Painel({ nome }: { nome: string }) {
  return <p>Bem-vindo, {nome}.</p>
}
`,
  });
  const r = await migrar(root, SEM_PORTOES);
  assert.equal(r.ok, true, r.erro);
  const src = ler(root, 'app/conta/Painel.tsx');
  assert.match(src, /import \{ useTranslation \} from 'react-i18next'/);
  assert.match(src, /const \{ t \} = useTranslation\('common'\)/);
  assert.match(src, /\{t\('conta\.painel\.[a-zA-Z]+', \{ nome \}\)\}/);
  const pt = JSON.parse(ler(root, 'public/locales/pt/common.json'));
  const en = JSON.parse(ler(root, 'public/locales/en/common.json'));
  const [k] = Object.keys(pt.conta.painel);
  assert.equal(pt.conta.painel[k], 'Bem-vindo, {{nome}}.');
  assert.equal(en.conta.painel[k], 'Bem-vindo, {{nome}}.');
  assert.equal(en.ola, 'Hello');
  assert.equal(r.resumo.traduzir, 1);
});

test('migrar recusa i18n de objeto sem acessor, sem gravar nada', async () => {
  const root = board();
  const op = { ...detectar(root).opcoes };
  delete op.acessor;
  writeFileSync(join(root, 'copy-edit.config.mjs'), `export default ${JSON.stringify({ adapter: 'i18n-objeto', opcoes: op })}\n`);
  /* a config sem acessor manda... mas a detecção completa o que a config não diz */
  const r = await migrar(root, { ...SEM_PORTOES, dry: true });
  assert.equal(r.ok, true, 'a detecção acha o acessor quando a config não escreve');
  const root2 = repo({ 'package.json': { dependencies: { next: '14.0.0' } }, 'app/page.tsx': 'export default function P() { return <p>Oi</p> }\n', 'locales/pt-br.json': { a: 'b' } });
  writeFileSync(join(root2, 'copy-edit.config.mjs'), `export default ${JSON.stringify({ adapter: 'i18n-objeto', opcoes: { locales: { 'pt-br': 'locales/pt-br.json' } } })}\n`);
  const r2 = await migrar(root2, SEM_PORTOES);
  assert.equal(r2.ok, false);
  assert.match(r2.erro, /acessor/);
  assert.equal(ler(root2, 'app/page.tsx'), 'export default function P() { return <p>Oi</p> }\n');
});
