/* =========================================================================
   fase2/core/entrada.js — teclado + gamepad + toque, numa API só
   -------------------------------------------------------------------------
   Regra de ouro deste módulo: NENHUM sistema do jogo deve olhar `KeyboardEvent`
   direto. Tudo passa por ações nomeadas ('pular', 'correr'...), pra que
   remapear tecla, adicionar gamepad ou botão de toque não exija mexer na
   lógica de jogo.

   O detalhe que faz diferença de "feel": além de `ativo` (segurando) e
   `acabouDePressionar` (borda deste frame), existe `consumirBuffer(acao,
   janela)`. Ele responde "essa ação foi pedida nos últimos N segundos e ainda
   não foi atendida?" e marca como atendida. É assim que se faz jump buffering
   de verdade — o jogador aperta pulo um instante ANTES de tocar o chão e o
   pulo sai mesmo assim, em vez de ser engolido. Sem isso o controle parece
   "escorregadio"/sem resposta, e é a causa nº1 de plataforma que parece ruim.
   ========================================================================= */

import { clamp } from './mat.js';

/** acao → lista de `KeyboardEvent.code`. Ordem não importa. */
const MAPA_TECLADO = {
  esquerda:  ['ArrowLeft', 'KeyA'],
  direita:   ['ArrowRight', 'KeyD'],
  cima:      ['ArrowUp', 'KeyW'],
  baixo:     ['ArrowDown', 'KeyS'],
  pular:     ['Space', 'KeyZ', 'KeyK'],
  investida: ['ShiftLeft', 'ShiftRight', 'KeyX', 'KeyL'],
  atacar:    ['KeyC', 'KeyJ', 'Enter'],
  canto:     ['KeyE', 'KeyF'],   // o "canto" que restaura — verbo central do jogo
  mapa:      ['Tab', 'KeyM'],
  pausa:     ['Escape'],
};

/** acao → índices de botão no layout padrão de gamepad. */
const MAPA_GAMEPAD = {
  pular:     [0],           // A / cruz
  atacar:    [2],           // X / quadrado
  investida: [1, 5, 7],     // B, RB, RT
  canto:     [3],           // Y / triângulo
  mapa:      [8],           // select/back
  pausa:     [9],           // start
  esquerda:  [14],
  direita:   [15],
  cima:      [12],
  baixo:     [13],
};

const ACOES = Object.keys(MAPA_TECLADO);
const ZONA_MORTA = 0.28;

export class Entrada {
  constructor(alvo = window) {
    this.alvo = alvo;
    /** acao → true enquanto segurando */
    this.estado = Object.create(null);
    /** acao → true só no frame em que desceu */
    this.borda = Object.create(null);
    /** acao → true só no frame em que subiu */
    this.bordaSolta = Object.create(null);
    /** acao → timestamp (s) do último pressionar ainda não consumido; -1 = consumido */
    this.pedido = Object.create(null);
    /* Bordas PENDENTES. O evento de tecla chega entre dois passos; se ele
       escrevesse direto em `borda`, o `atualizar()` do passo seguinte zeraria
       tudo ANTES de alguém ler — era por isso que Esc, Tab e M não faziam nada
       no teclado (só no gamepad, lido depois de zerar). Aqui o evento marca
       pendente, e `atualizar()` promove pendente → borda. */
    this._bordaPend = Object.create(null);
    this._soltaPend = Object.create(null);
    /** Pedidos de interface (pausa, mapa): lidos no QUADRO, que roda mesmo com
     *  o jogo pausado — senão, pausado, nada conseguia despausar. */
    this._ui = Object.create(null);
    for (const a of ACOES) {
      this.estado[a] = false;
      this.borda[a] = false;
      this.bordaSolta[a] = false;
      this.pedido[a] = -1;
      this._bordaPend[a] = false;
      this._soltaPend[a] = false;
      this._ui[a] = false;
    }

    this.tempo = 0;
    this.eixoX = 0;
    this.eixoY = 0;
    /** Última fonte usada — deixa a UI trocar entre glifos de tecla e de botão. */
    this.fonte = 'teclado';
    this.gamepadIndex = null;

    // code → [acoes] pra resolver em O(1) no keydown
    this._porCode = Object.create(null);
    for (const [acao, codes] of Object.entries(MAPA_TECLADO)) {
      for (const c of codes) (this._porCode[c] ||= []).push(acao);
    }

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onGamepad = this._onGamepad.bind(this);
    this._botoesGamepadAnteriores = {};
  }

  ligar() {
    this.alvo.addEventListener('keydown', this._onKeyDown, { passive: false });
    this.alvo.addEventListener('keyup', this._onKeyUp);
    this.alvo.addEventListener('blur', this._onBlur);
    this.alvo.addEventListener('gamepadconnected', this._onGamepad);
    this.alvo.addEventListener('gamepaddisconnected', this._onGamepad);
  }

  desligar() {
    this.alvo.removeEventListener('keydown', this._onKeyDown);
    this.alvo.removeEventListener('keyup', this._onKeyUp);
    this.alvo.removeEventListener('blur', this._onBlur);
    this.alvo.removeEventListener('gamepadconnected', this._onGamepad);
    this.alvo.removeEventListener('gamepaddisconnected', this._onGamepad);
  }

  _onGamepad(e) {
    this.gamepadIndex = e.type === 'gamepadconnected' ? e.gamepad.index : null;
  }

  _onKeyDown(e) {
    const acoes = this._porCode[e.code];
    if (!acoes) return;
    /* Espaço rola a página e Tab troca o foco — os dois estragam o jogo. Mas
       com o foco num BOTÃO (painel de pausa, abertura) eles são a navegação
       por teclado: Tab anda entre os botões e Espaço aperta o botão. */
    const emControle = e.target?.closest?.('button, input, select, textarea, a[href]');
    if (emControle && (e.code === 'Space' || e.code === 'Tab' || e.code === 'Enter')) return;
    if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    this.fonte = 'teclado';
    if (e.repeat) return;   // auto-repeat do SO não é uma nova intenção
    for (const a of acoes) this._pressionar(a);
  }

  _onKeyUp(e) {
    const acoes = this._porCode[e.code];
    if (!acoes) return;
    for (const a of acoes) this._soltar(a);
  }

  /** Perder o foco (alt-tab) tem que zerar tudo, senão a tecla "gruda". */
  _onBlur() {
    for (const a of ACOES) {
      if (this.estado[a]) this._soltaPend[a] = true;
      this.estado[a] = false;
      this.pedido[a] = -1;
      this._bordaPend[a] = false;
    }
  }

  _pressionar(acao) {
    if (this.estado[acao]) return;
    this.estado[acao] = true;
    this._bordaPend[acao] = true;
    this._ui[acao] = true;
    this.pedido[acao] = this.tempo;
  }

  _soltar(acao) {
    if (!this.estado[acao]) return;
    this.estado[acao] = false;
    this._soltaPend[acao] = true;
  }

  /** Um pedido de interface (pausa/mapa) desde a última consulta. Consome. */
  consumirUI(acao) {
    const v = !!this._ui[acao];
    this._ui[acao] = false;
    return v;
  }

  /**
   * Chamar UMA vez por frame, ANTES da lógica de jogo.
   * Limpa as bordas do frame anterior e lê o gamepad.
   */
  atualizar(dt) {
    this.tempo += dt;
    for (const a of ACOES) {
      this.borda[a] = this._bordaPend[a];
      this.bordaSolta[a] = this._soltaPend[a];
      this._bordaPend[a] = false;
      this._soltaPend[a] = false;
    }
    this._lerGamepad();

    // Eixo analógico tem prioridade sobre digital quando está fora da zona morta.
    const digitalX = (this.estado.direita ? 1 : 0) - (this.estado.esquerda ? 1 : 0);
    const digitalY = (this.estado.baixo ? 1 : 0) - (this.estado.cima ? 1 : 0);
    this.eixoX = this._analogicoX !== 0 ? this._analogicoX : digitalX;
    this.eixoY = this._analogicoY !== 0 ? this._analogicoY : digitalY;
  }

  _lerGamepad() {
    this._analogicoX = 0;
    this._analogicoY = 0;
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    let pad = this.gamepadIndex != null ? pads[this.gamepadIndex] : null;
    if (!pad) { for (const p of pads) if (p) { pad = p; break; } }
    if (!pad) {
      // Controle caiu: solta o que ele estava segurando, senão o direcional
      // apertado na hora da queda deixava o Guardião andando sozinho.
      for (const acao in this._botoesGamepadAnteriores) {
        if (this._botoesGamepadAnteriores[acao]) this._soltar(acao);
      }
      this._botoesGamepadAnteriores = {};
      return;
    }

    const ax = pad.axes[0] ?? 0, ay = pad.axes[1] ?? 0;
    if (Math.abs(ax) > ZONA_MORTA) {
      // Reescala fora da zona morta pra não ter um degrau ao cruzar o limiar.
      this._analogicoX = clamp((Math.abs(ax) - ZONA_MORTA) / (1 - ZONA_MORTA), 0, 1) * Math.sign(ax);
      this.fonte = 'gamepad';
    }
    if (Math.abs(ay) > ZONA_MORTA) {
      this._analogicoY = clamp((Math.abs(ay) - ZONA_MORTA) / (1 - ZONA_MORTA), 0, 1) * Math.sign(ay);
      this.fonte = 'gamepad';
    }

    for (const [acao, botoes] of Object.entries(MAPA_GAMEPAD)) {
      let apertado = false;
      for (const i of botoes) if (pad.buttons[i]?.pressed) { apertado = true; break; }
      const antes = this._botoesGamepadAnteriores[acao] || false;
      if (apertado && !antes) { this._pressionar(acao); this.fonte = 'gamepad'; }
      else if (!apertado && antes) this._soltar(acao);
      this._botoesGamepadAnteriores[acao] = apertado;
    }
  }

  // ------------------------------------------------------------- consultas --
  ativo(acao) { return !!this.estado[acao]; }
  acabouDePressionar(acao) { return !!this.borda[acao]; }
  acabouDeSoltar(acao) { return !!this.bordaSolta[acao]; }

  /**
   * Jump buffering. `true` só uma vez por pressionada, e só se a pressionada
   * aconteceu nos últimos `janela` segundos. Consumir marca como atendida.
   */
  consumirBuffer(acao, janela = 0.12) {
    const t = this.pedido[acao];
    if (t < 0 || this.tempo - t > janela) return false;
    this.pedido[acao] = -1;
    return true;
  }

  /** Descarta um pedido pendente sem atendê-lo (ex: ao entrar em cutscene). */
  limparBuffer(acao) { this.pedido[acao] = -1; }

  limparTudo() { for (const a of ACOES) this.pedido[a] = -1; }

  // ----------------------------------------------------------------- toque --
  /**
   * Ponte pros botões de toque do HUD (celular/tablet). O elemento só precisa
   * ter `data-acao="pular"`; o resto do jogo não sabe que toque existe.
   */
  ligarToque(container) {
    if (!container) return;
    const alvoDe = (e) => e.target.closest('[data-acao]')?.dataset.acao;
    container.addEventListener('pointerdown', (e) => {
      const acao = alvoDe(e);
      if (!acao || !(acao in this.estado)) return;
      e.preventDefault();
      this.fonte = 'toque';
      this._pressionar(acao);
      e.target.setPointerCapture?.(e.pointerId);
    });
    const soltar = (e) => {
      const acao = alvoDe(e);
      if (!acao || !(acao in this.estado)) return;
      this._soltar(acao);
    };
    container.addEventListener('pointerup', soltar);
    container.addEventListener('pointercancel', soltar);
  }
}
