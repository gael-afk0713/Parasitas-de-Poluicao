/* =========================================================================
   fase2/audio/audio.js — som procedural via WebAudio
   -------------------------------------------------------------------------
   Sem arquivos de áudio: tudo é sintetizado. Motivo prático — o projeto é
   hospedado no GitHub Pages sem build step, e trilha em .ogg/.mp3 pesaria
   mais que o jogo inteiro. Motivo artístico — som gerado pode responder
   continuamente ao estado (o drone da área muda de afinação conforme a
   pureza sobe), coisa que faixa gravada não faz.

   O contexto só é criado no PRIMEIRO gesto do usuário: navegador nenhum
   deixa tocar áudio antes disso, e criar antes deixa o contexto 'suspended'
   de forma difícil de recuperar.
   ========================================================================= */

import { clamp, clamp01, lerp, damp } from '../core/mat.js';
import { Musica } from './musica.js';

/** Escala menor pentatônica — soa "natural"/melancólica em qualquer ordem,
 *  o que torna melodia aleatória aceitável sem compor nada. */
const PENTATONICA = [0, 3, 5, 7, 10];
const notaParaHz = (semitom, base = 110) => base * Math.pow(2, semitom / 12);

export class Audio {
  constructor() {
    this.ctx = null;
    this.pronto = false;
    this.volumeMestre = 0.55;
    this.volumeAmbiente = 0.42;

    this._drone = null;
    this._purezaAlvo = 0;
    this._pureza = 0;
    this._proximaNota = 0;

    // Um gesto qualquer libera o áudio.
    const iniciar = () => {
      this._garantirContexto();
      window.removeEventListener('pointerdown', iniciar);
      window.removeEventListener('keydown', iniciar);
    };
    window.addEventListener('pointerdown', iniciar);
    window.addEventListener('keydown', iniciar);
  }

  _garantirContexto() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    this.mestre = this.ctx.createGain();
    this.mestre.gain.value = this.volumeMestre;
    // Compressor no fim da cadeia: sem ele, vários efeitos simultâneos
    // (golpe + morte + aterrissagem) estouram e distorcem.
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.ratio.value = 4;
    this.mestre.connect(this.comp);
    this.comp.connect(this.ctx.destination);

    this.barrAmbiente = this.ctx.createGain();
    this.barrAmbiente.gain.value = this.volumeAmbiente;
    this.barrAmbiente.connect(this.mestre);

    this._montarDrone();

    // Barramento próprio pra música, separado dos efeitos: assim dá pra
    // abaixar a trilha sem abafar o retorno de acerto/dano, que é informação
    // de jogo e não pode sumir.
    this.barrMusica = this.ctx.createGain();
    this.barrMusica.gain.value = 0.5;
    this.barrMusica.connect(this.mestre);
    this.musica = new Musica(this.ctx, this.barrMusica);
    this.musica.iniciar();

    this.pronto = true;
  }

  /** Drone de fundo: duas ondas levemente desafinadas + filtro que abre
   *  conforme a área é restaurada. É a "cor" sonora do lugar. */
  _montarDrone() {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = 0.0;
    const filtro = c.createBiquadFilter();
    filtro.type = 'lowpass';
    filtro.frequency.value = 320;
    filtro.Q.value = 1.2;

    const oscs = [];
    for (const [tipo, det, vol] of [['sawtooth', -6, 0.16], ['sine', 5, 0.24], ['triangle', 0, 0.12]]) {
      const o = c.createOscillator();
      o.type = tipo;
      o.frequency.value = 55;
      o.detune.value = det;
      const og = c.createGain();
      og.gain.value = vol;
      o.connect(og); og.connect(filtro);
      o.start();
      oscs.push({ o, og });
    }
    filtro.connect(g);
    g.connect(this.barrAmbiente);
    g.gain.linearRampToValueAtTime(0.5, c.currentTime + 3);
    this._drone = { g, filtro, oscs };
  }

  trocarAmbiente(sala, mundo) {
    this._purezaAlvo = mundo.purezaDaSala(sala.id);
  }

  atualizar(dt, mundo) {
    if (!this.pronto || !this.ctx) return;
    this._alimentarMusica(dt, mundo);
    this._purezaAlvo = mundo.tema?.pureza ?? this._purezaAlvo;
    this._pureza += (this._purezaAlvo - this._pureza) * Math.min(1, dt * 0.6);

    const d = this._drone;
    if (d) {
      // Suja = filtro fechado e grave (abafado, opressivo).
      // Limpa = filtro aberto e afinação uma quinta acima (aberto, respirável).
      const alvoFreq = lerp(280, 1900, this._pureza);
      d.filtro.frequency.setTargetAtTime(alvoFreq, this.ctx.currentTime, 0.6);
      const base = lerp(55, 82.4, this._pureza);
      for (const { o } of d.oscs) o.frequency.setTargetAtTime(base, this.ctx.currentTime, 1.2);
    }

    // Notinhas esparsas só em área restaurada — a recompensa sonora.
    this._proximaNota -= dt;
    if (this._proximaNota <= 0) {
      this._proximaNota = lerp(9, 2.6, this._pureza) * (0.6 + Math.random());
      if (this._pureza > 0.3 && Math.random() < this._pureza) this._sino();
    }
  }

  /**
   * Traduz o estado do jogo em estado musical.
   *
   * `intensidade` não é um interruptor de "combate ligado": é uma média
   * suavizada da ameaça na tela. Interruptor faz a trilha piscar toda vez que
   * um inimigo entra ou sai do alcance; média suave faz ela respirar junto com
   * a situação, que é o que se quer.
   */
  _alimentarMusica(dt, mundo) {
    if (!this.musica || !mundo.sala) return;
    const j = mundo.jogador;

    let ameaca = 0, chefe = false;
    for (const e of mundo.entidades) {
      if (e.morta || e.perigoso === false) continue;
      if (e.ehChefe) { chefe = true; ameaca = 1; continue; }
      const ex = e.centroX ?? e.x, ey = e.centroY ?? e.y;
      const d = Math.hypot(j.centroX - ex, j.centroY - ey);
      if (d < 420) ameaca += 1 - d / 420;
    }
    // Vida baixa também conta como tensão, mesmo sem inimigo perto.
    ameaca += (1 - j.vida / Math.max(1, j.vidaMax)) * 0.5;

    this._intensidade = damp(this._intensidade ?? 0, clamp01(ameaca / 2.2), 0.7, dt);
    this.musica.definirEstado({
      area: mundo.sala.area,
      pureza: mundo.tema?.pureza ?? 0,
      intensidade: this._intensidade,
      chefe,
    });
  }

  definirVolumeMusica(v) {
    if (this.barrMusica) {
      this.barrMusica.gain.setTargetAtTime(clamp01(v), this.ctx.currentTime, 0.2);
    }
  }

  _sino() {
    const c = this.ctx;
    const semitom = PENTATONICA[Math.floor(Math.random() * PENTATONICA.length)]
      + 12 * Math.floor(Math.random() * 2 + 2);
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = notaParaHz(semitom);
    const g = c.createGain();
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(0.1 * this._pureza, c.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 2.6);
    o.connect(g); g.connect(this.barrAmbiente);
    o.start();
    o.stop(c.currentTime + 2.7);
  }

  /* ------------------------------------------------------------ efeitos -- */

  /** Envelope percussivo genérico. `tipo` muda o timbre, não a estrutura. */
  _toque({ freq = 440, freqFim = null, tipo = 'sine', dur = 0.15, vol = 0.3, ataque = 0.004, ruido = false }) {
    if (!this.pronto) return;
    const c = this.ctx;
    const t0 = c.currentTime;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + ataque);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    g.connect(this.mestre);

    if (ruido) {
      const n = c.createBufferSource();
      const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
      const dados = buf.getChannelData(0);
      for (let i = 0; i < dados.length; i++) dados[i] = Math.random() * 2 - 1;
      n.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.setValueAtTime(freq, t0);
      if (freqFim) f.frequency.exponentialRampToValueAtTime(Math.max(30, freqFim), t0 + dur);
      f.Q.value = 1.4;
      n.connect(f); f.connect(g);
      n.start(); n.stop(t0 + dur);
    } else {
      const o = c.createOscillator();
      o.type = tipo;
      o.frequency.setValueAtTime(freq, t0);
      if (freqFim) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqFim), t0 + dur);
      o.connect(g);
      o.start(); o.stop(t0 + dur);
    }
  }

  aoEvento(ev, mundo) {
    if (!this.pronto) this._garantirContexto();
    if (!this.pronto) return;
    switch (ev.tipo) {
      case 'pulo':
        this._toque({ freq: 300, freqFim: 620, tipo: 'triangle', dur: 0.13, vol: 0.16 });
        break;
      case 'aterrissar':
        this._toque({ freq: 900, freqFim: 160, dur: 0.09 + ev.impacto * 0.1,
          vol: 0.06 + ev.impacto * 0.18, ruido: true });
        break;
      case 'investida':
        this._toque({ freq: 1600, freqFim: 300, dur: 0.2, vol: 0.16, ruido: true });
        break;
      case 'ataque':
        this._toque({ freq: 1800, freqFim: 700, dur: 0.1, vol: 0.12, ruido: true });
        break;
      case 'acerto':
        this._toque({ freq: 160, freqFim: 60, tipo: 'square', dur: 0.11, vol: 0.24 });
        this._toque({ freq: 2600, freqFim: 900, dur: 0.07, vol: 0.16, ruido: true });
        break;
      case 'dano':
        this._toque({ freq: 220, freqFim: 70, tipo: 'sawtooth', dur: 0.34, vol: 0.3 });
        break;
      case 'morte':
        this._toque({ freq: 300, freqFim: 40, tipo: 'sawtooth', dur: 1.1, vol: 0.32 });
        break;
      case 'inimigoMorto':
        this._toque({ freq: 520, freqFim: 180, tipo: 'triangle', dur: 0.2, vol: 0.14 });
        break;
      case 'canto':
        // Acorde ascendente — o verbo de restauração precisa soar generoso.
        [0, 7, 12, 16].forEach((s, i) => setTimeout(() =>
          this._toque({ freq: notaParaHz(s, 220), tipo: 'sine', dur: 1.4, vol: 0.13 }), i * 90));
        break;
      case 'semente':
        [0, 5, 7, 12, 19].forEach((s, i) => setTimeout(() =>
          this._toque({ freq: notaParaHz(s, 330), tipo: 'sine', dur: 2.4, vol: 0.14 }), i * 150));
        break;
      case 'habilidade':
        [0, 4, 7, 11, 14].forEach((s, i) => setTimeout(() =>
          this._toque({ freq: notaParaHz(s, 262), tipo: 'triangle', dur: 1.8, vol: 0.14 }), i * 120));
        break;
      case 'checkpoint':
        this._toque({ freq: notaParaHz(0, 440), tipo: 'sine', dur: 1.6, vol: 0.14 });
        this._toque({ freq: notaParaHz(7, 440), tipo: 'sine', dur: 1.6, vol: 0.1 });
        break;
    }
  }

  definirVolume(v) {
    this.volumeMestre = clamp01(v);
    if (this.mestre) this.mestre.gain.setTargetAtTime(this.volumeMestre, this.ctx.currentTime, 0.1);
  }
}
