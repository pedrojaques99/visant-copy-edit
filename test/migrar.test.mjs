/* `copy-edit migrar` com fixtures pequenas em diretório temporário. Cada caso
   é uma regra que os agentes de 07/10 seguiram à mão no Club: server async ×
   client, atributo lido, ICU de variável, plural, componente compartilhado,
   o que vai pra revisão, e o repo que volta como estava quando o tsc reprova.
   A prova grande (o Club de antes da 1ª onda) mora no PLANO, não aqui. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { migrar, lugarNoApp, aplicar } from '../migrar/index.mjs';
import { limparJsxText, slugDeIcu, pareceTexto, decodificar, verboDe } from '../migrar/texto.mjs';
import { acrescentarIndex } from '../migrar/infra.mjs';

function repo(arquivos) {
  const root = mkdtempSync(join(tmpdir(), 'copy-edit-migrar-'));
  for (const [p, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo, null, 2));
  }
  return root;
}
const ler = (root, p) => readFileSync(join(root, p), 'utf8');
const lerJson = (root, p) => JSON.parse(ler(root, p));

const TSCONFIG = { compilerOptions: { jsx: 'preserve', strict: true, resolveJsonModule: true, moduleResolution: 'bundler', module: 'esnext', target: 'es2022', paths: { '@/*': ['./*'] } }, include: ['**/*.ts', '**/*.tsx'] };

/* Um app no formato do Club: next-intl já ligado, copy/<rota>.json + index. */
function club(extra) {
  return repo({
    'package.json': { dependencies: { next: '15.0.0', 'next-intl': '4.0.0' } },
    'tsconfig.json': TSCONFIG,
    'i18n/request.ts': "import { getRequestConfig } from 'next-intl/server'\nimport { COPY } from '@/copy'\nexport default getRequestConfig(async () => ({ locale: 'pt-BR', messages: COPY }))\n",
    'copy/biblioteca.json': {},
    'copy/conta.json': { titulo: 'Conta' },
    'copy/index.ts': "import biblioteca from './biblioteca.json'\nimport conta from './conta.json'\n\nexport const COPY = {\n  biblioteca,\n  conta,\n}\n",
    ...extra,
  });
}

/* Portões desligados nos testes de texto (sem node_modules na fixture). */
const SEM_PORTOES = { tsc: false, eslint: false, copyLint: false, checarTipos: false };

/* ── peças puras ─────────────────────────────────────────────────────── */

test('espaço do JSX: o mesmo algoritmo do Babel', () => {
  assert.equal(limparJsxText('\n    Curso, leitura e vídeo fechado entram aqui. Enquanto\n    isso, o canal.\n  '), 'Curso, leitura e vídeo fechado entram aqui. Enquanto isso, o canal.');
  assert.equal(limparJsxText(' '), ' ');
  assert.equal(limparJsxText(' Salvar\n'), ' Salvar');
  assert.equal(limparJsxText('\n  '), '');
  assert.equal(decodificar('a&nbsp;b &amp; c'), 'a b & c');
});

test('nome da chave sai do texto fora do ICU, e plural puro usa o ramo other', () => {
  assert.equal(slugDeIcu('Fora da estante'), 'foraDaEstante');
  assert.equal(slugDeIcu('Hoje {n, plural, =1 {é 1 item} other {são {n} itens}} na estante.'), 'hojeNaEstante');
  assert.equal(slugDeIcu('{n} {n, plural, =1 {aula} other {aulas}}'), 'aulas');
  assert.equal(slugDeIcu('Leia o <a>guia</a> antes'), 'leiaOGuiaAntes');
});

test('pareceTexto cala pra className, chave, URL e SQL', () => {
  assert.equal(pareceTexto('Salvo com sucesso!'), true);
  assert.equal(pareceTexto('mt-3 flex items-center gap-2'), false);
  assert.equal(pareceTexto('enviando'), false);
  assert.equal(pareceTexto('https://visant.club/plano'), false);
  assert.equal(pareceTexto("count(*) filter (where status = 'published')::int"), false);
});

test('rota e seção pelo caminho do app', () => {
  assert.deepEqual(lugarNoApp('(club)/biblioteca/page.tsx'), { ns: 'biblioteca', secao: null });
  assert.deepEqual(lugarNoApp('(admin)/admin/membros/page.tsx'), { ns: 'admin', secao: 'membros' });
  assert.deepEqual(lugarNoApp('p/[sku]/bem-vindo/page.tsx'), { ns: 'p', secao: 'bemVindo' });
  assert.deepEqual(lugarNoApp('(club)/biblioteca/loading.tsx'), { ns: 'biblioteca', secao: 'carregando' });
  assert.deepEqual(lugarNoApp('layout.tsx'), { ns: 'comum', secao: 'layout' });
  assert.deepEqual(lugarNoApp('page.tsx'), { ns: 'inicio', secao: null });
  assert.deepEqual(lugarNoApp('definir-senha/DefinirSenha.tsx'), { ns: 'definir-senha', secao: null }, 'seção com o nome da rota é redundante');
});

test('aplicar: de trás pra frente, sobreposição descarta a de fora inteira', () => {
  assert.equal(aplicar('abcdef', [{ ini: 1, fim: 2, texto: 'X' }, { ini: 4, fim: 5, texto: 'Y' }]), 'aXcdYf');
  assert.equal(aplicar('abcdef', [{ ini: 1, fim: 5, texto: 'X' }, { ini: 2, fim: 3, texto: 'Y' }]), 'abYdef');
});

test('index.ts do Club ganha o namespace novo', () => {
  const novo = acrescentarIndex("import a from './a.json'\n\nexport const COPY = {\n  a,\n}\n", ['medir-livro']);
  assert.match(novo, /import medirLivro from '\.\/medir-livro\.json'/);
  assert.match(novo, /'medir-livro': medirLivro,/);
});

/* ── o codemod ───────────────────────────────────────────────────────── */

test('server async: await getTranslations, texto e atributo, ICU de variável e plural', async () => {
  const root = club({
    'app/(club)/biblioteca/page.tsx': `import { Vazio } from '@/components/Vazio'

export default async function BibliotecaPage() {
  const itens: string[] = await Promise.resolve([])
  const nome: string = 'Pedro'
  const ano: number = 2026
  return (
    <main>
      <h1 className="text-lg">A tua biblioteca</h1>
      <p>
        Olá, {nome}. Hoje {itens.length === 1 ? 'é 1 item' : \`são \${itens.length} itens\`} na estante.
      </p>
      <p>Desde {ano}</p>
      <input placeholder="Buscar por nome…" aria-label="Buscar na biblioteca" />
      <img src="/estante@640.webp" alt="Pintura a óleo de uma estante" />
      <Vazio titulo="Nada aqui ainda." />
    </main>
  )
}
`,
    'components/Vazio.tsx': 'export function Vazio({ titulo }: { titulo: string }) {\n  return <p>{titulo}</p>\n}\n',
  });
  const r = await migrar(root, SEM_PORTOES);
  assert.equal(r.ok, true, r.erro);
  const pag = ler(root, 'app/(club)/biblioteca/page.tsx');
  assert.match(pag, /import \{ getTranslations \} from 'next-intl\/server'/);
  assert.match(pag, /const t = await getTranslations\('biblioteca'\)/);
  assert.match(pag, /<h1 className="text-lg">\{t\('titulo'\)\}<\/h1>/);
  assert.match(pag, /placeholder=\{t\('campo\.placeholder'\)\}/);
  assert.match(pag, /alt=\{t\('estante\.alt'\)\}/);
  assert.match(pag, /titulo=\{t\('vazio\.titulo'\)\}/);
  /* número fora de plural vai como String(): o ICU formataria 2026 como 2.026 */
  assert.match(pag, /t\('desde', \{ ano: String\(ano\) \}\)/);
  const json = lerJson(root, 'copy/biblioteca.json');
  assert.equal(json.titulo, 'A tua biblioteca');
  assert.equal(json.sub, 'Olá, {nome}. Hoje {n, plural, =1 {é 1 item} other {são {n} itens}} na estante.');
  assert.match(pag, /t\('sub', \{ nome, n: itens\.length \}\)/);
  assert.equal(json.vazio.titulo, 'Nada aqui ainda.');
  assert.equal(json.desde, 'Desde {ano}');
  /* o que já existia nos outros JSON não é tocado */
  assert.deepEqual(lerJson(root, 'copy/conta.json'), { titulo: 'Conta' });
  assert.ok(existsSync(join(root, 'copy-edit-migrar.md')));
});

test('client: useTranslations depois do use client, `t` ocupado vira `tr`, plural solto', async () => {
  const root = club({
    'app/(club)/conta/Painel.tsx': `'use client'
export function Painel({ n, lista }: { n: number; lista: { t: string }[] }) {
  return (
    <div>
      {lista.map((t) => <span key={t.t}>{t.t}</span>)}
      <p>{n} {n === 1 ? 'aula' : 'aulas'}</p>
      <button onClick={() => confirm('Sair mesmo da conta?')}>Sair</button>
    </div>
  )
}
`,
  });
  const r = await migrar(root, SEM_PORTOES);
  assert.equal(r.ok, true, r.erro);
  const src = ler(root, 'app/(club)/conta/Painel.tsx');
  assert.match(src, /^'use client'\n\nimport \{ useTranslations \} from 'next-intl'\n/);
  assert.match(src, /const tr = useTranslations\('conta'\)/);
  assert.match(src, /<p>\{tr\('painel\.aulas', \{ n \}\)\}<\/p>/);
  assert.match(src, /confirm\(tr\('painel\.aviso\.sair'\)\)/);
  const json = lerJson(root, 'copy/conta.json');
  assert.equal(json.titulo, 'Conta');
  assert.equal(json.painel.aulas, '{n} {n, plural, =1 {aula} other {aulas}}');
  assert.equal(json.painel.sair, 'Sair');
});

test('componente de uma rota só fica nela; de duas rotas vai pra comum (namespace novo no index)', async () => {
  const root = club({
    'app/(club)/biblioteca/page.tsx': "import { Capa } from '@/components/Capa'\nimport { Rodape } from '@/components/Rodape'\nexport default function P() {\n  return <div><Capa /><Rodape /></div>\n}\n",
    'app/(club)/conta/page.tsx': "import { Rodape } from '@/components/Rodape'\nexport default function P() {\n  return <Rodape />\n}\n",
    'components/Capa.tsx': 'export function Capa() {\n  return <p>Capa do livro</p>\n}\n',
    'components/Rodape.tsx': 'export function Rodape() {\n  return <footer>Feito pela casa</footer>\n}\n',
  });
  const r = await migrar(root, SEM_PORTOES);
  assert.equal(r.ok, true, r.erro);
  assert.match(ler(root, 'components/Capa.tsx'), /useTranslations\('biblioteca'\)/);
  assert.match(ler(root, 'components/Rodape.tsx'), /useTranslations\('comum'\)/);
  assert.equal(lerJson(root, 'copy/comum.json').rodape.feitoPelaCasa, 'Feito pela casa');
  assert.match(ler(root, 'copy/index.ts'), /import comum from '\.\/comum\.json'/);
  assert.deepEqual(r.resumo.namespacesNovos, ['comum']);
});

test('frase cortada por elemento simples vira t.rich; o que não é óbvio vai pra revisão com arquivo:linha', async () => {
  const root = club({
    'app/(club)/biblioteca/page.tsx': `const ROTULOS = { curso: 'Cursos do Club' }

function linha() {
  return <p>Texto de helper</p>
}

export default function P({ nome }: { nome: string | null }) {
  return (
    <div>
      <p>Leia o <a href="/guia">guia</a> antes de começar.</p>
      <p>Olá, <strong><em>{nome}</em></strong>, tudo bem?</p>
      <p>Bem-vindo, {nome}.</p>
      <code>npm run dev</code>
      <span>{ROTULOS.curso}</span>
      {linha()}
    </div>
  )
}
`,
    'app/(club)/biblioteca/actions.ts': "'use server'\nexport async function salvar() {\n  return { erro: 'Não deu pra salvar agora.' }\n}\n",
    'lib/rotulos.ts': "export const PAPEL = { membro: 'Membro do Club' }\n",
  });
  const r = await migrar(root, SEM_PORTOES);
  assert.equal(r.ok, true, r.erro);
  const src = ler(root, 'app/(club)/biblioteca/page.tsx');
  assert.match(src, /t\.rich\('leiaOGuiaAntes', \{ a: \(chunks\) => <a href="\/guia">\{chunks\}<\/a> \}\)/);
  assert.equal(lerJson(root, 'copy/biblioteca.json').leiaOGuiaAntes, 'Leia o <a>guia</a> antes de começar.');
  assert.match(src, /<code>npm run dev<\/code>/, 'texto de <code> é dado, fica');
  assert.match(src, /Texto de helper/, 'helper minúsculo: o t não alcança');
  assert.match(src, /'Cursos do Club'/, 'mapa de módulo não é chutado');
  assert.match(src, /Olá, <strong>/, 'frase com elemento aninhado não é chutada');
  assert.match(src, /<p>Bem-vindo, \{nome\}\.<\/p>/, 'variável string | null não vira ICU, e a frase não é cortada');
  const md = ler(root, 'copy-edit-migrar.md');
  assert.match(md, /Texto fora de componente[\s\S]*app\/\(club\)\/biblioteca\/page\.tsx:4/);
  assert.match(md, /Mapa ou constante no módulo[\s\S]*page\.tsx:1/);
  assert.match(md, /Frase cortada por elemento com conteúdo próprio/);
  assert.match(md, /não é texto nem número/);
  assert.match(md, /Mensagem de servidor\/action[\s\S]*actions\.ts:3/);
  assert.match(md, /Texto em lib\/[\s\S]*lib\/rotulos\.ts:1/);
});

test('--dry não grava nada e devolve o diff', async () => {
  const root = club({ 'app/(club)/biblioteca/page.tsx': 'export default function P() {\n  return <h1>A tua biblioteca</h1>\n}\n' });
  const antes = ler(root, 'app/(club)/biblioteca/page.tsx');
  const r = await migrar(root, { ...SEM_PORTOES, dry: true });
  assert.equal(r.ok, true);
  assert.equal(ler(root, 'app/(club)/biblioteca/page.tsx'), antes);
  assert.deepEqual(lerJson(root, 'copy/biblioteca.json'), {});
  assert.equal(existsSync(join(root, 'copy-edit-migrar.md')), false);
  assert.match(r.patch, /\+  return <h1>\{t\('titulo'\)\}<\/h1>/);
});

test('tsc reprovou: desfaz TUDO, inclusive o JSON criado, e o repo volta como estava', async () => {
  const root = club({
    'app/(club)/biblioteca/page.tsx': 'export default function P() {\n  return <h1>A tua biblioteca</h1>\n}\n',
    'components/Rodape.tsx': 'export function Rodape() {\n  return <footer>Feito pela casa</footer>\n}\n',
  });
  const antes = {
    pag: ler(root, 'app/(club)/biblioteca/page.tsx'),
    idx: ler(root, 'copy/index.ts'),
    json: ler(root, 'copy/biblioteca.json'),
  };
  let chamadas = 0;
  const r = await migrar(root, {
    ...SEM_PORTOES,
    tsc: () => (++chamadas === 1 ? { ok: false, saida: "page.tsx(2,10): error TS2345: o tsc reprovou" } : { ok: true, saida: '' }),
  });
  assert.equal(r.ok, false);
  assert.equal(r.desfeito, true);
  assert.match(r.erro, /desfiz tudo/);
  assert.equal(ler(root, 'app/(club)/biblioteca/page.tsx'), antes.pag);
  assert.equal(ler(root, 'copy/index.ts'), antes.idx);
  assert.equal(ler(root, 'copy/biblioteca.json'), antes.json);
  assert.equal(existsSync(join(root, 'copy/comum.json')), false, 'o JSON que o migrar criou sai junto');
  assert.equal(existsSync(join(root, 'copy-edit-migrar.md')), false);
  assert.ok(existsSync(r.revisaoArq), 'a revisão fica fora do repo pra consulta');
});

test('checagem de tipo em memória: arquivo que não compilaria volta pro original e vai pra revisão', async () => {
  /* next-intl de mentira, só com os tipos: o suficiente pra checagem rodar. */
  const root = club({
    'node_modules/next-intl/package.json': { name: 'next-intl', version: '4.0.0', types: 'index.d.ts' },
    'node_modules/next-intl/index.d.ts': 'export declare function useTranslations(ns: string): ((k: string, v?: Record<string, string | number>) => string) & { rich: (k: string, v?: Record<string, unknown>) => unknown }\n',
    'node_modules/next-intl/server.d.ts': 'export declare function getTranslations(ns: string): Promise<(k: string, v?: Record<string, string | number>) => string>\n',
    'app/(club)/biblioteca/page.tsx': "import { Botao } from '@/components/Botao'\nexport default function P() {\n  return <Botao rotulo=\"Salvar\" />\n}\n",
    'app/(club)/conta/page.tsx': 'export default function P() {\n  return <h1>Tua conta</h1>\n}\n',
    'components/Botao.tsx': "export function Botao({ rotulo }: { rotulo: 'Salvar' | 'Cancelar' }) {\n  return <button>{rotulo}</button>\n}\n",
  });
  const r = await migrar(root, { ...SEM_PORTOES, checarTipos: true });
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.resumo.barrados, 1);
  assert.match(ler(root, 'app/(club)/biblioteca/page.tsx'), /rotulo="Salvar"/, 'o barrado fica intacto');
  assert.match(ler(root, 'app/(club)/conta/page.tsx'), /\{t\('tuaConta'\)\}/, 'o resto migra');
  assert.match(ler(root, 'copy-edit-migrar.md'), /não compilaria[\s\S]*biblioteca\/page\.tsx/);
  assert.equal(lerJson(root, 'copy/biblioteca.json').salvar, undefined, 'a chave do barrado não fica órfã no JSON');
});

test('repo sem next-intl: monta a infra do Club (request, copy/index, tipos, plugin, provider, ponte)', async () => {
  const root = repo({
    'package.json': { name: 'site', dependencies: { next: '15.0.0', react: '19.0.0' } },
    'tsconfig.json': TSCONFIG,
    'next.config.mjs': "/** @type {import('next').NextConfig} */\nconst nextConfig = { reactStrictMode: true }\n\nexport default nextConfig\n",
    'app/layout.tsx': "import './globals.css'\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html lang=\"pt-BR\">\n      <body>{children}</body>\n    </html>\n  )\n}\n",
    'app/page.tsx': 'export default function Home() {\n  return <h1>Olá, mundo</h1>\n}\n',
    'app/sobre/page.tsx': 'export default async function Sobre() {\n  return <p>Quem somos</p>\n}\n',
  });
  let instalou = false;
  const seco = await migrar(root, { ...SEM_PORTOES, dry: true, instalar: () => ((instalou = true), { ok: true }) });
  assert.equal(seco.ok, true, seco.erro);
  assert.equal(instalou, false, 'no --dry nada é instalado');
  assert.equal(existsSync(join(root, 'i18n/request.ts')), false);

  const r = await migrar(root, { ...SEM_PORTOES, instalar: () => ((instalou = true), { ok: true }) });
  assert.equal(r.ok, true, r.erro);
  assert.equal(instalou, true);
  assert.match(ler(root, 'i18n/request.ts'), /vercelStegaCombine[\s\S]*from '\.\.\/copy'/);
  assert.match(ler(root, 'copy/index.ts'), /import inicio from '\.\/inicio\.json'[\s\S]*import sobre from '\.\/sobre\.json'/);
  assert.match(ler(root, 'global.d.ts'), /Messages: typeof COPY/);
  const nc = ler(root, 'next.config.mjs');
  assert.match(nc, /^import createNextIntlPlugin from 'next-intl\/plugin'/);
  assert.match(nc, /export default withNextIntl\(comEditor\(nextConfig\)\)/);
  assert.match(nc, /\/__copy\/:caminho\*/);
  const ly = ler(root, 'app/layout.tsx');
  assert.match(ly, /<body><NextIntlClientProvider>\{children\}<\/NextIntlClientProvider>/);
  assert.match(ly, /\/__copy\/ponte-stega\.js/);
  assert.match(ly, /import \{ NextIntlClientProvider \} from 'next-intl'/);
  assert.equal(lerJson(root, 'copy/inicio.json').titulo, 'Olá, mundo');
  assert.equal(lerJson(root, 'copy/sobre.json').quemSomos, 'Quem somos');
  assert.match(ler(root, 'app/sobre/page.tsx'), /await getTranslations\('sobre'\)/);
  assert.equal(lerJson(root, 'package.json').scripts['copy:edit'], 'npx --yes github:pedrojaques99/visant-copy-edit');
});

/* ── nome com sentido: o papel do elemento decide antes das palavras ────── */

test('verboDe: infinitivo e imperativo de botão; substantivo em -ar/-or não', () => {
  assert.equal(verboDe('Salvar rascunho'), 'salvar');
  assert.equal(verboDe('Ver o plano'), 'ver');
  assert.equal(verboDe('Começar agora'), 'comecar');
  assert.equal(verboDe('Tenta de novo'), 'tenta');
  assert.equal(verboDe('Próxima aula'), null);
  assert.equal(verboDe('Melhor opção'), null);
  assert.equal(verboDe('Designer freela'), null);
});

test('chave pelo papel: título, sub, seção, botão, campo, alt, aria-label, vazio, aviso', async () => {
  const root = club({
    'app/(club)/conta/page.tsx': `'use client'
import Link from 'next/link'
export default function P({ toast }: { toast: { success: (m: string) => void } }) {
  return (
    <main>
      <h1>Tua conta</h1>
      <p>O que é teu aqui dentro.</p>
      <section id="planos-pagos">
        <h2>Planos</h2>
        <p>Escolhe o que cabe.</p>
      </section>
      <h2>Outra coisa</h2>
      <h3>Mais uma</h3>
      <form>
        <label htmlFor="email">Teu e-mail</label>
        <input id="email" placeholder="Teu melhor e-mail" />
        <input type="search" placeholder="Buscar por nome…" />
        <button onClick={() => confirm('Excluir este item?')}>Salvar rascunho</button>
        <button>Salvar e publicar</button>
        <button onClick={() => toast.success('Salvo com sucesso!')}>Próxima aula</button>
        <button aria-label="Fechar menu">x</button>
      </form>
      <nav aria-label="Navegação da conta" />
      <Link href="/">Voltar pro início</Link>
      <img id="retrato" src="/r.webp" alt="Retrato do dono" />
      <div className="estado-vazio">
        <h3>Nada por aqui.</h3>
        <p>Volta mais tarde.</p>
      </div>
      <p>Tua conta</p>
    </main>
  )
}
`,
  });
  const r = await migrar(root, SEM_PORTOES);
  assert.equal(r.ok, true, r.erro);
  const j = lerJson(root, 'copy/conta.json');
  const src = ler(root, 'app/(club)/conta/page.tsx');
  /* `titulo` já existia ("Conta"): o h1 cai na regra antiga, sem sobrescrever. */
  assert.equal(j.titulo, 'Conta');
  assert.equal(j.tuaConta, 'Tua conta');
  assert.equal(j.sub, 'O que é teu aqui dentro.');
  assert.equal(j.planosPagos.titulo, 'Planos');
  assert.equal(j.planosPagos.sub, 'Escolhe o que cabe.');
  assert.equal(j.subtitulo, 'Outra coisa');
  assert.equal(j.maisUma, 'Mais uma', 'segundo subtítulo: colisão cai na regra antiga');
  assert.equal(j.email.rotulo, 'Teu e-mail');
  assert.equal(j.email.placeholder, 'Teu melhor e-mail');
  assert.equal(j.busca.placeholder, 'Buscar por nome…');
  assert.equal(j.salvar, 'Salvar rascunho');
  assert.equal(j.salvarEPublicar, 'Salvar e publicar', 'verbo ocupado: regra antiga');
  assert.equal(j.acao, 'Próxima aula', 'botão sem verbo vira acao');
  assert.equal(j.fechar.rotulo, 'Fechar menu');
  assert.equal(j.menu.rotulo, 'Navegação da conta');
  assert.equal(j.voltar, 'Voltar pro início');
  assert.equal(j.retrato.alt, 'Retrato do dono');
  assert.equal(j.vazio.titulo, 'Nada por aqui.');
  assert.equal(j.vazio.sub, 'Volta mais tarde.');
  assert.equal(j.aviso.excluir, 'Excluir este item?');
  assert.equal(j.aviso.salvoCom, 'Salvo com sucesso!');
  /* texto igual na mesma seção reaproveita a chave que já ganhou */
  assert.match(src, /<p>\{t\('tuaConta'\)\}<\/p>/);
  assert.match(src, /<label htmlFor="email">\{t\('email\.rotulo'\)\}<\/label>/);
});

test('texto que diz "nenhum" é estado vazio; componente Vazio dá o nome às props', async () => {
  const root = club({
    'app/(club)/biblioteca/page.tsx': `import { Vazio } from '@/components/Vazio'
export default function P() {
  return (
    <div>
      <p>Nenhum produto liberado ainda.</p>
      <Vazio titulo="Nada aqui." texto="Volta depois." />
    </div>
  )
}
`,
    'components/Vazio.tsx': 'export function Vazio({ titulo, texto }: { titulo: string; texto: string }) {\n  return <p>{titulo}{texto}</p>\n}\n',
  });
  const r = await migrar(root, SEM_PORTOES);
  assert.equal(r.ok, true, r.erro);
  const j = lerJson(root, 'copy/biblioteca.json');
  assert.equal(j.vazio.titulo, 'Nenhum produto liberado ainda.');
  assert.equal(j.vazio.sub, 'Volta depois.');
  assert.equal(j.nadaAqui, 'Nada aqui.', 'vazio.titulo ocupado: regra antiga');
});

test('componente de vitrine (Card, Poster, Rail, Capa) usado por 2+ rotas vai pra catalogo', async () => {
  const root = club({
    'app/(club)/biblioteca/page.tsx': "import { PosterCard } from '@/components/PosterCard'\nexport default function P() {\n  return <PosterCard />\n}\n",
    'app/(club)/conta/page.tsx': "import { PosterCard } from '@/components/PosterCard'\nexport default function P() {\n  return <PosterCard />\n}\n",
    'components/PosterCard.tsx': 'export function PosterCard() {\n  return <span>Em andamento</span>\n}\n',
  });
  const r = await migrar(root, SEM_PORTOES);
  assert.equal(r.ok, true, r.erro);
  assert.match(ler(root, 'components/PosterCard.tsx'), /useTranslations\('catalogo'\)/);
  assert.equal(lerJson(root, 'copy/catalogo.json').posterCard.emAndamento, 'Em andamento');
});
