# @visant/copy-edit

A barra de edição local da Visant (texto, token, comentário pra IA), que se adapta ao repo.
Plano: visant-club/docs/PLANO-LIB-COPY-EDIT.md

## Uso

No `package.json` do repo (o pacote NÃO entra em dependencies: a Vercel não lê este repo privado):

```json
"copy:edit": "npx --yes github:pedrojaques99/visant-copy-edit",
"copy:edit:local": "node ../visant-copy-edit/bin/copy-edit.mjs"
```

`npm run copy:edit` na raiz do repo. Sem `copy-edit.config.mjs`, o editor **detecta** o formato,
escreve a config que achou (comentada, pra comitar) e sobe com ela. Com config no repo, ela manda.

```
copy-edit --detectar    mostra o que a detecção acharia, sem gravar nada
```

A detecção, na ordem:

1. **Next + next-intl**: acha o request config (o caminho do `createNextIntlPlugin` no
   next.config, ou `i18n/request.ts` / `src/i18n/request.ts`) e lê dele onde moram as mensagens:
   `import(`@/messages/${locale}.json`)` vira formato `locale` (site de cliente);
   `import { COPY } from '@/copy'` com um JSON por rota vira formato `rota` (Club).
1b. **i18n próprio** (adapter `i18n-objeto`, ver "Repo que já tem i18n" abaixo): i18next /
   react-i18next (deps + `locales/<idioma>/<ns>.json`), ou pasta `locales|i18n|lang` com um
   arquivo por idioma E um provider que importa eles (o visant-board).
2. **HTML estático** com `data-copy` + `copy*.json` na raiz (visantismo).
3. Nada disso: não sobe, e aponta o `copy-edit migrar` (abaixo).

A config, escrita à mão ou pela detecção:

```js
export default {
  adapter: 'html-json', // ou 'next-intl'
  opcoes: { /* ver o cabeçalho de adapters/<nome>.mjs */ },
}
```

## Migrar um app Next que tem o texto no JSX (`copy-edit migrar`)

```
copy-edit migrar --dry                         resumo + diff + revisão numa pasta temporária, nada gravado
copy-edit migrar                               grava, roda os portões, desfaz tudo se reprovar
copy-edit migrar --ignorar app/render,app/medir-livro --marca "Nome"
```

O que os 8 agentes fizeram à mão no Club em 07/10/2026, como codemod em AST (ts-morph):

1. **Infra**, só se o repo ainda não tem next-intl: instala `next-intl` e `@vercel/stega` NO REPO
   (são dependências do site) e monta o desenho do Club: `i18n/request.ts` (um idioma, sem rota
   de idioma, stega com `COPY_EDIT=1`), `copy/index.ts`, `global.d.ts` (chave tipada), plugin +
   rewrite do `/__copy` no next.config, `NextIntlClientProvider` + a ponte no layout raiz, e o
   script `copy:edit`. Repo que já tem next-intl só ganha texto (formato `rota` ou `locale`,
   pela detecção).
2. **Texto**, em `app/**` e `components/**` (.tsx). Namespace = a rota (`app/(club)/biblioteca/...`
   → `biblioteca`); componente fora de `app/` vai pra rota de quem importa, e pra `comum` quando
   mais de uma rota usa (`catalogo` se o arquivo é peça de vitrine: Card, Poster, Rail, Capa...).
   Chave = `<seção>.<nome pelo papel>` (a página da rota fica sem seção; seção com o nome da rota
   some). O papel do elemento decide antes das palavras (`migrar/nome.mjs`, regra simples, sem IA):
   `h1` → `titulo`; `h2/h3` → `subtitulo`, ou `<secao>.titulo` dentro de `<section id>`; `p`/`span`
   logo após o título → `sub`; botão/link → o verbo da 1ª palavra (`salvar`, `voltar`) ou `acao`;
   `label` → `<campo>.rotulo`; `placeholder` → `<campo>.placeholder`; `alt` → `<nome>.alt`;
   `aria-label` → `<nome>.rotulo`; estado vazio (Vazio/Empty, ou "nenhum"/"ainda não") →
   `vazio.titulo`/`vazio.sub`; `confirm`/`toast` → `aviso.<verbo>`. O campo se chama pelo
   `id`/`name`/`htmlFor`. Nome ocupado com outro texto → as primeiras palavras em camelCase (a
   regra antiga), com sufixo numérico se também ocupar. Texto IDÊNTICO: o espaço segue a regra do JSX, entidade vira caractere, número fora
   de plural vai como `String(n)` (o ICU formataria 2026 como "2.026").
   - componente `async` → `const t = await getTranslations('rota')`; o resto → `useTranslations`
     (client ou server síncrono). `t` ocupado no arquivo vira `tr`.
   - texto de JSX, com `{variavel}` string/número no meio → ICU com variável;
     `{n === 1 ? 'a' : 'b'}` → ICU plural;
   - atributo lido: placeholder, aria-label, alt, title, label e as props de texto de componente
     (`titulo`, `descricao`, `rotulo`...);
   - frase cortada por elemento simples (`Leia o <a>guia</a>.`) → `t.rich` com o elemento intacto;
   - ternário/`&&` com string dos dois lados; frase passada pra `confirm/alert/toast/setX` dentro
     de componente.
3. **Revisão** (`copy-edit-migrar.md`, arquivo:linha + motivo): o que não é óbvio NÃO é chutado.
   Texto de `lib/`, mensagem de server action/rota, `throw`, mapa no módulo, metadata, string em
   variável, condicional que não é plural, variável que pode ser `null`, frase cortada por elemento
   com conteúdo, texto em helper minúsculo (o `t` não alcança), `global-error` e imagem gerada.
   Nunca migra className, URL, marca, `<code>`/`<kbd>`, log, comentário.
4. **Tipo em memória** antes de gravar: arquivo que ficaria com erro de tsc novo volta pro
   original e vai pra revisão, em vez de derrubar a migração inteira.
5. **Portões** depois de gravar: `tsc --noEmit` e eslint nos arquivos mexidos (só erro NOVO conta)
   reprovaram → desfaz tudo (inclusive o JSON criado). copy-lint nos JSON só informa: migração
   não é reescrita.

Provado contra o Club de ANTES da 1ª onda (f282311): 630 textos em 83 arquivos (598 chaves),
78% dos textos que os agentes migraram, tsc + eslint + 498 testes verdes. Com o nome pelo papel,
36 das 598 chaves batem pelo caminho inteiro com as dos agentes (eram 19); o resto diverge mais na
SEÇÃO (`productsTable` × `produtos`), que os agentes renomearam à mão. Detalhes no PLANO.

## Ligar num app next-intl

Três pontos moram no app, porque nenhum pacote alcança sem virar plugin de build
(o Club e o `visant-site-template` são os exemplos vivos):

1. **request config**: com `COPY_EDIT=1`, esconder a chave em cada texto com
   `vercelStegaCombine(valor, { k: 'caminho.da.chave' })` (`@vercel/stega` como dependência do app).
2. **layout**: com `COPY_EDIT=1`, `<script type="module" async src="/__copy/ponte-stega.js" />`.
3. **next.config**: com `COPY_EDIT=1`, rewrite `/__copy/:caminho*` →
   `http://127.0.0.1:${COPY_EDIT_PORTA}/__copy/:caminho*`, e só em dev + `COPY_EDIT=1`,
   `frame-ancestors 'self'` / `X-Frame-Options: SAMEORIGIN` (a régua de 375px é um iframe).
   Se o app tem middleware do next-intl, tire `__copy` do `matcher`, senão ele manda
   `/__copy/chaves` pra `/pt-BR/__copy/chaves`.

## Repo que já tem i18n (`i18n-objeto`)

O editor trabalha EM CIMA do i18n do repo, sem converter pra next-intl, e os idiomas ficam
(o board: `locales/pt-br.ts` + `locales/en.ts`, lidos pelo `useI18n()`).

- **Arquivos**: objeto TS/JS (`export const messages = {}`, `export default {}`) ou JSON
  (i18next, `<idioma>/<ns>.json`, e a 1ª parte da chave é o namespace). O save troca SÓ o literal
  daquela chave (parser do TypeScript, `writers/objeto.mjs`): diff de uma linha, comentário e
  aspas intactos. Chave inexistente ou que não é literal: recusa.
- **Chave e idioma na tela**: `copy-edit ligar` escreve `lib/copy-edit-marcar.ts` no repo
  (depende só do `@vercel/stega`, público; o pacote continua fora do package.json). No provider,
  UMA mudança: os objetos passam por `marcarLocales({ en, 'pt-br': pt })`, que só age com
  `NEXT_PUBLIC_COPY_EDIT=1` em dev e esconde `{ k: chave, l: idioma }` em cada texto. A ponte
  põe `data-copy` + `data-copy-l`, espera o retrato ficar estável depois da hidratação (o
  provider do board renderiza `en` e troca pra pt-BR num useEffect) e vigia trocas de idioma
  depois; o save leva `locale` e grava no arquivo daquele idioma. O painel diz o idioma.
- **migrar**: não cria next-intl nem JSON paralelo. Escreve as chaves novas no arquivo do idioma
  padrão (pt) e usa o ACESSOR do repo (`const { messages } = useI18n()` + `messages.rota.chave`,
  ou `t('rota.chave')` do i18next com `{{var}}`), detectado pelo uso no repo ou escrito na config
  (`acessor: { hook, de, campo, forma }`). Os outros idiomas ganham a chave com o MESMO texto em
  pt e cada uma vai pra revisão como "Traduzir pro en". Texto do JSX que já está em INGLÊS
  ("Reset Password") faz o caminho inverso: o en fica com o original e o pt vai pra revisão como
  "Traduzir pro pt-br". Quem decide é `migrar/idioma.mjs`, heurística sem IA nem rede (palavra
  funcional e de interface, acento, terminação), que só diz "en" com folga: palavra única, nome
  próprio e número ficam no padrão. Medida: 0 pt chamado de en em 473 textos do board + 986 do
  Club, 86% do en de 2+ palavras reconhecido (`franc-min` chamou 50 dos 473 pt de inglês). Componente de servidor num i18n
  client-only, texto com variável num i18n de objeto e plural vão pra revisão com o motivo.

## Token e estilo (`writers/css-token`)

`tokens: { css, checar, origem, aoGravar }` nas opções do next-intl liga a paleta da barra:
lista os blocos de topo `@theme {` / `:root {` da folha, troca o valor de um token que já
existe, roda o portão (`checar`: comando de shell, args do node ou função) e desfaz se reprovar.
`origem` e `aoGravar` são os ganchos do repo (o Club recusa token que espelha a landing e grava
o `tokens.map.json` junto). Estilo num app React vira pedido em `docs/COMENTARIOS-IA.md`, nunca
regra CSS; no HTML estático grava na folha do site (`css` do html-json).

## Lint

O padrão é `lint/copy-lint.mjs`, cópia congelada do copy-lint da skill visant-copy.
`npm run vendor:lint` atualiza a cópia (fonte: `$VISANT_COPY_LINT`, `../visant-skills`, ou
`~/.claude/skills`). A config do repo pode apontar outro (`lint: 'scripts/...'`) ou desligar
(`lint: false`). Os portões `copy:lint` dos repos usam o vendor deles, não este.

## Peças

```
bin/copy-edit.mjs        lê a config (ou detecta e escreve), escolhe o adapter, sobe o servidor
server/nucleo.mjs        http 127.0.0.1, tranca por repo, guarda de escrita cega,
                         fila docs/COMENTARIOS-IA.md, parse do copy-lint, arquivos do cliente
server/detectar.mjs      a detecção e o texto da config sugerida
client/barra.js|css      a barra (servida em /__copy/editor.js|css)
client/ponte-stega.js    chave do stega → data-copy, espera a hidratação, sobe a barra
adapters/html-json.mjs   copy*.json plano + build do repo (visantismo)
adapters/next-intl.mjs   JSON aninhado, formato rota (Club) ou locale (site de cliente)
adapters/i18n-objeto.mjs arquivo de idioma que exporta objeto (TS/JSON, i18next), um por idioma
writers/objeto.mjs       lê/troca/insere chave em objeto TS ou JSON sem reescrever o arquivo
server/marcar.mjs        marcarMensagens/marcarLocales + o trecho que o `ligar` escreve no repo
writers/css-token.mjs    token na folha + estilo (na folha ou na fila)
lint/copy-lint.mjs       o lint padrão (vendor da skill)
migrar/                  `copy-edit migrar`: codemod (ts-morph), infra do next-intl, portões
migrar/idioma.mjs        o texto do JSX está em en? (heurística, só com folga)
```

`npm test` roda núcleo, adapters, writer, detecção e migrar gravando em diretório temporário.
