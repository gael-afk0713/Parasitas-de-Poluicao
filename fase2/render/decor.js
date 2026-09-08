/* =========================================================================
   fase2/render/decor.js — o que está POUSADO no chão de cada área
   -------------------------------------------------------------------------
   O terreno diz onde dá pra pisar. A decoração diz ONDE VOCÊ ESTÁ.

   Sem ela toda área tem a mesma silhueta de chão, e a identidade fica toda
   por conta da cor — o que é frágil: tira a cor e as cinco áreas viram a
   mesma. Aqui cada uma ganha objetos que só existem nela, e que contam o que
   aconteceu naquele lugar sem uma linha de texto:

     raizes    cogumelos, samambaias, pedras — mata que ainda tenta
     varzea    juncos, ossos, vitórias-régias — o que apodrece na água parada
     clareira  cano vazando, engrenagem, tambor — o que a empresa deixou
     dossel    galho caído, ninho vazio — altura e abandono
     coracao   cristais, tumores — nada disso cresceu naturalmente

   COMO É DESENHADO. Os objetos são posicionados percorrendo as arestas
   pisáveis do terreno (as mesmas que o musgo usa), por COMPRIMENTO DE ARCO,
   com espaçamento irregular. Tudo é determinístico pela posição no mundo:
   nada pisca entre quadros nem muda ao reentrar na sala.

   E tudo é pré-desenhado em `Path2D` cacheado por degrau de pureza, como o
   musgo — a geometria é estática, e regenerá-la a cada quadro custaria mais
   que o resto do terreno junto (lição da última passada de desempenho).
   ========================================================================= */

import {
  TAU, clamp01, lerp, rgba, misturarHex, hash2, ruido1,
} from '../core/mat.js';

/**
 * Vocabulário de cada área.
 * `itens` — funções de desenho, sorteadas por peso.
 * `passo` — distância média entre objetos, em px de aresta.
 * `vivo`  — se `true`, a densidade cresce com a pureza; se `false`, ela CAI
 *           (destroço industrial some conforme a mata cobre tudo).
 */
const VOCABULARIO = {
  raizes:   { passo: 150, itens: ['cogumelo', 'samambaia', 'pedra', 'graveto'], vivo: true },
  varzea:   { passo: 130, itens: ['junco', 'osso', 'pedra', 'cogumelo'], vivo: true },
  clareira: { passo: 175, itens: ['cano', 'engrenagem', 'tambor', 'graveto'], vivo: false },
  dossel:   { passo: 165, itens: ['galhoCaido', 'ninho', 'samambaia', 'pedra'], vivo: true },
  coracao:  { passo: 155, itens: ['cristal', 'tumor', 'osso'], vivo: true },
};

export class Decor {
  /**
   * @param {import('../mundo/terreno.js').Terreno} terreno
   * @param {string} area  chave de AREAS
   */
  constructor(terreno, area, semente = 7) {
    this.terreno = terreno;
    this.area = area;
    this.semente = semente;
    this._cache = null;
  }

  /** Chamado depois do terreno e ANTES das entidades. */
  desenhar(ctx, tema) {
    const pureza = clamp01(tema.pureza ?? 0);
    const degrau = Math.round(pureza * 15);
    if (this._cache?.degrau !== degrau) {
      this._cache = { degrau, ...this._construir(degrau / 15) };
    }
    const c = this._cache;

    for (const grupo of c.grupos) {
      ctx.save();
      // A cor de cada grupo é resolvida no DESENHO, não na construção: assim
      // o cache sobrevive à interpolação contínua do tema entre um degrau de
      // pureza e o seguinte, sem precisar reconstruir a geometria.
      ctx.fillStyle = rgba(this._cor(tema, grupo.tom), grupo.alfa);
      if (grupo.contorno) {
        ctx.strokeStyle = rgba(this._cor(tema, grupo.tom), grupo.alfa);
        ctx.lineWidth = grupo.largura;
        ctx.lineCap = 'round';
        ctx.stroke(grupo.path);
      } else {
        ctx.fill(grupo.path);
      }
      ctx.restore();
    }
  }

  /** Passe emissivo: só o que acende de verdade em área restaurada. */
  desenharLuz(ctx, tema) {
    // `brilhos` é um Path2D (ou null), não um array — testar `.length` daria
    // `undefined` e o passe emissivo nunca rodaria.
    const c = this._cache;
    if (!c?.brilhos) return;
    const pureza = clamp01(tema.pureza ?? 0);
    if (pureza < 0.25) return;
    ctx.save();
    ctx.fillStyle = rgba(tema.acento, (pureza - 0.25) * 0.9);
    ctx.fill(c.brilhos);
    ctx.restore();
  }

  _cor(tema, tom) {
    switch (tom) {
      case 'escuro': return misturarHex(tema.terreno, tema.ceuTopo, 0.45);
      case 'medio': return misturarHex(tema.terreno, tema.borda, 0.7);
      case 'claro': return tema.crista;
      case 'acento': return tema.acento;
      default: return tema.borda;
    }
  }

  /* --------------------------------------------------------------------- */

  _construir(pureza) {
    const voc = VOCABULARIO[this.area] ?? VOCABULARIO.raizes;
    // Grupos por (tom, tipo de traço) — o mesmo agrupamento que tornou o
    // terreno 18× mais rápido: poucos `fill`/`stroke` em vez de um por objeto.
    const grupos = {
      escuroF: { tom: 'escuro', alfa: 1, path: new Path2D(), contorno: false },
      medioF: { tom: 'medio', alfa: 1, path: new Path2D(), contorno: false },
      claroF: { tom: 'claro', alfa: 0.85, path: new Path2D(), contorno: false },
      acentoF: { tom: 'acento', alfa: 0.9, path: new Path2D(), contorno: false },
      medioT: { tom: 'medio', alfa: 0.9, path: new Path2D(), contorno: true, largura: 2.2 },
      claroT: { tom: 'claro', alfa: 0.7, path: new Path2D(), contorno: true, largura: 1.4 },
    };
    const brilhos = new Path2D();
    let temBrilho = false;
    const usados = new Set();

    // Densidade: vegetação cresce com a pureza, destroço industrial some.
    const densidade = voc.vivo
      ? lerp(0.45, 1, pureza)
      : lerp(1, 0.35, pureza);

    const api = {
      // Cada desenhista recebe isto. Assim o desenho de um item não sabe
      // nada sobre caching nem sobre agrupamento.
      f: (g, fn) => { usados.add(g); fn(grupos[g].path); },
      brilho: (x, y, r) => {
        brilhos.moveTo(x + r, y);
        brilhos.arc(x, y, r, 0, TAU);
        temBrilho = true;
      },
      pureza,
    };

    for (const faixa of this.terreno.arestasSuperiores(0.5)) {
      let percorrido = 0;
      let proximo = hash2(Math.round(faixa[0].x), Math.round(faixa[0].y), this.semente) * voc.passo;

      for (let i = 0; i < faixa.length - 1; i++) {
        const a = faixa[i], b = faixa[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const seg = Math.hypot(dx, dy) || 0.001;

        while (proximo <= percorrido + seg) {
          const t = (proximo - percorrido) / seg;
          const px = a.x + dx * t, py = a.y + dy * t;
          const h = hash2(Math.round(px), Math.round(py), this.semente + 3);
          const h2 = hash2(Math.round(py), Math.round(px), this.semente + 11);

          proximo += voc.passo * lerp(0.45, 1.7, h2);

          if (h > densidade * 0.85) continue;

          // Normal para fora — o objeto cresce perpendicular à superfície e
          // acompanha a inclinação, em vez de ficar sempre em pé.
          const nx = dy / seg, ny = -dx / seg;
          // Objeto muito inclinado fica esquisito de pé; pula rampas fortes.
          if (ny > -0.45) continue;

          const tipo = voc.itens[Math.floor(h * 997) % voc.itens.length];
          const escala = lerp(0.7, 1.35, h2);
          ITENS[tipo]?.(api, px, py, nx, ny, escala, h, h2);
        }
        percorrido += seg;
      }
    }

    return {
      grupos: [...usados].map((k) => grupos[k]),
      brilhos: temBrilho ? brilhos : null,
    };
  }
}

/* =========================================================================
   OS ITENS
   -------------------------------------------------------------------------
   Cada um recebe: (api, x, y, nx, ny, escala, h, h2) — posição na superfície,
   a normal para fora, uma escala e dois valores de ruído estáveis.
   Todos desenham em coordenadas de MUNDO, direto no Path2D do seu grupo.
   ========================================================================= */

/** Move um ponto ao longo da normal (para fora da superfície). */
const acima = (x, y, nx, ny, d) => [x + nx * d, y + ny * d];

const ITENS = {
  /* --- comuns ---------------------------------------------------------- */

  pedra(api, x, y, nx, ny, s, h) {
    const r = 5 * s;
    api.f('escuroF', (p) => {
      p.moveTo(x - r, y);
      // Meia-elipse irregular: pedra parcialmente enterrada, não bola solta.
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI + (i / 8) * Math.PI;
        const rr = r * (1 + (hash2(Math.round(x) + i, Math.round(y), 5) - 0.5) * 0.4);
        p.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * lerp(0.5, 0.9, h));
      }
      p.closePath();
    });
  },

  graveto(api, x, y, nx, ny, s, h, h2) {
    // Deitado no chão, quase horizontal — é o que o diferencia de um talo.
    const comp = 16 * s;
    const ang = (h - 0.5) * 0.6;
    api.f('medioT', (p) => {
      p.moveTo(x - Math.cos(ang) * comp * 0.5, y - Math.sin(ang) * comp * 0.5 - 1);
      p.lineTo(x + Math.cos(ang) * comp * 0.5, y + Math.sin(ang) * comp * 0.5 - 1);
      if (h2 > 0.6) {   // um galhinho saindo
        p.moveTo(x, y - 1);
        p.lineTo(x + comp * 0.25, y - 6 * s);
      }
    });
  },

  cogumelo(api, x, y, nx, ny, s, h, h2) {
    const alt = lerp(6, 13, h) * s;
    const [cx, cy] = acima(x, y, nx, ny, alt);
    const rChapeu = lerp(3.5, 6.5, h2) * s;
    api.f('medioT', (p) => { p.moveTo(x, y); p.lineTo(cx, cy); });   // pé
    api.f('claroF', (p) => {
      // Chapéu: meia-elipse com a boca virada pro chão.
      p.moveTo(cx - rChapeu, cy);
      p.bezierCurveTo(cx - rChapeu, cy - rChapeu * 1.2,
        cx + rChapeu, cy - rChapeu * 1.2, cx + rChapeu, cy);
      p.closePath();
    });
    // Bioluminescência: a recompensa de restaurar, e só aparece com pureza.
    if (api.pureza > 0.4 && h2 > 0.45) api.brilho(cx, cy - rChapeu * 0.4, rChapeu * 0.5);
  },

  samambaia(api, x, y, nx, ny, s, h) {
    // Leque de folíolos abrindo a partir da base.
    const n = 4 + Math.floor(h * 3);
    const comp = lerp(11, 22, h) * s;
    api.f('claroT', (p) => {
      for (let i = 0; i < n; i++) {
        const f = n === 1 ? 0.5 : i / (n - 1) - 0.5;
        const ang = Math.atan2(ny, nx) + f * 1.15;
        const c = comp * (1 - Math.abs(f) * 0.5);
        p.moveTo(x, y);
        p.quadraticCurveTo(
          x + Math.cos(ang) * c * 0.5 - ny * f * 6,
          y + Math.sin(ang) * c * 0.5 + nx * f * 6,
          x + Math.cos(ang) * c, y + Math.sin(ang) * c
        );
      }
    });
  },

  /* --- várzea ---------------------------------------------------------- */

  junco(api, x, y, nx, ny, s, h, h2) {
    const n = 3 + Math.floor(h2 * 4);
    api.f('medioT', (p) => {
      for (let i = 0; i < n; i++) {
        const hi = hash2(Math.round(x) + i * 13, Math.round(y), 7);
        const alt = lerp(14, 34, hi) * s;
        const verga = (hi - 0.5) * alt * 0.55;
        const bx = x + (hi - 0.5) * 9;
        p.moveTo(bx, y);
        p.quadraticCurveTo(bx + verga * 0.3, y - alt * 0.6, bx + verga, y - alt);
      }
    });
  },

  osso(api, x, y, nx, ny, s, h) {
    // Costela meio enterrada: arco fino saindo e voltando pro chão.
    const comp = 18 * s, alt = 9 * s;
    api.f('claroT', (p) => {
      p.moveTo(x - comp * 0.5, y);
      p.quadraticCurveTo(x + (h - 0.5) * 8, y - alt, x + comp * 0.5, y - 1);
    });
  },

  /* --- clareira (o que a empresa deixou) -------------------------------- */

  cano(api, x, y, nx, ny, s, h, h2) {
    // Cano quebrado saindo do chão, com flange. A ponta aberta é o detalhe
    // que conta que ele foi ARRANCADO, não instalado.
    const alt = lerp(14, 30, h) * s;
    const larg = 4 * s;
    api.f('escuroF', (p) => {
      p.rect(x - larg, y - alt, larg * 2, alt);
      p.rect(x - larg * 1.8, y - alt - 3, larg * 3.6, 4);   // flange
    });
    if (h2 > 0.55) {
      // Gotejamento: risco curto abaixo da boca.
      api.f('medioT', (p) => { p.moveTo(x, y - alt + 2); p.lineTo(x + 2, y - alt * 0.45); });
    }
  },

  engrenagem(api, x, y, nx, ny, s, h) {
    const r = 7 * s;
    const [cx, cy] = acima(x, y, nx, ny, r * 0.75);
    const dentes = 8;
    api.f('escuroF', (p) => {
      for (let i = 0; i < dentes; i++) {
        const a = (i / dentes) * TAU + h;
        const rr = r * (i % 2 === 0 ? 1 : 0.76);
        const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
        i === 0 ? p.moveTo(px, py) : p.lineTo(px, py);
      }
      p.closePath();
      // Furo central — sem ele lê como estrela, não engrenagem.
      p.moveTo(cx + r * 0.3, cy);
      p.arc(cx, cy, r * 0.3, 0, TAU, true);
    });
  },

  tambor(api, x, y, nx, ny, s, h) {
    const larg = 9 * s, alt = 13 * s;
    const tomba = (h - 0.5) * 0.5;
    api.f('escuroF', (p) => {
      // Path2D não tem transform: os cantos são calculados à mão.
      const c = Math.cos(tomba), sn = Math.sin(tomba);
      const pt = (dx, dy) => [x + dx * c - dy * sn, y + dx * sn + dy * c];
      const [ax, ay] = pt(-larg, 0), [bx, by] = pt(larg, 0);
      const [dx2, dy2] = pt(larg, -alt), [ex, ey] = pt(-larg, -alt);
      p.moveTo(ax, ay); p.lineTo(bx, by); p.lineTo(dx2, dy2); p.lineTo(ex, ey);
      p.closePath();
    });
    api.f('medioT', (p) => {   // aro
      const c = Math.cos(tomba), sn = Math.sin(tomba);
      const pt = (dx, dy) => [x + dx * c - dy * sn, y + dx * sn + dy * c];
      const [ax, ay] = pt(-larg, -alt * 0.6), [bx, by] = pt(larg, -alt * 0.6);
      p.moveTo(ax, ay); p.lineTo(bx, by);
    });
  },

  /* --- dossel ---------------------------------------------------------- */

  galhoCaido(api, x, y, nx, ny, s, h, h2) {
    const comp = 26 * s;
    const ang = (h - 0.5) * 0.5;
    api.f('medioT', (p) => {
      const ex = x + Math.cos(ang) * comp, ey = y + Math.sin(ang) * comp - 2;
      p.moveTo(x - Math.cos(ang) * comp * 0.3, y - Math.sin(ang) * comp * 0.3 - 2);
      p.quadraticCurveTo((x + ex) / 2, y - 5 * s, ex, ey);
      // Ramos: é o que separa "galho" de "pau".
      for (let i = 0; i < 3; i++) {
        const f = 0.25 + i * 0.25;
        const bx = lerp(x, ex, f), by = lerp(y - 2, ey, f);
        const hi = hash2(Math.round(bx) + i, Math.round(by), 17);
        p.moveTo(bx, by);
        p.lineTo(bx + (hi - 0.5) * 14 * s, by - lerp(4, 11, hi) * s);
      }
    });
  },

  ninho(api, x, y, nx, ny, s, h) {
    const r = 8 * s;
    const [cx, cy] = acima(x, y, nx, ny, r * 0.5);
    api.f('medioT', (p) => {
      // Fios entrelaçados em vez de um anel liso.
      for (let i = 0; i < 7; i++) {
        const a0 = (i / 7) * Math.PI - 0.2;
        const hi = hash2(Math.round(cx) + i, Math.round(cy), 23);
        p.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r * 0.5);
        p.quadraticCurveTo(cx, cy + r * lerp(0.5, 0.9, hi),
          cx - Math.cos(a0) * r, cy + Math.sin(a0) * r * 0.5);
      }
    });
  },

  /* --- coração --------------------------------------------------------- */

  cristal(api, x, y, nx, ny, s, h, h2) {
    const alt = lerp(10, 24, h) * s;
    const larg = lerp(3, 6, h2) * s;
    const incl = (h2 - 0.5) * 0.7;
    const [tx, ty] = acima(x, y, nx, ny, alt);
    api.f('acentoF', (p) => {
      p.moveTo(x - larg, y);
      p.lineTo(tx + incl * alt * 0.5, ty);
      p.lineTo(x + larg, y);
      p.closePath();
    });
    api.brilho(tx + incl * alt * 0.5, ty, larg * 0.9);
  },

  tumor(api, x, y, nx, ny, s, h) {
    // Lóbulos sobrepostos: nada disso cresceu simetricamente.
    const r = lerp(5, 11, h) * s;
    api.f('escuroF', (p) => {
      for (let i = 0; i < 3; i++) {
        const hi = hash2(Math.round(x) + i * 9, Math.round(y), 29);
        const rr = r * lerp(0.55, 1, hi);
        const [cx, cy] = acima(x + (hi - 0.5) * r, y, nx, ny, rr * 0.7);
        p.moveTo(cx + rr, cy);
        p.arc(cx, cy, rr, 0, TAU);
      }
    });
  },
};

export { VOCABULARIO };
