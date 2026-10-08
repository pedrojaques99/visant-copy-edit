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
2. **HTML estático** com `data-copy` + `copy*.json` na raiz (visantismo).
3. Nada disso: não sobe, e aponta o `copy-edit migrar` (fase 3).

A config, escrita à mão ou pela detecção:

```js
export default {
  adapter: 'html-json', // ou 'next-intl'
  opcoes: { /* ver o cabeçalho de adapters/<nome>.mjs */ },
}
```

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
writers/css-token.mjs    token na folha + estilo (na folha ou na fila)
lint/copy-lint.mjs       o lint padrão (vendor da skill)
```

`npm test` roda núcleo, adapters, writer e detecção gravando em diretório temporário.
