#!/usr/bin/env node
/* copy-edit — sobe o editor local de copy no repo onde foi chamado.
 *
 *   npx --yes github:pedrojaques99/visant-copy-edit         (o `npm run copy:edit`)
 *   node ../visant-copy-edit/bin/copy-edit.mjs              (o `copy:edit:local`)
 *   copy-edit 4321                                          porta fixa
 *   copy-edit --detectar                                    só diz o que acharia
 *   copy-edit --help
 *
 * Lê `copy-edit.config.mjs` da raiz do repo (process.cwd()). A config diz qual
 * adapter usar e passa pra ele o que é do repo (onde mora a copy, qual build e
 * qual lint rodar). Sem config, a detecção (server/detectar.mjs) descobre,
 * ESCREVE a config que achou e sobe com ela: adivinhar de novo a cada subida
 * num editor que grava arquivo é pedir pra ele mudar de ideia sozinho. Com
 * config no repo, a config manda.
 *
 * O pacote NÃO entra no package.json dos repos, de propósito: a Vercel builda
 * os dois e não tem acesso a este repo privado. Uma devDependency de
 * `github:` privado derruba o `npm install` do deploy. O npx usa a credencial
 * git de quem está na máquina, que é o único lugar onde o editor existe.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { criarServidor, trancar } from '../server/nucleo.mjs';
import { detectar, textoConfig } from '../server/detectar.mjs';

const ADAPTERS = ['html-json', 'next-intl'];
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`copy-edit — editor local de copy (@visant/copy-edit)

uso: copy-edit [porta]
     copy-edit --detectar     mostra o que a detecção acharia, sem gravar nada

Roda na raiz do repo. Com copy-edit.config.mjs, ela manda:

  export default {
    adapter: 'html-json' | 'next-intl',
    opcoes: { ... }   // ver adapters/<nome>.mjs
  }

Sem config, detecta (next-intl, depois HTML com data-copy), escreve a config
sugerida e sobe com ela.

Só escuta em 127.0.0.1. Não commita nada.`);
  process.exit(0);
}

const root = process.cwd();
const arqConfig = join(root, 'copy-edit.config.mjs');

if (args[0] === 'migrar') {
  console.error('\n  copy-edit migrar ainda não existe: é a fase 3 (visant-club/docs/PLANO-LIB-COPY-EDIT.md).\n');
  process.exit(1);
}

if (args.includes('--detectar')) {
  const achado = detectar(root);
  if (!achado.adapter) {
    console.log(`\n  ${achado.motivo}\n`);
    process.exit(1);
  }
  if (existsSync(arqConfig)) console.log('\n  (este repo já tem copy-edit.config.mjs, e é ela que manda; abaixo, só o que a detecção acharia)');
  console.log('\n' + textoConfig(achado));
  process.exit(0);
}

if (!existsSync(arqConfig)) {
  const achado = detectar(root);
  if (!achado.adapter) {
    console.error(`\n  ✖ copy-edit: ${achado.motivo}\n`);
    process.exit(1);
  }
  writeFileSync(arqConfig, textoConfig(achado));
  console.log('');
  console.log(`  Sem copy-edit.config.mjs aqui. Detectei ${achado.adapter}:`);
  for (const n of achado.notas) console.log('    · ' + n);
  console.log('  Escrevi copy-edit.config.mjs com isso. Confira e comite; a próxima subida lê dele.');
}

const config = (await import(pathToFileURL(arqConfig).href)).default;
if (!ADAPTERS.includes(config?.adapter)) {
  console.error(`\n  ✖ copy-edit: adapter "${config?.adapter}" não existe. Use um de: ${ADAPTERS.join(', ')}.\n`);
  process.exit(1);
}
const { criar } = await import(`../adapters/${config.adapter}.mjs`);
const adapter = await criar(root, config.opcoes || {});

const tranca = trancar(root);
if (!tranca.ok) {
  console.error('');
  console.error(`  Já tem um copy:edit de pé neste repo (PID ${tranca.dono}).`);
  console.error('  Dois editores escrevendo o mesmo JSON se sobrescrevem,');
  console.error('  então este aqui não vai subir. Use o que já está aberto, ou');
  console.error('  encerre ele antes (Ctrl+C na janela dele).');
  console.error('');
  process.exit(1);
}

const porta = Number(args.find((a) => /^\d+$/.test(a))) || adapter.porta || 0;
const server = criarServidor(root, adapter);
let parar = () => {};

const sair = () => {
  tranca.soltar();
  try {
    parar();
  } catch {
    /* o filho já saiu */
  }
  process.exit(0);
};
process.on('exit', tranca.soltar);
process.on('SIGINT', sair);
process.on('SIGTERM', sair);

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  ${adapter.portaOcupada(porta)}\n`);
    process.exit(1);
  }
  console.error(e);
  process.exit(1);
});

server.listen(porta, '127.0.0.1', () => {
  parar = adapter.aoSubir(server.address().port, sair) || (() => {});
});
