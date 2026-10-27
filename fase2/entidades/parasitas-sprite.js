/* =========================================================================
   fase2/entidades/parasitas-sprite.js — os parasitas em sprite (arte por IA)
   -------------------------------------------------------------------------
   O atlas `fase2/arte/parasitas.png` sai de `fase2/arte/preparar-parasitas.py`:
   um desenho por espécie (Cloudflare Workers AI), escurecido, limpo e
   deformado em QUADROS de animação. Uma linha por espécie, todas as células
   da linha do mesmo tamanho e com o pivô no mesmo ponto. Atlas novo? Rode o
   script, copie as constantes que ele imprime pra ESPECIES e SUBA o `?v` do
   PNG em `imagem.src`: o GitHub Pages guarda cache ~10 min, e atlas velho
   com constantes novas desalinha todos os quadros.

   O que continua em código (parasitas.js) e por quê:
   - o telégrafo (corpo inchando, fenda acendendo, luz de acento): é o aviso
     de ataque, e depende do tempo REAL do ataque;
   - o flash branco de dano, a piscada, o rastro, a auréola escura e a morte;
   - o fio do Tecelão (vai até o teto, que o desenho não conhece).

   Enquanto a imagem não carrega (ou se falhar), `pronto` fica false e o
   desenho em código assume — o jogo nunca fica sem inimigo.
   ========================================================================= */

/** Constantes impressas por `preparar-parasitas.py`. */
const QUADROS = 6;
const ESPECIES = {
  errante: { y: 0, w: 76, h: 102, pivoX: 38.0, pivoY: 96, escala: 0.4,
    olhoR: [2.0, 5.5], olhos: [[21.7, -55.1], [22.1, -56.9], [21.5, -57.0], [20.5, -55.1], [20.4, -53.7], [20.9, -53.8]] },
  espreita: { y: 102, w: 70, h: 82, pivoX: 35.0, pivoY: 41.0, escala: 0.4,
    olhoR: [2.5, 9.0], olhos: [[20.8, 0.1], [18.9, 0.2], [17.9, 0.2], [18.6, -0.0], [20.4, 0.1], [21.5, 0.2]] },
  cuspidor: { y: 184, w: 117, h: 102, pivoX: 58.5, pivoY: 96, escala: 0.4,
    olhoR: [2.0, 3.5], olhos: [[43.9, -60.8], [44.8, -62.7], [44.8, -62.7], [43.9, -60.8], [43.2, -58.4], [43.2, -58.4]] },
  rastejante: { y: 286, w: 87, h: 50, pivoX: 43.5, pivoY: 44, escala: 0.4,
    olhoR: [2.5, 4.0], olhos: [[24.0, -21.9], [25.2, -21.5], [25.2, -19.4], [24.1, -17.6], [22.6, -17.9], [22.8, -19.6]] },
  estopim: { y: 336, w: 92, h: 92, pivoX: 46.0, pivoY: 86, escala: 0.4,
    olhoR: [4.5, 8.5], olhos: [[12.0, -46.9], [12.3, -48.3], [12.3, -48.3], [12.0, -46.9], [11.7, -45.5], [11.7, -45.5]] },
  tecelao: { y: 428, w: 69, h: 112, pivoX: 34.5, pivoY: 56.0, escala: 0.4,
    olhoR: [2.0, 3.0], olhos: [[12.9, -30.3], [14.0, -30.4], [14.0, -30.4], [12.9, -30.3], [11.7, -30.5], [11.7, -30.5]] },
};

/* Quadros por segundo de cada espécie. Quem anda balança mais rápido; quem
   espreita respira devagar. Com movimento reduzido tudo cai a 1/3, como o
   resto do que anima no canvas (índice no fim do fase2.css). */
const QPS = { errante: 7, espreita: 4, cuspidor: 3, rastejante: 9, estopim: 3, tecelao: 3 };

/* Contorno claro: o corpo é quase preto e o primeiro plano também. O desenho
   em código resolve com um anel claro de 1,9 px; aqui é a silhueta branca
   desenhada deslocada em volta do sprite, que dá o mesmo recorte. */
const CONTORNO_PX = 1.0;     // px de mundo
const CONTORNO_ALFA = 0.24;
const OLHO_MIN = [1.5, 2.8];   // meia-largura e meia-altura, px de mundo
const DIRECOES = [[1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];

class SpritesParasitas {
  constructor() {
    this.pronto = false;
    /** Desligue pra comparar com o desenho em código, no console:
     *  `(await import('/fase2/entidades/parasitas-sprite.js'))
     *    .SPRITES_PARASITAS.ativo = false` */
    this.ativo = true;
    this.silhueta = null;    // o atlas em branco chapado (contorno e dano)
    this.imagem = new Image();
    this.imagem.decoding = 'async';
    this.imagem.onload = () => {
      this.silhueta = this._silhueta(this.imagem);
      this.pronto = true;
    };
    this.imagem.onerror = () => {
      console.warn('[fase2] sprite dos parasitas não carregou; usando o desenho em código');
    };
    this.imagem.src = new URL('../arte/parasitas.png?v=1', import.meta.url).href;
    this.movimentoReduzido = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  _silhueta(img) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }

  /** A espécie tem sprite e ele está pronto pra uso? */
  usa(especie) {
    return this.ativo && this.pronto && !!ESPECIES[especie];
  }

  quadro(especie, t) {
    const qps = QPS[especie] * (this.movimentoReduzido ? 0.33 : 1);
    return Math.floor(t * qps) % QUADROS;
  }

  /** Centro e meio-tamanho da fenda no quadro `q`, em px de mundo, relativos
   *  ao pivô e olhando pra direita (quem chama espelha com `dir`). */
  olho(especie, q) {
    const d = ESPECIES[especie];
    const [x, y] = d.olhos[q];
    /* Tamanho MÍNIMO de fenda. A IA desenhou o olho do Errante com 2 px de
       tela e o do Tecelão com menos de 1: a fenda é a âncora de leitura da
       espécie (ARQUITETURA.md), e a do desenho em código tem ~3 x 6 px. */
    return { x: x * d.escala, y: y * d.escala,
      rx: Math.max(d.olhoR[0] * d.escala, OLHO_MIN[0]),
      ry: Math.max(d.olhoR[1] * d.escala, OLHO_MIN[1]) };
  }

  /**
   * Desenha o quadro `q` com o pivô na origem atual do ctx (quem chama já
   * transladou, girou e espelhou). `branco` = flash de dano.
   */
  desenhar(ctx, especie, q, { branco = false } = {}) {
    const d = ESPECIES[especie];
    const sx = q * d.w;
    const e = d.escala;
    ctx.save();
    ctx.scale(e, e);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (!branco) {
      const passo = CONTORNO_PX / e;
      const alfa = ctx.globalAlpha;
      ctx.globalAlpha = alfa * CONTORNO_ALFA;
      for (const [ox, oy] of DIRECOES) {
        ctx.drawImage(this.silhueta, sx, d.y, d.w, d.h,
          -d.pivoX + ox * passo, -d.pivoY + oy * passo, d.w, d.h);
      }
      ctx.globalAlpha = alfa;
    }
    ctx.drawImage(branco ? this.silhueta : this.imagem, sx, d.y, d.w, d.h,
      -d.pivoX, -d.pivoY, d.w, d.h);
    ctx.restore();
  }
}

export const SPRITES_PARASITAS = new SpritesParasitas();
