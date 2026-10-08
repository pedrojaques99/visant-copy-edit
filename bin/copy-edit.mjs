#!/usr/bin/env node
/* copy-edit — sobe o editor local de copy no repo onde foi chamado.
 *
 *   npx --yes github:pedrojaques99/visant-copy-edit         (o `npm run copy:edit`)
 *   node ../visant-copy-edit/bin/copy-edit.mjs              (o `copy:edit:local`)
 *   copy-edit 4321                                          porta fixa
 *   copy-edit --help
 *
 * Lê `copy-edit.config.mjs` da raiz do repo (process.cwd()). A config diz qual
 * adapter usar e passa pra ele o que é do repo (onde mora a copy, qual build e
 * qual lint rodar). Detecção automática é a fase 2 (docs/PLANO-LIB-COPY-EDIT.md
 * no visant-club); aqui a config é explícita, porque adivinhar errado num
 * editor que GRAVA arquivo custa mais que três linhas de config.
 *
 * O pacote NÃO entra no package.json dos repos, de propósito: a Vercel builda
 * os dois e não tem acesso a este repo privado. Uma devDependency de
 * `github:` privado derruba o `npm install` do deploy. O npx usa a credencial
 * git de quem está na máquina, que é o único lugar onde o editor existe.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { criarServidor, trancar } from '../server/nucleo.mjs';

const ADAPTERS = ['html-json', 'next-intl'];
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`copy-edit — editor local de copy (@visant/copy-edit)

uso: copy-edit [porta]

Roda na raiz de um repo com copy-edit.config.mjs:

  export default {
    adapter: 'html-json' | 'next-intl',
    opcoes: { ... }   // ver adapters/<nome>.mjs
  }

Só escuta em 127.0.0.1. Não commita nada.`);
  process.exit(0);
}

const root = process.cwd();
const arqConfig = join(root, 'copy-edit.config.mjs');
if (!existsSync(arqConfig)) {
  console.error(`\n  ✖ copy-edit: não achei copy-edit.config.mjs em ${root}.`);
  console.error('    Rode na raiz do repo (o npm run já faz isso).\n');
  process.exit(1);
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
