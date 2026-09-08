/* =========================================================================
   fase2/mundo/terreno.js — colisão em grade + contorno orgânico
   -------------------------------------------------------------------------
   A decisão de arquitetura mais importante da Fase 2 está aqui.

   O terreno é uma GRADE DE TILES pra colisão (rápida, previsível, sem
   tunelamento, trivial de editar à mão em ASCII) — mas NUNCA é desenhado
   como quadradinhos. O desenho vem de `contornos()`, que extrai a fronteira
   sólido/vazio (marching squares por arestas), simplifica com
   Douglas-Peucker e suaviza com Catmull-Rom, virando curvas contínuas.

   Resultado: a física é de grade (confiável) e a silhueta é de traço à mão
   (Ori/Hollow Knight). Tentar o contrário — colidir contra polígonos
   suavizados — traz bug de canto, jitter em rampa e custo de CPU por nada.
   ========================================================================= */

import {
  fundirColineares, reamostrarCaminho, chaikin, areaPoligono, ruido1, clamp,
} from '../core/mat.js';

export const TILE = 32;

// Tipos de célula. Guardados num Uint8Array — 1 byte por tile.
export const VAZIO = 0;
export const SOLIDO = 1;
export const PLATAFORMA = 2;   // atravessa por baixo, apoia por cima
export const PERIGO = 3;       // espinho de escória / poça ácida
export const AGUA = 4;         // nado/flutuação lentos

/** char do mapa ASCII → tipo de célula. Qualquer outro char vira VAZIO. */
export const LEGENDA = {
  '#': SOLIDO,
  'X': SOLIDO,
  '=': PLATAFORMA,
  '^': PERIGO,
  '~': AGUA,
  '.': VAZIO,
  ' ': VAZIO,
};

const ehBloqueante = (t) => t === SOLIDO;

export class Terreno {
  /**
   * @param {string[]} linhas  linhas de igual comprimento (ver LEGENDA)
   * @param {object}  [opcoes]
   * @param {number}  [opcoes.tile=TILE]
   * @param {number}  [opcoes.semente=1]  varia a ondulação do contorno
   */
  constructor(linhas, { tile = TILE, semente = 1 } = {}) {
    this.tile = tile;
    this.semente = semente;
    this.altura = linhas.length;
    this.largura = Math.max(...linhas.map((l) => l.length));
    this.dados = new Uint8Array(this.largura * this.altura);

    for (let y = 0; y < this.altura; y++) {
      const linha = linhas[y];
      for (let x = 0; x < linha.length; x++) {
        this.dados[y * this.largura + x] = LEGENDA[linha[x]] ?? VAZIO;
      }
    }

    this.larguraPx = this.largura * tile;
    this.alturaPx = this.altura * tile;
    this._contornos = null;
    this._path = null;
  }

  // ------------------------------------------------------------- consultas --
  emGrade(cx, cy) {
    return cx >= 0 && cy >= 0 && cx < this.largura && cy < this.altura;
  }

  /** Fora do mapa conta como SÓLIDO — impede sair voando pela borda da sala. */
  em(cx, cy) {
    if (!this.emGrade(cx, cy)) return SOLIDO;
    return this.dados[cy * this.largura + cx];
  }

  /** Tipo na posição em PIXELS de mundo. */
  emPx(x, y) {
    return this.em(Math.floor(x / this.tile), Math.floor(y / this.tile));
  }

  solido(cx, cy) { return ehBloqueante(this.em(cx, cy)); }

  /**
   * Solidez para DESENHO, não para colisão.
   *
   * `solido()` trata fora-do-mapa como sólido de propósito (impede sair
   * voando pela borda da sala). Se o extrator de contorno usar a mesma regra,
   * a fileira da borda nunca gera aresta — o contorno externo do mapa some, e
   * com winding nonzero o preenchimento sai INVERTIDO: a caverna vira rocha e
   * a rocha some. Bug real, corrigido aqui; não unificar as duas funções.
   */
  _solidoVisual(cx, cy) {
    return this.emGrade(cx, cy) && ehBloqueante(this.dados[cy * this.largura + cx]);
  }

  /** `_solidoVisual` em coordenadas de PIXEL. */
  _solidoVisualPx(x, y) {
    return this._solidoVisual(Math.floor(x / this.tile), Math.floor(y / this.tile));
  }

  definir(cx, cy, tipo) {
    if (!this.emGrade(cx, cy)) return;
    this.dados[cy * this.largura + cx] = tipo;
    this._contornos = null;   // invalida o cache do desenho
    this._path = null;
    this._cacheArestas = null;
  }

  /** Existe algum tile do tipo em qualquer célula tocada pela caixa? */
  caixaToca(x, y, largura, altura, tipo) {
    const x0 = Math.floor(x / this.tile), x1 = Math.floor((x + largura - 1) / this.tile);
    const y0 = Math.floor(y / this.tile), y1 = Math.floor((y + altura - 1) / this.tile);
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++)
        if (this.em(cx, cy) === tipo) return true;
    return false;
  }

  caixaSolida(x, y, largura, altura) {
    const x0 = Math.floor(x / this.tile), x1 = Math.floor((x + largura - 1) / this.tile);
    const y0 = Math.floor(y / this.tile), y1 = Math.floor((y + altura - 1) / this.tile);
    for (let cy = y0; cy <= y1; cy++)
      for (let cx = x0; cx <= x1; cx++)
        if (this.solido(cx, cy)) return true;
    return false;
  }

  /* ---------------------------------------------------------------------
     MOVIMENTO COM COLISÃO
     ---------------------------------------------------------------------
     Eixos resolvidos separadamente (X depois Y) — o jeito padrão e correto
     em plataforma de grade: resolver os dois juntos gera o clássico "prende
     no canto" ao raspar numa quina enquanto anda.

     `corpo` = { x, y, largura, altura, vx, vy } e é MUTADO no lugar.
     Devolve flags do que foi tocado neste passo.
     --------------------------------------------------------------------- */
  mover(corpo, dx, dy, { atravessaPlataforma = false } = {}) {
    const res = { chao: false, teto: false, paredeEsq: false, paredeDir: false, plataforma: false };

    // --- X ---
    if (dx !== 0) {
      corpo.x += dx;
      const y0 = Math.floor(corpo.y / this.tile);
      const y1 = Math.floor((corpo.y + corpo.altura - 1) / this.tile);
      if (dx > 0) {
        const cx = Math.floor((corpo.x + corpo.largura - 1) / this.tile);
        for (let cy = y0; cy <= y1; cy++) {
          if (this.solido(cx, cy)) {
            corpo.x = cx * this.tile - corpo.largura;
            corpo.vx = 0;
            res.paredeDir = true;
            break;
          }
        }
      } else {
        const cx = Math.floor(corpo.x / this.tile);
        for (let cy = y0; cy <= y1; cy++) {
          if (this.solido(cx, cy)) {
            corpo.x = (cx + 1) * this.tile;
            corpo.vx = 0;
            res.paredeEsq = true;
            break;
          }
        }
      }
    }

    // --- Y ---
    if (dy !== 0) {
      const pesEmCimaAntes = corpo.y + corpo.altura;
      corpo.y += dy;
      const x0 = Math.floor(corpo.x / this.tile);
      const x1 = Math.floor((corpo.x + corpo.largura - 1) / this.tile);

      if (dy > 0) {   // caindo
        const cy = Math.floor((corpo.y + corpo.altura - 1) / this.tile);
        for (let cx = x0; cx <= x1; cx++) {
          const t = this.em(cx, cy);
          const ehPlat = t === PLATAFORMA;
          // Plataforma só apoia se os pés estavam ACIMA do topo dela antes do
          // passo — senão o jogador subindo por baixo é teleportado pra cima.
          const podeApoiarPlat = ehPlat && !atravessaPlataforma && pesEmCimaAntes <= cy * this.tile + 1;
          if (ehBloqueante(t) || podeApoiarPlat) {
            corpo.y = cy * this.tile - corpo.altura;
            corpo.vy = 0;
            res.chao = true;
            res.plataforma = ehPlat;
            break;
          }
        }
      } else {        // subindo
        const cy = Math.floor(corpo.y / this.tile);
        for (let cx = x0; cx <= x1; cx++) {
          if (this.solido(cx, cy)) {
            corpo.y = (cy + 1) * this.tile;
            corpo.vy = 0;
            res.teto = true;
            break;
          }
        }
      }
    }

    return res;
  }

  /** Há chão sólido/plataforma logo abaixo da caixa? (tolerância em px) */
  noChao(corpo, tolerancia = 2) {
    const y = corpo.y + corpo.altura + tolerancia - 1;
    const cy = Math.floor(y / this.tile);
    const x0 = Math.floor(corpo.x / this.tile);
    const x1 = Math.floor((corpo.x + corpo.largura - 1) / this.tile);
    for (let cx = x0; cx <= x1; cx++) {
      const t = this.em(cx, cy);
      if (ehBloqueante(t)) return true;
      if (t === PLATAFORMA && corpo.y + corpo.altura <= cy * this.tile + tolerancia) return true;
    }
    return false;
  }

  /** Distância em px até o chão abaixo de um ponto (Infinity se não houver). */
  alturaAteChao(x, y, maxTiles = 40) {
    let cx = Math.floor(x / this.tile);
    let cy = Math.floor(y / this.tile);
    for (let i = 0; i < maxTiles; i++, cy++) {
      const t = this.em(cx, cy);
      if (ehBloqueante(t) || t === PLATAFORMA) return cy * this.tile - y;
    }
    return Infinity;
  }

  /* ---------------------------------------------------------------------
     CONTORNOS — a fronteira sólido/vazio como curvas fechadas
     --------------------------------------------------------------------- */

  /**
   * @returns {{pontos:{x,y}[], externo:boolean}[]} caminhos em px de mundo,
   *   já simplificados e suavizados. Cache invalidado por `definir()`.
   */
  contornos() {
    if (this._contornos) return this._contornos;

    // 1. Arestas dirigidas na fronteira, orientadas pra encadear sozinhas.
    //    Chave "x,y" do ponto inicial → ponto final. Um mesmo ponto pode ser
    //    início de mais de uma aresta em cantos diagonais, daí a lista.
    const arestas = new Map();
    const chave = (x, y) => x + ',' + y;
    const add = (ax, ay, bx, by) => {
      const k = chave(ax, ay);
      const lista = arestas.get(k);
      if (lista) lista.push({ x: bx, y: by });
      else arestas.set(k, [{ x: bx, y: by }]);
    };

    for (let y = 0; y < this.altura; y++) {
      for (let x = 0; x < this.largura; x++) {
        if (!this._solidoVisual(x, y)) continue;
        // Orientação escolhida pra que o sólido fique sempre do mesmo lado;
        // com isso as arestas de células vizinhas se emendam ponta a ponta.
        if (!this._solidoVisual(x, y - 1)) add(x + 1, y, x, y);           // topo
        if (!this._solidoVisual(x, y + 1)) add(x, y + 1, x + 1, y + 1);   // base
        if (!this._solidoVisual(x - 1, y)) add(x, y, x, y + 1);           // esquerda
        if (!this._solidoVisual(x + 1, y)) add(x + 1, y + 1, x + 1, y);   // direita
      }
    }

    // 2. Encadeia arestas em laços fechados.
    //
    //    Num ponto onde DUAS células sólidas se tocam só pela diagonal, saem
    //    duas arestas do mesmo vértice. Escolher qualquer uma (era `pop()`)
    //    funde os dois contornos num laço em forma de oito — foi exatamente
    //    isso que produzia uma faixa diagonal gigante atravessando a sala.
    //
    //    Correção: ao chegar num vértice, seguir pela aresta de CURVA MAIS
    //    FECHADA À DIREITA em relação à direção de chegada. Isso mantém o
    //    traçado colado na célula atual e trata contato diagonal como NÃO
    //    conectado — que é como a colisão por eixos separados já se comporta,
    //    então desenho e física concordam.
    const laços = [];
    while (arestas.size) {
      const primeiraChave = arestas.keys().next().value;
      const [px, py] = primeiraChave.split(',').map(Number);
      const laco = [{ x: px, y: py }];
      let atualX = px, atualY = py;
      let dirX = 0, dirY = 0;   // direção de chegada; 0,0 no primeiro passo

      for (let guarda = 0; guarda < 500000; guarda++) {
        const k = chave(atualX, atualY);
        const lista = arestas.get(k);
        if (!lista || !lista.length) break;

        let escolhido = 0;
        if (lista.length > 1 && (dirX !== 0 || dirY !== 0)) {
          let melhorAng = Infinity;
          for (let i = 0; i < lista.length; i++) {
            const ox = lista[i].x - atualX, oy = lista[i].y - atualY;
            // Ângulo com sinal entre a direção de chegada e a de saída.
            const cruz = dirX * oy - dirY * ox;
            const escalar = dirX * ox + dirY * oy;
            const ang = Math.atan2(cruz, escalar);
            if (ang < melhorAng) { melhorAng = ang; escolhido = i; }
          }
        }

        const prox = lista.splice(escolhido, 1)[0];
        if (!lista.length) arestas.delete(k);
        dirX = prox.x - atualX; dirY = prox.y - atualY;
        atualX = prox.x; atualY = prox.y;
        if (atualX === px && atualY === py) break;   // fechou
        laco.push({ x: atualX, y: atualY });
      }
      if (laco.length >= 4) laços.push(laco);
    }

    // 3. Grade → pixels → forma orgânica, em quatro etapas.
    //
    //    A ORDEM importa e cada etapa conserta o problema da anterior:
    //      a) fundir colineares  — um muro de 10 tiles vira 2 pontos (exato)
    //      b) reamostrar          — espaçamento uniforme pro ruído ser parelho
    //      c) deslocar por ruído  — tira o ar de grade; amplitude limitada
    //      d) Chaikin             — arredonda cantos SEM sair do polígono
    //
    //    Tentativa anterior (descartada): Douglas-Peucker + Catmull-Rom.
    //    O RDP com tolerância de ~9px destruía plataformas de 4 tiles (viravam
    //    lentes) e cortava o perímetro da sala numa diagonal; o Catmull-Rom
    //    ainda fazia overshoot nos cantos, desenhando chão fora da colisão.
    //    Chaikin é convexo por construção — a curva nunca escapa da forma.
    this._contornos = laços.map((laco) => {
      const emPx = laco.map((p) => ({ x: p.x * this.tile, y: p.y * this.tile }));

      const cantos = fundirColineares(emPx);
      const uniforme = reamostrarCaminho(cantos, this.tile * 0.44);

      const amp = this.tile * 0.13;   // < 1/7 do tile: o desenho nunca sugere
                                      // um apoio que a física não tem
      const ondulado = uniforme.map((p, i) => {
        const fase = i * 0.31;
        const n = ruido1(fase, this.semente) - 0.5;
        const n2 = ruido1(fase * 2.3 + 31, this.semente + 7) - 0.5;
        return { x: p.x + n * amp, y: p.y + n2 * amp };
      });

      const pontos = chaikin(ondulado, 2);
      return { pontos, externo: areaPoligono(pontos) < 0 };
    });

    return this._contornos;
  }

  /**
   * Path2D preenchível de todo o terreno sólido. Winding nonzero recorta os
   * buracos automaticamente (laços internos têm orientação oposta), então
   * cavernas ficam vazadas sem nenhum tratamento especial.
   */
  path() {
    if (this._path) return this._path;
    const p = new Path2D();
    for (const c of this.contornos()) {
      const pts = c.pontos;
      if (pts.length < 2) continue;
      p.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
      p.closePath();
    }
    this._path = p;
    return p;
  }

  /**
   * Só as arestas VOLTADAS PRA CIMA (as que o jogador pisa), como polilinhas.
   * É onde vai musgo, grama e a luz de borda — aplicar esses efeitos no
   * contorno inteiro faz grama crescer no teto e entrega o truque na hora.
   * @param {number} limiar  cos do ângulo máximo com a vertical (0.55 ≈ 56°)
   */
  arestasSuperiores(limiar = 0.55) {
    // Cache: o resultado é estático por sala (só muda se `definir()` mexer no
    // terreno), mas era recalculado TRÊS vezes por quadro — crista, musgo e o
    // passe de luz — percorrendo todos os pontos de todos os contornos. Numa
    // sala grande isso sozinho era uma fatia grossa do orçamento de 16,7 ms.
    this._cacheArestas ??= new Map();
    const emCache = this._cacheArestas.get(limiar);
    if (emCache) return emCache;

    const saida = [];
    for (const c of this.contornos()) {
      const pts = c.pontos;
      let atual = null;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;

        /* "Face pisável" era decidido pelo SENTIDO do contorno (`ny = -dx/len`
           e um limiar). Isso só funciona se todo laço estiver enrolado no
           mesmo sentido — e não está: o encadeador de arestas resolve
           junções diagonais escolhendo a curva mais fechada à direita, o que
           inverte a orientação de alguns laços (as saliências pequenas e
           soltas, tipicamente). Nesses, a regra apontava para a face de
           BAIXO: musgo, luz de crista e a decoração de chão apareciam
           pendurados sob a plataforma, de cabeça pra baixo. Bug real, visível
           em qualquer sala com repuxo de 1 tile.

           A geometria não depende de orientação nenhuma: uma face é pisável
           se a aresta é quase horizontal, tem VAZIO em cima e SÓLIDO embaixo.
           A sonda usa um quarto de tile porque o contorno é suavizado e
           deslocado por ruído — perto demais da borda cairia no tile errado. */
        if (Math.abs(dx) / len < limiar) { atual = null; continue; }
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const sonda = this.tile * 0.25;
        const pisavel = !this._solidoVisualPx(mx, my - sonda)
          && this._solidoVisualPx(mx, my + sonda);
        if (pisavel) {
          if (!atual) { atual = [a]; saida.push(atual); }
          atual.push(b);
        } else {
          atual = null;
        }
      }
    }
    const resultado = saida.filter((s) => s.length > 2);
    this._cacheArestas.set(limiar, resultado);
    return resultado;
  }
}

/* -------------------------------------------------------------------------
   Ajuda pra montar sala a partir de arte ASCII sem se perder na contagem.
   ------------------------------------------------------------------------- */

/** Normaliza linhas pra todas terem o mesmo comprimento (completa com '.'). */
export function normalizarMapa(linhas) {
  const w = Math.max(...linhas.map((l) => l.length));
  return linhas.map((l) => l.padEnd(w, '.'));
}

/** Moldura sólida de 1 tile em volta — evita cair pra fora numa sala em teste. */
export function emoldurar(linhas, char = '#') {
  const norm = normalizarMapa(linhas);
  const w = norm[0].length;
  return [char.repeat(w + 2), ...norm.map((l) => char + l + char), char.repeat(w + 2)];
}
