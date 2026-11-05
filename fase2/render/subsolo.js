/* =========================================================================
   fase2/render/subsolo.js — o fundo das salas DEBAIXO DA TERRA
   -------------------------------------------------------------------------
   O jogo é ao ar livre (ARQUITETURA.md), e o parallax inteiro foi escrito pra
   isso: céu, sol, horizonte em chamas, manadas fugindo. Só que algumas salas
   ficam literalmente embaixo do chão — a gente entra nelas caindo por um
   buraco — e mostravam o mesmo céu com sol atrás das paredes. Pedido do
   autor: sala embaixo da terra tem fundo de embaixo da terra.

   Marca: `subterranea: true` na definição da sala. Sem céu, sem horizonte,
   sem fauna; no lugar, três planos:
     1. ESTRATOS — faixas onduladas de solo, a parede de terra mais distante;
     2. PEDRAS — manchas soltas na terra;
     3. EMARANHADOS — a silhueta de raízes gerada no Canva.
   Havia também raízes desenhadas em código, retas e ramificadas: cruzadas
   umas nas outras, liam como riscos e espetos soltos no fundo. Saíram.
   A luz continua vindo do buraco por onde se entrou (o feixe da sala).

   Restaurar não clareia (regra do jogo): com a pureza, os emaranhados ganham
   pontos de fungo luminoso no acento da área — o subsolo fica VIVO, não
   iluminado.
   ========================================================================= */
import { hash2, misturarHex, rgba, clamp01 } from '../core/mat.js';
import { silhueta, tingir } from './silhuetas.js';

/* SILHUETAS DO CANVA (pedido do autor: "faça alguns elementos do fundo
   usando o criador de imagens do Canva"). Um emaranhado de raízes, gerado
   como silhueta preta e convertido em MÁSCARA por
   `fase2/arte/preparar-subsolo.py`. A máscara é tingida com a cor do plano
   (render/silhuetas.js) — imagem colorida não acompanharia o tema nem a
   restauração. Até a imagem carregar (ou se falhar), o plano só não desenha
   a silhueta.
   Um monte de pedras do Canva também foi testado e saiu (design-reviewer):
   a silhueta lia como ovos e sujava a faixa do chão, onde andam os
   parasitas. As pedras procedurais do plano 2 bastam. */
const raizesDoCanva = () => silhueta('raizes', 'subsolo');

/* Pontos (fração da imagem) onde o fungo pousa no emaranhado de raízes —
   sorteados dentro da silhueta pelo script de preparo. */
const FUNGO_NAS_RAIZES = [[0.084, 0.459], [0.084, 0.634], [0.279, 0.439], [0.361, 0.595], [0.453, 0.264], [0.547, 0.25], [0.551, 0.482], [0.552, 0.309], [0.553, 0.532], [0.69, 0.675], [0.796, 0.327], [0.807, 0.616], [0.819, 0.332], [0.873, 0.566]];

/* As raízes pendem do TETO da sala (y = 0 no plano), não do topo da tela:
   presas à tela elas acompanhavam a câmera na vertical, como um adesivo. */
const TETO = -30;

/** Terra: o fundo do terreno da área puxado pro marrom. */
function corDeTerra(tema, claro = 0) {
  // 0,55 deixava a terra preto-azulada (o `terrenoFundo` de toda área é quase
  // preto) e a sala lia como gruta; 0,8 lê como solo.
  const terra = misturarHex(tema.terrenoFundo, '#24170e', 0.8);
  return claro ? misturarHex(terra, tema.crista, claro) : terra;
}

/** Faixa visível de um plano `p`, em coordenadas do plano. */
function janela(camera, p) {
  const vw = camera.largura / camera.zoom;
  const vh = camera.altura / camera.zoom;
  return { x0: camera.viewX * p - 80, x1: camera.viewX * p + vw + 80,
    y0: camera.viewY * p - 80, y1: camera.viewY * p + vh + 80 };
}

/**
 * Desenha o fundo inteiro de uma sala subterrânea. Substitui, em main.js,
 * céu + horizonte + parallax.
 */
export function desenharSubsolo(render, sala, mundo) {
  const tema = mundo.tema;
  // Movimento reduzido: o balanço das raízes e o pulso do fungo a 1/3.
  const tempo = (mundo.laco?.tempo ?? 0) * (render.movimentoReduzido ? 0.33 : 1);
  const pureza = clamp01(tema.pureza ?? 0);
  const sem = sala.def.semente ?? 7;

  // 0 · o fundo chapado: terra escura, um pouco mais clara embaixo (a luz do
  //     buraco escorre pro chão).
  render.camadaTela((ctx, _t, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    // Miolo mais escuro que as bordas: é onde ficam terreno e criaturas, que
    // precisam de contraste (o terreno de algumas áreas é quase da cor da terra).
    g.addColorStop(0, misturarHex(corDeTerra(tema), '#000000', 0.35));
    g.addColorStop(0.5, misturarHex(corDeTerra(tema), '#000000', 0.55));
    g.addColorStop(1, corDeTerra(tema, 0.08));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });

  // 1 · estratos de solo
  render.camada(0.25, (ctx, t, camera) => {
    const j = janela(camera, 0.25);
    const passo = 64;
    ctx.globalAlpha = 0.8;
    for (let k = Math.floor(j.y0 / passo); k * passo < j.y1; k++) {
      const y = k * passo;
      ctx.fillStyle = corDeTerra(t, 0.12 + hash2(k, sem, 13) * 0.16);
      ctx.beginPath();
      /* A base desce além da onda da faixa seguinte: terminando reta em
         y + passo, sobrava uma fresta escura onde a onda subia, e cada fresta
         lia como um risco horizontal solto no fundo. */
      ctx.moveTo(j.x0, y + passo + 16);
      for (let x = j.x0; x <= j.x1; x += 24) {
        ctx.lineTo(x, y + Math.sin(x * 0.006 + k * 1.7) * 9 + Math.sin(x * 0.017 + k) * 4);
      }
      ctx.lineTo(j.x1, y + passo + 16);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });

  // 2 · pedras na terra
  render.camada(0.5, (ctx, t, camera) => {
    const j = janela(camera, 0.5);
    const cel = 120;
    ctx.fillStyle = corDeTerra(t, 0.26);
    ctx.globalAlpha = 0.6;
    for (let cx = Math.floor(j.x0 / cel); cx * cel < j.x1; cx++) {
      for (let cy = Math.floor(j.y0 / cel); cy * cel < j.y1; cy++) {
        if (hash2(cx, cy, sem + 17) > 0.35) continue;
        const x = (cx + hash2(cx, cy, 19)) * cel, y = (cy + hash2(cx, cy, 23)) * cel;
        const r = 10 + hash2(cx, cy, 29) * 22;
        ctx.beginPath();
        ctx.ellipse(x, y, r * 1.4, r, hash2(cx, cy, 31) - 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  });

  // 3 · silhueta do Canva: emaranhados de raízes pendendo do teto. Escala e
  //     espelho variam por posição (nada se repete igual lado a lado).
  const ESC_RAIZES = 0.62, PASSO_RAIZES = 760;
  const emaranhados = (j, fn) => {
    for (let i = Math.floor(j.x0 / PASSO_RAIZES) - 1; i * PASSO_RAIZES < j.x1; i++) {
      if (hash2(i, sem, 83) < 0.3) continue;
      const esc = ESC_RAIZES * (0.75 + hash2(i, sem, 89) * 0.5);
      fn(i * PASSO_RAIZES + hash2(i, 97) * 200, esc, hash2(i, sem, 101) < 0.5 ? -1 : 1, i);
    }
  };
  if (raizesDoCanva()) {
    render.camada(0.62, (ctx, t, camera) => {
      const img = tingir(raizesDoCanva(), misturarHex(corDeTerra(t), '#000000', 0.4));
      emaranhados(janela(camera, 0.62), (x, esc, lado, i) => {
        ctx.save();
        ctx.translate(x, TETO - 10);
        // Balanço de pêndulo bem leve, a partir do teto.
        ctx.rotate(Math.sin(tempo * 0.35 + i) * 0.012);
        ctx.scale(lado * esc, esc);
        ctx.drawImage(img, -img.width / 2, 0);
        ctx.restore();
      });
    });
    if (pureza > 0.02) {
      render.emissivo(0.62, (ctx, t, camera) => {
        const img = raizesDoCanva();
        ctx.fillStyle = rgba(t.acento, 1);
        emaranhados(janela(camera, 0.62), (x, esc, lado, i) => {
          ctx.save();
          ctx.translate(x, TETO - 10);
          ctx.rotate(Math.sin(tempo * 0.35 + i) * 0.012);
          ctx.scale(lado * esc, esc);
          const n = Math.round(pureza * FUNGO_NAS_RAIZES.length);
          for (let k = 0; k < n; k++) {
            const [fx, fy] = FUNGO_NAS_RAIZES[k];
            const px = (fx - 0.5) * img.naturalWidth, py = fy * img.naturalHeight;
            const pulso = 0.65 + 0.35 * Math.sin(tempo * 1.3 + i + k);
            // Raios em px da máscara (a escala do plano reduz).
            ctx.globalAlpha = 0.15 * pureza * pulso;
            ctx.beginPath(); ctx.arc(px, py, 18, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 0.95 * pureza * pulso;
            ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
          }
          ctx.restore();
        });
        ctx.globalAlpha = 1;
      });
    }
  }
}
