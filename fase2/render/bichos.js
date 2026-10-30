/* =========================================================================
   fase2/render/bichos.js — os bichos PARADOS no espaço de jogo
   -------------------------------------------------------------------------
   As aves de `fauna.js` levantam voo; o veado, a capivara e o tamanduá são
   os feridos e os que fogem. Faltava o bicho que simplesmente MORA ali — e
   é ele que diz se o lugar está vivo:

     · sala suja   URUBUS pousados nas bordas, esperando. Somem com a pureza.
     · restaurada  a fauna que volta: tucano, arara, macaco, tatu, sapo,
                   coruja... no chão; e preguiça, macaco-aranha, morcego e
                   cobra PENDURADOS da borda de baixo do terreno.

   Silhuetas do Canva (`fase2/arte/preparar-bichos.py`), tingidas num tom
   MÉDIO do terreno — de propósito longe do preto: preto com olho branco é
   parasita, e bicho de cenário não pode ser confundido com inimigo.
   Nada colide nem bloqueia. Recuam (somem) quando o Guardião chega perto,
   que é o que bicho de verdade faz.

   Animação: respiração (escala vertical ~2%) e balanço dos pendurados. Com
   movimento reduzido, ambos a 1/3 (índice no fim do fase2.css).
   ========================================================================= */

import { clamp01, lerp, hash2, misturarHex } from '../core/mat.js';
import { VAZIO, SOLIDO } from '../mundo/terreno.js';
import { silhueta, tingir } from './silhuetas.js';
import { pertoDePerigo } from '../mundo/perigo.js';

// [x, y, l, a] no atlas, e a altura do bicho no jogo (px).
const CHAO = [
  { r: [0, 0, 91, 96], alt: 26 },      // tucano
  { r: [93, 0, 59, 96], alt: 30 },     // arara
  { r: [154, 26, 96, 70], alt: 22 },   // macaco-prego
  { r: [252, 55, 96, 41], alt: 13 },   // tatu
  { r: [350, 38, 96, 58], alt: 17 },   // quati
  // [448, 0, 43, 96] é a cauda do quati, solta no recorte: fica de fora.
  { r: [493, 17, 96, 79], alt: 11 },   // sapo
  { r: [591, 1, 96, 95], alt: 17 },    // beija-flor
  { r: [689, 0, 55, 96], alt: 24 },    // coruja
  { r: [746, 44, 96, 52], alt: 14 },   // jabuti
  { r: [844, 30, 96, 66], alt: 15 },   // cutia
];
const URUBUS = [[0, 4, 96, 92], [98, 38, 96, 58], [196, 33, 96, 63], [294, 40, 96, 56],
  [392, 6, 96, 90], [490, 44, 96, 52], [588, 0, 82, 96], [672, 4, 96, 92], [770, 53, 96, 43]]
  .map((r) => ({ r, alt: lerp(22, 30, r[3] / 96) }));
/* Bem abaixo do Guardião (~55 px): pendurado no ar é a pose do parasita
   que desce do teto, e bicho do tamanho do herói ali competia com ele. */
const PENDURADOS = [
  { r: [0, 0, 96, 79], alt: 24 },      // preguiça
  { r: [98, 0, 55, 96], alt: 28 },     // macaco-aranha
  { r: [155, 0, 44, 96], alt: 20 },    // morcego
  { r: [201, 0, 67, 96], alt: 26 },    // cobra
  { r: [270, 0, 49, 96], alt: 26 },    // bugio
];

/* Quantos de cada, no máximo, por sala. Pouco de propósito: bicho em toda
   aresta vira zoológico e polui a leitura do nível. */
const MAX_CHAO = 5, MAX_URUBU = 4, MAX_PEND = 3;
// Na primeira captura os bichos liam miúdos demais ao lado do Guardião.
const ESCALA = 1.25;

export class Bichos {
  constructor(terreno, semente = 7) {
    this.chao = [];
    this.pend = [];
    const t = terreno.tile;
    // --- no chão: arestas pisáveis com AR em cima (nada de nascer na água)
    const cand = [];
    for (const faixa of terreno.arestasSuperiores(0.92)) {
      let perc = 0, prox = 60;
      for (let i = 0; i < faixa.length - 1; i++) {
        const a = faixa[i], b = faixa[i + 1];
        const comp = Math.hypot(b.x - a.x, b.y - a.y);
        while (prox <= perc + comp) {
          const u = (prox - perc) / (comp || 1);
          const x = lerp(a.x, b.x, u), y = lerp(a.y, b.y, u);
          prox += 170;
          const cx = Math.floor(x / t);
          if (terreno.em(cx, Math.floor((y - t * 0.5) / t)) !== VAZIO) continue;
          if (terreno.em(cx, Math.floor((y - t * 1.5) / t)) !== VAZIO) continue;
          if (pertoDePerigo(terreno, x, y)) continue;
          cand.push({ x, y, h: hash2(Math.round(x), Math.round(y), semente + 701) });
        }
        perc += comp;
      }
    }
    cand.sort((p, q) => p.h - q.h);
    // Os primeiros viram urubu (sala suja), os seguintes, fauna da restaurada:
    // lugares DIFERENTES — o urubu não vira tucano no mesmo galho.
    cand.slice(0, MAX_URUBU).forEach((c, k) => this.chao.push({
      ...c, urubu: true, tipo: URUBUS[Math.floor(hash2(k, semente, 709) * URUBUS.length)],
      esp: hash2(k, semente, 719) < 0.5 ? -1 : 1, ordem: k / MAX_URUBU,
    }));
    cand.slice(MAX_URUBU, MAX_URUBU + MAX_CHAO).forEach((c, k) => this.chao.push({
      ...c, urubu: false, tipo: CHAO[Math.floor(hash2(k, semente, 727) * CHAO.length)],
      esp: hash2(k, semente, 733) < 0.5 ? -1 : 1, ordem: k / MAX_CHAO,
    }));

    // --- pendurados: tile sólido com ao menos 3 tiles de ar embaixo
    const tetos = [];
    for (let cy = 1; cy < terreno.altura - 4; cy++) {
      for (let cx = 1; cx < terreno.largura - 1; cx++) {
        // SÓLIDO de verdade: preguiça pendurada em espinho de teto ou em
        // plataforma fina (atravessável) não faz sentido.
        if (terreno.em(cx, cy) !== SOLIDO) continue;
        if (terreno.em(cx, cy + 1) !== VAZIO || terreno.em(cx, cy + 2) !== VAZIO
          || terreno.em(cx, cy + 3) !== VAZIO) continue;
        // Teto de verdade (com sólido dos lados), não ponta de estalactite.
        if (terreno.em(cx - 1, cy) !== SOLIDO || terreno.em(cx + 1, cy) !== SOLIDO) continue;
        const h = hash2(cx, cy, semente + 743);
        if (h < 0.06) tetos.push({ x: (cx + 0.5) * t, y: (cy + 1) * t, h });
      }
    }
    tetos.sort((p, q) => p.h - q.h);
    let ultimoX = -1e9;
    for (const p of tetos) {
      if (this.pend.length >= MAX_PEND) break;
      if (Math.abs(p.x - ultimoX) < 260) continue;
      ultimoX = p.x;
      const k = this.pend.length;
      this.pend.push({ ...p, tipo: PENDURADOS[Math.floor(hash2(k, semente, 751) * PENDURADOS.length)],
        esp: hash2(k, semente, 757) < 0.5 ? -1 : 1, ordem: k / MAX_PEND });
    }
    this._medo = new Map();   // bicho -> 0..1 (recuado)
    this._todos = [...this.chao, ...this.pend];
  }

  /** O Guardião perto espanta: o bicho some devagar e volta quando ele sai. */
  atualizar(dt, jx, jy) {
    for (const b of this._todos) {
      const perto = Math.hypot(b.x - jx, (b.y - 20) - jy) < 85 ? 1 : 0;
      const m = this._medo.get(b) ?? 0;
      this._medo.set(b, m + (perto - m) * Math.min(1, dt * (perto ? 5 : 0.8)));
    }
  }

  desenhar(ctx, tema, tempo, pureza, reduzido, comUrubus = true) {
    const tAnim = reduzido ? tempo / 3 : tempo;
    // Tom MÉDIO: entre o terreno e a crista (ver cabeçalho — nunca preto).
    const cor = misturarHex(tema.terreno, tema.crista, 0.55);
    const corUrubu = misturarHex(tema.terreno, tema.crista, 0.38);
    const aChao = silhueta('bichos', 'bichos');
    const aUrubu = silhueta('urubus', 'bichos');
    const aPend = silhueta('pendurados', 'bichos');

    // Urubu sai cedo (0,15→0,5); a fauna chega tarde (0,55→0,95) e um a um.
    for (const b of this.chao) {
      const alfa = (b.urubu
        ? clamp01(1 - (pureza - 0.15 - b.ordem * 0.15) / 0.2)
        : clamp01((pureza - 0.55 - b.ordem * 0.25) / 0.15))
        * (1 - (this._medo.get(b) ?? 0));
      const atlas = b.urubu ? aUrubu : aChao;
      if (alfa < 0.02 || !atlas || (b.urubu && !comUrubus)) continue;
      const [x, y, w, h] = b.tipo.r;
      const alt = b.tipo.alt * ESCALA, larg = alt * w / h;
      const resp = 1 + Math.sin(tAnim * 1.6 + b.h * 40) * 0.02;
      ctx.save();
      ctx.globalAlpha = alfa;
      ctx.translate(b.x, b.y + 1);
      ctx.scale(b.esp, resp);
      ctx.drawImage(tingir(atlas, b.urubu ? corUrubu : cor), x, y, w, h, -larg / 2, -alt, larg, alt);
      ctx.restore();
    }
    if (!aPend) return;
    for (const b of this.pend) {
      const alfa = clamp01((pureza - 0.6 - b.ordem * 0.2) / 0.15) * (1 - (this._medo.get(b) ?? 0));
      if (alfa < 0.02) continue;
      const [x, y, w, h] = b.tipo.r;
      const alt = b.tipo.alt * ESCALA, larg = alt * w / h;
      ctx.save();
      ctx.globalAlpha = alfa;
      ctx.translate(b.x, b.y - 1);
      // Pêndulo lento a partir do ponto de apoio.
      ctx.rotate(Math.sin(tAnim * 0.9 + b.h * 30) * 0.06);
      ctx.scale(b.esp, 1);
      ctx.drawImage(tingir(aPend, cor), x, y, w, h, -larg / 2, 0, larg, alt);
      ctx.restore();
    }
  }
}
