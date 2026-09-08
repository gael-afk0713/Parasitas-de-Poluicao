/**
 * Verificador de mapas da Fase 2, fora do navegador.
 *
 *     node fase2/verificar-mapas.mjs
 *
 * Roda `validarRegistro()` (comprimento de linha, portas sem ligação,
 * ligação para sala inexistente, altar/chefe/portão sem definição) e depois
 * faz uma checagem de ALCANÇABILIDADE: percorre o grafo de portas a partir da
 * sala inicial e lista o que ficou órfão.
 *
 * Existe porque erro de mapa em metroidvania só aparece jogando, e aparece
 * tarde — você descobre a porta quebrada quando já caiu numa sala sem saída.
 */

import { validarRegistro, todasAsSalas, carregarSala, PORTA_OPOSTA } from './mundo/salas.js';

await import('./mundo/salas-raizes.js');
await import('./mundo/salas-varzea.js');
try { await import('./mundo/salas-clareira.js'); } catch { /* ainda não existe */ }
try { await import('./mundo/salas-dossel.js'); } catch { /* ainda não existe */ }
try { await import('./mundo/salas-coracao.js'); } catch { /* ainda não existe */ }
await import('./mundo/salas-ramos.js');

const SALA_INICIAL = 'raizes-01';

const { problemas, avisos } = validarRegistro();

// --- alcançabilidade ------------------------------------------------------
const visitadas = new Set();
const fila = [SALA_INICIAL];
while (fila.length) {
  const id = fila.pop();
  if (visitadas.has(id)) continue;
  visitadas.add(id);
  let sala;
  try { sala = carregarSala(id); } catch { continue; }
  for (const destino of Object.values(sala.ligacoes)) {
    if (destino?.sala && !visitadas.has(destino.sala)) fila.push(destino.sala);
  }
}

const todas = todasAsSalas().map((d) => d.id);
const orfas = todas.filter((id) => !visitadas.has(id));

// --- relatório ------------------------------------------------------------
const porArea = {};
for (const def of todasAsSalas()) porArea[def.area] = (porArea[def.area] || 0) + 1;

console.log('Salas por área:', porArea);
console.log(`Total: ${todas.length} · alcançáveis a partir de ${SALA_INICIAL}: ${visitadas.size}`);

if (orfas.length) {
  console.log('\nORFAS (nenhum caminho a partir do início):');
  for (const id of orfas) console.log('  ' + id);
}

// Avisos NÃO derrubam a verificação: são cheiro de autoria, não defeito.
// Misturar os dois faz o autor aprender a ignorar a saída inteira, que é pior
// do que não ter verificador nenhum.
if (avisos.length) {
  console.log(`\n${avisos.length} aviso(s) — o jogo roda, mas confira:`);
  for (const a of avisos) console.log('  · ' + a);
}

if (problemas.length) {
  console.log(`\n${problemas.length} PROBLEMA(S):`);
  for (const p of problemas) console.log('  ' + p);
  process.exit(1);
}
if (orfas.length) process.exit(1);
console.log(avisos.length ? '\nSem problemas (só avisos).' : '\nOK — nada a apontar.');
