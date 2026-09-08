/* =========================================================================
   fase2/entidades/jogador-arte.js — desenho do Guardião
   -------------------------------------------------------------------------
   INSPIRAÇÃO: o Ori. Uma criatura-espírito pequena, PÁLIDA E LUMINOSA, de
   olhos grandes e escuros, orelhas longas caídas para trás, membros finos e
   cauda que acompanha o movimento com atraso.

   Inspiração, não cópia: o nosso é o que restou do CEO da Fase 1 depois que
   a empresa caiu — a forma humana se foi e sobrou isto. As marcas no corpo
   têm desenho de nervura de folha e ACENDEM conforme o mundo é restaurado,
   então o jogador lê o próprio progresso no personagem, sem HUD.

   Por que luminoso e claro num mundo escuro:
   1. Legibilidade. A floresta poluída é quase preta; um herói escuro sumiria
      nela. Claro sobre escuro é lido antes de qualquer outra coisa na tela.
   2. Ele é a única fonte de luz que se move — o mundo se ilumina em volta
      dele conforme anda, e é isso que faz o lugar parecer explorado em vez
      de apenas percorrido.
   3. Tematicamente: a coisa viva que sobrou dentro de um lugar morto.

   Regra de silhueta: a forma é SÓLIDA e simples, legível a 100 px. Todo o
   interesse mora no contorno, nos olhos e nas marcas. Detalhe interno em
   personagem pequeno vira sujeira.
   ========================================================================= */

import {
  TAU, clamp, clamp01, lerp, damp, easeOutCubic, easeOutQuad,
  rgba, misturarHex,
} from '../core/mat.js';
import { ESTADOS } from './jogador.js';
import { luzRadial } from '../render/renderizador.js';

/* ------------------------------------------------------------ proporções --
   Origem do desenho: PÉS do personagem, olhando para a direita, y negativo
   para cima. A caixa de colisão é 22×44; o desenho é maior de propósito
   (orelhas, cauda), pra dar presença sem punir o jogador com hitbox grande. */
const ALTURA_CORPO = 26;   // do chão ao topo da cabeça
const RAIO_CABECA = 9.5;
const CY_CABECA = -34;     // centro da cabeça em relação aos pés

export class ArteJogador {
  constructor() {
    /** Cauda: cadeia de molas que segue o corpo com atraso crescente. */
    this.cauda = Array.from({ length: 7 }, () => ({ x: 0, y: 0, vx: 0, vy: 0 }));
    this.caudaIniciada = false;

    /** Orelhas: duas molas angulares, com inércia própria. */
    this.orelhas = [{ ang: 0, vel: 0 }, { ang: 0, vel: 0 }];

    this.floracao = 0;          // 0..1 — quanto as marcas acenderam
    this._floracaoAlvo = 0;

    this.piscar = 0;
    this._proxPiscada = 2.5;

    this.rastro = [];           // cópias fantasma da investida
    this.respiro = 0;
  }

  /** `v` 0..1 = pureza média do mundo. Sobe devagar, de propósito. */
  definirFloracao(v) { this._floracaoAlvo = clamp01(v); }

  /* ===================================================================== */

  atualizar(dt, j) {
    this.respiro += dt;
    this.floracao = damp(this.floracao, this._floracaoAlvo, 0.9, dt);

    this._passoCauda(dt, j);
    this._passoOrelhas(dt, j);

    // Piscada: intervalo irregular, senão vira metrônomo.
    this._proxPiscada -= dt;
    if (this._proxPiscada <= 0) {
      this.piscar = 0.11;
      this._proxPiscada = 1.8 + Math.random() * 4.2;
    }
    if (this.piscar > 0) this.piscar -= dt;

    // Rastro da investida.
    if (j.estado === ESTADOS.INVESTIDA) {
      this.rastro.push({ x: j.centroX, y: j.pesY, t: 0.26, dir: j.direcao });
    }
    for (let i = this.rastro.length - 1; i >= 0; i--) {
      this.rastro[i].t -= dt;
      if (this.rastro[i].t <= 0) this.rastro.splice(i, 1);
    }
  }

  _passoCauda(dt, j) {
    // A cauda nasce na base das costas e vive em coordenadas de MUNDO —
    // simular no espaço local faria ela girar junto com o corpo ao virar,
    // que é exatamente o oposto de inércia.
    const ancoraX = j.centroX - j.direcao * 6;
    const ancoraY = j.pesY - 16;

    if (!this.caudaIniciada) {
      for (const s of this.cauda) { s.x = ancoraX; s.y = ancoraY; }
      this.caudaIniciada = true;
    }

    let alvoX = ancoraX, alvoY = ancoraY;
    const n = this.cauda.length;
    for (let i = 0; i < n; i++) {
      const s = this.cauda[i];
      const f = i / (n - 1);
      // Rigidez cai ao longo da cauda: a base acompanha, a ponta chicoteia.
      const rigidez = lerp(420, 120, f);
      const amort = lerp(18, 9, f);

      s.vx += (alvoX - s.x) * rigidez * dt;
      s.vy += (alvoY - s.y) * rigidez * dt;
      s.vy += 340 * dt;                 // peso próprio
      s.vx -= j.vx * 0.85 * dt;         // arrasto contra o movimento do corpo
      s.vy -= j.vy * 0.42 * dt;
      s.vx = damp(s.vx, 0, 1 / amort, dt);
      s.vy = damp(s.vy, 0, 1 / amort, dt);
      s.x += s.vx * dt;
      s.y += s.vy * dt;

      // Trava de comprimento: cada elo não se afasta mais que L do anterior.
      const L = 4.6;
      const dx = s.x - alvoX, dy = s.y - alvoY;
      const d = Math.hypot(dx, dy);
      if (d > L) { s.x = alvoX + (dx / d) * L; s.y = alvoY + (dy / d) * L; }

      alvoX = s.x; alvoY = s.y;
    }
  }

  _passoOrelhas(dt, j) {
    // Ângulo-alvo por estado. As orelhas são o rosto do personagem: elas
    // dizem o que ele está sentindo antes de qualquer outra parte.
    let alvo;
    switch (j.estado) {
      case ESTADOS.PULANDO:   alvo = -0.55; break;   // pra trás, empolgado
      case ESTADOS.CAINDO:    alvo = -0.25; break;
      case ESTADOS.INVESTIDA: alvo = -0.95; break;   // coladas de tanto vento
      case ESTADOS.PLANEIO:   alvo = 0.30; break;    // abertas, pegando ar
      case ESTADOS.ATORDOADO: alvo = 0.75; break;    // murchas
      case ESTADOS.MORTO:     alvo = 0.95; break;
      case ESTADOS.CANTO:     alvo = -0.15; break;
      case ESTADOS.CORRENDO:  alvo = -0.34 - Math.abs(j.vx) / 232 * 0.2; break;
      default:                alvo = -0.05; break;
    }
    for (let i = 0; i < 2; i++) {
      const o = this.orelhas[i];
      // Mola com amortecimento: overshoot leve dá o balanço de orelha.
      const rigidez = 150, amort = 11;
      // A orelha de trás reage um pouco depois da da frente.
      const atraso = i === 0 ? 1 : 0.82;
      o.vel += (alvo - o.ang) * rigidez * atraso * dt;
      o.vel -= o.vel * amort * dt;
      o.ang += o.vel * dt;
      // Balanço passivo da corrida.
      if (j.noChao) o.ang += Math.sin(j.faseAndar * 2 + i) * 0.004;
    }
  }

  /* ===================================================================== */

  /**
   * @param {CanvasRenderingContext2D} ctx  já no espaço do mundo
   * @param {import('./jogador.js').Jogador} j
   * @param {import('../render/paleta.js').Tema} tema
   */
  desenhar(ctx, j, tema) {
    const cores = this._cores(tema);

    // Rastro da investida — atrás de tudo, some rápido.
    for (const r of this.rastro) {
      const a = clamp01(r.t / 0.26);
      ctx.save();
      ctx.globalAlpha = a * 0.3;
      ctx.translate(r.x, r.y);
      ctx.scale(r.dir, 1);
      ctx.fillStyle = cores.claro;
      this._silhuetaSimples(ctx, 1 + (1 - a) * 0.3);
      ctx.restore();
    }

    if (!j.visivel) return;

    // A cauda é desenhada em MUNDO (é onde ela é simulada), antes do corpo.
    this._cauda(ctx, j, cores);

    const pose = this._pose(j);

    ctx.save();
    ctx.translate(j.centroX, j.pesY);
    ctx.rotate(j.inclinacao + pose.tombo);
    ctx.scale(j.direcao * j.esticar, j.achatar);

    this._pernas(ctx, j, cores, pose);
    this._corpo(ctx, j, cores, tema, pose);
    this._bracos(ctx, j, cores, pose);
    this._cabeca(ctx, j, cores, tema, pose);

    ctx.restore();

    this._ataque(ctx, j, tema);
  }

  /**
   * A POSE de cada estado.
   *
   * Sem isto, correr, pular, cair e ficar parado desenhavam praticamente a
   * mesma figura — só o ciclo das pernas mudava, e num personagem de 44 px
   * isso é invisível. Um jogo de plataforma se lê pela SILHUETA do estado: o
   * jogador precisa saber que está subindo, caindo ou correndo pelo formato,
   * não pelo que a física está fazendo por baixo.
   *
   * Os quatro parâmetros que mudam a silhueta, e o que cada um comunica:
   *   tombo    inclinação do corpo inteiro — direção e urgência
   *   cabecaY  cabeça mais alta (leve) ou enfiada nos ombros (impacto)
   *   cabecaX  cabeça à frente = ímpeto; atrás = recuo/queda
   *   encolhe  o quanto as pernas se recolhem
   */
  _pose(j) {
    const p = { tombo: 0, cabecaX: 0, cabecaY: 0, encolhe: 0, bracos: 0 };
    switch (j.estado) {
      case ESTADOS.CORRENDO:
        // Inclina PRA FRENTE. É a leitura mais forte de "estou indo".
        p.tombo = 0.13;
        p.cabecaX = 2.2; p.cabecaY = 0.8; p.bracos = 1;
        break;
      case ESTADOS.PULANDO:
        // Arqueia pra trás e recolhe as pernas: corpo em vírgula subindo.
        p.tombo = -0.1;
        p.cabecaX = -1; p.cabecaY = -1.6; p.encolhe = 1; p.bracos = -0.7;
        break;
      case ESTADOS.CAINDO:
        // Pernas descem e os braços sobem — silhueta oposta à do pulo.
        p.tombo = 0.06;
        p.cabecaX = 0.5; p.cabecaY = 1.2; p.encolhe = -0.5; p.bracos = -1.2;
        break;
      case ESTADOS.PLANEIO:
        // Aberto, quase deitado no ar.
        p.tombo = -0.22; p.cabecaY = -0.8; p.encolhe = 0.3; p.bracos = -1.6;
        break;
      case ESTADOS.INVESTIDA:
        // Esticado na horizontal, cabeça bem à frente.
        p.tombo = 0.3; p.cabecaX = 4; p.cabecaY = 2; p.encolhe = 1.3; p.bracos = 1.5;
        break;
      case ESTADOS.PAREDE:
        p.tombo = -0.08; p.cabecaX = -1.5; p.encolhe = 0.6;
        break;
      case ESTADOS.ATORDOADO:
        // Cabeça pra trás, corpo cedendo — leitura clara de "levei dano".
        p.tombo = -0.26; p.cabecaX = -3; p.cabecaY = 1.5; p.bracos = -1.4;
        break;
      case ESTADOS.CANTO:
        // Peito aberto, cabeça pra cima: postura de quem canta.
        p.tombo = -0.06; p.cabecaY = -2.2; p.bracos = -1.8;
        break;
      case ESTADOS.MORTO:
        p.tombo = -0.5; p.cabecaY = 3; p.encolhe = -1;
        break;
      default:
        break;
    }
    return p;
  }

  /** Uma paleta derivada do tema — o personagem esfria junto com a área. */
  _cores(tema) {
    // Base quase branca, levemente tingida pela luz dominante da área: é o
    // que integra o personagem à cena em vez de deixá-lo como adesivo.
    const claro = misturarHex('#f4f8f6', tema.luz, 0.22);
    return {
      claro,
      meio: misturarHex(claro, tema.ceuBase, 0.30),
      sombra: misturarHex(claro, tema.ceuTopo, 0.58),
      escuro: tema.ceuTopo,
      marca: tema.crista,
      acento: tema.acento,
    };
  }

  /** Contorno tosco usado só pelo rastro fantasma. */
  _silhuetaSimples(ctx, escala) {
    ctx.beginPath();
    ctx.ellipse(0, -16 * escala, 9 * escala, 15 * escala, 0, 0, TAU);
    ctx.fill();
  }

  _cauda(ctx, j, cores) {
    const pts = this.cauda;
    const n = pts.length;

    // Duas passadas: um brilho largo e difuso por baixo, o traço sólido em
    // cima. Isso dá a impressão de matéria luminosa em vez de um fio.
    for (const [larguraBase, cor, alfa] of [[6.5, cores.meio, 0.35], [3.6, cores.claro, 1]]) {
      ctx.save();
      ctx.globalAlpha = alfa;
      ctx.strokeStyle = cor;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // Espessura decrescente: desenhada em segmentos porque o canvas não
      // tem traço de espessura variável.
      for (let i = 0; i < n - 1; i++) {
        const f = i / (n - 1);
        ctx.lineWidth = larguraBase * (1 - f * 0.82);
        ctx.beginPath();
        ctx.moveTo(pts[i].x, pts[i].y);
        ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Tufo na ponta.
    const p = pts[n - 1];
    ctx.fillStyle = cores.claro;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 3.4, 2.6, 0, 0, TAU);
    ctx.fill();
  }

  _pernas(ctx, j, cores, pose = {}) {
    const noAr = !j.noChao;
    const correndo = j.estado === ESTADOS.CORRENDO;
    const amp = correndo ? clamp(Math.abs(j.vx) / 232, 0, 1) : 0;

    ctx.strokeStyle = cores.meio;
    ctx.lineCap = 'round';
    // Grossas o bastante pra ler: com 3,2px as pernas sumiam em tamanho real
    // e o personagem parecia flutuar sobre o chão em vez de pisar nele.
    ctx.lineWidth = 4.2;

    const perna = (dxQuadril, fase, atras) => {
      ctx.save();
      ctx.globalAlpha = atras ? 0.7 : 1;
      ctx.strokeStyle = atras ? cores.sombra : cores.meio;

      let joelhoX, joelhoY, peX, peY;
      if (noAr) {
        // No ar as pernas recolhem — silhueta compacta lê muito melhor em
        // pulo do que pernas esticadas. `encolhe` da pose reforça a diferença
        // entre SUBIR (recolhido) e CAIR (estendido), que é a leitura que o
        // jogador usa pra saber em que parte do arco ele está.
        const recolhe = clamp01(0.4 - j.vy / 900 + (pose.encolhe ?? 0) * 0.45);
        joelhoX = dxQuadril + 3 * fase;
        joelhoY = -9 + recolhe * 2;
        peX = dxQuadril + 5 * fase;
        peY = -3 - recolhe * 3;
      } else {
        // Ciclo de passada: o pé desenha uma elipse achatada, o joelho
        // acompanha a meio caminho. Simples e suficiente nessa escala.
        const s = Math.sin(fase), c = Math.cos(fase);
        peX = dxQuadril + s * 7 * amp;
        peY = -Math.max(0, c) * 5 * amp;
        joelhoX = dxQuadril + s * 3.5 * amp;
        joelhoY = -6 - Math.max(0, c) * 2 * amp;
      }

      ctx.beginPath();
      ctx.moveTo(dxQuadril, -13);
      ctx.quadraticCurveTo(joelhoX, joelhoY, peX, peY);
      ctx.stroke();

      // Pé: um ponto, não um sapato. Menos é mais nessa escala.
      ctx.fillStyle = atras ? cores.sombra : cores.claro;
      ctx.beginPath();
      ctx.ellipse(peX, peY, 3, 2.2, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    };

    perna(-3.5, j.faseAndar + Math.PI, true);
    perna(3.5, j.faseAndar, false);
  }

  _corpo(ctx, j, cores, tema, pose = {}) {
    const respiro = Math.sin(this.respiro * 1.9) * 0.5;

    // Tronco: gota invertida, ombros estreitos, quadril arredondado.
    //
    // O gradiente vai de BRANCO puro no alto até a cor de sombra embaixo, e
    // não de `claro` a `meio` como antes: com pouca diferença entre as duas
    // pontas o corpo virava um borrão cinza sem volume — parecia marshmallow.
    // A faixa larga de valor é o que dá forma de corpo a uma silhueta chapada.
    const g = ctx.createLinearGradient(0, -31, 0, -8);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.42, cores.claro);
    g.addColorStop(1, cores.sombra);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -30 - respiro);
    ctx.bezierCurveTo(-7, -28, -8.5, -20, -6.5, -12);
    ctx.bezierCurveTo(-5, -8.5, 5, -8.5, 6.5, -12);
    ctx.bezierCurveTo(8.5, -20, 7, -28, 0, -30 - respiro);
    ctx.closePath();
    ctx.fill();

    // Luz de borda no lado das costas: separa o corpo do fundo escuro mesmo
    // quando a silhueta encosta numa parede da mesma cor.
    ctx.save();
    ctx.strokeStyle = rgba('#ffffff', 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-6.4, -12.5);
    ctx.bezierCurveTo(-8.4, -20, -7, -28, 0, -30 - respiro);
    ctx.stroke();
    ctx.restore();

    // Marcas de nervura de folha — o medidor de restauração vestido no corpo.
    const f = this.floracao;
    if (f > 0.02) {
      ctx.save();
      ctx.globalAlpha = 0.25 + f * 0.75;
      ctx.strokeStyle = cores.marca;
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      // Nervura central.
      ctx.beginPath();
      ctx.moveTo(0, -26);
      ctx.lineTo(0, -13);
      ctx.stroke();
      // Nervuras laterais, abrindo de baixo pra cima conforme floresce.
      const pares = Math.round(lerp(1, 4, f));
      for (let i = 0; i < pares; i++) {
        const y = -15 - i * 3.4;
        const largura = lerp(1.5, 4.2, f) * (1 - i * 0.13);
        for (const lado of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.quadraticCurveTo(lado * largura * 0.7, y - 0.4, lado * largura, y - 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  _bracos(ctx, j, cores, pose = {}) {
    const atacando = j.ataqueRestante > 0;
    const t = atacando ? 1 - j.ataqueRestante / 0.22 : 0;
    const balanco = (j.noChao ? Math.sin(j.faseAndar + Math.PI) * 3 : -2)
      + (pose.bracos ?? 0) * 3.5;

    ctx.lineCap = 'round';
    ctx.lineWidth = 2.8;

    // Braço de trás.
    ctx.strokeStyle = cores.sombra;
    ctx.beginPath();
    ctx.moveTo(-5, -25);
    ctx.quadraticCurveTo(-8, -21 + balanco * 0.3, -7, -16 + balanco * 0.4);
    ctx.stroke();

    // Braço da frente — durante o ataque acompanha o arco do golpe.
    ctx.strokeStyle = cores.meio;
    ctx.beginPath();
    if (atacando) {
      // Antecipação (recuo) nos primeiros 22%, depois o golpe.
      const ang = t < 0.22
        ? lerp(-0.4, -1.25, easeOutQuad(t / 0.22))
        : lerp(-1.25, 1.05, easeOutCubic((t - 0.22) / 0.78));
      ctx.save();
      ctx.translate(5, -24);
      ctx.rotate(ang);
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(1.5, 5, 1, 10);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.moveTo(5, -25);
      ctx.quadraticCurveTo(8, -21 - balanco * 0.3, 7, -16 - balanco * 0.4);
      ctx.stroke();
    }
  }

  _cabeca(ctx, j, cores, tema, pose = {}) {
    const flutuar = Math.sin(this.respiro * 2.1) * 0.6;
    const cy = CY_CABECA + flutuar + (pose.cabecaY ?? 0);
    const cxOff = pose.cabecaX ?? 0;

    ctx.save();
    ctx.translate(cxOff, 0);
    this._orelhas(ctx, cy, cores);

    // Crânio: quase circular, um pouco mais estreito no queixo.
    const g = ctx.createRadialGradient(-2, cy - 3, 1, 0, cy, RAIO_CABECA * 1.5);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, cores.claro);
    g.addColorStop(1, cores.meio);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-RAIO_CABECA, cy - 1);
    ctx.bezierCurveTo(-RAIO_CABECA, cy - 9, RAIO_CABECA, cy - 9, RAIO_CABECA, cy - 1);
    ctx.bezierCurveTo(RAIO_CABECA, cy + 6.5, 2, cy + 9.5, 0, cy + 9.5);
    ctx.bezierCurveTo(-2, cy + 9.5, -RAIO_CABECA, cy + 6.5, -RAIO_CABECA, cy - 1);
    ctx.closePath();
    ctx.fill();

    this._olhos(ctx, cy, cores, j);
    ctx.restore();
  }

  _orelhas(ctx, cy, cores) {
    // Duas orelhas longas, varridas pra trás, ABERTAS EM V. A de trás é mais
    // escura e menor — dá volume sem precisar de sombreado.
    //
    // Sobre o ângulo, que já saiu errado uma vez: o desenho olha para +x, e
    // uma rotação θ leva o eixo local +y (onde a orelha é traçada) para
    // (−sen θ, cos θ). Para a orelha subir e ir para TRÁS é preciso
    // −sen θ < 0 e cos θ < 0, ou seja θ entre π/2 e π. Com θ ≈ −2,05 as duas
    // apontavam para a FRENTE e, por ficarem quase no mesmo ângulo, se
    // fundiam numa lâmina só.
    // Ângulos BEM separados. Com 2,12 e 2,62 as duas se sobrepunham quase
    // inteiras e o resultado lia como uma lâmina só com dois tons — o
    // personagem parecia ter um chifre, não orelhas. A separação precisa ser
    // grande o bastante pra sobreviver a 44 px de altura na tela.
    const BASE_ANG = [1.92, 2.78];
    for (let i = 1; i >= 0; i--) {
      const o = this.orelhas[i];
      const atras = i === 1;
      const comprimento = atras ? 17 : 23;
      const largura = atras ? 2.8 : 3.8;
      ctx.save();
      // Bases afastadas na horizontal também, não só no ângulo: é o que dá o
      // "V" visto de três quartos em vez de duas linhas saindo do mesmo ponto.
      ctx.translate(atras ? -6.5 : 1.5, cy - 5.5);
      // `ang` negativo = mais varrida para trás, então SOMA em θ.
      // A orelha de trás varre um pouco MAIS que a da frente: a diferença de
      // amplitude é o que faz o par parecer dois apêndices independentes em
      // vez de uma peça rígida girando.
      ctx.rotate(BASE_ANG[i] - o.ang * (atras ? 0.62 : 0.46));
      ctx.fillStyle = atras ? cores.sombra : cores.claro;
      ctx.beginPath();
      ctx.moveTo(-largura * 0.5, 0);
      // Curva com uma leve barriga e ponta fina.
      ctx.bezierCurveTo(
        -largura, comprimento * 0.45,
        -largura * 0.35, comprimento * 0.82,
        0, comprimento
      );
      ctx.bezierCurveTo(
        largura * 0.5, comprimento * 0.8,
        largura, comprimento * 0.4,
        largura * 0.5, 0
      );
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  _olhos(ctx, cy, cores, j) {
    // Olhos grandes e escuros com um ponto de luz — é o traço que mais
    // carrega expressão, e o que mais lembra o Ori. Ficam adiantados na
    // direção do olhar.
    const abertura = this.piscar > 0 ? 0.12
      : j.estado === ESTADOS.ATORDOADO ? 0.35
      : j.estado === ESTADOS.MORTO ? 0.06
      : j.estado === ESTADOS.INVESTIDA ? 0.72   // semicerrados na velocidade
      : 1;

    const olho = (dx, escala) => {
      ctx.fillStyle = cores.escuro;
      ctx.beginPath();
      ctx.ellipse(dx, cy - 0.5, 3.1 * escala, 4.3 * escala * abertura, 0.06, 0, TAU);
      ctx.fill();
      if (abertura > 0.5) {
        // Reflexo: fora de centro e pequeno, senão vira olho de desenho fofo.
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(dx + 1 * escala, cy - 2 * escala, 0.95 * escala, 1.15 * escala, 0, 0, TAU);
        ctx.fill();
      }
    };

    olho(-2.6, 0.82);   // olho de trás: menor, dá perspectiva de 3/4
    olho(3.4, 1);
  }

  /**
   * O CRESCENTE do golpe, em coordenadas locais (origem no eixo do arco, já
   * espelhado pela direção). Grossa no meio e afinando pras duas pontas: é o
   * afilamento que faz ler como um corte varrendo o ar. Um `arc()` com
   * `lineWidth` constante — que era o que havia aqui — tem espessura igual do
   * começo ao fim e lê como um pedaço de aro.
   *
   * @param {number} k     0..1, progresso do golpe
   * @param {number} escala engrossa/afina o crescente inteiro
   */
  _crescente(ctx, k, escala = 1) {
    const ang0 = lerp(-1.85, -1.0, k);
    const ang1 = lerp(-1.15, 1.6, k);
    const rMed = lerp(20, 31, k);
    const esp = lerp(12, 4, k) * escala;
    const N = 16;

    ctx.beginPath();
    for (let i = 0; i <= N; i++) {          // borda de fora, ida
      const u = i / N;
      const ang = lerp(ang0, ang1, u);
      const r = rMed + esp * 0.5 * Math.sin(u * Math.PI) ** 0.6;
      const x = Math.cos(ang) * r, y = Math.sin(ang) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    for (let i = N; i >= 0; i--) {          // borda de dentro, volta
      const u = i / N;
      const ang = lerp(ang0, ang1, u);
      const r = rMed - esp * 0.5 * Math.sin(u * Math.PI) ** 0.6;
      ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
    }
    ctx.closePath();
    return { ang0, ang1, rMed, esp };
  }

  _ataque(ctx, j, tema) {
    if (j.ataqueRestante <= 0) return;
    const t = 1 - j.ataqueRestante / 0.22;
    if (t < 0.18) return;   // antecipação: nada visível ainda
    const k = (t - 0.18) / 0.82;
    const a = Math.sin(clamp01(k) * Math.PI);

    ctx.save();
    ctx.translate(j.centroX + j.direcao * 20, j.centroY - 4);
    ctx.scale(j.direcao, 1);

    // 1 · esteira: dois crescentes maiores e apagados, atrasados no tempo.
    //     É o que dá VELOCIDADE ao golpe — sem eles o corte aparece e some
    //     no mesmo lugar, e o olho não vê movimento nenhum.
    ctx.fillStyle = misturarHex(tema.crista, tema.luz, 0.4);
    for (const [atraso, alfa, esc] of [[0.20, 0.16, 1.5], [0.10, 0.26, 1.2]]) {
      const kk = k - atraso;
      if (kk <= 0) continue;
      ctx.globalAlpha = a * alfa;
      this._crescente(ctx, kk, esc);
      ctx.fill();
    }

    // 2 · o corte: massa clara com a borda de fora acesa.
    ctx.globalAlpha = a * 0.95;
    const g = ctx.createLinearGradient(0, -30, 0, 30);
    g.addColorStop(0, misturarHex('#ffffff', tema.crista, 0.15));
    g.addColorStop(1, misturarHex(tema.crista, tema.luz, 0.55));
    ctx.fillStyle = g;
    const c = this._crescente(ctx, k);
    ctx.fill();

    ctx.globalAlpha = a;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, c.rMed + c.esp * 0.42, c.ang0 + 0.12, c.ang1 - 0.12);
    ctx.stroke();
    ctx.restore();
  }

  /* ---------------------------------------------------------------------
     PASSE EMISSIVO — o personagem é a lanterna do jogo.
     --------------------------------------------------------------------- */

  desenharLuz(ctx, j, tema) {
    if (!j.visivel) return;
    const cy = j.pesY + CY_CABECA;

    // 1. Halo grande e fraco: é o que ILUMINA A CENA em volta dele. Sem
    //    isso, andar num lugar escuro não muda nada e o mundo parece um
    //    quadro de fundo, não um lugar em que se está.
    const raioBase = lerp(120, 190, this.floracao);
    luzRadial(ctx, j.centroX, j.centroY - 6, raioBase, tema.luz,
      0.34 + this.floracao * 0.2 + j.brilho * 0.25);

    // 2. Núcleo quente e pequeno: mantém o corpo nítido dentro do halo.
    luzRadial(ctx, j.centroX, j.centroY - 10, 26, '#ffffff', 0.55);

    // 3. Marcas acesas.
    if (this.floracao > 0.05) {
      luzRadial(ctx, j.centroX, j.pesY - 20, 30 * this.floracao,
        tema.crista, this.floracao * 0.65);
    }

    // 4. Ações.
    if (j.ataqueRestante > 0) {
      const t = 1 - j.ataqueRestante / 0.22;
      const a = Math.sin(clamp01(t) * Math.PI);
      // O bloom segue a FORMA do corte, não uma bola no lugar dele: um halo
      // redondo apaga justamente o afilamento que dá leitura ao golpe.
      if (t > 0.18) {
        ctx.save();
        ctx.translate(j.centroX + j.direcao * 20, j.centroY - 4);
        ctx.scale(j.direcao, 1);
        ctx.globalAlpha = a * 0.85;
        ctx.fillStyle = misturarHex('#ffffff', tema.crista, 0.35);
        this._crescente(ctx, (t - 0.18) / 0.82, 1.35);
        ctx.fill();
        ctx.restore();
      }
      luzRadial(ctx, j.centroX + j.direcao * 26, j.centroY - 4, 30,
        misturarHex('#ffffff', tema.crista, 0.4), a * 0.55);
    }
    if (j.estado === ESTADOS.INVESTIDA) {
      luzRadial(ctx, j.centroX, j.centroY, 52, tema.acento, 0.8);
      for (const r of this.rastro) {
        const a = clamp01(r.t / 0.26);
        luzRadial(ctx, r.x, r.y - 22, 26 * a, tema.luz, a * 0.5);
      }
    }

    // 5. O Canto: onda que se expande junto com o efeito real de restauração.
    if (j.cantoRestante > 0) {
      const p = j.progressoCanto;
      const raio = easeOutCubic(p) * j.raioCanto;
      const forca = Math.sin(p * Math.PI);
      ctx.save();
      ctx.strokeStyle = rgba(tema.crista, forca * 0.9);
      ctx.lineWidth = lerp(10, 1.5, p);
      ctx.beginPath();
      ctx.arc(j.centroX, j.centroY, raio, 0, TAU);
      ctx.stroke();
      ctx.restore();
      luzRadial(ctx, j.centroX, j.centroY, raio * 0.75, tema.acento, forca * 0.6);
    }
  }
}
