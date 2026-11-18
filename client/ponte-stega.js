/* Ponte entre um app React (next-intl) e a barra. Servida em
 * /__copy/ponte-stega.js pelo @visant/copy-edit; o layout do app só a carrega
 * com COPY_EDIT=1, que só o `npm run copy:edit` liga. Nasceu no Club
 * (scripts/copy-edit/club.js) e mudou de casa sem mudar de comportamento.
 *
 * A barra acha o texto editável por `[data-copy="chave"]`, que no HTML estático
 * (visantismo) já vem do build. No app o HTML não tem isso: o i18n/request.ts
 * esconde a chave dentro do próprio texto em caractere invisível
 * (@vercel/stega). Este arquivo lê a chave de volta e põe o `data-copy` no
 * elemento, e só DEPOIS carrega a barra, que encontra o mesmo contrato que tem
 * no HTML estático.
 *
 * Roda depois da hidratação de propósito: atributo posto antes dela é "atributo
 * a mais vindo do servidor" pro React, e o console enche de aviso falso.
 */
import { vercelStegaDecode, vercelStegaClean } from '/__copy/stega.mjs';

const ATRIBUTOS = ['placeholder', 'aria-label', 'title', 'alt'];

/* O payload é { k: chave } (next-intl) ou { k, l: idioma } (i18n de objeto,
   server/marcar.mjs). O idioma importa porque a mesma chave mora num arquivo
   por idioma, e o save tem que cair no arquivo do texto que está na tela. */
function payloadDe(texto) {
  if (!texto) return null;
  try {
    const d = vercelStegaDecode(texto);
    return d && typeof d.k === 'string' ? { k: d.k, l: typeof d.l === 'string' ? d.l : null } : null;
  } catch {
    return null;
  }
}

/* O payload do RSC (`self.__next_f.push(...)`) vai em <script> no HTML e carrega
   os MESMOS textos, com a chave invisível junto. Sem este filtro o <script>
   ganhava `data-copy`, virava alvo da barra e entrava na contagem "N na tela". */
const FORA = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
const soVisivel = {
  acceptNode: (n) => (FORA.has(n.parentElement?.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
};

/* Acha os alvos sem tocar no DOM: [elemento, chave, atributo|null, idioma|null]. */
function alvos(raiz) {
  const achados = [];
  const visto = new Set();
  const andar = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, soVisivel);
  for (let n = andar.nextNode(); n; n = andar.nextNode()) {
    const d = payloadDe(n.nodeValue);
    const k = d && d.k;
    const el = n.parentElement;
    /* Só vira alvo o elemento cujo texto INTEIRO é aquela frase. A barra
       edita o `innerText` do elemento todo: no selo da assinatura o texto
       "ativa" divide o <span> com a descrição de leitor de tela ("Situação"),
       e na linha de fatos "em andamento" divide com o número. Editar ali
       gravaria "Situaçãoativa" na chave, e dois textos do JSON no mesmo nó
       gravariam um por cima do outro. Esses ficam pro painel de chaves.
       Texto só de leitor de tela (`.sr-only`) também: não se clica no que não
       se vê. */
    if (!k || !el || visto.has(el) || el.closest('.sr-only')) continue;
    if (vercelStegaClean(el.textContent).trim() !== vercelStegaClean(n.nodeValue).trim()) continue;
    visto.add(el);
    achados.push([el, k, null, d.l]);
  }
  for (const el of raiz.querySelectorAll('*')) {
    if (FORA.has(el.tagName)) continue;
    for (const a of ATRIBUTOS) {
      const d = payloadDe(el.getAttribute(a));
      const k = d && d.k;
      /* Texto de atributo não aparece na tela: vai pro painel de chaves, como
         o alt e o <title> no visantismo (`data-copy-attr`). */
      if (k && !visto.has(el)) {
        visto.add(el);
        achados.push([el, k, a, d.l]);
      }
    }
  }
  return achados;
}

function marcar(achados) {
  for (const [el, k, a, l] of achados) {
    el.dataset.copy = k;
    if (a) el.dataset.copyAttr = a;
    if (l) el.dataset.copyL = l;
  }
}

/* O idioma da página é o que a maioria dos textos marcados diz. Um texto
   perdido de outro idioma (o nome do idioma no seletor, por exemplo) não muda
   a página; a tela trocando de idioma muda, e aí a barra fica sabendo. */
function idiomaDe(achados) {
  const conta = new Map();
  for (const [, , , l] of achados) if (l) conta.set(l, (conta.get(l) || 0) + 1);
  let melhor = null;
  for (const [l, n] of conta) if (!melhor || n > conta.get(melhor)) melhor = l;
  return melhor;
}
function anunciarIdioma(achados) {
  const l = idiomaDe(achados);
  if (!l || l === window.__copyEdit.locale) return;
  window.__copyEdit.locale = l;
  window.dispatchEvent(new CustomEvent('copy-edit:locale', { detail: l }));
}

/* Hidratado = o nó pertence à árvore que o React JÁ COMMITOU.
 *
 * Só ter `__reactFiber$<id>` não basta (medido 07/10): o React grava essa chave
 * no passo de render, e a hidratação concorrente pode recomeçar e conferir o
 * mesmo nó de novo. Na segunda passada o `data-copy` já estava lá e o console
 * acusou mismatch na /conta inteira. A prova de commit é subir pelo `return`
 * até a raiz (tag 3, HostRoot) e ver que ela é a `current` do FiberRoot; antes
 * do commit a cadeia termina na raiz em obra, que é a `alternate`. Depois de
 * um re-render o nó pode estar pendurado na árvore velha, por isso vale o
 * fiber OU o `alternate` dele. */
const raizDe = (f) => {
  while (f && f.return) f = f.return;
  return f;
};
function hidratado(el) {
  const chave = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  if (!chave) return false;
  const f = el[chave];
  return [f, f && f.alternate].some((x) => {
    const r = raizDe(x);
    return !!r && r.tag === 3 && !!r.stateNode && r.stateNode.current === r;
  });
}

/* O valor que a barra manda como `antes` sai do textContent, com os caracteres
   invisíveis junto. O servidor também limpa, mas o painel mostra o que está aqui. */
window.__copyLimpar = vercelStegaClean;

/* Estilo e alça de largura gravam pela CHAVE, não pela primeira classe: aqui a
   classe é utilitário do Tailwind e o servidor recusa (ver alvoEstilo() na
   barra). A barra lê esta flag; sem ela, o comportamento é o do HTML estático. */
window.__copyEdit = { seletor: 'data-copy', locale: null };

function limparTitulo() {
  const limpo = vercelStegaClean(document.title);
  if (limpo !== document.title) document.title = limpo; // idempotente: não reentra
}

function iniciar() {
  /* O título da aba também vem do JSON, com a chave invisível junto: na aba ela
     vira lixo visível. Limpa aqui (só existe no modo editor). */
  limparTitulo();
  /* E de novo a cada troca de rota: o App Router regrava o <title> na navegação
     do cliente, com a chave junto. Sem isto a aba volta a mostrar lixo e
     ferramenta que lê o título (extensão, automação) se recusa a abrir a aba. */
  /* O documento inteiro, não só o <head>: rota dinâmica do Next transmite os
     metadados (o <title> junto) dentro do <body>. A checagem é só comparar uma
     string, e o observador só existe no modo editor. */
  new MutationObserver(limparTitulo).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  const achados = alvos(document.body);
  marcar(achados);
  anunciarIdioma(achados);
  vigiar();
  /* A régua de 375px abre a MESMA rota num iframe com `?ce=preview`: ali só
     precisa do `data-copy` pra rolar até a frase, não de uma segunda barra. */
  if (/[?&]ce=preview/.test(location.search)) return;
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = '/__copy/editor.css';
  document.head.appendChild(css);
  const js = document.createElement('script');
  js.src = '/__copy/editor.js';
  document.body.appendChild(js);
}

/* Esperar a hidratação, e não o `load`. A /conta é dinâmica e no `next dev` o
   chunk do client component chega DEPOIS do `load`: com `load` + ocioso, o
   `data-copy` e o contenteditable entravam antes do React conferir o HTML, e o
   console acusava hydration mismatch em cada texto do card (visto em 07/10).
   Agora a barra só sobe quando todo alvo achado está na árvore commitada.

   Sem teto de tempo, de propósito. A primeira versão tinha 20s e subia "assim
   mesmo" depois disso, e foi o teto que mentiu: com a aba em segundo plano o
   Chrome não roda `requestAnimationFrame`, o React não troca o conteúdo
   transmitido (o `<div hidden id="S:0">` do loading.tsx) e a hidratação
   espera a aba voltar. O teto marcava o HTML ainda não hidratado e, na volta,
   o console acusava mismatch na página inteira. Esperar mais custa um
   setTimeout ocioso; subir antes custa a tela. */
/* Hidratado não basta num i18n client-only: o provider do board renderiza
   `en` no servidor e troca pra pt-BR num useEffect, DEPOIS do commit da
   hidratação. Marcar nessa janela gravaria o idioma errado no alvo. Então,
   além de hidratado, o retrato (chave + idioma de cada alvo) tem que ficar
   igual por 3 voltas seguidas (~750ms), o que cobre o efeito do provider.
   Animação que não é copy (contador, 3D) não entra no retrato e não atrasa. */
let retratoAnterior = null;
let iguais = 0;
function quandoHidratar() {
  const achados = alvos(document.body);
  if (achados.every(([el]) => hidratado(el))) {
    const retrato = achados.map(([, k, a, l]) => k + '|' + (a || '') + '|' + (l || '')).join(',');
    iguais = retrato === retratoAnterior ? iguais + 1 : 0;
    retratoAnterior = retrato;
    if (iguais >= 2) return iniciar();
  } else iguais = 0;
  setTimeout(quandoHidratar, 250);
}

/* Depois de subir: o texto pode trocar de idioma (seletor de idioma do site) ou
   aparecer (aba, modal). Remarca e avisa a barra, que passa a gravar no arquivo
   do idioma novo. O próprio `marcar` só mexe em atributo, que não é vigiado,
   então não se realimenta. */
function vigiar() {
  let t = null;
  new MutationObserver(() => {
    clearTimeout(t);
    t = setTimeout(() => {
      const achados = alvos(document.body);
      marcar(achados);
      anunciarIdioma(achados);
    }, 200);
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
}

/* A barra só sobe em rota que JÁ TEM copy/<rota>.json. Sem isso ela subia em
   toda página (visto na /entrar, "0 na tela"), e o `submit` que ela engole em
   captura enquanto está ligada travaria qualquer form nativo de rota que nem
   migrou. Quem sabe se a rota tem JSON é o servidor do editor (`chavesDaPagina`):
   `arquivo: null` é página normal, sem barra e sem `data-copy`. */
async function subir() {
  const r = await fetch('/__copy/chaves?pagina=' + encodeURIComponent(location.pathname))
    .then((x) => x.json())
    .catch(() => null);
  if (!r || !r.arquivo) return;
  quandoHidratar();
}
if (document.readyState === 'complete') subir();
else window.addEventListener('load', subir, { once: true });
