/* =========================================================================
   fase2/render/catastrofe.js — a poluição em escala de paisagem
   -------------------------------------------------------------------------
   O fundo mostrava um lugar MORTO: troncos secos, bruma, cor lavada. Morto
   é estático, e estático não dói. O que o jogo quer dizer é outra coisa —
   que isto está ACONTECENDO: o horizonte queima, a fumaça sobe iluminada por
   baixo, cinza cai, os bichos correm. Sofrimento é verbo, não cenário.

   Cada área mostra uma face diferente da mesma catástrofe:
     raízes    o fogo acabou de passar — cinza, fumaça, o incêndio ao longe
     várzea    óleo e lixo — tambores, pneus, sacolas presas no junco
     clareira  o incêndio está AQUI — árvores em chamas, brasas, a fuga
     dossel    o desmatamento — toco de corte reto, tora caída, a máquina
     coração   a fonte — chama química, e nenhum bicho. Silêncio.

   E tudo é função da PUREZA. A restauração roda a catástrofe ao contrário:
   o fogo apaga primeiro, a fumaça afina depois, a máquina vai embora, o lixo
   vira vitória-régia, o toco brota, e os animais param de fugir e voltam a
   pastar. É isso que transforma a mecânica central ("a cor volta") em FORMA
   voltando — até aqui a imagem restaurada tinha as mesmas silhuetas da suja,
   só com outro matiz.

   Regras que valem pra tudo aqui (as mesmas do parallax.js):
     · função determinística de (x, tempo): nenhuma lista, nenhum estado;
     · caminhos agrupados sempre que dá — fogo, fumaça, tocos e lixo pintam
       um `fill` por cor; bicho, máquina e mancha de óleo pintam por objeto
       (são poucos por tela);
     · este arquivo não importa `parallax.js`: os auxiliares (âncora, perfil
       de chão, vento) chegam pelo objeto de ambiente `a`, e assim não existe
       dependência circular entre os dois.
   ========================================================================= */

import {
  TAU, lerp, clamp01, rgba, ruido1, hash2, misturarHex, ajustarBrilho,
} from '../core/mat.js';

/* =========================================================================
   1 · O QUE CADA ÁREA SOFRE
   ========================================================================= */

/* `bichos`: quem foge pela crista do horizonte. O horizonte é o único lugar
   que está SEMPRE na altura do olho — em sala baixa as cristas do meio do
   fundo caem atrás das plataformas e a manada simplesmente não aparece. Lá
   ela corre recortada contra a linha de fogo, em qualquer sala. */
export const CATASTROFE = {
  raizes: { fogo: 0.85, fumaca: 0.9, cinza: 1, brasas: 0.45, chama: 'laranja', fuga: -1,
    bichos: ['veado', 'veado', 'tamandua'] },
  // Várzea: o que queima é o ÓLEO sobre a água — poluição e incêndio na
  // mesma imagem. Fogo baixo e fumaça preta, não mata em chamas.
  varzea: { fogo: 0.5, fumaca: 0.7, cinza: 0.35, brasas: 0.2, chama: 'laranja', fuga: 1,
    bichos: ['capivara'] },
  clareira: { fogo: 1, fumaca: 1, cinza: 0.85, brasas: 1, chama: 'laranja', fuga: -1,
    bichos: ['veado', 'capivara', 'veado', 'tamandua'] },
  dossel: { fogo: 0.7, fumaca: 0.9, cinza: 0.55, brasas: 0.25, chama: 'laranja', fuga: 1,
    bichos: ['veado'] },
  coracao: { fogo: 0.8, fumaca: 0.7, cinza: 0.45, brasas: 0.7, chama: 'quimica', fuga: -1,
    bichos: null },
};

export function confCatastrofe(area) { return CATASTROFE[area] ?? CATASTROFE.raizes; }

/* As três curvas de desfazer. O FOGO apaga cedo (some com 55% de pureza):
   é a primeira coisa que o jogador precisa ver responder. A FUMAÇA demora
   mais — fumaça sobrevive ao fogo, e é essa defasagem que faz a restauração
   parecer um processo e não um interruptor. A CALMA dos animais começa só
   quando o fogo já quase acabou: bicho não volta pra mata que ainda queima. */
export function forcaFogo(area, pureza) {
  return confCatastrofe(area).fogo * clamp01(1 - pureza * 1.8);
}
export function forcaFumaca(area, pureza) {
  return confCatastrofe(area).fumaca * clamp01(1 - pureza * 1.25);
}
export function calmaDaFauna(pureza) {
  const k = clamp01((pureza - 0.35) / 0.4);
  return k * k * (3 - 2 * k);
}

/* Rampas de temperatura. Laranja é fogo de mata; a do Coração é QUÍMICA —
   magenta e violeta, a mesma família da área, porque ali o que queima não é
   madeira. Nenhuma das duas usa o âmbar do Guardião (#eaa24f): o fogo é mais
   vermelho, mais saturado e fica LONGE, e a faixa dele continua sendo a única
   coisa quente perto do jogador. */
export const CHAMAS = {
  laranja: { nucleo: '#fff1c4', meio: '#ff9c3a', borda: '#d8431a', brasa: '#ff6a24' },
  /* Química. Duas tentativas: magenta puro lia como grama neon; núcleo
     verde-ácido em línguas finas lia como capim ornamental. O que faz fogo
     é MASSA — chama larga e baixa, núcleo branco-quente —, e o verde-ácido
     virou o que ele é de verdade: VAPOR rasteiro saindo do chão queimado. */
  quimica: {
    nucleo: '#fff4fd', meio: '#ff4fc8', borda: '#8a2ae0', brasa: '#ff5fd0',
    vapor: '#b8ff4a', forma: { larg: 1.8, alt: 0.7 },
  },
};

export function chamaDe(area) { return CHAMAS[confCatastrofe(area).chama] ?? CHAMAS.laranja; }

/** Elipse como subcaminho próprio, começando NO contorno. Chamar `ellipse`
 *  direto depois de um `moveTo` no centro emenda uma reta do centro até o
 *  início do arco — em preenchimento vira uma lasca, em traço vira um raio. */
function elipse(p, cx, cy, rx, ry, rot = 0) {
  p.moveTo(cx + Math.cos(rot) * rx, cy + Math.sin(rot) * rx);
  p.ellipse(cx, cy, rx, ry, rot, 0, TAU);
}

/* =========================================================================
   2 · FOGO
   ========================================================================= */

/**
 * Acrescenta uma língua de fogo a um caminho. Base larga presa ao chão,
 * cintura, ponta que chicoteia pra `topoX`. Nunca um triângulo: fogo tem
 * barriga embaixo e afina de repente — é a curva que diz "chama".
 */
function lingua(p, x, yBase, alt, larg, topoX) {
  const w = larg * 0.5;
  const yt = yBase - alt;
  p.moveTo(x - w, yBase);
  p.bezierCurveTo(x - w * 1.15, yBase - alt * 0.42,
    lerp(x, topoX, 0.55) - w * 0.32, yBase - alt * 0.72, topoX, yt);
  p.bezierCurveTo(lerp(x, topoX, 0.55) + w * 0.32, yBase - alt * 0.72,
    x + w * 1.15, yBase - alt * 0.42, x + w, yBase);
  // Base em GOTA, não cortada reta: chama que termina numa linha horizontal
  // lê como adesivo colado no galho (a crítica achou uma assim na copa).
  p.quadraticCurveTo(x, yBase + w * 0.55, x - w, yBase);
  p.closePath();
}

/**
 * Um tufo de fogo: três passadas encolhendo (borda, meio, núcleo). A gradação
 * de temperatura é o que faz o olho ler FOGO em vez de mancha laranja, e o
 * núcleo claro fica baixo e estreito — fogo é mais quente na raiz.
 *
 * Adiciona aos três caminhos recebidos; quem chama preenche uma vez só.
 */
function tufo(pb, pm, pn, x, yBase, alt, larg, t, h, inclina) {
  const tremor = ruido1(t * 2.4 + h * 97, 71) - 0.5;
  const chicote = ruido1(t * 5.3 + h * 41, 73) - 0.5;
  const pulso = 0.7 + 0.6 * ruido1(t * 3.1 + h * 57, 79);
  const a = alt * pulso;
  const topo = x + inclina * a + tremor * larg * 1.1 + chicote * larg * 0.5;
  lingua(pb, x, yBase, a, larg, topo);
  lingua(pm, x, yBase, a * 0.7, larg * 0.64, lerp(x, topo, 0.82));
  lingua(pn, x, yBase, a * 0.4, larg * 0.34, lerp(x, topo, 0.55));
}

function preencherFogo(ctx, pb, pm, pn, ch, alfa) {
  ctx.fillStyle = rgba(ch.borda, 0.8 * alfa); ctx.fill(pb);
  ctx.fillStyle = rgba(ch.meio, 0.88 * alfa); ctx.fill(pm);
  ctx.fillStyle = rgba(ch.nucleo, 0.9 * alfa); ctx.fill(pn);
}

/**
 * Frente de fogo correndo ao longo de um perfil de chão.
 *
 * O fogo não é uma faixa contínua: ele QUEIMA EM MANCHAS, e as manchas andam
 * devagar (o ruído desliza com o tempo). É a diferença entre "incêndio" e
 * "enfeite de borda": trecho que já queimou fica em brasa, trecho que ainda
 * vai queimar está escuro, e o trecho vivo se move.
 *
 * @param {object} o
 * @param {(x:number)=>number} o.yEm  altura do chão em x
 */
export function frenteDeFogo(ctx, o) {
  const passo = o.passo;
  const pb = new Path2D(), pm = new Path2D(), pn = new Path2D();
  const brasa = new Path2D(), cinzaViva = new Path2D(), corpo = new Path2D();
  let emBrasa = false, temCorpo = false;
  let yMin = Infinity, yMax = -Infinity;
  /* `dx` separa onde se DESENHA de onde se SORTEIA: no horizonte o desenho é
     em coordenada de tela, mas a mancha de fogo precisa ficar presa ao mundo,
     senão o incêndio anda junto com a câmera. */
  const dx = o.dx ?? 0;
  const m0 = Math.floor((o.x0 + dx) / passo) * passo;
  for (let xm = m0; xm <= o.x1 + dx; xm += passo) {
    const x = xm - dx;
    const h = hash2(xm | 0, o.semente, 13);
    const n = ruido1(xm * 0.0032 + o.t * 0.035, o.semente);
    /* Limiar ALTO de propósito: com 0,3 quase todo trecho queimava, e a frente
       lia como fileira de velas — uma borda acesa de ponta a ponta. Incêndio
       de verdade tem trecho vivo, trecho escuro e trecho que explode. */
    /* LADO. O fogo tem de onde vir: `lateral` pesa as manchas pro lado
       oposto ao da fuga. Espalhado igual pelo horizonte inteiro, qualquer
       direção de corrida levava a manada PRA DENTRO de alguma chama, e não
       havia lado seguro legível. */
    const lado = o.lateral ? o.lateral(x) : 1;
    let foco = clamp01((n - 0.42) / 0.34) * o.inten * lado;
    /* MASSA. Línguas soltas, todas do mesmo tamanho, liam como fileira de
       velas — enfeite de borda, não incêndio. Em alguns trechos a frente vira
       PAREDE: as línguas engrossam, sobem três vezes mais e se fundem num
       corpo de fogo contínuo, com um miolo de luz por trás. É a escala que
       diz "isto está consumindo a mata", e não "isto está aceso". */
    const zona = o.massa
      ? o.massa * clamp01((ruido1(xm * 0.0012 + o.t * 0.01, o.semente + 7) - 0.6) / 0.2) * o.inten * lado
      : 0;
    foco = Math.max(foco, zona);
    const yb = o.yEm(x);
    /* Brasa: uma linha contínua por baixo das chamas VIVAS; onde o fogo já
       passou, só pontos soltos. Contínua de ponta a ponta ela lia como cano
       de lava correndo pelo morro. */
    if (foco > 0.05) {
      if (!emBrasa) { brasa.moveTo(x, yb); emBrasa = true; } else brasa.lineTo(x, yb);
    } else {
      emBrasa = false;
      if (n > 0.3 && o.inten > 0.02 && hash2(xm | 0, o.semente, 29) < 0.3) {
        cinzaViva.moveTo(x, yb);
        cinzaViva.lineTo(x + passo * 0.5, o.yEm(x + passo * 0.5));
      }
    }
    if (foco < 0.05) continue;
    // Labareda: de vez em quando um trecho sobe três vezes mais alto.
    const lab = clamp01((ruido1(xm * 0.012 + o.t * 0.09, o.semente + 3) - 0.6) / 0.4);
    // Dentro da parede, a altura ONDULA: cristas mais altas rolando ao longo
    // dela. Sem isso a parede era um pente — todas as pontas no mesmo nível.
    const onda = zona > 0.05 ? lerp(0.55, 1.45, ruido1(xm * 0.018 + o.t * 0.22, o.semente + 9)) : 1;
    const sobe = Math.max(lab * lab, zona * 0.85 * onda);
    const fa = o.ch.forma?.alt ?? 1, fl = o.ch.forma?.larg ?? 1;
    const alt = o.escala * lerp(0.35, 1.3, h) * (0.2 + 0.8 * foco) * (1 + 2.2 * sobe) * fa;
    const larg = passo * lerp(1.2, 2.1, hash2(xm | 0, o.semente, 17)) * fl * (1 + 0.6 * zona);
    const xf = x + (h - 0.5) * passo * 0.5;
    tufo(pb, pm, pn, xf, yb + 1, alt, larg, o.t, h, o.inclina);
    if (zona > 0.08) {
      // O corpo da parede: elipses baixas que se fundem num preenchimento só.
      elipse(corpo, xf, yb - alt * 0.18, larg * 1.1, alt * 0.38 * zona + 2);
      temCorpo = true;
      if (yb < yMin) yMin = yb;
      if (yb > yMax) yMax = yb;
    }
  }
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (o.ch.vapor) {
    // Vapor rasteiro, largo e mole, por baixo das chamas.
    ctx.strokeStyle = rgba(o.ch.vapor, 0.1 * o.inten * o.alfa);
    ctx.lineWidth = o.escala * 1.6;
    ctx.stroke(brasa);
    ctx.strokeStyle = rgba(o.ch.vapor, 0.2 * o.inten * o.alfa);
    ctx.lineWidth = o.escala * 0.6;
    ctx.stroke(brasa);
  }
  ctx.strokeStyle = rgba(o.ch.brasa, 0.55 * o.inten * o.alfa);
  ctx.lineWidth = Math.max(1, o.escala * 0.09);
  ctx.stroke(brasa);
  ctx.strokeStyle = rgba(o.ch.brasa, 0.4 * o.inten * o.alfa);
  ctx.lineWidth = Math.max(0.8, o.escala * 0.06);
  ctx.stroke(cinzaViva);
  if (temCorpo) {
    const g = ctx.createLinearGradient(0, yMax + 2, 0, yMin - o.escala * 2.4);
    g.addColorStop(0, rgba(o.ch.meio, 0.75 * o.alfa));
    g.addColorStop(0.45, rgba(o.ch.borda, 0.45 * o.alfa));
    g.addColorStop(1, rgba(o.ch.borda, 0));
    ctx.fillStyle = g;
    ctx.fill(corpo);
  }
  preencherFogo(ctx, pb, pm, pn, o.ch, o.alfa);
  ctx.restore();
}

/**
 * Toco em brasa — o FOGO PERTO, na moldura da frente. Era uma fogueira (um
 * monte de toras com labaredas altas) e lia como recorte colado na tela:
 * fogo grande e chapado, bem na faixa do chão, onde o jogador procura
 * perigo. Agora é o que sobra DEPOIS do fogo: um toco lascado e uma tora
 * tombada, pretos, recortados contra o próprio clarão, com as rachas acesas
 * por dentro e línguas baixas lambendo a borda. A luz conta o incêndio; a
 * silhueta conta a perda.
 *
 * `vida` (0..1) é a força do fogo: a silhueta some junto com ele.
 */
export function tocoEmBrasa(ctx, x, yBase, larg, alt, t, semente, ch, vida, corSilhueta, dir) {
  const h1 = hash2(semente, 3, 7), h2 = hash2(semente, 5, 7);
  const a0 = ctx.globalAlpha;
  const k = clamp01(vida * 5);
  // 1 · o clarão atrás: é ele que recorta a silhueta.
  const yc = yBase - alt * 0.4;
  const R = larg * 1.5;
  const g = ctx.createRadialGradient(x, yc, 0, x, yc, R);
  g.addColorStop(0, rgba(ch.meio, 0.55 * vida));
  g.addColorStop(0.45, rgba(ch.borda, 0.24 * vida));
  g.addColorStop(1, rgba(ch.borda, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - R, yc - R, R * 2, R * 2);

  // 2 · a silhueta: toco de topo lascado e uma tora apoiada nele.
  ctx.globalAlpha = a0 * k;
  const r = larg * 0.2;
  const topo = yBase - alt;
  const toco = new Path2D();
  toco.moveTo(x - r * 1.55, yBase + 14);
  toco.quadraticCurveTo(x - r * 1.05, yBase - alt * 0.2, x - r, yBase - alt * 0.55);
  toco.lineTo(x - r * 0.9, topo + alt * lerp(0.08, 0.2, h1));
  toco.lineTo(x - r * 0.42, topo + alt * 0.24);
  toco.lineTo(x - r * 0.12, topo);
  toco.lineTo(x + r * 0.22, topo + alt * 0.18);
  toco.lineTo(x + r * 0.6, topo + alt * lerp(0.06, 0.14, h2));
  toco.lineTo(x + r * 0.95, topo + alt * 0.32);
  toco.lineTo(x + r, yBase - alt * 0.55);
  toco.quadraticCurveTo(x + r * 1.05, yBase - alt * 0.2, x + r * 1.65, yBase + 14);
  toco.closePath();
  // Tora: do chão, longe do toco, até encostar nele a um terço da altura.
  const ax = x + dir * larg * lerp(0.95, 1.2, h2), ay = yBase + 8;
  const bx = x + dir * r * 0.4, by = yBase - alt * lerp(0.3, 0.42, h1);
  const cx = bx - ax, cy = by - ay, cl = Math.hypot(cx, cy);
  const tr = r * 0.62;
  const nx = (-cy / cl) * tr, ny = (cx / cl) * tr;
  const tora = new Path2D();
  tora.moveTo(ax + nx, ay + ny);
  tora.lineTo(bx + nx * 0.8, by + ny * 0.8);
  tora.lineTo(bx + cx / cl * tr * 0.5, by + cy / cl * tr * 0.5);
  tora.lineTo(bx - nx * 0.8, by - ny * 0.8);
  tora.lineTo(ax - nx, ay - ny);
  tora.closePath();
  // Contraluz: o contorno traçado ANTES do preenchimento sobra só do lado de
  // fora — um fio quente em volta da madeira, que a solta do fundo escuro.
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba(ch.meio, 0.45 * vida);
  ctx.lineWidth = 3;
  ctx.stroke(tora);
  ctx.stroke(toco);
  ctx.restore();
  ctx.fillStyle = corSilhueta;
  ctx.fill(tora);
  ctx.fill(toco);

  // 3 · rachas em brasa: o fogo por DENTRO da madeira, pulsando devagar.
  /* Rachas SEGUEM O VEIO: duas no toco, na vertical, e duas na tora, ao
     longo dela. Riscadas em qualquer direção e se cruzando, liam como fio
     elétrico laranja pendurado na madeira. */
  const rachas = new Path2D();
  for (let i = 0; i < 2; i++) {
    const hi = hash2(semente, i, 11);
    let rx = x + (i === 0 ? -0.45 : 0.32) * r + (hi - 0.5) * r * 0.2;
    const y0 = yBase - alt * lerp(0.1, 0.2, hi), y1 = yBase - alt * lerp(0.5, 0.7, hi);
    rachas.moveTo(rx, y0);
    for (let j = 1; j <= 5; j++) {
      rx += (hash2(semente + j, i, 13) - 0.5) * r * 0.22;
      rachas.lineTo(rx, lerp(y0, y1, j / 5));
    }
  }
  for (let i = 0; i < 2; i++) {
    const u0 = 0.14 + i * 0.36 + hash2(semente, i, 19) * 0.08, u1 = u0 + 0.22;
    const off = i ? -0.22 : 0.25;
    rachas.moveTo(ax + cx * u0 + nx * off, ay + cy * u0 + ny * off);
    rachas.lineTo(ax + cx * (u0 + u1) * 0.5 + nx * (off + 0.12), ay + cy * (u0 + u1) * 0.5 + ny * (off + 0.12));
    rachas.lineTo(ax + cx * u1 + nx * off, ay + cy * u1 + ny * off);
  }
  const pulso = 0.65 + 0.35 * ruido1(t * 0.9 + h1 * 30, 83);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba(ch.borda, 0.5 * vida * pulso);
  ctx.lineWidth = 4;
  ctx.stroke(rachas);
  ctx.strokeStyle = rgba(ch.brasa, 0.95 * vida * pulso);
  ctx.lineWidth = 1.6;
  ctx.stroke(rachas);
  ctx.restore();

  // 4 · línguas BAIXAS lambendo o topo lascado e o dorso da tora.
  const pb = new Path2D(), pm = new Path2D(), pn = new Path2D();
  const bocas = [[x - r * 0.42, topo + alt * 0.24], [x + r * 0.22, topo + alt * 0.18],
    [x - r * 0.9, topo + alt * 0.16]];
  for (let i = 0; i < bocas.length; i++) {
    const hi = hash2(semente, i, 23);
    tufo(pb, pm, pn, bocas[i][0], bocas[i][1] + 3, alt * lerp(0.16, 0.3, hi) * vida,
      r * lerp(0.7, 1.05, hi), t, hi + i * 0.31, -dir * 0.12);
  }
  for (let i = 0; i < 2; i++) {
    const u = 0.35 + i * 0.3;
    const hi = hash2(semente, i, 29);
    tufo(pb, pm, pn, ax + cx * u - nx * 0.85, ay + cy * u - ny * 0.85 + 2,
      alt * lerp(0.1, 0.18, hi) * vida, r * lerp(0.6, 0.9, hi), t, hi + 0.7 + i, -dir * 0.12);
  }
  preencherFogo(ctx, pb, pm, pn, ch, clamp01(0.4 + vida));

  // 5 · fagulhas subindo.
  ctx.fillStyle = rgba(ch.brasa, 0.9 * vida);
  for (let i = 0; i < 7; i++) {
    const hi = hash2(semente, i, 31);
    const u = (t * lerp(0.18, 0.3, hi) + hi) % 1;
    const fx = x + (hi - 0.5) * r * 1.6 + Math.sin(t * 1.3 + hi * 20) * 8 * u - dir * u * 30;
    const fy = topo + alt * 0.2 - u * alt * 1.1;
    ctx.globalAlpha = a0 * (1 - u);
    ctx.fillRect(fx - 1, fy - 1, 2, 2);
  }
  ctx.globalAlpha = a0;
}

/** Poça de luz do fogo no chão e no ar em volta (passe emissivo ou cena). */
export function focoDeLuz(ctx, x, y, r, cor, alfa) {
  if (alfa < 0.01) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(cor, alfa));
  g.addColorStop(1, rgba(cor, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Clarão do incêndio no céu: é o fogo que você não vê iluminando o que vê. */
export function claraoDeFogo(ctx, x0, x1, yTopo, yBase, ch, inten) {
  if (inten < 0.02 || yBase <= yTopo) return;
  const g = ctx.createLinearGradient(0, yBase, 0, yTopo);
  g.addColorStop(0, rgba(ch.meio, 0.34 * inten));
  g.addColorStop(0.35, rgba(ch.borda, 0.15 * inten));
  g.addColorStop(1, rgba(ch.borda, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x0, yTopo, x1 - x0, yBase - yTopo);
}

/* =========================================================================
   3 · FUMAÇA
   ========================================================================= */

/**
 * Coluna de fumaça: um caminho feito de círculos que SOBEM, preenchido de
 * uma vez só com um degradê vertical.
 *
 * Um preenchimento por coluna (não um por bolha) resolve duas coisas: custo,
 * e a soma de alfa — bolhas sobrepostas com alfa próprio viram manchas mais
 * escuras onde se cruzam, que é exatamente o que fumaça NÃO faz. A bolha que
 * chega ao topo some no degradê (alfa zero lá em cima) e renasce na base,
 * dentro do miolo denso, onde ninguém vê a troca.
 */
export function pluma(ctx, o) {
  /* 22 bolhas bem sobrepostas (raio cresce mais rápido que o espaçamento):
     com 14 e raio contido a coluna lia como COLAR DE CONTAS. */
  const N = 20;
  // As bolhas são calculadas uma vez; o que muda por passada é só o raio.
  const bx = new Float32Array(N), by = new Float32Array(N), br = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const hi = hash2(i, o.semente, 31);
    const u = ((i / N) + o.t * o.vel * lerp(0.8, 1.2, hi)) % 1;
    // A bolha encolhe nos últimos 18% da subida: sem isso ela voltava pra
    // base ainda com ~30% de alfa e o topo da coluna encolhia de repente.
    br[i] = o.larg * lerp(0.7, 3.1, u) * lerp(0.8, 1.2, hi) * Math.min(1, (1 - u) / 0.18);
    bx[i] = o.x + o.deriva * o.alt * u * u
      + Math.sin(u * 5.3 + hi * 9 + o.t * 0.25) * o.larg * 0.4 * u;
    by[i] = o.y - o.alt * u;
  }
  /* BORDA MACIA SEM FILTRO. Uma passada só deixa o contorno de cada bolha
     nítido e a coluna lê como cacho de uva. `filter: blur` custaria caro por
     quadro; aqui a mesma coluna é preenchida duas vezes com as bolhas um
     pouco MAIORES e mais transparentes a cada vez — o degradê de borda sai
     da sobreposição. O raio cresce no lugar (escalar o caminho inteiro
     deslocaria as bolhas que derivam pro lado, e a borda viraria imagem
     dupla). */
  // Duas passadas, não três: a fumaça é o preenchimento translúcido mais
  // caro da cena (megapixels por quadro), e a terceira quase não se via.
  const passadas = [[1.16, 0.32], [1, 0.62]];
  for (const [k, al] of passadas) {
    const p = new Path2D();
    for (let i = 0; i < N; i++) {
      const r = br[i] * k;
      p.moveTo(bx[i] + r, by[i]);
      p.arc(bx[i], by[i], r, 0, TAU);
    }
    const g = ctx.createLinearGradient(0, o.y, 0, o.y - o.alt * 1.2);
    g.addColorStop(0, rgba(o.corBaixa, o.alfa * al));
    g.addColorStop(0.3, rgba(o.corAlta, o.alfa * al * 0.9));
    g.addColorStop(0.75, rgba(o.corAlta, o.alfa * al * 0.45));
    g.addColorStop(1, rgba(o.corAlta, 0));
    ctx.fillStyle = g;
    ctx.fill(p);
  }
}

/** Cor base da fumaça: escura contra o céu, puxada pro fogo embaixo. */
function coresFumaca(a, extraFogo = 1) {
  return coresDeFumaca(a.tema, a.cor, a.chama, a.fogo * extraFogo);
}

/**
 * A fumaça tem que CONTRASTAR com o céu que ela atravessa: mais clara onde o
 * alto do céu é escuro (clareira, coração), mais escura onde ele é claro
 * (várzea, dossel). Com uma cor só, ela sumia num caso ou no outro.
 */
export function coresDeFumaca(tema, corPlano, chama, fogo) {
  /* A decisão é pelo céu PERTO DO HORIZONTE (`ceuBase`), que é onde a coluna
     passa a maior parte da altura. Decidindo pelo zênite, Raízes e Dossel
     (zênite escuro, horizonte cinza-claro) ganhavam fumaça CLARA — cinza
     sobre cinza, invisível sem aumentar o contraste da captura. */
  const l = luminancia(tema.ceuBase);
  const base = l < 0.42
    ? misturarHex(misturarHex(corPlano, tema.bruma, 0.55), '#8a8078', 0.25)
    : misturarHex(misturarHex(corPlano, '#1e1916', 0.6), tema.ceuTopo, 0.2);
  const baixa = misturarHex(base, chama.borda, 0.48 * fogo);
  return { baixa, alta: base };
}

function luminancia(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

/* =========================================================================
   4 · FORMAS DE PARALLAX
   Assinatura igual às de parallax.js: (ctx, a, s). Registradas lá em FORMAS.
   ========================================================================= */

/** Incêndio correndo sobre o perfil de chão de uma camada. */
function incendio(ctx, a, s) {
  if (a.fogo < 0.02) return;
  const y0 = a.y(s.rel);
  const solo = s.solo;
  const yEm = (x) => y0 - (solo ? a.perfil(x, solo) : 0);
  /* Clarão: o céu atrás da mata acesa. Recortado ACIMA da crista — a forma
     vem depois da `massa` na mesma camada, e sem recorte o laranja pintava
     por cima do morro e das árvores, não do céu. */
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(a.x0, y0 - a.vh * 2);
  for (let x = a.x0; x <= a.x1 + 16; x += 16) ctx.lineTo(x, yEm(x));
  ctx.lineTo(a.x1 + 16, y0 - a.vh * 2);
  ctx.closePath();
  ctx.clip();
  claraoDeFogo(ctx, a.x0, a.x1, y0 - a.vh * (s.clarao ?? 0.32), y0 + 30, a.chama, a.fogo * (s.alfa ?? 1));
  ctx.restore();
  frenteDeFogo(ctx, {
    x0: a.x0, x1: a.x1, passo: s.passo ?? 14, yEm, escala: s.escala ?? 26,
    t: a.tempoAnim, semente: s.semente, ch: a.chama, inten: a.fogo,
    inclina: a.inclinaFogo, alfa: s.alfa ?? 1, lateral: a.lateral, massa: s.massa ?? 1,
  });
}

function incendioLuz(ctx, a, s) {
  if (a.fogo < 0.02) return;
  const y0 = a.y(s.rel);
  const g = lerp(1, 0.5, clamp01(a.tema.brilhoBloom ?? 0.4));
  claraoDeFogo(ctx, a.x0, a.x1, y0 - a.vh * 0.12, y0 + 10, a.chama, a.fogo * 0.9 * g);
}

/** Colunas de fumaça subindo de trás do plano. */
function colunaFumaca(ctx, a, s) {
  if (a.fumaca < 0.03) return;
  const passo = s.passo ?? 700;
  const x0 = Math.floor(a.x0 / passo) * passo;
  const yb = a.y(s.rel);
  const { baixa, alta } = coresFumaca(a);
  for (let x = x0 - passo; x <= a.x1 + passo; x += passo) {
    const h = hash2(x | 0, s.semente, 41);
    if (h > (s.dens ?? 0.6)) continue;
    const h2 = hash2(x | 0, s.semente + 1, 43);
    // A fumaça sobe de onde o fogo está: do lado da fuga ela rareia.
    if (hash2(x | 0, s.semente + 2, 47) > a.lateral(x)) continue;
    pluma(ctx, {
      x: x + (h2 - 0.5) * passo * 0.6, y: yb,
      alt: a.vh * lerp(s.altMin ?? 0.55, s.altMax ?? 1.1, h2),
      larg: lerp(s.largMin ?? 26, s.largMax ?? 60, h),
      t: a.tempoAnim, vel: 0.022, semente: (x | 0) + s.semente,
      // A fumaça vai pro MESMO lado que os bichos correm: o vento que a
      // leva é o que empurra o fogo, e todo mundo foge dele.
      // Tombada pelo vento, 10–15°: coluna perfeitamente vertical lia como
      // lagarta em pé.
      deriva: a.inclinaFogo * 2.8,
      corBaixa: baixa, corAlta: alta, alfa: 0.5 * a.fumaca * (s.alfa ?? 1),
    });
  }
}

/**
 * Árvore em chamas: tronco carbonizado, galhos quebrados, fogo na copa e nas
 * pontas. Restaurada, a mesma árvore continua carbonizada — a cicatriz fica —
 * mas BROTA: tufos de folha nova nas pontas dos galhos, onde antes era fogo.
 */
function arvoreEmChamas(ctx, a, s) {
  const passo = s.passo ?? 460;
  const x0 = Math.floor(a.x0 / passo) * passo;
  const yb = a.y(s.rel);
  const tronco = new Path2D();
  // Galho em caminho PRÓPRIO: ele nasce DENTRO do tronco, e num caminho só
  // qualquer galho traçado no sentido oposto abriria um buraco exatamente
  // onde sai da madeira. Separado, o sentido deixa de importar.
  const galhos = new Path2D();
  const pb = new Path2D(), pm = new Path2D(), pn = new Path2D();
  const rachas = new Path2D();
  const brotos = new Path2D();
  const t = a.tempoAnim;
  let algumFogo = false;

  for (let x = x0 - passo; x <= a.x1 + passo; x += passo) {
    const h = hash2(x | 0, s.semente, 3);
    if (h > (s.dens ?? 0.55)) continue;
    const h2 = hash2(x | 0, s.semente + 1, 5);
    const h3 = hash2(x | 0, s.semente + 2, 7);
    const px = x + (h2 - 0.5) * passo * 0.6;
    const alt = lerp(s.altMin ?? 150, s.altMax ?? 330, h3);
    const r = lerp(s.largMin ?? 6, s.largMax ?? 16, h2);
    const inc = (h - 0.5) * 0.22;
    const tx = px + inc * alt;
    const ty = yb - alt;

    // Tronco: base alargada, topo QUEBRADO em ponta irregular (árvore que
    // queimou não termina em copa, termina em lasca).
    tronco.moveTo(px - r * 1.6, yb + 6);
    tronco.quadraticCurveTo(px - r * 0.9, yb - alt * 0.12, lerp(px, tx, 0.5) - r * 0.62, yb - alt * 0.5);
    tronco.lineTo(tx - r * 0.34, ty + r * 0.8);
    tronco.lineTo(tx - r * 0.1, ty - r * 0.9);
    tronco.lineTo(tx + r * 0.12, ty + r * 0.3);
    tronco.lineTo(tx + r * 0.3, ty - r * 0.3);
    tronco.lineTo(lerp(px, tx, 0.5) + r * 0.6, yb - alt * 0.5);
    tronco.quadraticCurveTo(px + r * 0.9, yb - alt * 0.12, px + r * 1.6, yb + 6);
    tronco.closePath();

    // Galhos: fita afinando, quase todos subindo e alguns quebrados curtos.
    const nG = 2 + ((h3 * 3) | 0);
    const pontas = [[tx, ty]];
    for (let g = 0; g < nG; g++) {
      const hg = hash2((x | 0) + g * 31, s.semente + 9, 11);
      const k = lerp(0.42, 0.86, hg);
      const bx = lerp(px, tx, k), by = yb - alt * k;
      const lado = g % 2 === 0 ? -1 : 1;
      const ang = -Math.PI / 2 + lado * lerp(0.55, 1.15, hg);
      const comp = alt * lerp(0.14, 0.34, hash2(g, x | 0, 13)) * (hg > 0.8 ? 0.45 : 1);
      const ex = bx + Math.cos(ang) * comp, ey = by + Math.sin(ang) * comp;
      const w = r * lerp(0.35, 0.6, hg);
      const nx = -Math.sin(ang) * w, ny = Math.cos(ang) * w;
      galhos.moveTo(bx - nx, by - ny);
      galhos.quadraticCurveTo(lerp(bx, ex, 0.5) + ny * 0.8, lerp(by, ey, 0.5) - nx * 0.8, ex, ey);
      galhos.lineTo(bx + nx, by + ny);
      galhos.closePath();
      pontas.push([ex, ey]);
    }

    // Rachas em brasa no tronco — o fogo por DENTRO da madeira.
    if (a.fogo > 0.05) {
      for (let k = 0; k < 3; k++) {
        const hk = hash2((x | 0) + k * 7, s.semente, 17);
        const ry = yb - alt * lerp(0.15, 0.7, hk);
        const rx = lerp(px, tx, lerp(0.15, 0.7, hk)) + (hk - 0.5) * r * 0.8;
        rachas.moveTo(rx, ry);
        rachas.lineTo(rx + (hk - 0.5) * r * 0.5, ry - r * lerp(1.2, 3, hk));
      }
    }

    /* Fogo na copa e nas pontas. Nem toda árvore queima com a mesma força — e
       nenhuma queima forte PERTO do Guardião. Medido: uma copa acesa entre
       dois andares de plataforma tinha luminância 0,48 contra 0,40 do herói;
       a coisa mais clara perto do jogador era um enfeite, e o jogador lê
       enfeite brilhante como perigo. Mesma ideia da máscara do primeiro
       plano: a força cai conforme a árvore se aproxima dele na tela. */
    const longe = clamp01((Math.abs(tx - a.jogX) - 90) / 320);
    const inten = a.fogo * lerp(0.55, 1, h2) * lerp(0.22, 1, longe) * a.lateral(tx);
    if (inten > 0.04) {
      algumFogo = true;
      /* TOCHA. Com o fogo forte (lado do fogo, longe do Guardião) a árvore
         queima INTEIRA: línguas subindo pelo tronco e a copa engolida. Um
         tufinho na ponta de cada galho lia como vela de aniversário — era o
         fogo decorando a árvore, não consumindo. */
      const tocha = clamp01((inten - 0.4) / 0.35);
      for (let i = 0; i < pontas.length; i++) {
        const [ex, ey] = pontas[i];
        const hi = hash2((x | 0) + i * 13, s.semente, 19);
        const n = (i === 0 ? 3 : 2) + (tocha > 0.5 ? 1 : 0);
        for (let j = 0; j < n; j++) {
          const hj = hash2((x | 0) + i * 13 + j, s.semente, 23);
          tufo(pb, pm, pn, ex + (hj - 0.5) * r * (2.2 + 1.6 * tocha), ey + r * 0.6,
            r * lerp(3, 6, hj) * (i === 0 ? 1.5 : 1) * inten * (1 + 0.7 * tocha),
            r * lerp(1.4, 2.2, hi) * (1 + 0.5 * tocha), t, hj + hi, a.inclinaFogo);
        }
      }
      if (tocha > 0.05) {
        for (let k = 0; k < 4; k++) {
          const hk = hash2((x | 0) + k * 5, s.semente, 37);
          const kk = lerp(0.18, 0.8, (k + hk * 0.7) / 4);
          const lado = k % 2 ? 1 : -1;
          tufo(pb, pm, pn, lerp(px, tx, kk) + lado * r * 0.55, yb - alt * kk,
            r * lerp(3.2, 5.5, hk) * tocha, r * lerp(1.5, 2.3, hk), t, hk + k * 0.37, a.inclinaFogo);
        }
      }
    }

    // Broto: onde havia fogo, folha nova.
    if (a.calma > 0.02) {
      for (let i = 1; i < pontas.length; i++) {
        const [ex, ey] = pontas[i];
        const rr = r * lerp(1.3, 2.2, hash2(i, x | 0, 29)) * a.calma;
        elipse(brotos, ex, ey, rr, rr * 0.7, 0.3);
      }
    }
  }

  ctx.fillStyle = ajustarBrilho(a.cor, -0.05);
  ctx.fill(tronco);
  ctx.fill(galhos);
  if (a.calma > 0.02) {
    ctx.fillStyle = rgba(misturarHex(a.cor, a.tema.acento, 0.4), 0.9 * a.calma);
    ctx.fill(brotos);
  }
  if (a.fogo > 0.05) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(a.chama.brasa, 0.7 * a.fogo);
    ctx.lineWidth = 1.4;
    ctx.stroke(rachas);
    ctx.restore();
  }
  if (algumFogo) preencherFogo(ctx, pb, pm, pn, a.chama, 1);
}

function arvoreEmChamasLuz(ctx, a, s) {
  if (a.fogo < 0.05) return;
  const passo = s.passo ?? 460;
  const x0 = Math.floor(a.x0 / passo) * passo;
  const yb = a.y(s.rel);
  const g = lerp(1, 0.55, clamp01(a.tema.brilhoBloom ?? 0.4));
  ctx.fillStyle = rgba(a.chama.meio, 0.5 * a.fogo * g);
  for (let x = x0 - passo; x <= a.x1 + passo; x += passo) {
    const h = hash2(x | 0, s.semente, 3);
    if (h > (s.dens ?? 0.55)) continue;
    const h2 = hash2(x | 0, s.semente + 1, 5);
    const h3 = hash2(x | 0, s.semente + 2, 7);
    const px = x + (h2 - 0.5) * passo * 0.6;
    const alt = lerp(s.altMin ?? 150, s.altMax ?? 330, h3);
    const tx = px + (h - 0.5) * 0.22 * alt;
    // A mesma máscara da cena: o halo não pode ficar forte do lado do herói.
    const longe = clamp01((Math.abs(tx - a.jogX) - 90) / 320);
    if (longe < 0.05) continue;
    ctx.globalAlpha = lerp(0.22, 1, longe);
    // A árvore-tocha acende um halo maior e mais baixo, que pega o tronco.
    const inten = a.fogo * lerp(0.55, 1, h2) * lerp(0.22, 1, longe) * a.lateral(tx);
    const tocha = clamp01((inten - 0.4) / 0.35);
    const r = lerp(s.largMin ?? 6, s.largMax ?? 16, h2) * (4 + 3 * tocha);
    ctx.beginPath();
    ctx.arc(tx, yb - alt * (1 - 0.2 * tocha), r, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* --- desmatamento ------------------------------------------------------ */

/**
 * Tocos de corte reto e toras caídas. A face do corte é CLARA — madeira viva
 * recém-exposta — e é ela que faz a leitura instantânea: uma fileira de
 * elipses pálidas no chão é desmatamento a qualquer distância, sem precisar
 * de uma única serra na tela. Restaurado, o toco brota.
 */
function tocos(ctx, a, s) {
  const passo = s.passo ?? 150;
  const x0 = Math.floor(a.x0 / passo) * passo;
  const y0 = a.y(s.rel);
  const solo = s.solo;
  const yEm = (x) => y0 - (solo ? a.perfil(x, solo) : 0);
  const corpo = new Path2D(), cortes = new Path2D(), aneis = new Path2D();
  const talos = new Path2D(), folhas = new Path2D();
  const madeira = misturarHex(a.cor, '#c9a574', lerp(0.42, 0.18, a.calma));
  const esc = s.escala ?? 1;

  for (let x = x0 - passo; x <= a.x1 + passo; x += passo) {
    const h = hash2(x | 0, s.semente, 51);
    if (h > (s.dens ?? 0.7)) continue;
    const h2 = hash2(x | 0, s.semente + 1, 53);
    const px = x + (h2 - 0.5) * passo * 0.7;
    const yb = yEm(px);
    if (h2 > 0.72) {
      // TORA caída: cilindro deitado em diagonal leve, corte à vista na ponta.
      const comp = lerp(90, 200, h) * esc;
      const r = lerp(7, 14, h2) * esc;
      const inc = (h - 0.5) * 0.18;
      const ex = px + comp, ey = yb + inc * comp;
      corpo.moveTo(px, yb - r * 2);
      corpo.lineTo(ex, ey - r * 2);
      corpo.lineTo(ex, ey);
      corpo.lineTo(px, yb);
      corpo.closePath();
      elipse(cortes, ex, ey - r, r * 0.55, r);
      continue;
    }
    const r = lerp(8, 18, h) * esc;
    const alt = lerp(10, 26, h2) * esc;
    const inclCorte = (h - 0.5) * 0.35;
    // Base com raiz alargada, corte inclinado no topo.
    corpo.moveTo(px - r * 1.5, yb + 3);
    corpo.quadraticCurveTo(px - r, yb - alt * 0.3, px - r, yb - alt + inclCorte * r);
    corpo.lineTo(px + r, yb - alt - inclCorte * r);
    corpo.quadraticCurveTo(px + r, yb - alt * 0.3, px + r * 1.5, yb + 3);
    corpo.closePath();
    const cy = yb - alt;
    elipse(cortes, px, cy, r, r * 0.32, -inclCorte * 0.5);
    elipse(aneis, px, cy, r * 0.55, r * 0.17, -inclCorte * 0.5);
    if (a.calma > 0.02) {
      // Dois brotos em V saindo da borda do corte.
      for (let k = 0; k < 2; k++) {
        const bx = px + (k ? r * 0.55 : -r * 0.45);
        const hk = alt * lerp(1.6, 2.6, hash2(k, x | 0, 57)) * a.calma;
        const tx = bx + (k ? 3 : -4) * esc;
        talos.moveTo(bx, cy);
        talos.quadraticCurveTo(bx + (k ? 6 : -6) * esc, cy - hk * 0.6, tx, cy - hk);
        elipse(folhas, tx, cy - hk, 9 * esc, 4 * esc, k ? 0.5 : -0.5);
        elipse(folhas, lerp(bx, tx, 0.55) + (k ? 5 : -5) * esc, cy - hk * 0.55,
          7 * esc, 3 * esc, k ? 0.9 : -0.9);
      }
    }
  }
  // O corpo do toco tinha o valor do morro e sumia — sobravam só as faces
  // do corte flutuando, "lentilhas bege". Um degrau mais escuro que o chão.
  ctx.fillStyle = ajustarBrilho(a.cor, -0.16); ctx.fill(corpo);
  ctx.fillStyle = madeira; ctx.fill(cortes);
  ctx.save();
  ctx.strokeStyle = rgba(a.cor, 0.45);
  ctx.lineWidth = 1;
  ctx.stroke(aneis);
  if (a.calma > 0.02) {
    const verde = misturarHex(a.cor, a.tema.acento, 0.55);
    ctx.strokeStyle = rgba(verde, a.calma);
    ctx.fillStyle = rgba(verde, a.calma);
    ctx.lineWidth = 1.4;
    ctx.stroke(talos);
    ctx.fill(folhas);
  }
  ctx.restore();
}

/**
 * A máquina: uma escavadeira-florestal parada na borda do desmate, farol
 * aceso, escapamento soltando fumaça. É o único objeto HUMANO do jogo que
 * está funcionando — e por isso mesmo o mais inquietante do fundo.
 * Some com a restauração (alfa = 1 - calma).
 */
function maquina(ctx, a, s) {
  const vis = 1 - a.calma;
  if (vis < 0.03) return;
  const passo = s.passo ?? 1800;
  const x0 = Math.floor(a.x0 / passo) * passo;
  const y0 = a.y(s.rel);
  const solo = s.solo;
  const esc = s.escala ?? 1;
  for (let x = x0 - passo; x <= a.x1 + passo; x += passo) {
    const h = hash2(x | 0, s.semente, 61);
    if (h > (s.dens ?? 0.7)) continue;
    const px = x + (hash2(x | 0, s.semente + 1, 63) - 0.5) * passo * 0.4;
    const yb = y0 - (solo ? a.perfil(px, solo) : 0);
    const lado = h > 0.35 ? 1 : -1;
    ctx.save();
    ctx.translate(px, yb);
    ctx.scale(lado * esc, esc);
    ctx.globalAlpha = vis;
    ctx.fillStyle = a.cor;
    ctx.beginPath();
    // esteira
    // Todos os subcaminhos no MESMO sentido (horário na tela): com sentidos
    // opostos a regra nonzero recorta um fio onde a esteira encosta no chassi.
    ctx.moveTo(-58, -14); ctx.lineTo(52, -14);
    ctx.quadraticCurveTo(64, -6, 52, 0); ctx.lineTo(-58, 0);
    ctx.quadraticCurveTo(-70, -6, -58, -14);
    // chassi e cabine
    ctx.rect(-50, -30, 84, 17);
    ctx.moveTo(-6, -30); ctx.lineTo(-4, -56); ctx.lineTo(26, -56); ctx.lineTo(32, -30);
    // escapamento
    ctx.rect(-36, -46, 5, 17);
    // braço com a garra/cabeçote
    ctx.moveTo(30, -38); ctx.lineTo(82, -78); ctx.lineTo(88, -72); ctx.lineTo(38, -30);
    ctx.moveTo(82, -80); ctx.lineTo(104, -64); ctx.lineTo(98, -46); ctx.lineTo(80, -58);
    ctx.fill();
    // janela da cabine, levemente acesa por dentro
    ctx.fillStyle = rgba(misturarHex(a.cor, '#ffd89a', 0.35), 0.8);
    ctx.fillRect(2, -52, 20, 14);
    // farol
    // Farol: com a máquina a 0,42 um raio de 2,6 virava 1 px. Tem um mínimo
    // em pixel de tela, senão o único ponto aceso da encosta não existe.
    ctx.fillStyle = rgba('#fff4d2', 0.95);
    ctx.beginPath(); ctx.arc(34, -34, Math.max(2.6, 4 / esc), 0, TAU); ctx.fill();
    ctx.restore();
    // Escapamento: fumaça escura saindo em sopros.
    const { alta } = coresFumaca(a, 0);
    pluma(ctx, {
      x: px + (-33.5 * lado) * esc, y: yb - 46 * esc, alt: 150 * esc, larg: 6 * esc,
      t: a.tempoAnim, vel: 0.08, semente: (x | 0) + 7,
      deriva: 0.5 * a.fuga, corBaixa: ajustarBrilho(alta, -0.12), corAlta: alta,
      alfa: 0.55 * vis,
    });
  }
  ctx.globalAlpha = 1;
}

function maquinaLuz(ctx, a, s) {
  const vis = 1 - a.calma;
  if (vis < 0.03) return;
  const passo = s.passo ?? 1800;
  const x0 = Math.floor(a.x0 / passo) * passo;
  const y0 = a.y(s.rel);
  const esc = s.escala ?? 1;
  for (let x = x0 - passo; x <= a.x1 + passo; x += passo) {
    const h = hash2(x | 0, s.semente, 61);
    if (h > (s.dens ?? 0.7)) continue;
    const px = x + (hash2(x | 0, s.semente + 1, 63) - 0.5) * passo * 0.4;
    const yb = y0 - (s.solo ? a.perfil(px, s.solo) : 0);
    const lado = h > 0.35 ? 1 : -1;
    const fx = px + 34 * lado * esc, fy = yb - 34 * esc;
    // Cone do farol varrendo o chão da frente.
    const halo = ctx.createRadialGradient(fx, fy, 0, fx, fy, 18);
    halo.addColorStop(0, rgba('#fff4d8', 0.9 * vis));
    halo.addColorStop(1, rgba('#fff4d8', 0));
    ctx.fillStyle = halo;
    ctx.fillRect(fx - 18, fy - 18, 36, 36);
    const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, 160 * esc);
    g.addColorStop(0, rgba('#fff0c8', 0.55 * vis));
    g.addColorStop(1, rgba('#fff0c8', 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx + 170 * lado * esc, fy + 40 * esc);
    ctx.lineTo(fx + 170 * lado * esc, fy - 26 * esc);
    ctx.closePath();
    ctx.fill();
  }
}

/* --- várzea: óleo e lixo ------------------------------------------------ */

/**
 * O que boia na linha d'água. Poluída: tambor com faixa amarela de risco,
 * pneu, sacola branca presa. Restaurada: vitória-régia e flor, nas MESMAS
 * posições — o lixo não some, ele é substituído, e é a troca de forma no
 * mesmo lugar que o olho percebe como "isto sarou".
 */
function lixo(ctx, a, s) {
  const passo = s.passo ?? 180;
  const x0 = Math.floor(a.x0 / passo) * passo;
  const yA = a.y(s.rel);
  const t = a.tempoAnim;
  const sujo = 1 - a.calma;
  const corpo = new Path2D(), faixas = new Path2D(), sacolas = new Path2D();
  const folhas = new Path2D(), flores = new Path2D();
  const esc = s.escala ?? 1;

  for (let x = x0 - passo; x <= a.x1 + passo; x += passo) {
    const h = hash2(x | 0, s.semente, 71);
    if (h > (s.dens ?? 0.6)) continue;
    const h2 = hash2(x | 0, s.semente + 1, 73);
    const px = x + (h2 - 0.5) * passo * 0.6;
    const boia = Math.sin(t * lerp(0.8, 1.4, h) + h * TAU) * 1.6 * esc;
    const y = yA + boia;
    if (sujo > 0.03) {
      if (h2 < 0.4) {
        // Tambor tombado de lado, metade pra fora d'água.
        const w = 15 * esc, hh = 11 * esc, rot = (h - 0.5) * 0.5;
        const c = Math.cos(rot), sn = Math.sin(rot);
        const P = (u, v) => [px + u * c - v * sn, y + u * sn + v * c];
        const pts = [P(-w, 0), P(-w, -hh), P(w, -hh), P(w, 0)];
        corpo.moveTo(...pts[0]);
        for (let i = 1; i < 4; i++) corpo.lineTo(...pts[i]);
        corpo.closePath();
        const f1 = P(-w * 0.25, 0), f2 = P(-w * 0.25, -hh), f3 = P(w * 0.1, -hh), f4 = P(w * 0.1, 0);
        faixas.moveTo(...f1); faixas.lineTo(...f2); faixas.lineTo(...f3); faixas.lineTo(...f4); faixas.closePath();
      } else if (h2 < 0.7) {
        // Pneu: meio anel acima da lâmina.
        const r = 11 * esc;
        corpo.moveTo(px - r, y);
        corpo.arc(px, y, r, Math.PI, 0);
        corpo.lineTo(px + r * 0.52, y);
        corpo.arc(px, y, r * 0.52, 0, Math.PI, true);
        corpo.closePath();
      } else {
        // Sacola presa, estufando com o vento.
        const inf = 0.8 + 0.25 * Math.sin(t * 3 + h * 20) + a.ventoAqui * 0.15;
        const sx = px, sy = y - 4 * esc;
        sacolas.moveTo(sx - 5 * esc, sy);
        sacolas.quadraticCurveTo(sx - 9 * esc * inf, sy - 10 * esc, sx - 2 * esc, sy - 14 * esc * inf);
        sacolas.quadraticCurveTo(sx + 8 * esc * inf, sy - 12 * esc, sx + 6 * esc, sy);
        sacolas.closePath();
      }
    }
    if (a.calma > 0.03) {
      const r = lerp(10, 18, h) * esc;
      folhas.moveTo(px, y);
      folhas.ellipse(px, y, r, r * 0.26, 0, 0.18, TAU - 0.18);
      folhas.closePath();
      if (h2 > 0.55) {
        const fx = px + r * 0.3, fy = y - r * 0.3;
        for (let k = 0; k < 5; k++) {
          const ang = -Math.PI / 2 + (k - 2) * 0.45;
          elipse(flores, fx + Math.cos(ang) * 3.2 * esc, fy + Math.sin(ang) * 3.2 * esc,
            3.4 * esc, 1.5 * esc, ang);
        }
      }
    }
  }
  if (sujo > 0.03) {
    ctx.globalAlpha = sujo;
    ctx.fillStyle = a.cor; ctx.fill(corpo);
    // Aro ESCURO, não faixa dourada: caixote com faixa dourada é o ícone
    // universal de baú, e num metroidvania isso diz "colete isto".
    ctx.fillStyle = ajustarBrilho(a.cor, -0.2); ctx.fill(faixas);
    ctx.fillStyle = misturarHex(a.cor, '#ece8dc', 0.42); ctx.fill(sacolas);
  }
  if (a.calma > 0.03) {
    ctx.globalAlpha = a.calma;
    ctx.fillStyle = misturarHex(a.cor, a.tema.acento, 0.4); ctx.fill(folhas);
    ctx.fillStyle = misturarHex(a.cor, '#ffd6ec', 0.5); ctx.fill(flores);
  }
  ctx.globalAlpha = 1;
}

/**
 * Mancha de óleo na lâmina: faixas finas com cor de arco-íris (o furta-cor
 * do petróleo é a assinatura visual mais reconhecível que existe de água
 * contaminada). Vai em 'screen' pra clarear sem apagar o que está embaixo.
 */
export function oleoNaLamina(ctx, x0, x1, y, t, semente, forca, escala = 1) {
  if (forca < 0.03) return;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const passo = 150 * escala;
  // A mancha deriva até 3 passos: começar só em `floor(x0/passo)` fazia as de
  // índice menor surgirem e sumirem no meio da tela quando a câmera andava.
  const i0 = Math.floor(x0 / passo) - 3;
  for (let i = i0; i * passo <= x1; i++) {
    const h = hash2(i, semente, 81);
    if (h > 0.62) continue;
    const ciclo = passo * 2;
    const deriva = (t * lerp(3, 8, h)) % ciclo;
    const cx = i * passo + h * passo + deriva;
    const w = lerp(40, 110, hash2(i, semente, 83)) * escala;
    if (cx + w < x0 || cx - w > x1) continue;
    // Some e renasce em fade: sem isso, a cada volta do módulo a mancha
    // saltava pra trás dois passos inteiros.
    const vida = Math.sin(Math.PI * deriva / ciclo);
    const g = ctx.createLinearGradient(cx - w, 0, cx + w, 0);
    const al = 0.22 * forca * vida;
    g.addColorStop(0, rgba('#ff4fd8', 0));
    g.addColorStop(0.25, rgba('#ff4fd8', al));
    g.addColorStop(0.5, rgba('#46e0d0', al));
    g.addColorStop(0.75, rgba('#ffe45a', al));
    g.addColorStop(1, rgba('#ffe45a', 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, y + 2 * escala, w, 2.4 * escala, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function oleo(ctx, a, s) {
  oleoNaLamina(ctx, a.x0, a.x1, a.y(s.rel), a.tempoAnim, s.semente, 1 - a.calma, s.escala ?? 0.7);
}

/* =========================================================================
   5 · FAUNA
   -------------------------------------------------------------------------
   Silhuetas de perfil desenhadas em unidades de CORPO (L = 1), olhando pra
   +x, chão em y = 0. Cada espécie tem corpo, cabeça (num pivô próprio, que é
   o que permite a cabeça esticar na fuga e baixar pra pastar) e quatro
   patas animadas por fase.

   A escolha das espécies não é neutra: veado, capivara e tamanduá-bandeira
   são os animais que aparecem nas imagens reais dos incêndios no Pantanal e
   no Cerrado. O tamanduá, em especial, é lento — ele não escapa correndo, ele
   vai TROTANDO, e é isso que dói.
   ========================================================================= */

const ESPECIES = {
  veado: {
    corpo: [[-0.5, -0.7], [-0.57, -0.8], [-0.5, -0.83], [-0.4, -0.75], [-0.15, -0.78],
      [0.14, -0.77], [0.32, -0.81], [0.42, -0.71], [0.4, -0.55], [0.24, -0.48],
      [-0.1, -0.5], [-0.34, -0.53], [-0.48, -0.61]],
    pivo: [0.36, -0.75],
    // Pescoço GROSSO na base afinando pra cabeça. Com a base fina e a cabeça
    // larga, o conjunto lia como uma trombeta.
    cabeca: [[-0.08, 0.06], [-0.01, -0.12], [0.07, -0.27], [0.03, -0.4], [-0.02, -0.55],
      [0.08, -0.46], [0.12, -0.39], [0.19, -0.36], [0.31, -0.3], [0.36, -0.26], [0.31, -0.22],
      [0.2, -0.22], [0.16, -0.1], [0.14, 0.1]],
    quadris: [[0.3, -0.56], [-0.36, -0.58]],
    perna: [0.3, 0.32], grossura: [0.075, 0.045],
    // Galope ESTICADO (amp alta, cabeça baixa à frente): com 0,95 e cabeça
    // erguida o veado lia como bicho trotando, não fugindo.
    freq: 2.1, amp: 1.2, salto: 0.13, cabecaFuga: 0.45, cabecaPasto: 2.0, pastoInclina: 0.16,
    cabecaDeitado: 1.35, cabecaLado: 1.3, olho: [0.22, -0.31],
    comp: 1.3,
  },
  capivara: {
    corpo: [[-0.52, -0.3], [-0.5, -0.43], [-0.38, -0.53], [-0.1, -0.57], [0.18, -0.56],
      [0.34, -0.5], [0.4, -0.4], [0.36, -0.26], [0.2, -0.2], [-0.1, -0.19],
      [-0.36, -0.2], [-0.48, -0.24]],
    pivo: [0.34, -0.47],
    cabeca: [[-0.04, -0.06], [0.02, -0.14], [0.06, -0.17], [0.06, -0.21], [0.1, -0.19],
      [0.11, -0.15], [0.25, -0.12], [0.31, -0.07], [0.32, 0.01], [0.27, 0.06],
      [0.13, 0.07], [0.01, 0.08]],
    quadris: [[0.26, -0.26], [-0.34, -0.26]],
    perna: [0.13, 0.13], grossura: [0.09, 0.06],
    freq: 2.6, amp: 0.85, salto: 0.06, cabecaFuga: 0.25, cabecaPasto: 0.9, pastoInclina: 0.06,
    cabecaDeitado: 0.7, cabecaLado: 0.95, olho: [0.17, -0.12],
    comp: 1.2,
  },
  /* Tamanduá-bandeira: lia como raposa. O que identifica o bicho são duas
     coisas e as duas faltavam — o FOCINHO tubular longo apontado pra baixo
     (aqui ~40% do corpo) e a FAIXA diagonal clara do ombro. A cauda-bandeira
     ficou menor pra não roubar a silhueta. */
  tamandua: {
    corpo: [[-0.4, -0.3], [-0.38, -0.46], [-0.2, -0.55], [0.08, -0.62], [0.26, -0.6],
      [0.36, -0.48], [0.34, -0.33], [0.1, -0.27], [-0.2, -0.27], [-0.36, -0.29]],
    // Cauda-bandeira: leque CHATO e comprido pra trás, quase do tamanho do
    // corpo — não bolota. É a metade de trás da silhueta do bicho.
    // Começa e termina DENTRO do corpo: o contorno suave passa pelos pontos
    // médios e, com as pontas na borda, a cauda saía descolada da garupa.
    // Mesmo SENTIDO do corpo (horário): no mesmo Path2D, sentido oposto faz a
    // regra nonzero abrir buraco onde os dois se sobrepõem — e o contorno de
    // luz, pintado antes, aparecia pela fresta como um fio piscando.
    cauda: [[-0.3, -0.32], [-0.5, -0.27], [-0.76, -0.24], [-0.98, -0.3],
      [-1.02, -0.46], [-0.86, -0.58], [-0.52, -0.6], [-0.3, -0.47]],
    /* A faixa do tamanduá é PRETA com borda BRANCA, na diagonal do ombro. Uma
       elipse laranja ali lia como olho — o bicho virava peixe. */
    faixa: [[0.32, -0.57], [0.16, -0.6], [-0.14, -0.39], [0.0, -0.35]],
    faixaPreta: [[0.24, -0.58], [0.14, -0.59], [-0.1, -0.4], [-0.02, -0.37]],
    pivo: [0.34, -0.46],
    // Focinho RETO afinando — tubo, não tromba. Curvado pra baixo ele lia
    // como foice.
    cabeca: [[-0.02, -0.1], [0.12, -0.12], [0.3, -0.07], [0.62, 0.02], [0.66, 0.05],
      [0.62, 0.07], [0.3, 0.06], [0.12, 0.08], [-0.02, 0.08]],
    quadris: [[0.22, -0.3], [-0.28, -0.3]],
    perna: [0.14, 0.15], grossura: [0.09, 0.06],
    freq: 1.3, amp: 0.6, salto: 0.02, cabecaFuga: 0.22, cabecaPasto: 0.8, pastoInclina: 0.04,
    cabecaDeitado: 0.2, cabecaLado: 0.22, olho: [0.16, -0.05],
    comp: 2.0,
  },
};

/** Contorno fechado suavizado: curva pelos PONTOS MÉDIOS, cantos arredondados. */
function contornoSuave(p, pts, ox, oy, rot = 0) {
  const n = pts.length;
  const c = Math.cos(rot), s = Math.sin(rot);
  const T = (q) => [ox + q[0] * c - q[1] * s, oy + q[0] * s + q[1] * c];
  const pts2 = pts.map(T);
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m0 = mid(pts2[n - 1], pts2[0]);
  p.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const q = pts2[i], m = mid(q, pts2[(i + 1) % n]);
    p.quadraticCurveTo(q[0], q[1], m[0], m[1]);
  }
  p.closePath();
}

/**
 * Um animal. Desenha no `ctx` já transladado/escalado pelo chamador:
 * origem no chão, L = 1, olhando pra +x.
 * @param {number} fuga  1 = galope, 0 = pastando parado
 */
function animal(ctx, esp, fase, fuga, tempo, h, borda = null, pose = null) {
  const E = ESPECIES[esp];
  const galope = fuga;
  /* `pose.deitado` (0..1): o bicho EXAUSTO, caído — corpo no chão, patas
     dobradas, cabeça apoiada à frente, respiração pesada. `pose.ergue`
     (0..1): levanta a cabeça pra olhar alguém que chega perto. */
  const deitado = pose?.deitado ?? 0;
  const ergue = pose?.ergue ?? 0;
  /* `pose.deLado` (0..1): caído DE LADO — pernas esticadas pra fora, cabeça
     no chão com o pescoço estendido. Deitado sobre o peito, de cabeça
     erguida, é a pose do bicho saudável descansando; de lado é a do bicho
     que não aguenta mais. `pose.peito` substitui a respiração regular (quem
     chama decide o ritmo — e as pausas). `pose.sacode`: deslocamento lateral
     de quem se sacode pra tirar a cinza. */
  const deLado = pose?.deLado ?? 0;
  // Suspensão: no galope o corpo inteiro sai do chão numa fase do ciclo.
  const salto = E.salto * Math.pow(Math.max(0, Math.sin(fase + 1.2)), 2) * galope;
  /* Pastando, o corpo INCLINA pra frente em volta do quadril de trás: só
     girar o pescoço não leva a boca ao chão (a cernelha fica alta demais),
     e o veado "pastando" lia como mesa com cabeça. */
  // Deitado não pasta: sem isso o bicho caído mergulhava o focinho no chão.
  const arfagem = Math.sin(fase) * 0.06 * galope
    + (1 - galope) * (1 - deitado) * (E.pastoInclina ?? 0);
  const yCorpo = -salto;

  ctx.save();
  ctx.translate(pose?.sacode ?? 0, yCorpo);
  // Onde fica o chão no espaço local do corpo (pra nenhuma pata atravessá-lo
  // enquanto o bicho se deita ou levanta).
  let chao = -yCorpo;
  if (deitado > 0) {
    /* Afunda até a BARRIGA encostar no chão, e respira: o corpo sobe e desce
       sempre a partir da barriga. De lado ele ainda achata um pouco. A
       escala é em volta da barriga, não da origem — em volta da origem o
       achatamento afundava o bicho caído 10 px dentro do chão. */
    const barriga = E.barriga ?? Math.max(...E.corpo.map((c) => c[1]));
    const resp = pose?.peito ?? (1 + Math.sin(tempo * 1.7 + h * 9) * 0.035 * deitado);
    const k = resp * (1 - 0.14 * deLado);
    const esc = lerp(1, k, deitado), desce = (0.02 - barriga * k) * deitado;
    ctx.translate(0, desce);
    ctx.scale(1, esc);
    chao = (chao - desce) / esc;
  }
  if (galope < 1) {
    const [qx, qy] = E.quadris[1];
    // Girar em volta do quadril de trás afunda as patas da frente no chão;
    // o corpo sobe metade dessa queda e o erro se divide entre as duas pontas.
    const queda = Math.sin(arfagem) * (E.quadris[0][0] - qx);
    ctx.translate(0, -queda * 0.5);
    ctx.translate(qx, qy); ctx.rotate(arfagem); ctx.translate(-qx, -qy);
  } else ctx.rotate(arfagem);

  // Patas primeiro: a do lado de lá fica atrás do corpo.
  ctx.lineCap = 'round';
  const [q1, q2] = E.perna;
  const pata = (hx, hy, fs, frente) => {
    let th, baixo;
    if (galope > 0.02) {
      th = E.amp * Math.sin(fs) * galope;
      baixo = frente
        ? th - 1.1 * clamp01(Math.cos(fs)) * galope
        // Jarrete: dobra pra trás, mas pouco — com 0,9 a canela de trás
        // deitava na horizontal e virava uma prateleira sob o corpo.
        : th + 0.25 * galope + 0.55 * clamp01(-Math.cos(fs)) * galope;
    } else { th = 0; baixo = 0; }
    // Pastando: pequena base aberta, pata da frente um pouco adiante.
    th += (1 - galope) * (frente ? 0.06 : -0.08);
    baixo += (1 - galope) * (frente ? 0.04 : -0.12);
    /* Deitado: coxa pra FRENTE quase na horizontal e canela voltando pra
       trás por baixo do corpo — a perna vira um Z deitado no chão. Com a
       coxa pra trás, a canela de trás apontava pro alto e o bicho caído
       ganhava dois palitos espetados. */
    if (deitado > 0) {
      th = lerp(th, frente ? 1.45 : 1.35, deitado);
      baixo = lerp(baixo, -1.5, deitado);
    }
    // Em pé e parado, um joelho: perna reta de ponta a ponta lia como pé de
    // mesa.
    if (galope < 0.02 && deitado < 0.02) baixo += frente ? -0.14 : 0.18;
    let kx = hx + Math.sin(th) * q1, ky = hy + Math.cos(th) * q1;
    let fx = kx + Math.sin(baixo) * q2, fy = ky + Math.cos(baixo) * q2;
    /* De lado: as patas ESTICADAS rentes ao chão — as da frente pra frente,
       as de trás pra trás; o bicho vira um comprido estirado, a leitura de
       "caído" que o deitado de peito não tinha. A transição interpola as
       POSIÇÕES de joelho e casco, não os ângulos: girando o ângulo, a perna
       de trás passava por "reta pra baixo" no meio do rolamento e atravessava
       o chão. */
    if (deLado > 0) {
      const t2 = frente ? 1.36 : -1.3, b2 = frente ? 1.56 : -1.6;
      const kx2 = hx + Math.sin(t2) * q1, ky2 = hy + Math.cos(t2) * q1;
      kx = lerp(kx, kx2, deLado); ky = lerp(ky, ky2, deLado);
      fx = lerp(fx, kx2 + Math.sin(b2) * q2, deLado);
      fy = lerp(fy, ky2 + Math.cos(b2) * q2, deLado);
    }
    // No meio do deitar/levantar, os ângulos intermediários pediam uma perna
    // mais comprida que a distância até o chão: o casco afundava. A perna
    // encolhe na vertical e abre pro lado, como quem apoia o peso.
    if (deitado > 0.02 && Math.max(fy, ky) > chao && chao > hy) {
      const f = (chao - hy) / (Math.max(fy, ky) - hy);
      ky = hy + (ky - hy) * f; fy = hy + (fy - hy) * f;
    }
    ctx.lineWidth = E.grossura[0];
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx, ky); ctx.stroke();
    ctx.lineWidth = E.grossura[1];
    ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
  };
  const [fr, tr] = E.quadris;
  pata(fr[0] - 0.04, fr[1], fase + 2.4 + 0.35, true);
  pata(tr[0] - 0.04, tr[1], fase + 0.35, false);

  const p = new Path2D();
  contornoSuave(p, E.corpo, 0, 0);
  if (E.cauda) {
    // A bandeira do tamanduá balança com o trote.
    contornoSuave(p, E.cauda, 0, 0, Math.sin(fase * 0.5) * 0.05 * galope);
  }
  let rotCabeca = lerp(E.cabecaPasto + Math.sin(tempo * 0.9 + h * 7) * 0.12, E.cabecaFuga, galope)
    + Math.sin(fase) * 0.08 * galope;
  // Deitado, a cabeça descansa à frente, rente ao chão; erguer a devolve ao
  // alto (olhando), com um tremor fraco.
  rotCabeca = lerp(rotCabeca, E.cabecaDeitado ?? 1.2, deitado);
  rotCabeca = lerp(rotCabeca, E.cabecaLado ?? 1.2, deLado);
  rotCabeca = lerp(rotCabeca, -0.15 + Math.sin(tempo * 7) * 0.03, ergue);
  contornoSuave(p, E.cabeca, E.pivo[0], E.pivo[1], rotCabeca);
  /* Contorno escuro: separa o bicho de um fundo de valor parecido (a pelagem
     marrom sobre o laranja da clareira sumia). Traçado ANTES do corpo e com o
     dobro da largura: o preenchimento cobre a metade de dentro — inclusive a
     emenda onde o pescoço entra no corpo, que num traço por cima aparecia
     como um laço no meio do pescoço. */
  if (pose?.contorno) {
    const st = ctx.strokeStyle, lw = ctx.lineWidth;
    ctx.strokeStyle = pose.contorno;
    ctx.lineWidth = 0.07;
    ctx.lineJoin = 'round';
    ctx.stroke(p);
    ctx.strokeStyle = st; ctx.lineWidth = lw;
  }
  /* CONTORNO DE LUZ: o mesmo corpo pintado antes, deslocado um fio pra cima,
     na cor do fogo. Sobra uma lasca acesa nas costas — é o que separa bicho
     escuro de chão escuro e diz de onde vem a luz. */
  if (borda) {
    const fill = ctx.fillStyle;
    ctx.save();
    // Um FIO, não uma faixa: a 0,05 do corpo a lasca tinha 2,5 px e a 1x o
    // bicho inteiro lia laranja.
    ctx.translate(0.012, -0.026);
    ctx.fillStyle = borda;
    ctx.fill(p);
    ctx.restore();
    ctx.fillStyle = fill;
  }
  ctx.fill(p);
  const fill = ctx.fillStyle;
  // Fuligem: o terço de trás do corpo escurecido — o bicho passou pelo fogo.
  if (pose?.fuligem > 0.02) {
    const g = ctx.createLinearGradient(-0.55, 0, 0.1, 0);
    g.addColorStop(0, rgba('#0c0a09', 0.62 * pose.fuligem));
    g.addColorStop(1, rgba('#0c0a09', 0));
    ctx.fillStyle = g;
    ctx.fill(p);
    ctx.fillStyle = fill;
  }
  if (E.faixa) {
    const fb = new Path2D(), fp = new Path2D();
    contornoSuave(fb, E.faixa, 0, 0);
    contornoSuave(fp, E.faixaPreta, 0, 0);
    ctx.fillStyle = misturarHex(typeof fill === 'string' ? fill : '#302820', '#ece6d8', 0.6);
    ctx.fill(fb);
    ctx.fillStyle = '#12100e';
    ctx.fill(fp);
    ctx.fillStyle = fill;
  }
  // Olho: um ponto claro gira junto com a cabeça. Sem ele a capivara caída
  // lia como pedra.
  if (pose?.olho && E.olho) {
    const c = Math.cos(rotCabeca), sn = Math.sin(rotCabeca);
    const ox = E.pivo[0] + E.olho[0] * c - E.olho[1] * sn;
    const oy = E.pivo[1] + E.olho[0] * sn + E.olho[1] * c;
    ctx.fillStyle = pose.olho;
    ctx.beginPath();
    ctx.arc(ox, oy, 0.028, 0, TAU);
    ctx.fill();
    ctx.fillStyle = fill;
  }

  pata(fr[0] + 0.04, fr[1], fase + 2.4, true);
  pata(tr[0] + 0.04, tr[1], fase, false);
  ctx.restore();
}

/** Pra folha de teste (e pra quem precisar de um bicho avulso). */
export { animal as desenharAnimal };

/**
 * Manada correndo sobre um chão — ou, restaurado, pastando.
 *
 * A fuga é sem estado: cada fatia de `passo` px tem uma manada que atravessa
 * `percurso` px num ciclo de `periodo` segundos e depois some por um tempo. A
 * entrada e a saída são em fade — os bichos SAEM DA FUMAÇA e somem nela, o
 * que num incêndio é exatamente o que se veria.
 *
 * Serve tanto a um plano de parallax quanto ao horizonte: `dx` separa a
 * coordenada em que se sorteia (presa ao mundo) da coordenada em que se
 * desenha (a do plano, ou a da tela).
 */
export function desenharManada(ctx, o) {
  const esp = o.especies;
  const dir = o.dir;
  const t = o.t;
  const dx = o.dx ?? 0;
  const fuga = 1 - o.calma;
  ctx.fillStyle = o.cor;
  ctx.strokeStyle = o.cor;
  /* Longe do Guardião. A crista do horizonte fica na altura do olho — que é
     a altura em que o jogador está. Um veado de 50 px pastando do lado dele,
     na mesma linha da plataforma, lia como bicho EM CIMA da plataforma, do
     tamanho de um inimigo. Perto dele na tela, o bicho some. */
  // Só no PASTO: bicho parado ao lado do herói confunde escala; bicho
  // passando correndo não — e apagado ele virava fantasma.
  const perto = (px) => o.evitarX == null ? 1
    : lerp(0.35, 1, clamp01((Math.abs(px - o.evitarX) - 50) / 150));

  if (fuga > 0.02) {
    const passo = o.passo ?? 1700;
    const percurso = o.percurso ?? 1500;
    const periodo = o.periodo ?? 15;
    const i0 = Math.floor((o.x0 + dx - percurso) / passo);
    const i1 = Math.ceil((o.x1 + dx + percurso) / passo);
    for (let i = i0; i <= i1; i++) {
      const hi = hash2(i, o.semente, 91);
      if (hi > (o.dens ?? 0.8)) continue;
      const u = ((t / periodo) + hi * 7.3) % 1;
      const corre = 0.55;
      if (u > corre) continue;
      const k = u / corre;
      // Entrada e saída CURTAS: bicho meio transparente por muito tempo lia
      // como alma, não como fuga.
      const fade = Math.min(clamp01(k / 0.06), clamp01((1 - k) / 0.06));
      const centro = i * passo + passo * 0.5;
      const lider = centro + dir * (k - 0.5) * percurso;
      /* 3 a 6 bichos. Grupo lê como FUGA e bicho solto lê como passeio —
         mas colados demais eles viram um bicho só de oito patas. O espaço
         entre eles é de quase um corpo, e o de trás corre um pouco mais
         abaixo (mais perto), o que separa as silhuetas. */
      const n = 3 + ((hash2(i, o.semente, 93) * 4) | 0);
      /* O espaço entre um bicho e o próximo é medido em CORPOS da espécie:
         o tamanduá, com a cauda-bandeira, tem quase o dobro do comprimento
         do veado, e no mesmo espaçamento a fila deles virava uma lagarta. */
      let atras = 0, compAnt = 0;
      for (let m = 0; m < n; m++) {
        const hm = hash2(i * 17 + m, o.semente, 97);
        const e = esp[(hm * esp.length) | 0];
        const L = lerp(o.tamMin, o.tamMax, hash2(m, i, o.semente)) * (e === 'capivara' ? 0.8 : 1);
        const comp = (ESPECIES[e].comp ?? 1.3) * L;
        if (m > 0) atras += (compAnt + comp) * 0.5 * lerp(1.12, 1.4, hm);
        compAnt = comp;
        const xm = lider - dir * atras;
        const px = xm - dx;
        if (px < o.x0 - 80 || px > o.x1 + 80) continue;
        const py = o.yEm(px) + (m % 2) * 0.1 * L;
        const freq = ESPECIES[e].freq * lerp(0.9, 1.1, hm);
        ctx.save();
        ctx.globalAlpha = fade * fuga;
        ctx.translate(px, py);
        ctx.scale(dir * L, L);
        animal(ctx, e, t * TAU * freq + hm * TAU, 1, t, hm, o.borda);
        ctx.restore();
      }
    }
  }

  if (o.calma > 0.02) {
    // Restaurado: poucos, parados, pastando. O mesmo desenho, outra FORMA —
    // cabeça baixa, patas plantadas.
    const passo = o.passoPasto ?? 900;
    const m0 = Math.floor((o.x0 + dx) / passo) * passo;
    for (let xm = m0 - passo; xm <= o.x1 + dx + passo; xm += passo) {
      const h = hash2(xm | 0, o.semente + 5, 99);
      if (h > (o.densPasto ?? 0.55)) continue;
      const n = 1 + ((hash2(xm | 0, o.semente, 101) * 3) | 0);
      for (let m = 0; m < n; m++) {
        const hm = hash2((xm | 0) + m * 13, o.semente, 103);
        const e = esp[(hm * esp.length) | 0];
        // Pastando é MENOR que fugindo: é a mesma distância, mas o bicho
        // calmo não precisa gritar — e grande e parado ele vira cenário de
        // primeiro plano.
        const L = lerp(o.tamMin, o.tamMax, hm) * (e === 'capivara' ? 0.8 : 1) * 0.75;
        const px = xm - dx + (h - 0.5) * passo * 0.5 + m * L * 1.6;
        ctx.save();
        ctx.globalAlpha = o.calma * perto(px);
        if (o.corPasto) { ctx.fillStyle = o.corPasto; ctx.strokeStyle = o.corPasto; }
        ctx.translate(px, o.yEm(px));
        ctx.scale((hm > 0.5 ? 1 : -1) * L, L);
        animal(ctx, e, 0, 0, t, hm, o.bordaPasto);
        ctx.restore();
      }
    }
  }
  ctx.globalAlpha = 1;
}

function manada(ctx, a, s) {
  const y0 = a.y(s.rel);
  const solo = s.solo;
  desenharManada(ctx, {
    x0: a.x0, x1: a.x1, yEm: (x) => y0 - (solo ? a.perfil(x, solo) : 0),
    especies: s.especies ?? ['veado'], dir: s.dir ?? a.fuga, t: a.tempoAnim,
    calma: a.calma,
    /* Um degrau mais escuro que o próprio plano: o bicho está NA FRENTE da
       crista em que corre, e sem essa diferença as patas somem no chão. */
    cor: ajustarBrilho(a.cor, -0.14),
    tamMin: s.tamMin ?? 26, tamMax: s.tamMax ?? 46, passo: s.passo, percurso: s.percurso,
    periodo: s.periodo, semente: s.semente, dens: s.dens,
    passoPasto: s.passoPasto, densPasto: s.densPasto,
  });
}

/** Acrescenta uma ave (asas em M) ao caminho. `bat` = -1..1, asa baixa..alta. */
export function ave(p, x, y, env, bat, dir = 1, assim = 0) {
  // Asas ASSIMÉTRICAS: a de trás um pouco atrasada no ciclo — ave em curva,
  // não emblema espelhado.
  const l = bat * env * 0.55;
  const l2 = (bat + assim * 4) * env * 0.55;
  const la = dir > 0 ? l2 : l, lb = dir > 0 ? l : l2;
  p.moveTo(x - env, y - la);
  p.quadraticCurveTo(x - env * 0.42, y - la * 0.15 - env * 0.16, x, y + env * 0.05);
  p.quadraticCurveTo(x + env * 0.42, y - lb * 0.15 - env * 0.16, x + env, y - lb);
  // corpo curto, apontado pra direção do voo
  p.moveTo(x - dir * env * 0.25, y);
  p.lineTo(x + dir * env * 0.32, y - env * 0.04);
}

/**
 * Bandos cruzando o céu. Poluído: bandos grandes, rápidos, desordenados, TODOS
 * pro mesmo lado — fugindo. Restaurado: poucas aves planando em círculos
 * largos, batendo asa de vez em quando. A mesma forma, outro comportamento.
 */
export function desenharBando(ctx, o) {
  const t = o.t;
  const dx = o.dx ?? 0;
  const fuga = 1 - o.calma;
  const dir = o.dir;
  const env0 = o.envergadura ?? 5;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = o.cor;
  ctx.lineWidth = Math.max(1, env0 * 0.3);

  // `soCalma`: área onde nada vive enquanto está suja (o Coração). As aves
  // só aparecem depois da restauração — a volta delas É o sinal.
  if (fuga > 0.02 && !o.soCalma) {
    const passo = o.passo ?? 2200;
    const percurso = o.percurso ?? 2600;
    const periodo = o.periodo ?? 11;
    const i0 = Math.floor((o.x0 + dx - percurso) / passo);
    const i1 = Math.ceil((o.x1 + dx + percurso) / passo);
    for (let i = i0; i <= i1; i++) {
      const hi = hash2(i, o.semente, 111);
      if (hi > (o.dens ?? 0.85)) continue;
      const u = ((t / periodo) + hi * 5.1) % 1;
      if (u > 0.7) continue;
      const k = u / 0.7;
      const fade = Math.min(clamp01(k / 0.1), clamp01((1 - k) / 0.1));
      const cx = i * passo + passo * 0.5 + dir * (k - 0.5) * percurso - dx;
      if (cx < o.x0 - 260 || cx > o.x1 + 260) continue;
      // Um traço POR BANDO, com o fade dele: num traço só, o bando que
      // entrava aparecia já opaco se outro estivesse no meio da tela.
      const p = new Path2D();
      const cy = o.y0 + (hash2(i, o.semente, 113) - 0.5) * o.faixa - k * 40;
      const n = 10 + ((hash2(i, o.semente, 117) * 16) | 0);
      /* BANDO COM RUMO. A nuvem simétrica de antes lia como urubu pairando:
         bando em fuga é uma FILA alongada (3:1) na diagonal, subindo, com a
         ponta na frente, os da frente maiores e os retardatários ficando pra
         trás e pra baixo. */
      for (let m = 0; m < n; m++) {
        const hm = hash2(i * 31 + m, o.semente, 119);
        const hm2 = hash2(m, i * 7, o.semente + 121);
        const atras = (m / n) * 230 + hm * 30 + ruido1(t * 0.4 + m, 131) * 18;
        const bx = cx - dir * atras;
        const by = cy + atras * 0.22 + (hm2 - 0.5) * 34 + Math.sin(t * 1.3 + m) * 4;
        if (bx < o.x0 - 40 || bx > o.x1 + 40) continue;
        const env = env0 * lerp(1.3, 0.75, m / n) * lerp(0.85, 1.15, hm2);
        const bat = Math.sin(t * TAU * lerp(3.4, 4.8, hm) + hm * TAU);
        ave(p, bx, by, env, bat, dir, 0.12 * (hm2 - 0.5));
      }
      ctx.globalAlpha = fuga * fade;
      ctx.stroke(p);
    }
  }

  if (o.calma > 0.02) {
    const passo = o.passoCalmo ?? 1100;
    const m0 = Math.floor((o.x0 + dx) / passo) * passo;
    const p = new Path2D();
    for (let xm = m0 - passo; xm <= o.x1 + dx + passo; xm += passo) {
      const h = hash2(xm | 0, o.semente + 3, 123);
      if (h > 0.6) continue;
      const n = 2 + ((h * 3) | 0);
      const r = lerp(60, 140, h);
      for (let m = 0; m < n; m++) {
        const hm = hash2((xm | 0) + m, o.semente, 127);
        const ang = t * lerp(0.12, 0.22, hm) * (hm > 0.5 ? 1 : -1) + hm * TAU;
        const bx = xm - dx + passo * 0.5 + Math.cos(ang) * r;
        const by = o.y0 - 30 + Math.sin(ang) * r * 0.35;
        // Planando: asa quase parada, batida curta de vez em quando.
        const bat = 0.25 + 0.75 * Math.pow(Math.max(0, Math.sin(t * 1.7 + hm * 11)), 8)
          * Math.sin(t * 20);
        ave(p, bx, by, env0 * 1.2, bat, Math.cos(ang + Math.PI / 2) > 0 ? 1 : -1);
      }
    }
    ctx.globalAlpha = o.calma;
    ctx.stroke(p);
  }
  ctx.restore();
}

function bando(ctx, a, s) {
  desenharBando(ctx, {
    x0: a.x0, x1: a.x1, y0: a.y(s.rel), faixa: a.vh * 0.25, t: a.tempoAnim,
    calma: a.calma, dir: s.dir ?? a.fuga, cor: a.cor, envergadura: s.envergadura,
    passo: s.passo, percurso: s.percurso, periodo: s.periodo, semente: s.semente,
    dens: s.dens, soCalma: s.soCalma, passoCalmo: s.passoCalmo,
  });
}

/* --- coração: a fonte ---------------------------------------------------- */

/**
 * Escoadouro — a FONTE. O Coração não queima de mata: queima de resto
 * industrial. Um cano colossal brota da encosta lá longe e despeja um jorro
 * de lodo químico aceso, e do pé dele sobe vapor ácido. É a única coisa
 * feita por gente no Coração — e é o motivo de todo o resto do jogo.
 *
 * Mora no HORIZONTE (desenhado em coordenada de tela, entre as duas bandas
 * de morro): é a única faixa que aparece em toda sala do Coração. Numa camada
 * de parallax as massas da frente o escondiam em quase toda sala, e deitado
 * mais perto, atravessando a tela na altura do olho, o cano lia como ponte.
 * A banda de morro da frente, pintada depois, cobre o pé do jorro — ele cai
 * ATRÁS do morro, e é isso que diz "longe".
 *
 * Restaurado, o jorro seca e o cano FICA: parado, tomado de musgo, com
 * trepadeira pendurada. A cicatriz fica; a ferida fecha.
 *
 * @param {object} o  x, yChao (tela), esc, lado (±1, pra onde a boca olha),
 *   t, cor (silhueta), ch (rampa da chama), vivo (0..1, o jorro), calma
 *   (0..1, o musgo), verde, deriva, semente
 */
export function escoadouroNoHorizonte(ctx, o) {
  const { x: px, yChao: yb, esc, lado, t, ch, vivo } = o;
  const R = 40 * esc, H = 230 * esc, J = H * 0.3;
  const yc = yb - H;
  const xPoca = px + lado * (R * 0.2 + J);

  // Vapor ácido subindo do pé do jorro — por TRÁS do cano.
  if (vivo > 0.03) {
    pluma(ctx, {
      x: xPoca, y: yb, alt: H * 2.2, larg: R * 0.9,
      t, vel: 0.03, semente: o.semente,
      deriva: o.deriva,
      // Vapor ácido: o verde que não pertence a este lugar.
      corBaixa: misturarHex(ch.vapor ?? ch.meio, o.cor, 0.3),
      corAlta: misturarHex(o.cor, ch.vapor ?? ch.meio, 0.3),
      alfa: 0.6 * vivo,
    });
  }

  /* Cano, no referencial dele: boca na origem, corpo indo pra trás e pra
     baixo até entrar no chão. Diagonal, brotando da encosta. */
  const run = 380 * esc;
  const ang = Math.atan2(H, run);
  const comp = Math.hypot(H, run) + 80 * esc;
  const corCano = ajustarBrilho(o.cor, -0.08);
  ctx.save();
  ctx.translate(px, yc);
  ctx.scale(lado, 1);
  ctx.rotate(-ang);
  const cano = new Path2D();
  cano.rect(-comp, -R, comp, R * 2);
  for (let k = 1; k <= 3; k++) cano.rect(-k * 110 * esc - 6 * esc, -R * 1.14, 12 * esc, R * 2.28);
  cano.rect(-16 * esc, -R * 1.2, 16 * esc, R * 2.4);
  ctx.fillStyle = corCano;
  ctx.fill(cano);
  // VOLUME: faixa clara em cima, escura embaixo — sem isso, chapa.
  ctx.fillStyle = rgba(ajustarBrilho(corCano, 0.12), 0.9);
  ctx.fillRect(-comp, -R * 0.78, comp, R * 0.3);
  ctx.fillStyle = rgba(ajustarBrilho(corCano, -0.2), 0.9);
  ctx.fillRect(-comp, R * 0.45, comp, R * 0.55);
  // Luz de baixo: o lodo aceso ilumina a barriga do cano perto da boca.
  if (vivo > 0.03) {
    const gl = ctx.createLinearGradient(0, R, 0, -R * 0.2);
    gl.addColorStop(0, rgba(ch.meio, 0.55 * vivo));
    gl.addColorStop(1, rgba(ch.meio, 0));
    ctx.fillStyle = gl;
    ctx.fillRect(-260 * esc, -R * 0.2, 260 * esc, R * 1.25);
  }
  // Boca: o escuro de dentro.
  ctx.fillStyle = ajustarBrilho(o.cor, -0.5);
  ctx.beginPath();
  elipse(ctx, 0, 0, R * 0.3, R * 0.86);
  ctx.fill();
  // Restaurado: musgo no dorso e trepadeira pendurada.
  if (o.calma > 0.02) {
    const musgo = new Path2D(), cipo = new Path2D();
    for (let k = 0; k < 12; k++) {
      const hk = hash2(k, o.semente, 81);
      const mx = -(24 + k * 30) * esc;
      const rr = R * lerp(0.18, 0.34, hk) * o.calma;
      elipse(musgo, mx, -R + rr * 0.2, rr * 1.6, rr);
      if (hk > 0.55) {
        cipo.moveTo(mx, R * 0.6);
        cipo.lineTo(mx + 2 * esc, R + R * lerp(0.3, 1.1, hk) * o.calma);
      }
    }
    ctx.fillStyle = rgba(o.verde, o.calma);
    ctx.fill(musgo);
    ctx.strokeStyle = rgba(o.verde, 0.85 * o.calma);
    ctx.lineWidth = Math.max(1.2, 2.2 * esc);
    ctx.lineCap = 'round';
    ctx.stroke(cipo);
  }
  ctx.restore();

  if (vivo < 0.03) return;
  // Jorro: parábola da boca até o chão, mais largo em cima.
  const N = 14;
  const borda = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const w = R * lerp(1.1, 0.75, u) * (1 + 0.06 * Math.sin(u * 9 - t * 7)) * 0.5;
    borda.push([px + lado * (R * 0.2 + J * Math.sqrt(u)), lerp(yc + R * 0.15, yb + 6, u), w]);
  }
  // Desce pela borda da direita e sobe pela da esquerda: sentido horário.
  const pj = new Path2D();
  pj.moveTo(borda[0][0] + borda[0][2], borda[0][1]);
  for (const [cx, cy, w] of borda) pj.lineTo(cx + w, cy);
  for (let i = N; i >= 0; i--) pj.lineTo(borda[i][0] - borda[i][2], borda[i][1]);
  pj.closePath();
  // Halo do jorro (no lugar do bloom, que o horizonte não tem).
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba(ch.meio, 0.22 * vivo);
  ctx.lineWidth = R * 0.9;
  ctx.stroke(pj);
  ctx.restore();
  const gj = ctx.createLinearGradient(0, yc, 0, yb);
  gj.addColorStop(0, rgba(ch.nucleo, 0.95 * vivo));
  gj.addColorStop(0.35, rgba(ch.meio, 0.92 * vivo));
  gj.addColorStop(1, rgba(ch.borda, 0.85 * vivo));
  ctx.fillStyle = gj;
  ctx.fill(pj);
  // O lodo ESCORRE: filetes claros descendo pelo jorro. Gotas redondas em
  // fila liam como botões de casaco.
  ctx.fillStyle = rgba(ch.nucleo, 0.42 * vivo);
  for (let i = 0; i < 9; i++) {
    const hi = hash2(i, o.semente, 77);
    const u = ((i / 9) + t * lerp(0.45, 0.7, hi)) % 1;
    const cx = px + lado * (R * 0.2 + J * Math.sqrt(u));
    const cy = lerp(yc + R * 0.15, yb, u);
    ctx.beginPath();
    elipse(ctx, cx + (hi - 0.5) * R * 0.6, cy, R * lerp(0.05, 0.09, hi), R * lerp(0.3, 0.55, hi));
    ctx.fill();
  }
  // Clarão no pé: o lodo acende o morro por trás.
  focoDeLuz(ctx, xPoca, yb, R * 3.2, ch.meio, 0.5 * vivo);
}

/* =========================================================================
   6 · REGISTRO
   ========================================================================= */

/** Formas de cena. Registradas em FORMAS no parallax.js. */
export const FORMAS_CATASTROFE = {
  incendio, colunaFumaca, arvoreEmChamas, tocos, maquina, lixo, oleo, manada, bando,
};

/** Formas que também acendem no passe emissivo (bloom). */
export const FORMAS_LUZ = {
  incendio: incendioLuz,
  arvoreEmChamas: arvoreEmChamasLuz,
  maquina: maquinaLuz,
};
