/* =========================================================================
   fase2/render/fauna.js — as aves pousadas no espaço de jogo
   -------------------------------------------------------------------------
   O fundo já mostra bichos fugindo LONGE. Isto é o que foge PERTO: aves
   pequenas pousadas nas bordas do terreno, que levantam voo em pânico quando
   o Guardião se aproxima.

   E o comportamento muda com a pureza, que é o ponto:
     · suja   poucas aves, ariscas (levantam de longe), às vezes entram em
              pânico sozinhas — e NÃO VOLTAM. O lugar vai ficando vazio
              conforme você passa por ele.
     · limpa  mais aves, mansas (só levantam bem de perto), e voltam pro
              mesmo galho alguns segundos depois.
   Quando a sala é restaurada com o jogador dentro, as aves que faltavam
   CHEGAM voando e pousam: a restauração tem plateia.

   Nada disso bloqueia, machuca ou colide. É ambiente — mas ambiente que
   reage ao jogador, e é essa reação que faz o lugar parecer habitado.
   ========================================================================= */

import { TAU, lerp, clamp01, hash2, misturarHex, rgba, damp } from '../core/mat.js';
import {
  calmaDaFauna, confCatastrofe, desenharAnimal, forcaFogo, chamaDe,
} from './catastrofe.js';
import { VAZIO } from '../mundo/terreno.js';

const MAX_AVES = 14;

/* O bicho caído de cada área. O Coração não tem: lá não sobrou nenhum. */
const FERIDO = { raizes: 'veado', varzea: 'capivara', clareira: 'tamandua', dossel: 'veado' };

export class Fauna {
  /**
   * @param {import('../mundo/terreno.js').Terreno} terreno
   */
  /**
   * @param {{x:number,y:number}|null} entrada  onde o jogador acabou de entrar
   */
  constructor(terreno, area, semente = 7, entrada = null) {
    this.area = area;
    this.aves = [];
    this.ferido = entrada ? this._acharFerido(terreno, area, semente, entrada) : null;
    // Poleiros: pontos das arestas PISÁVEIS (as mesmas em que o musgo
    // cresce), espaçados, sorteados por posição — a mesma sala tem sempre as
    // mesmas aves nos mesmos lugares.
    const arestas = terreno.arestasSuperiores(0.9);
    /* As arestas chegam já suavizadas, em segmentos de ~14 px: o poleiro é
       medido pela distância ACUMULADA ao longo da polilinha, não por
       segmento — por segmento, nenhum era longo o bastante e a sala ficava
       sem ave nenhuma. */
    const ESPACO = 120;
    const candidatos = [];
    for (const faixa of arestas) {
      let percorrido = 0, proximo = 40;
      for (let i = 0; i < faixa.length - 1; i++) {
        const a = faixa[i], b = faixa[i + 1];
        const comp = Math.hypot(b.x - a.x, b.y - a.y);
        while (proximo <= percorrido + comp) {
          const u = (proximo - percorrido) / (comp || 1);
          const x = lerp(a.x, b.x, u), y = lerp(a.y, b.y, u);
          proximo += ESPACO;
          const h = hash2(Math.round(x), Math.round(y), semente + 71);
          if (h > 0.45) continue;
          /* Só poleiro com AR em cima. `arestasSuperiores` só enxerga sólido,
             então o fundo de uma poça contava como chão — e a ave nascia
             pousada debaixo d'água (a fauna é desenhada antes da lâmina). */
          const cx = Math.floor(x / terreno.tile), cy = Math.floor((y - terreno.tile * 0.5) / terreno.tile);
          if (terreno.em(cx, cy) !== VAZIO) continue;
          candidatos.push({ x, y, h, ordem: hash2(Math.round(x), Math.round(y), semente + 91) });
        }
        percorrido += comp;
      }
    }
    /* Amostra JUSTA: primeiro escolhe as 14 por um hash independente, e só
       depois distribui os limiares por posição na fila. Ordenar pelo limiar e
       cortar em 14 guardava as de limiar mais baixo — com ~40 candidatas,
       umas 9 das 14 ficavam presentes na sala suja, em vez de 3. */
    candidatos.sort((p, q) => p.ordem - q.ordem);
    const n = Math.min(MAX_AVES, candidatos.length);
    for (let k = 0; k < n; k++) {
      const c = candidatos[k];
      this.aves.push({
        px: c.x, py: c.y, x: c.x, y: c.y, vx: 0, vy: 0,
        estado: 'ausente', t: hash2(k, 3, semente) * 5, h: c.h,
        // Quem aparece primeiro: ave com limiar baixo existe até na sala
        // mais suja; as de limiar alto só com a sala restaurada.
        limiar: (k + 0.5) / n,
        dir: c.h > 0.22 ? 1 : -1,
        fugiu: false,
      });
    }
    this._primeiro = true;
    this._idade = 0;
  }

  /**
   * O ANIMAL EXAUSTO. Todo o sofrimento do fundo fica a centenas de pixels de
   * profundidade; este fica NO PLANO DO JOGO, a 220–420 px de onde o Guardião
   * entra, pra ser visto nos primeiros segundos. Na sala suja ele está caído,
   * respirando pesado, e ergue a cabeça quando o Guardião chega perto — não
   * foge, não tem mais força pra isso. Restaurada a sala, o MESMO bicho, no
   * MESMO lugar, se levanta devagar e volta a pastar. É esse par, antes e
   * depois, que transforma troca de cor em emoção.
   *
   * Não bloqueia, não colide, não dá item. Por enquanto é só presença.
   */
  _acharFerido(terreno, area, semente, entrada) {
    const especie = FERIDO[area];
    if (!especie) return null;
    // Duas buscas: a ideal (perto da entrada, mesma altura) e, se a sala não
    // tiver chão assim, uma mais larga — senão metade das salas ficava sem.
    return this._buscarChao(terreno, entrada, especie, semente, 220, 420, 180)
      ?? this._buscarChao(terreno, entrada, especie, semente, 130, 760, 420);
  }

  _buscarChao(terreno, entrada, especie, semente, dMin, dMax, dyMax) {
    let melhor = null, nota = Infinity;
    for (const faixa of terreno.arestasSuperiores(0.9)) {
      let percorrido = 0, proximo = 20;
      for (let i = 0; i < faixa.length - 1; i++) {
        const a = faixa[i], b = faixa[i + 1];
        const comp = Math.hypot(b.x - a.x, b.y - a.y);
        while (proximo <= percorrido + comp) {
          const u = (proximo - percorrido) / (comp || 1);
          const x = lerp(a.x, b.x, u), y = lerp(a.y, b.y, u);
          proximo += 24;
          const dx = Math.abs(x - entrada.x), dy = Math.abs(y - entrada.y);
          if (dx < dMin || dx > dMax || dy > dyMax) continue;
          const cx = Math.floor(x / terreno.tile);
          const cy = Math.floor((y - terreno.tile * 0.5) / terreno.tile);
          // Chão com ar em cima e com APOIO dos dois lados do corpo.
          if (terreno.em(cx, cy) !== VAZIO) continue;
          if (!terreno.solido(Math.floor((x - 26) / terreno.tile), Math.floor((y + 4) / terreno.tile))) continue;
          if (!terreno.solido(Math.floor((x + 26) / terreno.tile), Math.floor((y + 4) / terreno.tile))) continue;
          const n = Math.abs(dx - (dMin + dMax) * 0.5) + dy * 1.5;
          if (n < nota) { nota = n; melhor = { x, y }; }
        }
        percorrido += comp;
      }
    }
    if (!melhor) return null;
    return {
      ...melhor, especie, h: hash2(Math.round(melhor.x), 5, semente),
      // Olha pra onde o jogador entrou.
      dir: entrada.x > melhor.x ? 1 : -1,
      deitado: 1, ergue: 0, iniciado: false,
    };
  }

  /**
   * @param {number} dt  tempo REAL — é apresentação, não simulação
   * @param {{centroX:number, centroY:number}} jogador
   */
  atualizar(dt, jogador, pureza) {
    const calma = calmaDaFauna(pureza);
    this._idade += dt;
    /* Um segundo de carência ao entrar: a ave pousada perto da porta levantava
       voo durante o fade da transição, com a tela preta — o jogador perdia
       justamente a fuga que ela existe pra mostrar. */
    const reage = this._idade > 1.1;
    // Suja: ~4 das 14 existem. Limpa: todas. No Coração, NENHUMA enquanto
    // ele está sujo — a área é silêncio, e a volta das aves é o sinal.
    const semVida = !confCatastrofe(this.area).bichos;
    const quantas = lerp(semVida ? 0 : 0.3, 1, calma);
    const raio = lerp(210, 80, calma);
    for (const a of this.aves) {
      a.t += dt;
      const presente = a.limiar < quantas;
      if (a.estado === 'ausente') {
        if (!presente) continue;
        // Primeira vez na sala: já está pousada.
        if (this._primeiro) { a.estado = 'pousado'; a.x = a.px; a.y = a.py; continue; }
        // Passou a existir agora (a sala está sendo restaurada com o jogador
        // dentro): CHEGA voando — é o que dá plateia à restauração.
        /* Não pousa em cima do Guardião: sem este teste, com o jogador
           parado perto do poleiro, a ave chegava, pousava, fugia e voltava a
           cada 4–8 s, em ciclo. */
        const ddx = a.px - jogador.centroX, ddy = a.py - jogador.centroY;
        const livre = ddx * ddx + ddy * ddy > (raio * 1.3) ** 2;
        if (!livre) continue;
        if (!a.fugiu) { this._chegar(a); continue; }
        // Fugiu antes: na sala limpa volta depois de um tempo; na suja, o
        // poleiro fica vazio.
        if (calma > 0.5 && a.t > lerp(4, 8, a.h)) this._chegar(a);
        continue;
      }
      if (a.estado === 'pousado') {
        const dx = a.x - jogador.centroX, dy = a.y - jogador.centroY;
        const perto = dx * dx + dy * dy < raio * raio;
        // Pânico sem motivo aparente — só na sala suja. É o nervosismo do
        // lugar, não uma reação ao jogador.
        const panico = Math.random() < 0.025 * (1 - calma) * dt;
        if (reage && (perto || panico || !presente)) this._fugir(a, dx);
        continue;
      }
      if (a.estado === 'voando') {
        a.vy -= 60 * dt;
        a.vx *= 1 + 0.4 * dt;
        a.x += a.vx * dt; a.y += a.vy * dt;
        if (a.t > 2.8) {
          a.estado = 'ausente';
          a.fugiu = true;
          a.t = 0;
        }
        continue;
      }
      if (a.estado === 'chegando') {
        const k = clamp01(a.t / 1.8);
        const e = 1 - (1 - k) * (1 - k);
        a.x = lerp(a.sx, a.px, e);
        a.y = lerp(a.sy, a.py, e) - Math.sin(k * Math.PI) * 30;
        if (k >= 1) { a.estado = 'pousado'; a.t = 0; }
      }
    }
    const f = this.ferido;
    if (f) {
      // Primeira vez: já no estado certo. Depois, se levanta devagar
      // (restauração) — o jogador tem que VER o bicho se erguer.
      const alvo = 1 - calma;
      if (!f.iniciado) { f.deitado = alvo; f.iniciado = true; }
      f.deitado = damp(f.deitado, alvo, 0.9, dt);
      const dx = jogador.centroX - f.x, dy = jogador.centroY - f.y;
      const perto = dx * dx + dy * dy < 170 * 170;
      f.ergue = damp(f.ergue, perto && f.deitado > 0.5 ? 1 : 0, perto ? 0.5 : 1.2, dt);
      if (perto && f.deitado > 0.5) f.dir = dx > 0 ? 1 : -1;
    }
    this._primeiro = false;
  }

  _fugir(a, dx) {
    a.estado = 'voando';
    a.t = 0;
    const lado = dx === 0 ? a.dir : Math.sign(dx);
    a.dir = lado;
    a.vx = lado * lerp(150, 230, a.h);
    a.vy = -lerp(170, 250, a.h);
  }

  _chegar(a) {
    a.estado = 'chegando';
    a.t = 0;
    a.dir = a.h > 0.2 ? 1 : -1;
    a.sx = a.px - a.dir * 220;
    a.sy = a.py - 180;
  }

  /** @param {boolean} reduzido  movimento reduzido: bater de asa a 1/3 */
  desenhar(ctx, tema, tempo, reduzido = false) {
    if (reduzido) tempo *= 0.33;
    const calma = calmaDaFauna(tema.pureza ?? 0);
    // Silhueta escura; na sala limpa ganha o peito na cor viva da área.
    const corpo = misturarHex(tema.primeiroPlano, tema.terreno, 0.35);
    const peito = misturarHex(corpo, tema.acento, 0.7 * calma);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const a of this.aves) {
      if (a.estado === 'ausente') continue;
      if (a.estado === 'pousado') this._pousada(ctx, a, tempo, corpo, peito);
      else this._voando(ctx, a, tempo, corpo);
    }
    ctx.restore();
    if (this.ferido) this._ferido(ctx, tema, tempo);
  }

  _ferido(ctx, tema, tempo) {
    const f = this.ferido;
    const L = 58;
    const fogo = forcaFogo(this.area, tema.pureza ?? 0);
    /* Silhueta OPACA, bem mais escura que o fundo, e só um fio de luz quente
       nas costas. Na várzea o fio é furta-cor: é o óleo cobrindo o bicho. */
    const corpo = misturarHex(tema.primeiroPlano, tema.terreno, 0.3);
    let borda;
    if (this.area === 'varzea' && f.deitado > 0.3) borda = rgba('#8fe8d8', 0.55 * f.deitado);
    else if (fogo > 0.05) borda = rgba(chamaDe(this.area).meio, 0.5);
    else borda = rgba(tema.luz, 0.45);
    ctx.save();
    // Sombra de contato: o corpo caído ENCOSTA no chão.
    const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, L * 0.75);
    g.addColorStop(0, rgba(tema.primeiroPlano, 0.45));
    g.addColorStop(1, rgba(tema.primeiroPlano, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(f.x, f.y + 1, L * 0.75, L * 0.16, 0, 0, TAU);
    ctx.fill();
    ctx.translate(f.x, f.y + 1);
    ctx.scale(f.dir * L, L);
    ctx.fillStyle = corpo;
    ctx.strokeStyle = corpo;
    /* Cabeça MEIO ERGUIDA por padrão, caindo e voltando devagar: com a cabeça
       apoiada no chão o bicho deitado virava uma placa escura — o que diz
       "veado caído" é o pescoço de pé. O balanço lento é o cansaço. */
    const cansaco = (0.5 + 0.3 * Math.sin(tempo * 0.45 + f.h * 5)) * f.deitado;
    desenharAnimal(ctx, f.especie, 0, 0, tempo, f.h, borda,
      { deitado: f.deitado, ergue: Math.max(f.ergue, cansaco) });
    ctx.restore();
  }

  /** Pousada: corpo em gota, cabeça que bica o chão de vez em quando. */
  _pousada(ctx, a, tempo, corpo, peito) {
    const s = 1.15;
    const bica = Math.max(0, Math.sin(tempo * 1.3 + a.h * 17)) ** 12;   // raro e rápido
    const pulinho = Math.max(0, Math.sin(tempo * 0.7 + a.h * 29)) ** 30 * 3;
    ctx.save();
    ctx.translate(a.x, a.y - pulinho);
    ctx.scale(a.dir * s, s);
    ctx.fillStyle = corpo;
    ctx.beginPath();
    // corpo
    ctx.ellipse(0, -4, 5, 3.4, -0.25, 0, TAU);
    // cauda
    ctx.moveTo(-3.5, -3.5); ctx.lineTo(-9, -6.5); ctx.lineTo(-8.5, -4.2); ctx.closePath();
    ctx.fill();
    // cabeça (desce pra bicar)
    const hx = 4.2, hy = -7 + bica * 5;
    ctx.beginPath();
    ctx.arc(hx, hy, 2.4, 0, TAU);
    ctx.moveTo(hx + 2, hy - 0.4); ctx.lineTo(hx + 4.6, hy + 0.4 + bica); ctx.lineTo(hx + 2, hy + 1);
    ctx.fill();
    // peito
    ctx.fillStyle = peito;
    ctx.beginPath();
    ctx.ellipse(2.2, -3.2, 2.4, 2, 0.3, 0, TAU);
    ctx.fill();
    // patas
    ctx.strokeStyle = corpo;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-0.5, -1); ctx.lineTo(-0.8, 0.5);
    ctx.moveTo(1.2, -1); ctx.lineTo(1.4, 0.5);
    ctx.stroke();
    ctx.restore();
  }

  /** Voando: asas em M batendo rápido — batida de pânico, não de planeio. */
  _voando(ctx, a, tempo, corpo) {
    const env = 7.5;
    const bat = Math.sin(tempo * 38 + a.h * 9);
    const l = bat * env * 0.6;
    ctx.save();
    // O voo acaba aos 2,8 s — muitas vezes ainda dentro do quadro, porque a
    // sala tem uma tela de largura. Some em fade, não de uma vez.
    if (a.estado === 'voando') ctx.globalAlpha = clamp01((2.8 - a.t) / 0.6);
    ctx.translate(a.x, a.y);
    ctx.strokeStyle = corpo;
    ctx.fillStyle = corpo;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-env, -l);
    ctx.quadraticCurveTo(-env * 0.4, -l * 0.2 - 2, 0, 0.5);
    ctx.quadraticCurveTo(env * 0.4, -l * 0.2 - 2, env, -l);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0.5, 3.4, 1.8, a.dir > 0 ? -0.3 : 0.3, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}
