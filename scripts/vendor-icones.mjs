#!/usr/bin/env node
/* npm run vendor:icones — congela no client/barra.js os ícones Phosphor que a barra usa.
 *
 * A barra é um script solto servido em /__copy/editor.js (sem bundler), então não dá pra
 * importar a biblioteca no navegador. Este script lê os SVG oficiais de @phosphor-icons/core
 * e escreve o mapa entre os marcadores ICONES:INICIO / ICONES:FIM. Não se edita o mapa à mão:
 * muda a lista aqui e roda de novo.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
// O pacote não exporta o package.json; a pasta vem da raiz deste repo.
const CORE = join(RAIZ, 'node_modules/@phosphor-icons/core');
const VERSAO = JSON.parse(readFileSync(join(CORE, 'package.json'), 'utf8')).version;

// nome na barra -> arquivo em assets/regular
const ICONES = {
  editar: 'pencil-simple',
  pausar: 'pause',
  comentar: 'chat-circle',
  textos: 'list-magnifying-glass',
  celular: 'device-mobile',
  desfazer: 'arrow-counter-clockwise',
  atalhos: 'keyboard',
  menu: 'list',
  fechar: 'x',
  alca: 'dots-six-vertical',
  fila: 'chats-circle',
  busca: 'magnifying-glass',
  check: 'check',
  reabrir: 'arrow-u-up-left',
  enviar: 'paper-plane-right',
  apagar: 'trash',
  rabiscar: 'scribble',
};

const mapa = Object.fromEntries(
  Object.entries(ICONES).map(([nome, arq]) => {
    const svg = readFileSync(join(CORE, 'assets/regular', arq + '.svg'), 'utf8')
      .trim()
      .replace('<svg ', '<svg aria-hidden="true" focusable="false" width="18" height="18" ');
    return [nome, svg];
  })
);

const alvo = join(RAIZ, 'client/barra.js');
const src = readFileSync(alvo, 'utf8');
const ini = '/* ICONES:INICIO';
const fim = '/* ICONES:FIM */';
const a = src.indexOf(ini);
const b = src.indexOf(fim);
if (a < 0 || b < 0) throw new Error('marcadores ICONES:INICIO/FIM não achados em client/barra.js');
const bloco =
  `${ini} (gerado por npm run vendor:icones, @phosphor-icons/core ${VERSAO}; não edite) */\n` +
  `  const ICONES = ${JSON.stringify(mapa, null, 2).replace(/\n/g, '\n  ')};\n  `;
writeFileSync(alvo, src.slice(0, a) + bloco + src.slice(b));
console.log(`${Object.keys(mapa).length} ícones congelados de @phosphor-icons/core ${VERSAO}`);
