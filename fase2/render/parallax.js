/* =========================================================================
   fase2/render/parallax.js — fundo em camadas, luz volumétrica e moldura
   -------------------------------------------------------------------------
   EXPORTA (o orquestrador liga isto em main.js)

     desenharParallax(render, sala, mundo)      camadas 1..7 + raios no meio
     desenharPrimeiroPlano(render, mundo)       moldura quase preta, parallax>1
     desenharRaios(render, sala, mundo)         só a luz volumétrica
     desenharBrilhoDeFundo(render, sala, mundo) poça de luz atrás de tudo
     anguloLuzArea(areaId) -> number            rad a partir da vertical
     direcaoLuzArea(areaId) -> {x, y}           vetor unitário da mesma luz
     corDeProfundidade(tema, cor, d, brilho)    perspectiva atmosférica completa

   -------------------------------------------------------------------------
   POR QUE ASSIM

   1. SEIS+ CAMADAS, NÃO TRÊS. Três planos com o mesmo ruído recolorido leem
      como adesivos empilhados por mais bonito que cada um seja. O que vende
      profundidade é a QUANTIDADE de passos de valor entre o horizonte e o
      jogador — e cada passo precisa ter SILHUETA PRÓPRIA, senão o olho
      percebe a repetição e o truque morre.

   2. PROFUNDIDADE SÃO QUATRO COISAS JUNTAS: velocidade diferente **e**
      saturação caindo **e** contraste caindo (a cor se aproxima do céu)
      **e** a bruma comendo tudo. `corDeProfundidade()` faz as três últimas
      numa conta só; o fator de parallax faz a primeira. Só a velocidade é o
      erro clássico.

   3. A ESCADA DE VALOR É INVERTIDA NUMA CAVERNA. Ao ar livre o horizonte é
      claro porque o céu é claro. Aqui o horizonte é claro porque a BRUMA
      espalha a luz da área — por isso as camadas distantes recebem `brilho`
      positivo e as próximas, negativo. Sem essa escada explícita a paleta
      poluída (tudo entre #0a e #20) vira uma mancha só.

   4. O FUNDO PRECISA DE UMA POÇA DE LUZ. `desenharBrilhoDeFundo` põe um
      halo enorme da cor dominante da área atrás de todas as camadas. É
      contra ele que as silhuetas leem. Sem isso, silhueta escura sobre fundo
      escuro = nada.

   5. ANCORAGEM VERTICAL NA SALA, NÃO NA TELA. O código antigo somava
      `camera.viewY * parallax` à posição da camada, o que CANCELA a
      translação da câmera e prega o fundo na tela: parallax vertical zero.
      Aqui a âncora é o centro da sala, então subir numa sala alta desloca o
      fundo de verdade.

   Tudo é função determinística da posição de mundo — nenhum estado, nenhuma
   lista de objetos. As alocações por quadro são pequenas e de vida curta
   (gradientes e os `Path2D` do fogo, da fumaça e da fauna). A mesma coluna
   desenha sempre a mesma silhueta, então nada pisca ou "nada" quando a
   câmera se move.
   ========================================================================= */

import {
  TAU, lerp, clamp, clamp01, rgba, ruido1, hash2,
  misturarHex, ajustarBrilho, hexParaRgb, rgbParaHex,
} from '../core/mat.js';
import { feixeLuz } from './renderizador.js';
import {
  FORMAS_CATASTROFE, FORMAS_LUZ, confCatastrofe, forcaFogo, forcaFumaca,
  calmaDaFauna, chamaDe, frenteDeFogo, claraoDeFogo, pluma,
  desenharManada, desenharBando, coresDeFumaca, tocoEmBrasa, focoDeLuz, escoadouroNoHorizonte,
  desenharMaquina,
} from './catastrofe.js';

/* =========================================================================
   1 · COR E PROFUNDIDADE
   ========================================================================= */

/** Tira saturação sem tocar no brilho percebido (luminância Rec.709). */
function dessaturar(hex, k) {
  if (k <= 0.002) return hex;
  const { r, g, b } = hexParaRgb(hex);
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return rgbParaHex(lerp(r, l, k), lerp(g, l, k), lerp(b, l, k));
}

/**
 * Perspectiva atmosférica completa.
 * @param {number} d      0 = colado no jogador, 1 = horizonte
 * @param {number} brilho -1..1, a escada de valor entre camadas
 */
export function corDeProfundidade(tema, corBase, d, brilho = 0) {
  const k = clamp01(d);
  let c = dessaturar(corBase, k * 0.62);
  c = misturarHex(c, tema.bruma, k * (0.30 + tema.densidadeBruma * 0.62));
  c = misturarHex(c, tema.ceuBase, k * 0.20);          // contraste cai
  return brilho ? ajustarBrilho(c, brilho) : c;
}

/* Parse de hex é caro e as mesmas ~20 cores se repetem todo quadro. Os temas
   já vêm quantizados em 64 degraus de pureza por paleta.js, então cachear
   por objeto de tema é exato — não aproxima nada. */
const _cacheCor = new WeakMap();
function cor(tema, chave, d, brilho) {
  let m = _cacheCor.get(tema);
  if (!m) { m = new Map(); _cacheCor.set(tema, m); }
  const k = chave + ((d * 64) | 0) + ':' + ((brilho * 64) | 0);
  let c = m.get(k);
  if (c === undefined) {
    c = corDeProfundidade(tema, tema[chave], d, brilho);
    m.set(k, c);
  }
  return c;
}

/* =========================================================================
   2 · DIREÇÃO DA LUZ
   -------------------------------------------------------------------------
   UMA fonte dominante por área e TODOS os feixes com o mesmo ângulo. Feixes
   com ângulos diferentes na mesma tela dão a impressão de três sóis e é o
   erro que mais denuncia luz volumétrica falsa.
   ========================================================================= */

const ANGULO_LUZ = {
  raizes: 0.26,    // fresta de superfície, um pouco à direita
  varzea: -0.20,   // sol baixo do lado oposto — a área é a "virada" da 1
  clareira: 0.36,    // sol raso entre as paredes, projeta sombra longa
  dossel: 0.12,    // quase a pino: é o topo da árvore-mãe
  coracao: -0.06,  // a luz vem do próprio Coração, quase vertical
};

export function anguloLuzArea(areaId) { return ANGULO_LUZ[areaId] ?? 0.22; }

/** Vetor unitário na direção em que a luz VIAJA (mesma convenção de feixeLuz). */
export function direcaoLuzArea(areaId) {
  const a = anguloLuzArea(areaId);
  return { x: -Math.sin(a), y: Math.cos(a) };
}

/* =========================================================================
   VENTO
   -------------------------------------------------------------------------
   Toda planta da cena já balançava — cada uma com a sua própria senóide, na
   sua própria fase. O resultado é vinte objetos oscilando em desacordo, que é
   exatamente a leitura de "vinte animações" em vez de "um lugar com ar".

   Aqui existe UM vento, e ele:
     · varia devagar (ruído de baixa frequência), então há calmaria e rajada;
     · VIAJA pela cena — a rajada chega antes na esquerda e depois na direita,
       e é esse atraso que faz o olho ler a onda atravessando a floresta;
     · é global: o mesmo valor entra no galho, na folha, no junco e na moita
       do primeiro plano, então tudo se dobra junto.

   O que cada planta mantém de próprio é a RIGIDEZ — junco fino deita, tronco
   grosso quase não se mexe. É a diferença de resposta ao mesmo vento que dá
   escala às coisas.
   ========================================================================= */

/** Força do vento em `x`, de ~-1,2 a ~1,8. Determinística, sem estado. */
export function vento(tempo, x = 0) {
  // A rajada percorre a cena a ~600 px/s.
  const fase = tempo - x / 600;
  const base = ruido1(fase * 0.09, 991) * 2 - 1;
  const rajada = Math.pow(clamp01(ruido1(fase * 0.16 + 40, 997) * 1.7 - 0.55), 2);
  return base * 0.5 + rajada * 1.25;
}

/* =========================================================================
   3 · AMBIENTE DE DESENHO
   -------------------------------------------------------------------------
   Objeto único reaproveitado entre camadas: zero alocação por quadro.
   ========================================================================= */

const _amb = {
  camera: null, tema: null, tempo: 0, pureza: 0, ang: 0,
  p: 1, x0: 0, x1: 0, vw: 0, vh: 0, ancora: 0,
  cor: '#000', corAlto: '#000', corBase: '#000', corTras: '#000',
  // --- catástrofe (ver catastrofe.js) — preenchidos a cada camada
  area: 'raizes', fogo: 0, fumaca: 0, calma: 0, fuga: -1, chama: null,
  tempoAnim: 0, ventoAqui: 0, inclinaFogo: 0,
};
/* Auxiliares entregues às formas de `catastrofe.js` pelo próprio ambiente:
   assim aquele arquivo não precisa importar este, e não nasce um ciclo. */
_amb.y = (rel) => yDe(_amb, rel);
_amb.perfil = (x, s) => perfilAltura(x, s);
/* LADO DO FOGO. O incêndio vem de um lado da tela — o oposto ao da fuga —, e
   é isso que dá à manada um lado seguro pra onde correr. 0,2 no lado da fuga,
   1 no lado do fogo, medido na posição de TELA (o fogo é "pra lá", não um
   ponto do mapa). */
_amb.lateral = (x) => ladoDoFogo((x - _amb.x0 - 220) / _amb.vw, _amb.fuga);

function ladoDoFogo(u, fuga) {
  const s = clamp01(u);
  return clamp01(0.2 + 0.95 * (fuga < 0 ? s : 1 - s));
}

/* Movimento reduzido: o `main.js` liga isto. Fogo, bando e manada continuam
   existindo — eles SÃO a informação da cena —, mas andam a um terço. */
let _reduzido = false;
// x de MUNDO do jogador, pra máscara que tira força do fogo perto dele.
let _jogMundoX = 0;

function prepararAmb(camera, sala, tema, tempo, p, c, cAlto, cBase, cTras, ang) {
  const vw = camera.largura / camera.zoom;
  _amb.camera = camera; _amb.tema = tema; _amb.tempo = tempo;
  _amb.pureza = tema.pureza ?? 0; _amb.ang = ang;
  _amb.p = p;
  _amb.vw = vw;
  _amb.vh = camera.altura / camera.zoom;
  _amb.x0 = camera.viewX * p - 220;
  _amb.x1 = _amb.x0 + vw + 440;
  // Âncora vertical = centro da sala em ESPAÇO DE FUNDO. Como o desenho já
  // recebe translate(-viewY*p), a camada se desloca a p·(altura da câmera) —
  // que é exatamente o parallax vertical que faltava.
  _amb.ancora = sala.altura * 0.5;
  _amb.cor = c; _amb.corAlto = cAlto; _amb.corBase = cBase; _amb.corTras = cTras;

  const area = sala.area;
  _amb.area = area;
  _amb.fogo = forcaFogo(area, _amb.pureza);
  _amb.fumaca = forcaFumaca(area, _amb.pureza);
  _amb.calma = calmaDaFauna(_amb.pureza);
  _amb.fuga = confCatastrofe(area).fuga;
  _amb.chama = chamaDe(area);
  _amb.tempoAnim = _reduzido ? tempo * 0.33 : tempo;
  // O jogador no espaço DESTE plano: x de tela + deslocamento do plano.
  _amb.jogX = _jogMundoX - camera.viewX + camera.viewX * p;
  _amb.ventoAqui = vento(_amb.tempoAnim, _amb.x0 + vw * 0.5);
  // O fogo tomba pro lado da fuga, mais forte na rajada.
  _amb.inclinaFogo = _amb.fuga * (0.16 + 0.14 * clamp01(_amb.ventoAqui));
  return _amb;
}

/**
 * Degradê vertical do plano, do ZÊNITE ao chão.
 *
 * `corDeProfundidade` mistura em direção à `bruma` proporcional à DISTÂNCIA e
 * só a ela — não à altura na tela. Mas atravessar 40 px de ar olhando pra
 * cima não é a mesma coisa que atravessar o horizonte inteiro: no alto do
 * quadro a silhueta distante saía com o DOBRO do brilho do céu que ela cruza
 * (medido: elementos até 68 contra céu 33), e os galhos das camadas de fundo
 * liam como arranhões pálidos na lente.
 *
 * Devolve um `CanvasGradient` — só serve pra `fillStyle`/`strokeStyle`. Quem
 * precisa de hex (ajustarBrilho, misturarHex, rgba) continua usando `a.cor`.
 */
function corVertical(ctx, a, yTopo, yBase) {
  if (!(yBase > yTopo + 1)) return a.cor;
  const g = ctx.createLinearGradient(0, yTopo, 0, yBase);
  g.addColorStop(0, a.corAlto);
  g.addColorStop(1, a.cor);
  return g;
}

/** `rel` 0 = topo da viewport, 1 = base — relativo à âncora da sala. */
function yDe(a, rel) {
  const y = a.ancora + (rel - 0.5) * a.vh;
  /* GUARDA. A âncora é o meio da SALA, então numa sala alta a linha de chão
     de um plano vai parar bem abaixo da borda de baixo da tela — e a camada
     inteira some. Era o caso das Raízes: as cinco `massa` nunca eram
     desenhadas, e os contrafortes dos troncos (onde está todo o trabalho de
     forma) ficavam de 150 a 240 px fora do quadro, o que fazia toda árvore
     ler como poste cortado. Nenhuma linha de chão passa de 5% abaixo da
     borda. */
  return Math.min(y, a.camera.viewY * a.p + a.vh * 1.05);
}

/* =========================================================================
   4 · FORMAS
   -------------------------------------------------------------------------
   Cada forma é `(ctx, amb, s)`, determinística em x de mundo. Nomeadas num
   mapa e referenciadas por string nas tabelas de área: assim uma camada é
   DADO, não código, e trocar a silhueta de uma área não mexe em desenho.
   ========================================================================= */

/** Perfil de rocha: três oitavas + picos esporádicos (senão vira duna). */
function perfilAltura(x, s) {
  const e = s.escala;
  let h = ruido1(x * e, s.semente) * s.amp;
  h += ruido1(x * e * 2.4 + 37, s.semente + 5) * s.amp * 0.44;
  h += ruido1(x * e * 5.7 + 91, s.semente + 11) * s.amp * 0.17;
  if (s.picos) {
    const n = ruido1(x * e * 0.55 + 13, s.semente + 3);
    const k = clamp01((n - 0.58) / 0.42);
    h += k * k * s.amp * s.picos * 1.6;
  }
  return h;
}

/** Massa de rocha: chão que sobe (`lado:'baixo'`) ou teto que desce ('cima'). */
function massa(ctx, a, s) {
  const y0 = yDe(a, s.rel);
  const sinal = s.lado === 'cima' ? 1 : -1;
  const longe = s.lado === 'cima' ? -2600 : 2600;
  const passo = s.passo || 13;

  ctx.beginPath();
  ctx.moveTo(a.x0, y0 + longe);
  for (let x = a.x0; x <= a.x1; x += passo) {
    ctx.lineTo(x, y0 + sinal * perfilAltura(x, s));
  }
  ctx.lineTo(a.x1, y0 + longe);
  ctx.closePath();

  // A bruma se acumula EMBAIXO. Num teto isso significa que a beirada
  // (inferior) é a parte mais lavada e o miolo lá em cima é o mais escuro —
  // por isso o gradiente não é simplesmente invertido junto com a forma.
  const g = ctx.createLinearGradient(0, y0 - s.amp * 1.5 - 40, 0, y0 + s.amp * 1.5 + 320);
  if (s.lado === 'cima') {
    g.addColorStop(0, ajustarBrilho(a.cor, -0.10));
    g.addColorStop(1, a.corBase);
  } else {
    g.addColorStop(0, a.cor);
    g.addColorStop(1, a.corBase);
  }
  ctx.fillStyle = g;
  ctx.fill();
}

/**
 * Dripstone: estalactite ('cima') ou estalagmite ('baixo').
 * Lados CÔNCAVOS — um triângulo de lados retos é o que faz a forma parecer
 * um cone de trânsito em vez de rocha.
 */
function dentes(ctx, a, s) {
  const yb = yDe(a, s.rel);
  const sinal = s.lado === 'cima' ? 1 : -1;
  const passo = s.passo || 80;
  const x0 = Math.floor(a.x0 / passo) * passo;
  ctx.fillStyle = a.cor;

  for (let x = x0; x <= a.x1; x += passo) {
    const h = hash2(x, s.semente, 17);
    if (h > (s.dens ?? 0.6)) continue;
    const h2 = hash2(x, s.semente + 1, 29);
    const h3 = hash2(x, s.semente + 2, 41);
    const px = x + (h2 - 0.5) * passo * 0.7;
    const comp = lerp(s.compMin ?? 40, s.compMax ?? 140, h3) * sinal;
    const larg = lerp(s.largMin ?? 8, s.largMax ?? 22, h);
    const torto = (h3 - 0.5) * larg * 1.5;   // a ponta não cai no eixo
    const base = yb + sinal * perfilAltura(px, s) * (s.seguirPerfil ? 1 : 0);

    ctx.beginPath();
    ctx.moveTo(px - larg, base);
    ctx.bezierCurveTo(
      px - larg * 0.62, base + comp * 0.34,
      px - larg * 0.20, base + comp * 0.72,
      px + torto, base + comp
    );
    ctx.bezierCurveTo(
      px + larg * 0.22, base + comp * 0.70,
      px + larg * 0.66, base + comp * 0.32,
      px + larg, base
    );
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Banda de rocha com PASSAGENS EM ARCO vazadas — a assinatura de "caverna em
 * camadas". A abertura é pintada com a cor da camada de TRÁS (mais clara pela
 * bruma), então lê como um vão iluminado ao fundo em vez de um buraco preto.
 */
function arcos(ctx, a, s) {
  const yTop = yDe(a, s.rel);
  const alt = s.altura ?? 220;
  const passoOnda = 26;

  ctx.beginPath();
  ctx.moveTo(a.x0, yTop);
  for (let x = a.x0; x <= a.x1; x += passoOnda) {
    ctx.lineTo(x, yTop + (ruido1(x * 0.0034, s.semente) - 0.5) * 34);
  }
  for (let x = a.x1; x >= a.x0; x -= passoOnda) {
    ctx.lineTo(x, yTop + alt + (ruido1(x * 0.0041 + 20, s.semente + 3) - 0.5) * 40);
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(0, yTop - 30, 0, yTop + alt + 60);
  g.addColorStop(0, a.cor);
  g.addColorStop(1, a.corBase);
  ctx.fillStyle = g;
  ctx.fill();

  const passo = s.passo ?? 330;
  const x0 = Math.floor(a.x0 / passo) * passo;
  ctx.fillStyle = a.corTras;
  for (let x = x0; x <= a.x1; x += passo) {
    const h = hash2(x, s.semente + 7, 53);
    if (h > (s.dens ?? 0.72)) continue;
    const h2 = hash2(x, s.semente + 8, 61);
    const px = x + (h2 - 0.5) * passo * 0.42;
    const w = lerp(64, 148, h2);
    const hh = alt * lerp(0.46, 0.86, h);
    const base = yTop + alt + 6;
    ctx.beginPath();
    ctx.moveTo(px - w * 0.5, base);
    ctx.lineTo(px - w * 0.5, base - hh * 0.42);
    ctx.quadraticCurveTo(px - w * 0.5, base - hh, px, base - hh);
    ctx.quadraticCurveTo(px + w * 0.5, base - hh, px + w * 0.5, base - hh * 0.42);
    ctx.lineTo(px + w * 0.5, base);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Raiz colossal descendo: fita afilada em S com uma sub-raiz.
 * Desenhada como polígono (esquerda descendo, direita voltando) porque um
 * stroke de largura fixa não afina, e raiz que não afina é cano.
 */
function fitaRaiz(ctx, px, yTopo, comp, larg, curva, passos) {
  /* Duas senóides incomensuráveis e um expoente de afilamento sorteado: com
     uma senóide só, mesma fase e mesmo expoente, toda raiz da tela era a
     MESMA lente afilada — quinze delas lado a lado leem como marca de garra,
     não como raiz. */
  const fase = curva * 3;
  const exp = 0.45 + Math.abs(curva) * 0.9;
  const eixo = (t) => px + Math.sin(t * 2.3 + fase) * curva * 46
    + Math.sin(t * 5.7 + fase * 2.4) * curva * 14 + t * curva * 26;
  ctx.beginPath();
  for (let i = 0; i <= passos; i++) {
    const t = i / passos;
    const w = larg * Math.pow(1 - t, exp);
    const x = eixo(t), y = yTopo + comp * t;
    if (i === 0) ctx.moveTo(x - w, y); else ctx.lineTo(x - w, y);
  }
  for (let i = passos; i >= 0; i--) {
    const t = i / passos;
    const w = larg * Math.pow(1 - t, exp);
    ctx.lineTo(eixo(t) + w, yTopo + comp * t);
  }
  ctx.closePath();
  ctx.fill();
}

function raizes(ctx, a, s) {
  const passo = s.passo ?? 200;
  const x0 = Math.floor(a.x0 / passo) * passo;
  const yTopo = yDe(a, s.rel);
  ctx.fillStyle = a.cor;

  for (let x = x0; x <= a.x1; x += passo) {
    const h = hash2(x, s.semente, 71);
    if (h > (s.dens ?? 0.6)) continue;
    const h2 = hash2(x, s.semente + 1, 83);
    const h3 = hash2(x, s.semente + 2, 97);
    const px = x + (h2 - 0.5) * passo * 0.8;
    const comp = lerp(s.compMin ?? 180, s.compMax ?? 520, h3);
    const larg = lerp(s.largMin ?? 7, s.largMax ?? 26, h);
    const curva = (h2 - 0.5) * 2;

    fitaRaiz(ctx, px, yTopo, comp, larg, curva, 9);
    // Sub-raiz saindo a meio caminho: sem bifurcação, raiz vira corda.
    if (h3 > 0.4) {
      const t = 0.42;
      const bx = px + Math.sin(t * 2.3 + curva * 3) * curva * 46 + t * curva * 26;
      fitaRaiz(ctx, bx, yTopo + comp * t, comp * 0.5, larg * 0.5, -curva * 1.4, 6);
    }
  }
}

/** Juncos: tufos de lâminas afiladas que balançam devagar (várzea). */
function juncos(ctx, a, s) {
  const passo = s.passo ?? 90;
  const x0 = Math.floor(a.x0 / passo) * passo;
  const yb = yDe(a, s.rel);
  const t = a.tempo;
  /* Degradê vertical em vez de cor chapada: no alto o talo cruza menos ar e
     precisa ficar mais escuro, senão a ponta fica mais clara que o céu que
     ela atravessa — o mesmo motivo dos troncos. E de quebra a moita deixa de
     ser uma mancha preta uniforme. */
  ctx.fillStyle = corVertical(ctx, a, yb - (s.compMax ?? 190), yb);

  for (let x = x0; x <= a.x1; x += passo) {
    const h = hash2(x, s.semente, 113);
    if (h > (s.dens ?? 0.75)) continue;
    const ventoAqui = vento(t, x);
    const cx = x + (hash2(x, s.semente + 1, 127) - 0.5) * passo * 0.8;
    const n = 2 + ((hash2(x, s.semente + 2, 131) * 4) | 0);
    for (let i = 0; i < n; i++) {
      const hi = hash2(x + i * 13, s.semente + 3, 139);
      const comp = lerp(s.compMin ?? 60, s.compMax ?? 190, hi);
      /* BASE PROPORCIONAL AO COMPRIMENTO.
         A largura era 2 a 6 px fixos, independente da altura: um junco de
         400 px saía com 3 px de base, ou seja, um FIO. Na várzea, onde eles
         chegam a 420, o plano médio inteiro virava um campo de agulhas
         idênticas — lia como arranhão na lente, não como planta. Um talo real
         tem uns 3% da própria altura na base, e é essa proporção que faz o
         olho aceitar a forma como vegetal. */
      const larg = Math.max(2, comp * 0.032) * (s.escalaLarg ?? 1);
      const bx = cx + (hi - 0.5) * passo * 0.5;
      /* Só a ponta se move, a base fica presa — é o que dá "planta". A
         oscilação própria continua (ela é o tremor de folha), mas quem manda
         na amplitude é o vento global: junco fino deita bem mais que talo
         grosso, e é essa diferença de resposta que dá escala. */
      const rigidez = lerp(1.5, 0.55, hi);
      const vento = Math.sin(t * lerp(0.5, 1.1, hi) + hi * TAU) * comp * 0.06
        + ventoAqui * comp * 0.13 / rigidez
        + (hi - 0.5) * comp * 0.2;
      /* ARCO PRÓPRIO, além do vento. Junco em repouso não é reto: ele já
         nasce curvado pra um lado, e é a mistura de arcos diferentes dentro
         da mesma moita que quebra a leitura de "fileira de riscos". */
      const arco = (hash2(x + i * 7, s.semente + 5, 149) - 0.5) * comp * 0.2;
      const px = bx + vento + arco;
      ctx.beginPath();
      ctx.moveTo(bx - larg, yb);
      ctx.quadraticCurveTo(bx - larg * 0.4 + (vento + arco) * 0.35, yb - comp * 0.6,
        px, yb - comp);
      ctx.quadraticCurveTo(bx + larg * 0.4 + (vento + arco) * 0.35, yb - comp * 0.6,
        bx + larg, yb);
      ctx.closePath();
      ctx.fill();

      /* FOLHA. Um em cada três ganha uma lâmina saindo do meio do talo e
         caindo. É o traço que distingue junco de espinho a 1×, e some
         sozinho nas camadas pequenas porque acompanha `comp`. */
      if (hi > 0.62 && comp > 70) {
        const t0 = lerp(0.35, 0.6, hi);
        const lx = lerp(bx, px, t0), ly = yb - comp * t0;
        const lado = hash2(x + i * 3, s.semente + 9, 151) < 0.5 ? -1 : 1;
        /* Estreita e curta. Na primeira versão a lâmina saía com até 40% do
           comprimento do talo e uma barriga larga: o resultado arqueava quase
           180° e a várzea virava um campo de FOICES. Folha de junco é uma
           fita fina que sai quase paralela e cai só na ponta. */
        const lc = comp * lerp(0.14, 0.24, hi);
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.quadraticCurveTo(lx + lado * lc * 0.75, ly - lc * 0.1,
          lx + lado * lc, ly + lc * 0.3);
        ctx.quadraticCurveTo(lx + lado * lc * 0.42, ly + lc * 0.06,
          lx, ly + larg * 0.5);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
}

/** Tronco morto caído — cápsula inclinada com tocos de galho quebrado. */
function troncos(ctx, a, s) {
  const passo = s.passo ?? 420;
  const x0 = Math.floor(a.x0 / passo) * passo;
  const yb = yDe(a, s.rel);
  ctx.fillStyle = a.cor;

  for (let x = x0; x <= a.x1; x += passo) {
    const h = hash2(x, s.semente, 149);
    if (h > (s.dens ?? 0.7)) continue;
    const h2 = hash2(x, s.semente + 1, 151);
    const px = x + (h2 - 0.5) * passo * 0.6;
    const py = yb + (h - 0.5) * 40;
    const comp = lerp(s.compMin ?? 130, s.compMax ?? 300, h2);
    const esp = lerp(6, 18, h);
    const incl = (h - 0.5) * 0.8;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(incl);
    ctx.beginPath();
    ctx.moveTo(-comp * 0.5, -esp);
    ctx.quadraticCurveTo(0, -esp * 1.5, comp * 0.5, -esp * 0.6);
    ctx.lineTo(comp * 0.5, esp * 0.6);
    ctx.quadraticCurveTo(0, esp * 1.4, -comp * 0.5, esp);
    ctx.closePath();
    ctx.fill();
    // dois tocos de galho, senão vira um charuto
    for (let i = 0; i < 2; i++) {
      const hi = hash2(x + i * 7, s.semente + 2, 157);
      const gx = lerp(-comp * 0.3, comp * 0.35, hi);
      const gy = hi > 0.5 ? -esp : esp;
      ctx.beginPath();
      ctx.moveTo(gx - esp * 0.5, gy);
      ctx.lineTo(gx + lerp(-14, 26, hi), gy + Math.sign(gy) * lerp(16, 44, hi));
      ctx.lineTo(gx + esp * 0.5, gy);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

/**
 * Superfície de água: banda + linha de brilho + estrias horizontais que
 * derivam. Reflexo geométrico de verdade custaria redesenhar a cena espelhada;
 * as estrias entregam 90% da leitura por 1% do custo.
 */
function agua(ctx, a, s) {
  const y = yDe(a, s.rel);
  const alt = s.altura ?? 260;
  const t = a.tempo;

  /* A lâmina d'água ESPELHA o céu. É a única coisa na Várzea que devolve a
     luz do horizonte, e é o que dá nome à área — sem esse brilho na
     superfície, a água some no mesmo verde de tudo e o alagado vira só mais
     um chão. O degradê cai depressa: dois terços da altura já são o fundo
     escuro, senão a mancha clara sobe demais e lê como neblina. */
  const espelho = misturarHex(a.tema.bruma, a.tema.luz, 0.42);
  const g = ctx.createLinearGradient(0, y, 0, y + alt);
  g.addColorStop(0, misturarHex(a.cor, espelho, 0.72));
  g.addColorStop(0.09, misturarHex(a.cor, espelho, 0.34));
  g.addColorStop(0.3, a.cor);
  g.addColorStop(1, a.corBase);
  ctx.fillStyle = g;
  ctx.fillRect(a.x0, y, a.x1 - a.x0, alt);

  // linha de superfície
  ctx.strokeStyle = rgba(misturarHex(a.tema.luz, espelho, 0.35), 0.55);
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let x = a.x0; x <= a.x1; x += 18) {
    const yy = y + Math.sin(x * 0.011 + t * 0.5) * 1.8;
    if (x === a.x0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
  }
  ctx.stroke();

  // estrias de reflexo
  const passo = 46;
  const y0 = Math.floor(y / passo) * passo;
  ctx.fillStyle = misturarHex(a.tema.luz, a.cor, 0.5);
  for (let yy = y0; yy < y + alt; yy += passo) {
    const prof = clamp01((yy - y) / alt);
    for (let i = 0; i < 3; i++) {
      const hx = hash2((yy / passo) | 0, i, s.semente);
      const larg = lerp(50, 230, hx) * (1 - prof * 0.5);
      const px = a.x0 + ((hx * (a.x1 - a.x0) + Math.sin(t * 0.3 + hx * TAU) * 30) % (a.x1 - a.x0));
      ctx.globalAlpha = (1 - prof) * 0.17 * lerp(0.4, 1, hx);
      ctx.fillRect(px, yy + Math.sin(t * 0.7 + hx * TAU) * 2, larg, lerp(1.2, 3.4, hx));
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * Chaminé da fábrica da Fase 1. Cônica, TORTA e às vezes com o topo
 * arrancado — chaminé reta e inteira lê como prédio, não como ruína.
 */
function chamines(ctx, a, s) {
  const passo = s.passo ?? 260;
  const x0 = Math.floor(a.x0 / passo) * passo;
  const yb = yDe(a, s.rel);

  for (let x = x0; x <= a.x1; x += passo) {
    const h = hash2(x, s.semente, 191);
    if (h > (s.dens ?? 0.62)) continue;
    const h2 = hash2(x, s.semente + 1, 193);
    const h3 = hash2(x, s.semente + 2, 197);
    const px = x + (h2 - 0.5) * passo * 0.7;
    const alt = lerp(s.altMin ?? 150, s.altMax ?? 420, h3);
    const largBase = lerp(16, 40, h2) * (s.escalaLarg ?? 1);
    const largTopo = largBase * lerp(0.42, 0.68, h);
    const incl = (h2 - 0.5) * (s.torcao ?? 0.16);
    const quebrada = h3 > 0.55;

    ctx.save();
    ctx.translate(px, yb);
    ctx.rotate(incl);
    ctx.fillStyle = a.cor;
    ctx.beginPath();
    ctx.moveTo(-largBase, 0);
    ctx.lineTo(-largTopo, -alt);
    if (quebrada) {
      // boca arrancada: dentes irregulares em vez de um corte reto
      const n = 4;
      for (let i = 0; i <= n; i++) {
        const hi = hash2(x + i * 31, s.semente + 3, 199);
        ctx.lineTo(lerp(-largTopo, largTopo, i / n), -alt + lerp(-14, 22, hi));
      }
    } else {
      ctx.lineTo(-largTopo * 1.25, -alt - largTopo * 0.5);
      ctx.lineTo(largTopo * 1.25, -alt - largTopo * 0.5);
      ctx.lineTo(largTopo, -alt);
    }
    ctx.lineTo(largBase, 0);
    ctx.closePath();
    ctx.fill();

    // anéis de reforço — a escala só aparece com detalhe repetido
    ctx.strokeStyle = rgba(ajustarBrilho(a.cor, -0.16), 0.7);
    ctx.lineWidth = Math.max(1, largBase * 0.09);
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      const w = lerp(largBase, largTopo, t) * 1.06;
      ctx.beginPath();
      ctx.moveTo(-w, -alt * t);
      ctx.lineTo(w, -alt * t);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** Torre de refino: cilindro + calota + treliça de apoio. */
function torres(ctx, a, s) {
  const passo = s.passo ?? 380;
  const x0 = Math.floor(a.x0 / passo) * passo;
  const yb = yDe(a, s.rel);

  for (let x = x0; x <= a.x1; x += passo) {
    const h = hash2(x, s.semente, 211);
    if (h > (s.dens ?? 0.6)) continue;
    const h2 = hash2(x, s.semente + 1, 223);
    const px = x + (h2 - 0.5) * passo * 0.6;
    const alt = lerp(s.altMin ?? 90, s.altMax ?? 240, h2);
    const r = lerp(18, 46, h) * (s.escalaLarg ?? 1);

    ctx.fillStyle = a.cor;
    ctx.beginPath();
    ctx.moveTo(px - r, yb);
    ctx.lineTo(px - r, yb - alt);
    ctx.quadraticCurveTo(px - r, yb - alt - r * 0.85, px, yb - alt - r * 0.85);
    ctx.quadraticCurveTo(px + r, yb - alt - r * 0.85, px + r, yb - alt);
    ctx.lineTo(px + r, yb);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = rgba(ajustarBrilho(a.cor, -0.18), 0.75);
    ctx.lineWidth = Math.max(1, r * 0.11);
    for (let i = 1; i < 5; i++) {
      const y = yb - alt * (i / 5);
      ctx.beginPath(); ctx.moveTo(px - r * 1.06, y); ctx.lineTo(px + r * 1.06, y); ctx.stroke();
    }
    // pernas em X
    ctx.beginPath();
    ctx.moveTo(px - r * 1.5, yb); ctx.lineTo(px + r * 0.4, yb - alt * 0.42);
    ctx.moveTo(px + r * 1.5, yb); ctx.lineTo(px - r * 0.4, yb - alt * 0.42);
    ctx.stroke();
  }
}

/** Esteira transportadora arrebentada: viga inclinada + treliça + correia caída. */
function esteiras(ctx, a, s) {
  const passo = s.passo ?? 520;
  const x0 = Math.floor(a.x0 / passo) * passo;
  const yb = yDe(a, s.rel);

  for (let x = x0; x <= a.x1; x += passo) {
    const h = hash2(x, s.semente, 227);
    if (h > (s.dens ?? 0.66)) continue;
    const h2 = hash2(x, s.semente + 1, 229);
    const px = x + (h2 - 0.5) * passo * 0.5;
    const comp = lerp(200, 460, h2) * (s.escalaLarg ?? 1);
    const incl = lerp(-0.34, -0.12, h) * (h2 > 0.5 ? 1 : -1);
    const esp = lerp(7, 15, h) * (s.escalaLarg ?? 1);

    ctx.save();
    ctx.translate(px, yb - lerp(20, 90, h));
    ctx.rotate(incl);
    ctx.fillStyle = a.cor;
    ctx.fillRect(-comp * 0.5, -esp * 0.5, comp, esp);

    ctx.strokeStyle = a.cor;
    ctx.lineWidth = Math.max(1.2, esp * 0.3);
    // treliça em zigue-zague
    ctx.beginPath();
    const n = Math.max(3, (comp / 46) | 0);
    for (let i = 0; i <= n; i++) {
      const xx = lerp(-comp * 0.5, comp * 0.5, i / n);
      ctx.moveTo(xx, esp * 0.5);
      ctx.lineTo(xx + (i % 2 ? -22 : 22), esp * 0.5 + 26);
    }
    ctx.moveTo(-comp * 0.5, esp * 0.5 + 26);
    ctx.lineTo(comp * 0.5, esp * 0.5 + 26);
    ctx.stroke();

    // correia rompida pendurada na ponta
    ctx.lineWidth = Math.max(1.4, esp * 0.42);
    ctx.beginPath();
    ctx.moveTo(comp * 0.5, 0);
    ctx.quadraticCurveTo(comp * 0.5 + 30, 70, comp * 0.5 - 6, 132);
    ctx.stroke();
    ctx.restore();
  }
}

/** Cabos pendurados: catenária entre dois pontos, com balanço lento. */
function cabos(ctx, a, s) {
  const passo = s.passo ?? 300;
  const x0 = Math.floor(a.x0 / passo) * passo;
  const yb = yDe(a, s.rel);
  const t = a.tempo;

  ctx.strokeStyle = a.cor;
  ctx.lineCap = 'round';
  for (let x = x0; x <= a.x1; x += passo) {
    const h = hash2(x, s.semente, 233);
    if (h > (s.dens ?? 0.7)) continue;
    const h2 = hash2(x, s.semente + 1, 239);
    const ax = x + (h2 - 0.5) * passo * 0.4;
    const bx = ax + lerp(120, 320, h2);
    const ay = yb + (h - 0.5) * 70;
    const by = ay + (h2 - 0.5) * 60;
    const barriga = lerp(50, 160, h) + Math.sin(t * lerp(0.3, 0.6, h) + h * TAU) * 5;
    ctx.lineWidth = lerp(1.4, 4.2, h) * (s.escalaLarg ?? 1);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo((ax + bx) * 0.5, (ay + by) * 0.5 + barriga, bx, by);
    ctx.stroke();
    // ponta rompida, pendurada
    if (h2 > 0.5) {
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.quadraticCurveTo(bx + 12, by + 60, bx - 8, by + lerp(80, 190, h));
      ctx.stroke();
    }
  }
}

/** Fumaça industrial subindo — só enquanto a área está suja. */
function fumaca(ctx, a, s) {
  const forca = 1 - a.pureza;
  if (forca < 0.06) return;
  const passo = s.passo ?? 260;
  const x0 = Math.floor(a.x0 / passo) * passo;
  const yb = yDe(a, s.rel);
  const t = a.tempo;

  for (let x = x0; x <= a.x1; x += passo) {
    const h = hash2(x, s.semente, 241);
    if (h > (s.dens ?? 0.5)) continue;
    const px = x + (hash2(x, s.semente + 1, 251) - 0.5) * passo * 0.7;
    for (let i = 0; i < 4; i++) {
      const hi = hash2(x + i * 17, s.semente + 2, 257);
      const subida = ((t * lerp(7, 18, hi) + hi * 400) % 400);
      const y = yb - subida;
      const r = lerp(26, 90, hi) * (0.4 + subida / 400);
      const g = ctx.createRadialGradient(px + Math.sin(subida * 0.012 + hi * TAU) * 34, y, 0,
        px + Math.sin(subida * 0.012 + hi * TAU) * 34, y, r);
      g.addColorStop(0, rgba(a.cor, 0.14 * forca * (1 - subida / 400)));
      g.addColorStop(1, rgba(a.cor, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px + Math.sin(subida * 0.012 + hi * TAU) * 34, y, r, 0, TAU);
      ctx.fill();
    }
  }
}

/** Tronco colossal vertical com raízes-contraforte (a árvore-mãe). */
/**
 * @param {object} s
 * @param {[number,number]} [s.altura]  faixa de altura do tronco, em fração da
 *   viewport. Sem isso todo tronco sobe 1,5 viewport acima da base — ou seja,
 *   vai do chão ao topo da tela SEMPRE.
 *
 *   Isso é certo pro plano bem próximo (o tronco que emoldura a cena) e errado
 *   pra todo o resto: com todos os planos indo até o topo, o céu nunca
 *   aparece e a floresta ao ar livre lê como corredor fechado. Numa floresta
 *   de verdade a copa distante TERMINA, e é ver onde ela termina que dá a
 *   sensação de espaço aberto.
 */
function troncosColossais(ctx, a, s) {
  const passo = s.passo ?? 340;
  const x0 = Math.floor(a.x0 / passo) * passo;
  const yb = yDe(a, s.rel);
  const faixaAltura = s.altura ?? [1.5, 1.5];

  for (let x = x0; x <= a.x1; x += passo) {
    /* Árvore nasce em BOSQUE, não em fileira. O laço anda numa grade fixa de
       `passo` e o jitter era de só ±0,35·passo: na camada mais densa isso dá
       uns dez troncos quase equidistantes atravessando a tela, e o olho acha
       o ritmo em meio segundo. O ruído de baixa frequência abre clareiras
       inteiras e o jitter dobrado desfaz o resto da grade. */
    if (ruido1(x * 0.0009, s.semente + 41) < 0.34) continue;
    const h = hash2(x, s.semente, 263);
    if (h > (s.dens ?? 0.7)) continue;
    const h2 = hash2(x, s.semente + 1, 269);
    const px = x + (h2 - 0.5) * passo * 1.6;
    const rBase = lerp(s.largMin ?? 26, s.largMax ?? 90, h2);
    // Altura própria por tronco: uma fileira de troncos de mesma altura lê
    // como cerca, não como floresta.
    const topo = yb - a.vh * lerp(faixaAltura[0], faixaAltura[1], hash2(x, s.semente + 3, 277));

    // AFILAMENTO. O tronco era um retângulo entre os contrafortes e o topo, e
    // um retângulo lê como pilar de concreto — foi exatamente o que a cena
    // parecia quando o céu abriu e os topos ficaram visíveis. Árvore afina
    // conforme sobe, e é esse afilamento que o olho usa pra dizer "isso é um
    // tronco". Quanto mais alta, mais fina fica a ponta.
    const alturaTronco = Math.max(1, yb - topo);
    // Piso no afilamento: sem ele um tronco alto vira agulha, e a curva
    // nova transformava a agulha numa lâmina inclinada.
    const afina = lerp(0.62, 0.36, clamp01(alturaTronco / (a.vh * 1.4)));
    const rTopo = rBase * afina;
    // Inclinação leve e própria: floresta de troncos perfeitamente verticais
    // lê como grade.
    const inclina = (hash2(x, s.semente + 5, 281) - 0.5) * rBase * 1.1;
    /* CURVA DO EIXO. O tronco era um afilamento reto entre os contrafortes e
       o topo: todo tronco da tela tinha exatamente o mesmo eixo vertical, e
       uma floresta de eixos paralelos lê como cerca de postes por mais que a
       espessura varie. Um desvio no MEIO dá a cada árvore um gesto próprio,
       que é o que o olho usa pra dizer "isto cresceu" em vez de "isto foi
       desenhado". */
    // Tronco grosso entorta menos que tronco fino — e é o grosso que fica
    // perto da câmera, onde uma curva exagerada denuncia na hora.
    /* Amplitude ATADA à própria espessura. Solta, o desvio chegava a quase
       duas vezes a meia-largura do tronco: o afilamento somado à curva
       produzia crescentes finos que leem como lâmina, não como árvore. */
    const curva = (hash2(x, s.semente + 23, 331) - 0.5) * rBase
      / (1 + rBase / 50);
    const yMeio = yb - alturaTronco * 0.52;
    const rMeio = lerp(rBase * 0.86, rTopo, 0.45);
    /** Eixo do tronco em `t` (0 = base, 1 = topo). */
    const eixo = (t) => px + curva * Math.sin(t * Math.PI) + inclina * t * t;
    const xMeio = eixo(0.52);

    ctx.fillStyle = corVertical(ctx, a, topo, yb + 80);
    ctx.beginPath();
    ctx.moveTo(px - rBase * 1.9, yb + 80);
    // contraforte esquerdo → meio desviado → topo
    ctx.quadraticCurveTo(px - rBase * 1.15, yb - rBase * 0.7, px - rBase * 0.86, yb - rBase * 2.2);
    ctx.quadraticCurveTo(
      px - rBase * 0.8 + curva * 0.5, yb - alturaTronco * 0.26,
      xMeio - rMeio, yMeio
    );
    ctx.quadraticCurveTo(
      xMeio - rMeio * 0.9 + curva * 0.3, yb - alturaTronco * 0.78,
      px - rTopo + inclina, topo
    );
    /* TOPO QUEBRADO. Uma em cada três termina em lasca em vez de ponta lisa —
       é o detalhe que diz "esta árvore morreu de pé" sem textura nenhuma. */
    if (hash2(x, s.semente + 29, 337) < 0.34) {
      // Número de lascas e fase da alternância variam por árvore — com N e
      // fase fixos dava pra contar quatro topos idênticos na mesma tela.
      const hl = hash2(x, s.semente + 43, 349);
      const lasca = rTopo * lerp(0.9, 1.6, hl);
      const N = 4 + Math.floor(hl * 5);
      const fase = hl > 0.5 ? 1 : 0;
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        const hk = hash2(x + k * 11, s.semente + 31, 341);
        ctx.lineTo(px - rTopo + inclina + rTopo * 2 * t,
          topo - lasca * (k % 2 === fase ? 0.35 + hk * 0.65 : hk * 0.3));
      }
    } else {
      ctx.lineTo(px + rTopo + inclina, topo);
    }
    ctx.quadraticCurveTo(
      xMeio + rMeio * 0.9 + curva * 0.3, yb - alturaTronco * 0.78,
      xMeio + rMeio, yMeio
    );
    ctx.quadraticCurveTo(
      px + rBase * 0.8 + curva * 0.5, yb - alturaTronco * 0.26,
      px + rBase * 0.86, yb - rBase * 2.2
    );
    ctx.quadraticCurveTo(px + rBase * 1.15, yb - rBase * 0.7, px + rBase * 1.9, yb + 80);
    ctx.closePath();
    ctx.fill();

    // COPA. Só quando o topo cabe na tela — um tronco que sai pelo alto do
    // quadro não precisa de copa, e desenhar uma fora da vista é custo puro.
    // Galhos nus na área morta; conforme a pureza sobe, a copa engrossa.
    // `yDe(a, 0)` é o topo da viewport neste plano; a folga de 0,15 deixa
    // desenhar copas que estão um pouco acima da borda e ainda são vistas.
    if (topo > yDe(a, 0) - a.vh * 0.15) {
      const vivo = 0.2 + (a.pureza ?? 0) * 0.8;
      /* GALHOS.
         A versão anterior era um leque de traços de espessura CONSTANTE,
         todos saindo do mesmo ponto no topo, com ângulos igualmente
         espaçados. Isso desenha um Y de palitos — e como toda árvore usava a
         mesma fórmula, a floresta virava o mesmo carimbo repetido em quinze
         tamanhos. Era o que mais fazia a cena parecer clip-art.

         Três mudanças, cada uma resolvendo um pedaço:
         1. o galho AFINA (é uma fita, não um traço) — espessura constante lê
            como antena de inseto;
         2. os galhos nascem espalhados pelo terço de cima do tronco, não
            todos no mesmo ponto;
         3. cada galho se BIFURCA uma vez — galho seco sem ramificação é
            palito, e é a ramificação que diz "árvore". */
      const nGalhos = 4 + Math.floor(hash2(x, s.semente + 7, 283) * 4);
      // Viés lateral por árvore: algumas cresceram tortas pro mesmo lado.
      const vies = (hash2(x, s.semente + 37, 347) - 0.5) * 1.1;
      // Galho lá no alto é onde o problema mais aparecia: eles cruzam o céu.
      ctx.fillStyle = corVertical(ctx, a, topo - a.vh * 0.25, topo + rBase * 3);

      const ventoTopo = vento(a.tempo, px) * lerp(0.11, 0.03, clamp01(rBase / 60));
      const fitaGalho = (bx, by, ang, comp, larg, nivel) => {
        const N = 6;
        // Galho seco cai com o próprio peso: curva pra baixo na ponta. E a
        // ponta dobra com o vento — a base, presa ao tronco, quase não.
        const arco = 0.5 + nivel * 0.35 + ventoTopo * (1 + nivel);
        const ponto = (t) => {
          const aa = ang + arco * t * t * 0.55;
          return [bx + Math.cos(aa) * comp * t, by + Math.sin(aa) * comp * t];
        };
        ctx.beginPath();
        for (let k = 0; k <= N; k++) {
          const t = k / N;
          const g = ponto(t);
          const w = larg * Math.pow(1 - t, 0.75);
          k === 0 ? ctx.moveTo(g[0] - w, g[1]) : ctx.lineTo(g[0] - w, g[1]);
        }
        for (let k = N; k >= 0; k--) {
          const t = k / N;
          const g = ponto(t);
          const w = larg * Math.pow(1 - t, 0.75);
          ctx.lineTo(g[0] + w, g[1]);
        }
        ctx.closePath();
        ctx.fill();
        return ponto;
      };

      for (let i = 0; i < nGalhos; i++) {
        const hg = hash2(x + i * 17, s.semente + 9, 293);
        const hg2 = hash2(x - i * 23, s.semente + 19, 317);
        // Inserção espalhada pelo terço de cima; os de baixo são maiores, que
        // é como uma árvore fica mais larga sob a copa.
        const u = i / Math.max(1, nGalhos - 1);
        const desce = alturaTronco * 0.3 * (u * u) * (0.5 + hg2);
        const by = topo + rBase * 0.25 + desce;
        const bx = eixo(clamp01((yb - by) / alturaTronco)) + inclina * 0.6;
        // Lado alternado com jitter — leque simétrico é o que fazia o Y.
        const lado = (i % 2 === 0 ? -1 : 1);
        const ang = -Math.PI / 2 + lado * lerp(0.5, 1.35, hg) + vies;
        const comp = rBase * lerp(2.4, 6.2, hg2) * (1 + desce / alturaTronco)
          * lerp(1, 1.45, vivo);
        const larg = Math.max(0.7, rBase * lerp(0.22, 0.1, hg));
        const ponto = fitaGalho(bx, by, ang, comp, larg, 0);
        if (hg2 > 0.3) {                       // bifurcação a ~55% do galho
          const fg = ponto(0.55);
          const dir = hg > 0.5 ? 1 : -1;
          fitaGalho(fg[0], fg[1], ang + dir * lerp(0.4, 0.85, hg2),
            comp * 0.5, larg * 0.55, 1);
        }
      }
      /* Folhagem: só existe de verdade quando a área revive.
         Era UMA elipse — e uma elipse lisa em cima de um tronco fino é um
         pirulito, não uma copa; no Coração restaurado a paisagem inteira
         virava um campo de cogumelos. Agora são cinco a sete lobos num
         caminho SÓ (com `fill` nonzero eles se fundem sem costura, o que um
         fill por lobo não daria com alfa < 1), achatados por uma
         transformação em vez de lobo a lobo — assim continua sendo um path
         só e o contorno da massa fica irregular. */
      if (vivo > 0.45) {
        ctx.globalAlpha = (vivo - 0.45) * 1.2;
        ctx.fillStyle = corVertical(ctx, a, topo - rBase * 3, topo + rBase * 2);
        const rc = rBase * lerp(1.5, 3.0, vivo);
        ctx.save();
        // Achatamento POR ÁRVORE: com 0.7 fixo e 5-7 lobos, seis copas na
        // mesma tela viravam seis couve-flores idênticas em fileira.
        const hAch = hash2(x, s.semente + 47, 353);
        ctx.translate(px + inclina, topo - rBase * 0.4);
        ctx.scale(1, lerp(0.5, 0.95, hAch));
        ctx.beginPath();
        const nLobos = 4 + Math.floor(hash2(x, s.semente + 11, 307) * 7);
        for (let i = 0; i < nLobos; i++) {
          const hl = hash2(x + i * 29, s.semente + 13, 311);
          const hl2 = hash2(x - i * 7, s.semente + 17, 313);
          const ang = (i / nLobos) * TAU + hl * 0.8;
          const dist = rc * lerp(0.18, 1.1, hl2);
          const rr = rc * lerp(0.32, 0.8, hl);
          const lx = Math.cos(ang) * dist, ly = Math.sin(ang) * dist - rc * 0.15;
          ctx.moveTo(lx + rr, ly);
          ctx.arc(lx, ly, rr, 0, TAU);
        }
        ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }

    // sulcos de casca: verticais, levemente tortos
    ctx.strokeStyle = rgba(ajustarBrilho(a.cor, -0.14), 0.6);
    ctx.lineWidth = Math.max(1, rBase * 0.07);
    for (let i = 0; i < 4; i++) {
      const hi = hash2(x + i * 13, s.semente + 2, 271);
      const sx = px + lerp(-rBase * 0.6, rBase * 0.6, hi);
      ctx.beginPath();
      ctx.moveTo(sx, yb - rBase * 1.2);
      ctx.quadraticCurveTo(sx + (hi - 0.5) * rBase * 0.5, (yb + topo) * 0.5, sx + (hi - 0.5) * rBase * 0.3, topo);
      ctx.stroke();
    }
  }
}

/** Galhos atravessando a tela na horizontal, com ramos. */
function galhos(ctx, a, s) {
  const passo = s.passo ?? 420;
  const x0 = Math.floor(a.x0 / passo) * passo;
  const yb = yDe(a, s.rel);
  const t = a.tempo;

  // Estes atravessam o céu: são o caso mais visível da silhueta distante
  // ficando mais clara que o ar que ela cruza.
  ctx.strokeStyle = corVertical(ctx, a, yb - a.vh * 0.34, yb + a.vh * 0.3);
  ctx.lineCap = 'round';
  for (let x = x0; x <= a.x1; x += passo) {
    const h = hash2(x, s.semente, 277);
    if (h > (s.dens ?? 0.7)) continue;
    const h2 = hash2(x, s.semente + 1, 281);
    const ax = x - passo * 0.4;
    const bx = x + passo * lerp(0.5, 1.1, h2);
    const ay = yb + (h - 0.5) * a.vh * 0.28;
    const arco = lerp(40, 150, h2) * (h > 0.5 ? 1 : -1);
    // Galho grosso é rígido: responde pouco, mas responde ao MESMO vento.
    const balanco = Math.sin(t * 0.35 + h * TAU) * 2
      /* `s.escalaLarg ?? 1 > 1 ? 0.4 : 1` não fazia o que parece: `>` amarra
         antes de `??`, então isso era `(s.escalaLarg ?? false) ? 0.4 : 1` —
         qualquer valor definido caía em 0,4, inclusive as camadas finas de
         fundo que deveriam balançar MAIS. */
      + vento(t, x) * lerp(9, 3, h) * ((s.escalaLarg ?? 1) > 1 ? 0.4 : 1);

    ctx.lineWidth = lerp(4, 16, h) * (s.escalaLarg ?? 1);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo((ax + bx) * 0.5, ay + arco + balanco, bx, ay + arco * 0.25);
    ctx.stroke();

    ctx.lineWidth = Math.max(1.2, lerp(4, 16, h) * 0.35);
    const pontas = [];
    for (let i = 1; i < 5; i++) {
      const tt = i / 5;
      const hx = hash2(x + i * 29, s.semente + 2, 283);
      const gx = lerp(ax, bx, tt);
      const gy = ay + arco * (2 * tt * (1 - tt)) * 2 + arco * 0.25 * tt * tt;
      const px = gx + (hx - 0.5) * 70;
      const py = gy + lerp(40, 110, hx) + balanco;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.quadraticCurveTo(gx + (hx - 0.5) * 40, gy + lerp(20, 60, hx), px, py);
      ctx.stroke();
      pontas.push([px, py, hx]);
    }

    /* FOLHA NA PONTA — só quando a área restaura.
       A restauração mudava a PALETA e mais nada: a mesma sala poluída com
       outro filtro de cor. O galho continuava sendo um graveto pelado nos
       dois estados, e era isso que fazia a cura ler como troca de tema em
       vez de vida voltando. Aqui a ponta seca ganha um tufo, e o tufo só
       existe acima de 30% de pureza: forma NOVA, não cor nova. */
    if (a.pureza > 0.3) {
      const vivo = clamp01((a.pureza - 0.3) / 0.55);
      ctx.save();
      ctx.globalAlpha = vivo * 0.85;
      ctx.fillStyle = ctx.strokeStyle;
      for (const [px, py, hx] of pontas) {
        const r = lerp(6, 20, hx) * vivo * (s.escalaLarg ?? 1);
        for (let k = 0; k < 3; k++) {
          const ang = hx * TAU + k * 2.1 + vento(t, px) * 0.12;
          ctx.beginPath();
          ctx.ellipse(px + Math.cos(ang) * r * 0.55, py + Math.sin(ang) * r * 0.4,
            r, r * 0.45, ang * 0.5, 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }
}

/**
 * Massa de folhagem: contorno recortado por raio variável em torno de um
 * centro. Círculos lisos leem como nuvem; o recorte é o que vira folha.
 */
function folhagem(ctx, a, s) {
  const passo = s.passo ?? 240;
  const x0 = Math.floor(a.x0 / passo) * passo;
  const yb = yDe(a, s.rel);
  const t = a.tempo;
  const vivo = 0.25 + a.pureza * 0.75;   // dossel morto tem pouca folha

  for (let x = x0; x <= a.x1; x += passo) {
    const h = hash2(x, s.semente, 293);
    if (h > (s.dens ?? 0.75) * vivo) continue;
    const h2 = hash2(x, s.semente + 1, 307);
    const px = x + (h2 - 0.5) * passo * 0.8;
    const py = yb + (h - 0.5) * a.vh * 0.3;
    const r = lerp(s.rMin ?? 60, s.rMax ?? 170, h2);
    // Massa de folha é o que mais responde: leve e com muita área.
    const balanco = Math.sin(t * lerp(0.22, 0.45, h) + h * TAU) * r * 0.015
      + vento(t, px) * r * 0.07;

    ctx.fillStyle = corVertical(ctx, a, py - r, py + r);
    ctx.beginPath();
    const n = 18;
    for (let i = 0; i <= n; i++) {
      const ang = (i / n) * TAU;
      const lob = 0.72 + 0.28 * ruido1(i * 0.9 + h * 20, s.semente + 3);
      const rr = r * lob * (1 + 0.16 * Math.sin(ang * 5 + h * TAU));
      const xx = px + Math.cos(ang) * rr + balanco;
      const yy = py + Math.sin(ang) * rr * 0.72;
      if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Massa orgânica pulsante — o Coração. Nada de rocha: lobos que respiram,
 * com veias por dentro. Períodos diferentes por lobo, senão a tela inteira
 * pulsa junto e vira um LED.
 */
function organico(ctx, a, s) {
  const passo = s.passo ?? 260;
  const x0 = Math.floor(a.x0 / passo) * passo;
  const yb = yDe(a, s.rel);
  const t = a.tempo;

  for (let x = x0; x <= a.x1; x += passo) {
    const h = hash2(x, s.semente, 311);
    if (h > (s.dens ?? 0.85)) continue;
    const h2 = hash2(x, s.semente + 1, 313);
    const px = x + (h2 - 0.5) * passo * 0.7;
    const py = yb + (h - 0.5) * a.vh * 0.34;
    const r = lerp(s.rMin ?? 70, s.rMax ?? 210, h2);
    const resp = 1 + 0.045 * Math.sin(t * lerp(0.5, 0.95, h) + h * TAU);

    ctx.fillStyle = a.cor;
    ctx.beginPath();
    const n = 22;
    for (let i = 0; i <= n; i++) {
      const ang = (i / n) * TAU;
      const lob = 0.66 + 0.34 * ruido1(i * 0.7 + h * 30, s.semente + 2);
      const rr = r * lob * resp * (1 + 0.1 * Math.sin(ang * 3 + h2 * TAU));
      const xx = px + Math.cos(ang) * rr;
      const yy = py + Math.sin(ang) * rr * lerp(0.6, 1.05, h2);
      if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.closePath();
    ctx.fill();

    // veias
    ctx.strokeStyle = rgba(misturarHex(a.cor, a.tema.acento, 0.35), 0.35);
    ctx.lineWidth = Math.max(1, r * 0.03);
    for (let i = 0; i < 4; i++) {
      const hi = hash2(x + i * 19, s.semente + 3, 317);
      const ang = hi * TAU;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(
        px + Math.cos(ang) * r * 0.5, py + Math.sin(ang) * r * 0.4,
        px + Math.cos(ang + (hi - 0.5)) * r * 0.92 * resp,
        py + Math.sin(ang + (hi - 0.5)) * r * 0.8 * resp
      );
      ctx.stroke();
    }
  }
}

/** Blocos de escombro/concreto arruinado no fundo. */
function escombros(ctx, a, s) {
  const passo = s.passo ?? 190;
  const x0 = Math.floor(a.x0 / passo) * passo;
  const yb = yDe(a, s.rel);
  ctx.fillStyle = a.cor;

  for (let x = x0; x <= a.x1; x += passo) {
    const h = hash2(x, s.semente, 331);
    if (h > (s.dens ?? 0.7)) continue;
    const h2 = hash2(x, s.semente + 1, 337);
    const h3 = hash2(x, s.semente + 2, 347);
    const px = x + (h2 - 0.5) * passo * 0.8;
    const w = lerp(30, 120, h2) * (s.escalaLarg ?? 1);
    const hh = lerp(20, 110, h3) * (s.escalaLarg ?? 1);
    const incl = (h3 - 0.5) * 0.5;
    ctx.save();
    ctx.translate(px, yb);
    ctx.rotate(incl);
    ctx.beginPath();
    ctx.moveTo(-w * 0.5, 0);
    ctx.lineTo(-w * 0.44, -hh);
    ctx.lineTo(-w * 0.05, -hh * lerp(0.7, 1.1, h));
    ctx.lineTo(w * 0.42, -hh * lerp(0.5, 0.95, h2));
    ctx.lineTo(w * 0.5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

const FORMAS = {
  massa, dentes, arcos, raizes, juncos, troncos, agua,
  chamines, torres, esteiras, cabos, fumaca,
  troncosColossais, galhos, folhagem, organico, escombros,
  ...FORMAS_CATASTROFE,
};

/* =========================================================================
   5 · AS CAMADAS DE CADA ÁREA
   -------------------------------------------------------------------------
   `p`      fator de parallax        `d`  profundidade 0..1 (bruma/saturação)
   `cor`    chave do tema            `brilho` degrau da escada de valor
   `veu`    força da névoa aplicada DEPOIS da camada (null = automático)

   Sete camadas por área. A escada de `brilho` vai de +0.22 (horizonte, quase
   dissolvido na bruma) a -0.48 (quase silhueta pura) — é ela que dá contraste
   numa paleta em que todas as cores estão entre #08 e #24.

   A faixa foi ALARGADA depois de olhar screenshots das cinco áreas: com o
   intervalo original (+0.20 a -0.22) as sete camadas caíam quase todas no
   mesmo meio-tom, e a cena virava papa ao apertar os olhos — que é
   exatamente o teste de silhueta. O que separa plano de plano é diferença de
   VALOR; saturação e bruma só ajudam depois que ela existe.
   ========================================================================= */

const CAMADAS = {
  /* --- SUB-BOSQUE: floresta morta em pé, vista do chão -------------------
     Composta com TRONCOS VERTICAIS, não com formas de caverna. A versão
     anterior usava `dentes`/`arcos` (estalactite e arcada de rocha) e a cena
     inteira lia como gruta — o que o jogo não é. O que faz o olho dizer
     "floresta" à primeira vista são linhas verticais repetidas em várias
     profundidades; tudo mais é secundário.

     A densidade cai e a espessura sobe conforme aproxima: longe é uma cerca
     de vultos finos, perto são poucos troncos grossos que emolduram a tela. */
  /* O campo `brilho` era uma escada CRESCENTE pro fundo (+0.21 no plano mais
     distante, -0.48 no mais próximo). Somado a uma `bruma` mais clara que o
     céu, isso punha a floresta distante em luminância ~108 contra um céu de
     25-69 — o fundo mais claro que o céu, que é a assinatura visual de
     caverna. A escada agora é decrescente do céu pro primeiro plano, que é
     como perspectiva atmosférica funciona ao ar livre. */
  /* Os `rel` daqui foram corrigidos DEPOIS da Várzea e da Clareira, e por
     isso ficaram errados por mais tempo: com a âncora no meio da sala e as 12
     fileiras que o `abrirCeu` acrescenta, tudo que tinha `rel` acima de 1.0
     caía de 150 a 240 px ABAIXO da borda de baixo da tela.

     Consequência medida: as cinco `massa` desta área NUNCA eram desenhadas, e
     os contrafortes dos troncos — onde está todo o trabalho de forma — também
     não. Sobrava o meio reto do tronco, e é por isso que a floresta lia como
     um monte de postes flutuando sobre uma faixa de cor chapada.

     Estas são as três primeiras salas do jogo. */
  raizes: [
    { p: 0.045, d: 1.00, cor: 'distante', brilho: -0.05, formas: [
      /* O fogo já passou por aqui e segue queimando ALÉM: colunas de fumaça
         subindo de trás da mata distante, a base avermelhada pelo que arde. */
      { f: 'colunaFumaca', rel: 0.66, passo: 560, dens: 0.62, altMin: 0.7, altMax: 1.35,
        largMin: 26, largMax: 62, semente: 15 },
      { f: 'massa', lado: 'baixo', rel: 0.66, amp: 44, escala: 0.0011, semente: 19, passo: 18 },
      { f: 'troncosColossais', rel: 0.62, passo: 120, dens: 0.92,
        largMin: 5, largMax: 13, semente: 11, altura: [0.30, 0.46] },
    ] },
    { p: 0.095, d: 0.88, cor: 'distante', brilho: -0.12, formas: [
      { f: 'troncosColossais', rel: 0.66, passo: 170, dens: 0.82,
        largMin: 8, largMax: 20, semente: 23, altura: [0.42, 0.62] },
      { f: 'galhos', rel: 0.20, passo: 260, dens: 0.55, escalaLarg: 0.45, semente: 29 },
      { f: 'massa', lado: 'baixo', rel: 0.70, amp: 56, escala: 0.0017, semente: 31, passo: 15 },
      /* O fogo que PASSOU ainda queima nos morros do meio: línguas de 60–90
         px, do lado de onde o incêndio veio. Sem este plano o fogo de Raízes
         era só um pavio no horizonte. */
      { f: 'incendio', rel: 0.70, fundo: 1, solo: { amp: 56, escala: 0.0017, semente: 31 },
        escala: 34, passo: 13, clarao: 0.26, semente: 33 },
    ] },
    { p: 0.17, d: 0.73, cor: 'medio', brilho: -0.2, formas: [
      { f: 'troncosColossais', rel: 0.70, passo: 250, dens: 0.7,
        largMin: 13, largMax: 32, semente: 37, altura: [0.58, 0.85] },
      { f: 'arvoreEmChamas', rel: 0.74, passo: 520, dens: 0.55, altMin: 150, altMax: 280,
        largMin: 6, largMax: 13, semente: 38 },
      { f: 'galhos', rel: 0.12, passo: 330, dens: 0.6, escalaLarg: 0.7, semente: 39 },
      { f: 'folhagem', rel: 0.10, passo: 300, dens: 0.5, rMin: 40, rMax: 110, semente: 41 },
    ] },
    { p: 0.28, d: 0.58, cor: 'medio', brilho: -0.28, formas: [
      { f: 'troncosColossais', rel: 0.74, passo: 340, dens: 0.62,
        largMin: 18, largMax: 44, semente: 43, altura: [0.8, 1.15] },
      // Raízes aéreas descendo do alto: a assinatura do sub-bosque, e o que
      // impede a faixa vertical de virar só "cerca de postes".
      { f: 'raizes', rel: -0.02, passo: 230, dens: 0.55, compMin: 160, compMax: 420,
        largMin: 7, largMax: 20, semente: 47 },
      { f: 'galhos', rel: 0.06, passo: 380, dens: 0.5, escalaLarg: 0.9, semente: 49 },
    ] },
    { p: 0.42, d: 0.40, cor: 'proximo', brilho: -0.36, formas: [
      { f: 'troncosColossais', rel: 0.80, passo: 460, dens: 0.55,
        largMin: 26, largMax: 62, semente: 59, altura: [1.1, 1.5] },
      { f: 'massa', lado: 'baixo', rel: 0.80, amp: 70, escala: 0.0036, semente: 61,
        passo: 11, picos: 0.35 },
    ] },
    { p: 0.60, d: 0.24, cor: 'proximo', brilho: -0.45, formas: [
      { f: 'raizes', rel: -0.08, passo: 280, dens: 0.45, compMin: 240, compMax: 620,
        largMin: 12, largMax: 34, semente: 67 },
      { f: 'massa', lado: 'baixo', rel: 0.86, amp: 74, escala: 0.0048, semente: 71,
        passo: 10, picos: 0.45 },
    ] },
    /* MEIO-CAMPO. Não havia NADA com paralaxe entre 0,28 e 1,0 atravessando o
       espaço de jogo: as camadas distantes ficavam lá atrás, as próximas
       apareciam só como dois verticais pretos nas bordas, e sem nada
       ocluindo nada não há profundidade — só camadas empilhadas.

       E a composição inteira era ortogonal: uns trinta verticais paralelos,
       três horizontais e nenhuma diagonal. `galhos` com espessura 3,2 vira um
       TRONCO TOMBADO arqueando por 900 px — a diagonal que faltava. */
    { p: 0.72, d: 0.16, cor: 'proximo', brilho: -0.50, veu: 0, formas: [
      { f: 'raizes', rel: -0.15, passo: 190, dens: 0.62, compMin: 380, compMax: 900,
        largMin: 9, largMax: 22, semente: 83 },
      /* Escala 3,2 dava vigas de 50 px atravessando o quadro inteiro de
         ponta a ponta: as linhas mais fortes da cena eram duas horizontais
         quase retas e de espessura constante, que é a definição de cabo
         industrial. Menos densas e menos grossas, elas voltam a ser galho. */
      { f: 'galhos', rel: 0.52, passo: 940, dens: 0.3, escalaLarg: 1.9, semente: 89 },
    ] },
    { p: 0.82, d: 0.10, cor: 'proximo', brilho: -0.56, veu: 0, formas: [
      { f: 'troncosColossais', rel: 0.90, passo: 620, dens: 0.42,
        largMin: 40, largMax: 96, semente: 73, altura: [1.6, 2.1] },
      { f: 'massa', lado: 'baixo', rel: 0.90, amp: 62, escala: 0.0062, semente: 79,
        passo: 10, picos: 0.35 },
    ] },
  ],

  /* --- VÁRZEA: juncos, troncos submersos, lâmina d'água ------------------
     Todos os `rel` daqui subiram 0.20 de uma vez. A âncora do parallax é o
     meio da sala, mas depois que `abrirCeu` passou a acrescentar 12 fileiras
     de céu no topo, o chão de verdade ficou bem abaixo desse meio: a lâmina
     d'água caía em ~94% da altura da tela, ou seja, fora do quadro. A área
     que dá nome à fase não mostrava água nenhuma, e a faixa do meio da tela
     ficava vazia. -------------------------------------------------------- */
  varzea: [
    { p: 0.045, d: 1.00, cor: 'distante', brilho: -0.05, formas: [
      { f: 'massa', lado: 'baixo', rel: 0.52, amp: 96, escala: 0.0009, semente: 101, passo: 18 },
    ] },
    { p: 0.095, d: 0.87, cor: 'distante', brilho: -0.12, formas: [
      // Fumaça industrial ao longe: a várzea não queima, ela recebe.
      { f: 'colunaFumaca', rel: 0.58, passo: 900, dens: 0.4, altMin: 0.6, altMax: 1.1,
        largMin: 20, largMax: 44, semente: 105 },
      { f: 'massa', lado: 'baixo', rel: 0.60, amp: 86, escala: 0.0016, semente: 103, passo: 16 },
      { f: 'troncos', rel: 0.58, passo: 340, dens: 0.6, compMin: 90, compMax: 200, semente: 107 },
      { f: 'juncos', rel: 0.60, passo: 70, dens: 0.7, compMin: 34, compMax: 90, escalaLarg: 0.6, semente: 109 },
    ] },
    { p: 0.17, d: 0.72, cor: 'medio', brilho: -0.2, formas: [
      { f: 'massa', lado: 'baixo', rel: 0.66, amp: 74, escala: 0.0024, semente: 113, passo: 14 },
      { f: 'juncos', rel: 0.66, passo: 84, dens: 0.78, compMin: 56, compMax: 150, escalaLarg: 0.8, semente: 127 },
    ] },
    { p: 0.28, d: 0.56, cor: 'medio', brilho: -0.28, formas: [
      { f: 'agua', rel: 0.70, altura: 420, semente: 131 },
      // O furta-cor do petróleo e o que boia: é aqui que a várzea adoece.
      { f: 'oleo', rel: 0.70, escala: 1.4, semente: 133 },
      // E o óleo PEGA FOGO: manchas baixas queimando sobre a lâmina, de onde
      // sobe fumaça preta.
      { f: 'incendio', rel: 0.70, fundo: 1, escala: 20, passo: 11, clarao: 0.18, semente: 134 },
      { f: 'troncos', rel: 0.70, passo: 400, dens: 0.66, compMin: 150, compMax: 330, semente: 137 },
      { f: 'lixo', rel: 0.70, passo: 130, dens: 0.7, escala: 1.6, semente: 135 },
    ] },
    { p: 0.42, d: 0.40, cor: 'proximo', brilho: -0.36, formas: [
      { f: 'massa', lado: 'baixo', rel: 0.82, amp: 66, escala: 0.0034, semente: 139, passo: 12 },
      // Capivara é bicho de várzea — é ela que foge por aqui.
      { f: 'manada', rel: 0.82, solo: { amp: 66, escala: 0.0034, semente: 139 },
        especies: ['capivara'], tamMin: 34, tamMax: 50, passo: 1900, periodo: 17, semente: 141 },
      { f: 'juncos', rel: 0.82, passo: 96, dens: 0.8, compMin: 90, compMax: 250, semente: 149 },
    ] },
    { p: 0.60, d: 0.24, cor: 'proximo', brilho: -0.45, formas: [
      { f: 'massa', lado: 'baixo', rel: 0.92, amp: 60, escala: 0.0046, semente: 151, passo: 11 },
      { f: 'troncos', rel: 0.90, passo: 520, dens: 0.5, compMin: 200, compMax: 380, semente: 157 },
    ] },
    { p: 0.82, d: 0.10, cor: 'proximo', brilho: -0.56, veu: 0, formas: [
      { f: 'juncos', rel: 1.06, passo: 140, dens: 0.6, compMin: 180, compMax: 420, escalaLarg: 1.6, semente: 163 },
    ] },
  ],

  /* --- CÂNION: as ruínas da fábrica da Fase 1 ---------------------------- */
  /* --- CLAREIRA: uma FERIDA DENTRO DA FLORESTA -------------------------
     A composição anterior era só indústria — chaminé, torre, esteira, cabo —
     e desenhava uma `massa lado:'cima'`, ou seja, literalmente um TETO. O
     resultado era um interior de fábrica: nem clareira, nem floresta.

     O nome da área diz o que ela é. Uma clareira é um BURACO na mata, e só
     lê como buraco se a mata estiver visível em volta. Então:
       · planos DISTANTES = troncos queimados, a floresta que sobrou em pé;
       · planos MÉDIOS e PRÓXIMOS = as ruínas, que ficam DENTRO do buraco.
     A linha do chão distante desceu de 0.70 para ~1.05: em 0.70 ela tapava
     metade da tela e o céu virava uma faixa. ---------------------------- */
  /* Os `rel` de tudo que fica no CHÃO subiram 0.18 (o mesmo problema da
     Várzea: a âncora do parallax é o meio da sala e, com as 12 fileiras de
     céu do `abrirCeu`, o chão de verdade ficou bem abaixo dela). Chaminés,
     torres, esteiras e escombros — as ruínas da fábrica da Fase 1, que são o
     assunto desta área — caíam todas abaixo da borda de baixo do quadro e
     nunca apareciam. O que sobrava na tela eram só os troncos finos. */
  clareira: [
    { p: 0.045, d: 1.00, cor: 'distante', brilho: -0.05, formas: [
      // A borda da mata no horizonte: baixa, densa, quase dissolvida na bruma.
      { f: 'troncosColossais', rel: 0.86, passo: 110, dens: 0.9,
        largMin: 4, largMax: 11, semente: 201, altura: [0.26, 0.40] },
      { f: 'colunaFumaca', rel: 0.9, passo: 560, dens: 0.55, altMin: 0.7, altMax: 1.2,
        largMin: 32, largMax: 74, semente: 205 },
      { f: 'massa', lado: 'baixo', rel: 0.92, amp: 70, escala: 0.0009, semente: 203,
        passo: 18, picos: 0.5 },
      { f: 'incendio', rel: 0.92, solo: { amp: 70, escala: 0.0009, semente: 203, picos: 0.5 },
        escala: 12, passo: 9, clarao: 0.3, semente: 209 },
    ] },
    { p: 0.095, d: 0.87, cor: 'distante', brilho: -0.12, formas: [
      { f: 'troncosColossais', rel: 0.88, passo: 165, dens: 0.78,
        largMin: 7, largMax: 18, semente: 207, altura: [0.38, 0.58] },
      // As chaminés começam a aparecer ENTRE as árvores, não no lugar delas.
      { f: 'chamines', rel: 0.84, passo: 320, dens: 0.4, altMin: 120, altMax: 300,
        escalaLarg: 0.6, torcao: 0.2, semente: 211 },
      { f: 'fumaca', rel: 0.62, passo: 300, dens: 0.4, semente: 213 },
    ] },
    { p: 0.17, d: 0.72, cor: 'medio', brilho: -0.2, formas: [
      { f: 'troncosColossais', rel: 0.90, passo: 300, dens: 0.5,
        largMin: 12, largMax: 28, semente: 215, altura: [0.55, 0.8] },
      // As árvores que ainda queimam: base atrás da crista, copa em chamas.
      { f: 'arvoreEmChamas', rel: 0.92, passo: 340, dens: 0.75, altMin: 130, altMax: 260,
        largMin: 6, largMax: 12, semente: 216 },
      { f: 'massa', lado: 'baixo', rel: 0.88, amp: 82, escala: 0.0022, semente: 217,
        passo: 14, picos: 0.7 },
      { f: 'incendio', rel: 0.88, solo: { amp: 82, escala: 0.0022, semente: 217, picos: 0.7 },
        escala: 20, passo: 12, clarao: 0.22, semente: 219 },
      { f: 'torres', rel: 0.84, passo: 340, dens: 0.6, altMin: 110, altMax: 260, escalaLarg: 0.75, semente: 223 },
      { f: 'chamines', rel: 0.84, passo: 300, dens: 0.5, altMin: 140, altMax: 330,
        escalaLarg: 0.8, torcao: 0.22, semente: 227 },
    ] },
    { p: 0.28, d: 0.56, cor: 'medio', brilho: -0.28, formas: [
      { f: 'arvoreEmChamas', rel: 0.84, passo: 520, dens: 0.65, altMin: 220, altMax: 400,
        largMin: 10, largMax: 18, semente: 228 },
      { f: 'esteiras', rel: 0.62, passo: 480, dens: 0.7, escalaLarg: 0.85, semente: 229 },
      { f: 'massa', lado: 'baixo', rel: 0.80, amp: 80, escala: 0.003, semente: 233, passo: 13, picos: 0.6 },
      { f: 'escombros', rel: 0.80, passo: 200, dens: 0.6, escalaLarg: 0.9, semente: 239 },
    ] },
    { p: 0.42, d: 0.40, cor: 'proximo', brilho: -0.36, formas: [
      { f: 'cabos', rel: 0.16, passo: 300, dens: 0.72, escalaLarg: 1, semente: 241 },
      { f: 'chamines', rel: 0.86, passo: 420, dens: 0.42, altMin: 260, altMax: 520,
        escalaLarg: 1.15, torcao: 0.24, semente: 251 },
      { f: 'massa', lado: 'baixo', rel: 0.88, amp: 78, escala: 0.0042, semente: 257, passo: 11, picos: 0.7 },
    ] },
    { p: 0.60, d: 0.24, cor: 'proximo', brilho: -0.45, formas: [
      { f: 'esteiras', rel: 0.82, passo: 620, dens: 0.5, escalaLarg: 1.2, semente: 263 },
      { f: 'massa', lado: 'baixo', rel: 0.98, amp: 70, escala: 0.0055, semente: 269, passo: 10, picos: 0.6 },
      { f: 'escombros', rel: 0.98, passo: 230, dens: 0.55, escalaLarg: 1.2, semente: 271 },
    ] },
    { p: 0.82, d: 0.10, cor: 'proximo', brilho: -0.56, veu: 0, formas: [
      { f: 'cabos', rel: -0.10, passo: 380, dens: 0.5, escalaLarg: 1.8, semente: 277 },
      { f: 'escombros', rel: 1.12, passo: 300, dens: 0.45, escalaLarg: 1.8, semente: 281 },
    ] },
  ],

  /* --- DOSSEL: a árvore-mãe, troncos colossais e folhagem ---------------- */
  dossel: [
    { p: 0.045, d: 1.00, cor: 'distante', brilho: -0.05, formas: [
      { f: 'colunaFumaca', rel: 0.95, passo: 640, dens: 0.55, altMin: 0.8, altMax: 1.4,
        largMin: 30, largMax: 70, semente: 303 },
      { f: 'troncosColossais', rel: 1.35, passo: 300, dens: 0.85, largMin: 40, largMax: 110, semente: 301 },
    ] },
    /* O DESMATE visto de cima. Entre os troncos colossais aparece o que
       sobrou da encosta: um morro pelado, a fileira de tocos claros e a
       máquina parada na borda, com o farol aceso. */
    { p: 0.07, d: 0.93, cor: 'distante', brilho: -0.09, formas: [
      { f: 'massa', lado: 'baixo', rel: 0.86, amp: 60, escala: 0.0014, semente: 304, passo: 16 },
      { f: 'tocos', rel: 0.86, solo: { amp: 60, escala: 0.0014, semente: 304 },
        passo: 46, dens: 0.8, escala: 0.45, semente: 305 },
      // A máquina: uma por tela, praticamente sempre (era 0,6 e muita tela
      // ficava sem ela).
      { f: 'maquina', rel: 0.86, solo: { amp: 60, escala: 0.0014, semente: 304 },
        passo: 1400, dens: 0.95, escala: 0.5, semente: 306 },
      /* Queimada depois do corte: a encosta desmatada ARDE atrás da máquina.
         É o desmatamento e o incêndio na mesma imagem. */
      { f: 'incendio', rel: 0.86, fundo: 1, solo: { amp: 60, escala: 0.0014, semente: 304 },
        escala: 26, passo: 11, clarao: 0.28, semente: 307 },
    ] },
    { p: 0.095, d: 0.87, cor: 'distante', brilho: -0.12, formas: [
      { f: 'troncosColossais', rel: 1.4, passo: 340, dens: 0.7, largMin: 30, largMax: 90, semente: 307 },
      { f: 'folhagem', rel: 0.22, passo: 210, dens: 0.8, rMin: 70, rMax: 180, semente: 311 },
    ] },
    { p: 0.17, d: 0.72, cor: 'medio', brilho: -0.2, formas: [
      { f: 'galhos', rel: 0.20, passo: 380, dens: 0.7, escalaLarg: 0.7, semente: 313 },
      { f: 'massa', lado: 'baixo', rel: 0.92, amp: 88, escala: 0.0021, semente: 317, passo: 14 },
      { f: 'tocos', rel: 0.92, solo: { amp: 88, escala: 0.0021, semente: 317 },
        passo: 110, dens: 0.65, escala: 0.9, semente: 319 },
      { f: 'folhagem', rel: 0.30, passo: 250, dens: 0.72, rMin: 60, rMax: 150, semente: 331 },
    ] },
    { p: 0.28, d: 0.56, cor: 'medio', brilho: -0.28, formas: [
      { f: 'troncosColossais', rel: 1.5, passo: 420, dens: 0.55, largMin: 46, largMax: 130, semente: 337 },
      { f: 'galhos', rel: 0.36, passo: 440, dens: 0.65, escalaLarg: 0.9, semente: 347 },
    ] },
    { p: 0.42, d: 0.40, cor: 'proximo', brilho: -0.36, formas: [
      { f: 'massa', lado: 'baixo', rel: 1.04, amp: 74, escala: 0.0034, semente: 349, passo: 12 },
      { f: 'folhagem', rel: 0.14, passo: 300, dens: 0.66, rMin: 90, rMax: 220, semente: 353 },
    ] },
    { p: 0.60, d: 0.24, cor: 'proximo', brilho: -0.45, formas: [
      { f: 'troncosColossais', rel: 1.6, passo: 560, dens: 0.4, largMin: 60, largMax: 170, semente: 359 },
      { f: 'massa', lado: 'baixo', rel: 1.14, amp: 66, escala: 0.005, semente: 367, passo: 11 },
    ] },
    { p: 0.82, d: 0.10, cor: 'proximo', brilho: -0.56, veu: 0, formas: [
      { f: 'galhos', rel: -0.12, passo: 520, dens: 0.5, escalaLarg: 1.6, semente: 373 },
      { f: 'folhagem', rel: -0.16, passo: 400, dens: 0.5, rMin: 120, rMax: 280, semente: 379 },
    ] },
  ],

  /* --- CORAÇÃO: nada de rocha; carne, lobos, veias ----------------------- */
  /* --- CORAÇÃO: a floresta INCHADA, ainda a céu aberto -------------------
     A composição anterior era só `organico` — e metade das massas estava com
     `rel` acima de 0.5, ou seja, na parte de CIMA da tela. O efeito era uma
     caverna de bolhas: o céu sumia atrás de massas suspensas e a área final
     parecia um interior de gruta, não o coração de uma floresta.

     Aqui a corrupção vem DO CHÃO. As massas orgânicas incham a partir de
     baixo, e as árvores continuam presentes — deformadas, fundidas com a
     coisa que cresceu nelas, mas presentes. É o que mantém a área ligada ao
     resto do jogo: o jogador precisa reconhecer que ainda está na floresta,
     e que ela virou isto. Uma caverna genérica não diria nada.

     O céu fica aberto e é a coisa mais clara da tela, como nas outras áreas —
     só que aqui ele é violeta e a luz vem de baixo, do próprio Coração, o que
     inverte a leitura e é o que dá o desconforto. -------------------------- */
  coracao: [
    { p: 0.045, d: 1.00, cor: 'distante', brilho: -0.05, formas: [
      // Linha do horizonte: árvores doentes, baixas, quase dissolvidas.
      // Pluma química: a mesma coluna, na cor da área.
      { f: 'colunaFumaca', rel: 1.0, passo: 600, dens: 0.6, altMin: 0.8, altMax: 1.4,
        largMin: 30, largMax: 66, semente: 400 },
      { f: 'troncosColossais', rel: 1.04, passo: 130, dens: 0.85,
        largMin: 5, largMax: 14, semente: 401, altura: [0.24, 0.40] },
      { f: 'organico', rel: 1.12, passo: 300, dens: 0.9, rMin: 120, rMax: 300, semente: 403 },
    ] },
    { p: 0.095, d: 0.87, cor: 'distante', brilho: -0.12, formas: [
      { f: 'troncosColossais', rel: 1.06, passo: 190, dens: 0.7,
        largMin: 8, largMax: 22, semente: 407, altura: [0.36, 0.56] },
      { f: 'organico', rel: 1.14, passo: 260, dens: 0.85, rMin: 110, rMax: 280, semente: 409 },
    ] },
    { p: 0.17, d: 0.72, cor: 'medio', brilho: -0.2, formas: [
      { f: 'troncosColossais', rel: 1.08, passo: 320, dens: 0.55,
        largMin: 14, largMax: 34, semente: 417, altura: [0.5, 0.78] },
      { f: 'organico', rel: 1.16, passo: 240, dens: 0.8, rMin: 90, rMax: 240, semente: 419 },
      // As raízes aéreas continuam — mas curtas, para não virarem cortina.
      { f: 'raizes', rel: -0.04, passo: 300, dens: 0.32, compMin: 120, compMax: 300,
        largMin: 10, largMax: 26, semente: 421 },
    ] },
    { p: 0.28, d: 0.56, cor: 'medio', brilho: -0.28, formas: [
      { f: 'organico', rel: 1.02, passo: 300, dens: 0.7, rMin: 100, rMax: 260, semente: 431 },
      { f: 'organico', rel: 1.2, passo: 280, dens: 0.7, rMin: 110, rMax: 270, semente: 433 },

    ] },
    { p: 0.42, d: 0.40, cor: 'proximo', brilho: -0.36, formas: [
      { f: 'troncosColossais', rel: 1.14, passo: 480, dens: 0.45,
        largMin: 26, largMax: 60, semente: 437, altura: [0.9, 1.3] },
      { f: 'organico', rel: 1.1, passo: 320, dens: 0.75, rMin: 130, rMax: 300, semente: 439 },
    ] },
    { p: 0.60, d: 0.24, cor: 'proximo', brilho: -0.45, formas: [
      { f: 'organico', rel: 1.18, passo: 340, dens: 0.6, rMin: 120, rMax: 290, semente: 443 },
      { f: 'organico', rel: 1.3, passo: 360, dens: 0.6, rMin: 140, rMax: 320, semente: 449 },
    ] },
    { p: 0.82, d: 0.10, cor: 'proximo', brilho: -0.56, veu: 0, formas: [
      { f: 'organico', rel: 1.34, passo: 420, dens: 0.5, rMin: 170, rMax: 380, semente: 457 },
    ] },
  ],
};

/** Depois de qual camada os raios entram (pra serem ocluídos pelas de frente). */
const RAIOS_APOS = { raizes: 3, varzea: 3, clareira: 3, dossel: 2, coracao: 3 };

/* =========================================================================
   6 · LUZ
   ========================================================================= */

/** A luz dominante da sala; se a sala não declarar nenhuma, uma no alto. */
function luzDominante(sala) {
  const l = sala.luzes;
  if (l && l.length) return l.find((x) => x.feixe) || l[0];
  return { x: sala.largura * 0.5, y: 0, raio: 320, intensidade: 0.7, feixe: true };
}

/**
 * Poça de luz atrás de TUDO. É contra ela que as silhuetas leem — sem isso a
 * paleta poluída (tudo entre #08 e #24) vira uma mancha uniforme por mais
 * camadas que existam. Vai na cena, não no emissivo: precisa ser OCLUÍDA
 * pelas camadas da frente, senão brilha por cima da rocha.
 */
export function desenharBrilhoDeFundo(render, sala, mundo) {
  const l = luzDominante(sala);
  const P = 0.18;
  render.camada(P, (ctx, t, camera) => {
    const dir = direcaoLuzArea(sala.area);
    const raio = Math.max(camera.largura, camera.altura) / camera.zoom * 0.95;
    const cx = l.x + dir.x * raio * 0.35;
    const cy = l.y + dir.y * raio * 0.42;
    const g = ctx.createRadialGradient(cx, cy, raio * 0.05, cx, cy, raio);
    // 0,16 no estado poluído somava ~12 níveis no centro do halo: a poça de
    // luz que deveria ser o ponto focal da sala não existia.
    const forca = (l.intensidade ?? 1) * lerp(0.3, 0.44, t.pureza ?? 0);
    g.addColorStop(0, rgba(t.luz, forca));
    g.addColorStop(0.45, rgba(t.luz, forca * 0.34));
    g.addColorStop(1, rgba(t.luz, 0));
    ctx.fillStyle = g;
    ctx.fillRect(cx - raio, cy - raio, raio * 2, raio * 2);
  });
}

/**
 * Luz volumétrica: o corpo do feixe vai na CENA (para ser ocluído pelas
 * camadas próximas e pelo terreno) e só o núcleo vai no emissivo (para virar
 * bloom). Fazer tudo no emissivo é o erro que deixa o raio brilhando por cima
 * da rocha e do jogador.
 *
 * Todos os feixes da área compartilham `anguloLuzArea`.
 */
export function desenharRaios(render, sala, mundo) {
  const luzes = sala.luzes;
  if (!luzes || !luzes.length) return;
  const ang = anguloLuzArea(sala.area);
  const tempo = mundo.laco?.tempo ?? 0;
  const P = 0.55;

  /* A BOCA de todo feixe fica ACIMA do topo da sala. Nenhuma sala declara
     `feixe: true` — o campo nunca foi usado — então o caminho que valia era o
     do "ponto de luz solto", que punha a boca do trapézio no meio do ar, à
     vista. Num jogo a céu aberto a luz desce do céu, ponto: a boca sai de
     cena por cima e o que se vê é só a coluna atravessando a floresta.
     (Era isso, junto com a aresta dura do degradê, que desenhava um retângulo
     claro no meio do Coração.) */
  const yBoca = -90;
  const alcance = (sala.altura + 260) * 1.2;

  /* Com fumaça no céu, o sol quase não passa — e o pouco que passa sai
     laranja. Os fachos frios vindos de cima eram a luz mais clara da tela e
     contradiziam o fogo como fonte; agora eles ficam como RECOMPENSA do
     estado limpo. */
  const abafa = lerp(1, 0.4, forcaFumaca(sala.area, mundo.tema?.pureza ?? 0));
  const aquece = forcaFogo(sala.area, mundo.tema?.pureza ?? 0);
  const chF = chamaDe(sala.area);

  render.camada(P, (ctx, t, camera) => {
    const comp = Math.max(alcance, camera.altura / camera.zoom * 1.4);
    const corF = aquece > 0.02 ? misturarHex(t.luz, chF.meio, 0.55 * aquece) : t.luz;
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < luzes.length; i++) {
      const l = luzes[i];
      const inten = l.intensidade ?? 1;
      // A coluna desce inclinada: onde ela CRUZA a altura da luz declarada é
      // que ela deve passar, então a boca recua na horizontal pelo tanto que
      // o ângulo vai deslocá-la na descida.
      const queda = l.y - yBoca;
      const x = l.x + Math.sin(ang) * queda;
      // Três feixes de larguras diferentes: um feixe só tem borda dura de
      // trapézio e denuncia o truque; três sobrepostos dão penumbra.
      // Antes da correção da boca, todo feixe passava por `inten * 0.45` por
      // não declarar `feixe`. Ao tirar esse fator, manter os mesmos números
      // aqui triplicava a luz — e numa área restaurada, com brilhoBloom 0.85,
      // o feixe estourava num borrão branco sem forma nenhuma.
      feixeLuz(ctx, x, yBoca, comp, 230, ang, corF, inten * 0.2 * abafa);
      feixeLuz(ctx, x - 26, yBoca, comp * 0.88, 104, ang + 0.045, corF, inten * 0.22 * abafa);
      feixeLuz(ctx, x + 30, yBoca, comp * 0.94, 52, ang - 0.035, corF, inten * 0.26 * abafa);
      poeiraNoFeixe(ctx, t, x, yBoca, comp, 210, ang, inten, tempo, i);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  });

  render.emissivo(P, (ctx, t, camera) => {
    const comp = Math.max(alcance, camera.altura / camera.zoom * 1.3);
    const corF = aquece > 0.02 ? misturarHex(t.luz, chF.meio, 0.55 * aquece) : t.luz;
    for (const l of luzes) {
      const inten = l.intensidade ?? 1;
      const x = l.x + Math.sin(ang) * (l.y - yBoca);
      // O passe emissivo ainda passa pelo bloom, que multiplica por
      // brilhoBloom (0.85 no Coração restaurado): o que entra aqui tem que
      // ser bem mais fraco do que parece necessário olhando só este trecho.
      const g = lerp(1, 0.5, clamp01(t.brilhoBloom ?? 0.4));
      feixeLuz(ctx, x, yBoca, comp, 44, ang, corF, inten * 0.13 * g * abafa);
      feixeLuz(ctx, x, yBoca, comp * 0.6, 16, ang, corF, inten * 0.16 * g * abafa);
    }
  });
}

/**
 * Motas de poeira DENTRO do feixe — é o que torna o feixe volumétrico em vez
 * de um triângulo pintado. Função determinística do índice: sem lista, sem
 * alocação, e a mesma mota está sempre no mesmo lugar no mesmo instante.
 */
function poeiraNoFeixe(ctx, tema, x, y, comp, largura, ang, inten, tempo, semente) {
  const N = 46;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.fillStyle = tema.particula;
  for (let i = 0; i < N; i++) {
    const h1 = hash2(i, semente, 601);
    const h2 = hash2(i, semente + 1, 607);
    const h3 = hash2(i, semente + 2, 613);
    // desce devagar e reentra pelo topo
    const v = (h1 * comp + tempo * lerp(5, 17, h2)) % comp;
    const k = v / comp;
    const meia = lerp(largura * 0.32, largura, k);
    const u = (h2 * 2 - 1) * meia;
    // apaga nas bordas do feixe e no fim do alcance
    const borda = 1 - Math.abs(u) / meia;
    const alfa = inten * 0.5 * borda * borda * (1 - k * k) * lerp(0.3, 1, h3);
    if (alfa < 0.004) continue;
    ctx.globalAlpha = alfa;
    ctx.beginPath();
    ctx.arc(u, v, lerp(0.7, 2.1, h3), 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/* =========================================================================
   7 · O PASSE COMPLETO
   ========================================================================= */

export function desenharParallax(render, sala, mundo) {
  const tema = mundo.tema;
  const camadas = CAMADAS[sala.area] || CAMADAS.raizes;
  const tempo = mundo.laco?.tempo ?? 0;
  const ang = anguloLuzArea(sala.area);
  const quandoRaios = RAIOS_APOS[sala.area] ?? 3;

  _reduzido = !!render.movimentoReduzido;
  _jogMundoX = mundo.jogador?.centroX ?? 0;
  desenharBrilhoDeFundo(render, sala, mundo);

  // A cor da camada ANTERIOR é o que as aberturas em arco usam pra parecerem
  // vãos iluminados ao fundo em vez de buracos pretos.
  let corTras = cor(tema, 'distante', 1, 0.24);

  for (let i = 0; i < camadas.length; i++) {
    const s = camadas[i];
    const c = cor(tema, s.cor, s.d, s.brilho);
    // No zênite se atravessa pouca atmosfera: a mesma camada precisa ficar
    // MAIS ESCURA lá em cima, senão a silhueta fica mais clara que o céu.
    const cAlto = cor(tema, s.cor, s.d * 0.22, s.brilho - 0.22);
    // A base da camada é mais lavada que o topo: a bruma se acumula embaixo e
    // é isso que derrete um plano no seguinte em vez de deixar borda de adesivo.
    const cBase = cor(tema, s.cor, Math.min(1, s.d * 1.34 + 0.04), s.brilho + 0.06);
    const cTras = corTras;

    render.camada(s.p, (ctx, t, camera) => {
      const a = prepararAmb(camera, sala, t, tempo, s.p, c, cAlto, cBase, cTras, ang);
      for (let k = 0; k < s.formas.length; k++) {
        const f = s.formas[k];
        const fn = FORMAS[f.f];
        if (fn) fn(ctx, a, f);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    });

    /* O que QUEIMA também entra no bloom — mas no mesmo plano de parallax da
       camada, senão o brilho desliza por cima da silhueta ao andar. */
    if (s.formas.some((f) => FORMAS_LUZ[f.f])) {
      render.emissivo(s.p, (ctx, t, camera) => {
        const a = prepararAmb(camera, sala, t, tempo, s.p, c, cAlto, cBase, cTras, ang);
        for (const f of s.formas) FORMAS_LUZ[f.f]?.(ctx, a, f);
      });
    }

    corTras = c;

    // Véu só nas junções que precisam: uma névoa de tela cheia por camada é
    // meio megapixel de overdraw cada e lava o primeiro plano.
    /* Três véus de bruma empilhados davam 31% de bruma chapada sobre a faixa
       central da tela — justamente onde ficam o horizonte e os troncos
       médios. Era a definição de faixa morta. Composto agora dá ~11%. */
    const veu = s.veu != null ? s.veu : (i % 2 === 0 ? lerp(0.14, 0.03, i / (camadas.length - 1)) : 0);
    if (veu > 0) render.velarProfundidade(veu);

    if (i === quandoRaios) desenharRaios(render, sala, mundo);
    /* A fauna do horizonte entra DEPOIS dos dois planos mais distantes: antes
       deles, os troncos finos do fundo cortavam cada veado ao meio e a manada
       virava um emaranhado. É uma trapaça de profundidade (o horizonte é mais
       longe que esses troncos), e ninguém percebe — um bicho partido ao meio
       todo mundo percebe. */
    /* Depois do VÉU da camada 2, não da 1: cada véu de bruma pintado por
       cima lavava a manada escura até ela virar fantasma bege, com o fogo
       aparecendo através do corpo. */
    if (i === 2) desenharFaunaHorizonte(render, sala, mundo);
  }
}

/* =========================================================================
   8 · PRIMEIRO PLANO
   -------------------------------------------------------------------------
   Silhuetas quase pretas passando MAIS RÁPIDO que o jogador. É o que dá a
   sensação de estar DENTRO da cena em vez de olhar pra ela.

   O risco é óbvio: uma massa preta parada em cima do jogador. Duas defesas,
   as duas necessárias:
     · elementos ancorados nas BORDAS (base e topo da tela), nunca no miolo;
     · alfa que cai conforme o elemento cruza o centro horizontal da tela.
   A segunda é o que salva: quando a silhueta chegaria em cima do personagem,
   ela já está quase transparente, e ao sair pro canto volta a ser sólida.
   ========================================================================= */

/**
 * A máscara que impede o primeiro plano de tapar o jogador.
 *
 * Media a distância até o CENTRO DA TELA, o que quase sempre dá no mesmo —
 * menos exatamente quando não dá: nas bordas do mapa a câmera para de rolar e
 * o jogador desliza para o canto do quadro, que é justamente onde a máscara
 * deixa o primeiro plano 100% opaco. O personagem sumia atrás de um tronco no
 * primeiro segundo do jogo, na sala inicial.
 *
 * Agora a referência é a posição real do jogador. O contrato passa a ser o que
 * sempre deveria ter sido: nada do primeiro plano cobre o Guardião, esteja ele
 * onde estiver no quadro.
 *
 * @param {number} dx  distância horizontal entre o elemento e o jogador
 * @param {number} largura  largura da viewport, em mundo
 */
function opacidadeDeBorda(dx, largura) {
  const t = Math.abs(dx / (largura * 0.5));
  const k = clamp01((t - 0.30) / 0.42);
  return k * k * (3 - 2 * k);
}

const MOLDURA = {
  // O sub-bosque é FLORESTA: a moldura de cima é galho, não estalactite.
  // Com estalactite a cena inteira lia como gruta, por mais troncos que
  // houvesse no parallax — o primeiro plano é o que mais define o lugar,
  // porque é o que está mais perto e mais escuro.
  //
  // A base virou `moitaBaixa` depois de duas tentativas com `raizGrossa`. O
  // problema não era o desenho da raiz: era o CONCEITO. Um objeto alto e
  // escuro, sozinho, repetido ao longo da tela, sempre lê como "uma coisa" —
  // primeiro cone, depois barbatana, por mais que se conserte a curva. Na
  // referência (GRIS) o primeiro plano não é feito de objetos isolados: é uma
  // FAIXA baixa de terra com plantas pequenas recortadas em cima. Faixa não
  // vira objeto, e é o que emoldura sem competir com o personagem.
  raizes: { base: 'moitaBaixa', topo: 'galhoFolhado' },
  varzea: { base: 'folhaLarga', topo: 'juncoAlto' },
  clareira: { base: 'viga', topo: 'cano' },
  dossel: { base: 'raizGrossa', topo: 'galhoFolhado' },
  coracao: { base: 'lobo', topo: 'lobo' },
};

// Área da sala sendo emoldurada — as molduras precisam saber se ali queima.
let areaAtual = 'raizes';

export function desenharPrimeiroPlano(render, mundo) {
  const sala = mundo.sala;
  if (!sala) return;
  const P = 1.34;
  const molde = MOLDURA[sala.area] || MOLDURA.raizes;
  const tempo = mundo.laco?.tempo ?? 0;

  render.camada(P, (ctx, t, camera) => {
    const vw = camera.largura / camera.zoom;
    const vh = camera.altura / camera.zoom;
    const esq = camera.viewX * P;
    // Referência da máscara: o JOGADOR, não o centro do quadro. Nas bordas do
    // mapa a câmera para de rolar e ele desliza pro canto — que era onde o
    // primeiro plano ficava opaco e o cobria.
    const j = mundo.jogador;
    const refX = (j ? j.centroX : camera.viewX + vw * 0.5) * P;
    /* Moldura é elemento de QUADRO: cola na borda da tela, sempre. Ancorada
       no meio da sala, ela flutuava — em `raizes-02` a base caía a 571 px com
       um degrau de 46 níveis numa reta perfeita de 640 px (a aresta mais
       forte do quadro inteiro), e o topo ia parar 228 px ACIMA da tela, então
       aquela sala simplesmente não tinha copa. Duas salas vizinhas nem
       estavam emolduradas do mesmo jeito. Isto mata o parallax vertical da
       moldura, que é o certo. */
    const yBase = camera.viewY * P + vh;
    const yTopo = camera.viewY * P;

    ctx.fillStyle = t.primeiroPlano;
    ctx.strokeStyle = t.primeiroPlano;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    areaAtual = sala.area;
    desenharMolduraBase(ctx, molde.base, esq, vw, vh, yBase, refX, tempo, t);
    desenharMolduraTopo(ctx, molde.topo, esq, vw, vh, yTopo, refX, tempo, t);
    ctx.globalAlpha = 1;
    fogueirasDaFrente(ctx, t, sala.area, esq, vw, vh, yBase, refX,
      render.movimentoReduzido ? tempo * 0.33 : tempo, false);
    ctx.globalAlpha = 1;
  });
  render.emissivo(P, (ctx, t, camera) => {
    const vw = camera.largura / camera.zoom;
    const vh = camera.altura / camera.zoom;
    const j = mundo.jogador;
    const refX = (j ? j.centroX : camera.viewX + vw * 0.5) * P;
    fogueirasDaFrente(ctx, t, sala.area, camera.viewX * P, vw, vh, camera.viewY * P + vh,
      refX, tempo, true);
    ctx.globalAlpha = 1;
  });
}

/**
 * Tocos em brasa na moldura de baixo — o FOGO PERTO. Com o fogo só no horizonte e
 * no meio do fundo, o incêndio era sempre uma coisa lá longe; aqui ele queima
 * na borda da tela, entre o jogador e a câmera. Obedecem à mesma máscara da
 * moldura: somem conforme se aproximam do Guardião, então nunca ficam na
 * linha dele nem competem com ele.
 */
function fogueirasDaFrente(ctx, tema, area, esq, vw, vh, yBase, refX, tempo, luz) {
  const fogo = forcaFogo(area, tema.pureza ?? 0);
  if (fogo < 0.05) return;
  const ch = chamaDe(area);
  const passo = 1150;
  const x0 = Math.floor((esq - passo) / passo) * passo;
  for (let x = x0; x <= esq + vw + passo; x += passo) {
    const h = hash2(x, 877, 3);
    if (h > 0.6) continue;
    const px = x + (hash2(x, 881, 3) - 0.5) * passo * 0.5;
    const alfa = opacidadeDeBorda(px - refX, vw);
    if (alfa < 0.04) continue;
    const larg = lerp(110, 170, hash2(x, 883, 3));
    const alt = vh * lerp(0.16, 0.24, h);
    if (luz) {
      const g = lerp(1, 0.5, clamp01(tema.brilhoBloom ?? 0.4));
      focoDeLuz(ctx, px, yBase - alt * 0.45, alt * 1.1, ch.meio, 0.4 * alfa * g * fogo);
      continue;
    }
    ctx.globalAlpha = alfa;
    tocoEmBrasa(ctx, px, yBase, larg, alt, tempo, x, ch, fogo, tema.primeiroPlano,
      hash2(x, 887, 3) > 0.5 ? 1 : -1);
  }
}

function desenharMolduraBase(ctx, tipo, esq, vw, vh, yBase, refX, tempo, tema) {
  const passo = 430;
  const x0 = Math.floor((esq - passo) / passo) * passo;
  for (let x = x0; x <= esq + vw + passo; x += passo) {
    const h = hash2(x, 811, 5);
    if (h > 0.7) continue;
    const h2 = hash2(x, 821, 5);
    const h3 = hash2(x, 823, 5);
    const px = x + (h2 - 0.5) * passo * 0.75;
    const alfa = opacidadeDeBorda(px - refX, vw);
    if (alfa < 0.02) continue;
    ctx.globalAlpha = alfa;

    const escala = lerp(0.7, 1.5, h3);
    switch (tipo) {
      /* Faixa baixa de terra com plantas recortadas — ver a nota em MOLDURA
         sobre por que isto substituiu a raiz isolada. Três camadas:
         o monte, os talos e as folhas. Nenhuma delas sobe o bastante pra
         disputar espaço com o jogador. */
      case 'moitaBaixa': {
        const altMonte = vh * lerp(0.055, 0.14, h3);
        const largMonte = lerp(150, 330, h2);

        // 1 · o monte: contorno ondulado por ruído, base bem larga.
        ctx.beginPath();
        ctx.moveTo(px - largMonte, yBase + 80);
        const N = 16;
        for (let i = 0; i <= N; i++) {
          const t = i / N;
          const x = px + lerp(-largMonte, largMonte, t);
          // Perfil de meia-elipse com ruído por cima: monte de terra, não domo.
          const perfil = Math.sin(t * Math.PI);
          const n = ruido1(t * 5 + h * 9, 771) - 0.5;
          ctx.lineTo(x, yBase + 80 - altMonte * (perfil * (1 + n * 0.55) + 0.15));
        }
        ctx.lineTo(px + largMonte, yBase + 80);
        ctx.closePath();
        ctx.fill();

        // 2 · talos e folhas saindo do monte.
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineCap = 'round';
        for (let i = 0; i < 9; i++) {
          const hi = hash2(Math.round(px) + i * 31, 787, 3);
          const hj = hash2(Math.round(px) - i * 17, 797, 3);
          if (hi > 0.78) continue;
          const bx = px + lerp(-largMonte * 0.85, largMonte * 0.85, hj);
          const perfil = Math.sin(((bx - px) / largMonte * 0.5 + 0.5) * Math.PI);
          const by = yBase + 80 - altMonte * (perfil + 0.15);
          const alt = vh * lerp(0.05, 0.16, hi) * lerp(0.7, 1.3, hj);
          const verga = (hi - 0.5) * alt * 0.9;

          ctx.lineWidth = lerp(2, 5.5, hi);
          ctx.beginPath();
          ctx.moveTo(bx, by + 6);
          ctx.quadraticCurveTo(bx + verga * 0.3, by - alt * 0.55, bx + verga, by - alt);
          ctx.stroke();

          // Folha na ponta: elipse inclinada. Só em alguns, senão vira mato.
          if (hj > 0.45) {
            ctx.save();
            ctx.translate(bx + verga, by - alt);
            ctx.rotate(verga * 0.02 + (hi - 0.5) * 0.8);
            ctx.beginPath();
            ctx.ellipse(0, -alt * 0.1, alt * 0.1, alt * 0.26, 0, 0, TAU);
            ctx.fill();
            ctx.restore();
          }
        }
        break;
      }

      case 'raizGrossa': {
        // Raiz saindo do chão e arqueando.
        //
        // A versão anterior era uma massa SIMÉTRICA afinando até um bico, e
        // por isso lia como cone — chapéu de bruxa preto plantado na tela, o
        // defeito mais visível do primeiro plano em todas as áreas. Raiz de
        // verdade não é simétrica, não termina em agulha e não sobe reta: ela
        // ARQUEIA para um lado, mantém espessura na ponta e se divide.
        //
        // Agora é uma fita curva: uma linha de centro que arqueia, com largura
        // caindo suavemente, mais uma raiz secundária saindo do meio.
        // Baixa e larga, não alta e pontuda: elemento de primeiro plano que
        // sobe muito vira lâmina atravessando a tela e disputa com o jogador.
        const alt = vh * lerp(0.13, 0.30, h3);
        const larg = lerp(34, 88, h2);
        const arco = (h - 0.5) * 2.4;   // para que lado ela verga

        /** Fita curva com borda IRREGULAR — contorno liso lê como recorte. */
        const fita = (bx, byBase, altura, largura, curvatura, sem) => {
          const passos = 14;
          ctx.beginPath();
          for (let lado = 0; lado < 2; lado++) {
            const sinal = lado === 0 ? -1 : 1;
            for (let i = 0; i <= passos; i++) {
              const t = lado === 0 ? i / passos : 1 - i / passos;
              const cx2 = bx + curvatura * t * t * largura * 1.5;
              const cy2 = byBase - altura * t;
              // Largura cai devagar e PARA em 26% — a ponta continua grossa.
              // A ondulação por ruído é o que tira o ar de forma vetorial.
              const ondula = 1 + (ruido1(t * 6 + sem, 91) - 0.5) * 0.42;
              const w = largura * lerp(1, 0.26, t * t) * ondula;
              const px2 = cx2 + sinal * w;
              if (lado === 0 && i === 0) ctx.moveTo(px2, cy2);
              else ctx.lineTo(px2, cy2);
            }
          }
          ctx.closePath();
          ctx.fill();
        };

        fita(px, yBase + 60, alt + 60, larg, arco, h * 10);
        // Raiz secundária: sai do meio e verga para o outro lado. É o que
        // quebra a leitura de "objeto único repetido".
        if (h3 > 0.3) {
          fita(px + arco * larg * 0.5, yBase + 60 - alt * 0.4,
            alt * 0.55, larg * 0.4, -arco * 1.5, h2 * 10);
        }
        // Radículas finas saindo da base: detalhe pequeno que dá escala e
        // impede a massa de terminar numa curva limpa contra o chão.
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineCap = 'round';
        for (let i = 0; i < 4; i++) {
          const hi = hash2(Math.round(px) + i * 7, 863, 5);
          if (hi > 0.65) continue;
          const rx = px + (hi - 0.5) * larg * 2.4;
          const ry = yBase + 20 - hi * alt * 0.5;
          ctx.lineWidth = lerp(2, 6, hi);
          ctx.beginPath();
          ctx.moveTo(rx, yBase + 60);
          ctx.quadraticCurveTo(rx + (hi - 0.5) * 40, (yBase + ry) * 0.5,
            rx + (hi - 0.5) * 70, ry);
          ctx.stroke();
        }
        break;
      }
      case 'folhaLarga': {
        // par de folhas de várzea abrindo em leque
        const alt = vh * lerp(0.16, 0.34, h3);
        for (let i = 0; i < 3; i++) {
          const hi = hash2(x + i * 11, 829, 5);
          /* A moita do primeiro plano é a coisa mais próxima da câmera: é
             nela que a rajada tem que ser mais visível, senão o vento fica
             sendo uma coisa que só acontece no fundo. */
          const incl = (hi - 0.5) * 1.5 + Math.sin(tempo * 0.4 + hi * TAU) * 0.03
            + vento(tempo, px) * lerp(0.26, 0.1, hi);
          const c = alt * lerp(0.6, 1.15, hi);
          const w = c * 0.26;
          ctx.beginPath();
          ctx.moveTo(px, yBase + 40);
          ctx.quadraticCurveTo(px + Math.sin(incl) * c * 0.7 - Math.cos(incl) * w,
            yBase - c * 0.6, px + Math.sin(incl) * c, yBase - c);
          ctx.quadraticCurveTo(px + Math.sin(incl) * c * 0.7 + Math.cos(incl) * w,
            yBase - c * 0.5, px, yBase + 40);
          ctx.closePath();
          ctx.fill();
        }
        break;
      }
      case 'viga': {
        // viga de aço torta + parafusos: escala industrial no primeiro plano
        const alt = vh * lerp(0.22, 0.5, h3);
        const larg = lerp(26, 58, h2);
        const incl = (h2 - 0.5) * 0.4;
        ctx.save();
        ctx.translate(px, yBase + 40);
        ctx.rotate(incl);
        ctx.fillRect(-larg * 0.5, -alt, larg, alt + 60);
        ctx.fillRect(-larg * 1.35, -alt, larg * 2.7, larg * 0.42);
        ctx.restore();
        break;
      }
      case 'lobo': {
        const r = vh * lerp(0.13, 0.28, h3);
        const resp = 1 + 0.05 * Math.sin(tempo * lerp(0.5, 0.8, h) + h * TAU);
        ctx.beginPath();
        const n = 16;
        for (let i = 0; i <= n; i++) {
          const ang = Math.PI + (i / n) * Math.PI;
          const rr = r * resp * (0.75 + 0.25 * ruido1(i * 0.8 + h * 12, 839));
          const xx = px + Math.cos(ang) * rr * 1.4;
          const yy = yBase + 40 + Math.sin(ang) * rr;
          if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
        }
        ctx.closePath();
        ctx.fill();
        break;
      }
    }
    // pedra/entulho baixo colado na base: fecha o canto inferior sem tapar nada
    if (h3 < 0.5) {
      const w = lerp(70, 190, h2) * escala;
      ctx.beginPath();
      ctx.ellipse(px + (h2 - 0.5) * 160, yBase + 46, w, lerp(26, 58, h) * escala, 0, 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function desenharMolduraTopo(ctx, tipo, esq, vw, vh, yTopo, refX, tempo, tema) {
  const passo = 300;
  const x0 = Math.floor((esq - passo) / passo) * passo;
  /* Canos: um COLETOR horizontal no alto, de onde eles descem. Soltos, sem
     nada que os segurasse, liam como pistões caindo do céu. */
  /* Baixo o bastante pra não ser confundido com a borda da tela (colado no
     topo ele lia como tarja de cinema ou HUD), grosso, com flanges redondas
     e um terço puxado pra fumaça. */
  const yColetor = yTopo + 30;
  if (tipo === 'cano') {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = misturarHex(tema.primeiroPlano, tema.bruma, 0.3);
    ctx.fillRect(esq - 20, yColetor, vw + 40, 26);
    const passoF = 150;
    for (let fx = Math.floor(esq / passoF) * passoF; fx <= esq + vw + passoF; fx += passoF) {
      ctx.beginPath();
      ctx.ellipse(fx, yColetor + 13, 6, 17, 0, 0, TAU);
      ctx.fill();
    }
    // A barriga do coletor pega a luz do fogo.
    const fogoC = forcaFogo(areaAtual, tema.pureza ?? 0);
    if (fogoC > 0.05) {
      ctx.strokeStyle = rgba(chamaDe(areaAtual).meio, 0.5 * fogoC);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(esq - 20, yColetor + 25.5);
      ctx.lineTo(esq + vw + 20, yColetor + 25.5);
      ctx.stroke();
    }
    ctx.restore();
  }
  for (let x = x0; x <= esq + vw + passo; x += passo) {
    const h = hash2(x, 907, 9);
    if (h > 0.78) continue;
    const h2 = hash2(x, 911, 9);
    const h3 = hash2(x, 919, 9);
    const px = x + (h2 - 0.5) * passo * 0.8;
    // O topo cobre menos o jogador (ele fica no terço inferior), então a
    // máscara de centro pode ser bem mais suave aqui.
    const alfa = lerp(0.45, 1, opacidadeDeBorda(px - refX, vw));
    ctx.globalAlpha = alfa;

    switch (tipo) {
      case 'estalactite': {
        const comp = vh * lerp(0.10, 0.30, h3);
        const larg = lerp(20, 54, h2);
        ctx.beginPath();
        ctx.moveTo(px - larg, yTopo - 30);
        ctx.bezierCurveTo(px - larg * 0.6, yTopo + comp * 0.35,
          px - larg * 0.18, yTopo + comp * 0.72, px + (h - 0.5) * 30, yTopo + comp);
        ctx.bezierCurveTo(px + larg * 0.2, yTopo + comp * 0.7,
          px + larg * 0.68, yTopo + comp * 0.32, px + larg, yTopo - 30);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'juncoAlto': {
        const comp = vh * lerp(0.12, 0.26, h3);
        ctx.lineWidth = lerp(4, 12, h2);
        for (let i = 0; i < 3; i++) {
          const hi = hash2(x + i * 7, 929, 9);
          const balanco = Math.sin(tempo * 0.5 + hi * TAU) * 12;
          ctx.beginPath();
          ctx.moveTo(px + (hi - 0.5) * 90, yTopo - 20);
          ctx.quadraticCurveTo(px + (hi - 0.5) * 90 + balanco, yTopo + comp * 0.6,
            px + (hi - 0.5) * 120 + balanco * 2, yTopo + comp);
          ctx.stroke();
        }
        break;
      }
      case 'cano': {
        const comp = vh * lerp(0.12, 0.32, h3);
        const d = lerp(16, 40, h2);
        /* CANO, não pistão. A tampa larga na ponta e o cotovelo solto
           pendurado liam como marreta de armadilha — o jogador esperava que
           aquilo descesse nele. Agora: colarinhos finos ao longo do corpo, uma
           boca só um pouco mais larga, e o que um cano de fábrica faz de
           verdade: PINGA. Restaurado, a trepadeira toma conta. */
        // Desce do coletor, com um colarinho largo na emenda.
        ctx.fillRect(px - d * 0.5, yTopo + 30, d, comp - 30);
        ctx.fillRect(px - d * 0.7, yTopo + 50, d * 1.4, Math.max(4, d * 0.25));
        for (let k = 1; k <= 2; k++) {
          ctx.fillRect(px - d * 0.62, yTopo + comp * (k / 3), d * 1.24, Math.max(3, d * 0.2));
        }
        // Ponta CORTADA em diagonal, com a flange rasgada: cano rompido.
        ctx.beginPath();
        ctx.moveTo(px - d * 0.62, yTopo + comp - d * 0.3);
        ctx.lineTo(px + d * 0.62, yTopo + comp - d * 0.3);
        ctx.lineTo(px + d * 0.5, yTopo + comp - d * 0.1);
        ctx.lineTo(px + d * 0.5, yTopo + comp + d * 0.15);
        ctx.lineTo(px - d * 0.1, yTopo + comp + d * 0.3);
        ctx.lineTo(px - d * 0.5, yTopo + comp + d * 0.45);
        ctx.lineTo(px - d * 0.5, yTopo + comp - d * 0.1);
        ctx.closePath();
        ctx.fill();
        const calmaC = calmaDaFauna(tema.pureza ?? 0);
        if (calmaC < 0.97) {
          // A gota se forma na boca, cai e some.
          const u = ((_reduzido ? tempo * 0.33 : tempo) * lerp(0.35, 0.55, h) + h * 3) % 1;
          const forma = clamp01(u / 0.35);
          const r = d * 0.16;
          ctx.save();
          ctx.globalAlpha = alfa * (1 - calmaC);
          ctx.beginPath();
          if (u < 0.35) {
            ctx.ellipse(px, yTopo + comp + r * forma, r * 0.8, r * (0.6 + 0.6 * forma), 0, 0, TAU);
          } else {
            const q = (u - 0.35) / 0.65;
            ctx.globalAlpha *= 1 - q;
            ctx.ellipse(px, yTopo + comp + r + q * q * vh * 0.35, r * 0.7, r * 1.2, 0, 0, TAU);
          }
          ctx.fill();
          ctx.restore();
        }
        if (calmaC > 0.03) {
          // Trepadeira enrolada no cano e folhas penduradas na boca.
          const verde = misturarHex(tema.primeiroPlano, tema.acento, 0.3);
          ctx.save();
          ctx.strokeStyle = rgba(verde, calmaC);
          ctx.fillStyle = rgba(verde, calmaC);
          /* Dois fios de passo irregular (senoide perfeita lia como DNA ou
             poste de barbeiro), cachos de folha e uma ponta pendurada. */
          ctx.lineWidth = Math.max(1.5, d * 0.1);
          for (let fio = 0; fio < 2; fio++) {
            ctx.beginPath();
            let fase = h * 7 + fio * 2.1;
            for (let yy = yTopo + 40; yy <= yTopo + comp; yy += 6) {
              fase += lerp(0.35, 0.8, hash2(Math.round(yy), x + fio, 943)) * 0.5;
              const xx = px + Math.sin(fase) * d * 0.55;
              yy === yTopo + 40 ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy);
            }
            ctx.stroke();
          }
          const pend = lerp(40, 80, h) * calmaC;
          ctx.beginPath();
          ctx.moveTo(px + d * 0.4, yTopo + comp);
          ctx.quadraticCurveTo(px + d * 0.8, yTopo + comp + pend * 0.5, px + d * 0.5, yTopo + comp + pend);
          ctx.stroke();
          for (let i = 0; i < 7; i++) {
            const hi = hash2(x + i, 941, 9);
            const cyF = yTopo + lerp(0.15, 1, hash2(i, x, 947)) * comp;
            const fx = px + (hi - 0.5) * d * 1.3 + (i > 4 ? d * 0.5 : 0);
            const fy = i > 4 ? yTopo + comp + pend * lerp(0.3, 1, hi) : cyF;
            // Cada elipse começa NO contorno dela (sem isso o caminho emenda
            // uma reta entre as duas folhas).
            const r1 = (hi - 0.5) * 1.4, r2 = hi - 0.2;
            ctx.beginPath();
            ctx.moveTo(fx + Math.cos(r1) * d * 0.18, fy + Math.sin(r1) * d * 0.18);
            ctx.ellipse(fx, fy, d * 0.18, d * 0.3, r1, 0, TAU);
            ctx.moveTo(fx + d * 0.2 + Math.cos(r2) * d * 0.14, fy + d * 0.12 + Math.sin(r2) * d * 0.14);
            ctx.ellipse(fx + d * 0.2, fy + d * 0.12, d * 0.14, d * 0.24, r2, 0, TAU);
            ctx.fill();
          }
          ctx.restore();
        }
        /* Com o céu aceso pelo incêndio, cano preto chapado era o contraste
           mais duro da tela e lia como arte faltando. O lado de baixo pega o
           reflexo do fogo: um fio quente nas arestas. */
        const fogoAqui = forcaFogo(areaAtual, tema.pureza ?? 0);
        if (fogoAqui > 0.05) {
          const chC = chamaDe(areaAtual);
          ctx.save();
          ctx.strokeStyle = rgba(chC.meio, 0.4 * fogoAqui);
          ctx.lineWidth = 1.5;
          ctx.strokeRect(px - d * 0.5, yTopo + 56, d, comp - d * 0.28 - 56);
          ctx.strokeRect(px - d * 0.6, yTopo + comp - d * 0.28, d * 1.2, d * 0.28);
          ctx.restore();
        }
        break;
      }
      case 'galhoFolhado': {
        const comp = vh * lerp(0.16, 0.34, h3);
        const balanco = Math.sin(tempo * 0.32 + h * TAU) * 7;
        ctx.lineWidth = lerp(6, 18, h2);
        ctx.beginPath();
        ctx.moveTo(px - 140, yTopo - 30);
        ctx.quadraticCurveTo(px, yTopo + comp * 0.6 + balanco, px + 190, yTopo + comp * 0.35);
        ctx.stroke();
        for (let i = 1; i < 6; i++) {
          const hi = hash2(x + i * 23, 937, 9);
          const tt = i / 6;
          const gx = lerp(px - 140, px + 190, tt);
          const gy = yTopo - 30 + (comp * 0.6 + balanco + 30) * 2 * tt * (1 - tt) + comp * 0.35 * tt * tt;
          const r = lerp(22, 54, hi);
          ctx.beginPath();
          ctx.ellipse(gx, gy + r * 0.5, r, r * 0.62, (hi - 0.5) * 1.2, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case 'lobo': {
        const r = vh * lerp(0.10, 0.22, h3);
        const resp = 1 + 0.05 * Math.sin(tempo * lerp(0.6, 1.0, h) + h * TAU);
        ctx.beginPath();
        const n = 16;
        for (let i = 0; i <= n; i++) {
          const ang = (i / n) * Math.PI;
          const rr = r * resp * (0.75 + 0.25 * ruido1(i * 0.8 + h * 12, 941));
          const xx = px + Math.cos(ang) * rr * 1.3;
          const yy = yTopo - 20 + Math.sin(ang) * rr;
          if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
        }
        ctx.closePath();
        ctx.fill();
        break;
      }
    }
  }
  ctx.globalAlpha = 1;
}

/* =========================================================================
   9 · LINHA DO HORIZONTE
   -------------------------------------------------------------------------
   O céu ganhou um clarão de horizonte, mas clarão sozinho não é distância:
   é preciso ter ALGUMA COISA recortada contra ele. Sem isso o topo da tela
   continua sendo um degradê bonito e vazio, e o jogo não parece a céu aberto
   — parece um fundo pintado.

   Esta faixa não passa pelo sistema de CAMADAS porque precisa cair EXATAMENTE
   sobre o clarão, que é calculado em espaço de tela. Então ela é desenhada em
   espaço de tela e a paralaxe é feita à mão: o ruído é avaliado em
   `x + viewX·p`, o que dá deslocamento contínuo sem repetição.

   Duas bandas, sempre: uma quase dissolvida na bruma (o fim do mundo) e uma
   um pouco mais escura logo à frente. Uma banda só lê como recorte de papel.
   ========================================================================= */

const HORIZONTE = {
  //          tipo       altura da massa (fração de h)  espaçamento dos vultos
  raizes:   { tipo: 'mata', alt: 0.085, passo: 46, semente: 811 },
  varzea:   { tipo: 'brejo', alt: 0.075, passo: 40, semente: 823 },
  clareira: { tipo: 'queimada', alt: 0.070, passo: 58, semente: 827 },
  dossel:   { tipo: 'mata', alt: 0.115, passo: 62, semente: 829 },
  coracao:  { tipo: 'rocha', alt: 0.105, passo: 90, semente: 839 },
};

/** Perfil ondulado da massa, em px acima do horizonte. */
function perfilHorizonte(xm, s, amp, tipo) {
  let v = ruido1(xm * 0.0013, s) * 0.62
        + ruido1(xm * 0.0041 + 17, s + 7) * 0.28
        + ruido1(xm * 0.011 + 53, s + 13) * 0.10;
  if (tipo === 'rocha') {
    // Cristas angulares: dobra o ruído em torno do meio e afia o topo.
    v = Math.abs(v - 0.5) * 2;
    v = v ** 0.7;
  } else if (tipo === 'brejo') {
    // Brejo é raso, mas não RETO: chapado demais a banda vira uma régua
    // atravessando a tela e lê como muro, não como distância.
    v = 0.28 + v * 0.72;
  }
  return v * amp;
}

/**
 * Manada correndo pela crista da banda próxima do horizonte, bando cruzando o
 * clarão logo acima. O horizonte é o único lugar SEMPRE na altura do olho:
 * nas cristas do meio do fundo, em sala baixa, a manada caía atrás das
 * plataformas e não aparecia. Chamado por `desenharParallax` depois dos dois
 * planos mais distantes (ver o comentário lá).
 */
function desenharFaunaHorizonte(render, sala, mundo) {
  const conf = HORIZONTE[sala.area] ?? HORIZONTE.raizes;
  const camera = render.camera;
  render.camadaTela((ctx, tema, w, h) => {
    const yH = render.alturaHorizonte(sala.altura);
    if (yH < -200 || yH > h + 200) return;
    const t = mundo.laco?.tempo ?? 0;
    const tAnim = render.movimentoReduzido ? t * 0.33 : t;
    const cc = confCatastrofe(sala.area);
    const fuga = cc.fuga;
    const fogo = forcaFogo(sala.area, tema.pureza ?? 0);
    const ch = chamaDe(sala.area);
    const calma = calmaDaFauna(tema.pureza ?? 0);
    const amp1 = h * conf.alt * 1.45;
    const y01 = yH + h * 0.028;
    const desl1 = camera.viewX * 0.045;
    const s1 = conf.semente + 101;
    /* Contraluz: o bicho está entre o olho e o fogo, então é quase preto — e
       ganha uma lasca de luz nas costas na cor do que o ilumina (fogo onde há
       fogo, céu onde não há). */
    /* Sem contorno aceso e fora do preto: silhueta preta com fio de luz é a
       linguagem dos parasitas, e a manada lia como bando de aranhas. A cor
       é a do morro onde ela corre, puxada pra bruma — bicho LONGE. */
    const silhueta = misturarHex(misturarHex(cor(tema, 'distante', 0.8, -0.24), tema.primeiroPlano, 0.45),
      tema.ceuBase, 0.32);
    const borda = null;
    if (cc.bichos) {
      desenharManada(ctx, {
        x0: -60, x1: w + 60, dx: desl1,
        yEm: (x) => y01 - perfilHorizonte(x + desl1, s1, amp1, conf.tipo) + 2,
        especies: cc.bichos, dir: fuga, t: tAnim, calma,
        cor: silhueta, borda, bordaPasto: rgba(tema.luz, 0.4),
        // Calmo, o bicho do horizonte é recortado contra céu claro e LONGE:
        // leva um pouco da bruma, senão fica mais preto que tudo à volta.
        corPasto: misturarHex(silhueta, tema.bruma, 0.3),
        // ~1,7x o tamanho anterior: a 20 px o veado era um borrão.
        tamMin: h * 0.052, tamMax: h * 0.068,
        evitarX: ((mundo.jogador?.centroX ?? 0) - camera.viewX) * camera.zoom,
        // Uma manada por vez: com o passo menor que o percurso, duas manadas
        // vizinhas cruzavam o mesmo trecho e empilhavam bicho sobre bicho.
        passo: 2300, percurso: 1600, periodo: 12, semente: conf.semente + 7,
        dens: 0.9, passoPasto: 520, densPasto: 0.75,
      });
    }
    desenharBando(ctx, {
      x0: -60, x1: w + 60, dx: camera.viewX * 0.03,
      y0: yH - h * 0.2, faixa: h * 0.12, t: tAnim, calma, dir: fuga,
      cor: misturarHex(cor(tema, 'distante', 0.85, -0.3), tema.primeiroPlano, 0.55),
      envergadura: h * 0.011,
      passo: 1500, percurso: 2400, periodo: 9, semente: conf.semente + 11,
      dens: 0.85, soCalma: !cc.bichos, passoCalmo: 700,
    });
  });
}

/**
 * A silhueta do horizonte. Chamar LOGO DEPOIS do céu e antes do parallax.
 */
export function desenharHorizonte(render, sala, mundo) {
  const conf = HORIZONTE[sala.area] ?? HORIZONTE.raizes;
  const camera = render.camera;

  render.camadaTela((ctx, tema, w, h) => {
    const yH = render.alturaHorizonte(sala.altura);
    // Fora da tela por completo: nada a fazer (salas altas, câmera lá em cima).
    if (yH < -200 || yH > h + 200) return;

    const fogo = forcaFogo(sala.area, tema.pureza ?? 0);
    const fumaca = forcaFumaca(sala.area, tema.pureza ?? 0);
    const ch = chamaDe(sala.area);
    const t = mundo.laco?.tempo ?? 0;
    const tAnim = render.movimentoReduzido ? t * 0.33 : t;
    const fuga = confCatastrofe(sala.area).fuga;

    /* O SOL ATRÁS DA FUMAÇA: um disco chapado, vermelho, sem halo — a
       imagem de todo incêndio florestal grande, quando a fumaça filtra o sol
       até ele virar uma moeda em brasa que dá pra olhar de frente. No
       Coração, um sol verde doente. Pintado antes das colunas, que passam
       por cima dele; some conforme a fumaça afina (o sol de verdade, o da
       área limpa, é a luz dourada que já existe). */
    /* (No Coração não: o disco verde lia como lua. Lá a fonte e o fogo
       químico bastam.) */
    if (fumaca > 0.05 && sala.area !== 'coracao') {
      const meioS = ((sala.largura ?? w) - w / camera.zoom) * 0.5;
      // Alto e perto do canto: no meio do céu ele encostava nos canos e
      // troncos e virava gota de lava pendurada.
      const xs = (fuga < 0 ? 0.18 : 0.82) * w - (camera.viewX - meioS) * 0.008;
      const ys = yH - h * 0.34;
      const rs = h * 0.062;
      const al = 0.82 * clamp01((fumaca - 0.05) / 0.4);
      ctx.save();
      // O terço de baixo do disco se perde na névoa do horizonte.
      const gsol = ctx.createLinearGradient(0, ys - rs, 0, ys + rs);
      gsol.addColorStop(0, rgba('#d8402a', al));
      gsol.addColorStop(0.62, rgba('#d8402a', al));
      gsol.addColorStop(1, rgba('#d8402a', al * 0.15));
      ctx.fillStyle = gsol;
      ctx.beginPath();
      ctx.arc(xs, ys, rs, 0, TAU);
      ctx.fill();
      /* Faixas de fumaça atravessando o CÉU (não o disco): longas, finas,
         inclinadas, de bordas moles (duas passadas). Presas dentro do disco,
         iguais e paralelas, liam como logo impresso nele. */
      const { alta: corFaixa } = coresDeFumaca(tema, cor(tema, 'distante', 0.9, -0.2), ch, 0);
      const faixas = [[-0.35, 0.1, -0.087], [0.3, 0.22, 0.14]];
      for (const [dy, esp, ang] of faixas) {
        ctx.save();
        ctx.translate(xs + Math.sin(tAnim * 0.05 + dy * 9) * rs * 0.4, ys + rs * dy);
        ctx.rotate(ang);
        for (const [k, a2] of [[1.8, 0.35], [1, 0.6]]) {
          ctx.fillStyle = rgba(corFaixa, a2 * al);
          ctx.beginPath();
          ctx.ellipse(0, 0, rs * 4.5, rs * esp * k, 0, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      }
      /* Por dentro do disco a faixa tem que ficar MAIS fraca que fora (é
         fumaça na frente de uma luz): um pouco do vermelho volta por cima. */
      ctx.beginPath();
      ctx.arc(xs, ys, rs, 0, TAU);
      ctx.clip();
      ctx.fillStyle = gsol;
      ctx.globalAlpha = 0.45;
      ctx.fillRect(xs - rs, ys - rs, rs * 2, rs * 2);
      ctx.restore();
    }

    for (let banda = 0; banda < 2; banda++) {
      /* O INCÊNDIO NO HORIZONTE vive entre as duas bandas: o clarão e as
         colunas nascem ATRÁS da banda distante (ela recorta a base delas), e
         as chamas correm sobre a crista dela. A banda mais próxima, desenhada
         depois, tapa um pedaço do fogo — e é esse recorte que diz "longe". */
      if (banda === 0 && (fogo > 0.02 || fumaca > 0.03)) {
        const amp0 = h * conf.alt;
        const y00 = yH + h * 0.008;
        const desl0 = camera.viewX * 0.018;
        const s0 = conf.semente;
        /* Clarão largo e QUENTE: o fogo tem que ser a luz principal do céu.
           Com 0,2·h e o alfa de antes, em Raízes a faixa acima do fogo ficava
           neutra (matiz 211°, saturação 0,05) — o fogo não iluminava nada. */
        claraoDeFogo(ctx, 0, w, y00 - amp0 - h * 0.34, y00, ch, Math.min(1, fogo * 1.1));
        /* Focos quentes do lado do fogo e o CHÃO aceso abaixo da linha: o
           incêndio tem que ser a luz principal da cena, não um fio laranja
           sobre um céu neutro. */
        for (let k = 0; k < 3; k++) {
          const u = fuga < 0 ? lerp(0.55, 0.98, k / 2) : lerp(0.02, 0.45, k / 2);
          const inten = fogo * ladoDoFogo(u, fuga);
          focoDeLuz(ctx, u * w, y00 - amp0 * 0.6, h * lerp(0.28, 0.4, k / 2), ch.meio, 0.32 * inten);
        }
        const gc = ctx.createLinearGradient(0, y00 - 4, 0, y00 + h * 0.17);
        gc.addColorStop(0, rgba(ch.meio, 0.26 * fogo));
        gc.addColorStop(1, rgba(ch.borda, 0));
        ctx.fillStyle = gc;
        ctx.fillRect(0, y00 - 4, w, h * 0.17 + 4);
        if (fumaca > 0.03) {
          const { baixa: baseBaixa, alta: base } = coresDeFumaca(
            tema, cor(tema, 'distante', 0.9, -0.2), ch, fogo);
          const passoC = 520;
          const i0 = Math.floor((desl0 - 200) / passoC);
          const i1 = Math.ceil((desl0 + w + 200) / passoC);
          for (let i = i0; i <= i1; i++) {
            const hc = hash2(i, s0, 17);
            if (hc > 0.75) continue;
            const xm = i * passoC + hc * passoC * 0.8;
            const x = xm - desl0;
            if (hash2(i, s0, 23) > ladoDoFogo(x / w, fuga)) continue;
            pluma(ctx, {
              x, y: y00 - perfilHorizonte(xm, s0, amp0, conf.tipo) + 4,
              // Colunas que SAEM pelo topo do quadro, largas lá em cima: a
              // fumaça tem que ocupar o céu, não enfeitar o horizonte.
              alt: h * lerp(0.75, 1.1, hash2(i, s0, 19)), larg: h * lerp(0.03, 0.05, hc),
              t: tAnim, vel: 0.014, semente: i * 7 + s0,
              deriva: fuga * 0.7,
              corBaixa: baseBaixa, corAlta: base,
              alfa: 0.5 * fumaca,
            });
          }
          /* PIROCÚMULO. Várias colunas do mesmo tamanho liam como chaminés
             de fábrica; incêndio grande tem UMA coluna que domina o céu —
             larga, densa, a barriga acesa pelo fogo embaixo, tombando com o
             vento pro lado da fuga. Fica do lado do fogo e quase não anda
             com a câmera (é a coisa mais distante da cena). */
          const uDom = fuga < 0 ? 0.8 : 0.2;
          const meio = ((sala.largura ?? w) - w / camera.zoom) * 0.5;
          const xDom = uDom * w - (camera.viewX - meio) * 0.012;
          pluma(ctx, {
            x: xDom, y: y00 - perfilHorizonte(xDom + desl0, s0, amp0, conf.tipo) + 6,
            alt: h * 1.2, larg: h * 0.07,
            t: tAnim, vel: 0.009, semente: s0 + 999,
            deriva: fuga * 0.55,
            corBaixa: misturarHex(baseBaixa, ch.meio, 0.35 * fogo), corAlta: base,
            alfa: Math.min(0.85, 0.72 * fumaca + 0.1),
          });
        }
      }
      if (banda === 1 && fogo > 0.02) {
        const amp0 = h * conf.alt;
        const y00 = yH + h * 0.008;
        const desl0 = camera.viewX * 0.018;
        frenteDeFogo(ctx, {
          x0: -12, x1: w + 12, dx: desl0, passo: 7,
          yEm: (x) => y00 - perfilHorizonte(x + desl0, conf.semente, amp0, conf.tipo),
          // ~3x a altura de antes: a 6 px efetivos o incêndio era um pavio.
          // O fogo químico é baixo e largo (forma própria): sem compensar, no
          // Coração ele virava um fio de neon de 4 px.
          escala: h * (sala.area === 'coracao' ? 0.075 : 0.042), t: tAnim, semente: conf.semente + 5,
          ch, inten: Math.min(1, fogo * 1.3),
          inclina: fuga * 0.22, alfa: 0.92, massa: 1,
          lateral: (x) => ladoDoFogo(x / w, fuga),
        });
      }

      const p = banda === 0 ? 0.018 : 0.045;
      const d = banda === 0 ? 0.97 : 0.86;
      const amp = h * conf.alt * (banda === 0 ? 1 : 1.45);
      const y0 = yH + h * (banda === 0 ? 0.008 : 0.028);
      const desl = camera.viewX * p;
      const s = conf.semente + banda * 101;
      // A mata do horizonte tem que ser MAIS ESCURA que o clarão em que ela
      // se recorta. Clarear a silhueta (era +0.16) apaga o recorte.
      ctx.fillStyle = cor(tema, 'distante', d, banda === 0 ? -0.06 : -0.14);

      // 1 · a massa
      ctx.beginPath();
      ctx.moveTo(-4, h + 4);
      for (let x = -4; x <= w + 4; x += 6) {
        ctx.lineTo(x, y0 - perfilHorizonte(x + desl, s, amp, conf.tipo));
      }
      ctx.lineTo(w + 4, h + 4);
      ctx.closePath();
      ctx.fill();

      /* A FONTE do Coração: em cima da crista da frente, do lado do fogo. A
         poça fica na crista e o cano brota dela — atrás das árvores do meio
         do fundo, mas inteiro na faixa de céu que toda sala do Coração tem. */
      if (banda === 1 && sala.area === 'coracao') {
        const meioF = ((sala.largura ?? w) - w / camera.zoom) * 0.5;
        const xF = (fuga < 0 ? 0.76 : 0.24) * w - (camera.viewX - meioF) * 0.03;
        const corBanda = cor(tema, 'distante', d, -0.14);
        escoadouroNoHorizonte(ctx, {
          x: xF, yEm: (x) => y0 - perfilHorizonte(x + desl, s, amp, conf.tipo),
          esc: h / 720 * 0.62, lado: fuga < 0 ? -1 : 1,
          t: tAnim, ch, vivo: clamp01(1 - (tema.pureza ?? 0) * 1.6),
          calma: calmaDaFauna(tema.pureza ?? 0),
          cor: ajustarBrilho(corBanda, -0.06), verde: misturarHex(corBanda, tema.acento, 0.45),
          deriva: fuga * 0.5, semente: conf.semente + 41,
        });
      }

      /* CORTE RASO no Dossel: na crista da frente a mata ACABA, e começa uma
         faixa de tocos de corte claro com a máquina parada na borda, farol
         aceso, virada pra mata que sobrou. É a única faixa que aparece em toda
         sala — no fundo de parallax a máquina ficava escondida atrás dos
         troncos colossais em quase toda tela. Restaurado, a mata volta. */
      let corte0 = 0, corte1 = 0;
      const corte = banda === 1 && sala.area === 'dossel'
        ? 1 - clamp01((calmaDaFauna(tema.pureza ?? 0) - 0.2) / 0.5) : 0;
      if (corte > 0.02) {
        const meioC = ((sala.largura ?? w) - w / camera.zoom) * 0.5;
        const dC = -(camera.viewX - meioC) * 0.045;
        // Do lado do fogo (a queimada vem depois do corte) e fora do centro,
        // que no Dossel é quase sempre tomado pelo tronco da árvore-mãe.
        corte0 = (fuga > 0 ? 0.1 : 0.56) * w + dC;
        corte1 = (fuga > 0 ? 0.44 : 0.9) * w + dC;
        const perfilC = (x) => y0 - perfilHorizonte(x + desl, s, amp, conf.tipo);
        const tocosC = new Path2D(), cortes = new Path2D();
        /* Tocos IRREGULARES: com altura, largura e espaço iguais a fileira
           lia como paliçada ou ameia de castelo. Alguns tortos, toras
           deitadas entre eles, e uma faixa de terra nua embaixo. */
        const terra = new Path2D();
        terra.moveTo(corte0, perfilC(corte0) + 3);
        for (let x = corte0; x <= corte1; x += 10) terra.lineTo(x, perfilC(x) - 1);
        terra.lineTo(corte1, perfilC(corte1) + 6);
        for (let x = corte1; x >= corte0; x -= 10) terra.lineTo(x, perfilC(x) + 6);
        terra.closePath();
        ctx.save();
        ctx.fillStyle = misturarHex(cor(tema, 'distante', d, -0.14), '#8a6a4a', 0.35);
        ctx.globalAlpha = corte;
        ctx.fill(terra);
        ctx.restore();
        const toras = new Path2D();
        let x = corte0;
        let n = 0;
        while (x <= corte1) {
          n++;
          const hx = hash2(n, 853, 5), hy = hash2(n, 857, 5);
          const tx = x;
          x += 13 * lerp(0.6, 1.4, hx);
          const tb = perfilC(tx) + 2;
          if (hy < 0.14) {
            // Tora deitada no chão.
            const cl = h * lerp(0.03, 0.05, hx), ct = h * 0.006;
            toras.moveTo(tx - cl, tb - ct * 2);
            toras.lineTo(tx + cl, tb - ct * 2.4);
            toras.lineTo(tx + cl, tb);
            toras.lineTo(tx - cl, tb);
            toras.closePath();
            continue;
          }
          const ta = h * lerp(0.008, 0.022, hy);
          const tl = h * lerp(0.004, 0.009, hx);
          const inc = (hash2(n, 859, 5) - 0.5) * tl * 1.4;
          tocosC.moveTo(tx - tl * 1.3, tb);
          tocosC.lineTo(tx - tl + inc, tb - ta);
          tocosC.lineTo(tx + tl + inc, tb - ta + inc * 0.3);
          tocosC.lineTo(tx + tl * 1.3, tb);
          tocosC.closePath();
          cortes.moveTo(tx + tl + inc, tb - ta);
          cortes.ellipse(tx + inc, tb - ta, tl, tl * 0.4, inc * 0.05, 0, TAU);
        }
        tocosC.addPath(toras);
        ctx.save();
        ctx.globalAlpha = corte;
        ctx.fill(tocosC);
        // A face do corte é CLARA: madeira viva recém-exposta.
        ctx.fillStyle = misturarHex(cor(tema, 'distante', d, -0.14), '#c9a77a', 0.55);
        ctx.fill(cortes);
        // A máquina na borda do corte, virada pra mata.
        const xm = fuga > 0 ? corte1 - h * 0.02 : corte0 + h * 0.02;
        const escM = h / 720 * 0.5;
        desenharMaquina(ctx, xm, perfilC(xm) + 3, escM, fuga > 0 ? 1 : -1,
          cor(tema, 'distante', d, -0.2), 1);
        const fx = xm + 34 * (fuga > 0 ? 1 : -1) * escM, fy = perfilC(xm) + 3 - 34 * escM;
        focoDeLuz(ctx, fx, fy, h * 0.03, '#fff0c8', 0.55);
        ctx.fillStyle = rgba('#fff0c8', 0.16);
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(fx + (fuga > 0 ? 1 : -1) * h * 0.16, fy + h * 0.02);
        ctx.lineTo(fx + (fuga > 0 ? 1 : -1) * h * 0.16, fy - h * 0.025);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.fillStyle = cor(tema, 'distante', d, banda === 0 ? -0.06 : -0.14);
      }

      // 2 · os vultos que quebram a linha — é o que faz "mata" e não "duna".
      if (conf.tipo === 'rocha') continue;
      const passo = conf.passo * (banda === 0 ? 1 : 1.6);
      const i0 = Math.floor((desl - 40) / passo);
      const i1 = Math.ceil((desl + w + 40) / passo);
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        const hx = hash2(i, banda, s);
        const hy = hash2(banda, i, s + 3);
        if (hx > (conf.tipo === 'brejo' ? 0.72 : 0.86)) continue;
        const xm = i * passo + hx * passo * 0.8;
        // Vulto nasce em MOITA. Espaçamento uniforme, mesmo com jitter, lê
        // como cerca de estacas — o olho acha o ritmo antes de achar a mata.
        if (ruido1(xm * 0.0026, s + 21) < 0.38) continue;
        const x = xm - desl;
        // No corte raso não sobra árvore.
        if (corte > 0.5 && x > corte0 - 6 && x < corte1 + 6) continue;
        const base = y0 - perfilHorizonte(xm, s, amp, conf.tipo) + 2;
        // Faixa de altura larga: vultos todos do mesmo tamanho denunciam
        // repetição mais rápido que qualquer outra coisa.
        const alt = h * lerp(0.014, conf.tipo === 'brejo' ? 0.062 : 0.115, hy * hy)
          * (banda === 0 ? 1 : 1.5);
        const larg = Math.max(0.9, alt * lerp(0.035, 0.075, hx));
        // Tronco afinando pro topo. Retângulo denuncia poste.
        ctx.moveTo(x - larg, base);
        ctx.lineTo(x - larg * 0.28, base - alt);
        ctx.lineTo(x + larg * 0.28, base - alt);
        ctx.lineTo(x + larg, base);
        ctx.closePath();
        // Dois galhos secos em V, só nos vultos mais altos: é o detalhe que
        // diz "árvore morta" a essa distância, e custa quatro linhas.
        /* Restaurado, o vulto seco ganha copa: um tronco morto na linha do
           horizonte limpo desmentia a restauração inteira. */
        const copa = calmaDaFauna(tema.pureza ?? 0);
        if (copa > 0.05 && conf.tipo !== 'brejo') {
          const r = alt * lerp(0.2, 0.34, hx) * copa;
          ctx.moveTo(x + r, base - alt);
          ctx.ellipse(x, base - alt, r, r * 0.78, 0, 0, TAU);
        }
        if (conf.tipo !== 'brejo' && hy > 0.55) {
          /* Três galhos ASSIMÉTRICOS em alturas diferentes. Dois galhos iguais
             em V liam como turbina eólica — exatamente o símbolo errado numa
             cena de desmatamento. */
          const gl = alt * 0.3;
          const lado = hx > 0.5 ? 1 : -1;
          const galho = (gy, sx, comp, sobe) => {
            // Sentido horário, igual à copa do estado restaurado.
            ctx.moveTo(x, gy);
            ctx.lineTo(x + sx * comp * 0.82, gy - comp * sobe);
            ctx.lineTo(x + sx * comp, gy - comp * (sobe + 0.2));
            ctx.closePath();
          };
          galho(base - alt * 0.7, -lado, gl * 1.05, 0.55);
          galho(base - alt * 0.52, lado, gl * 0.55, 0.3);
          galho(base - alt * 0.86, lado, gl * 0.4, 0.7);
        }
      }
      ctx.fill();
    }

  });
}
