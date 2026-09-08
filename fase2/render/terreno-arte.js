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
import { caminhoDe, luzRadial } from './renderizador.js';
import { PLATAFORMA, PERIGO, AGUA } from '../mundo/terreno.js';

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

    // --- 7. tiles especiais ---------------------------------------------
    // Plataforma, perigo e água NÃO entram no contorno: `contornos()` só
    // extrai a fronteira de tiles SÓLIDOS. Sem estes passes eles existem na
    // colisão e não na tela — o jogador se apoiava no ar e morria em espinho
    // invisível. (Água tem passe próprio, `desenharAgua`, porque precisa
    // ficar NA FRENTE das entidades pra submergir quem entra nela.)
    this.desenharPlataformas(ctx, tema, camera);
    this.desenharPerigos(ctx, tema, camera);
  }

  /* ---------------------------------------------------------------------
     TILES ESPECIAIS
     --------------------------------------------------------------------- */

  /**
   * Agrupa tiles contíguos de um tipo em faixas horizontais.
   * Desenhar tile a tile deixa costura visível entre os quadrados; uma viga
   * inteira por faixa lê como um objeto só, que é o que ela é.
   * @returns {{cx0:number, cx1:number, cy:number}[]}
   */
  _faixas(camera, tipo) {
    const t = this.terreno;
    const a = camera.areaVisivel(t.tile * 2);
    const cx0 = Math.max(0, Math.floor(a.x / t.tile));
    const cx1 = Math.min(t.largura - 1, Math.ceil((a.x + a.largura) / t.tile));
    const cy0 = Math.max(0, Math.floor(a.y / t.tile));
    const cy1 = Math.min(t.altura - 1, Math.ceil((a.y + a.altura) / t.tile));

    const saida = [];
    for (let cy = cy0; cy <= cy1; cy++) {
      let inicio = -1;
      for (let cx = cx0; cx <= cx1 + 1; cx++) {
        const eh = cx <= cx1 && t.em(cx, cy) === tipo;
        if (eh && inicio < 0) inicio = cx;
        else if (!eh && inicio >= 0) { saida.push({ cx0: inicio, cx1: cx - 1, cy }); inicio = -1; }
      }
    }
    return saida;
  }

  /**
   * Plataformas atravessáveis por baixo.
   *
   * A comunicação importa mais que a beleza aqui: se a plataforma parecer
   * chão maciço, o jogador nunca tenta pular por baixo dela e a sala inteira
   * fica menor do que foi desenhada. Por isso a face de CIMA é sólida e
   * iluminada, e a de baixo é esfarrapada e aberta — a forma diz "isto
   * segura você, mas não te barra".
   */
  desenharPlataformas(ctx, tema, camera) {
    const t = this.terreno;
    const faixas = this._faixas(camera, PLATAFORMA);
    if (!faixas.length) return;
    const pureza = tema.pureza ?? 0;

    for (const f of faixas) {
      const x0 = f.cx0 * t.tile;
      const x1 = (f.cx1 + 1) * t.tile;
      const y = f.cy * t.tile;
      const largura = x1 - x0;
      const espessura = t.tile * 0.34;
      const s = this.semente + f.cy * 31 + f.cx0;

      // Corpo: viga levemente arqueada, como um galho apoiado nas pontas.
      const arco = Math.min(4, largura * 0.012);
      ctx.beginPath();
      ctx.moveTo(x0, y + 1);
      ctx.quadraticCurveTo((x0 + x1) / 2, y + 1 + arco, x1, y + 1);
      // Barra de baixo irregular: dentes curtos e desiguais.
      const passos = Math.max(2, Math.round(largura / 11));
      for (let i = passos; i >= 0; i--) {
        const px = x0 + (largura * i) / passos;
        const n = hash2(Math.round(px), f.cy, s);
        ctx.lineTo(px, y + espessura * lerp(0.55, 1.15, n) + arco * 0.6);
      }
      ctx.closePath();
      // O corpo é bem mais claro que o terreno (0.45 de mistura, não 0.18):
      // uma plataforma na cor da rocha some contra a rocha, e some justamente
      // no momento em que o jogador precisa dela para calcular um pulo.
      const g = ctx.createLinearGradient(0, y, 0, y + espessura);
      g.addColorStop(0, misturarHex(tema.terreno, tema.crista, 0.45));
      g.addColorStop(1, misturarHex(tema.terrenoFundo, tema.borda, 0.35));
      ctx.fillStyle = g;
      ctx.fill();

      // Face de cima: a linha que o jogador realmente pisa. É o elemento mais
      // claro de toda a cena depois do próprio Guardião — legibilidade de
      // affordance vence sutileza de atmosfera, sempre.
      ctx.strokeStyle = rgba(misturarHex(tema.crista, '#ffffff', 0.4),
        lerp(0.85, 1, pureza));
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0 + 1, y + 1);
      ctx.quadraticCurveTo((x0 + x1) / 2, y + 1 + arco, x1 - 1, y + 1);
      ctx.stroke();

      // Sombra projetada logo abaixo: descola a viga do fundo e reforça que
      // existe VÃO ali embaixo (por onde dá pra passar).
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = tema.ceuTopo;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x0 + 4, y + espessura + 4);
      ctx.lineTo(x1 - 4, y + espessura + 4);
      ctx.stroke();
      ctx.restore();

      // Amarração nas pontas: dois nós que ancoram a viga visualmente.
      ctx.fillStyle = misturarHex(tema.borda, tema.terreno, 0.4);
      for (const px of [x0 + 2, x1 - 2]) {
        ctx.beginPath();
        ctx.ellipse(px, y + espessura * 0.4, 3, espessura * 0.5, 0, 0, TAU);
        ctx.fill();
      }

      // Vegetação pendurada quando a área revive.
      if (pureza > 0.25) {
        ctx.strokeStyle = rgba(tema.crista, (pureza - 0.25) * 0.7);
        ctx.lineWidth = 1;
        for (let px = x0 + 6; px < x1 - 4; px += 9) {
          const n = hash2(Math.round(px), f.cy + 7, s);
          if (n > pureza * 0.8) continue;
          const comp = lerp(4, 15, n) * pureza;
          ctx.beginPath();
          ctx.moveTo(px, y + espessura * 0.8);
          ctx.quadraticCurveTo(px + (n - 0.5) * 5, y + espessura + comp * 0.6,
            px + (n - 0.5) * 9, y + espessura + comp);
          ctx.stroke();
        }
      }
    }
  }

  /**
   * Perigo (espinho de escória).
   *
   * É o único elemento do jogo em que ambiguidade custa vida do jogador, então
   * ele é desenhado com regras diferentes de todo o resto: alto contraste
   * SEMPRE (mesmo em área restaurada), ponta clara contra base escura, e
   * emissão própria no passe de luz. Nada de sutileza.
   */
  desenharPerigos(ctx, tema, camera) {
    const t = this.terreno;
    const faixas = this._faixas(camera, PERIGO);
    if (!faixas.length) return;

    for (const f of faixas) {
      for (let cx = f.cx0; cx <= f.cx1; cx++) {
        // Orientação: o espinho cresce a partir da superfície em que está
        // encostado. Sem isso, espinho de teto aponta pra cima e o jogador
        // não entende de onde veio o dano.
        const temChaoAbaixo = t.solido(cx, f.cy + 1) || t.em(cx, f.cy + 1) === PERIGO;
        const dir = temChaoAbaixo ? -1 : (t.solido(cx, f.cy - 1) ? 1 : -1);
        const baseY = dir < 0 ? (f.cy + 1) * t.tile : f.cy * t.tile;
        const x = cx * t.tile;

        // 3 pontas por tile, alturas irregulares.
        for (let i = 0; i < 3; i++) {
          const n = hash2(cx * 3 + i, f.cy, this.semente + 5);
          const px = x + (i + 0.5) * (t.tile / 3) + (n - 0.5) * 4;
          const alt = t.tile * lerp(0.5, 0.92, n) * dir;
          const meia = t.tile * lerp(0.1, 0.16, n);

          const g = ctx.createLinearGradient(0, baseY, 0, baseY + alt);
          g.addColorStop(0, misturarHex(tema.terrenoFundo, tema.ceuTopo, 0.5));
          g.addColorStop(1, misturarHex(tema.acento, '#ffffff', 0.35));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(px - meia, baseY);
          // Curva para dentro: espinho reto lê como triângulo de sinalização,
          // curvo lê como coisa crescida.
          ctx.quadraticCurveTo(px - meia * 0.35, baseY + alt * 0.55, px, baseY + alt);
          ctx.quadraticCurveTo(px + meia * 0.35, baseY + alt * 0.55, px + meia, baseY);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
  }

  /**
   * Água / poça ácida. Chamada DEPOIS das entidades (ver main.js), pra que
   * quem entra nela apareça submerso em vez de flutuando por cima.
   */
  desenharAgua(ctx, tema, camera, tempo = 0) {
    const t = this.terreno;
    const faixas = this._faixas(camera, AGUA);
    if (!faixas.length) return;

    for (const f of faixas) {
      const x0 = f.cx0 * t.tile;
      const x1 = (f.cx1 + 1) * t.tile;
      const y = f.cy * t.tile;
      // É a linha de superfície? (não há água logo acima)
      const superficie = t.em(f.cx0, f.cy - 1) !== AGUA;

      ctx.save();
      ctx.globalAlpha = 0.55;
      const g = ctx.createLinearGradient(0, y, 0, y + t.tile);
      g.addColorStop(0, rgba(tema.luz, superficie ? 0.34 : 0.16));
      g.addColorStop(1, rgba(tema.bruma, 0.5));
      ctx.fillStyle = g;
      ctx.fillRect(x0, y, x1 - x0, t.tile + 1);
      ctx.restore();

      if (!superficie) continue;

      // Linha de superfície ondulando — é o que faz ler como líquido em vez
      // de retângulo azul.
      ctx.save();
      ctx.strokeStyle = rgba(tema.crista, 0.7);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let px = x0; px <= x1; px += 6) {
        const oy = y + Math.sin(px * 0.06 + tempo * 1.6) * 1.6
                     + Math.sin(px * 0.017 - tempo * 0.9) * 1.1;
        px === x0 ? ctx.moveTo(px, oy) : ctx.lineTo(px, oy);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Passe emissivo dos especiais: plataforma, perigo e superfície de água. */
  desenharLuzEspeciais(ctx, tema, camera, tempo = 0) {
    const t = this.terreno;

    // A face pisável emite de leve. Custa quase nada e é o que faz a
    // plataforma "saltar" do fundo escuro sem precisar clarear a cena toda.
    ctx.save();
    ctx.strokeStyle = rgba(tema.crista, 0.42);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (const f of this._faixas(camera, PLATAFORMA)) {
      const y = f.cy * t.tile + 1;
      ctx.beginPath();
      ctx.moveTo(f.cx0 * t.tile, y);
      ctx.lineTo((f.cx1 + 1) * t.tile, y);
      ctx.stroke();
    }
    ctx.restore();

    for (const f of this._faixas(camera, PERIGO)) {
      for (let cx = f.cx0; cx <= f.cx1; cx++) {
        // Brilho fraco e constante na ponta: o jogador enxerga o espinho
        // antes de a silhueta ficar legível, o que é a diferença entre
        // "morri sem ver" e "eu que errei".
        luzRadial(ctx, cx * t.tile + t.tile / 2, f.cy * t.tile + t.tile / 2,
          t.tile * 0.9, tema.acento, 0.34);
      }
    }
    for (const f of this._faixas(camera, AGUA)) {
      if (t.em(f.cx0, f.cy - 1) === AGUA) continue;
      const y = f.cy * t.tile;
      for (let cx = f.cx0; cx <= f.cx1; cx++) {
        const cintila = 0.2 + 0.18 * Math.sin(cx * 0.7 + tempo * 1.3);
        luzRadial(ctx, cx * t.tile + t.tile / 2, y, t.tile * 1.1, tema.crista, cintila);
      }
    }
  }

  /**
   * Textura interna do solo.
   *
   * Antes eram FAIXAS HORIZONTAIS de largura total, imitando estrato de
   * rocha sedimentar. Ficava errado por dois motivos: o lugar é floresta, não
   * gruta, e faixa que atravessa a tela inteira amarra visualmente pedaços de
   * terreno que não têm relação nenhuma entre si, achatando a cena em lajes.
   *
   * Agora é manchado irregular (terra socada) mais filamentos de raiz perto
   * da superfície. Nada atravessa a tela, então cada pedaço de chão lê como
   * um pedaço de chão.
   */
  _estratos(ctx, tema, camera, alturaMundo) {
    const a = camera.areaVisivel(80);
    const passo = 46;
    const x0 = Math.floor(a.x / passo) * passo;
    const y0 = Math.floor(a.y / passo) * passo;

    // 1 · manchas de terra: elipses grandes e suaves, alfa baixo.
    for (let y = y0; y < a.y + a.altura; y += passo) {
      for (let x = x0; x < a.x + a.largura; x += passo) {
        const h = hash2(x, y, this.semente);
        if (h > 0.55) continue;
        const h2 = hash2(x, y, this.semente + 17);
        ctx.fillStyle = h2 > 0.5
          ? rgba(tema.terrenoFundo, 0.34)
          : rgba(misturarHex(tema.terreno, tema.borda, 0.45), 0.20);
        ctx.beginPath();
        ctx.ellipse(
          x + (h - 0.5) * passo, y + (h2 - 0.5) * passo,
          lerp(20, 52, h), lerp(12, 30, h2),
          (h - 0.5) * 1.2, 0, TAU
        );
        ctx.fill();
      }
    }

    // 2 · filamentos de raiz descendo a partir das superfícies pisáveis.
    ctx.strokeStyle = rgba(tema.terrenoFundo, 0.5);
    ctx.lineCap = 'round';
    for (const faixa of this.terreno.arestasSuperiores(0.5)) {
      for (let i = 0; i < faixa.length - 1; i += 3) {
        const p = faixa[i];
        const h = hash2(Math.round(p.x), Math.round(p.y), this.semente + 3);
        if (h > 0.4) continue;
        const comp = lerp(10, 40, h * 2.5);
        ctx.lineWidth = lerp(0.8, 2.4, h * 2.5);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.quadraticCurveTo(
          p.x + (h - 0.2) * 26, p.y + comp * 0.55,
          p.x + (h - 0.2) * 12, p.y + comp
        );
        ctx.stroke();
      }
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
  /**
   * Vegetação nas faces superiores, em TUFOS.
   *
   * A primeira versão desenhava uma lâmina por ponto do contorno. Como o
   * Chaikin deixa os pontos densos e quase equidistantes, o resultado era um
   * PENTE: lâminas iguais, igualmente espaçadas, ao longo de toda borda —
   * a coisa mais artificial que restava na tela.
   *
   * Agora a grama nasce em tufos de 3-6 lâminas, separados por vãos
   * irregulares, com altura decrescente do centro para as pontas de cada
   * tufo. Grama de verdade cresce onde pegou, não em fila.
   */
  _musgo(ctx, tema, faixas, pureza) {
    if (pureza < 0.02) return;
    const densidade = clamp01(pureza);
    const corBase = rgba(tema.crista, lerp(0.25, 0.75, densidade));
    ctx.lineCap = 'round';

    for (let f = 0; f < faixas.length; f++) {
      const faixa = faixas[f];

      // Percorre a aresta por COMPRIMENTO DE ARCO, não por índice: assim o
      // espaçamento dos tufos é o mesmo num trecho reto e num curvo.
      let percorrido = 0;
      let proximoTufo = 0;

      for (let i = 0; i < faixa.length - 1; i++) {
        const a = faixa[i], b = faixa[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const seg = Math.hypot(dx, dy) || 0.001;

        if (percorrido + seg < proximoTufo) { percorrido += seg; continue; }

        // Normal pra fora: a grama cresce perpendicular à superfície e
        // acompanha a inclinação do terreno.
        const nx = dy / seg, ny = -dx / seg;
        const tx = dx / seg, ty = dy / seg;

        while (proximoTufo <= percorrido + seg) {
          const t = (proximoTufo - percorrido) / seg;
          const bx = a.x + dx * t, by = a.y + dy * t;
          const h = hash2(Math.round(bx), Math.round(by), this.semente + f);
          const h2 = hash2(Math.round(by), Math.round(bx), this.semente + 13);

          // Vão até o próximo tufo: irregular, e menor quanto mais viva a área.
          proximoTufo += lerp(34, 9, densidade) * lerp(0.5, 1.8, h2);

          if (h > densidade * 0.9) continue;

          const lâminas = 3 + Math.floor(h2 * 4);
          const alturaTufo = lerp(5, 15, h) * densidade;
          ctx.strokeStyle = corBase;

          for (let k = 0; k < lâminas; k++) {
            const kf = lâminas === 1 ? 0 : k / (lâminas - 1) - 0.5;   // -0.5..0.5
            // Altura cai do meio pras pontas: dá forma de tufo, não de cerca.
            const alt = alturaTufo * (1 - Math.abs(kf) * 0.85) * lerp(0.7, 1.15, hash2(k, Math.round(bx), f));
            const raiz = { x: bx + tx * kf * 7, y: by + ty * kf * 7 };
            const curva = kf * 2.2 + (h - 0.5) * 0.9;
            ctx.lineWidth = lerp(1.5, 0.7, Math.abs(kf) * 2);
            ctx.beginPath();
            ctx.moveTo(raiz.x, raiz.y);
            ctx.quadraticCurveTo(
              raiz.x + nx * alt * 0.55 + tx * curva * 2,
              raiz.y + ny * alt * 0.55 + ty * curva * 2,
              raiz.x + nx * alt + tx * curva * 5,
              raiz.y + ny * alt + ty * curva * 5
            );
            ctx.stroke();
          }

          // Flor no topo de um tufo, esporádica e só em pureza alta — é a
          // recompensa visual final da restauração, e vale exatamente porque
          // é rara.
          if (densidade > 0.6 && h < 0.13) {
            const alt = alturaTufo * 1.05;
            ctx.fillStyle = tema.acento;
            ctx.beginPath();
            ctx.arc(bx + nx * alt, by + ny * alt, lerp(1.4, 2.4, h2), 0, TAU);
            ctx.fill();
          }
        }
        percorrido += seg;
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
