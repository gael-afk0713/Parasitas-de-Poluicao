/* =========================================================================
   fase2/entidades/chefes.js — os três chefes
   -------------------------------------------------------------------------
   O que define um chefe bom aqui, e que vale para os três:

   1. TELEGRAFA TUDO. Nenhum ataque sai sem pelo menos 0,45 s de aviso
      visível — o corpo muda de forma, as fendas acendem, a criatura para.
      Num jogo escuro a tentação de esconder o golpe é grande; morte por algo
      invisível não é dificuldade, é ruído.
   2. A FASE 2 RECONTEXTUALIZA A FASE 1, não aumenta números. O padrão antigo
      volta com uma variação que invalida a resposta antiga — o jogador
      precisa reaprender, não repetir mais rápido.
   3. EXISTE JANELA DE CONTRA-ATAQUE ÓBVIA. Depois de cada padrão o chefe
      fica exposto por um tempo generoso. Sem essa janela o combate vira
      espera, e o jogador não sente que ganhou nada por ler o padrão.
   4. NÃO ENCOSTA E MATA. O corpo do chefe causa dano, mas ele nunca fica
      parado em cima do jogador — todo padrão termina com ele se afastando.

   Cada chefe expõe `vida`/`vidaMax` e `nomeChefe`, que a UI usa pra barra.
   ========================================================================= */

import {
  TAU, clamp, clamp01, lerp, damp, sign, rgba, misturarHex,
  easeOutCubic, easeOutQuad, easeInQuad, hash2, dist, sobrepoe,
} from '../core/mat.js';
import { luzRadial } from '../render/renderizador.js';
import { Sombra, Espreita } from './parasitas.js';
import { atirarReto, atirarArco, atirarSpray, atirarAnel, Explosao, OndaChoque, PocaAcida } from './projeteis.js';

const GRAVIDADE = 1500;

/* -------------------------------------------------------------------------
   Assinaturas de `projeteis.js` que já pegaram este arquivo de surpresa —
   anotadas aqui porque não são uniformes entre si:

     new PocaAcida(x, y, { largura, duracao, dano })   ← POSICIONAL, e o
         tamanho é `largura`, não `raio`. Chamar com um objeto só fazia `y`
         virar undefined e o passe de luz explodir com "non-finite value".
     new OndaChoque({ x, y, dir, vel, alcance, altura, dano })
         ← viaja numa direção SÓ; para um baque no chão são DUAS ondas.
     new Explosao({ x, y, raio, dano, duracao })       ← objeto, expande em
         círculo a partir do centro.
   ------------------------------------------------------------------------- */

/** Baque no chão: duas ondas, uma para cada lado. */
function ondaDupla(mundo, x, y, alcance, dano = 1) {
  for (const dir of [-1, 1]) {
    mundo.entidades.push(new OndaChoque({ x, y, dir, alcance, dano, vel: 260 }));
  }
}

/* =========================================================================
   BASE
   ========================================================================= */

class Chefe {
  constructor(obj, cfg) {
    this.largura = cfg.largura;
    this.altura = cfg.altura;
    this.x = obj.x - this.largura / 2;
    this.y = obj.y - this.altura;
    this.origemX = this.x; this.origemY = this.y;

    this.vx = 0; this.vy = 0;
    this.dir = -1;
    this.vidaMax = cfg.vida;
    this.vida = cfg.vida;
    this.dano = cfg.dano ?? 1;
    this.nomeChefe = cfg.nome;
    this.ehChefe = true;

    this.morta = false;
    this.perigoso = true;
    this.t = 0;
    this.piscarDano = 0;
    this.telegrafo = 0;
    this.morrendo = 0;

    this.fase = 1;
    this.limiaresFase = cfg.limiaresFase ?? [0.6, 0.3];   // frações de vida
    this.estado = 'entrada';
    this.tempoEstado = 0;
    this.padraoAtual = null;
    this.filaPadroes = [];

    /** Invulnerável durante transições — evita matar o chefe no meio da
     *  animação de mudança de fase, que ficaria anticlimático e confuso. */
    this.invulneravel = 0;
  }

  get centroX() { return this.x + this.largura / 2; }
  get centroY() { return this.y + this.altura / 2; }
  get fracaoVida() { return this.vida / this.vidaMax; }

  caixa() {
    const m = this.largura * 0.14;
    return { x: this.x + m, y: this.y + m, largura: this.largura - m * 2, altura: this.altura - m * 2 };
  }

  _trocarEstado(novo) {
    this.estado = novo;
    this.tempoEstado = 0;
  }

  atualizar(dt, mundo) {
    this.t += dt;
    this.tempoEstado += dt;
    this.piscarDano = Math.max(0, this.piscarDano - dt);
    this.invulneravel = Math.max(0, this.invulneravel - dt);

    if (this.morrendo > 0) {
      this.morrendo += dt * 0.55;
      // Explosões em cadeia enquanto desmonta.
      if (Math.random() < dt * 9) {
        mundo.emitir(
          this.x + Math.random() * this.largura,
          this.y + Math.random() * this.altura,
          14, { velMin: 60, velMax: 260, g: 160, cor: mundo.tema.acento, brilha: true }
        );
        mundo.camera.sacudir(0.12);
      }
      if (this.morrendo >= 1) { this.morta = true; this.aoMorrer?.(mundo); }
      return;
    }

    // Fase por limiar de vida. Checado ANTES do padrão pra que a transição
    // interrompa o que estiver em andamento.
    const faseAlvo = 1 + this.limiaresFase.filter((l) => this.fracaoVida <= l).length;
    if (faseAlvo > this.fase) { this._entrarEmFase(faseAlvo, mundo); return; }

    this.comportamento(dt, mundo);
  }

  _entrarEmFase(n, mundo) {
    this.fase = n;
    this.invulneravel = 1.4;
    this._trocarEstado('transicao');
    this.filaPadroes = [];
    mundo.camera.sacudir(0.7);
    mundo.render?.piscar?.(mundo.tema.acento, 0.45);
    mundo.laco.congelar(0.12);
    mundo.emitir(this.centroX, this.centroY, 60, {
      velMin: 80, velMax: 420, g: 60, vidaMin: 0.6, vidaMax: 1.8,
      cor: mundo.tema.acento, brilha: true, arrasto: 0.4,
    });
    mundo.aoEvento?.({ tipo: 'chefeFase', fase: n, nome: this.nomeChefe });
    this.aoEntrarEmFase?.(n, mundo);
  }

  /** Sorteia o próximo padrão sem repetir o anterior duas vezes seguidas. */
  _proximoPadrao(lista) {
    if (!this.filaPadroes.length) {
      // Embaralha a lista inteira e consome — garante variedade sem sorteio
      // puro, que às vezes repete o mesmo padrão quatro vezes e parece bug.
      const copia = [...lista];
      for (let i = copia.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copia[i], copia[j]] = [copia[j], copia[i]];
      }
      this.filaPadroes = copia;
    }
    return this.filaPadroes.pop();
  }

  receberDano(n, deX, deY, mundo) {
    if (this.morrendo > 0 || this.invulneravel > 0) return;
    this.vida -= n;
    this.piscarDano = 0.12;
    mundo.emitir(deX, deY, 8, {
      velMin: 80, velMax: 240, g: 220, cor: mundo.tema.crista, brilha: true,
    });
    if (this.vida <= 0) this._morrer(mundo);
  }

  _morrer(mundo) {
    this.vida = 0;
    this.morrendo = 0.001;
    this.perigoso = false;
    mundo.laco.congelar(0.22);
    mundo.camera.sacudir(1);
    mundo.render?.piscar?.('#ffffff', 0.7);
    mundo.aoEvento?.({ tipo: 'chefeMorto', nome: this.nomeChefe });
  }

  /** Utilidade: aproxima o corpo de um ponto com aceleração suave. */
  _irPara(dt, mundo, alvoX, alvoY, vel, meiaVida = 0.3) {
    const dx = alvoX - this.centroX;
    const dy = alvoY - this.centroY;
    const d = Math.hypot(dx, dy) || 1;
    this.vx = damp(this.vx, (dx / d) * vel, meiaVida, dt);
    this.vy = damp(this.vy, (dy / d) * vel, meiaVida, dt);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  /** Barra de vida — desenhada pela UI, mas o dado sai daqui. */
  infoBarra() {
    return { nome: this.nomeChefe, fracao: this.fracaoVida, fase: this.fase };
  }
}

/* =========================================================================
   1 · A MÃE AFOGADA — Várzea
   -------------------------------------------------------------------------
   Uma massa que vive submersa e emerge para atacar. O chão da arena é água,
   então o jogador nunca está totalmente estável.

   Fase 1: emerge e cospe em arco. Padrão simples, ensina a leitura.
   Fase 2: some na água e ressurge SOB o jogador — a resposta "fique longe"
           deixa de funcionar, tem que ficar em movimento.
   Fase 3: as duas coisas, mais filhotes (Espreita) que forçam o jogador a
           dividir atenção entre o chão e o ar.
   ========================================================================= */

class MaeAfogada extends Chefe {
  constructor(obj) {
    super(obj, {
      nome: 'A Mãe Afogada', vida: 34, largura: 96, altura: 88, dano: 1,
      limiaresFase: [0.62, 0.3],
    });
    this.baseY = this.y;
    this.submersao = 0;     // 0 = fora d'água, 1 = totalmente submersa
    this.tentaculosLongos = Array.from({ length: 9 }, (_, i) => ({
      ang: lerp(-Math.PI * 1.05, 0.05, i / 8),
      comp: 40 + hash2(i, 3, 5) * 45,
      fase: hash2(i, 7, 11) * TAU,
    }));
  }

  comportamento(dt, mundo) {
    const j = mundo.jogador;
    switch (this.estado) {
      case 'entrada':
        this.submersao = damp(this.submersao, 0, 0.4, dt);
        if (this.tempoEstado > 1.2) this._trocarEstado('espera');
        break;

      case 'transicao':
        this.submersao = damp(this.submersao, 0.5, 0.3, dt);
        if (this.tempoEstado > 1.4) this._trocarEstado('espera');
        break;

      case 'espera':
        this.submersao = damp(this.submersao, 0, 0.5, dt);
        this.dir = j.centroX < this.centroX ? -1 : 1;
        this.y = damp(this.y, this.baseY + Math.sin(this.t * 1.2) * 8, 0.4, dt);
        // Janela de contra-ataque: 1,1 s parada e exposta entre padrões.
        if (this.tempoEstado > 1.1) {
          const padroes = this.fase === 1 ? ['cuspir']
            : this.fase === 2 ? ['cuspir', 'mergulho']
            : ['cuspir', 'mergulho', 'ninhada'];
          this._trocarEstado(this._proximoPadrao(padroes));
        }
        break;

      /* --- cuspir: leque em arco, telegrafado pelo corpo inchando --------- */
      case 'cuspir': {
        const AVISO = 0.55;
        this.telegrafo = clamp01(this.tempoEstado / AVISO);
        if (this.tempoEstado >= AVISO && !this._cuspiu) {
          this._cuspiu = true;
          const n = this.fase >= 3 ? 5 : 3;
          for (let i = 0; i < n; i++) {
            const alvo = j.centroX + (i - (n - 1) / 2) * 90 + j.vx * 0.3;
            atirarArco(mundo, this.centroX, this.centroY - 20, alvo, j.centroY, {
              raio: 7, cor: 'acento',
              // Deixa poça ao cair: o chão da arena vai ficando menor, e é
              // isso que impede o jogador de resolver a luta parado num canto.
              aoBater: (m, p) => m.entidades.push(new PocaAcida(p.x, p.y, { largura: 64, duracao: 5 })),
            });
          }
          mundo.camera.sacudir(0.3);
        }
        if (this.tempoEstado > AVISO + 0.7) { this._cuspiu = false; this.telegrafo = 0; this._trocarEstado('espera'); }
        break;
      }

      /* --- mergulho: some e ressurge sob o jogador ------------------------ */
      case 'mergulho': {
        const T_SOME = 0.5, T_VIAJA = 0.9, T_SOBE = 0.45;
        if (this.tempoEstado < T_SOME) {
          this.submersao = clamp01(this.tempoEstado / T_SOME);
          this.perigoso = this.submersao < 0.7;
        } else if (this.tempoEstado < T_SOME + T_VIAJA) {
          this.submersao = 1;
          this.perigoso = false;
          // Viaja submersa. O rastro na água é o telegrafo: dá pra ver onde
          // ela vai emergir antes de emergir.
          this.x = damp(this.x, j.centroX - this.largura / 2, 0.32, dt);
          if (Math.random() < dt * 22) {
            mundo.emitir(this.centroX + (Math.random() - 0.5) * this.largura,
              this.baseY + this.altura * 0.7, 2,
              { velMin: 10, velMax: 60, g: -40, vidaMin: 0.4, vidaMax: 0.9, cor: mundo.tema.crista });
          }
        } else if (this.tempoEstado < T_SOME + T_VIAJA + T_SOBE) {
          const k = (this.tempoEstado - T_SOME - T_VIAJA) / T_SOBE;
          this.submersao = 1 - easeOutCubic(k);
          this.perigoso = true;
          if (k > 0.3 && !this._emergiu) {
            this._emergiu = true;
            ondaDupla(mundo, this.centroX, this.baseY + this.altura, 340, 1);
            mundo.camera.sacudir(0.6);
            mundo.laco.congelar(0.05);
          }
        } else {
          this._emergiu = false;
          this._trocarEstado('espera');
        }
        break;
      }

      /* --- ninhada: solta filhotes -------------------------------------- */
      case 'ninhada': {
        const AVISO = 0.7;
        this.telegrafo = clamp01(this.tempoEstado / AVISO);
        if (this.tempoEstado >= AVISO && !this._pariu) {
          this._pariu = true;
          for (let i = 0; i < 3; i++) {
            const cria = new Espreita({
              x: this.centroX + (i - 1) * 40, y: this.centroY - 20,
              cx: this.origemX / 32 + i, cy: this.origemY / 32,
            });
            cria.perseguindo = true;
            mundo.entidades.push(cria);
          }
          mundo.camera.sacudir(0.25);
        }
        if (this.tempoEstado > AVISO + 0.8) { this._pariu = false; this.telegrafo = 0; this._trocarEstado('espera'); }
        break;
      }
    }

    // A submersão mexe na posição de desenho E na hitbox — submersa, ela não
    // machuca quem passa por cima.
    this.y = this.baseY + this.submersao * this.altura * 0.95;
  }

  desenhar(ctx, tema, camera) {
    const morre = clamp01(this.morrendo);
    const ferida = this.piscarDano > 0;
    const cx = this.centroX, cy = this.centroY;
    const r = this.largura * 0.45 * (1 + this.telegrafo * 0.14);
    const cor = ferida ? '#ffffff' : misturarHex(tema.primeiroPlano, tema.ceuTopo, 0.35);

    ctx.save();
    if (morre > 0) { ctx.globalAlpha = 1 - morre; }

    /* Ela mora dentro d'água escura, é quase preta e o passe da água ainda
       passa POR CIMA dela. Sem contorno e sem auréola, o que se via era um
       arbusto escuro entre os juncos: um chefe que mata sem nunca ter sido
       visto. As duas coisas juntas resolvem os dois fundos — a auréola
       escurece o que está atrás (aparece contra a água clara), o contorno
       claro aparece contra o fundo escuro. */
    const halo = rgba(misturarHex(tema.bruma, tema.acento, 0.25), 0.55);
    const rAur = this.largura * 1.15;
    const gAur = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, rAur);
    gAur.addColorStop(0, rgba(tema.primeiroPlano, 0.6));
    gAur.addColorStop(0.55, rgba(tema.primeiroPlano, 0.3));
    gAur.addColorStop(1, rgba(tema.primeiroPlano, 0));
    ctx.fillStyle = gAur;
    ctx.fillRect(cx - rAur, cy - rAur, rAur * 2, rAur * 2);

    // Tentáculos longos varrendo — a assinatura dela. Duas passadas: um
    // traço mais largo na cor do halo e o traço escuro por cima.
    ctx.lineCap = 'round';
    for (const t of this.tentaculosLongos) {
      const a = t.ang + Math.sin(this.t * 0.9 + t.fase) * 0.3;
      const comp = t.comp * (1 + this.telegrafo * 0.3);
      const px = cx + Math.cos(a) * comp;
      const py = cy + Math.sin(a) * comp * 0.8;
      for (const passada of (ferida ? ['massa'] : ['halo', 'massa'])) {
        const extra = passada === 'halo' ? 3.4 : 0;
        ctx.strokeStyle = passada === 'halo' ? halo : cor;
        let ax = cx, ay = cy;
        for (let k = 1; k <= 5; k++) {
          const u = k / 5;
          const bx = lerp(cx, px, u) + Math.sin(u * 3 + this.t * 1.4 + t.fase) * 12 * u;
          const by = lerp(cy, py, u);
          ctx.lineWidth = lerp(13, 1.5, u) + extra;
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
          ax = bx; ay = by;
        }
      }
    }

    // Massa — traçada uma vez e usada como contorno e como preenchimento.
    const traçar = () => {
      ctx.beginPath();
      for (let i = 0; i <= 26; i++) {
        const a = (i / 26) * TAU;
        const rr = r * (1 + 0.1 * Math.sin(a * 3 + this.t * 1.6) + 0.06 * Math.sin(a * 6 - this.t));
        const px = cx + Math.cos(a) * rr;
        const py = cy + Math.sin(a) * rr * 0.86;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
    };
    if (!ferida) {
      ctx.strokeStyle = halo;
      ctx.lineWidth = 3.2;
      ctx.lineJoin = 'round';
      traçar();
      ctx.stroke();
    }
    ctx.fillStyle = cor;
    traçar();
    ctx.fill();

    // Fendas: muitas, em arco largo. Numa criatura grande, poucos olhos
    // grandes ficam cômicos; muitos pequenos ficam ameaçadores.
    if (!ferida) {
      ctx.fillStyle = '#ffffff';
      const n = 7;
      for (let i = 0; i < n; i++) {
        const f = i / (n - 1);
        const dx = lerp(-r * 0.5, r * 0.5, f);
        const dy = -r * 0.34 + Math.abs(f - 0.5) * r * 0.3;
        // As fendas são o rosto dela e o único elemento claro de verdade —
        // com alfa base 0.5 elas sumiam e o chefe ficava sem cara.
        ctx.globalAlpha = (0.78 + 0.22 * Math.sin(this.t * 2.4 + i)) * (0.8 + this.telegrafo * 0.2);
        ctx.beginPath();
        ctx.ellipse(cx + dx * this.dir, cy + dy, 2.3,
          lerp(9, 4, Math.abs(f - 0.5) * 2) * (1 + this.telegrafo * 0.6), 0, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  desenharLuz(ctx, tema) {
    const i = this.piscarDano > 0 ? 1 : 0.35 + this.telegrafo * 0.65;
    luzRadial(ctx, this.centroX, this.centroY, this.largura * 0.9,
      this.piscarDano > 0 ? '#ffffff' : tema.acento, i * (1 - this.submersao * 0.7));
  }
}

/* =========================================================================
   2 · A MÁQUINA — Clareira Queimada
   -------------------------------------------------------------------------
   Uma das construções da Fase 1, ainda funcionando, agora meio viva. É o
   único chefe que o jogador RECONHECE — ele mesmo construiu essa coisa.

   Fase 1: investidas horizontais telegrafadas por um apito de vapor.
   Fase 2: as investidas continuam, mas agora ela sobe e cai (o chão deixa de
           ser rota de fuga) e solta jatos de vapor onde caiu.
   Fase 3: investida encadeada com quique nas paredes — o padrão da fase 1
           volta, mas a resposta antiga (esperar passar) não serve mais.
   ========================================================================= */

class Maquina extends Chefe {
  constructor(obj) {
    super(obj, {
      nome: 'A Máquina', vida: 40, largura: 104, altura: 84, dano: 1,
      limiaresFase: [0.65, 0.32],
    });
    this.chaoY = this.y + this.altura;
    this.giroRoda = 0;
    this.pressao = 0;      // 0..1 — vapor acumulado, visível nas válvulas
    this.quiques = 0;
  }

  comportamento(dt, mundo) {
    const j = mundo.jogador;
    const terreno = mundo.sala.terreno;
    this.giroRoda += (Math.abs(this.vx) / 40 + 0.6) * dt;

    switch (this.estado) {
      case 'entrada':
        if (this.tempoEstado > 1) this._trocarEstado('espera');
        break;
      case 'transicao':
        this.vx = damp(this.vx, 0, 0.2, dt);
        this.pressao = clamp01(this.tempoEstado / 1.4);
        if (this.tempoEstado > 1.4) { this.pressao = 0; this._trocarEstado('espera'); }
        break;

      case 'espera':
        this.vx = damp(this.vx, 0, 0.18, dt);
        this.dir = j.centroX < this.centroX ? -1 : 1;
        this._gravidade(dt, terreno);
        if (this.tempoEstado > 0.95) {
          const padroes = this.fase === 1 ? ['investida', 'vapor']
            : this.fase === 2 ? ['investida', 'salto', 'vapor']
            : ['investidaTripla', 'salto', 'vapor'];
          this._trocarEstado(this._proximoPadrao(padroes));
        }
        break;

      /* --- investida ----------------------------------------------------- */
      case 'investida':
      case 'investidaTripla': {
        const AVISO = 0.62;
        if (this.tempoEstado < AVISO) {
          // Telegrafo: recua, chia e a pressão sobe. Recuar antes de avançar
          // é a antecipação clássica — o corpo conta o que vai fazer.
          this.telegrafo = this.tempoEstado / AVISO;
          this.pressao = this.telegrafo;
          this.vx = damp(this.vx, -this.dir * 40, 0.2, dt);
          if (this.tempoEstado < dt * 2) this.quiques = this.estado === 'investidaTripla' ? 2 : 0;
        } else {
          this.telegrafo = 0;
          this.pressao = damp(this.pressao, 0, 0.25, dt);
          this.vx = this.dir * 480;
          const antes = this.x;
          this.x += this.vx * dt;
          // Bateu na parede?
          if (terreno.caixaSolida(this.x, this.y + 8, this.largura, this.altura - 16)) {
            this.x = antes;
            mundo.camera.sacudir(0.8);
            mundo.laco.congelar(0.08);
            mundo.emitir(this.centroX + this.dir * this.largura * 0.5, this.centroY, 24, {
              angulo: this.dir > 0 ? Math.PI : 0, espalhamento: 1.6,
              velMin: 90, velMax: 340, g: 300, cor: mundo.tema.acento, brilha: true,
            });
            if (this.quiques > 0) { this.quiques--; this.dir *= -1; }
            else this._trocarEstado('atordoada');
          }
          if (this.tempoEstado > AVISO + 2.2) this._trocarEstado('espera');
        }
        this._gravidade(dt, terreno);
        break;
      }

      /* --- atordoada: A janela de contra-ataque. Longa e óbvia. ---------- */
      case 'atordoada':
        this.vx = damp(this.vx, 0, 0.12, dt);
        this._gravidade(dt, terreno);
        if (Math.random() < dt * 6) {
          mundo.emitir(this.centroX + (Math.random() - 0.5) * this.largura, this.y + 10, 2, {
            angulo: -Math.PI / 2, espalhamento: 0.8, velMin: 30, velMax: 90,
            g: -60, vidaMin: 0.6, vidaMax: 1.4, cor: mundo.tema.particula,
          });
        }
        if (this.tempoEstado > 1.7) this._trocarEstado('espera');
        break;

      /* --- salto: sobe e cai, com onda ao aterrissar --------------------- */
      case 'salto': {
        const AVISO = 0.5;
        if (this.tempoEstado < AVISO) {
          this.telegrafo = this.tempoEstado / AVISO;
          this.vx = 0;
        } else if (!this._pulou) {
          this._pulou = true;
          this.telegrafo = 0;
          this.vy = -820;
          this.alvoX = j.centroX;
        } else {
          // No ar, corrige a horizontal em direção ao ponto de queda — mas
          // devagar, pra que sair de baixo continue funcionando.
          this.x = damp(this.x, this.alvoX - this.largura / 2, 0.55, dt);
          const res = this._gravidade(dt, terreno);
          if (res.chao && this.vy === 0 && this.tempoEstado > AVISO + 0.25) {
            this._pulou = false;
            ondaDupla(mundo, this.centroX, this.y + this.altura, 420, 1);
            mundo.camera.sacudir(0.9);
            mundo.laco.congelar(0.09);
            this._trocarEstado('atordoada');
          }
        }
        break;
      }

      /* --- vapor: jatos verticais em leque ------------------------------- */
      case 'vapor': {
        const AVISO = 0.7;
        this.telegrafo = clamp01(this.tempoEstado / AVISO);
        this.pressao = this.telegrafo;
        this.vx = damp(this.vx, 0, 0.2, dt);
        this._gravidade(dt, terreno);
        if (this.tempoEstado >= AVISO && !this._soltou) {
          this._soltou = true;
          atirarSpray(mundo, this.centroX, this.y + 6, -Math.PI / 2,
            this.fase >= 3 ? 9 : 6, 2.1, { vel: 300, raio: 6, cor: 'acento', g: 420 });
          mundo.camera.sacudir(0.35);
        }
        if (this.tempoEstado > AVISO + 1.1) {
          this._soltou = false; this.telegrafo = 0; this.pressao = 0;
          this._trocarEstado('espera');
        }
        break;
      }
    }
  }

  _gravidade(dt, terreno) {
    this.vy = Math.min(this.vy + GRAVIDADE * dt, 1100);
    return terreno.mover(this, 0, this.vy * dt);
  }

  desenhar(ctx, tema, camera) {
    const morre = clamp01(this.morrendo);
    const ferida = this.piscarDano > 0;
    const cx = this.centroX, cy = this.centroY;
    const w = this.largura, h = this.altura;
    /* O chassi era `terreno` misturado com `primeiroPlano` — ou seja, MAIS
       escuro que o chão em que a coisa se apoia. Um chefe preto sobre chão
       preto vira um vulto sem forma: dava pra ver a chama e nada mais. Metal
       reflete; ele tem que ser mais claro que a terra, não menos. */
    const corpo = ferida ? '#ffffff' : misturarHex(tema.terreno, tema.borda, 0.6);
    const metal = ferida ? '#ffffff' : misturarHex(tema.borda, tema.crista, 0.35);

    ctx.save();
    if (morre > 0) ctx.globalAlpha = 1 - morre;
    ctx.translate(cx, cy);
    ctx.scale(this.dir, 1);
    // Balanço da caldeira: mais forte quanto maior a pressão.
    ctx.rotate(Math.sin(this.t * 9) * 0.02 * this.pressao);

    // Fumaça saindo da chaminé — a coisa está ACESA, e é o que se vê de
    // longe antes de qualquer detalhe do chassi.
    if (!ferida) {
      for (let i = 0; i < 4; i++) {
        const f = ((this.t * 0.42 + i / 4) % 1);
        ctx.globalAlpha = (1 - f) * (0.22 + this.pressao * 0.3);
        ctx.fillStyle = misturarHex(tema.bruma, tema.primeiroPlano, 0.35);
        ctx.beginPath();
        ctx.arc(-w * 0.22 + Math.sin(this.t * 0.8 + i * 2) * f * 16,
          -h * 0.86 - f * h * 1.1, 5 + f * 20, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Chassi
    const traçarChassi = () => {
      ctx.beginPath();
      ctx.moveTo(-w * 0.46, h * 0.38);
      ctx.lineTo(-w * 0.4, -h * 0.2);
      ctx.quadraticCurveTo(-w * 0.34, -h * 0.44, -w * 0.1, -h * 0.46);
      ctx.lineTo(w * 0.28, -h * 0.44);
      ctx.quadraticCurveTo(w * 0.46, -h * 0.36, w * 0.46, -h * 0.05);
      ctx.lineTo(w * 0.42, h * 0.38);
      ctx.closePath();
    };
    ctx.fillStyle = corpo;
    traçarChassi();
    ctx.fill();
    if (!ferida) {
      ctx.strokeStyle = rgba(misturarHex(tema.crista, tema.luz, 0.3), 0.5);
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      traçarChassi();
      ctx.stroke();
    }

    // Chaminé — a citação direta da Fase 1.
    ctx.fillStyle = metal;
    ctx.fillRect(-w * 0.3, -h * 0.86, w * 0.16, h * 0.44);
    ctx.fillRect(-w * 0.34, -h * 0.92, w * 0.24, h * 0.09);

    // Rodas girando: a coisa está VIVA e funcionando, é o que assusta.
    for (const rx of [-w * 0.26, w * 0.06, w * 0.32]) {
      const rr = h * 0.19;
      ctx.save();
      ctx.translate(rx, h * 0.3);
      ctx.rotate(this.giroRoda);
      ctx.strokeStyle = metal;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke();
      for (let i = 0; i < 4; i++) {
        ctx.rotate(TAU / 4);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -rr); ctx.stroke();
      }
      ctx.restore();
    }

    // Válvulas: acendem com a pressão. É o telegrafo lido de longe.
    for (const [vx, vy] of [[-w * 0.12, -h * 0.18], [w * 0.16, -h * 0.1], [w * 0.3, -h * 0.24]]) {
      ctx.fillStyle = misturarHex(metal, tema.luz, this.pressao);
      ctx.beginPath();
      ctx.arc(vx, vy, 5 + this.pressao * 2.5, 0, TAU);
      ctx.fill();
    }

    // O olho: a parte VIVA da máquina, uma fenda só — o contraste entre metal
    // limpo e fenda orgânica é o que conta que a coisa foi infectada.
    if (!ferida) {
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.65 + 0.35 * Math.sin(this.t * 3) + this.telegrafo * 0.3;
      ctx.beginPath();
      ctx.ellipse(w * 0.3, -h * 0.3, 2.4, 9 * (1 + this.telegrafo * 0.7), 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  desenharLuz(ctx, tema) {
    if (this.piscarDano > 0) {
      luzRadial(ctx, this.centroX, this.centroY, this.largura, '#ffffff', 1);
      return;
    }
    const cx = this.centroX, cy = this.centroY;
    luzRadial(ctx, cx + this.dir * this.largura * 0.3, cy - this.altura * 0.3, 40,
      tema.luz, 0.5 + this.telegrafo * 0.5);
    if (this.pressao > 0.05) {
      luzRadial(ctx, cx, cy, this.largura * 0.8, tema.luz, this.pressao * 0.55);
    }
  }
}

/* =========================================================================
   3 · O CORAÇÃO — área final
   -------------------------------------------------------------------------
   Não é uma criatura: é a origem da corrupção, uma coisa pulsante presa no
   centro da arena. Não se move — o desafio é o espaço, não a perseguição.

   Fase 1: anéis de projétil COM UM VÃO. O vão é a resposta, e é visível no
           telegrafo.
   Fase 2: os anéis giram, e o vão se move junto — não dá mais pra escolher
           um lugar e ficar.
   Fase 3: dois anéis em contra-rotação, com pausa maior entre eles. É o
           padrão da fase 1 e da 2 ao mesmo tempo.
   ========================================================================= */

class CoracaoChefe extends Chefe {
  constructor(obj) {
    super(obj, {
      nome: 'O Coração', vida: 52, largura: 110, altura: 110, dano: 2,
      limiaresFase: [0.66, 0.33],
    });
    this.pulso = 0;
    this.anguloVao = 0;
    this.veias = Array.from({ length: 10 }, (_, i) => ({
      ang: (i / 10) * TAU + hash2(i, 1, 3) * 0.4,
      comp: 60 + hash2(i, 5, 7) * 70,
      fase: hash2(i, 9, 11) * TAU,
    }));
  }

  comportamento(dt, mundo) {
    const j = mundo.jogador;
    // Batimento: dois toques rápidos e uma pausa, como um coração de verdade.
    const ciclo = (this.t * 1.15) % 1;
    this.pulso = ciclo < 0.12 ? Math.sin(ciclo / 0.12 * Math.PI)
      : ciclo < 0.3 ? Math.sin((ciclo - 0.18) / 0.12 * Math.PI) * 0.6 : 0;

    switch (this.estado) {
      case 'entrada':
        if (this.tempoEstado > 1.4) this._trocarEstado('espera');
        break;
      case 'transicao':
        if (this.tempoEstado > 1.4) this._trocarEstado('espera');
        break;

      case 'espera':
        this.telegrafo = damp(this.telegrafo, 0, 0.15, dt);
        if (this.tempoEstado > (this.fase >= 3 ? 1.3 : 1.0)) {
          const padroes = this.fase === 1 ? ['anel', 'lanca']
            : this.fase === 2 ? ['anelGirante', 'lanca', 'anel']
            : ['anelDuplo', 'anelGirante', 'lanca'];
          this._trocarEstado(this._proximoPadrao(padroes));
          // Escolhe o vão longe do jogador não: PERTO dele, pra que a
          // resposta seja "fique onde está" e não "corra sempre".
          this.anguloVao = Math.atan2(j.centroY - this.centroY, j.centroX - this.centroX);
        }
        break;

      case 'anel':
      case 'anelGirante':
      case 'anelDuplo': {
        const AVISO = 0.75;
        this.telegrafo = clamp01(this.tempoEstado / AVISO);
        if (this.tempoEstado >= AVISO && !this._disparou) {
          this._disparou = true;
          const n = this.fase >= 3 ? 18 : 14;
          const gira = this.estado !== 'anel';
          atirarAnel(mundo, this.centroX, this.centroY, n, this.anguloVao, 1.0, {
            vel: 190, raio: 6, cor: 'acento',
            // No anel girante os projéteis curvam, então o vão VIAJA. Um
            // jogador parado no vão da fase 1 morre aqui — de propósito.
            curvatura: gira ? 0.55 : 0,
          });
          if (this.estado === 'anelDuplo') {
            setTimeout(() => {
              if (!this.morta) {
                atirarAnel(mundo, this.centroX, this.centroY, n, this.anguloVao + Math.PI, 1.0, {
                  vel: 150, raio: 6, cor: 'acento', curvatura: -0.55,
                });
              }
            }, 520);
          }
          mundo.camera.sacudir(0.4);
        }
        if (this.tempoEstado > AVISO + (this.estado === 'anelDuplo' ? 1.5 : 0.9)) {
          this._disparou = false; this._trocarEstado('espera');
        }
        break;
      }

      /* --- lança: tiro rápido e direto, força o jogador a se mexer ------- */
      case 'lanca': {
        const AVISO = 0.48;
        this.telegrafo = clamp01(this.tempoEstado / AVISO);
        if (this.tempoEstado >= AVISO && !this._lancou) {
          this._lancou = true;
          const ang = Math.atan2(j.centroY - this.centroY, j.centroX - this.centroX);
          atirarSpray(mundo, this.centroX, this.centroY, ang, 3, 0.36,
            { vel: 380, raio: 5, cor: 'crista' });
        }
        if (this.tempoEstado > AVISO + 0.6) { this._lancou = false; this._trocarEstado('espera'); }
        break;
      }
    }
  }

  desenhar(ctx, tema, camera) {
    const morre = clamp01(this.morrendo);
    const ferida = this.piscarDano > 0;
    const cx = this.centroX, cy = this.centroY;
    const r = this.largura * 0.4 * (1 + this.pulso * 0.09 + this.telegrafo * 0.16);
    const cor = ferida ? '#ffffff' : misturarHex(tema.primeiroPlano, tema.acento, 0.32);

    ctx.save();
    if (morre > 0) ctx.globalAlpha = 1 - morre;

    // Veias ancorando o Coração na arena — ele está PRESO, não flutuando.
    ctx.strokeStyle = misturarHex(cor, tema.borda, 0.4);
    ctx.lineCap = 'round';
    for (const v of this.veias) {
      const comp = v.comp * (1 + this.pulso * 0.14);
      const px = cx + Math.cos(v.ang) * comp;
      const py = cy + Math.sin(v.ang) * comp;
      let ax = cx, ay = cy;
      for (let k = 1; k <= 4; k++) {
        const u = k / 4;
        const bx = lerp(cx, px, u) + Math.sin(u * 4 + this.t + v.fase) * 9 * u;
        const by = lerp(cy, py, u) + Math.cos(u * 3 + this.t * 0.8 + v.fase) * 7 * u;
        ctx.lineWidth = lerp(11, 1.5, u);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ax = bx; ay = by;
      }
    }

    // Massa pulsante
    const g = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.3, r * 0.1, cx, cy, r);
    g.addColorStop(0, misturarHex(cor, tema.acento, 0.5 + this.pulso * 0.4));
    g.addColorStop(1, cor);
    ctx.fillStyle = g;
    ctx.beginPath();
    for (let i = 0; i <= 30; i++) {
      const a = (i / 30) * TAU;
      const rr = r * (1 + 0.09 * Math.sin(a * 4 + this.t * 1.3) + 0.05 * Math.sin(a * 7 - this.t * 2));
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    // O vão do anel, mostrado ANTES do disparo. É a informação que torna o
    // padrão justo — sem isso o anel é uma loteria.
    if (this.telegrafo > 0.05 && this.estado.startsWith('anel')) {
      ctx.save();
      ctx.globalAlpha = this.telegrafo * 0.85;
      ctx.strokeStyle = tema.crista;
      ctx.lineWidth = 3;
      ctx.setLineDash([7, 9]);
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.5 + this.telegrafo * 20,
        this.anguloVao - 0.5, this.anguloVao + 0.5);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  desenharLuz(ctx, tema) {
    const i = this.piscarDano > 0 ? 1 : 0.5 + this.pulso * 0.4 + this.telegrafo * 0.5;
    luzRadial(ctx, this.centroX, this.centroY, this.largura * (1 + this.pulso * 0.2),
      this.piscarDano > 0 ? '#ffffff' : tema.acento, i);
  }
}

/* ========================================================================= */

export const CHEFES = {
  'mae-afogada': MaeAfogada,
  'maquina': Maquina,
  'coracao': CoracaoChefe,
};

/**
 * @param {string} id  vem de `def.chefe` na definição da sala
 * @returns {Chefe|null}
 */
export function criarChefe(id, obj, mundo) {
  const Classe = CHEFES[id];
  if (!Classe) {
    if (id) console.warn(`[fase2] chefe desconhecido: "${id}"`);
    return null;
  }
  return new Classe(obj);
}

export { Chefe };
