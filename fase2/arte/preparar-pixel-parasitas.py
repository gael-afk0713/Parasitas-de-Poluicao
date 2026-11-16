"""Gera os parasitas da Fase 2 em PIXEL ART (proposta, ainda fora do jogo).

Uso:  python fase2/arte/preparar-pixel-parasitas.py
Grava fase2/arte/pixel/parasitas/<especie>.png    (atlas: uma linha por animação)
      fase2/arte/pixel/parasitas/<especie>.json   (célula, pivô, linhas, fps)
      fase2/arte/pixel/_previa/parasitas.png       (tudo ampliado)

Referência: os sprites de IA em fase2/arte/parasitas/. Regras de leitura da
ARQUITETURA que valem aqui:
- parasita é BURACO PRETO com pontos de luz (olho branco); o herói é o claro;
- UMA silhueta = UM contorno: corpo, chifre e cauda viram uma máscara só;
- contorno claro POR DENTRO (aresta iluminada) + anel escuro POR FORA, pra
  ler tanto contra o fundo escuro quanto contra o céu claro;
- o arco do golpe, o telégrafo e o flash de dano o jogo faz em código; aqui
  vão a POSE de cada momento (preparar, atacar, recuar, morrer).
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

SAIDA = os.path.join(AQUI, 'pixel', 'parasitas')
PRETO = rampa(['#030305', '#08080b', '#101015', '#1a1a22', '#2a2a36'], 5)
ARO = C('#4e4e62')          # aresta iluminada por dentro
ANEL = C('#000000')         # anel escuro por fora
OLHO = C('#f4f0e6')
OLHO_N = C('#ffffff')
FOGO = rampa(['#5a1408', '#a8301a', '#d2521c', '#ff9a40', '#ffe0a0'], 5)
GOSMA = rampa(['#1a2408', '#3a4a10', '#6a8018', '#a8c030', '#e0f080'], 5)


# ----------------------------------------------------------------- base
def elipse(m, cx, cy, rx, ry, ang=0.0):
    H, W = m.shape
    yy, xx = np.mgrid[0:H, 0:W] + .5
    dx, dy = xx - cx, yy - cy
    ca, sa = math.cos(ang), math.sin(ang)
    u, v = dx * ca + dy * sa, -dx * sa + dy * ca
    m |= (u / rx) ** 2 + (v / ry) ** 2 <= 1


def poligono(m, pts):
    H, W = m.shape
    im = Image.new('L', (W, H), 0)
    ImageDraw.Draw(im).polygon([(x, y) for x, y in pts], fill=255)
    m |= np.asarray(im) > 0


def chifre(m, x0, y0, ang, L, r0, curva=0.0):
    x, y, r = x0, y0, r0
    n = max(3, int(L))
    for k in range(n):
        a = ang + curva * k
        nx, ny = x + math.cos(a) * L / n, y + math.sin(a) * L / n
        r2 = max(.45, r0 * (1 - (k + 1) / n))
        capsula(m, x, y, nx, ny, r, r2)
        x, y, r = nx, ny, r2


def pintar_sombra(m, extra_v=None):
    """Corpo preto com luz de cima-esquerda, aro claro por dentro, anel escuro por fora."""
    H, W = m.shape
    img = np.zeros((H, W, 4), np.uint8)
    v = valor(m, 2, k=3.0, base=.3)
    if extra_v is not None:
        v = v + extra_v
    aplicar(img, m, PRETO, v, dither=.3)
    aro = m & (~desloca(m, 1, 0) | ~desloca(m, 0, 1))
    img[aro, :3] = ARO
    pp.contorno(img, m, ANEL)
    return img


def olho(img, x, y, w=2, h=3, fechado=False):
    x, y, h = int(round(x)), int(round(y)), int(round(h))
    if fechado:
        for dx in range(w + 1):
            px(img, x + dx, y + h // 2, OLHO)
        return
    for dx in range(w):
        for dy in range(h):
            px(img, x + dx, y + dy, OLHO)
    px(img, x, y, OLHO_N)


def morte(base, k, n, rng, cor_part=None):
    """Dissolve: o corpo se desfaz em fumaça preta que sobe; o olho apaga por último."""
    img = base.copy()
    H, W = img.shape[:2]
    t = (k + 1) / (n + 1)
    nz = pp.ruido2(rng, H, W, 2) + np.linspace(.25, -.25, H)[:, None]   # some de baixo pra cima
    some = (img[..., 3] > 0) & (nz + .5 < t * 1.25)
    branco = (img[..., 0] > 200) & (img[..., 1] > 200)
    img[some & ~(branco & (t < .8))] = 0
    ys, xs = np.where(base[..., 3] > 0)
    if len(xs):
        cx, top = xs.mean(), ys.min()
        for j in range(int(6 + 10 * t)):
            x = cx + rng.uniform(-1, 1) * (W * .35)
            y = top + rng.uniform(-2, 1) * (H * .2) * t + rng.uniform(0, H * .5) * (1 - t)
            c = PRETO[3] if j % 3 else (cor_part if cor_part is not None else PRETO[4])
            px(img, x, y, c)
            if j % 4 == 0:
                px(img, x + 1, y, PRETO[2])
    return img


def dano_de(base, dx=-2):
    img = np.roll(base, dx, 1)
    if dx < 0:
        img[:, dx:] = 0
    return img


# ------------------------------------------------------------- ERRANTE
def errante(fase=0.0, modo='andar'):
    S = 40
    m = vazio(S, S)
    bob = -abs(math.sin(fase * math.pi)) if modo == 'andar' else 0
    lean = {'andar': 0, 'parado': 0, 'preparar': -2, 'bote': 3, 'recuo': 1}[modo]
    hx, hy = 22 + lean, 15 + bob + (1 if modo == 'preparar' else 0)
    elipse(m, hx, hy, 6.5, 6.5)
    chifre(m, hx - 2.5, hy - 5, -math.pi / 2 - .5, 7, 1.6, .06)
    chifre(m, hx + 1.5, hy - 5.5, -math.pi / 2 + .05, 7, 1.6, .05)
    # manto: trapézio com barra rasgada
    sw = math.sin(fase * math.pi * 2)
    base_y = 34 + bob * .5
    pts = [(hx - 5, hy + 3), (hx + 4, hy + 3), (hx + 6 + lean * .5, base_y - 3)]
    for i in range(6):
        x = hx + 6 + lean * .5 - i * 3.2
        pts.append((x, base_y + (2 if i % 2 == 0 else -1) + (sw if i % 3 == 0 else 0)))
    pts.append((hx - 8 - lean * .3, base_y - 1))
    poligono(m, pts)
    # pernas curtas
    pa = math.sin(fase * math.pi * 2) * 2.5 if modo == 'andar' else 0
    capsula(m, hx - 2 + pa, base_y - 1, hx - 2 + pa * 1.3, 37, 1.2, 1)
    capsula(m, hx + 2 - pa, base_y - 1, hx + 2 - pa * 1.3, 37, 1.2, 1)
    # braço/garra
    if modo in ('bote', 'recuo', 'preparar'):
        ax = {'preparar': -3, 'bote': 9, 'recuo': 6}[modo]
        capsula(m, hx + 3, hy + 6, hx + 3 + ax, hy + 8 - (2 if modo == 'bote' else 0), 1.2, .8)
        for g in (-1, 0, 1):
            capsula(m, hx + 3 + ax, hy + 8 - (2 if modo == 'bote' else 0),
                    hx + 4.5 + ax, hy + 8 + g * 1.5 - (2 if modo == 'bote' else 0), .6, .45)
    # cauda com espinhos
    tx, ty = hx - 8, base_y - 3
    a = math.pi - .25 + .15 * sw
    for k in range(6):
        nx, ny = tx + math.cos(a) * 2.2, ty + math.sin(a) * 2.2
        capsula(m, tx, ty, nx, ny, 1.4 - k * .18, 1.2 - k * .18)
        if k in (1, 3):
            poligono(m, [(tx - 1, ty - 1), (nx, ny - 1), (tx + math.cos(a) * 1.1 + .5, ty - 4)])
        tx, ty, a = nx, ny, a + .12
    img = pintar_sombra(m)
    olho(img, hx + 2, hy - 2, 2, 4 if modo != 'bote' else 2)
    return img


# ------------------------------------------------------------ ESPREITA
def espreita(fase=0.0, modo='flutuar'):
    S = 40
    m = vazio(S, S)
    bob = math.sin(fase * math.pi * 2) * 1.2
    sx = {'flutuar': 1, 'perseguir': 1.18, 'preparar': .85, 'mergulho': 1.3, 'recuo': 1}[modo]
    sy = {'flutuar': 1, 'perseguir': .88, 'preparar': 1.12, 'mergulho': .8, 'recuo': 1}[modo]
    inc = {'flutuar': 0, 'perseguir': .25, 'preparar': -.2, 'mergulho': .45, 'recuo': -.1}[modo]
    cx, cy = 22, 21 + bob
    elipse(m, cx, cy, 9.5 * sx, 11 * sy, inc)
    # ponta da gota curvando pra trás
    tipx, tipy = cx - 6 - 3 * sx + inc * 6, cy - 15 * sy
    poligono(m, [(cx - 7 * sx, cy - 4), (tipx, tipy), (cx + 2, cy - 10 * sy)])
    # espinhos miúdos nas costas
    for k, (ox, oy) in enumerate(((-9.5, 0), (-9, 4))):
        x0, y0 = cx + ox * sx, cy + oy * sy
        poligono(m, [(x0, y0 - 1.5), (x0 - 3, y0 - .5 + k), (x0, y0 + 1.5)])
    # cauda de fiapo
    w = math.sin(fase * math.pi * 2)
    for k, (ang, L) in enumerate(((2.5, 9), (2.2, 7), (2.8, 6))):
        a = ang + .2 * w * (1 if k % 2 else -1) - inc
        x, y = cx - 4 * sx, cy + 8 * sy
        r = 1.6
        for j in range(5):
            nx, ny = x + math.cos(a) * L / 5, y + math.sin(a) * L / 5
            capsula(m, x, y, nx, ny, r, max(.45, r - .3))
            x, y, r, a = nx, ny, max(.45, r - .3), a + .15 * w
    img = pintar_sombra(m)
    oh = {'mergulho': 4, 'preparar': 6}.get(modo, 7)
    olho(img, cx + 4 * sx + inc * 3, cy - oh / 2, 3, oh)
    return img


# ------------------------------------------------------------ CUSPIDOR
def cuspidor(fase=0.0, modo='parado'):
    W, H = 64, 56
    m = vazio(H, W)
    resp = math.sin(fase * math.pi * 2) * .8
    baixa = {'parado': 0, 'mirar': 2.5, 'cuspir': -2, 'recuo': -1, 'dano': 0}[modo]
    cx, cy = 29, 33 + baixa * .5 - resp * .3
    elipse(m, cx, cy, 18 + resp * .3, 14 - resp * .3, -.1)
    elipse(m, cx + 4, cy + 7, 15, 9)
    # cabeça baixa à frente
    hx, hy = cx + 16, cy + 4 + baixa * .6
    elipse(m, hx, hy, 6.5, 5.5, .3)
    poligono(m, [(hx - 2, hy - 5), (hx + 7, hy - 2), (hx + 2, hy - 1)])   # sobrancelha
    # pernas
    capsula(m, cx + 9, cy + 8, cx + 12, 51, 4, 3)
    capsula(m, cx - 9, cy + 8, cx - 10, 51, 3.5, 3)
    for px0 in (cx + 12, cx - 10):
        for g in (-2, 0, 2):
            capsula(m, px0, 51, px0 + 2 + g, 53, 1, .7)
    # canos nas costas
    capsula(m, cx - 6, cy - 11, cx - 6, cy - 22, 2.6, 2.6)
    elipse(m, cx - 6, cy - 23, 3.6, 1.6)
    pts = []
    for k in range(9):          # sai das costas, sobe e curva pra frente
        t = k / 8 * 2.1
        pts.append((cx + 3 + 6 * (1 - math.cos(t)), cy - 11 - 8 * math.sin(t) - k * .5))
    for p0, p1 in zip(pts, pts[1:]):
        capsula(m, *p0, *p1, 2.4, 2.4)
    boca = pts[-1]
    elipse(m, boca[0] + 1, boca[1], 2.2, 3.2, .4)
    # cauda fina com espinhos
    tx, ty = cx - 17, cy + 4
    for k in range(5):
        capsula(m, tx, ty, tx - 2.4, ty + .6 - k * .3, 1.4 - k * .2, 1.2 - k * .2)
        if k % 2 == 0:
            poligono(m, [(tx - 1, ty - 1), (tx - 2.5, ty - 4), (tx - 3, ty - .5)])
        tx, ty = tx - 2.4, ty + .6 - k * .3
    # escorridos de gosma embaixo
    for gx, L in ((cx - 4, 3 + resp), (cx + 2, 5 - resp), (cx - 12, 2)):
        capsula(m, gx, cy + 13, gx, cy + 13 + L, 1, .6)
    img = pintar_sombra(m)
    # anéis do cano (relevo)
    for k in range(2, 8, 2):
        x, y = pts[k]
        px(img, x - 1, y, PRETO[0])
        px(img, x + 1, y, PRETO[0])
    olho(img, hx + 2, hy - 1, 2, 2 if modo == 'mirar' else 3)
    if modo == 'mirar':                     # boca do cano esquenta
        g = int(fase * 3)
        for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1)):
            px(img, boca[0] + dx, boca[1] + dy - 1, GOSMA[min(4, 2 + g)])
    if modo == 'cuspir':
        bx, by = boca[0] + 3, boca[1] - 2
        bola = vazio(H, W)
        circulo(bola, bx + fase * 6, by - fase * 3, 2.4 + fase)
        aplicar(img, bola, GOSMA, valor(bola, 1, k=3, base=.6))
        for k in range(4):
            px(img, bx - 2 + k * 1.5, by + 1 + (k % 2), GOSMA[2])
    return img


# ---------------------------------------------------------- RASTEJANTE
def rastejante(fase=0.0, modo='rastejar'):
    W, H = 48, 24
    m = vazio(H, W)
    onda = math.sin(fase * math.pi * 2)
    ergue = {'rastejar': 0, 'eriçar': 2.5, 'bote': 1, 'dano': 0}[modo]
    comp = 17 + onda * 1.5 + (3 if modo == 'bote' else 0)
    alt = 6 - onda * .6 + ergue * .4
    cx = 24 + (2 if modo == 'bote' else 0)
    elipse(m, cx, 21 - alt, comp, alt + 1)
    elipse(m, cx + comp - 6, 20 - alt, 6.5, alt + 1.5)        # cabeça
    m &= np.mgrid[0:H, 0:W][0] <= 21
    # espinhos nas costas
    for k in range(4):
        x0 = cx - comp + 7 + k * 6.5 + onda * (1 if k % 2 else -1)
        y0 = 21 - 2 * alt - .5
        hgt = 3 + ergue + (1 if k == 1 else 0)
        poligono(m, [(x0 - 2, y0 + 2), (x0 - .5 - ergue * .3, y0 - hgt), (x0 + 1.5, y0 + 2)])
    # cauda afinando
    capsula(m, cx - comp + 2, 19, cx - comp - 5, 20 + onda * .5, 2, .6)
    img = pintar_sombra(m)
    ex = cx + comp - 4
    ey = 18 - alt
    olho(img, ex, ey, 2, 2 if modo != 'eriçar' else 3)
    olho(img, ex + 3, ey + .5, 1, 2)
    return img


# ------------------------------------------------------------- ESTOPIM
def estopim(fase=0.0, modo='rolar', pulsa=0.0):
    W, H = 32, 40
    m = vazio(H, W)
    pulo = abs(math.sin(fase * math.pi)) * (3 if modo == 'rolar' else 0)
    esm = 1 + (.12 if (modo == 'rolar' and pulo < .5) else 0)
    cx, cy = 16, 30 - pulo
    elipse(m, cx, cy, 9 * esm, 9 / esm)
    m[int(cy - 9 / esm - 3):int(cy - 9 / esm + 1), 13:19] = True      # tampa
    img = pintar_sombra(m)
    # pavio
    top = cy - 9 / esm - 3
    pts = [(16, top), (17, top - 2), (16.5, top - 4), (18, top - 5.5)]
    for p0, p1 in zip(pts, pts[1:]):
        for t in np.linspace(0, 1, 4):
            px(img, p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, '#3a3a44')
    # rachaduras brilhando (giram com o rolar)
    rng = np.random.default_rng(5)
    ang0 = fase * math.pi * .5 if modo == 'rolar' else 0
    brilho = .45 + .55 * pulsa
    for k in range(3):
        a = ang0 + k * 2.1 + rng.uniform(-.3, .3)
        x, y = cx, cy
        for j in range(int(5 + 3 * pulsa)):
            a += rng.uniform(-.5, .5)
            x += math.cos(a) * 1.2
            y += math.sin(a) * 1.2
            if (x - cx) ** 2 + (y - cy) ** 2 < 64:
                i = min(4, int(1 + brilho * 3 - j * .25))
                px(img, x, y, FOGO[max(1, i)])
    px(img, cx, cy, FOGO[min(4, int(2 + 2 * pulsa))])
    if modo == 'pavio':        # faísca na ponta do pavio
        sx, sy = pts[-1]
        px(img, sx, sy, FOGO[4])
        for dx, dy in ((1, -1), (-1, -1), (1, 1), (0, -2))[:1 + int(pulsa * 3)]:
            px(img, sx + dx, sy + dy, FOGO[3])
    return img


def explosao(k):
    """Estouro: núcleo quente que cresce, anel de fumaça preta, cacos."""
    W, H = 32, 40
    img = np.zeros((H, W, 4), np.uint8)
    cx, cy = 16, 28
    r = [4, 8, 11, 13, 14][k]
    fumo = vazio(H, W)
    rng = np.random.default_rng(40 + k)
    for j in range(9):
        a = j * .7 + k
        circulo(fumo, cx + math.cos(a) * r * .7, cy + math.sin(a) * r * .55 - k, r * .45)
    aplicar(img, fumo, PRETO, valor(fumo, 2, k=3, base=.35))
    if k < 4:
        fogo = vazio(H, W)
        circulo(fogo, cx, cy - k, max(1.5, r * (.75 - k * .15)))
        v = 1 - np.hypot(*(np.mgrid[0:H, 0:W] - [[[cy - k]], [[cx]]])) / max(1, r)
        aplicar(img, fogo, FOGO, v * 1.2 + .1)
    for j in range(6 + k):
        a = rng.uniform(0, 6.28)
        d = r + rng.uniform(0, 3)
        px(img, cx + math.cos(a) * d, cy + math.sin(a) * d * .8, PRETO[3] if j % 2 else FOGO[3 - min(2, k // 2)])
    return img


# ------------------------------------------------------------- TECELÃO
def tecelao(fase=0.0, modo='parado'):
    W, H = 32, 56
    m = vazio(H, W)
    sway = math.sin(fase * math.pi * 2) * .8
    estica = {'parado': 0, 'descer': 3, 'bote': 1, 'subir': 2, 'dano': 0}[modo]
    cx = 16 + sway
    capsula(m, 16, 1, cx, 12, .5, 1.6)                        # espinho que entra no fio
    elipse(m, cx, 26 + estica * .5, 4.2 - estica * .3, 12 + estica, sway * .03)
    elipse(m, cx + .5, 39 + estica, 3, 3.5)                    # cabeça embaixo
    # pernas: dobradas rente ao corpo no repouso, abertas no bote
    abre = {'parado': .15, 'descer': .05, 'bote': 1.0, 'subir': .2, 'dano': .5}[modo]
    for lado in (-1, 1):
        for k, y0 in enumerate((20, 26, 32)):
            y0 += estica * .5
            a1 = math.pi / 2 + lado * (.25 + abre * (1.1 - k * .2))
            jx, jy = cx + lado * 3 + math.cos(a1) * 5 * lado * 0 + lado * (2 + abre * 5), y0 + 4 - abre * 3
            fx, fy = jx + lado * (1 + abre * 2), jy + 6 - abre * 1 + k
            capsula(m, cx + lado * 2.5, y0, jx, jy, .8, .6)
            capsula(m, jx, jy, fx, fy, .6, .45)
    img = pintar_sombra(m)
    oh = 4 if modo == 'bote' else 3
    olho(img, cx + 1, 37 + estica - oh / 2, 2, oh)
    return img


# --------------------------------------------------------------- folhas
def especie(nome, celula, pivo, anims):
    """anims: lista de (nome, [quadros], fps, repete)."""
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
    rng = np.random.default_rng(1)
    todas = []

    def mortes(base, n=4, cor=None):
        return [morte(base, k, n, rng, cor) for k in range(n)]

    b = errante(0, 'parado')
    todas.append(('errante', especie('errante', (40, 40), [20, 37], [
        ('parado', [errante(f / 2, 'parado') for f in range(2)], 3, True),
        ('andar', [errante(f / 4, 'andar') for f in range(4)], 8, True),
        ('ataque', [errante(0, 'preparar'), errante(0, 'bote'), errante(0, 'recuo')], 10, False),
        ('dano', [dano_de(errante(0, 'recuo'))], 1, False),
        ('morte', mortes(b), 8, False)])))
    b = espreita(0, 'flutuar')
    todas.append(('espreita', especie('espreita', (40, 40), [20, 20], [
        ('flutuar', [espreita(f / 4, 'flutuar') for f in range(4)], 6, True),
        ('perseguir', [espreita(f / 2, 'perseguir') for f in range(2)], 6, True),
        ('ataque', [espreita(0, 'preparar'), espreita(0, 'mergulho'), espreita(.5, 'recuo')], 10, False),
        ('dano', [dano_de(espreita(0, 'recuo'))], 1, False),
        ('morte', mortes(b), 8, False)])))
    b = cuspidor(0, 'parado')
    todas.append(('cuspidor', especie('cuspidor', (64, 56), [32, 53], [
        ('parado', [cuspidor(f / 4, 'parado') for f in range(4)], 4, True),
        ('mirar', [cuspidor(f / 3, 'mirar') for f in range(3)], 5, False),
        ('cuspir', [cuspidor(f / 3, 'cuspir') for f in range(3)], 12, False),
        ('dano', [dano_de(cuspidor(0, 'dano'))], 1, False),
        ('morte', mortes(b, 5, GOSMA[2]), 8, False)])))
    b = rastejante(0, 'rastejar')
    todas.append(('rastejante', especie('rastejante', (48, 24), [24, 22], [
        ('rastejar', [rastejante(f / 4, 'rastejar') for f in range(4)], 6, True),
        ('ataque', [rastejante(0, 'eriçar'), rastejante(0, 'bote'), rastejante(.25, 'eriçar')], 10, False),
        ('dano', [dano_de(rastejante(0, 'dano'))], 1, False),
        ('morte', mortes(b, 3), 8, False)])))
    todas.append(('estopim', especie('estopim', (32, 40), [16, 39], [
        ('rolar', [estopim(f / 4, 'rolar', .2) for f in range(4)], 8, True),
        ('pavio', [estopim(0, 'pavio', p) for p in (.3, .65, 1.0)], 8, True),
        ('explosao', [explosao(k) for k in range(5)], 14, False),
        ('dano', [dano_de(estopim(0, 'rolar', .6))], 1, False)])))
    b = tecelao(0, 'parado')
    todas.append(('tecelao', especie('tecelao', (32, 56), [16, 1], [
        ('parado', [tecelao(f / 2, 'parado') for f in range(2)], 2, True),
        ('descer', [tecelao(f / 2, 'descer') for f in range(2)], 6, True),
        ('ataque', [tecelao(0, 'parado'), tecelao(0, 'bote'), tecelao(.5, 'bote')], 10, False),
        ('subir', [tecelao(f / 2, 'subir') for f in range(2)], 6, True),
        ('dano', [dano_de(tecelao(0, 'dano'))], 1, False),
        ('morte', mortes(b, 3), 8, False)])))

    # prévia: cada espécie em bloco, fundo de jogo escuro e faixa de céu claro
    Z = 4
    blocos = []
    for nome, (atlas, anims) in todas:
        h, w = atlas.shape[:2]
        fundo = np.zeros((h, w, 4), np.uint8)
        fundo[..., :3] = (22, 28, 34)
        fundo[..., 3] = 255
        fundo[:, w // 2:, :3] = (120, 132, 148)       # metade clara: testa o anel escuro
        im = Image.fromarray(fundo)
        im.alpha_composite(Image.fromarray(atlas))
        im = im.resize((w * Z, h * Z), Image.NEAREST)
        cab = Image.new('RGBA', (im.width + 150, im.height), (12, 12, 14, 255))
        cab.paste(im, (150, 0))
        dr = ImageDraw.Draw(cab)
        dr.text((8, 6), nome, fill=(232, 228, 218, 255))
        lin_h = h // len(anims) * Z
        for i, (an, *_ ) in enumerate(anims):
            dr.text((8, i * lin_h + lin_h // 2), an, fill=(150, 146, 136, 255))
        blocos.append(cab)
    Wt = max(b.width for b in blocos)
    out = Image.new('RGBA', (Wt, sum(b.height + 8 for b in blocos)), (12, 12, 14, 255))
    y = 0
    for b in blocos:
        out.paste(b, (0, y))
        y += b.height + 8
    out.save(os.path.join(AQUI, 'pixel', '_previa', 'parasitas.png'))
    print('ok', out.size)


if __name__ == '__main__':
    main()
