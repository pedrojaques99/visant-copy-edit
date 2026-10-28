# Barra v3: o ciclo designer ↔ agente

Pedido do dono (2026-10-28): "nível vale do silício, com shortcuts e UI/UX intuitiva pra mim (designer)
clicar, arrastar e deixar comentários que facilitem a burilação entre human designer <-> AI agent", e
depois: "aparece na tela posicionado igual figma faz, se posso editar o comentário ou ver o feedback
visual de que o agent já captou".

Parte da v2 do Félix (`feat/barra-v2`, PLAN-BARRA-V2.md). Branch `feat/barra-v3-ciclo`. O `main` só recebe
com OK do dono: os outros repos usam o pacote via `npx github:`.

## O que entrou

| Antes | v3 |
|---|---|
| Comentário vira uma linha no .md e uma marca no elemento | Pin numerado no ponto exato do clique (como Figma), que acompanha rolagem e largura |
| Sem retorno do agente | Estado visível: aguardando (pin claro) → o agente leu (pin laranja) → feito (pin cinza); ponto vermelho quando o agente respondeu e falta o designer olhar |
| Sem conversa | Thread por comentário no painel **F**: designer e agente respondem; responder num feito reabre |
| Não dava pra corrigir | Editar (lápis) e apagar (lixeira, com confirmação) o próprio pedido; editar devolve pra "aguardando" |
| — | Hover no pin mostra o pedido e a última resposta, sem abrir nada |
| — | Avisos sozinhos quando o agente lê, responde ou termina (a barra busca a fila a cada 5s) |
| — | **⌘/Ctrl+K**: uma busca pra ações da barra, textos da página (texto ou chave) e comentários (`#3`) |
| Compositor no canto | Balão ao lado do pin provisório, que já mostra o número que o comentário vai ganhar |

## Formato da fila (`docs/COMENTARIOS-IA.md`)

```
- [ ] #3 `/wishlist` `[data-copy="hero.selo"]` @24,46 · "Em breve" · selo mais discreto
  - ia: troquei o peso pra 400
  - designer: e menor
```

- `[ ]` aberto (aguardando o agente), `[~]` o agente leu, `[x]` feito.
- `@x,y` é o ponto do pin em % do elemento (opcional).
- Linha antiga (sem número, sem ponto) continua valendo: ganha número na leitura e o pin vai pro canto do elemento.

## API pro agente (com o editor no ar)

| Rota | O quê |
|---|---|
| `GET /__copy/comentarios?todas=1&agente=1` | fila inteira; `agente=1` marca os abertos como lidos (o pin fica laranja na tela do designer) |
| `POST /__copy/comentario/responder` `{id, autor: "ia", texto}` | resposta na thread |
| `POST /__copy/comentario/status` `{id, estado: "lido"\|"feito"\|"aberto", autor: "ia", texto?}` | muda o estado (com nota opcional) |
| `POST /__copy/comentario/editar` `{id, texto}` · `/apagar` `{id}` | usados pela barra |

Sem o editor no ar, o agente edita o .md direto, no mesmo formato.

## Também nesta rodada

- **Alça de espaço**: passar o mouse num texto mostra, além da alça de largura (direita), uma alça embaixo.
  Arrastar muda o espaço até o próximo bloco (`margin-bottom`) na grade de 4px, ao vivo; soltar vira
  pendência e o "aplicar" grava (styles.css, ou pedido na fila num app com Tailwind).
- Painéis de textos (K) e régua (M) no idioma da v3 (flutuantes, cantos de 14px).
- **Bug corrigido**: na v2, a função que posiciona a barra também se chamava `aplicar` e tomava o lugar da
  que grava as alterações pendentes: o botão "aplicar" (largura, cor, fonte) não gravava nada.
- Pedido de estilo na fila (`estiloNaFila`) reconhece a linha mesmo depois de ganhar número (#n).

## Fora de escopo

- Reordenar blocos arrastando: a ordem mora no HTML/JSX, não em CSS; vira pedido pro agente (C).

## Prova

- `npm test`: 70 passando (fila v3 e v3.1: thread, estados, ponto, editar, apagar, linha antiga).
- E2E no Chrome (Playwright) numa cópia do visantismo: 25 checagens, do clique no ponto ao "feito pelo
  agente", editar, apagar, paleta, sem erro de JS.
- Barra nova servida por um editor antigo ainda no ar não quebra a página (item sem id/thread é completado).
