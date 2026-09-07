/* =========================================================================
   fase2/core/laco.js — laço principal, tempo, hitstop e câmera
   ========================================================================= */

import { clamp, clamp01, damp, lerp, easeOutCubic, Rng } from './mat.js';

/* -------------------------------------------------------------------------
   LAÇO — passo fixo com acumulador
   -------------------------------------------------------------------------
   `atualizar` sempre recebe o MESMO dt (1/120). Física de plataforma com dt
   variável é a origem clássica de "às vezes o pulo é mais alto" e de
   atravessar parede em quedas de frame — passo fixo elimina os dois.
   `desenhar` recebe `alpha` (0..1) pra interpolar entre o estado anterior e o
   atual, então 60Hz e 144Hz ficam igualmente suaves.
   ------------------------------------------------------------------------- */

export const PASSO_FIXO = 1 / 120;
const MAX_PASSOS_POR_FRAME = 8;   // trava de segurança: sem isso, uma aba em
                                  // background acumula segundos e ao voltar o
                                  // jogo tenta rodar 1000 passos de uma vez.

export class Laco {
  /**
   * @param {(dt:number, tempo:number) => void} atualizar
   * @param {(alpha:number, dtReal:number) => void} desenhar
   */
  constructor(atualizar, desenhar) {
    this.atualizar = atualizar;
    this.desenhar = desenhar;

    this.tempo = 0;            // segundos de jogo simulados (não conta hitstop)
    this.tempoReal = 0;        // segundos de parede desde o início
    this.acumulador = 0;
    this.rodando = false;
    this.pausado = false;

    /** Segundos restantes de congelamento de impacto. */
    this.hitstop = 0;
    /** Escala global de tempo — 1 normal, <1 câmera lenta, 0 parado. */
    this.escalaTempo = 1;
    this._escalaAlvo = 1;

    this.fps = 60;
    this._ultimo = 0;
    this._quadro = null;
    this._tick = this._tick.bind(this);
  }

  iniciar() {
    if (this.rodando) return;
    this.rodando = true;
    this._ultimo = performance.now();
    this._quadro = requestAnimationFrame(this._tick);
  }

  parar() {
    this.rodando = false;
    if (this._quadro != null) cancelAnimationFrame(this._quadro);
    this._quadro = null;
  }

  /**
   * Congela a simulação por `s` segundos SEM parar o desenho — o frame do
   * impacto fica na tela e o golpe "pesa". É o truque de game feel mais
   * barato e mais eficaz que existe; usar em acerto de ataque, dano recebido
   * e morte de inimigo (0.04-0.10s; acima disso vira travamento).
   * Não acumula: um hitstop maior sobrescreve um menor em andamento.
   */
  congelar(s) { this.hitstop = Math.max(this.hitstop, s); }

  /** Câmera lenta com transição suave. `escala` 0..1, `suavidade` em segundos. */
  definirEscalaTempo(escala, suavidade = 0.15) {
    this._escalaAlvo = clamp(escala, 0, 4);
    this._suavidadeEscala = suavidade;
  }

  _tick(agora) {
    if (!this.rodando) return;
    this._quadro = requestAnimationFrame(this._tick);

    let dtReal = (agora - this._ultimo) / 1000;
    this._ultimo = agora;
    // Um alt-tab longo devolve um dt gigante; cortar em 0.25s evita o salto.
    dtReal = clamp(dtReal, 0, 0.25);
    this.tempoReal += dtReal;
    this.fps = lerp(this.fps, 1 / Math.max(dtReal, 1e-6), 0.06);

    this.escalaTempo = damp(this.escalaTempo, this._escalaAlvo, this._suavidadeEscala ?? 0.15, dtReal);

    if (this.hitstop > 0) {
      this.hitstop -= dtReal;
      this.desenhar(1, dtReal);      // continua desenhando: a tela não trava
      return;
    }

    if (!this.pausado) {
      this.acumulador += dtReal * this.escalaTempo;
      let passos = 0;
      while (this.acumulador >= PASSO_FIXO && passos < MAX_PASSOS_POR_FRAME) {
        this.atualizar(PASSO_FIXO, this.tempo);
        this.tempo += PASSO_FIXO;
        this.acumulador -= PASSO_FIXO;
        passos++;
      }
      if (passos === MAX_PASSOS_POR_FRAME) this.acumulador = 0;  // desiste do atraso
    }

    this.desenhar(clamp01(this.acumulador / PASSO_FIXO), dtReal);
  }
}

/* -------------------------------------------------------------------------
   CÂMERA
   -------------------------------------------------------------------------
   Segue o alvo com atraso (damp por meia-vida, não lerp por frame),
   antecipa a direção do movimento (look-ahead), respeita os limites da sala e
   tem trauma-based shake — a intensidade decai sozinha e o deslocamento usa
   ruído contínuo em vez de random puro, senão o tremor fica granulado em vez
   de parecer um impacto de verdade.
   ------------------------------------------------------------------------- */

export class Camera {
  constructor(largura, altura) {
    this.x = 0; this.y = 0;             // canto superior-esquerdo, em mundo
    this.largura = largura;
    this.altura = altura;
    this.zoom = 1;
    this._zoomAlvo = 1;

    this.alvoX = 0; this.alvoY = 0;
    this.limites = null;                 // {x, y, largura, altura} da sala

    this.antecipacao = 76;               // px que a câmera "olha à frente"
    this._antecipAtual = 0;
    this.folgaVertical = 34;             // câmera fica um tico acima do alvo

    this.trauma = 0;                     // 0..1; shake = trauma²
    this.traumaDecaimento = 1.6;         // por segundo
    this._t = 0;
    this._rng = new Rng(4242);
    this._offX = 0; this._offY = 0;

    /** Deslocamento de recuo aditivo (dano/aterrissagem) — some sozinho. */
    this._recuoX = 0; this._recuoY = 0;
  }

  redimensionar(largura, altura) {
    this.largura = largura;
    this.altura = altura;
  }

  /** Enquadra instantaneamente (troca de sala, respawn) — sem deslize. */
  encaixar(x, y) {
    this.alvoX = x; this.alvoY = y;
    this._antecipAtual = 0;
    const { cx, cy } = this._centroDesejado(x, y, 0);
    this.x = cx; this.y = cy;
    this._aplicarLimites();
  }

  definirLimites(limites) {
    this.limites = limites;
    this._aplicarLimites();
  }

  sacudir(quantidade) { this.trauma = clamp01(this.trauma + quantidade); }

  recuar(dx, dy) { this._recuoX += dx; this._recuoY += dy; }

  definirZoom(z, suave = true) {
    this._zoomAlvo = clamp(z, 0.4, 3);
    if (!suave) this.zoom = this._zoomAlvo;
  }

  _centroDesejado(x, y, antecip) {
    const vw = this.largura / this.zoom;
    const vh = this.altura / this.zoom;
    return {
      cx: x + antecip - vw / 2,
      cy: y - this.folgaVertical - vh / 2,
    };
  }

  /**
   * @param {number} dt
   * @param {{x:number,y:number,vx:number}} alvo  posição e velocidade horizontal
   */
  seguir(dt, alvo) {
    this._t += dt;
    this.zoom = damp(this.zoom, this._zoomAlvo, 0.22, dt);

    // Look-ahead proporcional à velocidade, com meia-vida LONGA de propósito:
    // se a antecipação reagir rápido, a câmera balança a cada troca de direção
    // e embrulha o estômago. Lenta, ela "acredita" na direção do jogador.
    const antecipDesejada = clamp(alvo.vx / 260, -1, 1) * this.antecipacao;
    this._antecipAtual = damp(this._antecipAtual, antecipDesejada, 0.42, dt);

    const { cx, cy } = this._centroDesejado(alvo.x, alvo.y, this._antecipAtual);
    // Vertical mais frouxo que horizontal: durante o pulo a câmera não deve
    // colar no personagem, senão o mundo "pula" junto e some a referência.
    this.x = damp(this.x, cx, 0.16, dt);
    this.y = damp(this.y, cy, 0.26, dt);

    this.trauma = Math.max(0, this.trauma - this.traumaDecaimento * dt);
    const forca = this.trauma * this.trauma;            // curva quadrática
    if (forca > 0) {
      const f = this._t * 34;
      this._offX = (this._ruidoShake(f, 0) * 2 - 1) * 26 * forca;
      this._offY = (this._ruidoShake(f, 91) * 2 - 1) * 26 * forca;
    } else {
      this._offX = 0; this._offY = 0;
    }

    this._recuoX = damp(this._recuoX, 0, 0.09, dt);
    this._recuoY = damp(this._recuoY, 0, 0.09, dt);

    this._aplicarLimites();
  }

  _ruidoShake(x, semente) {
    const i = Math.floor(x), f = x - i;
    const u = f * f * (3 - 2 * f);
    const h = (n) => {
      let v = Math.imul(n ^ semente, 0x27d4eb2d);
      v = Math.imul(v ^ (v >>> 15), 0x2c1b3c6d);
      return ((v ^ (v >>> 13)) >>> 0) / 4294967296;
    };
    return lerp(h(i), h(i + 1), u);
  }

  _aplicarLimites() {
    const l = this.limites;
    if (!l) return;
    const vw = this.largura / this.zoom;
    const vh = this.altura / this.zoom;
    // Sala menor que a viewport: centraliza em vez de grudar num canto.
    this.x = l.largura <= vw ? l.x + (l.largura - vw) / 2 : clamp(this.x, l.x, l.x + l.largura - vw);
    this.y = l.altura <= vh ? l.y + (l.altura - vh) / 2 : clamp(this.y, l.y, l.y + l.altura - vh);
  }

  /** Posição final usada pelo desenho (com shake e recuo aplicados). */
  get viewX() { return this.x + this._offX + this._recuoX; }
  get viewY() { return this.y + this._offY + this._recuoY; }

  /**
   * Aplica a transformação da câmera no contexto. `parallax` 0 = colado na
   * tela (céu), 1 = na velocidade do mundo, >1 = primeiro plano passando
   * mais rápido que o jogador.
   */
  aplicar(ctx, parallax = 1) {
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.viewX * parallax, -this.viewY * parallax);
  }

  paraTela(x, y, parallax = 1) {
    return {
      x: (x - this.viewX * parallax) * this.zoom,
      y: (y - this.viewY * parallax) * this.zoom,
    };
  }

  paraMundo(x, y) {
    return { x: x / this.zoom + this.viewX, y: y / this.zoom + this.viewY };
  }

  /** Retângulo visível em coordenadas de mundo, com folga pra culling. */
  areaVisivel(folga = 96) {
    const vw = this.largura / this.zoom;
    const vh = this.altura / this.zoom;
    return {
      x: this.viewX - folga,
      y: this.viewY - folga,
      largura: vw + folga * 2,
      altura: vh + folga * 2,
    };
  }

  visivel(x, y, largura, altura, folga = 96) {
    const a = this.areaVisivel(folga);
    return x < a.x + a.largura && x + largura > a.x && y < a.y + a.altura && y + altura > a.y;
  }
}

/* -------------------------------------------------------------------------
   TELA — canvas com DPR correto
   -------------------------------------------------------------------------
   Em tela retina, ignorar devicePixelRatio deixa TUDO borrado — o defeito
   isolado que mais faz um jogo web parecer amador ao lado de um jogo nativo.
   ------------------------------------------------------------------------- */

export class Tela {
  constructor(canvas, { dprMax = 2 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.dprMax = dprMax;
    this.largura = 0;
    this.altura = 0;
    this.dpr = 1;
    this.aoRedimensionar = null;
    this._observer = new ResizeObserver(() => this.ajustar());
    this._observer.observe(canvas);
    this.ajustar();
  }

  ajustar() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprMax);
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    if (w === this.largura && h === this.altura && dpr === this.dpr) return;
    this.largura = w; this.altura = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.aoRedimensionar?.(w, h, dpr);
  }

  /** Começa um frame: reseta a transformação e já embute o DPR. */
  iniciarFrame() {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    return ctx;
  }

  destruir() { this._observer.disconnect(); }
}

/* -------------------------------------------------------------------------
   Utilidade de transição de tela (fade entre salas / morte).
   ------------------------------------------------------------------------- */
export class Transicao {
  constructor() {
    this.valor = 0;        // 0 = transparente, 1 = tela cheia
    this._alvo = 0;
    this._dur = 0.28;
    this._t = 0;
    this._de = 0;
    this._aoTerminar = null;
    this.cor = '#04070a';
  }

  /** Escurece, chama `aoCobrir` com a tela toda preta, depois clareia. */
  cortar(aoCobrir, dur = 0.28) {
    this._dur = dur;
    this._de = this.valor;
    this._alvo = 1;
    this._t = 0;
    this._aoTerminar = () => {
      aoCobrir?.();
      this._de = 1;
      this._alvo = 0;
      this._t = 0;
      this._aoTerminar = null;
    };
  }

  atualizar(dt) {
    if (this.valor === this._alvo && !this._aoTerminar) return;
    this._t += dt;
    const k = Math.min(1, this._t / this._dur);
    this.valor = lerp(this._de, this._alvo, easeOutCubic(k));
    if (k >= 1) {
      this.valor = this._alvo;
      const cb = this._aoTerminar;
      this._aoTerminar = null;
      cb?.();
    }
  }

  desenhar(ctx, largura, altura) {
    if (this.valor <= 0.001) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = this.valor;
    ctx.fillStyle = this.cor;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  get ativa() { return this.valor > 0.001 || this._aoTerminar != null; }
}
