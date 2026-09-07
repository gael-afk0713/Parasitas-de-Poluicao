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
   lista de objetos, nenhuma alocação por quadro além de gradientes. A mesma
   coluna desenha sempre a mesma silhueta, então nada pisca ou "nada" quando
   a câmera se move.
   ========================================================================= */

import {
  TAU, lerp, clamp, clamp01, rgba, ruido1, hash2,
  misturarHex, ajustarBrilho, hexParaRgb, rgbParaHex,
} from '../core/mat.js';
import { feixeLuz } from './renderizador.js';

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
   3 · AMBIENTE DE DESENHO
   -------------------------------------------------------------------------
   Objeto único reaproveitado entre camadas: zero alocação por quadro.
   ========================================================================= */

const _amb = {
  camera: null, tema: null, tempo: 0, pureza: 0, ang: 0,
  p: 1, x0: 0, x1: 0, vw: 0, vh: 0, ancora: 0,
  cor: '#000', corBase: '#000', corTras: '#000',
};

function prepararAmb(camera, sala, tema, tempo, p, c, cBase, cTras, ang) {
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
  _amb.cor = c; _amb.corBase = cBase; _amb.corTras = cTras;
  return _amb;
}

/** `rel` 0 = topo da viewport, 1 = base — relativo à âncora da sala. */
function yDe(a, rel) { return a.ancora + (rel - 0.5) * a.vh; }

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
  ctx.beginPath();
  for (let i = 0; i <= passos; i++) {
    const t = i / passos;
    const x = px + Math.sin(t * 2.3 + curva * 3) * curva * 46 + t * curva * 26;
    const y = yTopo + comp * t;
    const w = larg * Math.pow(1 - t, 0.62);
    if (i === 0) ctx.moveTo(x - w, y); else ctx.lineTo(x - w, y);
  }
  for (let i = passos; i >= 0; i--) {
    const t = i / passos;
    const x = px + Math.sin(t * 2.3 + curva * 3) * curva * 46 + t * curva * 26;
    const y = yTopo + comp * t;
    const w = larg * Math.pow(1 - t, 0.62);
    ctx.lineTo(x + w, y);
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
  ctx.fillStyle = a.cor;

  for (let x = x0; x <= a.x1; x += passo) {
    const h = hash2(x, s.semente, 113);
    if (h > (s.dens ?? 0.75)) continue;
    const cx = x + (hash2(x, s.semente + 1, 127) - 0.5) * passo * 0.8;
    const n = 2 + ((hash2(x, s.semente + 2, 131) * 4) | 0);
    for (let i = 0; i < n; i++) {
      const hi = hash2(x + i * 13, s.semente + 3, 139);
      const comp = lerp(s.compMin ?? 60, s.compMax ?? 190, hi);
      const larg = lerp(2, 6, hi) * (s.escalaLarg ?? 1);
      const bx = cx + (hi - 0.5) * passo * 0.5;
      // Vento: só a ponta se move, a base fica presa — é o que dá "planta".
      const vento = Math.sin(t * lerp(0.5, 1.1, hi) + hi * TAU) * comp * 0.13
        + (hi - 0.5) * comp * 0.34;
      ctx.beginPath();
      ctx.moveTo(bx - larg, yb);
      ctx.quadraticCurveTo(bx - larg * 0.4 + vento * 0.35, yb - comp * 0.6, bx + vento, yb - comp);
      ctx.quadraticCurveTo(bx + larg * 0.4 + vento * 0.35, yb - comp * 0.6, bx + larg, yb);
      ctx.closePath();
      ctx.fill();
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

  const g = ctx.createLinearGradient(0, y, 0, y + alt);
  g.addColorStop(0, misturarHex(a.cor, a.tema.luz, 0.20));
  g.addColorStop(0.25, a.cor);
  g.addColorStop(1, a.corBase);
  ctx.fillStyle = g;
  ctx.fillRect(a.x0, y, a.x1 - a.x0, alt);

  // linha de superfície
  ctx.strokeStyle = rgba(misturarHex(a.tema.luz, a.cor, 0.35), 0.30);
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
      ctx.globalAlpha = (1 - prof) * 0.10 * lerp(0.4, 1, hx);
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
function troncosColossais(ctx, a, s) {
  const passo = s.passo ?? 340;
  const x0 = Math.floor(a.x0 / passo) * passo;
  const yb = yDe(a, s.rel);
  const topo = yb - a.vh * 1.5;

  for (let x = x0; x <= a.x1; x += passo) {
    const h = hash2(x, s.semente, 263);
    if (h > (s.dens ?? 0.7)) continue;
    const h2 = hash2(x, s.semente + 1, 269);
    const px = x + (h2 - 0.5) * passo * 0.7;
    const rBase = lerp(s.largMin ?? 26, s.largMax ?? 90, h2);

    ctx.fillStyle = a.cor;
    ctx.beginPath();
    ctx.moveTo(px - rBase * 1.9, yb + 80);
    // contraforte esquerdo → corpo → contraforte direito
    ctx.quadraticCurveTo(px - rBase * 1.15, yb - rBase * 0.7, px - rBase * 0.86, yb - rBase * 2.2);
    ctx.lineTo(px - rBase * 0.62, topo);
    ctx.lineTo(px + rBase * 0.62, topo);
    ctx.lineTo(px + rBase * 0.86, yb - rBase * 2.2);
    ctx.quadraticCurveTo(px + rBase * 1.15, yb - rBase * 0.7, px + rBase * 1.9, yb + 80);
    ctx.closePath();
    ctx.fill();

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

  ctx.strokeStyle = a.cor;
  ctx.lineCap = 'round';
  for (let x = x0; x <= a.x1; x += passo) {
    const h = hash2(x, s.semente, 277);
    if (h > (s.dens ?? 0.7)) continue;
    const h2 = hash2(x, s.semente + 1, 281);
    const ax = x - passo * 0.4;
    const bx = x + passo * lerp(0.5, 1.1, h2);
    const ay = yb + (h - 0.5) * a.vh * 0.28;
    const arco = lerp(40, 150, h2) * (h > 0.5 ? 1 : -1);
    const balanco = Math.sin(t * 0.35 + h * TAU) * 4;

    ctx.lineWidth = lerp(4, 16, h) * (s.escalaLarg ?? 1);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo((ax + bx) * 0.5, ay + arco + balanco, bx, ay + arco * 0.25);
    ctx.stroke();

    ctx.lineWidth = Math.max(1.2, lerp(4, 16, h) * 0.35);
    for (let i = 1; i < 5; i++) {
      const tt = i / 5;
      const hx = hash2(x + i * 29, s.semente + 2, 283);
      const gx = lerp(ax, bx, tt);
      const gy = ay + arco * (2 * tt * (1 - tt)) * 2 + arco * 0.25 * tt * tt;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.quadraticCurveTo(gx + (hx - 0.5) * 40, gy + lerp(20, 60, hx),
        gx + (hx - 0.5) * 70, gy + lerp(40, 110, hx) + balanco);
      ctx.stroke();
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
    const balanco = Math.sin(t * lerp(0.22, 0.45, h) + h * TAU) * r * 0.03;

    ctx.fillStyle = a.cor;
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
};

/* =========================================================================
   5 · AS CAMADAS DE CADA ÁREA
   -------------------------------------------------------------------------
   `p`      fator de parallax        `d`  profundidade 0..1 (bruma/saturação)
   `cor`    chave do tema            `brilho` degrau da escada de valor
   `veu`    força da névoa aplicada DEPOIS da camada (null = automático)

   Sete camadas por área. A escada de `brilho` vai de +0.18 (horizonte, quase
   dissolvido na bruma) a -0.20 (quase silhueta) — é ela que dá contraste
   numa paleta em que todas as cores estão entre #08 e #24.
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
  raizes: [
    { p: 0.045, d: 1.00, cor: 'distante', brilho: 0.19, formas: [
      { f: 'massa', lado: 'baixo', rel: 1.00, amp: 70, escala: 0.0011, semente: 19, passo: 18 },
      { f: 'troncosColossais', rel: 1.02, passo: 120, dens: 0.92,
        largMin: 5, largMax: 13, semente: 11 },
    ] },
    { p: 0.095, d: 0.88, cor: 'distante', brilho: 0.12, formas: [
      { f: 'troncosColossais', rel: 1.04, passo: 170, dens: 0.82,
        largMin: 8, largMax: 20, semente: 23 },
      { f: 'galhos', rel: 0.20, passo: 260, dens: 0.55, escalaLarg: 0.45, semente: 29 },
      { f: 'massa', lado: 'baixo', rel: 1.05, amp: 74, escala: 0.0017, semente: 31, passo: 15 },
    ] },
    { p: 0.17, d: 0.73, cor: 'medio', brilho: 0.05, formas: [
      { f: 'troncosColossais', rel: 1.06, passo: 250, dens: 0.7,
        largMin: 13, largMax: 32, semente: 37 },
      { f: 'galhos', rel: 0.12, passo: 330, dens: 0.6, escalaLarg: 0.7, semente: 39 },
      { f: 'folhagem', rel: 0.10, passo: 300, dens: 0.5, rMin: 40, rMax: 110, semente: 41 },
    ] },
    { p: 0.28, d: 0.58, cor: 'medio', brilho: -0.02, formas: [
      { f: 'troncosColossais', rel: 1.08, passo: 340, dens: 0.62,
        largMin: 18, largMax: 44, semente: 43 },
      // Raízes aéreas descendo do alto: a assinatura do sub-bosque, e o que
      // impede a faixa vertical de virar só "cerca de postes".
      { f: 'raizes', rel: -0.02, passo: 230, dens: 0.55, compMin: 160, compMax: 420,
        largMin: 7, largMax: 20, semente: 47 },
      { f: 'galhos', rel: 0.06, passo: 380, dens: 0.5, escalaLarg: 0.9, semente: 49 },
    ] },
    { p: 0.42, d: 0.40, cor: 'proximo', brilho: -0.06, formas: [
      { f: 'troncosColossais', rel: 1.12, passo: 460, dens: 0.55,
        largMin: 26, largMax: 62, semente: 59 },
      { f: 'massa', lado: 'baixo', rel: 1.10, amp: 70, escala: 0.0036, semente: 61,
        passo: 11, picos: 0.35 },
    ] },
    { p: 0.60, d: 0.24, cor: 'proximo', brilho: -0.13, formas: [
      { f: 'raizes', rel: -0.08, passo: 280, dens: 0.45, compMin: 240, compMax: 620,
        largMin: 12, largMax: 34, semente: 67 },
      { f: 'massa', lado: 'baixo', rel: 1.18, amp: 74, escala: 0.0048, semente: 71,
        passo: 10, picos: 0.45 },
    ] },
    { p: 0.82, d: 0.10, cor: 'proximo', brilho: -0.22, veu: 0, formas: [
      { f: 'troncosColossais', rel: 1.30, passo: 620, dens: 0.42,
        largMin: 40, largMax: 96, semente: 73 },
      { f: 'massa', lado: 'baixo', rel: 1.28, amp: 62, escala: 0.0062, semente: 79,
        passo: 10, picos: 0.35 },
    ] },
  ],

  /* --- VÁRZEA: juncos, troncos submersos, lâmina d'água ------------------ */
  varzea: [
    { p: 0.045, d: 1.00, cor: 'distante', brilho: 0.19, formas: [
      { f: 'massa', lado: 'baixo', rel: 0.72, amp: 96, escala: 0.0009, semente: 101, passo: 18 },
    ] },
    { p: 0.095, d: 0.87, cor: 'distante', brilho: 0.12, formas: [
      { f: 'massa', lado: 'baixo', rel: 0.80, amp: 86, escala: 0.0016, semente: 103, passo: 16 },
      { f: 'troncos', rel: 0.78, passo: 340, dens: 0.6, compMin: 90, compMax: 200, semente: 107 },
      { f: 'juncos', rel: 0.80, passo: 70, dens: 0.7, compMin: 34, compMax: 90, escalaLarg: 0.6, semente: 109 },
    ] },
    { p: 0.17, d: 0.72, cor: 'medio', brilho: 0.05, formas: [
      { f: 'massa', lado: 'baixo', rel: 0.86, amp: 74, escala: 0.0024, semente: 113, passo: 14 },
      { f: 'juncos', rel: 0.86, passo: 84, dens: 0.78, compMin: 56, compMax: 150, escalaLarg: 0.8, semente: 127 },
    ] },
    { p: 0.28, d: 0.56, cor: 'medio', brilho: -0.02, formas: [
      { f: 'agua', rel: 0.90, altura: 420, semente: 131 },
      { f: 'troncos', rel: 0.90, passo: 400, dens: 0.66, compMin: 150, compMax: 330, semente: 137 },
    ] },
    { p: 0.42, d: 0.40, cor: 'proximo', brilho: -0.06, formas: [
      { f: 'massa', lado: 'baixo', rel: 1.02, amp: 66, escala: 0.0034, semente: 139, passo: 12 },
      { f: 'juncos', rel: 1.02, passo: 96, dens: 0.8, compMin: 90, compMax: 250, semente: 149 },
    ] },
    { p: 0.60, d: 0.24, cor: 'proximo', brilho: -0.13, formas: [
      { f: 'massa', lado: 'baixo', rel: 1.12, amp: 60, escala: 0.0046, semente: 151, passo: 11 },
      { f: 'troncos', rel: 1.10, passo: 520, dens: 0.5, compMin: 200, compMax: 380, semente: 157 },
    ] },
    { p: 0.82, d: 0.10, cor: 'proximo', brilho: -0.22, veu: 0, formas: [
      { f: 'juncos', rel: 1.26, passo: 140, dens: 0.6, compMin: 180, compMax: 420, escalaLarg: 1.6, semente: 163 },
    ] },
  ],

  /* --- CÂNION: as ruínas da fábrica da Fase 1 ---------------------------- */
  clareira: [
    { p: 0.045, d: 1.00, cor: 'distante', brilho: 0.20, formas: [
      { f: 'massa', lado: 'baixo', rel: 0.70, amp: 150, escala: 0.0009, semente: 201, passo: 18, picos: 0.8 },
      { f: 'massa', lado: 'cima', rel: 0.02, amp: 90, escala: 0.0011, semente: 203, passo: 18 },
    ] },
    { p: 0.095, d: 0.87, cor: 'distante', brilho: 0.13, formas: [
      { f: 'massa', lado: 'baixo', rel: 0.78, amp: 110, escala: 0.0015, semente: 207, passo: 16, picos: 0.9 },
      { f: 'chamines', rel: 0.78, passo: 230, dens: 0.55, altMin: 90, altMax: 250,
        escalaLarg: 0.6, torcao: 0.2, semente: 211 },
      { f: 'fumaca', rel: 0.55, passo: 300, dens: 0.4, semente: 213 },
    ] },
    { p: 0.17, d: 0.72, cor: 'medio', brilho: 0.05, formas: [
      { f: 'massa', lado: 'baixo', rel: 0.88, amp: 92, escala: 0.0022, semente: 217, passo: 14, picos: 0.7 },
      { f: 'torres', rel: 0.88, passo: 340, dens: 0.6, altMin: 110, altMax: 260, escalaLarg: 0.75, semente: 223 },
      { f: 'chamines', rel: 0.88, passo: 300, dens: 0.5, altMin: 140, altMax: 330,
        escalaLarg: 0.8, torcao: 0.22, semente: 227 },
    ] },
    { p: 0.28, d: 0.56, cor: 'medio', brilho: -0.02, formas: [
      { f: 'esteiras', rel: 0.80, passo: 480, dens: 0.7, escalaLarg: 0.85, semente: 229 },
      { f: 'massa', lado: 'baixo', rel: 0.98, amp: 80, escala: 0.003, semente: 233, passo: 13, picos: 0.6 },
      { f: 'escombros', rel: 0.98, passo: 200, dens: 0.6, escalaLarg: 0.9, semente: 239 },
    ] },
    { p: 0.42, d: 0.40, cor: 'proximo', brilho: -0.06, formas: [
      { f: 'cabos', rel: 0.16, passo: 300, dens: 0.72, escalaLarg: 1, semente: 241 },
      { f: 'chamines', rel: 1.04, passo: 420, dens: 0.42, altMin: 260, altMax: 520,
        escalaLarg: 1.15, torcao: 0.24, semente: 251 },
      { f: 'massa', lado: 'baixo', rel: 1.06, amp: 78, escala: 0.0042, semente: 257, passo: 11, picos: 0.7 },
    ] },
    { p: 0.60, d: 0.24, cor: 'proximo', brilho: -0.13, formas: [
      { f: 'esteiras', rel: 1.0, passo: 620, dens: 0.5, escalaLarg: 1.2, semente: 263 },
      { f: 'massa', lado: 'baixo', rel: 1.16, amp: 70, escala: 0.0055, semente: 269, passo: 10, picos: 0.6 },
      { f: 'escombros', rel: 1.16, passo: 230, dens: 0.55, escalaLarg: 1.2, semente: 271 },
    ] },
    { p: 0.82, d: 0.10, cor: 'proximo', brilho: -0.22, veu: 0, formas: [
      { f: 'cabos', rel: -0.10, passo: 380, dens: 0.5, escalaLarg: 1.8, semente: 277 },
      { f: 'escombros', rel: 1.3, passo: 300, dens: 0.45, escalaLarg: 1.8, semente: 281 },
    ] },
  ],

  /* --- DOSSEL: a árvore-mãe, troncos colossais e folhagem ---------------- */
  dossel: [
    { p: 0.045, d: 1.00, cor: 'distante', brilho: 0.20, formas: [
      { f: 'troncosColossais', rel: 1.35, passo: 300, dens: 0.85, largMin: 40, largMax: 110, semente: 301 },
    ] },
    { p: 0.095, d: 0.87, cor: 'distante', brilho: 0.13, formas: [
      { f: 'troncosColossais', rel: 1.4, passo: 340, dens: 0.7, largMin: 30, largMax: 90, semente: 307 },
      { f: 'folhagem', rel: 0.22, passo: 210, dens: 0.8, rMin: 70, rMax: 180, semente: 311 },
    ] },
    { p: 0.17, d: 0.72, cor: 'medio', brilho: 0.05, formas: [
      { f: 'galhos', rel: 0.20, passo: 380, dens: 0.7, escalaLarg: 0.7, semente: 313 },
      { f: 'massa', lado: 'baixo', rel: 0.92, amp: 88, escala: 0.0021, semente: 317, passo: 14 },
      { f: 'folhagem', rel: 0.30, passo: 250, dens: 0.72, rMin: 60, rMax: 150, semente: 331 },
    ] },
    { p: 0.28, d: 0.56, cor: 'medio', brilho: -0.02, formas: [
      { f: 'troncosColossais', rel: 1.5, passo: 420, dens: 0.55, largMin: 46, largMax: 130, semente: 337 },
      { f: 'galhos', rel: 0.36, passo: 440, dens: 0.65, escalaLarg: 0.9, semente: 347 },
    ] },
    { p: 0.42, d: 0.40, cor: 'proximo', brilho: -0.06, formas: [
      { f: 'massa', lado: 'baixo', rel: 1.04, amp: 74, escala: 0.0034, semente: 349, passo: 12 },
      { f: 'folhagem', rel: 0.14, passo: 300, dens: 0.66, rMin: 90, rMax: 220, semente: 353 },
    ] },
    { p: 0.60, d: 0.24, cor: 'proximo', brilho: -0.13, formas: [
      { f: 'troncosColossais', rel: 1.6, passo: 560, dens: 0.4, largMin: 60, largMax: 170, semente: 359 },
      { f: 'massa', lado: 'baixo', rel: 1.14, amp: 66, escala: 0.005, semente: 367, passo: 11 },
    ] },
    { p: 0.82, d: 0.10, cor: 'proximo', brilho: -0.22, veu: 0, formas: [
      { f: 'galhos', rel: -0.12, passo: 520, dens: 0.5, escalaLarg: 1.6, semente: 373 },
      { f: 'folhagem', rel: -0.16, passo: 400, dens: 0.5, rMin: 120, rMax: 280, semente: 379 },
    ] },
  ],

  /* --- CORAÇÃO: nada de rocha; carne, lobos, veias ----------------------- */
  coracao: [
    { p: 0.045, d: 1.00, cor: 'distante', brilho: 0.20, formas: [
      { f: 'organico', rel: 0.5, passo: 300, dens: 0.9, rMin: 150, rMax: 380, semente: 401 },
    ] },
    { p: 0.095, d: 0.87, cor: 'distante', brilho: 0.13, formas: [
      { f: 'organico', rel: 0.36, passo: 260, dens: 0.85, rMin: 110, rMax: 280, semente: 409 },
    ] },
    { p: 0.17, d: 0.72, cor: 'medio', brilho: 0.05, formas: [
      { f: 'organico', rel: 0.66, passo: 240, dens: 0.8, rMin: 90, rMax: 240, semente: 419 },
      { f: 'raizes', rel: 0.0, passo: 240, dens: 0.5, compMin: 200, compMax: 520,
        largMin: 10, largMax: 30, semente: 421 },
    ] },
    { p: 0.28, d: 0.56, cor: 'medio', brilho: -0.02, formas: [
      { f: 'organico', rel: 0.18, passo: 300, dens: 0.7, rMin: 100, rMax: 260, semente: 431 },
      { f: 'organico', rel: 0.92, passo: 280, dens: 0.7, rMin: 110, rMax: 270, semente: 433 },
    ] },
    { p: 0.42, d: 0.40, cor: 'proximo', brilho: -0.06, formas: [
      { f: 'organico', rel: 1.06, passo: 320, dens: 0.75, rMin: 130, rMax: 300, semente: 439 },
    ] },
    { p: 0.60, d: 0.24, cor: 'proximo', brilho: -0.13, formas: [
      { f: 'organico', rel: -0.04, passo: 340, dens: 0.6, rMin: 120, rMax: 290, semente: 443 },
      { f: 'organico', rel: 1.16, passo: 360, dens: 0.6, rMin: 140, rMax: 320, semente: 449 },
    ] },
    { p: 0.82, d: 0.10, cor: 'proximo', brilho: -0.22, veu: 0, formas: [
      { f: 'organico', rel: 1.3, passo: 420, dens: 0.5, rMin: 170, rMax: 380, semente: 457 },
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
    const forca = (l.intensidade ?? 1) * lerp(0.16, 0.30, t.pureza ?? 0);
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

  render.camada(P, (ctx, t, camera) => {
    const comp = Math.max(sala.altura, camera.altura / camera.zoom) * 1.25;
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < luzes.length; i++) {
      const l = luzes[i];
      const inten = (l.intensidade ?? 1) * (l.feixe ? 1 : 0.45);
      const x = l.x, y = l.feixe ? l.y : l.y - (l.raio ?? 200) * 0.4;
      // Três feixes de larguras diferentes: um feixe só tem borda dura de
      // trapézio e denuncia o truque; três sobrepostos dão penumbra.
      feixeLuz(ctx, x, y, comp, 230, ang, t.luz, inten * 0.16);
      feixeLuz(ctx, x - 26, y, comp * 0.88, 104, ang + 0.045, t.luz, inten * 0.17);
      feixeLuz(ctx, x + 30, y, comp * 0.94, 52, ang - 0.035, t.luz, inten * 0.20);
      poeiraNoFeixe(ctx, t, x, y, comp, 210, ang, inten, tempo, i);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  });

  render.emissivo(P, (ctx, t, camera) => {
    const comp = Math.max(sala.altura, camera.altura / camera.zoom) * 1.15;
    for (const l of luzes) {
      if (!l.feixe) continue;
      const inten = l.intensidade ?? 1;
      feixeLuz(ctx, l.x, l.y, comp, 44, ang, t.luz, inten * 0.30);
      feixeLuz(ctx, l.x, l.y, comp * 0.6, 16, ang, t.luz, inten * 0.34);
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

  desenharBrilhoDeFundo(render, sala, mundo);

  // A cor da camada ANTERIOR é o que as aberturas em arco usam pra parecerem
  // vãos iluminados ao fundo em vez de buracos pretos.
  let corTras = cor(tema, 'distante', 1, 0.24);

  for (let i = 0; i < camadas.length; i++) {
    const s = camadas[i];
    const c = cor(tema, s.cor, s.d, s.brilho);
    // A base da camada é mais lavada que o topo: a bruma se acumula embaixo e
    // é isso que derrete um plano no seguinte em vez de deixar borda de adesivo.
    const cBase = cor(tema, s.cor, Math.min(1, s.d * 1.34 + 0.04), s.brilho + 0.06);
    const cTras = corTras;

    render.camada(s.p, (ctx, t, camera) => {
      const a = prepararAmb(camera, sala, t, tempo, s.p, c, cBase, cTras, ang);
      for (let k = 0; k < s.formas.length; k++) {
        const f = s.formas[k];
        const fn = FORMAS[f.f];
        if (fn) fn(ctx, a, f);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    });

    corTras = c;

    // Véu só nas junções que precisam: uma névoa de tela cheia por camada é
    // meio megapixel de overdraw cada e lava o primeiro plano.
    const veu = s.veu != null ? s.veu : (i % 2 === 0 ? lerp(0.26, 0.05, i / (camadas.length - 1)) : 0);
    if (veu > 0) render.velarProfundidade(veu);

    if (i === quandoRaios) desenharRaios(render, sala, mundo);
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

/** 1 nas bordas da tela, ~0 no centro — a máscara que protege o jogador. */
function opacidadeDeBorda(sxCentro, largura) {
  const t = Math.abs(sxCentro / (largura * 0.5));
  const k = clamp01((t - 0.30) / 0.42);
  return k * k * (3 - 2 * k);
}

const MOLDURA = {
  // O sub-bosque é FLORESTA: a moldura de cima é galho, não estalactite.
  // Com estalactite a cena inteira lia como gruta, por mais troncos que
  // houvesse no parallax — o primeiro plano é o que mais define o lugar,
  // porque é o que está mais perto e mais escuro.
  raizes: { base: 'raizGrossa', topo: 'galhoFolhado' },
  varzea: { base: 'folhaLarga', topo: 'juncoAlto' },
  clareira: { base: 'viga', topo: 'cano' },
  dossel: { base: 'raizGrossa', topo: 'galhoFolhado' },
  coracao: { base: 'lobo', topo: 'lobo' },
};

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
    const centroTela = esq + vw * 0.5;
    const yBase = sala.altura * 0.5 + vh * 0.5;
    const yTopo = sala.altura * 0.5 - vh * 0.5;

    ctx.fillStyle = t.primeiroPlano;
    ctx.strokeStyle = t.primeiroPlano;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    desenharMolduraBase(ctx, molde.base, esq, vw, vh, yBase, centroTela, tempo, t);
    desenharMolduraTopo(ctx, molde.topo, esq, vw, vh, yTopo, centroTela, tempo, t);
    ctx.globalAlpha = 1;
  });
}

function desenharMolduraBase(ctx, tipo, esq, vw, vh, yBase, centroTela, tempo, tema) {
  const passo = 430;
  const x0 = Math.floor((esq - passo) / passo) * passo;
  for (let x = x0; x <= esq + vw + passo; x += passo) {
    const h = hash2(x, 811, 5);
    if (h > 0.7) continue;
    const h2 = hash2(x, 821, 5);
    const h3 = hash2(x, 823, 5);
    const px = x + (h2 - 0.5) * passo * 0.75;
    const alfa = opacidadeDeBorda(px - centroTela, vw);
    if (alfa < 0.02) continue;
    ctx.globalAlpha = alfa;

    const escala = lerp(0.7, 1.5, h3);
    switch (tipo) {
      case 'raizGrossa': {
        // raiz saindo do chão e arqueando — massa larga embaixo, ponta fina
        const alt = vh * lerp(0.20, 0.46, h3);
        const larg = lerp(40, 110, h2);
        ctx.beginPath();
        ctx.moveTo(px - larg, yBase + 60);
        ctx.bezierCurveTo(px - larg * 0.8, yBase - alt * 0.35,
          px - larg * 0.15, yBase - alt * 0.8, px + (h - 0.5) * 90, yBase - alt);
        ctx.bezierCurveTo(px + larg * 0.3, yBase - alt * 0.72,
          px + larg * 0.85, yBase - alt * 0.3, px + larg, yBase + 60);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'folhaLarga': {
        // par de folhas de várzea abrindo em leque
        const alt = vh * lerp(0.16, 0.34, h3);
        for (let i = 0; i < 3; i++) {
          const hi = hash2(x + i * 11, 829, 5);
          const incl = (hi - 0.5) * 1.5 + Math.sin(tempo * 0.4 + hi * TAU) * 0.05;
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

function desenharMolduraTopo(ctx, tipo, esq, vw, vh, yTopo, centroTela, tempo, tema) {
  const passo = 300;
  const x0 = Math.floor((esq - passo) / passo) * passo;
  for (let x = x0; x <= esq + vw + passo; x += passo) {
    const h = hash2(x, 907, 9);
    if (h > 0.78) continue;
    const h2 = hash2(x, 911, 9);
    const h3 = hash2(x, 919, 9);
    const px = x + (h2 - 0.5) * passo * 0.8;
    // O topo cobre menos o jogador (ele fica no terço inferior), então a
    // máscara de centro pode ser bem mais suave aqui.
    const alfa = lerp(0.45, 1, opacidadeDeBorda(px - centroTela, vw));
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
        ctx.fillRect(px - d * 0.5, yTopo - 30, d, comp);
        ctx.fillRect(px - d * 0.85, yTopo + comp - d * 0.5, d * 1.7, d * 0.5);
        // cotovelo quebrado
        if (h3 > 0.55) {
          ctx.save();
          ctx.translate(px, yTopo + comp);
          ctx.rotate(lerp(-0.9, 0.9, h2));
          ctx.fillRect(-d * 0.45, 0, d * 0.9, comp * 0.5);
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
