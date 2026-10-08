/* Nome da chave pelo PAPEL do elemento, antes das palavras. Regra simples,
 * sem IA: o que o elemento é (título, botão, campo, estado vazio, aviso)
 * decide o nome; as primeiras palavras do texto ficam só de reserva.
 *
 *   h1                         → titulo
 *   h2/h3                      → subtitulo, ou <secao>.titulo se a seção tem id
 *   p/span logo após o título  → sub (ou <secao>.sub)
 *   texto de botão/link        → o verbo (salvar, enviar, voltar) ou acao
 *   label de campo             → <campo>.rotulo
 *   alt / placeholder          → <nome>.alt / <campo>.placeholder
 *   aria-label                 → <nome>.rotulo
 *   estado vazio               → vazio.titulo / vazio.sub
 *   confirm/alert/toast        → aviso.<verbo>
 *
 * `candidatos` devolve os caminhos em ordem de preferência; quem grava
 * (Mensagens.chave) usa o primeiro livre e, se todos estiverem ocupados com
 * outro texto, cai na regra antiga (primeiras palavras) com sufixo numérico.
 */
import { Node } from 'ts-morph';
import { camel, slug, verboDe } from './texto.mjs';

const tagDe = (el) =>
  Node.isJsxElement(el) ? el.getOpeningElement().getTagNameNode().getText() : Node.isJsxSelfClosingElement(el) ? el.getTagNameNode().getText() : '';
const abertura = (el) => (Node.isJsxElement(el) ? el.getOpeningElement() : Node.isJsxSelfClosingElement(el) ? el : null);
const ehElemento = (n) => Node.isJsxElement(n) || Node.isJsxSelfClosingElement(n);

/* Valor literal de um atributo (`id="email"`, `id={'email'}`), ou null. */
function attrLiteral(el, nome) {
  const ab = abertura(el);
  const a = ab?.getAttribute?.(nome);
  if (!a || !Node.isJsxAttribute(a)) return null;
  let i = a.getInitializer();
  if (i && Node.isJsxExpression(i)) i = i.getExpression();
  return i && (Node.isStringLiteral(i) || Node.isNoSubstitutionTemplateLiteral(i)) ? i.getLiteralValue() : null;
}

const BOTAO = /^(button|a|summary|Link|NextLink|Button|Botao|[A-Z]\w*(Button|Botao|Link))$/;
const ehBotao = (el) => BOTAO.test(tagDe(el));
const TITULO = /^h[1-6]$/;
const CAMPO = new Set(['input', 'textarea', 'select']);
const VAZIO = /vazio|vazia|empty/i;
const SECAO = new Set(['section', 'article', 'aside', 'fieldset']);

/* O nome do campo: id, name ou htmlFor; busca pelo tipo; senão `campo`. */
function nomeDoCampo(el) {
  const proprio = attrLiteral(el, 'id') || attrLiteral(el, 'name') || attrLiteral(el, 'htmlFor');
  if (proprio && camel(proprio)) return camel(proprio);
  if (attrLiteral(el, 'type') === 'search' || attrLiteral(el, 'role') === 'search') return 'busca';
  /* <label>Nome <input name="nome" /></label>: o campo de dentro dá o nome. */
  if (Node.isJsxElement(el)) {
    const dentro = el.getDescendants().find((d) => ehElemento(d) && CAMPO.has(tagDe(d)));
    if (dentro) return nomeDoCampo(dentro);
  }
  return null;
}

/* Elemento que separa blocos, pra subir até ele e achar o contexto. */
function ancestrais(no) {
  const out = [];
  for (let a = no; a; a = a.getParent()) if (ehElemento(a)) out.push(a);
  return out;
}

/* Estado vazio: dentro de algo chamado Vazio/Empty (tag, className ou o
   componente), ou o próprio texto diz "nenhum" / "ainda não". */
function ehVazio(no, msg) {
  if (/\bnenhum(a|as|os)?\b|\bainda não\b/i.test(msg)) return true;
  for (const a of ancestrais(no)) {
    if (VAZIO.test(tagDe(a))) return true;
    const cls = attrLiteral(a, 'className');
    if (cls && /(^|[\s-])(vazio|vazia|empty)(\b|-)/i.test(cls)) return true;
  }
  for (let a = no.getParent(); a; a = a.getParent()) {
    if (Node.isFunctionDeclaration(a) || Node.isFunctionExpression(a) || Node.isArrowFunction(a)) {
      const nome = Node.isFunctionDeclaration(a) ? a.getName() : Node.isVariableDeclaration(a.getParent()) ? a.getParent().getName() : '';
      if (nome && /^[A-Z]/.test(nome) && VAZIO.test(nome)) return true;
    }
  }
  return false;
}

/* O irmão anterior que é elemento (pula espaço e comentário JSX). */
function irmaoAnterior(el) {
  const pai = el.getParent();
  if (!Node.isJsxElement(pai) && !Node.isJsxFragment(pai)) return null;
  const filhos = pai.getJsxChildren();
  for (let i = filhos.indexOf(el) - 1; i >= 0; i--) {
    const f = filhos[i];
    if (Node.isJsxText(f) && !/\S/.test(f.getText())) continue;
    if (Node.isJsxExpression(f) && !f.getExpression()) continue;
    return ehElemento(f) ? f : null;
  }
  return null;
}

/* Prefixo de um título: h1 e h2 soltos não têm; h2/h3 com id próprio ou
   dentro de <section id> viram `<secao>.`. */
function secaoDoTitulo(h) {
  if (tagDe(h) === 'h1') return '';
  const id = attrLiteral(h, 'id');
  if (id && camel(id)) return camel(id);
  for (const a of ancestrais(h).slice(1)) {
    if (!SECAO.has(tagDe(a))) continue;
    const sid = attrLiteral(a, 'id') || attrLiteral(a, 'aria-label');
    return sid && camel(sid) ? camel(sid) : '';
  }
  return '';
}

const comPrefixo = (p, folha) => (p ? `${p}.${folha}` : folha);

/* Texto de dentro de um elemento (filho de JSX, ou ramo de condicional). */
function porElemento(el, msg) {
  const tag = tagDe(el);
  /* Botão/link: o elemento ou o pai imediato (<button><span>Salvar</span>). */
  const pai = ancestrais(el)[1];
  if (ehBotao(el) || (pai && ehBotao(pai) && !TITULO.test(tag))) {
    return [verboDe(msg) || 'acao'];
  }
  const anterior = irmaoAnterior(el);
  if (ehVazio(el, msg)) {
    if (TITULO.test(tag) || tag === 'strong') return ['vazio.titulo', 'vazio.sub'];
    if (anterior && (TITULO.test(tagDe(anterior)) || tagDe(anterior) === 'strong')) return ['vazio.sub'];
    return ['vazio.titulo', 'vazio.sub'];
  }
  if (tag === 'h1') return ['titulo'];
  if (TITULO.test(tag)) {
    const s = secaoDoTitulo(el);
    return s ? [`${s}.titulo`] : ['subtitulo'];
  }
  if (tag === 'label' || tag === 'legend') {
    const c = nomeDoCampo(el);
    return [comPrefixo(c || 'campo', 'rotulo')];
  }
  if (['p', 'span', 'small', 'div'].includes(tag) && anterior && TITULO.test(tagDe(anterior))) {
    return [comPrefixo(secaoDoTitulo(anterior), 'sub')];
  }
  return [];
}

/* Nome do dono de um alt/aria-label: id/name; senão o papel. */
function nomeDoDono(el, valor) {
  const proprio = attrLiteral(el, 'id') || attrLiteral(el, 'name');
  if (proprio && camel(proprio)) return camel(proprio);
  if (ehBotao(el)) return verboDe(valor) || 'acao';
  const tag = tagDe(el);
  if (CAMPO.has(tag)) return nomeDoCampo(el) || 'campo';
  if (tag === 'nav') return 'menu';
  return null;
}

/* Prop de componente (não HTML) → papel. */
const PROP_PAPEL = {
  titulo: 'titulo', title: 'titulo', heading: 'titulo',
  subtitulo: 'sub', subtitle: 'sub', descricao: 'sub', description: 'sub', texto: 'sub', text: 'sub', mensagem: 'sub',
  rotulo: 'rotulo', label: 'rotulo', ariaLabel: 'rotulo', 'aria-label': 'rotulo',
  placeholder: 'placeholder', alt: 'alt',
};

function porAtributo(attr, msg) {
  const nome = attr.getNameNode().getText();
  const dono = attr.getParent().getParent();
  const tag = Node.isJsxOpeningElement(dono) || Node.isJsxSelfClosingElement(dono) ? dono.getTagNameNode().getText() : '';
  const el = Node.isJsxOpeningElement(dono) ? dono.getParent() : dono;
  const intrinseco = /^[a-z]/.test(tag) && !tag.includes('.');
  if (!intrinseco) {
    const papel = PROP_PAPEL[nome];
    if (!papel) return [];
    if (BOTAO.test(tag) && (papel === 'rotulo' || papel === 'sub')) return [verboDe(msg) || 'acao'];
    if (VAZIO.test(tag) || (papel !== 'placeholder' && ehVazio(el, msg))) return [`vazio.${papel}`];
    const base = camel(tag.split('.').pop());
    return base ? [`${base}.${papel}`] : [];
  }
  if (nome === 'placeholder') return [comPrefixo(nomeDoCampo(el) || 'campo', 'placeholder')];
  if (nome === 'alt') {
    if (ehVazio(el, '')) return ['vazio.alt'];
    const proprio = attrLiteral(el, 'id') || attrLiteral(el, 'name');
    const src = attrLiteral(el, 'src');
    const doArquivo = src && camel(src.split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/@.*$/, ''));
    return [comPrefixo(camel(proprio || '') || doArquivo || 'imagem', 'alt')];
  }
  if (nome === 'aria-label') {
    const n = nomeDoDono(el, msg);
    return [n ? `${n}.rotulo` : 'rotulo'];
  }
  return [];
}

/* Frase de confirm/alert/prompt/toast → aviso.<verbo>. */
const AVISO = /^((window\.)?(confirm|alert|prompt)|toast(\.\w+)?)$/;

export function candidatos(no, msg) {
  for (let a = no; a; a = a.getParent()) {
    if (Node.isJsxAttribute(a)) return porAtributo(a, msg);
    if (Node.isCallExpression(a)) {
      if (AVISO.test(a.getExpression().getText())) return [`aviso.${verboDe(msg) || slug(msg, 2)}`];
      return [];
    }
    if (Node.isJsxElement(a) || Node.isJsxSelfClosingElement(a)) return porElemento(a, msg);
    if (Node.isJsxFragment(a)) return [];
  }
  return [];
}
