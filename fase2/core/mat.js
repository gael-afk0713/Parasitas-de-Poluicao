/* =========================================================================
   fase2/core/mat.js — matemática compartilhada
   -------------------------------------------------------------------------
   Zero dependências. Tudo aqui é puro e determinístico (com exceção de
   `Rng`, que é determinístico dado uma semente). Qualquer sistema da Fase 2
   pode importar daqui; NADA aqui pode importar de outro módulo do jogo.
   ========================================================================= */

export const TAU = Math.PI * 2;

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const clamp01 = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const inverseLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const remap = (v, a1, b1, a2, b2) => lerp(a2, b2, clamp01(inverseLerp(a1, b1, v)));
export const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** Aproxima `a` de `b` no máximo `passo` — evita o overshoot de um lerp por frame. */
export const moveTowards = (a, b, passo) => {
  const d = b - a;
  return Math.abs(d) <= passo ? b : a + sign(d) * passo;
};

/**
 * Lerp com meia-vida, independente de framerate.
 * `meiaVida` = segundos pra fechar metade da distância restante.
 * Preferir SEMPRE isso a `lerp(a, b, 0.1)` dentro de um update — o lerp cru
 * muda de velocidade conforme o FPS, esse não.
 */
export const damp = (a, b, meiaVida, dt) =>
  meiaVida <= 0 ? b : b + (a - b) * Math.pow(2, -dt / meiaVida);

// ---------------------------------------------------------------- easing --
// Todas recebem e devolvem 0..1. Nomes seguem a convenção do easings.net.
export const easeInQuad = (t) => t * t;
export const easeOutQuad = (t) => t * (2 - t);
export const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
export const easeInCubic = (t) => t * t * t;
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeInExpo = (t) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10));
export const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeOutElastic = (t) => {
  if (t === 0 || t === 1) return t;
  const c4 = TAU / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};
/** Sobe e volta — útil pra flash/pulso de um disparo só. */
export const pulso = (t) => Math.sin(clamp01(t) * Math.PI);

// ------------------------------------------------------------------- rng --
/**
 * PRNG determinístico (mulberry32). Duas instâncias com a mesma semente dão
 * exatamente a mesma sequência — é o que deixa o mundo procedural ser sempre
 * o MESMO mundo entre sessões, sem precisar salvar a geometria no Firestore.
 */
export class Rng {
  constructor(semente = 1) { this.s = semente >>> 0 || 1; }
  /** 0 <= x < 1 */
  next() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + this.next() * (b - a); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  /** -1 ou 1 */
  sinal() { return this.next() < 0.5 ? -1 : 1; }
  bool(p = 0.5) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  /** Fisher-Yates in-place, determinístico. */
  embaralhar(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/** Hash 2D→[0,1) sem estado. Mesmo (x,y,semente) ⇒ mesmo valor, sempre. */
export function hash2(x, y, semente = 0) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ (semente | 0);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

// ----------------------------------------------------------------- ruído --
/**
 * Value noise 1D com interpolação suave — barato e suficiente pra ondulação
 * de terreno/vento. (Não é Perlin; não precisamos de gradiente aqui.)
 */
export function ruido1(x, semente = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);            // smoothstep
  return lerp(hash2(i, 0, semente), hash2(i + 1, 0, semente), u);
}

export function ruido2(x, y, semente = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, semente);
  const b = hash2(xi + 1, yi, semente);
  const c = hash2(xi, yi + 1, semente);
  const d = hash2(xi + 1, yi + 1, semente);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** Soma de oitavas — dá detalhe fractal (montanha, névoa, casca de árvore). */
export function fbm2(x, y, oitavas = 4, semente = 0) {
  let soma = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < oitavas; i++) {
    soma += ruido2(x * freq, y * freq, semente + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return soma / norm;
}

// ------------------------------------------------------------- geometria --
export const dist2 = (ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
};
export const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));

/** Menor diferença angular entre dois ângulos, em (-PI, PI]. */
export function difAngulo(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export const aabbColide = (ax, ay, aw, ah, bx, by, bw, bh) =>
  ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

/**
 * Sobreposição entre dois retângulos no formato `{x, y, largura, altura}` —
 * o formato que `caixa()` das entidades devolve.
 *
 * Mora aqui, e não em `mundo/mundo.js`, de propósito: as entidades precisam
 * disso e `mundo.js` precisa do catálogo de entidades, então tê-lo lá criava
 * um ciclo de importação. `core/mat.js` não importa nada, então é sempre o
 * lugar seguro para um utilitário compartilhado.
 */
export const sobrepoe = (a, b) =>
  a.x < b.x + b.largura && a.x + a.largura > b.x &&
  a.y < b.y + b.altura && a.y + a.altura > b.y;

/** Entidade (que tem x/y/largura/altura soltos) → retângulo. */
export const caixaDe = (e) => ({ x: e.x, y: e.y, largura: e.largura, altura: e.altura });

/** Ponto dentro de um círculo — usa dist2 pra evitar a raiz quadrada. */
export const noCirculo = (px, py, cx, cy, r) => dist2(px, py, cx, cy) <= r * r;

/**
 * Catmull-Rom: interpola passando POR CIMA dos pontos de controle (ao
 * contrário de Bézier). É o que transforma o contorno serrilhado do
 * marching squares numa curva orgânica de traço à mão.
 */
export function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

/**
 * Suaviza um caminho fechado (array de {x,y}) via Catmull-Rom.
 * `subdiv` = quantos pontos gerados por segmento original.
 * Devolve um array novo; não muta a entrada.
 */
export function suavizarCaminho(pontos, subdiv = 4) {
  const n = pontos.length;
  if (n < 3) return pontos.slice();
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = pontos[(i - 1 + n) % n];
    const p1 = pontos[i];
    const p2 = pontos[(i + 1) % n];
    const p3 = pontos[(i + 2) % n];
    for (let s = 0; s < subdiv; s++) {
      const t = s / subdiv;
      out.push({
        x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
        y: catmullRom(p0.y, p1.y, p2.y, p3.y, t),
      });
    }
  }
  return out;
}

/**
 * Remove pontos EXATAMENTE colineares de um caminho fechado.
 * Um muro de 10 tiles vira 2 pontos. Diferente do Douglas-Peucker abaixo,
 * isto é exato: nunca muda a forma, só apaga pontos redundantes.
 */
export function fundirColineares(pontos, epsilon = 0.001) {
  const n = pontos.length;
  if (n < 3) return pontos.slice();
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = pontos[(i - 1 + n) % n], b = pontos[i], c = pontos[(i + 1) % n];
    // Produto vetorial ~0 ⇒ b está na reta a-c ⇒ é descartável.
    const cruz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cruz) > epsilon) out.push(b);
  }
  return out.length >= 3 ? out : pontos.slice();
}

/**
 * Reamostra um caminho fechado com espaçamento uniforme.
 * Necessário antes de deslocar por ruído: sem espaçamento constante, trechos
 * longos recebem uma ondulação por dezenas de px e trechos curtos recebem
 * várias, e o terreno fica com "textura" irregular sem motivo.
 */
export function reamostrarCaminho(pontos, espacamento = 14) {
  const n = pontos.length;
  if (n < 3) return pontos.slice();

  let perimetro = 0;
  for (let i = 0; i < n; i++) {
    const a = pontos[i], b = pontos[(i + 1) % n];
    perimetro += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const total = Math.max(3, Math.round(perimetro / espacamento));
  const passo = perimetro / total;

  const out = [];
  let i = 0;
  let restanteNoSegmento = 0;
  let a = pontos[0], b = pontos[1 % n];
  let compSeg = Math.hypot(b.x - a.x, b.y - a.y);
  let percorrido = 0;

  for (let k = 0; k < total; k++) {
    const alvo = k * passo;
    while (percorrido + compSeg < alvo && i < n * 2) {
      percorrido += compSeg;
      i++;
      a = pontos[i % n];
      b = pontos[(i + 1) % n];
      compSeg = Math.hypot(b.x - a.x, b.y - a.y);
    }
    const t = compSeg > 0 ? (alvo - percorrido) / compSeg : 0;
    out.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
  }
  return out;
}

/**
 * Chaikin — corta cantos por subdivisão. Preferido ao Catmull-Rom para
 * terreno: cada ponto novo é uma COMBINAÇÃO CONVEXA dos vizinhos, então a
 * curva nunca sai do polígono original. Catmull-Rom faz overshoot em cantos
 * fechados, e num terreno isso significa desenhar chão onde a colisão não
 * tem — o jogador cai atravessando o que parecia sólido.
 */
export function chaikin(pontos, passadas = 2) {
  let atual = pontos;
  for (let p = 0; p < passadas; p++) {
    const n = atual.length;
    if (n < 3) break;
    const prox = new Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = atual[i], b = atual[(i + 1) % n];
      prox[i * 2] = { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 };
      prox[i * 2 + 1] = { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 };
    }
    atual = prox;
  }
  return atual;
}

/**
 * Ramer-Douglas-Peucker em caminho FECHADO — tira pontos colineares que o
 * marching squares gera às centenas, antes de suavizar. Sem isso o
 * Catmull-Rom recebe ruído de quantização e devolve uma borda tremida.
 */
export function simplificarCaminho(pontos, tolerancia = 1.2) {
  if (pontos.length < 4) return pontos.slice();
  const marcados = new Uint8Array(pontos.length);
  marcados[0] = 1;
  marcados[pontos.length - 1] = 1;

  const pilha = [[0, pontos.length - 1]];
  while (pilha.length) {
    const [ini, fim] = pilha.pop();
    if (fim - ini < 2) continue;
    const a = pontos[ini], b = pontos[fim];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    let pior = -1, piorD = tolerancia;
    for (let i = ini + 1; i < fim; i++) {
      const p = pontos[i];
      // distância perpendicular ponto→reta
      const d = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
      if (d > piorD) { piorD = d; pior = i; }
    }
    if (pior !== -1) {
      marcados[pior] = 1;
      pilha.push([ini, pior], [pior, fim]);
    }
  }
  const out = [];
  for (let i = 0; i < pontos.length; i++) if (marcados[i]) out.push(pontos[i]);
  return out;
}

/** Área com sinal de um polígono. Negativa = sentido horário em tela (y↓). */
export function areaPoligono(pontos) {
  let a = 0;
  for (let i = 0, n = pontos.length; i < n; i++) {
    const p = pontos[i], q = pontos[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

// -------------------------------------------------------------------- cor --
/** '#rrggbb' → {r,g,b} 0-255. Aceita com ou sem '#'. */
export function hexParaRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export const rgbParaHex = (r, g, b) =>
  '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

/**
 * Mistura duas cores hex. É o motor visual da restauração: cada camada tem
 * uma cor "poluída" e uma "restaurada", e `t` é a pureza da área.
 */
export function misturarHex(hexA, hexB, t) {
  const a = hexParaRgb(hexA), b = hexParaRgb(hexB);
  return rgbParaHex(lerp(a.r, b.r, t), lerp(a.g, b.g, t), lerp(a.b, b.b, t));
}

export function rgba(hex, alpha) {
  const { r, g, b } = hexParaRgb(hex);
  return `rgba(${r},${g},${b},${clamp01(alpha)})`;
}

/** Clareia (f>0) ou escurece (f<0) uma cor hex. f em -1..1. */
export function ajustarBrilho(hex, f) {
  const { r, g, b } = hexParaRgb(hex);
  const alvo = f > 0 ? 255 : 0;
  const t = Math.abs(f);
  return rgbParaHex(lerp(r, alvo, t), lerp(g, alvo, t), lerp(b, alvo, t));
}
