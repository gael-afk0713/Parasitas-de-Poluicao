/* =========================================================================
   fase2/ui/hud.js — HUD desenhado no canvas
   -------------------------------------------------------------------------
   Desenhado no canvas, não em DOM: o HUD precisa reagir ao TEMA da área
   (ele muda de cor junto com o mundo restaurado) e a CSS não tem acesso ao
   tema interpolado por frame.

   Princípio: o HUD é o mais discreto possível. Vida sempre visível; nome de
   área e habilidade nova aparecem e SOMEM. Nada de barra permanente de
   experiência, minimapa ou contador — em jogo de atmosfera, HUD é ruído.

   O RAMO. A vida era uma fila de máscaras no canto — a assinatura visual do
   Hollow Knight, e o Guardião não é um cavaleiro: é a floresta andando. Agora
   ela é um galho que brota da borda da tela, uma folha por ponto de vida:
     · levar dano = ver a folha se soltar e cair, secando no caminho;
     · curar = ver a folha se abrir de novo no mesmo nó;
     · a fumaça tóxica acinzenta as folhas enquanto sufoca;
     · na ponta, um broto se enche de luz a cada fragmento — no quarto ele
       abre e vira uma folha nova (vida máxima +1).
   Embaixo do galho, só quando importa, uma linha diz quantos parasitas ainda
   seguram a semente da área.

   Tipografia: Archivo, em caixa normal. O estêncil é a voz da empresa (menu,
   Fase 1) e some aqui — a empresa caiu.
   ========================================================================= */

import {
  TAU, clamp, clamp01, lerp, damp, rgba, misturarHex, easeOutCubic, easeOutBack,
} from '../core/mat.js';
import { nomeArea } from '../render/paleta.js';
import { FRAGMENTOS_POR_VIDA } from '../entidades/catalogo.js';

/* -------------------------------------------------------------- A TINTA ---
   Contraste é função de um PAR FIXO; identidade é função de um TINTE. O HUD
   já dependeu das cores da estrutura do tema e oscilava entre invisível (1,17:1
   nas Raízes poluídas) e fluorescente. Estrutura e texto saem de `PAPEL`/
   `BREU` (os mesmos `--paper`/`--soot` do style.css) e o tema entra só como
   matiz e acento.
   ------------------------------------------------------------------------ */
const PAPEL = '#efe8d6';
const BREU = '#0b0906';
const FONTE = '"Archivo", system-ui, sans-serif';

/** Tinta do HUD: valor fixo (legibilidade), matiz do tema (identidade). */
const tinta = (tema, nivel, matiz = 0.22) =>
  rgba(misturarHex(PAPEL, tema.luz, matiz), nivel);

/** Placa/sombra: sempre o mesmo breu, pra o desenho ter sobre o que assentar. */
const placa = (nivel) => rgba(BREU, nivel);

/* Cores do ramo — fixas pelo mesmo motivo do PAPEL. O tema só tinge. */
const FOLHA = '#a3d483';
const NERVURA = '#46723a';
const SECA = '#a27a45';     // a folha que cai seca no caminho
const CINZA = '#6f6a62';    // a folha sufocada pela fumaça
const CASCA = '#7d6650';

/** Quanto um aviso merece interromper. `sussurro` vai pra outro canal. */
const PESO = { sussurro: 0, normal: 1, marco: 2 };
/** Segundos da saída de um aviso (e do encurtamento quando há fila). */
const SAIDA = 0.6;
/** Segundos que uma folha leva pra se abrir. */
const DUR_BROTAR = 0.5;

const NOMES_HABILIDADE = {
  saltoDuplo: 'Salto duplo',
  investida: 'Investida',
  canto: 'Canto da raiz',
  parede: 'Agarre',
  planeio: 'Planeio',
};

const DICAS_HABILIDADE = {
  saltoDuplo: 'pule de novo no ar',
  investida: 'Shift para avançar rápido',
  canto: 'E para restaurar o que está perto',
  parede: 'segure contra a parede',
  planeio: 'segure pular enquanto cai',
};

export class Hud {
  constructor(elemento, mundo) {
    this.el = elemento;
    this.mundo = mundo;
    this.ctx = elemento?.getContext ? elemento.getContext('2d') : null;

    /* Dois canais de aviso. Antes havia um só, e qualquer `anunciar` apagava
       o que estava na tela: pegar um fragmento logo depois de destravar uma
       habilidade sumia com o nome da habilidade. Agora o título (marco/normal)
       mora no alto e o sussurro na base; dentro de cada canal, o mais
       importante passa na frente e o resto espera na fila. */
    this._canais = { topo: { atual: null, fila: [] }, base: { atual: null, fila: [] } };
    this._dpr = 1;
    this._t = 0;
    /** Ligado por main.js quando o sistema pede movimento reduzido. */
    this.movimentoReduzido = false;

    // --- o ramo
    this._vidaVista = null;     // null = primeiro quadro: o que já existe não anima
    this._fragVistos = 0;
    this._caindo = [];          // folhas soltas no ar
    this._brotando = new Map(); // índice da folha -> tempo desde que começou a abrir
    this._tremor = 0;
    this._brilhoBroto = 0;

    // --- a linha da área
    this._areaT = 0;
    this._areaAlfa = 0;
    this._areaTexto = null;
    this._parasitasVistos = null;

    /* MARGEM SEGURA. O canvas cobre a tela inteira, então o recorte do
       celular (notch, cantos arredondados) comia o galho no canto. CSS sabe
       o tamanho dessa margem (`env()`), o canvas não: uma sonda invisível
       com padding em env() traduz isso em pixels. */
    this.sa = { t: 0, r: 0, b: 0, l: 0 };
    this._toque = false;
    this._sonda = null;
    if (typeof document !== 'undefined' && document.body) {
      const s = document.createElement('div');
      s.setAttribute('aria-hidden', 'true');
      s.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;'
        + 'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) '
        + 'env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);';
      document.body.appendChild(s);
      this._sonda = s;
      // Canvas não dispara o carregamento da fonte sozinho.
      document.fonts?.load?.('600 14px Archivo')?.catch?.(() => {});
    }
  }

  /* Todo o HUD era posicionado em px fixos, então numa janela de 2560 px ele
     tinha metade do tamanho relativo que tem em 1280. Um fator só, com teto e
     piso pra não virar cartaz nem sumir. */
  get escala() { return clamp((this.larguraCss || 1280) / 1280, 0.85, 1.4); }

  /** O aviso mais à frente — o tutor espera ele passar antes de falar. */
  get anuncio() {
    const { topo, base } = this._canais;
    return topo.atual || base.atual || topo.fila[0] || base.fila[0] || null;
  }

  anunciarSala(sala, mundo) {
    // Entrar numa sala reapresenta a linha da área por alguns segundos.
    this.mostrarArea(4.5);
    if (!sala.titulo) return;
    /* O título de sala-marco É o nome da área, e a área muda de nome quando
       é restaurada. Anunciar "A Clareira Queimada" numa clareira já coberta
       de verde desmente o que está na tela. */
    // A pureza vem da SALA, não de `mundo.tema`: no instante em que a sala é
    // anunciada o tema ainda é o da sala anterior, e entrar numa área suja
    // logo depois de uma restaurada anunciava o nome restaurado.
    const pureza = mundo?.purezaDaSala?.(sala.id) ?? 0;
    const nome = nomeArea(sala.area, 0);
    const titulo = sala.titulo === nome ? nomeArea(sala.area, pureza) : sala.titulo;
    // Chave 'sala': atravessar duas salas depressa não enfileira dois nomes.
    this.anunciar(titulo, null, 3.4, 'normal', 'sala');
  }

  anunciarHabilidade(id) {
    this.anunciar(NOMES_HABILIDADE[id] || id, DICAS_HABILIDADE[id] || '', 4.2, 'marco');
  }

  /**
   * @param {'marco'|'normal'|'sussurro'} peso  quanto isto merece interromper.
   *   `marco` = habilidade, chefe morto, semente. `normal` = nome de sala, dica.
   *   `sussurro` = fragmento, portão trancado, lore — vai pra outro canal.
   * @param {string|null} chave  avisos com a mesma chave se substituem em vez
   *   de enfileirar (o nome de sala só vale enquanto se está nela).
   */
  anunciar(titulo, sub = null, dur = 3, peso = 'normal', chave = null) {
    const novo = { titulo, sub, t: 0, dur, peso, chave };
    const canal = this._canais[peso === 'sussurro' ? 'base' : 'topo'];
    const atual = canal.atual;
    if (chave) canal.fila = canal.fila.filter((a) => a.chave !== chave);
    if (!atual || (chave && atual.chave === chave)) { canal.atual = novo; return; }

    const igual = (a) => a.titulo === titulo && a.sub === sub;
    // O mesmo aviso de novo (a semente recusando a cada 3 s): só renova.
    if (igual(atual)) { atual.t = Math.min(atual.t, 0.5); atual.dur = Math.max(atual.dur, dur); return; }
    if (canal.fila.some(igual)) return;

    if ((PESO[peso] ?? 1) > (PESO[atual.peso] ?? 1)) {
      // Passa na frente; o que estava na tela volta pra fila se ainda tinha
      // o que dizer.
      if (atual.dur - atual.t > 1) canal.fila.unshift({ ...atual, t: 0 });
      canal.atual = novo;
    } else {
      canal.fila.push(novo);
    }
    // Fila curta: se encher, sai primeiro o de menor peso.
    while (canal.fila.length > 3) {
      let pior = 0;
      for (let i = 1; i < canal.fila.length; i++) {
        if ((PESO[canal.fila[i].peso] ?? 1) < (PESO[canal.fila[pior].peso] ?? 1)) pior = i;
      }
      canal.fila.splice(pior, 1);
    }
  }

  /** Liga a linha da área por alguns segundos (entrar numa sala, a semente recusar). */
  mostrarArea(seg = 4) { this._areaT = Math.max(this._areaT, seg); }

  _ajustar() {
    const el = this.el;
    if (!el) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = el.getBoundingClientRect();
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (el.width !== w || el.height !== h) {
      el.width = w; el.height = h;
      this._lerMargens();   // girar o celular muda a margem segura e o tamanho juntos
    }
    this._dpr = dpr;
    this.larguraCss = r.width;
    this.alturaCss = r.height;
    return w > 0 && h > 0;
  }

  _lerMargens() {
    this._toque = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    if (!this._sonda) return;
    const cs = getComputedStyle(this._sonda);
    this.sa = {
      t: parseFloat(cs.paddingTop) || 0,
      r: parseFloat(cs.paddingRight) || 0,
      b: parseFloat(cs.paddingBottom) || 0,
      l: parseFloat(cs.paddingLeft) || 0,
    };
  }

  /**
   * @param {boolean} bloqueado  pausa, mapa ou tela de abertura. O relógio do
   *   HUD para junto: antes os avisos venciam enquanto ninguém olhava — o nome
   *   da primeira sala expirava atrás da tela de abertura.
   */
  desenhar(dt, tema, bloqueado = false) {
    if (!this.ctx || !this._ajustar()) return;
    const ctx = this.ctx;
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, this.larguraCss, this.alturaCss);

    const d = bloqueado ? 0 : Math.min(dt, 0.1);
    this._t += d;
    this._ramo(ctx, tema, d);
    this._linhaDaArea(ctx, tema, d);
    this._barraChefe(ctx, tema, d);
    this._avancarCanal(this._canais.topo, d);
    this._avancarCanal(this._canais.base, d);
    this._titulo(ctx, tema);
    this._sussurro(ctx, tema);
  }

  _avancarCanal(canal, dt) {
    const a = canal.atual;
    if (!a) { if (canal.fila.length) canal.atual = canal.fila.shift(); return; }
    a.t += dt;
    // Tem gente esperando: depois de lido, quem está na tela sai mais cedo.
    if (canal.fila.length && a.t > 1.4 && a.dur - a.t > SAIDA) a.dur = a.t + SAIDA;
    if (a.t >= a.dur) canal.atual = canal.fila.shift() ?? null;
  }

  /* ================================================================ RAMO == */

  _ramo(ctx, tema, dt) {
    const j = this.mundo.jogador;
    const k = this.escala;
    const rm = this.movimentoReduzido;
    const max = clamp(j.vidaMax | 0, 1, 40);
    const vida = clamp(Math.ceil(j.vida), 0, max);
    const frag = this.mundo.fragmentosColetados?.size ?? 0;

    /* Geometria. O galho sobe um pouco rumo à ponta e ondula de leve; as
       folhas alternam em cima e embaixo, como num galho de verdade. Com
       muita vida o passo encolhe em vez de o galho atravessar a tela. */
    const passo = Math.max(10 * k, Math.min(27 * k, (380 * k) / max));
    const ox = this.sa.l + 24 * k, oy = this.sa.t + 36 * k;
    const xNo = (i) => ox + 12 * k + i * passo;
    const xBroto = xNo(max) - passo * 0.2;
    const yEm = (x) => oy - (x - ox) * 0.045 + Math.sin((x - ox) * 0.05) * 1.6 * k;
    const angDe = (i) => (i % 2 === 0 ? -0.95 : 0.78);

    // --- o que mudou desde o último quadro
    if (this._vidaVista == null) { this._vidaVista = vida; this._fragVistos = frag; }
    if (vida < this._vidaVista) {
      /* A folha se solta NO QUADRO DO GOLPE. A máscara antiga só estourava
         depois que uma vida "exibida" amortecida alcançava a real — quase um
         segundo de atraso, já com o jogador olhando pra outra coisa. */
      for (let i = vida; i < Math.min(this._vidaVista, max); i++) {
        const x = xNo(i);
        this._soltarFolha(x, yEm(x), angDe(i), k, this._corFolha(tema, j));
        this._brotando.delete(i);
      }
      this._tremor = 1;
    } else if (vida > this._vidaVista) {
      // Curou ou renasceu: as folhas se abrem, em cascata quando são várias.
      const n = vida - this._vidaVista;
      for (let i = this._vidaVista; i < vida; i++) {
        this._brotando.set(i, n > 1 ? -(i - this._vidaVista) * 0.07 : 0);
      }
    }
    this._vidaVista = vida;
    if (frag > this._fragVistos) this._brilhoBroto = 1;
    this._fragVistos = frag;

    this._tremor = Math.max(0, this._tremor - dt * 2.8);
    this._brilhoBroto = Math.max(0, this._brilhoBroto - dt * 1.3);
    for (const [i, t] of this._brotando) {
      if (i >= vida) { this._brotando.delete(i); continue; }
      const nt = t + dt;
      if (nt >= DUR_BROTAR) this._brotando.delete(i); else this._brotando.set(i, nt);
    }

    ctx.save();
    if (this._tremor > 0 && !rm) {
      ctx.translate(Math.sin(this._tremor * 40) * this._tremor * 2.2 * k, 0);
    }
    /* Sombra curta e macia: lê sobre o céu claro das salas restauradas e não
       aparece sobre o escuro das sujas. */
    ctx.shadowColor = placa(0.6);
    ctx.shadowBlur = 5 * k;
    ctx.shadowOffsetY = 1 * k;

    this._galho(ctx, tema, k, ox, xBroto, yEm);

    const cor = this._corFolha(tema, j);
    for (let i = 0; i < max; i++) {
      const x = xNo(i), y = yEm(x);
      let ang = angDe(i);
      if (!rm) {
        ang += Math.sin(this._t * 1.3 + i * 0.9) * 0.035;
        // A última folha treme: está segura por um fio.
        if (vida === 1 && i === 0 && max > 1) ang += Math.sin(this._t * 7) * 0.11;
      }
      if (i >= vida) { this._vaga(ctx, tema, x, y, angDe(i), k); continue; }
      const tb = this._brotando.get(i);
      if (tb == null) { this._folha(ctx, x, y, ang, k, cor, 1); continue; }
      if (tb < 0) { this._vaga(ctx, tema, x, y, angDe(i), k); continue; }
      const p = clamp01(tb / DUR_BROTAR);
      if (rm) {
        // Sem desenrolar: a folha só acende no lugar.
        this._vaga(ctx, tema, x, y, angDe(i), k);
        this._folha(ctx, x, y, ang, k, cor, p);
      } else {
        const lado = i % 2 === 0 ? -1 : 1;
        this._folha(ctx, x, y, ang + (1 - easeOutCubic(p)) * lado * 0.9, k * Math.max(0.05, easeOutBack(p)), cor, 1);
      }
    }
    this._broto(ctx, tema, k, xBroto, yEm(xBroto), frag);
    ctx.restore();

    this._folhasCaindo(ctx, dt, k);
  }

  /** Verde vivo tingido pelo tema; a fumaça puxa pro cinza conforme sufoca. */
  _corFolha(tema, j) {
    const viva = misturarHex(FOLHA, tema.luz, 0.12);
    return misturarHex(viva, CINZA, clamp01(j.sufoco ?? 0) * 0.85);
  }

  _galho(ctx, tema, k, ox, xFim, yEm) {
    // Nasce FORA da tela: o galho vem da borda, não flutua no canto.
    const x0 = -8 * k;
    const larg = (x) => lerp(5.8 * k, 2 * k, clamp01((x - ox) / Math.max(1, xFim - ox)));
    const N = 16;
    const pts = [];
    for (let s = 0; s <= N; s++) { const x = lerp(x0, xFim, s / N); pts.push([x, yEm(x)]); }
    ctx.beginPath();
    for (let n = 0; n < pts.length; n++) {
      const [x, y] = pts[n];
      if (n === 0) ctx.moveTo(x, y - larg(x) / 2); else ctx.lineTo(x, y - larg(x) / 2);
    }
    for (let n = pts.length - 1; n >= 0; n--) {
      const [x, y] = pts[n];
      ctx.lineTo(x, y + larg(x) / 2);
    }
    ctx.closePath();
    ctx.fillStyle = misturarHex(CASCA, tema.luz, 0.12);
    ctx.fill();
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 1;
    ctx.strokeStyle = placa(0.5);
    ctx.stroke();
    // Um fio de luz no dorso da casca: dá volume sem contorno pesado.
    ctx.beginPath();
    for (let n = 0; n < pts.length; n++) {
      const [x, y] = pts[n];
      const yy = y - larg(x) * 0.18;
      if (n === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
    }
    ctx.strokeStyle = rgba(misturarHex(CASCA, PAPEL, 0.45), 0.55);
    ctx.lineWidth = Math.max(0.8, 0.9 * k);
    ctx.stroke();
    ctx.restore();
  }

  /** Uma folha: pecíolo, lâmina e nervura. `s` é a escala (k × crescimento). */
  _folha(ctx, x, y, ang, s, cor, alfa = 1) {
    if (alfa <= 0.01) return;
    const L = 17 * s, W = 7.2 * s, pec = 3.2 * s;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.globalAlpha *= alfa;
    ctx.strokeStyle = NERVURA;
    ctx.lineWidth = Math.max(1, 1.2 * s);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(pec + 0.5, 0); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pec, 0);
    ctx.quadraticCurveTo(pec + L * 0.42, -W * 1.05, pec + L, 0);
    ctx.quadraticCurveTo(pec + L * 0.5, W * 0.95, pec, 0);
    ctx.closePath();
    ctx.fillStyle = cor;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = Math.max(0.8, 0.9 * s);
    ctx.strokeStyle = placa(0.45);
    ctx.stroke();
    ctx.strokeStyle = rgba(NERVURA, 0.8);
    ctx.lineWidth = Math.max(0.6, 0.75 * s);
    ctx.beginPath(); ctx.moveTo(pec + L * 0.06, 0); ctx.lineTo(pec + L * 0.8, -W * 0.06); ctx.stroke();
    ctx.restore();
  }

  /** O lugar de uma folha perdida: o toco do pecíolo e o contorno do que havia.
   *  Dá pra ver quantas folhas se TEM e quantas se PERDEU — é o dado do combate. */
  _vaga(ctx, tema, x, y, ang, k) {
    const L = 17 * k, W = 7.2 * k, pec = 3.2 * k;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = misturarHex(CASCA, PAPEL, 0.15);
    ctx.lineWidth = 1.2 * k;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(pec * 0.8, 0); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pec, 0);
    ctx.quadraticCurveTo(pec + L * 0.42, -W * 1.05, pec + L, 0);
    ctx.quadraticCurveTo(pec + L * 0.5, W * 0.95, pec, 0);
    ctx.closePath();
    ctx.fillStyle = placa(0.4);
    ctx.fill();
    ctx.strokeStyle = tinta(tema, 0.4);
    ctx.lineWidth = Math.max(0.8, 1 * k);
    ctx.stroke();
    ctx.restore();
  }

  /** O broto da ponta: enche de luz da base pra ponta, um quarto por fragmento. */
  _broto(ctx, tema, k, x, y, frag) {
    const n = FRAGMENTOS_POR_VIDA;
    const cheios = frag % n;
    const L = 13.5 * k, W = 5.4 * k;
    const gota = () => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(L * 0.1, -W * 1.3, L * 0.75, -W * 0.9, L, 0);
      ctx.bezierCurveTo(L * 0.75, W * 0.9, L * 0.1, W * 1.3, 0, 0);
      ctx.closePath();
    };
    const luz = misturarHex(tema.acento, PAPEL, 0.35);

    if (this._brilhoBroto > 0) {
      const r = 24 * k;
      const g = ctx.createRadialGradient(x + 4 * k, y - 3 * k, 0, x + 4 * k, y - 3 * k, r);
      g.addColorStop(0, rgba(luz, 0.6 * this._brilhoBroto));
      g.addColorStop(1, rgba(luz, 0));
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = g;
      ctx.fillRect(x + 4 * k - r, y - 3 * k - r, r * 2, r * 2);
      ctx.restore();
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.55);
    gota();
    ctx.fillStyle = placa(0.6);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.save();
    gota();
    ctx.clip();
    if (cheios > 0) {
      ctx.fillStyle = rgba(luz, 0.95);
      ctx.fillRect(0, -W * 2, L * (cheios / n), W * 4);
    }
    // As divisas dos quartos: lê "faltam dois" sem número nenhum.
    ctx.strokeStyle = placa(0.55);
    ctx.lineWidth = Math.max(0.7, 0.8 * k);
    for (let q = 1; q < n; q++) {
      ctx.beginPath(); ctx.moveTo((L * q) / n, -W * 2); ctx.lineTo((L * q) / n, W * 2); ctx.stroke();
    }
    ctx.restore();
    gota();
    ctx.lineWidth = Math.max(0.9, 1.1 * k);
    ctx.strokeStyle = tinta(tema, 0.72);
    ctx.stroke();
    ctx.restore();
  }

  _soltarFolha(x, y, ang, k, cor) {
    this._caindo.push({
      x, y, ang, t: 0, cor,
      vx: (6 + Math.random() * 14) * k,
      vy: (-16 - Math.random() * 14) * k,
      va: (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 2.5),
      fase: Math.random() * TAU,
    });
    if (this._caindo.length > 24) this._caindo.shift();
  }

  /** A folha perdida cai balançando e seca no caminho. Com movimento reduzido
   *  ela só apaga no lugar. */
  _folhasCaindo(ctx, dt, k) {
    if (!this._caindo.length) return;
    const rm = this.movimentoReduzido;
    const dur = rm ? 0.35 : 1.4;
    ctx.save();
    ctx.shadowColor = placa(0.5);
    ctx.shadowBlur = 4 * k;
    for (const f of this._caindo) {
      f.t += dt;
      if (!rm) {
        f.vy += 150 * k * dt;
        f.vx *= Math.pow(0.4, dt);
        f.x += (f.vx + Math.sin(f.t * 5 + f.fase) * 16 * k) * dt;
        f.y += f.vy * dt;
        f.ang += f.va * dt;
      }
      const p = clamp01(f.t / dur);
      this._folha(ctx, f.x, f.y, f.ang, k, misturarHex(f.cor, SECA, Math.min(1, p * 1.5)), 1 - p * p);
    }
    ctx.restore();
    this._caindo = this._caindo.filter((f) => f.t < dur);
  }

  /* ========================================================= LINHA DA ÁREA == */

  /**
   * Quantos parasitas ainda seguram a semente da área. Aparece ao entrar numa
   * sala, quando o número muda e quando a semente recusa — e some. Fica fixa
   * só quando a área está limpa e a semente ainda não foi colhida, porque aí
   * ela é uma instrução: vá buscar.
   */
  _linhaDaArea(ctx, tema, dt) {
    const m = this.mundo;
    const area = m.sala?.area;
    if (!area) return;
    const faltam = m.parasitasVivosNaArea?.(area) ?? 0;
    const semente = m.sementeDaArea?.(area) ?? null;
    if (this._parasitasVistos != null && faltam !== this._parasitasVistos) this.mostrarArea(3.5);
    this._parasitasVistos = faltam;

    let texto = null, livre = false;
    if (semente && !semente.colhida) {
      if (faltam > 0) texto = faltam === 1 ? '1 parasita segura a semente' : `${faltam} parasitas seguram a semente`;
      else { texto = 'A semente da área está livre'; livre = true; }
    } else if (faltam > 0) {
      texto = faltam === 1 ? '1 parasita nesta área' : `${faltam} parasitas nesta área`;
    }

    this._areaT = Math.max(0, this._areaT - dt);
    const alvo = texto && (livre || this._areaT > 0) ? 1 : 0;
    this._areaAlfa = alvo > this._areaAlfa
      ? Math.min(1, this._areaAlfa + dt / 0.3)
      : Math.max(0, this._areaAlfa - dt / 0.7);
    if (texto) this._areaTexto = { texto, livre };
    if (this._areaAlfa <= 0.01 || !this._areaTexto) return;

    const k = this.escala;
    const x = this.sa.l + 24 * k, y = this.sa.t + 36 * k + 36 * k;
    ctx.save();
    ctx.globalAlpha = this._areaAlfa;
    ctx.shadowColor = placa(0.75);
    ctx.shadowBlur = 5 * k;
    ctx.font = `500 ${Math.round(13 * k)}px ${FONTE}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const { texto: tx, livre: lv } = this._areaTexto;
    // O ponto à esquerda é o mesmo do mapa: um parasita vivo, ou a semente.
    ctx.fillStyle = lv
      ? rgba(misturarHex(tema.acento, PAPEL, 0.3), 1)
      : rgba(misturarHex(tema.particula, '#ffffff', 0.35), 0.95);
    ctx.beginPath();
    ctx.arc(x + 3 * k, y, (lv ? 3.4 : 2.8) * k, 0, TAU);
    ctx.fill();
    ctx.fillStyle = lv ? rgba(misturarHex(tema.acento, PAPEL, 0.45), 1) : tinta(tema, 0.88);
    ctx.fillText(tx, x + 12 * k, y + 0.5);
    ctx.restore();
  }

  /* ========================================================= BARRA DO CHEFE == */

  /**
   * Barra de vida do chefe. Aparece sozinha quando há um chefe na sala e some
   * quando ele morre — sem HUD permanente.
   *
   * Duas camadas de barra: a da frente cai na hora e a de trás cai com atraso
   * de meio segundo, deixando um rastro claro. É como o jogador VÊ quanto dano
   * um golpe fez, o que é a informação que ele precisa para decidir se o
   * padrão que arriscou valeu a pena.
   */
  _barraChefe(ctx, tema, dt) {
    const chefe = this.mundo.entidades.find((e) => e.ehChefe && !e.morta);
    if (chefe) {
      this._chefeVisivel = chefe;
      this._chefeAlfa = Math.min(1, (this._chefeAlfa ?? 0) + dt * 1.6);
      const alvo = Math.max(0, chefe.fracaoVida);
      this._chefeFracao = alvo;
      // Rastro: acompanha para BAIXO devagar, mas acompanha para cima na hora
      // (transição de fase pode curar, e barra que sobe devagar confunde).
      this._chefeRastro = this._chefeRastro == null ? alvo
        : (alvo > this._chefeRastro ? alvo : damp(this._chefeRastro, alvo, 0.35, dt));
    } else {
      this._chefeAlfa = Math.max(0, (this._chefeAlfa ?? 0) - dt * 2.2);
      if (this._chefeAlfa <= 0) { this._chefeVisivel = null; this._chefeRastro = null; return; }
    }
    const alfa = this._chefeAlfa ?? 0;
    if (alfa <= 0.01 || !this._chefeVisivel) return;

    // Barra fina e larga lê como acabamento; barra grossa com moldura de 1 px
    // lê como <progress> de HTML, que era exatamente o problema.
    const w = Math.min(this.larguraCss * 0.44, 430);
    const x = (this.larguraCss - w) / 2;
    /* No toque a base da tela é dos polegares (os botões cobriam a barra);
       lá ela sobe pro alto. */
    const y = this._toque
      ? this.sa.t + 40
      : this.alturaCss - this.sa.b - Math.max(48, this.alturaCss * 0.085);
    this._yChefe = y;
    const h = 4;

    ctx.save();
    ctx.globalAlpha = alfa;

    ctx.font = `600 13px ${FONTE}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = placa(0.7);
    ctx.shadowBlur = 4;
    ctx.fillStyle = tinta(tema, 0.78);
    ctx.fillText(this._chefeVisivel.nomeChefe || '', this.larguraCss / 2, y - 10);
    ctx.shadowColor = 'transparent';

    ctx.fillStyle = placa(0.7);
    ctx.fillRect(x, y, w, h);
    // `tema.rust` NÃO existe em CHAVES_COR: o `??` nunca era fallback, era o
    // único caminho, e pintava um marrom fixo que brigava com todo tema
    // turquesa, azul e violeta do jogo.
    ctx.fillStyle = rgba(misturarHex(tema.acento, PAPEL, 0.35), 0.5);
    ctx.fillRect(x, y, w * (this._chefeRastro ?? 0), h);
    ctx.fillStyle = tinta(tema, 0.88, 0.3);
    ctx.fillRect(x, y, w * (this._chefeFracao ?? 0), h);
    ctx.fillStyle = tinta(tema, 0.18);
    ctx.fillRect(x, y + h, w, 1);

    // Marcas nos limiares de fase: o jogador vê quanto falta para a luta
    // mudar, e isso transforma "estou perdendo" em "estou chegando lá".
    // Em pixel inteiro — em meio pixel elas saíam borradas e sumiam.
    ctx.strokeStyle = tinta(tema, 0.35);
    ctx.lineWidth = 1;
    for (const l of this._chefeVisivel.limiaresFase ?? []) {
      ctx.beginPath();
      ctx.moveTo(Math.round(x + w * l) + 0.5, y);
      ctx.lineTo(Math.round(x + w * l) + 0.5, y + h);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ================================================================ AVISOS == */

  _alfaDe(a) {
    const entrada = clamp01(a.t / 0.45);
    const saida = clamp01((a.dur - a.t) / SAIDA);
    return { alfa: Math.min(easeOutCubic(entrada), saida), entrada };
  }

  /** Título no alto: `marco` grita, `normal` fala. */
  _titulo(ctx, tema) {
    const a = this._canais.topo.atual;
    if (!a || (!a.titulo && !a.sub)) return;
    const { alfa, entrada } = this._alfaDe(a);
    if (alfa <= 0.01) return;
    const desloc = (1 - easeOutCubic(entrada)) * 14;

    const cx = this.larguraCss / 2;
    const cy = this.sa.t + this.alturaCss * 0.17 + desloc + (this._toque && this._chefeVisivel ? 30 : 0);

    /* PESO. Pegar um fragmento, entrar numa sala, destravar uma habilidade e
       matar um chefe recebiam exatamente o mesmo tratamento — o que achata a
       curva emocional inteira do jogo. */
    const corpo = a.peso === 'marco' ? 32 : 23;
    const fs = Math.round(clamp(this.larguraCss * 0.026, corpo * 0.7, corpo));

    ctx.save();
    ctx.globalAlpha = alfa;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    /* SCRIM. Um véu radial atrás do título: no Coração restaurado, com o céu
       quase branco, o título ficava em ~1,1:1 e desaparecia. */
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, fs * 9);
    g.addColorStop(0, placa(0.5));
    g.addColorStop(1, placa(0));
    ctx.fillStyle = g;
    ctx.fillRect(cx - fs * 9, cy - fs * 4, fs * 18, fs * 8);

    if (a.titulo) {
      ctx.font = `${a.peso === 'marco' ? 800 : 700} ${fs}px ${FONTE}`;
      // Archivo larga no marco: o mesmo "papel timbrado" dos títulos de painel.
      if ('fontStretch' in ctx) ctx.fontStretch = a.peso === 'marco' ? 'semi-expanded' : 'normal';
      ctx.fillStyle = tinta(tema, 0.95, 0.18);
      ctx.fillText(a.titulo, cx, cy);
      if ('fontStretch' in ctx) ctx.fontStretch = 'normal';
    }

    // Filete só no marco — nome de sala deve falar baixo, não ter acabamento.
    if (a.titulo && a.peso === 'marco') {
      const w = lerp(0, 110, easeOutCubic(entrada));
      ctx.strokeStyle = tinta(tema, 0.42);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - w, cy + fs * 0.8);
      ctx.lineTo(cx + w, cy + fs * 0.8);
      ctx.stroke();
    }

    if (a.sub) {
      ctx.font = `500 ${Math.round(clamp(fs * 0.55, 13, 16))}px ${FONTE}`;
      ctx.fillStyle = tinta(tema, 0.78);
      ctx.fillText(a.sub, cx, a.titulo ? cy + fs * 1.35 : cy);
    }
    ctx.restore();
  }

  /** Sussurro: uma linha só, numa faixa macia. Na base da tela no teclado;
   *  no toque ela sobe (a base é dos polegares). Nunca em cima da barra do
   *  chefe. */
  _sussurro(ctx, tema) {
    const a = this._canais.base.atual;
    if (!a) return;
    const txt = a.sub || a.titulo || '';
    if (!txt) return;
    const { alfa, entrada } = this._alfaDe(a);
    if (alfa <= 0.01) return;
    const desloc = (1 - easeOutCubic(entrada)) * 10;

    const cx = this.larguraCss / 2;
    let y;
    if (this._toque) {
      y = this.sa.t + this.alturaCss * 0.17 + 66;
      if (this._chefeVisivel) y += 30;
    } else {
      y = this.alturaCss - this.sa.b - 92;
      if (this._chefeVisivel && this._yChefe != null) y = Math.min(y, this._yChefe - 44);
    }
    y += desloc;

    ctx.save();
    ctx.globalAlpha = alfa;
    ctx.font = `500 ${Math.round(clamp(this.larguraCss * 0.011, 13, 16))}px ${FONTE}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const wt = Math.min(ctx.measureText(txt).width, this.larguraCss - 40);
    // Faixa que esmaece nas pontas: assenta o texto sem desenhar uma caixa.
    const meia = wt / 2 + 60;
    const g = ctx.createLinearGradient(cx - meia, 0, cx + meia, 0);
    g.addColorStop(0, placa(0));
    g.addColorStop(0.22, placa(0.55));
    g.addColorStop(0.78, placa(0.55));
    g.addColorStop(1, placa(0));
    ctx.fillStyle = g;
    ctx.fillRect(cx - meia, y - 15, meia * 2, 30);
    ctx.fillStyle = tinta(tema, 0.88);
    ctx.fillText(txt, cx, y + 0.5, this.larguraCss - 40);
    ctx.restore();
  }
}
