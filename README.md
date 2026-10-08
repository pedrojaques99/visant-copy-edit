# @visant/copy-edit

A barra de edição local da Visant (texto, token, comentário pra IA), que se adapta ao repo.
Plano: visant-club/docs/PLANO-LIB-COPY-EDIT.md

## Uso

Na raiz do repo, um `copy-edit.config.mjs`:

```js
export default {
  adapter: 'html-json', // ou 'next-intl'
  opcoes: { /* ver o cabeçalho de adapters/<nome>.mjs */ },
}
```

e no `package.json` do repo (o pacote NÃO entra em dependencies: a Vercel não lê este repo privado):

```json
"copy:edit": "npx --yes github:pedrojaques99/visant-copy-edit",
"copy:edit:local": "node ../visant-copy-edit/bin/copy-edit.mjs"
```

## Peças

```
bin/copy-edit.mjs        lê a config do cwd, escolhe o adapter, sobe o servidor
server/nucleo.mjs        http 127.0.0.1, tranca por repo, guarda de escrita cega,
                         fila docs/COMENTARIOS-IA.md, parse do copy-lint, arquivos do cliente
client/barra.js|css      a barra (servida em /__copy/editor.js|css)
client/ponte-stega.js    chave do stega → data-copy, espera a hidratação, sobe a barra
adapters/html-json.mjs   copy*.json plano + build do repo (visantismo)
adapters/next-intl.mjs   copy/<rota>.json aninhado + next dev com COPY_EDIT=1 (Club)
```

`npm test` roda o núcleo e os dois adapters gravando em diretório temporário.
