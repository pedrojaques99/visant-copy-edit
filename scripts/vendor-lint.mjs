#!/usr/bin/env node
/* npm run vendor:lint — congela o copy-lint da skill visant-copy dentro do pacote.
 *
 * O copy-lint é o padrão do editor: a cada save, a frase passa pela voz da casa
 * no segundo seguinte. A verdade sobre essa voz mora na skill
 * (Z:/Cursor/visant-skills/visant-copy/scripts/copy-lint.mjs, que o
 * ~/.claude/skills aponta por symlink). Este pacote roda em máquina que não tem
 * a skill (npx de outra pasta, clone novo), então leva uma CÓPIA, e a cópia diz
 * de onde veio. Não se edita a cópia: muda a skill e roda isto de novo.
 *
 * Fonte, nesta ordem: $VISANT_COPY_LINT (o mesmo nome que o Club usa), o repo
 * de skills ao lado deste (../visant-skills), e ~/.claude/skills.
 *
 * Os portões `copy:lint` dos repos NÃO usam esta cópia: cada um tem o vendor
 * dele pro CI. Esta é só a do editor, quando a config do repo não aponta outra.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACOTE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = join(PACOTE, 'lint', 'copy-lint.mjs');
const CANDIDATOS = [
  process.env.VISANT_COPY_LINT,
  resolve(PACOTE, '..', 'visant-skills', 'visant-copy', 'scripts', 'copy-lint.mjs'),
  join(homedir(), '.claude', 'skills', 'visant-copy', 'scripts', 'copy-lint.mjs'),
].filter(Boolean);

const fonte = CANDIDATOS.find((p) => existsSync(p));
if (!fonte) {
  console.error('✖ vendor:lint: não achei o copy-lint da skill. Procurei em:');
  for (const p of CANDIDATOS) console.error('    ' + p);
  console.error('  Rode com VISANT_COPY_LINT=<caminho>.');
  process.exit(1);
}

const texto = readFileSync(fonte, 'utf8');
/* O cabeçalho entra DEPOIS do shebang: empurrado pra linha 3, o shebang vira
   sintaxe inválida (o defeito já parou o check do visantismo uma vez). */
const shebang = texto.startsWith('#!') ? texto.slice(0, texto.indexOf('\n') + 1) : '';
const cabeca =
  `/* CÓPIA CONGELADA de visant-skills/visant-copy/scripts/copy-lint.mjs (skill visant-copy),\n` +
  ` * feita por \`npm run vendor:lint\` no @visant/copy-edit. É o lint padrão do editor\n` +
  ` * quando a config do repo não aponta outro. A verdade mora na skill: não edite aqui. */\n`;
mkdirSync(dirname(DESTINO), { recursive: true });
writeFileSync(DESTINO, shebang + cabeca + texto.slice(shebang.length).replace(/\r\n/g, '\n'));
console.log(`✔ copy-lint congelado em lint/copy-lint.mjs (fonte: ${fonte.replaceAll('\\', '/')})`);
