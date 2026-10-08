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

function chaveDe(texto) {
  if (!texto) return null;
  try {
    const d = vercelStegaDecode(texto);
    return d && typeof d.k === 'string' ? d.k : null;
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

/* Acha os alvos sem tocar no DOM: [elemento, chave, atributo|null]. */
function alvos(raiz) {
  const achados = [];
  const visto = new Set();
  const andar = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, soVisivel);
  for (let n = andar.nextNode(); n; n = andar.nextNode()) {
    const k = chaveDe(n.nodeValue);
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
    achados.push([el, k, null]);
  }
  for (const el of raiz.querySelectorAll('*')) {
    if (FORA.has(el.tagName)) continue;
    for (const a of ATRIBUTOS) {
      const k = chaveDe(el.getAttribute(a));
      /* Texto de atributo não aparece na tela: vai pro painel de chaves, como
         o alt e o <title> no visantismo (`data-copy-attr`). */
      if (k && !visto.has(el)) {
        visto.add(el);
        achados.push([el, k, a]);
      }
    }
  }
  return achados;
}

function marcar(achados) {
  for (const [el, k, a] of achados) {
    el.dataset.copy = k;
    if (a) el.dataset.copyAttr = a;
  }
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
window.__copyEdit = { seletor: 'data-copy' };

function iniciar() {
  /* O título da aba também vem do JSON, com a chave invisível junto: na aba ela
     vira lixo visível. Limpa aqui (só existe no modo editor). */
  document.title = vercelStegaClean(document.title);
  marcar(alvos(document.body));
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
function quandoHidratar() {
  const achados = alvos(document.body);
  if (achados.every(([el]) => hidratado(el))) return iniciar();
  setTimeout(quandoHidratar, 250);
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
