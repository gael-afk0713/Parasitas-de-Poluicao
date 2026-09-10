/* =========================================================================
   fase2/ui/mapa.js — a tela de mapa
   -------------------------------------------------------------------------
   Um metroidvania sem mapa é um labirinto; com mapa é um LUGAR. É a diferença
   entre "estou perdido" e "sei onde estou e escolhi vir por aqui".

   O layout não é escrito à mão em lugar nenhum. Ele é DERIVADO do grafo de
   portas: partindo da sala inicial, cada ligação empurra a sala vizinha na
   direção da porta que a liga (porta-dir empurra pra direita, porta-baixo pra
   baixo), com o deslocamento proporcional ao tamanho real das duas salas.
   Isso mantém o mapa sempre coerente com o mundo — mexer numa sala não exige
   lembrar de mexer no mapa também, que é como mapas desenhados à mão sempre
   acabam mentindo depois de umas refatorações.

   Só aparecem salas VISITADAS. Um mapa que já nasce completo entrega a
   exploração antes de ela acontecer.
   ========================================================================= */

import {
  TAU, clamp, clamp01, lerp, damp, rgba, misturarHex, easeOutCubic,
} from '../core/mat.js';
import { todasAsSalas, carregarSala } from '../mundo/salas.js';
import { AREAS, resolver, nomeArea } from '../render/paleta.js';

const DESLOC = {
  'porta-dir': [1, 0],
  'porta-esq': [-1, 0],
  'porta-cima': [0, -1],
  'porta-baixo': [0, 1],
};

/** Folga entre salas no mapa, em tiles de mundo. */
const FOLGA = 6;

export class TelaMapa {
  constructor(mundo) {
    this.mundo = mundo;
    this.aberta = false;
    this.abertura = 0;        // 0..1, animação
    this.zoom = 1;
    this._layout = null;
    this.panX = 0; this.panY = 0;
  }

  alternar() {
    this.aberta = !this.aberta;
    if (this.aberta) this._garantirLayout();
  }
  fechar() { this.aberta = false; }

  atualizar(dt) {
    this.abertura = damp(this.abertura, this.aberta ? 1 : 0, 0.09, dt);
  }

  get visivel() { return this.abertura > 0.01; }

  /* ---------------------------------------------------------------------
     LAYOUT — posições derivadas do grafo de portas
     --------------------------------------------------------------------- */

  _garantirLayout() {
    if (this._layout) return this._layout;

    const pos = new Map();     // salaId → {x, y, w, h}
    const inicio = todasAsSalas()[0]?.id;
    if (!inicio) return (this._layout = { pos, limites: null });

    // BFS: cada sala é colocada relativa a quem a alcançou primeiro. Usar BFS
    // (e não DFS) importa — com DFS um ramo longo empurra tudo pra longe antes
    // de os vizinhos próximos serem posicionados, e o mapa fica esticado.
    const fila = [inicio];
    const salaInicial = carregarSala(inicio);
    pos.set(inicio, { x: 0, y: 0, w: salaInicial.largura, h: salaInicial.altura });

    const vistos = new Set([inicio]);
    while (fila.length) {
      const id = fila.shift();
      const sala = carregarSala(id);
      const p = pos.get(id);

      for (const [nomePorta, destino] of Object.entries(sala.ligacoes)) {
        const idDest = destino?.sala;
        if (!idDest || vistos.has(idDest)) continue;
        const d = DESLOC[nomePorta];
        if (!d) continue;
        let destSala;
        try { destSala = carregarSala(idDest); } catch { continue; }

        // Encosta a sala vizinha na borda correspondente, com folga.
        const folga = FOLGA * 32;
        const x = d[0] > 0 ? p.x + p.w + folga
          : d[0] < 0 ? p.x - destSala.largura - folga
          : p.x + (p.w - destSala.largura) / 2;
        const y = d[1] > 0 ? p.y + p.h + folga
          : d[1] < 0 ? p.y - destSala.altura - folga
          : p.y + (p.h - destSala.altura) / 2;

        pos.set(idDest, { x, y, w: destSala.largura, h: destSala.altura });
        vistos.add(idDest);
        fila.push(idDest);
      }
    }

    this._separar(pos);

    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pos.values()) {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h);
    }
    this._layout = { pos, limites: { x0, y0, x1, y1 } };
    return this._layout;
  }

  /**
   * Empurra salas sobrepostas até deixarem de se sobrepor.
   *
   * O BFS coloca cada sala relativa a QUEM A ALCANÇOU, e não sabe nada sobre
   * o que já está no lugar. Num mundo com ciclos e ramos, dois caminhos
   * diferentes acabam apontando para a mesma região e as salas se empilham —
   * visível na primeira versão do mapa como retângulos um em cima do outro.
   *
   * A separação é iterativa e empurra pelo eixo de MENOR penetração, que é o
   * que preserva a leitura do grafo: uma sala à direita continua à direita,
   * só desliza o suficiente para caber.
   */
  _separar(pos, iteracoes = 60) {
    const itens = [...pos.values()];
    const margem = 24;
    for (let it = 0; it < iteracoes; it++) {
      let mexeu = false;
      for (let i = 0; i < itens.length; i++) {
        for (let k = i + 1; k < itens.length; k++) {
          const a = itens[i], b = itens[k];
          const penX = Math.min(a.x + a.w + margem, b.x + b.w + margem) - Math.max(a.x - margem, b.x - margem);
          const penY = Math.min(a.y + a.h + margem, b.y + b.h + margem) - Math.max(a.y - margem, b.y - margem);
          if (penX <= 0 || penY <= 0) continue;

          mexeu = true;
          const centroA = a.x + a.w / 2, centroB = b.x + b.w / 2;
          const centroAy = a.y + a.h / 2, centroBy = b.y + b.h / 2;
          if (penX < penY) {
            const empurra = (penX / 2) * (centroA < centroB ? -1 : 1);
            a.x += empurra; b.x -= empurra;
          } else {
            const empurra = (penY / 2) * (centroAy < centroBy ? -1 : 1);
            a.y += empurra; b.y -= empurra;
          }
        }
      }
      if (!mexeu) break;
    }
  }

  /* --------------------------------------------------------------------- */

  desenhar(ctx, largura, altura, tema) {
    if (!this.visivel) return;
    const a = easeOutCubic(this.abertura);
    const layout = this._garantirLayout();
    if (!layout.limites) return;

    ctx.save();
    ctx.globalAlpha = a;

    // Fundo quase opaco: o mapa é uma PAUSA, e enxergar a cena por trás dele
    // mantém o jogador com um pé no jogo em vez de conseguir se orientar.
    ctx.fillStyle = rgba(tema.ceuTopo, 0.985);
    ctx.fillRect(0, 0, largura, altura);

    const { x0, y0, x1, y1 } = layout.limites;
    // Margem proporcional, e nunca maior que o próprio espaço: com margem
    // fixa de 70px numa janela baixa, `altura - margem*2 - 40` ficava
    // NEGATIVO e a escala junto — o que acabava virando `arc()` de raio
    // negativo e derrubava o desenho inteiro. Bug real, encontrado em pane
    // pequeno; a lição é nunca deixar uma dimensão derivada ficar sem piso.
    const margemX = Math.min(70, largura * 0.08);
    const margemY = Math.min(70, altura * 0.10);
    const escala = Math.max(0.02, Math.min(
      (largura - margemX * 2) / Math.max(1, x1 - x0),
      (altura - margemY * 2 - 56) / Math.max(1, y1 - y0)
    ));
    const offX = (largura - (x1 - x0) * escala) / 2 - x0 * escala;
    const offY = (altura - (y1 - y0) * escala) / 2 - y0 * escala + 10;

    // A sala atual "cresce" um pouco na entrada — dá o ponto de foco.
    const atual = this.mundo.sala?.id;

    /* 1 · CORREDORES entre salas visitadas (por baixo dos retângulos).
       Ligar centro com centro — que era o que estava aqui — desenha
       diagonais que atravessam salas sem relação nenhuma com elas: lê como
       teia de aranha, não como planta de um lugar. Um corredor sai da PORTA
       e chega na porta oposta da vizinha, que é onde a passagem realmente
       fica. */
    ctx.lineCap = 'round';
    for (const def of todasAsSalas()) {
      const p = layout.pos.get(def.id);
      if (!p || !this._visitada(def.id)) continue;
      const sala = carregarSala(def.id);
      for (const porta of sala.portas) {
        const lig = sala.ligacoes[porta.tipo];
        if (!lig || !this._visitada(lig.sala)) continue;
        const q = layout.pos.get(lig.sala);
        if (!q) continue;
        const oposta = carregarSala(lig.sala).portas.find((pt) => pt.tipo === lig.porta);
        if (!oposta) continue;
        ctx.strokeStyle = rgba(tema.borda, 0.85);
        ctx.lineWidth = Math.max(1.4, Math.min(5, 26 * escala));
        ctx.beginPath();
        ctx.moveTo(offX + (p.x + porta.x) * escala, offY + (p.y + porta.y) * escala);
        ctx.lineTo(offX + (q.x + oposta.x) * escala, offY + (q.y + oposta.y) * escala);
        ctx.stroke();
      }
    }

    // 2 · salas
    for (const def of todasAsSalas()) {
      const p = layout.pos.get(def.id);
      if (!p || !this._visitada(def.id)) continue;

      const pureza = this.mundo.purezaDaSala(def.id);
      // A cor da sala no mapa É a cor da área naquele estado de restauração:
      // o mapa vira, sozinho, o placar de progresso do jogo.
      const temaSala = resolver(def.area, pureza);
      const x = offX + p.x * escala;
      const y = offY + p.y * escala;
      const w = p.w * escala;
      const h = p.h * escala;

      // 0.15 deixava sala poluída quase invisível contra o fundo do mapa —
      // e sala poluída é justamente a que o jogador precisa achar.
      ctx.fillStyle = misturarHex(temaSala.terreno, temaSala.crista, 0.3 + pureza * 0.45);
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = def.id === atual
        ? misturarHex('#ffffff', temaSala.crista, 0.4)
        : rgba(temaSala.borda, 0.9);
      ctx.lineWidth = def.id === atual ? 2.4 : 1.2;
      ctx.strokeRect(x, y, w, h);

      // Marcadores do que a sala tem. Só de coisas que o jogador já viu.
      const sala = carregarSala(def.id);
      const cx = x + w / 2, cy = y + h / 2;
      if (sala.objetos.some((o) => o.tipo === 'salvamento')) {
        ctx.fillStyle = temaSala.crista;
        ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, Math.min(4, h * 0.3)), 0, TAU); ctx.fill();
      }
      if (sala.objetos.some((o) => o.tipo === 'chefe')) {
        ctx.fillStyle = temaSala.acento;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI / 4);
        const s = Math.max(1.5, Math.min(5, h * 0.3));
        ctx.fillRect(-s, -s, s * 2, s * 2);
        ctx.restore();
      }
      // Semente ainda não colhida: o objetivo pendente, visível de longe.
      if (sala.objetos.some((o) => o.tipo === 'semente') && pureza < 0.9) {
        ctx.strokeStyle = temaSala.acento;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(2, Math.min(6, h * 0.34)), 0, TAU);
        ctx.stroke();
      }
    }

    /* 2b · PORTAS PARA O DESCONHECIDO. Um toco saindo da sala visitada, com
       um quadrado tracejado na ponta. É a promessa que faz o jogador abrir o
       mapa de novo: "existe alguma coisa ali, e eu ainda não fui". Sem isso o
       mapa só conta o que já aconteceu, e não puxa pra lugar nenhum. */
    ctx.setLineDash([3, 3]);
    for (const def of todasAsSalas()) {
      const p = layout.pos.get(def.id);
      if (!p || !this._visitada(def.id)) continue;
      const sala = carregarSala(def.id);
      for (const porta of sala.portas) {
        const lig = sala.ligacoes[porta.tipo];
        if (!lig || this._visitada(lig.sala)) continue;
        const d = DESLOC[porta.tipo] ?? [0, 0];
        const bx = offX + (p.x + porta.x) * escala;
        const by = offY + (p.y + porta.y) * escala;
        const comp = Math.max(10, Math.min(26, 90 * escala));
        ctx.strokeStyle = rgba(tema.particula, 0.55);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + d[0] * comp, by + d[1] * comp);
        ctx.stroke();
        const s2 = comp * 0.42;
        ctx.strokeRect(bx + d[0] * (comp + s2) - s2, by + d[1] * (comp + s2) - s2, s2 * 2, s2 * 2);
      }
    }
    ctx.setLineDash([]);

    // 3 · o Guardião, na posição real dentro da sala
    if (atual && layout.pos.has(atual)) {
      const p = layout.pos.get(atual);
      const j = this.mundo.jogador;
      const px = offX + (p.x + j.centroX) * escala;
      const py = offY + (p.y + j.centroY) * escala;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(px, py, 3.4, 0, TAU);
      ctx.fill();
      // Halo pulsando: acha o ponto branco num mapa cheio de retângulos.
      ctx.strokeStyle = rgba('#ffffff', 0.5 + 0.3 * Math.sin(performance.now() / 260));
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(px, py, 7 + Math.sin(performance.now() / 260) * 1.6, 0, TAU);
      ctx.stroke();
    }

    this._legenda(ctx, largura, altura, tema);
    ctx.restore();
  }

  _legenda(ctx, largura, altura, tema) {
    const m = this.mundo;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    ctx.font = '700 20px "Space Grotesk", sans-serif';
    ctx.fillStyle = misturarHex('#efe8d6', tema.crista, 0.3);
    ctx.fillText(nomeArea(m.sala?.area, m.purezaDaArea(m.sala?.area ?? '')), largura / 2, 40);

    /* Quantos parasitas faltam NA ÁREA.
       A semente só abre com a área limpa, e sem este número o jogador teria
       que voltar até a semente pra descobrir se já pode — ou, pior, vasculhar
       salas já limpas sem saber quantas ainda devem alguma coisa. Fica no
       mapa porque é lá que se decide pra onde ir. */
    const faltam = m.parasitasVivosNaArea?.(m.sala?.area) ?? 0;
    ctx.font = '600 12px "JetBrains Mono", monospace';
    ctx.fillStyle = faltam > 0
      ? rgba(misturarHex(tema.particula, '#ffffff', 0.3), 0.9)
      : rgba(tema.acento, 0.95);
    ctx.fillText(
      faltam > 0
        ? `${faltam} ${faltam === 1 ? 'PARASITA' : 'PARASITAS'} NESTA ÁREA`
        : 'ÁREA LIMPA · A SEMENTE PODE SER COLHIDA',
      largura / 2, 62);

    // Percentual de restauração — o único número do jogo inteiro, e ele existe
    // porque "quanto do mundo eu já trouxe de volta" é exatamente a pergunta
    // que o jogo está fazendo.
    const pct = Math.round(m.purezaGlobal * 100);
    ctx.font = '600 12px "JetBrains Mono", monospace';
    ctx.fillStyle = rgba(tema.particula, 0.85);
    ctx.fillText(`RESTAURADO  ${pct}%`, largura / 2, altura - 42);

    const frag = m.fragmentosColetados?.size ?? 0;
    ctx.fillStyle = rgba(tema.particula, 0.55);
    ctx.fillText(`FRAGMENTOS ${frag}   ·   TAB PARA FECHAR`, largura / 2, altura - 22);
  }

  _visitada(id) {
    // Uma sala conta como visitada se tem pureza registrada — `entrarNaSala`
    // cria a entrada, então isso é equivalente a "já estive lá" sem precisar
    // de um Set paralelo que poderia sair de sincronia com o save.
    return this.mundo.pureza.has(id);
  }
}
