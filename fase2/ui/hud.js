/* =========================================================================
   fase2/ui/hud.js — HUD desenhado no canvas
   -------------------------------------------------------------------------
   Desenhado no canvas, não em DOM: o HUD precisa reagir ao TEMA da área
   (ele muda de cor junto com o mundo restaurado) e a CSS não tem acesso ao
   tema interpolado por frame.

   Princípio: o HUD é o mais discreto possível. Vida sempre visível; nome de
   área e habilidade nova aparecem e SOMEM. Nada de barra permanente de
   experiência, minimapa ou contador — em jogo de atmosfera, HUD é ruído.
   ========================================================================= */

import { TAU, clamp01, lerp, damp, rgba, misturarHex, easeOutCubic, easeOutBack } from '../core/mat.js';
import { nomeArea } from '../render/paleta.js';

const NOMES_HABILIDADE = {
  saltoDuplo: 'Salto Duplo',
  investida: 'Investida',
  canto: 'Canto da Raiz',
  parede: 'Agarre',
  planeio: 'Planeio',
};

const DICAS_HABILIDADE = {
  saltoDuplo: 'Pular de novo no ar',
  investida: 'Shift — avanço rápido',
  canto: 'E — restaura o que está perto',
  parede: 'Segure contra a parede',
  planeio: 'Segure pular ao cair',
};

export class Hud {
  constructor(elemento, mundo) {
    this.el = elemento;
    this.mundo = mundo;
    this.ctx = null;
    if (elemento?.getContext) this.ctx = elemento.getContext('2d');

    this.anuncio = null;      // { titulo, sub, t, dur }
    this.pausado = false;
    this._vidaExibida = mundo.jogador.vida;
    this._dpr = 1;
  }

  anunciarSala(sala, mundo) {
    if (!sala.titulo) return;
    /* O título de sala-marco É o nome da área, e a área muda de nome quando
       é restaurada. Anunciar "A Clareira Queimada" numa clareira já coberta
       de verde desmente o que está na tela. */
    const pureza = mundo?.tema?.pureza ?? 0;
    const nome = nomeArea(sala.area, 0);
    const titulo = sala.titulo === nome ? nomeArea(sala.area, pureza) : sala.titulo;
    this.anunciar(titulo, null, 3.4);
  }

  anunciarHabilidade(id) {
    this.anunciar(NOMES_HABILIDADE[id] || id, DICAS_HABILIDADE[id] || '', 4.2);
  }

  anunciar(titulo, sub = null, dur = 3) {
    this.anuncio = { titulo, sub, t: 0, dur };
  }

  definirPausa(v) { this.pausado = v; }

  _ajustar() {
    const el = this.el;
    if (!el) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = el.getBoundingClientRect();
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (el.width !== w || el.height !== h) { el.width = w; el.height = h; }
    this._dpr = dpr;
    this.larguraCss = r.width;
    this.alturaCss = r.height;
    return w > 0 && h > 0;
  }

  desenhar(dt, tema) {
    if (!this.ctx || !this._ajustar()) return;
    const ctx = this.ctx;
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, this.larguraCss, this.alturaCss);

    this._vida(ctx, tema, dt);
    this._habilidades(ctx, tema);
    this._barraChefe(ctx, tema, dt);
    this._anuncio(ctx, tema, dt);
    if (this.pausado) this._pausa(ctx, tema);
  }

  /**
   * Barra de vida do chefe. Aparece sozinha quando há um chefe na sala e some
   * quando ele morre — sem HUD permanente.
   *
   * Duas camadas de barra: a da frente cai na hora e a de trás cai com atraso
   * de meio segundo, deixando um rastro claro. É como o jogador VÊ quanto dano
   * um golpe fez, o que é a informação que ele precisa para decidir se o
   * padrão que arriscou valeu a pena.
   */
  _barraChefe(ctx, tema, dt) {
    const chefe = this.mundo.entidades.find((e) => e.ehChefe && !e.morta);
    if (chefe) {
      this._chefeVisivel = chefe;
      this._chefeAlfa = Math.min(1, (this._chefeAlfa ?? 0) + dt * 1.6);
      const alvo = Math.max(0, chefe.fracaoVida);
      this._chefeFracao = alvo;
      // Rastro: acompanha para BAIXO devagar, mas acompanha para cima na hora
      // (transição de fase pode curar, e barra que sobe devagar confunde).
      this._chefeRastro = this._chefeRastro == null ? alvo
        : (alvo > this._chefeRastro ? alvo : damp(this._chefeRastro, alvo, 0.35, dt));
    } else {
      this._chefeAlfa = Math.max(0, (this._chefeAlfa ?? 0) - dt * 2.2);
      if (this._chefeAlfa <= 0) { this._chefeVisivel = null; this._chefeRastro = null; return; }
    }
    const alfa = this._chefeAlfa ?? 0;
    if (alfa <= 0.01 || !this._chefeVisivel) return;

    const w = Math.min(this.larguraCss * 0.56, 520);
    const x = (this.larguraCss - w) / 2;
    const y = this.alturaCss - 54;
    const h = 7;

    ctx.save();
    ctx.globalAlpha = alfa;

    ctx.font = '600 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = rgba(tema.particula, 0.9);
    ctx.fillText((this._chefeVisivel.nomeChefe || '').toUpperCase(), this.larguraCss / 2, y - 10);

    ctx.fillStyle = rgba(tema.ceuTopo, 0.75);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = rgba(tema.rust ?? '#8a4a2f', 0.55);
    ctx.fillRect(x, y, w * (this._chefeRastro ?? 0), h);
    ctx.fillStyle = tema.crista;
    ctx.fillRect(x, y, w * (this._chefeFracao ?? 0), h);
    ctx.strokeStyle = rgba(tema.borda, 0.9);
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    // Marcas nos limiares de fase: o jogador vê quanto falta para a luta
    // mudar, e isso transforma "estou perdendo" em "estou chegando lá".
    ctx.strokeStyle = rgba(tema.ceuTopo, 0.9);
    for (const l of this._chefeVisivel.limiaresFase ?? []) {
      ctx.beginPath();
      ctx.moveTo(x + w * l, y);
      ctx.lineTo(x + w * l, y + h);
      ctx.stroke();
    }
    ctx.restore();
  }

  _vida(ctx, tema, dt) {
    const j = this.mundo.jogador;
    this._vidaExibida = damp(this._vidaExibida, j.vida, 0.12, dt);

    const x0 = 30, y0 = 30, r = 8, gap = 23;

    // Acima de 12 pontos as máscaras atravessariam a tela inteira. O jogo não
    // deve chegar lá pelo caminho normal (fragmentos sobem devagar), mas um
    // save adulterado ou um teste chegam — e HUD que estoura a tela é pior que
    // HUD feio. Acima do limite, vira contador.
    const LIMITE_ICONES = 12;
    if (j.vidaMax > LIMITE_ICONES) {
      ctx.font = '700 15px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = misturarHex('#e8e2d0', tema.luz, 0.3);
      ctx.fillText(`${j.vida}`, x0 - 4, y0);
      const w = ctx.measureText(`${j.vida}`).width;
      ctx.font = '400 11px "JetBrains Mono", monospace';
      ctx.fillStyle = rgba(tema.particula, 0.7);
      ctx.fillText(`/ ${j.vidaMax}`, x0 - 4 + w + 6, y0 + 1);
      return;
    }

    for (let i = 0; i < j.vidaMax; i++) {
      const cheio = i < j.vida;
      const x = x0 + i * gap;
      // Máscaras iguais às do Guardião — a vida É ele, não um ícone genérico.
      ctx.beginPath();
      ctx.ellipse(x, y0, r * 0.82, r, 0, 0, TAU);
      if (cheio) {
        ctx.fillStyle = misturarHex('#e8e2d0', tema.luz, 0.3);
        ctx.fill();
        ctx.fillStyle = rgba(tema.ceuTopo, 0.85);
        ctx.beginPath();
        ctx.ellipse(x - 2.4, y0 - 0.6, 1.5, 2.3, 0, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(x + 2.4, y0 - 0.6, 1.5, 2.3, 0, 0, TAU);
        ctx.fill();
      } else {
        ctx.strokeStyle = rgba(tema.borda, 0.7);
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
    }
  }

  _habilidades(ctx, tema) {
    const j = this.mundo.jogador;
    if (!j.habilidades.size) return;
    const y = 62;
    let x = 30;
    ctx.font = '600 10px "JetBrains Mono", monospace';
    ctx.textBaseline = 'middle';
    for (const h of j.habilidades) {
      const nome = (NOMES_HABILIDADE[h] || h).toUpperCase();
      const w = ctx.measureText(nome).width;
      ctx.fillStyle = rgba(tema.ceuTopo, 0.45);
      ctx.fillRect(x - 5, y - 8, w + 10, 16);
      ctx.strokeStyle = rgba(tema.borda, 0.6);
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 5, y - 8, w + 10, 16);
      ctx.fillStyle = rgba(tema.crista, 0.85);
      ctx.fillText(nome, x, y);
      x += w + 20;
    }
  }

  _anuncio(ctx, tema, dt) {
    const a = this.anuncio;
    if (!a) return;
    a.t += dt;
    if (a.t >= a.dur) { this.anuncio = null; return; }

    // Entra rápido, fica, sai devagar.
    const entrada = clamp01(a.t / 0.5);
    const saida = clamp01((a.dur - a.t) / 0.9);
    const alfa = Math.min(easeOutCubic(entrada), saida);
    const desloc = (1 - easeOutCubic(entrada)) * 14;

    const cx = this.larguraCss / 2;
    const cy = this.alturaCss * 0.22 + desloc;

    ctx.save();
    ctx.globalAlpha = alfa;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.font = '700 clamp(20px, 2.6vw, 30px) "Space Grotesk", sans-serif';
    ctx.fillStyle = rgba(tema.ceuTopo, 0.75);
    ctx.fillText(a.titulo, cx + 1.5, cy + 1.5);
    ctx.fillStyle = misturarHex('#efe8d6', tema.crista, 0.35);
    ctx.fillText(a.titulo, cx, cy);

    // Filete embaixo, largura animada — dá acabamento sem caixa de diálogo.
    const w = lerp(0, 120, easeOutCubic(entrada));
    ctx.strokeStyle = rgba(tema.crista, 0.55);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - w, cy + 22);
    ctx.lineTo(cx + w, cy + 22);
    ctx.stroke();

    if (a.sub) {
      ctx.font = '400 12px "JetBrains Mono", monospace';
      ctx.fillStyle = rgba(tema.particula, 0.8);
      ctx.fillText(a.sub.toUpperCase(), cx, cy + 38);
    }
    ctx.restore();
  }

  _pausa(ctx, tema) {
    ctx.save();
    ctx.fillStyle = rgba(tema.ceuTopo, 0.55);
    ctx.fillRect(0, 0, this.larguraCss, this.alturaCss);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 26px "Space Grotesk", sans-serif';
    ctx.fillStyle = misturarHex('#efe8d6', tema.crista, 0.3);
    ctx.fillText('PAUSADO', this.larguraCss / 2, this.alturaCss / 2);
    ctx.font = '400 12px "JetBrains Mono", monospace';
    ctx.fillStyle = rgba(tema.particula, 0.75);
    ctx.fillText('ESC PARA CONTINUAR', this.larguraCss / 2, this.alturaCss / 2 + 30);
    ctx.restore();
  }
}
