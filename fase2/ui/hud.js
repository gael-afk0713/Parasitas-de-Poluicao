/* =========================================================================
   fase2/ui/hud.js — HUD desenhado no canvas
   -------------------------------------------------------------------------
   Desenhado no canvas, não em DOM: o HUD precisa reagir ao TEMA da área
   (ele muda de cor junto com o mundo restaurado) e a CSS não tem acesso ao
   tema interpolado por frame.

   Princípio: o HUD é o mais discreto possível. Vida sempre visível; nome de
   área e habilidade nova aparecem e SOMEM. Nada de barra permanente de
   experiência, minimapa ou contador — em jogo de atmosfera, HUD é ruído.
   ========================================================================= */

import {
  TAU, clamp, clamp01, lerp, damp, rgba, misturarHex, easeOutCubic, easeOutBack,
} from '../core/mat.js';
import { nomeArea } from '../render/paleta.js';

/* -------------------------------------------------------------- A TINTA ---
   O HUD tinha as cores da ESTRUTURA vindas do tema (`crista`, `borda`,
   `ceuTopo`). Essas cores foram desenhadas pro mundo, onde tudo é escuro de
   propósito — então o contraste do HUD dependia da sala. Nas Raízes poluídas
   a máscara vazia ficava em 1,17:1 contra o fundo (o mínimo legível é 4,5:1)
   e o chip de habilidade em 1,58:1; no Coração restaurado, com o céu quase
   branco, o título sumia por completo. O mesmo HUD oscilava entre invisível e
   fluorescente.

   Contraste é função de um PAR FIXO. Identidade é função de um TINTE. Então:
   estrutura e texto saem de `PAPEL`/`BREU` (os mesmos `--paper`/`--soot` do
   style.css) e o tema entra só como matiz e como acento. É o que o Hollow
   Knight faz — a máscara é sempre osso, o mundo muda em volta.
   ------------------------------------------------------------------------ */
const PAPEL = '#efe8d6';
const BREU = '#0b0906';

/** Tinta do HUD: valor fixo (legibilidade), matiz do tema (identidade). */
const tinta = (tema, nivel, matiz = 0.22) =>
  rgba(misturarHex(PAPEL, tema.luz, matiz), nivel);

/** Placa/trilho: sempre o mesmo breu, pra o texto ter sobre o que assentar. */
const placa = (nivel) => rgba(BREU, nivel);

const NOMES_HABILIDADE = {
  saltoDuplo: 'Salto Duplo',
  investida: 'Investida',
  canto: 'Canto da Raiz',
  parede: 'Agarre',
  planeio: 'Planeio',
};

const DICAS_HABILIDADE = {
  saltoDuplo: 'Pular de novo no ar',
  investida: 'Shift — avanço rápido',
  canto: 'E — restaura o que está perto',
  parede: 'Segure contra a parede',
  planeio: 'Segure pular ao cair',
};

export class Hud {
  constructor(elemento, mundo) {
    this.el = elemento;
    this.mundo = mundo;
    this.ctx = null;
    if (elemento?.getContext) this.ctx = elemento.getContext('2d');

    this.anuncio = null;      // { titulo, sub, t, dur, peso }
    this.pausado = false;
    this._vidaExibida = mundo.jogador.vida;
    this._dpr = 1;
    this._t = 0;
    this._habNova = null;     // { id, t } — o chip aparece e some
    /** Ligado por main.js quando o sistema pede movimento reduzido. */
    this.movimentoReduzido = false;
  }

  /* Todo o HUD era posicionado em px fixos, então numa janela de 2560 px ele
     tinha metade do tamanho relativo que tem em 1280. Um fator só, com teto e
     piso pra não virar cartaz nem sumir. */
  get escala() { return clamp((this.larguraCss || 1280) / 1280, 0.85, 1.4); }

  anunciarSala(sala, mundo) {
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
    this.anunciar(titulo, null, 3.4, 'normal');
  }

  anunciarHabilidade(id) {
    this._habNova = { id, t: 0 };
    this.anunciar(NOMES_HABILIDADE[id] || id, DICAS_HABILIDADE[id] || '', 4.2, 'marco');
  }

  /**
   * @param {'marco'|'normal'|'sussurro'} peso  quanto isto merece interromper.
   *   `marco` = habilidade, chefe morto, semente. `normal` = nome de sala.
   *   `sussurro` = fragmento, portão trancado, lore — vai pra base da tela.
   */
  anunciar(titulo, sub = null, dur = 3, peso = 'normal') {
    this.anuncio = { titulo, sub, t: 0, dur, peso };
  }

  definirPausa(v) { this.pausado = v; }

  _ajustar() {
    const el = this.el;
    if (!el) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = el.getBoundingClientRect();
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (el.width !== w || el.height !== h) { el.width = w; el.height = h; }
    this._dpr = dpr;
    this.larguraCss = r.width;
    this.alturaCss = r.height;
    return w > 0 && h > 0;
  }

  desenhar(dt, tema) {
    if (!this.ctx || !this._ajustar()) return;
    const ctx = this.ctx;
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, this.larguraCss, this.alturaCss);

    this._t += dt;
    this._vida(ctx, tema, dt);
    this._habilidades(ctx, tema, dt);
    this._barraChefe(ctx, tema, dt);
    this._anuncio(ctx, tema, dt);
    if (this.pausado) this._pausa(ctx, tema);
  }

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
    const y = this.alturaCss - Math.max(48, this.alturaCss * 0.085);
    const h = 4;

    ctx.save();
    ctx.globalAlpha = alfa;

    ctx.font = '600 10px "JetBrains Mono", monospace';
    ctx.letterSpacing = '0.28em';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = tinta(tema, 0.55);
    ctx.fillText((this._chefeVisivel.nomeChefe || '').toUpperCase(), this.larguraCss / 2, y - 14);
    ctx.letterSpacing = '0px';

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

  _vida(ctx, tema, dt) {
    const j = this.mundo.jogador;
    /* PERDER UMA MÁSCARA precisa de transição, não de estado.
       `_vidaExibida` era calculada todo quadro e nunca lida: a máscara sumia
       num quadro, binária, a 10 px de altura, no canto oposto ao que o
       jogador está olhando. A informação chegava pelo som e pelo empurrão; o
       HUD só servia pra conferir depois. Aqui a perda vira um estouro curto
       com tremor — é a transição que se lê no periférico. */
    const perdeu = j.vida < this._vidaExibida - 0.01;
    this._vidaExibida = damp(this._vidaExibida, j.vida, 0.12, dt);
    this._flash = perdeu ? 1 : Math.max(0, (this._flash ?? 0) - dt * 2.4);
    const flash = this._flash;

    const k = this.escala;
    const x0 = 30 * k, y0 = 32 * k, r = 9 * k, gap = 26 * k;

    // Acima de 12 pontos as máscaras atravessariam a tela inteira. O jogo não
    // deve chegar lá pelo caminho normal (fragmentos sobem devagar), mas um
    // save adulterado ou um teste chegam — e HUD que estoura a tela é pior que
    // HUD feio. Acima do limite, vira contador.
    const LIMITE_ICONES = 12;
    if (j.vidaMax > LIMITE_ICONES) {
      ctx.save();
      ctx.font = `700 ${15 * k}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = tinta(tema, 0.92);
      ctx.fillText(`${j.vida}`, x0 - 4, y0);
      const w = ctx.measureText(`${j.vida}`).width;
      ctx.font = `400 ${11 * k}px "JetBrains Mono", monospace`;
      ctx.fillStyle = tinta(tema, 0.5);
      ctx.fillText(`/ ${j.vidaMax}`, x0 - 4 + w + 6, y0 + 1);
      ctx.restore();
      return;
    }

    ctx.save();
    // Tremor curto no golpe — some junto com o flash.
    if (flash > 0 && !this.movimentoReduzido) {
      ctx.translate(Math.sin(flash * 42) * flash * 2.6 * k, 0);
    }
    // Piscada da invulnerabilidade: comunica os i-frames sem ícone novo.
    // Com movimento reduzido vira um esmaecido constante em vez de pulso.
    if (j.invulneravel > 0) {
      ctx.globalAlpha = this.movimentoReduzido
        ? 0.8 : 0.75 + 0.25 * Math.abs(Math.sin(this._t * 26));
    }

    /* Véu por baixo das máscaras.
       A cor delas é creme, e depois que o estado restaurado passou a ter céu
       claro de verdade (`ceuBase` de 57 pra 182 na raiz) creme sobre céu
       claro deixou de ser legível — o HUD sumia justamente nas salas que o
       jogador acabou de curar. Uma sombra curta e macia sob cada máscara
       garante leitura sobre qualquer fundo e não aparece sobre o escuro. */
    ctx.shadowColor = placa(0.55);
    ctx.shadowBlur = 5 * k;
    ctx.shadowOffsetY = 1 * k;

    for (let i = 0; i < j.vidaMax; i++) {
      const cheio = i < j.vida;
      const x = x0 + i * gap;
      /* A máscara É a cabeça do Guardião — mas a versão anterior era uma
         elipse 0,82 (quase redonda) e simétrica, enquanto a cabeça dele é
         0,60 (ovo alto) e assimétrica, em três-quartos, com reflexo. Não
         batiam: o HUD desenhava outro bicho. */
      const acabou = flash > 0 && i === j.vida;
      const esc = acabou ? 1 + easeOutBack(1 - flash) * 0.35 : 1;
      const dy = acabou ? -flash * 3 * k : 0;
      ctx.beginPath();
      ctx.ellipse(x, y0 + dy, r * 0.62 * esc, r * esc, 0, 0, TAU);
      if (cheio) {
        // 0,84 e não 1: cheia a 10,4:1 gritava mais alto que o feixe de luz
        // que a paleta inteira do jogo foi construída pra criar.
        ctx.fillStyle = tinta(tema, 0.84, 0.25);
        ctx.fill();
        // Olhos e reflexo já estão DENTRO da máscara: repetir a sombra neles
        // suja o desenho a 18 px.
        ctx.shadowColor = 'transparent';
        ctx.fillStyle = placa(0.86);
        ctx.beginPath();
        ctx.ellipse(x - 2.6 * k, y0 - 0.8 * k, 1.35 * k, 2.1 * k, 0, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(x + 2.9 * k, y0 - 0.8 * k, 1.55 * k, 2.35 * k, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = tinta(tema, 0.9);
        ctx.beginPath();
        ctx.ellipse(x + 3.4 * k, y0 - 2.3 * k, 0.65 * k, 0.8 * k, 0, 0, TAU);
        ctx.fill();
        ctx.shadowColor = placa(0.55);
      } else {
        /* SOQUETE, não ausência. O vazio era só um contorno em `tema.borda`
           a 1,17:1 — dava pra ver quantas vidas se TEM e nunca quantas se
           PERDEU, que é o dado que importa em combate. */
        ctx.fillStyle = placa(0.55);
        ctx.fill();
        ctx.strokeStyle = tinta(tema, 0.3);
        ctx.lineWidth = 1.4 * k;
        ctx.stroke();
        if (acabou) {
          ctx.fillStyle = tinta(tema, flash);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  /**
   * A habilidade RECÉM-ganha, e só ela, por alguns segundos.
   *
   * A versão anterior listava tudo que estava destravado, para sempre — uma
   * faixa de ~500 px de mono maiúsculo permanente no canto. O cabeçalho deste
   * arquivo promete que "habilidade nova aparece e SOME", e a lista completa
   * contradizia isso todo quadro. Ninguém esquece que sabe pular duas vezes;
   * a lista inteira vive no painel de pausa, onde é consulta.
   */
  _habilidades(ctx, tema, dt) {
    const c = this._habNova;
    if (!c) return;
    c.t += dt;
    if (c.t >= 6) { this._habNova = null; return; }
    const k = this.escala;
    const alfa = Math.min(1, c.t / 0.4) * clamp01((6 - c.t) / 1.2);

    const nome = (NOMES_HABILIDADE[c.id] || c.id).toUpperCase();
    ctx.save();
    ctx.globalAlpha = alfa;
    ctx.font = `600 ${9.5 * k}px "JetBrains Mono", monospace`;
    ctx.letterSpacing = '0.16em';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const w = ctx.measureText(nome).width;
    // A borda da placa alinha com a borda da máscara (x0 - r*0.62).
    const x = 31 * k, y = 64 * k;
    ctx.fillStyle = placa(0.68);
    ctx.fillRect(x - 9 * k, y - 9 * k, w + 18 * k, 18 * k);
    ctx.strokeStyle = tinta(tema, 0.16);
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 8.5 * k, y - 8.5 * k, w + 17 * k, 17 * k);
    // 0,62 sobre a placa de breu ainda ficava no limite do legível — e o chip
    // só existe por seis segundos, então tem que ser lido de primeira.
    ctx.fillStyle = tinta(tema, 0.78);
    ctx.fillText(nome, x, y);
    ctx.letterSpacing = '0px';
    ctx.restore();
  }

  _anuncio(ctx, tema, dt) {
    const a = this.anuncio;
    if (!a) return;
    a.t += dt;
    if (a.t >= a.dur) { this.anuncio = null; return; }

    // Entra rápido, fica, sai devagar.
    const entrada = clamp01(a.t / 0.5);
    const saida = clamp01((a.dur - a.t) / 0.9);
    const alfa = Math.min(easeOutCubic(entrada), saida);
    const desloc = (1 - easeOutCubic(entrada)) * 14;

    const cx = this.larguraCss / 2;
    const cy = this.alturaCss * 0.17 + desloc;   // 0.22 caía sobre a copa

    ctx.save();
    ctx.globalAlpha = alfa;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    /* PESO. Pegar um fragmento, entrar numa sala, destravar uma habilidade e
       matar um chefe recebiam exatamente o mesmo tratamento — título de 30 px
       no meio da tela — o que achata a curva emocional inteira do jogo.
       Agora: `marco` grita, `normal` fala, `sussurro` cochicha na base. */
    const peso = a.peso ?? 'normal';
    const corpo = peso === 'marco' ? 30 : peso === 'normal' ? 22 : 13;
    const fs = Math.round(clamp(this.larguraCss * 0.026, corpo * 0.7, corpo));

    if (peso === 'sussurro') {
      ctx.font = `600 ${Math.max(10, fs)}px "JetBrains Mono", monospace`;
      ctx.letterSpacing = '0.2em';
      const txt = (a.sub || a.titulo || '').toUpperCase();
      const wt = ctx.measureText(txt).width;
      const yb = this.alturaCss - 92 - desloc;
      ctx.fillStyle = placa(0.5);
      ctx.fillRect(cx - wt / 2 - 14, yb - 13, wt + 28, 26);
      ctx.fillStyle = tinta(tema, 0.8);
      ctx.fillText(txt, cx, yb);
      ctx.letterSpacing = '0px';
      ctx.restore();
      return;
    }

    /* SCRIM. A "sombra" era um offset de 1,5 px: invisível no escuro e
       pequena demais no claro. No Coração restaurado, com o céu quase branco,
       o título ficava em ~1,1:1 e desaparecia. Um véu radial resolve os dois
       casos de uma vez. */
    if (a.titulo) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, fs * 9);
      g.addColorStop(0, placa(0.5));
      g.addColorStop(1, placa(0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - fs * 9, cy - fs * 4, fs * 18, fs * 8);

      ctx.font = `900 ${fs}px "Space Grotesk", sans-serif`;
      ctx.letterSpacing = '-0.01em';
      ctx.fillStyle = tinta(tema, 0.94, 0.18);
      ctx.fillText(a.titulo, cx, cy);
      ctx.letterSpacing = '0px';
    }

    // Filete só no marco — nome de sala deve sussurrar, não ter acabamento.
    if (a.titulo && peso === 'marco') {
      const w = lerp(0, 120, easeOutCubic(entrada));
      ctx.strokeStyle = tinta(tema, 0.45);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - w, cy + fs * 0.78);
      ctx.lineTo(cx + w, cy + fs * 0.78);
      ctx.stroke();
    }

    if (a.sub) {
      ctx.font = `400 ${12}px "JetBrains Mono", monospace`;
      ctx.letterSpacing = '0.12em';
      ctx.fillStyle = tinta(tema, 0.62);
      ctx.fillText(a.sub.toUpperCase(), cx, cy + fs * 1.3);
      ctx.letterSpacing = '0px';
    }
    ctx.restore();
  }

  _pausa(ctx, tema) {
    ctx.save();
    ctx.fillStyle = placa(0.62);
    ctx.fillRect(0, 0, this.larguraCss, this.alturaCss);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 34/900: a 26 px o "PAUSADO" ficava MENOR que o nome de sala a 30 px —
    // inversão direta de hierarquia.
    ctx.font = '900 34px "Space Grotesk", sans-serif';
    ctx.letterSpacing = '0.04em';
    ctx.fillStyle = tinta(tema, 0.94, 0.18);
    ctx.fillText('PAUSADO', this.larguraCss / 2, this.alturaCss / 2);
    ctx.font = '400 12px "JetBrains Mono", monospace';
    ctx.letterSpacing = '0.2em';
    ctx.fillStyle = tinta(tema, 0.55);
    ctx.fillText('ESC PARA CONTINUAR', this.larguraCss / 2, this.alturaCss / 2 + 34);
    ctx.letterSpacing = '0px';
    ctx.restore();
  }
}
