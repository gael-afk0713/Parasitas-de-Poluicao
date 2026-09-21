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

import { TAU, lerp, clamp01, hash2, misturarHex, rgba, damp, ruido1 } from '../core/mat.js';
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
          // No CHÃO do caminho do jogador, não no alto de um pilar: acima da
          // entrada ninguém olha, e contra tronco escuro ninguém vê.
          const n = Math.abs(dx - (dMin + dMax) * 0.5) + dy * 1.5
            + (y < entrada.y - 40 ? 420 : 0);
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
      ergue: 0, iniciado: false,
      estado: 'caido', tl: 0,
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
      /* caído → levantando → de pé. Entrando numa sala já restaurada, o bicho
         já está de pé. Restaurando com o jogador dentro, ele LEVANTA na frente
         dele — é o momento que o par antes/depois existe pra mostrar. */
      if (!f.iniciado) { f.estado = calma > 0.5 ? 'dePe' : 'caido'; f.iniciado = true; }
      f.tl += dt;
      if (f.estado === 'caido' && calma > 0.5) { f.estado = 'levantando'; f.tl = 0; }
      // Fica de pé olhando pra onde acabou de se virar (pro Guardião). Sem
      // gravar a direção, a pose de pé voltava pra `dir` da entrada e o
      // bicho se espelhava num quadro, de costas pra quem estava do lado.
      if (f.estado === 'levantando' && f.tl > 2.6) { f.estado = 'dePe'; f.tl = 0; f.dir = f.olhaPara; }
      const dx = jogador.centroX - f.x, dy = jogador.centroY - f.y;
      const perto = dx * dx + dy * dy < 170 * 170;
      // Caído, ele só consegue erguer um pouco a cabeça quando alguém chega.
      f.ergue = damp(f.ergue, perto && f.estado === 'caido' ? 1 : 0, perto ? 0.6 : 1.4, dt);
      f.olhaPara = dx > 0 ? 1 : -1;
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
    const L = 64;
    const fogo = forcaFogo(this.area, tema.pureza ?? 0);
    const oleado = this.area === 'varzea';
    const pose = this._poseFerido(f, tempo);

    /* PELAGEM, não silhueta: preto chapado sumia contra a terra escura do
       plano de jogo e o bicho lia como tronco caído. Marrom-acinzentado
       tocado pela luz da área — mais claro que o chão, bem mais escuro que o
       Guardião, longe do preto dos parasitas.
       REGRA: preto + olho claro + contorno claro é a linguagem dos
       INIMIGOS. Nenhum bicho junta os três. A capivara oleada era preta
       inteira, de olho branco e fio de brilho — lia como mais um parasita.
       Agora ela é marrom com o ÓLEO POR CIMA (dorso encharcado, barriga
       ainda marrom), o brilho do óleo é um fio verde-azulado, e o olho do
       bicho caído fica FECHADO. */
    const pelo = misturarHex(misturarHex(tema.terreno, '#7a5a44', 0.55), tema.luz, 0.12);
    const oleo = oleado ? pose.sujo : 0;
    const corpo = pelo;
    let borda;
    if (f.estado === 'dePe') borda = rgba(tema.luz, 0.6);            // luz dourada no dorso
    // Oleada, sem fio de luz: contorno aceso é linguagem de inimigo.
    else if (oleo > 0.3) borda = null;
    else if (fogo > 0.05) borda = rgba(chamaDe(this.area).meio, 0.55); // lado do fogo
    else borda = rgba(tema.luz, 0.45);

    ctx.save();
    /* Poça de óleo IRREGULAR (um disco com borda completa lia como placa de
       pressão) e o furta-cor em dois ou três arcos curtos, como reflexo
       molhado — nunca contornando a poça inteira. */
    if (oleo > 0.05) {
      const N = 9, rx = L * 0.8, ry = L * 0.1;
      ctx.fillStyle = rgba('#0d0b0a', 0.7 * oleo);
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const a = (i % N) / N * TAU;
        const k = lerp(0.72, 1.28, hash2(i % N, f.h * 97 | 0, 5));
        const px = f.x + Math.cos(a) * rx * k, py = f.y + 2 + Math.sin(a) * ry * k;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';
      const cores = ['#ff4fd8', '#46e0d0', '#ffe45a'];
      for (let i = 0; i < 3; i++) {
        const a0 = lerp(0.3, 2.6, i / 2) + hash2(i, 3, 7) * 0.4;
        ctx.strokeStyle = rgba(cores[i], 0.4 * oleo);
        ctx.beginPath();
        ctx.ellipse(f.x, f.y + 2, rx * 0.8, ry * 0.8, 0, a0, a0 + 0.5);
        ctx.stroke();
      }
    }
    // De pé ainda sujo, o óleo PINGA da barriga.
    if (oleo > 0.05 && pose.deitado < 0.5) {
      ctx.fillStyle = rgba('#120e0c', 0.85 * oleo);
      for (let i = 0; i < 4; i++) {
        const u = (tempo * 0.8 + i / 4 + f.h) % 1;
        const dx = (i - 1.5) * L * 0.16 * pose.dir;
        ctx.beginPath();
        ctx.ellipse(f.x + dx, lerp(f.y - L * 0.2, f.y, u), 1.5, 3, 0, 0, TAU);
        ctx.fill();
      }
    }
    // Sombra de contato: o corpo caído ENCOSTA no chão.
    const gs = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, L * 0.75);
    gs.addColorStop(0, rgba(tema.primeiroPlano, 0.45));
    gs.addColorStop(1, rgba(tema.primeiroPlano, 0));
    ctx.fillStyle = gs;
    ctx.beginPath();
    ctx.ellipse(f.x, f.y + 1, L * 0.75, L * 0.16, 0, 0, TAU);
    ctx.fill();

    // Fio de fumaça saindo do pelo chamuscado — só enquanto está caído.
    if (pose.sujo > 0.05 && !oleado) {
      for (let i = 0; i < 4; i++) {
        const u = ((tempo * 0.32 + i / 4) % 1);
        const sx = f.x - f.dir * L * 0.25 + Math.sin(tempo * 1.1 + i * 2) * 5 * u;
        const sy = f.y - L * 0.2 - u * L * 1.1;
        ctx.fillStyle = rgba(tema.particula, 0.22 * (1 - u) * pose.sujo);
        ctx.beginPath();
        ctx.arc(sx, sy, 2.5 + u * 9, 0, TAU);
        ctx.fill();
      }
    }
    // Cinza saindo do corpo enquanto ele se sacode.
    if (pose.cinza > 0.02) {
      ctx.fillStyle = rgba(misturarHex(tema.particula, '#a8988a', 0.5), 0.8 * pose.cinza);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU + f.h * 9;
        const r = L * (0.3 + (1 - pose.cinza) * 0.7);
        ctx.beginPath();
        ctx.arc(f.x + Math.cos(a) * r, f.y - L * 0.35 + Math.sin(a) * r * 0.5, 1.6, 0, TAU);
        ctx.fill();
      }
    }

    ctx.translate(f.x, f.y + 1);
    ctx.scale(pose.dir * L, L);
    ctx.fillStyle = corpo;
    ctx.strokeStyle = corpo;
    desenharAnimal(ctx, f.especie, 0, 0, tempo, f.h, borda, {
      deitado: pose.deitado, deitadoTras: pose.deitadoTras, deLado: pose.deLado,
      ergue: pose.ergue, sacode: pose.sacode,
      peito: pose.peito, fuligem: pose.sujo * (oleado ? 0 : 1), oleo,
      // Caído, de olho fechado; abre quando ergue a cabeça pra quem chega.
      olhoFechado: f.estado === 'caido' && f.ergue < 0.3,
      olho: f.estado === 'caido' && f.ergue < 0.3 ? rgba('#2a1d15', 0.9) : rgba('#f6f2ea', 0.9),
      contorno: rgba(tema.primeiroPlano, 0.75),
    });
    ctx.restore();
  }

  /**
   * A pose do bicho em cada momento. Caído: de lado, respiração IRREGULAR —
   * duas ou três arfadas e uma pausa longa; é a pausa que assusta. Levantando
   * (2,6 s): rola pro peito e ergue a cabeça, apoia as patas, fica de pé, se
   * sacode (a cinza sai do corpo), vira pro Guardião. De pé: alerta, olhando,
   * e de tempos em tempos baixa a cabeça pra pastar.
   */
  _poseFerido(f, tempo) {
    const suave = (a, b, t) => { const k = clamp01((t - a) / (b - a)); return k * k * (3 - 2 * k); };
    if (f.estado === 'caido') {
      const T = 4.6 + ruido1(tempo * 0.07 + f.h * 13, 5) * 2.4;
      const u = ((tempo + f.h * 11) % T) / T;
      const arfa = u < 0.45 ? Math.max(0, Math.sin((u / 0.45) * Math.PI * 3)) : 0;
      return {
        deitado: 1, deLado: 1 - f.ergue * 0.4, ergue: f.ergue * 0.45,
        peito: 1 + arfa * 0.07, sacode: 0, sujo: 1, cinza: 0, dir: f.dir,
      };
    }
    if (f.estado === 'levantando') {
      const t = f.tl;
      // Rola pro peito; a TRASEIRA sobe primeiro (joelhos da frente ainda no
      // chão); depois a frente; sacode; vira pro Guardião.
      const deLado = 1 - suave(0, 0.6, t);
      const deitadoTras = 1 - suave(0.6, 1.05, t);
      // A frente AJOELHA enquanto a traseira sobe (peito fora do chão), e só
      // depois estica.
      const deitado = 1 - 0.45 * suave(0.6, 1.05, t) - 0.55 * suave(1.05, 1.5, t);
      const agita = t > 1.5 && t < 1.95 ? (1 - (t - 1.5) / 0.45) : 0;
      return {
        deitado, deitadoTras, deLado, ergue: suave(0.1, 0.7, t),
        peito: 1, sacode: Math.sin(t * 46) * 0.035 * agita,
        sujo: 1 - suave(1.5, 1.95, t), cinza: agita, dir: t > 1.95 ? f.olhaPara : f.dir,
      };
    }
    // De pé: alterna olhar (cabeça alta) e pastar.
    const olhando = (Math.sin(tempo * 0.38 + f.h * 7) + 1) * 0.5;
    return {
      deitado: 0, deLado: 0, ergue: suave(0.35, 0.65, olhando),
      peito: 1, sacode: 0, sujo: 0, cinza: 0, dir: f.dir,
    };
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
