/* Editor inline de copy — cliente. Servido em /__copy/editor.js pelo servidor
 * do @visant/copy-edit (server/nucleo.mjs), e só por ele.
 *
 * O contrato: NADA aqui escreve no DOM final do site. O que este arquivo faz é
 * abrir o nó pra edição, mandar o valor pro servidor e mostrar o que o
 * copy-lint respondeu. Quem reescreve o HTML continua sendo o copy:build, e é
 * por isso que o editor não precisa saber nada sobre markup.
 */
(() => {
  const PAGINA = location.pathname;
  /* O idioma que a página está mostrando, quando o repo tem um arquivo por
     idioma (i18n-objeto). Quem sabe é a ponte, pelo stega; o save leva junto
     pra o servidor gravar no arquivo certo. Vazio nos outros formatos. */
  const idioma = () => (window.__copyEdit && window.__copyEdit.locale) || '';
  const editaveis = () => [...document.querySelectorAll('[data-copy]:not([data-copy-attr])')];

  /* `plaintext-only` é o que impede o editor de virar um gerador de markup:
     colar do Notion num contenteditable comum traz <span style>, e aí o SSoT
     recebe estilo em vez de texto. Firefox antigo não conhece o valor e cai no
     contenteditable normal, então o innerText continua sendo a leitura. */
  const MODO = 'plaintext-only';

/* ICONES:INICIO (gerado por npm run vendor:icones, @phosphor-icons/core 2.1.1; não edite) */
  const ICONES = {
    "editar": "<svg aria-hidden=\"true\" focusable=\"false\" width=\"18\" height=\"18\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" fill=\"currentColor\"><path d=\"M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z\"/></svg>",
    "pausar": "<svg aria-hidden=\"true\" focusable=\"false\" width=\"18\" height=\"18\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" fill=\"currentColor\"><path d=\"M200,32H160a16,16,0,0,0-16,16V208a16,16,0,0,0,16,16h40a16,16,0,0,0,16-16V48A16,16,0,0,0,200,32Zm0,176H160V48h40ZM96,32H56A16,16,0,0,0,40,48V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V48A16,16,0,0,0,96,32Zm0,176H56V48H96Z\"/></svg>",
    "comentar": "<svg aria-hidden=\"true\" focusable=\"false\" width=\"18\" height=\"18\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" fill=\"currentColor\"><path d=\"M128,24A104,104,0,0,0,36.18,176.88L24.83,210.93a16,16,0,0,0,20.24,20.24l34.05-11.35A104,104,0,1,0,128,24Zm0,192a87.87,87.87,0,0,1-44.06-11.81,8,8,0,0,0-6.54-.67L40,216,52.47,178.6a8,8,0,0,0-.66-6.54A88,88,0,1,1,128,216Z\"/></svg>",
    "textos": "<svg aria-hidden=\"true\" focusable=\"false\" width=\"18\" height=\"18\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" fill=\"currentColor\"><path d=\"M32,64a8,8,0,0,1,8-8H216a8,8,0,0,1,0,16H40A8,8,0,0,1,32,64Zm8,72h72a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16Zm88,48H40a8,8,0,0,0,0,16h88a8,8,0,0,0,0-16Zm109.66,13.66a8,8,0,0,1-11.32,0L206,177.36A40,40,0,1,1,217.36,166l20.3,20.3A8,8,0,0,1,237.66,197.66ZM184,168a24,24,0,1,0-24-24A24,24,0,0,0,184,168Z\"/></svg>",
    "celular": "<svg aria-hidden=\"true\" focusable=\"false\" width=\"18\" height=\"18\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" fill=\"currentColor\"><path d=\"M176,16H80A24,24,0,0,0,56,40V216a24,24,0,0,0,24,24h96a24,24,0,0,0,24-24V40A24,24,0,0,0,176,16ZM72,64H184V192H72Zm8-32h96a8,8,0,0,1,8,8v8H72V40A8,8,0,0,1,80,32Zm96,192H80a8,8,0,0,1-8-8v-8H184v8A8,8,0,0,1,176,224Z\"/></svg>",
    "desfazer": "<svg aria-hidden=\"true\" focusable=\"false\" width=\"18\" height=\"18\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" fill=\"currentColor\"><path d=\"M224,128a96,96,0,0,1-94.71,96H128A95.38,95.38,0,0,1,62.1,197.8a8,8,0,0,1,11-11.63A80,80,0,1,0,71.43,71.39a3.07,3.07,0,0,1-.26.25L44.59,96H72a8,8,0,0,1,0,16H24a8,8,0,0,1-8-8V56a8,8,0,0,1,16,0V85.8L60.25,60A96,96,0,0,1,224,128Z\"/></svg>",
    "atalhos": "<svg aria-hidden=\"true\" focusable=\"false\" width=\"18\" height=\"18\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" fill=\"currentColor\"><path d=\"M224,48H32A16,16,0,0,0,16,64V192a16,16,0,0,0,16,16H224a16,16,0,0,0,16-16V64A16,16,0,0,0,224,48Zm0,144H32V64H224V192Zm-16-64a8,8,0,0,1-8,8H56a8,8,0,0,1,0-16H200A8,8,0,0,1,208,128Zm0-32a8,8,0,0,1-8,8H56a8,8,0,0,1,0-16H200A8,8,0,0,1,208,96ZM72,160a8,8,0,0,1-8,8H56a8,8,0,0,1,0-16h8A8,8,0,0,1,72,160Zm96,0a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,160Zm40,0a8,8,0,0,1-8,8h-8a8,8,0,0,1,0-16h8A8,8,0,0,1,208,160Z\"/></svg>",
    "menu": "<svg aria-hidden=\"true\" focusable=\"false\" width=\"18\" height=\"18\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" fill=\"currentColor\"><path d=\"M224,128a8,8,0,0,1-8,8H40a8,8,0,0,1,0-16H216A8,8,0,0,1,224,128ZM40,72H216a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16ZM216,184H40a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Z\"/></svg>",
    "fechar": "<svg aria-hidden=\"true\" focusable=\"false\" width=\"18\" height=\"18\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" fill=\"currentColor\"><path d=\"M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z\"/></svg>",
    "alca": "<svg aria-hidden=\"true\" focusable=\"false\" width=\"18\" height=\"18\" xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\" fill=\"currentColor\"><path d=\"M104,60A12,12,0,1,1,92,48,12,12,0,0,1,104,60Zm60,12a12,12,0,1,0-12-12A12,12,0,0,0,164,72ZM92,116a12,12,0,1,0,12,12A12,12,0,0,0,92,116Zm72,0a12,12,0,1,0,12,12A12,12,0,0,0,164,116ZM92,184a12,12,0,1,0,12,12A12,12,0,0,0,92,184Zm72,0a12,12,0,1,0,12,12A12,12,0,0,0,164,184Z\"/></svg>"
  };
  /* ICONES:FIM */

  /* ── barra v2 (PLAN-BARRA-V2.md): pílula vertical de ícones, cada botão com tooltip e a
     tecla dele. As classes antigas (.ce-toggle, .ce-chaves, .ce-regua, .ce-desfazer, .ce-n)
     continuam: o resto do arquivo pendura a lógica nelas. */
  const botao = (cls, icone, rotulo, tecla, extra = '') =>
    `<button type="button" class="ce-bt ${cls}" data-dica="${rotulo}" data-tecla="${tecla}" aria-label="${rotulo}" aria-keyshortcuts="${tecla}" ${extra}>${ICONES[icone] || ''}</button>`;
  const barra = document.createElement('div');
  barra.className = 'ce-barra';
  barra.setAttribute('role', 'toolbar');
  barra.setAttribute('aria-label', 'editor de copy');
  barra.innerHTML =
    '<div class="ce-grupo">' +
    botao('ce-toggle', 'pausar', 'Pausar edição', 'E', 'aria-pressed="false"') +
    botao('ce-comentar', 'comentar', 'Comentar', 'C', 'aria-pressed="false"') +
    botao('ce-chaves', 'textos', 'Textos sem cara', 'K') +
    botao('ce-regua', 'celular', 'Ver no celular', 'M') +
    botao('ce-desfazer', 'desfazer', 'Desfazer', '⌘Z', 'disabled') +
    '<span class="ce-sep" aria-hidden="true"></span>' +
    botao('ce-atalhos', 'atalhos', 'Atalhos', '?') +
    '</div>' +
    botao('ce-menu', 'menu', 'Recolher', '', 'aria-expanded="true"') +
    '<b class="ce-n" hidden></b>';
  const dica = document.createElement('div');
  dica.className = 'ce-dica';
  dica.setAttribute('role', 'tooltip');
  const recado = document.createElement('div');
  recado.className = 'ce-recado';

  const painel = document.createElement('aside');
  painel.className = 'ce-painel';
  painel.innerHTML =
    '<header><input type="search" placeholder="filtrar chave ou texto"><button class="ce-fechar">fechar</button></header>' +
    '<div class="ce-idioma" hidden></div>' +
    '<div class="ce-lista"></div>';

  document.body.append(barra, recado, painel, dica);

  const nEl = barra.querySelector('.ce-n');
  let ligado = true;

  function diz(texto, tipo) {
    recado.textContent = texto || '';
    recado.dataset.tipo = tipo || '';
    barra.dataset.alerta = texto && tipo === 'erro' ? '1' : '';
    clearTimeout(diz.t);
    if (texto && tipo !== 'erro') diz.t = setTimeout(() => (recado.textContent = ''), 4000);
  }

  /* ── a régua de celular ──────────────────────────────────────────────────
     Um iframe da MESMA rota com 375px de largura, que é o piso realista do
     mercado brasileiro e a largura que o `overflow:check` mede. Iframe e não
     um wrapper estreito porque media query responde à largura do VIEWPORT: um
     `div` de 375px continuaria renderizando o layout de desktop, e a régua
     mentiria exatamente onde ela precisa ser exata.

     Ela existe porque copy é escrita no desktop e quebra no celular. Sem isso
     o editor deixa você burilar uma headline que cabe lindamente em 1280 e
     estoura na tela onde a maior parte do funil lê. */
  const regua = document.createElement('aside');
  regua.className = 'ce-regua-painel';
  regua.innerHTML =
    '<header><b>375</b><span class="ce-medida"></span><button data-w="375">375</button>' +
    '<button data-w="390">390</button><button class="ce-regua-fechar">fechar</button></header>' +
    '<div class="ce-moldura"><iframe title="prévia em 375px"></iframe></div>';
  document.body.append(regua);
  const ifr = regua.querySelector('iframe');
  const medida = regua.querySelector('.ce-medida');

  function reguaAberta() {
    return regua.dataset.aberto === '1';
  }

  /* O estouro medido DENTRO da régua quando ela está aberta, e no documento
     quando não está. É o mesmo cálculo do `npm run overflow:check`
     (`scrollWidth - clientWidth`) e no DOCUMENTO, não no elemento: um
     decorativo dentro de um `overflow:hidden` dá falso positivo, e o que dói
     no dedo do usuário é a página inteira arrastar. */
  function estouro() {
    if (reguaAberta() && ifr.contentDocument) {
      const d = ifr.contentDocument.documentElement;
      return { px: d.scrollWidth - d.clientWidth, onde: regua.dataset.w + 'px' };
    }
    const d = document.documentElement;
    return { px: d.scrollWidth - d.clientWidth, onde: 'nesta largura' };
  }

  function largura(w) {
    regua.dataset.w = w;
    regua.querySelector('header b').textContent = w;
    ifr.style.width = w + 'px';
    regua.querySelectorAll('header button[data-w]').forEach((b) => {
      b.dataset.ativo = b.dataset.w === String(w) ? '1' : '0';
    });
    recarregarRegua();
  }

  /* Mirar é diferente de recarregar: enquanto o iframe já está na página
     certa, mudar de linha é rolar, não recarregar. Recarregar a cada clique
     daria um flash de página inteira a cada frase, e a régua vira desconforto
     em vez de instrumento. */
  function mirarRegua(chave) {
    if (!reguaAberta()) return;
    regua.dataset.chave = chave;
    const doc = ifr.contentDocument;
    const el = doc && doc.querySelector(`[data-copy="${CSS.escape(chave)}"]`);
    if (el) el.scrollIntoView({ block: 'center' });
    else recarregarRegua(chave);
  }

  function recarregarRegua(chave) {
    if (!reguaAberta()) return;
    const alvo = chave || regua.dataset.chave || '';
    regua.dataset.chave = alvo;
    /* O `t=` não é cache: é o que garante que a URL MUDE. Trocar só o hash faz
       o browser navegar sem recarregar, o `onload` não dispara e a régua ficaria
       mostrando a frase velha depois de um save. */
    ifr.src = `${PAGINA}?ce=preview&t=${Date.now()}`;
    ifr.onload = () => {
      const doc = ifr.contentDocument;
      if (!doc) return;
      /* O reveal do site depende de IntersectionObserver, e num iframe curto
         metade das dobras nunca entraria em vista. Sem isto a régua mostraria
         a página com o conteúdo invisível, que não é o que o visitante vê. */
      doc.querySelectorAll('.reveal').forEach((e) => e.classList.add('in', 'is-in', 'visible'));
      doc.querySelectorAll('[data-isca]').forEach((e) => e.classList.add('is-aberta'));
      const el = alvo && doc.querySelector(`[data-copy="${CSS.escape(alvo)}"]`);
      if (el) el.scrollIntoView({ block: 'center' });
      const x = estouro();
      medida.textContent = x.px > 0 ? `estoura ${x.px}px` : 'sem estouro';
      medida.dataset.ruim = x.px > 0 ? '1' : '0';
    };
  }

  /* Pilha de desfazer. O Esc só alcança o que ainda não foi salvo; depois do
     save o valor velho só existiria no git, e "dá um git checkout" no meio de
     uma sessão de burilamento é caro demais pra ser usado. Guardar o anterior
     aqui torna o experimento barato, que é a condição pra alguém experimentar
     de verdade. */
  const pilha = [];
  const botaoDesfazer = () => barra.querySelector('.ce-desfazer');

  /* `antes` viaja junto com o save: é o valor que ESTA aba tinha na tela. O
     servidor recusa a escrita se o disco não bater com ele, e é isso que impede
     uma aba velha de sobrescrever com texto antigo o que outra acabou de
     escrever. Sem esse par, o último Enter sempre ganha, mesmo estando errado. */
  async function salvar(chave, valor, el, ehDesfazer, antesExplicito, localeExplicito) {
    let antes = antesExplicito;
    /* O idioma do ELEMENTO vence o da página; o desfazer leva o do save que ele
       desfaz, mesmo que a página tenha trocado de idioma no meio. */
    const locale = localeExplicito || (el && el.dataset.copyL) || idioma() || undefined;
    if (!ehDesfazer) {
      if (antes === undefined && el) antes = el.dataset.ceAntes ?? '';
      if (antes !== undefined) pilha.push({ chave, valor: antes, locale });
      botaoDesfazer().disabled = pilha.length === 0;
    } else {
      antes = undefined;
    }
    diz('salvando ' + chave + '…');
    let r;
    try {
      r = await fetch('/__copy/salvar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pagina: PAGINA, chave, valor, antes, locale }),
      }).then((x) => x.json());
    } catch (e) {
      diz('o servidor do copy:edit caiu: ' + e.message, 'erro');
      return;
    }
    if (r.erro) {
      /* Recusa não é save: tirar da pilha impede que um desfazer depois
         restaure um valor que nunca chegou a existir no disco. */
      if (!ehDesfazer) {
        pilha.pop();
        botaoDesfazer().disabled = pilha.length === 0;
      }
      diz(r.erro, 'erro');
      return;
    }
    const meu = (r.lint || []).filter((l) => l.chave === chave);
    const outros = (r.lint || []).length - meu.length;
    if (el) el.classList.toggle('ce-sujo', meu.length > 0);

    recarregarRegua(chave);

    if (meu.length) {
      diz(
        meu.map((l) => `${l.regra} · ${chave}\n${l.conserto}`).join('\n\n') +
          (outros ? `\n\n(+${outros} em outras chaves do ${r.arquivo})` : ''),
        'erro'
      );
      return;
    }
    if (r.vocab && r.vocab.length) {
      diz('vocabulário fora do glossário:\n' + r.vocab.join('\n'), 'erro');
      return;
    }
    /* Com a régua fechada o iframe não recarregou ainda, então a medida sai do
       documento; com ela aberta o número vem de 375 ou 390, que é onde o
       estouro de copy acontece de verdade. */
    setTimeout(
      () => {
        const x = estouro();
        if (x.px > 0) {
          diz(
            `salvo em ${r.arquivo}, mas passou a estourar ${x.px}px de lado (${x.onde}).`,
            'erro'
          );
        } else {
          diz(`salvo · ${chave} → ${r.arquivo} · copy:build ok`);
        }
      },
      reguaAberta() ? 400 : 0
    );
  }

  /* Controle nativo não aceita caret: o Chrome não põe cursor dentro de
     <button>, e o clique dispara o que o elemento faz no ar (submit, abrir o
     <details>, navegar). Aqui o texto vira um campo flutuante por cima dele,
     que é o mesmo gesto dos editores visuais de CMS pra botão e link. */
  const CONTROLE = 'button, a, summary, label, [role="button"]';
  const ehControle = (el) => !!el.closest(CONTROLE);

  const campo = document.createElement('input');
  campo.className = 'ce-campo';
  campo.spellcheck = true;
  document.body.append(campo);
  let alvoCampo = null;

  function abrirCampo(el) {
    alvoCampo = el;
    el.dataset.ceAntes = el.innerText;
    const r = el.getBoundingClientRect();
    campo.value = el.innerText;
    campo.style.left = r.left + 'px';
    campo.style.top = r.top + 'px';
    campo.style.minWidth = Math.max(r.width, 160) + 'px';
    campo.style.height = Math.max(r.height, 28) + 'px';
    campo.dataset.aberto = '1';
    campo.focus();
    campo.select();
    mirarRegua(el.dataset.copy);
  }

  function fecharCampo(gravar) {
    const el = alvoCampo;
    if (!el) return;
    alvoCampo = null;
    campo.dataset.aberto = '0';
    if (!gravar) return diz('desfeito');
    const valor = campo.value.replace(/ /g, ' ').trim();
    if (valor === (el.dataset.ceAntes ?? '').trim()) return;
    if (!valor) {
      diz(
        'copy vazia não entra no SSoT. Se a linha não serve mais, tire o data-copy do HTML.',
        'erro'
      );
      return;
    }
    /* Ícone dentro do botão sobrevive: só o nó de texto troca. */
    const txt = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    if (txt) txt.textContent = valor;
    else el.textContent = valor;
    salvar(el.dataset.copy, valor, el);
  }

  campo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      fecharCampo(true);
    }
    if (e.key === 'Escape') fecharCampo(false);
  });
  campo.addEventListener('blur', () => fecharCampo(true));

  /* ── comentário pra IA ───────────────────────────────────────────────────
     Alt+clique em QUALQUER elemento, copy ou não. O que não é texto (largura,
     foto, motion, token) não tem SSoT pra este editor escrever, então vira
     pedido: uma linha em docs/COMENTARIOS-IA.md com rota e seletor, que o
     Claude executa depois com o `npm run check` como juiz. */
  const UI = '.ce-barra, .ce-painel, .ce-regua-painel, .ce-recado, .ce-campo, .ce-nota';

  /* Seletor curto e estável: para no primeiro id ou data-copy, e usa
     nth-of-type só quando há irmão do mesmo tipo. */
  function seletorDe(el) {
    const partes = [];
    let n = el;
    while (n && n.nodeType === 1 && n !== document.body && partes.length < 6) {
      if (n.id) {
        partes.unshift('#' + CSS.escape(n.id));
        break;
      }
      if (n.dataset.copy) {
        partes.unshift(`[data-copy="${n.dataset.copy}"]`);
        break;
      }
      let p = n.tagName.toLowerCase();
      const cls = [...n.classList].filter((c) => !c.startsWith('ce-')).slice(0, 2);
      if (cls.length) p += '.' + cls.map((c) => CSS.escape(c)).join('.');
      const irmaos = n.parentElement
        ? [...n.parentElement.children].filter((x) => x.tagName === n.tagName)
        : [];
      if (irmaos.length > 1) p += `:nth-of-type(${irmaos.indexOf(n) + 1})`;
      partes.unshift(p);
      n = n.parentElement;
    }
    return partes.join(' > ');
  }

  const nota = document.createElement('div');
  nota.className = 'ce-nota';
  nota.innerHTML =
    '<div class="ce-cores"></div>' +
    '<textarea rows="1" placeholder="pedir pra IA…"></textarea>' +
    '<button class="ce-nota-fechar" aria-label="fechar">×</button>';
  document.body.append(nota);
  const notaTxt = nota.querySelector('textarea');
  const notaCores = nota.querySelector('.ce-cores');
  let alvoNota = null;
  const fecharNota = () => {
    nota.dataset.aberto = '0';
    alvoNota = null;
  };
  nota.querySelector('.ce-nota-fechar').onclick = fecharNota;

  let todosTokens = null;

  /* ONDE o estilo grava. No HTML estático (visantismo) a classe é nome de
     componente (`.hero-title`) e mora numa regra de topo do styles.css, então a
     primeira classe é o alvo certo, com `[data-copy]` de reserva pro texto sem
     classe.

     Num app com Tailwind (Club) a primeira classe é utilitário (`text-sm`,
     `max-w-prose`): o servidor recusa, e com razão, porque escrever ali mudaria
     todo elemento da casa que usa o mesmo utilitário. Lá a ponte do stega liga
     `window.__copyEdit = { seletor: 'data-copy' }` e a chave da copy vira o
     seletor: é o único nome que aquele texto tem sozinho. Sem a flag, nada
     muda pro visantismo. */
  const porChave = () => (window.__copyEdit || {}).seletor === 'data-copy';

  /* { seletor, rotulo } ou null. `rotulo` é o que aparece no recado e na chave
     da pendência (sem escape), `seletor` é o que vai pro CSS. */
  function alvoEstilo(el) {
    if (porChave()) {
      const k = el.dataset.copy;
      return k ? { seletor: `[data-copy="${k}"]`, rotulo: `[data-copy="${k}"]` } : null;
    }
    const c = classeDe(el);
    return c ? { seletor: '.' + CSS.escape(c), rotulo: '.' + c } : null;
  }

  const seletorEstilo = (el) => {
    if (porChave()) return (alvoEstilo(el) || {}).seletor || null;
    const c = classeDe(el);
    if (c) return '.' + CSS.escape(c);
    return el.dataset.copy ? `[data-copy="${el.dataset.copy}"]` : null;
  };

  const postar = (url, corpo) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    })
      .then((x) => x.json())
      .catch((e) => ({ erro: e.message }));

  /* ── alterações pendentes ────────────────────────────────────────────────
     Largura e token não gravam no gesto: viram pendência, com preview ao vivo
     numa <style> só do editor. A barra mostra "N alterações · aplicar", e só
     o aplicar escreve no styles.css e no tokens.json. Ctrl+Z anda pra trás nas
     pendências sem tocar no disco. A copy continua gravando na hora, porque o
     lint de voz precisa responder no segundo seguinte. */
  const pendentes = new Map();
  const preview = document.createElement('style');
  preview.id = 'ce-preview';
  document.head.append(preview);
  const aplicarBox = document.createElement('div');
  aplicarBox.className = 'ce-aplicar';
  aplicarBox.innerHTML =
    '<b></b><button class="ce-ap-sim">aplicar</button><button class="ce-ap-nao">descartar</button>';
  barra.append(aplicarBox);

  function pintar() {
    let css = ':root {';
    for (const p of pendentes.values()) if (p.tipo === 'token') css += `--${p.nome}: ${p.valor};`;
    css += '}';
    for (const p of pendentes.values()) {
      if (p.tipo === 'estilo') css += `${p.seletor} { ${p.prop}: ${p.valor} !important; }`;
    }
    preview.textContent = css;
    const n = pendentes.size;
    aplicarBox.dataset.aberto = n ? '1' : '0';
    aplicarBox.querySelector('b').textContent = n === 1 ? '1 alteração' : n + ' alterações';
    botaoDesfazer().disabled = pilha.length === 0;
  }

  /* Cada gesto guarda o estado ANTERIOR da pendência, e o desfazer devolve
     esse estado. Sem pendência anterior, desfazer é apagar a pendência. */
  /* Um gesto pode mexer em mais de uma regra (filho + pai que cresce junto),
     e continua sendo UM passo de desfazer. */
  function pender(...novos) {
    const itens = novos
      .filter((v) => (pendentes.get(v.chave) || {}).valor !== v.valor)
      .map((v) => ({ chave: v.chave, anterior: pendentes.get(v.chave) }));
    if (!itens.length) return;
    pilha.push({ tipo: 'visual', itens });
    for (const v of novos) pendentes.set(v.chave, v);
    pintar();
  }

  async function aplicar() {
    const itens = [...pendentes.values()];
    const erros = [];
    for (const p of itens) {
      const r =
        p.tipo === 'token'
          ? await postar('/__copy/token', { nome: p.nome, valor: p.valor })
          : await postar('/__copy/estilo', { seletor: p.seletor, prop: p.prop, valor: p.valor });
      if (r.erro) erros.push(r.erro);
      else {
        pendentes.delete(p.chave);
        if (p.tipo === 'token') {
          const t = todosTokens && todosTokens.find((k) => k.nome === p.nome);
          if (t) t.valor = p.valor;
        }
      }
    }
    /* O styles.css da aba ainda é o velho: recarrega a folha antes de tirar o
       preview, senão a página pisca pro valor antigo no meio. */
    const link = document.querySelector('link[rel="stylesheet"][href*="styles.css"]');
    if (link) {
      const novo = link.cloneNode();
      novo.href = link.href.split('?')[0] + '?t=' + Date.now();
      novo.onload = () => {
        link.remove();
        pintar();
      };
      link.after(novo);
    } else pintar();
    for (let i = pilha.length - 1; i >= 0; i--) if (pilha[i].tipo === 'visual') pilha.splice(i, 1);
    diz(
      erros.length
        ? 'não aplicou: ' + erros.join(' · ')
        : `${itens.length} aplicada(s) · styles.css / tokens.json · rode o npm run check antes do commit`,
      erros.length ? 'erro' : ''
    );
  }

  function descartar() {
    pendentes.clear();
    for (let i = pilha.length - 1; i >= 0; i--) if (pilha[i].tipo === 'visual') pilha.splice(i, 1);
    pintar();
    if (alvoNota) montarCores(alvoNota);
    diz('alterações descartadas');
  }
  aplicarBox.querySelector('.ce-ap-sim').onclick = aplicar;
  aplicarBox.querySelector('.ce-ap-nao').onclick = descartar;
  addEventListener('beforeunload', (e) => {
    if (pendentes.size) e.preventDefault();
  });

  /* ── amostras de cor ─────────────────────────────────────────────────────
     Igual à paleta de estilos do Figma: as cores da marca (os tokens com hex)
     em bolinha, a atual com anel. Clicar troca a cor DESTE elemento pelo token,
     como pendência. O valor do token não muda, só quem o elemento usa. */
  const hex = (rgb) => {
    const m = rgb.match(/d+/g);
    return m
      ? '#' +
          m
            .slice(0, 3)
            .map((n) => (+n).toString(16).padStart(2, '0'))
            .join('')
      : '';
  };

  /* Uma linha por propriedade, todas no mesmo gesto: clicar na opção grava
     `prop: var(--token)` no seletor do elemento, como pendência. */
  function linhaOpcoes(el, seletor, prop, tokens, ativo, desenhar) {
    const linha = document.createElement('div');
    linha.className = 'ce-linha';
    for (const t of tokens) {
      const b = document.createElement('button');
      b.title = '--' + t.nome;
      b.dataset.ativo = ativo(t) ? '1' : '0';
      desenhar(b, t);
      b.onclick = () => {
        const chave = 'estilo:' + seletor + ':' + prop;
        pender({ tipo: 'estilo', chave, seletor, prop, valor: `var(--${t.nome})` });
        diz(`${prop} → --${t.nome} (pendente)`);
        setTimeout(() => montarCores(el), 0);
      };
      linha.append(b);
    }
    return linha;
  }

  /* Tamanho do token em px, medido no próprio documento: clamp() só resolve
     com o viewport de verdade. */
  function pxDoToken(nome) {
    const s = document.createElement('span');
    s.style.cssText = `position:absolute;visibility:hidden;font-size:var(--${nome})`;
    document.body.append(s);
    const px = parseFloat(getComputedStyle(s).fontSize);
    s.remove();
    return px;
  }

  async function montarCores(el) {
    if (!todosTokens) {
      todosTokens = await fetch('/__copy/tokens')
        .then((x) => x.json())
        .then((r) => r.tokens)
        .catch(() => []);
    }
    notaCores.innerHTML = '';
    const seletor = seletorEstilo(el);
    if (!seletor) {
      notaCores.textContent = porChave() ? 'sem chave, peça pra IA' : 'sem classe, peça pra IA';
      return;
    }
    const cs = getComputedStyle(el);
    const cor = hex(cs.color);
    const familia = cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
    const tamanho = parseFloat(cs.fontSize);

    notaCores.append(
      linhaOpcoes(
        el,
        seletor,
        'color',
        todosTokens.filter((k) => /^#[0-9a-f]{6}$/i.test(k.valor)),
        (t) => t.valor.toLowerCase() === cor,
        (b, t) => {
          b.className = 'ce-cor';
          b.style.background = t.valor;
        }
      ),
      linhaOpcoes(
        el,
        seletor,
        'font-family',
        todosTokens.filter((k) => k.nome.startsWith('font-')),
        (t) => t.valor.split(',')[0].replace(/['"]/g, '').trim() === familia,
        (b, t) => {
          b.className = 'ce-op';
          b.style.fontFamily = t.valor;
          b.textContent = 'Aa';
        }
      ),
      linhaOpcoes(
        el,
        seletor,
        'font-size',
        todosTokens.filter((k) => /^(display|h\d|text-|fs-)/.test(k.nome)),
        (t) => Math.abs(pxDoToken(t.nome) - tamanho) < 0.5,
        (b, t) => {
          b.className = 'ce-op';
          b.textContent = t.nome;
        }
      )
    );
  }

  function abrirNota(el, x, y) {
    alvoNota = el;
    nota.style.left = Math.max(8, Math.min(x, innerWidth - 360)) + 'px';
    nota.style.top = Math.max(8, Math.min(y + 12, innerHeight - 120)) + 'px';
    nota.dataset.aberto = '1';
    notaTxt.value = '';
    montarCores(el);
  }

  /* ── alça de largura ─────────────────────────────────────────────────────
     Passar o mouse num texto editável (ou Shift+passar em qualquer elemento)
     mostra uma alça na borda direita. Arrastar muda a largura ao vivo; soltar
     grava `max-width` na regra da primeira classe do elemento no styles.css.
     Elemento centrado cresce pros dois lados, então a alça anda 2× pra ficar
     colada no dedo. */
  const alca = document.createElement('div');
  alca.className = 'ce-alca';
  alca.title = 'arraste pra mudar a largura';
  document.body.append(alca);
  let alvoAlca = null;
  let arrastando = null;

  const classeDe = (el) => [...el.classList].find((c) => !c.startsWith('ce-') && c !== 'reveal');

  function porAlca(el) {
    alvoAlca = el;
    const r = el.getBoundingClientRect();
    alca.style.left = r.right - 4 + 'px';
    alca.style.top = r.top + r.height / 2 - 14 + 'px';
    alca.dataset.aberto = '1';
  }

  document.addEventListener('mousemove', (e) => {
    if (!ligado || arrastando || e.altKey) return;
    if (e.target === alca) return;
    const el = e.target.closest && e.target.closest(e.shiftKey ? '[class]' : '.ce-alvo');
    if (!el || el.closest(UI)) return;
    if (el !== alvoAlca) porAlca(el);
  });

  /* A alça é fixed e o elemento rola: no scroll ela some até o próximo hover. */
  addEventListener(
    'scroll',
    () => {
      if (arrastando) return;
      alca.dataset.aberto = '0';
      alvoAlca = null;
    },
    { passive: true }
  );

  alca.addEventListener('pointerdown', (e) => {
    if (!alvoAlca) return;
    e.preventDefault();
    try {
      alca.setPointerCapture(e.pointerId);
    } catch {
      /* evento sintético não tem ponteiro de verdade */
    }
    const el = alvoAlca;
    const r = el.getBoundingClientRect();
    const pai = el.parentElement.getBoundingClientRect();
    const centrado = Math.abs(r.left - pai.left - (pai.right - r.right)) < 3;
    const p = el.parentElement;
    const cs = getComputedStyle(p);
    const paiConteudo = p.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    arrastando = {
      el,
      x0: e.clientX,
      w0: r.width,
      k: centrado ? 2 : 1,
      pai: alvoEstilo(p) && cs.maxWidth !== 'none' ? p : null,
      paiW0: p.getBoundingClientRect().width,
      paiConteudo,
    };
  });

  alca.addEventListener('pointermove', (e) => {
    if (!arrastando) return;
    const { el, x0, w0, k } = arrastando;
    const w = Math.max(40, Math.round(w0 + (e.clientX - x0) * k));
    el.style.maxWidth = w + 'px';
    el.style.width = w + 'px';
    arrastando.w = w;
    /* Pai mais estreito que o filho segura a largura, e o arraste pareceria
       quebrado. Aí o pai cresce junto, como frame com hug no Figma. */
    const pai = arrastando.pai;
    if (pai) {
      const sobra = w - arrastando.paiConteudo;
      pai.style.maxWidth = sobra > 0 ? arrastando.paiW0 + sobra + 'px' : '';
      arrastando.paiW = sobra > 0 ? arrastando.paiW0 + sobra : 0;
    }
    porAlca(el);
    diz(`${(alvoEstilo(el) || {}).rotulo || '?'} · max-width ${w}px`);
  });

  alca.addEventListener('pointerup', () => {
    if (!arrastando) return;
    const { el, w, pai, paiW } = arrastando;
    arrastando = null;
    el.style.width = '';
    el.style.maxWidth = '';
    if (pai) pai.style.maxWidth = '';
    if (!w) return;
    const alvo = alvoEstilo(el);
    if (!alvo) {
      return diz(
        porChave()
          ? 'esse elemento não tem chave de copy. Alt+clique e peça pra IA.'
          : 'esse elemento não tem classe. Alt+clique e peça pra IA.',
        'erro'
      );
    }
    const mudancas = [
      {
        tipo: 'estilo',
        chave: 'estilo:' + alvo.rotulo + ':max-width',
        seletor: alvo.seletor,
        rotulo: alvo.rotulo,
        prop: 'max-width',
        valor: w + 'px',
      },
    ];
    if (pai && paiW) {
      const ap = alvoEstilo(pai);
      mudancas.push({
        tipo: 'estilo',
        chave: 'estilo:' + ap.rotulo + ':max-width',
        seletor: ap.seletor,
        rotulo: ap.rotulo,
        prop: 'max-width',
        valor: Math.round(paiW) + 'px',
      });
    }
    pender(...mudancas);
    porAlca(el);
    diz(mudancas.map((m) => `${m.rotulo} → ${m.valor}`).join(' · ') + ' (pendente)');
  });

  async function enviarNota() {
    const el = alvoNota;
    const texto = notaTxt.value.trim();
    nota.dataset.aberto = '0';
    alvoNota = null;
    notaTxt.blur();
    if (!el || !texto) return;
    const r = await fetch('/__copy/comentar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pagina: PAGINA,
        seletor: seletorDe(el),
        trecho: (el.innerText || el.getAttribute('alt') || '').trim(),
        texto,
      }),
    })
      .then((x) => x.json())
      .catch((e) => ({ erro: e.message }));
    if (r.erro) return diz('comentário não salvou: ' + r.erro, 'erro');
    el.classList.add('ce-comentado');
    diz('comentário na fila · ' + r.arquivo);
  }

  notaTxt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enviarNota();
    }
    if (e.key === 'Escape') {
      nota.dataset.aberto = '0';
      alvoNota = null;
      /* Sem o blur o foco ficava no campo escondido e as teclas (E, C, K) viravam texto. */
      notaTxt.blur();
    }
  });

  /* Com Alt apertado a mira mostra qual elemento vai receber o comentário. */
  let mira = null;
  const tirarMira = () => {
    if (mira) mira.classList.remove('ce-mira');
    mira = null;
  };
  document.addEventListener('mouseover', (e) => {
    if (!e.altKey || !ligado || e.target.closest(UI)) return tirarMira();
    tirarMira();
    mira = e.target;
    mira.classList.add('ce-mira');
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Alt') tirarMira();
  });

  document.addEventListener(
    'click',
    (e) => {
      if (!e.altKey || !ligado || e.target.closest(UI)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      tirarMira();
      abrirNota(e.target, e.clientX, e.clientY);
    },
    true
  );

  /* O que já está na fila aparece marcado, pra ninguém pedir duas vezes. */
  fetch('/__copy/comentarios?pagina=' + encodeURIComponent(PAGINA))
    .then((x) => x.json())
    .then((r) => {
      for (const c of r.itens || []) {
        if (c.feito) continue;
        try {
          const el = document.querySelector(c.seletor);
          if (el) {
            el.classList.add('ce-comentado');
            el.title = 'pedido pra IA: ' + c.texto;
          }
        } catch {
          /* seletor que não parseia mais: a linha continua no md */
        }
      }
    })
    .catch(() => {});

  /* Captura, e não bolha: o handler do site (submit, toggle do details) não
     pode nem saber que o clique aconteceu.

     Ctrl/⌘+clique é a exceção (08/10/2026, pedido do dono): o clique PASSA e o
     botão faz o que faz no ar. Com o app inteiro editável, sem isto não dava
     nem pra entrar na conta com o editor ligado. `passaProSite` segura o
     submit que esse mesmo clique dispara logo em seguida. */
  let passaProSite = false;
  document.addEventListener(
    'click',
    (e) => {
      if (ligado && (e.ctrlKey || e.metaKey) && !e.altKey) {
        passaProSite = true;
        setTimeout(() => (passaProSite = false), 0);
        return;
      }
      if (!ligado || e.altKey) return;
      const el = e.target.closest && e.target.closest('.ce-controle');
      if (!el) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      abrirCampo(el);
    },
    true
  );
  document.addEventListener(
    'submit',
    (e) => {
      if (ligado && !passaProSite) e.preventDefault();
    },
    true
  );

  function preparar(el) {
    el.classList.add('ce-alvo');
    if (ehControle(el)) {
      el.classList.add('ce-controle');
      return;
    }
    el.contentEditable = MODO;
    el.spellcheck = true;

    el.addEventListener('focus', () => {
      el.dataset.ceAntes = el.innerText;
      mirarRegua(el.dataset.copy);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        el.innerText = el.dataset.ceAntes ?? el.innerText;
        el.blur();
        diz('desfeito');
      }
      /* Enter salva; Shift+Enter quebra linha, que no SSoT vira \n e no HTML
         vira <br>. É o mesmo par que o copy.mjs já usa nos dois sentidos. */
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        el.blur();
      }
    });
    el.addEventListener('blur', () => {
      const valor = el.innerText.replace(/ /g, ' ').trim();
      if (valor === (el.dataset.ceAntes ?? '').trim()) return;
      if (!valor) {
        el.innerText = el.dataset.ceAntes;
        diz(
          'copy vazia não entra no SSoT. Se a linha não serve mais, tire o data-copy do HTML.',
          'erro'
        );
        return;
      }
      salvar(el.dataset.copy, valor, el);
    });
  }

  /* A dobra que o site esconde até o clique (`[data-isca]`, a amostra da
     /ebook) fica aberta no editor: texto fechado não se clica, e o atalho do
     painel rolaria até um nó sem caixa. */
  document.querySelectorAll('[data-isca]').forEach((e) => e.classList.add('is-aberta'));

  const alvos = editaveis();
  alvos.forEach(preparar);
  nEl.textContent = alvos.length + ' na tela';
  barra.querySelector('.ce-toggle').dataset.extra = nEl.textContent;

  /* ── desfazer ─────────────────────────────────────────────────────────── */
  async function desfazer() {
    const ultimo = pilha.pop();
    botaoDesfazer().disabled = pilha.length === 0;
    if (!ultimo) return;
    /* Visual desfaz só a pendência, sem disco. Copy desfaz gravando o valor
       anterior, porque copy já foi gravada no gesto. */
    if (ultimo.tipo === 'visual') {
      for (const i of ultimo.itens) {
        if (i.anterior) pendentes.set(i.chave, i.anterior);
        else pendentes.delete(i.chave);
      }
      pintar();
      if (alvoNota) montarCores(alvoNota);
      return diz('desfeito');
    }
    const el = alvos.find((e) => e.dataset.copy === ultimo.chave);
    if (el) {
      el.innerText = ultimo.valor;
      el.dataset.ceAntes = ultimo.valor;
      el.classList.remove('ce-sujo');
    }
    await salvar(ultimo.chave, ultimo.valor, el, true, undefined, ultimo.locale);
    diz(`desfeito · ${ultimo.chave} voltou ao valor anterior`);
  }
  botaoDesfazer().onclick = desfazer;
  /* Ctrl+Z fora de um campo. Dentro do texto quem manda é o desfazer nativo do
     contenteditable, que é o certo enquanto a frase não foi salva. */
  document.addEventListener('keydown', (e) => {
    const dentro = document.activeElement && document.activeElement.isContentEditable;
    const campo = document.activeElement && document.activeElement.tagName === 'TEXTAREA';
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !dentro && !campo) {
      e.preventDefault();
      desfazer();
    }
  });

  /* ── régua ────────────────────────────────────────────────────────────── */
  barra.querySelector('.ce-regua').onclick = () => {
    const abrir = !reguaAberta();
    regua.dataset.aberto = abrir ? '1' : '0';
    document.body.classList.toggle('ce-com-regua', abrir);
    if (abrir) {
      painel.dataset.aberto = '0';
      largura(Number(regua.dataset.w) || 375);
    }
  };
  regua.querySelector('.ce-regua-fechar').onclick = () => {
    regua.dataset.aberto = '0';
    document.body.classList.remove('ce-com-regua');
  };
  regua.querySelectorAll('header button[data-w]').forEach((b) => {
    b.onclick = () => largura(Number(b.dataset.w));
  });

  /* Tecla E pausa e retoma, fora de campo de texto (08/10/2026). Pausado, a
     página volta a se comportar como no ar: clique é clique. Dentro de um texto
     em edição o E é só uma letra, por isso a guarda. */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'e' && e.key !== 'E') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const a = document.activeElement;
    if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
    e.preventDefault();
    barra.querySelector('.ce-toggle').click();
  });

  barra.querySelector('.ce-toggle').onclick = () => {
    ligado = !ligado;
    document.body.classList.toggle('ce-off', !ligado);
    alvos.forEach((el) => {
      if (!ehControle(el)) el.contentEditable = ligado ? MODO : 'false';
    });
    const bt = barra.querySelector('.ce-toggle');
    bt.innerHTML = ICONES[ligado ? 'pausar' : 'editar'] || '';
    bt.dataset.dica = ligado ? 'Pausar edição' : 'Retomar edição';
    bt.setAttribute('aria-label', bt.dataset.dica);
    bt.setAttribute('aria-pressed', String(!ligado));
    if (!ligado) modoComentar(false);
    diz(ligado ? '' : 'pausado (E retoma), a página volta a se comportar como no ar');
  };

  /* ── painel ────────────────────────────────────────────────────────────
     As chaves sem representação visível (alt, <title>, og:) são ~15% do SSoT e
     nenhum editor inline alcança elas. Aqui elas viram campo, e as que estão na
     tela viram atalho de rolagem em vez de campo duplicado. */
  const lista = painel.querySelector('.ce-lista');
  const busca = painel.querySelector('input');
  let carregado = false;

  async function carregar() {
    const r = await fetch(
      '/__copy/chaves?pagina=' + encodeURIComponent(PAGINA) + '&locale=' + encodeURIComponent(idioma())
    ).then((x) => x.json());
    /* Em repo com um arquivo por idioma, o painel diz de qual idioma são os
       textos: editar aqui grava nesse arquivo. */
    const id$ = painel.querySelector('.ce-idioma');
    id$.hidden = !r.locale;
    if (r.locale) id$.textContent = 'idioma da página: ' + r.locale + ' · grava em ' + r.arquivo;
    const naTela = new Set(alvos.map((el) => el.dataset.copy));
    lista.innerHTML = '';
    for (const [k, v] of Object.entries(r.chaves || {})) {
      const item = document.createElement('div');
      item.className = 'ce-item';
      item.dataset.tela = naTela.has(k) ? '1' : '0';
      item.dataset.busca = (k + ' ' + v).toLowerCase();
      const k$ = document.createElement('span');
      k$.className = 'k';
      k$.textContent = k;
      const v$ = document.createElement('div');
      v$.className = 'v';
      v$.textContent = v;
      const t$ = document.createElement('textarea');
      t$.rows = Math.min(5, Math.ceil(String(v).length / 52));
      t$.value = v;
      /* Duas chaves têm limite DURO e nenhuma delas aparece na tela, que é
         justamente por que elas apodrecem: o Google corta o título em ~60
         caracteres e a description em ~155, e ninguém nota porque o defeito
         mora no resultado de busca. O contador é a única forma de o limite
         existir na hora da escrita. */
      const teto = { 'meta.title': 60, 'meta.description': 155 }[k] || 0;
      const c$ = document.createElement('span');
      c$.className = 'ce-conta';
      const conta = () => {
        const n = t$.value.length;
        c$.textContent = teto ? `${n}/${teto}` : `${n}`;
        c$.dataset.ruim = teto && n > teto ? '1' : '0';
      };
      conta();
      t$.addEventListener('input', conta);
      t$.addEventListener('blur', () => {
        if (t$.value.trim() && t$.value !== v) salvar(k, t$.value.trim(), null, false, v);
      });
      k$.onclick = () => {
        const el = alvos.find((e) => e.dataset.copy === k);
        if (!el) return;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (ehControle(el)) setTimeout(() => abrirCampo(el), 350);
        else el.focus();
      };
      k$.append(c$);
      item.append(k$, v$, t$);
      lista.append(item);
    }
    carregado = true;
  }

  busca.oninput = () => {
    const q = busca.value.toLowerCase();
    lista.querySelectorAll('.ce-item').forEach((i) => {
      i.style.display = !q || i.dataset.busca.includes(q) ? '' : 'none';
    });
  };
  painel.querySelector('.ce-fechar').onclick = () => (painel.dataset.aberto = '0');
  /* A página trocou de idioma: a lista do painel é do idioma velho. */
  window.addEventListener('copy-edit:locale', () => {
    carregado = false;
    if (painel.dataset.aberto === '1') carregar();
    diz('idioma da página: ' + idioma() + ' (os saves vão pro arquivo dele)');
  });
  /* Painel e régua dividem a mesma borda da tela, então um fecha o outro. Dois
     painéis empilhados à direita deixariam menos página visível do que os dois
     juntos entregam, e a página é o que se está julgando. */
  barra.querySelector('.ce-chaves').onclick = async () => {
    if (!carregado) await carregar();
    const abrir = painel.dataset.aberto !== '1';
    painel.dataset.aberto = abrir ? '1' : '0';
    if (abrir) {
      regua.dataset.aberto = '0';
      document.body.classList.remove('ce-com-regua');
    }
  };

  /* ══ barra v2: comportamento da casca (PLAN-BARRA-V2.md) ══════════════════════════════ */

  /* Contagem vai pro tooltip do pausar, não pra um rótulo solto na barra. */
  const editarBt = barra.querySelector('.ce-toggle');
  editarBt.dataset.extra = nEl.textContent;

  /* Tooltip: nome + tecla, do lado de dentro da tela. Abre no hover e no foco do teclado. */
  function mostrarDica(bt) {
    const tecla = bt.dataset.tecla;
    dica.innerHTML = '';
    const t = document.createElement('span');
    t.textContent = bt.dataset.dica + (bt.dataset.extra ? ' · ' + bt.dataset.extra : '');
    dica.append(t);
    if (tecla) {
      const k = document.createElement('kbd');
      k.textContent = tecla;
      dica.append(k);
    }
    const r = bt.getBoundingClientRect();
    dica.dataset.aberto = '1';
    const w = dica.offsetWidth;
    const h = dica.offsetHeight;
    const praEsquerda = barra.dataset.lado !== 'esquerda';
    dica.style.left = (praEsquerda ? r.left - w - 10 : r.right + 10) + 'px';
    dica.style.top = r.top + r.height / 2 - h / 2 + 'px';
  }
  const esconderDica = () => (dica.dataset.aberto = '0');
  barra.addEventListener('pointerover', (e) => {
    const bt = e.target.closest('.ce-bt');
    if (bt && !arrasto) mostrarDica(bt);
  });
  barra.addEventListener('pointerleave', esconderDica);
  barra.addEventListener('focusin', (e) => {
    const bt = e.target.closest('.ce-bt');
    if (bt && bt.matches(':focus-visible')) mostrarDica(bt);
  });
  barra.addEventListener('focusout', esconderDica);
  barra.addEventListener('click', esconderDica);

  /* ── modo comentário (C) ─────────────────────────────────────────────────
     O mesmo comentário do Alt+clique, sem precisar segurar tecla: liga, a mira segue o
     ponteiro, um clique abre a nota e o modo desliga. Escuta no window em captura, que roda
     antes dos handlers de document: o clique não chega no site nem no campo de edição. */
  let comentando = false;
  const comentarBt = barra.querySelector('.ce-comentar');
  function modoComentar(liga) {
    comentando = liga === undefined ? !comentando : liga;
    comentarBt.setAttribute('aria-pressed', String(comentando));
    document.body.classList.toggle('ce-comentando', comentando);
    if (!comentando) tirarMira();
    else diz('clique no elemento pra comentar (Esc cancela)');
  }
  comentarBt.onclick = () => {
    if (!ligado) barra.querySelector('.ce-toggle').click();
    modoComentar();
  };
  window.addEventListener(
    'mouseover',
    (e) => {
      if (!comentando || e.target.closest(UI)) return;
      tirarMira();
      mira = e.target;
      mira.classList.add('ce-mira');
    },
    true
  );
  for (const tipo of ['pointerdown', 'mousedown']) {
    window.addEventListener(
      tipo,
      (e) => {
        if (comentando && !e.target.closest(UI)) e.preventDefault();
      },
      true
    );
  }
  window.addEventListener(
    'click',
    (e) => {
      if (!comentando || e.target.closest(UI)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const alvo = e.target;
      modoComentar(false);
      abrirNota(alvo, e.clientX, e.clientY);
      setTimeout(() => notaTxt.focus(), 0);
    },
    true
  );

  /* ── lista de atalhos (?) ───────────────────────────────────────────── */
  const ajuda = document.createElement('div');
  ajuda.className = 'ce-ajuda';
  ajuda.setAttribute('role', 'dialog');
  ajuda.setAttribute('aria-label', 'atalhos do editor');
  const ATALHOS = [
    ['Clique no texto', 'editar'],
    ['Enter', 'salvar'],
    ['Esc', 'desfazer a edição ou fechar'],
    ['E', 'pausar ou retomar'],
    ['C', 'comentar (ou Alt+clique)'],
    ['K', 'textos sem cara (alt, title, og)'],
    ['M', 'ver no celular'],
    ['⌘/Ctrl+Z', 'desfazer o último save'],
    ['⌘/Ctrl+clique', 'clicar como no site'],
    ['?', 'esta lista'],
  ];
  ajuda.innerHTML =
    '<header><b>Atalhos</b><button type="button" class="ce-ajuda-fechar" aria-label="fechar">' +
    (ICONES.fechar || '×') +
    '</button></header><dl></dl>';
  const dl = ajuda.querySelector('dl');
  for (const [k, v] of ATALHOS) {
    const dt = document.createElement('dt');
    const kbd = document.createElement('kbd');
    kbd.textContent = k;
    dt.append(kbd);
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  document.body.append(ajuda);
  const ajudaAberta = (abre) => (ajuda.dataset.aberto = abre ? '1' : '0');
  barra.querySelector('.ce-atalhos').onclick = () => ajudaAberta(ajuda.dataset.aberto !== '1');
  ajuda.querySelector('.ce-ajuda-fechar').onclick = () => ajudaAberta(false);

  /* ── teclado da casca ────────────────────────────────────────────────── */
  const emCampo = () => {
    const a = document.activeElement;
    return a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  };
  const TECLAS = { c: '.ce-comentar', k: '.ce-chaves', m: '.ce-regua', '?': '.ce-atalhos' };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (comentando) return modoComentar(false);
      if (ajuda.dataset.aberto === '1') return ajudaAberta(false);
      if (painel.dataset.aberto === '1') return (painel.dataset.aberto = '0');
      if (reguaAberta()) return regua.querySelector('.ce-regua-fechar').click();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || emCampo()) return;
    const acao = TECLAS[e.key === '?' ? '?' : e.key.toLowerCase()];
    if (!acao) return;
    e.preventDefault();
    barra.querySelector(acao).click();
  });

  /* ── recolher e arrastar ────────────────────────────────────────────────
     Recolhida, a barra vira só o botão de menu. Arrastada pelo menu, ela gruda no canto
     mais perto (quatro cantos, como a toolbar da Vercel) e lembra onde ficou. */
  const GUARDA = 'ce-barra-v2';
  const estado = (() => {
    try {
      return JSON.parse(localStorage.getItem(GUARDA)) || {};
    } catch {
      return {};
    }
  })();
  const guardar = () => {
    try {
      localStorage.setItem(GUARDA, JSON.stringify(estado));
    } catch {
      /* modo privado: a posição só não persiste */
    }
  };
  function aplicar() {
    barra.dataset.lado = estado.lado || 'direita';
    barra.dataset.altura = estado.altura || 'baixo';
    barra.dataset.recolhida = estado.recolhida ? '1' : '0';
    const menu = barra.querySelector('.ce-menu');
    menu.setAttribute('aria-expanded', String(!estado.recolhida));
    menu.dataset.dica = estado.recolhida ? 'Abrir editor' : 'Recolher (arraste pra mover)';
    menu.setAttribute('aria-label', menu.dataset.dica);
    document.body.dataset.ceLado = barra.dataset.lado;
  }
  aplicar();
  let arrasto = null;
  const menuBt = barra.querySelector('.ce-menu');
  menuBt.addEventListener('pointerdown', (e) => {
    arrasto = { x: e.clientX, y: e.clientY, moveu: false };
    menuBt.setPointerCapture(e.pointerId);
  });
  menuBt.addEventListener('pointermove', (e) => {
    if (!arrasto) return;
    if (!arrasto.moveu && Math.hypot(e.clientX - arrasto.x, e.clientY - arrasto.y) < 6) return;
    arrasto.moveu = true;
    esconderDica();
    barra.classList.add('ce-arrastando');
    barra.style.left = e.clientX - barra.offsetWidth / 2 + 'px';
    barra.style.top = e.clientY - barra.offsetHeight + 18 + 'px';
    barra.style.right = barra.style.bottom = 'auto';
  });
  menuBt.addEventListener('pointerup', (e) => {
    const a = arrasto;
    arrasto = null;
    if (!a) return;
    barra.classList.remove('ce-arrastando');
    barra.style.left = barra.style.top = barra.style.right = barra.style.bottom = '';
    if (a.moveu) {
      estado.lado = e.clientX < innerWidth / 2 ? 'esquerda' : 'direita';
      estado.altura = e.clientY < innerHeight / 2 ? 'cima' : 'baixo';
    } else {
      estado.recolhida = !estado.recolhida;
    }
    guardar();
    aplicar();
  });
  /* Teclado: Enter/Espaço no menu recolhe, como o clique. */
  menuBt.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    estado.recolhida = !estado.recolhida;
    guardar();
    aplicar();
  });
})();
