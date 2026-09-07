/* =========================================================================
   fase2/render/efeitos.js — biblioteca de impacto
   -------------------------------------------------------------------------
   Partículas (mundo.particulas) resolvem "muitas coisinhas voando". O que
   elas NÃO resolvem é a leitura de um IMPACTO: um anel que se abre, poeira
   que se espalha rente ao chão, cópias fantasma de um dash, faíscas com
   direção. Essas coisas têm FORMA e TEMPO PRÓPRIOS — cada uma é um objeto
   com ciclo de vida curto, não um punhado de pontos com gravidade.

   Contrato de todo efeito (igual ao de entidade, de propósito):

       atualizar(dt)                → avança; marca `morto` quando acaba
       desenhar(ctx, tema, camera)  → passe normal
       desenharLuz(ctx, tema, cam)  → passe emissivo (só o que EMITE luz)
       morto                        → true = pode ser descartado
       naTela                       → true = desenha em espaço de TELA
                                      (vinheta), não de mundo

   Regra de cor: nenhum efeito escreve hex. A opção `cor` é uma CHAVE do
   tema ('crista', 'acento', 'luz', 'particula', 'borda'…). Assim um anel de
   choque numa sala poluída sai âmbar-doente e na mesma sala restaurada sai
   turquesa, sem ninguém tocar no código do efeito.

   Uso típico:
       const efeitos = new Efeitos();
       efeitos.anelChoque(x, y, { raio: 90, cor: 'crista' });
       …
       efeitos.atualizar(dtReal);
       render.camada(1,   (ctx, tema, cam) => efeitos.desenhar(ctx, tema, cam));
       render.emissivo(1, (ctx, tema, cam) => efeitos.desenharLuz(ctx, tema, cam));
       render.camadaTela((ctx, tema, w, h) => efeitos.desenharTela(ctx, tema, w, h));
   ========================================================================= */

import {
  TAU, clamp, clamp01, lerp, damp, easeOutCubic, easeOutQuad, easeOutExpo,
  pulso, rgba, misturarHex,
} from '../core/mat.js';

/* -------------------------------------------------------------------------
   utilidades internas
   ------------------------------------------------------------------------- */

/**
 * Resolve uma cor: chave de tema ('crista') ou hex literal.
 * Só aceita chave cujo valor no tema seja string — `tema.vinheta` é número e
 * cairia como cor inválida em 'rgba(NaN…)', que o canvas engole em silêncio.
 */
function corDe(tema, c, padrao = 'crista') {
  const k = c ?? padrao;
  if (typeof k === 'string' && typeof tema?.[k] === 'string') return tema[k];
  return typeof k === 'string' ? k : '#ffffff';
}

const aleatorio = (a, b) => a + Math.random() * (b - a);

/**
 * Fita suave de largura variável ao longo de uma polilinha.
 * Devolve um Path2D fechado. É o tijolo de capa, membro e rastro — traçar
 * `lineWidth` não serve porque a largura precisa VARIAR ponto a ponto.
 * @param {Array<[number,number]>} pts
 * @param {number[]} larguras  meia-largura em cada ponto
 */
export function faixa(pts, larguras) {
  const n = pts.length;
  const p = new Path2D();
  if (n < 2) return p;

  const esq = new Array(n), dir = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    const w = larguras[i];
    esq[i] = [pts[i][0] - ty * w, pts[i][1] + tx * w];
    dir[i] = [pts[i][0] + ty * w, pts[i][1] - tx * w];
  }

  // Quadráticas passando pelos meios dos segmentos: o contorno fica curvo sem
  // precisar de mais pontos de controle (e sem overshoot de Catmull-Rom).
  const lado = (pontos, primeiro) => {
    if (primeiro) p.moveTo(pontos[0][0], pontos[0][1]);
    else p.lineTo(pontos[0][0], pontos[0][1]);
    for (let i = 1; i < pontos.length - 1; i++) {
      const mx = (pontos[i][0] + pontos[i + 1][0]) / 2;
      const my = (pontos[i][1] + pontos[i + 1][1]) / 2;
      p.quadraticCurveTo(pontos[i][0], pontos[i][1], mx, my);
    }
    p.lineTo(pontos[pontos.length - 1][0], pontos[pontos.length - 1][1]);
  };

  lado(esq, true);
  dir.reverse();
  lado(dir, false);
  p.closePath();
  return p;
}

/* -------------------------------------------------------------------------
   base
   ------------------------------------------------------------------------- */

export class Efeito {
  constructor(dur = 0.4) {
    this.t = 0;
    this.dur = Math.max(0.001, dur);
    this.morto = false;
    this.naTela = false;
  }
  /** progresso 0..1 */
  get p() { return clamp01(this.t / this.dur); }
  atualizar(dt) {
    this.t += dt;
    if (this.t >= this.dur) this.morto = true;
  }
  desenhar() {}
  desenharLuz() {}
}

/* =========================================================================
   1. ANEL DE CHOQUE
   -------------------------------------------------------------------------
   O anel é o que diz "aqui aconteceu alguma coisa" antes de qualquer
   partícula. Dois detalhes fazem ele parecer energia em vez de círculo:
   a espessura AFINA conforme abre (conservação de matéria) e existe um
   segundo anel atrasado — um pulso só parece um "ping" de sonar.
   ========================================================================= */

export class AnelChoque extends Efeito {
  /**
   * @param {object} [o]
   * @param {number} [o.raio]      raio final
   * @param {number} [o.raio0]     raio inicial
   * @param {number} [o.espessura] largura inicial do traço
   * @param {number} [o.achatar]   1 = círculo · <1 = elipse (onda rente ao chão)
   * @param {number} [o.giro]      rotação da elipse, em radianos
   * @param {number} [o.arco]      TAU = anel inteiro · menor = leque
   * @param {number} [o.direcao]   centro do leque, em radianos
   * @param {string} [o.cor]       chave de tema
   * @param {number} [o.eco]       0..1 — força do segundo anel atrasado
   */
  constructor(x, y, o = {}) {
    super(o.dur ?? 0.34);
    this.x = x; this.y = y;
    this.raio = o.raio ?? 70;
    this.raio0 = o.raio0 ?? this.raio * 0.12;
    this.espessura = o.espessura ?? 6;
    this.achatar = o.achatar ?? 1;
    this.giro = o.giro ?? 0;
    this.arco = o.arco ?? TAU;
    this.direcao = o.direcao ?? -Math.PI / 2;
    this.cor = o.cor ?? 'crista';
    this.alfa = o.alfa ?? 0.9;
    this.eco = o.eco ?? 0.5;
  }

  _tracar(ctx, p, alfa, cor) {
    if (p <= 0 || alfa <= 0.004) return;
    const r = lerp(this.raio0, this.raio, easeOutExpo(p));
    const w = Math.max(0.4, this.espessura * (1 - p) * (1 - p * 0.4));
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.giro);
    ctx.scale(1, this.achatar);
    ctx.strokeStyle = rgba(cor, alfa);
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, r, this.direcao - this.arco / 2, this.direcao + this.arco / 2);
    ctx.stroke();
    ctx.restore();
  }

  desenhar(ctx, tema) {
    const c = corDe(tema, this.cor);
    const p = this.p;
    this._tracar(ctx, p, (1 - p) * this.alfa, c);
    if (this.eco > 0.01) this._tracar(ctx, p - 0.22, (1 - p) * this.alfa * this.eco * 0.7, c);
  }

  desenharLuz(ctx, tema) {
    const c = corDe(tema, this.cor);
    const p = this.p;
    this._tracar(ctx, p, (1 - p) * this.alfa * 0.85, c);
  }
}

/* =========================================================================
   2. POEIRA DE ATERRISSAGEM
   -------------------------------------------------------------------------
   O erro clássico é jogar partículas pra cima: aterrissagem não levanta
   poeira pro céu, ela EMPURRA o ar pros lados. Cada baforada nasce com
   velocidade quase horizontal, sobe um triz, e vai ACHATANDO enquanto se
   espalha — é o achatamento que faz a poeira "conhecer" o chão.
   ========================================================================= */

export class PoeiraChao extends Efeito {
  /**
   * @param {number} y  altura do CHÃO (não do centro do corpo)
   * @param {object} [o]
   * @param {number} [o.forca]  0..1 — impacto; escala alcance e quantidade
   * @param {number} [o.lados]  1 = só pra direção `dir` · 2 = pros dois lados
   */
  constructor(x, y, o = {}) {
    const forca = clamp(o.forca ?? 1, 0.15, 2);
    super(o.dur ?? lerp(0.45, 0.85, clamp01(forca)));
    this.x = x; this.y = y;
    this.cor = o.cor ?? 'particula';
    this.alfa = o.alfa ?? 0.5;
    this.baforadas = [];

    const n = Math.round(lerp(5, 13, clamp01(forca)));
    const lados = o.lados ?? 2;
    const dir = o.dir ?? 1;
    for (let i = 0; i < n; i++) {
      const s = lados === 2 ? (i % 2 ? 1 : -1) : dir;
      const k = i / n;
      this.baforadas.push({
        x: x + s * aleatorio(0, 6),
        y: y - aleatorio(0, 3),
        vx: s * aleatorio(45, 200) * forca,
        vy: -aleatorio(12, 55) * forca,
        r: aleatorio(3, 7.5) * lerp(0.8, 1.35, forca),
        cresce: aleatorio(1.7, 3.2),
        atraso: k * 0.05,
        giro: aleatorio(-1, 1),
      });
    }
  }

  atualizar(dt) {
    super.atualizar(dt);
    for (const b of this.baforadas) {
      // Arrasto forte: poeira perde velocidade rápido, não voa como pedra.
      const f = Math.pow(0.06, dt);
      b.vx *= f;
      b.vy = b.vy * f + 130 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y > this.y) { b.y = this.y; b.vy = 0; }   // encosta e fica
    }
  }

  _pintar(ctx, tema, ganho) {
    const c = corDe(tema, this.cor, 'particula');
    const p = this.p;
    for (const b of this.baforadas) {
      const k = clamp01((this.t - b.atraso) / (this.dur - b.atraso));
      if (k <= 0) continue;
      const a = (1 - k) * (1 - k) * this.alfa * ganho;
      if (a <= 0.004) continue;
      const r = b.r * lerp(0.5, b.cresce, easeOutCubic(k));
      ctx.globalAlpha = a;
      ctx.fillStyle = c;
      ctx.beginPath();
      // Achata conforme se espalha: elipse deitada = poeira rente ao chão.
      ctx.ellipse(b.x, b.y - r * 0.35, r, r * lerp(0.85, 0.32, k), b.giro * 0.2, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    void p;
  }

  desenhar(ctx, tema) { this._pintar(ctx, tema, 1); }
  desenharLuz(ctx, tema) {
    // Só emite se o tema tiver vida (área restaurada levanta esporo, não pó).
    if ((tema.pureza ?? 0) < 0.35) return;
    this._pintar(ctx, tema, 0.22 * (tema.pureza ?? 0));
  }
}

/* =========================================================================
   3. RASTRO FANTASMA (investida)
   -------------------------------------------------------------------------
   Não é um borrão: são CÓPIAS do personagem congeladas onde ele esteve. Por
   isso guarda quadros (pose inteira) e delega o desenho a quem sabe desenhar
   o corpo — o mesmo rastro serve pra inimigo, projétil ou pro jogador.
   ========================================================================= */

export class RastroFantasma {
  /**
   * @param {object} [o]
   * @param {number} [o.intervalo] s entre capturas (0 = todo frame)
   * @param {number} [o.vida]      s que cada cópia dura
   * @param {number} [o.max]       teto de cópias vivas
   * @param {(ctx, quadro, alfa) => void} [o.desenhador]
   */
  constructor(o = {}) {
    this.intervalo = o.intervalo ?? 0.018;
    this.vida = o.vida ?? 0.26;
    this.max = o.max ?? 14;
    this.desenhador = o.desenhador ?? null;
    this.alfa = o.alfa ?? 0.4;
    this.quadros = [];
    this._desde = 0;
    this.morto = false;
    this.naTela = false;
  }

  /** `quadro` é opaco pra cá — quem captura decide o que precisa pra redesenhar. */
  capturar(quadro, forcar = false) {
    if (!forcar && this._desde < this.intervalo) return;
    this._desde = 0;
    quadro.t = 0;
    this.quadros.push(quadro);
    if (this.quadros.length > this.max) this.quadros.shift();
  }

  limpar() { this.quadros.length = 0; }
  get vazio() { return this.quadros.length === 0; }

  atualizar(dt) {
    this._desde += dt;
    for (let i = this.quadros.length - 1; i >= 0; i--) {
      this.quadros[i].t += dt;
      if (this.quadros[i].t >= this.vida) this.quadros.splice(i, 1);
    }
  }

  desenhar(ctx, tema, desenhador = this.desenhador) {
    if (!desenhador) return;
    for (const q of this.quadros) {
      // Cúbica: as cópias somem rápido perto do corpo e a cauda fica curta —
      // decaimento linear deixa um borrão longo e leitoso.
      const k = 1 - q.t / this.vida;
      const a = k * k * k * this.alfa;
      if (a <= 0.005) continue;
      desenhador(ctx, q, a, tema);
    }
  }

  desenharLuz(ctx, tema, desenhador = this.desenhador) {
    if (!desenhador) return;
    for (const q of this.quadros) {
      const k = 1 - q.t / this.vida;
      const a = k * k * this.alfa * 0.55;
      if (a <= 0.005) continue;
      desenhador(ctx, q, a, tema, true);
    }
  }
}

/* =========================================================================
   4. FAÍSCAS DE ACERTO
   -------------------------------------------------------------------------
   Faísca é RISCO, não bolinha: desenhada como um traço no sentido do
   movimento, que encurta conforme freia. Bolinha voando lê como confete.
   ========================================================================= */

export class Faiscas extends Efeito {
  /**
   * @param {object} [o]
   * @param {number} [o.angulo]       direção central, em radianos
   * @param {number} [o.espalhamento] abertura do leque
   * @param {number} [o.n]            quantidade
   * @param {number} [o.forca]        multiplicador de velocidade/tamanho
   */
  constructor(x, y, o = {}) {
    super(o.dur ?? 0.3);
    this.x = x; this.y = y;
    this.cor = o.cor ?? 'crista';
    this.alfa = o.alfa ?? 1;
    const forca = o.forca ?? 1;
    const n = o.n ?? 9;
    const ang = o.angulo ?? 0;
    const esp = o.espalhamento ?? 1.5;
    this.riscos = [];
    for (let i = 0; i < n; i++) {
      const a = ang + (Math.random() - 0.5) * esp;
      const v = aleatorio(190, 560) * forca;
      this.riscos.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - aleatorio(0, 60),
        comp: aleatorio(5, 14) * forca,
        larg: aleatorio(0.9, 2.1),
        vida: aleatorio(0.6, 1) * this.dur,
        t: 0,
      });
    }
    // Estouro branco-quente no ponto de contato — 3 frames, mas é o que
    // registra "bateu AQUI" antes de qualquer faísca chegar longe.
    this.estouro = o.estouro ?? 1;
  }

  atualizar(dt) {
    super.atualizar(dt);
    for (const r of this.riscos) {
      r.t += dt;
      const f = Math.pow(0.02, dt);
      r.vx *= f;
      r.vy = r.vy * f + 900 * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
    }
  }

  _pintar(ctx, tema, ganho) {
    const c = corDe(tema, this.cor);
    ctx.strokeStyle = c;
    ctx.lineCap = 'round';
    for (const r of this.riscos) {
      const k = clamp01(1 - r.t / r.vida);
      if (k <= 0.01) continue;
      const v = Math.hypot(r.vx, r.vy);
      const comp = Math.min(r.comp, v * 0.03) * k;
      const ux = v > 1 ? r.vx / v : 1, uy = v > 1 ? r.vy / v : 0;
      ctx.globalAlpha = k * this.alfa * ganho;
      ctx.lineWidth = r.larg * k;
      ctx.beginPath();
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x - ux * comp, r.y - uy * comp);
      ctx.stroke();
    }
    if (this.estouro > 0) {
      const k = clamp01(1 - this.t / (this.dur * 0.28));
      if (k > 0.01) {
        ctx.globalAlpha = k * k * this.alfa * ganho;
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(this.x, this.y, lerp(2, 13, easeOutQuad(1 - k)) * this.estouro, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  desenhar(ctx, tema) { this._pintar(ctx, tema, 0.95); }
  desenharLuz(ctx, tema) { this._pintar(ctx, tema, 1); }
}

/* =========================================================================
   5. FOLHAS LEVANTADAS
   -------------------------------------------------------------------------
   Só existe em área restaurada — é o prêmio de correr por um lugar vivo.
   Cada folha tem giro próprio e uma deriva senoidal (planeio), então nunca
   duas caem igual. Sem a deriva, folha vira pedrinha.
   ========================================================================= */

export class Folhas extends Efeito {
  constructor(x, y, o = {}) {
    super(o.dur ?? 1.5);
    this.cor = o.cor ?? 'crista';
    this.cor2 = o.cor2 ?? 'acento';
    this.alfa = o.alfa ?? 0.9;
    const n = o.n ?? 3;
    const dir = o.dir ?? 1;
    this.folhas = [];
    for (let i = 0; i < n; i++) {
      this.folhas.push({
        x: x + aleatorio(-8, 8),
        y: y - aleatorio(0, 5),
        vx: -dir * aleatorio(20, 95),
        vy: -aleatorio(45, 130),
        giro: aleatorio(0, TAU),
        vgiro: aleatorio(-6, 6),
        tam: aleatorio(2.2, 4.4),
        fase: aleatorio(0, TAU),
        freq: aleatorio(2.2, 4.4),
        deriva: aleatorio(14, 42),
        t: 0,
        vida: aleatorio(0.6, 1) * this.dur,
        matiz: Math.random(),
      });
    }
  }

  atualizar(dt) {
    super.atualizar(dt);
    for (const f of this.folhas) {
      f.t += dt;
      f.vy = f.vy * Math.pow(0.35, dt) + 95 * dt;
      f.vx *= Math.pow(0.5, dt);
      f.giro += f.vgiro * dt;
      f.vgiro *= Math.pow(0.6, dt);
      f.x += (f.vx + Math.sin(f.t * f.freq + f.fase) * f.deriva) * dt;
      f.y += f.vy * dt;
    }
  }

  desenhar(ctx, tema) {
    const a = corDe(tema, this.cor, 'crista');
    const b = corDe(tema, this.cor2, 'acento');
    for (const f of this.folhas) {
      const k = clamp01(1 - f.t / f.vida);
      if (k <= 0.01) continue;
      ctx.save();
      ctx.globalAlpha = Math.min(1, k * 1.6) * this.alfa;
      ctx.translate(f.x, f.y);
      ctx.rotate(f.giro);
      ctx.fillStyle = misturarHex(a, b, f.matiz);
      ctx.beginPath();
      // Gota, não elipse: a ponta assimétrica é o que lê como folha.
      ctx.moveTo(f.tam * 1.6, 0);
      ctx.quadraticCurveTo(0, f.tam * 0.85, -f.tam, 0);
      ctx.quadraticCurveTo(0, -f.tam * 0.85, f.tam * 1.6, 0);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  desenharLuz(ctx, tema) {
    if ((tema.pureza ?? 0) < 0.4) return;
    const b = corDe(tema, this.cor2, 'acento');
    ctx.fillStyle = b;
    for (const f of this.folhas) {
      const k = clamp01(1 - f.t / f.vida);
      if (k <= 0.02) continue;
      ctx.globalAlpha = k * 0.3 * (tema.pureza ?? 0);
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.tam * 1.1, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/* =========================================================================
   6. ONDA DO CANTO
   -------------------------------------------------------------------------
   O verbo de restauração precisa parecer que ATRAVESSA o mundo, não que
   acende no lugar. Três anéis defasados + pétalas radiais que se abrem, tudo
   no passe emissivo — a onda é feita de luz, não de tinta.
   ========================================================================= */

export class OndaCanto extends Efeito {
  constructor(x, y, o = {}) {
    super(o.dur ?? 1.05);
    this.x = x; this.y = y;
    this.raio = o.raio ?? 190;
    this.cor = o.cor ?? 'crista';
    this.cor2 = o.cor2 ?? 'acento';
    this.petalas = o.petalas ?? 9;
    this.giro = Math.random() * TAU;
  }

  _anel(ctx, cor, p, alfa, esp) {
    if (p <= 0 || p >= 1) return;
    const r = easeOutCubic(p) * this.raio;
    ctx.strokeStyle = rgba(cor, alfa * (1 - p) * (1 - p));
    ctx.lineWidth = lerp(esp, 0.8, p);
    ctx.beginPath();
    ctx.arc(this.x, this.y, r, 0, TAU);
    ctx.stroke();
  }

  desenhar(ctx, tema) {
    const c = corDe(tema, this.cor);
    const p = this.p;
    this._anel(ctx, c, p, 0.55, 7);
    this._anel(ctx, c, p - 0.13, 0.3, 4);
    this._anel(ctx, c, p - 0.26, 0.16, 2.5);
  }

  desenharLuz(ctx, tema) {
    const c = corDe(tema, this.cor);
    const c2 = corDe(tema, this.cor2, 'acento');
    const p = this.p;
    this._anel(ctx, c, p, 0.9, 9);
    this._anel(ctx, c, p - 0.13, 0.5, 5);

    // Pétalas: riscos radiais que se alongam e apagam. Dão DIREÇÃO à onda —
    // um anel liso parece um decalque, os raios parecem propagação.
    const k = pulso(p);
    if (k > 0.01) {
      const r0 = easeOutCubic(p) * this.raio * 0.55;
      const r1 = easeOutCubic(p) * this.raio * 1.02;
      ctx.strokeStyle = rgba(c2, k * 0.5);
      ctx.lineWidth = lerp(3.5, 0.6, p);
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < this.petalas; i++) {
        const a = this.giro + (i / this.petalas) * TAU;
        ctx.moveTo(this.x + Math.cos(a) * r0, this.y + Math.sin(a) * r0);
        ctx.lineTo(this.x + Math.cos(a) * r1, this.y + Math.sin(a) * r1);
      }
      ctx.stroke();
    }

    // Núcleo: clarão que nasce forte e some — a "voz" saindo do peito.
    const nuc = Math.pow(1 - p, 2.4);
    if (nuc > 0.01) {
      const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, 46);
      g.addColorStop(0, rgba(c, nuc * 0.9));
      g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 46, 0, TAU);
      ctx.fill();
    }
  }
}

/* =========================================================================
   7. DISSOLUÇÃO (morte)
   -------------------------------------------------------------------------
   Morte não é explosão: o corpo se DESFAZ. As motas sobem (não caem), vão
   perdendo massa e o conjunto se alarga — a silhueta some virando o mesmo
   pó que o mundo tem em suspensão.
   ========================================================================= */

export class Dissolucao extends Efeito {
  constructor(x, y, o = {}) {
    super(o.dur ?? 1.3);
    this.x = x; this.y = y;
    this.cor = o.cor ?? 'particula';
    this.cor2 = o.cor2 ?? 'acento';
    this.alfa = o.alfa ?? 1;
    const n = o.n ?? 26;
    const largura = o.largura ?? 20;
    const altura = o.altura ?? 44;
    this.motas = [];
    for (let i = 0; i < n; i++) {
      const k = Math.random();
      this.motas.push({
        x: x + aleatorio(-largura / 2, largura / 2),
        y: y - altura * Math.pow(k, 0.7),
        vx: aleatorio(-32, 32),
        vy: -aleatorio(14, 62),
        r: aleatorio(0.9, 2.6),
        atraso: (1 - k) * this.dur * 0.42,   // dissolve de baixo pra cima
        fase: aleatorio(0, TAU),
        brilha: Math.random() < 0.35,
      });
    }
  }

  atualizar(dt) {
    super.atualizar(dt);
    for (const m of this.motas) {
      m.vy = damp(m.vy, -26, 0.5, dt);
      m.x += (m.vx + Math.sin(this.t * 2.2 + m.fase) * 12) * dt;
      m.y += m.vy * dt;
      m.vx *= Math.pow(0.5, dt);
    }
  }

  _pintar(ctx, tema, soBrilhantes) {
    const c = corDe(tema, this.cor, 'particula');
    const c2 = corDe(tema, this.cor2, 'acento');
    for (const m of this.motas) {
      if (soBrilhantes && !m.brilha) continue;
      const k = clamp01((this.t - m.atraso) / (this.dur - m.atraso));
      if (k <= 0) continue;
      const a = Math.pow(1 - k, 1.6) * this.alfa * (soBrilhantes ? 0.7 : 0.85);
      if (a <= 0.005) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = m.brilha ? c2 : c;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r * (soBrilhantes ? 2.1 : 1) * (1 - k * 0.5), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  desenhar(ctx, tema) { this._pintar(ctx, tema, false); }
  desenharLuz(ctx, tema) { this._pintar(ctx, tema, true); }
}

/* =========================================================================
   8. CORTE (arco de golpe reaproveitável)
   -------------------------------------------------------------------------
   Um `arc()` com lineWidth grande tem espessura CONSTANTE e por isso parece
   um pedaço de anel. Um corte de verdade é grosso no meio e some nas duas
   pontas — então o crescente é um polígono amostrado com perfil de seno.
   ========================================================================= */

export function crescente(ctx, raio, a0, a1, espessura, amostras = 16) {
  ctx.beginPath();
  for (let i = 0; i <= amostras; i++) {
    const k = i / amostras;
    const a = lerp(a0, a1, k);
    const e = Math.pow(Math.sin(k * Math.PI), 0.65) * espessura;
    ctx.lineTo(Math.cos(a) * (raio + e), Math.sin(a) * (raio + e));
  }
  for (let i = amostras; i >= 0; i--) {
    const k = i / amostras;
    const a = lerp(a0, a1, k);
    const e = Math.pow(Math.sin(k * Math.PI), 0.65) * espessura;
    ctx.lineTo(Math.cos(a) * (raio - e * 0.55), Math.sin(a) * (raio - e * 0.55));
  }
  ctx.closePath();
}

export class Corte extends Efeito {
  /**
   * @param {object} [o]
   * @param {number} [o.raio]      distância do centro ao corte
   * @param {number} [o.arco]      abertura angular varrida
   * @param {number} [o.direcao]   ângulo central
   * @param {number} [o.espessura]
   * @param {number} [o.dir]       1 / -1 — espelha o sentido da varredura
   */
  constructor(x, y, o = {}) {
    super(o.dur ?? 0.2);
    this.x = x; this.y = y;
    this.raio = o.raio ?? 28;
    this.arco = o.arco ?? 2.4;
    this.direcao = o.direcao ?? 0;
    this.espessura = o.espessura ?? 7;
    this.dir = o.dir ?? 1;
    this.cor = o.cor ?? 'crista';
    this.alfa = o.alfa ?? 1;
    this.fantasmas = o.fantasmas ?? 3;
  }

  _pintar(ctx, tema, ganho) {
    const p = this.p;
    const c = corDe(tema, this.cor);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(this.dir, 1);
    ctx.rotate(this.direcao);
    ctx.fillStyle = c;
    // Cópias atrasadas = o rastro que persiste alguns quadros depois do golpe.
    for (let g = this.fantasmas; g >= 0; g--) {
      const pg = p - g * 0.075;
      if (pg <= 0 || pg >= 1) continue;
      const varr = easeOutExpo(clamp01(pg / 0.55));
      const a0 = -this.arco / 2;
      const a1 = a0 + this.arco * varr;
      const alfa = (g === 0 ? 1 : 0.28 / g) * (1 - pg) * this.alfa * ganho;
      if (alfa <= 0.006) continue;
      ctx.globalAlpha = alfa;
      crescente(ctx, this.raio * lerp(0.86, 1.12, pg),
        a1 - Math.min(this.arco * varr, this.arco * 0.75), a1,
        this.espessura * (1 - pg * 0.75));
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  desenhar(ctx, tema) { this._pintar(ctx, tema, 0.85); }
  desenharLuz(ctx, tema) { this._pintar(ctx, tema, 1); }
}

/* =========================================================================
   9. VINHETA DE DANO (espaço de TELA)
   -------------------------------------------------------------------------
   Escurece/tinge as bordas com um pulso. Separada do `render.piscar` de
   propósito: flash de tela cheia apaga a leitura da cena por um instante;
   a vinheta avisa sem cegar, e por isso pode ficar residual com vida baixa.
   ========================================================================= */

export class VinhetaDano extends Efeito {
  /**
   * @param {object} [o]
   * @param {number} [o.intensidade] pico do pulso
   * @param {number} [o.base]        0..1 — resíduo permanente (vida baixa)
   */
  constructor(o = {}) {
    super(o.dur ?? 0.55);
    this.naTela = true;
    this.intensidade = o.intensidade ?? 0.55;
    this.base = o.base ?? 0;
    this.cor = o.cor ?? 'acento';
    this.permanente = o.permanente ?? false;
  }

  atualizar(dt) {
    if (this.permanente) { this.t = Math.min(this.t + dt, this.dur); return; }
    super.atualizar(dt);
  }

  /** Deixa reaproveitar a mesma instância em vez de acumular objetos. */
  disparar(intensidade = this.intensidade) {
    this.t = 0;
    this.intensidade = intensidade;
    this.morto = false;
  }

  definirBase(v) { this.base = clamp01(v); }

  desenharTela(ctx, tema, largura, altura) {
    const a = Math.pow(1 - this.p, 1.7) * this.intensidade + this.base;
    if (a <= 0.006) return;
    const c = corDe(tema, this.cor, 'acento');
    const g = ctx.createRadialGradient(
      largura / 2, altura / 2, Math.min(largura, altura) * 0.22,
      largura / 2, altura / 2, Math.max(largura, altura) * 0.62
    );
    g.addColorStop(0, rgba(c, 0));
    g.addColorStop(0.55, rgba(c, a * 0.22));
    g.addColorStop(1, rgba(c, a));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, largura, altura);
  }
}

/* =========================================================================
   GERENCIADOR
   ========================================================================= */

export class Efeitos {
  constructor() {
    /** Efeitos em espaço de MUNDO. */
    this.lista = [];
    /** Efeitos em espaço de TELA (vinheta). */
    this.tela = [];
    /** Teto de segurança: sala cheia de inimigos não pode virar sopa. */
    this.max = 90;
  }

  limpar() { this.lista.length = 0; this.tela.length = 0; }

  /** @template {object} T @param {T} ef @returns {T} */
  adicionar(ef) {
    const alvo = ef.naTela ? this.tela : this.lista;
    alvo.push(ef);
    if (alvo.length > this.max) alvo.splice(0, alvo.length - this.max);
    return ef;
  }

  atualizar(dt) {
    for (let i = this.lista.length - 1; i >= 0; i--) {
      this.lista[i].atualizar(dt);
      if (this.lista[i].morto) this.lista.splice(i, 1);
    }
    for (let i = this.tela.length - 1; i >= 0; i--) {
      this.tela[i].atualizar(dt);
      if (this.tela[i].morto) this.tela.splice(i, 1);
    }
  }

  desenhar(ctx, tema, camera) {
    for (const e of this.lista) e.desenhar(ctx, tema, camera);
  }

  desenharLuz(ctx, tema, camera) {
    for (const e of this.lista) e.desenharLuz(ctx, tema, camera);
  }

  desenharTela(ctx, tema, largura, altura) {
    for (const e of this.tela) e.desenharTela?.(ctx, tema, largura, altura);
  }

  /* ------------------------------------------------------------ atalhos -- */
  // Açúcar: `efeitos.anelChoque(x, y)` em vez de
  // `efeitos.adicionar(new AnelChoque(x, y))`. Todos devolvem a instância.

  anelChoque(x, y, o) { return this.adicionar(new AnelChoque(x, y, o)); }
  poeiraChao(x, y, o) { return this.adicionar(new PoeiraChao(x, y, o)); }
  faiscas(x, y, o) { return this.adicionar(new Faiscas(x, y, o)); }
  folhas(x, y, o) { return this.adicionar(new Folhas(x, y, o)); }
  ondaCanto(x, y, o) { return this.adicionar(new OndaCanto(x, y, o)); }
  dissolucao(x, y, o) { return this.adicionar(new Dissolucao(x, y, o)); }
  corte(x, y, o) { return this.adicionar(new Corte(x, y, o)); }
  vinhetaDano(o) { return this.adicionar(new VinhetaDano(o)); }

  /**
   * Aterrissagem completa: poeira + anel achatado no chão. `impacto` é o
   * mesmo 0..1 que o evento 'aterrissar' do jogador entrega.
   */
  aterrissagem(x, y, impacto = 1, o = {}) {
    this.poeiraChao(x, y, { forca: clamp(impacto * 1.3, 0.25, 1.6), ...o });
    if (impacto > 0.25) {
      this.anelChoque(x, y - 2, {
        raio: lerp(26, 82, clamp01(impacto)),
        espessura: lerp(2.5, 6, clamp01(impacto)),
        achatar: 0.26, dur: 0.28, alfa: 0.5 * impacto,
        cor: o.cor ?? 'borda', eco: 0,
      });
    }
  }

  /** Acerto de golpe: faíscas no sentido do impacto + anel curto e apertado. */
  impacto(x, y, dir = 1, o = {}) {
    this.faiscas(x, y, {
      angulo: dir > 0 ? 0 : Math.PI, espalhamento: 1.9,
      n: o.n ?? 10, forca: o.forca ?? 1, cor: o.cor ?? 'crista',
    });
    this.anelChoque(x, y, {
      raio: o.raio ?? 34, espessura: 5, dur: 0.2,
      cor: o.cor ?? 'crista', alfa: 0.8, eco: 0,
      arco: 2.6, direcao: dir > 0 ? 0 : Math.PI, achatar: 1.25,
      giro: dir > 0 ? -0.3 : 0.3,
    });
  }
}

export default Efeitos;
