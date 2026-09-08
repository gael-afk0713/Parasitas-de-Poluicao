/* =========================================================================
   fase2/render/renderizador.js — pipeline de composição
   -------------------------------------------------------------------------
   O que separa "canvas 2D bonitinho" de "parece Ori" quase nunca é o desenho
   de cada objeto — é o que acontece DEPOIS que tudo foi desenhado. Este
   arquivo é essa etapa.

   Passes, em ordem (a ordem É a profundidade — não reordenar sem pensar):

     1. céu           gradiente vertical, colado na tela
     2. distante      parallax ~0.15 — silhuetas comidas pela bruma
     3. médio         parallax ~0.38
     4. raios         luz volumétrica ATRÁS do terreno (god rays)
     5. próximo       parallax ~0.65
     6. mundoFundo    decoração colada no terreno, atrás dele
     7. terreno       o chão jogável
     8. entidades     inimigos, jogador, projéteis
     9. mundoFrente   decoração na frente do terreno
    10. partículas    esporos, poeira, fuligem
    11. primeiroPlano parallax ~1.35, quase preto — a moldura viva
    12. composição    bloom + gradação + bruma de profundidade + vinheta

   O buffer EMISSIVO é o truque central. Qualquer sistema pode chamar
   `emissivo(fn)` a qualquer momento; o desenho vai pra um canvas separado em
   meia resolução que, no fim, é borrado e somado por cima da cena com
   `globalCompositeOperation:'lighter'`. É assim que se consegue glow que
   VAZA pra fora do objeto e tinge o que está em volta, em vez do
   `shadowBlur` do canvas (que é por objeto, caríssimo, e não vaza).
   ========================================================================= */

import { clamp01, rgba, misturarHex, lerp } from '../core/mat.js';

/** Escala do buffer de luz. 0.5 = metade da resolução em cada eixo.
 *  Borrão não precisa de resolução; isso corta o custo do bloom em 4x. */
const ESCALA_LUZ = 0.5;

/** ctx.filter='blur()' cobre os navegadores atuais, mas não todos.
 *  Sem ele, o bloom vira um halo duro e feio — então detectamos e caímos
 *  num borrão manual por múltiplos desenhos deslocados. */
const SUPORTA_FILTRO = (() => {
  try {
    const c = document.createElement('canvas');
    const x = c.getContext('2d');
    x.filter = 'blur(2px)';
    return x.filter === 'blur(2px)';
  } catch { return false; }
})();

function criarBuffer(largura, altura) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, largura);
  c.height = Math.max(1, altura);
  return { canvas: c, ctx: c.getContext('2d') };
}

export class Renderizador {
  /** @param {import('../core/laco.js').Tela} tela */
  constructor(tela) {
    this.tela = tela;
    this.luz = criarBuffer(1, 1);
    this.cena = criarBuffer(1, 1);
    this._w = 0; this._h = 0;

    /** Ajustado por área/eventos; 1 = bloom cheio do tema. */
    this.ganhoBloom = 1;
    /** Aberração cromática momentânea (dano/impacto). 0 = desligado. */
    this.aberracao = 0;
    /** Flash de tela cheia — cor + intensidade, decai sozinho. */
    this.flash = { cor: '#ffffff', valor: 0 };

    this.tema = null;
    this.camera = null;

    /** Estatísticas do último frame — usadas pelo HUD de debug. */
    this.stats = { desenhos: 0, emissivos: 0 };

    this._garantirBuffers();
  }

  _garantirBuffers() {
    const { largura, altura, dpr } = this.tela;
    const w = Math.round(largura * dpr);
    const h = Math.round(altura * dpr);
    if (w === this._w && h === this._h) return;
    this._w = w; this._h = h;
    this.cena.canvas.width = w;
    this.cena.canvas.height = h;
    this.luz.canvas.width = Math.max(1, Math.round(w * ESCALA_LUZ));
    this.luz.canvas.height = Math.max(1, Math.round(h * ESCALA_LUZ));
  }

  /* ---------------------------------------------------------------------
     Ciclo de frame
     --------------------------------------------------------------------- */

  /**
   * @param {import('./paleta.js').Tema} tema
   * @param {import('../core/laco.js').Camera} camera
   */
  iniciarFrame(tema, camera) {
    this._garantirBuffers();
    this.tema = tema;
    this.camera = camera;
    this.stats.desenhos = 0;
    this.stats.emissivos = 0;

    const { ctx } = this.cena;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // Céu já preenche tudo; não precisa de clearRect (que é mais lento).

    const l = this.luz.ctx;
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.globalCompositeOperation = 'source-over';
    l.globalAlpha = 1;
    l.clearRect(0, 0, this.luz.canvas.width, this.luz.canvas.height);
    return ctx;
  }

  /**
   * Executa `fn(ctx)` com a câmera aplicada no fator de parallax dado.
   * Sempre save/restore — nenhum sistema precisa lembrar de limpar estado.
   */
  camada(parallax, fn) {
    const { ctx } = this.cena;
    const { dpr } = this.tela;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.camera.aplicar(ctx, parallax);
    fn(ctx, this.tema, this.camera);
    ctx.restore();
    this.stats.desenhos++;
  }

  /** Camada colada na tela (HUD de mundo, gradiente de céu). */
  camadaTela(fn) {
    const { ctx } = this.cena;
    const { dpr } = this.tela;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fn(ctx, this.tema, this.tela.largura, this.tela.altura);
    ctx.restore();
    this.stats.desenhos++;
  }

  /**
   * Desenha no buffer EMISSIVO (o que vira glow). Mesma transformação de
   * câmera da cena, só que em meia resolução — transparente pro chamador.
   */
  emissivo(parallax, fn) {
    const l = this.luz.ctx;
    const escala = this.tela.dpr * ESCALA_LUZ;
    l.save();
    l.setTransform(escala, 0, 0, escala, 0, 0);
    this.camera.aplicar(l, parallax);
    l.globalCompositeOperation = 'lighter';   // luz soma, nunca oclui
    fn(l, this.tema, this.camera);
    l.restore();
    this.stats.emissivos++;
  }

  /** Versão colada na tela do buffer emissivo. */
  emissivoTela(fn) {
    const l = this.luz.ctx;
    const escala = this.tela.dpr * ESCALA_LUZ;
    l.save();
    l.setTransform(escala, 0, 0, escala, 0, 0);
    l.globalCompositeOperation = 'lighter';
    fn(l, this.tema, this.tela.largura, this.tela.altura);
    l.restore();
    this.stats.emissivos++;
  }

  /* ---------------------------------------------------------------------
     Composição final
     --------------------------------------------------------------------- */

  finalizar(dtReal) {
    const tema = this.tema;
    const cena = this.cena.ctx;
    const w = this._w, h = this._h;

    // --- 1. Bloom: borra o buffer de luz e soma na cena. ------------------
    const intensidade = tema.brilhoBloom * this.ganhoBloom;
    if (intensidade > 0.01) {
      cena.save();
      cena.setTransform(1, 0, 0, 1, 0, 0);
      cena.globalCompositeOperation = 'lighter';

      if (SUPORTA_FILTRO) {
        // Dois raios: o pequeno mantém o objeto nítido e "quente"; o grande
        // é o halo que tinge o ambiente. Um raio só sempre parece errado —
        // ou lava o objeto, ou não vaza.
        cena.globalAlpha = intensidade * 0.85;
        cena.filter = `blur(${(4 * this.tela.dpr).toFixed(1)}px)`;
        cena.drawImage(this.luz.canvas, 0, 0, w, h);
        cena.globalAlpha = intensidade * 0.55;
        cena.filter = `blur(${(18 * this.tela.dpr).toFixed(1)}px)`;
        cena.drawImage(this.luz.canvas, 0, 0, w, h);
        cena.filter = 'none';
      } else {
        // Fallback: 9 cópias deslocadas aproximam um borrão gaussiano.
        cena.globalAlpha = intensidade * 0.18;
        const r = 5 * this.tela.dpr;
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          cena.drawImage(this.luz.canvas, Math.cos(a) * r, Math.sin(a) * r, w, h);
        }
        cena.globalAlpha = intensidade * 0.5;
        cena.drawImage(this.luz.canvas, 0, 0, w, h);
      }
      cena.restore();
    }

    // --- 2. Tinta ambiente: unifica a cena numa temperatura só. -----------
    //     Multiply escurece e tinge ao mesmo tempo, que é o que uma luz
    //     ambiente colorida faz de verdade. Fraco de propósito (5-11%);
    //     acima disso vira filtro de Instagram.
    cena.save();
    cena.setTransform(1, 0, 0, 1, 0, 0);
    cena.globalCompositeOperation = 'soft-light';
    cena.globalAlpha = 0.38;
    cena.fillStyle = tema.luzAmbiente;
    cena.fillRect(0, 0, w, h);
    cena.restore();

    // --- 3. Vinheta: gradiente radial escuro nas bordas. ------------------
    if (tema.vinheta > 0.01) {
      const g = cena.createRadialGradient(
        w / 2, h * 0.46, Math.min(w, h) * 0.28,
        w / 2, h * 0.5, Math.max(w, h) * 0.78
      );
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.62, rgba(tema.ceuTopo, tema.vinheta * 0.35));
      g.addColorStop(1, rgba(tema.ceuTopo, tema.vinheta));
      cena.save();
      cena.setTransform(1, 0, 0, 1, 0, 0);
      cena.fillStyle = g;
      cena.fillRect(0, 0, w, h);
      cena.restore();
    }

    // --- 4. Flash de tela cheia (impacto, restauração, morte). ------------
    if (this.flash.valor > 0.002) {
      cena.save();
      cena.setTransform(1, 0, 0, 1, 0, 0);
      cena.globalCompositeOperation = 'lighter';
      cena.globalAlpha = clamp01(this.flash.valor);
      cena.fillStyle = this.flash.cor;
      cena.fillRect(0, 0, w, h);
      cena.restore();
      // Decaimento exponencial: pico instantâneo, cauda curta.
      this.flash.valor *= Math.pow(0.0016, dtReal);
    }

    // --- 5. Cena → tela, com aberração cromática se houver. ---------------
    const saida = this.tela.ctx;
    saida.setTransform(1, 0, 0, 1, 0, 0);
    saida.globalCompositeOperation = 'source-over';
    saida.globalAlpha = 1;
    saida.filter = 'none';

    if (this.aberracao > 0.004) {
      // Separa os canais em px. Só em momentos de impacto — permanente é
      // enjoativo e denuncia efeito barato.
      const d = this.aberracao * 9 * this.tela.dpr;
      saida.fillStyle = '#000';
      saida.fillRect(0, 0, w, h);
      saida.globalCompositeOperation = 'lighter';
      const canais = [
        ['rgba(255,0,0,1)', -d],
        ['rgba(0,255,0,1)', 0],
        ['rgba(0,0,255,1)', d],
      ];
      const tmp = this._tmpCanal ||= criarBuffer(w, h);
      if (tmp.canvas.width !== w || tmp.canvas.height !== h) {
        tmp.canvas.width = w; tmp.canvas.height = h;
      }
      for (const [mascara, desloc] of canais) {
        const t = tmp.ctx;
        t.setTransform(1, 0, 0, 1, 0, 0);
        t.globalCompositeOperation = 'source-over';
        t.clearRect(0, 0, w, h);
        t.drawImage(this.cena.canvas, desloc, 0);
        t.globalCompositeOperation = 'multiply';
        t.fillStyle = mascara;
        t.fillRect(0, 0, w, h);
        saida.drawImage(tmp.canvas, 0, 0);
      }
      saida.globalCompositeOperation = 'source-over';
      this.aberracao *= Math.pow(0.002, dtReal);
    } else {
      saida.drawImage(this.cena.canvas, 0, 0);
    }
  }

  /* ---------------------------------------------------------------------
     Atalhos usados por vários sistemas
     --------------------------------------------------------------------- */

  /** Dispara um flash. `valor` ~0.15 pra sutil, ~0.6 pra evento grande. */
  piscar(cor, valor) {
    this.flash.cor = cor;
    this.flash.valor = Math.max(this.flash.valor, valor);
  }

  sacudirCor(valor = 0.5) { this.aberracao = Math.max(this.aberracao, valor); }

  /**
   * O céu — primeiro pass de todo frame.
   *
   * O jogo se passa AO AR LIVRE, e ao ar livre o céu é a coisa mais clara da
   * cena, mesmo à noite, mesmo sob fumaça. É isso que faz silhueta de árvore
   * ler como silhueta em vez de virar mais uma mancha escura entre outras.
   * Um gradiente escuro de cima a baixo, como era antes, é céu de caverna.
   *
   * Três camadas:
   *   1. gradiente base, escurecendo pra cima (o zênite é sempre o mais escuro)
   *   2. CLARÃO DE HORIZONTE — a faixa mais clara da tela inteira, logo acima
   *      da linha das copas. É o que dá profundidade e diz "há mundo além"
   *   3. faixas de fumaça derivando devagar, porque esta floresta está doente
   *      e o céu precisa contar isso antes de qualquer texto
   */
  desenharCeu(alturaMundo = 2000, tempo = 0) {
    this.camadaTela((ctx, tema, w, h) => {
      // Quanto do mundo já foi escalado. Perto do chão o horizonte fica baixo
      // na tela; subindo, ele desce — dá a sensação de altitude ganha.
      const alturaRel = clamp01(this.camera.viewY / Math.max(1, alturaMundo - this.tela.altura));
      const yHorizonte = h * lerp(0.58, 0.92, alturaRel);

      // 1 · base
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, tema.ceuTopo);
      g.addColorStop(0.45, misturarHex(tema.ceuTopo, tema.ceuBase, 0.6));
      g.addColorStop(1, tema.ceuBase);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      // 2 · clarão de horizonte
      const clarao = ctx.createLinearGradient(0, yHorizonte - h * 0.42, 0, yHorizonte + h * 0.1);
      clarao.addColorStop(0, rgba(tema.bruma, 0));
      clarao.addColorStop(0.72, rgba(misturarHex(tema.bruma, tema.luz, 0.28), 0.55));
      clarao.addColorStop(1, rgba(misturarHex(tema.bruma, tema.luz, 0.4), 0.75));
      ctx.fillStyle = clarao;
      ctx.fillRect(0, 0, w, h);

      // 3 · fumaça em faixas
      // Alongadas e quase horizontais: nuvem redonda lê como algodão, faixa
      // esticada lê como poluição parada no ar. Derivam devagar e em
      // velocidades diferentes, senão a camada inteira desliza como um bloco.
      ctx.save();
      for (let i = 0; i < 5; i++) {
        const f = i / 4;
        const y = yHorizonte - h * lerp(0.05, 0.5, f) + Math.sin(tempo * 0.06 + i) * 6;
        const deriva = (tempo * lerp(3, 9, f) + i * 260) % (w * 2) - w * 0.5;
        const larguraFaixa = w * lerp(0.5, 1.1, ((i * 37) % 10) / 10);
        const alturaFaixa = h * lerp(0.02, 0.055, f);
        const alfa = lerp(0.16, 0.05, f) * (1 - (tema.pureza ?? 0) * 0.55);
        const gf = ctx.createRadialGradient(
          deriva + larguraFaixa / 2, y, 0,
          deriva + larguraFaixa / 2, y, larguraFaixa / 2
        );
        gf.addColorStop(0, rgba(tema.bruma, alfa));
        gf.addColorStop(1, rgba(tema.bruma, 0));
        ctx.fillStyle = gf;
        ctx.beginPath();
        ctx.ellipse(deriva + larguraFaixa / 2, y, larguraFaixa / 2, alturaFaixa, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    });
  }

  /**
   * Névoa de profundidade sobre a última camada desenhada. Chamar ENTRE
   * camadas de parallax, não no fim — é o que faz cada plano se separar do
   * de trás.
   * @param {number} forca 0..1
   */
  velarProfundidade(forca) {
    if (forca <= 0.002) return;
    this.camadaTela((ctx, tema, w, h) => {
      ctx.globalAlpha = clamp01(forca * tema.densidadeBruma);
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, rgba(tema.bruma, 0.85));
      g.addColorStop(0.6, rgba(tema.bruma, 1));
      g.addColorStop(1, rgba(tema.bruma, 0.7));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    });
  }
}

/* -------------------------------------------------------------------------
   Helpers de desenho reaproveitáveis
   ------------------------------------------------------------------------- */

/** Traça uma polilinha já suavizada. Não faz fill nem stroke — só o caminho. */
export function caminhoDe(ctx, pontos, fechar = false) {
  if (!pontos.length) return;
  ctx.beginPath();
  ctx.moveTo(pontos[0].x, pontos[0].y);
  for (let i = 1; i < pontos.length; i++) ctx.lineTo(pontos[i].x, pontos[i].y);
  if (fechar) ctx.closePath();
}

/** Ponto de luz radial — o tijolo de toda iluminação do jogo. */
export function luzRadial(ctx, x, y, raio, cor, intensidade = 1) {
  if (raio <= 0 || intensidade <= 0.002) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, raio);
  g.addColorStop(0, rgba(cor, 0.95 * intensidade));
  g.addColorStop(0.35, rgba(cor, 0.42 * intensidade));
  g.addColorStop(0.72, rgba(cor, 0.12 * intensidade));
  g.addColorStop(1, rgba(cor, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, raio, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Feixe de luz volumétrica (god ray). `angulo` em radianos a partir da
 * vertical; feixes de uma mesma área devem compartilhar o ângulo, senão a
 * cena parece ter três sóis.
 */
export function feixeLuz(ctx, x, y, comprimento, largura, angulo, cor, intensidade = 1) {
  if (intensidade <= 0.002) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angulo);
  const g = ctx.createLinearGradient(0, 0, 0, comprimento);
  g.addColorStop(0, rgba(cor, 0.5 * intensidade));
  g.addColorStop(0.42, rgba(cor, 0.2 * intensidade));
  g.addColorStop(1, rgba(cor, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  // Trapézio: a boca do feixe é estreita e ele abre ao descer.
  ctx.moveTo(-largura * 0.32, 0);
  ctx.lineTo(largura * 0.32, 0);
  ctx.lineTo(largura, comprimento);
  ctx.lineTo(-largura, comprimento);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Silhueta com gradiente vertical — usada por todo parallax.
 * `topo`/`base` permitem que a base da montanha derreta na bruma.
 */
export function preencherGradienteVertical(ctx, path, y0, y1, corTopo, corBase) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, corTopo);
  g.addColorStop(1, corBase);
  ctx.fillStyle = g;
  ctx.fill(path);
}

export { SUPORTA_FILTRO };
