/* Peças puras do `migrar`: como o JSX transforma texto, como o texto vira
 * chave, e quando uma string "parece copy". Nada aqui lê disco nem AST.
 */

/* Espaço em branco do JSX, o mesmo algoritmo do Babel
 * (cleanJSXElementLiteralChild) e do TypeScript: linha só de espaço some, as
 * bordas de cada linha são aparadas (menos a borda de fora da primeira e da
 * última), e as linhas que sobram se juntam com UM espaço. É o texto que o
 * React renderiza; é ele que vai pro JSON, senão o "texto idêntico" mentiria. */
export function limparJsxText(cru) {
  const linhas = cru.split(/\r\n|\n|\r/);
  let ultimaCheia = 0; // o Babel começa em 0: linha só de espaço vale como "a última"
  linhas.forEach((l, i) => {
    if (/[^ \t]/.test(l)) ultimaCheia = i;
  });
  let saida = '';
  linhas.forEach((linha, i) => {
    let l = linha.replace(/\t/g, ' ');
    if (i !== 0) l = l.replace(/^[ ]+/, '');
    if (i !== linhas.length - 1) l = l.replace(/[ ]+$/, '');
    if (l) {
      if (i !== ultimaCheia) l += ' ';
      saida += l;
    }
  });
  return saida;
}

/* Entidade HTML no JSX (texto e atributo entre aspas) é decodificada pelo
   compilador; no JSON tem que ir o caractere, senão o editor mostra `&nbsp;`. */
const ENTIDADES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", hellip: '…', mdash: '—', ndash: '–', copy: '©', middot: '·', rarr: '→', larr: '←' };
export function decodificar(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (todo, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : todo;
    }
    return ENTIDADES[e.toLowerCase()] ?? todo;
  });
}

const semAcento = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/* Nome da chave a partir do texto: as primeiras palavras em camelCase, sem
   acento ("Fora da estante" → foraDaEstante). É o que os agentes faziam à mão
   na maioria das chaves curtas, e é legível no painel do editor. */
export function slug(texto, max = 4) {
  const palavras = semAcento(texto)
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, max);
  if (!palavras.length) return 'texto';
  const s = palavras.map((p, i) => (i === 0 ? p.toLowerCase() : p[0].toUpperCase() + p.slice(1).toLowerCase())).join('');
  return /^\d/.test(s) ? 'n' + s : s;
}

/* camelCase de um pedaço de caminho ou nome de arquivo (`bem-vindo` → bemVindo). */
export function camel(s) {
  const p = semAcento(String(s)).split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!p.length) return '';
  const r = p.map((w, i) => (i === 0 ? w[0].toLowerCase() + w.slice(1) : w[0].toUpperCase() + w.slice(1))).join('');
  return /^\d/.test(r) ? 'n' + r : r;
}

export const temLetra = (s) => /\p{L}/u.test(s);

/* URL, e-mail, caminho: não é copy, é dado. */
export const ehDado = (s) => {
  const t = s.trim();
  return /^(https?:\/\/|mailto:|tel:|www\.)/i.test(t) || /^[\w.+-]+@[\w-]+\.[\w.]+$/.test(t) || /^\/[\w\-/.]*$/.test(t);
};

/* Lista de className do Tailwind (e afins): tudo minúsculo, sem acento, e a
   maioria dos pedaços com hífen, dois-pontos, barra ou colchete. */
function pareceClasse(t) {
  if (/[A-ZÀ-Ý]/.test(t) || /[à-ÿ]/.test(t)) return false;
  const p = t.split(/\s+/);
  const tecnicos = p.filter((w) => /[-:/[\]]/.test(w) || /^(flex|grid|block|hidden|inline|relative|absolute|fixed|sticky|truncate|underline|italic|uppercase|lowercase|capitalize|group|peer|container|prose|border|rounded|shadow|toque|toque-claro)$/.test(w));
  return tecnicos.length * 2 >= p.length;
}

/* "Parece copy" para string SOLTA (fora do JSX), que nunca é migrada, só
   listada pra revisão. Tem que errar pro lado de calar: lista que acusa
   className e chave de banco treina a pessoa a ignorar a lista. */
export function pareceTexto(s) {
  const t = s.trim();
  if (t.length < 3 || !temLetra(t) || ehDado(t)) return false;
  if (/[{}<>`\\]/.test(t)) return false; // código, regex, HTML
  if (/^\s*(select|insert|update|delete|with|create|alter|drop)\s/i.test(t)) return false;
  if (/::|\(\*\)|\bwhere\b|\s=\s'/i.test(t)) return false; // SQL no meio da string
  if (/^[\w.-]+$/.test(t) && !/[à-ÿÀ-Ý]/.test(t)) return false; // identificador, slug, chave
  if (pareceClasse(t)) return false;
  const palavras = t.split(/\s+/);
  const acento = /[à-ÿÀ-Ý]/.test(t);
  if (palavras.length < 2 && !acento) return false;
  return /^[\p{Lu}"“(¿¡]/u.test(t) || acento || palavras.length >= 3 || /[.?!…:]$/.test(t);
}

/* Pedaço literal dentro de mensagem ICU. Chave aberta ou tag não tem escape
   seguro (o texto viraria outra coisa), então quem chama manda pra revisão.
   O apóstrofo só é especial colado em `{`, `}` e (no plural) `#`: dobramos só
   ali, pra o JSON continuar com o texto que a pessoa escreveu. */
export function icuLiteralInseguro(s) {
  return /[{}<]/.test(s);
}

export function montarIcu(partes) {
  /* partes: [{ tipo:'lit', valor } | { tipo:'raw', valor }] — 'raw' já é ICU. */
  let out = '';
  partes.forEach((p, i) => {
    if (p.tipo === 'raw') {
      out += p.valor;
      return;
    }
    let v = p.dentroDePlural ? p.valor.replace(/#/g, "'#'") : p.valor;
    const prox = partes[i + 1];
    if (v.endsWith("'") && prox && prox.tipo === 'raw') v += "'";
    out += v;
  });
  return out;
}

/* O texto de fora das chaves ICU, pra dar nome à chave ("Hoje {n, plural...}
   na estante" → "Hoje na estante"). Mensagem que é só plural usa o ramo
   `other` ("{n} {n, plural, =1 {aula} other {aulas}}" → "aulas"). */
export function slugDeIcu(msg) {
  let fora = '';
  let prof = 0;
  for (const c of msg) {
    if (c === '{') prof++;
    else if (c === '}') prof = Math.max(0, prof - 1);
    else if (prof === 0) fora += c;
  }
  fora = fora.replace(/<\/?[A-Za-z0-9]+>/g, ' ');
  if (/[A-Za-zÀ-ÿ]/.test(fora)) return slug(fora);
  const outro = msg.match(/other \{([^{}]*)/);
  return outro && /[A-Za-zÀ-ÿ]/.test(outro[1]) ? slug(outro[1]) : 'texto';
}
