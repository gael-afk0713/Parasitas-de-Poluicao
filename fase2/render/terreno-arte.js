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
import { VAZIO, PLATAFORMA, PERIGO, AGUA } from '../mundo/terreno.js';

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
    // 0,16 dava ~16 níveis de luminância de alcance no corpo INTEIRO da
    // rocha: sem alcance não há material, só uma mancha.
    const g = ctx.createLinearGradient(0, camera.viewY, 0, camera.viewY + camera.altura);
    g.addColorStop(0, misturarHex(tema.terreno, tema.crista, 0.4));
    g.addColorStop(0.45, tema.terreno);
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

    // --- 3b. crosta iluminada -------------------------------------------
    // DEPOIS da oclusão, de propósito. A luz vem do céu: bate na face de
    // cima e não entra na parede. Como só as arestas PISÁVEIS entram aqui,
    // a distinção sai de graça — parede e teto continuam escuros.
    //
    // Sem isso o miolo da rocha é preto liso: a silhueta lê, o material não.
    // A escada de larguras faz o degradê que um `stroke` sozinho não faz.
    this._crosta(ctx, tema);
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
    // Cache por quadro: `_faixas` é chamado 5 vezes por quadro (plataforma,
    // perigo, água e os passes de luz dos três) e a varredura é O(tiles
    // visíveis). Numa sala alagada isso era metade do custo do quadro.
    // A chave inclui a área visível arredondada — a câmera mexeu, refaz.
    const t = this.terreno;
    const a = camera.areaVisivel(t.tile * 2);
    // Um mapa POR TIPO sob a mesma chave de área: com um cache de entrada só,
    // as chamadas alternadas (plataforma → perigo → água) se derrubariam
    // mutuamente e o cache nunca acertaria.
    const chaveArea = `${a.x | 0}|${a.y | 0}|${a.largura | 0}|${a.altura | 0}`;
    if (this._cacheFaixas?.chaveArea !== chaveArea) {
      this._cacheFaixas = { chaveArea, porTipo: new Map() };
    }
    const cache = this._cacheFaixas.porTipo;
    if (cache.has(tipo)) return cache.get(tipo);

    const valor = this._calcularFaixas(a, tipo);
    cache.set(tipo, valor);
    return valor;
  }

  _calcularFaixas(a, tipo) {
    const t = this.terreno;
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
      const s = this.semente + f.cy * 31 + f.cx0;

      /* DOIS TIPOS DE PLATAFORMA.
         Antes havia um só, e a sala inteira era a mesma barra arredondada
         repetida cinco, seis vezes: o elemento mais presente da tela era
         também o mais igual a si mesmo, e barra arredondada idêntica lê como
         elemento de interface, não como coisa do mundo.

         Agora cada faixa sorteia (pela posição, então nunca muda) entre um
         TRONCO CAÍDO — corpo cilíndrico, tampas de corte nas pontas, sulcos
         de casca ao longo — e uma LAJE de pedra — corpo angular, quebrado nas
         pontas, trinca atravessando. A regra de leitura continua a mesma nos
         dois: a face de cima é a coisa mais clara da cena depois do próprio
         Guardião, porque é nela que o jogador pisa. */
      const ehTronco = hash2(f.cx0, f.cy, s + 5) < 0.55;
      const espessura = t.tile * (ehTronco ? 0.46 : 0.4);

      const arco = Math.min(4, largura * 0.012);
      const topoY = (px) => y + 1 + arco * Math.sin(((px - x0) / largura) * Math.PI);
      ctx.beginPath();
      ctx.moveTo(x0, y + 1);
      ctx.quadraticCurveTo((x0 + x1) / 2, y + 1 + arco, x1, y + 1);
      if (ehTronco) {
        // Barriga do tronco: uma curva cheia, e as pontas descem arredondadas
        // — é a curva que faz ler como cilindro em vez de tábua.
        ctx.quadraticCurveTo(x1 + espessura * 0.5, y + espessura * 0.5,
          x1 - espessura * 0.35, y + espessura);
        const passos = Math.max(2, Math.round(largura / 26));
        for (let i = passos; i >= 0; i--) {
          const px = x0 + (largura * i) / passos;
          const n = hash2(Math.round(px), f.cy, s);
          ctx.lineTo(px, y + espessura * lerp(0.92, 1.06, n) + arco * 0.6);
        }
        ctx.quadraticCurveTo(x0 - espessura * 0.5, y + espessura * 0.5, x0, y + 1);
      } else {
        // Laje: quebrada embaixo, com dentes maiores e desiguais.
        const passos = Math.max(2, Math.round(largura / 15));
        for (let i = passos; i >= 0; i--) {
          const px = x0 + (largura * i) / passos;
          const n = hash2(Math.round(px), f.cy, s);
          ctx.lineTo(px, y + espessura * lerp(0.45, 1.35, n * n) + arco * 0.6);
        }
      }
      ctx.closePath();
      // O corpo é bem mais claro que o terreno (0.45 de mistura, não 0.18):
      // uma plataforma na cor da rocha some contra a rocha, e some justamente
      // no momento em que o jogador precisa dela para calcular um pulo.
      const g = ctx.createLinearGradient(0, y, 0, y + espessura);
      g.addColorStop(0, misturarHex(tema.terreno, tema.crista, 0.45));
      g.addColorStop(ehTronco ? 0.34 : 0.5, misturarHex(tema.terreno, tema.borda, 0.5));
      g.addColorStop(1, misturarHex(tema.terrenoFundo, tema.borda, 0.35));
      ctx.fillStyle = g;
      ctx.fill();

      if (ehTronco) {
        // Sulcos de casca: duas linhas longas acompanhando a curva do corpo.
        ctx.strokeStyle = rgba(tema.terrenoFundo, 0.5);
        ctx.lineWidth = 1;
        for (const k of [0.42, 0.68]) {
          ctx.beginPath();
          for (let px = x0 + 4; px <= x1 - 4; px += 9) {
            const n = hash2(Math.round(px), f.cy + k * 10, s + 3);
            const yy = topoY(px) + espessura * k + (n - 0.5) * 1.6;
            px === x0 + 4 ? ctx.moveTo(px, yy) : ctx.lineTo(px, yy);
          }
          ctx.stroke();
        }
        // Tampas de corte: o anel na ponta é o que diz "isto foi cortado".
        for (const [px, sinal] of [[x0 + 2.5, -1], [x1 - 2.5, 1]]) {
          ctx.fillStyle = misturarHex(tema.terreno, tema.borda, 0.55);
          ctx.beginPath();
          ctx.ellipse(px, y + espessura * 0.52, espessura * 0.24, espessura * 0.5, 0, 0, TAU);
          ctx.fill();
          ctx.strokeStyle = rgba(tema.crista, 0.35);
          ctx.lineWidth = 0.9;
          ctx.beginPath();
          ctx.ellipse(px + sinal * 0.6, y + espessura * 0.52,
            espessura * 0.12, espessura * 0.26, 0, 0, TAU);
          ctx.stroke();
        }
      } else {
        // Trinca: uma só, atravessando a laje na diagonal.
        const hc = hash2(f.cx0, f.cy, s + 11);
        const cx0 = x0 + largura * lerp(0.25, 0.7, hc);
        ctx.strokeStyle = rgba(tema.terrenoFundo, 0.6);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(cx0, y + 2);
        ctx.lineTo(cx0 + (hc - 0.5) * 10, y + espessura * 0.55);
        ctx.lineTo(cx0 + (hc - 0.5) * 4, y + espessura * 0.95);
        ctx.stroke();
      }

      // Face de cima: a linha que o jogador realmente pisa. É o elemento mais
      // claro de toda a cena depois do próprio Guardião — legibilidade de
      // affordance vence sutileza de atmosfera, sempre.
      ctx.strokeStyle = rgba(misturarHex(tema.crista, '#ffffff', 0.4),
        lerp(0.85, 0.72, pureza));
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

    // A onda é uma soma de três senoides de períodos incomensuráveis. Uma só
    // lê como animação em loop; três nunca repetem visivelmente, e é o que faz
    // parecer água em vez de um retângulo com uma cobra em cima.
    const onda = (px) =>
      Math.sin(px * 0.055 + tempo * 1.5) * 1.9 +
      Math.sin(px * 0.017 - tempo * 0.9) * 1.3 +
      Math.sin(px * 0.0083 + tempo * 0.47) * 0.9;

    for (const f of faixas) {
      const x0 = f.cx0 * t.tile;
      const x1 = (f.cx1 + 1) * t.tile;
      const y = f.cy * t.tile;

      /* Onde esta faixa tem LÂMINA D'ÁGUA de verdade.
         Superfície existe onde há AR logo acima — não basta "não é água".
         Testando só `!== AGUA` na primeira coluna da faixa, água embaixo de um
         bloco sólido era classificada como superfície, e o corpo d'água ficava
         cortado por linhas de onda horizontais no meio. Aqui o teste é por
         COLUNA e exige VAZIO, então a lâmina aparece só onde ela existiria. */
      const trechos = [];
      let ini = -1;
      for (let cx = f.cx0; cx <= f.cx1 + 1; cx++) {
        const ehLamina = cx <= f.cx1 && t.em(cx, f.cy - 1) === VAZIO;
        if (ehLamina && ini < 0) ini = cx;
        else if (!ehLamina && ini >= 0) { trechos.push([ini, cx - 1]); ini = -1; }
      }
      const superficie = trechos.length > 0;

      // --- corpo ---------------------------------------------------------
      // O gradiente vai do claro no topo ao escuro no fundo em CADA faixa, o
      // que dá a sensação de profundidade acumulando: quanto mais fundo, mais
      // opaco, como água de verdade.
      // Cor PLANA por linha, escolhida pela profundidade real abaixo da
      // lâmina. Antes cada linha desenhava seu próprio gradiente de claro a
      // escuro dentro do tile, e a fronteira entre linhas virava uma costura
      // visível — o corpo d'água saía listrado de alto a baixo. Com cor plana
      // por linha e escurecimento acumulando com a profundidade, o degradê
      // aparece na coluna inteira e não sobra emenda nenhuma.
      let prof = 0;
      for (let cy = f.cy - 1; cy >= 0 && t.em(f.cx0, cy) === AGUA; cy--) prof++;
      const k = clamp01(prof / 7);

      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = rgba(misturarHex(tema.luz, tema.bruma, lerp(0.35, 0.95, k)),
        lerp(0.42, 0.62, k));
      // +1 px de sobreposição pra não deixar fresta por arredondamento.
      ctx.fillRect(x0, y, x1 - x0, t.tile + 1);
      ctx.restore();

      if (!superficie) continue;

      // --- superfície ----------------------------------------------------
      ctx.save();
      const gs = ctx.createLinearGradient(0, y - 2, 0, y + t.tile * 0.55);
      gs.addColorStop(0, rgba(tema.crista, 0.28));
      gs.addColorStop(1, rgba(tema.crista, 0));

      for (const [ci, cf] of trechos) {
        const tx0 = ci * t.tile;
        const tx1 = (cf + 1) * t.tile;

        // 1 · fatia clara logo abaixo da linha d'água: é onde a luz entra e
        //     espalha, e o que mais faz o olho aceitar aquilo como líquido.
        ctx.fillStyle = gs;
        ctx.beginPath();
        ctx.moveTo(tx0, y + t.tile * 0.55);
        for (let px = tx0; px <= tx1; px += 8) ctx.lineTo(px, y + onda(px));
        ctx.lineTo(tx1, y + t.tile * 0.55);
        ctx.closePath();
        ctx.fill();

        // 2 · a linha da lâmina.
        ctx.strokeStyle = rgba(tema.crista, 0.75);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        for (let px = tx0; px <= tx1; px += 6) {
          const oy = y + onda(px);
          px === tx0 ? ctx.moveTo(px, oy) : ctx.lineTo(px, oy);
        }
        ctx.stroke();
      }

      // 3 · brilhos: traços curtos e horizontais deslizando devagar sobre a
      //     lâmina. É o detalhe que separa "água" de "gel colorido" — sem
      //     eles a superfície fica morta mesmo ondulando.
      ctx.strokeStyle = rgba(misturarHex(tema.crista, '#ffffff', 0.5), 0.5);
      ctx.lineWidth = 1.1;
      ctx.lineCap = 'round';
      const passoBrilho = 46;
      const bx0 = Math.floor(x0 / passoBrilho) * passoBrilho;
      for (let bx = bx0; bx <= x1; bx += passoBrilho) {
        const h = hash2(bx, f.cy, this.semente + 41);
        // Deriva lenta e por brilho: todos na mesma velocidade lê como
        // textura rolando, não como reflexo.
        const deriva = (tempo * lerp(4, 13, h) + h * 300) % (passoBrilho * 3);
        const px = bx + deriva;
        if (px < x0 || px > x1) continue;
        const comp = lerp(8, 26, h);
        // Piscam entrando e saindo, senão viram tracinhos permanentes.
        const alfa = 0.35 + 0.65 * Math.abs(Math.sin(tempo * lerp(0.6, 1.4, h) + h * 6));
        ctx.globalAlpha = alfa;
        ctx.beginPath();
        ctx.moveTo(px, y + onda(px) + 3);
        ctx.lineTo(px + comp, y + onda(px + comp) + 3);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** Passe emissivo dos especiais: plataforma, perigo e superfície de água. */
  desenharLuzEspeciais(ctx, tema, camera, tempo = 0) {
    const t = this.terreno;

    // A face pisável emite de leve. Custa quase nada e é o que faz a
    // plataforma "saltar" do fundo escuro sem precisar clarear a cena toda.
    ctx.save();
    // 0,42 num tema restaurado (brilhoBloom 0,72) fazia o borrão contornar a
    // plataforma INTEIRA em neon — o vazamento do bloom dá a volta na forma.
    ctx.strokeStyle = rgba(tema.crista, 0.26);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    for (const f of this._faixas(camera, PLATAFORMA)) {
      const y = f.cy * t.tile + 1;
      ctx.beginPath();
      ctx.moveTo(f.cx0 * t.tile, y);
      ctx.lineTo((f.cx1 + 1) * t.tile, y);
      ctx.stroke();
    }
    ctx.restore();

    // UM gradiente por FAIXA, não por tile.
    //
    // `luzRadial` cria um `createRadialGradient` a cada chamada, e um tile de
    // 32px é uma unidade cara demais pra isso: uma sala alagada tem centenas,
    // e o passe de luz sozinho custava ~10 ms por quadro. Uma faixa de água de
    // 20 tiles vira um gradiente esticado em vez de 20 redondos — e fica
    // melhor, porque a luz de uma lâmina d'água é contínua, não pontilhada.
    for (const f of this._faixas(camera, PERIGO)) {
      const meio = ((f.cx0 + f.cx1 + 1) / 2) * t.tile;
      const largura = (f.cx1 - f.cx0 + 1) * t.tile;
      // Brilho fraco e constante: o jogador enxerga o espinho antes de a
      // silhueta ficar legível — a diferença entre "morri sem ver" e "eu errei".
      luzRadial(ctx, meio, f.cy * t.tile + t.tile / 2,
        Math.max(t.tile, largura * 0.6), tema.acento, 0.34);
    }

    for (const f of this._faixas(camera, AGUA)) {
      if (t.em(f.cx0, f.cy - 1) === AGUA) continue;   // só a superfície
      const y = f.cy * t.tile;
      const meio = ((f.cx0 + f.cx1 + 1) / 2) * t.tile;
      const largura = (f.cx1 - f.cx0 + 1) * t.tile;
      const cintila = 0.2 + 0.14 * Math.sin(f.cx0 * 0.7 + tempo * 1.3);
      luzRadial(ctx, meio, y, Math.max(t.tile, largura * 0.55), tema.crista, cintila);
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
    // Manchas menores, mais densas e com mais contraste leem como terra
    // socada; grandes e suaves leem como sujeira na lente, que era o caso.
    const passo = 30;
    const x0 = Math.floor(a.x / passo) * passo;
    const y0 = Math.floor(a.y / passo) * passo;

    // 1 · manchas de terra: elipses grandes e suaves, alfa baixo.
    for (let y = y0; y < a.y + a.altura; y += passo) {
      for (let x = x0; x < a.x + a.largura; x += passo) {
        const h = hash2(x, y, this.semente);
        if (h > 0.55) continue;
        const h2 = hash2(x, y, this.semente + 17);
        ctx.fillStyle = h2 > 0.5
          ? rgba(tema.terrenoFundo, 0.48)
          : rgba(misturarHex(tema.terreno, tema.crista, 0.35), 0.34);
        ctx.beginPath();
        ctx.ellipse(
          x + (h - 0.5) * passo, y + (h2 - 0.5) * passo,
          lerp(10, 28, h), lerp(7, 17, h2),
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

  /**
   * Contorno com espessura variável — o que diferencia traço de caneta de
   * traço de pincel. O canvas não tem espessura variável nativa, então o
   * traçado é quebrado em segmentos.
   *
   * A versão anterior fazia `beginPath`/`stroke` POR SEGMENTO, na sala
   * inteira, todo quadro. Com o Chaikin dobrando os pontos duas vezes, isso
   * dava milhares de chamadas de desenho por quadro e sozinho custava ~9 ms
   * numa sala grande — mais da metade do orçamento de 60 fps.
   *
   * Agora os segmentos são pré-agrupados em FAIXAS DE ESPESSURA, uma vez por
   * sala, cada faixa virando um `Path2D`. Desenhar passa a ser um punhado de
   * `stroke` em vez de milhares, e o resultado na tela é o mesmo: a espessura
   * continua variando ao longo do traço, só que em degraus — indistinguível
   * a olho, porque a variação já era de 1,4 a 3,4 px.
   */
  _faixasContorno() {
    if (this._contornoPronto) return this._contornoPronto;

    const N = 5;   // degraus de espessura
    const faixas = Array.from({ length: N }, (_, i) => ({
      largura: lerp(1.4, 3.4, i / (N - 1)),
      alfa: lerp(0.55, 1, i / (N - 1)),
      path: new Path2D(),
      vazia: true,
    }));

    for (const c of this.terreno.contornos()) {
      const pts = c.pontos;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const n = ruido1(i * 0.09, this.semente + 3);
        const faixa = faixas[Math.min(N - 1, Math.floor(n * N))];
        faixa.path.moveTo(a.x, a.y);
        faixa.path.lineTo(b.x, b.y);
        faixa.vazia = false;
      }
    }

    this._contornoPronto = faixas.filter((f) => !f.vazia);
    return this._contornoPronto;
  }

  _contorno(ctx, tema) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const f of this._faixasContorno()) {
      ctx.strokeStyle = rgba(tema.borda, f.alfa);
      ctx.lineWidth = f.largura;
      ctx.stroke(f.path);
    }
  }

  /** Todas as arestas pisáveis num `Path2D` só — construído uma vez por sala. */
  _pathCristas() {
    if (this._cristasPronto) return this._cristasPronto;
    const p = new Path2D();
    for (const faixa of this.terreno.arestasSuperiores(0.5)) {
      p.moveTo(faixa[0].x, faixa[0].y);
      for (let i = 1; i < faixa.length; i++) p.lineTo(faixa[i].x, faixa[i].y);
    }
    this._cristasPronto = p;
    return p;
  }

  /**
   * A camada de terra iluminada logo abaixo da superfície pisável.
   * Chamar SEMPRE dentro de um `clip(path)`: o traço é largo e, sem recorte,
   * metade dele cai fora da rocha.
   */
  _crosta(ctx, tema) {
    const p = this._pathCristas();
    const pureza = tema.pureza ?? 0;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 1;
    /* A crosta somava ~6 níveis de luminância sobre o corpo — invisível. Uma
       faixa de terra iluminada precisa de ~30 níveis pra ler como superfície
       recebendo luz em vez de mais uma sombra. */
    ctx.strokeStyle = misturarHex(tema.terreno, tema.crista, lerp(0.7, 0.85, pureza));
    // Largura ímpar de propósito: metade do traço fica fora da silhueta e é
    // cortada pelo clip, então a "profundidade" real é metade do valor.
    const passos = [[54, 0.1], [34, 0.17], [18, 0.26], [8, 0.4]];
    for (const [larg, alfa] of passos) {
      ctx.globalAlpha = alfa * lerp(0.85, 1.25, pureza);
      ctx.lineWidth = larg;
      ctx.stroke(p);
    }
    ctx.globalAlpha = 1;
  }

  _cristas(ctx, tema) {
    const pureza = tema.pureza ?? 0;
    const path = this._pathCristas();

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // luz de borda
    ctx.strokeStyle = rgba(tema.crista, lerp(0.45, 0.9, pureza));
    ctx.lineWidth = 2.6;
    ctx.stroke(path);

    // segunda passada mais fina e mais clara, deslocada 1px pra cima —
    // sugere um bisel de luz em vez de uma linha chapada
    ctx.save();
    ctx.translate(0, -1.2);
    ctx.strokeStyle = rgba(misturarHex(tema.crista, '#ffffff', 0.4), lerp(0.15, 0.5, pureza));
    ctx.lineWidth = 1;
    ctx.stroke(path);
    ctx.restore();

    this._musgo(ctx, tema, this.terreno.arestasSuperiores(0.5), pureza);
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

    // O musgo depende SÓ da pureza (a geometria dos tufos é determinística
    // pela posição), então regenerá-lo a cada quadro é trabalho jogado fora.
    // Quantizar a pureza em 24 degraus e guardar o `Path2D` de cada degrau
    // torna a transição imperceptível — a pureza leva segundos pra subir — e
    // troca centenas de `stroke` por quadro por três.
    const degrau = Math.round(densidade * 23);
    if (this._musgoPronto?.degrau !== degrau) {
      this._musgoPronto = { degrau, ...this._construirMusgo(faixas, degrau / 23) };
    }
    const m = this._musgoPronto;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(tema.crista, lerp(0.25, 0.75, densidade));
    for (const b of m.laminas) {
      ctx.lineWidth = b.largura;
      ctx.stroke(b.path);
    }
    if (m.temFlores) {
      ctx.fillStyle = tema.acento;
      ctx.fill(m.flores);
    }
    ctx.restore();
  }

  /**
   * Monta os `Path2D` do musgo para uma dada densidade.
   * Mesma geometria de antes; só que gravada em caminhos agrupados por
   * espessura de lâmina em vez de desenhada direto.
   */
  _construirMusgo(faixas, densidade) {
    const NL = 3;
    const laminas = Array.from({ length: NL }, (_, i) => ({
      largura: lerp(1.5, 0.7, i / (NL - 1)),
      path: new Path2D(),
      vazia: true,
    }));
    const flores = new Path2D();
    let temFlores = false;

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

          /* Vão até o próximo tufo: irregular, e menor quanto mais viva a
             área. Com 9 px de piso e tufos de ±3,5 px, em pureza alta os
             tufos se encostavam e a borda inteira virava um PENTE contínuo —
             que é justamente o que o agrupamento em tufos existe pra evitar.
             15 px de piso mantém vão visível entre um e outro. */
          proximoTufo += lerp(38, 15, densidade) * lerp(0.45, 2, h2);

          if (h > densidade * 0.9) continue;

          const nLaminas = 3 + Math.floor(h2 * 4);
          // Faixa de altura mais larga: tufo todo do mesmo tamanho é o que
          // mais rápido denuncia repetição numa borda longa.
          const alturaTufo = lerp(4, 19, h) * densidade;

          for (let k = 0; k < nLaminas; k++) {
            const kf = nLaminas === 1 ? 0 : k / (nLaminas - 1) - 0.5;   // -0.5..0.5
            // Altura cai do meio pras pontas: dá forma de tufo, não de cerca.
            const alt = alturaTufo * (1 - Math.abs(kf) * 0.85) * lerp(0.7, 1.15, hash2(k, Math.round(bx), f));
            const raiz = { x: bx + tx * kf * 7, y: by + ty * kf * 7 };
            const curva = kf * 2.2 + (h - 0.5) * 0.9;
            const balde = laminas[Math.min(NL - 1, Math.floor(Math.abs(kf) * 2 * NL))];
            balde.path.moveTo(raiz.x, raiz.y);
            balde.path.quadraticCurveTo(
              raiz.x + nx * alt * 0.55 + tx * curva * 2,
              raiz.y + ny * alt * 0.55 + ty * curva * 2,
              raiz.x + nx * alt + tx * curva * 5,
              raiz.y + ny * alt + ty * curva * 5
            );
            balde.vazia = false;
          }

          // Flor no topo de um tufo, esporádica e só em pureza alta — é a
          // recompensa visual final da restauração, e vale exatamente porque
          // é rara.
          if (densidade > 0.6 && h < 0.13) {
            const alt = alturaTufo * 1.05;
            const r = lerp(1.4, 2.4, h2);
            const fx = bx + nx * alt, fy = by + ny * alt;
            flores.moveTo(fx + r, fy);
            flores.arc(fx, fy, r, 0, TAU);
            temFlores = true;
          }
        }
        percorrido += seg;
      }
    }

    return { laminas: laminas.filter((b) => !b.vazia), flores, temFlores };
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
