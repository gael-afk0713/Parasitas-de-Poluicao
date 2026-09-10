/* =========================================================================
   fase2/entidades/parasitas.js — o bestiário
   -------------------------------------------------------------------------
   A poluição virada criatura. Não são monstros genéricos: cada um é uma forma
   de dano ambiental que ganhou corpo, e cada um faz uma PERGUNTA DIFERENTE ao
   jogador. Se dois se resolvem do mesmo jeito, um dos dois não deveria
   existir — é o critério usado pra decidir o que entra aqui.

     Errante    andar e virar na borda      → timing e posicionamento
     Espreita   flutua, ignora terreno      → controle no ar
     Cuspidor   ancorado, atira em arco     → aproximar sob fogo
     Rastejante corre por parede e teto     → ameaça que muda de superfície
     Estopim    persegue e explode          → desengajar em vez de brigar
     Tecelão    emboscada de cima           → olhar pra cima antes de passar

   REGRA INEGOCIÁVEL: tudo que causa dano tem TELEGRAFO de pelo menos 0,25 s,
   com sinal visível (o corpo infla, as fendas acendem, a criatura para).
   Morte sem aviso não é dificuldade, é ruído — e num jogo escuro como este a
   tentação de esconder ameaça é grande, então a regra fica escrita.

   VISUAL: todos compartilham a linguagem da Sombra — massa preta encapuzada,
   fendas brancas no lugar de rosto, tentáculos saindo só do hemisfério
   superior, barra do manto esfarrapada. A silhueta é o que os distingue à
   distância, não a cor: o Espreita é redondo e sem barra, o Cuspidor é
   pesado e assimétrico, o Estopim incha, o Tecelão pende de um fio.
   ========================================================================= */

import {
  TAU, clamp, clamp01, lerp, damp, sign, rgba, misturarHex,
  easeOutCubic, easeOutQuad, hash2, dist,
} from '../core/mat.js';
import { luzRadial } from '../render/renderizador.js';
import { PLATAFORMA } from '../mundo/terreno.js';
import { atirarArco, atirarSpray, Explosao } from './projeteis.js';

const GRAVIDADE = 1500;
const VEL_QUEDA_MAX = 800;

/* =========================================================================
   BASE — física, dano e a aparência de Sombra
   ========================================================================= */

export class Sombra {
  /**
   * @param {{x:number,y:number,cx:number,cy:number}} obj  posição do mapa
   * @param {object} forma  parâmetros de silhueta (ver comentários)
   */
  constructor(obj, forma = {}) {
    this.largura = forma.largura ?? 30;
    this.altura = forma.altura ?? 32;
    // O mapa dá o ponto no CHÃO da célula; subimos a criatura pra ela nascer
    // apoiada e não meio enterrada.
    this.x = obj.x - this.largura / 2;
    this.y = obj.y - this.altura;
    this.cxInicial = obj.cx; this.cyInicial = obj.cy;

    this.vx = 0; this.vy = 0;
    this.dir = hash2(obj.cx, obj.cy, 7) < 0.5 ? -1 : 1;

    this.vida = forma.vida ?? 2;
    this.vidaMax = this.vida;
    this.dano = forma.dano ?? 1;
    this.morta = false;
    this.perigoso = true;

    this.t = hash2(obj.cx, obj.cy, 11) * 10;   // dessincroniza a ondulação
    this.piscarDano = 0;
    this.recuoX = 0;
    this.telegrafo = 0;        // 0..1 — quanto está "carregando" um ataque
    this.morrendo = 0;

    // --- silhueta ---
    this.raio = forma.raio ?? 13;
    this.temManto = forma.temManto ?? true;
    this.gravidade = forma.gravidade ?? true;

    /* Proporção da mancha. É o que diferencia as seis espécies a 26 px de
       tela — raio ±3 px e ±2 tentáculos não diferenciam nada. */
    this.escalaX = forma.escalaX ?? 1;
    this.escalaY = forma.escalaY ?? 1;

    /* OS CHIFRES (antes: "tentáculos").
       Eram SETE, num leque simétrico de 190°, e o do meio era o mais longo
       (`lerp(0.6, 1.25, sin(f·π))`) — que é exatamente a proporção de uma mão
       humana. Com comprimento de até 39 px saindo de um corpo de raio 13, o
       desenho ficava 3× mais largo que a hitbox e a massa era 11% da
       silhueta (numa Sombra de verdade é 65-75%). A criatura lia como uma
       MÃO ABERTA, não como uma coisa encapuzada.

       Agora são poucos, CURTOS (nunca passam de 0,9·raio), varridos pra trás
       — o que de quebra dá direção à criatura, coisa que antes era impossível
       de ler — e o perfil está invertido: as pontas do leque são as longas. */
    const nTent = forma.tentaculos ?? 2;
    const espalha = forma.espalhaTentaculos ?? 1;
    this.tentaculos = Array.from({ length: nTent }, (_, i) => {
      const f = nTent === 1 ? 0.5 : i / (nTent - 1);
      const h = hash2(obj.cx + i, obj.cy, 23);
      return {
        /* Faixa escolhida pra `cos(ang)` ficar SEMPRE positivo (0,15 a 0,81):
           o desenho insere os chifres no lado direito do capuz, e um chifre
           com cosseno negativo desenhava um esporão atravessando o corpo. A
           varredura pra trás (que é quem dá a direção) entra depois, no
           desenho, e aí sim pode cruzar pro outro lado. */
        ang: lerp(-1.42, -0.62, f) * espalha - (1 - espalha) * 1.02
             + (h - 0.5) * 0.16,
        comp: Math.min(this.raio * 0.9, (forma.compTentaculo ?? 11)
          * lerp(1.15, 0.55, Math.sin(f * Math.PI)) * (0.85 + h * 0.3)),
        fase: h * TAU,
        vel: 0.7 + h * 0.8,
        curva: (f - 0.5) * 1.7 + (h - 0.5) * 0.4,
      };
    });

    /* AS FENDAS.
       Eram cinco riscos de 1,15 px de meia-largura espremidos numa faixa de
       11 px — um terço da área do olho do herói — e ficavam ENTERRADOS: as
       bases dos sete tentáculos convergiam exatamente sobre eles. Na tela
       sobrava um olho visível, às vezes dois.

       Duas fendas grandes, com vão escuro entre elas e inclinadas pra dentro
       (carranca). O rosto é a âncora de reconhecimento da Sombra. */
    /* UM OLHO SÓ, FORA DO EIXO — o padrão da espécie.
       Duas fendas simétricas leem como ROSTO, e rosto já é do Guardião: ele
       tem dois olhos grandes e claros, e os parasitas tinham dois olhos
       grandes e claros. A 26 px de tela os dois usavam o mesmo símbolo, e o
       jogador lia "personagem" nos dois — a criatura perdia a estranheza
       inteira antes mesmo de se mexer.

       Um olho só, deslocado do centro e inclinado, não lê como rosto: lê
       como coisa. E a posição vem do hash da criatura, então dois Errantes
       lado a lado não são a mesma figura duas vezes. */
    const nOlhos = forma.olhos ?? 1;
    this.olhos = Array.from({ length: nOlhos }, (_, i) => {
      if (nOlhos === 1) {
        const hx = hash2(obj.cx, obj.cy, 61);
        const hy = hash2(obj.cx, obj.cy, 67);
        return {
          // Sempre adiantado na direção do olhar — a fenda é o que diz pra
          // que lado a criatura anda, e isso é informação de jogo.
          dx: this.raio * lerp(0.08, 0.30, hx),
          dy: -this.raio * lerp(0.40, 0.62, hy),
          larg: this.raio * 0.30,
          alt: this.raio * 0.44,
          giro: lerp(-0.55, -0.14, hy),
          fase: hash2(obj.cx, obj.cy + i, 29) * TAU,
        };
      }
      const f = i / (nOlhos - 1);
      const lado = f < 0.5 ? -1 : 1;
      return {
        /* `alt` era 0,52·raio: 13,5 px num corpo de 29 de altura, ou seja 47%
           da criatura em branco puro — na Sombra do Hollow Knight é menos de
           3%. E o topo da fenda caía a 0,15 px da borda do capuz, então o
           contorno APARAVA os olhos e eles liam como furo.

           O giro também estava invertido: com os topos convergindo pro centro
           o resultado é olho triste, não carranca. Carranca é o oposto — os
           topos abrem e as pontas internas descem. */
        dx: nOlhos === 1 ? 0 : lado * this.raio * 0.36,
        dy: -this.raio * 0.5,
        alt: this.raio * 0.34,
        giro: lado * 0.3,
        fase: hash2(obj.cx, obj.cy + i, 29) * TAU,
      };
    });
    /* A barra do manto desce até 2,4·raio abaixo do centro, mas a caixa da
       criatura tem só `altura`: com o desenho centrado no centro da caixa, a
       franja entrava uns 15 px no chão e a criatura lia como mato nascendo do
       piso. Este deslocamento apoia a ponta da barra exatamente nos pés.
       Quem flutua não precisa (e não deve) ser apoiado. */
    this.deslocDesenhoY = (this.temManto && this.gravidade)
      ? this.altura / 2 - this.raio * 1.7 : 0;

    // Piscada: um piscar vale mais que qualquer tremeluzir. Dessincronizado
    // por criatura, senão a sala inteira pisca junto.
    this._proxPiscada = 1 + hash2(obj.cx, obj.cy, 43) * 5;
    this._piscando = 0;

    /* `dir` troca de sinal num quadro só, e com ele a inclinação do corpo
       (0,24 rad) e o arrasto da barra (5,7 px) davam um POP sem antecipação
       — na única ação legível que o Errante tem. `dirSuave` faz a virada
       durar uns 0,25 s de manto arrastando, que é a antecipação que o jogador
       precisa pra reagir. */
    this.dirSuave = this.dir;
  }

  get centroX() { return this.x + this.largura / 2; }
  get centroY() { return this.y + this.altura / 2; }

  /**
   * Caixa de DANO — segue o capuz, não a caixa de colisão.
   *
   * Com `deslocDesenhoY` apoiando a barra do manto no chão, o capuz sobe: no
   * Errante o rosto inteiro ficava ACIMA da caixa antiga, e o golpe só
   * contava quando cruzava o manto. Num bicho em que o rosto é a âncora de
   * leitura e o alvo natural do olho, isso é mira mentindo. A área continua
   * praticamente a mesma; o que muda é ficar em cima do que se está mirando.
   */
  caixa() {
    const cy = this.centroY + this.deslocDesenhoY;
    return {
      x: this.centroX - this.raio * 0.82 * this.escalaX,
      y: cy - this.raio * 1.0 * this.escalaY,
      largura: this.raio * 1.64 * this.escalaX,
      altura: this.raio * 2.0 * this.escalaY,
    };
  }

  /* -------------------------------------------------------------- passo -- */

  atualizar(dt, mundo) {
    this.t += dt;
    this.piscarDano = Math.max(0, this.piscarDano - dt);
    this.dirSuave = damp(this.dirSuave, this.dir, 0.09, dt);

    /* ECO. Duas posições que perseguem a criatura com atraso — a segunda
       persegue a PRIMEIRA, não a criatura, então o rastro curva junto em vez
       de sair reto.

       Parada, elas alcançam a criatura e o rastro desaparece sozinho: é o
       movimento que revela o borrão, que é o comportamento certo. Sem isso
       toda criatura desliza pela cena sem deixar marca e a sala inteira lê
       como um mostruário de adesivos em movimento. */
    if (this._ecoX === undefined) {
      this._ecoX = this.centroX; this._ecoY = this.centroY;
      this._eco2X = this.centroX; this._eco2Y = this.centroY;
    }
    this._ecoX = damp(this._ecoX, this.centroX, 0.055, dt);
    this._ecoY = damp(this._ecoY, this.centroY, 0.055, dt);
    this._eco2X = damp(this._eco2X, this._ecoX, 0.055, dt);
    this._eco2Y = damp(this._eco2Y, this._ecoY, 0.055, dt);

    // Piscar > tremeluzir: o alfa dos olhos era uma senoide permanente, que
    // lê como vaga-lume. Uma piscada curta e rara lê como encarada.
    if (this._piscando > 0) this._piscando -= dt;
    else if ((this._proxPiscada -= dt) <= 0) {
      this._piscando = 0.06;
      this._proxPiscada = 3 + hash2(this.cxInicial, Math.round(this.t), 47) * 3;
    }

    if (this.morrendo > 0) {
      this.morrendo += dt * 2.6;
      if (this.morrendo >= 1) this.morta = true;
      return;
    }

    this.comportamento(dt, mundo);

    // Recuo de dano some sozinho, somado por cima do movimento próprio.
    if (Math.abs(this.recuoX) > 1) {
      this.x += this.recuoX * dt;
      this.recuoX = damp(this.recuoX, 0, 0.11, dt);
    }
  }

  /** Sobrescrito por cada tipo. A base só cai. */
  comportamento(dt, mundo) {
    this._aplicarGravidade(dt, mundo);
  }

  _aplicarGravidade(dt, mundo) {
    if (!this.gravidade) return;
    this.vy = Math.min(this.vy + GRAVIDADE * dt, VEL_QUEDA_MAX);
    mundo.sala.terreno.mover(this, this.vx * dt, this.vy * dt);
  }

  /** Anda e vira ao bater na parede OU ao chegar na beirada da plataforma. */
  _patrulhar(dt, mundo, vel) {
    const terreno = mundo.sala.terreno;
    this.vx = vel * this.dir;
    this.vy = Math.min(this.vy + GRAVIDADE * dt, VEL_QUEDA_MAX);

    const antes = this.x;
    terreno.mover(this, this.vx * dt, this.vy * dt);

    // Sem o teste de beirada o parasita despenca da plataforma e a sala se
    // esvazia sozinha depois de alguns segundos.
    const sondaX = this.dir > 0 ? this.x + this.largura + 2 : this.x - 6;
    const semChaoAdiante = !terreno.caixaSolida(sondaX, this.y + this.altura + 2, 4, 8)
      && terreno.emPx(sondaX, this.y + this.altura + 4) !== PLATAFORMA;
    const bateuParede = Math.abs(this.x - antes) < Math.abs(this.vx * dt) * 0.6;
    if (bateuParede || semChaoAdiante) this.dir *= -1;
  }

  /* --------------------------------------------------------------- dano -- */

  receberDano(n, deX, deY, mundo) {
    if (this.morrendo > 0) return;
    this.vida -= n;
    this.piscarDano = 0.13;
    this.recuoX = sign(this.centroX - deX) * 190;

    mundo.emitir(this.centroX, this.centroY, 9, {
      velMin: 70, velMax: 220, g: 260, vidaMin: 0.2, vidaMax: 0.5,
      cor: mundo.tema.acento, brilha: true,
    });

    if (this.vida <= 0) this._morrer(mundo);
  }

  _morrer(mundo) {
    this.morrendo = 0.001;
    this.perigoso = false;
    // Ao morrer a criatura se desfaz em fuligem — a poluição volta a ser só
    // poluição. Partículas SEM brilho de propósito: a coisa apagou.
    mundo.emitir(this.centroX, this.centroY, 26, {
      velMin: 60, velMax: 300, g: 190, vidaMin: 0.5, vidaMax: 1.4,
      cor: mundo.tema.particula, arrasto: 0.35,
    });
    mundo.emitir(this.centroX, this.centroY, 10, {
      velMin: 40, velMax: 150, g: -30, vidaMin: 0.8, vidaMax: 1.8,
      cor: mundo.tema.acento, brilha: true,
    });
    /* A morte fica GRAVADA. A semente da área só abre com a área limpa, e
       sem persistir isso "área limpa" nunca seria verdade: as criaturas
       renascem a cada `_popular`, então o jogador limparia a última sala e a
       primeira já estaria cheia de novo. */
    mundo.registrarParasitaMorto?.(this.cxInicial, this.cyInicial);
    mundo.aoEvento?.({ tipo: 'inimigoMorto', x: this.centroX, y: this.centroY });
    this.aoMorrer?.(mundo);
  }

  /* ------------------------------------------------------------ desenho -- */

  desenhar(ctx, tema, camera) {
    const morre = clamp01(this.morrendo);
    const ferida = this.piscarDano > 0;
    const cx = this.centroX;
    const cy = this.centroY + this.deslocDesenhoY + Math.sin(this.t * 3.1) * 1.6;

    ctx.save();
    if (morre > 0) {
      ctx.globalAlpha = 1 - morre;
      ctx.translate(cx, cy);
      ctx.scale(1 + morre * 0.5, 1 + morre * 0.5);
      ctx.translate(-cx, -cy);
    }

    this._rastro(ctx, tema, cx, cy);
    this._aureola(ctx, tema, cx, cy);
    // Corpo e chifres num caminho SÓ; as fendas por ÚLTIMO. Antes a massa
    // vinha antes dos tentáculos e as bases dos sete convergiam exatamente
    // sobre os olhos, soterrando o rosto — sobrava um olho visível na tela.
    this._massa(ctx, tema, cx, cy, ferida);
    this._olhos(ctx, tema, cx, cy, ferida);

    ctx.restore();
  }

  /**
   * Auréola ESCURA em volta da criatura.
   *
   * O contorno claro resolve o caso "sombra contra parede preta", mas cria o
   * problema oposto: contra o céu ou contra um feixe de luz, o bicho vira um
   * desenho de linhas. A auréola cobre exatamente esse caso — escurece o que
   * está atrás dela, então some no escuro e aparece no claro. Junto com o
   * contorno, dá leitura nos dois fundos, e mantém a criatura sendo o que ela
   * é: um buraco no mundo.
   */
  /**
   * O borrão que fica pra trás quando a criatura se move.
   *
   * Não é a silhueta inteira repetida — a 26 px de tela isso vira três
   * bichos, não um bicho rápido. São duas manchas do capuz, moles e sem
   * contorno, nas posições de `_ecoX`/`_eco2X`. O alfa sai da DISTÂNCIA até a
   * criatura, então parada ela não tem rastro nenhum e correndo o rastro
   * estica: quem se move deixa marca, quem espreita não.
   */
  _rastro(ctx, tema, cx, cy) {
    if (this._ecoX === undefined || this.morrendo > 0) return;
    const dy = this.deslocDesenhoY + Math.sin(this.t * 3.1) * 1.6;
    const r = this.raio;
    ctx.save();
    ctx.fillStyle = tema.primeiroPlano;
    for (const [ex, ey, k] of [[this._ecoX, this._ecoY, 0.3],
      [this._eco2X, this._eco2Y, 0.16]]) {
      const d = Math.hypot(ex - cx, ey - (cy - dy));
      const forca = clamp01(d / (r * 1.1));
      if (forca < 0.04) continue;
      ctx.globalAlpha = forca * k;
      ctx.beginPath();
      ctx.ellipse(ex, ey + dy, r * 0.86 * this.escalaX, r * 0.9 * this.escalaY,
        0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  _aureola(ctx, tema, cx, cy) {
    // 2,6 de raio a 0,55 de alfa era uma mancha borrada que comia justamente
    // a borda que precisa estar nítida. Menor e mais fraca.
    const r = this.raio * 1.7;
    const g = ctx.createRadialGradient(cx, cy - this.raio * 0.2, this.raio * 0.3, cx, cy - this.raio * 0.2, r);
    g.addColorStop(0, rgba(tema.primeiroPlano, 0.34));
    g.addColorStop(0.55, rgba(tema.primeiroPlano, 0.14));
    g.addColorStop(1, rgba(tema.primeiroPlano, 0));
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - this.raio * 0.2 - r, r * 2, r * 2);
  }

  /**
   * O CORPO INTEIRO num caminho só — capuz, barra do manto e chifres.
   *
   * Antes o corpo e cada chifre eram traçados e contornados SEPARADAMENTE, e
   * cada chifre ainda levava um traço largo claro por baixo (o "halo"). Numa
   * criatura de 26 px isso somava dezesseis linhas claras internas: a Sombra
   * lia como um diagrama de si mesma. Uma silhueta = um contorno.
   */
  _massa(ctx, tema, cx, cy, ferida) {
    const r = this.raio * (1 + this.telegrafo * 0.18);
    const cor = ferida ? '#ffffff' : misturarHex(tema.primeiroPlano, tema.ceuTopo, 0.4);
    const inclina = this.dirSuave * 0.2 + Math.sin(this.t * 0.8) * 0.05;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(inclina);
    ctx.scale(this.escalaX, this.escalaY);

    const onda = (a, k) => Math.sin(a * 3 + this.t * 1.7 + k) * r * 0.12;

    /** Cunha preenchida no lugar do traço de 4 segmentos: ponta de verdade,
     *  sem as bolotas de `lineCap` que viravam juntas de dedo. */
    /* Cada chifre é um SUBCAMINHO próprio, não um desvio inserido no contorno
       do capuz. Inserido, um chifre varrido pra trás fazia o traçado cruzar o
       corpo inteiro; e o remendo que existia — desenhar só os de cosseno
       positivo — apagava o chifre de QUATRO das seis espécies, incluindo o
       grosso e assimétrico do Cuspidor, que é o telégrafo dele.

       Como o contorno é traçado ANTES do preenchimento, a parte do chifre que
       cai dentro do corpo é coberta pelo fill e só o que sobra pra fora
       aparece — que é exatamente o desejado. */
    const chifre = (t) => {
      const a = t.ang + Math.sin(this.t * t.vel + t.fase) * 0.42
        - this.dirSuave * 0.55;                  // varrido pra trás = direção
      const comp = t.comp * (1 + this.telegrafo * 0.35);
      const bx = Math.cos(a) * r * 0.72, by = Math.sin(a) * r * 0.72;
      const px = bx + Math.cos(a) * comp, py = by + Math.sin(a) * comp * 0.9;
      const nx = -Math.sin(a) * r * 0.26, ny = Math.cos(a) * r * 0.26;
      const mx = bx + Math.cos(a + t.curva * 0.35) * comp * 0.55;
      const my = by + Math.sin(a + t.curva * 0.35) * comp * 0.5;
      ctx.moveTo(bx - nx, by - ny);
      ctx.quadraticCurveTo(mx - nx * 0.4, my - ny * 0.4, px, py);
      ctx.quadraticCurveTo(mx + nx * 0.4, my + ny * 0.4, bx + nx, by + ny);
      ctx.closePath();
    };

    /**
     * @param {boolean} comBarra  inclui os dentes do manto.
     *
     * O CONTORNO usa `false` e o PREENCHIMENTO usa `true`. Contornar os
     * dentes fazia o terço de baixo da criatura virar um zigue-zague branco:
     * o vão entre dentes é 5,5 px e o contorno de dois tons come 2,75 de cada
     * lado, então não sobrava preto nenhum dentro do dente. Era o mesmo
     * defeito das "dezesseis linhas claras", só que mudou de endereço.
     */
    const traçar = (comBarra) => {
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.15);                                  // topo do capuz
      ctx.bezierCurveTo(r * 0.46 + onda(1, 0), -r * 1.05, r * 0.92 + onda(2, 1), -r * 0.7, r, -0.08 * r);
      if (this.temManto && comBarra) {
        ctx.bezierCurveTo(r * 1.04, r * 0.54, r * 0.9, r * 0.9, r * 0.84, r * 1.1);
        /* BARRA DO MANTO. Eram sete dentes iguais de ~5 px num vão mais
           estreito que o corpo, pendurados sob uma tigela: lia como vaso de
           grama. Cinco dentes DESIGUAIS num vão maior leem como pano rasgado,
           e o arrasto pro lado oposto ao movimento codifica a direção de
           graça. O comprimento caiu (chegavam a 35 px num corpo de raio 13,
           atravessando a linha do chão). */
        for (let i = 2; i >= -2; i--) {
          const hd = hash2(this.cxInicial + i, this.cyInicial, 41);
          const x = i * r * 0.52;
          const L = 0.95 + hd * 0.55;
          ctx.lineTo(x - this.dirSuave * r * 0.22,
            r * L + Math.sin(i * 2.1 + this.t * 2.2) * r * 0.18);
          ctx.lineTo(x - r * 0.16, r * 1.02 + Math.sin(i * 1.7 + this.t) * r * 0.10);
        }
        ctx.bezierCurveTo(-r * 0.9, r * 0.9, -r * 1.04, r * 0.54, -r, -0.08 * r);
      } else if (this.temManto) {
        ctx.bezierCurveTo(r * 1.04, r * 0.54, r * 0.9, r * 0.9, r * 0.84, r * 1.05);
        ctx.lineTo(-r * 0.84, r * 1.05);
        ctx.bezierCurveTo(-r * 0.9, r * 0.9, -r * 1.04, r * 0.54, -r, -0.08 * r);
      } else {
        ctx.bezierCurveTo(r * 1.02, r * 0.6, r * 0.6, r * 1.05, 0, r * 1.05);
        ctx.bezierCurveTo(-r * 0.6, r * 1.05, -r * 1.02, r * 0.6, -r, -0.08 * r);
      }
      ctx.bezierCurveTo(-r * 0.92 + onda(2, 3), -r * 0.7, -r * 0.46 + onda(1, 4), -r * 1.15, 0, -r * 1.15);
      ctx.closePath();
      for (const t of this.tentaculos) chifre(t);
    };

    /* CONTORNO DE DOIS TONS. O halo antigo era `bruma+acento` a 0,30 de alfa:
       dava luminância ~45 sobre um fundo de parede ~67, ou seja, o "halo de
       separação" era MAIS ESCURO que aquilo de que ele deveria separar. Com
       um anel escuro por fora e um claro por dentro, a criatura se recorta
       tanto contra o preto quanto contra o céu — e continua sendo um vazio. */
    if (!ferida) {
      ctx.lineJoin = 'round';
      ctx.strokeStyle = rgba(tema.primeiroPlano, 0.85);
      ctx.lineWidth = 4;
      traçar(false);
      ctx.stroke();
      // Contra o primeiro plano quase preto o anel escuro não faz nada, e é
      // só este que segura a leitura — a 1,5 px ele some a 1x de zoom.
      ctx.strokeStyle = rgba(misturarHex(tema.bruma, '#ffffff', 0.3), 0.7);
      ctx.lineWidth = 1.9;
      traçar(false);
      ctx.stroke();
    }
    /* O CORPO NÃO É UMA MANCHA CHAPADA.
       Medido na sala de abertura: corpo em luminância 20-25 contra fundo
       10-18. Dez níveis de diferença é invisível — o que lia da criatura era
       a fenda (241) e um fio de contorno; o resto do bicho, incluindo o
       tamanho dele, o jogador adivinhava. Num jogo em que a caixa de dano é o
       corpo, isso é informação de combate faltando, não só estética.

       A saída não é clarear a criatura (ela é um buraco no mundo, e precisa
       continuar sendo): é dar VOLUME. O capuz recebe a luz do céu no alto e
       apaga na barra do manto, e isso separa a silhueta do primeiro plano
       preto sem acender nada. */
    if (ferida) {
      ctx.fillStyle = cor;
    } else {
      const g = ctx.createLinearGradient(0, -r * 1.15, 0, r * 2.2);
      g.addColorStop(0, misturarHex(tema.primeiroPlano, tema.ceuBase, 0.2));
      g.addColorStop(0.42, cor);
      g.addColorStop(1, tema.primeiroPlano);
      ctx.fillStyle = g;
    }
    traçar(true);
    ctx.fill();
    ctx.restore();
  }

  /**
   * As fendas. Desenhadas por último, no espaço do mundo (sem a escala do
   * corpo), pra não virarem ovais achatados nas espécies largas.
   */
  _olhos(ctx, tema, cx, cy, ferida) {
    const r = this.raio;
    const inclina = this.dirSuave * 0.2 + Math.sin(this.t * 0.8) * 0.05;
    const piscada = this._piscando > 0 ? clamp01(this._piscando / 0.06) : 0;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(inclina);
    // Durante o flash de dano a criatura virava um borrão branco SEM ROSTO
    // por 0,13 s. Fendas pretas no branco resolvem, e é de graça.
    ctx.fillStyle = ferida ? tema.primeiroPlano : '#ffffff';
    ctx.globalAlpha = ferida ? 0.9 : 0.92;
    for (const o of this.olhos) {
      ctx.save();
      // O par inteiro anda pra FRENTE do capuz. Fendas simétricas e centradas
      // dizem "olhando pra você" e apagam a direção; num inimigo que patrulha
      // e vira na beirada, saber pra que lado ele anda é informação de jogo.
      ctx.translate(o.dx * this.dir + this.dirSuave * r * 0.22, o.dy);
      ctx.rotate(o.giro * this.dir);
      ctx.beginPath();
      ctx.ellipse(0, 0, o.larg ?? r * 0.18,
        o.alt * (1 - piscada) * (1 + this.telegrafo * 0.5), 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  desenharLuz(ctx, tema, camera) {
    if (this.morrendo > 0) {
      luzRadial(ctx, this.centroX, this.centroY, this.raio * 4 * this.morrendo,
        tema.acento, 1 - this.morrendo);
      return;
    }
    if (this.piscarDano > 0) {
      luzRadial(ctx, this.centroX, this.centroY, this.raio * 2.6, '#ffffff', 1);
      return;
    }

    /* LUZ = PERIGO, nunca ambiente.
       O corpo emitia `tema.acento` a 0,3 o tempo todo, num raio de quase 2×
       o próprio: um buraco no mundo brilhando por dentro, que é a contradição
       exata da referência. E como `acento` vai de oliva morto (poluído) a
       turquesa vivo (restaurado), quanto MAIS o jogador curava a área, mais
       bonito e mais neon o parasita ficava — o oposto da leitura narrativa.
       Pior: com 0,3 de base, o telégrafo (subir pra 0,9) era só "um pouco
       mais claro", e não sinal nenhum. Agora sai de 0 e o aviso triplica de
       força sem tocar em uma linha da lógica de combate. */
    const cy = this.centroY + this.deslocDesenhoY + Math.sin(this.t * 3.1) * 1.6;
    const piscada = this._piscando > 0 ? 1 : 0;
    ctx.save();
    ctx.translate(this.centroX, cy);
    ctx.fillStyle = '#ffffff';
    /* A regra "luz = perigo" tinha sido aplicada à auréola de acento mas não
       às FENDAS, que continuavam a 0,55 fixo — o parasita virava o segundo
       emissor mais forte da cena e invertia a hierarquia de luz do jogo
       inteiro. Sai de 0,18 e só sobe com o telégrafo. */
    ctx.globalAlpha = (0.18 + this.telegrafo * 0.62) * (1 - piscada);
    for (const o of this.olhos) {
      ctx.beginPath();
      ctx.ellipse(o.dx * this.dir, o.dy,
        (o.larg ?? this.raio * 0.18) * 1.1, o.alt * 1.2, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    if (this.telegrafo > 0.05) {
      luzRadial(ctx, this.centroX, cy, this.raio * 2.2, tema.acento, this.telegrafo * 0.9);
    }
  }
}

/* =========================================================================
   1 · ERRANTE — o inimigo básico
   ========================================================================= */

export class Errante extends Sombra {
  constructor(obj) {
    // A REFERÊNCIA da espécie: proporção 1:1, dois chifres, barra longa.
    super(obj, { vida: 2, raio: 13, largura: 30, altura: 32, tentaculos: 2 });
    this.vel = 46;
  }
  comportamento(dt, mundo) { this._patrulhar(dt, mundo, this.vel); }
}

/* =========================================================================
   2 · ESPREITA — flutua e persegue ignorando o terreno
   -------------------------------------------------------------------------
   Não colide com o mundo de propósito: ele é a ameaça que atravessa a
   arquitetura da sala, e por isso força o jogador a resolver NO AR em vez de
   escolher um lugar seguro. Compensa sendo lento e frágil.
   ========================================================================= */

export class Espreita extends Sombra {
  constructor(obj) {
    super(obj, {
      // Gota LISA: zero chifres e sem barra. É a única silhueta redonda do
      // bestiário, e é o que faz "aquele que flutua" ser lido de longe.
      vida: 1, raio: 11, largura: 26, altura: 26,
      tentaculos: 0, olhos: 1, escalaX: 1.05, escalaY: 0.95,
      temManto: false, gravidade: false,
    });
    this.baseY = this.y;
    this.vel = 42;
    this.raioPercepcao = 260;
    this.perseguindo = false;
  }

  comportamento(dt, mundo) {
    const j = mundo.jogador;
    const d = dist(this.centroX, this.centroY, j.centroX, j.centroY);

    // Histerese: entra a 260, só desiste a 380. Sem isso ele oscila entre
    // perseguir e voltar na fronteira exata, tremendo no lugar.
    if (!this.perseguindo && d < this.raioPercepcao) this.perseguindo = true;
    else if (this.perseguindo && d > this.raioPercepcao * 1.45) this.perseguindo = false;

    if (this.perseguindo) {
      const ang = Math.atan2(j.centroY - this.centroY, j.centroX - this.centroX);
      // Aceleração, não velocidade direta: dá inércia e deixa o jogador
      // "driblar" mudando de direção, em vez de ser grudado.
      this.vx = damp(this.vx, Math.cos(ang) * this.vel, 0.35, dt);
      this.vy = damp(this.vy, Math.sin(ang) * this.vel, 0.35, dt);
      this.dir = this.vx < 0 ? -1 : 1;
    } else {
      this.vx = damp(this.vx, Math.sin(this.t * 0.6) * 22, 0.5, dt);
      this.vy = damp(this.vy, (this.baseY - this.y) * 1.4, 0.5, dt);
    }

    this.x += this.vx * dt;
    this.y += this.vy * dt + Math.sin(this.t * 2.2) * 12 * dt;
  }
}

/* =========================================================================
   3 · CUSPIDOR — ancorado, atira em arco
   -------------------------------------------------------------------------
   Pergunta: como me aproximo sob fogo? Ele nunca sai do lugar, então a
   resposta é sempre sobre a rota do jogador, não sobre reflexo.
   ========================================================================= */

const RECARGA_CUSPIDOR = 2.4;
const TELEGRAFO_CUSPIDOR = 0.62;   // bem acima do mínimo de 0,25 s: o tiro é
                                   // em arco e o jogador precisa ler a mira

export class Cuspidor extends Sombra {
  constructor(obj) {
    super(obj, {
      // CORCUNDA: mais largo que alto, com UM chifre grosso só do lado de
      // onde sai o tiro. Assimetria é o que diz "isto aponta pra você".
      vida: 3, raio: 15, largura: 34, altura: 36,
      tentaculos: 1, compTentaculo: 13, olhos: 1,
      escalaX: 1.35, escalaY: 0.85, espalhaTentaculos: 0.55,
    });
    this.recarga = RECARGA_CUSPIDOR * (0.5 + hash2(obj.cx, obj.cy, 3));
    this.carregando = 0;
    this.alcance = 420;
  }

  comportamento(dt, mundo) {
    this._aplicarGravidade(dt, mundo);
    this.vx = 0;

    const j = mundo.jogador;
    const d = dist(this.centroX, this.centroY, j.centroX, j.centroY);
    this.dir = j.centroX < this.centroX ? -1 : 1;

    if (this.carregando > 0) {
      this.carregando -= dt;
      this.telegrafo = 1 - clamp01(this.carregando / TELEGRAFO_CUSPIDOR);
      if (this.carregando <= 0) {
        this.telegrafo = 0;
        this._cuspir(mundo, j);
        this.recarga = RECARGA_CUSPIDOR;
      }
      return;
    }

    this.telegrafo = damp(this.telegrafo, 0, 0.1, dt);
    this.recarga -= dt;
    if (this.recarga <= 0 && d < this.alcance && j.vivo !== false) {
      this.carregando = TELEGRAFO_CUSPIDOR;
    }
  }

  _cuspir(mundo, j) {
    // Mira no jogador com uma antecipação PARCIAL da velocidade dele: mira
    // perfeita é injusta (impossível de evitar andando), mira parada é
    // inofensiva. 0,35 s de antecipação acerta quem não reage e erra quem reage.
    const alvoX = j.centroX + j.vx * 0.35;
    atirarArco(mundo, this.centroX, this.centroY - 8, alvoX, j.centroY, {
      raio: 6, dano: 1, cor: 'acento',
    });
    mundo.emitir(this.centroX, this.centroY - 8, 8, {
      angulo: this.dir > 0 ? -0.8 : -2.3, espalhamento: 0.7,
      velMin: 40, velMax: 140, cor: mundo.tema.acento, brilha: true,
    });
    mundo.aoEvento?.({ tipo: 'inimigoAtira', x: this.centroX, y: this.centroY });
  }
}

/* =========================================================================
   4 · RASTEJANTE — corre por chão, parede e teto
   -------------------------------------------------------------------------
   A criatura anda colada numa superfície e vira nas quinas, seguindo o
   contorno da sala. Isso muda a leitura do espaço: um corredor "seguro" deixa
   de ser seguro porque a ameaça pode vir pelo teto.

   Implementação: guarda a NORMAL da superfície (pra onde é "cima" pra ela) e
   anda perpendicular a ela. Em quina externa (sumiu o chão) gira pra fora; em
   quina interna (bateu numa parede) gira pra dentro.
   ========================================================================= */

// Normais possíveis, em ordem de rotação. 0 = de pé no chão.
const NORMAIS = [
  { nx: 0, ny: -1 },   // 0 · sobre o chão
  { nx: -1, ny: 0 },   // 1 · na parede direita (normal aponta pra esquerda)
  { nx: 0, ny: 1 },    // 2 · sob o teto
  { nx: 1, ny: 0 },    // 3 · na parede esquerda
];

export class Rastejante extends Sombra {
  constructor(obj) {
    super(obj, {
      // ACHATADO contra a superfície — a única silhueta larga e baixa.
      vida: 1, raio: 10, largura: 24, altura: 24,
      tentaculos: 0, olhos: 1, escalaX: 1.6, escalaY: 0.6,
      temManto: false, gravidade: false,
    });
    this.normal = 0;
    this.vel = 96;
    this.ancoraX = this.centroX;
    this.ancoraY = this.centroY;
    this._grudou = false;
  }

  /**
   * Acha a superfície mais próxima e gruda nela.
   *
   * O Rastejante estava na lista de ANCORADOS_NO_CHAO, então o carregador de
   * sala o DERRUBAVA até o chão — no `dossel-02` ele caía dez tiles. Só que a
   * coisa toda dele é ser a ameaça que anda por parede e teto: nascer sempre
   * no chão apagava a identidade dele e o transformava num Errante lento.
   *
   * Tirá-lo da lista sozinho não bastava: com `normal = 0` (de pé no chão) e
   * nada embaixo, o passo cai todo quadro no ramo de "quina externa" e ele
   * gira no lugar. Então a superfície é procurada uma vez, na primeira
   * atualização — que é quando o terreno já existe.
   */
  _grudar(terreno) {
    const sonda = this.raio + 3;
    let melhor = -1, melhorD = Infinity;
    for (let i = 0; i < NORMAIS.length; i++) {
      const n = NORMAIS[i];
      // Anda na direção OPOSTA à normal (para onde ficariam os "pés").
      for (let d = 2; d <= terreno.tile * 6; d += 4) {
        if (terreno.caixaSolida(
          this.ancoraX - n.nx * d - 2, this.ancoraY - n.ny * d - 2, 4, 4)) {
          if (d < melhorD) { melhorD = d; melhor = i; }
          break;
        }
      }
    }
    // Sem superfície por perto: NÃO marca como grudado e devolve false. Com
    // `normal` errado e nada embaixo, o passo cai todo quadro no ramo de
    // quina externa e a criatura gira no lugar — melhor esperar parada.
    if (melhor < 0) return false;
    this._grudou = true;
    this.normal = melhor;
    const n = NORMAIS[melhor];
    this.ancoraX -= n.nx * (melhorD - sonda);
    this.ancoraY -= n.ny * (melhorD - sonda);
    return true;
  }

  comportamento(dt, mundo) {
    const terreno = mundo.sala.terreno;
    if (!this._grudou && !this._grudar(terreno)) return;
    const n = NORMAIS[this.normal];
    // Tangente = normal girada 90°, multiplicada pelo sentido da caminhada.
    const tx = -n.ny * this.dir;
    const ty = n.nx * this.dir;

    const passo = this.vel * dt;
    const proxX = this.ancoraX + tx * passo;
    const proxY = this.ancoraY + ty * passo;

    const sonda = this.raio + 3;
    // Existe superfície sob os "pés" na posição seguinte?
    const temChao = terreno.caixaSolida(
      proxX - n.nx * sonda - 2, proxY - n.ny * sonda - 2, 4, 4
    );
    // Há parede na frente?
    const temParede = terreno.caixaSolida(
      proxX + tx * sonda - 2, proxY + ty * sonda - 2, 4, 4
    );

    if (temParede) {
      // Quina interna: sobe a parede (gira contra o sentido da caminhada).
      this.normal = (this.normal + (this.dir > 0 ? 1 : 3)) % 4;
    } else if (!temChao) {
      // Quina externa: contorna a beirada (gira a favor).
      this.normal = (this.normal + (this.dir > 0 ? 3 : 1)) % 4;
      const nn = NORMAIS[this.normal];
      this.ancoraX = proxX - nn.nx * 2;
      this.ancoraY = proxY - nn.ny * 2;
    } else {
      this.ancoraX = proxX;
      this.ancoraY = proxY;
    }

    // Cola na superfície: sem isso ela vai se afastando por acúmulo de erro.
    const nAtual = NORMAIS[this.normal];
    this.x = this.ancoraX - this.largura / 2;
    this.y = this.ancoraY - this.altura / 2;
    this.anguloCorpo = Math.atan2(nAtual.ny, nAtual.nx) + Math.PI / 2;
  }

  desenhar(ctx, tema, camera) {
    // Gira o corpo inteiro para acompanhar a superfície — uma criatura de
    // teto desenhada em pé denuncia o truque na hora.
    ctx.save();
    ctx.translate(this.centroX, this.centroY);
    ctx.rotate(this.anguloCorpo ?? 0);
    ctx.translate(-this.centroX, -this.centroY);
    super.desenhar(ctx, tema, camera);
    ctx.restore();
  }

  /** O passe emissivo precisa da MESMA rotação do corpo. Sem isto, no teto o
   *  corpo aparecia de cabeça pra baixo e as fendas acesas ficavam em pé:
   *  dois pares de olhos, em lugares diferentes, na mesma criatura. */
  desenharLuz(ctx, tema, camera) {
    ctx.save();
    ctx.translate(this.centroX, this.centroY);
    ctx.rotate(this.anguloCorpo ?? 0);
    ctx.translate(-this.centroX, -this.centroY);
    super.desenharLuz(ctx, tema, camera);
    ctx.restore();
  }
}

/* =========================================================================
   5 · ESTOPIM — persegue e explode
   -------------------------------------------------------------------------
   Pergunta: quando NÃO brigar. Bater nele adianta pouco (1 de vida, mas
   explode do mesmo jeito ao morrer perto), então a resposta certa costuma ser
   sair de perto. É o inimigo que ensina que fugir é uma jogada.
   ========================================================================= */

const PAVIO = 0.85;

export class Estopim extends Sombra {
  constructor(obj) {
    super(obj, {
      /* Errante e Estopim eram a MESMA criatura: 1 px de raio de diferença e
         um chifre. E o Estopim faz o dobro de dano e explode. Agora é uma
         esfera inchada e LISA — sem manto, sem chifre — que é a leitura
         "isto vai estourar". */
      vida: 1, raio: 12, largura: 28, altura: 28,
      tentaculos: 0, olhos: 1, dano: 2,
      escalaX: 1.18, escalaY: 1.18, temManto: false,
    });
    this.vel = 88;
    this.raioPercepcao = 210;
    this.raioGatilho = 52;
    this.pavio = 0;
    this.acordado = false;
  }

  comportamento(dt, mundo) {
    const j = mundo.jogador;
    const d = dist(this.centroX, this.centroY, j.centroX, j.centroY);

    if (this.pavio > 0) {
      // Acendeu: para de andar e incha. O jogador tem PAVIO segundos, e o
      // corpo crescendo é o relógio — não existe barra nem número.
      this.pavio -= dt;
      this.telegrafo = 1 - clamp01(this.pavio / PAVIO);
      this.vx = damp(this.vx, 0, 0.12, dt);
      this._aplicarGravidade(dt, mundo);
      if (this.pavio <= 0) this._estourar(mundo);
      return;
    }

    if (!this.acordado && d < this.raioPercepcao) this.acordado = true;
    if (this.acordado && d < this.raioGatilho) { this.pavio = PAVIO; return; }

    if (this.acordado) {
      this.dir = j.centroX < this.centroX ? -1 : 1;
      this._patrulhar(dt, mundo, this.vel);
      // Acordado ele NÃO vira na beirada (quer alcançar o jogador), mas o
      // `_patrulhar` já virou; força a direção de volta pro alvo.
      this.dir = j.centroX < this.centroX ? -1 : 1;
    } else {
      this._patrulhar(dt, mundo, this.vel * 0.35);
    }
  }

  _estourar(mundo) {
    mundo.entidades.push(new Explosao({
      x: this.centroX, y: this.centroY, raio: 82, dano: this.dano,
    }));
    mundo.camera.sacudir(0.55);
    mundo.laco.congelar(0.06);
    this.vida = 0;
    this._morrer(mundo);
  }

  /** Morrer de espada perto também estoura — não dá pra desarmar de graça. */
  receberDano(n, deX, deY, mundo) {
    if (this.morrendo > 0) return;
    if (this.pavio <= 0) this.pavio = PAVIO * 0.55;   // acende ao levar dano
    this.piscarDano = 0.13;
    this.recuoX = sign(this.centroX - deX) * 150;
  }
}

/* =========================================================================
   6 · TECELÃO — emboscada de cima
   -------------------------------------------------------------------------
   Pergunta: você olhou pra cima antes de passar? Fica imóvel colado no teto
   até o jogador entrar embaixo, então desce no fio. Sobe de volta depois.
   O fio é sempre visível, mesmo parado — a emboscada é justa: a informação
   está na tela desde antes, só não estava sendo olhada.
   ========================================================================= */

export class Tecelao extends Sombra {
  constructor(obj) {
    super(obj, {
      // ALTO E FINO, com um espinho reto pra cima que entra no fio.
      vida: 2, raio: 12, largura: 26, altura: 28,
      tentaculos: 1, compTentaculo: 12, olhos: 1,
      escalaX: 0.7, escalaY: 1.45, espalhaTentaculos: 1, gravidade: false,
    });
    this.tetoY = this.y;
    this.alcanceQueda = 260;
    this.fase = 'espera';    // espera | desce | segura | sobe
    this.tempoFase = 0;
  }

  comportamento(dt, mundo) {
    const j = mundo.jogador;
    this.tempoFase += dt;
    const dx = Math.abs(j.centroX - this.centroX);

    switch (this.fase) {
      case 'espera':
        this.y = damp(this.y, this.tetoY, 0.2, dt);
        this.telegrafo = damp(this.telegrafo, 0, 0.2, dt);
        // Só dispara com o jogador razoavelmente embaixo E abaixo dela.
        if (dx < 46 && j.centroY > this.centroY) {
          this.fase = 'aviso'; this.tempoFase = 0;
        }
        break;

      case 'aviso':
        // 0,3 s de tremor antes de soltar: é o telegrafo, e é o que separa
        // "emboscada" de "armadilha barata".
        this.telegrafo = clamp01(this.tempoFase / 0.3);
        this.y = this.tetoY + Math.sin(this.tempoFase * 60) * 2;
        if (this.tempoFase >= 0.3) { this.fase = 'desce'; this.tempoFase = 0; }
        break;

      case 'desce': {
        this.telegrafo = 0;
        this.vy = Math.min(this.vy + 2200 * dt, 900);
        const res = mundo.sala.terreno.mover(this, 0, this.vy * dt);
        const desceu = this.y - this.tetoY;
        if (res.chao || desceu > this.alcanceQueda) {
          this.fase = 'segura'; this.tempoFase = 0; this.vy = 0;
          mundo.camera.sacudir(0.14);
        }
        break;
      }

      case 'segura':
        if (this.tempoFase > 0.7) { this.fase = 'sobe'; this.tempoFase = 0; }
        break;

      case 'sobe':
        this.y = damp(this.y, this.tetoY, 0.45, dt);
        if (Math.abs(this.y - this.tetoY) < 2) { this.fase = 'espera'; this.tempoFase = 0; }
        break;
    }
  }

  desenharFundo(ctx, tema) {
    // O fio, atrás da criatura. Desenhado SEMPRE, inclusive parada — é a
    // pista que torna a emboscada legível antes de acontecer.
    ctx.save();
    ctx.strokeStyle = rgba(tema.borda, 0.7);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(this.centroX, this.tetoY - 40);
    const balanco = this.fase === 'espera' ? Math.sin(this.t * 1.1) * 3 : 0;
    ctx.quadraticCurveTo(this.centroX + balanco, (this.tetoY + this.centroY) / 2,
      this.centroX, this.centroY);
    ctx.stroke();
    ctx.restore();
  }
}

/* ========================================================================= */

export const PARASITAS = {
  parasita: Errante,
  voador: Espreita,
  cuspidor: Cuspidor,
  rastejante: Rastejante,
  explosivo: Estopim,
  tecelao: Tecelao,
};

/** @returns {Sombra|null} */
export function criarParasita(tipo, obj) {
  const Classe = PARASITAS[tipo];
  return Classe ? new Classe(obj) : null;
}
