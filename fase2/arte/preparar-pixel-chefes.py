"""Gera os três chefes da Fase 2 em PIXEL ART (proposta, ainda fora do jogo).

Uso:  python fase2/arte/preparar-pixel-chefes.py
Grava fase2/arte/pixel/chefes/<chefe>.png + .json (uma linha por animação)
      fase2/arte/pixel/_previa/chefes.png

Referência: o desenho em código de fase2/entidades/chefes.js, que manda na
silhueta e no que cada estado comunica:
- Mãe Afogada (Várzea): massa escura dentro d'água, tentáculos longos em
  leque, MUITAS fendas brancas em arco (o rosto dela). Estados: entrada
  (emerge), espera, cuspir, mergulho/ressurgir (sob o jogador), ninhada.
- Máquina (Clareira): construção da Fase 1 ainda acesa e meio viva. Metal
  MAIS CLARO que o chão (lição do chefe preto sobre chão preto), chaminé,
  três rodas, válvulas que acendem com a pressão, UMA fenda orgânica de olho.
  Estados: espera, apito (telégrafo), investida, atordoada, salto, vapor.
- Coração (área final): coisa pulsante presa por veias, não anda. Batimento
  duplo, telégrafo de anel (incha), lança, troca de fase (convulsão).
O telégrafo do vão do anel, o flash branco de dano e a luz continuam no
código; aqui vão as poses.
"""
import importlib.util
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw

AQUI = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location('pp', os.path.join(AQUI, 'preparar-pixel.py'))
pp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pp)
rampa, capsula, circulo, valor, aplicar, px, C, mix, desloca, vazio = (
    pp.rampa, pp.capsula, pp.circulo, pp.valor, pp.aplicar, pp.px, pp.C, pp.mix, pp.desloca, pp.vazio)
_spec2 = importlib.util.spec_from_file_location('pz', os.path.join(AQUI, 'preparar-pixel-parasitas.py'))
pz = importlib.util.module_from_spec(_spec2)
_spec2.loader.exec_module(pz)
elipse, poligono, olho = pz.elipse, pz.poligono, pz.olho

SAIDA = os.path.join(AQUI, 'pixel', 'chefes')
ANEL = C('#000000')
BRANCO = C('#f4f0e6')
GOSMA, FOGO, PRETO = pz.GOSMA, pz.FOGO, pz.PRETO
FUMACA = rampa(['#141210', '#24201c', '#38322c', '#4c453c'], 4)
VAPOR = rampa(['#8a8a86', '#b4b4ae', '#d8d8d0', '#f0f0e8'], 4)


def pintar(img, m, ramp, aro=None, k=3.0, base=.32, raio=2, tex=None, dither=.3):
    v = valor(m, raio, k=k, base=base)
    if tex is not None:
        v = v + tex
    aplicar(img, m, ramp, v, dither=dither)
    if aro is not None:
        a = m & (~desloca(m, 1, 0) | ~desloca(m, 0, 1))
        img[a, :3] = C(aro)


def fechar(img, cor=ANEL):
    pp.contorno(img, img[..., 3] > 0, cor)
    return img


def girar(img, graus, centro):
    if abs(graus) < .01:
        return img
    im = Image.fromarray(img).rotate(graus, resample=Image.NEAREST, center=centro)
    return np.asarray(im).copy()


def mover(img, dx, dy):
    out = np.zeros_like(img)
    H, W = img.shape[:2]
    dx, dy = int(round(dx)), int(round(dy))
    out[max(dy, 0):H + min(dy, 0), max(dx, 0):W + min(dx, 0)] = \
        img[max(-dy, 0):H + min(-dy, 0), max(-dx, 0):W + min(-dx, 0)]
    return out


def por_cima(base, topo):
    a = topo[..., 3] > 0
    out = base.copy()
    out[a] = topo[a]
    return out


def fumaca(img, x, y, r, ramp=FUMACA, rng=None):
    m = vazio(*img.shape[:2])
    circulo(m, x, y, r)
    if rng is not None and r > 2:
        circulo(m, x + rng.uniform(-r, r) * .6, y - r * .5, r * .7)
    v = valor(m, 1, k=2.5, base=.45)
    aplicar(img, m & (img[..., 3] == 0), ramp, v, dither=.6)


def blob(m, cx, cy, r, achata, harm, fase):
    """Massa orgânica: círculo com harmônicos (como o traçado do jogo)."""
    pts = []
    for i in range(40):
        a = i / 40 * math.tau
        rr = r * (1 + sum(amp * math.sin(a * n + fase * s) for n, amp, s in harm))
        pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr * achata))
    poligono(m, pts)


def morte_de(base, k, n, rng, cor):
    return pz.morte(base, k, n, rng, cor)


# =================================================================== MÃE
MAE_W, MAE_H = 112, 80
MAE_COR = rampa(['#010302', '#040b07', '#0a160e', '#122218', '#1e3224', '#2c4430'], 6)
MAE_ARO = '#4c5e44'
ALGA = rampa(['#141a08', '#26300e', '#3c4a16', '#5a6a22'], 4)
AGUA = rampa(['#2a3424', '#4a5a40', '#76845e', '#a8b48a'], 4)
TENT = [(-math.pi * 1.05 + (math.pi * 1.1) * i / 8, 36 + ((i * 37) % 9) / 9 * 20, i * 1.7) for i in range(9)]


def mae(fase=0.0, modo='espera', tel=0.0, boca=0.0, cria=0.0):
    """tel: telégrafo 0..1 (incha, fendas abrem, tentáculos esticam);
    boca: abertura do rasgo de cuspir; cria: filhote saindo das costas."""
    W, H = MAE_W, MAE_H
    img = np.zeros((H, W, 4), np.uint8)
    ph = fase * math.tau
    cx, cy = 56, 56 + math.sin(ph) * 1.2
    r = 21.5 * (1 + tel * .14)
    # tentáculos atrás da massa
    tm = vazio(H, W)
    pontas = []
    for i, (ang, comp, f0) in enumerate(TENT):
        a = ang + math.sin(ph + f0) * .22
        if modo == 'ressurgir':
            a = -math.pi / 2 + (a + math.pi / 2) * .7
        L = comp * (1 + tel * .18)
        x0, y0 = cx, cy
        segs = 7
        for k in range(1, segs + 1):
            u = k / segs
            enrola = (u ** 2) * (.9 if i % 2 else -.9) * (1 - tel * .6)
            bx = cx + math.cos(a + enrola * u) * L * u + math.sin(u * 3 + ph * 1.4 + f0) * 5 * u
            by = cy + math.sin(a + enrola * u) * L * u * .9
            capsula(tm, x0, y0, bx, by, max(.6, 5.2 * (1 - u) + .5), max(.6, 5.2 * (1 - u + 1 / segs) - .3))
            x0, y0 = bx, by
        pontas.append((x0, y0))
    # massa
    m = vazio(H, W)
    blob(m, cx, cy, r, .86, [(3, .1, 1.6), (6, .06, -1)], ph)
    # raízes/lodo pendendo embaixo (vai ficar sob a água no jogo)
    for gx in (-14, -6, 3, 11, 17):
        capsula(m, cx + gx, cy + r * .7, cx + gx + math.sin(ph + gx) * 2, cy + r * .86 + 5 + (gx % 3), 2.2, .6)
    if cria > 0:
        # filhote (espreita) brotando das costas, ainda colado
        fx, fy = cx - 6 + cria * 4, cy - r * .8 - cria * 9
        elipse(m, fx, fy, 3 + cria * 2.5, 3.5 + cria * 2.5)
        capsula(m, fx, fy + 2, cx - 6, cy - r * .6, 2.4 * (1.2 - cria), 2.6)
    tex = pp.ruido2(np.random.default_rng(7), H, W, 3) * .25
    pintar(img, tm | m, MAE_COR, MAE_ARO, k=3.2, base=.3, tex=tex)
    corpo = tm | m
    # algas e lixo presos (Várzea): fios caindo do topo da massa
    rng = np.random.default_rng(3)
    for j in range(9):
        a = -math.pi * .9 + j / 8 * math.pi * .8
        x = cx + math.cos(a) * r * .92 + rng.uniform(-1, 1)
        y = cy + math.sin(a) * r * .8 + 1
        L = int(2 + rng.integers(0, 4))
        for d in range(L):
            xx = x + math.sin(ph + j + d * .5) * .6
            if corpo[min(H - 1, int(y + d)), min(W - 1, int(xx))]:
                px(img, xx, y + d, ALGA[min(3, 1 + (d < 2) + (j % 3 == 0))])
    # tira de sacola plástica enroscada num tentáculo
    sx, sy = pontas[6]
    for d in range(5):
        px(img, sx - 2 + d * .6, sy + 2 + d * .8 + math.sin(ph + d) * .5, C('#a8aca0') if d % 2 else C('#c8ccc0'))
    # ventosas claras no lado de baixo dos tentáculos
    for (x, y) in pontas[1:-1:2]:
        px(img, (x + cx) / 2, (y + cy) / 2 + 2, MAE_ARO)
    fechar(img)
    # fendas: o rosto
    n = 7
    for i in range(n):
        f = i / (n - 1)
        dx = (f - .5) * r
        dy = -r * .34 + abs(f - .5) * r * .3
        h = (4.5 - abs(f - .5) * 2 * 2.5) * (1 + tel * .6)
        if modo == 'dano':
            h = 1
        x, y = cx + dx, cy + dy - h / 2
        for d in range(max(1, int(round(h)))):
            px(img, x, y + d, BRANCO)
        if h >= 4 and tel > .5:
            px(img, x + 1, y + h / 2, BRANCO)
    # rasgo da boca
    if boca > 0:
        bw, bh = 9 + boca * 4, 1 + boca * 3.5
        bm = vazio(H, W)
        elipse(bm, cx, cy + 5, bw, bh)
        aplicar(img, bm, GOSMA, valor(bm, 1, k=2, base=.75) - np.linspace(0, .4, H)[:, None], dither=.5)
        for d in range(-int(bw) + 2, int(bw) - 1, 3):
            px(img, cx + d, cy + 5 - bh + 1, C('#e8e4d0'))       # dentes
        if boca > .8:
            g = vazio(H, W)
            circulo(g, cx + 6, cy - 2 - boca * 8, 3.5)
            aplicar(img, g, GOSMA, valor(g, 1, k=3, base=.6))
            for k in range(4):
                px(img, cx + 3 + k, cy + 2 - k * 2, GOSMA[2 + k % 2])
    return img


def submerso(img, s, rng, espuma=True, linha=79):
    """Afunda o quadro s (0..1) na água: corta abaixo da linha e faz anel de espuma."""
    out = mover(img, 0, s * 58)
    out[linha:] = 0
    if espuma:
        ys, xs = np.where(out[:linha, :, 3] > 0)
        if len(xs):
            x0, x1 = xs.min(), xs.max()
        else:
            x0, x1 = 46, 66
        for x in range(int(x0) - 4, int(x1) + 5):
            if rng.random() < .7:
                px(out, x, linha - 1, AGUA[1 + int(rng.random() * 2.5)])
            if rng.random() < .3:
                px(out, x, linha - 2, AGUA[3])
        for _ in range(int(8 * (1 - abs(s - .5)))):
            px(out, rng.uniform(x0 - 6, x1 + 6), linha - 3 - rng.uniform(0, 6), AGUA[3])
    return out


def respingo(img, forca, rng, linha=79):
    for _ in range(int(40 * forca)):
        a = rng.uniform(math.pi * 1.1, math.pi * 1.9)
        d = rng.uniform(10, 34)
        x = 56 + math.cos(a) * d * 1.3
        y = linha - 2 + math.sin(a) * d * forca
        px(img, x, y, AGUA[2 + (rng.random() < .4)])
        if rng.random() < .5:
            px(img, x, y + 1, AGUA[1])
    return img


# =============================================================== MÁQUINA
MAQ_W, MAQ_H = 84, 80
METAL = rampa(['#1a100a', '#3a2618', '#5a3e28', '#7e5a3a', '#a07a52', '#c49c6e'], 6)
FERRO = rampa(['#0c0806', '#1e1610', '#342820', '#4e3e30', '#6a5844'], 5)
FERRUGEM = rampa(['#3a1a0a', '#6a2e12', '#93441c', '#b8602a'], 4)
MAQ_ARO = '#d8b080'


def roda(m, x, y, r, giro):
    anel = vazio(*m.shape)
    circulo(anel, x, y, r)
    furo = vazio(*m.shape)
    circulo(furo, x, y, r - 2.2)
    m |= anel & ~furo
    circulo(m, x, y, 1.8)
    for i in range(4):
        a = giro + i * math.pi / 2
        capsula(m, x, y, x + math.cos(a) * (r - 1.5), y + math.sin(a) * (r - 1.5), .7, .7)


def maquina(fase=0.0, modo='espera', pressao=0.0, giro=0.0, tel=0.0, rng=None,
            rodas_fora=0.0, chamine_fora=0.0, rachado=0.0, agacha=0.0, ar=0.0):
    """Virada pra direita (o jogo espelha). Corpo 52x42 px de arte."""
    W, H = MAQ_W, MAQ_H
    rng = rng or np.random.default_rng(int(fase * 100) + 5)
    img = np.zeros((H, W, 4), np.uint8)
    w, h = 52, 42
    cx = 42
    cy = 58 + agacha * 3 - ar * 3
    treme = math.sin(fase * math.tau * 3) * .6 * pressao
    cx += treme
    # fumaça da chaminé (atrás de tudo)
    fumo = []
    for i in range(5):
        f = (fase + i / 5) % 1
        fx = cx - w * .22 - f * 6 + math.sin(fase * 6 + i * 2) * f * 4
        fy = cy - h * .9 - f * 30
        fumo.append((fx, fy, 2 + f * 5.5))
    # chassi
    m = vazio(H, W)
    poligono(m, [(cx - w * .46, cy + h * .36), (cx - w * .42, cy - h * .18), (cx - w * .36, cy - h * .36),
                 (cx - w * .2, cy - h * .46), (cx + w * .26, cy - h * .45), (cx + w * .4, cy - h * .38),
                 (cx + w * .47, cy - h * .1), (cx + w * .45, cy + h * .36)])
    # limpa-trilho na frente (cunha), é o que bate na investida
    poligono(m, [(cx + w * .43, cy + h * .05), (cx + w * .58, cy + h * .42), (cx + w * .42, cy + h * .42)])
    if agacha > 0:
        sq = vazio(H, W)
        sq[int(cy + h * .36):, :] = True
    # chaminé (pode se soltar na morte)
    ch = vazio(H, W)
    chx, chy = cx - w * .22 - chamine_fora * 8, cy - chamine_fora * 6
    capsula(ch, chx, chy - h * .4, chx, chy - h * .84, 4, 3.4)
    poligono(ch, [(chx - 6.5, chy - h * .82), (chx + 6.5, chy - h * .82), (chx + 5, chy - h * .93), (chx - 5, chy - h * .93)])
    # apito
    capsula(ch, cx + w * .1, cy - h * .44, cx + w * .1, cy - h * .58, 1.4, 1.4)
    elipse(ch, cx + w * .1, cy - h * .6, 2.4, 1.3)
    if chamine_fora > 0:
        ch = np.asarray(Image.fromarray(ch.astype(np.uint8) * 255).rotate(
            chamine_fora * 35, resample=Image.NEAREST, center=(chx, chy - h * .4))) > 0
    tex = pp.ruido2(np.random.default_rng(11), H, W, 2) * .18
    pintar(img, ch, FERRO, MAQ_ARO, k=3.5, base=.42, raio=1, tex=tex)
    pintar(img, m, METAL, MAQ_ARO, k=3.2, base=.42, raio=2, tex=tex)
    # ferrugem em manchas (Voronoi simples por ruído)
    fr = (pp.ruido2(np.random.default_rng(4), H, W, 4) > .18) & m
    fr &= ~(m & ~desloca(m, 1, 0))
    v = valor(m, 2, k=3.2, base=.42)
    aplicar(img, fr, FERRUGEM, v + .1, dither=.5)
    # costuras e rebites
    for sx in (cx - w * .14, cx + w * .16):
        for y in range(int(cy - h * .44), int(cy + h * .34)):
            if m[y, int(sx)]:
                px(img, sx, y, METAL[1])
                if y % 4 == 0:
                    px(img, sx + 1, y, METAL[5])
    for i in range(14):
        x = cx - w * .38 + i * 3.4
        y = cy - h * .36 + (1.5 if i < 2 or i > 11 else 0)
        if m[int(y), int(x)]:
            px(img, x, y, METAL[5])
            px(img, x, y + 1, METAL[1])
    # fornalha acesa na frente-baixo (a coisa está ACESA)
    fx0, fy0 = cx + w * .16, cy + h * .02
    for yy in range(4):
        for xx in range(9):
            c = FOGO[min(4, int(1 + (pressao * 2.5 + .6) * (1 - yy / 5) + rng.random() * .8))]
            px(img, fx0 + xx, fy0 + yy, c if xx % 3 else FERRO[1])
    # válvulas
    for vx, vy in ((cx - w * .12, cy - h * .2), (cx + w * .04, cy - h * .28), (cx + w * .3, cy - h * .2)):
        vm = vazio(H, W)
        circulo(vm, vx, vy, 2.4 + pressao * 1.0)
        if pressao > .25:
            aplicar(img, vm, FOGO, valor(vm, 1, k=2, base=.35 + pressao * .5), dither=.4)
        else:
            aplicar(img, vm, FERRO, valor(vm, 1, k=3, base=.6), dither=.4)
        px(img, vx - .5, vy - .8, C('#f0e0c0') if pressao > .6 else METAL[5])
    # infecção: o preto do parasita tomando a frente da máquina
    inf = vazio(H, W)
    ex, ey = cx + w * .3, cy - h * .26
    elipse(inf, ex, ey, 6 + rachado * 3, 5, .3)
    for i, (a, L) in enumerate(((2.2, 10), (1.3, 9), (.5, 7), (3.3, 8), (-.6, 6), (1.9, 13))):
        x0, y0 = ex, ey
        for k in range(5):
            u = (k + 1) / 5
            nx = ex + math.cos(a + math.sin(k + i) * .4) * L * u
            ny = ey + math.sin(a + math.sin(k + i) * .4) * L * u * .9 + (k * .8 if a > 1 else 0)
            capsula(inf, x0, y0, nx, ny, 2 * (1 - u) + .6, 2 * (1 - u + .2) + .4)
            x0, y0 = nx, ny
    # escorrido pingando pelo chassi
    for gx in (ex - 4, ex + 2):
        capsula(inf, gx, ey + 3, gx + .5, ey + 9 + math.sin(fase * math.tau + gx) * 1.5, 1.2, .6)
    inf &= m | desloca(m, -1, 0)
    pintar(img, inf, PRETO, '#4e4e62', k=3, base=.3, raio=1)
    # rachaduras na morte
    if rachado > 0:
        r2 = np.random.default_rng(9)
        for _ in range(int(rachado * 6)):
            x, y = r2.uniform(cx - w * .4, cx + w * .4), r2.uniform(cy - h * .4, cy + h * .3)
            for k in range(int(4 + rachado * 6)):
                if m[int(y) % H, int(x) % W]:
                    px(img, x, y, FOGO[3] if k % 3 == 0 else PRETO[0])
                x += r2.uniform(-1, 1.4)
                y += r2.uniform(-.6, 1.2)
    # rodas
    rm = vazio(H, W)
    for i, rx in enumerate((cx - w * .26, cx + w * .02, cx + w * .3)):
        dx = rodas_fora * (-14 if i == 0 else (6 if i == 1 else 20))
        dy = rodas_fora * (6 if i == 1 else 2) + ar * 3
        roda(rm, rx + dx, cy + h * .3 + dy, 8 if i != 1 else 7, giro + i)
    pintar(img, rm, FERRO, '#8a7458', k=3, base=.5, raio=1)
    # eixo/biela ligando as rodas
    if rodas_fora < .2:
        bx = math.cos(giro) * 4
        by = math.sin(giro) * 4
        bm = vazio(H, W)
        capsula(bm, cx - w * .26 + bx, cy + h * .3 + by + ar * 3, cx + w * .3 + bx, cy + h * .3 + by + ar * 3, 1, 1)
        pintar(img, bm, METAL, None, k=2, base=.6, raio=1)
    fechar(img)
    # fumaça e vapor por cima do contorno, mas atrás do metal
    for fx, fy, fr_ in fumo:
        fumaca(img, fx, fy, fr_ * (1 + pressao * .4), FUMACA if modo != 'atordoada' else PRETO[:4], rng)
    # olho: a fenda viva
    if modo != 'dano':
        oh = 4 + tel * 4
        if modo == 'atordoada':
            for d in range(4):
                px(img, ex - 1 + d, ey, BRANCO)
        elif rachado < .9:
            olho(img, ex, ey - oh / 2, 1 + (tel > .6), oh)
    return img


def jato(img, x, y, ang, L, rng, ramp=VAPOR):
    for k in range(int(L)):
        u = k / L
        xx = x + math.cos(ang) * k + rng.uniform(-1, 1) * u * 3
        yy = y + math.sin(ang) * k + rng.uniform(-1, 1) * u * 3
        fumaca(img, xx, yy, .6 + u * 2.6, ramp)
    return img


def poeira(img, cx, chao, forca, rng):
    for _ in range(int(30 * forca)):
        x = cx + rng.uniform(-1, 1) * 34
        y = chao - rng.uniform(0, 6) * forca
        px(img, x, y, FUMACA[1 + int(rng.random() * 3)])
    return img


# =============================================================== CORAÇÃO
COR_W, COR_H = 128, 128
CARNE = rampa(['#050109', '#12051c', '#22082c', '#380c40', '#561454', '#7c1c6c'], 6)
VEIA = rampa(['#040108', '#100418', '#1e0828', '#2e0c3a', '#441450'], 5)
BRILHO = rampa(['#7a1c6a', '#b42a8c', '#e63fa6', '#ff8ad0', '#ffe0f4'], 5)
CRISTAL = rampa(['#1a0a2c', '#3a1a5c', '#6a3aa0', '#9a68d0', '#d0b0f4'], 5)
COR_ARO = '#8a3a90'
VEIAS = [(i / 10 * math.tau + ((i * 53) % 10) / 25, 34 + ((i * 29) % 10) / 10 * 26, i * 2.1) for i in range(10)]


def coracao(fase=0.0, pulso=0.0, tel=0.0, convulsao=0.0, rachado=0.0, lanca=0.0):
    W, H = COR_W, COR_H
    img = np.zeros((H, W, 4), np.uint8)
    cx, cy = 64, 64
    ph = fase * math.tau
    r = 22 * (1 + pulso * .09 + tel * .16 - lanca * .06)
    # veias até as bordas da arena
    vm = vazio(H, W)
    nos = []
    for i, (a, L, f0) in enumerate(VEIAS):
        L = min(62, L * (1 + pulso * .14))
        x0, y0 = cx, cy
        for k in range(1, 7):
            u = k / 6
            bx = cx + math.cos(a) * L * u + math.sin(u * 4 + ph + f0) * 4.5 * u + convulsao * math.sin(k * 3 + i) * 3
            by = cy + math.sin(a) * L * u + math.cos(u * 3 + ph * .8 + f0) * 3.5 * u
            capsula(vm, x0, y0, bx, by, 5.2 * (1 - u) + .8, 5.2 * (1 - u + 1 / 6) + .5)
            if k in (2, 4):
                nos.append((bx, by, k))
            x0, y0 = bx, by
        # ramificação
        a2 = a + (.5 if i % 2 else -.5)
        capsula(vm, cx + math.cos(a) * L * .45, cy + math.sin(a) * L * .45,
                cx + math.cos(a) * L * .45 + math.cos(a2) * L * .35, cy + math.sin(a) * L * .45 + math.sin(a2) * L * .35, 1.6, .5)
    pintar(img, vm, VEIA, '#5a2066', k=3, base=.4, raio=1)
    # nódulos nas veias acendem no batimento
    for (x, y, k) in nos:
        nm = vazio(H, W)
        circulo(nm, x, y, 2.4 - k * .25 + pulso * .8)
        if pulso > .3:
            aplicar(img, nm, BRILHO, valor(nm, 1, k=2, base=.2 + pulso * .45), dither=.4)
        else:
            aplicar(img, nm, CARNE, valor(nm, 1, k=2, base=.7), dither=.4)
    # cristais crescendo da massa (mais a cada fase/convulsão)
    cm = vazio(H, W)
    n_cr = 5 + int(convulsao * 3)
    for i in range(n_cr):
        a = -math.pi / 2 + (i - (n_cr - 1) / 2) * .72 + (i % 2) * .15
        L = 10 + (i * 7) % 6 + convulsao * 4 + tel * 3
        bx, by = cx + math.cos(a) * r * .8, cy + math.sin(a) * r * .8
        tx, ty = cx + math.cos(a) * (r + L), cy + math.sin(a) * (r + L)
        nx, ny = -math.sin(a) * 2.6, math.cos(a) * 2.6
        poligono(cm, [(bx + nx, by + ny), (tx, ty), (bx - nx, by - ny)])
    for a in (2.5, .64):            # dois baixos e grossos
        bx, by = cx + math.cos(a) * r * .8, cy + math.sin(a) * r * .8
        tx, ty = cx + math.cos(a) * (r + 7), cy + math.sin(a) * (r + 7)
        nx, ny = -math.sin(a) * 3.5, math.cos(a) * 3.5
        poligono(cm, [(bx + nx, by + ny), (tx, ty), (bx - nx, by - ny)])
    pintar(img, cm, CRISTAL, '#e0c8ff', k=4.5, base=.45, raio=1, dither=.2)
    # massa: lobos
    m = vazio(H, W)
    blob(m, cx, cy, r, 1.0, [(4, .09, 1.3), (7, .05, -2), (2, .04 * convulsao, 5)], ph)
    for ang, rr in ((-2.4, .62), (-.7, .58), (1.9, .55)):        # lobos/câmaras
        elipse(m, cx + math.cos(ang) * r * .55, cy + math.sin(ang) * r * .55, r * rr, r * rr * .9)
    # tubos industriais fundidos (a poluição tem origem)
    tb = vazio(H, W)
    for x0, ang in ((-8, -1.9), (7, -1.2)):
        capsula(tb, cx + x0, cy - r * .7, cx + x0 + math.cos(ang) * 14, cy - r * .7 + math.sin(ang) * 14, 3.2, 3.2)
        elipse(tb, cx + x0 + math.cos(ang) * 14, cy - r * .7 + math.sin(ang) * 14, 4.2, 2.2, ang + math.pi / 2)
    tex = pp.ruido2(np.random.default_rng(13), H, W, 3) * .3
    pintar(img, tb, FERRO, '#6a5844', k=3, base=.45, raio=1)
    pintar(img, m, CARNE, COR_ARO, k=3.4, base=.36 + pulso * .1, raio=2, tex=tex)
    fechar(img)
    # fissuras brilhantes (mais fortes no batimento, no telégrafo e ao morrer)
    luz = max(pulso * .7, tel, lanca, rachado)
    r2 = np.random.default_rng(21)
    n_f = 7 + int(rachado * 8)
    for j in range(n_f):
        a = r2.uniform(0, math.tau)
        x, y = cx + math.cos(a) * r * .15, cy + math.sin(a) * r * .15
        L = r * (.5 + r2.uniform(0, .45) + rachado * .4)
        for k in range(int(L)):
            a += r2.uniform(-.5, .5)
            x += math.cos(a)
            y += math.sin(a)
            if not m[int(y) % H, int(x) % W]:
                break
            nivel = 1 + luz * 3 * (1 - k / L * .6)
            px(img, x, y, BRILHO[int(min(4, nivel))] if luz > .15 or k % 3 else CARNE[4])
    # núcleo: brilha no meio da massa
    nm = vazio(H, W)
    circulo(nm, cx + 2, cy + 1, 3 + luz * 4)
    aplicar(img, nm & m, BRILHO, valor(nm, 2, k=1.5, base=.35 + luz * .5), dither=.5)
    if lanca > .5:          # a lança se forma: cristal claro saindo do núcleo
        lm = vazio(H, W)
        poligono(lm, [(cx + 6, cy - 3), (cx + 26 + lanca * 10, cy), (cx + 6, cy + 3)])
        aplicar(img, lm, CRISTAL, valor(lm, 1, k=3, base=.75), dither=.2)
        fechar(img, ANEL)
    if tel > .6:            # telégrafo do anel: faíscas na borda
        for i in range(16):
            a = i / 16 * math.tau + ph
            px(img, cx + math.cos(a) * (r + 5 + tel * 3), cy + math.sin(a) * (r + 5 + tel * 3), BRILHO[3])
    return img


def onda(img, raio, forca):
    for i in range(int(raio * 3)):
        a = i / (raio * 3) * math.tau
        px(img, 64 + math.cos(a) * raio, 64 + math.sin(a) * raio, BRILHO[min(4, 2 + int(forca * 2))])
        if forca > .5:
            px(img, 64 + math.cos(a) * (raio - 1), 64 + math.sin(a) * (raio - 1), BRILHO[1])
    return img


def desfazer_coracao(base, k, n, rng):
    """Morte: as fissuras abrem, a massa racha em cacos de cristal que caem e apagam."""
    img = base.copy()
    t = (k + 1) / n
    H, W = img.shape[:2]
    nz = pp.ruido2(rng, H, W, 3)
    yy, xx = np.mgrid[0:H, 0:W]
    d = np.hypot(xx - 64, yy - 64) / 64
    some = (img[..., 3] > 0) & (nz + d * .6 < t * 1.4 - .4)
    img[some] = 0
    for _ in range(int(30 * t)):
        a = rng.uniform(0, math.tau)
        rr = rng.uniform(10, 30 + 30 * t)
        x, y = 64 + math.cos(a) * rr, 64 + math.sin(a) * rr + t * 14
        px(img, x, y, CRISTAL[2 + int(rng.random() * 3)] if rng.random() < .5 else BRILHO[1])
    return img


# ================================================================ folhas
def folha(nome, celula, pivo, anims):
    W, H = celula
    cols = max(len(q) for _, q, _, _ in anims)
    atlas = np.zeros((H * len(anims), W * cols, 4), np.uint8)
    meta = {'celula': [W, H], 'pivo': pivo, 'escala': 2, 'animacoes': {}}
    for lin, (an, quadros, fps, rep) in enumerate(anims):
        for i, q in enumerate(quadros):
            atlas[lin * H:(lin + 1) * H, i * W:(i + 1) * W] = q
        meta['animacoes'][an] = {'linha': lin, 'quadros': len(quadros), 'fps': fps, 'repete': rep}
    os.makedirs(SAIDA, exist_ok=True)
    Image.fromarray(atlas).save(os.path.join(SAIDA, f'{nome}.png'))
    with open(os.path.join(SAIDA, f'{nome}.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    return atlas, anims


def main():
    rng = np.random.default_rng(2)
    todas = []

    # --- Mãe Afogada: pivô = ponto de baixo no meio (onde o mapa a põe)
    b = mae(0)
    emergir = [respingo(submerso(mae(s), 1 - s, rng), .8 if s < .5 else .3, rng) for s in (.15, .45, .75, 1.0)]
    emergir[-1] = submerso(mae(0), 0, rng)
    todas.append(('mae-afogada', folha('mae-afogada', (MAE_W, MAE_H), [56, 79], [
        ('espera', [submerso(mae(f / 4), 0, rng) for f in range(4)], 5, True),
        ('emergir', emergir, 6, False),
        ('cuspir', [submerso(mae(0, tel=.4), 0, rng), submerso(mae(.1, tel=1, boca=.4), 0, rng),
                    submerso(mae(.2, tel=.6, boca=1), 0, rng), submerso(mae(.3, tel=.1, boca=.3), 0, rng)], 7, False),
        ('mergulho', [submerso(mae(f / 4, tel=.3), s, rng) for f, s in enumerate((.2, .45, .72, .95))], 7, False),
        ('ressurgir', [respingo(submerso(mae(0, 'ressurgir', tel=1), s, rng), 1 - s * .6, rng)
                       for s in (.6, .25, 0)], 9, False),
        ('ninhada', [submerso(mae(0, tel=.3, cria=c), 0, rng) for c in (.2, .55, .9)], 5, False),
        ('dano', [pz.dano_de(submerso(mae(0, 'dano'), 0, rng))], 1, False),
        ('morte', [submerso(pz.morte(b, k, 5, rng, GOSMA[2]), min(1, k * .15), rng) for k in range(5)], 7, False),
    ])))

    # --- Máquina: pivô = chão no meio; desenhada virada pra direita
    r = np.random.default_rng(5)
    apito = []
    for p in (.35, .7, 1.0):
        q = maquina(p, 'apito', pressao=p, giro=p, tel=p, rng=r)
        jato(q, 47.2, 29 - p * 2, -math.pi / 2, 6 + p * 8, r)          # o apito do telégrafo
        apito.append(q)
    investida = []
    for f in range(4):
        q = maquina(f / 4, 'investida', pressao=.6, giro=f * .9, rng=r)
        q = girar(q, -4, (42, 78))
        jato(q, 14, 58, math.pi + .2, 10, r, FUMACA)
        for _ in range(5):
            px(q, r.uniform(20, 70), r.uniform(76, 79), FOGO[3 + (r.random() < .5)])
        investida.append(q)
    atordoada = []
    for f in range(3):
        q = maquina(f / 3, 'atordoada', pressao=0, giro=0, rng=r)
        q = girar(q, 6 + math.sin(f * 2) * 2, (42, 78))
        for k in range(3):                 # faíscas girando sobre a chaminé
            a = f * 1.2 + k * 2.1
            px(q, 30 + math.cos(a) * 9, 18 + math.sin(a) * 3, FOGO[4])
        atordoada.append(q)
    salto = [poeira(maquina(0, 'salto', pressao=.5, agacha=1, rng=r), 42, 79, .4, r),
             maquina(.3, 'salto', pressao=.5, ar=1, giro=1, rng=r),
             poeira(maquina(.6, 'salto', pressao=.3, agacha=1, giro=1.4, rng=r), 42, 79, 1, r)]
    vapor = []
    for f, p in enumerate((.4, .8, 1.0, .5)):
        q = maquina(f / 4, 'vapor', pressao=p, giro=f * .3, tel=p, rng=r)
        if f >= 2:
            for ang in (-2.6, -1.9, -1.2, -.5):
                jato(q, 42 + math.cos(ang) * 22, 54 + math.sin(ang) * 16, ang, 8 + (3 - f) * 4, r)
            for _ in range(8):
                px(q, r.uniform(4, 80), r.uniform(4, 48), FOGO[2 + int(r.random() * 3)])
        vapor.append(q)
    morte = [maquina(0, 'morte', pressao=1, rachado=.4, rng=r),
             maquina(.2, 'morte', pressao=.8, rachado=.8, chamine_fora=.4, rng=r),
             maquina(.4, 'morte', pressao=.5, rachado=1, chamine_fora=1, rodas_fora=.6, rng=r),
             maquina(.6, 'morte', pressao=.2, rachado=1, chamine_fora=1.2, rodas_fora=1, agacha=1, rng=r)]
    for q in morte[1:3]:
        for _ in range(14):
            fumaca(q, r.uniform(20, 64), r.uniform(36, 64), r.uniform(1, 3), FOGO[1:], r)
    morte += [pz.morte(morte[-1], k, 3, rng, FOGO[2]) for k in (1, 2)]
    todas.append(('maquina', folha('maquina', (MAQ_W, MAQ_H), [42, 79], [
        ('espera', [maquina(f / 4, 'espera', pressao=.15, giro=f * .35, rng=r) for f in range(4)], 6, True),
        ('apito', apito, 5, False),
        ('investida', investida, 14, True),
        ('atordoada', atordoada, 6, True),
        ('salto', salto, 6, False),
        ('vapor', vapor, 8, False),
        ('dano', [pz.dano_de(maquina(0, 'dano', pressao=.3, rng=r))], 1, False),
        ('morte', morte, 7, False),
    ])))

    # --- Coração: pivô = centro (ele flutua)
    bater = [coracao(f / 6, p) for f, p in enumerate((0, 1, .45, .85, .25, 0))]
    anel = [coracao(.1, 0, t) for t in (.35, .7, 1.0)]
    anel.append(onda(coracao(.2, .6, .2), 36, 1))
    anel.append(onda(coracao(.3, .2, 0), 50, .4))
    todas.append(('coracao', folha('coracao', (COR_W, COR_H), [64, 64], [
        ('bater', bater, 8, True),
        ('anel', anel, 6, False),
        ('lanca', [coracao(0, 0, 0, lanca=.4), coracao(.1, 0, 0, lanca=.8), coracao(.2, .5, 0, lanca=1)], 6, False),
        ('transicao', [coracao(f / 4, (f % 2) * .8, 0, convulsao=c) for f, c in enumerate((.3, .7, 1, .6))], 8, False),
        ('dano', [pz.dano_de(coracao(0, .3, 0), -3)], 1, False),
        ('morte', [coracao(0, 1, 0, rachado=.5), coracao(.1, 1, 0, rachado=1)] +
                  [desfazer_coracao(coracao(.2, 1, 0, rachado=1), k, 4, rng) for k in range(4)], 6, False),
    ])))

    # prévia: fundo escuro e metade clara, como os parasitas
    Z = 3
    blocos = []
    for nome, (atlas, anims) in todas:
        h, w = atlas.shape[:2]
        fundo = np.zeros((h, w, 4), np.uint8)
        fundo[..., :3] = (22, 28, 34)
        fundo[..., 3] = 255
        fundo[:, w // 2:, :3] = (120, 132, 148)
        im = Image.fromarray(fundo)
        im.alpha_composite(Image.fromarray(atlas))
        im = im.resize((w * Z, h * Z), Image.NEAREST)
        cab = Image.new('RGBA', (im.width + 120, im.height), (12, 12, 14, 255))
        cab.paste(im, (120, 0))
        dr = ImageDraw.Draw(cab)
        dr.text((8, 6), nome, fill=(232, 228, 218, 255))
        lin_h = h // len(anims) * Z
        for i, (an, *_) in enumerate(anims):
            dr.text((8, i * lin_h + lin_h // 2), an, fill=(150, 146, 136, 255))
        blocos.append(cab)
    Wt = max(b.width for b in blocos)
    out = Image.new('RGBA', (Wt, sum(b.height + 8 for b in blocos)), (12, 12, 14, 255))
    y = 0
    for b in blocos:
        out.paste(b, (0, y))
        y += b.height + 8
    out.save(os.path.join(AQUI, 'pixel', '_previa', 'chefes.png'))
    print('ok', out.size)


if __name__ == '__main__':
    main()
