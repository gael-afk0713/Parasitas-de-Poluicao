/* =========================================================================
   fase2/audio/musica.js — trilha adaptativa, sintetizada
   -------------------------------------------------------------------------
   Sem nenhum arquivo de áudio. Dois motivos, um prático e um artístico:

   · PRÁTICO — o projeto é hospedado no GitHub Pages sem build step. Uma
     trilha gravada decente pesaria mais que o jogo inteiro.
   · ARTÍSTICO — som gerado responde CONTINUAMENTE ao estado. Aqui a pureza da
     área abre o filtro e faz a melodia aparecer, o combate acende uma camada
     rítmica, o chefe aperta o baixo. Faixa gravada só consegue cortar de uma
     para outra, e o corte sempre denuncia que existe um sistema por trás.

   AGENDAMENTO. WebAudio não tem "toque esta nota agora" confiável: `setTimeout`
   tem jitter de dezenas de milissegundos e isso destrói qualquer ritmo. O
   padrão correto, usado aqui, é lookahead — um timer grosseiro (25 ms) que
   olha uma janela à frente (120 ms) e AGENDA no relógio de amostra do
   contexto (`currentTime + offset`), que é preciso. O timer pode atrasar à
   vontade; as notas já estão marcadas.

   COMPOSIÇÃO (revisão pedida pelo autor: "melhore essa música").
   A versão anterior era UM acorde aberto parado pra sempre (dente-de-serra e
   onda quadrada crus a 55 Hz — lia como zumbido de transformador) e notas
   sorteadas por cima. Sem harmonia andando, nada soava como música, só como
   ambiente. Agora:
   · cada área tem uma PROGRESSÃO de quatro acordes, um por compasso, e o pad
     troca de acorde com ataque e soltura longos (as trocas se sobrepõem);
   · o pad é quente: dois dente-de-serra desafinados por nota, cada voz num
     passa-baixa próprio — o filtro come a aspereza e deixa o corpo;
   · a melodia é um MOTIVO composto por área (graus da escala, com pausas),
     tocado em frases de dois compassos e respondido uma oitava acima; a
     pureza decide com que frequência ele aparece;
   · um arpejo dedilhado das notas do acorde, com eco, cresce com a
     restauração — a área curada canta, a morta só respira;
   · combate: bumbo macio nos tempos 1 e 3 e chimbal no contratempo; chefe:
     baixo em colcheias e um tambor grave no fim do compasso.
   ========================================================================= */

/** Escalas (semitons) — a melodia anda nelas. */
const PENTA_MENOR = [0, 3, 5, 7, 10];
const PENTA_MAIOR = [0, 2, 4, 7, 9];

/* Acordes em semitons a partir da tônica da área. Menor: i–VI–III–VII, a
   progressão "épica e triste" de trilha de aventura; o Coração vai pra
   i–iv–VI–v, mais pesada; o Dossel, a área mais alta e aberta, é maior. */
const MENOR = [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]];
const PESADA = [[0, 3, 7], [5, 8, 12], [-4, 0, 3], [7, 10, 14]];
const MAIOR = [[0, 4, 7], [7, 11, 14], [9, 12, 16], [5, 9, 12]];

/* Motivos: graus da escala da área (índice em `modo`), `null` = pausa.
   16 colcheias = dois compassos; a segunda frase do ciclo sobe uma oitava. */
const MOTIVO_RAIZES = [0, null, 2, null, 1, null, null, null, 4, null, 3, 2, 1, null, null, null];
const MOTIVO_VARZEA = [2, null, null, 1, 0, null, null, null, 3, null, 2, null, 4, null, null, null];
const MOTIVO_CLAREIRA = [4, 3, null, 2, null, null, 1, null, 0, null, null, null, 2, null, 1, null];
const MOTIVO_DOSSEL = [0, 1, 2, null, 4, null, 3, null, 2, null, 1, null, 2, null, null, null];
const MOTIVO_CORACAO = [0, null, null, null, 1, null, 0, null, 4, null, null, 3, 2, null, null, null];

/** Tônica, escala, progressão e motivo de cada área. A tônica sobe conforme
 *  o jogo avança — a jornada inteira é uma modulação lenta para cima. */
const COR_DA_AREA = {
  raizes:   { tonica: 55.00, modo: PENTA_MENOR, acordes: MENOR,  motivo: MOTIVO_RAIZES },
  varzea:   { tonica: 61.74, modo: PENTA_MENOR, acordes: MENOR,  motivo: MOTIVO_VARZEA },
  clareira: { tonica: 58.27, modo: PENTA_MENOR, acordes: MENOR,  motivo: MOTIVO_CLAREIRA },
  dossel:   { tonica: 65.41, modo: PENTA_MAIOR, acordes: MAIOR,  motivo: MOTIVO_DOSSEL },
  coracao:  { tonica: 73.42, modo: PENTA_MENOR, acordes: PESADA, motivo: MOTIVO_CORACAO },
};

const LOOKAHEAD_MS = 25;
const JANELA_S = 0.12;
const PASSOS_POR_COMPASSO = 8;   // colcheias
const COMPASSOS_NO_CICLO = 4;    // um acorde por compasso

const semitom = (f, s) => f * Math.pow(2, s / 12);

export class Musica {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} destino  normalmente o barramento de música
   */
  constructor(ctx, destino) {
    this.ctx = ctx;
    this.saida = ctx.createGain();
    this.saida.gain.value = 0;

    // --- barramentos por camada ---
    this.barramentos = {};
    for (const nome of ['pad', 'melodia', 'arpejo', 'baixo', 'pulso']) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.saida);
      this.barramentos[nome] = g;
    }

    // Filtro global: é o "abrir a janela" da restauração. Fechado, o mundo
    // soa abafado e opressivo; aberto, soa espaçoso.
    this.filtro = ctx.createBiquadFilter();
    this.filtro.type = 'lowpass';
    this.filtro.frequency.value = 400;
    this.filtro.Q.value = 0.7;
    this.saida.connect(this.filtro);
    this.filtro.connect(destino);

    /* Eco de colcheia pontuada na melodia e no arpejo. É o que transforma
       notas soltas em frase com espaço entre elas — sem ele, arpejo
       sintetizado soa como relógio. */
    this.eco = ctx.createDelay(2);
    this.ecoRetorno = ctx.createGain();
    this.ecoRetorno.gain.value = 0.32;
    const ecoFiltro = ctx.createBiquadFilter();
    ecoFiltro.type = 'lowpass';
    ecoFiltro.frequency.value = 2200;
    this.eco.connect(ecoFiltro);
    ecoFiltro.connect(this.ecoRetorno);
    this.ecoRetorno.connect(this.eco);
    const ecoSaida = ctx.createGain();
    ecoSaida.gain.value = 0.5;
    ecoFiltro.connect(ecoSaida);
    ecoSaida.connect(this.filtro);
    this.barramentos.melodia.connect(this.eco);
    this.barramentos.arpejo.connect(this.eco);

    // Reverb barato: um impulso de ruído decrescente. Sem reverb, som
    // sintetizado fica colado no rosto do ouvinte e não sugere lugar nenhum.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulso(3.2, 2.4);
    this.envioReverb = ctx.createGain();
    this.envioReverb.gain.value = 0.34;
    this.filtro.connect(this.envioReverb);
    this.envioReverb.connect(this.reverb);
    this.reverb.connect(destino);

    // --- estado musical ---
    this.area = 'raizes';
    this.pureza = 0;
    this.intensidade = 0;      // 0 explorando .. 1 combate
    this.chefe = false;
    this.bpm = 62;

    this.passo = 0;
    this._proximoPasso = 0;
    this._timer = null;
    this._ligada = false;
    this._tocarMotivo = false;   // sorteado a cada frase de dois compassos
    this._corDoCompasso = null;  // a área fica fixa até o fim do compasso
  }

  /** Resposta de impulso sintética para o convolver. */
  _impulso(duracao, decaimento) {
    const taxa = this.ctx.sampleRate;
    const n = Math.floor(taxa * duracao);
    const buf = this.ctx.createBuffer(2, n, taxa);
    for (let c = 0; c < 2; c++) {
      const dados = buf.getChannelData(c);
      for (let i = 0; i < n; i++) {
        // Ruído com cauda exponencial — o suficiente para sugerir espaço.
        dados[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decaimento);
      }
    }
    return buf;
  }

  iniciar() {
    if (this._ligada) return;
    this._ligada = true;
    this._proximoPasso = this.ctx.currentTime + 0.1;
    this._timer = setInterval(() => this._agendar(), LOOKAHEAD_MS);
    this.saida.gain.setTargetAtTime(1, this.ctx.currentTime, 2.5);
  }

  parar() {
    this._ligada = false;
    clearInterval(this._timer);
    this.saida.gain.setTargetAtTime(0, this.ctx.currentTime, 0.6);
  }

  /** Chamado pelo jogo a cada quadro. Tudo aqui é suave e contínuo. */
  definirEstado({ area, pureza, intensidade, chefe }) {
    const t = this.ctx.currentTime;
    // Trocar de área nunca produz silêncio: o acorde que está soando termina
    // de soltar e o próximo compasso já entra na tônica nova.
    if (area && COR_DA_AREA[area]) this.area = area;
    if (pureza != null) this.pureza = pureza;
    if (intensidade != null) this.intensidade = intensidade;
    if (chefe != null) this.chefe = chefe;

    // Filtro: a restauração literalmente ABRE o som.
    const alvoFiltro = 600 + this.pureza * 3800 + this.intensidade * 900
      + (this.chefe ? 700 : 0);
    this.filtro.frequency.setTargetAtTime(alvoFiltro, t, 0.9);

    // Mixagem por camada. O pad está sempre presente; melodia e arpejo crescem
    // com a vida da área (a recompensa sonora da restauração); pulso e baixo
    // entram com o combate.
    const g = this.barramentos;
    g.pad.gain.setTargetAtTime(0.15 + this.pureza * 0.04, t, 1.2);
    g.melodia.gain.setTargetAtTime(0.05 + this.pureza * 0.11, t, 1.6);
    g.arpejo.gain.setTargetAtTime(0.012 + this.pureza * 0.07, t, 1.6);
    g.baixo.gain.setTargetAtTime(0.10 + this.intensidade * 0.10 + (this.chefe ? 0.08 : 0), t, 0.8);
    g.pulso.gain.setTargetAtTime(this.intensidade * 0.11 + (this.chefe ? 0.08 : 0), t, 0.6);

    // O andamento acelera com a tensão, mas pouco: música de exploração que
    // acelera demais vira trilha de ação e come a atmosfera.
    this.bpm = 62 + this.intensidade * 16 + (this.chefe ? 14 : 0);
    // Eco em colcheia pontuada do andamento atual.
    this.eco.delayTime.setTargetAtTime(60 / this.bpm * 0.75, t, 0.5);
    this.envioReverb.gain.setTargetAtTime(0.24 + this.pureza * 0.26, t, 1.5);
  }

  /* ---------------------------------------------------------------------
     Agendamento
     --------------------------------------------------------------------- */

  _duracaoPasso() { return 60 / this.bpm / (PASSOS_POR_COMPASSO / 4); }

  _agendar() {
    if (!this._ligada) return;
    const c = this.ctx;
    /* Aba em segundo plano segura o setInterval com o contexto rodando: na
       volta, todos os passos atrasados seriam agendados no passado e
       tocariam juntos, numa rajada. Atraso grande = retoma de agora. */
    if (this._proximoPasso < c.currentTime - 0.25) this._proximoPasso = c.currentTime + 0.05;
    while (this._proximoPasso < c.currentTime + JANELA_S) {
      this._tocarPasso(this.passo, this._proximoPasso);
      this._proximoPasso += this._duracaoPasso();
      this.passo = (this.passo + 1) % (PASSOS_POR_COMPASSO * COMPASSOS_NO_CICLO);
    }
  }

  _tocarPasso(passo, quando) {
    const noCompasso = passo % PASSOS_POR_COMPASSO;
    /* A área é lida só no começo do compasso: trocando no meio, baixo e
       arpejo iam pra tônica nova por cima do pad ainda na antiga — um trecho
       desafinado a cada porta entre áreas. */
    if (noCompasso === 0 || !this._corDoCompasso) {
      this._corDoCompasso = COR_DA_AREA[this.area] ?? COR_DA_AREA.raizes;
    }
    const cor = this._corDoCompasso;
    const compasso = Math.floor(passo / PASSOS_POR_COMPASSO);
    const acorde = cor.acordes[compasso % cor.acordes.length];
    const dPasso = this._duracaoPasso();
    const dCompasso = dPasso * PASSOS_POR_COMPASSO;

    // --- pad: o acorde do compasso, entrando devagar e saindo devagar ---
    if (noCompasso === 0) this._acorde(cor.tonica * 2, acorde, quando, dCompasso);

    // --- baixo: fundamental no 1 e no "e" do 3; colcheias no chefe ---
    const raiz = semitom(cor.tonica, acorde[0] < 0 ? acorde[0] + 12 : acorde[0]);
    if (noCompasso === 0 || noCompasso === 5 || (this.chefe && noCompasso % 2 === 0)) {
      this._nota({
        freq: raiz, destino: this.barramentos.baixo, tipo: 'triangle',
        dur: noCompasso === 0 ? dCompasso * 0.9 : dPasso * 2.5, quando, vol: 0.55, ataque: 0.04,
      });
    }

    // --- arpejo: notas do acorde subindo e descendo, em colcheias ---
    const ordem = [0, 1, 2, 3, 2, 1, 0, 1];
    const i = ordem[noCompasso];
    const grauArpejo = i === 3 ? acorde[0] + 12 : acorde[i];
    this._nota({
      freq: semitom(cor.tonica * 4, grauArpejo), destino: this.barramentos.arpejo,
      tipo: 'sine', dur: dPasso * 3, quando, vol: noCompasso === 0 ? 0.5 : 0.36, ataque: 0.005,
    });

    // --- melodia: o motivo da área em frases de dois compassos ---
    const naFrase = passo % (PASSOS_POR_COMPASSO * 2);
    if (naFrase === 0) {
      // Área morta quase não canta; restaurada, canta quase sempre. A
      // segunda frase do ciclo responde uma oitava acima.
      this._tocarMotivo = Math.random() < 0.25 + this.pureza * 0.65;
    }
    const grau = this._tocarMotivo ? cor.motivo[naFrase] : null;
    if (grau != null) {
      const modo = cor.modo;
      const oitava = Math.floor(grau / modo.length) + (compasso >= 2 ? 1 : 0);
      const s = modo[grau % modo.length] + 12 * oitava;
      this._flauta(semitom(cor.tonica * 4, s), quando, dPasso * 2.6);
    }

    // --- pulso: só quando há tensão ---
    if (this.intensidade > 0.05) {
      if (noCompasso === 0 || noCompasso === 4) this._bumbo(quando, 0.9);
      if (noCompasso % 2 === 1) {
        this._ruido({ destino: this.barramentos.pulso, quando, dur: 0.05, freq: 7000, vol: 0.28 });
      }
    }
    if (this.chefe && noCompasso === 6) {
      this._ruido({ destino: this.barramentos.pulso, quando, dur: 0.22, freq: 160, vol: 0.8 });
    }
  }

  /* ---------------------------------------------------------------------
     Vozes
     --------------------------------------------------------------------- */

  /**
   * Um acorde do pad. Cada nota são dois dente-de-serra desafinados ±7
   * cents (o batimento lento é o que faz pad soar vivo) num passa-baixa
   * próprio, mais um seno uma oitava abaixo da fundamental pra dar chão.
   * A soltura invade o compasso seguinte: as trocas de acorde se fundem.
   */
  _acorde(base, acorde, quando, dur) {
    const c = this.ctx;
    const ataque = Math.min(1.2, dur * 0.35);
    const fim = quando + dur + 1.6;
    const vozes = [...acorde.map((s) => [semitom(base, s), 'sawtooth']),
      [semitom(base / 2, acorde[0] < 0 ? acorde[0] + 12 : acorde[0]), 'sine']];
    for (const [freq, tipo] of vozes) {
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = tipo === 'sine' ? 2000 : 700 + this.pureza * 900;
      lp.Q.value = 0.4;
      const g = c.createGain();
      const vol = tipo === 'sine' ? 0.32 : 0.14;
      g.gain.setValueAtTime(0, quando);
      g.gain.linearRampToValueAtTime(vol, quando + ataque);
      g.gain.setValueAtTime(vol, quando + dur);
      g.gain.exponentialRampToValueAtTime(0.0001, fim);
      lp.connect(g); g.connect(this.barramentos.pad);
      const desafinos = tipo === 'sine' ? [0] : [-7, 7];
      for (const d of desafinos) {
        const o = c.createOscillator();
        o.type = tipo;
        o.frequency.value = freq;
        o.detune.value = d;
        o.connect(lp);
        o.start(quando);
        o.stop(fim + 0.05);
      }
    }
  }

  /** Voz da melodia: seno com um pouco de triângulo e vibrato que entra
   *  devagar — lê como sopro, não como bip. */
  _flauta(freq, quando, dur) {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.setValueAtTime(0, quando);
    g.gain.linearRampToValueAtTime(0.42, quando + 0.08);
    g.gain.setTargetAtTime(0.3, quando + 0.08, dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, quando + dur + 0.4);
    g.connect(this.barramentos.melodia);
    const vib = c.createOscillator();
    vib.frequency.value = 5;
    const vibG = c.createGain();
    vibG.gain.setValueAtTime(0, quando);
    vibG.gain.linearRampToValueAtTime(freq * 0.006, quando + dur * 0.6);
    vib.connect(vibG);
    for (const [tipo, v] of [['sine', 1], ['triangle', 0.25]]) {
      const o = c.createOscillator();
      o.type = tipo;
      o.frequency.value = freq;
      vibG.connect(o.frequency);
      const m = c.createGain();
      m.gain.value = v;
      o.connect(m); m.connect(g);
      o.start(quando);
      o.stop(quando + dur + 0.5);
    }
    vib.start(quando);
    vib.stop(quando + dur + 0.5);
  }

  /** Bumbo macio: seno com a afinação despencando. */
  _bumbo(quando, vol) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, quando);
    o.frequency.exponentialRampToValueAtTime(42, quando + 0.18);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, quando);
    g.gain.exponentialRampToValueAtTime(0.0001, quando + 0.32);
    o.connect(g); g.connect(this.barramentos.pulso);
    o.start(quando);
    o.stop(quando + 0.35);
  }

  _nota({ freq, destino, tipo = 'sine', dur = 1, quando, vol = 0.5, ataque = 0.02 }) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = tipo;
    o.frequency.setValueAtTime(freq, quando);
    const g = c.createGain();
    g.gain.setValueAtTime(0, quando);
    g.gain.linearRampToValueAtTime(vol, quando + ataque);
    g.gain.exponentialRampToValueAtTime(0.0001, quando + dur);
    o.connect(g); g.connect(destino);
    o.start(quando);
    o.stop(quando + dur + 0.05);
  }

  _ruido({ destino, quando, dur = 0.08, freq = 2000, vol = 0.5 }) {
    const c = this.ctx;
    const n = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const dados = buf.getChannelData(0);
    for (let i = 0; i < n; i++) dados[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 1.1;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(destino);
    src.start(quando);
  }
}
