/* =========================================================================
   fase2/entidades/jogador.js — o Guardião: física, estados e habilidades
   -------------------------------------------------------------------------
   Os números aqui não são chutes ajustados até "parecer ok". Eles derivam de
   INTENÇÃO DE DESIGN e o resto é calculado:

       ALTURA_PULO  = quantos tiles o pulo precisa vencer
       TEMPO_APICE  = quanto tempo leva pra chegar lá

       gravidade    = 2·h / t²
       v0           = 2·h / t

   Isso importa porque "quero pular 3 tiles em 0,3s" é uma decisão de level
   design verificável; "gravidade = 2031" não é. Mexer na altura do pulo
   quebra salas inteiras — mexa na constante de cima, nunca na derivada.

   As três coisas que mais fazem uma plataforma parecer boa, todas aqui:
     · coyote time    — pular por alguns frames DEPOIS de sair da borda
     · jump buffer    — apertar pular ANTES de aterrissar e o pulo sair
     · pulo variável  — soltar o botão cedo encurta o pulo

   Sem essas três, nenhum ajuste de gravidade salva o controle.
   ========================================================================= */

import {
  clamp, clamp01, lerp, damp, moveTowards, sign,
  easeOutCubic, easeOutQuad, TAU,
} from '../core/mat.js';
import { TILE, PERIGO, AGUA } from '../mundo/terreno.js';

/* ---------------------------------------------------------------- ajuste -- */

const LARGURA = 22;          // caixa de colisão, não o desenho — o desenho é
const ALTURA = 44;           // maior de propósito (capa, chifres) pra dar
                             // presença sem punir o jogador com hitbox grande

const ALTURA_PULO = TILE * 3.15;   // 100.8px — vence 3 tiles com folga real
const TEMPO_APICE = 0.32;          // s até o topo
const GRAVIDADE = (2 * ALTURA_PULO) / (TEMPO_APICE * TEMPO_APICE);
const VEL_PULO = (2 * ALTURA_PULO) / TEMPO_APICE;

// Cair mais rápido do que sobe é o ajuste isolado que mais "aperta" o
// controle: o tempo no ar cai sem tirar a altura do pulo.
const MULT_GRAVIDADE_QUEDA = 1.45;
// Perto do ápice a gravidade afrouxa — dá aquele instante de flutuação em que
// o jogador enxerga onde vai cair. Copiado de Mario/HK, e é o que separa
// "pulo controlável" de "pulo balístico".
const MULT_GRAVIDADE_APICE = 0.62;
const JANELA_APICE = 78;           // |vy| abaixo disso conta como ápice
const VEL_QUEDA_MAX = 900;

const VEL_CORRIDA = 232;
const ACEL_CHAO = 2300;
const FREIO_CHAO = 3100;           // freia mais rápido do que acelera → para
                                   // no lugar que o jogador mirou
const ACEL_AR = 1500;
const FREIO_AR = 900;              // pouco controle no ar, mas não zero

const COYOTE = 0.10;               // s de tolerância após sair da borda
const BUFFER_PULO = 0.13;          // s de tolerância antes de aterrissar
const CORTE_PULO = 0.45;           // vy é multiplicado por isso ao soltar cedo

// --- Investida (dash) ---
const VEL_INVESTIDA = 560;
const DUR_INVESTIDA = 0.17;
const RECARGA_INVESTIDA = 0.42;

// --- Parede ---
const VEL_DESLIZE_PAREDE = 116;
const PULO_PAREDE_X = 290;
const PULO_PAREDE_Y = VEL_PULO * 0.94;
const TRAVA_PAREDE = 0.16;         // s ignorando input horizontal após o pulo,
                                   // senão segurar contra a parede cola de volta

// --- Planeio ---
const VEL_PLANEIO = 92;

// --- Combate ---
const DUR_ATAQUE = 0.22;
const ALCANCE_ATAQUE = 46;
const RECUO_ATAQUE = 165;          // empurrão pra trás ao acertar — vende o peso
const DUR_INVULNERAVEL = 0.95;
const RECUO_DANO_X = 235;
const RECUO_DANO_Y = 260;
const DUR_ATORDOADO = 0.26;

// --- Canto (verbo de restauração) ---
const DUR_CANTO = 1.05;
const RAIO_CANTO = 190;

export const ESTADOS = {
  PARADO: 'parado',
  CORRENDO: 'correndo',
  PULANDO: 'pulando',
  CAINDO: 'caindo',
  PAREDE: 'parede',
  INVESTIDA: 'investida',
  PLANEIO: 'planeio',
  ATORDOADO: 'atordoado',
  CANTO: 'canto',
  MORTO: 'morto',
};

/** Habilidades destraváveis. Ordem = ordem de aquisição pretendida. */
export const HABILIDADES = ['saltoDuplo', 'investida', 'canto', 'parede', 'planeio'];

export class Jogador {
  constructor(x, y) {
    // corpo físico (canto superior-esquerdo da caixa)
    this.x = x; this.y = y;
    this.largura = LARGURA;
    this.altura = ALTURA;
    this.vx = 0; this.vy = 0;

    this.estado = ESTADOS.PARADO;
    this.estadoAnterior = ESTADOS.PARADO;
    this.tempoNoEstado = 0;
    this.direcao = 1;                  // 1 = direita, -1 = esquerda

    this.noChao = false;
    this.eraNoChao = false;
    this.naParede = 0;                 // 0 nenhuma, -1 esquerda, 1 direita
    this.naAgua = false;

    this.coyote = 0;
    this.travaParede = 0;
    this.saltosRestantes = 0;
    this.segurandoPulo = false;

    this.investidaRestante = 0;
    this.recargaInvestida = 0;
    this.investidaDisponivel = true;   // recarrega ao tocar o chão/parede

    this.ataqueRestante = 0;
    this.ataqueAcertou = false;
    this.cantoRestante = 0;

    this.vidaMax = 5;
    this.vida = 5;
    this.invulneravel = 0;
    this.atordoado = 0;

    this.habilidades = new Set();

    // --- estado só de apresentação (nada aqui afeta a física) ---
    this.esticar = 1;      // squash & stretch
    this.achatar = 1;
    this.inclinacao = 0;   // radianos, inclina na direção do movimento
    this.faseAndar = 0;
    this.faseFlutuar = 0;
    this.brilho = 0;       // 0..1, pulsa em ações
    this.velAnteriorY = 0;

    /** Preenchido pelo mundo a cada passo — quem consome são os efeitos. */
    this.eventos = [];
  }

  temHabilidade(id) { return this.habilidades.has(id); }
  destravar(id) { this.habilidades.add(id); }

  get centroX() { return this.x + this.largura / 2; }
  get centroY() { return this.y + this.altura / 2; }
  get pesX() { return this.x + this.largura / 2; }
  get pesY() { return this.y + this.altura; }
  get vivo() { return this.estado !== ESTADOS.MORTO; }

  _trocarEstado(novo) {
    if (this.estado === novo) return;
    this.estadoAnterior = this.estado;
    this.estado = novo;
    this.tempoNoEstado = 0;
  }

  /**
   * `extra` é espalhado DEPOIS de x/y mas o campo `tipo` é reaplicado no fim:
   * um `extra.tipo` sobrescreveria o tipo do evento e o ouvinte cairia no
   * `case` errado (bug real que aconteceu com `_emitir('pulo',{tipo:'chao'})`).
   * Variantes de um mesmo evento vão em `variante`, nunca em `tipo`.
   */
  _emitir(tipo, extra = {}) {
    this.eventos.push({ x: this.centroX, y: this.centroY, ...extra, tipo });
  }

  /* =======================================================================
     PASSO
     ======================================================================= */

  /**
   * @param {number} dt  passo FIXO (ver core/laco.js)
   * @param {import('../core/entrada.js').Entrada} entrada
   * @param {import('../mundo/terreno.js').Terreno} terreno
   */
  atualizar(dt, entrada, terreno) {
    this.eventos.length = 0;
    this.tempoNoEstado += dt;
    this.velAnteriorY = this.vy;

    if (this.estado === ESTADOS.MORTO) {
      this._fisicaMorto(dt, terreno);
      this._apresentacao(dt);
      return;
    }

    // Timers primeiro — o resto da lógica lê os valores já decrementados.
    this.coyote = Math.max(0, this.coyote - dt);
    this.travaParede = Math.max(0, this.travaParede - dt);
    this.recargaInvestida = Math.max(0, this.recargaInvestida - dt);
    this.invulneravel = Math.max(0, this.invulneravel - dt);
    this.atordoado = Math.max(0, this.atordoado - dt);
    if (this.ataqueRestante > 0) this.ataqueRestante -= dt;
    if (this.cantoRestante > 0) this.cantoRestante -= dt;

    const controlavel = this.atordoado <= 0 && this.cantoRestante <= 0;
    const eixo = controlavel ? entrada.eixoX : 0;

    if (this.atordoado > 0) this._trocarEstado(ESTADOS.ATORDOADO);
    else if (this.cantoRestante > 0) this._trocarEstado(ESTADOS.CANTO);

    // ---------------------------------------------------------- ações ----
    if (controlavel) {
      this._tentarInvestida(entrada);
      this._tentarAtaque(entrada);
      this._tentarCanto(entrada);
    }

    // ------------------------------------------------------- movimento ---
    if (this.investidaRestante > 0) {
      this._passoInvestida(dt);
    } else {
      this._passoHorizontal(dt, eixo);
      this._passoVertical(dt, entrada, controlavel);
    }

    // --------------------------------------------------------- colisão ---
    const antesY = this.y;
    terreno.mover(this, this.vx * dt, 0, { atravessaPlataforma: false });
    const res = terreno.mover(this, 0, this.vy * dt, {
      // Segurar baixo numa plataforma faz descer por ela.
      atravessaPlataforma: controlavel && entrada.ativo('baixo') && entrada.ativo('pular'),
    });

    this.eraNoChao = this.noChao;
    this.noChao = res.chao || terreno.noChao(this, 2);

    // Parede: precisa estar no ar, encostado, e empurrando contra ela.
    this.naParede = 0;
    if (!this.noChao && this.temHabilidade('parede')) {
      const encostaDir = terreno.caixaSolida(this.x + this.largura, this.y + 6, 2, this.altura - 12);
      const encostaEsq = terreno.caixaSolida(this.x - 2, this.y + 6, 2, this.altura - 12);
      if (encostaDir && eixo > 0.2) this.naParede = 1;
      else if (encostaEsq && eixo < -0.2) this.naParede = -1;
    }

    this.naAgua = terreno.caixaToca(this.x, this.y, this.largura, this.altura, AGUA);

    // ------------------------------------------------- pós-aterrissagem --
    if (this.noChao) {
      this.coyote = COYOTE;
      this.saltosRestantes = this.temHabilidade('saltoDuplo') ? 1 : 0;
      this.investidaDisponivel = true;
      if (!this.eraNoChao) this._aoAterrissar(antesY);
    } else if (this.eraNoChao && this.vy >= 0 && this.investidaRestante <= 0) {
      // Saiu andando de uma borda: só AQUI o coyote começa a contar.
      this.coyote = COYOTE;
    }

    if (this.naParede !== 0) {
      this.investidaDisponivel = true;
      this.saltosRestantes = this.temHabilidade('saltoDuplo') ? 1 : 0;
    }

    // ------------------------------------------------------------ dano ---
    if (terreno.caixaToca(this.x + 3, this.y + 3, this.largura - 6, this.altura - 6, PERIGO)) {
      this.receberDano(1, this.centroX, this.centroY, { fonte: 'terreno' });
    }

    this._resolverEstado();
    this._apresentacao(dt);
  }

  /* ------------------------------------------------------------ ações -- */

  _tentarInvestida(entrada) {
    if (!this.temHabilidade('investida')) return;
    if (this.investidaRestante > 0 || this.recargaInvestida > 0 || !this.investidaDisponivel) return;
    if (!entrada.consumirBuffer('investida', 0.1)) return;

    this.investidaRestante = DUR_INVESTIDA;
    this.recargaInvestida = RECARGA_INVESTIDA;
    this.investidaDisponivel = false;
    // Direção da investida: o input manda; sem input, segue o olhar.
    const dir = Math.abs(entrada.eixoX) > 0.2 ? sign(entrada.eixoX) : this.direcao;
    this.direcao = dir;
    this.vx = VEL_INVESTIDA * dir;
    this.vy = 0;
    this._trocarEstado(ESTADOS.INVESTIDA);
    this._emitir('investida', { direcao: dir });
  }

  _passoInvestida(dt) {
    this.investidaRestante -= dt;
    // Gravidade zerada durante a investida: dash em linha reta é legível e
    // vira ferramenta de travessia confiável. Com gravidade, o alcance muda
    // conforme a altura e o jogador não consegue planejar o pulo.
    this.vy = 0;
    this.vx = VEL_INVESTIDA * this.direcao;
    if (this.investidaRestante <= 0) {
      // Sai da investida com parte da velocidade — cortar pra zero mata o
      // encadeamento dash→pulo, que é onde o movimento fica gostoso.
      this.vx *= 0.42;
      this._trocarEstado(this.noChao ? ESTADOS.CORRENDO : ESTADOS.CAINDO);
    }
  }

  _tentarAtaque(entrada) {
    if (this.ataqueRestante > 0) return;
    if (!entrada.consumirBuffer('atacar', 0.11)) return;
    this.ataqueRestante = DUR_ATAQUE;
    this.ataqueAcertou = false;
    this._emitir('ataque', { direcao: this.direcao });
  }

  _tentarCanto(entrada) {
    if (!this.temHabilidade('canto') || this.cantoRestante > 0 || !this.noChao) return;
    if (!entrada.consumirBuffer('canto', 0.12)) return;
    this.cantoRestante = DUR_CANTO;
    this.vx = 0;
    this._trocarEstado(ESTADOS.CANTO);
    this._emitir('canto', { raio: RAIO_CANTO });
  }

  /* -------------------------------------------------------- movimento -- */

  _passoHorizontal(dt, eixo) {
    if (this.travaParede > 0) return;   // pulo de parede em andamento

    const alvo = eixo * VEL_CORRIDA * (this.naAgua ? 0.62 : 1);
    const acelerando = Math.abs(eixo) > 0.05 && sign(eixo) === sign(this.vx || eixo);
    let taxa;
    if (this.noChao) taxa = acelerando ? ACEL_CHAO : FREIO_CHAO;
    else taxa = acelerando ? ACEL_AR : FREIO_AR;

    this.vx = moveTowards(this.vx, alvo, taxa * dt);
    if (Math.abs(eixo) > 0.05) this.direcao = sign(eixo);
  }

  _passoVertical(dt, entrada, controlavel) {
    const querPular = controlavel && entrada.consumirBuffer('pular', BUFFER_PULO);
    this.segurandoPulo = controlavel && entrada.ativo('pular');

    // --- deslize na parede ---
    if (this.naParede !== 0 && this.vy > 0) {
      this.vy = Math.min(this.vy, VEL_DESLIZE_PAREDE);
      this._trocarEstado(ESTADOS.PAREDE);
      if (querPular) { this._pularDaParede(); return; }
    }

    // --- pulos ---
    if (querPular) {
      if (this.noChao || this.coyote > 0) this._pular();
      else if (this.naParede !== 0) this._pularDaParede();
      else if (this.saltosRestantes > 0) this._pularNoAr();
    }

    // --- corte do pulo variável ---
    // Só corta subindo e só se o botão foi solto: é o que dá controle fino de
    // altura sem exigir precisão de frame do jogador.
    if (this.vy < 0 && !this.segurandoPulo) {
      this.vy = Math.max(this.vy, this.vy * CORTE_PULO + 0);
      if (this.vy > -60) this.vy = Math.max(this.vy, -60);
    }

    // --- planeio ---
    const planando = this.temHabilidade('planeio') && controlavel &&
      entrada.ativo('pular') && this.vy > 0 && !this.noChao && this.naParede === 0;

    // --- gravidade ---
    let g = GRAVIDADE;
    if (planando) {
      this.vy = damp(this.vy, VEL_PLANEIO, 0.09, dt);
      this._trocarEstado(ESTADOS.PLANEIO);
      g = 0;
    } else if (this.vy > 0) {
      g *= MULT_GRAVIDADE_QUEDA;
    }
    if (Math.abs(this.vy) < JANELA_APICE && !this.noChao && !planando) {
      g *= MULT_GRAVIDADE_APICE;
    }
    if (this.naAgua) g *= 0.42;

    this.vy = Math.min(this.vy + g * dt, this.naAgua ? VEL_QUEDA_MAX * 0.4 : VEL_QUEDA_MAX);
  }

  _pular() {
    this.vy = -VEL_PULO;
    this.coyote = 0;
    this.noChao = false;
    this.esticar = 1.28; this.achatar = 0.76;
    this._trocarEstado(ESTADOS.PULANDO);
    this._emitir('pulo', { variante: 'chao' });
  }

  _pularNoAr() {
    this.saltosRestantes--;
    this.vy = -VEL_PULO * 0.92;
    this.esticar = 1.34; this.achatar = 0.72;
    this.brilho = 1;
    this._trocarEstado(ESTADOS.PULANDO);
    this._emitir('pulo', { variante: 'duplo' });
  }

  _pularDaParede() {
    const fora = -this.naParede;
    this.vx = PULO_PAREDE_X * fora;
    this.vy = -PULO_PAREDE_Y;
    this.direcao = fora;
    this.travaParede = TRAVA_PAREDE;
    this.naParede = 0;
    this.esticar = 1.22; this.achatar = 0.8;
    this._trocarEstado(ESTADOS.PULANDO);
    this._emitir('pulo', { variante: 'parede', direcao: fora });
  }

  _aoAterrissar(antesY) {
    const impacto = clamp01(this.velAnteriorY / VEL_QUEDA_MAX);
    // Squash proporcional à queda: pulinho quase não deforma, queda de altura
    // amassa. Deformação constante parece animação em loop, não reação.
    this.achatar = 1 + impacto * 0.42;
    this.esticar = 1 - impacto * 0.3;
    this._emitir('aterrissar', { impacto, x: this.pesX, y: this.pesY });
  }

  _fisicaMorto(dt, terreno) {
    this.vy = Math.min(this.vy + GRAVIDADE * dt, VEL_QUEDA_MAX);
    this.vx = damp(this.vx, 0, 0.2, dt);
    terreno.mover(this, this.vx * dt, this.vy * dt);
  }

  _resolverEstado() {
    if (this.atordoado > 0 || this.cantoRestante > 0 || this.investidaRestante > 0) return;
    if (this.estado === ESTADOS.PLANEIO && this.vy > 0 && !this.noChao) return;
    if (this.naParede !== 0 && this.vy > 0) { this._trocarEstado(ESTADOS.PAREDE); return; }
    if (!this.noChao) {
      this._trocarEstado(this.vy < 0 ? ESTADOS.PULANDO : ESTADOS.CAINDO);
      return;
    }
    this._trocarEstado(Math.abs(this.vx) > 18 ? ESTADOS.CORRENDO : ESTADOS.PARADO);
  }

  /* ----------------------------------------------------------- combate -- */

  /** Retângulo do golpe neste frame, ou null. Quem testa colisão é o mundo. */
  caixaAtaque() {
    if (this.ataqueRestante <= 0) return null;
    // Ativa só no MIOLO da animação: janela cheia faz o golpe acertar antes de
    // aparecer na tela, e o jogador não entende por que acertou/errou.
    const t = 1 - this.ataqueRestante / DUR_ATAQUE;
    if (t < 0.15 || t > 0.72) return null;
    const alturaGolpe = 40;
    return {
      x: this.direcao > 0 ? this.x + this.largura - 4 : this.x - ALCANCE_ATAQUE + 4,
      y: this.centroY - alturaGolpe / 2,
      largura: ALCANCE_ATAQUE,
      altura: alturaGolpe,
    };
  }

  /** Chamado pelo mundo quando a caixa de ataque encosta em algo. */
  confirmarAcerto() {
    if (this.ataqueAcertou) return false;
    this.ataqueAcertou = true;
    // Recuo: o golpe empurra o jogador pra trás. Sem isso, bater parece
    // apertar botão; com isso, parece bater em algo com massa.
    this.vx = -this.direcao * RECUO_ATAQUE;
    this._emitir('acerto', { direcao: this.direcao });
    return true;
  }

  receberDano(quantidade, deX, deY, { fonte = 'inimigo' } = {}) {
    if (this.invulneravel > 0 || !this.vivo) return false;
    // Investida NÃO dá invencibilidade: transformar o dash em botão de
    // atravessar tudo apaga o desafio de posicionamento das salas.
    this.vida = Math.max(0, this.vida - quantidade);
    this.invulneravel = DUR_INVULNERAVEL;
    this.atordoado = DUR_ATORDOADO;
    this.investidaRestante = 0;

    const dir = deX === this.centroX ? -this.direcao : sign(this.centroX - deX);
    this.vx = RECUO_DANO_X * dir;
    this.vy = -RECUO_DANO_Y;
    this.direcao = -dir;   // olha pra fonte do dano
    this._trocarEstado(ESTADOS.ATORDOADO);
    this._emitir('dano', { quantidade, fonte, dir });

    if (this.vida <= 0) this._morrer();
    return true;
  }

  curar(quantidade) {
    const antes = this.vida;
    this.vida = Math.min(this.vidaMax, this.vida + quantidade);
    if (this.vida !== antes) this._emitir('cura', { quantidade: this.vida - antes });
  }

  _morrer() {
    this._trocarEstado(ESTADOS.MORTO);
    this.vy = -300;
    this._emitir('morte');
  }

  reviver(x, y) {
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.vida = this.vidaMax;
    this.invulneravel = 1.2;
    this.atordoado = 0;
    this.investidaRestante = 0;
    this.cantoRestante = 0;
    this.ataqueRestante = 0;
    this._trocarEstado(ESTADOS.PARADO);
  }

  /* ----------------------------------------------------- apresentação -- */

  _apresentacao(dt) {
    // Squash/stretch volta ao normal com mola, não linearmente — o overshoot
    // leve é o que faz parecer elástico em vez de mecânico.
    this.esticar = damp(this.esticar, 1, 0.075, dt);
    this.achatar = damp(this.achatar, 1, 0.075, dt);
    this.brilho = damp(this.brilho, 0, 0.14, dt);

    const velNorm = clamp(this.vx / VEL_CORRIDA, -1, 1);
    const inclAlvo = this.estado === ESTADOS.INVESTIDA
      ? velNorm * 0.24
      : (this.noChao ? velNorm * 0.1 : velNorm * 0.16);
    this.inclinacao = damp(this.inclinacao, inclAlvo, 0.1, dt);

    // Fase de passada acoplada à velocidade REAL, não a um timer: os pés
    // acompanham o chão e não patinam.
    if (this.noChao) this.faseAndar += (Math.abs(this.vx) / 26) * dt;
    else this.faseAndar += dt * 1.6;
    this.faseFlutuar += dt;
    if (this.faseAndar > TAU * 1000) this.faseAndar %= TAU;
    if (this.faseFlutuar > TAU * 1000) this.faseFlutuar %= TAU;
  }

  /** Piscar durante invulnerabilidade — quem desenha consulta isso. */
  get visivel() {
    if (this.invulneravel <= 0) return true;
    // Pisca acelerando conforme acaba, avisando que a proteção vai sumir.
    const f = 1 - this.invulneravel / DUR_INVULNERAVEL;
    return Math.sin(this.invulneravel * lerp(26, 54, f)) > -0.2;
  }

  /** Progresso 0..1 do canto — usado pelo efeito de onda de restauração. */
  get progressoCanto() {
    return this.cantoRestante <= 0 ? 0 : 1 - this.cantoRestante / DUR_CANTO;
  }

  get raioCanto() { return RAIO_CANTO; }

  /** Serialização mínima pro save (Firestore). */
  paraSave() {
    return {
      x: Math.round(this.x), y: Math.round(this.y),
      vida: this.vida, vidaMax: this.vidaMax,
      habilidades: [...this.habilidades],
    };
  }

  aplicarSave(dados) {
    if (!dados) return;
    this.x = dados.x ?? this.x;
    this.y = dados.y ?? this.y;
    this.vidaMax = dados.vidaMax ?? this.vidaMax;
    this.vida = clamp(dados.vida ?? this.vidaMax, 0, this.vidaMax);
    this.habilidades = new Set(dados.habilidades ?? []);
  }
}

export const AJUSTE = {
  LARGURA, ALTURA, GRAVIDADE, VEL_PULO, VEL_CORRIDA, ALTURA_PULO, TEMPO_APICE,
  VEL_INVESTIDA, DUR_INVESTIDA, ALCANCE_ATAQUE, DUR_ATAQUE, RAIO_CANTO, DUR_CANTO,
};
