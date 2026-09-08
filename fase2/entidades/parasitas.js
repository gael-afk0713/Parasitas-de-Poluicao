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

    const nTent = forma.tentaculos ?? 7;
    const espalha = forma.espalhaTentaculos ?? 1;
    this.tentaculos = Array.from({ length: nTent }, (_, i) => {
      const f = nTent === 1 ? 0.5 : i / (nTent - 1);
      const h = hash2(obj.cx + i, obj.cy, 23);
      return {
        // Só o hemisfério superior: em 360° a criatura lê como aranha.
        ang: lerp(-Math.PI * 1.03, 0.09, f) * espalha
             - (1 - espalha) * Math.PI / 2 + (h - 0.5) * 0.28,
        comp: (forma.compTentaculo ?? 26) * lerp(0.6, 1.25, Math.sin(f * Math.PI)) * (0.8 + h * 0.4),
        fase: h * TAU,
        vel: 0.7 + h * 0.8,
        curva: (f - 0.5) * 1.7 + (h - 0.5) * 0.4,
      };
    });

    const nOlhos = forma.olhos ?? 5;
    this.olhos = Array.from({ length: nOlhos }, (_, i) => {
      const f = nOlhos === 1 ? 0.5 : i / (nOlhos - 1);
      return {
        dx: lerp(-this.raio * 0.42, this.raio * 0.42, f),
        dy: -this.raio * 0.7 + Math.abs(f - 0.5) * this.raio * 0.42,
        alt: lerp(this.raio * 0.4, this.raio * 0.2, Math.abs(f - 0.5) * 2),
        fase: hash2(obj.cx, obj.cy + i, 29) * TAU,
      };
    });
  }

  get centroX() { return this.x + this.largura / 2; }
  get centroY() { return this.y + this.altura / 2; }

  caixa() {
    // Um pouco menor que o desenho: a hitbox generosa a favor do jogador é a
    // diferença entre "encostei de raspão" e "foi injusto".
    const m = 5;
    return { x: this.x + m, y: this.y + m, largura: this.largura - m * 2, altura: this.altura - m * 2 };
  }

  /* -------------------------------------------------------------- passo -- */

  atualizar(dt, mundo) {
    this.t += dt;
    this.piscarDano = Math.max(0, this.piscarDano - dt);

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
    mundo.aoEvento?.({ tipo: 'inimigoMorto', x: this.centroX, y: this.centroY });
    this.aoMorrer?.(mundo);
  }

  /* ------------------------------------------------------------ desenho -- */

  desenhar(ctx, tema, camera) {
    const morre = clamp01(this.morrendo);
    const ferida = this.piscarDano > 0;
    const cx = this.centroX;
    const cy = this.centroY + Math.sin(this.t * 3.1) * 1.6;

    ctx.save();
    if (morre > 0) {
      ctx.globalAlpha = 1 - morre;
      ctx.translate(cx, cy);
      ctx.scale(1 + morre * 0.5, 1 + morre * 0.5);
      ctx.translate(-cx, -cy);
    }

    this._fumaca(ctx, tema, cx, cy);
    this._tentaculos(ctx, tema, cx, cy, ferida);
    this._massa(ctx, tema, cx, cy, ferida);

    ctx.restore();
  }

  _fumaca(ctx, tema, cx, cy) {
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = tema.primeiroPlano;
    for (let i = 0; i < 3; i++) {
      const f = (this.t * 0.35 + i / 3) % 1;
      ctx.beginPath();
      ctx.arc(cx + Math.sin(this.t * 0.9 + i * 2) * 5,
        cy - this.raio * 0.5 - f * 22, this.raio * 0.45 + f * 7, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  _tentaculos(ctx, tema, cx, cy, ferida) {
    const cor = ferida ? '#ffffff' : misturarHex(tema.primeiroPlano, tema.ceuTopo, 0.4);
    const ox = cx, oy = cy - this.raio * 0.46;
    // Inflam junto com o telegrafo — o aviso é físico, não um ícone.
    const escala = 1 + this.telegrafo * 0.35;

    ctx.save();
    ctx.lineCap = 'round';
    for (const t of this.tentaculos) {
      const a = t.ang + Math.sin(this.t * t.vel + t.fase) * 0.42;
      const comp = t.comp * escala;
      const px = ox + Math.cos(a) * comp;
      const py = oy + Math.sin(a) * comp * 0.85;
      const mx = ox + Math.cos(a + t.curva * 0.5) * comp * 0.55;
      const my = oy + Math.sin(a + t.curva * 0.5) * comp * 0.5;

      // Afina em 4 subsegmentos: o canvas não tem espessura variável, e
      // garra de espessura constante lê como antena de inseto.
      let ax = ox, ay = oy;
      ctx.strokeStyle = cor;
      for (let k = 1; k <= 4; k++) {
        const u = k / 4, iu = 1 - u;
        const bx = iu * iu * ox + 2 * iu * u * mx + u * u * px;
        const by = iu * iu * oy + 2 * iu * u * my + u * u * py;
        ctx.lineWidth = lerp(this.raio * 0.5, 0.9, (k - 0.5) / 4);
        ctx.beginPath();
        ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ax = bx; ay = by;
      }

      // Fio de luz na borda externa: sem ele a criatura preta some contra a
      // parede escura em vez de ler como silhueta.
      if (!ferida) {
        ctx.globalAlpha = 0.22 + this.telegrafo * 0.5;
        ctx.strokeStyle = tema.acento;
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(ox, oy); ctx.quadraticCurveTo(mx, my, px, py); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  _massa(ctx, tema, cx, cy, ferida) {
    const r = this.raio * (1 + this.telegrafo * 0.18);
    const cor = ferida ? '#ffffff' : misturarHex(tema.primeiroPlano, tema.ceuTopo, 0.4);
    const inclina = this.dir * 0.12 + Math.sin(this.t * 0.8) * 0.05;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(inclina);
    ctx.fillStyle = cor;

    const onda = (a, k) => Math.sin(a * 3 + this.t * 1.7 + k) * r * 0.12;
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.6);                                  // ponta do capuz
    ctx.bezierCurveTo(r * 0.46 + onda(1, 0), -r * 1.38, r * 0.92 + onda(2, 1), -r * 0.7, r, -0.08 * r);
    if (this.temManto) {
      ctx.bezierCurveTo(r * 1.04, r * 0.54, r * 0.77, r, r * 0.54 + onda(3, 2), r * 1.3);
      // Barra esfarrapada: dentes irregulares dissolvendo em fumaça.
      for (let i = 3; i >= -3; i--) {
        const x = i * r * 0.2;
        ctx.lineTo(x, r * 1.3 + Math.sin(i * 2.1 + this.t * 2.2) * r * 0.27);
        ctx.lineTo(x - r * 0.1, r * 0.92 + Math.sin(i * 1.7 + this.t) * r * 0.12);
      }
      ctx.bezierCurveTo(-r * 0.77, r, -r * 1.04, r * 0.54, -r, -0.08 * r);
    } else {
      // Sem manto: fundo arredondado. É o que separa o Espreita (que flutua)
      // dos que andam — a silhueta conta como a criatura se move.
      ctx.bezierCurveTo(r * 1.02, r * 0.6, r * 0.6, r * 1.05, 0, r * 1.05);
      ctx.bezierCurveTo(-r * 0.6, r * 1.05, -r * 1.02, r * 0.6, -r, -0.08 * r);
    }
    ctx.bezierCurveTo(-r * 0.92 + onda(2, 3), -r * 0.7, -r * 0.46 + onda(1, 4), -r * 1.38, 0, -r * 1.6);
    ctx.closePath();
    ctx.fill();

    if (!ferida) {
      ctx.fillStyle = '#ffffff';
      for (const o of this.olhos) {
        ctx.globalAlpha = (0.75 + 0.25 * Math.sin(this.t * 2.6 + o.fase)) * (1 - this.telegrafo * 0.2)
          + this.telegrafo * 0.25;
        ctx.save();
        ctx.translate(o.dx * this.dir, o.dy);
        ctx.rotate(o.dx * this.dir * 0.055);
        ctx.beginPath();
        ctx.ellipse(0, 0, 0.8, o.alt * (1 + this.telegrafo * 0.5), 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
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

    const cy = this.centroY + Math.sin(this.t * 3.1) * 1.6;
    ctx.save();
    ctx.translate(this.centroX, cy);
    ctx.fillStyle = '#ffffff';
    for (const o of this.olhos) {
      ctx.globalAlpha = (0.5 + 0.3 * Math.sin(this.t * 2.6 + o.fase)) + this.telegrafo * 0.5;
      ctx.beginPath();
      ctx.ellipse(o.dx * this.dir, o.dy, 1.6, o.alt * 1.35, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    luzRadial(ctx, this.centroX, cy, this.raio * 1.9,
      tema.acento, 0.3 + this.telegrafo * 0.6);
  }
}

/* =========================================================================
   1 · ERRANTE — o inimigo básico
   ========================================================================= */

export class Errante extends Sombra {
  constructor(obj) {
    super(obj, { vida: 2, raio: 13, largura: 30, altura: 32, tentaculos: 7 });
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
      vida: 1, raio: 11, largura: 26, altura: 26,
      tentaculos: 9, compTentaculo: 20, olhos: 3,
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
      vida: 3, raio: 15, largura: 34, altura: 36,
      tentaculos: 5, compTentaculo: 22, olhos: 6,
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
    if (this.recarga <= 0 && d < this.alcance && !j.vivo === false) {
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
      vida: 1, raio: 10, largura: 24, altura: 24,
      tentaculos: 6, compTentaculo: 17, olhos: 3, temManto: false, gravidade: false,
    });
    this.normal = 0;
    this.vel = 96;
    this.ancoraX = this.centroX;
    this.ancoraY = this.centroY;
  }

  comportamento(dt, mundo) {
    const terreno = mundo.sala.terreno;
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
      vida: 1, raio: 12, largura: 28, altura: 28,
      tentaculos: 8, compTentaculo: 15, olhos: 2, dano: 2,
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
      vida: 2, raio: 12, largura: 26, altura: 28,
      tentaculos: 6, compTentaculo: 18, olhos: 4, gravidade: false,
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
