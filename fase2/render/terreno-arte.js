/* =========================================================================
   fase2/render/terreno-arte.js — pintura do terreno jogável
   -------------------------------------------------------------------------
   Recebe os contornos suavizados de `mundo/terreno.js` e pinta em camadas.
   A ordem existe por um motivo e cada passe resolve um problema específico:

     1. massa       silhueta cheia, com gradiente vertical (topo mais claro)
     2. estratos    faixas horizontais internas — dão idade e escala à rocha
     3. oclusão     escurecimento junto à borda POR DENTRO, simula profundidade
     4. contorno    linha de tinta, espessura variável — traço de nanquim
     5. crista      luz de borda só nas faces voltadas pra cima
     6. musgo       vegetação nas mesmas faces, densidade = pureza da área

   O passe 5 é o que mais entrega "desenhado à mão": luz de borda uniforme no
   contorno inteiro parece contorno de PowerPoint; luz só onde a luz bateria
   parece pintura.
   ========================================================================= */

import {
  TAU, clamp, clamp01, lerp, rgba, misturarHex, ruido1, hash2, Rng,
} from '../core/mat.js';
import { caminhoDe } from './renderizador.js';

export class ArteTerreno {
  /** @param {import('../mundo/terreno.js').Terreno} terreno */
  constructor(terreno, semente = 7) {
    this.terreno = terreno;
    this.semente = semente;
    this._cacheMusgo = null;
    this._cachePureza = -1;
  }

  invalidar() { this._cacheMusgo = null; }

  /* --------------------------------------------------------------------- */

  desenhar(ctx, tema, camera) {
    const path = this.terreno.path();
    const alturaMundo = this.terreno.alturaPx;

    // --- 1. massa ------------------------------------------------------
    const g = ctx.createLinearGradient(0, camera.viewY, 0, camera.viewY + camera.altura);
    g.addColorStop(0, misturarHex(tema.terreno, tema.crista, 0.16));
    g.addColorStop(0.5, tema.terreno);
    g.addColorStop(1, tema.terrenoFundo);
    ctx.fillStyle = g;
    ctx.fill(path);

    // --- 2. estratos ---------------------------------------------------
    // Recortados pela silhueta: as faixas só aparecem dentro da rocha.
    ctx.save();
    ctx.clip(path);
    this._estratos(ctx, tema, camera, alturaMundo);
    ctx.restore();

    // --- 3. oclusão interna --------------------------------------------
    ctx.save();
    ctx.clip(path);
    ctx.strokeStyle = rgba(tema.ceuTopo, 0.55);
    ctx.lineWidth = 14;
    ctx.stroke(path);
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 5;
    ctx.stroke(path);
    ctx.restore();

    // --- 4. contorno ---------------------------------------------------
    this._contorno(ctx, tema);

    // --- 5 e 6. crista + musgo ------------------------------------------
    this._cristas(ctx, tema);
  }

  _estratos(ctx, tema, camera, alturaMundo) {
    const corA = rgba(tema.terrenoFundo, 0.5);
    const corB = rgba(misturarHex(tema.terreno, tema.borda, 0.5), 0.32);
    const a = camera.areaVisivel(80);
    const passo = 34;
    const y0 = Math.floor(a.y / passo) * passo;
    for (let y = y0; y < a.y + a.altura; y += passo) {
      const n = ruido1(y * 0.021, this.semente);
      ctx.fillStyle = n > 0.5 ? corA : corB;
      // Faixa com altura e deslocamento variáveis — faixa regular vira listra.
      const h = lerp(4, 15, ruido1(y * 0.037 + 11, this.semente));
      const dx = (ruido1(y * 0.013 + 5, this.semente) - 0.5) * 60;
      ctx.fillRect(a.x + dx, y, a.largura, h);
    }
  }

  _contorno(ctx, tema) {
    for (const c of this.terreno.contornos()) {
      const pts = c.pontos;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      // Espessura variável ao longo do traço: é o que diferencia caneta de
      // pincel. Desenhado em segmentos curtos porque o canvas não tem
      // espessura variável nativa.
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const n = ruido1(i * 0.09, this.semente + 3);
        ctx.strokeStyle = rgba(tema.borda, lerp(0.55, 1, n));
        ctx.lineWidth = lerp(1.4, 3.4, n);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }

  _cristas(ctx, tema) {
    const faixas = this.terreno.arestasSuperiores(0.5);
    const pureza = tema.pureza ?? 0;

    for (const faixa of faixas) {
      // luz de borda
      ctx.strokeStyle = rgba(tema.crista, lerp(0.45, 0.9, pureza));
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      caminhoDe(ctx, faixa);
      ctx.stroke();

      // segunda passada mais fina e mais clara, deslocada 1px pra cima —
      // sugere um bisel de luz em vez de uma linha chapada
      ctx.strokeStyle = rgba(misturarHex(tema.crista, '#ffffff', 0.4), lerp(0.15, 0.5, pureza));
      ctx.lineWidth = 1;
      ctx.save();
      ctx.translate(0, -1.2);
      caminhoDe(ctx, faixa);
      ctx.stroke();
      ctx.restore();
    }

    this._musgo(ctx, tema, faixas, pureza);
  }

  /**
   * Vegetação nas faces superiores. Determinística por posição (hash2), então
   * não pisca entre frames nem muda ao recarregar a sala.
   */
  _musgo(ctx, tema, faixas, pureza) {
    if (pureza < 0.02) return;
    const densidade = clamp01(pureza);

    for (let f = 0; f < faixas.length; f++) {
      const faixa = faixas[f];
      for (let i = 0; i < faixa.length - 1; i++) {
        const a = faixa[i], b = faixa[i + 1];
        const h = hash2(Math.round(a.x), Math.round(a.y), this.semente + f);
        if (h > densidade * 0.75) continue;

        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        // Normal pra fora (pra cima), pra que a grama cresça perpendicular à
        // superfície e acompanhe a inclinação do terreno.
        const nx = dy / len, ny = -dx / len;
        const alturaTufo = lerp(3, 11, hash2(Math.round(a.y), Math.round(a.x), this.semente)) * densidade;
        const inclina = (h - 0.5) * 0.8;

        ctx.strokeStyle = rgba(tema.crista, lerp(0.3, 0.85, densidade));
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(
          a.x + nx * alturaTufo * 0.6 + inclina * 3,
          a.y + ny * alturaTufo * 0.6,
          a.x + nx * alturaTufo + inclina * 6,
          a.y + ny * alturaTufo
        );
        ctx.stroke();

        // Flor esporádica só em pureza alta — a recompensa visual final.
        if (densidade > 0.65 && h < 0.06) {
          ctx.fillStyle = tema.acento;
          ctx.beginPath();
          ctx.arc(a.x + nx * alturaTufo + inclina * 6, a.y + ny * alturaTufo, 1.7, 0, TAU);
          ctx.fill();
        }
      }
    }
  }

  /** Passe emissivo: só a crista brilha, e só quando a área está viva. */
  desenharLuz(ctx, tema) {
    const pureza = tema.pureza ?? 0;
    if (pureza < 0.12) return;
    ctx.strokeStyle = rgba(tema.crista, (pureza - 0.12) * 0.5);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const faixa of this.terreno.arestasSuperiores(0.5)) {
      caminhoDe(ctx, faixa);
      ctx.stroke();
    }
  }
}
