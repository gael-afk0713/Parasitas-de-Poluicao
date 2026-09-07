/* =========================================================================
   fase2/render/parallax.js — camadas de fundo
   -------------------------------------------------------------------------
   Três planos + luz volumétrica. A profundidade NÃO vem só do fator de
   parallax: vem da combinação de (a) velocidade diferente, (b) cor comida
   pela bruma, (c) contraste caindo e (d) detalhe sumindo. Só (a) é o erro
   clássico — dá camadas nítidas deslizando, que o olho lê como adesivos.

   Tudo é gerado por função determinística da posição (sem estado, sem cache
   de textura): a mesma coluna do mundo desenha sempre a mesma silhueta,
   então nada "nada" ou pisca quando a câmera se move.
   ========================================================================= */

import { TAU, lerp, clamp01, rgba, ruido1, fbm2, misturarHex } from '../core/mat.js';
import { corPorProfundidade } from './paleta.js';
import { feixeLuz } from './renderizador.js';

/** Perfil de silhueta de uma camada, em coordenadas de mundo. */
function perfil(x, semente, escala, amplitude, base) {
  return base
    - ruido1(x * escala, semente) * amplitude
    - ruido1(x * escala * 2.7 + 40, semente + 5) * amplitude * 0.32;
}

function camadaSilhueta(ctx, camera, { parallax, semente, escala, amplitude, baseRel, cor, corBase }) {
  const vw = camera.largura / camera.zoom;
  const x0 = camera.viewX * parallax - 120;
  const x1 = x0 + vw + 240;
  const yBase = camera.viewY * parallax + camera.altura / camera.zoom * baseRel;
  const passo = 14;

  ctx.beginPath();
  ctx.moveTo(x0, yBase + 1400);
  for (let x = x0; x <= x1; x += passo) {
    ctx.lineTo(x, perfil(x, semente, escala, amplitude, yBase));
  }
  ctx.lineTo(x1, yBase + 1400);
  ctx.closePath();

  const g = ctx.createLinearGradient(0, yBase - amplitude, 0, yBase + 260);
  g.addColorStop(0, cor);
  g.addColorStop(1, corBase);
  ctx.fillStyle = g;
  ctx.fill();
}

/**
 * Raízes/troncos verticais pendurados — a assinatura visual das áreas
 * subterrâneas. Espaçamento irregular por ruído, senão viram grades.
 */
function raizesPendentes(ctx, camera, { parallax, semente, cor, densidade = 1 }) {
  const vw = camera.largura / camera.zoom;
  const x0 = Math.floor((camera.viewX * parallax - 200) / 160) * 160;
  const x1 = camera.viewX * parallax + vw + 200;
  const yTopo = camera.viewY * parallax - 60;

  ctx.strokeStyle = cor;
  ctx.lineCap = 'round';
  for (let x = x0; x <= x1; x += 160) {
    const n = ruido1(x * 0.013, semente);
    if (n > densidade * 0.85) continue;
    const px = x + (ruido1(x * 0.05 + 3, semente) - 0.5) * 130;
    const comprimento = lerp(140, 460, ruido1(x * 0.021 + 9, semente));
    const largura = lerp(3, 14, n);
    ctx.lineWidth = largura;
    ctx.beginPath();
    ctx.moveTo(px, yTopo);
    // Curva em S: raiz reta é poste, raiz curva é raiz.
    ctx.bezierCurveTo(
      px + (n - 0.5) * 70, yTopo + comprimento * 0.38,
      px - (n - 0.5) * 90, yTopo + comprimento * 0.7,
      px + (n - 0.5) * 40, yTopo + comprimento
    );
    ctx.stroke();
  }
}

/* ------------------------------------------------------------------------- */

export function desenharParallax(render, sala, mundo) {
  const tema = mundo.tema;

  // --- distante (0.12) ---
  render.camada(0.12, (ctx, t, camera) => {
    camadaSilhueta(ctx, camera, {
      parallax: 0.12, semente: 11, escala: 0.0019, amplitude: 220, baseRel: 0.82,
      cor: corPorProfundidade(t, t.distante, 0.95),
      corBase: corPorProfundidade(t, t.distante, 1),
    });
  });
  render.velarProfundidade(0.34);

  // --- médio (0.32) ---
  render.camada(0.32, (ctx, t, camera) => {
    camadaSilhueta(ctx, camera, {
      parallax: 0.32, semente: 27, escala: 0.0031, amplitude: 170, baseRel: 0.9,
      cor: corPorProfundidade(t, t.medio, 0.62),
      corBase: corPorProfundidade(t, t.medio, 0.85),
    });
    raizesPendentes(ctx, camera, {
      parallax: 0.32, semente: 33, densidade: 0.7,
      cor: rgba(corPorProfundidade(t, t.medio, 0.55), 0.8),
    });
  });
  render.velarProfundidade(0.2);

  // --- luz volumétrica, ATRÁS do plano próximo ---
  if (sala.luzes?.length) {
    render.emissivo(0.5, (ctx, t) => {
      for (const l of sala.luzes) {
        if (!l.feixe) continue;
        feixeLuz(ctx, l.x, l.y, sala.altura * 1.1, 160, l.angulo ?? 0.2, t.luz,
          (l.intensidade ?? 1) * 0.45);
      }
    });
  }

  // --- próximo (0.62) ---
  render.camada(0.62, (ctx, t, camera) => {
    camadaSilhueta(ctx, camera, {
      parallax: 0.62, semente: 51, escala: 0.0046, amplitude: 130, baseRel: 1.02,
      cor: corPorProfundidade(t, t.proximo, 0.24),
      corBase: corPorProfundidade(t, t.proximo, 0.5),
    });
    raizesPendentes(ctx, camera, {
      parallax: 0.62, semente: 61, densidade: 0.45,
      cor: rgba(corPorProfundidade(t, t.proximo, 0.2), 0.9),
    });
  });
  render.velarProfundidade(0.1);
}

/**
 * Primeiro plano: silhuetas quase pretas passando MAIS RÁPIDO que o jogador.
 * Chamado depois das entidades. É a camada que dá sensação de "estar dentro"
 * da cena em vez de olhar pra ela — mas cobre o jogador, então precisa ser
 * esparsa e nunca ficar no meio da tela por muito tempo.
 */
export function desenharPrimeiroPlano(render, mundo) {
  render.camada(1.34, (ctx, t, camera) => {
    const vw = camera.largura / camera.zoom;
    const x0 = Math.floor((camera.viewX * 1.34 - 300) / 340) * 340;
    const x1 = camera.viewX * 1.34 + vw + 300;
    const yBase = camera.viewY * 1.34 + camera.altura / camera.zoom;

    ctx.fillStyle = t.primeiroPlano;
    for (let x = x0; x <= x1; x += 340) {
      const n = ruido1(x * 0.007, 77);
      if (n > 0.62) continue;
      const px = x + (n - 0.5) * 250;
      const h = lerp(120, 330, n);
      const w = lerp(40, 130, ruido1(x * 0.02 + 4, 77));
      ctx.beginPath();
      ctx.moveTo(px - w, yBase + 40);
      ctx.bezierCurveTo(px - w * 0.7, yBase - h * 0.4, px - w * 0.3, yBase - h * 0.8, px, yBase - h);
      ctx.bezierCurveTo(px + w * 0.4, yBase - h * 0.75, px + w * 0.8, yBase - h * 0.3, px + w, yBase + 40);
      ctx.closePath();
      ctx.fill();
    }
  });
}
