/* =========================================================================
   fase2/render/subsolo.js — o fundo das salas DEBAIXO DA TERRA
   -------------------------------------------------------------------------
   O jogo é ao ar livre (ARQUITETURA.md), e o parallax inteiro foi escrito pra
   isso: céu, sol, horizonte em chamas, manadas fugindo. Só que algumas salas
   ficam literalmente embaixo do chão — a gente entra nelas caindo por um
   buraco — e mostravam o mesmo céu com sol atrás das paredes. Pedido do
   autor: sala embaixo da terra tem fundo de embaixo da terra.

   Marca: `subterranea: true` na definição da sala. Sem céu, sem horizonte,
   sem fauna; no lugar, três planos:
     1. ESTRATOS — faixas onduladas de solo, a parede de terra mais distante;
     2. RAÍZES E PEDRAS — raízes finas pendendo do teto, pedras na terra;
        2b. EMARANHADOS — a silhueta de raízes gerada no Canva;
     3. RAÍZES GROSSAS — as mais perto, quase pretas.
   A luz continua vindo do buraco por onde se entrou (o feixe da sala).

   Restaurar não clareia (regra do jogo): com a pureza, as raízes ganham
   pontos de fungo luminoso no acento da área — o subsolo fica VIVO, não
   iluminado.
   ========================================================================= */
import { hash2, misturarHex, rgba, clamp01 } from '../core/mat.js';

/* SILHUETAS DO CANVA (pedido do autor: "faça alguns elementos do fundo
   usando o criador de imagens do Canva"). Um emaranhado de raízes, gerado
   como silhueta preta e convertido em MÁSCARA
   por `fase2/arte/preparar-subsolo.py`. A máscara é tingida aqui com a cor do
   plano — imagem colorida não acompanharia o tema nem a restauração. Até a
   imagem carregar (ou se falhar), o plano só não desenha a silhueta.
   Um monte de pedras do Canva também foi testado e saiu (design-reviewer):
   a silhueta lia como ovos e sujava a faixa do chão, onde andam os
   parasitas. As pedras procedurais do plano 2 bastam. */
function carregar(nome) {
  const img = new Image();
  img.decoding = 'async';
  img.src = new URL(`../arte/subsolo/${nome}.png?v=1`, import.meta.url).href;
  return img;
}
const SILHUETAS = { raizes: carregar('raizes') };
const pronta = (img) => img.complete && img.naturalWidth > 0;

/* Pontos (fração da imagem) onde o fungo pousa no emaranhado de raízes —
   sorteados dentro da silhueta pelo script de preparo. */
const FUNGO_NAS_RAIZES = [[0.084, 0.459], [0.084, 0.634], [0.279, 0.439], [0.361, 0.595], [0.453, 0.264], [0.547, 0.25], [0.551, 0.482], [0.552, 0.309], [0.553, 0.532], [0.69, 0.675], [0.796, 0.327], [0.807, 0.616], [0.819, 0.332], [0.873, 0.566]];

/* Máscara tingida, guardada por cor. A cor do tema muda devagar com a pureza,
   então o cache é pequeno e é descartado quando enche. */
const _tingidas = new Map();
function tingir(img, cor) {
  const chave = img.src + cor;
  let c = _tingidas.get(chave);
  if (c) return c;
  if (_tingidas.size > 24) _tingidas.clear();
  c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = cor;
  g.fillRect(0, 0, c.width, c.height);
  _tingidas.set(chave, c);
  return c;
}

/* As raízes pendem do TETO da sala (y = 0 no plano), não do topo da tela:
   presas à tela elas acompanhavam a câmera na vertical, como um adesivo. */
const TETO = -30;

/** Terra: o fundo do terreno da área puxado pro marrom. */
function corDeTerra(tema, claro = 0) {
  // 0,55 deixava a terra preto-azulada (o `terrenoFundo` de toda área é quase
  // preto) e a sala lia como gruta; 0,8 lê como solo.
  const terra = misturarHex(tema.terrenoFundo, '#24170e', 0.8);
  return claro ? misturarHex(terra, tema.crista, claro) : terra;
}

/** Faixa visível de um plano `p`, em coordenadas do plano. */
function janela(camera, p) {
  const vw = camera.largura / camera.zoom;
  const vh = camera.altura / camera.zoom;
  return { x0: camera.viewX * p - 80, x1: camera.viewX * p + vw + 80,
    y0: camera.viewY * p - 80, y1: camera.viewY * p + vh + 80 };
}

/** Desvio lateral da raiz (o mesmo no desenho e no fungo pousado nela). */
const curvaDe = (sem, comp) => (hash2(sem, 3) - 0.5) * comp * 0.55;

/** Ponto `t` (0 = teto, 1 = ponta) sobre a linha central da raiz. */
function pontoNaRaiz(x, y, comp, balanco, sem, t) {
  const curva = curvaDe(sem, comp);
  const cx = x + curva * 0.5, cy = y + comp * 0.55;
  const px = x + curva + balanco, py = y + comp;
  const u = 1 - t;
  return { x: u * u * x + 2 * u * t * cx + t * t * px, y: u * u * y + 2 * u * t * cy + t * t * py };
}

/** Uma raiz pendurada: curva afinando do topo até a ponta. */
function raiz(ctx, x, y, comp, grossura, balanco, sem) {
  const curva = curvaDe(sem, comp);
  const pontaX = x + curva + balanco;
  ctx.beginPath();
  ctx.moveTo(x - grossura, y);
  ctx.quadraticCurveTo(x + curva * 0.5 - grossura * 0.6, y + comp * 0.55, pontaX, y + comp);
  ctx.quadraticCurveTo(x + curva * 0.5 + grossura * 0.6, y + comp * 0.55, x + grossura, y);
  ctx.closePath();
  ctx.fill();
  // Ramificações em TODAS: raiz reta e única lê como estalactite ou espeto.
  for (let r = 0; r < 2; r++) {
    if (r === 1 && hash2(sem, 5) < 0.5) break;
    const t = 0.25 + hash2(sem, 7 + r) * 0.4;
    const { x: bx, y: by } = pontoNaRaiz(x, y, comp, balanco, sem, t);
    const lado = (hash2(sem, 11) < 0.5 ? -1 : 1) * (r ? -1 : 1);
    ctx.beginPath();
    ctx.moveTo(bx - grossura * 0.4, by);
    ctx.quadraticCurveTo(bx + lado * comp * 0.18, by + comp * 0.2,
      bx + lado * comp * 0.24 + balanco * 0.7, by + comp * 0.42);
    ctx.lineTo(bx + grossura * 0.4, by);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Desenha o fundo inteiro de uma sala subterrânea. Substitui, em main.js,
 * céu + horizonte + parallax.
 */
export function desenharSubsolo(render, sala, mundo) {
  const tema = mundo.tema;
  // Movimento reduzido: o balanço das raízes e o pulso do fungo a 1/3.
  const tempo = (mundo.laco?.tempo ?? 0) * (render.movimentoReduzido ? 0.33 : 1);
  const pureza = clamp01(tema.pureza ?? 0);
  const sem = sala.def.semente ?? 7;

  // 0 · o fundo chapado: terra escura, um pouco mais clara embaixo (a luz do
  //     buraco escorre pro chão).
  render.camadaTela((ctx, _t, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    // Miolo mais escuro que as bordas: é onde ficam terreno e criaturas, que
    // precisam de contraste (o terreno de algumas áreas é quase da cor da terra).
    g.addColorStop(0, misturarHex(corDeTerra(tema), '#000000', 0.35));
    g.addColorStop(0.5, misturarHex(corDeTerra(tema), '#000000', 0.55));
    g.addColorStop(1, corDeTerra(tema, 0.08));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });

  // 1 · estratos de solo
  render.camada(0.25, (ctx, t, camera) => {
    const j = janela(camera, 0.25);
    const passo = 64;
    ctx.globalAlpha = 0.8;
    for (let k = Math.floor(j.y0 / passo); k * passo < j.y1; k++) {
      const y = k * passo;
      ctx.fillStyle = corDeTerra(t, 0.12 + hash2(k, sem, 13) * 0.16);
      ctx.beginPath();
      ctx.moveTo(j.x0, y + passo);
      for (let x = j.x0; x <= j.x1; x += 24) {
        ctx.lineTo(x, y + Math.sin(x * 0.006 + k * 1.7) * 9 + Math.sin(x * 0.017 + k) * 4);
      }
      ctx.lineTo(j.x1, y + passo);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });

  /* Fungo luminoso pousado SOBRE a raiz (mesma curva e mesmo balanço): um
     ponto firme e um halo largo e fraco — só o ponto, em meia resolução no
     buffer de luz, não aparecia. */
  const fungo = (ctx, x, comp, bal, s, n, i) => {
    for (let k = 0; k < n; k++) {
      const p = pontoNaRaiz(x, TETO, comp, bal, s, 0.25 + hash2(i, k, 71) * 0.7);
      const pulso = 0.65 + 0.35 * Math.sin(tempo * 1.3 + i + k);
      ctx.globalAlpha = 0.15 * pureza * pulso;
      ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.95 * pureza * pulso;
      ctx.beginPath(); ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  const raizesFinas = (ctx, j, comFungo) => {
    for (let i = Math.floor(j.x0 / 70); i * 70 < j.x1; i++) {
      if (hash2(i, sem, 37) < 0.45) continue;
      const x = i * 70 + hash2(i, 41) * 50, comp = 60 + hash2(i, sem, 43) * 170;
      const bal = Math.sin(tempo * 0.6 + i) * 3, s = i * 7 + sem;
      if (comFungo) fungo(ctx, x, comp, bal, s, Math.round(pureza * 2), i);
      else raiz(ctx, x, TETO, comp, 4 + hash2(i, 47) * 4, bal, s);
    }
  };

  // 2 · pedras na terra e raízes finas pendendo do teto
  render.camada(0.5, (ctx, t, camera) => {
    const j = janela(camera, 0.5);
    const cel = 120;
    ctx.fillStyle = corDeTerra(t, 0.26);
    ctx.globalAlpha = 0.6;
    for (let cx = Math.floor(j.x0 / cel); cx * cel < j.x1; cx++) {
      for (let cy = Math.floor(j.y0 / cel); cy * cel < j.y1; cy++) {
        if (hash2(cx, cy, sem + 17) > 0.35) continue;
        const x = (cx + hash2(cx, cy, 19)) * cel, y = (cy + hash2(cx, cy, 23)) * cel;
        const r = 10 + hash2(cx, cy, 29) * 22;
        ctx.beginPath();
        ctx.ellipse(x, y, r * 1.4, r, hash2(cx, cy, 31) - 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = misturarHex(corDeTerra(t), '#000000', 0.25);
    raizesFinas(ctx, j, false);
    ctx.globalAlpha = 1;
  });
  if (pureza > 0.02) {
    render.emissivo(0.5, (ctx, t, camera) => {
      ctx.fillStyle = rgba(t.acento, 1);
      raizesFinas(ctx, janela(camera, 0.5), true);
    });
  }

  // 2b · silhueta do Canva: emaranhados de raízes pendendo do teto, entre os
  //      dois planos procedurais. Escala e espelho variam por posição (nada se repete
  //      igual lado a lado).
  const ESC_RAIZES = 0.62, PASSO_RAIZES = 760;
  const emaranhados = (j, fn) => {
    for (let i = Math.floor(j.x0 / PASSO_RAIZES) - 1; i * PASSO_RAIZES < j.x1; i++) {
      if (hash2(i, sem, 83) < 0.3) continue;
      const esc = ESC_RAIZES * (0.75 + hash2(i, sem, 89) * 0.5);
      fn(i * PASSO_RAIZES + hash2(i, 97) * 200, esc, hash2(i, sem, 101) < 0.5 ? -1 : 1, i);
    }
  };
  if (pronta(SILHUETAS.raizes)) {
    render.camada(0.62, (ctx, t, camera) => {
      const img = tingir(SILHUETAS.raizes, misturarHex(corDeTerra(t), '#000000', 0.4));
      emaranhados(janela(camera, 0.62), (x, esc, lado, i) => {
        ctx.save();
        ctx.translate(x, TETO - 10);
        // Balanço de pêndulo bem leve, a partir do teto.
        ctx.rotate(Math.sin(tempo * 0.35 + i) * 0.012);
        ctx.scale(lado * esc, esc);
        ctx.drawImage(img, -img.width / 2, 0);
        ctx.restore();
      });
    });
    if (pureza > 0.02) {
      render.emissivo(0.62, (ctx, t, camera) => {
        const img = SILHUETAS.raizes;
        ctx.fillStyle = rgba(t.acento, 1);
        emaranhados(janela(camera, 0.62), (x, esc, lado, i) => {
          ctx.save();
          ctx.translate(x, TETO - 10);
          ctx.rotate(Math.sin(tempo * 0.35 + i) * 0.012);
          ctx.scale(lado * esc, esc);
          const n = Math.round(pureza * FUNGO_NAS_RAIZES.length);
          for (let k = 0; k < n; k++) {
            const [fx, fy] = FUNGO_NAS_RAIZES[k];
            const px = (fx - 0.5) * img.naturalWidth, py = fy * img.naturalHeight;
            const pulso = 0.65 + 0.35 * Math.sin(tempo * 1.3 + i + k);
            // Raios em px da máscara (a escala do plano reduz).
            ctx.globalAlpha = 0.15 * pureza * pulso;
            ctx.beginPath(); ctx.arc(px, py, 18, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 0.95 * pureza * pulso;
            ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
          }
          ctx.restore();
        });
        ctx.globalAlpha = 1;
      });
    }
  }

  // 3 · raízes grossas, as mais perto, e o fungo que acende na restauração
  const raizesPerto = (ctx, j, comFungo) => {
    for (let i = Math.floor(j.x0 / 160); i * 160 < j.x1; i++) {
      if (hash2(i, sem, 53) < 0.4) continue;
      const x = i * 160 + hash2(i, 59) * 110;
      const comp = 120 + hash2(i, sem, 61) * 220;
      const bal = Math.sin(tempo * 0.4 + i * 1.3) * 4, s = i * 13 + sem;
      if (comFungo) fungo(ctx, x, comp, bal, s, Math.round(pureza * 5), i);
      else raiz(ctx, x, TETO, comp, 10 + hash2(i, 67) * 7, bal, s);
    }
  };
  render.camada(0.75, (ctx, t, camera) => {
    ctx.fillStyle = misturarHex(corDeTerra(t), '#000000', 0.55);
    raizesPerto(ctx, janela(camera, 0.75), false);
  });
  if (pureza > 0.02) {
    render.emissivo(0.75, (ctx, t, camera) => {
      ctx.fillStyle = rgba(t.acento, 1);
      raizesPerto(ctx, janela(camera, 0.75), true);
    });
  }
}
