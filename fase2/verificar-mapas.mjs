/**
 * Verificador de mapas da Fase 2, fora do navegador.
 *
 *     node fase2/verificar-mapas.mjs
 *
 * Roda `validarRegistro()` (comprimento de linha, portas sem ligação,
 * ligação para sala inexistente, altar/chefe/portão sem definição) e depois
 * faz uma checagem de ALCANÇABILIDADE: percorre o grafo de portas a partir da
 * sala inicial e lista o que ficou órfão. Por fim, o ESPAÇO DO CORPO dentro
 * de cada sala: portas que não se comunicam por dentro e objetos (altar,
 * semente, salvamento, fragmento...) presos em bolsão onde o Guardião não cabe.
 *
 * Existe porque erro de mapa em metroidvania só aparece jogando, e aparece
 * tarde — você descobre a porta quebrada quando já caiu numa sala sem saída.
 */

import { validarRegistro, todasAsSalas, carregarSala, PORTA_OPOSTA } from './mundo/salas.js';
import { SOLIDO, TILE } from './mundo/terreno.js';

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

// --- espaço do corpo, DENTRO de cada sala ---------------------------------
/* O grafo de portas acima não sabe se, dentro da sala, dá pra ir de uma
   porta à outra. Foi assim que passou, por meses, a saída do varzea-03
   emparedada numa poça (a Várzea inteira terminava ali) e o salvamento dela
   num "tronco oco" com entrada de 1 tile de altura.
   O Guardião ocupa 1 coluna × 2 fileiras (22 × 44 px): uma célula serve se
   ela e a de cima não são sólidas. Inunda a partir da chegada de cada porta,
   IGNORANDO gravidade e altura de pulo (portão e barreira contam como
   passagem) — então só acusa bolsão fisicamente fechado, que é defeito com
   certeza. Altura de pulo é com a simulação de verdade (ver CONTEXTO). */
const ALVOS_DO_CORPO = new Set(['altar', 'semente', 'salvamento', 'fragmento', 'fonte', 'bichoPreso']);
for (const def of todasAsSalas()) {
  let sala;
  try { sala = carregarSala(def.id); } catch { continue; }
  const t = sala.terreno;
  const livre = (cx, cy) => t.em(cx, cy) !== SOLIDO && t.em(cx, cy - 1) !== SOLIDO;
  const celula = (p) => [Math.floor(p.x / TILE), Math.floor((p.y - 1) / TILE)];
  const rotulo = new Int32Array(t.largura * t.altura).fill(-1);
  const regiao = (cx, cy) => {
    if (cx < 0 || cy < 0 || cx >= t.largura || cy >= t.altura || !livre(cx, cy)) return -1;
    const i0 = cy * t.largura + cx;
    if (rotulo[i0] >= 0) return rotulo[i0];
    const id = i0;
    const pilha = [[cx, cy]];
    rotulo[i0] = id;
    while (pilha.length) {
      const [x, y] = pilha.pop();
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= t.largura || ny >= t.altura) continue;
        const i = ny * t.largura + nx;
        if (rotulo[i] >= 0 || !livre(nx, ny)) continue;
        rotulo[i] = id;
        pilha.push([nx, ny]);
      }
    }
    return id;
  };
  const regioesDePorta = new Map();
  for (const tipo of new Set(sala.portas.map((p) => p.tipo))) {
    const [cx, cy] = celula(sala.pontoDeEntrada(tipo));
    regioesDePorta.set(tipo, regiao(cx, cy));
  }
  const comPorta = new Set(regioesDePorta.values());
  if (def.id === SALA_INICIAL) comPorta.add(regiao(...celula(sala.inicio)));
  for (const [tipo, r] of regioesDePorta) {
    if (r < 0) problemas.push(`${def.id}: a chegada pela ${tipo} não cabe o corpo do Guardião`);
  }
  if (regioesDePorta.size > 1 && new Set(regioesDePorta.values()).size > 1) {
    const grupos = {};
    for (const [tipo, r] of regioesDePorta) (grupos[r] ??= []).push(tipo);
    problemas.push(`${def.id}: portas que não se comunicam por dentro da sala — ${Object.values(grupos).map((g) => g.join('+')).join(' | ')}`);
  }
  for (const o of sala.objetos) {
    if (!ALVOS_DO_CORPO.has(o.tipo)) continue;
    const r = regiao(...celula(o));
    if (r < 0 || !comPorta.has(r)) {
      problemas.push(`${def.id}: "${o.tipo}" em (col ${o.cx}, row ${o.cy}) fica num bolsão onde o Guardião não entra`);
    }
  }
}

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
