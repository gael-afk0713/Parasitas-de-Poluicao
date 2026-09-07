/* =========================================================================
   fase2/render/paleta.js — direção de arte por área e estado de restauração
   -------------------------------------------------------------------------
   Toda cor do jogo sai daqui. Nenhum módulo de desenho deve escrever um
   literal '#rrggbb' — se escrever, aquela cor não participa da restauração e
   fica "morta" enquanto o resto do mundo revive, que é justamente o efeito
   que o jogo inteiro existe pra entregar.

   Cada área define DOIS temas completos: `poluido` (pureza 0) e `restaurado`
   (pureza 1). `resolver(area, pureza)` devolve o tema interpolado. Como a
   interpolação é por canal RGB em TODAS as chaves ao mesmo tempo, a transição
   é coerente — não existe um estado intermediário com céu limpo e chão
   morto.

   Princípios de cor herdados de Ori/Hollow Knight e seguidos aqui:
   - O primeiro plano é quase preto e DESSATURADO. Silhueta lê antes de tudo.
   - A profundidade vem de: contraste caindo + saturação caindo + o azul da
     névoa comendo a cor conforme afasta (perspectiva atmosférica de verdade,
     não só "escurecer").
   - Existe UMA fonte de luz dominante por área, e ela é a cor mais saturada
     da tela inteira. Luz espalhada em toda parte = imagem lavada.
   - A cor de vida (verde/turquesa) é RARA no estado poluído. Ela é a
     recompensa; se estiver em todo lugar desde o começo, restaurar não
     significa nada.
   ========================================================================= */

import { misturarHex, clamp01, lerp } from '../core/mat.js';

/**
 * Chaves de um tema. Todo tema precisa definir TODAS — `validarTema()` cobra.
 * @typedef {object} Tema
 * @property {string} ceuTopo       topo do gradiente de fundo
 * @property {string} ceuBase       base do gradiente de fundo
 * @property {string} bruma         cor da névoa atmosférica (come as camadas distantes)
 * @property {string} distante      silhuetas do parallax mais longe
 * @property {string} medio         parallax intermediário
 * @property {string} proximo       parallax logo atrás do terreno jogável
 * @property {string} terreno       preenchimento do chão/parede
 * @property {string} terrenoFundo  faces internas (o "miolo" visto em cortes)
 * @property {string} borda         linha de contorno do terreno
 * @property {string} crista        topo iluminado do terreno (musgo/luz de borda)
 * @property {string} primeiroPlano silhuetas na frente do jogador
 * @property {string} luz           cor da fonte de luz dominante
 * @property {string} luzAmbiente   tinta geral que banha tudo
 * @property {string} particula     poeira/esporo em suspensão
 * @property {string} acento        detalhes vivos (flores, cristais, olhos)
 * @property {number} densidadeBruma  0..1 — quanto a névoa apaga a distância
 * @property {number} vinheta         0..1 — escurecimento das bordas da tela
 * @property {number} saturacao       multiplicador global de saturação
 * @property {number} brilhoBloom     0..1 — intensidade do glow
 */

const CHAVES_COR = [
  'ceuTopo', 'ceuBase', 'bruma', 'distante', 'medio', 'proximo',
  'terreno', 'terrenoFundo', 'borda', 'crista', 'primeiroPlano',
  'luz', 'luzAmbiente', 'particula', 'acento',
];
const CHAVES_NUM = ['densidadeBruma', 'vinheta', 'saturacao', 'brilhoBloom'];

/* =========================================================================
   ÁREAS
   =========================================================================
   A ordem aqui é a ordem narrativa de descoberta. Cada área tem uma cor
   dominante distinta no estado restaurado, pra que o mapa do jogo seja
   legível por cor (o jogador lembra "a área turquesa", "a área âmbar").
   ========================================================================= */

export const AREAS = {
  /* --------------------------------------------------------------------
     1. RAÍZES CINZENTAS — área inicial, subterrânea.
     Poluída: cinza-chumbo sufocado, luz de sódio doente vazando de cima.
     Restaurada: turquesa fria de raiz viva, bioluminescência.
     -------------------------------------------------------------------- */
  raizes: {
    nome: 'Raízes Cinzentas',
    nomeRestaurado: 'Raízes Vivas',
    ordem: 1,
    poluido: {
      ceuTopo: '#0a0d10', ceuBase: '#171a19',
      bruma: '#20241f',
      distante: '#191d1c', medio: '#141716', proximo: '#0e100f',
      terreno: '#121412', terrenoFundo: '#0a0b0a',
      borda: '#2b2f28', crista: '#3a3a2e',
      primeiroPlano: '#050605',
      luz: '#8a7a42', luzAmbiente: '#2a2b22',
      particula: '#6b6a55', acento: '#7d6b32',
      densidadeBruma: 0.62, vinheta: 0.72, saturacao: 0.55, brilhoBloom: 0.28,
    },
    restaurado: {
      ceuTopo: '#071319', ceuBase: '#0e2b2e',
      bruma: '#1c4a48',
      distante: '#173f42', medio: '#123033', proximo: '#0c2124',
      terreno: '#0d1c1d', terrenoFundo: '#071113',
      borda: '#2f6a5c', crista: '#7fd8a6',
      primeiroPlano: '#040c0e',
      luz: '#8ff2c4', luzAmbiente: '#1d4a44',
      particula: '#a9f0cf', acento: '#5fe0b0',
      densidadeBruma: 0.44, vinheta: 0.5, saturacao: 1.0, brilhoBloom: 0.7,
    },
  },

  /* --------------------------------------------------------------------
     2. VÁRZEA MORTA — alagado, água parada e oleosa.
     Poluída: verde-doente de esgoto, reflexo iridescente de óleo.
     Restaurada: azul-claro de água limpa, junco, libélula.
     -------------------------------------------------------------------- */
  varzea: {
    nome: 'Várzea Morta',
    nomeRestaurado: 'Várzea Clara',
    ordem: 2,
    poluido: {
      ceuTopo: '#0d1210', ceuBase: '#1c2418',
      bruma: '#2c3524',
      distante: '#212a1c', medio: '#1a2117', proximo: '#111610',
      terreno: '#151a12', terrenoFundo: '#0b0e09',
      borda: '#333d26', crista: '#4a5230',
      primeiroPlano: '#060805',
      luz: '#9aa844', luzAmbiente: '#2e3722',
      particula: '#8a9455', acento: '#6f7d2a',
      densidadeBruma: 0.7, vinheta: 0.66, saturacao: 0.6, brilhoBloom: 0.3,
    },
    restaurado: {
      ceuTopo: '#0a1e2c', ceuBase: '#1d4d5c',
      bruma: '#3a7f8c',
      distante: '#2d6b78', medio: '#215260', proximo: '#153a46',
      terreno: '#12292f', terrenoFundo: '#0a181c',
      borda: '#3c7f7a', crista: '#9ce8b6',
      primeiroPlano: '#05141a',
      luz: '#bff0ff', luzAmbiente: '#2a6070',
      particula: '#cdf3ff', acento: '#6fd8e8',
      densidadeBruma: 0.5, vinheta: 0.42, saturacao: 1.05, brilhoBloom: 0.72,
    },
  },

  /* --------------------------------------------------------------------
     3. CÂNION DE ESCÓRIA — as ruínas da própria fábrica da Fase 1.
     Única área que cita a paleta industrial da Fase 1 (âmbar/ferrugem) — é
     de propósito: o jogador tem que RECONHECER o que ele construiu antes.
     Restaurada: o âmbar não some, esfria pra cobre com trepadeira por cima.
     -------------------------------------------------------------------- */
  canion: {
    nome: 'Cânion de Escória',
    nomeRestaurado: 'Cânion Coberto',
    ordem: 3,
    poluido: {
      ceuTopo: '#140c07', ceuBase: '#2a1509',
      bruma: '#3a1f0e',
      distante: '#2c1809', medio: '#221206', proximo: '#160c04',
      terreno: '#1a1109', terrenoFundo: '#0d0703',
      borda: '#4a2d13', crista: '#8a4a2f',
      primeiroPlano: '#080402',
      luz: '#d99a35', luzAmbiente: '#3d2410',
      particula: '#c88a4a', acento: '#e8641f',
      densidadeBruma: 0.58, vinheta: 0.75, saturacao: 0.75, brilhoBloom: 0.42,
    },
    restaurado: {
      ceuTopo: '#161a10', ceuBase: '#3b3a1c',
      bruma: '#5a5228',
      distante: '#46441f', medio: '#343518', proximo: '#232610',
      terreno: '#1d2011', terrenoFundo: '#0f1108',
      borda: '#5c6b2e', crista: '#b8d96a',
      primeiroPlano: '#0a0c05',
      luz: '#ffd98a', luzAmbiente: '#4a4a22',
      particula: '#e8e0a0', acento: '#8fbf72',
      densidadeBruma: 0.4, vinheta: 0.48, saturacao: 1.0, brilhoBloom: 0.66,
    },
  },

  /* --------------------------------------------------------------------
     4. DOSSEL CINÉREO — escalada vertical pela árvore-mãe morta.
     Poluída: branco-cinza de cinza de queimada, silhuetas nuas.
     Restaurada: dourado quente de sol filtrado por folha — a área mais
     luminosa do jogo, a recompensa visual do meio.
     -------------------------------------------------------------------- */
  dossel: {
    nome: 'Dossel Cinéreo',
    nomeRestaurado: 'Dossel Dourado',
    ordem: 4,
    poluido: {
      ceuTopo: '#181a1c', ceuBase: '#33352f',
      bruma: '#45463d',
      distante: '#3a3b33', medio: '#2b2c26', proximo: '#1c1d19',
      terreno: '#1a1b17', terrenoFundo: '#0e0f0c',
      borda: '#3e4036', crista: '#5c5c4c',
      primeiroPlano: '#090a08',
      luz: '#c8c4a8', luzAmbiente: '#3a3b33',
      particula: '#b0ad98', acento: '#8c8a70',
      densidadeBruma: 0.74, vinheta: 0.6, saturacao: 0.35, brilhoBloom: 0.35,
    },
    restaurado: {
      ceuTopo: '#1a2a14', ceuBase: '#6b8a2e',
      bruma: '#8fae4a',
      distante: '#6d8c34', medio: '#4e6a25', proximo: '#33491a',
      terreno: '#22300f', terrenoFundo: '#111a07',
      borda: '#5e8226', crista: '#d9f26a',
      primeiroPlano: '#0c1305',
      luz: '#fff0a8', luzAmbiente: '#5a7a28',
      particula: '#fdf6c0', acento: '#ffd94a',
      densidadeBruma: 0.46, vinheta: 0.34, saturacao: 1.12, brilhoBloom: 0.85,
    },
  },

  /* --------------------------------------------------------------------
     5. O CORAÇÃO — origem da corrupção. Área final.
     Poluída: violeta-doente de infecção, a única área com cor FRIA e
     saturada no estado sujo — porque não é sujeira industrial, é a coisa
     viva que a sujeira virou.
     Restaurada: branco-rosado de amanhecer. Fim da jornada.
     -------------------------------------------------------------------- */
  coracao: {
    nome: 'O Coração',
    nomeRestaurado: 'O Coração Desperto',
    ordem: 5,
    poluido: {
      ceuTopo: '#0a0512', ceuBase: '#1d0c2e',
      bruma: '#2e1244',
      distante: '#240e36', medio: '#1a0a28', proximo: '#12061c',
      terreno: '#150a1e', terrenoFundo: '#0a0410',
      borda: '#3d1a58', crista: '#7a2f9e',
      primeiroPlano: '#050208',
      luz: '#c44ff0', luzAmbiente: '#2a1040',
      particula: '#a25ec8', acento: '#e83fb0',
      densidadeBruma: 0.55, vinheta: 0.82, saturacao: 0.95, brilhoBloom: 0.6,
    },
    restaurado: {
      ceuTopo: '#2a1c3a', ceuBase: '#e8a88c',
      bruma: '#f0c4a8',
      distante: '#c99a92', medio: '#8e6f76', proximo: '#4e4054',
      terreno: '#2a2436', terrenoFundo: '#151220',
      borda: '#6a5a78', crista: '#ffd9c8',
      primeiroPlano: '#100c18',
      luz: '#fff4e0', luzAmbiente: '#7a5a68',
      particula: '#ffe8d8', acento: '#ff9ec4',
      densidadeBruma: 0.38, vinheta: 0.3, saturacao: 1.0, brilhoBloom: 0.9,
    },
  },
};

export const ORDEM_AREAS = Object.keys(AREAS).sort((a, b) => AREAS[a].ordem - AREAS[b].ordem);

/* ------------------------------------------------------------------------- */

/** Erro cedo e claro em vez de `undefined` virando 'rgba(NaN...)' no canvas. */
export function validarTema(tema, rotulo = 'tema') {
  const faltando = [];
  for (const k of CHAVES_COR) if (typeof tema[k] !== 'string') faltando.push(k);
  for (const k of CHAVES_NUM) if (typeof tema[k] !== 'number') faltando.push(k);
  if (faltando.length) throw new Error(`${rotulo}: chaves ausentes → ${faltando.join(', ')}`);
  return tema;
}

for (const [id, area] of Object.entries(AREAS)) {
  validarTema(area.poluido, `AREAS.${id}.poluido`);
  validarTema(area.restaurado, `AREAS.${id}.restaurado`);
}

const _cache = new Map();

/**
 * Tema interpolado de uma área.
 * @param {string} areaId
 * @param {number} pureza 0 (poluído) .. 1 (restaurado)
 * @returns {Tema}
 */
export function resolver(areaId, pureza) {
  const area = AREAS[areaId];
  if (!area) throw new Error(`Área desconhecida: ${areaId}`);
  const p = clamp01(pureza);

  // Cor é cara de interpolar (15 chaves × parse hex). A pureza muda devagar,
  // então quantizar em 64 degraus é imperceptível e mata o custo por frame.
  const passo = Math.round(p * 63);
  const chaveCache = areaId + ':' + passo;
  const hit = _cache.get(chaveCache);
  if (hit) return hit;

  const t = passo / 63;
  const tema = {};
  for (const k of CHAVES_COR) tema[k] = misturarHex(area.poluido[k], area.restaurado[k], t);
  for (const k of CHAVES_NUM) tema[k] = lerp(area.poluido[k], area.restaurado[k], t);
  tema.areaId = areaId;
  tema.pureza = t;
  tema.nome = t >= 0.999 ? area.nomeRestaurado : area.nome;

  _cache.set(chaveCache, tema);
  return tema;
}

/**
 * Profundidade → cor, com perspectiva atmosférica.
 * `d` 0 = colado no jogador, 1 = horizonte. Aplica a bruma progressivamente,
 * que é o que cria sensação de espaço — sem isso as camadas viram adesivos
 * empilhados, por mais bonita que cada uma seja isolada.
 */
export function corPorProfundidade(tema, corBase, d) {
  const k = clamp01(d) * tema.densidadeBruma;
  return misturarHex(corBase, tema.bruma, k);
}

/** Nome legível pro HUD/mapa, já considerando o estado. */
export function nomeArea(areaId, pureza) {
  const a = AREAS[areaId];
  return !a ? '—' : (pureza >= 0.999 ? a.nomeRestaurado : a.nome);
}
