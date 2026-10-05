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
import { carregarSala, todasAsSalas, idsDeArea, PORTA_OPOSTA, definicaoSala } from './salas.js';
import { AREAS, resolver } from '../render/paleta.js';
import { ArteTerreno } from '../render/terreno-arte.js';
import { Decor } from '../render/decor.js';
import { Fauna } from '../render/fauna.js';
import { Jogador } from '../entidades/jogador.js';
import { ArteJogador } from '../entidades/jogador-arte.js';
import { FRAGMENTOS_POR_VIDA } from '../entidades/catalogo.js';

/** Tipos de objeto do mapa que contam como "parasita da área". */
const TIPOS_PARASITA = new Set([
  'parasita', 'voador', 'cuspidor', 'rastejante', 'explosivo', 'tecelao',
]);

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
    this.fauna = null;
    this.entidades = [];
    this.particulas = [];

    /** salaId → 0..1 */
    this.pureza = new Map();

    /* Conjuntos de "isso já aconteceu". Todos persistem no save e são
       consultados por `criarEntidade` ao popular a sala, para que um objeto
       consumido não reapareça ao voltar. As chaves incluem a posição na
       grade, então são estáveis entre sessões sem precisar de ID por objeto. */
    this.sementesAtivadas = new Set();
    /* Parasitas mortos, por `sala:cx,cy`.
       Existe porque a semente da área só abre com a área limpa, e sem
       persistir a morte "área limpa" nunca seria verdade: as criaturas
       renascem a cada `_popular`, então o jogador limparia a última sala e a
       primeira já estaria cheia de novo. Persistir a morte também é o que
       torna o objetivo legível — o contador só desce. */
    this.parasitasMortos = new Set();
    this._cacheVivos = new Map();   // area -> quantos faltam
    this._cacheSemente = new Map(); // area -> { sala, colhida } | null
    this.fragmentosColetados = new Set();
    this.barreirasQuebradas = new Set();
    /** Bichos presos que o Canto já soltou (entidades/perigos.js). */
    this.bichosSalvos = new Set();
    /** Salas cujo chefe já caiu. */
    this.chefesDerrotados = new Set();

    /** Último ponto de salvamento tocado. */
    this.checkpoint = { sala: null, x: 0, y: 0 };

    this.trocandoDeSala = false;
    this._revivendo = false;
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
    // O "último chão seguro" (volta do espinho) é da sala ANTERIOR: zera.
    this.jogador.chaoSeguro = null;
    this.jogador._voltaSegura = 0;
    // Depois do jogador posicionado: o bicho caído da sala é colocado perto
    // de onde ELE entrou, pra ser visto logo.
    this.fauna = new Fauna(sala.terreno, sala.area, sala.def.semente ?? 7,
      { x: this.jogador.centroX, y: this.jogador.pesY });

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
    // Morto não atravessa porta: o corpo caindo numa porta perto da hora de
    // renascer disparava duas transições e uma delas se perdia (preso morto,
    // ou nenhuma porta funcionando mais).
    if (!j.vivo || this._revivendo) return;
    const porta = this.sala.portaEm(j.centroX, j.centroY);
    // A porta por onde ele ACABOU de chegar só volta a valer depois que ele
    // sair do gatilho dela — rede de segurança contra pingue-pongue.
    if (porta !== this._portaDeChegada) this._portaDeChegada = null;
    if (!porta || porta === this._portaDeChegada) return;
    const destino = this.sala.ligacoes[porta.tipo];
    if (!destino) return;

    this.trocandoDeSala = true;
    const idDestino = destino.sala;
    const portaChegada = destino.porta || PORTA_OPOSTA[porta.tipo];
    this._transicao?.(() => {
      const salaDest = carregarSala(idDestino);
      const ponto = salaDest.pontoDeEntrada(portaChegada);
      this.entrarNaSala(idDestino, ponto);
      this._portaDeChegada = salaDest.objetos.find((o) => o.tipo === portaChegada) ?? null;
      // Subindo por um buraco, sai com impulso — senão cai de volta nele.
      if (portaChegada === 'porta-baixo') this.jogador.vy = -380;
      this.trocandoDeSala = false;
    });
  }

  /** `main.js` injeta a função de fade. */
  _transicao = (cb) => cb();

  /* ----------------------------------------------------------- restauração -- */

  /* ------------------------------------------------------ praga da área -- */

  /** Chave estável de um parasita: a sala mais a célula onde ele nasce. */
  static chaveParasita(salaId, cx, cy) { return `${salaId}:${cx},${cy}`; }

  parasitaEstaMorto(salaId, cx, cy) {
    return this.parasitasMortos.has(Mundo.chaveParasita(salaId, cx, cy));
  }

  registrarParasitaMorto(cx, cy, salaId = this.sala?.id) {
    if (!salaId) return;
    const area = this.sala?.area;
    // Anuncia só na PASSAGEM de "ainda tem" para "limpa" — não a cada morte
    // numa área que já estava limpa.
    const antes = area ? this.parasitasVivosNaArea(area) : 0;
    const chave = Mundo.chaveParasita(salaId, cx, cy);
    if (this.parasitasMortos.has(chave)) return;
    this.parasitasMortos.add(chave);
    this._cacheVivos.clear();
    if (area && antes > 0 && this.parasitasVivosNaArea(area) === 0) {
      this.aoEvento?.({ tipo: 'areaLimpa', area });
    }
  }

  /** Quantos parasitas ainda respiram numa sala. Usado pelo mapa. */
  parasitasVivosNaSala(salaId) {
    if (!salaId) return 0;
    let vivos = 0;
    for (const o of carregarSala(salaId).objetos) {
      if (!TIPOS_PARASITA.has(o.tipo)) continue;
      if (!this.parasitaEstaMorto(salaId, o.cx, o.cy)) vivos++;
    }
    return vivos;
  }

  /**
   * Quantos parasitas ainda respiram na área inteira.
   *
   * Varre a DEFINIÇÃO das salas, não as entidades vivas: só existe entidade
   * na sala em que o jogador está, e a pergunta é sobre a área toda. As salas
   * ficam em cache (`carregarSala`), então a varredura é barata; ainda assim
   * o resultado é memorizado e só se invalida quando alguém morre.
   */
  parasitasVivosNaArea(areaId) {
    if (this._cacheVivos.has(areaId)) return this._cacheVivos.get(areaId);
    let vivos = 0;
    for (const id of idsDeArea(areaId)) {
      for (const o of carregarSala(id).objetos) {
        if (!TIPOS_PARASITA.has(o.tipo)) continue;
        if (!this.parasitaEstaMorto(id, o.cx, o.cy)) vivos++;
      }
    }
    this._cacheVivos.set(areaId, vivos);
    return vivos;
  }

  /**
   * As sementes da área: `{ total, pendentes, sala, colhida }`, ou `null`
   * se a área não tem nenhuma. `colhida` só é verdade com TODAS colhidas, e
   * `sala` aponta a primeira que falta. (Uma versão anterior parava na
   * primeira semente achada — mas o Sub-bosque tem duas, em `raizes-01` e
   * `raizes-03`, e colher só uma das duas deixava o HUD e o mapa errados.)
   * Mesma varredura da definição das salas que `parasitasVivosNaArea`; o HUD
   * e o mapa perguntam isto todo quadro, então fica em cache até uma semente
   * abrir ou um save ser carregado.
   */
  sementeDaArea(areaId) {
    if (this._cacheSemente.has(areaId)) return this._cacheSemente.get(areaId);
    let total = 0, pendentes = 0, sala = null;
    for (const id of idsDeArea(areaId)) {
      for (const o of carregarSala(id).objetos) {
        if (o.tipo !== 'semente') continue;
        total++;
        // chave nova (`sala:cx,cy`) ou a antiga (`cx,cy`), como em catalogo.js
        const colhida = this.sementesAtivadas.has(`${id}:${o.cx},${o.cy}`)
          || this.sementesAtivadas.has(`${o.cx},${o.cy}`);
        if (!colhida) { pendentes++; sala ??= id; }
      }
    }
    const r = total ? { total, pendentes, sala, colhida: pendentes === 0 } : null;
    this._cacheSemente.set(areaId, r);
    return r;
  }

  purezaDaSala(id) { return this.pureza.get(id) ?? 0; }

  /* DENOMINADOR FIXO: todas as salas da área, não só as visitadas.
     O `Map` de pureza só ganha entrada quando o jogador PISA na sala, e as
     médias dividiam por quantas entradas existiam. Com uma sala visitada e
     restaurada a média dava 1; entrar na sala seguinte, ainda suja, derrubava
     pra 0,5 sem nada ter piorado. As marcas do Guardião (que leem
     `purezaGlobal`) e o mapa apagavam justamente quando o jogador explorava,
     que é o oposto do que a progressão devia comunicar. Com o registro
     inteiro no denominador a média só sobe. */
  purezaDaArea(areaId) {
    const ids = idsDeArea(areaId);
    if (!ids.length) return 0;
    let soma = 0;
    for (const id of ids) soma += this.pureza.get(id) ?? 0;
    return soma / ids.length;
  }

  /** Média global — alimenta a floração do broto do Guardião. */
  get purezaGlobal() {
    const todas = todasAsSalas();
    if (!todas.length) return 0;
    let soma = 0;
    for (const d of todas) soma += this.pureza.get(d.id) ?? 0;
    return soma / todas.length;
  }

  /**
   * Ativa uma semente: a sala restaura ao longo de alguns segundos.
   * Não é instantâneo de propósito — o jogador precisa VER a cor subir.
   */
  ativarSemente(chave, salaId = this.sala?.id, x = null, y = null) {
    if (this.sementesAtivadas.has(chave)) return false;
    this.sementesAtivadas.add(chave);
    this._cacheSemente.clear();
    this._restaurando = { sala: salaId, de: this.purezaDaSala(salaId), para: 1, t: 0, dur: 2.6 };
    // A posição vai junto: quem desenha o efeito precisa saber DE ONDE a
    // restauração sai. Sem isso a onda nasceria no jogador, e o momento é da
    // semente, não dele.
    this.aoEvento?.({
      tipo: 'semente', sala: salaId,
      x: x ?? this.jogador.centroX, y: y ?? this.jogador.centroY,
      area: this.sala?.area,
    });
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
    // Não atropela uma restauração MAIOR em andamento (a da semente): cantar
    // no meio dela a interrompia em 0,28 pra sempre, com a semente já gasta.
    const r = this._restaurando;
    if (r && r.sala === salaId && r.para >= alvo) return false;
    this._restaurando = { sala: salaId, de: atual, para: alvo, t: 0, dur: 1.4 };
    return true;
  }

  /** O golpe tem 46 px de alcance — mais que um tile. Sem esta checagem a
   *  espada acertava o que estava do OUTRO lado de uma parede fina. */
  _semParedeEntre(x0, y0, c) {
    const t = this.sala?.terreno;
    if (!t) return true;
    const x1 = c.x + c.largura / 2, y1 = c.y + c.altura / 2;
    for (let i = 1; i < 6; i++) {
      const k = i / 6;
      if (t.solido(Math.floor(lerp(x0, x1, k) / t.tile), Math.floor(lerp(y0, y1, k) / t.tile))) return false;
    }
    return true;
  }

  salvarBicho(chave) {
    if (this.bichosSalvos.has(chave)) return false;
    this.bichosSalvos.add(chave);
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

    // (Os eventos do jogador são despachados no FIM do passo — ver lá.)

    // --- entidades ---
    const caixa = j.caixaAtaque();
    for (let i = this.entidades.length - 1; i >= 0; i--) {
      const e = this.entidades[i];
      e.atualizar?.(dt, this);
      if (e.morta) { this.entidades.splice(i, 1); continue; }
      // `alvoDeGolpe: false` — perigo de cenário (fogo, galho, bicho preso):
      // tem caixa pra FERIR, mas não pode consumir o golpe da espada. Sem isso
      // o golpe batia no fogo primeiro, tocava o feedback de acerto e o
      // parasita ao lado saía ileso.
      // Só é ALVO quem pode levar golpe (`receberDano`) e ainda não está
      // morrendo: ponto de salvamento, semente, altar, fonte ou um parasita
      // já se desfazendo ficavam com o golpe e o inimigo ao lado saía ileso.
      if (caixa && e.caixa && typeof e.receberDano === 'function' && e.alvoDeGolpe !== false
        && !(e.morrendo > 0) && !j.ataqueAcertou && sobrepoe(caixa, e.caixa())
        && this._semParedeEntre(j.centroX, j.centroY, e.caixa())) {
        if (j.confirmarAcerto()) {
          e.receberDano?.(1, j.centroX, j.centroY, this);
          this.laco.congelar(0.055);
          this.camera.sacudir(0.24);
          this.render.sacudirCor(0.35);
        }
      }
      if (e.caixa && e.perigoso !== false) {
        const ce = e.caixa();
        if (sobrepoe(caixaDe(j), ce)) {
          // Recuo a partir do CENTRO de quem fere. Com o canto superior
          // esquerdo (`e.x`), quem encostava pela esquerda de um chefe era
          // empurrado PRA DENTRO dele.
          j.receberDano(e.dano ?? 1, ce.x + ce.largura / 2, ce.y + ce.altura / 2);
        }
      }
    }

    /* --- sufoco (fumaça tóxica, entidades/perigos.js) ---
       Cada bolsão SOBE o medidor enquanto o Guardião está nele; aqui, uma vez
       por passo, ele desce do lado de fora e cobra a máscara quando enche.
       Sem empurrão: sufocar não é ser golpeado. */
    if (j.naFumaca) {
      // Bolsões sobrepostos NÃO somam: vale o mais denso (cada um só informa
      // a própria taxa). Somando, dois juntos sufocavam no dobro da pressa.
      j.sufoco = Math.min(1, (j.sufoco ?? 0) + dt * (j.sufocoTaxa ?? 0));
      // Só alivia se a máscara foi cobrada de fato — invulnerável (acabou de
      // levar outro golpe neste passo), o medidor espera cheio.
      if (j.sufoco >= 1 && j.receberDano(1, j.centroX, j.centroY, { fonte: 'fumaca', recuo: false })) {
        j.sufoco = 0.45;
      }
    } else {
      j.sufoco = Math.max(0, (j.sufoco ?? 0) - dt * 0.45);
    }
    j.naFumaca = false;
    j.sufocoTaxa = 0;

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

    /* EVENTOS DO JOGADOR, no fim do passo. Eram despachados logo depois de
       `jogador.atualizar` — e tudo o que acontece DEPOIS disso no mesmo passo
       (dano por contato, projétil, fogo, sufoco, acerto da espada, morte) era
       apagado pelo próximo `atualizar` antes de alguém ver: dano sem flash,
       sem som, sem tela de morte. */
    for (const ev of j.eventos) {
      // O Canto restaura um pouco a sala — `cantar()` existia e ninguém chamava.
      if (ev.tipo === 'canto') this.cantar();
      this.aoEvento?.(ev);
    }
    j.eventos.length = 0;
  }

  /** Chamado fora do passo fixo — animação puramente visual. */
  atualizarApresentacao(dtReal, pausado = false) {
    this.arteJogador.atualizar(dtReal, this.jogador);
    /* As aves reagem ao jogador, mas são apresentação: andam no tempo real,
       não no passo fixo. E PARAM com a pausa, o mapa e a tela de abertura —
       senão o pânico aleatório seguia sorteando com o jogo parado (em dois
       minutos de pausa quase toda ave da sala suja fugia pra sempre) e a
       carência de entrada passava inteira atrás da tela de abertura. */
    if (this.sala && !pausado) this.fauna?.atualizar(dtReal, this.jogador, this._purezaExibida);
  }

  /**
   * Renascer no checkpoint.
   *
   * O guarda `_revivendo` NÃO é preciosismo: `atualizar` chama isto a cada
   * passo enquanto o jogador está morto, e `Transicao.cortar` zera o próprio
   * relógio a cada chamada. Com 120 passos por segundo zerando e um único
   * `atualizar(dtReal)` por quadro avançando, o fade NUNCA chegava ao fim — o
   * jogo travava de vez na tela escura depois de qualquer morte. É o mesmo
   * padrão do `trocandoDeSala` em `_tentarPorta`, que já existia aqui do lado.
   */
  reviverNoCheckpoint() {
    if (this._revivendo) return;
    this._revivendo = true;
    const cp = this.checkpoint;
    if (cp.sala && cp.sala !== this.sala?.id) {
      this._transicao(() => {
        this.entrarNaSala(cp.sala, { x: cp.x, y: cp.y });
        this.jogador.reviver(cp.x - this.jogador.largura / 2, cp.y - this.jogador.altura);
        this._revivendo = false;
      });
    } else if (!cp.sala) {
      /* Sem checkpoint ainda (antes do primeiro ponto de salvamento): volta ao
         começo do jogo. O `inicio` de uma sala sem '@' é o CENTRO dela — o
         Guardião renascia no ar, às vezes em cima de um poço. */
      this._transicao(() => {
        const inicial = 'raizes-01';
        if (this.sala?.id !== inicial) this.entrarNaSala(inicial);
        const p = this.sala.inicio;
        this.jogador.reviver(p.x - this.jogador.largura / 2, p.y - this.jogador.altura);
        this.camera.encaixar(this.jogador.centroX, this.jogador.centroY);
        this._revivendo = false;
      });
    } else {
      const p = cp;
      this._transicao(() => {
        this.jogador.reviver(p.x - this.jogador.largura / 2, p.y - this.jogador.altura);
        this.camera.encaixar(this.jogador.centroX, this.jogador.centroY);
        this._revivendo = false;
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
    /* A restauração em curso vai pro save JÁ no valor final: a semente grava
       no instante em que é ativada, antes dos 2,6 s de animação, e um save
       com a pureza do meio do caminho deixava a sala suja pra sempre (a
       semente já consta como gasta). */
    const r = this._restaurando;
    const pureza = Object.fromEntries([...this.pureza].map(([k, v]) =>
      [k, r && r.sala === k ? Math.max(v, r.para) : v]));
    return {
      versao: 1,
      salvoEm: Date.now(),
      sala: this.sala?.id ?? null,
      jogador: this.jogador.paraSave(),
      pureza,
      sementes: [...this.sementesAtivadas],
      parasitas: [...this.parasitasMortos],
      fragmentos: [...this.fragmentosColetados],
      barreiras: [...this.barreirasQuebradas],
      bichos: [...this.bichosSalvos],
      chefes: [...this.chefesDerrotados],
      checkpoint: this.checkpoint,
      dicas: this.dicasVistas ?? [],
    };
  }

  aplicarSave(dados) {
    if (!dados || typeof dados !== 'object') return false;
    /* SAVE DESCONFIADO. Um save antigo ou corrompido (sala que deixou de
       existir, campo com o tipo errado) lançava no meio da carga: o mundo
       ficava meio aplicado e nada mais era salvo na sessão. Aqui cada campo
       é conferido e o que não presta é descartado. */
    const lista = (v) => (Array.isArray(v) ? v.filter((k) => typeof k === 'string') : []);
    const pares = (v) => (v && typeof v === 'object' && !Array.isArray(v)
      ? Object.entries(v).filter(([k, x]) => definicaoSala(k) && Number.isFinite(x)).map(([k, x]) => [k, clamp01(x)])
      : []);
    this.pureza = new Map(pares(dados.pureza));
    this.sementesAtivadas = new Set(lista(dados.sementes));
    this._cacheSemente.clear();
    this.parasitasMortos = new Set(lista(dados.parasitas));
    this._cacheVivos.clear();
    this.fragmentosColetados = new Set(lista(dados.fragmentos));
    this.barreirasQuebradas = new Set(lista(dados.barreiras));
    this.bichosSalvos = new Set(lista(dados.bichos));
    this.chefesDerrotados = new Set(lista(dados.chefes));
    const cp = dados.checkpoint;
    const cpValido = !!(cp && definicaoSala(cp.sala) && Number.isFinite(cp.x) && Number.isFinite(cp.y));
    this.checkpoint = cpValido ? { sala: cp.sala, x: cp.x, y: cp.y } : { sala: null, x: 0, y: 0 };
    this.dicasVistas = lista(dados.dicas);

    /* Renasce no último ponto de salvamento, não onde parou: é o contrato do
       gênero, e evita restaurar o jogador no meio de uma queda ou dentro de
       um chefe. Sem ponto de salvamento, do começo do jogo — nunca na posição
       gravada, que é de OUTRA sala (o save acontece em qualquer lugar: o
       Guardião aparecia fora do mapa, preso). */
    const destino = cpValido ? cp.sala : 'raizes-01';

    // A vida máxima depende dos fragmentos, então tem que ser reaplicada
    // ANTES de entrar na sala (a UI lê `vidaMax` no primeiro quadro).
    this.jogador.aplicarSave(dados.jogador);
    this.entrarNaSala(destino, cpValido ? this.checkpoint : null);
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
