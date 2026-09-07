/* =========================================================================
   fase2/render/particulas.js — partículas de evento + atmosfera ambiente
   -------------------------------------------------------------------------
   Duas coisas diferentes moram aqui:

   1. PARTÍCULAS DE EVENTO — vivem em `mundo.particulas`, nascem de um golpe,
      de uma aterrissagem, de uma morte. Têm vida curta e física simples.

   2. ATMOSFERA AMBIENTE — não é uma lista de objetos. É uma FUNÇÃO da
      posição e do tempo, avaliada só nas células visíveis. Assim uma sala
      pode ter "mil" motas em suspensão sem alocar mil objetos nem custar
      nada quando a câmera está longe. Área suja solta fuligem que CAI; área
      restaurada solta esporos que SOBEM — a direção sozinha já conta ao
      jogador se aquele lugar está vivo ou morto.
   ========================================================================= */

import { TAU, clamp01, lerp, rgba, hash2, ruido1 } from '../core/mat.js';

const CELULA = 220;   // grade de amostragem da atmosfera, em px de mundo

export function desenharParticulas(render, mundo) {
  const tema = mundo.tema;

  // --- atmosfera (atrás das de evento) ---
  render.camada(0.9, (ctx, t, camera) => atmosfera(ctx, t, camera, mundo, 0.9));
  render.emissivo(0.9, (ctx, t, camera) => {
    if (t.pureza < 0.25) return;
    atmosfera(ctx, t, camera, mundo, 0.9, true);
  });

  // --- de evento ---
  render.camada(1, (ctx, t) => {
    for (const p of mundo.particulas) {
      const k = 1 - p.t / p.vida;
      ctx.globalAlpha = clamp01(k) * 0.92;
      ctx.fillStyle = p.cor || t.particula;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.raio * (0.35 + k * 0.65), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });

  render.emissivo(1, (ctx, t) => {
    for (const p of mundo.particulas) {
      if (!p.brilha) continue;
      const k = 1 - p.t / p.vida;
      ctx.globalAlpha = clamp01(k) * 0.8;
      ctx.fillStyle = p.cor || t.acento;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.raio * 2.2 * k, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}

/**
 * Motas em suspensão, avaliadas por célula visível.
 * @param {boolean} soBrilhantes  passe emissivo: desenha só as que emitem
 */
function atmosfera(ctx, tema, camera, mundo, parallax, soBrilhantes = false) {
  const a = camera.areaVisivel(CELULA);
  const t = mundo.laco?.tempo ?? performance.now() / 1000;
  const pureza = tema.pureza ?? 0;

  // Quantidade por célula: área suja tem MAIS partículas (fuligem), mas elas
  // são opacas e sem brilho. Área limpa tem menos, porém luminosas.
  const porCelula = Math.round(lerp(5, 3, pureza));
  const cx0 = Math.floor(a.x / CELULA), cx1 = Math.ceil((a.x + a.largura) / CELULA);
  const cy0 = Math.floor(a.y / CELULA), cy1 = Math.ceil((a.y + a.altura) / CELULA);

  ctx.fillStyle = tema.particula;

  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let i = 0; i < porCelula; i++) {
        const h1 = hash2(cx * 73 + i, cy * 31, 991);
        const h2 = hash2(cx * 17, cy * 59 + i, 337);
        const h3 = hash2(cx + i, cy - i, 55);

        const bx = cx * CELULA + h1 * CELULA;
        const by = cy * CELULA + h2 * CELULA;

        // Deriva vertical: suja cai, limpa sobe. Velocidade por partícula.
        const dir = lerp(1, -1, pureza);
        const vel = lerp(7, 26, h3);
        const periodo = CELULA * 2;
        const desloc = ((t * vel * dir) % periodo + periodo) % periodo;

        const x = bx + Math.sin(t * lerp(0.25, 0.7, h1) + h2 * TAU) * lerp(6, 22, h2);
        const y = by + (dir > 0 ? desloc : -desloc);

        const brilha = pureza > 0.3 && h3 > 0.62;
        if (soBrilhantes !== brilha) continue;

        // Piscar lento e dessincronizado — partícula com alfa fixo parece
        // sujeira na lente; piscando parece matéria viva em suspensão.
        const cintila = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * lerp(0.8, 2.4, h1) + h3 * TAU));
        const alfa = lerp(0.1, 0.42, h3) * cintila * lerp(0.7, 1.2, pureza);
        const raio = lerp(0.8, 2.6, h2) * (brilha ? 1.5 : 1);

        ctx.globalAlpha = alfa;
        ctx.fillStyle = brilha ? tema.acento : tema.particula;
        ctx.beginPath();
        ctx.arc(x, y, raio, 0, TAU);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * Neblina rasteira — bancos de névoa que se movem devagar junto ao chão.
 * Barato: são só elipses borradas. Chamar entre o terreno e as entidades pra
 * a névoa passar NA FRENTE do chão e ATRÁS do jogador.
 */
export function desenharNevoa(render, mundo, parallax = 0.85) {
  const tema = mundo.tema;
  if (tema.densidadeBruma < 0.05) return;

  render.camada(parallax, (ctx, t, camera) => {
    const a = camera.areaVisivel(300);
    const tempo = mundo.laco?.tempo ?? 0;
    const passo = 340;
    const x0 = Math.floor(a.x / passo) * passo;

    ctx.globalCompositeOperation = 'screen';
    for (let x = x0; x < a.x + a.largura; x += passo) {
      const n = ruido1(x * 0.004, 17);
      const y = a.y + a.altura * lerp(0.62, 0.95, n) + Math.sin(tempo * 0.22 + n * TAU) * 26;
      const w = lerp(260, 520, n);
      const h = lerp(40, 90, ruido1(x * 0.009 + 5, 17));
      const deriva = (tempo * lerp(5, 14, n)) % (passo * 3);

      const g = ctx.createRadialGradient(x + deriva, y, 0, x + deriva, y, w);
      g.addColorStop(0, rgba(t.bruma, 0.2 * t.densidadeBruma));
      g.addColorStop(1, rgba(t.bruma, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x + deriva, y, w, h, 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  });
}
