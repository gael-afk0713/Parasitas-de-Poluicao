/* =========================================================================
   fase2/audio/musica.js — trilha adaptativa, sintetizada
   -------------------------------------------------------------------------
   Sem nenhum arquivo de áudio. Dois motivos, um prático e um artístico:

   · PRÁTICO — o projeto é hospedado no GitHub Pages sem build step. Uma
     trilha gravada decente pesaria mais que o jogo inteiro.
   · ARTÍSTICO — som gerado responde CONTINUAMENTE ao estado. Aqui a pureza da
     área abre o filtro e sobe a afinação, o combate acende uma camada
     rítmica, o chefe troca o modo. Faixa gravada só consegue cortar de uma
     para outra, e o corte sempre denuncia que existe um sistema por trás.

   AGENDAMENTO. WebAudio não tem "toque esta nota agora" confiável: `setTimeout`
   tem jitter de dezenas de milissegundos e isso destrói qualquer ritmo. O
   padrão correto, usado aqui, é lookahead — um timer grosseiro (25 ms) que
   olha uma janela à frente (120 ms) e AGENDA no relógio de amostra do
   contexto (`currentTime + offset`), que é preciso. O timer pode atrasar à
   vontade; as notas já estão marcadas.

   TEORIA, o mínimo necessário. Tudo vive numa escala pentatônica menor
   (0,3,5,7,10). Ela não tem trítono nem semitom, então QUALQUER combinação de
   notas dela soa consonante — o que torna melodia gerada por sorteio aceitável
   sem compor nota a nota. É a mesma razão de tantos jogos usarem pentatônica
   para música procedural.
   ========================================================================= */

const PENTA_MENOR = [0, 3, 5, 7, 10];
const PENTA_MAIOR = [0, 2, 4, 7, 9];

/** Tônica e modo de cada área. A tônica sobe conforme o jogo avança —
 *  a jornada inteira é uma modulação lenta para cima. */
const COR_DA_AREA = {
  raizes:   { tonica: 55.00, modo: PENTA_MENOR, timbrePad: 'sawtooth', brilho: 0.30 },
  varzea:   { tonica: 61.74, modo: PENTA_MENOR, timbrePad: 'triangle', brilho: 0.40 },
  clareira: { tonica: 58.27, modo: PENTA_MENOR, timbrePad: 'square',   brilho: 0.25 },
  dossel:   { tonica: 65.41, modo: PENTA_MAIOR, timbrePad: 'triangle', brilho: 0.60 },
  coracao:  { tonica: 73.42, modo: PENTA_MENOR, timbrePad: 'sawtooth', brilho: 0.45 },
};

const LOOKAHEAD_MS = 25;
const JANELA_S = 0.12;
const PASSOS_POR_COMPASSO = 8;

export class Musica {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} destino  normalmente o barramento de música
   */
  constructor(ctx, destino) {
    this.ctx = ctx;
    this.saida = ctx.createGain();
    this.saida.gain.value = 0;
    this.saida.connect(destino);

    // --- barramentos por camada ---
    this.barramentos = {};
    for (const nome of ['pad', 'melodia', 'baixo', 'pulso']) {
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
    this.filtro.Q.value = 0.9;
    this.saida.disconnect();
    this.saida.connect(this.filtro);
    this.filtro.connect(destino);

    // Reverb barato: um impulso de ruído decrescente. Sem reverb, som
    // sintetizado fica colado no rosto do ouvinte e não sugere lugar nenhum.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulso(2.6, 2.2);
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
    this.bpm = 68;

    this.passo = 0;
    this._proximoPasso = 0;
    this._timer = null;
    this._pad = null;
    this._ligada = false;
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
    this._montarPad();
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
    if (area && area !== this.area) this._trocarArea(area);
    if (pureza != null) this.pureza = pureza;
    if (intensidade != null) this.intensidade = intensidade;
    if (chefe != null) this.chefe = chefe;

    const cor = COR_DA_AREA[this.area] ?? COR_DA_AREA.raizes;

    // Filtro: a restauração literalmente ABRE o som.
    const alvoFiltro = 320 + this.pureza * 3400 + this.intensidade * 900
      + (this.chefe ? 700 : 0);
    this.filtro.frequency.setTargetAtTime(alvoFiltro, t, 0.9);

    // Mixagem por camada. O pad está sempre presente; melodia só aparece
    // quando há vida na área (é a recompensa sonora da restauração); pulso e
    // baixo entram com o combate.
    const g = this.barramentos;
    g.pad.gain.setTargetAtTime(0.20 + this.pureza * 0.06, t, 1.2);
    g.melodia.gain.setTargetAtTime(0.02 + this.pureza * 0.13, t, 1.6);
    g.baixo.gain.setTargetAtTime(0.05 + this.intensidade * 0.13 + (this.chefe ? 0.1 : 0), t, 0.8);
    g.pulso.gain.setTargetAtTime(this.intensidade * 0.09 + (this.chefe ? 0.08 : 0), t, 0.6);

    // O andamento acelera com a tensão, mas pouco: música de exploração que
    // acelera demais vira trilha de ação e come a atmosfera.
    this.bpm = 62 + this.intensidade * 16 + (this.chefe ? 14 : 0);

    // O pad acompanha a tônica da área e a afinação sobe de leve com a pureza
    // (uma quinta acima quando totalmente restaurada, sem trocar de acorde).
    if (this._pad) {
      const base = cor.tonica * (1 + this.pureza * 0.03);
      for (let i = 0; i < this._pad.oscs.length; i++) {
        const o = this._pad.oscs[i];
        o.frequency.setTargetAtTime(base * this._pad.razoes[i], t, 1.8);
      }
    }
    this.envioReverb.gain.setTargetAtTime(0.2 + this.pureza * 0.3, t, 1.5);
  }

  _trocarArea(area) {
    this.area = area;
    // Sem corte: o pad já está tocando e só desliza para a nova tônica em
    // `definirEstado`. Trocar de área nunca deve produzir um silêncio.
  }

  _montarPad() {
    const c = this.ctx;
    const cor = COR_DA_AREA[this.area] ?? COR_DA_AREA.raizes;
    // Tônica, quinta e oitava — tríade aberta, sem terça. Sem terça o acorde
    // não é nem maior nem menor, então ele serve de base para as duas
    // afinações de área sem precisar trocar de pad.
    const razoes = [1, 1.5, 2, 3.005];
    const oscs = [];
    for (let i = 0; i < razoes.length; i++) {
      const o = c.createOscillator();
      o.type = i === 3 ? 'sine' : cor.timbrePad;
      o.frequency.value = cor.tonica * razoes[i];
      // Desafinação minúscula e diferente por voz: é o que dá o batimento
      // lento que faz um pad soar "vivo" em vez de estático.
      o.detune.value = (i - 1.5) * 5;
      const g = c.createGain();
      g.gain.value = [0.30, 0.20, 0.13, 0.05][i];
      o.connect(g); g.connect(this.barramentos.pad);
      o.start();
      oscs.push(o);
    }
    this._pad = { oscs, razoes };
  }

  /* ---------------------------------------------------------------------
     Agendamento
     --------------------------------------------------------------------- */

  _agendar() {
    if (!this._ligada) return;
    const c = this.ctx;
    const duracaoPasso = 60 / this.bpm / (PASSOS_POR_COMPASSO / 4);

    while (this._proximoPasso < c.currentTime + JANELA_S) {
      this._tocarPasso(this.passo, this._proximoPasso);
      this._proximoPasso += duracaoPasso;
      this.passo = (this.passo + 1) % (PASSOS_POR_COMPASSO * 4);
    }
  }

  _tocarPasso(passo, quando) {
    const cor = COR_DA_AREA[this.area] ?? COR_DA_AREA.raizes;
    const noCompasso = passo % PASSOS_POR_COMPASSO;

    // --- baixo: tônica no 1, quinta no 5 ---
    if (noCompasso === 0 || noCompasso === 4) {
      const grau = noCompasso === 0 ? 0 : 7;
      this._nota({
        freq: cor.tonica * Math.pow(2, grau / 12),
        destino: this.barramentos.baixo,
        tipo: 'triangle', dur: 0.9, quando, vol: 0.5,
      });
    }

    // --- pulso: contratempo, só quando há tensão ---
    if (this.intensidade > 0.05 && noCompasso % 2 === 1) {
      this._ruido({ destino: this.barramentos.pulso, quando, dur: 0.06, freq: 2600, vol: 0.5 });
    }
    if (this.chefe && noCompasso === 6) {
      this._ruido({ destino: this.barramentos.pulso, quando, dur: 0.18, freq: 180, vol: 0.7 });
    }

    // --- melodia: esparsa e sorteada dentro da escala ---
    // A probabilidade cresce com a pureza. Área morta fica quase muda; área
    // restaurada canta. É a recompensa sonora ficando audível aos poucos.
    const chance = 0.06 + this.pureza * 0.34;
    if (Math.random() < chance) {
      const modo = cor.modo;
      const grau = modo[Math.floor(Math.random() * modo.length)];
      const oitava = 2 + Math.floor(Math.random() * 2);
      this._nota({
        freq: cor.tonica * Math.pow(2, grau / 12 + oitava),
        destino: this.barramentos.melodia,
        tipo: 'sine', dur: 1.4 + Math.random(), quando, vol: 0.42,
      });
    }
  }

  _nota({ freq, destino, tipo = 'sine', dur = 1, quando, vol = 0.5 }) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = tipo;
    o.frequency.setValueAtTime(freq, quando);
    const g = c.createGain();
    g.gain.setValueAtTime(0, quando);
    g.gain.linearRampToValueAtTime(vol, quando + 0.02);
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
