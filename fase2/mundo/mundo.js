/* =========================================================================
   fase2/mundo/mundo.js — estado do jogo: sala atual, entidades, restauração
   -------------------------------------------------------------------------
   Dono de tudo que muda durante a partida. `main.js` só empurra o tempo pra
   cá e pede o desenho; nenhuma regra de jogo mora lá.

   O conceito central é PUREZA. Cada sala tem uma pureza 0..1; a pureza de uma
   ÁREA é a média das salas dela. A pureza alimenta:
     · o tema de cor (render/paleta.js)
     · a densidade de musgo/flor no terreno
     · a floração do broto na cabeça do Guardião
     · quais parasitas ainda nascem (área pura para de gerar)
   Ou seja: uma variável só, e o mundo inteiro responde. É o que faz a
   restauração PARECER causal em vez de um contador subindo num canto.
   ========================================================================= */

import { clamp01, lerp, damp, sobrepoe, caixaDe } from '../core/mat.js';
import { carregarSala, PORTA_OPOSTA } from './salas.js';
import { AREAS, resolver } from '../render/paleta.js';
import { ArteTerreno } from '../render/terreno-arte.js';
import { Decor } from '../render/decor.js';
import { Jogador } from '../entidades/jogador.js';
import { ArteJogador } from '../entidades/jogador-arte.js';
import { FRAGMENTOS_POR_VIDA } from '../entidades/catalogo.js';

/** Quanto de pureza um Canto adiciona, e até onde ele sozinho consegue levar.
 *  A semente é o que leva a sala a 1 — o Canto só prepara o terreno. */
const GANHO_CANTO = 0.18;
const TETO_CANTO = 0.55;

export class Mundo {
  /**
   * @param {import('../core/laco.js').Camera} camera
   * @param {import('../core/laco.js').Laco} laco
   * @param {import('../render/renderizador.js').Renderizador} render
   */
  constructor(camera, laco, render) {
    this.camera = camera;
    this.laco = laco;
    this.render = render;

    this.jogador = new Jogador(0, 0);
    this.arteJogador = new ArteJogador();

    this.sala = null;
    this.arteTerreno = null;
    this.decor = null;
    this.entidades = [];
    this.particulas = [];

    /** salaId → 0..1 */
    this.pureza = new Map();

    /* Conjuntos de "isso já aconteceu". Todos persistem no save e são
       consultados por `criarEntidade` ao popular a sala, para que um objeto
       consumido não reapareça ao voltar. As chaves incluem a posição na
       grade, então são estáveis entre sessões sem precisar de ID por objeto. */
    this.sementesAtivadas = new Set();
    this.fragmentosColetados = new Set();
    this.barreirasQuebradas = new Set();

    /** Último ponto de salvamento tocado. */
    this.checkpoint = { sala: null, x: 0, y: 0 };

    this.trocandoDeSala = false;
    this._purezaExibida = 0;   // suavizada, é a que vai pro tema
    this.tema = resolver('raizes', 0);

    /** Ganchos preenchidos por outros sistemas (efeitos, áudio, HUD). */
    this.aoEvento = null;      // (evento) => void
    this.aoTrocarSala = null;  // (sala) => void
  }

  /* --------------------------------------------------------------- salas -- */

  entrarNaSala(id, ponto = null) {
    const sala = carregarSala(id);
    this.sala = sala;
    this.arteTerreno = new ArteTerreno(sala.terreno, sala.def.semente ?? 7);
    this.decor = new Decor(sala.terreno, sala.area, sala.def.semente ?? 7);
    sala.visitada = true;

    if (!this.pureza.has(id)) this.pureza.set(id, 0);

    this.entidades = [];
    this.particulas.length = 0;
    this._popular(sala);

    const p = ponto || sala.inicio;
    this.jogador.x = p.x - this.jogador.largura / 2;
    this.jogador.y = p.y - this.jogador.altura;
    this.jogador.vx = 0; this.jogador.vy = 0;

    this.camera.definirLimites(sala.limites);
    this.camera.encaixar(this.jogador.centroX, this.jogador.centroY);

    this._purezaExibida = this.purezaDaSala(id);
    this.aoTrocarSala?.(sala);
  }

  /** Ganchos de spawn — o agente de inimigos preenche `fabricaEntidade`. */
  _popular(sala) {
    for (const obj of sala.objetos) {
      if (obj.tipo === 'inicio' || obj.tipo.startsWith('porta-')) continue;
      const ent = this.fabricaEntidade?.(obj, this);
      if (ent) this.entidades.push(ent);
    }
  }

  /** Injetado de fora pra este módulo não depender do catálogo de inimigos. */
  fabricaEntidade = null;

  _tentarPorta() {
    if (this.trocandoDeSala || !this.sala) return;
    const j = this.jogador;
    const porta = this.sala.portaEm(j.centroX, j.centroY);
    if (!porta) return;
    const destino = this.sala.ligacoes[porta.tipo];
    if (!destino) return;

    this.trocandoDeSala = true;
    const idDestino = destino.sala;
    const portaChegada = destino.porta || PORTA_OPOSTA[porta.tipo];
    this._transicao?.(() => {
      const salaDest = carregarSala(idDestino);
      const ponto = salaDest.pontoDeEntrada(portaChegada);
      this.entrarNaSala(idDestino, ponto);
      this.trocandoDeSala = false;
    });
  }

  /** `main.js` injeta a função de fade. */
  _transicao = (cb) => cb();

  /* ----------------------------------------------------------- restauração -- */

  purezaDaSala(id) { return this.pureza.get(id) ?? 0; }

  purezaDaArea(areaId) {
    let soma = 0, n = 0;
    for (const [id, v] of this.pureza) {
      if (carregarSala(id).area === areaId) { soma += v; n++; }
    }
    return n ? soma / n : 0;
  }

  /** Média global — alimenta a floração do broto do Guardião. */
  get purezaGlobal() {
    if (!this.pureza.size) return 0;
    let soma = 0;
    for (const v of this.pureza.values()) soma += v;
    return soma / this.pureza.size;
  }

  /**
   * Ativa uma semente: a sala restaura ao longo de alguns segundos.
   * Não é instantâneo de propósito — o jogador precisa VER a cor subir.
   */
  ativarSemente(chave, salaId = this.sala?.id) {
    if (this.sementesAtivadas.has(chave)) return false;
    this.sementesAtivadas.add(chave);
    this._restaurando = { sala: salaId, de: this.purezaDaSala(salaId), para: 1, t: 0, dur: 2.6 };
    this.aoEvento?.({ tipo: 'semente', sala: salaId });
    return true;
  }

  /**
   * O Canto restaura PARCIALMENTE a sala em volta do jogador. Diferente da
   * semente (que leva a sala a 1), ele dá um empurrão pequeno e com teto —
   * senão o jogador cantaria em loop e restauraria o mundo inteiro parado num
   * canto, o que esvaziaria a exploração de sentido.
   */
  cantar(salaId = this.sala?.id) {
    const atual = this.purezaDaSala(salaId);
    if (atual >= TETO_CANTO) return false;
    const alvo = Math.min(TETO_CANTO, atual + GANHO_CANTO);
    this._restaurando = { sala: salaId, de: atual, para: alvo, t: 0, dur: 1.4 };
    return true;
  }

  coletarFragmento(chave) {
    if (this.fragmentosColetados.has(chave)) return false;
    this.fragmentosColetados.add(chave);
    const total = this.fragmentosColetados.size;
    const subiu = total % FRAGMENTOS_POR_VIDA === 0;
    if (subiu) {
      this.jogador.vidaMax++;
      this.jogador.curar(1);
    }
    this.aoEvento?.({
      tipo: 'fragmento', total,
      faltam: (FRAGMENTOS_POR_VIDA - (total % FRAGMENTOS_POR_VIDA)) % FRAGMENTOS_POR_VIDA,
      subiuVida: subiu,
    });
    return true;
  }

  /* ---------------------------------------------------------------- passo -- */

  atualizar(dt, entrada) {
    if (!this.sala) return;

    const j = this.jogador;
    j.atualizar(dt, entrada, this.sala.terreno);

    for (const ev of j.eventos) this.aoEvento?.(ev);

    // --- entidades ---
    const caixa = j.caixaAtaque();
    for (let i = this.entidades.length - 1; i >= 0; i--) {
      const e = this.entidades[i];
      e.atualizar?.(dt, this);
      if (e.morta) { this.entidades.splice(i, 1); continue; }
      if (caixa && e.caixa && !j.ataqueAcertou && sobrepoe(caixa, e.caixa())) {
        if (j.confirmarAcerto()) {
          e.receberDano?.(1, j.centroX, j.centroY, this);
          this.laco.congelar(0.055);
          this.camera.sacudir(0.24);
          this.render.sacudirCor(0.35);
        }
      }
      if (e.caixa && e.perigoso !== false && sobrepoe(caixaDe(j), e.caixa())) {
        j.receberDano(e.dano ?? 1, e.x ?? j.centroX, e.y ?? j.centroY);
      }
    }

    // --- partículas ---
    for (let i = this.particulas.length - 1; i >= 0; i--) {
      const p = this.particulas[i];
      p.t += dt;
      if (p.t >= p.vida) { this.particulas.splice(i, 1); continue; }
      p.vx *= Math.pow(p.arrasto ?? 0.4, dt);
      p.vy = p.vy * Math.pow(p.arrasto ?? 0.4, dt) + (p.g ?? 0) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    // --- restauração em andamento ---
    if (this._restaurando) {
      const r = this._restaurando;
      r.t += dt;
      const k = clamp01(r.t / r.dur);
      this.pureza.set(r.sala, lerp(r.de, r.para, k * k * (3 - 2 * k)));
      if (k >= 1) this._restaurando = null;
    }

    // --- tema ---
    const alvo = this.purezaDaSala(this.sala.id);
    this._purezaExibida = damp(this._purezaExibida, alvo, 0.25, dt);
    this.tema = resolver(this.sala.area, this._purezaExibida);
    this.arteJogador.definirFloracao(this.purezaGlobal);

    // --- morte / respawn ---
    if (!j.vivo && j.tempoNoEstado > 1.6) this.reviverNoCheckpoint();

    this._tentarPorta();
    this.camera.seguir(dt, { x: j.centroX, y: j.centroY, vx: j.vx });
  }

  /** Chamado fora do passo fixo — animação puramente visual. */
  atualizarApresentacao(dtReal) {
    this.arteJogador.atualizar(dtReal, this.jogador);
  }

  reviverNoCheckpoint() {
    const cp = this.checkpoint;
    if (cp.sala && cp.sala !== this.sala?.id) {
      this._transicao(() => {
        this.entrarNaSala(cp.sala, { x: cp.x, y: cp.y });
        this.jogador.reviver(cp.x - this.jogador.largura / 2, cp.y - this.jogador.altura);
      });
    } else {
      const p = cp.sala ? cp : this.sala.inicio;
      this._transicao(() => {
        this.jogador.reviver(p.x - this.jogador.largura / 2, p.y - this.jogador.altura);
        this.camera.encaixar(this.jogador.centroX, this.jogador.centroY);
      });
    }
  }

  definirCheckpoint(x, y) {
    this.checkpoint = { sala: this.sala.id, x, y };
    this.aoEvento?.({ tipo: 'checkpoint', x, y });
  }

  /* ------------------------------------------------------------ partículas -- */

  emitir(x, y, quantidade, opcoes = {}) {
    for (let i = 0; i < quantidade; i++) {
      const a = opcoes.angulo != null
        ? opcoes.angulo + (Math.random() - 0.5) * (opcoes.espalhamento ?? 1.2)
        : Math.random() * Math.PI * 2;
      const v = lerp(opcoes.velMin ?? 40, opcoes.velMax ?? 160, Math.random());
      this.particulas.push({
        x, y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        t: 0,
        vida: lerp(opcoes.vidaMin ?? 0.3, opcoes.vidaMax ?? 0.9, Math.random()),
        raio: lerp(opcoes.raioMin ?? 1, opcoes.raioMax ?? 3.5, Math.random()),
        g: opcoes.g ?? 300,
        arrasto: opcoes.arrasto ?? 0.25,
        cor: opcoes.cor ?? null,   // null = usa tema.particula
        brilha: opcoes.brilha ?? false,
      });
    }
  }

  /* ------------------------------------------------------------------ save -- */

  /**
   * Estado completo, pronto pro Firestore.
   *
   * Precisa conter TUDO que é permanente, e o teste é simples: se um objeto
   * consumido reaparecer depois de recarregar, faltou uma chave aqui. Foi o
   * caso de `fragmentos`/`barreiras` na primeira versão — a pureza voltava
   * certa, mas os fragmentos já coletados renasciam.
   */
  paraSave() {
    return {
      versao: 1,
      sala: this.sala?.id ?? null,
      jogador: this.jogador.paraSave(),
      pureza: Object.fromEntries(this.pureza),
      sementes: [...this.sementesAtivadas],
      fragmentos: [...this.fragmentosColetados],
      barreiras: [...this.barreirasQuebradas],
      checkpoint: this.checkpoint,
      dicas: this.dicasVistas ?? [],
    };
  }

  aplicarSave(dados) {
    if (!dados) return false;
    this.pureza = new Map(Object.entries(dados.pureza || {}));
    this.sementesAtivadas = new Set(dados.sementes || []);
    this.fragmentosColetados = new Set(dados.fragmentos || []);
    this.barreirasQuebradas = new Set(dados.barreiras || []);
    this.checkpoint = dados.checkpoint || this.checkpoint;
    this.dicasVistas = dados.dicas || [];

    // Renasce no último ponto de salvamento, não onde parou: é o contrato do
    // gênero, e evita restaurar o jogador no meio de uma queda ou dentro de
    // um chefe.
    const destino = dados.checkpoint?.sala || dados.sala;
    if (!destino) return false;

    // A vida máxima depende dos fragmentos, então tem que ser reaplicada
    // ANTES de entrar na sala (a UI lê `vidaMax` no primeiro quadro).
    this.jogador.aplicarSave(dados.jogador);
    this.entrarNaSala(destino, dados.checkpoint?.sala ? dados.checkpoint : null);
    this.jogador.aplicarSave(dados.jogador);   // `entrarNaSala` mexe em x/y
    return true;
  }
}

/* -------------------------------------------------------------------------
   `sobrepoe`/`caixaDe` moraram aqui e migraram para `core/mat.js` quando
   `mundo.js` passou a importar do catálogo de entidades — as entidades
   precisavam desses helpers e o ciclo de importação se fechava. Reexportados
   para não quebrar quem já importava daqui.
   ------------------------------------------------------------------------- */
export { sobrepoe, caixaDe } from '../core/mat.js';
