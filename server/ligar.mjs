/* `copy-edit ligar`: num repo com i18n próprio, escreve o trecho que esconde a
 * chave no texto (server/marcar.mjs, TRECHO_TS) e diz o que falta ligar à mão.
 *
 * Escreve UM arquivo, novo, e nada mais. O provider, o next.config e o layout
 * são código do dono e cada repo tem o seu jeito; editar isso por regex é o tipo
 * de mágica que quebra calado. O texto devolvido diz a linha exata.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TRECHO_TS } from './marcar.mjs';

export function ligar(root, destino) {
  const base = existsSync(join(root, 'src')) && !existsSync(join(root, 'lib')) ? 'src/lib' : 'lib';
  const rel = destino || `${base}/copy-edit-marcar.ts`;
  const abs = join(root, rel);
  const linhas = [];
  if (existsSync(abs) && readFileSync(abs, 'utf8') !== TRECHO_TS) {
    linhas.push(`  ${rel} já existe e é diferente do trecho deste pacote: não sobrescrevi. Apague e rode de novo pra atualizar.`);
  } else {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, TRECHO_TS);
    linhas.push(`  ✓ escrevi ${rel} (depende só do @vercel/stega).`);
  }
  let pkg = {};
  try {
    pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch {
    /* sem package.json: o passo 1 vale do mesmo jeito */
  }
  const temStega = !!{ ...pkg.dependencies, ...pkg.devDependencies }['@vercel/stega'];
  const imp = '@/' + rel.replace(/^src\//, '').replace(/\.ts$/, '');
  linhas.push(
    '',
    '  Falta ligar, à mão (cada um só age com o editor ligado):',
    temStega ? '  1. @vercel/stega já está no package.json.' : '  1. npm install @vercel/stega   (dependência pública do site; o pacote do editor não entra)',
    `  2. no provider, onde as mensagens são montadas, passe o mapa idioma → mensagens por marcarLocales:`,
    `       import { marcarLocales } from '${imp}'`,
    `       const locales = marcarLocales({ en: enMessages, 'pt-br': ptBrMessages })`,
    '     e use `locales.<idioma>` em todo lugar que usava o objeto cru (estado inicial incluso).',
    '     i18next: `resources: marcarLocales({ en: { common, home }, pt: { ... } })`.',
    "  3. layout raiz: {process.env.COPY_EDIT === '1' && <script type=\"module\" async src=\"/__copy/ponte-stega.js\" />}",
    "  4. next.config: rewrite /__copy/:caminho* → http://127.0.0.1:${COPY_EDIT_PORTA}/__copy/:caminho* só com COPY_EDIT=1,",
    "     e frame-ancestors 'self' / X-Frame-Options SAMEORIGIN só em dev + COPY_EDIT=1 (a régua de 375px é um iframe).",
    '  5. middleware: deixe /__copy passar antes de redirect ou sessão.',
    '  Depois: `copy-edit --detectar` confere, e `npm run copy:edit` sobe.'
  );
  return { ok: true, arquivo: rel, texto: linhas.join('\n') };
}
