/* O codemod do `copy-edit migrar`: lê o AST (ts-morph) de cada .tsx e devolve
 * as edições de texto, as mensagens novas e a lista de revisão. NÃO grava:
 * quem decide gravar, checar tipo e desfazer é o migrar/index.mjs.
 *
 * Por que edição de TEXTO sobre posições do AST, e não as APIs de mutação do
 * ts-morph: mexer num nó invalida os irmãos, e um arquivo do Club tem dezenas
 * de textos. Analisar tudo no AST original e aplicar as edições de trás pra
 * frente é determinístico e não perde comentário nem formatação.
 *
 * O que vira chave (o óbvio, que os 8 agentes migraram sem discutir):
 *   · texto de JSX, inclusive com `{variavel}` no meio (vira ICU com variável)
 *     e com `{n === 1 ? 'a' : 'b'}` (vira ICU plural);
 *   · atributo lido: placeholder, aria-label, alt, title (+ a lista de props
 *     de texto de componente, `titulo`, `descricao`...);
 *   · frase cortada por elemento simples (`Leia o <a>guia</a> antes`) vira
 *     `t.rich` com o elemento preservado;
 *   · ternário e `&&` com string literal nos dois lados, sozinhos no JSX.
 * O que NÃO é óbvio vai pra revisão com arquivo:linha e o motivo (ver
 * `motivoDeLiteral`), nunca é chutado.
 */
import { Node, SyntaxKind } from 'ts-morph';
import { limparJsxText, decodificar, slugDeIcu, temLetra, ehDado, pareceTexto, icuLiteralInseguro, montarIcu } from './texto.mjs';

export const ATRIBUTOS_HTML = ['placeholder', 'aria-label', 'alt', 'title', 'aria-description', 'aria-placeholder', 'aria-roledescription', 'aria-valuetext', 'label'];
/* Prop de componente que É texto lido. A lista é de nomes, não de tipos: um
   `titulo="..."` num componente da casa é copy em 100% dos casos que vimos. */
export const ATRIBUTOS_COMPONENTE = [
  ...ATRIBUTOS_HTML,
  'ariaLabel', 'titulo', 'subtitulo', 'descricao', 'texto', 'rotulo', 'legenda', 'mensagem', 'aviso', 'dica', 'chamada',
  'description', 'subtitle', 'heading', 'text', 'caption', 'hint', 'tooltip', 'eyebrow', 'cta', 'emptyText', 'helperText',
];
/* Dentro destas tags o texto é código, atalho de teclado ou desenho. */
const TAGS_SEM_COPY = new Set(['code', 'pre', 'kbd', 'samp', 'script', 'style', 'svg', 'math']);
/* Chamadas cujo argumento de frase chega na tela como está. */
const FUNCOES_DE_TEXTO = /^((window\.)?(confirm|alert|prompt)|toast(\.\w+)?|set[A-Z]\w*)$/;
/* Funções cujos argumentos são className, nunca copy. */
const FUNCOES_CLASSE = new Set(['cn', 'clsx', 'classNames', 'cx', 'twMerge', 'cva', 'tv']);
/* Atributo/propriedade que carrega dado técnico: a string ali nunca é listada. */
const CHAVES_TECNICAS = /^(className|class|href|src|srcSet|id|key|type|name|role|rel|target|method|action|as|variant|size|tone|color|cor|icon|icone|lang|htmlFor|style|d|fill|stroke|viewBox|xmlns|sizes|loading|prefetch|accept|autoComplete|inputMode|pattern|form|value|defaultValue|slug|sku|path|rota|url|href\w*|data-\w+|aria-(controls|describedby|labelledby|hidden|live|current|expanded|haspopup|selected|checked|pressed|invalid|busy|atomic|relevant|owns|activedescendant|level|modal|orientation))$/;

const ehFuncao = (n) =>
  Node.isFunctionDeclaration(n) || Node.isFunctionExpression(n) || Node.isArrowFunction(n) || Node.isMethodDeclaration(n);

/* O nome pelo qual o React conhece a função: declaração, `const X = () =>`,
   `const X = memo(function ...)`, `export default ...`. */
function nomeDe(fn) {
  if (Node.isFunctionDeclaration(fn)) return fn.getName() || (fn.isDefaultExport() ? '<default>' : '');
  if (Node.isFunctionExpression(fn) && fn.getName()) return fn.getName();
  const p = fn.getParent();
  if (Node.isVariableDeclaration(p)) return p.getName();
  if (Node.isExportAssignment(p)) return '<default>';
  if (Node.isCallExpression(p)) {
    const pp = p.getParent();
    if (Node.isVariableDeclaration(pp)) return pp.getName();
    if (Node.isExportAssignment(pp)) return '<default>';
  }
  return '';
}

/* Componente (Maiúscula ou default) ou hook (`useX`): os únicos lugares onde
   `useTranslations` não fere a regra dos hooks. */
export function ehComponente(fn) {
  if (Node.isMethodDeclaration(fn)) return false;
  const nome = nomeDe(fn);
  return nome === '<default>' || /^[A-Z]/.test(nome) || /^use[A-Z0-9]/.test(nome);
}

/* O componente mais próximo que envolve o nó. Função minúscula no meio
   (callback do `.map`, helper interno) não atrapalha: o `t` vem da closure. */
function componenteDe(n) {
  for (let a = n.getParent(); a; a = a.getParent()) {
    if (Node.isClassDeclaration(a) || Node.isClassExpression(a)) return null;
    if (ehFuncao(a) && ehComponente(a)) return a;
  }
  return null;
}

const dentroDeTagSemCopy = (n) =>
  !!n.getFirstAncestor((a) => {
    if (!Node.isJsxElement(a) && !Node.isJsxSelfClosingElement(a)) return false;
    const tag = Node.isJsxElement(a) ? a.getOpeningElement().getTagNameNode().getText() : a.getTagNameNode().getText();
    return TAGS_SEM_COPY.has(tag);
  });

/* Elemento que separa falas: bloco HTML, ou componente (Maiúscula) com
   filhos que são elementos. Inline (a, strong, Link com texto) não separa. */
const BLOCO = new Set(['div', 'p', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main', 'form', 'fieldset', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'figure', 'figcaption', 'blockquote', 'details', 'summary', 'hr', 'img', 'button', 'label', 'input', 'textarea', 'select', 'video', 'iframe', 'picture']);
function ehBloco(no) {
  const tag = tagDe(no);
  if (BLOCO.has(tag)) return true;
  if (/^[A-Z]/.test(tag) && Node.isJsxElement(no)) return no.getJsxChildren().some((c) => !Node.isJsxText(c));
  return false;
}

const tagDe = (el) =>
  Node.isJsxElement(el) ? el.getOpeningElement().getTagNameNode().getText() : Node.isJsxSelfClosingElement(el) ? el.getTagNameNode().getText() : '';

/* Tipo que o ICU aceita como variável sem mudar o texto: string ou número
   (literal ou não, união deles). `null`, ReactNode, any: não. */
function tipoDaVar(expr) {
  let t;
  try {
    t = expr.getType();
  } catch {
    return null;
  }
  const membros = t.isUnion() ? t.getUnionTypes() : [t];
  let str = false;
  let num = false;
  for (const m of membros) {
    if (m.isString() || m.isStringLiteral() || m.isTemplateLiteral?.()) str = true;
    else if (m.isNumber() || m.isNumberLiteral()) num = true;
    else return null;
  }
  return str && num ? 'misto' : str ? 'string' : num ? 'number' : null;
}

/* Expressão que pode virar `{nome}` no ICU: identificador, acesso a
   propriedade ou chamada simples, sem string nem JSX dentro (string dentro
   seria texto escondido, JSX seria elemento). */
function nomeDeVar(expr) {
  if (Node.isIdentifier(expr)) return expr.getText();
  /* `itens.length` vira `n` (o nome que os agentes davam), não `length`. */
  if (Node.isPropertyAccessExpression(expr)) return ['length', 'size'].includes(expr.getName()) ? 'n' : expr.getName();
  if (Node.isCallExpression(expr)) {
    const c = expr.getExpression();
    if (Node.isIdentifier(c)) return c.getText();
    if (Node.isPropertyAccessExpression(c)) return c.getName();
  }
  if (Node.isNonNullExpression(expr) || Node.isParenthesizedExpression(expr)) return nomeDeVar(expr.getExpression());
  return null;
}
function varSimples(expr) {
  if (!nomeDeVar(expr)) return false;
  if (expr.getFirstDescendant((d) => Node.isStringLiteral(d) || Node.isNoSubstitutionTemplateLiteral(d) || Node.isTemplateExpression(d) || Node.isJsxElement(d) || Node.isJsxSelfClosingElement(d) || Node.isJsxFragment(d) || ehFuncao(d)))
    return false;
  return true;
}

/* `n === 1 ? 'a' : 'b'` (ou `!==`, ou `1 === n`). Devolve o seletor e os
   ramos, ou null. Qualquer outra condição é "string condicional complexa". */
function pluralDe(expr) {
  if (!Node.isConditionalExpression(expr)) return null;
  let cond = expr.getCondition();
  while (Node.isParenthesizedExpression(cond)) cond = cond.getExpression();
  if (!Node.isBinaryExpression(cond)) return null;
  const op = cond.getOperatorToken().getText();
  if (!['===', '==', '!==', '!='].includes(op)) return null;
  const [a, b] = [cond.getLeft(), cond.getRight()];
  const um = (n) => Node.isNumericLiteral(n) && n.getLiteralValue() === 1;
  const sel = um(b) ? a : um(a) ? b : null;
  if (!sel || !varSimples(sel)) return null;
  const igual = op === '===' || op === '==';
  return { sel, um: igual ? expr.getWhenTrue() : expr.getWhenFalse(), outro: igual ? expr.getWhenFalse() : expr.getWhenTrue() };
}

const desembrulhar = (e) => {
  while (Node.isParenthesizedExpression(e) || Node.isAsExpression(e) || Node.isSatisfiesExpression?.(e)) e = e.getExpression();
  return e;
};

/* ── mensagens ────────────────────────────────────────────────────────── */

/* A árvore de mensagens: começa com o que já existe nos JSON e só ganha
   folha. Texto igual na mesma seção reaproveita a chave; chave ocupada com
   outro texto ganha sufixo (nunca sobrescreve copy existente). */
export class Mensagens {
  constructor(base = {}) {
    this.arvore = JSON.parse(JSON.stringify(base));
    this.novas = 0;
    this.reusos = 0;
    this.tocados = new Set();
  }
  chave(ns, secao, base, texto) {
    if (typeof this.arvore[ns] !== 'object' || this.arvore[ns] === null) this.arvore[ns] = {};
    let raiz = this.arvore[ns];
    let sec = secao;
    if (sec) {
      let i = 1;
      while (typeof raiz[sec] === 'string') sec = secao + ++i;
      raiz[sec] ??= {};
      raiz = raiz[sec];
    }
    let nome = base;
    for (let i = 1; ; ) {
      const v = raiz[nome];
      const chave = [sec, nome].filter(Boolean).join('.');
      if (v === undefined) {
        raiz[nome] = texto;
        this.novas++;
        this.tocados.add(ns);
        return chave;
      }
      if (v === texto) {
        this.reusos++;
        return chave;
      }
      nome = base + ++i;
    }
  }
}

/* ── análise de um arquivo ────────────────────────────────────────────── */

/**
 * @param sf        SourceFile (texto ORIGINAL)
 * @param ctx       { ns, secao, msgs: Mensagens, marcas: Set, revisao: fn(no, motivo, trecho?) }
 * @returns { edicoes: [{ini, fim, texto}], migrados: n, imports: Set('useTranslations'|'getTranslations') }
 */
export function analisarArquivo(sf, ctx) {
  const edicoes = [];
  const consumidos = []; // [ini, fim] de trechos já reescritos (t.rich)
  /* Literais já migrados (não vão pra revisão), por posição e não por nó: a
     checagem de tipo troca o texto do arquivo e o ts-morph recria os nós. */
  const editados = new Set();
  const editar = (n) => editados.add(n.getStart() + ':' + n.getEnd());
  const componentes = new Map(); // fn → { nomeT, async, reuso }
  const imports = new Set();
  let migrados = 0;
  const texto = sf.getFullText();
  const eol = texto.includes('\r\n') ? '\r\n' : '\n';
  const pontoVirgula = /^import [^\n]*;\r?$/m.test(texto);

  /* Nome do `t`: `t` se o arquivo não usa esse identificador pra outra coisa
     (o `.map((t) => ...)` é comum), senão o próximo livre. */
  const usados = new Set(sf.getDescendantsOfKind(SyntaxKind.Identifier).map((i) => i.getText()));
  const livre = ['t', 'tr', 'tc', 'tCopy', 'tCopy2'].find((n) => !usados.has(n));

  const dentroConsumido = (n) => consumidos.some(([a, b]) => n.getStart() >= a && n.getEnd() <= b);

  /* Prepara o `t` do componente e devolve o nome dele. */
  function tDo(no) {
    const fn = componenteDe(no);
    if (!fn) return null;
    if (componentes.has(fn)) return componentes.get(fn).nomeT;
    /* Já existe `const X = useTranslations('ns')` / `await getTranslations('ns')` no topo? reusa. */
    const corpo = fn.getBody();
    if (Node.isBlock(corpo)) {
      for (const st of corpo.getStatements()) {
        if (!Node.isVariableStatement(st)) continue;
        for (const d of st.getDeclarations()) {
          const ini = d.getInitializer() && desembrulhar(Node.isAwaitExpression(d.getInitializer()) ? d.getInitializer().getExpression() : d.getInitializer());
          if (!ini || !Node.isCallExpression(ini)) continue;
          const nomeF = ini.getExpression().getText();
          const arg = ini.getArguments()[0];
          if ((nomeF === 'useTranslations' || nomeF === 'getTranslations') && arg && Node.isStringLiteral(arg) && arg.getLiteralValue() === ctx.ns && Node.isIdentifier(d.getNameNode())) {
            const info = { nomeT: d.getName(), reuso: true };
            componentes.set(fn, info);
            return info.nomeT;
          }
        }
      }
    }
    if (!livre) return null;
    const info = { nomeT: livre, async: fn.isAsync(), fn, reuso: false };
    componentes.set(fn, info);
    imports.add(info.async ? 'getTranslations' : 'useTranslations');
    return livre;
  }

  /* Um pedaço de mensagem a partir de expressão de texto: literal, template
     com variáveis simples, plural óbvio, variável. `vars` acumula os valores. */
  function fragmento(expr, vars, dentroDePlural = false) {
    expr = desembrulhar(expr);
    if (Node.isStringLiteral(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) {
      const v = expr.getLiteralValue();
      if (icuLiteralInseguro(v)) return { erro: 'tem chave `{}` ou `<` no texto (ICU leria como variável ou tag)' };
      return { partes: [{ tipo: 'lit', valor: v, dentroDePlural }], literal: v };
    }
    if (Node.isTemplateExpression(expr)) {
      const partes = [];
      let literal = '';
      const head = expr.getHead().getLiteralText();
      if (icuLiteralInseguro(head)) return { erro: 'tem chave `{}` ou `<` no texto' };
      partes.push({ tipo: 'lit', valor: head, dentroDePlural });
      literal += head;
      for (const span of expr.getTemplateSpans()) {
        const f = fragmento(span.getExpression(), vars, dentroDePlural);
        if (f.erro) return f;
        partes.push(...f.partes);
        literal += f.literal || '';
        const lit = span.getLiteral().getLiteralText();
        if (icuLiteralInseguro(lit)) return { erro: 'tem chave `{}` ou `<` no texto' };
        partes.push({ tipo: 'lit', valor: lit, dentroDePlural });
        literal += lit;
      }
      return { partes, literal };
    }
    const pl = pluralDe(expr);
    if (pl) {
      if (tipoDaVar(pl.sel) !== 'number') return { erro: 'plural com seletor que não é número' };
      const nome = registrarVar(vars, pl.sel, true);
      const um = fragmento(pl.um, vars, true);
      const outro = fragmento(pl.outro, vars, true);
      if (um.erro || outro.erro) return { erro: um.erro || outro.erro };
      if (!um.partes.every((p) => p.tipo === 'lit' || p.ok) || !outro.partes.every((p) => p.tipo === 'lit' || p.ok)) return { erro: 'plural com ramo que não é texto' };
      const raw = `{${nome}, plural, =1 {${montarIcu(um.partes)}} other {${montarIcu(outro.partes)}}}`;
      return { partes: [{ tipo: 'raw', valor: raw, ok: true }], literal: (um.literal || '') + (outro.literal || '') };
    }
    if (varSimples(expr)) {
      const tipo = tipoDaVar(expr);
      if (!tipo) return { erro: `variável \`${expr.getText()}\` não é texto nem número (é ${expr.getType().getText(expr).slice(0, 60)})` };
      const nome = registrarVar(vars, expr, false, tipo);
      return { partes: [{ tipo: 'raw', valor: `{${nome}}`, ok: true }], literal: '' };
    }
    return { erro: `expressão \`${expr.getText().slice(0, 50)}\` no meio do texto` };
  }

  /* vars: Map nome → { expr: texto, numeroPlural, tipo } */
  function registrarVar(vars, expr, plural, tipo) {
    const base = nomeDeVar(expr);
    const src = expr.getText();
    for (let i = 1; ; i++) {
      const nome = i === 1 ? base : base + i;
      const v = vars.get(nome);
      if (!v) {
        vars.set(nome, { src, plural, tipo: tipo || tipoDaVar(expr) });
        return nome;
      }
      if (v.src === src) {
        if (plural) v.plural = true;
        return nome;
      }
    }
  }

  /* `{ n, titulo: item.titulo, ano: String(ano) }`. Número fora de plural vai
     como String(): o ICU formataria 2026 como "2.026" e o texto mudaria. */
  function objetoVars(vars, extra = []) {
    const itens = [...vars].map(([nome, v]) => {
      let val = v.src;
      if (!v.plural && v.tipo !== 'string') val = `String(${v.src})`;
      return val === nome ? nome : `${nome}: ${val}`;
    });
    itens.push(...extra);
    return itens.length ? `, { ${itens.join(', ')} }` : '';
  }

  const ehMarca = (s) => ctx.marcas.has(s.trim().toLowerCase());

  /* Registra a mensagem e devolve a chamada `t('chave', {...})`. */
  function chamada(no, mensagem, vars, rich = []) {
    const nomeT = tDo(no);
    if (!nomeT) return null;
    const chave = ctx.msgs.chave(ctx.ns, ctx.secao, slugDeIcu(mensagem), mensagem);
    migrados++;
    const fn = rich.length ? `${nomeT}.rich` : nomeT;
    return `${fn}('${chave}'${objetoVars(vars, rich)})`;
  }

  /* ── 1. filhos de elemento: frases ─────────────────────────────────── */
  const elementos = sf.getDescendants().filter((n) => Node.isJsxElement(n) || Node.isJsxFragment(n));
  for (const el of elementos) {
    if (dentroConsumido(el)) continue;
    if (Node.isJsxElement(el) && TAGS_SEM_COPY.has(tagDe(el))) continue;
    if (dentroDeTagSemCopy(el)) continue;
    const filhos = el.getJsxChildren();

    /* Classifica cada filho. */
    const itens = filhos.map((f) => {
      if (Node.isJsxText(f)) {
        const limpo = decodificar(limparJsxText(f.compilerNode.text));
        return { no: f, tipo: 'texto', valor: limpo, ini: f.getPos(), fim: f.getEnd() };
      }
      if (Node.isJsxExpression(f)) {
        const e = f.getExpression();
        if (!e) return { no: f, tipo: 'comentario' };
        const vars = new Map();
        const fr = fragmento(e, vars);
        const lit = Node.isStringLiteral(desembrulhar(e)) || Node.isNoSubstitutionTemplateLiteral(desembrulhar(e)) || Node.isTemplateExpression(desembrulhar(e)) || pluralDe(desembrulhar(e));
        if (!fr.erro) return { no: f, tipo: lit ? 'expr-texto' : 'var', expr: e, ini: f.getStart(), fim: f.getEnd() };
        return { no: f, tipo: 'quebra', expr: e, erro: fr.erro };
      }
      return { no: f, tipo: 'elemento' };
    });

    /* Corridas de texto contínuo (texto, variável, plural), cortadas por
       elemento, expressão complexa ou comentário. */
    const corridas = [];
    let atual = null;
    itens.forEach((it, i) => {
      if (it.tipo === 'texto' || it.tipo === 'var' || it.tipo === 'expr-texto') {
        if (!atual) corridas.push((atual = { de: i, ate: i }));
        else atual.ate = i;
      } else atual = null;
    });

    /* Corrida "textual" é a que tem letra fora das variáveis. */
    const literalDa = (c) => {
      let s = '';
      for (let i = c.de; i <= c.ate; i++) {
        const it = itens[i];
        if (it.tipo === 'texto') s += it.valor;
        if (it.tipo === 'expr-texto') s += fragmento(it.expr, new Map()).literal || '';
      }
      return s;
    };
    /* Corrida com qualquer texto visível entra no agrupamento, até a de só
       pontuação: em "Bem-vindo, {nome}." o ponto é da mesma frase, e migrar
       "Bem-vindo," sozinho cortaria a frase em duas chaves. */
    const textuais = corridas.filter((c) => /\S/.test(literalDa(c).replace(/ /g, ' ')));

    /* Grupos: elemento de bloco (div, ul, p, h2...) entre dois textos separa
       duas falas; elemento inline (a, strong, Link) ou expressão no meio é a
       MESMA frase cortada, e frase cortada vira t.rich ou revisão. */
    const grupos = [];
    let g = [];
    let ultimo = -1;
    for (const c of textuais) {
      const entre = itens.slice(ultimo + 1, c.de);
      if (g.length && entre.some((it) => it.tipo === 'elemento' && ehBloco(it.no))) {
        grupos.push(g);
        g = [];
      }
      g.push(c);
      ultimo = c.ate;
    }
    if (g.length) grupos.push(g);

    for (const grupo of grupos) {
      const lit = grupo.map(literalDa).join('');
      if (!temLetra(lit) || ehDado(lit) || ehMarca(lit)) continue;
      if (grupo.length === 1) {
        tratarCorrida(el, itens, grupo[0]);
        continue;
      }
      const de = grupo[0].de;
      const ate = grupo[grupo.length - 1].ate;
      const meio = itens.slice(de, ate + 1);
      const quebra = meio.find((it) => it.tipo === 'quebra' || it.tipo === 'comentario');
      const naoSimples = meio.find((it) => it.tipo === 'elemento' && !elementoSimples(it.no));
      if (quebra || naoSimples) {
        const motivo = quebra
          ? quebra.tipo === 'comentario'
            ? 'Frase cortada por comentário JSX no meio: juntar à mão'
            : `Frase com expressão que não é texto no meio (${quebra.erro}): t.rich ou variável à mão`
          : `Frase cortada por elemento com conteúdo próprio (<${tagDe(naoSimples.no) || 'fragmento'}>): t.rich à mão`;
        ctx.revisao(el, motivo, literalDa({ de, ate }));
        marcarLiterais(meio);
        continue;
      }
      /* t.rich: os elementos do meio viram tag, preservados no callback. */
      const vars = new Map();
      const partes = [];
      const rich = [];
      const tags = new Map();
      let falhou = null;
      for (const it of meio) {
        if (it.tipo === 'texto') partes.push({ tipo: 'lit', valor: it.valor });
        else if (it.tipo === 'var' || it.tipo === 'expr-texto') {
          const f = fragmento(it.expr, vars);
          if (f.erro) falhou = f.erro;
          else partes.push(...f.partes);
        } else if (it.tipo === 'elemento') {
          const nomeTag = registrarTag(tags, it.no);
          const dentro = it.no.getJsxChildren().map((c) => decodificar(limparJsxText(c.compilerNode.text))).join('');
          if (icuLiteralInseguro(dentro)) falhou = 'texto dentro do elemento tem `{}` ou `<`';
          partes.push({ tipo: 'raw', valor: `<${nomeTag}>` }, { tipo: 'lit', valor: dentro }, { tipo: 'raw', valor: `</${nomeTag}>` });
          const abre = it.no.getOpeningElement().getText();
          const fecha = it.no.getClosingElement().getText();
          rich.push(`${nomeTag}: (chunks) => ${abre}{chunks}${fecha}`);
        }
      }
      if (partes.some((p) => p.tipo === 'lit' && icuLiteralInseguro(p.valor))) falhou = 'tem chave `{}` ou `<` no texto (ICU leria como variável ou tag)';
      if (falhou) {
        ctx.revisao(el, `Frase com elemento no meio que não deu pra montar em t.rich (${falhou})`, literalDa({ de, ate }));
        continue;
      }
      if (substituirCorrida(el, itens, de, ate, partes, vars, rich))
        consumidos.push([itens[de].ini ?? itens[de].no.getStart(), itens[ate].fim ?? itens[ate].no.getEnd()]);
    }

    /* Ternário / && com literal, sozinho entre elementos: cada ramo vira chave. */
    for (const it of itens) {
      if (it.tipo !== 'quebra') continue;
      migrarRamos(it.expr);
    }
  }

  function tratarCorrida(el, itens, c) {
    const vars = new Map();
    const partes = [];
    let falhou = null;
    for (let i = c.de; i <= c.ate; i++) {
      const it = itens[i];
      if (it.tipo === 'texto') {
        if (icuLiteralInseguro(it.valor)) falhou = 'tem chave `{}` ou `<` no texto';
        partes.push({ tipo: 'lit', valor: it.valor });
      } else {
        const f = fragmento(it.expr, vars);
        if (f.erro) falhou = f.erro;
        else partes.push(...f.partes);
      }
    }
    if (falhou) {
      ctx.revisao(el, `Texto que não deu pra montar em ICU (${falhou})`, partes.map((p) => p.valor).join(''));
      return;
    }
    substituirCorrida(el, itens, c.de, c.ate, partes, vars, []);
  }

  function elementoSimples(no) {
    if (!Node.isJsxElement(no)) return false;
    if (TAGS_SEM_COPY.has(tagDe(no)) && tagDe(no) !== 'code') return false;
    const f = no.getJsxChildren();
    return f.length > 0 && f.every((c) => Node.isJsxText(c));
  }

  function registrarTag(tags, no) {
    const base = tagDe(no).replace(/[^A-Za-z0-9]/g, '').replace(/^./, (c) => c.toLowerCase()) || 'tag';
    let nome = base;
    for (let i = 2; tags.has(nome); i++) nome = base + i;
    tags.set(nome, no);
    return nome;
  }

  function marcarLiterais(meio) {
    for (const it of meio) if (it.expr) andar(it.expr, (d) => void editar(d));
    for (const it of meio) if (it.expr) editar(desembrulhar(it.expr));
  }

  /* Troca a corrida [de..ate] por `{' '}{t('chave', vars)}{' '}`. A borda de
     espaço sai da mensagem e volta como JSX explícito: o render é o mesmo e o
     JSON não guarda espaço que ninguém vê no editor. */
  function substituirCorrida(el, itens, de, ate, partes, vars, rich) {
    let msg = montarIcu(partes);
    const lead = msg.match(/^ +/)?.[0] || '';
    const trail = msg.match(/ +$/)?.[0] || '';
    msg = msg.slice(lead.length, msg.length - trail.length);
    if (!msg || ehMarca(msg)) return false;
    const call = chamada(el, msg, vars, rich);
    if (!call) {
      ctx.revisao(el, 'Texto fora de componente (helper minúsculo, constante de módulo ou classe): o `t` não alcança; vire componente ou receba o texto por prop', msg);
      return false;
    }
    let ini = itens[de].ini ?? itens[de].no.getStart();
    let fim = itens[ate].fim ?? itens[ate].no.getEnd();
    /* Espaço de borda COM quebra de linha o JSX joga fora: fica no código
       como estava, pra o diff mexer só no texto e a indentação sobreviver. */
    if (itens[de].tipo === 'texto') ini += (itens[de].no.compilerNode.text.match(/^[ \t]*\r?\n\s*/)?.[0] || '').length;
    if (itens[ate].tipo === 'texto') fim -= (itens[ate].no.compilerNode.text.match(/[ \t]*\r?\n\s*$/)?.[0] || '').length;
    if (fim < ini) fim = ini;
    const esp = (s) => (s ? `{'${s}'}` : '');
    edicoes.push({ ini, fim, texto: `${esp(lead)}{${call}}${esp(trail)}` });
    for (let i = de; i <= ate; i++) if (itens[i].expr) marcarLiterais([itens[i]]);
    return true;
  }

  /* `{cond ? 'A' : 'B'}`, `{cond && 'A'}`, `title={cond ? 'A' : 'B'}`: o
     ramo que é texto vira `t()`, o resto fica como está. */
  function migrarRamos(expr) {
    expr = desembrulhar(expr);
    const ramos = [];
    if (Node.isConditionalExpression(expr) && !pluralDe(expr)) ramos.push(expr.getWhenTrue(), expr.getWhenFalse());
    else if (Node.isBinaryExpression(expr) && ['&&', '||', '??'].includes(expr.getOperatorToken().getText())) ramos.push(expr.getRight());
    else return false;
    let algum = false;
    for (let r of ramos) {
      r = desembrulhar(r);
      if (Node.isConditionalExpression(r) || Node.isBinaryExpression(r)) {
        algum = migrarRamos(r) || algum;
        continue;
      }
      if (!(Node.isStringLiteral(r) || Node.isNoSubstitutionTemplateLiteral(r) || Node.isTemplateExpression(r))) continue;
      const vars = new Map();
      const f = fragmento(r, vars);
      if (f.erro) {
        if (temLetra(r.getText().replace(/\$\{[^}]*\}/g, ''))) ctx.revisao(r, `Ramo de condicional que não deu pra montar em ICU (${f.erro})`, r.getText().slice(1, -1));
        editar(r);
        continue;
      }
      if (!temLetra(f.literal) || ehDado(f.literal) || ehMarca(f.literal)) continue;
      const msg = montarIcu(f.partes);
      if (msg !== msg.trim()) {
        ctx.revisao(r, 'Ramo de condicional com espaço na borda: juntar com o texto vizinho à mão', msg);
        editar(r);
        continue;
      }
      const call = chamada(r, msg, vars);
      if (!call) continue;
      edicoes.push({ ini: r.getStart(), fim: r.getEnd(), texto: call });
      editar(r);
      algum = true;
    }
    return algum;
  }

  /* ── 2. atributos lidos ─────────────────────────────────────────────── */
  for (const attr of sf.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    if (dentroConsumido(attr) || dentroDeTagSemCopy(attr)) continue;
    const nome = attr.getNameNode().getText();
    const dono = attr.getParent().getParent();
    const tag = Node.isJsxOpeningElement(dono) || Node.isJsxSelfClosingElement(dono) ? dono.getTagNameNode().getText() : '';
    const intrinseco = /^[a-z]/.test(tag) && !tag.includes('.');
    const lista = intrinseco ? ctx.atributosHtml : ctx.atributosComponente;
    const init = attr.getInitializer();
    if (!init) continue;
    if (Node.isStringLiteral(init)) {
      const valor = decodificar(init.compilerNode.text);
      if (!temLetra(valor) || ehDado(valor) || ehMarca(valor)) continue;
      if (!lista.has(nome)) {
        if (!CHAVES_TECNICAS.test(nome) && pareceTexto(valor)) ctx.revisao(attr, `Atributo fora da lista de texto lido, confira se é copy (\`${nome}\`)`, valor);
        editar(init);
        continue;
      }
      if (icuLiteralInseguro(valor)) {
        ctx.revisao(attr, 'Atributo com `{}` ou `<` no texto', valor);
        editar(init);
        continue;
      }
      const call = chamada(attr, valor.trim() === valor ? valor : valor, new Map());
      if (!call) {
        ctx.revisao(attr, 'Atributo fora de componente: o `t` não alcança', valor);
        editar(init);
        continue;
      }
      edicoes.push({ ini: init.getStart(), fim: init.getEnd(), texto: `{${call}}` });
      editar(init);
    } else if (Node.isJsxExpression(init) && init.getExpression()) {
      if (!lista.has(nome)) continue;
      const e = desembrulhar(init.getExpression());
      if (Node.isStringLiteral(e) || Node.isNoSubstitutionTemplateLiteral(e) || Node.isTemplateExpression(e)) {
        const vars = new Map();
        const f = fragmento(e, vars);
        if (f.erro) {
          if (temLetra(f.literal || e.getText())) ctx.revisao(attr, `Atributo com template que não é óbvio (\`${nome}\`: ${f.erro})`, e.getText());
          editar(e);
          continue;
        }
        if (!temLetra(f.literal) || ehDado(f.literal) || ehMarca(f.literal)) continue;
        const call = chamada(attr, montarIcu(f.partes), vars);
        if (!call) {
          ctx.revisao(attr, 'Atributo fora de componente: o `t` não alcança', f.literal);
          editar(e);
          continue;
        }
        edicoes.push({ ini: e.getStart(), fim: e.getEnd(), texto: call });
        editar(e);
      } else migrarRamos(e);
    }
  }

  /* ── 2b. frase passada pra confirm/alert/toast/setEstado ──────────────
     Dentro de componente o `t` alcança pela closure, e o texto chega na tela
     igual. Só frase (pareceTexto): `setStatus('enviando')` é estado, não copy,
     e trocá-lo por t() quebraria o `status === 'enviando'` de outro lugar. */
  const ehFrase = (r) => pareceTexto(Node.isTemplateExpression(r) ? r.getText().slice(1, -1).replace(/\$\{[^}]*\}/g, 'X') : r.getLiteralValue());
  const ehLiteral = (r) => Node.isStringLiteral(r) || Node.isNoSubstitutionTemplateLiteral(r) || Node.isTemplateExpression(r);
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!FUNCOES_DE_TEXTO.test(call.getExpression().getText())) continue;
    if (dentroConsumido(call) || !componenteDe(call)) continue;
    for (let arg of call.getArguments()) {
      arg = desembrulhar(arg);
      if (Node.isConditionalExpression(arg) && !pluralDe(arg)) {
        const ramos = [arg.getWhenTrue(), arg.getWhenFalse()].map(desembrulhar);
        if (ramos.some((r) => ehLiteral(r) && ehFrase(r)) && ramos.every((r) => !ehLiteral(r) || ehFrase(r))) migrarRamos(arg);
        continue;
      }
      if (!ehLiteral(arg) || !ehFrase(arg)) continue;
      const vars = new Map();
      const f = fragmento(arg, vars);
      if (f.erro) continue;
      const msg = montarIcu(f.partes);
      if (msg !== msg.trim() || ehMarca(msg)) continue;
      const c = chamada(arg, msg, vars);
      if (!c) continue;
      edicoes.push({ ini: arg.getStart(), fim: arg.getEnd(), texto: c });
      editar(arg);
    }
  }

  /* ── 3. o `t` de cada componente ────────────────────────────────────── */
  /* O recuo da linha onde a posição está (pra declaração nova cair alinhada). */
  const recuoDaLinha = (pos) => texto.slice(texto.lastIndexOf('\n', pos - 1) + 1).match(/^[ \t]*/)[0];
  for (const info of componentes.values()) {
    if (info.reuso) continue;
    const corpo = info.fn.getBody();
    const decl = `const ${info.nomeT} = ${info.async ? 'await getTranslations' : 'useTranslations'}('${ctx.ns}')${pontoVirgula ? ';' : ''}`;
    if (Node.isBlock(corpo)) {
      const primeiro = corpo.getStatements()[0];
      let ind = recuoDaLinha(info.fn.getStart()) + '  ';
      if (primeiro) {
        const pref = texto.slice(texto.lastIndexOf('\n', primeiro.getStart() - 1) + 1, primeiro.getStart());
        if (/^[ \t]*$/.test(pref)) ind = pref;
      }
      edicoes.push({ ini: corpo.getStart() + 1, fim: corpo.getStart() + 1, texto: `${eol}${ind}${decl}` });
    } else {
      const linhaFn = recuoDaLinha(info.fn.getStart());
      edicoes.push({ ini: corpo.getStart(), fim: corpo.getStart(), texto: `{${eol}${linhaFn}  ${decl}${eol}${linhaFn}  return ` });
      edicoes.push({ ini: corpo.getEnd(), fim: corpo.getEnd(), texto: `${eol}${linhaFn}}` });
    }
  }

  return { edicoes, migrados, imports, editados, eol, pontoVirgula };
}

/* ── strings que ficaram pra trás (só revisão) ─────────────────────────── */

/* Motivo, pelo lugar onde a string mora. É a mesma régua dos agentes de
   07/10: o que vem de lib/, de server action, de mapa compartilhado ou de
   condicional não óbvia NÃO é migrado por adivinhação. */
export function motivoDeLiteral(lit, { servidor, lib }) {
  if (lib) return 'Texto em lib/ (chega pronto na tela; migrar pede chave no lugar do texto e `t` em quem exibe)';
  const fnMeta = lit.getFirstAncestor((a) => (Node.isVariableDeclaration(a) && a.getName() === 'metadata') || (Node.isFunctionDeclaration(a) && a.getName() === 'generateMetadata'));
  if (fnMeta) return 'Título/descrição de aba (metadata): virar generateMetadata com getTranslations';
  if (lit.getFirstAncestor((a) => Node.isThrowStatement(a) || (Node.isNewExpression(a) && /Error$/.test(a.getExpression().getText())))) return 'Erro lançado (throw / new Error)';
  if (servidor) return 'Mensagem de servidor/action (volta pro cliente no retorno; namespace de erros)';
  if (lit.getFirstAncestor((a) => Node.isJsxExpression(a) || Node.isJsxAttribute(a))) return 'String condicional ou expressão no JSX que não é óbvia';
  if (!lit.getFirstAncestor(ehFuncao)) return 'Mapa ou constante no módulo (compartilhado): precisa de chave por item';
  if (lit.getFirstAncestor((a) => Node.isCallExpression(a))) return 'Texto passado pra função (toast, estado, confirm, helper)';
  return 'String solta dentro do componente (variável, objeto, retorno)';
}

/* Andador próprio, e não forEachDescendant: o `skip()` do ts-morph 28 num
   nó JSX encerrava a travessia inteira (medido em 08/10/2026), e a revisão
   saía vazia calada. `false` = não desce nos filhos. */
function andar(no, visita) {
  if (visita(no) === false) return;
  no.forEachChild((f) => andar(f, visita));
}

export function literaisSobrando(sf, editados) {
  const fora = [];
  andar(sf, (n) => {
    if (Node.isImportDeclaration(n) || Node.isExportDeclaration(n) || Node.isTypeNode(n)) return false;
    if (Node.isCallExpression(n)) {
      const c = n.getExpression().getText();
      if (FUNCOES_CLASSE.has(c) || /^console./.test(c) || c === 'require' || n.getExpression().getKind() === SyntaxKind.ImportKeyword) return false;
    }
    if (Node.isJsxAttribute(n) && CHAVES_TECNICAS.test(n.getNameNode().getText())) return false;
    if (Node.isPropertyAssignment(n) && CHAVES_TECNICAS.test(n.getName().replace(/['"]/g, ''))) return false;
    if (Node.isElementAccessExpression(n)) return false;
    if (!(Node.isStringLiteral(n) || Node.isNoSubstitutionTemplateLiteral(n) || Node.isTemplateExpression(n))) return true;
    if (editados.has(n.getStart() + ':' + n.getEnd())) return false;
    const p = n.getParent();
    if (Node.isExpressionStatement(p)) return true; // 'use client'
    if (Node.isPropertyAssignment(p) && p.getNameNode() === n) return true;
    if (Node.isCaseClause(p) || (Node.isBinaryExpression(p) && ['===', '!==', '==', '!='].includes(p.getOperatorToken().getText()))) return true;
    const valor = Node.isTemplateExpression(n) ? n.getText().slice(1, -1).replace(/${[^}]*}/g, 'X') : n.getLiteralValue();
    if (!pareceTexto(valor)) return true;
    fora.push(n);
    return !Node.isTemplateExpression(n);
  });
  return fora;
}
