/* =========================================================================
   fase2/mundo/salas.js — formato de sala, parser e registro
   -------------------------------------------------------------------------
   Uma sala é escrita em ASCII. Isso não é preguiça: mapa em texto é
   editável por qualquer um, o diff no git mostra a mudança de layout de
   forma legível, e dá pra ver a sala inteira sem abrir o jogo.

   Caracteres de TERRENO (ver mundo/terreno.js):
     #  sólido      =  plataforma (atravessa por baixo)
     ^  perigo      ~  água        .  vazio

   Caracteres de OBJETO (viram VAZIO no terreno + geram uma entidade):
     @  ponto de início / respawn        o  semente (restaura a sala)
     e  parasita comum                   v  parasita voador
     c  parasita cuspidor                B  arena de chefe
     !  altar de habilidade              +  fonte de vida
     $  fragmento (coletável)            S  ponto de salvamento
     >  porta pra direita                <  porta pra esquerda
     ^^ (ver perigo)                     ¨  porta pra cima     _  porta pra baixo

   Cada objeto vira { tipo, x, y } em coordenadas de PIXEL já centradas no
   tile — nenhum sistema precisa saber que existiu um grid.
   ========================================================================= */

import { Terreno, TILE, normalizarMapa } from './terreno.js';

/**
 * char → tipo de entidade. Tudo aqui vira VAZIO no terreno.
 *
 * Este conjunto é CONGELADO: o desenhista de salas e o autor de inimigos
 * dependem os dois dele. Precisa de um símbolo novo? Adicione aqui primeiro e
 * avise os dois lados — inventar um char só num dos mapas produz uma sala que
 * carrega em silêncio com um buraco no lugar do inimigo.
 */
export const LEGENDA_OBJETOS = {
  '@': 'inicio',
  'o': 'semente',       // restaura a sala — o objetivo de cada área
  'S': 'salvamento',    // checkpoint + cura
  '!': 'altar',         // destrava habilidade
  '+': 'fonte',         // cura pontual
  '$': 'fragmento',     // coletável (aumenta vida máxima a cada 4)
  'l': 'lapide',        // pedra de lore, sem efeito mecânico

  // --- inimigos ---
  'e': 'parasita',      // andarilho comum
  'v': 'voador',        // persegue em linha, ignora terreno
  'c': 'cuspidor',      // fixo, atira projétil
  'r': 'rastejante',    // rápido e frágil, anda por parede/teto
  'x': 'explosivo',     // corre até o jogador e estoura
  'w': 'tecelao',       // ancorado no teto, desce em fio
  'B': 'chefe',         // arena de chefe (a sala define QUAL em `def.chefe`)

  // --- travas de progressão ---
  'g': 'portao',        // exige a habilidade dita em `def.portoes`
  'b': 'barreira',      // matéria corrompida, só quebra com o Canto

  // --- portas entre salas ---
  '>': 'porta-dir',
  '<': 'porta-esq',
  '¨': 'porta-cima',
  '_': 'porta-baixo',
};

/**
 * Definições cruas. Cada uma vira uma `Sala` sob demanda (só a sala atual e
 * as vizinhas ficam instanciadas — o resto é só texto na memória).
 * @type {Map<string, object>}
 */
const REGISTRO = new Map();

/**
 * @param {object} def
 * @param {string} def.id            único no jogo inteiro
 * @param {string} def.area          chave de AREAS (render/paleta.js)
 * @param {string[]} def.mapa        linhas ASCII
 * @param {object} [def.ligacoes]    nomeDaPorta → { sala, porta } de destino
 * @param {object} [def.luzes]       focos fixos: [{x,y,raio,intensidade,cor}]
 * @param {string} [def.titulo]      nome mostrado ao entrar (só nas salas-marco)
 * @param {number} [def.semente]     varia a ondulação do contorno
 */
export function registrarSala(def) {
  if (REGISTRO.has(def.id)) throw new Error(`Sala duplicada: ${def.id}`);
  if (!def.area) throw new Error(`Sala ${def.id} sem área`);
  REGISTRO.set(def.id, def);
  return def;
}

export function definicaoSala(id) { return REGISTRO.get(id); }
export function todasAsSalas() { return [...REGISTRO.values()]; }
export function idsDeArea(area) {
  return [...REGISTRO.values()].filter((d) => d.area === area).map((d) => d.id);
}

/* ------------------------------------------------------------------------- */

export class Sala {
  constructor(def) {
    this.def = def;
    this.id = def.id;
    this.area = def.area;
    this.titulo = def.titulo || null;
    this.ligacoes = def.ligacoes || {};

    const linhas = normalizarMapa(def.mapa);
    this.objetos = [];

    // Extrai objetos e substitui por vazio ANTES de montar o terreno.
    const limpo = linhas.map((linha, y) =>
      [...linha].map((ch, x) => {
        const tipo = LEGENDA_OBJETOS[ch];
        if (!tipo) return ch;
        this.objetos.push({
          tipo,
          // Centro horizontal do tile, base no chão do tile: é onde uma
          // entidade "de pé" deve nascer sem ficar meio enterrada.
          x: x * TILE + TILE / 2,
          y: y * TILE + TILE,
          cx: x, cy: y,
        });
        return '.';
      }).join('')
    );

    this.terreno = new Terreno(limpo, { semente: def.semente ?? hashId(def.id) });
    this.largura = this.terreno.larguraPx;
    this.altura = this.terreno.alturaPx;

    this.luzes = def.luzes || [];
    this.portas = this.objetos.filter((o) => o.tipo.startsWith('porta-'));
    this.inicio = this.objetos.find((o) => o.tipo === 'inicio') || {
      x: this.largura / 2, y: this.altura / 2,
    };

    /** Estado mutável de sessão (não persiste) — preenchido pelo mundo. */
    this.entidades = [];
    this.visitada = false;
  }

  get limites() {
    return { x: 0, y: 0, largura: this.largura, altura: this.altura };
  }

  /** Objetos de um tipo, já em px. */
  objetosDe(tipo) { return this.objetos.filter((o) => o.tipo === tipo); }

  /**
   * Porta cuja caixa contém o ponto. Usada pra detectar transição de sala.
   * A caixa é generosa (1 tile de folga) — porta apertada faz o jogador
   * "quicar" na borda sem entender por quê.
   */
  portaEm(x, y) {
    for (const p of this.portas) {
      if (Math.abs(x - p.x) < TILE * 1.1 && Math.abs(y - p.y + TILE / 2) < TILE * 1.6) return p;
    }
    return null;
  }

  /** Onde nascer ao entrar por uma porta vinda de outra sala. */
  pontoDeEntrada(nomePorta) {
    const p = this.objetos.find((o) => o.tipo === nomePorta);
    if (!p) return { x: this.inicio.x, y: this.inicio.y };
    // Entra empurrado 1 tile pra dentro, senão a detecção de porta dispara de
    // novo no mesmo frame e o jogador pinga entre as duas salas.
    const desloc = nomePorta === 'porta-dir' ? -TILE * 1.3
      : nomePorta === 'porta-esq' ? TILE * 1.3
      : 0;
    const deslocY = nomePorta === 'porta-cima' ? TILE * 1.3
      : nomePorta === 'porta-baixo' ? -TILE * 1.3
      : 0;
    return { x: p.x + desloc, y: p.y + deslocY };
  }
}

/** Porta oposta — o par natural ao atravessar. */
export const PORTA_OPOSTA = {
  'porta-dir': 'porta-esq',
  'porta-esq': 'porta-dir',
  'porta-cima': 'porta-baixo',
  'porta-baixo': 'porta-cima',
};

const _cacheSalas = new Map();
export function carregarSala(id) {
  if (_cacheSalas.has(id)) return _cacheSalas.get(id);
  const def = REGISTRO.get(id);
  if (!def) throw new Error(`Sala não registrada: ${id}`);
  const sala = new Sala(def);
  _cacheSalas.set(id, sala);
  return sala;
}

export function limparCacheSalas() { _cacheSalas.clear(); }

function hashId(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* =========================================================================
   Validação — roda uma vez na carga e falha alto.
   Erro de ligação de porta em metroidvania é o bug mais chato de achar
   jogando (você só descobre quando cai numa sala sem saída), então é melhor
   quebrar no console na hora do que depois.
   ========================================================================= */
export function validarRegistro() {
  const problemas = [];
  for (const def of REGISTRO.values()) {
    const sala = new Sala(def);
    const nomesPortas = new Set(sala.portas.map((p) => p.tipo));

    for (const [nome, destino] of Object.entries(sala.ligacoes)) {
      if (!nomesPortas.has(nome)) {
        problemas.push(`${def.id}: ligação "${nome}" não tem porta correspondente no mapa`);
      }
      if (!REGISTRO.has(destino.sala)) {
        problemas.push(`${def.id}: ligação "${nome}" aponta pra sala inexistente "${destino.sala}"`);
        continue;
      }
      // A sala de destino tem a porta de chegada?
      const destSala = new Sala(REGISTRO.get(destino.sala));
      const portaChegada = destino.porta || PORTA_OPOSTA[nome];
      if (!destSala.portas.some((p) => p.tipo === portaChegada)) {
        problemas.push(`${def.id} → ${destino.sala}: sala de destino não tem "${portaChegada}"`);
      }
    }
    for (const nome of nomesPortas) {
      if (!sala.ligacoes[nome]) problemas.push(`${def.id}: porta "${nome}" no mapa sem ligação definida`);
    }
    if (!def.mapa.length) problemas.push(`${def.id}: mapa vazio`);
  }
  return problemas;
}
