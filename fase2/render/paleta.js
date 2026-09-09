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
   ÁREAS — uma floresta morta, restaurada aos poucos
   =========================================================================
   O lugar é UMA FLORESTA, do começo ao fim: não é caverna, não é fábrica.
   A fábrica da Fase 1 aparece só como uma ferida dentro dela.

   Duas decisões de valor que valem para todas as áreas:

   · RESTAURAR NÃO CLAREIA. O mundo restaurado continua escuro — ele fica
     LUMINOSO, não iluminado. Musgo que brilha, esporo que acende, água que
     reflete. Uma floresta viva à noite, não uma floresta de dia. Isso
     mantém o jogo sombrio (pedido do autor) e ainda dá o salto emocional,
     porque o salto vem de contraste e cor, não de brilho geral.

   · O CÉU É A COISA MAIS CLARA DA CENA, sempre. O jogo é AO AR LIVRE, e ao ar
     livre o fundo é claro e o que está na frente vira silhueta. Com o céu
     quase preto — como já esteve — a floresta não tem contra o que se
     recortar e tudo lê como caverna, mesmo de teto aberto. O jogo continua
     sombrio porque o que sobe é o CONTRASTE, não o brilho: terreno, primeiro
     plano e as cores de vida seguem escuros.

   · SATURAÇÃO É RECURSO ESCASSO. Quase tudo fica entre cinza-azulado e
     quase-preto; a cor saturada aparece só na fonte de luz e no acento.
     É o que segura a leitura de silhueta e o que faz o pouco verde que
     existe no estado poluído doer de tão raro.

   A ordem abaixo é a ordem narrativa de descoberta. Cada área restaurada
   tem uma cor dominante distinta, pra que o mapa seja legível por cor.
   ========================================================================= */

export const AREAS = {
  /* --------------------------------------------------------------------
     1. SUB-BOSQUE CINZENTO — chão da floresta, entre raízes mortas.
     Área de abertura. Quase monocromática: o jogador precisa sentir que a
     cor foi EMBORA daqui, não que o lugar sempre foi assim.
     Poluída: cinza-azulado de cinza fria, com uma única luz de sódio doente
     furando o dossel morto lá em cima.
     Restaurada: musgo bioluminescente turquesa. Continua noite.
     -------------------------------------------------------------------- */
  raizes: {
    nome: 'Sub-bosque Cinzento',
    nomeRestaurado: 'Sub-bosque Vivo',
    ordem: 1,
    poluido: {
      /* A ESCADA DE VALOR ESTAVA INVERTIDA, e era a causa raiz de a área
         inteira ler como caverna por mais que o vocabulário de formas fosse
         todo de floresta.

         Medindo em luminância Rec.709 o que os números antigos produziam
         depois de `corDeProfundidade`: o plano DISTANTE saía em 108 e o céu
         entre 25 e 69. Ao ar livre isso é fisicamente impossível — silhueta
         contra céu é sempre mais escura que o céu — e o que o olho lê quando
         o fundo é claro e o céu é escuro é exatamente "caverna com luz vindo
         do fundo". Pior: `bruma` (91) era mais clara que `ceuBase` (69), e
         como `corDeProfundidade` puxa tudo pra `bruma`, quanto mais longe
         mais claro, sem teto: o horizonte virava uma barra luminosa
         atravessando a tela.

         Agora o céu é a coisa mais clara (a regra que já estava escrita no
         topo deste arquivo e que os números desmentiam), `bruma` fica SEMPRE
         abaixo de `ceuBase`, e a bruma cai de 0.60 pra 0.44 pra as camadas
         não convergirem todas pro mesmo tom.

         E o TERRENO tinha `borda` (40) duas vezes e meia mais clara que o
         próprio corpo (16): uma massa mais escura que o próprio contorno lê
         como buraco recortado, não como rocha. A borda virou tinta escura, o
         corpo subiu e a crista subiu mais. */
      ceuTopo: '#1b2430', ceuBase: '#7d8896',
      bruma: '#68727f',
      distante: '#141a23', medio: '#0f141b', proximo: '#0a0e14',
      terreno: '#1a222c', terrenoFundo: '#080c11',
      borda: '#080b10', crista: '#4e5866',
      primeiroPlano: '#03050a',
      luz: '#c8b878', luzAmbiente: '#181d27',
      particula: '#6a7280', acento: '#8a7d55',
      densidadeBruma: 0.44, vinheta: 0.52, saturacao: 0.38, brilhoBloom: 0.34,
    },
    restaurado: {
      ceuTopo: '#071820', ceuBase: '#17414a',
      bruma: '#2a6b6a',
      distante: '#112e37', medio: '#0c2229', proximo: '#07161c',
      terreno: '#12313a', terrenoFundo: '#041014',
      borda: '#05141a', crista: '#7fdcc0',
      primeiroPlano: '#020a0d',
      luz: '#7fe8c4', luzAmbiente: '#0f332e',
      particula: '#8fe0c0', acento: '#48d9a8',
      densidadeBruma: 0.42, vinheta: 0.44, saturacao: 0.92, brilhoBloom: 0.72,
    },
  },

  /* --------------------------------------------------------------------
     2. VÁRZEA AFOGADA — o alagado da floresta, envenenado.
     Poluída: preto oleoso com iridescência doente na superfície da água.
     Restaurada: azul-noite profundo, juncos e libélulas acesas.
     -------------------------------------------------------------------- */
  varzea: {
    nome: 'Várzea Afogada',
    nomeRestaurado: 'Várzea Clara',
    ordem: 2,
    poluido: {
      /* Tudo aqui era o MESMO verde-oliva, do zênite ao primeiro plano, com
         densidadeBruma 0.68 puxando as camadas todas pro mesmo #525c48: a
         tela inteira virava uma chapa de cor só e a área não tinha nem
         profundidade nem clima. Agora o céu abre num azul-esverdeado frio no
         alto e amarela na linha do horizonte (ar podre visto contra a luz),
         enquanto o chão fica no oliva escuro. A distância entre esses dois
         extremos é o que faz cada silhueta ter contra o que se recortar. */
      ceuTopo: '#101a1c', ceuBase: '#59583a',
      bruma: '#5e6446',
      distante: '#171d18', medio: '#111511', proximo: '#0a0d0a',
      terreno: '#0d100d', terrenoFundo: '#060806',
      borda: '#242a20', crista: '#4a5535',
      primeiroPlano: '#030503',
      luz: '#a09a4c', luzAmbiente: '#1a1f18',
      particula: '#565c46', acento: '#6d7a30',
      densidadeBruma: 0.56, vinheta: 0.76, saturacao: 0.42, brilhoBloom: 0.26,
    },
    restaurado: {
      ceuTopo: '#07182a', ceuBase: '#17475f',
      bruma: '#2a6d80',
      distante: '#133a48', medio: '#0e2b37', proximo: '#081c26',
      terreno: '#0a1e28', terrenoFundo: '#040f16',
      borda: '#1e4f58', crista: '#68d4e8',
      primeiroPlano: '#020a10',
      luz: '#a8ecff', luzAmbiente: '#0e3543',
      particula: '#a2dced', acento: '#4fc4e0',
      densidadeBruma: 0.50, vinheta: 0.56, saturacao: 0.95, brilhoBloom: 0.74,
    },
  },

  /* --------------------------------------------------------------------
     3. A CLAREIRA QUEIMADA — a cicatriz que a fábrica da Fase 1 deixou.
     É a ÚNICA área quente do jogo, de propósito: tudo mais é frio, e o
     calor aqui não é aconchego — é brasa que não apagou. É onde o jogador
     reconhece o que ele mesmo construiu, agora enferrujando na floresta.
     Restaurada: o metal esfria pra cobre e some sob trepadeira.
     -------------------------------------------------------------------- */
  clareira: {
    nome: 'A Clareira Queimada',
    nomeRestaurado: 'A Clareira Coberta',
    ordem: 3,
    poluido: {
      /* Era tudo o mesmo marrom-laranja, do zênite ao chão. Agora o alto do
         céu é cinza-cinza-arroxeado (cinza fria, ar frio) e a linha do
         horizonte é quente — fumaça vista contra a luz. É a diferença de
         MATIZ, não só de valor, que faz a área parar de ler como um chapado
         sépia. A bruma caiu de 0.56 pra 0.47 para os planos próximos
         continuarem escuros em vez de convergirem todos pro mesmo tom. */
      ceuTopo: '#171218', ceuBase: '#6b3a15',
      bruma: '#6b4520',
      distante: '#1f1610', medio: '#180e07', proximo: '#0e0804',
      terreno: '#120c07', terrenoFundo: '#080502',
      borda: '#37220f', crista: '#6b3a22',
      primeiroPlano: '#050301',
      luz: '#d08a30', luzAmbiente: '#2a1a0c',
      particula: '#7a5a3a', acento: '#c2481a',
      densidadeBruma: 0.47, vinheta: 0.80, saturacao: 0.60, brilhoBloom: 0.36,
    },
    restaurado: {
      ceuTopo: '#131a10', ceuBase: '#3a4820',
      bruma: '#556a2c',
      distante: '#232c14', medio: '#1a2110', proximo: '#11160a',
      terreno: '#121809', terrenoFundo: '#080c05',
      borda: '#31461c', crista: '#8fbf5a',
      primeiroPlano: '#050703',
      luz: '#d8c878', luzAmbiente: '#243015',
      particula: '#a8b878', acento: '#7ab84a',
      densidadeBruma: 0.44, vinheta: 0.60, saturacao: 0.88, brilhoBloom: 0.60,
    },
  },

  /* --------------------------------------------------------------------
     4. DOSSEL CINÉREO — a copa da árvore-mãe, escalada vertical.
     Poluída: cinza de queimada, galho nu, névoa espessa. A área mais
     dessaturada do jogo inteiro — quase uma litografia.
     Restaurada: folha acesa por dentro, dourado-esverdeado contra céu
     noturno. A recompensa visual do meio do jogo.
     -------------------------------------------------------------------- */
  dossel: {
    nome: 'Dossel Cinéreo',
    nomeRestaurado: 'Dossel Aceso',
    ordem: 4,
    poluido: {
      ceuTopo: '#1e2126', ceuBase: '#4e545c',
      bruma: '#6a7079',
      distante: '#24272b', medio: '#1a1c20', proximo: '#111316',
      terreno: '#121417', terrenoFundo: '#08090b',
      borda: '#2a2e33', crista: '#454a51',
      primeiroPlano: '#050607',
      luz: '#9aa0a8', luzAmbiente: '#232629',
      particula: '#6e737a', acento: '#5e646c',
      densidadeBruma: 0.74, vinheta: 0.66, saturacao: 0.18, brilhoBloom: 0.30,
    },
    restaurado: {
      ceuTopo: '#0e1c10', ceuBase: '#33501e',
      bruma: '#4d7030',
      distante: '#243516', medio: '#1a2810', proximo: '#111b0a',
      terreno: '#101a09', terrenoFundo: '#070d04',
      borda: '#2e4a18', crista: '#b8d94a',
      primeiroPlano: '#040802',
      luz: '#f0e08a', luzAmbiente: '#22350f',
      particula: '#d8dc90', acento: '#e0c040',
      densidadeBruma: 0.48, vinheta: 0.50, saturacao: 0.95, brilhoBloom: 0.80,
    },
  },

  /* --------------------------------------------------------------------
     5. O CORAÇÃO — a origem da corrupção. Área final.
     Poluída: violeta infeccioso. É a única cor SATURADA do estado sujo em
     todo o jogo, e isso é intencional: aqui a poluição não é fuligem, é
     uma coisa viva que a fuligem virou.
     Restaurada: branco-esverdeado pálido, quase amanhecer. Fim da jornada.
     -------------------------------------------------------------------- */
  coracao: {
    nome: 'O Coração',
    nomeRestaurado: 'O Coração Desperto',
    ordem: 5,
    poluido: {
      ceuTopo: '#120a1e', ceuBase: '#331550',
      bruma: '#46206b',
      distante: '#1b0c29', medio: '#14081e', proximo: '#0d0514',
      terreno: '#100718', terrenoFundo: '#07030d',
      borda: '#2e1444', crista: '#5f2280',
      primeiroPlano: '#030108',
      luz: '#a83fd0', luzAmbiente: '#1f0c30',
      particula: '#7e46a0', acento: '#d02f96',
      densidadeBruma: 0.54, vinheta: 0.84, saturacao: 0.85, brilhoBloom: 0.56,
    },
    restaurado: {
      ceuTopo: '#33223f', ceuBase: '#f0b096',
      bruma: '#f7cdb2',
      distante: '#2b4239', medio: '#1e302a', proximo: '#14211d',
      terreno: '#141f1b', terrenoFundo: '#0a110e',
      borda: '#33564a', crista: '#c8e8d0',
      primeiroPlano: '#050b08',
      luz: '#e8f4e0', luzAmbiente: '#2a4238',
      particula: '#d8ecdc', acento: '#8fe0b8',
      /* brilhoBloom era 0.85. Com `luz` e `bruma` quase brancas nesta paleta,
         o buffer emissivo já entra claríssimo, e o bloom transformava o feixe
         de luz num borrão branco sem forma no meio do quadro — a única tela
         do jogo em que dava pra ver estouro. 0.50 mantém o amanhecer sem
         apagar o desenho. */
      densidadeBruma: 0.40, vinheta: 0.46, saturacao: 0.90, brilhoBloom: 0.50,
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
