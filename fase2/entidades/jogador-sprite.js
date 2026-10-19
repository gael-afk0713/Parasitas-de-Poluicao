/* =========================================================================
   fase2/entidades/jogador-sprite.js — o Guardião em sprite (arte por IA)
   -------------------------------------------------------------------------
   A folha `fase2/arte/guardiao.png` sai de `fase2/arte/preparar-guardiao.py`
   (que recorta a folha original gerada no ChatGPT, limpa a névoa de brilho e
   alinha todos os quadros num PIVÔ comum). Por isso aqui não há tabela de
   recortes: toda célula tem o mesmo tamanho e o pé do Guardião no mesmo
   ponto. Gerou folha nova? Rode o script e copie as constantes que ele
   imprime pra CELULA.

   O que continua em código (jogador-arte.js) e por quê:
   - o arco do golpe, a onda do Canto e o passe de luz: dependem do tempo e do
     alcance REAIS do golpe e do tema da área — desenhados na folha, eles
     ficavam fixos e em dobro com os do código (o script tira os da folha);
   - squash/stretch e inclinação: são a reação física ao pulo e à queda.

   Enquanto a imagem não carrega (ou se falhar), `pronto` fica false e o
   Guardião desenhado em código assume — o jogo nunca fica sem herói.
   ========================================================================= */
import { clamp01 } from '../core/mat.js';
import { ESTADOS } from './jogador.js';

/** Constantes impressas por `preparar-guardiao.py`. */
const CELULA = { largura: 342, altura: 248, pivoX: 171.0, pivoY: 179.5 };
const ALTURA_PARADO_ATLAS = 126.8;

/* Altura do Guardião parado na tela, do pé à ponta da orelha, em px de
   mundo. A caixa de colisão tem 44; o desenho em código tinha ~55 contando
   orelhas — o sprite fica na mesma presença pra não mudar a leitura das
   salas (vão, espinho, plataforma) que foram calibradas com ele. */
const ALTURA_NA_TELA = 56;
export const ESCALA_SPRITE = ALTURA_NA_TELA / ALTURA_PARADO_ATLAS;

/** Mesma ordem da folha (6 por linha). */
const QUADROS = [
  'parado', 'respiro', 'corrida1', 'corrida2', 'corrida3', 'corrida4',
  'agachado', 'subindo', 'apice', 'caindo', 'saltoDuplo', 'planeio',
  'ataque1', 'ataque2', 'ataque3', 'investida', 'parede', 'saltoParede',
  'canto1', 'canto2', 'canto3', 'dano', 'atordoado', 'morte',
];
const INDICE = Object.fromEntries(QUADROS.map((n, i) => [n, i]));

/* Corrida: 1→2→3→2. O quadro `corrida4` (as duas pernas no ar) tem escala e
   inclinação diferentes dos outros três e quebrava o ritmo do ciclo — ficou
   de fora, como sugeriu a revisão de design. */
const CICLO_CORRIDA = ['corrida1', 'corrida2', 'corrida3', 'corrida2'];

/* O mesmo de jogador.js, DUPLICADO de propósito: importar de lá quebraria o
   módulo inteiro se o GitHub Pages servisse um jogador.js velho do cache
   (sem o export) junto com este arquivo novo. */
const DUR_ATAQUE = 0.22;
const DUR_SALTO_DUPLO = 0.32; // a cambalhota

export class SpriteGuardiao {
  constructor() {
    this.pronto = false;
    this.imagem = new Image();
    this.imagem.decoding = 'async';
    this.imagem.onload = () => { this.pronto = true; };
    this.imagem.onerror = () => {
      console.warn('[fase2] sprite do Guardião não carregou; usando o desenho em código');
    };
    this.imagem.src = new URL('../arte/guardiao.png?v=1', import.meta.url).href;

    this._saltoDuplo = 0;   // tempo restante da cambalhota
    // Movimento reduzido: a cambalhota não gira (fica o quadro da bolinha).
    // Lido aqui e não em main.js pra este módulo não depender de quem o liga.
    this.movimentoReduzido = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this._saltosAntes = 0;
  }

  /** Detecta o salto duplo (o Jogador não emite flag própria pra isso). */
  atualizar(dt, j) {
    if (!j.noChao && j.saltosRestantes < this._saltosAntes) {
      this._saltoDuplo = DUR_SALTO_DUPLO;
    }
    this._saltosAntes = j.saltosRestantes;
    // Parede e investida cortam a cambalhota: sem isso, pular da parede logo
    // depois do salto duplo mostrava a bolinha girando, e a cambalhota
    // voltava do meio depois da investida.
    if (j.noChao || j.naParede || j.travaParede > 0 || j.estado === ESTADOS.INVESTIDA) {
      this._saltoDuplo = 0;
    }
    if (this._saltoDuplo > 0) this._saltoDuplo -= dt;
  }

  /**
   * Quadro do estado atual + se ele está desenhado olhando pra ESQUERDA na
   * folha (só o pulo da parede: ele se afasta de uma parede à direita).
   */
  quadro(j) {
    if (j.estado === ESTADOS.MORTO) return { nome: 'morte' };
    if (j.estado === ESTADOS.ATORDOADO) return { nome: 'dano' };
    if (j.estado === ESTADOS.CANTO) {
      const p = j.progressoCanto ?? 0;
      return { nome: p < 0.22 ? 'canto1' : p < 0.78 ? 'canto2' : 'canto3' };
    }
    if (j.estado === ESTADOS.INVESTIDA) return { nome: 'investida' };
    if (j.ataqueRestante > 0) {
      const t = 1 - j.ataqueRestante / DUR_ATAQUE;
      return { nome: t < 0.2 ? 'ataque1' : t < 0.65 ? 'ataque2' : 'ataque3' };
    }
    if (j.estado === ESTADOS.PAREDE) return { nome: 'parede' };
    if (j.estado === ESTADOS.PLANEIO) return { nome: 'planeio' };
    if (!j.noChao) {
      if (this._saltoDuplo > 0) {
        const giro = this.movimentoReduzido ? 0 : 1 - this._saltoDuplo / DUR_SALTO_DUPLO;
        return { nome: 'saltoDuplo', giro };
      }
      if (j.travaParede > 0 && j.vy < 0) return { nome: 'saltoParede', espelhado: true };
      if (j.vy < -140) return { nome: 'subindo' };
      if (j.vy < 140) return { nome: 'apice' };
      return { nome: 'caindo' };
    }
    // No chão: a aterrissagem pesada aparece como o agachado.
    if (j.achatar > 1.12) return { nome: 'agachado' };
    if (j.estado === ESTADOS.CORRENDO && Math.abs(j.vx) > 20) {
      const i = Math.floor(j.faseAndar / Math.PI * 2) % CICLO_CORRIDA.length;
      return { nome: CICLO_CORRIDA[(i + CICLO_CORRIDA.length) % CICLO_CORRIDA.length] };
    }
    // `respiro` e `atordoado` estão na folha mas não entram: o respiro abre
    // as orelhas em leque (contra o DESIGN §7) e o parado alternando com ele
    // pulsava de tamanho; `dano` já cobre o ATORDOADO.
    return { nome: 'parado' };
  }

  /**
   * Desenha um quadro com o pé em (x, y). `dir` 1 = direita.
   * `sx/sy` são o squash/stretch do Jogador; `rot` a inclinação.
   */
  desenhar(ctx, nome, x, y, { dir = 1, sx = 1, sy = 1, rot = 0, alfa = 1, giro = 0 } = {}) {
    const i = INDICE[nome] ?? 0;
    const cx = (i % 6) * CELULA.largura;
    const cy = Math.floor(i / 6) * CELULA.altura;
    const e = ESCALA_SPRITE;
    ctx.save();
    ctx.globalAlpha *= clamp01(alfa);
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(dir * sx * e, sy * e);
    if (giro) {
      // A cambalhota gira em volta do centro do corpo, não do pé.
      const meio = -ALTURA_PARADO_ATLAS * 0.42;
      ctx.translate(0, meio);
      ctx.rotate(giro * Math.PI * 2);
      ctx.translate(0, -meio);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.imagem, cx, cy, CELULA.largura, CELULA.altura,
      -CELULA.pivoX, -CELULA.pivoY, CELULA.largura, CELULA.altura);
    ctx.restore();
  }
}
