/* Arquivo de idioma que exporta OBJETO: `locales/pt-br.ts` (`export const
 * messages = {...}`, `export default {...}`) e o JSON do i18next
 * (`public/locales/en/common.json`). É onde mora a copy de um repo que já tem
 * i18n próprio, e o editor trabalha EM CIMA dele, sem converter pra next-intl.
 *
 * POR QUE O PARSER DO TYPESCRIPT, E NÃO `import()` + JSON.stringify
 *
 * Gravar = trocar SÓ o literal daquela chave, e o diff tem que ser de uma linha.
 * Reescrever o objeto inteiro apaga comentário, ordem, aspas e a quebra de
 * linha que o dono escolheu (o `locales/en.ts` do board tem comentário explicando
 * por que "Club" não traduz). Com a árvore do compilador cada folha sabe onde
 * começa e termina no texto, e a edição é um corte cirúrgico naquela posição.
 * O mesmo parser lê JSON (`ts.parseJsonText`), então TS e JSON passam pelo
 * mesmo código. É o `typescript` que o ts-morph já traz: nenhuma dependência nova.
 *
 * O que vira chave: string literal e template SEM `${}`. Template com
 * expressão, identificador, spread e chamada aparecem como "não é literal" e o
 * editor recusa gravar neles (quem escreve código ali é gente, não a barra).
 * Array entra pelo índice (`servicos.categorias.0.itens.3`).
 *
 * Nada aqui grava em disco: recebe texto, devolve texto. Quem grava é o adapter
 * (com a guarda de escrita cega) ou o migrar (com o snapshot pra desfazer).
 */
import { ts } from 'ts-morph';

export const tipoDe = (arq) => (/\.json$/i.test(arq) ? 'json' : 'ts');

function parse(texto, arq) {
  if (tipoDe(arq) === 'json') return ts.parseJsonText(arq, texto);
  const kind = /\.tsx$/.test(arq) ? ts.ScriptKind.TSX : /\.(m|c)?jsx?$/.test(arq) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(arq, texto, ts.ScriptTarget.Latest, true, kind);
}

const desembrulhar = (e) => {
  while (
    e &&
    (ts.isAsExpression(e) ||
      (ts.isSatisfiesExpression && ts.isSatisfiesExpression(e)) ||
      ts.isParenthesizedExpression(e) ||
      ts.isTypeAssertionExpression(e))
  )
    e = e.expression;
  return e;
};

const exportado = (st) => !!st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/* Os objetos que o arquivo exporta: [{ nome, obj }]. `nome` é o do export
   (`messages`, `default`). `export default X` com X declarado no arquivo resolve
   pra declaração; `module.exports = {}` conta como default. */
function objetosExportados(sf) {
  const locais = new Map();
  const achados = [];
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      const ini = desembrulhar(d.initializer);
      if (!ts.isIdentifier(d.name) || !ini || !ts.isObjectLiteralExpression(ini)) continue;
      locais.set(d.name.text, ini);
      if (exportado(st)) achados.push({ nome: d.name.text, obj: ini });
    }
  }
  for (const st of sf.statements) {
    if (ts.isExportAssignment(st)) {
      const e = desembrulhar(st.expression);
      if (ts.isObjectLiteralExpression(e)) achados.push({ nome: 'default', obj: e });
      else if (ts.isIdentifier(e) && locais.has(e.text)) achados.push({ nome: 'default', obj: locais.get(e.text) });
    } else if (ts.isExpressionStatement(st) && ts.isBinaryExpression(st.expression)) {
      const b = st.expression;
      const dir = desembrulhar(b.right);
      if (b.left.getText(sf) === 'module.exports' && dir && ts.isObjectLiteralExpression(dir)) achados.push({ nome: 'default', obj: dir });
    } else if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      /* `const messages = {...}; export { messages }` */
      for (const el of st.exportClause.elements) {
        const local = (el.propertyName || el.name).text;
        if (locais.has(local)) achados.push({ nome: el.name.text, obj: locais.get(local) });
      }
    }
  }
  return achados;
}

function raizDe(sf, arq, exportar) {
  if (tipoDe(arq) === 'json') {
    const e = sf.statements[0]?.expression;
    return e && ts.isObjectLiteralExpression(e) ? { nome: null, obj: e } : null;
  }
  const todos = objetosExportados(sf);
  if (exportar) return todos.find((x) => x.nome === exportar) || null;
  return todos.find((x) => x.nome === 'default') || todos[0] || null;
}

function nomeDaProp(p, sf) {
  const n = p.name;
  if (!n) return null;
  if (ts.isIdentifier(n) || ts.isPrivateIdentifier?.(n)) return n.text;
  if (ts.isStringLiteral(n) || ts.isNumericLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  return null; // [computada]: não é chave estável
}

/**
 * Lê o objeto e devolve:
 *   folhas      Map(chave → { valor, no })     só as editáveis (literal)
 *   naoLiterais Set(chave)                     existem, mas não são texto literal
 *   objetos     Map(caminho → nó objeto|array) '' é a raiz
 *   arvore      o objeto puro (strings, objetos, arrays), pro lint e o migrar
 */
export function lerObjeto(texto, arq, { exportar } = {}) {
  const sf = parse(texto, arq);
  const raiz = raizDe(sf, arq, exportar);
  if (!raiz) return { erro: `${arq} não exporta um objeto literal${exportar ? ` chamado \`${exportar}\`` : ''}` };
  const folhas = new Map();
  const naoLiterais = new Set();
  const objetos = new Map();
  const juntar = (p, k) => (p ? `${p}.${k}` : String(k));

  function andar(no, caminho) {
    objetos.set(caminho, no);
    if (ts.isArrayLiteralExpression(no)) {
      const arr = [];
      no.elements.forEach((el, i) => (arr[i] = valorDe(desembrulhar(el), juntar(caminho, i))));
      return arr;
    }
    const obj = {};
    for (const p of no.properties) {
      if (!ts.isPropertyAssignment(p)) continue; // spread, método, shorthand: não é copy editável
      const k = nomeDaProp(p, sf);
      if (k === null) continue;
      const v = valorDe(desembrulhar(p.initializer), juntar(caminho, k));
      if (v !== undefined) obj[k] = v;
    }
    return obj;
  }
  function valorDe(v, chave) {
    if (!v) return undefined;
    if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) {
      folhas.set(chave, { valor: v.text, no: v });
      return v.text;
    }
    if (ts.isObjectLiteralExpression(v) || ts.isArrayLiteralExpression(v)) return andar(v, chave);
    naoLiterais.add(chave);
    return undefined;
  }

  const arvore = andar(raiz.obj, '');
  return { sf, raiz: raiz.obj, nomeExport: raiz.nome, folhas, naoLiterais, objetos, arvore };
}

/* ── literal ──────────────────────────────────────────────────────────────
   O valor novo sai com as MESMAS aspas do literal que ele substitui, e quebra
   de linha vira `\n`: o diff fica numa linha só e o arquivo não muda de estilo. */
const CONTROLE = /[\u0000-\u001f\u2028\u2029]/g;
const escControle = (c) =>
  ({ '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f', '\v': '\\v' })[c] ||
  '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');

export function literal(valor, aspas, tipo) {
  if (tipo === 'json') return JSON.stringify(valor);
  let s = String(valor).replace(/\\/g, '\\\\').replace(CONTROLE, escControle);
  if (aspas === '`') s = s.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  else s = s.split(aspas).join('\\' + aspas);
  return aspas + s + aspas;
}

const ehIdent = (k) => /^[A-Za-z_$][\w$]*$/.test(k);

/* Aspas da casa: as que o arquivo mais usa nas folhas (o board usa "). */
function aspasDoArquivo(texto, lido) {
  let duplas = 0;
  let simples = 0;
  for (const { no } of lido.folhas.values()) {
    const c = texto[no.getStart(lido.sf)];
    if (c === '"') duplas++;
    else if (c === "'") simples++;
  }
  return duplas >= simples && duplas > 0 ? '"' : simples > 0 ? "'" : '"';
}

/**
 * Troca o valor de UMA chave que já existe. Devolve { texto, anterior } ou
 * { erro }. `antes` é o valor que a tela tinha (guarda de escrita cega, quem
 * compara é o chamador via `guarda`), `undefined` pula (desfazer).
 */
export function trocarValor(texto, arq, chave, valor, { exportar, guarda } = {}) {
  const lido = lerObjeto(texto, arq, { exportar });
  if (lido.erro) return { erro: lido.erro };
  const f = lido.folhas.get(chave);
  if (!f) {
    if (lido.naoLiterais.has(chave)) return { erro: `"${chave}" em ${arq} não é texto literal (é código: template com \${}, variável ou chamada); edite à mão` };
    return { erro: `chave "${chave}" não existe em ${arq}` };
  }
  if (guarda) {
    const erro = guarda(f.valor);
    if (erro) return { erro };
  }
  const ini = f.no.getStart(lido.sf);
  const fim = f.no.getEnd();
  const aspas = tipoDe(arq) === 'json' ? '"' : texto[ini];
  return { texto: texto.slice(0, ini) + literal(valor, aspas, tipoDe(arq)) + texto.slice(fim), anterior: f.valor };
}

/* Recuo da linha onde a posição está. */
const recuoEm = (texto, pos) => texto.slice(texto.lastIndexOf('\n', pos - 1) + 1).match(/^[ \t]*/)[0];

/**
 * Acrescenta chaves NOVAS (nunca sobrescreve). `pares` = [[chave, valor]].
 * Chave que já existe com o mesmo texto é ignorada; com outro texto, ou cujo
 * caminho bate num texto/array, vai pra `conflitos`. Uma inserção por objeto
 * que já existe, todas de trás pra frente: um parse só, por maior que seja a lista.
 *
 * Devolve { texto, inseridas: [chave], conflitos: [{ chave, motivo }], linhas: Map(chave → linha) }.
 */
export function inserirChaves(texto, arq, pares, { exportar } = {}) {
  const tipo = tipoDe(arq);
  const lido = lerObjeto(texto, arq, { exportar });
  if (lido.erro) return { erro: lido.erro };
  const eol = texto.includes('\r\n') ? '\r\n' : '\n';
  const aspas = aspasDoArquivo(texto, lido);
  const conflitos = [];
  const inseridas = [];
  /* objeto existente (caminho) → árvore do que entra nele */
  const planos = new Map();

  for (const [chave, valor] of pares) {
    const segs = chave.split('.');
    let i = segs.length;
    /* o objeto existente mais fundo do caminho */
    while (i > 0 && !lido.objetos.has(segs.slice(0, i).join('.'))) i--;
    const existente = segs.slice(0, i).join('.');
    if (i === segs.length) {
      conflitos.push({ chave, motivo: 'o caminho já é um objeto/array, não um texto' });
      continue;
    }
    if (lido.folhas.has(chave)) {
      if (lido.folhas.get(chave).valor !== valor) conflitos.push({ chave, motivo: `já existe com outro texto: ${JSON.stringify(lido.folhas.get(chave).valor)}` });
      continue;
    }
    const prox = segs.slice(0, i + 1).join('.');
    if (lido.folhas.has(prox) || lido.naoLiterais.has(prox) || ts.isArrayLiteralExpression(lido.objetos.get(existente))) {
      conflitos.push({ chave, motivo: `"${ts.isArrayLiteralExpression(lido.objetos.get(existente)) ? existente : prox}" já existe e não é objeto` });
      continue;
    }
    if (!planos.has(existente)) planos.set(existente, {});
    let no = planos.get(existente);
    let ok = true;
    for (const s of segs.slice(i, -1)) {
      if (typeof no[s] === 'string') {
        ok = false;
        break;
      }
      no = no[s] ??= {};
    }
    const folha = segs.at(-1);
    if (!ok || (no[folha] !== undefined && no[folha] !== valor)) {
      conflitos.push({ chave, motivo: 'duas chaves novas no mesmo caminho' });
      continue;
    }
    no[folha] = valor;
    inseridas.push(chave);
  }

  /* unidade de recuo: a da 1ª propriedade da raiz menos o recuo da raiz */
  const p0 = lido.raiz.properties[0];
  const unidade = p0 ? recuoEm(texto, p0.getStart(lido.sf)).slice(recuoEm(texto, lido.raiz.getStart(lido.sf)).length) || '  ' : '  ';
  const nomeK = (k) => (tipo === 'json' ? JSON.stringify(k) : ehIdent(k) ? k : literal(k, aspas, 'ts'));
  const lit = (v) => literal(v, aspas, tipo);
  const bloco = (arvore, rec, virgulaFinal) =>
    Object.entries(arvore)
      .map(([k, v]) =>
        typeof v === 'string'
          ? `${rec}${nomeK(k)}: ${lit(v)}`
          : `${rec}${nomeK(k)}: {${eol}${bloco(v, rec + unidade, virgulaFinal)}${virgulaFinal ? ',' : ''}${eol}${rec}}`
      )
      .join(',' + eol);

  const edicoes = [];
  for (const [caminho, arvore] of planos) {
    const obj = lido.objetos.get(caminho);
    const props = obj.properties;
    const recObj = recuoEm(texto, obj.getStart(lido.sf));
    const virgulaFinal = tipo !== 'json' && (props.length ? !!props.hasTrailingComma : true);
    if (props.length) {
      const ult = props[props.length - 1];
      const rec = recuoEm(texto, ult.getStart(lido.sf));
      if (props.hasTrailingComma) {
        const v = texto.indexOf(',', ult.getEnd());
        edicoes.push({ pos: v + 1, txt: eol + bloco(arvore, rec, virgulaFinal) + ',' });
      } else edicoes.push({ pos: ult.getEnd(), txt: ',' + eol + bloco(arvore, rec, virgulaFinal) });
    } else {
      /* `{}`: abre por dentro */
      const abre = obj.getStart(lido.sf) + 1;
      const fecha = obj.getEnd() - 1;
      edicoes.push({ pos: abre, fim: fecha, txt: eol + bloco(arvore, recObj + unidade, virgulaFinal) + (virgulaFinal ? ',' : '') + eol + recObj });
    }
  }
  let out = texto;
  for (const e of edicoes.sort((a, b) => b.pos - a.pos)) out = out.slice(0, e.pos) + e.txt + out.slice(e.fim ?? e.pos);

  /* A linha de cada chave nova, pra revisão apontar arquivo:linha. */
  const linhas = new Map();
  if (inseridas.length) {
    const depois = lerObjeto(out, arq, { exportar });
    if (depois.erro) return { erro: `a inserção quebrou ${arq}: ${depois.erro}` };
    for (const k of inseridas) {
      const f = depois.folhas.get(k);
      if (f) linhas.set(k, depois.sf.getLineAndCharacterOfPosition(f.no.getStart(depois.sf)).line + 1);
    }
  }
  return { texto: out, inseridas, conflitos, linhas };
}

/* Chave → valor de todas as folhas literais (o painel da barra). */
export const achatar = (lido) => Object.fromEntries([...lido.folhas].map(([k, f]) => [k, f.valor]));
