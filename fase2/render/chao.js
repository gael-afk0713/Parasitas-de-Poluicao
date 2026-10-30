/* =========================================================================
   fase2/render/chao.js — o que está CAÍDO no chão: lixo e folhas
   -------------------------------------------------------------------------
   As arestas pisáveis eram rocha limpa com musgo: nada apoiado nelas dizia
   que aquilo é um chão onde alguém jogou coisa fora, nem uma floresta que
   perde folha. Peças pequenas (10-24 px) tiradas de dois atlas de silhuetas
   gerados no Canva (`fase2/arte/preparar-chao.py`):

     · LIXO   — lata, garrafa, sacola, pneu, galão... Some com a pureza: é a
                poluição que o Guardião limpa, então a sala restaurada não
                pode guardar nem um pneu.
     · FOLHAS — secas e escuras na sala suja; na restaurada pegam o verde do
                acento da área. Nunca somem: floresta sempre perde folha.

   Como o resto da arte por IA, cada peça é MÁSCARA tingida com a cor do
   tema (`tingir`), que muda com a pureza. Nada aqui anima.
   ========================================================================= */

import { clamp01, lerp, hash2, misturarHex } from '../core/mat.js';
import { silhueta, tingir } from './silhuetas.js';
import { pertoDePerigo } from '../mundo/perigo.js';

// Retângulos [x, y, l, a] de cada peça no atlas (saída do preparar-chao.py).
const PECAS = {
  lixo: [[0, 28, 64, 36], [66, 37, 64, 27], [132, 19, 64, 45], [198, 27, 64, 37],
    [264, 24, 64, 40], [330, 17, 64, 47], [396, 0, 61, 64], [459, 36, 64, 28],
    [525, 0, 61, 64], [588, 29, 64, 35], [654, 33, 64, 31], [720, 35, 64, 29]],
  folhas: [[0, 19, 64, 45], [66, 20, 64, 44], [132, 8, 64, 56], [198, 18, 64, 46],
    [264, 27, 64, 37], [330, 28, 64, 36], [396, 24, 64, 40], [462, 20, 64, 44],
    [528, 29, 64, 35], [594, 9, 64, 55], [660, 15, 64, 49], [726, 14, 64, 50],
    [792, 0, 46, 64], [840, 0, 47, 64], [889, 21, 64, 43], [955, 16, 64, 48]],
};

/**
 * Âncoras ao longo das arestas pisáveis, uma vez por sala. Em MONTE, com
 * vãos pelados entre eles — o mesmo cuidado das samambaias: peça a passo
 * fixo vira franja e denuncia geração.
 */
export function ancorasDoChao(arestas, terreno = null) {
  const pts = [];
  for (const faixa of arestas) {
    let percorrido = 0;
    let proxima = 20 + hash2(Math.round(faixa[0].x), Math.round(faixa[0].y), 601) * 80;
    for (let i = 0; i < faixa.length - 1; i++) {
      const a = faixa[i], b = faixa[i + 1];
      const seg = Math.hypot(b.x - a.x, b.y - a.y) || 0.001;
      while (percorrido + seg > proxima) {
        const u = (proxima - percorrido) / seg;
        const x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u;
        const passo = 14 + hash2(Math.round(x), Math.round(y), 607) * 46;
        proxima += passo;
        if (hash2(Math.round(x / 130), Math.round(y / 80), 611) > 0.55) continue;
        // Uma pinha entre os espinhos (captura) confundia a leitura do perigo.
        if (terreno && pertoDePerigo(terreno, x, y)) continue;
        const h = hash2(Math.round(x), Math.round(y), 613);
        pts.push({
          x, y,
          // Inclinação da aresta: a peça deita no chão, não fica em pé torta.
          // Normalizada pra (-90°, 90°): metade dos contornos corre da
          // direita pra esquerda, e com ângulo ~180° a peça ia de CABEÇA PRA
          // BAIXO, enterrada no chão em vez de deitada nele.
          ang: Math.atan(((b.y - a.y) / ((b.x - a.x) || 0.001))),
          lixo: h < 0.42,
          // Ordem de sumir: o lixo de h baixo é o último a ser limpo.
          h,
          i: Math.floor(hash2(Math.round(x), Math.round(y), 617) * 997),
          esp: hash2(Math.round(x), Math.round(y), 619) < 0.5 ? -1 : 1,
        });
      }
      percorrido += seg;
    }
  }
  return pts;
}

export function desenharChao(ctx, tema, pts, pureza) {
  if (!pts.length) return;
  const atlasLixo = silhueta('lixo', 'chao');
  const atlasFolhas = silhueta('folhas', 'chao');
  /* Escuro sobre rocha escura sumia (primeira captura): as peças são mais
     CLARAS que o chão, puxadas pra crista — é a luz batendo no que está
     caído. A folha esverdeia com a pureza. */
  const corLixo = misturarHex(tema.terreno, tema.crista, 0.5);
  const corFolha = misturarHex(misturarHex(tema.terreno, tema.crista, 0.5),
    tema.acento, lerp(0, 0.6, pureza));
  const tLixo = atlasLixo ? tingir(atlasLixo, corLixo) : null;
  const tFolha = atlasFolhas ? tingir(atlasFolhas, corFolha) : null;

  for (const p of pts) {
    let img, r, larg, alfa = 1;
    if (p.lixo) {
      if (!tLixo) continue;
      // Some do mais "novo" pro mais "antigo" entre 10% e 65% de pureza.
      alfa = clamp01(1 - (pureza - 0.1 - p.h * 0.6) / 0.25);
      if (alfa <= 0.02) continue;
      img = tLixo; r = PECAS.lixo[p.i % PECAS.lixo.length];
      larg = lerp(16, 28, (p.i % 7) / 6);
    } else {
      if (!tFolha) continue;
      img = tFolha; r = PECAS.folhas[p.i % PECAS.folhas.length];
      larg = lerp(10, 18, (p.i % 5) / 4);
    }
    const k = larg / Math.max(r[2], r[3]);
    const w = r[2] * k, hh = r[3] * k;
    ctx.save();
    ctx.globalAlpha = alfa;
    // 1,5 px enterrado: apoiado, não pousado por cima.
    ctx.translate(p.x, p.y + 1.5);
    ctx.rotate(p.ang + (p.lixo ? 0 : (p.h - 0.5) * 0.5));
    ctx.scale(p.esp, 1);
    ctx.drawImage(img, r[0], r[1], r[2], r[3], -w / 2, -hh, w, hh);
    ctx.restore();
  }
}
