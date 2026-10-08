/* A chave na tela, num repo com i18n PRÓPRIO (objeto de mensagens, i18next).
 *
 * O editor acha o texto clicado pela chave escondida no próprio texto
 * (@vercel/stega), como no next-intl. A diferença: aqui quem carrega as
 * mensagens é o provider DO REPO (no board, o `context/i18n-context.tsx`), e o
 * payload leva também o idioma (`l`), porque o mesmo `common.home` mora em
 * `locales/pt-br.ts` E em `locales/en.ts`, e o servidor precisa saber em qual
 * gravar.
 *
 * POR QUE O REPO GANHA UMA CÓPIA, E NÃO UM IMPORT DO PACOTE
 *
 * Este pacote é privado e não entra no package.json de site nenhum: a Vercel
 * não lê repo privado e o `npm install` do deploy cairia. Então o trecho que
 * roda no site é ARQUIVO DO REPO (`copy-edit ligar` escreve), e só depende do
 * `@vercel/stega`, que é público. São 20 linhas que não mudam; o teste do
 * pacote transpila o trecho e confere que ele marca igual ao `marcarMensagens`
 * daqui, então as duas versões não se separam caladas.
 *
 * Fora do editor o trecho devolve o objeto intacto: a guarda é
 * `NEXT_PUBLIC_COPY_EDIT=1` (que só o `copy-edit` liga) E não-produção. O
 * `NEXT_PUBLIC_` é porque o provider é client: variável sem esse prefixo não
 * chega no bundle do browser, e o servidor marcaria o HTML que o browser
 * desmarcaria na hidratação (mismatch em todo texto).
 */
import { vercelStegaCombine } from '@vercel/stega';

/* Deep map: string vira string + {k, l} invisível; array entra pelo índice;
   número, função e o resto passam como estão. O `skip` padrão do stega
   ('auto') já deixa URL e data limpas: texto que vira href não quebra o link. */
export function marcarMensagens(obj, { locale, prefixo = '' } = {}) {
  const andar = (v, k) =>
    typeof v === 'string'
      ? vercelStegaCombine(v, { k, l: locale })
      : Array.isArray(v)
        ? v.map((x, i) => andar(x, k ? `${k}.${i}` : String(i)))
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([c, x]) => [c, andar(x, k ? `${k}.${c}` : c)]))
          : v;
  return andar(obj, prefixo);
}

/* Mapa idioma → mensagens, cada um marcado com o próprio idioma. É a forma do
   board (`{ en, 'pt-br' }`) e dos `resources` do i18next (`{ en: { common } }`,
   onde a 1ª parte da chave vira o namespace). */
export const marcarLocales = (mapa) =>
  Object.fromEntries(Object.entries(mapa).map(([l, m]) => [l, marcarMensagens(m, { locale: l })]));

/* O arquivo que o repo ganha (`copy-edit ligar`). TS de propósito: os repos são
   TS, e o tipo `T` sai igual ao que entrou, então o `typeof ptBrMessages` do
   board continua valendo. */
export const TRECHO_TS = `/* Escrito pelo \`copy-edit ligar\` (@visant/copy-edit). Não edite: o pacote
   confere este trecho contra a versão dele.

   Com o editor local ligado (\`npm run copy:edit\` liga NEXT_PUBLIC_COPY_EDIT=1, e
   só em dev), cada texto sai com a própria chave e o idioma escondidos em
   caractere invisível (@vercel/stega). A ponte do editor lê de volta pra saber
   o que a pessoa clicou e em qual arquivo de idioma gravar. Fora do editor
   devolve o objeto intacto. */
import { vercelStegaCombine } from '@vercel/stega'

const LIGADO = process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_COPY_EDIT === '1'

export function marcarMensagens<T>(obj: T, { locale, prefixo = '' }: { locale: string; prefixo?: string }): T {
  if (!LIGADO) return obj
  const andar = (v: unknown, k: string): unknown =>
    typeof v === 'string'
      ? vercelStegaCombine(v, { k, l: locale })
      : Array.isArray(v)
        ? v.map((x, i) => andar(x, k ? \`\${k}.\${i}\` : String(i)))
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([c, x]) => [c, andar(x, k ? \`\${k}.\${c}\` : c)]))
          : v
  return andar(obj, prefixo) as T
}

export function marcarLocales<T extends Record<string, unknown>>(mapa: T): T {
  if (!LIGADO) return mapa
  return Object.fromEntries(Object.entries(mapa).map(([l, m]) => [l, marcarMensagens(m, { locale: l })])) as T
}
`;
