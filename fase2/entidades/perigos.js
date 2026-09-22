/* =========================================================================
   fase2/entidades/perigos.js — a catástrofe que o jogador TOCA
   -------------------------------------------------------------------------
   O fundo mostra a poluição em escala de paisagem (render/catastrofe.js).
   Isto aqui é o pedaço dela que entra no plano do jogo — e que, por isso,
   tem regra:

     f  FOGO       chão em chamas. Machuca. Apaga com o Canto, e apaga
                   sozinho quando a sala se cura (o mesmo `forcaFogo` do
                   fundo: o que queima lá longe queima aqui).
     t  TRONCO     galho em chamas que despenca da copa num ritmo, com AVISO:
                   brasa pingando e uma mancha acesa no chão onde vai cair.
                   Obstáculo de tempo, nunca de sorte.
     m  FUMAÇA     bolsão tóxico. Não empurra nem fere ao encostar: sufoca —
                   um medidor sobe enquanto o Guardião está dentro e, cheio,
                   custa uma máscara. Escurece a visão. Some quando a ÁREA
                   fica sem parasitas (é o mesmo objetivo da semente), e o
                   Canto abre uma clareira nela por alguns segundos.
     a  BICHO      um animal PRESO (sob tora, no piche, num anel de fogo, no
                   arame). O Canto solta; ele se levanta, foge, e deixa um
                   fragmento de vida. Nas primeiras áreas o jogador ainda não
                   tem o Canto — o bicho fica esperando a volta.

   Regra de leitura que vale pra tudo aqui: BRANCO-QUENTE = PERIGO PERTO. O
   fogo que machuca tem núcleo claro; o fogo do fundo, não.

   Todo tempo de JOGO (ritmo do tronco, sufoco) corre em tempo real; só a
   animação decorativa desacelera com movimento reduzido.
   ========================================================================= */

import { TAU, clamp01, lerp, damp, rgba, misturarHex, hash2, easeOutCubic } from '../core/mat.js';
import {
  frenteDeFogo, chamaDe, focoDeLuz, desenharAnimal,
} from '../render/catastrofe.js';
import { TILE, SOLIDO } from '../mundo/terreno.js';

/** Força do fogo NESTA sala, 0..1 (1 = sala suja; 0 a partir de ~55% de pureza). */
function vivoFogo(mundo) {
  return clamp01(1 - (mundo?.tema?.pureza ?? 0) * 1.8);
}

/** Tempo da animação decorativa (a 1/3 com movimento reduzido). */
function tempoArte(mundo, t) {
  return mundo?.render?.movimentoReduzido ? t * 0.33 : t;
}

/** O Canto do jogador alcança este ponto AGORA? (a onda cresce com o tempo) */
function cantoAlcanca(j, x, y) {
  if (!(j.cantoRestante > 0)) return false;
  const r = easeOutCubic(j.progressoCanto) * j.raioCanto;
  return Math.hypot(j.centroX - x, j.centroY - y) <= r;
}

/* =========================================================================
   FOGO — chão em chamas
   ========================================================================= */

export class Fogo {
  constructor(obj) {
    this.cx = obj.cx; this.cy = obj.cy;
    this.xc = obj.x; this.yChao = obj.y;
    this.x = obj.x - TILE / 2; this.y = obj.y - 30;
    this.largura = TILE;
    this.gravidade = false;          // sem sombra de contato: não é um corpo
    this.perigoso = false;
    this.dano = 1;
    this.forca = 1;
    this.apagado = 0;
    this.apagando = false;
    this.t = hash2(obj.cx, obj.cy, 17) * 10;
    this._mundo = null;
  }
  // A caixa de dano é MENOR que o desenho: encostar na ponta de uma língua
  // não pode custar máscara — só pisar no fogo.
  caixa() { return { x: this.x + 5, y: this.yChao - 20, largura: TILE - 10, altura: 20 }; }

  atualizar(dt, mundo) {
    this._mundo = mundo;
    this.t += dt;
    const j = mundo.jogador;
    if (!this.apagando && vivoFogo(mundo) > 0.05 && cantoAlcanca(j, this.xc, this.yChao - 12)) {
      this.apagando = true;
      mundo.emitir(this.xc, this.yChao - 10, 12, {
        velMin: 20, velMax: 90, g: -90, vidaMin: 0.8, vidaMax: 1.6,
        cor: mundo.tema.particula, arrasto: 0.5,
      });
      mundo.aoEvento?.({ tipo: 'fogoApagado', x: this.xc, y: this.yChao });
    }
    if (this.apagando) this.apagado = Math.min(1, this.apagado + dt * 1.6);
    this.forca = vivoFogo(mundo) * (1 - this.apagado);
    this.perigoso = this.forca > 0.3;
  }

  desenhar(ctx, tema) {
    const ch = chamaDe(this._mundo?.sala?.area);
    const ta = tempoArte(this._mundo, this.t);
    // Chão queimado: fica depois que o fogo apaga — a cicatriz.
    ctx.fillStyle = rgba('#0c0908', 0.55);
    ctx.beginPath();
    ctx.ellipse(this.xc, this.yChao, TILE * 0.62, 5, 0, 0, TAU);
    ctx.fill();
    if (this.forca > 0.03) {
      frenteDeFogo(ctx, {
        x0: this.x - 4, x1: this.x + TILE + 4, passo: 6, yEm: () => this.yChao + 1,
        escala: 24 * (0.4 + 0.6 * this.forca), t: ta, semente: this.cx * 31 + this.cy,
        ch, inten: this.forca, inclina: 0.1, alfa: 1, piso: 1,
      });
    }
    // Apagado: fio de fumaça subindo da brasa.
    const fumo = 1 - this.forca;
    if (fumo > 0.1 && vivoFogo(this._mundo) > 0.05) {
      for (let i = 0; i < 3; i++) {
        const u = (ta * 0.3 + i / 3 + hash2(this.cx, i, 5)) % 1;
        ctx.fillStyle = rgba(tema.particula, 0.22 * (1 - u) * fumo);
        ctx.beginPath();
        ctx.arc(this.xc + Math.sin(ta + i * 2) * 4 * u, this.yChao - 6 - u * 46, 3 + u * 8, 0, TAU);
        ctx.fill();
      }
    }
  }

  desenharLuz(ctx) {
    if (this.forca < 0.05) return;
    const ch = chamaDe(this._mundo?.sala?.area);
    const pulso = 0.85 + 0.15 * Math.sin(tempoArte(this._mundo, this.t) * 9 + this.cx);
    focoDeLuz(ctx, this.xc, this.yChao - 12, 58, ch.meio, 0.5 * this.forca * pulso);
  }
}

/* =========================================================================
   TRONCO — galho em chamas despencando da copa
   ========================================================================= */

const PAUSA = 1.0;       // s parado antes do aviso
const AVISO = 1.3;       // s de brasa pingando antes da queda
const G_TRONCO = 2400;   // px/s²
const IMPACTO = 0.3;     // s em que o chão onde caiu ainda fere

export class TroncoCaindo {
  constructor(obj, terreno) {
    this.cx = obj.cx; this.cy = obj.cy;
    this.xc = obj.x; this.yChao = obj.y;
    // Cai de onde houver copa/teto acima; em céu aberto, de bem alto.
    let topo = obj.y - TILE * 14;
    for (let cy = obj.cy - 1; cy >= 0; cy--) {
      if (terreno?.em?.(obj.cx, cy) === SOLIDO) { topo = (cy + 1) * TILE; break; }
    }
    this.yTopo = Math.min(topo, obj.y - TILE * 5);
    const h = hash2(obj.cx, obj.cy, 29);
    this.periodo = lerp(4.4, 5.6, h);
    this.t = h * this.periodo;           // vizinhos fora de sincronia
    this.gravidade = false;
    this.perigoso = false;
    this.dano = 1;
    this.fase = 'pausa';
    this.yLog = this.yTopo;
    this.giro = 0;
    this.lado = h > 0.5 ? 1 : -1;
    this.x = this.xc - 14; this.y = this.yTopo;
    this._mundo = null;
    this._caiu = false;
  }

  get _duracaoQueda() { return Math.sqrt(2 * (this.yChao - this.yTopo) / G_TRONCO); }

  caixa() {
    if (this.fase === 'queda') return { x: this.xc - 18, y: this.yLog - 80, largura: 36, altura: 80 };
    return { x: this.xc - 44, y: this.yChao - 30, largura: 88, altura: 30 };
  }

  atualizar(dt, mundo) {
    this._mundo = mundo;
    if (vivoFogo(mundo) < 0.3) { this.fase = 'pausa'; this.perigoso = false; return; }
    this.t = (this.t + dt) % this.periodo;
    const tq = this._duracaoQueda;
    const inicioQueda = PAUSA + AVISO;
    if (this.t < PAUSA) this.fase = 'pausa';
    else if (this.t < inicioQueda) this.fase = 'aviso';
    else if (this.t < inicioQueda + tq) this.fase = 'queda';
    else if (this.t < inicioQueda + tq + IMPACTO) this.fase = 'impacto';
    else this.fase = 'brasa';

    if (this.fase === 'queda') {
      const s = this.t - inicioQueda;
      this.yLog = this.yTopo + 0.5 * G_TRONCO * s * s;
      this.giro = s * 1.6 * this.lado;
      this._caiu = false;
    } else if (this.fase === 'impacto' || this.fase === 'brasa') {
      this.yLog = this.yChao;
      if (!this._caiu) {
        this._caiu = true;
        mundo.emitir(this.xc, this.yChao - 6, 26, {
          velMin: 80, velMax: 320, g: 420, vidaMin: 0.4, vidaMax: 1.1,
          cor: chamaDe(mundo.sala?.area).brasa, brilha: true, arrasto: 0.5,
        });
        mundo.aoEvento?.({ tipo: 'troncoCaiu', x: this.xc, y: this.yChao });
      }
    } else {
      this._caiu = false;
    }
    // Brasa pingando no aviso: o jogador vê DE ONDE vai vir.
    if (this.fase === 'aviso' && Math.random() < dt * 14) {
      const yTopoVisto = Math.max(this.yTopo, (mundo.camera?.viewY ?? this.yTopo) - 10);
      mundo.emitir(this.xc + (Math.random() - 0.5) * 22, yTopoVisto, 1, {
        angulo: Math.PI / 2, espalhamento: 0.2, velMin: 120, velMax: 220, g: 380,
        vidaMin: 0.8, vidaMax: 1.4, cor: chamaDe(mundo.sala?.area).brasa, brilha: true, arrasto: 0.9,
      });
    }
    this.perigoso = this.fase === 'queda' || this.fase === 'impacto';
  }

  _log(ctx, tema, x, y, giro, alfa) {
    const ch = chamaDe(this._mundo?.sala?.area);
    ctx.save();
    ctx.globalAlpha *= alfa;
    ctx.translate(x, y);
    ctx.rotate(giro);
    // Grande o bastante pra ler como AMEAÇA ao lado do Guardião.
    ctx.scale(1.35, 1.35);
    // Galho: tora carbonizada com um toco de galho quebrado.
    ctx.fillStyle = misturarHex(tema.primeiroPlano, '#2a1a12', 0.5);
    ctx.beginPath();
    ctx.moveTo(-9, 0); ctx.lineTo(-11, -52); ctx.lineTo(-4, -64); ctx.lineTo(8, -58);
    ctx.lineTo(10, -30); ctx.lineTo(18, -40); ctx.lineTo(20, -36); ctx.lineTo(10, -20);
    ctx.lineTo(9, 0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba(ch.brasa, 0.9);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-3, -8); ctx.lineTo(-5, -26); ctx.lineTo(-2, -40);
    ctx.moveTo(4, -14); ctx.lineTo(3, -30);
    ctx.stroke();
    frenteDeFogo(ctx, {
      x0: -10, x1: 10, passo: 5, yEm: () => -52, escala: 16, t: tempoArte(this._mundo, this.t * 3),
      semente: this.cx * 7, ch, inten: 1, inclina: -0.3, alfa: 1, piso: 1,
    });
    ctx.restore();
  }

  desenhar(ctx, tema) {
    if (vivoFogo(this._mundo) < 0.3) return;
    const ch = chamaDe(this._mundo?.sala?.area);
    // Mancha acesa no chão durante o aviso: cresce e pulsa até a queda.
    if (this.fase === 'aviso' || this.fase === 'queda') {
      const k = this.fase === 'queda' ? 1 : clamp01((this.t - PAUSA) / AVISO);
      const pulso = 0.6 + 0.4 * Math.sin(this.t * 18);
      ctx.fillStyle = rgba(ch.meio, (0.18 + 0.32 * k) * pulso);
      ctx.beginPath();
      ctx.ellipse(this.xc, this.yChao, 20 + 26 * k, 4 + 4 * k, 0, 0, TAU);
      ctx.fill();
    }
    if (this.fase === 'queda') this._log(ctx, tema, this.xc, this.yLog, this.giro, 1);
    if (this.fase === 'impacto' || this.fase === 'brasa') {
      // Caído: deitado no chão, se desfazendo em brasa até o próximo.
      const ini = PAUSA + AVISO + this._duracaoQueda;
      const k = clamp01((this.t - ini) / Math.max(0.1, this.periodo - ini));
      this._log(ctx, tema, this.xc - this.lado * 40, this.yChao - 8, this.lado * Math.PI / 2, 1 - k);
    }
  }

  desenharLuz(ctx) {
    if (vivoFogo(this._mundo) < 0.3) return;
    const ch = chamaDe(this._mundo?.sala?.area);
    if (this.fase === 'queda') focoDeLuz(ctx, this.xc, this.yLog - 50, 70, ch.meio, 0.6);
    if (this.fase === 'impacto') focoDeLuz(ctx, this.xc, this.yChao - 10, 120, ch.meio, 0.7);
    if (this.fase === 'aviso') {
      const k = clamp01((this.t - PAUSA) / AVISO);
      focoDeLuz(ctx, this.xc, this.yChao - 4, 40 + 30 * k, ch.meio, 0.35 * k);
    }
  }
}

/* =========================================================================
   FUMAÇA TÓXICA — bolsão que sufoca
   ========================================================================= */

const RAIO_FUMACA = TILE * 3.4;
/** s dentro da fumaça densa até perder uma máscara. */
export const TEMPO_SUFOCO = 2.3;

export class Fumaca {
  constructor(obj) {
    this.cx = obj.cx; this.cy = obj.cy;
    this.xc = obj.x; this.yc = obj.y - TILE / 2;
    this.raio = RAIO_FUMACA;
    this.perigoso = false;
    this.gravidade = false;
    this.densidade = 1;
    this.clareado = 0;
    this.t = hash2(obj.cx, obj.cy, 41) * 20;
    this._iniciado = false;
    this._mundo = null;
  }
  // Sem `caixa`: a fumaça não bloqueia, não leva golpe e não fere ao
  // encostar. O que ela faz é pelo sufoco.

  atualizar(dt, mundo) {
    this._mundo = mundo;
    this.t += dt;
    const area = mundo.sala?.area;
    const limpa = (mundo.parasitasVivosNaArea?.(area) ?? 1) === 0 || (mundo.tema?.pureza ?? 0) >= 0.55;
    if (!this._iniciado) { this.densidade = limpa ? 0 : 1; this._iniciado = true; }
    this.densidade = damp(this.densidade, limpa ? 0 : 1, 0.6, dt);
    const j = mundo.jogador;
    if (cantoAlcanca(j, this.xc, this.yc)) this.clareado = 1;
    this.clareado = Math.max(0, this.clareado - dt / 6);
    const d = this.densidade * (1 - this.clareado);
    if (d > 0.3 && j.vivo && Math.hypot(j.centroX - this.xc, j.centroY - this.yc) < this.raio * 0.85) {
      j.sufoco = Math.min(1, (j.sufoco ?? 0) + (dt / TEMPO_SUFOCO) * d);
      j.naFumaca = true;
      if (!this._avisou) {
        this._avisou = true;
        mundo.aoEvento?.({ tipo: 'fumacaToxica', x: this.xc, y: this.yc });
      }
    }
  }

  _blocos() {
    // Seis bolhas deslocadas, cada uma girando devagar em volta do centro.
    const ta = tempoArte(this._mundo, this.t);
    const out = [];
    for (let i = 0; i < 6; i++) {
      const h = hash2(this.cx + i, this.cy, 43);
      const a = h * TAU + ta * lerp(0.08, 0.18, h) * (i % 2 ? 1 : -1);
      const r = this.raio * lerp(0.2, 0.55, hash2(i, this.cy, 47));
      out.push([this.xc + Math.cos(a) * r, this.yc + Math.sin(a) * r * 0.6,
        this.raio * lerp(0.55, 0.85, h)]);
    }
    return out;
  }

  /** Por CIMA das entidades e do Guardião: a fumaça esconde o que está nela. */
  desenharSobre(ctx, tema) {
    const d = this.densidade * (1 - this.clareado * 0.85);
    if (d < 0.02) return;
    /* Fumaça de queimada puxada pro marrom-esverdeado de coisa química,
       escura o bastante pra COBRIR o que está dentro — é esse o perigo: não
       ver o parasita que espera no meio dela. */
    // Mais ESCURA que o ar em volta: clara, ela lia como neblina bonita ou
    // como foco de luz — nunca como veneno.
    const cor = misturarHex(misturarHex('#221f14', tema.bruma, 0.2), '#56642a', 0.2);
    for (const [x, y, r] of this._blocos()) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(cor, 0.72 * d));
      g.addColorStop(0.55, rgba(cor, 0.5 * d));
      g.addColorStop(1, rgba(cor, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
}

/* =========================================================================
   BICHO PRESO — o Canto solta
   ========================================================================= */

const PRISAO = {
  raizes: { especie: 'veado', prisao: 'tora' },
  varzea: { especie: 'capivara', prisao: 'piche' },
  clareira: { especie: 'tamandua', prisao: 'fogo' },
  dossel: { especie: 'veado', prisao: 'arame' },
  coracao: { especie: 'capivara', prisao: 'piche' },
};

export class BichoPreso {
  /**
   * @param {() => object} criarFragmento  o prêmio (vem do catálogo, que
   *   conhece o Fragmento — importar daqui fecharia um ciclo de módulos)
   */
  constructor(obj, chave, area, criarFragmento) {
    this.chave = chave;
    this.cx = obj.cx; this.cy = obj.cy;
    this.xc = obj.x; this.yChao = obj.y;
    const p = PRISAO[area] ?? PRISAO.raizes;
    this.especie = p.especie;
    this.prisao = p.prisao;
    this.x = obj.x - 40; this.y = obj.y - 36;
    this.largura = 80;
    this.gravidade = false;
    this.perigoso = false;
    this.dano = 1;
    this.h = hash2(obj.cx, obj.cy, 53);
    this.dir = this.h > 0.5 ? 1 : -1;
    this.estado = 'preso';
    this.tl = 0;
    this.t = this.h * 10;
    this.xAnda = 0;
    this.solta = 0;              // 0..1, a prisão se desfazendo
    this._avisou = 0;
    this._criarFragmento = criarFragmento;
    this._mundo = null;
  }

  // Só o anel de fogo fere (branco-quente = perigo); o resto é inofensivo.
  caixa() { return { x: this.xc - 70, y: this.yChao - 22, largura: 140, altura: 22 }; }

  atualizar(dt, mundo) {
    this._mundo = mundo;
    this.t += dt;
    this.tl += dt;
    if (this._avisou > 0) this._avisou -= dt;
    const j = mundo.jogador;
    const dist = Math.hypot(j.centroX - this.xc, j.centroY - (this.yChao - 20));

    if (this.estado === 'preso') {
      this.perigoso = this.prisao === 'fogo';
      if (dist < 200 && this._avisou <= 0) {
        this._avisou = 7;
        mundo.aoEvento?.({ tipo: 'bichoPreso', temCanto: !!j.temHabilidade?.('canto'), x: this.xc, y: this.yChao });
      }
      if (cantoAlcanca(j, this.xc, this.yChao - 20)) {
        this.estado = 'soltando'; this.tl = 0;
        mundo.salvarBicho?.(this.chave);
        mundo.emitir(this.xc, this.yChao - 20, 34, {
          velMin: 50, velMax: 260, g: -40, vidaMin: 0.7, vidaMax: 1.6,
          cor: mundo.tema.crista, brilha: true, arrasto: 0.5,
        });
        mundo.aoEvento?.({ tipo: 'bichoSalvo', x: this.xc, y: this.yChao });
      }
      return;
    }
    this.perigoso = false;
    if (this.estado === 'soltando') {
      this.solta = clamp01(this.tl / 1.1);
      if (this.tl > 1.1) { this.estado = 'levantando'; this.tl = 0; }
    } else if (this.estado === 'levantando') {
      if (this.tl > 1.95) {
        this.estado = 'fugindo'; this.tl = 0;
        // Foge pro lado OPOSTO ao Guardião — e deixa o presente pra trás.
        this.dir = j.centroX > this.xc ? -1 : 1;
        const frag = this._criarFragmento?.();
        if (frag) mundo.entidades.push(frag);
      }
    } else if (this.estado === 'fugindo') {
      this.xAnda += this.dir * 330 * dt * clamp01(this.tl / 0.3);
      if (this.tl > 2.2) this.morta = true;
    }
  }

  _pose() {
    const suave = (a, b, t) => { const k = clamp01((t - a) / (b - a)); return k * k * (3 - 2 * k); };
    const ta = tempoArte(this._mundo, this.t);
    if (this.estado === 'preso' || this.estado === 'soltando') {
      // Preso: de lado, respirando curto; a cada poucos segundos se DEBATE —
      // ergue a cabeça, sacode, e desiste. É o que diz "vivo e preso".
      const ciclo = ta % 3.4;
      const debate = ciclo < 0.7 ? Math.sin(ciclo / 0.7 * Math.PI) : 0;
      const arfa = Math.max(0, Math.sin(ta * 3.1)) * 0.06;
      return {
        deitado: 1, deLado: 1 - 0.5 * debate, ergue: 0.6 * debate,
        peito: 1 + arfa, sacode: Math.sin(ta * 40) * 0.03 * debate,
        olhoFechado: debate < 0.2, fase: 0, galope: 0,
      };
    }
    if (this.estado === 'levantando') {
      const t = this.tl;
      return {
        deLado: 1 - suave(0, 0.45, t), deitadoTras: 1 - suave(0.4, 0.85, t),
        deitado: 1 - 0.45 * suave(0.4, 0.85, t) - 0.55 * suave(0.85, 1.25, t),
        ergue: suave(0.1, 0.5, t), peito: 1,
        sacode: t > 1.25 && t < 1.7 ? Math.sin(t * 46) * 0.035 : 0,
        olhoFechado: false, fase: 0, galope: 0,
      };
    }
    return { deitado: 0, deLado: 0, ergue: 0, peito: 1, sacode: 0, olhoFechado: false,
      fase: ta * TAU * 2.2, galope: clamp01(this.tl / 0.3) };
  }

  desenhar(ctx, tema) {
    const L = 60;
    const pose = this._pose();
    const ch = chamaDe(this._mundo?.sala?.area);
    const x = this.xc + this.xAnda;
    const some = this.estado === 'fugindo' ? clamp01(1 - (this.tl - 1.4) / 0.8) : 1;
    const pelo = misturarHex(misturarHex(tema.terreno, '#7a5a44', 0.55), tema.luz, 0.12);
    const preso = 1 - this.solta;
    const comPrisao = preso > 0.02 && this.estado !== 'fugindo';

    ctx.save();
    ctx.globalAlpha *= some;
    // Prisão, a parte de TRÁS: o anel de fogo queima dos dois lados.
    if (this.prisao === 'fogo' && comPrisao) {
      for (const lado of [-1, 1]) {
        frenteDeFogo(ctx, {
          x0: this.xc + lado * 54 - 16, x1: this.xc + lado * 54 + 16, passo: 6,
          yEm: () => this.yChao + 1, escala: 28 * preso, t: tempoArte(this._mundo, this.t),
          semente: this.cx * 13 + lado, ch, inten: preso, inclina: 0.1, alfa: 1, piso: 1,
        });
      }
    }
    // O bicho.
    ctx.save();
    ctx.translate(x, this.yChao + 1);
    ctx.scale((this.estado === 'fugindo' ? this.dir : -this.dir) * L, L);
    ctx.fillStyle = pelo;
    ctx.strokeStyle = pelo;
    desenharAnimal(ctx, this.especie, pose.fase, pose.galope, tempoArte(this._mundo, this.t), this.h,
      rgba(tema.luz, 0.4), {
        deitado: pose.deitado, deitadoTras: pose.deitadoTras, deLado: pose.deLado,
        ergue: pose.ergue, peito: pose.peito, sacode: pose.sacode,
        olhoFechado: pose.olhoFechado,
        olho: pose.olhoFechado ? rgba('#2a1d15', 0.9) : rgba('#f6f2ea', 0.9),
        contorno: rgba(tema.primeiroPlano, 0.75),
        // No piche o bicho fica MARROM: a prisão é a massa preta em volta,
        // e bicho preto dentro de piche preto era só uma mancha.
        oleo: 0,
      });
    ctx.restore();

    // Prisão, a parte da FRENTE.
    if (comPrisao) {
      if (this.prisao === 'tora') this._tora(ctx, tema, preso, ch);
      else if (this.prisao === 'piche') this._piche(ctx, preso);
      else if (this.prisao === 'arame') this._arame(ctx, preso);
    }
    ctx.restore();
  }

  _tora(ctx, tema, k, ch) {
    // Tora carbonizada caída por cima do corpo, rachas em brasa. Soltando,
    // ela vira cinza e se desfaz.
    ctx.save();
    ctx.globalAlpha *= k;
    ctx.translate(this.xc, this.yChao - 16);
    ctx.rotate(-0.12 * this.dir);
    ctx.fillStyle = misturarHex(tema.primeiroPlano, '#2a1a12', 0.45);
    ctx.beginPath();
    ctx.moveTo(-58, -8); ctx.lineTo(54, -12); ctx.quadraticCurveTo(62, -2, 54, 8);
    ctx.lineTo(-58, 10); ctx.quadraticCurveTo(-64, 1, -58, -8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba(ch.brasa, 0.85);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-40, -2); ctx.lineTo(-18, -4); ctx.lineTo(-6, -1);
    ctx.moveTo(12, 1); ctx.lineTo(34, -3);
    ctx.stroke();
    ctx.restore();
  }

  _piche(ctx, k) {
    // Piche até a barriga: massa preta brilhante, um fio de reflexo.
    const w = 66 * (0.4 + 0.6 * k), hgt = 11 * k;
    ctx.fillStyle = rgba('#0b0908', 0.92);
    ctx.beginPath();
    ctx.moveTo(this.xc - w, this.yChao + 2);
    ctx.bezierCurveTo(this.xc - w * 0.8, this.yChao - hgt, this.xc - w * 0.3, this.yChao - hgt * 1.3,
      this.xc, this.yChao - hgt);
    ctx.bezierCurveTo(this.xc + w * 0.35, this.yChao - hgt * 0.8, this.xc + w * 0.8, this.yChao - hgt * 1.2,
      this.xc + w, this.yChao + 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = rgba('#b8c8c0', 0.35 * k);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(this.xc - w * 0.5, this.yChao - hgt * 0.95);
    ctx.quadraticCurveTo(this.xc - w * 0.2, this.yChao - hgt * 1.25, this.xc + w * 0.1, this.yChao - hgt * 0.95);
    ctx.stroke();
  }

  _arame(ctx, k) {
    // Arame farpado enrolado no corpo: três voltas com farpas. Soltando, os
    // fios se abrem pra fora e somem.
    ctx.save();
    ctx.strokeStyle = rgba('#9aa0a4', 0.9 * k);
    ctx.lineWidth = 1.3;
    const abre = 1 - k;
    for (let i = 0; i < 3; i++) {
      const y0 = this.yChao - 8 - i * 9 - abre * 20;
      const x0 = this.xc - 44 - abre * 16, x1 = this.xc + 44 + abre * 16;
      ctx.beginPath();
      for (let x = x0; x <= x1; x += 6) {
        const y = y0 + Math.sin((x - x0) * 0.21 + i) * 3;
        x === x0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      for (let x = x0 + 8; x < x1; x += 16) {
        const y = y0 + Math.sin((x - x0) * 0.21 + i) * 3;
        ctx.beginPath();
        ctx.moveTo(x - 2.5, y - 2.5); ctx.lineTo(x + 2.5, y + 2.5);
        ctx.moveTo(x + 2.5, y - 2.5); ctx.lineTo(x - 2.5, y + 2.5);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  desenharLuz(ctx, tema) {
    const ch = chamaDe(this._mundo?.sala?.area);
    if (this.prisao === 'fogo' && this.estado === 'preso') {
      focoDeLuz(ctx, this.xc, this.yChao - 14, 90, ch.meio, 0.5);
    }
    // Com o Canto na mão e perto: um pulso claro chamando.
    const j = this._mundo?.jogador;
    if (this.estado === 'preso' && j?.temHabilidade?.('canto')) {
      const d = Math.hypot(j.centroX - this.xc, j.centroY - this.yChao);
      if (d < 260) {
        const p = 0.5 + 0.5 * Math.sin(this.t * 3);
        focoDeLuz(ctx, this.xc, this.yChao - 24, 70, tema.crista, 0.35 * p * (1 - d / 260));
      }
    }
  }
}

/* =========================================================================
   A VISÃO SUFOCADA — vinheta em tela, lida do jogador
   ========================================================================= */

/** Escurece a borda da tela conforme `jogador.sufoco` sobe. */
export function desenharSufoco(ctx, w, h, sufoco) {
  if (!(sufoco > 0.02)) return;
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * lerp(0.5, 0.18, sufoco),
    w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(20,18,10,0)');
  g.addColorStop(1, `rgba(20,18,10,${(0.85 * sufoco).toFixed(3)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
