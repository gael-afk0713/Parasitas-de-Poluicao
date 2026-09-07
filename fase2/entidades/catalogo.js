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

import { TAU, clamp01, lerp, damp, rgba, misturarHex, easeOutCubic, easeOutBack, Rng } from '../core/mat.js';
import { luzRadial } from '../render/renderizador.js';
import { sobrepoe } from '../mundo/mundo.js';

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
      mundo.ativarSemente(this.chave);
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
    this.t = 0;
    this.piscarDano = 0;
    this.vel = 46;
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

  desenhar(ctx, tema) {
    const cx = this.x + this.largura / 2;
    const cy = this.y + this.altura / 2 + Math.sin(this.t * 4) * 1.5;
    ctx.save();
    if (this.piscarDano > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.9;
    }
    // Massa escura irregular com "cílios" — algo entre fungo e óleo.
    ctx.fillStyle = this.piscarDano > 0 ? '#ffffff' : misturarHex(tema.primeiroPlano, tema.acento, 0.22);
    ctx.beginPath();
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * TAU;
      const r = 11 + Math.sin(a * 3 + this.t * 2.4) * 2.2 + Math.sin(a * 5 - this.t) * 1.2;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r * 0.86;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    // olho único — dá direção e intenção à criatura
    ctx.fillStyle = tema.acento;
    ctx.beginPath();
    ctx.arc(cx + this.dir * 3.5, cy - 1, 3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = tema.ceuTopo;
    ctx.beginPath();
    ctx.arc(cx + this.dir * 4.4, cy - 1, 1.4, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  desenharLuz(ctx, tema) {
    const cx = this.x + this.largura / 2;
    const cy = this.y + this.altura / 2;
    luzRadial(ctx, cx + this.dir * 3.5, cy - 1, 22, tema.acento, this.piscarDano > 0 ? 1 : 0.4);
  }
}

/* ========================================================================== */

/** Ordem de destravamento por altar, na ordem em que os altares aparecem. */
const ORDEM_HABILIDADES = ['saltoDuplo', 'investida', 'canto', 'parede', 'planeio'];
let contadorAltares = 0;

/**
 * @param {{tipo:string,x:number,y:number,cx:number,cy:number}} obj
 * @returns {object|null}
 */
export function criarEntidade(obj, mundo) {
  switch (obj.tipo) {
    case 'semente':
      // Semente já ativada num save anterior nasce aberta e não reativa.
      { const s = new Semente(obj);
        if (mundo.sementesAtivadas.has(s.chave)) { s.ativada = true; s.abrindo = 1; }
        return s; }
    case 'salvamento': return new PontoSalvamento(obj);
    case 'altar': return new Altar(obj, ORDEM_HABILIDADES[contadorAltares++ % ORDEM_HABILIDADES.length]);
    case 'fonte': return new Fonte(obj);
    case 'parasita': return new ParasitaBase(obj);
    case 'voador': { const p = new ParasitaBase(obj); p.vel = 30; p.voa = true; return p; }
    case 'cuspidor': { const p = new ParasitaBase(obj); p.vel = 20; p.vida = 3; return p; }
    case 'rastejante': { const p = new ParasitaBase(obj); p.vel = 70; p.vida = 1; return p; }
    case 'fragmento': return new Fonte(obj);
    case 'chefe': return null;   // entidades/chefes.js assume
    default: return null;
  }
}

export { Semente, PontoSalvamento, Altar, Fonte };
