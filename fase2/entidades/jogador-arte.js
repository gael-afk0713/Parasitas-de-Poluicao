/* =========================================================================
   fase2/entidades/jogador-arte.js — desenho do Guardião
   -------------------------------------------------------------------------
   O personagem é desenhado por código, não sprite: assim ele responde à
   física de forma contínua (squash real, capa com inércia, broto que floresce
   conforme o mundo é restaurado) em vez de trocar entre quadros fixos.

   Quem é: o antigo CEO da Fase 1. Ainda veste o que sobrou do casaco
   corporativo — rasgado, virando capa. A máscara pálida cobre o rosto porque
   ele não tem mais um; do topo da cabeça brota um rebento que ABRE conforme
   as áreas são restauradas. O jogador vê o próprio progresso no personagem,
   sem HUD.

   Regras de silhueta (Ori/HK): o corpo é uma forma escura e SÓLIDA, legível
   a 100px de distância. Todo o interesse visual mora em (a) o contorno e (b)
   dois pontos de luz — máscara e broto. Detalhe interno em personagem
   pequeno vira sujeira.
   ========================================================================= */

import {
  TAU, clamp, clamp01, lerp, damp, easeOutCubic, easeOutBack, rgba, misturarHex,
} from '../core/mat.js';
import { ESTADOS } from './jogador.js';
import { luzRadial } from '../render/renderizador.js';

/* Estado de animação que não pertence à física — vive aqui. */
export class ArteJogador {
  constructor() {
    /** Segmentos da capa: cada um segue o anterior com atraso (inércia). */
    this.capa = Array.from({ length: 5 }, () => ({ x: 0, y: 0, vx: 0, vy: 0 }));
    this.capaIniciada = false;
    this.floracao = 0;        // 0..1 — quanto o broto abriu
    this._floracaoAlvo = 0;
    this.piscar = 0;          // timer de piscada da máscara
    this._proxPiscada = 2.5;
    this.rastro = [];         // posições anteriores, pro rastro da investida
  }

  /** `floracao` 0..1 = média de pureza do mundo. Muda devagar, de propósito. */
  definirFloracao(v) { this._floracaoAlvo = clamp01(v); }

  atualizar(dt, j) {
    this.floracao = damp(this.floracao, this._floracaoAlvo, 0.9, dt);

    // --- capa: cadeia de molas seguindo o corpo ---
    const ancoraX = j.centroX - j.direcao * 5;
    const ancoraY = j.y + 15;
    if (!this.capaIniciada) {
      for (const s of this.capa) { s.x = ancoraX; s.y = ancoraY; }
      this.capaIniciada = true;
    }
    let alvoX = ancoraX, alvoY = ancoraY;
    for (let i = 0; i < this.capa.length; i++) {
      const s = this.capa[i];
      // Rigidez decresce ao longo da capa: a ponta esvoaça mais que a gola.
      const rigidez = lerp(340, 130, i / (this.capa.length - 1));
      const amort = lerp(16, 10, i / (this.capa.length - 1));
      s.vx += (alvoX - s.x) * rigidez * dt;
      s.vy += (alvoY - s.y) * rigidez * dt;
      // Gravidade própria da capa + arrasto contra a velocidade do corpo:
      // é isso que faz ela levantar ao correr e cair ao parar.
      s.vy += 520 * dt;
      s.vx -= j.vx * 1.05 * dt;
      s.vy -= j.vy * 0.5 * dt;
      s.vx = damp(s.vx, 0, 1 / amort, dt);
      s.vy = damp(s.vy, 0, 1 / amort, dt);
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      // Cada segmento não pode se afastar mais que L do anterior.
      const L = 5.5;
      const dx = s.x - alvoX, dy = s.y - alvoY;
      const d = Math.hypot(dx, dy);
      if (d > L) { s.x = alvoX + (dx / d) * L; s.y = alvoY + (dy / d) * L; }
      alvoX = s.x; alvoY = s.y;
    }

    // --- piscada ---
    this._proxPiscada -= dt;
    if (this._proxPiscada <= 0) { this.piscar = 0.12; this._proxPiscada = 2 + Math.random() * 4; }
    if (this.piscar > 0) this.piscar -= dt;

    // --- rastro da investida ---
    if (j.estado === ESTADOS.INVESTIDA) {
      this.rastro.push({ x: j.centroX, y: j.centroY, t: 0.24, dir: j.direcao });
    }
    for (let i = this.rastro.length - 1; i >= 0; i--) {
      this.rastro[i].t -= dt;
      if (this.rastro[i].t <= 0) this.rastro.splice(i, 1);
    }
  }

  /* --------------------------------------------------------------------- */

  /**
   * @param {CanvasRenderingContext2D} ctx  já transformado pro espaço do mundo
   * @param {import('./jogador.js').Jogador} j
   * @param {import('../render/paleta.js').Tema} tema
   */
  desenhar(ctx, j, tema) {
    if (!j.visivel) return;

    // Rastro primeiro, atrás de tudo.
    for (const r of this.rastro) {
      const a = clamp01(r.t / 0.24);
      ctx.save();
      ctx.globalAlpha = a * 0.34;
      ctx.translate(r.x, r.y);
      ctx.scale(r.dir, 1);
      ctx.fillStyle = tema.acento;
      ctx.beginPath();
      ctx.ellipse(0, 0, 12 * a + 4, 20 * a + 6, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(j.centroX, j.pesY);
    ctx.rotate(j.inclinacao);
    ctx.scale(j.direcao * j.esticar, j.achatar);
    // A partir daqui: origem nos PÉS, olhando pra direita, y negativo = cima.

    this._capa(ctx, j, tema);
    this._pernas(ctx, j, tema);
    this._corpo(ctx, j, tema);
    this._bracos(ctx, j, tema);
    this._cabeca(ctx, j, tema);
    this._broto(ctx, j, tema);

    ctx.restore();

    this._ataque(ctx, j, tema);
  }

  _capa(ctx, j, tema) {
    // A capa vive em coordenadas de MUNDO (a simulação é lá), então
    // desfazemos a transformação local pra desenhá-la.
    ctx.save();
    ctx.setTransform(ctx.getTransform());
    ctx.restore();

    ctx.save();
    ctx.scale(j.direcao, 1);   // volta pra orientação neutra dentro do corpo
    ctx.scale(j.direcao, 1);
    const pts = this.capa;
    ctx.beginPath();
    ctx.moveTo(-6, -30);
    // Aproxima a cadeia em coordenadas locais relativas ao corpo.
    for (let i = 0; i < pts.length; i++) {
      const s = pts[i];
      const lx = (s.x - j.centroX) * j.direcao;
      const ly = s.y - j.pesY;
      const largura = lerp(9, 2.5, i / (pts.length - 1));
      ctx.lineTo(lx - largura, ly);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const s = pts[i];
      const lx = (s.x - j.centroX) * j.direcao;
      const ly = s.y - j.pesY;
      const largura = lerp(9, 2.5, i / (pts.length - 1));
      ctx.lineTo(lx + largura, ly);
    }
    ctx.lineTo(6, -30);
    ctx.closePath();
    ctx.fillStyle = misturarHex(tema.primeiroPlano, tema.terreno, 0.35);
    ctx.fill();
    ctx.restore();
  }

  _pernas(ctx, j, tema) {
    const cor = tema.primeiroPlano;
    ctx.fillStyle = cor;
    const noAr = !j.noChao;
    const passo = Math.sin(j.faseAndar);
    const passo2 = Math.sin(j.faseAndar + Math.PI);
    const amp = j.estado === ESTADOS.CORRENDO ? 5.5 : 0;

    const perna = (dx, fase) => {
      ctx.beginPath();
      if (noAr) {
        // No ar as pernas recolhem — silhueta compacta lê melhor em pulo.
        const recolhe = clamp01(-j.vy / 400);
        ctx.ellipse(dx + 1, -6 + recolhe * 2, 3.4, 6 - recolhe * 2, 0.3 * fase, 0, TAU);
      } else {
        ctx.ellipse(dx + fase * amp, -5, 3.2, 6, fase * 0.22, 0, TAU);
      }
      ctx.fill();
    };
    perna(-4, passo);
    perna(4, passo2);
  }

  _corpo(ctx, j, tema) {
    const g = ctx.createLinearGradient(0, -34, 0, -6);
    g.addColorStop(0, misturarHex(tema.primeiroPlano, tema.terreno, 0.28));
    g.addColorStop(1, tema.primeiroPlano);
    ctx.fillStyle = g;
    ctx.beginPath();
    // Tronco em forma de sino — ombros estreitos, base larga (o casaco).
    ctx.moveTo(-6, -32);
    ctx.bezierCurveTo(-11, -22, -12, -14, -10, -5);
    ctx.lineTo(10, -5);
    ctx.bezierCurveTo(12, -14, 11, -22, 6, -32);
    ctx.closePath();
    ctx.fill();

    // Debrum na barra — uma linha só, pra dar acabamento sem sujar.
    ctx.strokeStyle = rgba(tema.crista, 0.3);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-10, -6);
    ctx.lineTo(10, -6);
    ctx.stroke();
  }

  _bracos(ctx, j, tema) {
    ctx.fillStyle = tema.primeiroPlano;
    const atacando = j.ataqueRestante > 0;
    const t = atacando ? 1 - j.ataqueRestante / 0.22 : 0;
    const balanço = j.noChao ? Math.sin(j.faseAndar + Math.PI) * 4 : -3;

    // braço de trás
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.ellipse(-7, -20 + balanço * 0.3, 2.8, 7, -0.2, 0, TAU);
    ctx.fill();
    ctx.restore();

    // braço da frente — durante o ataque acompanha o arco do golpe
    ctx.beginPath();
    if (atacando) {
      const ang = lerp(-1.1, 0.9, easeOutCubic(t));
      ctx.save();
      ctx.translate(7, -21);
      ctx.rotate(ang);
      ctx.ellipse(0, 5, 2.9, 8, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    } else {
      ctx.ellipse(8, -20 - balanço * 0.3, 2.9, 7, 0.18, 0, TAU);
      ctx.fill();
    }
  }

  _cabeca(ctx, j, tema) {
    const flutuar = Math.sin(j.faseFlutuar * 2.1) * 0.7;
    const cy = -37 + flutuar;

    // capuz (parte do casaco, envolve a máscara)
    ctx.fillStyle = misturarHex(tema.primeiroPlano, tema.terreno, 0.18);
    ctx.beginPath();
    ctx.moveTo(-8, cy + 6);
    ctx.bezierCurveTo(-10, cy - 6, -5, cy - 11, 1, cy - 11);
    ctx.bezierCurveTo(7, cy - 11, 10, cy - 5, 9, cy + 6);
    ctx.closePath();
    ctx.fill();

    // máscara pálida — a forma mais clara do personagem, o "rosto" que lê
    ctx.fillStyle = misturarHex('#e8e2d0', tema.luz, 0.28);
    ctx.beginPath();
    ctx.ellipse(1.5, cy, 6.2, 7, 0, 0, TAU);
    ctx.fill();

    // olhos — dois vazios escuros. Piscar fecha em fenda.
    const abertura = this.piscar > 0 ? 0.18 : 1;
    ctx.fillStyle = rgba(tema.ceuTopo, 0.9);
    for (const dx of [-1.6, 4.2]) {
      ctx.beginPath();
      ctx.ellipse(dx, cy - 0.5, 1.5, 2.4 * abertura, 0, 0, TAU);
      ctx.fill();
    }
  }

  _broto(ctx, j, tema) {
    const f = this.floracao;
    const cy = -37 + Math.sin(j.faseFlutuar * 2.1) * 0.7;
    const alturaCaule = lerp(4, 11, f);

    ctx.strokeStyle = misturarHex(tema.borda, tema.crista, f);
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(1, cy - 9);
    ctx.quadraticCurveTo(1 + Math.sin(j.faseFlutuar * 1.4) * 2, cy - 9 - alturaCaule * 0.6,
      3, cy - 9 - alturaCaule);
    ctx.stroke();

    if (f > 0.06) {
      // Pétalas abrem em leque conforme a floração.
      const n = 5;
      ctx.fillStyle = tema.acento;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i - (n - 1) / 2) * lerp(0.1, 0.62, f);
        const r = lerp(0.8, 3.4, f);
        ctx.save();
        ctx.translate(3, cy - 9 - alturaCaule);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.9, r * 0.55, r, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  _ataque(ctx, j, tema) {
    if (j.ataqueRestante <= 0) return;
    const t = 1 - j.ataqueRestante / 0.22;
    const a = Math.sin(clamp01(t) * Math.PI);
    ctx.save();
    ctx.translate(j.centroX + j.direcao * 22, j.centroY);
    ctx.scale(j.direcao, 1);
    ctx.globalAlpha = a * 0.9;
    // Arco fino, alongado — corte, não bola de luz.
    ctx.strokeStyle = tema.crista;
    ctx.lineWidth = lerp(6, 1.5, t);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, 26, lerp(-1.5, -0.5, t), lerp(0.4, 1.5, t));
    ctx.stroke();
    ctx.restore();
  }

  /** Passe emissivo — só o que EMITE luz. Chamado por render.emissivo(). */
  desenharLuz(ctx, j, tema) {
    if (!j.visivel) return;
    const cy = j.pesY - 37;

    // Máscara: brilho fraco e constante — a presença do personagem no escuro.
    luzRadial(ctx, j.centroX + 1.5 * j.direcao, cy, 26, tema.luz, 0.34 + j.brilho * 0.4);

    // Broto florido: a luz cresce com a restauração do mundo.
    if (this.floracao > 0.05) {
      luzRadial(ctx, j.centroX + 3 * j.direcao, cy - 18, 34 * this.floracao,
        tema.acento, this.floracao * 0.7);
    }

    if (j.ataqueRestante > 0) {
      const a = Math.sin((1 - j.ataqueRestante / 0.22) * Math.PI);
      luzRadial(ctx, j.centroX + j.direcao * 30, j.centroY, 44, tema.crista, a * 0.8);
    }

    if (j.estado === ESTADOS.INVESTIDA) {
      luzRadial(ctx, j.centroX, j.centroY, 40, tema.acento, 0.7);
    }

    if (j.cantoRestante > 0) {
      const p = j.progressoCanto;
      const raio = easeOutCubic(p) * j.raioCanto;
      const forca = Math.sin(p * Math.PI);
      ctx.save();
      ctx.strokeStyle = rgba(tema.crista, forca * 0.85);
      ctx.lineWidth = lerp(9, 1.5, p);
      ctx.beginPath();
      ctx.arc(j.centroX, j.centroY, raio, 0, TAU);
      ctx.stroke();
      ctx.restore();
      luzRadial(ctx, j.centroX, j.centroY, raio * 0.7, tema.acento, forca * 0.5);
    }
  }
}
