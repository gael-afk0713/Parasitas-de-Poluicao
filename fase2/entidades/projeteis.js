/* =========================================================================
   fase2/entidades/projeteis.js — projéteis e perigos reaproveitáveis
   -------------------------------------------------------------------------
   Um projétil é uma entidade NORMAL (mesmo contrato de mundo.js): basta
   empurrar em `mundo.entidades` e o resto acontece sozinho — colisão com o
   jogador, desenho no passe normal e no emissivo, remoção quando `morta`.

   Quatro decisões que valem o comentário, porque não são óbvias:

   1. TODO projétil morre no golpe do jogador. O laço de combate de mundo.js
      consome o ataque no PRIMEIRO alvo sobreposto, e projéteis entram na
      lista depois dos inimigos — ou seja, eles interceptariam o golpe de
      qualquer jeito. Em vez de deixar isso virar "meu ataque sumiu sem
      motivo", virou mecânica: dá pra cortar o cuspe no ar. Uma regra só,
      legível, e ainda custa o tempo do golpe.

   2. Subpasso de integração. A 900 px/s (chefe) um passo de 1/120 anda
      7,5 px; sem subdividir, o projétil atravessa parede de 1 tile em certas
      diagonais. O custo é irrisório e o bug é impossível de reproduzir.

   3. Nenhuma cor literal. Cada projétil guarda a CHAVE do tema ('acento',
      'luz', …) e resolve no desenho — assim ele participa da restauração
      igual ao resto do mundo, em vez de ficar morto numa sala revivida.

   4. A caixa de dano é MENOR que o desenho (fator 0,82). Projétil que
      machuca de raspão parece injusto mesmo quando é tecnicamente correto;
      o contrário (perdoar um pixel) ninguém percebe.
   ========================================================================= */

import { TAU, clamp, clamp01, lerp, rgba, misturarHex, difAngulo } from '../core/mat.js';
import { luzRadial } from '../render/renderizador.js';

/** Gravidade dos projéteis em arco.
 *  Metade da do jogador (2031) de propósito: arco lento é arco LEGÍVEL — dá
 *  pra ler o ponto de queda antes de a coisa chegar, e é isso que separa
 *  "ataque difícil" de "ataque injusto". */
export const G_ARCO = 980;

/** Passo máximo de integração, em px de mundo. */
const PASSO_MAX = 5;

/** Aceita chave do tema ('acento') ou um hex já resolvido. */
export function corDe(tema, chave) {
  if (!chave) return tema.acento;
  return chave[0] === '#' ? chave : (tema[chave] ?? tema.acento);
}

/* ==========================================================================
   BASE
   ========================================================================== */

export class Projetil {
  constructor(op = {}) {
    // Centro, não canto superior-esquerdo: projétil é radial e todo o resto
    // do arquivo (rastro, luz, colisão) assume isso.
    this.x = op.x ?? 0;
    this.y = op.y ?? 0;
    this.vx = op.vx ?? 0;
    this.vy = op.vy ?? 0;
    this.g = op.g ?? 0;
    this.raio = op.raio ?? 5.5;
    this.dano = op.dano ?? 1;
    this.duracao = op.duracao ?? 5;
    this.cor = op.cor ?? 'acento';
    this.corNucleo = op.corNucleo ?? 'primeiroPlano';
    this.atravessa = op.atravessa ?? false;    // ignora terreno
    this.aoBater = op.aoBater ?? null;         // (mundo, projetil)
    this.cortavel = op.cortavel ?? true;

    this.perigoso = true;
    this.morta = false;
    this.t = 0;
    this.giro = op.giro ?? Math.random() * TAU;
    this.velGiro = op.velGiro ?? 2.4;
    this.rastro = [];
    this.maxRastro = op.maxRastro ?? 14;
  }

  get centroX() { return this.x; }
  get centroY() { return this.y; }

  caixa() {
    const r = this.raio * 0.82;
    return { x: this.x - r, y: this.y - r, largura: r * 2, altura: r * 2 };
  }

  atualizar(dt, mundo) {
    this.t += dt;
    if (this.t >= this.duracao) { this._expirar(mundo); return; }
    this.giro += this.velGiro * dt;
    this.vy += this.g * dt;
    this.aoAntesDeMover?.(dt, mundo);
    this._integrar(dt, mundo);
    if (this.morta) return;
    this.rastro.push({ x: this.x, y: this.y });
    if (this.rastro.length > this.maxRastro) this.rastro.shift();
  }

  _integrar(dt, mundo) {
    const terreno = mundo.sala?.terreno;
    const passo = Math.hypot(this.vx, this.vy) * dt;
    const n = Math.max(1, Math.ceil(passo / PASSO_MAX));
    const sx = (this.vx * dt) / n;
    const sy = (this.vy * dt) / n;
    for (let i = 0; i < n; i++) {
      this.x += sx;
      this.y += sy;
      if (this.atravessa || !terreno) continue;
      const r = this.raio * 0.62;
      if (terreno.caixaSolida(this.x - r, this.y - r, r * 2, r * 2)) {
        this.x -= sx; this.y -= sy;
        this._bater(mundo);
        return;
      }
    }
  }

  _bater(mundo) {
    this.morta = true;
    this.aoBater?.(mundo, this);
    mundo.emitir(this.x, this.y, 8, {
      velMin: 30, velMax: 150, g: 260, vidaMin: 0.18, vidaMax: 0.5,
      cor: mundo.tema[this.cor] ?? mundo.tema.acento, brilha: true,
    });
  }

  _expirar(mundo) {
    this.morta = true;
    mundo.emitir(this.x, this.y, 4, {
      velMin: 10, velMax: 60, g: 60, vidaMin: 0.2, vidaMax: 0.5,
      cor: mundo.tema[this.cor] ?? mundo.tema.acento, brilha: true,
    });
  }

  /** O nail corta o projétil no ar — ver comentário 1 do cabeçalho. */
  receberDano(n, deX, deY, mundo) {
    if (!this.cortavel) return;
    this.morta = true;
    mundo.emitir(this.x, this.y, 14, {
      velMin: 90, velMax: 300, g: 180, vidaMin: 0.2, vidaMax: 0.6,
      cor: mundo.tema.crista, brilha: true, arrasto: 0.4,
    });
    mundo.laco?.congelar(0.035);
  }

  /* ------------------------------------------------------------ desenho -- */

  _desenharRastro(ctx, tema, alfaBase = 0.5) {
    const n = this.rastro.length;
    if (n < 2) return;
    const cor = corDe(tema, this.cor);
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1);
      ctx.globalAlpha = alfaBase * k * k;
      ctx.fillStyle = cor;
      ctx.beginPath();
      ctx.arc(this.rastro[i].x, this.rastro[i].y, this.raio * (0.25 + k * 0.6), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  desenhar(ctx, tema) {
    this._desenharRastro(ctx, tema, 0.42);
    const ang = Math.atan2(this.vy, this.vx);
    const vel = Math.hypot(this.vx, this.vy);
    // Alonga na direção do movimento: um disco redondo em alta velocidade
    // parece flutuar; alongado parece ter sido ATIRADO.
    const alonga = 1 + clamp01(vel / 700) * 0.9;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(ang);
    ctx.fillStyle = misturarHex(corDe(tema, this.corNucleo), corDe(tema, this.cor), 0.45);
    ctx.beginPath();
    ctx.ellipse(0, 0, this.raio * alonga, this.raio, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = corDe(tema, this.cor);
    ctx.beginPath();
    ctx.ellipse(this.raio * (alonga - 1) * 0.5, 0, this.raio * 0.52, this.raio * 0.46, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  desenharLuz(ctx, tema) {
    luzRadial(ctx, this.x, this.y, this.raio * 4.2, corDe(tema, this.cor), 0.55);
  }
}

/* ==========================================================================
   RETO — velocidade constante, linha limpa. O tijolo de todo padrão.
   ========================================================================== */

export class ProjetilReto extends Projetil {
  constructor(op = {}) {
    super({ g: 0, velGiro: 0, ...op });
    /**
     * Rotação constante da velocidade, em rad/s. Zero = reto de verdade.
     *
     * Existe para o "anel girante" do Coração: um anel com vão, em que os
     * projéteis curvam todos no mesmo sentido, faz o VÃO VIAJAR em volta do
     * jogador. É o que impede a resposta da fase anterior (achar o vão e
     * ficar parado nele) de continuar funcionando na fase seguinte — a fase 2
     * recontextualiza a fase 1 em vez de só acelerar.
     */
    this.curvatura = op.curvatura ?? 0;
  }

  aoAntesDeMover(dt) {
    if (!this.curvatura) return;
    const c = Math.cos(this.curvatura * dt);
    const s = Math.sin(this.curvatura * dt);
    const vx = this.vx * c - this.vy * s;
    const vy = this.vx * s + this.vy * c;
    this.vx = vx; this.vy = vy;
  }
}

/* ==========================================================================
   ARCO — cai. Deixa uma poça no ponto de impacto, então nega ESPAÇO, não só
   a trajetória: o jogador tem que decidir onde o chão vai ficar proibido.
   ========================================================================== */

export class ProjetilArco extends Projetil {
  constructor(op = {}) {
    super({ g: op.g ?? G_ARCO, velGiro: 5.5, maxRastro: 18, ...op });
    this.poca = op.poca ?? true;
    this.larguraPoca = op.larguraPoca ?? 56;
    this.duracaoPoca = op.duracaoPoca ?? 4.6;
  }

  _bater(mundo) {
    if (this.poca) {
      mundo.entidades.push(new PocaAcida(this.x, this.y, {
        largura: this.larguraPoca, duracao: this.duracaoPoca, cor: this.cor,
      }));
    }
    super._bater(mundo);
  }

  desenhar(ctx, tema) {
    this._desenharRastro(ctx, tema, 0.34);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.giro);
    // Gota gosmenta: contorno irregular que oscila — massa, não bolinha.
    ctx.fillStyle = misturarHex(corDe(tema, this.corNucleo), corDe(tema, this.cor), 0.5);
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * TAU;
      const r = this.raio * (1 + Math.sin(a * 3 + this.t * 9) * 0.18);
      const px = Math.cos(a) * r, py = Math.sin(a) * r * 1.12;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = corDe(tema, this.cor);
    ctx.beginPath();
    ctx.arc(-this.raio * 0.18, -this.raio * 0.2, this.raio * 0.4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}

/* ==========================================================================
   TELEGUIADO — lento e curva devagar. Não existe pra acertar: existe pra
   OCUPAR o espaço enquanto o jogador resolve outra coisa. Por isso a taxa de
   giro é baixa o bastante pra ser sempre superada por uma investida.
   ========================================================================== */

export class ProjetilTeleguiado extends Projetil {
  constructor(op = {}) {
    super({ g: 0, velGiro: 0, maxRastro: 20, duracao: op.duracao ?? 6, ...op });
    this.vel = op.vel ?? 132;
    this.giroMax = op.giroMax ?? 2.0;      // rad/s
    this.atrasoPerseguicao = op.atraso ?? 0.35;  // s de voo reto antes de curvar
    this.ang = Math.atan2(this.vy, this.vx);
    const v = Math.hypot(this.vx, this.vy) || 1;
    this.vx = (this.vx / v) * this.vel;
    this.vy = (this.vy / v) * this.vel;
  }

  aoAntesDeMover(dt, mundo) {
    if (this.t < this.atrasoPerseguicao) return;
    const j = mundo.jogador;
    if (!j?.vivo) return;
    const alvo = Math.atan2(j.centroY - this.y, j.centroX - this.x);
    // Aceleração ANGULAR, não teleporte de direção: a curva fica visível e o
    // jogador consegue "descascar" o projétil dando a volta nele.
    const d = difAngulo(this.ang, alvo);
    this.ang += clamp(d, -this.giroMax * dt, this.giroMax * dt);
    this.vx = Math.cos(this.ang) * this.vel;
    this.vy = Math.sin(this.ang) * this.vel;
  }

  desenhar(ctx, tema) {
    this._desenharRastro(ctx, tema, 0.55);
    const pulso = 0.85 + Math.sin(this.t * 12) * 0.15;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.ang);
    ctx.fillStyle = misturarHex(corDe(tema, this.corNucleo), corDe(tema, this.cor), 0.3);
    ctx.beginPath();
    ctx.ellipse(0, 0, this.raio * 1.5, this.raio * 0.85 * pulso, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = corDe(tema, this.cor);
    ctx.beginPath();
    ctx.arc(this.raio * 0.35, 0, this.raio * 0.5 * pulso, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  desenharLuz(ctx, tema) {
    const pulso = 0.6 + Math.sin(this.t * 12) * 0.25;
    luzRadial(ctx, this.x, this.y, this.raio * 6, corDe(tema, this.cor), pulso);
  }
}

/* ==========================================================================
   POÇA — perigo persistente no chão. Cortável: dispersar a poça é uma opção
   real, custa um golpe, e evita que "meu ataque foi engolido pela poça"
   pareça bug.
   ========================================================================== */

export class PocaAcida {
  constructor(x, y, op = {}) {
    this.x = x;
    this.y = y;
    this.larguraAlvo = op.largura ?? 56;
    this.largura = 6;
    this.duracao = op.duracao ?? 4.6;
    this.dano = op.dano ?? 1;
    this.cor = op.cor ?? 'acento';
    this.perigoso = true;
    this.morta = false;
    this.t = 0;
    this._assentou = false;
    this.semente = Math.random() * 100;
  }

  caixa() {
    const w = this.largura * this._fade();
    return { x: this.x - w / 2, y: this.y - 11, largura: w, altura: 13 };
  }

  /** Cresce rápido, encolhe no fim — o encolhimento avisa que vai liberar. */
  _fade() {
    const k = this.t / this.duracao;
    if (k > 0.82) return clamp01((1 - k) / 0.18);
    return 1;
  }

  atualizar(dt, mundo) {
    this.t += dt;
    if (!this._assentou) {
      // Assenta no chão só no primeiro passo: o construtor não tem terreno.
      const d = mundo.sala.terreno.alturaAteChao(this.x, this.y - 8, 6);
      if (Number.isFinite(d)) this.y = this.y - 8 + d;
      this._assentou = true;
    }
    this.largura = lerp(this.largura, this.larguraAlvo, 1 - Math.pow(0.001, dt));
    if (this.t >= this.duracao) this.morta = true;
    if (Math.random() < dt * 5) {
      mundo.emitir(this.x + (Math.random() - 0.5) * this.largura, this.y - 4, 1, {
        velMin: 12, velMax: 46, g: -40, vidaMin: 0.4, vidaMax: 0.9,
        cor: mundo.tema[this.cor] ?? mundo.tema.acento, brilha: true, raioMax: 2,
      });
    }
  }

  receberDano(n, deX, deY, mundo) {
    this.larguraAlvo *= 0.5;
    this.largura *= 0.5;
    this.t += this.duracao * 0.35;
    mundo.emitir(this.x, this.y - 6, 12, {
      velMin: 60, velMax: 220, g: 300, vidaMin: 0.2, vidaMax: 0.5,
      cor: mundo.tema.crista, brilha: true,
    });
    if (this.larguraAlvo < 14) this.morta = true;
  }

  _perfil(i, n) {
    // Contorno irregular estável (não muda de frame a frame) + ondulação lenta.
    const a = (i / n) * Math.PI;
    return Math.sin(a) * (0.75 + 0.25 * Math.sin(i * 1.7 + this.semente))
      * (1 + Math.sin(this.t * 2.2 + i) * 0.06);
  }

  desenhar(ctx, tema) {
    const f = this._fade();
    const w = this.largura * f;
    if (w < 2) return;
    const cor = corDe(tema, this.cor);
    ctx.save();
    ctx.globalAlpha = 0.9 * f;
    ctx.fillStyle = misturarHex(tema.primeiroPlano, cor, 0.55);
    ctx.beginPath();
    ctx.moveTo(this.x - w / 2, this.y);
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const px = this.x - w / 2 + (w * i) / n;
      ctx.lineTo(px, this.y - 3 - this._perfil(i, n) * 9);
    }
    ctx.lineTo(this.x + w / 2, this.y);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  desenharLuz(ctx, tema) {
    const f = this._fade();
    luzRadial(ctx, this.x, this.y - 4, this.largura * 0.75 * f, corDe(tema, this.cor),
      0.4 * f * (0.8 + Math.sin(this.t * 3) * 0.2));
  }
}

/* ==========================================================================
   ONDA DE CHOQUE — anda colada no chão e morre em parede/precipício.
   O contrato com o jogador é: SEMPRE dá pra pular. Por isso a altura é fixa
   (34px < 99px de pulo) e a velocidade nunca passa da corrida (232 px/s).
   ========================================================================== */

export class OndaChoque {
  constructor(op = {}) {
    this.x = op.x ?? 0;
    this.y = op.y ?? 0;             // linha do chão
    this.dir = op.dir ?? 1;
    this.vel = op.vel ?? 224;
    this.alcance = op.alcance ?? 600;
    this.alturaOnda = op.altura ?? 34;
    this.dano = op.dano ?? 1;
    this.cor = op.cor ?? 'luz';
    this.perigoso = true;
    this.morta = false;
    this.t = 0;
    this.percorrido = 0;
  }

  caixa() {
    const h = this.alturaOnda * this._forca();
    return { x: this.x - 13, y: this.y - h, largura: 26, altura: h };
  }

  _forca() {
    const k = 1 - this.percorrido / this.alcance;
    return clamp01(k) * clamp01(this.t / 0.06);
  }

  atualizar(dt, mundo) {
    this.t += dt;
    const terreno = mundo.sala.terreno;
    const d = this.vel * dt;
    this.x += d * this.dir;
    this.percorrido += d;

    // Parede na frente: a onda quebra.
    if (terreno.caixaSolida(this.x + this.dir * 12 - 4, this.y - 26, 8, 22)) {
      this._quebrar(mundo); return;
    }
    // Acompanha o relevo; sem chão logo abaixo, a onda se desfaz na borda.
    const queda = terreno.alturaAteChao(this.x, this.y - 30, 3);
    if (!Number.isFinite(queda)) { this._quebrar(mundo); return; }
    this.y = this.y - 30 + queda;

    if (this.percorrido >= this.alcance) this.morta = true;
    if (Math.random() < dt * 22) {
      mundo.emitir(this.x, this.y - 4, 1, {
        velMin: 40, velMax: 140, g: 320, vidaMin: 0.2, vidaMax: 0.5,
        cor: mundo.tema[this.cor] ?? mundo.tema.luz, brilha: true, raioMax: 2.4,
      });
    }
  }

  _quebrar(mundo) {
    this.morta = true;
    mundo.emitir(this.x, this.y - 10, 12, {
      velMin: 60, velMax: 240, g: 380, vidaMin: 0.2, vidaMax: 0.6,
      cor: mundo.tema[this.cor] ?? mundo.tema.luz, brilha: true,
    });
  }

  receberDano(n, deX, deY, mundo) {
    this._quebrar(mundo);
    mundo.laco?.congelar(0.04);
  }

  desenhar(ctx, tema) {
    const f = this._forca();
    if (f <= 0.01) return;
    const h = this.alturaOnda * f;
    const cor = corDe(tema, this.cor);
    ctx.save();
    ctx.globalAlpha = 0.85 * f;
    ctx.fillStyle = misturarHex(tema.terreno, cor, 0.55);
    ctx.beginPath();
    ctx.moveTo(this.x - this.dir * 22, this.y + 2);
    ctx.quadraticCurveTo(this.x - this.dir * 6, this.y - h * 1.1, this.x + this.dir * 6, this.y - h * 0.55);
    ctx.quadraticCurveTo(this.x + this.dir * 14, this.y - h * 0.2, this.x + this.dir * 20, this.y + 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = cor;
    ctx.lineWidth = 2;
    ctx.globalAlpha = f;
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  desenharLuz(ctx, tema) {
    const f = this._forca();
    luzRadial(ctx, this.x, this.y - this.alturaOnda * 0.4 * f, 46 * f, corDe(tema, this.cor), 0.75 * f);
  }
}

/* ==========================================================================
   EXPLOSÃO — perigo radial de vida curtíssima. Não é cortável: o que se corta
   é o inimigo ANTES, não a consequência.
   ========================================================================== */

export class Explosao {
  constructor(op = {}) {
    this.x = op.x ?? 0;
    this.y = op.y ?? 0;
    this.raio = op.raio ?? 78;
    this.dano = op.dano ?? 1;
    this.duracao = op.duracao ?? 0.2;
    this.cor = op.cor ?? 'luz';
    this.perigoso = true;
    this.morta = false;
    this.t = 0;
  }

  caixa() {
    // Quadrado inscrito com folga: o círculo desenhado é a promessa visual, e
    // a caixa fica DENTRO dele — nunca acerta fora do que se vê.
    const r = this.raio * 0.72 * this._escala();
    return { x: this.x - r, y: this.y - r, largura: r * 2, altura: r * 2 };
  }

  _escala() { return clamp01(this.t / 0.06) ; }

  atualizar(dt) {
    this.t += dt;
    if (this.t > this.duracao) this.perigoso = false;
    if (this.t > this.duracao + 0.35) this.morta = true;
  }

  receberDano() { /* explosão não se corta */ }

  desenhar(ctx, tema) {
    const k = clamp01(this.t / (this.duracao + 0.35));
    const r = this.raio * (0.45 + k * 0.75);
    ctx.save();
    ctx.globalAlpha = (1 - k) * 0.7;
    ctx.strokeStyle = corDe(tema, this.cor);
    ctx.lineWidth = 3 * (1 - k) + 1;
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, TAU);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  desenharLuz(ctx, tema) {
    const k = clamp01(this.t / (this.duracao + 0.35));
    luzRadial(ctx, this.x, this.y, this.raio * (0.7 + k), corDe(tema, this.cor), (1 - k) * 1.2);
  }
}

/* ==========================================================================
   Fábricas — é por aqui que inimigos e chefes atiram.
   ========================================================================== */

/**
 * Velocidade inicial pra um arco sair de (x,y) e cair em (ax,ay).
 * Tempo de voo cresce com a distância mas fica em [0,55s; 1,5s]: abaixo disso
 * o arco vira reta (ilegível), acima o jogador já andou pra longe.
 */
export function resolverArco(x, y, ax, ay, g = G_ARCO) {
  const dx = ax - x, dy = ay - y;
  const T = clamp(Math.hypot(dx, dy) / 300, 0.55, 1.5);
  return { vx: dx / T, vy: dy / T - 0.5 * g * T, T };
}

export function atirarReto(mundo, x, y, ang, op = {}) {
  const vel = op.vel ?? 300;
  const p = new ProjetilReto({
    x, y, vx: Math.cos(ang) * vel, vy: Math.sin(ang) * vel, ...op,
  });
  mundo.entidades.push(p);
  return p;
}

export function atirarArco(mundo, x, y, ax, ay, op = {}) {
  const g = op.g ?? G_ARCO;
  const { vx, vy } = resolverArco(x, y, ax, ay, g);
  const p = new ProjetilArco({ x, y, vx, vy, g, ...op });
  mundo.entidades.push(p);
  return p;
}

export function atirarTeleguiado(mundo, x, y, ang, op = {}) {
  const p = new ProjetilTeleguiado({
    x, y, vx: Math.cos(ang), vy: Math.sin(ang), ...op,
  });
  mundo.entidades.push(p);
  return p;
}

/**
 * Leque de projéteis retos. `abertura` em radianos, total.
 * Velocidade levemente variada por raio — um leque com velocidade idêntica
 * lê como uma parede rígida; variado lê como jato.
 */
export function atirarSpray(mundo, x, y, ang, n = 5, abertura = 0.9, op = {}) {
  const saida = [];
  const velBase = op.vel ?? 260;
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 0.5 : i / (n - 1);
    const a = ang + (k - 0.5) * abertura;
    saida.push(atirarReto(mundo, x, y, a, {
      raio: op.raio ?? 4,
      ...op,
      vel: velBase * lerp(0.78, 1.12, ((i * 37) % 11) / 10),
    }));
  }
  return saida;
}

/** Anel radial com um VÃO — o vão é a resposta, e ele é visível no telegrafo. */
export function atirarAnel(mundo, x, y, n = 12, angVao = null, larguraVao = 0.8, op = {}) {
  const saida = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    if (angVao != null && Math.abs(difAngulo(a, angVao)) < larguraVao / 2) continue;
    saida.push(atirarReto(mundo, x, y, a, op));
  }
  return saida;
}

export const PROJETEIS = {
  reto: ProjetilReto,
  arco: ProjetilArco,
  teleguiado: ProjetilTeleguiado,
  poca: PocaAcida,
  onda: OndaChoque,
  explosao: Explosao,
};
