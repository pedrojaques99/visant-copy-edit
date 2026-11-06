#!/usr/bin/env node
/* npm run vendor:ditado — congela no pacote o cliente de ditado do Gravador.
 *
 * O microfone da nota (comentário e rabisco) fala com o Gravador do jaques-os, e o
 * cliente de navegador dele mora lá, ao lado do backend
 * (jaques-os/frontend/public/gravador/ditado.mjs), porque o Estúdio usa o mesmo.
 * Este pacote roda em máquina que não tem o jaques-os ao lado, então leva uma
 * CÓPIA em client/ditado.mjs, e a cópia diz de onde veio. Não se edita a cópia:
 * muda o original e roda isto de novo.
 *
 * Fonte, nesta ordem: $JAQUES_OS (a raiz do repo) e o ../jaques-os ao lado deste.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACOTE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = join(PACOTE, 'client', 'ditado.mjs');
const REL = join('frontend', 'public', 'gravador', 'ditado.mjs');
const CANDIDATOS = [process.env.JAQUES_OS, resolve(PACOTE, '..', 'jaques-os')]
  .filter(Boolean)
  .map((raiz) => join(raiz, REL));

const fonte = CANDIDATOS.find((p) => existsSync(p));
if (!fonte) {
  console.error('✖ vendor:ditado: não achei o ditado.mjs do jaques-os. Procurei em:');
  for (const p of CANDIDATOS) console.error('    ' + p);
  console.error('  Rode com JAQUES_OS=<raiz do jaques-os>.');
  process.exit(1);
}

const cabecalho =
  `/* gerado por npm run vendor:ditado a partir de jaques-os/${REL.replace(/\\/g, '/')}; não edite. */\n`;
writeFileSync(DESTINO, cabecalho + readFileSync(fonte, 'utf8'));
console.log(`✔ client/ditado.mjs ← ${fonte}`);
