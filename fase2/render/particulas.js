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

import { TAU, clamp01, lerp, rgba, hash2, ruido1, misturarHex } from '../core/mat.js';
import { confCatastrofe, forcaFogo, chamaDe } from './catastrofe.js';

const CELULA = 220;   // grade de amostragem da atmosfera, em px de mundo

/* Movimento reduzido: fuligem, cinza e brasas continuam existindo (são a
   leitura de sujo/limpo e de fogo), mas a um terço da velocidade — o mesmo
   contrato do fogo e das manadas do fundo. */
function tempoDe(mundo) {
  const t = mundo.laco?.tempo ?? performance.now() / 1000;
  return mundo.render?.movimentoReduzido ? t * 0.33 : t;
}

export function desenharParticulas(render, mundo) {
  const tema = mundo.tema;

  // --- atmosfera (atrás das de evento) ---
  render.camada(0.9, (ctx, t, camera) => atmosfera(ctx, t, camera, mundo, 0.9));
  render.emissivo(0.9, (ctx, t, camera) => {
    if (t.pureza < 0.25) return;
    atmosfera(ctx, t, camera, mundo, 0.9, true);
  });

  // --- brasas: sobem do chão nas áreas que queimam ---
  render.camada(0.95, (ctx, t, camera) => brasas(ctx, t, camera, mundo, false));
  render.emissivo(0.95, (ctx, t, camera) => brasas(ctx, t, camera, mundo, true));

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
  const t = tempoDe(mundo);
  const pureza = tema.pureza ?? 0;

  // Quantidade por célula: área suja tem MAIS partículas (fuligem), mas elas
  // são opacas e sem brilho. Área limpa tem menos, porém luminosas.
  const conf = confCatastrofe(mundo.sala?.area);
  const cinza = conf.cinza * clamp01(1 - pureza * 1.5);
  const porCelula = Math.round(lerp(5, 3, pureza) + cinza * 2);
  /* Cinza clara sobre paleta fria lia como NEVE — noite de inverno, não
     queimada. A cinza agora é morna, e metade dos flocos é carvão escuro:
     é a mistura de claro e escuro caindo junto que diz "algo queimou". */
  const corCinza = misturarHex(tema.particula, '#a8988a', 0.5);
  const corCarvao = misturarHex(tema.primeiroPlano, '#3a2e26', 0.6);
  const lotesCinza = [new Path2D(), new Path2D(), new Path2D()];
  const lotesCarvao = new Path2D();
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

        /* CINZA. Na área suja, parte da fuligem vira floco de cinza: maior,
           mais clara, e girando enquanto cai. Um ponto que cai lê como poeira;
           um floco que CAPOTA lê como algo que queimou — e é essa leitura que
           diz, sem uma palavra, que há fogo em algum lugar desta mata. */
        // Sorteio com hash PRÓPRIO: `h1` também dá a posição x na célula, e
        // usá-lo aqui fazia toda cinza cair no lado direito de cada célula —
        // uma cortina de colunas com período fixo.
        if (!brilha && cinza > 0.02 && hash2(cx * 29 + i, cy * 83, 677) < cinza * 0.55) {
          const giro = t * lerp(1.2, 3.2, h2) + h3 * TAU;
          const rx = lerp(1.6, 3.4, h2), ry = rx * (0.25 + 0.75 * Math.abs(Math.cos(giro)));
          const al = lerp(0.25, 0.6, h3) * (0.6 + 0.4 * Math.abs(Math.sin(giro)));
          const fx = x + Math.sin(t * 0.9 + h1 * 9) * 8, rot = giro * 0.5;
          // Três degraus de alfa, um caminho cada — ver `brasas`. Metade vai
          // pro lote de carvão.
          const p = h2 > 0.5 ? lotesCarvao : lotesCinza[al < 0.3 ? 0 : al < 0.45 ? 1 : 2];
          p.moveTo(fx + Math.cos(rot) * rx, y + Math.sin(rot) * rx);
          p.ellipse(fx, y, rx, ry, rot, 0, TAU);
          continue;
        }

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
  if (cinza > 0.02 && !soBrilhantes) {
    ctx.fillStyle = corCinza;
    const alfas = [0.28, 0.42, 0.56];
    for (let i = 0; i < 3; i++) { ctx.globalAlpha = alfas[i]; ctx.fill(lotesCinza[i]); }
    ctx.fillStyle = corCarvao;
    ctx.globalAlpha = 0.55;
    ctx.fill(lotesCarvao);
  }
  ctx.globalAlpha = 1;
}

/**
 * Brasas subindo. Nascem embaixo, sobem em zigue-zague empurradas pelo calor,
 * piscam e APAGAM antes de chegar lá em cima — brasa que atravessa a tela
 * inteira vira fagulha de fogos de artifício.
 *
 * Mesmo esquema da atmosfera: função da célula e do tempo, sem lista. Na cena
 * a brasa é um ponto de cor plana (tem que existir mesmo onde o bloom é
 * fraco — Raízes suja tem brilhoBloom 0,34); no emissivo ela ganha o halo.
 */
function brasas(ctx, tema, camera, mundo, luz) {
  const area = mundo.sala?.area;
  const conf = confCatastrofe(area);
  const fogo = forcaFogo(area, tema.pureza ?? 0);
  const k = conf.brasas * (conf.fogo > 0 ? fogo / conf.fogo : 0);
  if (k < 0.03) return;
  const ch = chamaDe(area);
  const a = camera.areaVisivel(CELULA);
  const t = tempoDe(mundo);
  const porCelula = Math.round(1 + k * 5);
  const cx0 = Math.floor(a.x / CELULA), cx1 = Math.ceil((a.x + a.largura) / CELULA);
  const cy0 = Math.floor(a.y / CELULA), cy1 = Math.ceil((a.y + a.altura) / CELULA);
  const periodo = CELULA * 1.6;
  /* EM LOTE. Uma chamada de `fill` por brasa custava ~480 chamadas por
     quadro na clareira (cena + emissivo). Aqui cada brasa cai num de quatro
     degraus de alfa, por cor, e cada degrau é UM caminho: oito `fill` no
     total, e ninguém distingue quatro degraus de alfa numa fagulha piscando. */
  const DEGRAUS = 4;
  const lotes = [];
  for (let i = 0; i < DEGRAUS * 2; i++) lotes.push(new Path2D());
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let i = 0; i < porCelula; i++) {
        const h1 = hash2(cx * 41 + i, cy * 13, 503);
        const h2 = hash2(cx * 7, cy * 71 + i, 509);
        const h3 = hash2(cx + i * 3, cy + i, 521);
        const vel = lerp(22, 60, h3);
        const sobe = ((t * vel + h1 * periodo) % periodo);
        const vida = sobe / periodo;                   // 0 nasce, 1 apaga
        const x = cx * CELULA + h1 * CELULA
          + Math.sin(t * lerp(1.5, 3.2, h2) + h3 * TAU) * lerp(6, 18, h2)
          + vida * lerp(-30, 30, h2);
        const y = cy * CELULA + CELULA - sobe;
        const pisca = 0.55 + 0.45 * Math.sin(t * lerp(9, 17, h1) + h2 * TAU);
        const alfa = (1 - vida) * (1 - vida) * pisca;
        if (alfa * k < 0.02) continue;
        const d = Math.min(DEGRAUS - 1, (alfa * DEGRAUS) | 0);
        // Uma em cada quatro é mais quente (núcleo claro): brasa toda da
        // mesma cor lê como confete.
        const quente = !luz && h2 > 0.75 ? 1 : 0;
        const r = (luz ? 3.6 : 1.5) * lerp(0.7, 1.3, h3);
        const p = lotes[d + quente * DEGRAUS];
        p.moveTo(x + r, y);
        p.arc(x, y, r, 0, TAU);
      }
    }
  }
  for (let d = 0; d < DEGRAUS; d++) {
    const al = k * (d + 0.5) / DEGRAUS;
    ctx.globalAlpha = luz ? al * 0.8 : al;
    ctx.fillStyle = luz ? ch.meio : ch.brasa;
    ctx.fill(lotes[d]);
    if (!luz) { ctx.fillStyle = ch.nucleo; ctx.fill(lotes[d + DEGRAUS]); }
  }
  ctx.globalAlpha = 1;
}

/**
 * Topo do primeiro tile pisável abaixo do alto da área visível, na coluna `x`.
 * Varre de cima pra baixo em passos de um tile; se a coluna for um poço sem
 * fundo à vista, devolve a base da área visível.
 */
function alturaDoChao(terreno, x, a) {
  const base = a.y + a.altura;
  if (!terreno) return base;
  const cx = Math.floor(x / terreno.tile);
  // `solido()` trata fora-do-mapa como sólido; aqui isso devolveria o topo da
  // tela como se fosse chão. Coluna fora da sala não tem chão, e ponto.
  if (cx < 0 || cx >= terreno.largura) return base;
  const cy0 = Math.max(0, Math.floor(a.y / terreno.tile));
  const cy1 = Math.min(terreno.altura - 1, Math.ceil(base / terreno.tile));
  for (let cy = cy0; cy <= cy1; cy++) {
    if (terreno.solido(cx, cy)) return cy * terreno.tile;
  }
  return base;
}

/**
 * Neblina rasteira — bancos de névoa que se movem devagar junto ao chão.
 * Barato: são só elipses borradas. Chamar entre o terreno e as entidades pra
 * a névoa passar NA FRENTE do chão e ATRÁS do jogador.
 */
export function desenharNevoa(render, mundo, parallax = 0.85) {
  const tema = mundo.tema;
  if (tema.densidadeBruma < 0.05) return;
  const terreno = mundo.sala?.terreno;

  render.camada(parallax, (ctx, t, camera) => {
    const a = camera.areaVisivel(300);
    const tempo = mundo.laco?.tempo ?? 0;
    const passo = 340;
    const x0 = Math.floor(a.x / passo) * passo;

    ctx.globalCompositeOperation = 'screen';
    for (let x = x0; x < a.x + a.largura; x += passo) {
      const n = ruido1(x * 0.004, 17);
      const deriva = (tempo * lerp(5, 14, n)) % (passo * 3);
      const cxm = x + deriva;
      // Névoa RASTEIRA se apoia no CHÃO, não na tela. Ancorada na área
      // visível (que era o que estava aqui), ela ficava sempre na mesma
      // altura do quadro: subindo numa sala alta, os bancos subiam junto e
      // ficavam pairando no ar sobre o vazio. O chão é medido na posição em
      // que o banco vai ser DESENHADO, não na de origem — senão a deriva o
      // arrasta pra longe do chão que o ancorou.
      const y = alturaDoChao(terreno, cxm, a) - lerp(6, 34, n)
        + Math.sin(tempo * 0.22 + n * TAU) * 14;
      const w = lerp(260, 520, n);
      const h = lerp(40, 90, ruido1(x * 0.009 + 5, 17));

      const g = ctx.createRadialGradient(cxm, y, 0, cxm, y, w);
      g.addColorStop(0, rgba(t.bruma, 0.2 * t.densidadeBruma));
      g.addColorStop(1, rgba(t.bruma, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cxm, y, w, h, 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  });
}
