/* A cara do `copy-edit migrar` no terminal: lê as flags, chama o migrar e
 * imprime o resumo. Separado do migrar/index.mjs pra o teste chamar a função
 * sem passar por process.exit. */
import { migrar } from './index.mjs';

export async function executar(root, args) {
  const valor = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const lista = (flag) => args.flatMap((a, i) => (a === flag ? String(args[i + 1] || '').split(',') : [])).filter(Boolean);
  const dry = args.includes('--dry') || args.includes('--dry-run');
  const t0 = Date.now();
  const r = await migrar(root, {
    dry,
    ignorar: lista('--ignorar'),
    marcas: lista('--marca'),
    log: (m) => console.log('  · ' + m),
  });
  const seg = ((Date.now() - t0) / 1000).toFixed(0);
  console.log('');
  if (r.resumo) {
    const s = r.resumo;
    console.log(`  copy-edit migrar${dry ? ' --dry (nada gravado)' : ''}: ${s.modo}, ${seg}s`);
    console.log(`    ${s.migrados} textos migrados em ${s.arquivos} arquivos (${s.chavesNovas} chaves novas, ${s.reusos} reaproveitadas)`);
    if (s.arquivoPadrao)
      console.log(`    ${s.chavesNoLocale} chaves entram em ${s.arquivoPadrao}; ${s.outros.join(', ') || 'nenhum outro idioma'} com o mesmo texto: ${s.traduzir} pra traduzir${Object.entries(s.traduzirPor || {}).map(([d, n]) => ` (${d}: ${n})`).join('')}`);
    console.log(`    ${s.revisao} itens pra revisão, ${s.barrados} arquivo(s) barrados pela checagem de tipo`);
    const ns = Object.entries(s.porNs).sort((a, b) => b[1] - a[1]);
    if (ns.length) console.log(`    por namespace: ${ns.map(([k, v]) => `${k} ${v}`).join(', ')}`);
    if (s.namespacesNovos.length) console.log(`    namespaces novos: ${s.namespacesNovos.join(', ')}`);
    for (const n of s.notas) console.log(`    ! ${n}`);
  }
  for (const p of r.portoes || []) {
    console.log(`    ${p.ok ? (p.aviso ? '~' : '✓') : '✖'} ${p.nome}`);
    if (!p.ok || p.aviso) console.log(p.saida.split('\n').slice(0, 30).map((l) => '        ' + l).join('\n'));
  }
  if (r.diff) console.log(`\n    diff:    ${r.diff}`);
  if (r.revisaoArq) console.log(`    revisão: ${r.revisaoArq}`);
  if (!r.ok) {
    console.error(`\n  ✖ ${r.erro}\n`);
    return 1;
  }
  if (!dry) console.log('\n    Nada foi commitado. Confira o diff (git diff), a revisão e rode os testes do repo.');
  console.log('');
  return 0;
}
