/* =========================================================================
   fase2/ui/tutor.js — ensino contextual
   -------------------------------------------------------------------------
   O jogo ensinava as habilidades no momento em que o jogador as pegava, e
   NADA MAIS: nunca dizia qual era o objetivo, o que a semente fazia, que Tab
   abre o mapa, ou que aquela massa roxa tinha solução. Quem não sabia de nada
   descobria por tentativa e erro ou não descobria.

   Três regras, que são o que separa ensino contextual de tutorial chato:

   1. NO PRIMEIRO CONTATO, NUNCA ANTES. A dica sobre a semente só aparece
      quando uma semente entra na tela. Ensinar algo que o jogador ainda não
      viu é pedir pra ele memorizar uma regra sem objeto — ele esquece, e
      quando o objeto aparece a dica já passou.
   2. UMA VEZ SÓ, E FICA GRAVADO NO SAVE. Repetir dica é o jeito mais rápido
      de treinar o jogador a ignorar a área do HUD onde ela aparece — e é
      justamente onde os avisos importantes também aparecem.
   3. NUNCA BLOQUEIA. Nada aqui pausa, escurece ou pede confirmação. É uma
      linha no anúncio do HUD e some sozinha.

   Uma quarta, específica deste jogo: dica NUNCA diz o que fazer com o vão à
   frente. "Este vão precisa de Salto Duplo" mata o único prazer do gênero,
   que é o jogador reconhecer sozinho o que ainda não consegue.
   ========================================================================= */

import { dist } from '../core/mat.js';

/**
 * Cada dica: quando dispara, o que diz.
 * `ver` = precisa de um objeto do tipo VISÍVEL na tela.
 * `quando` = predicado livre sobre o mundo.
 */
const DICAS = [
  {
    id: 'objetivo',
    // Dispara ao começar a andar, não na hora que a tela abre: dar o objetivo
    // antes de o jogador ter mexido no personagem é texto sobre nada.
    quando: (m, ctx) => ctx.distanciaAndada > 260,
    titulo: 'Traga a cor de volta',
    sub: 'cada área tem uma semente',
    dur: 4.2,
  },
  {
    id: 'semente',
    ver: 'semente',
    titulo: 'Semente',
    // Ensina a REGRA, não o gesto. Dizer só "alcance-a" mandava o jogador
    // encostar nela, ver a cápsula recuar e não entender o porquê — a dica
    // virava a origem da confusão em vez da solução dela.
    sub: 'limpe a área dos parasitas e ela abre',
    dur: 4.4,
  },
  {
    id: 'inimigo',
    ver: 'parasita',
    titulo: 'Parasita',
    sub: 'C para atacar — eles sempre avisam antes',
    dur: 4,
  },
  {
    id: 'salvamento',
    ver: 'salvamento',
    titulo: 'Raiz-marco',
    sub: 'cura e vira seu ponto de retorno',
    dur: 3.6,
  },
  {
    id: 'perigo',
    // Escória é o único elemento que mata sem ser um inimigo; avisar antes de
    // encostar é a diferença entre desafio e emboscada.
    quando: (m) => m.sala && perigoVisivel(m),
    titulo: 'Escória',
    sub: 'queima ao toque',
    dur: 3.4,
  },
  {
    id: 'agua',
    quando: (m) => m.jogador.naAgua,
    titulo: 'Água morta',
    sub: 'te deixa lento — pense antes de descer',
    dur: 3.6,
  },
  {
    id: 'barreira',
    ver: 'barreira',
    // Muda conforme o jogador já tem o Canto ou não: antes é uma promessa,
    // depois é uma instrução. A mesma dica dos dois jeitos seria inútil numa
    // das duas horas.
    titulo: 'Matéria corrompida',
    sub: (m) => m.jogador.temHabilidade('canto')
      ? 'E — cante para dissolver'
      : 'nada que você tem hoje abre isto',
    dur: 4,
  },
  {
    id: 'mapa',
    // Só depois de três salas: com uma ou duas, o mapa não tem o que mostrar
    // e a dica queima sem valor nenhum.
    quando: (m) => m.pureza.size >= 3,
    titulo: 'Tab',
    sub: 'abre o mapa do que você já percorreu',
    dur: 3.8,
  },
  {
    id: 'chefe',
    quando: (m) => m.entidades.some((e) => e.ehChefe && !e.morta),
    titulo: 'Algo grande acordou',
    sub: 'observe antes de atacar',
    dur: 3.4,
  },
  {
    id: 'restaurou',
    quando: (m, ctx) => ctx.jaRestaurouUmaSala,
    titulo: 'A sala respira',
    sub: 'restaure tudo e a floresta volta',
    dur: 4.4,
  },
];

function perigoVisivel(mundo) {
  const t = mundo.sala.terreno;
  const j = mundo.jogador;
  // Varredura curta em volta do jogador, não da tela inteira: barato, e o que
  // importa é o perigo que ele está prestes a encontrar.
  const raio = 6;
  const cx = Math.floor(j.centroX / t.tile);
  const cy = Math.floor(j.centroY / t.tile);
  for (let y = cy - raio; y <= cy + raio; y++) {
    for (let x = cx - raio; x <= cx + raio; x++) {
      if (t.em(x, y) === 3 /* PERIGO */) return true;
    }
  }
  return false;
}

/** Distância em que um objeto conta como "visto". */
const ALCANCE_VISTA = 340;

export class Tutor {
  /**
   * @param {import('../mundo/mundo.js').Mundo} mundo
   * @param {import('./hud.js').Hud} hud
   */
  constructor(mundo, hud) {
    this.mundo = mundo;
    this.hud = hud;
    this.mostradas = new Set();
    this.ativo = true;

    this.ctx = { distanciaAndada: 0, jaRestaurouUmaSala: false };
    this._ultimoX = null;
    // Espaçamento mínimo entre dicas: duas seguidas viram parede de texto, que
    // é exatamente o que este sistema existe pra evitar.
    this._esfriando = 0;
  }

  /** O que já foi ensinado entra no save — dica repetida treina a ignorar. */
  paraSave() { return [...this.mostradas]; }
  aplicarSave(lista) { this.mostradas = new Set(lista || []); }

  aoEvento(ev) {
    if (ev.tipo === 'semente') this.ctx.jaRestaurouUmaSala = true;
  }

  atualizar(dt) {
    if (!this.ativo || !this.mundo.sala) return;
    this._esfriando = Math.max(0, this._esfriando - dt);

    const j = this.mundo.jogador;
    if (this._ultimoX != null) this.ctx.distanciaAndada += Math.abs(j.x - this._ultimoX);
    this._ultimoX = j.x;

    // Nunca durante uma luta ou uma queda: dica no meio de um combate é
    // ruído em cima da informação que o jogador precisa de verdade.
    if (this._esfriando > 0 || j.atordoado > 0 || this.hud.anuncio) return;

    for (const d of DICAS) {
      if (this.mostradas.has(d.id)) continue;
      if (!this._disparou(d)) continue;

      this.mostradas.add(d.id);
      this._esfriando = 5;
      const sub = typeof d.sub === 'function' ? d.sub(this.mundo) : d.sub;
      this.hud.anunciar(d.titulo, sub, d.dur ?? 3.6);
      return;   // uma por vez, sempre
    }
  }

  _disparou(d) {
    if (d.ver && !this._vePerto(d.ver)) return false;
    if (d.quando && !d.quando(this.mundo, this.ctx)) return false;
    return true;
  }

  /** Há uma entidade daquele tipo perto o bastante pra o jogador ter visto? */
  _vePerto(tipo) {
    const j = this.mundo.jogador;
    for (const e of this.mundo.entidades) {
      if (e.morta) continue;
      if (!this._ehTipo(e, tipo)) continue;
      const ex = e.centroX ?? e.x, ey = e.centroY ?? e.y;
      if (dist(j.centroX, j.centroY, ex, ey) < ALCANCE_VISTA) return true;
    }
    return false;
  }

  /**
   * As entidades não carregam o char do mapa, então o tipo é deduzido do nome
   * da classe. Frágil se alguém renomear uma classe — mas o custo de errar é
   * uma dica que não aparece, não um bug de jogo, e a alternativa (carregar o
   * tipo em toda entidade) suja o contrato por causa do tutorial.
   */
  _ehTipo(e, tipo) {
    const n = e.constructor?.name || '';
    switch (tipo) {
      case 'semente': return n === 'Semente';
      case 'salvamento': return n === 'PontoSalvamento';
      case 'barreira': return n === 'Barreira';
      case 'parasita': return !e.ehChefe && (
        n === 'Errante' || n === 'Espreita' || n === 'Cuspidor' ||
        n === 'Rastejante' || n === 'Estopim' || n === 'Tecelao' ||
        n === 'ParasitaBase');
      default: return false;
    }
  }
}
