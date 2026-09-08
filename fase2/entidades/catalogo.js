/* =========================================================================
   fase2/entidades/catalogo.js — fábrica de entidades a partir do mapa ASCII
   -------------------------------------------------------------------------
   Contrato que TODA entidade precisa cumprir (o mundo não sabe nada além
   disso, então qualquer inimigo novo entra sem mexer em mundo.js):

     atualizar(dt, mundo)       obrigatório
     caixa()                    { x, y, largura, altura } — colisão
     desenhar(ctx, tema, cam)   passe normal
     desenharLuz(ctx, tema)     passe emissivo (opcional)
     desenharFundo/Frente(...)  camadas extras (opcional)
     receberDano(n, deX, deY, mundo)
     morta                      true → removida no fim do passo
     perigoso                   false → não machuca ao encostar
     dano                       inteiro, padrão 1

   Este arquivo é base. O catálogo completo de parasitas e chefes é
   responsabilidade de entidades/parasitas.js e entidades/chefes.js.
   ========================================================================= */

import {
  TAU, clamp01, lerp, damp, rgba, misturarHex, easeOutCubic, easeOutBack, Rng, sobrepoe, hash2,
} from '../core/mat.js';
import { luzRadial } from '../render/renderizador.js';
import { criarParasita } from './parasitas.js';
import { criarChefe } from './chefes.js';

/* ==========================================================================
   Coletáveis / interativos
   ========================================================================== */

class Semente {
  constructor(obj) {
    this.chave = `${obj.cx},${obj.cy}`;
    this.x = obj.x - 14; this.y = obj.y - 34;
    this.largura = 28; this.altura = 28;
    this.perigoso = false;
    this.t = 0;
    this.ativada = false;
    this.abrindo = 0;
  }
  caixa() { return { x: this.x, y: this.y, largura: this.largura, altura: this.altura }; }
  atualizar(dt, mundo) {
    this.t += dt;
    if (this.ativada) { this.abrindo = Math.min(1, this.abrindo + dt * 1.4); return; }
    const j = mundo.jogador;
    if (sobrepoe(this.caixa(), { x: j.x, y: j.y, largura: j.largura, altura: j.altura })) {
      this.ativada = true;
      mundo.ativarSemente(this.chave, undefined, this.x + 14, this.y + 14);
      mundo.emitir(this.x + 14, this.y + 14, 40, {
        velMin: 60, velMax: 300, g: -40, vidaMin: 0.8, vidaMax: 2,
        cor: mundo.tema.acento, brilha: true, arrasto: 0.5,
      });
    }
  }
  desenhar(ctx, tema) {
    const flut = Math.sin(this.t * 1.7) * 4;
    const cx = this.x + 14, cy = this.y + 14 + flut;
    const abre = easeOutBack(this.abrindo);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.sin(this.t * 0.8) * 0.12);
    // Cápsula fechada → pétalas abertas
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + this.t * 0.2;
      ctx.save();
      ctx.rotate(a);
      ctx.fillStyle = misturarHex(tema.borda, tema.acento, 0.4 + abre * 0.6);
      ctx.beginPath();
      ctx.ellipse(0, lerp(-3, -11, abre), lerp(4.5, 3.5, abre), lerp(7, 12, abre), 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = tema.crista;
    ctx.beginPath();
    ctx.arc(0, 0, lerp(5, 3.4, abre), 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  desenharLuz(ctx, tema) {
    const flut = Math.sin(this.t * 1.7) * 4;
    const pulso = 0.6 + 0.4 * Math.sin(this.t * 2.2);
    luzRadial(ctx, this.x + 14, this.y + 14 + flut, lerp(50, 130, this.abrindo),
      tema.acento, pulso * lerp(0.7, 1, this.abrindo));
  }
}

class PontoSalvamento {
  constructor(obj) {
    this.x = obj.x - 18; this.y = obj.y - 44;
    this.largura = 36; this.altura = 44;
    this.perigoso = false;
    this.t = 0;
    this.ativo = false;
  }
  caixa() { return { x: this.x, y: this.y, largura: this.largura, altura: this.altura }; }
  atualizar(dt, mundo) {
    this.t += dt;
    const j = mundo.jogador;
    if (!this.ativo && sobrepoe(this.caixa(), { x: j.x, y: j.y, largura: j.largura, altura: j.altura })) {
      this.ativo = true;
      mundo.definirCheckpoint(this.x + 18, this.y + this.altura);
      mundo.jogador.curar(99);
    }
  }
  desenhar(ctx, tema) {
    const cx = this.x + 18, base = this.y + this.altura;
    // Pequeno monólito de raiz enrolada.
    ctx.fillStyle = tema.terreno;
    ctx.strokeStyle = tema.borda;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 9, base);
    ctx.bezierCurveTo(cx - 12, base - 22, cx - 5, base - 34, cx, base - 40);
    ctx.bezierCurveTo(cx + 5, base - 34, cx + 12, base - 22, cx + 9, base);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (this.ativo) {
      ctx.fillStyle = tema.crista;
      ctx.beginPath();
      ctx.arc(cx, base - 30, 4 + Math.sin(this.t * 3) * 0.8, 0, TAU);
      ctx.fill();
    }
  }
  desenharLuz(ctx, tema) {
    if (!this.ativo) return;
    luzRadial(ctx, this.x + 18, this.y + 14, 90 + Math.sin(this.t * 2) * 10, tema.crista, 0.7);
  }
}

class Altar {
  constructor(obj, habilidade = 'saltoDuplo') {
    this.x = obj.x - 22; this.y = obj.y - 52;
    this.largura = 44; this.altura = 52;
    this.perigoso = false;
    this.habilidade = habilidade;
    this.t = 0;
    this.usado = false;
    this.abrindo = 0;
  }
  caixa() { return { x: this.x, y: this.y, largura: this.largura, altura: this.altura }; }
  atualizar(dt, mundo) {
    this.t += dt;
    if (this.usado) { this.abrindo = Math.min(1, this.abrindo + dt * 1.2); return; }
    const j = mundo.jogador;
    if (sobrepoe(this.caixa(), { x: j.x, y: j.y, largura: j.largura, altura: j.altura })) {
      this.usado = true;
      j.destravar(this.habilidade);
      mundo.aoEvento?.({ tipo: 'habilidade', habilidade: this.habilidade, x: this.x, y: this.y });
      mundo.emitir(this.x + 22, this.y + 20, 50, {
        velMin: 40, velMax: 260, g: -60, vidaMin: 1, vidaMax: 2.4,
        cor: mundo.tema.crista, brilha: true, arrasto: 0.6,
      });
    }
  }
  desenhar(ctx, tema) {
    const cx = this.x + 22, base = this.y + this.altura;
    ctx.fillStyle = misturarHex(tema.terreno, tema.borda, 0.4);
    ctx.strokeStyle = tema.borda;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - 16, base);
    ctx.lineTo(cx - 11, base - 42);
    ctx.lineTo(cx + 11, base - 42);
    ctx.lineTo(cx + 16, base);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const flut = Math.sin(this.t * 1.4) * 3;
    ctx.save();
    ctx.translate(cx, base - 52 + flut);
    ctx.rotate(this.t * (this.usado ? 0.3 : 0.9));
    ctx.fillStyle = this.usado ? tema.borda : tema.acento;
    ctx.globalAlpha = this.usado ? 0.35 : 1;
    for (let i = 0; i < 3; i++) {
      ctx.rotate(TAU / 3);
      ctx.beginPath();
      ctx.ellipse(0, -8, 3, 7, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
  desenharLuz(ctx, tema) {
    if (this.usado) return;
    const flut = Math.sin(this.t * 1.4) * 3;
    luzRadial(ctx, this.x + 22, this.y + flut, 80, tema.acento, 0.6 + Math.sin(this.t * 2) * 0.2);
  }
}

class Fonte {
  constructor(obj) {
    this.x = obj.x - 12; this.y = obj.y - 24;
    this.largura = 24; this.altura = 24;
    this.perigoso = false;
    this.t = 0;
    this.usada = false;
  }
  caixa() { return { x: this.x, y: this.y, largura: this.largura, altura: this.altura }; }
  atualizar(dt, mundo) {
    this.t += dt;
    if (this.usada) return;
    const j = mundo.jogador;
    if (j.vida < j.vidaMax &&
        sobrepoe(this.caixa(), { x: j.x, y: j.y, largura: j.largura, altura: j.altura })) {
      this.usada = true;
      j.curar(1);
      mundo.emitir(this.x + 12, this.y + 12, 20, {
        velMin: 30, velMax: 120, g: -80, cor: mundo.tema.crista, brilha: true,
      });
    }
  }
  desenhar(ctx, tema) {
    if (this.usada) return;
    const flut = Math.sin(this.t * 2.3) * 3;
    ctx.fillStyle = tema.crista;
    ctx.beginPath();
    ctx.arc(this.x + 12, this.y + 12 + flut, 5, 0, TAU);
    ctx.fill();
  }
  desenharLuz(ctx, tema) {
    if (this.usada) return;
    luzRadial(ctx, this.x + 12, this.y + 12, 44, tema.crista, 0.55);
  }
}

/* ==========================================================================
   Travas de progressão
   --------------------------------------------------------------------------
   Duas travas, com propósitos diferentes:

   · PORTÃO  — exige uma habilidade. É uma tranca EXPLÍCITA, e por isso deve
     ser rara: em metroidvania, a boa tranca é a GEOMETRIA (um vão de 4 tiles
     já exige salto duplo sem precisar de porta nenhuma). Portão serve para
     quando o designer precisa que o jogador entenda "aqui tem algo, volte
     depois" — ele mostra QUAL habilidade abre, senão vira busca cega.

   · BARREIRA — matéria corrompida que só o Canto dissolve. É a tranca que
     ensina o verbo central do jogo: restaurar não é só bonito, é como se
     abre caminho.
   ========================================================================== */

class Portao {
  constructor(obj, habilidade) {
    this.x = obj.x - 16; this.y = obj.y - 96;
    this.largura = 32; this.altura = 96;
    this.perigoso = false;
    this.solido = true;
    this.habilidade = habilidade;
    this.abertura = 0;      // 0 fechado .. 1 aberto
    this.t = 0;
    this.avisou = 0;
  }
  caixa() { return { x: this.x, y: this.y, largura: this.largura, altura: this.altura }; }

  atualizar(dt, mundo) {
    this.t += dt;
    const temChave = !this.habilidade || mundo.jogador.temHabilidade(this.habilidade);
    if (temChave && this.abertura < 1) {
      this.abertura = Math.min(1, this.abertura + dt * 0.9);
      if (this.abertura === 1) {
        mundo.emitir(this.x + 16, this.y + 48, 26, {
          velMin: 40, velMax: 200, g: 120, cor: mundo.tema.crista, brilha: true,
        });
      }
    }
    if (this.abertura >= 1) return;

    // Fechado: empurra o jogador pra fora em vez de deixar atravessar.
    const j = mundo.jogador;
    if (sobrepoe(this.caixa(), { x: j.x, y: j.y, largura: j.largura, altura: j.altura })) {
      const dir = j.centroX < this.x + 16 ? -1 : 1;
      j.x = dir < 0 ? this.x - j.largura - 1 : this.x + this.largura + 1;
      if (Math.sign(j.vx) === dir * -1) j.vx = 0;
      // Avisa QUAL habilidade abre, no máximo uma vez a cada 2s.
      if (this.t - this.avisou > 2) {
        this.avisou = this.t;
        mundo.aoEvento?.({ tipo: 'portaoTrancado', habilidade: this.habilidade, x: this.x, y: this.y });
      }
    }
  }

  desenhar(ctx, tema) {
    const a = easeOutCubic(this.abertura);
    const cx = this.x + 16;
    ctx.save();
    ctx.globalAlpha = 1 - a * 0.85;
    // Grade de raízes entrelaçadas que recuam ao abrir.
    ctx.strokeStyle = misturarHex(tema.borda, tema.terreno, 0.3);
    ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const f = i / 4;
      const ondula = Math.sin(this.t * 0.7 + i) * 2;
      ctx.lineWidth = lerp(6, 3, f);
      ctx.beginPath();
      ctx.moveTo(cx - 14 + f * 28, this.y - a * 60);
      ctx.bezierCurveTo(
        cx - 14 + f * 28 + ondula, this.y + 30 - a * 40,
        cx + 14 - f * 28 - ondula, this.y + 64 - a * 20,
        cx - 14 + f * 28, this.y + 96
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  desenharLuz(ctx, tema) {
    if (this.abertura >= 1) return;
    const pulso = 0.35 + 0.25 * Math.sin(this.t * 1.6);
    luzRadial(ctx, this.x + 16, this.y + 48, 40, tema.acento, pulso * (1 - this.abertura));
  }
}

/* Grade de células vivas da sala corrente.
   Uma parede de barreira é feita de N entidades INDEPENDENTES. Se cada uma
   desenha o próprio contorno aceso, uma parede 4×4 vira uma grade de
   dezesseis carimbos idênticos — lê como papel de parede, não como matéria.
   Aqui cada célula descobre quais vizinhas existem e só acende o contorno
   onde a massa realmente TERMINA; por dentro as células se fundem numa
   silhueta só. A grade é reconstruída ao trocar de sala e a célula se
   remove dela ao começar a dissolver, então o contorno abre junto com o
   buraco que o jogador acabou de fazer. */
const _gradeBarreira = { sala: null, celulas: new Set() };
function gradeBarreiras(mundo) {
  if (_gradeBarreira.sala !== mundo.sala) {
    _gradeBarreira.sala = mundo.sala;
    _gradeBarreira.celulas = new Set();
    for (const e of mundo.entidades) {
      if (e instanceof Barreira) _gradeBarreira.celulas.add(e.chave);
    }
  }
  return _gradeBarreira.celulas;
}

const VIZ_DIR = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const VIZ_UNIT = VIZ_DIR.map(([x, y]) => { const l = Math.hypot(x, y); return [x / l, y / l]; });
// Duas células ortogonais (centros a 32px, raio ~21) se cruzam a ±40° do
// eixo — daí o limiar 0.72 em cosseno. Na diagonal os centros ficam a 45px
// e mal se tocam: praticamente não escondem contorno nenhum.
const VIZ_LIMIAR = [0.72, 0.96, 0.72, 0.96, 0.72, 0.96, 0.72, 0.96];
const N_BORDA = 40;

/* Deslocamento do centro de uma célula em relação ao centro do tile.
   Sem isso os núcleos ficam alinhados e as nervuras entre vizinhas formam
   um xadrez perfeito dentro da massa — a parede volta a denunciar a grade
   mesmo com a silhueta já fundida. É função pura da célula, então cada
   barreira sabe onde fica o centro da vizinha sem consultar ninguém. */
const JITTER = 3.4;
const deslocCelula = (cx, cy) => [
  (hash2(cx, cy, 211) - 0.5) * 2 * JITTER,
  (hash2(cx, cy, 307) - 0.5) * 2 * JITTER,
];

class Barreira {
  constructor(obj) {
    this.chave = `barreira:${obj.cx},${obj.cy}`;
    this.cx = obj.cx; this.cy = obj.cy;
    this.viz = 0;                 // bitmask de vizinhas vivas, em VIZ_DIR
    this.x = obj.x - 16; this.y = obj.y - 32;
    this.largura = 32; this.altura = 32;
    this.perigoso = false;
    this.t = 0;
    this.dissolvendo = 0;
    this.morta = false;

    /* Variação por posição. Cada célula sorteia (determinístico, pela
       posição) raio, rotação, número de lóbulos, fase e tom. O raio é 19-23,
       MAIOR que o meio-tile: as vizinhas se sobrepõem e a parede vira uma
       massa contínua em vez de uma fileira de bolhas encostadas. */
    const h1 = hash2(obj.cx, obj.cy, 61);
    const h2 = hash2(obj.cx, obj.cy, 97);
    const h3 = hash2(obj.cx, obj.cy, 131);
    // Raio um pouco maior que antes pra compensar o jitter: mesmo com duas
    // vizinhas se afastando ao máximo, as massas continuam se tocando.
    this.raio = lerp(21, 25, h1);
    [this.jx, this.jy] = deslocCelula(obj.cx, obj.cy);
    this.giro = h2 * TAU;
    this.lobulos = 3 + Math.floor(h3 * 4);
    this.fase = h2 * TAU;
    this.pulsoVel = lerp(0.8, 1.5, h3);
    // Tom próprio: variação pequena o bastante pra ler como manchas de
    // tecido, não como células distintas.
    this.tom = lerp(0.46, 0.56, h3);
    this._borda = new Float64Array(N_BORDA * 3);   // x, y, ângulo — reusado
  }
  caixa() { return { x: this.x, y: this.y, largura: this.largura, altura: this.altura }; }

  atualizar(dt, mundo) {
    this.t += dt;

    // Quem está do lado — recalculado todo quadro porque vizinhas somem.
    const grade = gradeBarreiras(mundo);
    let m = 0;
    for (let i = 0; i < 8; i++) {
      const d = VIZ_DIR[i];
      if (grade.has(`barreira:${this.cx + d[0]},${this.cy + d[1]}`)) m |= 1 << i;
    }
    this.viz = m;

    if (this.dissolvendo > 0) {
      this.dissolvendo += dt * 1.6;
      if (this.dissolvendo >= 1) this.morta = true;
      return;
    }

    const j = mundo.jogador;
    // O Canto dissolve tudo dentro do raio — o alcance CRESCE junto com a
    // onda visual, então o que o jogador vê acontecer é o que acontece.
    if (j.cantoRestante > 0) {
      const raioAtual = easeOutCubic(j.progressoCanto) * j.raioCanto;
      const d = Math.hypot(j.centroX - (this.x + 16), j.centroY - (this.y + 16));
      if (d <= raioAtual) {
        this.dissolvendo = 0.001;
        // Sai da grade agora: as vizinhas abrem o contorno no mesmo quadro
        // em que o buraco aparece.
        gradeBarreiras(mundo).delete(this.chave);
        mundo.emitir(this.x + 16, this.y + 16, 24, {
          velMin: 50, velMax: 220, g: -30, vidaMin: 0.6, vidaMax: 1.4,
          cor: mundo.tema.crista, brilha: true, arrasto: 0.5,
        });
        mundo.aoEvento?.({ tipo: 'barreiraQuebrada', x: this.x + 16, y: this.y + 16 });
        return;
      }
    }

    // Fechada: bloqueia como se fosse parede.
    if (sobrepoe(this.caixa(), { x: j.x, y: j.y, largura: j.largura, altura: j.altura })) {
      const dx = j.centroX - (this.x + 16);
      const dy = j.centroY - (this.y + 16);
      // Empurra pelo eixo de MENOR penetração — empurrar sempre na horizontal
      // catapulta quem cai em cima.
      if (Math.abs(dx) > Math.abs(dy)) {
        j.x = dx > 0 ? this.x + this.largura : this.x - j.largura;
        j.vx = 0;
      } else {
        j.y = dy > 0 ? this.y + this.altura : this.y - j.altura;
        j.vy = 0;
      }
    }
  }

  /** Raio do lóbulo num ângulo de MUNDO. O giro entra na fase em vez de num
   *  `ctx.rotate`, porque o ângulo amostrado precisa continuar valendo pra
   *  decidir se aquela direção tem vizinha ou não. */
  _raioEm(a) {
    const g = this.giro + Math.sin(this.t * 0.3 + this.fase) * 0.06;
    return this.raio * (
      1 + 0.14 * Math.sin((a - g) * this.lobulos + this.t * 0.9 + this.fase)
        + 0.07 * Math.sin((a - g) * (this.lobulos * 2 + 1) - this.t * 0.6));
  }

  /** 0 = borda exposta, 1 = escondida dentro de uma célula vizinha. */
  _cobertura(a) {
    if (!this.viz) return 0;
    const ca = Math.cos(a), sa = Math.sin(a);
    let c = 0;
    for (let i = 0; i < 8; i++) {
      if (!(this.viz & (1 << i))) continue;
      const u = VIZ_UNIT[i];
      const dot = ca * u[0] + sa * u[1];
      const lim = VIZ_LIMIAR[i];
      if (dot > lim) c = Math.max(c, (dot - lim) / (1 - lim));
    }
    return c;
  }

  /** Recalcula a borda em coordenadas de mundo (x, y, ângulo). */
  _atualizarBorda() {
    const pulso = (1 + clamp01(this.dissolvendo) * 0.35)
      * (1 + Math.sin(this.t * this.pulsoVel + this.fase) * 0.05);
    const cx = this.x + 16 + this.jx, cy = this.y + 16 + this.jy;
    const b = this._borda;
    for (let i = 0; i < N_BORDA; i++) {
      const a = (i / N_BORDA) * TAU;
      const r = this._raioEm(a) * pulso;
      b[i * 3] = cx + Math.cos(a) * r;
      b[i * 3 + 1] = cy + Math.sin(a) * r;
      b[i * 3 + 2] = a;
    }
    return pulso;
  }

  _traçar(ctx) {
    const b = this._borda;
    ctx.beginPath();
    ctx.moveTo(b[0], b[1]);
    for (let i = 1; i < N_BORDA; i++) ctx.lineTo(b[i * 3], b[i * 3 + 1]);
    ctx.closePath();
  }

  /* A MASSA vai no passe de FUNDO, e só o detalhe no passe normal. Se cada
     célula desenhasse massa e detalhe de uma vez, a massa da vizinha —
     desenhada depois — cobriria as nervuras desta, e a trama sumiria por
     baixo da parede. Separando os dois passes, todas as massas assentam
     primeiro e as nervuras correm por cima de todas elas. */
  desenharFundo(ctx, tema) {
    const d = clamp01(this.dissolvendo);
    this._atualizarBorda();
    ctx.save();
    ctx.globalAlpha = 1 - d;
    // Preenchimento chapado: com alfa 1 as vizinhas se sobrepõem sem emenda
    // e a parede vira uma silhueta só. Era o gradiente radial (claro no
    // centro) que fazia cada tile ler como uma flor carimbada.
    this._traçar(ctx);
    ctx.fillStyle = misturarHex(tema.primeiroPlano, tema.ceuTopo, this.tom);
    ctx.fill();
    ctx.restore();
  }

  desenhar(ctx, tema) {
    const d = clamp01(this.dissolvendo);
    const pulso = this._atualizarBorda();
    const b = this._borda;
    const cx = this.x + 16 + this.jx, cy = this.y + 16 + this.jy;

    ctx.save();
    ctx.globalAlpha = 1 - d;

    // 2) NERVURAS até o centro de cada vizinha viva — a parede lê como uma
    //    trama contínua em vez de bolhas encostadas.
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(tema.acento, 0.16);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 8; i += 2) {                 // só as ortogonais
      if (!(this.viz & (1 << i))) continue;
      const d0 = VIZ_DIR[i];
      const vx = this.cx + d0[0], vy = this.cy + d0[1];
      // Nem toda ligação existe: uma trama com TODAS as arestas volta a ser
      // uma grade, só que desenhada. O sorteio usa a célula de MENOR índice
      // do par, então as duas pontas concordam sobre existir ou não.
      const kx = Math.min(this.cx, vx), ky = Math.min(this.cy, vy);
      if (hash2(kx, ky, 53 + (i >> 1) % 2) > 0.7) continue;
      const [ox, oy] = deslocCelula(vx, vy);
      const ax = this.x + 16 + d0[0] * 32 + ox, ay = this.y + 16 + d0[1] * 32 + oy;
      // Cada lado desenha só a METADE até o encontro. As duas metades são
      // calculadas do mesmo jeito pelas duas células, então emendam.
      const mx = (cx + ax) / 2, my = (cy + ay) / 2;
      const arco = (hash2(kx, ky, 17) - 0.5) * 9;
      ctx.moveTo(cx, cy);
      ctx.quadraticCurveTo((cx + mx) / 2 - (ay - cy) * 0.05 - arco * 0.5,
        (cy + my) / 2 + (ax - cx) * 0.05 + arco * 0.5, mx, my);
    }
    ctx.stroke();

    // 3) NÚCLEO: pequeno e escuro, com um ponto aceso. Dá escala à massa sem
    //    virar miolo de flor.
    ctx.beginPath();
    ctx.ellipse(cx, cy, 4.2 * pulso, 3.4 * pulso, this.giro, 0, TAU);
    ctx.fillStyle = misturarHex(tema.primeiroPlano, tema.ceuTopo, 0.78);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx - 1.2, cy - 1.2, 1.3, 0, TAU);
    ctx.fillStyle = rgba(tema.acento, 0.5);
    ctx.fill();

    // 4) CONTORNO: fraco na volta inteira (matéria no miolo) e forte só onde
    //    não há vizinha. É esse trecho forte que desenha a borda da parede
    //    inteira, em vez de dezesseis contornos concorrentes.
    this._traçar(ctx);
    ctx.strokeStyle = rgba(tema.acento, 0.13);
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.strokeStyle = rgba(tema.acento, 0.8);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    let dentro = false;
    for (let i = 0; i <= N_BORDA; i++) {
      const k = (i % N_BORDA) * 3;
      if (this._cobertura(b[k + 2]) < 0.35) {
        if (dentro) ctx.lineTo(b[k], b[k + 1]);
        else { ctx.moveTo(b[k], b[k + 1]); dentro = true; }
      } else dentro = false;
    }
    ctx.stroke();

    ctx.restore();
  }

  desenharLuz(ctx, tema) {
    const d = clamp01(this.dissolvendo);
    if (d > 0) {
      luzRadial(ctx, this.x + 16, this.y + 16, 70 * d, tema.acento, 1 - d);
      return;
    }
    // Só a borda da parede acende. Dezesseis luzes iguais somadas viram um
    // borrão chapado de magenta bem onde deveria haver massa escura.
    let livres = 0;
    for (let i = 0; i < 8; i += 2) if (!(this.viz & (1 << i))) livres++;
    if (!livres) return;
    luzRadial(ctx, this.x + 16, this.y + 16, 26, tema.acento,
      0.06 + 0.05 * livres + Math.sin(this.t * 1.5 + this.fase) * 0.03);
  }
}

class Lapide {
  constructor(obj, texto) {
    this.x = obj.x - 14; this.y = obj.y - 40;
    this.largura = 28; this.altura = 40;
    this.perigoso = false;
    this.texto = texto;
    this.t = 0;
    this.perto = 0;
  }
  caixa() { return { x: this.x, y: this.y, largura: this.largura, altura: this.altura }; }
  atualizar(dt, mundo) {
    this.t += dt;
    const j = mundo.jogador;
    const d = Math.hypot(j.centroX - (this.x + 14), j.centroY - (this.y + 20));
    const alvo = d < 70 ? 1 : 0;
    this.perto += (alvo - this.perto) * Math.min(1, dt * 6);
    if (alvo && this.perto > 0.9 && !this._mostrou) {
      this._mostrou = true;
      mundo.aoEvento?.({ tipo: 'lore', texto: this.texto, x: this.x, y: this.y });
    } else if (!alvo && this.perto < 0.1) this._mostrou = false;
  }
  desenhar(ctx, tema) {
    const cx = this.x + 14, base = this.y + this.altura;
    ctx.fillStyle = misturarHex(tema.terreno, tema.borda, 0.5);
    ctx.strokeStyle = tema.borda;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cx - 10, base);
    ctx.lineTo(cx - 8, base - 30);
    ctx.quadraticCurveTo(cx, base - 38, cx + 8, base - 30);
    ctx.lineTo(cx + 10, base);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 0.3 + this.perto * 0.7;
    ctx.fillStyle = tema.crista;
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(cx - 5, base - 26 + i * 6, 10 - i * 2, 1.4);
    }
    ctx.globalAlpha = 1;
  }
  desenharLuz(ctx, tema) {
    if (this.perto < 0.05) return;
    luzRadial(ctx, this.x + 14, this.y + 16, 46, tema.crista, this.perto * 0.5);
  }
}

/* ==========================================================================
   Parasita base — o inimigo comum.
   Comportamento mínimo: patrulha, cai em plataforma, morre em 2 golpes.
   entidades/parasitas.js substitui e amplia isso.
   ========================================================================== */

export class ParasitaBase {
  constructor(obj) {
    this.x = obj.x - 15; this.y = obj.y - 30;
    this.largura = 30; this.altura = 30;
    this.vx = 0; this.vy = 0;
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.vida = 2;
    this.dano = 1;
    this.morta = false;
    this.t = Math.random() * 10;   // dessincroniza a ondulação entre parasitas
    this.piscarDano = 0;
    this.vel = 46;

    // Tentáculos: quantidade, ângulo de saída, comprimento e fase próprios.
    // Fixos por instância (não recalculados por quadro) pra criatura não
    // "ferver" — o movimento vem da fase, não de sorteio novo a cada frame.
    //
    // Comprimento MUITO maior que o raio do corpo (~11): com 10-22px eles
    // terminavam dentro da própria massa e a criatura virava um borrão
    // redondo. O que faz a silhueta ler como a Sombra são as pontas saindo
    // bem para fora, como chama fria.
    // Tentáculos só na METADE DE CIMA, abrindo para os lados como chama
    // fria subindo. Distribuir em 360° foi a primeira tentativa e o
    // resultado leu como ARANHA — o cérebro vê apêndices saindo por baixo
    // de um corpo redondo e chama aquilo de perna. Mantendo tudo acima da
    // linha de ombro, a mesma técnica lê como fumaça/garra.
    const nTent = 6 + Math.floor(Math.random() * 3);
    this.tentaculos = Array.from({ length: nTent }, (_, i) => {
      const f = nTent === 1 ? 0.5 : i / (nTent - 1);
      return {
        // De −185° a +5°: varre o hemisfério superior, com sobra nas pontas.
        ang: lerp(-Math.PI * 1.03, 0.09, f) + (Math.random() - 0.5) * 0.28,
        // As do meio (mais verticais) são as mais longas.
        comp: lerp(16, 34, Math.sin(f * Math.PI)) + Math.random() * 8,
        fase: Math.random() * TAU,
        vel: 0.7 + Math.random() * 0.8,
        // Curvam para fora do centro, como fogo lambendo.
        curva: (f - 0.5) * 1.7 + (Math.random() - 0.5) * 0.4,
      };
    });

    // Fendas de olho no CAPUZ: fila em arco, cada uma alongada e inclinada
    // no mesmo sentido. Agrupadas no centro do corpo elas liam como uma
    // fileira de dentes; no alto e em arco, leem como olhar.
    const nOlhos = 4 + Math.floor(Math.random() * 3);
    this.olhos = Array.from({ length: nOlhos }, (_, i) => {
      const f = nOlhos === 1 ? 0.5 : i / (nOlhos - 1);
      return {
        dx: lerp(-5.5, 5.5, f),
        dy: -9 + Math.abs(f - 0.5) * 5.5,   // arco: as das pontas descem
        alt: lerp(5.2, 2.6, Math.abs(f - 0.5) * 2),
        fase: Math.random() * TAU,
      };
    });

    this.balanco = Math.random() * TAU;
  }
  caixa() { return { x: this.x + 4, y: this.y + 4, largura: this.largura - 8, altura: this.altura - 8 }; }

  atualizar(dt, mundo) {
    this.t += dt;
    this.piscarDano = Math.max(0, this.piscarDano - dt);
    const terreno = mundo.sala.terreno;

    this.vx = this.vel * this.dir;
    this.vy = Math.min(this.vy + 1500 * dt, 800);

    const antes = this.x;
    terreno.mover(this, this.vx * dt, this.vy * dt);
    // Bateu na parede OU chegou na beirada → vira. Sem o teste de beirada o
    // parasita cai da plataforma e a sala se esvazia sozinha.
    const beirada = !terreno.caixaSolida(
      this.dir > 0 ? this.x + this.largura + 2 : this.x - 4, this.y + this.altura + 2, 4, 6
    );
    if (Math.abs(this.x - antes) < Math.abs(this.vx * dt) * 0.6 || beirada) this.dir *= -1;
  }

  receberDano(n, deX, deY, mundo) {
    this.vida -= n;
    this.piscarDano = 0.12;
    mundo.emitir(this.x + this.largura / 2, this.y + this.altura / 2, 8, {
      velMin: 60, velMax: 200, g: 300, cor: mundo.tema.acento, brilha: true,
    });
    if (this.vida <= 0) {
      this.morta = true;
      mundo.emitir(this.x + this.largura / 2, this.y + this.altura / 2, 22, {
        velMin: 80, velMax: 320, g: 260, vidaMin: 0.4, vidaMax: 1.1,
        cor: mundo.tema.particula, brilha: true,
      });
      mundo.aoEvento?.({ tipo: 'inimigoMorto', x: this.x, y: this.y });
    }
  }

  /* -----------------------------------------------------------------------
     DESENHO — a poluição virada criatura.

     Inspiração: a Sombra de Hollow Knight. Massa PRETA sem detalhe interno,
     tentáculos que saem do corpo como chamas frias, e um punhado de fendas
     brancas no lugar de rosto. Não copia: aqui a matéria é oleosa e a fumaça
     que sobe é fuligem, porque é disso que essas coisas são feitas.

     O acerto visual central é o CONTRASTE INVERTIDO em relação ao herói: ele
     é claro e luminoso, elas são buracos pretos com dois pontos de luz. Numa
     tela escura, as duas coisas continuam legíveis e nunca se confundem.
     ----------------------------------------------------------------------- */

  desenhar(ctx, tema) {
    const cx = this.x + this.largura / 2;
    const cy = this.y + this.altura / 2 + Math.sin(this.t * 3.1) * 1.8;
    const ferida = this.piscarDano > 0;

    ctx.save();

    // --- fumaça subindo: nasce do corpo e dissolve ------------------------
    // Desenhada ANTES do corpo pra ficar por trás; alfa baixo e raio grande,
    // senão vira nuvem sólida e come a silhueta.
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = tema.primeiroPlano;
    for (let i = 0; i < 3; i++) {
      const f = ((this.t * 0.35 + i / 3) % 1);
      const sobe = f * 22;
      ctx.beginPath();
      ctx.arc(cx + Math.sin(this.t * 0.9 + i * 2) * 5, cy - 6 - sobe,
        6 + f * 7, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // --- tentáculos -------------------------------------------------------
    const corMassa = ferida
      ? '#ffffff'
      : misturarHex(tema.primeiroPlano, tema.ceuTopo, 0.4);
    ctx.lineCap = 'round';
    // Nascem na altura dos "ombros", não no centro: saindo do meio da massa
    // elas apontam para baixo também e viram perna.
    const ox = cx, oy = cy - 6;
    for (const t of this.tentaculos) {
      const onda = Math.sin(this.t * t.vel + t.fase) * 0.42;
      const a = t.ang + onda;
      const px = ox + Math.cos(a) * t.comp;
      const py = oy + Math.sin(a) * t.comp * 0.85;
      const mx = ox + Math.cos(a + t.curva * 0.5) * t.comp * 0.55;
      const my = oy + Math.sin(a + t.curva * 0.5) * t.comp * 0.5;

      // Um traço só, afinando: desenhado em 4 subsegmentos com espessura
      // decrescente, porque o canvas não tem espessura variável nativa e uma
      // garra de espessura constante lê como antena de inseto.
      const N = 4;
      let ax = ox, ay = oy;
      for (let k = 1; k <= N; k++) {
        const u = k / N;
        // Bézier quadrática avaliada em u.
        const iu = 1 - u;
        const bx = iu * iu * ox + 2 * iu * u * mx + u * u * px;
        const by = iu * iu * oy + 2 * iu * u * my + u * u * py;
        ctx.strokeStyle = corMassa;
        ctx.lineWidth = lerp(6.5, 0.9, (k - 0.5) / N);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
        ax = bx; ay = by;
      }

      // Fio de luz fraquíssimo na borda externa da garra. Existe por um
      // motivo prático: a criatura é quase preta e o fundo também é escuro —
      // sem esse fio ela some contra a parede em vez de ler como silhueta.
      if (!ferida) {
        ctx.globalAlpha = 0.22;
        ctx.strokeStyle = tema.acento;
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.quadraticCurveTo(mx, my, px, py);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // --- massa central ----------------------------------------------------
    // --- corpo: capuz em cima, manto esfarrapado embaixo -------------------
    // Mais ALTO que largo, com ponta no topo. Um corpo redondo com apêndices
    // vira bicho; um vulto encapuzado vira presença.
    const inclina = this.dir * 0.12 + Math.sin(this.t * 0.8 + this.balanco) * 0.05;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(inclina);
    ctx.fillStyle = corMassa;

    const onda = (a, k) => Math.sin(a * 3 + this.t * 1.7 + k) * 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -21);                                    // ponta do capuz
    ctx.bezierCurveTo(6 + onda(1, 0), -18, 12 + onda(2, 1), -9, 13, -1);
    ctx.bezierCurveTo(13.5, 7, 10, 13, 7 + onda(3, 2), 17);
    // Barra do manto: dentes irregulares, como pano rasgado dissolvendo.
    for (let i = 3; i >= -3; i--) {
      const x = i * 2.6;
      const y = 17 + Math.sin(i * 2.1 + this.t * 2.2) * 3.5;
      ctx.lineTo(x, y);
      ctx.lineTo(x - 1.3, 12 + Math.sin(i * 1.7 + this.t) * 1.5);
    }
    ctx.bezierCurveTo(-10, 13, -13.5, 7, -13, -1);
    ctx.bezierCurveTo(-12 + onda(2, 3), -9, -6 + onda(1, 4), -18, 0, -21);
    ctx.closePath();
    ctx.fill();

    // --- fendas de olho ---------------------------------------------------
    // Único elemento claro da criatura, no capuz. Inclinam junto com o corpo,
    // então o vulto sempre parece estar olhando para onde vai.
    if (!ferida) {
      ctx.fillStyle = '#ffffff';
      for (const o of this.olhos) {
        // Cintilação dessincronizada: fenda de alfa fixo parece adesivo,
        // piscando parece coisa viva olhando.
        ctx.globalAlpha = 0.75 + 0.25 * Math.sin(this.t * 2.6 + o.fase);
        ctx.save();
        ctx.translate(o.dx * this.dir, o.dy);
        ctx.rotate(o.dx * this.dir * 0.055);   // leque, acompanhando o arco
        ctx.beginPath();
        ctx.ellipse(0, 0, 0.8, o.alt, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
    ctx.restore();
  }

  desenharLuz(ctx, tema) {
    const cx = this.x + this.largura / 2;
    const cy = this.y + this.altura / 2 + Math.sin(this.t * 3.1) * 1.8;

    if (this.piscarDano > 0) {
      luzRadial(ctx, cx, cy, 34, '#ffffff', 1);
      return;
    }

    // As fendas emitem — é o que faz o parasita ser visto no escuro antes de
    // a silhueta ficar legível, dando ao jogador tempo de reagir.
    ctx.save();
    ctx.translate(cx + this.dir * 2, cy - 2);
    ctx.fillStyle = '#ffffff';
    for (const o of this.olhos) {
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(this.t * 2.6 + o.fase);
      ctx.beginPath();
      ctx.ellipse(o.dx * this.dir, o.dy, 1.6, o.alt * 1.35, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    luzRadial(ctx, cx + this.dir * 2, cy - 2, 24, tema.acento, 0.32);
  }
}

/* ========================================================================== */

/**
 * Coletável permanente. A cada `FRAGMENTOS_POR_VIDA` recolhidos, a vida
 * máxima sobe 1 — é a recompensa que faz explorar valer a pena sem precisar
 * de loja, moeda ou árvore de talentos.
 */
export const FRAGMENTOS_POR_VIDA = 4;

class Fragmento {
  constructor(obj) {
    this.chave = `frag:${obj.cx},${obj.cy}`;
    this.x = obj.x - 11; this.y = obj.y - 26;
    this.largura = 22; this.altura = 22;
    this.perigoso = false;
    this.t = Math.random() * 6;   // dessincroniza a flutuação entre fragmentos
    this.morta = false;
  }
  caixa() { return { x: this.x, y: this.y, largura: this.largura, altura: this.altura }; }
  atualizar(dt, mundo) {
    this.t += dt;
    const j = mundo.jogador;
    if (!sobrepoe(this.caixa(), { x: j.x, y: j.y, largura: j.largura, altura: j.altura })) return;
    this.morta = true;
    mundo.coletarFragmento(this.chave);
    mundo.emitir(this.x + 11, this.y + 11, 30, {
      velMin: 50, velMax: 240, g: -50, vidaMin: 0.5, vidaMax: 1.3,
      cor: mundo.tema.crista, brilha: true, arrasto: 0.5,
    });
  }
  desenhar(ctx, tema) {
    const cx = this.x + 11, cy = this.y + 11 + Math.sin(this.t * 1.9) * 3.5;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.t * 0.6);
    ctx.fillStyle = tema.crista;
    ctx.beginPath();       // losango alongado — lê como "estilhaço"
    ctx.moveTo(0, -8); ctx.lineTo(5, 0); ctx.lineTo(0, 8); ctx.lineTo(-5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  desenharLuz(ctx, tema) {
    const cy = this.y + 11 + Math.sin(this.t * 1.9) * 3.5;
    luzRadial(ctx, this.x + 11, cy, 34 + Math.sin(this.t * 2.4) * 5, tema.crista, 0.65);
  }
}

/* ------------------------------------------------------------------------- */

/**
 * @param {{tipo:string,x:number,y:number,cx:number,cy:number}} obj
 * @param {import('../mundo/mundo.js').Mundo} mundo
 * @returns {object|null}
 */
export function criarEntidade(obj, mundo) {
  const def = mundo.sala?.def ?? {};

  switch (obj.tipo) {
    // --- objetos com estado persistido: nascem já consumidos se o save disser
    case 'semente': {
      const s = new Semente(obj);
      if (mundo.sementesAtivadas.has(s.chave)) { s.ativada = true; s.abrindo = 1; }
      return s;
    }
    case 'fragmento': {
      const f = new Fragmento(obj);
      return mundo.fragmentosColetados.has(f.chave) ? null : f;
    }
    case 'altar': {
      // Qual habilidade cada altar dá vem da DEFINIÇÃO DA SALA (`def.altar`),
      // não de um contador global de altares já criados. O contador dependia
      // da ordem em que as salas fossem carregadas — entrar por outra porta
      // dava outra habilidade, e recarregar um save dava outra ainda.
      const hab = def.altar || 'saltoDuplo';
      const a = new Altar(obj, hab);
      if (mundo.jogador.temHabilidade(hab)) { a.usado = true; a.abrindo = 1; }
      return a;
    }
    case 'barreira': {
      const b = new Barreira(obj);
      return mundo.barreirasQuebradas.has(b.chave) ? null : b;
    }

    // --- sem estado persistido
    case 'salvamento': return new PontoSalvamento(obj);
    case 'fonte': return new Fonte(obj);
    case 'portao': return new Portao(obj, def.portao || 'investida');
    case 'lapide': return new Lapide(obj, (def.lore || [])[obj.cx % Math.max(1, (def.lore || []).length)] || '');

    // --- inimigos: o bestiário vive em `entidades/parasitas.js`
    case 'parasita': case 'voador': case 'cuspidor':
    case 'rastejante': case 'explosivo': case 'tecelao':
      return criarParasita(obj.tipo, obj) ?? new ParasitaBase(obj);

    case 'chefe': return criarChefe(def.chefe, obj, mundo);
    default: return null;
  }
}

export { Semente, PontoSalvamento, Altar, Fonte, Portao, Barreira, Lapide, Fragmento };
