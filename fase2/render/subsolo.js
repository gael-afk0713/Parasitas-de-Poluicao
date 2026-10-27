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
     3. RAÍZES GROSSAS — as mais perto, quase pretas.
   A luz continua vindo do buraco por onde se entrou (o feixe da sala).

   Restaurar não clareia (regra do jogo): com a pureza, as raízes ganham
   pontos de fungo luminoso no acento da área — o subsolo fica VIVO, não
   iluminado.
   ========================================================================= */
import { hash2, misturarHex, rgba, clamp01 } from '../core/mat.js';

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
