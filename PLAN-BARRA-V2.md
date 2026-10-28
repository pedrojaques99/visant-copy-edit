# Barra v2: a casca do editor no nível da toolbar da Vercel

Pedido do dono (2026-10-28): a lib "mais completa, funcional, com UI/UX burilada igual o Vercel faz"
(referência: a toolbar da Vercel, pílula vertical com ícone, tooltip e atalho de teclado).

## Escopo

Só a **casca** muda (markup e CSS da barra, do recado e dos painéis). A lógica de edição, o servidor,
os adapters e as URLs (`/__copy/editor.js|css`) ficam iguais: os outros repos que usam o pacote não
precisam mexer em nada. Trabalho no branch `feat/barra-v2`; o `main` só recebe com OK do dono.

## O que muda

| Hoje | v2 |
|---|---|
| Faixa de botões de texto no canto inferior esquerdo | Pílula vertical (canto inferior direito), botões de ícone 36px |
| Atalho escondido (só E e ⌘Z) | Tooltip em cada botão com o nome e a tecla (`kbd`) |
| Comentário só com Alt+clique | Também um modo comentário (C): clique em qualquer elemento |
| Painel de chaves e régua só pelo botão | K abre os textos, M abre a régua, ? mostra todos os atalhos |
| Posição fixa | Arrastar a pílula; ela gruda no canto mais perto e lembra (localStorage) |
| Sempre aberta | Recolhe num botão só (o menu, como na Vercel) |
| Recado em bloco de texto | Toast compacto com ícone por tipo; erro de lint fica até resolver |
| Contador "N na tela" solto | Contador no tooltip do editar + ponto de status quando o lint acusou |

## Atalhos

| Tecla | Ação |
|---|---|
| E | pausar / retomar a edição |
| C | modo comentário (ou Alt+clique) |
| K | textos sem cara (alt, title, og) com busca |
| M | régua de celular 375/390 |
| ⌘/Ctrl+Z | desfazer o último save |
| ? | lista de atalhos |
| Esc | fecha painel, régua, nota, modo comentário |

Nenhum atalho dispara com foco em texto editável, input ou textarea.

## Regras

- Ícones da biblioteca Phosphor (`@phosphor-icons/core`), congelados no `barra.js` por
  `npm run vendor:icones` (mesma lógica do `vendor:lint`): nada desenhado à mão.
- Cinza e mono como hoje (o editor não pode ter cara de plugin por cima da página).
- `prefers-reduced-motion`: sem transição.
- Teclado e leitor de tela: todo botão com `aria-label`, `aria-pressed` e `aria-keyshortcuts`.

## Pronto quando

- `npm test` verde.
- Testado no tomarillo-ac1 (`npm run copy:edit:local`): editar, desfazer, pausar, comentar, painel,
  régua, arrastar e recolher, mais os atalhos, sem erro no console.
