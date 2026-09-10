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
// O mesmo campo de vento do parallax: a samambaia do chão deita na mesma
// rajada que a folhagem do fundo, senão o primeiro plano lê como maquete.
import { vento, direcaoLuzArea } from './parallax.js';

export class ArteTerreno {
  /** @param {import('../mundo/terreno.js').Terreno} terreno */
  constructor(terreno, semente = 7) {
    this.terreno = terreno;
    this.semente = semente;
    this._cacheMusgo = null;
    this._cachePureza = -1;
  }

  /**
   * Joga fora tudo que foi pré-calculado a partir da geometria da sala.
   *
   * Hoje ninguém chama: `ArteTerreno` nasce junto com a sala e o terreno não
   * muda em runtime. Fica completo de propósito — no dia em que existir
   * terreno destrutível, o cache que ficar de fora daqui vira um pedaço de
   * sala que continua desenhado depois de ter deixado de existir, e esse é o
   * tipo de defeito que ninguém liga ao cache.
   */
  invalidar() {
    this._cacheSalientes = undefined;
    this._cacheEncontros = undefined;
    this._cacheFetos = null;
    this._musgoPronto = null;
    this._contornoPronto = null;
    this._cristasPronto = null;
  }

  /* --------------------------------------------------------------------- */

  desenhar(ctx, tema, camera, tempo = 0, area = null) {
    /* UMA direção de luz, a mesma que já rege o céu e os feixes. Antes cada
       forma era um preenchimento chapado com contorno arredondado: sem lado
       claro e lado escuro, o cérebro processa a tela como camadas empilhadas
       num editor vetorial, não como espaço com ar dentro. É a causa número um
       de a fase ler como colagem, e vale pra tudo que é desenhado. */
    this._luz = direcaoLuzArea(area ?? tema.area);
    // Guardado porque `_cristas`/`_samambaias` estão vários níveis abaixo e
    // passar tempo por toda a cadeia só pra folha balançar não vale a assinatura.
    this._tempo = tempo;
    const path = this.terreno.path();
    const alturaMundo = this.terreno.alturaPx;

    // --- 1. massa ------------------------------------------------------
    /* O degradê do corpo é de TELA, não da forma: uma rampa única aplicada a
       todo o terreno faz um pilar ficar claro no topo e escuro na base
       independentemente da forma dele — a definição de extrusão lisa. Encurtar
       a rampa pro terço de baixo deixa a maior parte da rocha em `terreno`
       chapado e passa o trabalho de volume pra oclusão e pra crosta, que
       seguem a SILHUETA. */
    const g = ctx.createLinearGradient(
      0, camera.viewY + camera.altura * 0.58, 0, camera.viewY + camera.altura);
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

    /* --- 3a. oclusão DIRECIONAL ----------------------------------------
       O mesmo contorno traçado largo, deslocado no sentido em que a luz
       viaja. O deslocamento faz a faixa escura cair sempre do lado oposto ao
       sol e sumir do lado voltado pra ele:
         · face de cima  → a faixa desce e vira sombra própria sob a aresta;
         · parede a favor→ a faixa entra na rocha e a aresta iluminada fica
                           limpa;
         · parede contra → metade da faixa cai bem na aresta, que é a que
                           está na sombra;
         · teto          → a faixa fica colada no teto, que é escuro mesmo.
       Um traço resolve os quatro casos porque a geometria é a mesma. */
    ctx.save();
    ctx.translate(this._luz.x * 11, this._luz.y * 11);
    ctx.strokeStyle = rgba(tema.borda, 0.42);
    ctx.lineWidth = 22;
    ctx.stroke(path);
    ctx.restore();

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

    // --- 4b. encontros de plano -----------------------------------------
    this._encontros(ctx, tema);

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
  /**
   * Onde a peça começa e termina NA TELA.
   *
   * Duas regras, e as duas custaram bug:
   *
   * 1. O recuo é sempre PRA DENTRO. A primeira versão sorteava de -6 a +10 px
   *    e desenhava até 10 px de plataforma que não era sólida — com tile de
   *    32 e caixa do jogador de 22, um terço de tile de chão falso: ele pousa
   *    no que vê e atravessa. Desenhar mais CURTO que a colisão erra pro lado
   *    perdoável (sobra beirada invisível onde ainda dá pra ficar); desenhar
   *    mais comprido erra pro lado que parece defeito do jogo.
   * 2. Isto é uma função, não duas linhas repetidas. O passe emissivo
   *    continuava traçando o brilho da face de `x0` a `x1` enquanto o corpo
   *    já estava em `bx0..bx1`, e sobrava um fio de luz pendurado no ar.
   */
  static _extremosPlataforma(f, tile, semente) {
    const x0 = f.cx0 * tile, x1 = (f.cx1 + 1) * tile;
    return {
      bx0: x0 + lerp(0, 5, hash2(f.cx0, f.cy, semente + 19)),
      bx1: x1 - lerp(0, 5, hash2(f.cx1, f.cy, semente + 23)),
    };
  }

  desenharPlataformas(ctx, tema, camera) {
    const t = this.terreno;
    const faixas = this._faixas(camera, PLATAFORMA);
    if (!faixas.length) return;

    this._sombraProjetada(ctx, tema, faixas);
    const pureza = tema.pureza ?? 0;

    for (const f of faixas) {
      const x0 = f.cx0 * t.tile;
      const x1 = (f.cx1 + 1) * t.tile;
      const y = f.cy * t.tile;
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
      /* ESPESSURA E PONTAS VARIÁVEIS.
         Os dois tipos existiam mas liam iguais, e o motivo é que tudo que
         variava entre eles era TEXTURA INTERNA — sulco de casca, trinca — e
         textura interna some a 40 px de tela. O que lê é a SILHUETA, e a
         silhueta era idêntica: mesma espessura, mesmas pontas travadas na
         grade de tiles, mesma face de cima reta de borda a borda.

         Agora a espessura varia ±25% por peça e as pontas saem da grade —
         nenhuma plataforma da sala começa e termina onde a grade manda. */
      const hEsp = hash2(f.cx0, f.cy, s + 17);
      const espessura = t.tile * (ehTronco ? 0.46 : 0.4) * lerp(0.78, 1.22, hEsp);
      const { bx0, bx1 } = ArteTerreno._extremosPlataforma(f, t.tile, s);
      const larg = bx1 - bx0;

      const arco = Math.min(4, larg * 0.012);
      /* A face de cima é onde o jogador pousa: o realce de topo e os sulcos
         precisam cair EM CIMA dela, degrau incluído. Enquanto `topoY`
         devolvia só o arco liso, o fio de luz de 1,6 px flutuava até 2,5 px
         fora da aresta desenhada em toda laje. */
      const nDeg = Math.max(3, Math.round(larg / 46));
      const degrauEm = (px) => {
        if (ehTronco) return 0;
        const i = Math.min(nDeg, Math.max(1, Math.ceil(((px - bx0) / larg) * nDeg)));
        const cx = bx0 + (larg * i) / nDeg;
        return (hash2(Math.round(cx), f.cy, s + 29) - 0.5) * 5;
      };
      const topoY = (px) => y + 1
        + arco * Math.sin(((px - bx0) / larg) * Math.PI) + degrauEm(px);
      ctx.beginPath();
      ctx.moveTo(bx0, y + 1);
      if (ehTronco) {
        ctx.quadraticCurveTo((bx0 + bx1) / 2, y + 1 + arco, bx1, y + 1);
      } else {
        /* LAJE: a face de cima é quebrada em degraus de 2 a 5 px. Uma aresta
           superior perfeitamente reta de 200 px é a coisa que mais denuncia
           geometria gerada — pedra não tem isso. */
        for (let i = 1; i <= nDeg; i++) {
          const px = bx0 + (larg * i) / nDeg;
          const dy = topoY(px);
          ctx.lineTo(px - larg / nDeg * 0.12, dy);
          ctx.lineTo(px, dy);
        }
      }
      /* AFUNILAMENTO. Toda plataforma da sala é um retângulo de altura
         constante, e a sala inteira lê como grade porque não existe uma única
         DIAGONAL na tela. A face de cima não pode inclinar — é nela que o
         jogador pousa, e mentir sobre isso é o defeito que acabou de ser
         corrigido. Mas a BARRIGA pode: um tronco grosso numa ponta e fino na
         outra dá a diagonal sem tocar em um pixel de colisão.
         O lado grosso vem do hash, então metade da sala afina pra um lado. */
      const afinaPara = hash2(f.cx0, f.cy, s + 31) < 0.5 ? 1 : -1;
      const forcaAfina = lerp(0.12, 0.5, hash2(f.cx1, f.cy, s + 37));
      const afinar = (px) => {
        const u = (px - bx0) / larg;                 // 0..1
        return 1 + (afinaPara > 0 ? (0.5 - u) : (u - 0.5)) * 2 * forcaAfina;
      };

      if (ehTronco) {
        // Barriga do tronco: uma curva cheia, e as pontas descem arredondadas
        // — é a curva que faz ler como cilindro em vez de tábua.
        ctx.quadraticCurveTo(bx1 + espessura * 0.5, y + espessura * 0.5 * afinar(bx1),
          bx1 - espessura * 0.35, y + espessura * afinar(bx1));
        const passos = Math.max(2, Math.round(larg / 26));
        for (let i = passos; i >= 0; i--) {
          const px = bx0 + (larg * i) / passos;
          const n = hash2(Math.round(px), f.cy, s);
          ctx.lineTo(px, y + espessura * afinar(px) * lerp(0.92, 1.06, n) + arco * 0.6);
        }
        ctx.quadraticCurveTo(bx0 - espessura * 0.5, y + espessura * 0.5 * afinar(bx0),
          bx0, y + 1);
      } else {
        // Laje: quebrada embaixo, com dentes maiores e desiguais.
        const passos = Math.max(2, Math.round(larg / 15));
        for (let i = passos; i >= 0; i--) {
          const px = bx0 + (larg * i) / passos;
          const n = hash2(Math.round(px), f.cy, s);
          ctx.lineTo(px, y + espessura * afinar(px) * lerp(0.45, 1.35, n * n) + arco * 0.6);
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
          for (let px = bx0 + 4; px <= bx1 - 4; px += 9) {
            const n = hash2(Math.round(px), f.cy + k * 10, s + 3);
            const yy = topoY(px) + espessura * k + (n - 0.5) * 1.6;
            px === bx0 + 4 ? ctx.moveTo(px, yy) : ctx.lineTo(px, yy);
          }
          ctx.stroke();
        }
        // Tampas de corte: o anel na ponta é o que diz "isto foi cortado".
        for (const [px, sinal] of [[bx0 + 2.5, -1], [bx1 - 2.5, 1]]) {
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
        const cx0 = bx0 + larg * lerp(0.25, 0.7, hc);
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
      /* A face de cima tinha 2,4 px de aresta dura, valor altíssimo e era
         idêntica em toda plataforma da sala: lia como barra cromada de
         interface. O valor fica (legibilidade de apoio vale mais que
         sutileza), mas o traço passa a ser desenhado em pedaços de alfa
         irregular, com um deslocamento de ruído — mantém a linha e tira o
         acabamento de UI. */
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      const corTopo = misturarHex(tema.crista, '#ffffff', 0.4);
      const passosTopo = Math.max(3, Math.round(larg / 18));
      for (let i = 0; i < passosTopo; i++) {
        const u0 = i / passosTopo, u1 = (i + 1) / passosTopo;
        const n = hash2(f.cx0 + i, f.cy, s + 7);
        ctx.strokeStyle = rgba(corTopo, lerp(0.85, 0.72, pureza) * lerp(0.45, 1, n));
        ctx.beginPath();
        ctx.moveTo(bx0 + 1 + larg * u0, topoY(bx0 + larg * u0) + (n - 0.5));
        ctx.lineTo(bx0 + 1 + larg * u1, topoY(bx0 + larg * u1) + (n - 0.5));
        ctx.stroke();
      }

      // Sombra projetada logo abaixo: descola a viga do fundo e reforça que
      // existe VÃO ali embaixo (por onde dá pra passar).
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = tema.ceuTopo;
      // Era o MESMO retângulo desfocado sob todas as plataformas da sala.
      const hs = hash2(f.cx0, f.cy, s + 13);
      ctx.lineWidth = lerp(4, 8, hs);
      ctx.beginPath();
      ctx.moveTo(bx0 + 4, y + espessura + lerp(3, 7, hs));
      ctx.lineTo(bx1 - 4, y + espessura + lerp(3, 7, hs));
      ctx.stroke();
      ctx.restore();


      // Vegetação pendurada quando a área revive.
      if (pureza > 0.25) {
        ctx.strokeStyle = rgba(tema.crista, (pureza - 0.25) * 0.7);
        ctx.lineWidth = 1;
        for (let px = bx0 + 6; px < bx1 - 4; px += 9) {
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
  /**
   * A sombra que a plataforma joga no chão que está embaixo dela.
   *
   * É a peça que faltava pra plataforma parar de flutuar. Sombra de contato
   * resolve quem está APOIADO; o que não existia era a projeção de quem está
   * suspenso, e sem ela cada laje é um adesivo colado sobre o fundo.
   *
   * A direção do deslocamento é a mesma `direcaoLuzArea` do céu e dos feixes
   * — é isso que faz as sombras da sala concordarem entre si em vez de
   * parecerem três sóis. E ela enfraquece e alarga com a altura da queda,
   * que é como o olho lê "isso está longe do chão".
   *
   * Vai ANTES do corpo da plataforma de propósito: o terreno já está
   * pintado, a plataforma ainda não, então a sombra cai só no que está atrás.
   */
  _sombraProjetada(ctx, tema, faixas) {
    const t = this.terreno;
    const luz = this._luz ?? { x: 0, y: 1 };
    ctx.save();
    for (const f of faixas) {
      const { bx0, bx1 } = ArteTerreno._extremosPlataforma(f, t.tile, this.semente);
      const meio = (bx0 + bx1) / 2;
      const base = (f.cy + 1) * t.tile;
      const queda = t.alturaAteChao(meio, base + 2, 9);
      // Sem chão à vista embaixo: a sombra não cairia em lugar nenhum.
      if (!Number.isFinite(queda) || queda < 4) continue;

      const k = clamp01(1 - queda / 260);
      if (k <= 0.04) continue;
      const cx = meio + luz.x * queda * 0.55;
      const cy = base + queda;
      const rx = (bx1 - bx0) * lerp(0.5, 0.85, 1 - k);
      const ry = Math.max(5, rx * 0.16);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, ry / rx);
      /* Gradiente montado DEPOIS do translate, centrado na origem. Um
         `createRadialGradient(cx, cy, …)` seguido de `translate(cx, cy)` põe
         o centro do degradê no dobro da distância: as coordenadas do
         gradiente são lidas na transformação vigente na hora do `fill`, não
         na hora da criação. */
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, rgba(tema.borda, 0.4 * k));
      g.addColorStop(0.45, rgba(tema.borda, 0.2 * k));
      g.addColorStop(1, rgba(tema.borda, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

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

        /* 3 pontas por tile.
           A fileira lia como saída de laço `for`: nove triângulos de mesma
           altura, mesma largura, mesmo espaçamento e todos verticais. Agora
           cada um tem altura quadrática (a maioria baixa, poucos altos) e
           INCLINAÇÃO própria — é o desalinho que quebra a fileira.

           E o valor da ponta caiu. Era `acento` misturado com 35% de branco:
           luminância ~170 num quadro cuja coisa mais clara depois do herói
           tinha ~135. O espinho era o objeto mais claro da tela, ou seja, o
           quadro inteiro apontava pro perigo em vez de apontar pro
           personagem. Perigo se sinaliza por forma e posição; brilho é do
           herói e do objetivo. */
        for (let i = 0; i < 3; i++) {
          const n = hash2(cx * 3 + i, f.cy, this.semente + 5);
          const n2 = hash2(cx * 3 + i, f.cy, this.semente + 61);
          const px = x + (i + 0.5) * (t.tile / 3) + (n - 0.5) * 5;
          const alt = t.tile * lerp(0.32, 1, n * n) * dir;
          const meia = t.tile * lerp(0.085, 0.17, n2);
          const torto = (n2 - 0.5) * meia * 2.4;

          const g = ctx.createLinearGradient(0, baseY, 0, baseY + alt);
          g.addColorStop(0, misturarHex(tema.terrenoFundo, tema.ceuTopo, 0.5));
          g.addColorStop(1, misturarHex(tema.crista, tema.acento, 0.5));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(px - meia, baseY);
          // Curva para dentro: espinho reto lê como triângulo de sinalização,
          // curvo lê como coisa crescida.
          ctx.quadraticCurveTo(px - meia * 0.35 + torto * 0.5, baseY + alt * 0.55,
            px + torto, baseY + alt);
          ctx.quadraticCurveTo(px + meia * 0.35 + torto * 0.5, baseY + alt * 0.55,
            px + meia, baseY);
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
      const e = ArteTerreno._extremosPlataforma(f, t.tile, this.semente);
      ctx.beginPath();
      ctx.moveTo(e.bx0, y);
      ctx.lineTo(e.bx1, y);
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
          ? rgba(tema.terrenoFundo, 0.36)
          : rgba(misturarHex(tema.terreno, tema.crista, 0.35), 0.24);
        /* Jitter MAIOR que o passo e faixa de raio quadrática. Com jitter de
           meio passo e raio numa faixa estreita, as manchas formavam uma
           treliça de 30 px — a autocorrelação das arestas da cena tinha pico
           exatamente nesse lag, e na tela viravam seixos idênticos dentro da
           rocha. */
        ctx.beginPath();
        ctx.ellipse(
          x + (h - 0.5) * passo * 2.8, y + (h2 - 0.5) * passo * 2.8,
          lerp(4, 26, h * h), lerp(3, 15, h2 * h2),
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
    /* 0.5 aceita aresta até 60° da horizontal. Num canto arredondado pelo
       Chaikin isso inclui o filete inteiro, que desce pelas laterais e pela
       barriga da peça: a luz de crista dava a volta em tudo e virava o
       "contorno de PowerPoint" que o cabeçalho deste arquivo diz evitar.
       0.86 é ~30°, que é onde a luz do céu realmente bate. */
    for (const faixa of this.terreno.arestasSuperiores(0.86)) {
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
    /* Larguras em proporção ao tile. Um traço de 54 px num braço de terreno
       de 1 tile (32 px) inunda a peça inteira de cima a baixo — e era isso
       que fazia pilar e viga lerem como cano de PVC estofado. */
    const k = this.terreno.tile / 32;
    const passos = [[26 * k, 0.1], [16 * k, 0.17], [9 * k, 0.26], [4 * k, 0.4]];
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

    this._salientes(ctx, tema);
    this._musgo(ctx, tema, this.terreno.arestasSuperiores(0.5), pureza);
    this._samambaias(ctx, tema, pureza);
  }

  /**
   * SAMAMBAIAS — a forma que só existe com o mundo restaurado.
   *
   * A restauração era um filtro de cor: a mesma sala, mesma silhueta, outra
   * paleta. Medido, o quadro restaurado e o poluído eram quase idênticos em
   * FORMA — e o jogo inteiro se chama "traga a cor de volta", o que torna
   * essa a promessa mais importante da fase.
   *
   * Uma fronde tem contorno que nada mais na cena tem: um eixo em arco com
   * folíolos que encolhem até a ponta. Ela aparece a partir de 22% de pureza
   * e cresce com ela — então o jogador vê a sala mudar de SILHUETA, não de
   * filtro. E deita no mesmo vento do parallax.
   *
   * As âncoras saem das arestas pisáveis uma vez por sala; o que muda por
   * quadro é quantas desenham e de que tamanho, que é barato.
   */
  _samambaias(ctx, tema, pureza) {
    if (pureza < 0.22) return;
    if (!this._cacheFetos) {
      const pts = [];
      for (const faixa of this.terreno.arestasSuperiores(0.86)) {
        let percorrido = 0;
        let proxima = 40 + hash2(Math.round(faixa[0].x), Math.round(faixa[0].y), 137) * 120;
        for (let i = 0; i < faixa.length - 1; i++) {
          const a = faixa[i], b = faixa[i + 1];
          const seg = Math.hypot(b.x - a.x, b.y - a.y) || 0.001;
          while (percorrido + seg > proxima) {
            const u = (proxima - percorrido) / seg;
            const x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u;
            /* TOUCEIRA. Sem esta peneira a samambaia nascia a cada ~110 px em
               TODA aresta pisável da sala, e o resultado é uma franja: uma
               orla decorativa correndo por baixo de cada plataforma, com o
               mesmo passo, que denuncia geração tanto quanto o musgo contínuo
               que já foi corrigido antes por este mesmo motivo. Planta cresce
               onde pegou — em moita, com vãos pelados entre elas. */
            if (hash2(Math.round(x / 150), Math.round(y / 90), 151) > 0.52) {
              proxima += 60 + hash2(Math.round(x), Math.round(y), 149) * 120;
              continue;
            }
            pts.push({ x, y, h: hash2(Math.round(x), Math.round(y), 139) });
            proxima += 26 + hash2(Math.round(x), Math.round(y), 149) * 120;
          }
          percorrido += seg;
        }
      }
      this._cacheFetos = pts;
    }
    if (!this._cacheFetos.length) return;

    const abre = clamp01((pureza - 0.22) / 0.6);
    const cor = misturarHex(tema.crista, tema.acento, lerp(0.3, 0.72, pureza));
    /* Dois caminhos, dois `stroke()`. Emitindo por fronde eram 9 a 15
       `stroke()` cada uma, e nasce ~1 fronde a cada 100 px de aresta pisável:
       200 a 500 chamadas por quadro numa sala média. É o mesmo agrupamento
       que o musgo já usa; o vento continua entrando porque quem varia por
       quadro é a GEOMETRIA, e ela é remontada de qualquer jeito. */
    const eixos = new Path2D();
    const foliolos = new Path2D();
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = cor;
    for (const f of this._cacheFetos) {
      // Nem toda âncora abre de uma vez: as de hash baixo brotam primeiro.
      const meu = clamp01((abre - f.h * 0.55) / 0.45);
      if (meu <= 0.02) continue;
      // Faixa larga de tamanho: fronde nova de 8 px ao lado de uma de 38 é o
      // que faz ler como moita em vez de escova.
      // Piso de 15: abaixo disso os folíolos ficam com 2 px e a fronde lê
      // como pente, não como samambaia.
      const comp = lerp(15, 40, f.h * f.h) * meu;
      const lado = f.h < 0.5 ? -1 : 1;
      const dobra = vento(this._tempo ?? 0, f.x) * 0.16;
      const curva = lado * lerp(0.35, 0.85, f.h) + dobra;

      eixos.moveTo(f.x, f.y + 1);
      eixos.quadraticCurveTo(f.x + curva * comp * 0.15, f.y - comp * 0.7,
        f.x + curva * comp, f.y - comp);

      // Folíolos: encolhem até a ponta. É esse gradiente que faz "fronde".
      const n = 4 + Math.round(f.h * 3);
      for (let i = 1; i <= n; i++) {
        const tt = i / (n + 1);
        const ex = f.x + curva * comp * (0.15 * 2 * tt * (1 - tt) + tt * tt);
        const ey = f.y - comp * tt;
        const lf = comp * 0.34 * (1 - tt * 0.85);
        for (const sgn of [-1, 1]) {
          foliolos.moveTo(ex, ey);
          foliolos.quadraticCurveTo(ex + sgn * lf * 0.7, ey - lf * 0.1,
            ex + sgn * lf, ey + lf * 0.35);
        }
      }
    }
    ctx.lineWidth = 1.5; ctx.stroke(eixos);
    ctx.lineWidth = 1.1; ctx.stroke(foliolos);
    ctx.restore();
  }

  /**
   * Sombra de contato de uma coisa apoiada no chão.
   *
   * Sem ela, personagem e criatura ficam COLADOS por cima do plano em vez de
   * apoiados nele — é o detalhe mais barato que existe e o que mais separa
   * "colagem" de "lugar". Elipse macia, mais larga que alta, e que encolhe e
   * escurece conforme a coisa sobe: é assim que o olho lê altura.
   *
   * @param {number} alturaDoChao  0 = tocando, 1 = longe (some)
   */
  static contato(ctx, tema, x, y, largura, alturaDoChao = 0, forca = 1) {
    const k = clamp01(1 - alturaDoChao) * clamp01(forca);
    if (k <= 0.02) return;
    const rx = largura * lerp(0.8, 0.55, 1 - k);
    const ry = rx * 0.28;
    /* Queda LONGA. Com o degradê caindo a zero só no raio final, a borda da
       elipse encontrava o brilho do herói num anel visível — lia como um
       decalque, não como sombra. A opacidade cai quase toda no primeiro
       terço e o resto é bruma. */
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    /* Montado DEPOIS do translate: as coordenadas do gradiente são lidas na
       transformação vigente na hora do `fill`. Criado antes, com centro em
       (x, y), o degradê ia parar no DOBRO da distância e o que sobrava aqui
       era a cor da última parada — a razão do anel duro que apareceu sob o
       herói na primeira captura. */
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, rgba(tema.primeiroPlano, 0.42 * k));
    g.addColorStop(0.35, rgba(tema.primeiroPlano, 0.2 * k));
    g.addColorStop(0.68, rgba(tema.primeiroPlano, 0.06 * k));
    g.addColorStop(1, rgba(tema.primeiroPlano, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /**
   * SAPOPEMA — o alargamento onde uma parede encontra o chão.
   *
   * É o que faltava pra sala parar de ler como andaime. Numa sala montada em
   * grade, todo encontro de plano é um ângulo reto perfeito, e vinte ângulos
   * retos perfeitos na mesma tela leem como estrutura montada, não como
   * lugar: nada na natureza encosta em outra coisa sem engrossar no
   * encontro. Raiz de árvore, base de pilar, pé de barranco — todos abrem.
   *
   * A forma é um triângulo de hipotenusa CÔNCAVA: sobe colada ao chão e só
   * então dispara pela parede. Côncava é o que distingue "cresceu" de
   * "chanfro de CAD". Vem escura de propósito (mistura com `borda`), porque
   * canto interno é onde a luz do céu não chega — o mesmo traço resolve a
   * forma e a oclusão.
   *
   * Puro desenho, como as `_salientes`: fica em canto CÔNCAVO, então não tem
   * como virar degrau falso.
   */
  _encontros(ctx, tema) {
    if (this._cacheEncontros === undefined) {
      const t = this.terreno.tile;
      const p = new Path2D();
      const raizes = new Path2D();
      let tem = false;

      for (const faixa of this.terreno.arestasSuperiores(0.86)) {
        for (const ponta of [faixa[0], faixa[faixa.length - 1]]) {
          for (const lado of [-1, 1]) {
            // Parede subindo de um lado e ar do outro: canto interno.
            if (!this.terreno._solidoVisualPx(ponta.x + lado * t * 0.45, ponta.y - t * 0.5)) continue;
            if (this.terreno._solidoVisualPx(ponta.x - lado * t * 0.45, ponta.y - t * 0.5)) continue;

            const rx = Math.round(ponta.x), ry = Math.round(ponta.y);
            const L = t * lerp(0.5, 1.25, hash2(rx, ry, 83));
            const H = t * lerp(0.4, 1.05, hash2(rx, ry, 89));
            p.moveTo(ponta.x - lado * L, ponta.y + 1);
            p.quadraticCurveTo(
              ponta.x - lado * L * 0.24, ponta.y - H * 0.1,
              ponta.x - lado * 0.5, ponta.y - H
            );
            p.lineTo(ponta.x + lado * 2, ponta.y - H);
            p.lineTo(ponta.x + lado * 2, ponta.y + 1);
            p.closePath();

            // Duas ou três raízes finas escorrendo pelo chão a partir do pé.
            const n = 2 + Math.floor(hash2(rx, ry, 97) * 2);
            for (let i = 0; i < n; i++) {
              const h = hash2(rx + i * 7, ry, 101);
              const comp = t * lerp(0.5, 1.6, h);
              const y0 = ponta.y - H * lerp(0.05, 0.5, h);
              raizes.moveTo(ponta.x - lado * 1, y0);
              raizes.quadraticCurveTo(
                ponta.x - lado * comp * 0.5, y0 + (ponta.y - y0) * 0.35,
                ponta.x - lado * comp, ponta.y + lerp(-1, 1.5, h)
              );
            }
            tem = true;
          }
        }
      }
      this._cacheEncontros = tem ? { p, raizes } : null;
    }
    if (!this._cacheEncontros) return;

    const pureza = tema.pureza ?? 0;
    ctx.save();
    ctx.fillStyle = misturarHex(tema.terreno, tema.borda, 0.5);
    ctx.fill(this._cacheEncontros.p);
    ctx.strokeStyle = rgba(misturarHex(tema.terreno, tema.crista, lerp(0.25, 0.5, pureza)), 0.7);
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.stroke(this._cacheEncontros.raizes);
    ctx.restore();
  }

  /**
   * Pedras e tocos encravados na beirada.
   *
   * O contorno sai de uma escada de tiles ortogonal com 4 px de ruído e um
   * Chaikin por cima: o resultado é um retângulo de canto arredondado, sem
   * uma diagonal, sem saliência, sem nada que quebre a linha. É o que mais
   * separa "tilemap desenhado" de "terreno".
   *
   * Estas formas são puro desenho — vão POR CIMA do contorno e não tocam a
   * colisão, então nenhuma delas pode virar degrau falso para o jogador: são
   * baixas de propósito, e sempre menores que a altura de um passo.
   */
  _salientes(ctx, tema) {
    if (!this._cacheSalientes) {
      const p = new Path2D();
      let tem = false;
      for (const faixa of this.terreno.arestasSuperiores(0.5)) {
        let percorrido = 0;
        let proxima = hash2(Math.round(faixa[0].x), Math.round(faixa[0].y), 71) * 90;
        for (let i = 0; i < faixa.length - 1; i++) {
          const a = faixa[i], b = faixa[i + 1];
          const dx = b.x - a.x, dy = b.y - a.y;
          const seg = Math.hypot(dx, dy) || 0.001;
          while (proxima <= percorrido + seg) {
            const t = (proxima - percorrido) / seg;
            const bx = a.x + dx * t, by = a.y + dy * t;
            const h = hash2(Math.round(bx), Math.round(by), 73);
            const h2 = hash2(Math.round(by), Math.round(bx), 79);
            proxima += lerp(70, 170, h2);
            if (h > 0.62) continue;
            const larg = lerp(9, 26, h2);
            const alt = lerp(5, 14, h);
            const nx = dy / seg, ny = -dx / seg;
            const tx = dx / seg, ty = dy / seg;
            // Meia-cúpula irregular assentada na aresta, um pouco enterrada.
            p.moveTo(bx - tx * larg, by - ny * 1 - ty * larg);
            for (let k = 1; k <= 7; k++) {
              const u = k / 8;
              const rr = alt * Math.sin(u * Math.PI) * lerp(0.7, 1.25, hash2(k, Math.round(bx), 83));
              p.lineTo(bx + tx * larg * (u * 2 - 1) + nx * rr,
                by + ty * larg * (u * 2 - 1) + ny * rr);
            }
            p.lineTo(bx + tx * larg, by + ty * larg);
            p.closePath();
            tem = true;
          }
          percorrido += seg;
        }
      }
      this._cacheSalientes = tem ? p : null;
    }
    if (!this._cacheSalientes) return;
    // Mais CLARO que o corpo, não mais escuro: pedra encravada recebe a mesma
    // luz do céu que a superfície. Escura, ela lia como buraco.
    ctx.fillStyle = misturarHex(tema.terreno, tema.crista, 0.3);
    ctx.fill(this._cacheSalientes);
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
          /* Segunda passada no mesmo problema. Com 15 px de piso em pureza
             alta e tufos de 7 px de base, o vão médio caía pra ~8 px: o pente
             voltou, agora sob a samambaia nova. O piso alto continua e o
             sorteio ficou mais largo — o que separa moita de escova é o
             tamanho dos VÃOS, não o dos tufos. */
          proximoTufo += lerp(38, 24, densidade) * lerp(0.45, 2.4, h2);

          /* Portão de baixa frequência ANTES do sorteio de densidade. Com
             espaçamento médio de ~18 px numa borda de 1280, saíam uns setenta
             leques iguais em fila: um pente. O ruído abre trechos de borda
             pelada, que é o que faz o musgo ler como manchas de vegetação. */
          if (ruido1(bx * 0.006, this.semente + 91) < 0.5) {
            proximoTufo += 45;
            continue;
          }
          if (h > densidade * 0.9) continue;

          const nLaminas = 3 + Math.floor(h2 * 4);
          // Faixa de altura mais larga: tufo todo do mesmo tamanho é o que
          // mais rápido denuncia repetição numa borda longa.
          // Faixa bem mais larga, e quadrática: a maioria baixa, uns poucos
          // altos. Faixa estreita é o que faz todo tufo parecer o mesmo.
          // Expoente 1,5 em vez de 2: sem tantos tufos de 3 px, que a essa
          // escala não leem como planta e sim como serrilha na borda.
          const alturaTufo = lerp(5, 36, Math.pow(h, 1.5)) * densidade;

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
