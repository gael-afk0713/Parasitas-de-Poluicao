/* =========================================================================
   fase2/mundo/salas-ramos.js — ramos, atalhos e salas secretas
   -------------------------------------------------------------------------
   Estas salas existem por um motivo que só ficou óbvio ao abrir a tela de
   mapa pela primeira vez: o mundo era uma LINHA RETA. Vinte e seis salas
   ligadas todas esquerda-direita desenham um traço horizontal, e um traço não
   é um mapa — é um corredor. O jogador nunca escolhe caminho, nunca se perde,
   nunca reconhece um cruzamento, e a tela de mapa não tem nada a dizer.

   O que cada sala daqui adiciona, e por quê:

   · RAMO VERTICAL — descidas e subidas a partir do corredor principal. É o
     que dá FORMA ao mapa e o que faz "onde estou" ser uma pergunta com
     resposta espacial em vez de uma posição numa fila.

   · TRANCA POR HABILIDADE — passagens visíveis desde cedo que só abrem
     depois. É a promessa que faz o jogador querer voltar; sem isso, uma
     habilidade nova só serve pra ir pra frente e o mundo nunca é revisitado.

   · ATALHO — ligação que corta caminho de volta e só abre do lado de lá. É a
     recompensa que transforma "explorei" em "domino este lugar".
   ========================================================================= */

import { registrarSala } from './salas.js';

/* --------------------------------------------------------------------------
   raizes-04 — A FENDA  (ramo vertical, desce de raizes-01)
   Visível já na primeira sala do jogo, alcançável só com Salto Duplo. É a
   primeira promessa que o jogo faz e a primeira que ele cumpre.
   -------------------------------------------------------------------------- */
registrarSala({
  id: 'raizes-04',
  area: 'raizes',
  titulo: 'A Fenda',
  semente: 104,
  mapa: [
    '######¨#######################',
    '#............................#',
    '#............................#',
    '#....####..............####..#',
    '#............................#',
    '#..........r.................#',
    '#............................#',
    '####..................########',
    '#............................#',
    '#.......====......====.......#',
    '#............................#',
    '#............................#',
    '#....$.......................#',
    '#..####..............####....#',
    '#............................#',
    '#...........+................#',
    '#........#############.......#',
    '#............................#',
    '#....e...................e..>#',
    '##############################',
  ],
  ligacoes: {
    'porta-cima': { sala: 'raizes-01', porta: 'porta-baixo' },
    'porta-dir': { sala: 'dossel-05', porta: 'porta-esq' },
  },
  luzes: [{ x: 6 * 32, y: 1 * 32, raio: 280, intensidade: 0.6, feixe: true, angulo: 0.2 }],
});

/* --------------------------------------------------------------------------
   varzea-08 — O CANAL FUNDO  (ramo vertical, desce de varzea-02)
   Sala submersa. Só a rota de baixo leva ao fragmento, e a água lenta
   transforma a travessia em decisão de fôlego, não de reflexo.
   -------------------------------------------------------------------------- */
registrarSala({
  id: 'varzea-08',
  area: 'varzea',
  titulo: 'O Canal Fundo',
  semente: 208,
  mapa: [
    '###############¨##############',
    '#............................#',
    '#............................#',
    '#.....####............####...#',
    '#............................#',
    '#~~~~~~~~~~~~~~~~~~~~~~~~~~~~#',
    '#~~~~~~~~~~~~~~~~~~~~~~~~~~~~#',
    '#~~~~####~~~~~~~~~~~~####~~~~#',
    '#~~~~~~~~~~~~~~v~~~~~~~~~~~~~#',
    '#~~~~~~~~~~~~~~~~~~~~~~~~~~~~#',
    '#~~~~~~~~~~~~~~~~~~~~~~~~~~~~#',
    '#####~~~~~~~~~~~~~~~~~~~######',
    '#~~~~~~~~~~~~~~~~~~~~~~~~~~~~#',
    '#~~~~~~~$~~~~~~~~~~~~~~~~~~~~#',
    '#^^^^^^^^^^^^^^^^^^^^^^^^^^^^#',
    '##############################',
  ],
  ligacoes: {
    'porta-cima': { sala: 'varzea-02', porta: 'porta-baixo' },
  },
  luzes: [{ x: 16 * 32, y: 1 * 32, raio: 300, intensidade: 0.55, feixe: true, angulo: -0.1 }],
});

/* --------------------------------------------------------------------------
   clareira-08 — O DEPÓSITO  (ramo, atrás de portão de PLANEIO)
   Trancado por habilidade que só existe no Dossel, DUAS áreas adiante. O
   jogador passa por aqui, vê, não consegue, e volta muito depois — que é
   exatamente o laço que o gênero existe pra criar.
   -------------------------------------------------------------------------- */
registrarSala({
  id: 'clareira-08',
  area: 'clareira',
  titulo: 'O Depósito',
  semente: 308,
  portao: 'planeio',
  mapa: [
    '#################¨######################',
    '#......................................#',
    '#......................................#',
    '#......................................#',
    '#......................................#',
    '#...........................====.......#',
    '#..g...................................#',
    '#####..................................#',
    '#...............w......................#',
    '#......................................#',
    '#.......====...........................#',
    '#......................................#',
    '#..................................$...#',
    '#....+.............................#####',
    '#......................................#',
    '########################################',
  ],
  ligacoes: {
    'porta-cima': { sala: 'clareira-05', porta: 'porta-baixo' },
  },
  luzes: [{ x: 30 * 32, y: 3 * 32, raio: 260, intensidade: 0.7 }],
});

/* --------------------------------------------------------------------------
   dossel-05 — A TRILHA DE VOLTA  (atalho)
   Liga o topo do Dossel de volta ao Sub-bosque. Abre só deste lado — descer
   por aqui encurta a viagem inteira, e é a sala que faz o mapa deixar de ser
   uma linha e virar um CICLO.
   -------------------------------------------------------------------------- */
registrarSala({
  id: 'dossel-05',
  area: 'dossel',
  titulo: 'A Trilha de Volta',
  semente: 405,
  mapa: [
    '##############¨###############',
    '#............................#',
    '#............................#',
    '#.......####.........####....#',
    '#............................#',
    '#............................#',
    '#....====..............====..#',
    '#............................#',
    '#..........S.................#',
    '#............................#',
    '#............................#',
    '#....................v.......#',
    '#....####..............####..#',
    '#............................#',
    '#............................#',
    '#............................#',
    '#........###########.........#',
    '#............................#',
    '#............................#',
    '<............................#',
    '##############################',
  ],
  ligacoes: {
    'porta-cima': { sala: 'dossel-03', porta: 'porta-baixo' },
    'porta-esq': { sala: 'raizes-04', porta: 'porta-dir' },
  },
  luzes: [{ x: 14 * 32, y: 1 * 32, raio: 300, intensidade: 0.6, feixe: true, angulo: 0.1 }],
});
