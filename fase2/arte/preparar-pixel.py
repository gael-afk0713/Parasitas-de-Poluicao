"""Gera em código os assets em PIXEL ART da Fase 2 (proposta, ainda fora do jogo).

Uso:  python fase2/arte/preparar-pixel.py
Grava fase2/arte/pixel/<area>/arvore-N-<estado>.png      (64x96)
      fase2/arte/pixel/<area>/plataforma-N-<estado>.png       (64x48)
      fase2/arte/pixel/<area>/caverna-N-<estado>.png          (64x48, pedra)
      fase2/arte/pixel/<area>/chao/<peca>-<estado>.png       (32x48 topo, 32x32 preench.)
      fase2/arte/pixel/<area>/montanhas/camada-N-<estado>.png (256x128, 1=perto 4=longe)
      fase2/arte/pixel/<area>/arvores.png, plataformas.png, cavernas.png, montanhas.png,
      chao.png e chao-preenchimento.png (folhas: linha 0
      poluída, linha 1 restaurada)
      fase2/arte/pixel/_previa/<area>.png e todas.png (ampliadas, pra revisar)

GRADE FIXA: 1 pixel de arte = 2 px do jogo, então 1 tile (32 px) = 16 px de
arte. Árvore ocupa 4x6 tiles (64x96), plataforma 4x3 tiles (64x48) com a
superfície pisável na linha y=14 (o que fica acima é grama/flor, decorativo).

As cores saem de render/paleta.js (lidas do arquivo), então cada área já nasce
com a luz e a crista dela. Mesma semente nos dois estados: a forma é a mesma,
e restaurar acrescenta vida (folha, musgo, flor, cipó) e tira a sujeira.
"""
import math
import os
import re

import numpy as np
from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))
SAIDA = os.path.join(AQUI, 'pixel')

AW, AH = 64, 96          # célula da árvore
PW, PH = 64, 48          # célula da plataforma (4x3 tiles)
SUP = 14                 # linha pisável da plataforma

NOMES = ['raizes', 'varzea', 'clareira', 'dossel', 'coracao']
EXTRA = {
    'raizes':   dict(flor3='#e890b8', tipos=['laje', 'raiz', 'torrao', 'orelha', 'tronco'],
                     arv5='jovem', sujeira='cinza'),
    'varzea':   dict(flor3='#f2b0d0', tipos=['balsa', 'tronco', 'lama', 'mangue', 'laje'],
                     arv5='buriti', sujeira='oleo'),
    'clareira': dict(flor3='#f4a868', tipos=['tronco', 'laje', 'toco', 'torrao', 'raiz'],
                     arv5='jovem', sujeira='brasa'),
    'dossel':   dict(flor3='#e8708c', tipos=['galho', 'orelha', 'tronco', 'raiz', 'torrao'],
                     arv5='emergente', sujeira='po'),
    'coracao':  dict(flor3='#d8a0f0', tipos=['raiz', 'laje', 'orelha', 'torrao', 'galho'],
                     arv5='ancestral', sujeira='gosma'),
}
ARVORES = ['alta', 'torta', 'bifurcada', 'sumauma']


# ------------------------------------------------------------------ cores
def C(c):
    if isinstance(c, str):
        s = c.lstrip('#')
        return np.array([int(s[i:i + 2], 16) for i in (0, 2, 4)], float)
    return np.asarray(c, float)


def mix(a, b, t):
    a, b = C(a), C(b)
    return a + (b - a) * t


def rampa(paradas, n):
    cs = [C(c) for c in paradas]
    out = []
    for i in range(n):
        t = i / (n - 1) * (len(cs) - 1)
        k = min(int(t), len(cs) - 2)
        f = t - k
        out.append(np.clip(cs[k] + (cs[k + 1] - cs[k]) * f, 0, 255))
    return np.array(out, np.uint8)


def ler_paleta():
    txt = open(os.path.join(RAIZ, 'fase2', 'render', 'paleta.js'), encoding='utf-8').read()
    pos = [txt.index(f'\n  {n}: {{') for n in NOMES] + [len(txt)]
    areas = {}
    for i, n in enumerate(NOMES):
        bloco = txt[pos[i]:pos[i + 1]]
        ip, ir = bloco.index('poluido:'), bloco.index('restaurado:')

        def cores(s):
            return dict(re.findall(r"(\w+):\s*'(#[0-9a-fA-F]{6})'", s))
        areas[n] = {'p': cores(bloco[ip:ir]), 'r': cores(bloco[ir:])}
    return areas


def materiais(T, estado, area):
    if estado == 'p':
        p = T['p']
        b, t, c, l = p['borda'], p['terreno'], p['crista'], p['luz']
        m = dict(
            madeira=rampa([b, t, mix(t, c, .45), c, mix(c, l, .3)], 6),
            pedra=rampa([b, t, mix(t, c, .5), mix(c, p['ceuBase'], .2), mix(c, p['ceuBase'], .5)], 6),
            terra=rampa([b, mix(t, '#2e2418', .4), mix(t, '#4a3a28', .45),
                         mix(c, '#6a5236', .45), mix(c, '#8a7050', .4)], 5),
            fungo=rampa([b, mix(t, '#3e3a2c', .6), mix(c, '#6e6850', .6),
                         mix(c, '#948c6c', .6), '#b0a884'], 5),
            seco=rampa([b, mix(t, '#3a2e1c', .6), mix(c, '#6a5634', .6), mix(c, '#8e7448', .55)], 4),
            contorno=C(b) * .8,
            acento=C(p['acento']),
        )
        if area == 'clareira':
            m['madeira'] = rampa(['#050302', '#0f0a07', '#1c140f', '#2b2019', '#3e3026', '#574536'], 6)
        if area == 'coracao':
            m['madeira'] = rampa([b, t, mix(t, c, .3), mix(c, '#5a5060', .5), mix(c, '#8a8090', .5)], 6)
    else:
        r = T['r']
        b, t, c, l, f = r['borda'], r['terreno'], r['crista'], r['luz'], r['terrenoFundo']
        m = dict(
            madeira=rampa([b, mix(t, '#1e140e', .75), mix(t, '#3e2c20', .72), mix(c, '#6a4e36', .78),
                           mix(c, '#947454', .72), mix(l, '#a08060', .6)], 6),
            pedra=rampa([b, t, mix(t, c, .35), mix(c, '#8a948c', .45), mix(c, l, .45)], 5),
            terra=rampa([b, mix(t, '#2a1c12', .6), mix(t, '#4a3422', .5),
                         mix(c, '#6e5236', .6), mix(c, '#94785a', .5)], 5),
            fungo=rampa([b, mix(t, '#4a2a1c', .7), mix(t, '#7a4a2e', .65), mix(c, '#b07a4a', .65),
                         mix(l, '#d8a878', .5)], 5),
            folha=rampa([f, mix(t, '#1e4a2a', .3), mix(mix(t, c, .5), '#3a7a40', .3), mix(c, '#5aa050', .35),
                         mix(mix(c, '#5aa050', .35), l, .3), mix(c, '#eaffd8', .5)], 6),
            musgo=rampa([mix(t, '#2a5a20', .5), mix(c, '#4a9a3a', .45), mix(c, '#86c850', .5),
                         mix(c, '#d4f0a0', .55)], 4),
            flores=[C(l), C('#48d9a8'), C(EXTRA[area]['flor3'])],
            contorno=C(b) * .8,
        )
    return m


# --------------------------------------------------------- utilidades
BAYER = (np.array([[0, 2], [3, 1]]) / 4.0) - .375


def vazio(H, W):
    return np.zeros((H, W), bool)


def caixa(a, r):
    if r <= 0:
        return a
    p = np.pad(a, ((r, r), (0, 0)))
    c = np.vstack([np.zeros((1, a.shape[1])), np.cumsum(p, 0)])
    a = (c[2 * r + 1:] - c[:-2 * r - 1]) / (2 * r + 1)
    p = np.pad(a, ((0, 0), (r, r)))
    c = np.hstack([np.zeros((a.shape[0], 1)), np.cumsum(p, 1)])
    return (c[:, 2 * r + 1:] - c[:, :-2 * r - 1]) / (2 * r + 1)


def desloca(m, dy, dx):
    """out[y, x] = m[y - dy, x - dx]; o que sai da grade vira falso."""
    out = np.zeros_like(m)
    H, W = m.shape
    out[max(dy, 0):H + min(dy, 0), max(dx, 0):W + min(dx, 0)] = \
        m[max(-dy, 0):H + min(-dy, 0), max(-dx, 0):W + min(-dx, 0)]
    return out


def ruido1(rng, n, escala):
    k = n // escala + 3
    pts = rng.random(k) - .5
    return np.interp(np.arange(n) / escala, np.arange(k), pts)


def ruido2(rng, H, W, ex, ey=None):
    ey = ey or ex
    h, w = H // ey + 2, W // ex + 2
    a = rng.random((h, w)).astype(np.float32)
    im = Image.fromarray(a).resize((w * ex, h * ey), Image.BILINEAR)
    return np.asarray(im)[:H, :W] - .5


def capsula(m, x0, y0, x1, y1, r0, r1):
    H, W = m.shape
    yy, xx = np.mgrid[0:H, 0:W] + .5
    dx, dy = x1 - x0, y1 - y0
    L2 = dx * dx + dy * dy or 1e-6
    t = np.clip(((xx - x0) * dx + (yy - y0) * dy) / L2, 0, 1)
    d = np.hypot(xx - (x0 + t * dx), yy - (y0 + t * dy))
    m |= d <= np.maximum(r0 + (r1 - r0) * t, .5)


def circulo(m, cx, cy, r):
    H, W = m.shape
    yy, xx = np.mgrid[0:H, 0:W] + .5
    m |= np.hypot(xx - cx, yy - cy) <= r


def valor(mask, raio=2, k=3.2, base=.52, topo=.16, baixo=.14):
    b = caixa(caixa(mask.astype(float), raio), raio)
    gy, gx = np.gradient(b)
    v = base + (gx * .45 + gy * .9) * k
    v = v + (mask & ~desloca(mask, 1, 0)) * topo - (mask & ~desloca(mask, -1, 0)) * baixo
    return v


def aplicar(img, sel, ramp, v, dither=.5):
    H, W = sel.shape
    yy, xx = np.mgrid[0:H, 0:W]
    n = len(ramp)
    idx = np.clip(np.floor((v + BAYER[yy % 2, xx % 2] * (dither / n)) * n).astype(int), 0, n - 1)
    img[sel, :3] = ramp[idx][sel]
    img[sel, 3] = 255


def contorno(img, mask, cor):
    d = mask | desloca(mask, 1, 0) | desloca(mask, -1, 0) | desloca(mask, 0, 1) | desloca(mask, 0, -1)
    o = d & ~mask & (img[..., 3] == 0)
    img[o, :3] = cor
    img[o, 3] = 255


def px(img, x, y, cor):
    x, y = int(round(x)), int(round(y))
    if 0 <= y < img.shape[0] and 0 <= x < img.shape[1]:
        img[y, x, :3] = np.clip(C(cor), 0, 255)
        img[y, x, 3] = 255


def cheio(img, x, y):
    x, y = int(round(x)), int(round(y))
    return 0 <= y < img.shape[0] and 0 <= x < img.shape[1] and img[y, x, 3] > 0


def flor(img, x, y, cor, rng, grande=None):
    centro = mix(cor, '#fff6dc', .65)
    if grande if grande is not None else rng.random() < .6:
        for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1)):
            px(img, x + dx, y + dy, cor)
        px(img, x, y, centro)
    else:
        px(img, x, y, cor)
        px(img, x + 1, y, mix(cor, '#000000', .25))


def colunas_topo(mask):
    """Para cada coluna, a primeira linha cheia (ou -1)."""
    tem = mask.any(0)
    return np.where(tem, mask.argmax(0), -1)


# ------------------------------------------------------------- árvores
def esqueleto(rng, tipo, esc):
    H, W = AH, AW
    segs, pontas, tronco_pts = [], [], []

    def seg(x0, y0, x1, y1, r0, r1):
        segs.append((x0, y0, x1, y1, r0, r1))

    def ramo(x, y, ang, comp, r, prof, abert=.7, curva=0.0):
        passos = max(2, int(round(comp / 5)))
        l = comp / passos
        ri = r
        for i in range(passos):
            ang += rng.uniform(-.22, .22) + curva
            nx, ny = x + math.sin(ang) * l, y - math.cos(ang) * l
            r2 = max(.5, r * (1 - .45 * (i + 1) / passos))
            seg(x, y, nx, ny, ri, r2)
            x, y, ri = nx, ny, r2
        if prof > 0:
            n = 3 if rng.random() < .25 else 2
            for k in range(n):
                off = (k - (n - 1) / 2) * abert * rng.uniform(.8, 1.25)
                ramo(x, y, ang + off + rng.uniform(-.12, .12), comp * rng.uniform(.58, .78),
                     max(.5, ri * .78), prof - 1, abert, curva)
        else:
            pontas.append((x, y, ang))
            seg(x, y, x + math.sin(ang) * 3, y - math.cos(ang) * 3, .5, .5)

    def tronco(bx, by, h, rb, rt, inclina, ond):
        n = max(3, int(h / 7))
        x, y, r = bx, by, rb
        pts = []
        for i in range(n):
            ang = inclina + rng.uniform(-ond, ond)
            nx, ny = x + math.sin(ang) * h / n, y - math.cos(ang) * h / n
            r2 = rb + (rt - rb) * (i + 1) / n
            seg(x, y, nx, ny, r, r2)
            pts.append((nx, ny, ang, r2))
            x, y, r = nx, ny, r2
        tronco_pts.extend(pts)
        return pts

    def raizes(bx, by, rb, n, larg):
        for s in (-1, 1):
            for k in range(n):
                dx = s * (rb * rng.uniform(1.2, 1.9) + k * larg * rng.uniform(.8, 1.2))
                seg(bx + s * rb * .3, by - rb * rng.uniform(1.2, 2.2), bx + dx, by + .5, rb * .55, .6)

    bx, by = W / 2 + rng.uniform(-4, 4), H - 1.5
    s = rng.choice([-1, 1])
    if tipo == 'alta':
        pts = tronco(bx, by, rng.uniform(50, 58) * esc, 3.6, 2.0, rng.uniform(-.06, .06), .08)
        raizes(bx, by, 3.6, 1, 3)
        x, y, a, r = pts[-1]
        ramo(x, y, a + rng.uniform(-.2, .2), 16 * esc, r, 2, .75)
        for i, f in enumerate((.55, .72)):
            x, y, a, r = pts[int(len(pts) * f)]
            ss = s if i == 0 else -s
            ramo(x, y, ss * rng.uniform(.9, 1.2), 13 * esc, r * .7, 1, .6, -ss * .04)
    elif tipo == 'torta':
        pts = tronco(bx - s * 6, by, 46 * esc, 3.4, 1.8, s * .3, .22)
        raizes(bx - s * 6, by, 3.4, 1, 3)
        x, y, a, r = pts[-1]
        ramo(x, y, a - s * .2, 17 * esc, r, 2, .8)
        x, y, a, r = pts[len(pts) // 2]
        ramo(x, y, -s * 1.0, 12 * esc, r * .7, 1, .6, s * .05)
    elif tipo == 'bifurcada':
        pts = tronco(bx, by, 26 * esc, 3.8, 3.0, rng.uniform(-.05, .05), .06)
        raizes(bx, by, 3.8, 1, 3)
        x, y, a, r = pts[-1]
        for ss in (-1, 1):
            ramo(x, y, ss * rng.uniform(.4, .6), 22 * esc, 2.6, 2, .7, -ss * .02)
    elif tipo == 'sumauma':
        pts = tronco(bx, by, 44 * esc, 6.0, 3.4, 0, .04)
        raizes(bx, by, 6.0, 2, 4)
        x, y, a, r = pts[-1]
        for ang, comp in ((-1.15, 19), (-.5, 14), (.5, 14), (1.15, 19)):
            ramo(x, y, ang + rng.uniform(-.1, .1), comp * esc, 2.5, 1, .55, -np.sign(ang) * .06)
    elif tipo == 'jovem':
        pts = tronco(bx, by, 34 * esc, 2.3, 1.2, rng.uniform(-.1, .1), .1)
        raizes(bx, by, 2.3, 1, 2)
        x, y, a, r = pts[-1]
        ramo(x, y, a, 11 * esc, r, 1, .8)
        x, y, a, r = pts[len(pts) // 2]
        ramo(x, y, s * 1.0, 7 * esc, r * .7, 0)
    elif tipo == 'emergente':
        pts = tronco(bx, by, 66 * esc, 3.2, 1.8, rng.uniform(-.04, .04), .05)
        raizes(bx, by, 3.2, 2, 3)
        x, y, a, r = pts[-1]
        ramo(x, y, a, 12 * esc, r, 2, .9)
        for f in (.4, .6):
            x, y, a, r = pts[int(len(pts) * f)]
            s = -s
            ramo(x, y, s * 1.2, 7 * esc, r * .6, 0, curva=-s * .05)
    elif tipo == 'ancestral':
        # dois troncos que se enroscam um no outro
        h, n = 50 * esc, 12
        fase = rng.uniform(0, 6.28)
        for k in (-1, 1):
            x, y, r = bx + k * 3, by, 3.4
            for i in range(n):
                nx = bx + k * 4.2 * math.sin(i * .55 + fase)
                ny = by - h * (i + 1) / n
                r2 = 3.4 - 1.4 * (i + 1) / n
                seg(x, y, nx, ny, r, r2)
                tronco_pts.append((nx, ny, 0, r2))
                x, y, r = nx, ny, r2
            ramo(x, y, k * .55, 16 * esc, r, 2, .7)
        raizes(bx, by, 4.5, 2, 4)
    # limites: madeira dentro da célula, pontas com folga pra copa
    for x0, y0, x1, y1, r0, r1 in segs:
        for x, y, r in ((x0, y0, r0), (x1, y1, r1)):
            if x - r < 1 or x + r > W - 2 or y - r < 1:
                return None
    for x, y, a in pontas:
        if x < 7 or x > W - 8 or y < 8:
            return None
    m = vazio(H, W)
    for sg in segs:
        capsula(m, *sg)
    return dict(madeira=m, pontas=pontas, tronco=tronco_pts, base=bx)


def gerar_esqueleto(seed, tipo):
    for tent in range(400):
        rng = np.random.default_rng(seed * 1000 + tent)
        a = esqueleto(rng, tipo, 1 - min(tent, 200) * .0015)
        if a:
            return a
    raise RuntimeError(f'árvore {tipo} não coube na célula')


def copa(rng, pontas, tipo):
    H, W = AH, AW
    yy, xx = np.mgrid[0:H, 0:W] + .5
    big = {'sumauma': 1.25, 'ancestral': 1.15, 'jovem': .95, 'emergente': .95}.get(tipo, 1.0)
    circ = []
    for x, y, a in pontas:
        cx, cy = x + math.sin(a) * 1.5, y - 1.5 - math.cos(a)
        R = rng.uniform(4.2, 6.0) * big
        circ.append((cx, cy, R))
        for _ in range(2):
            circ.append((cx + rng.uniform(-R * .8, R * .8), cy + rng.uniform(-R * .5, R * .4),
                         R * rng.uniform(.55, .8)))
    circ.sort(key=lambda c: -c[1])           # de baixo pra cima: o de cima fica na frente
    m = vazio(H, W)
    local = np.zeros((H, W))
    sep = vazio(H, W)
    for cx, cy, R in circ:
        d = np.hypot(xx - cx, yy - cy)
        th = np.arctan2(yy - cy, xx - cx)
        lob = rng.integers(5, 8)
        Rr = R + .8 * np.sin(th * lob + rng.uniform(0, 6.28)) + .4 * np.sin(th * 11 + rng.uniform(0, 6.28))
        dentro = d <= Rr
        # sombra fina onde este tufo se apoia no de trás
        sep |= (d > Rr) & (d <= Rr + 1) & m & (yy > cy)
        m |= dentro
        sep &= ~dentro
        local[dentro] = ((-(xx - cx) * .45 - (yy - cy) * .9) / R)[dentro]
    return m, local, sep


def palmeira(rng, estado, mats, img_w):
    """Buriti: tronco anelado; leque verde vivo, saia de folha morta no poluído."""
    H, W = AH, AW
    madeira, folhas = vazio(H, W), vazio(H, W)
    bx, by = W / 2 + rng.uniform(-3, 3), H - 1.5
    x, y, r = bx, by, 2.8
    n = 9
    for i in range(n):
        ang = .05 + rng.uniform(-.03, .03)
        nx, ny = x + math.sin(ang) * 60 / n, y - math.cos(ang) * 60 / n
        r2 = 2.8 - .7 * (i + 1) / n
        capsula(madeira, x, y, nx, ny, r, r2)
        x, y, r = nx, ny, r2
    tx, ty = x, y
    extras = []
    if estado == 'r':
        for i in range(13):
            ang = -1.55 + 3.1 * i / 12 + rng.uniform(-.08, .08)
            L = rng.uniform(12, 17)
            fx, fy, rr = tx, ty, 1.3
            for k in range(int(L / 2)):
                ang += np.sign(ang) * .07
                nx, ny = fx + math.sin(ang) * 2, fy - math.cos(ang) * 2
                capsula(folhas, fx, fy, nx, ny, rr, max(.5, rr - .1))
                fx, fy, rr = nx, ny, max(.5, rr - .1)
            for j in range(7):
                a2 = ang - .7 + 1.4 * j / 6 + rng.uniform(-.05, .05)
                l2 = rng.uniform(5, 8)
                capsula(folhas, fx, fy, fx + math.sin(a2) * l2, fy - math.cos(a2) * l2 + 1.5, .8, .5)
        for _ in range(7):
            extras.append(('fruto', tx + rng.uniform(-3, 3), ty + rng.uniform(3, 7)))
    else:
        for i in range(9):
            ang = math.pi + rng.uniform(-.75, .75)
            L = rng.uniform(12, 20)
            capsula(folhas, tx, ty + 1, tx + math.sin(ang) * L, ty + 1 - math.cos(ang) * L, 1.3, .5)
        for ss in (-1, 1):
            a2 = ss * rng.uniform(.25, .5)
            L = rng.uniform(6, 9)
            capsula(madeira, tx, ty, tx + math.sin(a2) * L, ty - math.cos(a2) * L, .9, .5)
    return dict(madeira=madeira, folhas=folhas, base=bx, topo=(tx, ty), extras=extras,
                pontas=[(tx, ty, 0)], tronco=[(bx, by - 30, 0, 2.4)])


CASCA = ['#120b07', '#24170e', '#3a2717', '#523a24', '#6e5234', '#8c6c48']


def cores_arvore(mats, T, estado, area):
    """Árvore na MESMA família de cor das ilhas e do chão aprovados: casca
    marrom-quente das raízes/galhos e copa no verde da capa de grama. No
    poluído a casca é a mesma, só acinzentada com a cor da área (a Clareira
    continua carbonizada)."""
    if estado == 'r':
        g = grama_rampa(T)
        mats['madeira'] = rampa(CASCA, 6)
        mats['folha'] = g
        mats['musgo'] = rampa([g[2], mix(g[3], '#8aa830', .3), mix(g[4], '#b0c840', .3), mix(g[5], '#d8e880', .3)], 4)
    elif area != 'clareira':
        tema = rampa([T['p']['borda'], T['p']['terreno'], mix(T['p']['terreno'], T['p']['crista'], .5),
                      T['p']['crista'], mix(T['p']['crista'], '#a8a8a8', .3), mix(T['p']['crista'], '#c0c0c0', .4)], 6)
        casca = rampa(CASCA, 6)
        mats['madeira'] = np.clip(casca * .55 + tema * .45, 0, 255).astype(np.uint8)
        mats['seco'] = rampa([CASCA[0], CASCA[2], mix(CASCA[4], '#8a7a5a', .4), mix(CASCA[5], '#a89870', .4)], 4)
    return mats


def desenhar_arvore(area, idx, tipo, estado, T):
    mats = cores_arvore(materiais(T, estado, area), T, estado, area)
    seed = NOMES.index(area) * 100 + idx * 7 + 3
    suj = EXTRA[area]['sujeira']
    H, W = AH, AW
    img = np.zeros((H, W, 4), np.uint8)
    rng = np.random.default_rng(seed + (0 if estado == 'p' else 50000))
    yy, xx = np.mgrid[0:H, 0:W]

    if tipo == 'buriti':
        A = palmeira(np.random.default_rng(seed), estado, mats, W)
        wood = A['madeira']
        tex = (((yy + 1) % 4) == 0) * -.22 + ruido2(rng, H, W, 2, 5) * .2
        v = valor(wood, 1) + tex
        aplicar(img, wood, mats['madeira'], v)
        fol = A['folhas']
        vf = valor(fol, 1, k=2.4) + ruido2(rng, H, W, 2) * .25
        aplicar(img, fol & ~wood, mats['folha'] if estado == 'r' else mats['seco'], vf)
        uniao = wood | fol
    else:
        A = gerar_esqueleto(seed, tipo)
        wood = A['madeira']
        tex = ruido2(rng, H, W, 2, 6) * .3
        v = valor(wood, 2) + tex
        aplicar(img, wood, mats['madeira'], v)
        uniao = wood.copy()
        if estado == 'r':
            topo = wood & ~desloca(wood, 1, 0)
            n2 = ruido2(rng, H, W, 6)
            musgo = (topo | (desloca(topo, 1, 0) & wood & (rng.random((H, W)) < .5))) & (n2 > -.12)
            musgo |= wood & (yy > H - 18) & (v > .5) & (ruido2(rng, H, W, 3) > -.15)
            aplicar(img, musgo, mats['musgo'], v * .9 + .1)
            fol, local, sep = copa(rng, A['pontas'], tipo)
            vf = valor(fol, 3, k=2.2, base=.5) + local * .32 + ruido2(rng, H, W, 2) * .18
            vf = vf - sep * .35
            aplicar(img, fol, mats['folha'], vf)
            uniao |= fol
    contorno(img, uniao, mats['contorno'])

    # ---------------- detalhes depois do contorno
    base = A['base']
    if estado == 'r':
        fol = uniao & ~wood if tipo != 'buriti' else A['folhas']
        musgo_c = mats['musgo']
        # cipós pendurados
        baixo = fol & ~desloca(fol, -1, 0)
        cand = np.argwhere(baixo)
        if len(cand):
            for k in rng.choice(len(cand), min(4, len(cand)), replace=False):
                y0, x0 = cand[k]
                L = rng.integers(4, 12)
                for j in range(1, L):
                    xj = x0 + round(math.sin(j * .5 + k) * .6)
                    if y0 + j >= H - 1:
                        break
                    px(img, xj, y0 + j, musgo_c[1] if j % 3 else musgo_c[2])
                    if j % 3 == 0:
                        px(img, xj + (1 if j % 2 else -1), y0 + j, musgo_c[2])
        # flores na borda da copa
        borda = fol & ~(desloca(fol, 1, 0) & desloca(fol, -1, 0) & desloca(fol, 0, 1) & desloca(fol, 0, -1))
        cand = np.argwhere(borda & (yy < H - 30))
        if len(cand):
            for k in rng.choice(len(cand), min(7, len(cand)), replace=False):
                y0, x0 = cand[k]
                flor(img, x0, y0, mats['flores'][rng.integers(0, 3)], rng)
        for kind, fx, fy in A.get('extras', []):
            px(img, fx, fy, '#6a3420')
            px(img, fx + 1, fy, '#8a4a2a')
            px(img, fx, fy + 1, '#3a1c12')
        # grama e flores no pé
        for x in range(int(base) - 12, int(base) + 13):
            if 0 <= x < W and rng.random() < .55 and not cheio(img, x, H - 2):
                h = rng.integers(1, 4)
                for j in range(h):
                    px(img, x, H - 1 - j, musgo_c[min(3, 1 + j)])
        for _ in range(2):
            fx = base + rng.choice([-1, 1]) * rng.uniform(6, 12)
            px(img, fx, H - 2, musgo_c[1])
            flor(img, fx, H - 4, mats['flores'][rng.integers(0, 3)], rng, grande=True)
    else:
        sujeira_arvore(img, rng, suj, wood, mats, A, v)
        for x in range(int(base) - 10, int(base) + 11):
            if 0 <= x < W and rng.random() < .3 and not cheio(img, x, H - 2):
                px(img, x, H - 1, mats['seco'][2])
                if rng.random() < .4:
                    px(img, x, H - 2, mats['seco'][1])
    return img


def sujeira_arvore(img, rng, suj, wood, mats, A, v):
    H, W = wood.shape
    yy, xx = np.mgrid[0:H, 0:W]
    topo = wood & ~desloca(wood, 1, 0)
    interior = wood & desloca(wood, 1, 0) & desloca(wood, -1, 0) & desloca(wood, 0, 1) & desloca(wood, 0, -1)
    if suj == 'cinza':
        for y, x in np.argwhere(topo & (rng.random((H, W)) < .35)):
            px(img, x, y, '#8a929e' if rng.random() < .5 else '#6a7280')
        for x, y, a in A['pontas'][:4]:
            px(img, x, y + 1, mats['acento'])
            px(img, x, y + 2, mix(mats['acento'], '#000000', .3))
    elif suj == 'oleo':
        mancha = wood & (yy > H - 13 + ruido2(rng, H, W, 3) * 5)
        aplicar(img, mancha, rampa(['#040504', '#0b0d0a', '#171a14', '#22261d'], 4), v)
        linha = mancha & ~desloca(mancha, 1, 0)
        for i, (y, x) in enumerate(np.argwhere(linha)):
            px(img, x, y, '#4a3a5a' if i % 2 else '#3a5a4a')
        if A['pontas']:
            x, y, a = A['pontas'][rng.integers(0, len(A['pontas']))]
            for dx, dy, c in ((0, 1, '#b8bcb0'), (1, 1, '#9aa094'), (0, 2, '#9aa094'), (1, 2, '#b8bcb0'),
                              (-1, 2, '#8a8e84'), (0, 3, '#8a8e84'), (1, 3, '#7a7e74'), (1, 4, '#7a7e74')):
                px(img, x + dx, y + dy, c)
    elif suj == 'brasa':
        for y, x in np.argwhere(topo & (rng.random((H, W)) < .3)):
            px(img, x, y, '#4a4038' if rng.random() < .6 else '#6a5c50')
        cand = np.argwhere(interior)
        if len(cand):
            for k in rng.choice(len(cand), min(9, len(cand)), replace=False):
                y, x = cand[k]
                L = rng.integers(2, 5)
                for j in range(L):
                    if interior[min(H - 1, y + j), x]:
                        px(img, x + (j % 2) * (1 if k % 2 else 0), y + j, '#d2521c')
                px(img, x, y + L // 2, '#ff9a40')
    elif suj == 'po':
        for y, x in np.argwhere(topo & (rng.random((H, W)) < .5)):
            px(img, x, y, '#8a9098' if rng.random() < .5 else '#a4aab2')
        for x, y, a in A['pontas'][:2]:
            px(img, x, y, '#b0a890')
            px(img, x + 1, y, '#8a7e66')
            px(img, x, y - 1, '#c8c0a8')
    elif suj == 'gosma':
        cand = np.argwhere(topo | (wood & (xx % 3 == 0) & (rng.random((H, W)) < .05)))
        if len(cand):
            for k in rng.choice(len(cand), min(6, len(cand)), replace=False):
                y, x = cand[k]
                L = rng.integers(3, 8)
                for j in range(L):
                    px(img, x, y + j, '#4a1868' if j < L - 1 else '#e63fa6')
                px(img, x + 1, y + L - 1, '#7e3aa4')
        cand = np.argwhere(interior)
        if len(cand):
            for k in rng.choice(len(cand), min(4, len(cand)), replace=False):
                y, x = cand[k]
                px(img, x, y, '#7e3aa4')
                px(img, x + 1, y, '#7e3aa4')
                px(img, x, y + 1, '#5a1e7a')
                px(img, x + 1, y + 1, '#e63fa6')


# ---------------------------------------------------------- plataformas
# Ilhas de terra flutuantes. A TERRA é a mesma nos dois estados (mesma
# semente, mesma paleta de solo): restaurar só põe vida por cima (capa de
# grama com franja, plantas, cipó) e tira a sujeira. Cada área tem o seu solo,
# as suas inclusões e o seu vocabulário de forma.

SOLO = {
    'raizes':   ['#120a07', '#2a1912', '#40261a', '#573423', '#6d432d', '#83553a'],
    'varzea':   ['#0e0b08', '#211a12', '#33281b', '#463824', '#5a4a30', '#6e5e3e'],
    'clareira': ['#160906', '#33150e', '#4e2116', '#6a2e1e', '#863e26', '#9c5232'],
    'dossel':   ['#140d08', '#2e1e0f', '#473018', '#604121', '#78542c', '#8e683a'],
    'coracao':  ['#120a0f', '#28141e', '#3c202a', '#522c36', '#683b44', '#7e4e56'],
}
PEDRA_ILHA = {
    'raizes':   ['#16171c', '#33343c', '#4d4e57', '#6a6b73', '#87888f'],
    'varzea':   ['#141812', '#2e342a', '#474f40', '#636c58', '#808a72'],
    'clareira': ['#1a1412', '#3a302c', '#554842', '#72645c', '#8e8078'],
    'dossel':   ['#161614', '#34332e', '#4f4d46', '#6c6a62', '#8a887e'],
    'coracao':  ['#16121c', '#322a3c', '#4c4258', '#685e74', '#857b90'],
}
CONTORNO_ILHA = '#090605'
RAIZ_COR = ['#1e140c', '#3a2818', '#584028', '#76583a', '#94744e']

# (largura, profundidade, assimetria, fundo, dentes)
FORMAS_ILHA = {
    'raizes':   [(.9, 15, 0, 'ponta', 3), (.68, 12, -.5, 'largo', 2), (.95, 14, .3, 'dois', 3),
                 (.6, 18, .2, 'ponta', 2), (.82, 10, 0, 'dentes', 6)],
    'varzea':   [(.95, 9, 0, 'largo', 5), (.78, 8, .4, 'largo', 4), (.9, 11, -.3, 'dois', 4),
                 (.62, 10, 0, 'largo', 3), (.86, 12, .2, 'ponta', 4)],
    'clareira': [(.9, 13, 0, 'largo', 2), (.74, 16, .4, 'ponta', 1), (.95, 12, -.2, 'dois', 2),
                 (.6, 14, 0, 'largo', 1), (.84, 17, -.4, 'ponta', 2)],
    'dossel':   [(.84, 14, 0, 'ponta', 3), (.95, 12, .3, 'dois', 3), (.7, 16, -.3, 'ponta', 2),
                 (.9, 10, 0, 'largo', 4), (.64, 17, .2, 'ponta', 3)],
    'coracao':  [(.9, 15, 0, 'ponta', 3), (.74, 17, .4, 'ponta', 2), (.95, 13, -.2, 'dois', 3),
                 (.6, 18, 0, 'ponta', 2), (.85, 12, .3, 'largo', 4)],
}
CEL = {'raizes': 5, 'varzea': 4, 'clareira': 6, 'dossel': 5, 'coracao': 5}


def grama_rampa(T):
    c = T['r']['crista']
    return rampa([mix('#0c2410', c, .1), mix('#1a4418', c, .15), mix('#2c6820', c, .15),
                  mix('#478a26', c, .15), mix('#6aa82e', c, .12), mix('#9cc84a', c, .1)], 6)


def corpo_ilha(rng, larg, prof, assim, fundo, ndentes):
    w = int(PW * larg)
    x0 = max(2, min(PW - w - 2, (PW - w) // 2 + int(rng.integers(-3, 4))))
    x1 = x0 + w - 1
    n1, n2 = ruido1(rng, PW, 7), ruido1(rng, PW, 3)
    tc = .5 + assim * .3
    topo, bot = {}, {}
    for x in range(x0, x1 + 1):
        t = (x - x0) / (x1 - x0)
        e = min(x - x0, x1 - x)
        topo[x] = SUP + (2 if e < 1 else 1 if e < 3 else 0)
        if fundo == 'ponta':
            p = max(0.0, 1 - abs(t - tc) / max(tc, 1 - tc)) ** 1.3
            p = .35 * math.sin(math.pi * t) ** .5 + .65 * p
        elif fundo == 'largo':
            p = math.sin(math.pi * t) ** .45 * .75
        elif fundo == 'dois':
            p = max(math.exp(-((t - .28) / .17) ** 2), .85 * math.exp(-((t - .72) / .16) ** 2))
            p = .3 * math.sin(math.pi * t) ** .5 + .7 * p
        else:
            p = math.sin(math.pi * t) ** .6 * .8
        bot[x] = topo[x] + 7 + p * prof * 1.35 + n1[x] * 5 + n2[x] * 2
    for _ in range(ndentes):
        c = int(rng.integers(x0 + 4, x1 - 3))
        hw = rng.uniform(1.5, 3.5)
        L = rng.uniform(3, 8)
        for x in range(int(c - hw), int(c + hw) + 1):
            if x in bot:
                bot[x] = max(bot[x], bot[c] + L * max(0.0, 1 - abs(x - c) / (hw + .5)) ** .8)
    m = vazio(PH, PW)
    for x in range(x0, x1 + 1):
        m[topo[x]:int(min(PH - 2, bot[x])) + 1, x] = True
    return m, x0, x1


def voronoi(rng, esp):
    pts = []
    for gy in range(-esp, PH + esp, esp):
        for gx in range(-esp, PW + esp, esp):
            pts.append((gx + rng.uniform(0, esp), gy + rng.uniform(0, esp * .85)))
    P = np.array(pts)
    yy, xx = np.mgrid[0:PH, 0:PW] + .5
    d = np.hypot(xx[..., None] - P[:, 0], yy[..., None] - P[:, 1])
    o = np.argsort(d, axis=2)
    d1 = np.take_along_axis(d, o[..., :1], 2)[..., 0]
    d2 = np.take_along_axis(d, o[..., 1:2], 2)[..., 0]
    c = P[o[..., 0]]
    local = np.clip(-((xx - c[..., 0]) * .45 + (yy - c[..., 1]) * .9) / (esp * .7), -1, 1)
    return local, (d2 - d1) < 1.0


def blob(img, rng, circs, ramp, cor_contorno):
    """Tufo de folhas (arbusto) desenhado por cima, com contorno próprio."""
    m = vazio(*img.shape[:2])
    local = np.zeros(img.shape[:2])
    yy, xx = np.mgrid[0:img.shape[0], 0:img.shape[1]] + .5
    for cx, cy, R in sorted(circs, key=lambda c: -c[1]):
        th = np.arctan2(yy - cy, xx - cx)
        dentro = np.hypot(xx - cx, yy - cy) <= R + .6 * np.sin(th * 6 + rng.uniform(0, 6))
        m |= dentro
        local[dentro] = ((-(xx - cx) * .45 - (yy - cy) * .9) / R)[dentro]
    v = valor(m, 1, k=2) * .5 + .25 + local * .35
    livre = img[..., 3] == 0
    aplicar(img, m, ramp, v)
    o = (m | desloca(m, 1, 0) | desloca(m, -1, 0) | desloca(m, 0, 1) | desloca(m, 0, -1)) & ~m & livre
    img[o, :3] = cor_contorno
    img[o, 3] = 255


def samambaia(img, rng, x, y, ramp, tam):
    n = int(rng.integers(4, 7))
    angs = sorted(np.linspace(-1.25, 1.25, n) + rng.uniform(-.12, .12, n), key=lambda a: -abs(a))
    for a in angs:
        L = tam * (1 - .35 * abs(a)) * rng.uniform(.85, 1.1)
        fx, fy = x + .5, y + .5
        for j in range(int(L)):
            fx += math.sin(a)
            fy -= math.cos(a)
            a += np.sign(a) * .13 if a else 0
            px(img, fx, fy, ramp[2])
            if j % 2 == 0 and j < L - 1:
                nx, ny = math.cos(a), math.sin(a)
                px(img, fx + nx, fy + ny, ramp[3])
                px(img, fx - nx, fy - ny, ramp[4])
        px(img, fx, fy, ramp[4])


def junco(img, rng, x, y, ramp):
    for k in range(int(rng.integers(3, 5))):
        a = rng.uniform(-.35, .35)
        L = rng.uniform(6, 11)
        fx, fy = x + k - 1.5, y
        for j in range(int(L)):
            fx += math.sin(a) * .9
            fy -= 1
            a *= 1.08
            px(img, fx, fy, ramp[3 if j < L * .6 else 4])
    # taboa
    tx = x + rng.integers(-1, 2)
    for j in range(1, 12):
        px(img, tx, y - j, ramp[2])
    for j in range(12, 15):
        px(img, tx, y - j, '#5a3820')
        px(img, tx + 1, y - j, '#7a5030')
    px(img, tx, y - 15, ramp[3])


def bromelia(img, rng, x, y, ramp, centro):
    for a in (-1.25, 1.25, -.85, .85, -.45, .45, 0):
        L = 6 - abs(a) * 1.5 + rng.uniform(-.5, .5)
        fx, fy = x + .5, y + .5
        for j in range(int(L)):
            fx += math.sin(a)
            fy -= math.cos(a)
            a += np.sign(a) * .18
            px(img, fx, fy, ramp[3] if j < L / 2 else ramp[4])
    px(img, x, y - 1, centro)
    px(img, x, y - 2, mix(centro, '#ffffff', .3))
    px(img, x + 1, y - 1, mix(centro, '#000000', .2))


def broto(img, x, y, ramp):
    px(img, x, y - 1, ramp[2])
    px(img, x, y - 2, ramp[2])
    px(img, x - 1, y - 3, ramp[4])
    px(img, x + 1, y - 3, ramp[3])
    px(img, x - 2, y - 3, ramp[3])
    px(img, x + 2, y - 4, ramp[4])


def desenhar_plataforma(area, k, estado, T):
    larg, prof, assim, fundo, nd = FORMAS_ILHA[area][k]
    seed = NOMES.index(area) * 100 + k * 11 + 7
    rf = np.random.default_rng(seed)              # forma: igual nos dois estados
    rd = np.random.default_rng(seed + (1 if estado == 'p' else 2) * 7919)
    img = np.zeros((PH, PW, 4), np.uint8)
    yy, xx = np.mgrid[0:PH, 0:PW]
    solo = rampa(SOLO[area], 6)
    pedra = rampa(PEDRA_ILHA[area], 5)

    corpo, x0, x1 = corpo_ilha(rf, larg, prof, assim, fundo, nd)
    pedras, raizes, galho, cristais, carvao = (vazio(PH, PW) for _ in range(5))
    # pedras: algumas saindo pelas laterais/fundo, outras dentro
    topo_c = colunas_topo(corpo)
    for i in range(int(rf.integers(2, 5))):
        if i == 0:
            cx = x0 + rf.uniform(-1, 3) if rf.random() < .5 else x1 - rf.uniform(-1, 3)
            cy = SUP + rf.uniform(4, 9)
        else:
            cx = rf.uniform(x0 + 5, x1 - 5)
            cy = rf.uniform(SUP + 6, SUP + 6 + prof * .9)
        rx, ry = rf.uniform(2.6, 4.2), rf.uniform(2.2, 3.2)
        e = (((xx + .5 - cx) / rx) ** 2 + ((yy + .5 - cy) / ry) ** 2) <= 1
        if i == 0 or (e & corpo).sum() == e.sum():
            pedras |= e
    pedras &= yy >= SUP + 2
    if area == 'raizes':
        for _ in range(2):
            x, y, rr = rf.uniform(x0 + 6, x1 - 6), SUP + rf.uniform(6, 10), 1.2
            a = rf.uniform(-.4, .4)
            for j in range(int(rf.integers(6, 10))):
                nx, ny = x + math.sin(a) * 2, y + math.cos(a) * 2
                capsula(raizes, x, y, nx, ny, rr, max(.45, rr - .06))
                x, y, rr = nx, ny, max(.45, rr - .06)
                a += rf.uniform(-.35, .35)
                if y > PH - 3:
                    break
    if area == 'dossel':
        lado = rf.choice([-1, 1])
        gy = SUP + rf.uniform(6, 9)
        xa, xb = (x0 - rf.uniform(3, 6), x1 - 4) if lado < 0 else (x0 + 4, x1 + rf.uniform(3, 6))
        capsula(galho, xb if lado < 0 else xa, gy + 2, xa if lado < 0 else xb, gy + rf.uniform(1, 4), 1.9, 1.2)
        galho &= (xx >= 1) & (xx <= PW - 2)
    if area == 'coracao':
        for _ in range(int(rf.integers(3, 6))):
            fundo_px = np.argwhere(corpo & ~desloca(corpo, -1, 0))
            y, x = fundo_px[rf.integers(0, len(fundo_px))]
            a = rf.uniform(-.7, .7) + math.pi
            L = rf.uniform(4, 8)
            capsula(cristais, x + .5, y - 1, x + .5 + math.sin(a) * L, y - 1 - math.cos(a) * L, 1.6, .3)
        cristais &= yy <= PH - 2
    if area == 'clareira':
        for _ in range(7):
            circulo(carvao, rf.uniform(x0 + 3, x1 - 3), rf.uniform(SUP + 3, SUP + 3 + prof * .8), rf.uniform(.8, 1.6))
        carvao &= corpo

    uniao = corpo | pedras | raizes | galho | cristais
    ao = np.clip((yy - SUP) / (PH - SUP), 0, 1) * .3
    local, costura = voronoi(rf, CEL[area])
    vu = valor(uniao, 2) * .55 + .22 - ao
    vs = vu + local * .3 - costura * .3 + ruido2(rf, PH, PW, 2) * .1
    if area == 'varzea':
        vs = vs - .05
    aplicar(img, corpo, solo, vs + .12)
    aplicar(img, carvao, rampa(['#060404', '#120e0c', '#221c18', '#363028'], 4), vs)
    aplicar(img, raizes & ~corpo, rampa(RAIZ_COR, 5), valor(raizes, 1) * .6 + .2)
    aplicar(img, raizes & corpo, rampa(RAIZ_COR, 5), vs * .7 + .05)
    aplicar(img, pedras, pedra, valor(pedras, 1, k=3) * .9 + .1)
    aplicar(img, galho, rampa(RAIZ_COR[:4], 4), valor(galho, 1) * .8 + ruido2(rf, PH, PW, 5, 1) * .3)
    # costura escura em volta das pedras que ficam dentro da terra
    anel = (desloca(pedras, 1, 0) | desloca(pedras, -1, 0) | desloca(pedras, 0, 1) | desloca(pedras, 0, -1)) & ~pedras & corpo
    img[anel, :3] = solo[0]
    if cristais.any():
        cc = (['#2a0c40', '#5a1e7a', '#9a3ac8', '#d070f0', '#f4c0ff'] if estado == 'p'
              else ['#0a2a2a', '#1a5a54', '#2e9a88', '#60d8b8', '#c8fae8'])
        aplicar(img, cristais, rampa(cc, 5), valor(cristais, 1, k=4) * .8 + .2)
    if area == 'varzea':
        for y, x in np.argwhere(corpo & (local > .55) & (rf.random((PH, PW)) < .25)):
            px(img, x, y, solo[5])

    topo = colunas_topo(corpo | pedras)
    cap = vazio(PH, PW)
    grama = grama_rampa(T)
    if estado == 'r':
        nb = ruido1(rd, PW, 3)
        dente = np.zeros(PW, int)
        x = x0
        while x <= x1:
            w = int(rd.integers(2, 4))
            L = int(rd.choice([1, 2, 3, 3, 4]))
            for i in range(w):
                if x + i <= x1:
                    dente[x + i] = max(0, L - (1 if i == w - 1 else 0))
            x += w
        for x in range(x0, x1 + 1):
            y0 = topo[x]
            if y0 < 0:
                continue
            ini = y0 - (1 if nb[x] > -.15 else 0)
            e = min(x - x0, x1 - x)
            fim = y0 + 3 + dente[x] + (4 - e if e < 3 else 0)
            cap[ini:fim, x] = True
        for xl, s in ((x0 - 1, -1), (x1 + 1, 1)):
            if 0 <= xl < PW:
                y0 = topo[xl - s]
                cap[y0:y0 + 3, xl] = True
        cap &= yy < PH - 1
        vcap = np.zeros((PH, PW))
        for x in range(PW):
            col = np.where(cap[:, x])[0]
            if len(col):
                y0 = col[0]
                vcap[col, x] = .92 - (col - y0) * .17
        vcap += (rd.random((PH, PW)) < .18) * .17 - (rd.random((PH, PW)) < .1) * .15
        aplicar(img, cap, grama, vcap, dither=.3)
        uniao |= cap
    else:
        crosta = vazio(PH, PW)
        for x in range(PW):
            if topo[x] >= 0:
                crosta[topo[x], x] = True
        crosta &= corpo
        aplicar(img, crosta, solo, np.full((PH, PW), .78 + 0.0))
        for x in range(x0 + 2, x1 - 1, 5):
            px(img, x + int(rd.integers(0, 3)), topo[x], solo[1])
        sujeira_ilha(img, rd, area, corpo, topo, x0, x1, galho)
    contorno(img, uniao, C(CONTORNO_ILHA))

    if estado == 'r':
        flores = [C(T['r']['luz']), C('#48d9a8'), C(EXTRA[area]['flor3'])]
        cols = [x for x in range(x0 + 2, x1 - 1) if topo[x] >= 0]
        # vida por cima — cada área com a sua
        n_pl = max(2, len(cols) // 14)
        lugares = sorted(rd.choice(cols, n_pl + 2, replace=False))
        for i, x in enumerate(lugares):
            y = topo[x] - 1
            if area == 'varzea':
                if i % 2 == 0:
                    junco(img, rd, x, y, grama)
                else:
                    samambaia(img, rd, x, y, grama, 5)
            elif area == 'dossel' and i % 2 == 0:
                bromelia(img, rd, x, y, grama, C('#d84860'))
            elif area == 'clareira' and i % 2 == 1:
                broto(img, x, y, grama)
            elif i == 1 and len(cols) > 30:
                blob(img, rd, [(x, y - 3, 3.5), (x + 3, y - 2, 2.6), (x - 3, y - 1.5, 2.4)],
                     grama, C(CONTORNO_ILHA))
            else:
                samambaia(img, rd, x, y, grama, rd.uniform(5, 8))
        for x in cols:
            if rd.random() < .3:
                for j in range(int(rd.integers(1, 3))):
                    px(img, x, topo[x] - 2 - j, grama[4 if j == 0 else 5])
        for x in rd.choice(cols, 3, replace=False):
            flor(img, x, topo[x] - 3, flores[int(rd.integers(0, 3))], rd)
        # cipós por cima da terra
        base_cap = cap & ~desloca(cap, -1, 0) & (xx > x0 + 1) & (xx < x1 - 1)
        cand = np.argwhere(base_cap)
        for i in rd.choice(len(cand), min(3, len(cand)), replace=False):
            y0, x = cand[i]
            L = int(rd.integers(6, 15))
            for j in range(1, L):
                xj = x + round(math.sin(j * .45 + i) * .7)
                if y0 + j >= PH - 1:
                    break
                px(img, xj, y0 + j, grama[2])
                if j % 3 == 1:
                    px(img, xj - 1, y0 + j, grama[3])
                    px(img, xj + 1, y0 + j + 1, grama[4])
        # raminhos de 3 folhas na face da terra
        face = np.argwhere(corpo & ~cap & (yy > SUP + 5) & (img[..., 1] < 120))
        for i in rd.choice(len(face), min(3, len(face)), replace=False):
            y, x = face[i]
            px(img, x, y, grama[2])
            px(img, x - 1, y - 1, grama[4])
            px(img, x + 1, y - 1, grama[3])
            px(img, x, y - 2, grama[4])
        if area == 'coracao':
            for i in rd.choice(len(face), min(4, len(face)), replace=False):
                y, x = face[i]
                px(img, x, y, '#8ff0d0')
    return img


def sujeira_ilha(img, rng, area, corpo, topo, x0, x1, galho):
    cols = [x for x in range(x0, x1 + 1) if topo[x] >= 0]
    if area == 'raizes':
        for x in cols:
            if rng.random() < .35:
                px(img, x, topo[x], '#7a828e' if rng.random() < .5 else '#5e6672')
        for x in rng.choice(cols, 2, replace=False):
            px(img, x, topo[x] - 1, '#6b6040')
            px(img, x + 1, topo[x] - 1, '#4e4630')
    elif area == 'varzea':
        for x in cols:
            px(img, x, topo[x], '#0b0d0a')
            px(img, x, topo[x] + 1, '#171a14' if x % 4 else '#0b0d0a')
            if rng.random() < .12:
                px(img, x, topo[x], '#4a3a5a' if rng.random() < .5 else '#3a5a4a')
        baixo = np.argwhere(corpo & ~desloca(corpo, -1, 0))
        for i in rng.choice(len(baixo), 3, replace=False):
            y, x = baixo[i]
            for j in range(1, int(rng.integers(2, 5))):
                px(img, x, y + j, '#0b0d0a')
        x = int(rng.choice(cols[3:-3]))
        y = topo[x] - 1
        for dx, dy, c in ((0, 0, '#8a8e90'), (1, 0, '#a8acae'), (2, 0, '#6a6e70'),
                          (0, -1, '#a8acae'), (1, -1, '#c4c8ca'), (2, -1, '#8a8e90')):
            px(img, x + dx, y + dy, c)
    elif area == 'clareira':
        for x in cols:
            px(img, x, topo[x], '#3a302a' if rng.random() < .6 else '#5a4c40')
        dentro = np.argwhere(corpo & desloca(corpo, 1, 0) & (np.mgrid[0:PH, 0:PW][0] < SUP + 8))
        for i in rng.choice(len(dentro), min(9, len(dentro)), replace=False):
            y, x = dentro[i]
            px(img, x, y, '#d2521c' if i % 3 else '#ff9a40')
        for x in rng.choice(cols, 3, replace=False):
            px(img, x, topo[x] - 1, '#1a120c')
    elif area == 'dossel':
        for x in cols:
            if rng.random() < .5:
                px(img, x, topo[x], '#8a9098' if rng.random() < .5 else '#a4aab2')
        ys, xs = np.where(galho)
        if len(xs):
            for xe in [x for x in (xs.min(), xs.max()) if x < x0 or x > x1]:
                col = ys[xs == xe]
                for y in col:
                    px(img, xe, y, '#c8bea0' if (y - col.min()) % 2 else '#9a8e70')
    elif area == 'coracao':
        xs = int(rng.integers(x0 + 3, max(x0 + 4, x1 - 14)))
        for x in range(xs, min(x1, xs + int(rng.integers(8, 14)))):
            if topo[x] >= 0:
                px(img, x, topo[x], '#5a1e7a' if x % 3 else '#b03aa0')
        baixo = np.argwhere(corpo & ~desloca(corpo, -1, 0))
        for i in rng.choice(len(baixo), 3, replace=False):
            y, x = baixo[i]
            L = int(rng.integers(2, 5))
            for j in range(1, L):
                px(img, x, y + j, '#4a1868')
            px(img, x, y + L, '#e63fa6')


# ------------------------------------------------- plataformas de caverna
# Lajes de pedra pra trechos subterrâneos. Mesma pedra nos dois estados;
# restaurar cobre o topo de musgo, que escorre pela borda e pende em fios.
# Forma angular (facetas retas entre pontos de controle) e estalactites
# afinando até 1 px — pedra quebra em plano, terra escorre em curva.

PEDRA_CAV = {
    'raizes':   ['#0c0e12', '#1c2028', '#2c323c', '#3e4652', '#525b68', '#68727f'],
    'varzea':   ['#0a0d0b', '#182019', '#263028', '#36423a', '#48564c', '#5c6c60'],
    'clareira': ['#110b09', '#241714', '#36241f', '#4a332c', '#5f453b', '#76584c'],
    'dossel':   ['#121110', '#26241f', '#3a3730', '#504c43', '#686357', '#827c6e'],
    'coracao':  ['#0e0a12', '#1e1626', '#2e2238', '#40304c', '#544062', '#6a5478'],
}
# (largura, profundidade, assimetria, estilo)
FORMAS_CAVERNA = {
    'raizes':   [(.9, 12, 0, 'laje'), (.7, 16, .3, 'ponta'), (.95, 10, -.3, 'degrau')],
    'varzea':   [(.95, 9, .2, 'laje'), (.75, 13, -.3, 'ponta'), (.88, 11, .3, 'degrau')],
    'clareira': [(.9, 11, -.2, 'degrau'), (.72, 15, .3, 'ponta'), (.95, 9, 0, 'laje')],
    'dossel':   [(.85, 13, .3, 'ponta'), (.95, 10, 0, 'laje'), (.8, 12, -.3, 'degrau')],
    'coracao':  [(.9, 14, 0, 'ponta'), (.8, 11, -.3, 'degrau'), (.95, 10, .3, 'laje')],
}


def musgo_rampa(T):
    c = T['r']['crista']
    return rampa([mix('#0e2210', c, .1), mix('#24401a', c, .12), mix('#3e6224', c, .12),
                  mix('#5e8430', c, .1), mix('#86a83e', c, .08), mix('#b0c860', c, .06)], 6)


def corpo_pedra(rng, larg, prof, assim, estilo):
    w = int(PW * larg)
    x0 = max(2, min(PW - w - 2, (PW - w) // 2 + int(rng.integers(-3, 4))))
    x1 = x0 + w - 1
    # pontos de controle do fundo -> facetas retas
    n = 6 if estilo != 'ponta' else 5
    xs = np.linspace(x0, x1, n)
    tc = .5 + assim * .3
    ys = []
    for i, x in enumerate(xs):
        t = (x - x0) / (x1 - x0)
        if estilo == 'ponta':
            p = max(0.0, 1 - abs(t - tc) / max(tc, 1 - tc))
        elif estilo == 'laje':
            p = .55 + rng.uniform(-.15, .15) if 0 < i < n - 1 else .15
        else:   # degrau: um lado bem mais fundo que o outro, em patamares
            p = (.25 if (t < tc) == (assim > 0) else .8) + rng.uniform(-.1, .1)
            if i in (0, n - 1):
                p = .12
        ys.append(SUP + 5 + p * prof * 1.3)
    bot = np.interp(np.arange(PW), xs, ys)
    lascas = ruido1(rng, PW, 2) * 2
    topo = np.full(PW, SUP)
    for lado, x in ((1, x0), (-1, x1)):       # cantos lascados em degraus
        k = int(rng.integers(1, 4))
        for j in range(k):
            topo[x + lado * j] = SUP + (k - j)
    for _ in range(int(rng.integers(2, 5))):  # estalactites
        c = int(rng.integers(x0 + 3, x1 - 2))
        hw = rng.uniform(1, 2.6)
        L = rng.uniform(4, 13)
        for x in range(int(c - hw), int(c + hw) + 1):
            if x0 <= x <= x1:
                bot[x] = max(bot[x], bot[c] + L * max(0.0, 1 - abs(x - c) / (hw + .5)))
    m = vazio(PH, PW)
    for x in range(x0, x1 + 1):
        m[topo[x]:int(min(PH - 2, bot[x] + lascas[x])) + 1, x] = True
    return m, x0, x1


def desenhar_caverna(area, k, estado, T):
    larg, prof, assim, estilo = FORMAS_CAVERNA[area][k]
    seed = NOMES.index(area) * 100 + k * 13 + 501
    rf = np.random.default_rng(seed)
    rd = np.random.default_rng(seed + (1 if estado == 'p' else 2) * 7919)
    img = np.zeros((PH, PW, 4), np.uint8)
    yy, xx = np.mgrid[0:PH, 0:PW]
    pedra = rampa(PEDRA_CAV[area], 6)
    corpo, x0, x1 = corpo_pedra(rf, larg, prof, assim, estilo)

    extra, veio = vazio(PH, PW), vazio(PH, PW)
    if area == 'raizes':                       # raízes descendo pelas fendas
        for _ in range(2):
            x, y, rr = rf.uniform(x0 + 6, x1 - 6), SUP + 3, 1.1
            for j in range(int(rf.integers(7, 12))):
                nx, ny = x + rf.uniform(-1.2, 1.2), y + 2
                capsula(extra, x, y, nx, ny, rr, max(.45, rr - .07))
                x, y, rr = nx, ny, max(.45, rr - .07)
                if y > PH - 3:
                    break
    if area == 'coracao':                      # veios de cristal na pedra
        for _ in range(2):
            x, y = rf.uniform(x0 + 4, x1 - 4), SUP + rf.uniform(3, 6)
            for j in range(10):
                veio[int(min(PH - 1, y)), int(min(PW - 1, max(0, x)))] = True
                x += rf.choice([-1, 0, 1])
                y += 1
        veio &= corpo
    uniao = corpo | extra

    local, costura = voronoi(rf, 7)
    ao = np.clip((yy - SUP) / (PH - SUP), 0, 1) * .3
    estratos = ((yy + (ruido2(rf, PH, PW, 8, 2) * 3).astype(int)) % 6 == 0)
    v = (valor(corpo, 1, k=3.6) * .6 + .25 + local * .22 - costura * .32 - estratos * .12
         - ao + ruido2(rf, PH, PW, 2) * .1)
    aplicar(img, corpo, pedra, v, dither=.35)
    anel = corpo & ~desloca(corpo, -1, 0)      # aresta de baixo escura
    img[anel, :3] = pedra[0]
    aplicar(img, extra & ~corpo, rampa(RAIZ_COR, 5), valor(extra, 1) * .6 + .2)
    aplicar(img, extra & corpo, rampa(RAIZ_COR[:3], 3), v)
    if veio.any():
        cc = ['#5a1e7a', '#c65de8'] if estado == 'p' else ['#1a5a54', '#60d8b8']
        for i, (y, x) in enumerate(np.argwhere(veio)):
            px(img, x, y, cc[i % 3 == 0])
    if area == 'varzea':                       # pedra molhada: brilhos
        for y, x in np.argwhere(corpo & (local > .5) & (rf.random((PH, PW)) < .2)):
            px(img, x, y, pedra[5])

    topo = colunas_topo(corpo)
    musgo_c = musgo_rampa(T)
    cap = vazio(PH, PW)
    if estado == 'r':
        nb = ruido1(rd, PW, 3)
        for x in range(x0, x1 + 1):
            y0 = topo[x]
            if y0 < 0:
                continue
            ini = y0 - (1 if nb[x] > 0 else 0)
            fim = y0 + 2 + (rd.random() < .35) * int(rd.integers(1, 3))
            e = min(x - x0, x1 - x)
            if e < 3:
                fim += 3 - e + int(rd.integers(0, 3))
            cap[ini:fim, x] = True
        # manchas de musgo na face iluminada
        face = corpo & (v > .62) & (ruido2(rd, PH, PW, 4) > .1) & (yy > SUP + 3)
        cap |= face
        cap &= yy < PH - 1
        vc = np.zeros((PH, PW))
        for x in range(PW):
            col = np.where(cap[:, x])[0]
            if len(col):
                vc[col, x] = .88 - (col - col[0]) * .16
        vc += (rd.random((PH, PW)) < .2) * .17 - (rd.random((PH, PW)) < .12) * .17
        aplicar(img, cap, musgo_c, vc, dither=.3)
        uniao |= cap
    else:
        sujeira_ilha(img, rd, area, corpo, topo, x0, x1, vazio(PH, PW))
    contorno(img, uniao, C(CONTORNO_ILHA))

    if estado == 'r':
        # fios de musgo pendurados (barba-de-velho) sob a laje
        baixo = np.argwhere(corpo & ~desloca(corpo, -1, 0) & (yy < PH - 4))
        for i in rd.choice(len(baixo), min(6, len(baixo)), replace=False):
            y0, x = baixo[i]
            L = int(rd.integers(2, 9))
            for j in range(1, L):
                if y0 + j >= PH - 1:
                    break
                xj = x + (1 if (j + i) % 5 == 0 else 0)
                px(img, xj, y0 + j, musgo_c[2] if j < L - 1 else musgo_c[3])
        # tufinhos por cima e algumas gotas de luz (esporos) nas fendas
        for x in range(x0, x1 + 1):
            if topo[x] >= 0 and rd.random() < .25:
                px(img, x, topo[x] - 2, musgo_c[4])
        cols = [x for x in range(x0 + 2, x1 - 1) if topo[x] >= 0]
        for x in rd.choice(cols, 2, replace=False):
            flor(img, x, topo[x] - 3, C(T['r']['luz']) if area != 'coracao' else C('#48d9a8'), rd,
                 grande=False)
    return img


# ------------------------------------------------------------- chão
# Tileset do chão em PEDAÇOS que encaixam em qualquer ordem: 3 meios
# (variações), borda esquerda/direita, e preenchimento (miolo e lados) pra
# empilhar em profundidade. O segredo do encaixe: a textura da terra é uma
# função PERIÓDICA de período 32 nos dois eixos (Voronoi num toro), então a
# coluna 31 de qualquer pedaço continua a coluna 0 de qualquer outro, e o
# preenchimento continua o fundo do pedaço de cima. Tudo que não é periódico
# (pedras, plantas, bichos, sujeira) fica longe das bordas do pedaço.

CW, CH, CF = 32, 48, 32      # largura do pedaço, altura, altura do preenchimento
SUPC = 16                    # superfície na linha do tile (16 px de arte = 1 tile)
AO_FUNDO = .22               # escurecimento que o fundo atinge e o preenchimento mantém


def textura_periodica(area):
    rng = np.random.default_rng(900 + NOMES.index(area))
    g = max(4, round(32 / CEL[area]))
    cel = 32 / g
    P = np.array([(gx * cel + rng.uniform(0, cel), gy * cel + rng.uniform(0, cel * .9))
                  for gy in range(g) for gx in range(g)])
    yy, xx = np.mgrid[0:32, 0:32] + .5
    dx = (xx[..., None] - P[:, 0] + 16) % 32 - 16
    dy = (yy[..., None] - P[:, 1] + 16) % 32 - 16
    d = np.hypot(dx, dy)
    o = np.argsort(d, 2)
    d1 = np.take_along_axis(d, o[..., :1], 2)[..., 0]
    d2 = np.take_along_axis(d, o[..., 1:2], 2)[..., 0]
    ldx = np.take_along_axis(dx, o[..., :1], 2)[..., 0]
    ldy = np.take_along_axis(dy, o[..., :1], 2)[..., 0]
    local = np.clip(-(ldx * .45 + ldy * .9) / (cel * .7), -1, 1)
    costura = (d2 - d1) < 1.0
    nz = rng.random((32, 32))
    nz = (nz + np.roll(nz, 1, 0) + np.roll(nz, -1, 0) + np.roll(nz, 1, 1) + np.roll(nz, -1, 1)) / 5 - .5
    return local, costura, nz


def valor_pad(mask, raio=2, k=3.2):
    p = 8
    m = np.pad(mask, p, mode='edge')
    return valor(m, raio, k)[p:-p, p:-p]


def lado(y, fase):
    t = 2 * math.pi * (y % 32) / 32
    return 4 + 1.3 * math.sin(t + fase) + .8 * math.sin(2 * t + fase * 1.7)


def mascara_chao(peca, var, H, oy):
    """peca: meio|esq|dir|fill|fill-esq|fill-dir. oy = y absoluto da linha 0."""
    m = vazio(H, CW)
    for y in range(H):
        ya = y + oy
        if ya < SUPC:
            continue
        x0, x1 = 0, CW - 1
        if peca in ('esq', 'fill-esq'):
            x0 = int(round(lado(ya, .7)))
            if ya < SUPC + 6:
                x0 += int(round(4 * (1 - (ya - SUPC) / 6) ** 2))
        if peca in ('dir', 'fill-dir'):
            x1 = CW - 1 - int(round(lado(ya, 2.4)))
            if ya < SUPC + 6:
                x1 -= int(round(4 * (1 - (ya - SUPC) / 6) ** 2))
        m[y, x0:x1 + 1] = True
    if peca == 'meio' and var == 1:      # monte suave de 1 px
        m[SUPC - 1, 9:23] = True
    if peca == 'meio' and var == 2:      # degrauzinho
        m[SUPC - 1, 18:27] = True
    return m


def desenhar_chao(area, peca, var, estado, T):
    H = CF if peca.startswith('fill') else CH
    oy = CH if peca.startswith('fill') else 0
    seed = NOMES.index(area) * 100 + ['meio', 'esq', 'dir', 'fill', 'fill-esq', 'fill-dir'].index(peca) * 17 + var * 5 + 2001
    rf = np.random.default_rng(seed)
    rd = np.random.default_rng(seed + (1 if estado == 'p' else 2) * 7919)
    img = np.zeros((H, CW, 4), np.uint8)
    yy, xx = np.mgrid[0:H, 0:CW]
    solo = rampa(SOLO[area], 6)
    corpo = mascara_chao(peca, var, H, oy)
    local, costura, nz = textura_periodica(area)
    ya = (yy + oy) % 32
    ao = np.clip(((yy + oy) - SUPC) / 24, 0, 1) * AO_FUNDO
    vg = valor_pad(corpo, 2) * .55 + .22
    v = vg + local[ya, xx] * .3 - costura[ya, xx] * .3 + nz[ya, xx] * .2 - ao + .12
    if area == 'varzea':
        v = v - .05
    aplicar(img, corpo, solo, v)

    # inclusões (longe das bordas do pedaço)
    pedras, raizes = vazio(H, CW), vazio(H, CW)
    yminc = 2 if peca.startswith('fill') else SUPC + 4
    xs_ok = (6, CW - 7)
    n_pedras = int(rf.integers(0, 2)) if peca.startswith('fill') else int(rf.integers(1, 3))
    for i in range(n_pedras):
        cx, cy = rf.uniform(*xs_ok), rf.uniform(yminc + 2, H - 5)
        rx, ry = rf.uniform(2.2, 3.6), rf.uniform(1.8, 2.8)
        e = (((xx + .5 - cx) / rx) ** 2 + ((yy + .5 - cy) / ry) ** 2) <= 1
        if (e & corpo).sum() == e.sum():
            pedras |= e
    if peca in ('esq', 'dir'):           # pedra saindo pela lateral
        ys = SUPC + rf.uniform(8, 14)
        lx = lado(ys, .7) + .5 if peca == 'esq' else CW - 1 - lado(ys, 2.4) + .5
        e = (((xx + .5 - lx) / 3.2) ** 2 + ((yy + .5 - ys) / 2.5) ** 2) <= 1
        pedras |= e & (xx >= 1) & (xx <= CW - 2)
    if area == 'raizes' and peca == 'meio':
        x, y, rr = rf.uniform(8, 24), SUPC + 4, 1.1
        for j in range(int(rf.integers(5, 9))):
            nx, ny = min(CW - 5, max(4, x + rf.uniform(-1.4, 1.4))), y + 2.5
            capsula(raizes, x, y, nx, ny, rr, max(.45, rr - .08))
            x, y, rr = nx, ny, max(.45, rr - .08)
        raizes &= corpo & (yy < H - 2)
    if area == 'clareira':
        carvao = vazio(H, CW)
        for _ in range(3):
            circulo(carvao, rf.uniform(*xs_ok), rf.uniform(yminc, H - 3), rf.uniform(.8, 1.5))
        aplicar(img, carvao & corpo, rampa(['#060404', '#120e0c', '#221c18', '#363028'], 4), v)
    if area == 'coracao':
        x, y = rf.uniform(*xs_ok), yminc + rf.uniform(0, 6)
        cc = ['#5a1e7a', '#c65de8'] if estado == 'p' else ['#1a5a54', '#60d8b8']
        for j in range(int(rf.integers(6, 11))):
            if corpo[min(H - 1, int(y)), int(x)]:
                px(img, x, y, cc[j % 3 == 0])
            x = min(CW - 4, max(3, x + rf.choice([-1, 0, 1])))
            y += 1
    aplicar(img, raizes, rampa(RAIZ_COR[:3], 3), v)
    aplicar(img, pedras, rampa(PEDRA_ILHA[area], 5), valor(pedras, 1, k=3) * .9 + .1)
    anel = (desloca(pedras, 1, 0) | desloca(pedras, -1, 0) | desloca(pedras, 0, 1) | desloca(pedras, 0, -1)) & ~pedras & corpo
    img[anel, :3] = solo[0]
    if area == 'varzea':
        for y, x in np.argwhere(corpo & (local[ya, xx] > .55) & (rf.random((H, CW)) < .22)):
            px(img, x, y, solo[5])

    uniao = corpo | pedras
    topo = colunas_topo(corpo)
    tem_topo = not peca.startswith('fill')
    grama = grama_rampa(T)
    if tem_topo and estado == 'r':
        cap = vazio(H, CW)
        nb = ruido1(rd, CW, 3)
        lados = [x for x in range(CW) if topo[x] >= 0]
        xa, xb = min(lados), max(lados)
        for x in lados:
            y0 = topo[x]
            dente = int(rd.choice([1, 2, 3, 3, 4]))
            e = min(x - xa if peca == 'esq' else 99, xb - x if peca == 'dir' else 99)
            fim = y0 + 3 + dente + (4 - e + int(rd.integers(0, 3)) if e < 3 else 0)
            cap[y0 - (1 if nb[x] > -.15 else 0):fim, x] = True
        if peca == 'esq' and xa > 0:
            cap[topo[xa]:topo[xa] + 3, xa - 1] = True
        if peca == 'dir' and xb < CW - 1:
            cap[topo[xb]:topo[xb] + 3, xb + 1] = True
        vc = np.zeros((H, CW))
        for x in range(CW):
            col = np.where(cap[:, x])[0]
            if len(col):
                vc[col, x] = .92 - (col - col[0]) * .17
        vc += (rd.random((H, CW)) < .18) * .17 - (rd.random((H, CW)) < .1) * .15
        aplicar(img, cap, grama, vc, dither=.3)
        uniao |= cap
    elif tem_topo:
        crosta = vazio(H, CW)
        for x in range(CW):
            if topo[x] >= 0:
                crosta[topo[x], x] = True
        aplicar(img, crosta, solo, np.full((H, CW), .78))
        for x in range(3, CW - 3, 5):
            if topo[x] >= 0:
                px(img, x + int(rd.integers(0, 2)), topo[x], solo[1])
    # contorno só nas bordas de verdade (não entre pedaços)
    contorno(img, uniao, C(CONTORNO_ILHA))
    if not tem_topo:
        return img
    if estado == 'r':
        vida_chao(img, rd, area, topo, var, peca, T, grama)
    else:
        morte_chao(img, rd, area, topo, var, peca)
    return img


def vida_chao(img, rng, area, topo, var, peca, T, grama):
    flores = [C(T['r']['luz']), C('#48d9a8'), C(EXTRA[area]['flor3'])]
    cols = [x for x in range(2, CW - 2) if topo[x] >= 0]
    # capim baixo em toda a largura (coluna a coluna: encaixa entre pedaços)
    for x in cols:
        if rng.random() < .45:
            for j in range(int(rng.integers(1, 4))):
                px(img, x, topo[x] - 2 - j, grama[min(5, 3 + j)])
    meio = [x for x in cols if 8 <= x <= CW - 9]
    if not meio:
        meio = cols
    x1 = int(rng.choice(meio))
    y1 = topo[x1] - 2
    if area == 'raizes':
        samambaia(img, rng, x1, y1, grama, rng.uniform(7, 9))
        cogumelo(img, int(rng.choice(cols)), rng, topo, ['#5a3a2a', '#b07050', '#e0a080'])
        if var != 1:
            caramujo(img, int(rng.choice(meio)), topo)
    elif area == 'varzea':
        aguape(img, rng, x1, y1, grama)
        junco_baixo(img, rng, int(rng.choice(cols)), topo, grama)
        if var != 2:
            sapo(img, int(rng.choice(meio)), topo)
    elif area == 'clareira':
        broto(img, x1, y1 + 1, grama)
        samambaia(img, rng, int(rng.choice(meio)), y1, grama, 6)
        if var == 0:
            borboleta(img, x1 + 3, y1 - 9, '#f0a050')
        elif var == 2:
            joaninha(img, int(rng.choice(cols)), topo)
    elif area == 'dossel':
        bromelia(img, rng, x1, y1, grama, C('#d84860'))
        samambaia(img, rng, int(rng.choice(meio)), y1, grama, 6.5)
        if var != 0:
            besouro(img, int(rng.choice(meio)), topo)
    elif area == 'coracao':
        samambaia(img, rng, x1, y1, grama, 7.5)
        cogumelo(img, int(rng.choice(cols)), rng, topo, ['#1a5a54', '#48d9a8', '#b8f8e0'])
        vagalume(img, int(rng.integers(6, CW - 6)), int(rng.integers(3, 9)))
        if var == 1:
            vagalume(img, int(rng.integers(6, CW - 6)), int(rng.integers(2, 7)))
    for x in rng.choice(cols, 2 + (var == 2), replace=False):
        flor(img, x, topo[x] - 3 - int(rng.integers(0, 2)), flores[int(rng.integers(0, 3))], rng)


def morte_chao(img, rng, area, topo, var, peca):
    cols = [x for x in range(2, CW - 2) if topo[x] >= 0]
    meio = [x for x in cols if 8 <= x <= CW - 9] or cols
    if area == 'raizes':
        for x in cols:
            if rng.random() < .35:
                px(img, x, topo[x], '#7a828e' if rng.random() < .5 else '#5e6672')
        for x in rng.choice(cols, 2, replace=False):
            px(img, x, topo[x] - 1, '#6b6040')
            px(img, x + 1, topo[x] - 1, '#4e4630')
    elif area == 'varzea':
        for x in cols:
            px(img, x, topo[x], '#0b0d0a')
            px(img, x, topo[x] + 1, '#171a14' if x % 4 else '#0b0d0a')
            if rng.random() < .12:
                px(img, x, topo[x], '#4a3a5a' if rng.random() < .5 else '#3a5a4a')
        x = int(rng.choice(meio))
        y = topo[x] - 1
        if var == 0:      # latinha
            for dx, dy, c in ((0, 0, '#8a8e90'), (1, 0, '#a8acae'), (2, 0, '#6a6e70'),
                              (0, -1, '#a8acae'), (1, -1, '#c4c8ca'), (2, -1, '#8a8e90')):
                px(img, x + dx, y + dy, c)
        elif var == 1:    # garrafa deitada
            for dx in range(5):
                px(img, x + dx, y, '#5a7a6a' if dx < 4 else '#3a4a40')
                px(img, x + dx, y - 1, '#7a9a88' if dx < 3 else '#5a7a6a')
        else:             # saco plástico murcho
            for dx, dy in ((0, 0), (1, 0), (2, 0), (3, 0), (1, -1), (2, -1), (2, -2)):
                px(img, x + dx, y + dy, '#a8aca0' if (dx + dy) % 2 else '#8a8e84')
    elif area == 'clareira':
        for x in cols:
            px(img, x, topo[x], '#3a302a' if rng.random() < .6 else '#5a4c40')
        H = img.shape[0]
        for _ in range(7):
            x = int(rng.choice(cols))
            y = topo[x] + int(rng.integers(1, 7))
            if y < H and img[y, x, 3]:
                px(img, x, y, '#d2521c' if rng.random() < .7 else '#ff9a40')
        for x in rng.choice(cols, 3, replace=False):
            px(img, x, topo[x] - 1, '#1a120c')
    elif area == 'dossel':
        for x in cols:
            if rng.random() < .5:
                px(img, x, topo[x], '#8a9098' if rng.random() < .5 else '#a4aab2')
        if var == 2:      # toquinho serrado
            x = int(rng.choice(meio))
            for dx in range(5):
                for dy in range(1, 4):
                    px(img, x + dx, topo[x] - dy, RAIZ_COR[1 + (dx < 2)])
                px(img, x + dx, topo[x] - 4, '#c8bea0' if dx % 2 else '#9a8e70')
    elif area == 'coracao':
        xs = int(rng.choice(meio))
        for x in range(max(2, xs - 5), min(CW - 2, xs + 5)):
            if topo[x] >= 0:
                px(img, x, topo[x], '#5a1e7a' if x % 3 else '#b03aa0')
        if var != 1:      # caco de cristal tóxico brotando
            x = int(rng.choice(meio))
            for j in range(1, 5):
                px(img, x, topo[x] - j, '#9a3ac8' if j < 4 else '#f4c0ff')
                if j < 3:
                    px(img, x + 1, topo[x] - j, '#5a1e7a')


# ------------- bichos e plantas miúdas
def cogumelo(img, x, rng, topo, cores):
    y = topo[x] - 2
    px(img, x, y, '#d8d0c0')
    px(img, x, y - 1, '#d8d0c0')
    for dx in (-1, 0, 1):
        px(img, x + dx, y - 2, cores[1])
    px(img, x, y - 3, cores[2])
    px(img, x + 1, y - 2, cores[0])


def caramujo(img, x, topo):
    y = topo[x] - 2
    for dx, c in ((-1, '#a8a08a'), (0, '#a8a08a'), (1, '#a8a08a'), (2, '#a8a08a'), (3, '#c8c0a8')):
        px(img, x + dx, y, c)
    px(img, x + 3, y - 1, '#c8c0a8')
    for dx, dy, c in ((0, -1, '#8a5a3a'), (1, -1, '#b07a4a'), (0, -2, '#b07a4a'), (1, -2, '#5a3420')):
        px(img, x + dx, y + dy, c)


def sapo(img, x, topo):
    y = topo[x] - 2
    for dx, dy, c in ((0, 0, '#2a6a2a'), (1, 0, '#3a8a32'), (2, 0, '#3a8a32'), (3, 0, '#2a6a2a'),
                      (1, -1, '#4aa03a'), (2, -1, '#4aa03a'), (2, -2, '#f0e080'), (0, -1, '#3a8a32')):
        px(img, x + dx, y + dy, c)


def borboleta(img, x, y, cor):
    px(img, x, y, '#2a1a10')
    px(img, x, y + 1, '#2a1a10')
    for dx in (-1, 1):
        px(img, x + dx, y, cor)
        px(img, x + 2 * dx, y - 1, cor)
        px(img, x + dx, y + 1, mix(cor, '#000000', .25))


def joaninha(img, x, topo):
    y = topo[x] - 2
    px(img, x, y, '#c83a2a')
    px(img, x + 1, y, '#e04a34')
    px(img, x + 2, y, '#1a1010')
    px(img, x + 1, y - 1, '#c83a2a')
    px(img, x, y - 1, '#1a1010')


def besouro(img, x, topo):
    y = topo[x] - 2
    for dx, dy, c in ((0, 0, '#1a3a34'), (1, 0, '#2a6a5a'), (2, 0, '#1a3a34'), (3, 0, '#0e1a18'),
                      (1, -1, '#4ac0a0'), (2, -1, '#2a6a5a')):
        px(img, x + dx, y + dy, c)


def vagalume(img, x, y):
    px(img, x, y, '#f0f8a0')
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        px(img, x + dx, y + dy, '#5a7a3a')


def aguape(img, rng, x, y, grama):
    for dx, dy in ((-2, 0), (-1, -1), (1, -1), (2, 0), (0, -1), (-1, 0), (1, 0), (0, 0)):
        px(img, x + dx, y + dy, grama[3 if dy else 2])
    px(img, x - 1, y - 1, grama[4])
    for j in range(2, 6):
        px(img, x, y - j, grama[2] if j < 4 else '#b090e0')
    px(img, x + 1, y - 5, '#d0b8f0')
    px(img, x - 1, y - 4, '#9070c8')


def junco_baixo(img, rng, x, topo, grama):
    y = topo[x] - 2
    for k in range(3):
        a = (k - 1) * .25 + rng.uniform(-.1, .1)
        fx = x + k - 1
        for j in range(int(rng.integers(5, 9))):
            px(img, fx + math.sin(a) * j * .5, y - j, grama[3 if j < 4 else 4])


# ---------------------------------------------------------- montanhas
# Faixas de fundo pro parallax: 4 camadas por área (1 = perto .. 4 = longe),
# cada uma emendável nas laterais (período = largura). Perspectiva
# atmosférica em quatro frentes ao mesmo tempo (ARQUITETURA, princípio 2):
# a camada longe sobe no céu, perde contraste, perde detalhe (tufo menor,
# menos tons) e é comida por uma bruma AZULADA — a cor sai da `bruma` do tema
# puxada pro azul. A névoa também sobe do pé de cada camada, em faixas
# (posterizada) pra continuar pixel art.

FW, FH = 256, 128
NEVOA = [.10, .30, .50, .68]       # quanto cada camada mistura com a bruma
CONTRASTE = [1.0, .8, .6, .45]
TOPO_CAMADA = [62, 46, 30, 16]     # y aproximado dos picos
TUFO = [5, 4, 4, 3]                # célula do Voronoi (copa) por camada
ESCURO = [.52, .66, .82, 1.0]      # a frente é a mais escura (escada de valor)


def voronoi_faixa(rng, W, H, esp):
    """Voronoi periódico só em x (grade com jitter, vizinhança 3x3)."""
    gw = max(1, round(W / esp))
    cel = W / gw
    gh = int(H / cel) + 3
    jit = rng.random((gh, gw, 2))
    yy, xx = np.mgrid[0:H, 0:W] + .5
    cx, cy = np.floor(xx / cel).astype(int), np.floor(yy / cel).astype(int)
    d1 = np.full((H, W), 1e9)
    d2 = np.full((H, W), 1e9)
    bdx, bdy = np.zeros((H, W)), np.zeros((H, W))
    bid = np.zeros((H, W), int)
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            gx, gy = cx + ox, np.clip(cy + oy, 0, gh - 1)
            j = jit[gy, gx % gw]
            sx, sy = (gx + j[..., 0]) * cel, (gy + j[..., 1] * .9) * cel
            dx, dy = xx - sx, yy - sy
            d = np.hypot(dx, dy)
            menor = d < d1
            d2 = np.where(menor, d1, np.minimum(d2, d))
            bdx, bdy = np.where(menor, dx, bdx), np.where(menor, dy, bdy)
            bid = np.where(menor, gy * gw + gx % gw, bid)
            d1 = np.where(menor, d, d1)
    local = np.clip(-(bdx * .45 + bdy * .9) / (cel * .7), -1, 1)
    return local, (d2 - d1) < 1.0, bid


def harmonicos(rng, W, kmin, kmax, exp=1.2):
    x = np.arange(W)
    h = np.zeros(W)
    for k in range(kmin, kmax + 1):
        h += rng.normal() * k ** -exp * np.sin(2 * np.pi * k * x / W + rng.uniform(0, 6.28))
    return h / (np.abs(h).max() or 1)


def perfil_montanha(rng, d, area):
    """Picos sobrepostos de trás pra frente: cada pixel pertence a UM pico
    (o da frente que o cobre), então a emenda entre dois morros segue a
    encosta do da frente, nunca uma reta vertical."""
    n = int(rng.integers(3, 5)) + d
    xs = (np.arange(n) + rng.uniform(-.3, .3, n)) * FW / n
    base = TOPO_CAMADA[d]
    yy, xx = np.mgrid[0:FH, 0:FW]
    redondo = area == 'varzea'
    picos = []
    for xi in xs:
        yp = base + rng.uniform(0, 22)
        s = rng.uniform(.45, .85) if not redondo else rng.uniform(.006, .012)
        if area == 'coracao':
            s *= 1.25
        picos.append((xi, yp, s))
    picos.sort(key=lambda p: p[1])           # mais alto atrás, mais baixo na frente
    dono_dx = np.zeros((FH, FW))
    dono_yp = np.zeros((FH, FW))
    corpo = vazio(FH, FW)
    aresta = vazio(FH, FW)
    for xi, yp, s in picos:
        dx = (np.arange(FW) - xi + FW / 2) % FW - FW / 2
        y = yp + (np.abs(dx) * s if not redondo else dx * dx * s)
        y = y + harmonicos(rng, FW, 6, 30) * (2 + d * .3) + harmonicos(rng, FW, 31, 60) * 1.2
        y = np.maximum(y, 4)
        m = yy >= y[None, :]
        topo_m = m & ~desloca(m, 1, 0)
        aresta = (aresta & ~m) | (topo_m & corpo)        # crista do da frente sobre o de trás
        corpo |= m
        dono_dx = np.where(m, dx[None, :], dono_dx)
        dono_yp = np.where(m, yp, dono_yp)
    topo = colunas_topo(corpo)
    return topo, corpo, dono_dx, dono_yp, aresta


def desenhar_montanha(area, d, estado, T):
    seed = NOMES.index(area) * 100 + d * 19 + 3001
    rf = np.random.default_rng(seed)
    rd = np.random.default_rng(seed + (1 if estado == 'p' else 2) * 7919)
    tema = T[estado]
    yy, xx = np.mgrid[0:FH, 0:FW]
    topo, corpo, dono_dx, dono_yp, aresta = perfil_montanha(rf, d, area)

    # face iluminada (esquerda do cume) x sombra: a aresta desce INCLINADA do
    # cume, tremida, e a diferença entre as faces se dilui perto do pé
    tremor = harmonicos(rf, FH, 3, 14)[:, None] * 2.5
    lit = (dono_dx - (yy - dono_yp) * .42 + tremor) < 0
    face = np.where(lit, 1.0, -1.0) * np.exp(-np.clip(yy - topo[None, :], 0, None) / 38)
    local, costura, celula = voronoi_faixa(rf, FW, FH, TUFO[d])
    sorteio_cel = np.random.default_rng(seed + 77).random(celula.max() + 1)[celula]
    sulcos = (np.sin((xx * .9 + yy * 1.6 + harmonicos(rf, FW, 2, 8)[None, :] * 9) * .35) > .82)

    floresta = estado == 'r'
    if floresta:
        c = T['r']['crista']
        ramp = rampa([T['r']['terrenoFundo'], mix('#0e2c18', c, .15), mix('#18461e', c, .15),
                      mix('#286a24', c, .12), mix('#3e8a2c', c, .1), mix('#62aa3c', c, .08)], 6)
        # tons vizinhos: copa amarelada e copa funda, sorteados por tufo
        ramp_am = rampa([T['r']['terrenoFundo'], '#1c3414', '#324e1a', '#4e6e22', '#6e8c2c', '#94ac40'], 6)
        ramp_fu = rampa([T['r']['terrenoFundo'], '#0a2420', '#123a30', '#1c5040', '#2c6a50', '#448a64'], 6)
        v = .5 + face * .16 + local * .2 - costura * .14
        # pico alto e íngreme fica de rocha mesmo restaurado
        rocha = corpo & (yy < topo[None, :] + 6) & (topo[None, :] < TOPO_CAMADA[d] + 6) & (area != 'varzea')
    else:
        p = T['p']
        ramp = rampa([p['borda'], p['terreno'], mix(p['terreno'], p['crista'], .35),
                      mix(p['terreno'], p['crista'], .6), p['crista'], mix(p['crista'], p['luz'], .15)], 6)
        if area == 'clareira':
            ramp = rampa(['#0a0605', '#1c120e', '#2e2019', '#443026', '#5c4434', '#76584a'], 6)
        v = .5 + face * .2 + local * .1 - sulcos * (~lit) * .12 - costura * .08
        rocha = vazio(FH, FW)
    v += (corpo & ~desloca(corpo, 1, 0)) * lit * .2          # luz na crista
    v += aresta * np.where(lit, .14, -.1)                     # crista do morro da frente
    v = .5 + (v - .5) * CONTRASTE[d]
    img = np.zeros((FH, FW, 4), np.uint8)
    aplicar(img, corpo, ramp, v)
    if floresta:
        aplicar(img, corpo & (sorteio_cel < .2), ramp_am, v)
        aplicar(img, corpo & (sorteio_cel > .84), ramp_fu, v)
    if rocha.any():
        r_ramp = rampa([T['r']['borda'], T['r']['terreno'], mix(T['r']['terreno'], T['r']['crista'], .4),
                        mix(T['r']['crista'], '#9aa4a0', .4), mix(T['r']['luz'], '#9aa4a0', .4)], 5)
        rv = .5 + face * .2
        aplicar(img, rocha & (rf.random((FH, FW)) > .2 + (yy - topo[None, :]) * .12), r_ramp,
                .5 + (rv - .5) * CONTRASTE[d])

    def pxw(x, y, cor):
        px(img, int(round(x)) % FW, y, cor)

    # --------- silhueta do topo: copa (restaurado) ou paus secos (poluído)
    if floresta and d < 3:
        R = [3.2, 2.4, 1.7][d]
        cop = vazio(FH, FW)
        x = 0.0
        while x < FW:
            y = topo[int(x) % FW]
            if not rocha[min(FH - 1, y + 1), int(x) % FW]:
                for off in (-FW, 0, FW):
                    circulo(cop, x + off, y + R * .5, R * rf.uniform(.8, 1.2))
            x += rf.uniform(R * .9, R * 1.8)
        cop &= ~corpo
        vc = .62 + local * .3
        aplicar(img, cop, ramp, .5 + (vc - .5) * CONTRASTE[d])
        corpo = corpo | cop
    elif not floresta and d < 2:
        for x in range(FW):
            if rf.random() < [.10, .06][d]:
                h = int(rf.integers(2, [7, 4][d]))
                for j in range(1, h):
                    pxw(x, topo[x] - j, ramp[1])
                if h > 3:
                    pxw(x + 1, topo[x] - h + 2, ramp[1])

    # --------- extras por área (sempre com x periódico)
    cols = np.arange(FW)
    if area == 'varzea' and d < 2:
        agua = yy >= FH - [16, 10][d]
        if floresta:
            aramp = rampa(['#0a2a34', '#14404a', '#22606a', '#4a9aa0', '#a8e0d8'], 5)
        else:
            aramp = rampa(['#14120c', '#24200f', '#38321c', '#5a5030', '#7a6e48'], 5)
        av = .45 + ruido2(rf, FH, FW, 8, 1) * .3 + ((yy % 3) == 0) * .15
        aplicar(img, agua, aramp, av)
        for x in range(0, FW, 3):
            if rf.random() < .25:
                y = int(rf.integers(FH - [16, 10][d] + 1, FH))
                pxw(x, y, aramp[4] if floresta else '#4a3a5a')
                pxw(x + 1, y, aramp[3] if floresta else '#3a5a4a')
        corpo = corpo | agua
    if area == 'clareira' and not floresta:
        if d >= 2:      # linha de fogo abafada no horizonte (sem núcleo claro)
            fogo = harmonicos(rf, FW, 2, 6) > .1
            for x in cols[fogo]:
                pxw(x, topo[x], '#a8381a' if x % 3 else '#c8501e')
                if rf.random() < .5:
                    pxw(x, topo[x] - 1, '#7a2a14')
        if d in (1, 2):  # colunas de fumaça
            for _ in range(2):
                x0 = rf.uniform(0, FW)
                y = topo[int(x0) % FW]
                fum = vazio(FH, FW)
                for k in range(12):
                    rr = 1.5 + k * 1.05
                    for off in (-FW, 0, FW):
                        circulo(fum, x0 + k * k * .22 + off, y - k * 2.6, rr)
                        circulo(fum, x0 + k * k * .22 + rr * .7 + off, y - k * 2.6 + rr * .4, rr * .7)
                # borda esgarçada: a fumaça se desfaz, não termina em bola
                fum &= (yy < y + 2) & ~((ruido2(rf, FH, FW, 2) < -.12) & ~(caixa(caixa(fum.astype(float), 2), 2) > .97))
                fv = .4 + valor(fum, 2) * .5 + ruido2(rf, FH, FW, 3) * .2
                aplicar(img, fum & (img[..., 3] == 0) | fum & ~corpo,
                        rampa(['#2a2220', '#3a302c', '#4e4440', '#665a54'], 4), fv)
                corpo = corpo | fum
    if area == 'clareira' and floresta and d < 2:
        for _ in range([40, 22][d]):
            x = int(rf.integers(0, FW))
            y = topo[x] + int(rf.integers(0, 8))
            pxw(x, y, '#e890b0' if rf.random() < .5 else '#f0c860')
    if area == 'dossel' and not floresta and d < 2:      # corte raso nas encostas
        for _ in range([3, 2][d]):
            x0, y0 = rf.uniform(0, FW), 0
            w, h = rf.uniform(14, 26), rf.uniform(8, 16)
            y0 = topo[int(x0) % FW] + rf.uniform(4, 10)
            for y in range(int(y0), int(min(FH, y0 + h))):
                sh = (y - y0) * .4
                for x in range(int(x0 + sh), int(x0 + w + sh)):
                    if corpo[y, x % FW]:
                        pxw(x, y, '#5a4630' if (x + y) % 5 else '#3a2c1e')
                        if (x * 7 + y * 3) % 11 == 0:
                            pxw(x, y, '#2a1e14')
    if area == 'dossel' and floresta and d < 2:          # emergentes acima da copa
        for _ in range([5, 4][d]):
            x = int(rf.integers(0, FW))
            hgt = [9, 6][d]
            y = topo[x]
            for j in range(hgt):
                pxw(x, y - j, ramp[1])
            em = vazio(FH, FW)
            for off in (-FW, 0, FW):
                circulo(em, x + off, y - hgt, [3.5, 2.5][d])
                circulo(em, x + off + 2, y - hgt + 1, [2.6, 1.8][d])
            em &= (img[..., 3] == 0) | ~corpo
            aplicar(img, em, ramp, .5 + (.6 + local * .3 - .5) * CONTRASTE[d])
            corpo = corpo | em
    if area == 'coracao' and d < 3:
        cor = ['#5a1e7a', '#b03aa0'] if not floresta else ['#1a5a54', '#3aa890']
        for _ in range([5, 4, 3][d]):
            x = rf.uniform(0, FW)
            y = topo[int(x) % FW] + 2
            for j in range(int(rf.integers(8, 20))):
                pxw(x, y, cor[j % 4 == 0])
                x += rf.choice([-1, 0, 1])
                y += 1
                if y >= FH:
                    break
        if not floresta:
            for i in range(FW):
                if i % 37 == 5:
                    for j in range(1, [6, 4, 3][d]):
                        pxw(i, topo[i] - j, '#7e3aa4' if j < 3 else '#c65de8')
    if area == 'raizes' and floresta and d == 1:          # cachoeira
        x = int(rf.integers(0, FW))
        y0 = topo[x] + 2
        for y in range(y0, FH):
            pxw(x, y, '#c8e8e8' if y % 3 else '#8ab8c0')
            pxw(x + 1, y, '#8ab8c0')
        for dx in range(-2, 4):
            pxw(x + dx, FH - 1, '#e0f4f0')
    if area == 'raizes' and not floresta and d < 2:       # manchas de cinza
        for y, x in np.argwhere(corpo & lit & (ruido2(rf, FH, FW, 6) > .3) & (rf.random((FH, FW)) < .25)):
            pxw(x, y, '#6a7280')

    # --------- árvores soltas: na encosta e furando a linha da copa
    if d < 3:
        n_arv = [34, 44, 54][d] if floresta else [16, 20, 0][d]
        R0 = [3.6, 2.6, 1.8][d]
        floridas = [C(EXTRA[area]['flor3']), C(T['r']['luz']), C('#f0c860'), C('#c890e0')]
        arvs = []
        for _ in range(n_arv):
            x = rf.uniform(0, FW)
            xi = int(x) % FW
            borda_arv = rf.random() < .35
            y = topo[xi] - (R0 * rf.uniform(.6, 1.3) if borda_arv else -rf.uniform(2, 34 - d * 8))
            arvs.append((y, x, borda_arv))
        arvs.sort()
        for y, x, borda_arv in arvs:
            xi = int(x) % FW
            if floresta:
                if area == 'varzea' and borda_arv and rf.random() < .5:      # buriti
                    hgt = int(R0 * 3)
                    for j in range(hgt):
                        pxw(x, topo[xi] - j, ramp[1])
                    for a in (-1.2, -.6, 0, .6, 1.2):
                        for j in range(1, int(R0 + 1)):
                            pxw(x + math.sin(a) * j, topo[xi] - hgt - math.cos(a) * j * .6 + (j * j * .08),
                                ramp[3 if a < 0 else 2])
                    continue
                R = R0 * rf.uniform(.8, 1.35)
                if borda_arv:
                    for j in range(int(topo[xi] - y) + 1):
                        pxw(x, topo[xi] - j, ramp[1])
                rr = ramp
                if rf.random() < .14:
                    fc = floridas[int(rf.integers(0, 4))]
                    rr = rampa([mix(fc, '#000000', .75), mix(fc, '#000000', .5), mix(fc, '#000000', .3),
                                mix(fc, '#000000', .12), fc, mix(fc, '#ffffff', .25)], 6)
                elif rf.random() < .3:
                    rr = ramp_am if rf.random() < .5 else ramp_fu
                yy2, xx2 = np.mgrid[0:FH, 0:FW] + .5
                m = vazio(FH, FW)
                loc = np.zeros((FH, FW))
                for off in (-FW, 0, FW):
                    dd = np.hypot(xx2 - x - off, yy2 - y)
                    th = np.arctan2(yy2 - y, xx2 - x - off)
                    dentro = dd <= R + .5 * np.sin(th * 5 + x)
                    m |= dentro
                    loc = np.where(dentro, -((xx2 - x - off) * .45 + (yy2 - y) * .9) / R, loc)
                sombra = (desloca(m, 1, 0) | desloca(m, 1, 1)) & ~m & (img[..., 3] > 0)
                img[sombra, :3] = rr[1]
                aplicar(img, m, rr, .5 + ((.52 + loc * .38) - .5) * CONTRASTE[d])
                corpo = corpo | m
            else:                                                   # árvore morta
                if not borda_arv:
                    continue
                hgt = int(R0 * rf.uniform(2, 3.4))
                for j in range(hgt):
                    pxw(x, topo[xi] - j, ramp[1])
                    if d == 0 and j < hgt // 2:
                        pxw(x + 1, topo[xi] - j, ramp[0])
                for k in range(int(rf.integers(2, 4))):
                    j0 = int(hgt * rf.uniform(.45, .9))
                    sgn = rf.choice([-1, 1])
                    for j in range(1, int(R0) + 1):
                        pxw(x + sgn * j, topo[xi] - j0 - j // 2, ramp[1])

    # --------- bruma azulada: camada inteira + névoa subindo do pé, em faixas
    img[..., :3] = (img[..., :3] * ESCURO[d]).astype(np.uint8)
    bruma = mix(tema.get('bruma', tema['ceuBase']), '#6c86b4', .6)
    pe = np.clip((yy - (topo[None, :] + 26 - d * 4)) / 70, 0, 1) * .4
    f = np.clip(NEVOA[d] + pe * (d > 0) + pe * .5 * (d == 0), 0, .92)
    f = np.round(f * 10) / 10
    tem = img[..., 3] > 0
    rgb = img[..., :3].astype(float)
    rgb = rgb * (1 - f[..., None]) + bruma[None, None, :] * f[..., None]
    img[..., :3] = np.where(tem[..., None], np.clip(rgb, 0, 255), img[..., :3]).astype(np.uint8)
    return img


# -------------------------------------------------------------- saída
def salvar(arr, caminho):
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    Image.fromarray(arr).save(caminho)


def gradiente(w, h, a, b):
    t = np.linspace(0, 1, h)[:, None, None]
    g = C(a)[None, None, :] * (1 - t) + C(b)[None, None, :] * t
    return np.repeat(g, w, 1)


def painel(T, estado, arvs, plats):
    M = 6
    w = 5 * AW + 6 * M
    h = AH + PH + 3 * M
    tema = T[estado]
    fundo = gradiente(w, h, tema['ceuTopo'], mix(tema['ceuTopo'], tema['ceuBase'], .55))
    im = Image.fromarray(fundo.astype(np.uint8)).convert('RGBA')
    grade = np.zeros((h, w, 4), np.uint8)
    for i in range(5):
        for (x, y, cw, ch) in ((M + i * (AW + M), M, AW, AH), (M + i * (AW + M) + (AW - PW) // 2, 2 * M + AH, PW, PH)):
            for xx in range(x, x + cw, 2):
                grade[y, xx] = grade[y + ch - 1, xx] = (255, 255, 255, 28)
            for yy in range(y, y + ch, 2):
                grade[yy, x] = grade[yy, x + cw - 1] = (255, 255, 255, 28)
    im = Image.alpha_composite(im, Image.fromarray(grade))
    for i in range(5):
        im.alpha_composite(Image.fromarray(arvs[i]), (M + i * (AW + M), M))
        im.alpha_composite(Image.fromarray(plats[i]), (M + i * (AW + M) + (AW - PW) // 2, 2 * M + AH))
    return im


def main():
    T = ler_paleta()
    previas = []
    for area in NOMES:
        tipos_arv = ARVORES + [EXTRA[area]['arv5']]
        arvs = {e: [] for e in 'pr'}
        plats = {e: [] for e in 'pr'}
        for e, nome_e in (('p', 'poluida'), ('r', 'restaurada')):
            for i, tipo in enumerate(tipos_arv):
                a = desenhar_arvore(area, i, tipo, e, T[area])
                arvs[e].append(a)
                salvar(a, os.path.join(SAIDA, area, f'arvore-{i + 1}-{tipo}-{nome_e}.png'))
            for k in range(5):
                p = desenhar_plataforma(area, k, e, T[area])
                plats[e].append(p)
                salvar(p, os.path.join(SAIDA, area, f'plataforma-{k + 1}-{nome_e}.png'))
        folha_a = np.zeros((AH * 2, AW * 5, 4), np.uint8)
        folha_p = np.zeros((PH * 2, PW * 5, 4), np.uint8)
        for r, e in enumerate('pr'):
            for i in range(5):
                folha_a[r * AH:(r + 1) * AH, i * AW:(i + 1) * AW] = arvs[e][i]
                folha_p[r * PH:(r + 1) * PH, i * PW:(i + 1) * PW] = plats[e][i]
        salvar(folha_a, os.path.join(SAIDA, area, 'arvores.png'))
        salvar(folha_p, os.path.join(SAIDA, area, 'plataformas.png'))
        folha_c = np.zeros((PH * 2, PW * 3, 4), np.uint8)
        for r, (e, nome_e) in enumerate((('p', 'poluida'), ('r', 'restaurada'))):
            for k in range(3):
                c = desenhar_caverna(area, k, e, T[area])
                folha_c[r * PH:(r + 1) * PH, k * PW:(k + 1) * PW] = c
                salvar(c, os.path.join(SAIDA, area, f'caverna-{k + 1}-{nome_e}.png'))
        salvar(folha_c, os.path.join(SAIDA, area, 'cavernas.png'))
        # chão em pedaços: folha com 5 pedaços de topo (esq, meio1-3, dir) e
        # 3 de preenchimento (esq, miolo, dir); linha 0 poluído, 1 restaurado
        topo_p = [('esq', 0), ('meio', 0), ('meio', 1), ('meio', 2), ('dir', 0)]
        fill_p = [('fill-esq', 0), ('fill', 0), ('fill', 1), ('fill', 2), ('fill-dir', 0)]
        folha_t = np.zeros((CH * 2, CW * 5, 4), np.uint8)
        folha_f = np.zeros((CF * 2, CW * 5, 4), np.uint8)
        for r, (e, nome_e) in enumerate((('p', 'poluido'), ('r', 'restaurado'))):
            for i, (pc, var) in enumerate(topo_p):
                c = desenhar_chao(area, pc, var, e, T[area])
                folha_t[r * CH:(r + 1) * CH, i * CW:(i + 1) * CW] = c
                nome = f'meio-{var + 1}' if pc == 'meio' else f'borda-{pc}'
                salvar(c, os.path.join(SAIDA, area, 'chao', f'{nome}-{nome_e}.png'))
            for i, (pc, var) in enumerate(fill_p):
                c = desenhar_chao(area, pc, var, e, T[area])
                folha_f[r * CF:(r + 1) * CF, i * CW:(i + 1) * CW] = c
                nome = {'fill': f'preenchimento-{var + 1}', 'fill-esq': 'preenchimento-esq',
                        'fill-dir': 'preenchimento-dir'}[pc]
                salvar(c, os.path.join(SAIDA, area, 'chao', f'{nome}-{nome_e}.png'))
        salvar(folha_t, os.path.join(SAIDA, area, 'chao.png'))
        salvar(folha_f, os.path.join(SAIDA, area, 'chao-preenchimento.png'))
        # montanhas de fundo: 4 camadas (1 perto .. 4 longe); linha 0 poluída
        folha_m = np.zeros((FH * 2, FW * 4, 4), np.uint8)
        for r, (e, nome_e) in enumerate((('p', 'poluida'), ('r', 'restaurada'))):
            for dd in range(4):
                c = desenhar_montanha(area, dd, e, T[area])
                folha_m[r * FH:(r + 1) * FH, dd * FW:(dd + 1) * FW] = c
                salvar(c, os.path.join(SAIDA, area, 'montanhas', f'camada-{dd + 1}-{nome_e}.png'))
        salvar(folha_m, os.path.join(SAIDA, area, 'montanhas.png'))
        pp, pr = painel(T[area], 'p', arvs['p'], plats['p']), painel(T[area], 'r', arvs['r'], plats['r'])
        junto = Image.new('RGBA', (pp.width * 2 + 4, pp.height), (10, 10, 12, 255))
        junto.paste(pp, (0, 0))
        junto.paste(pr, (pp.width + 4, 0))
        previas.append(junto)
        os.makedirs(os.path.join(SAIDA, '_previa'), exist_ok=True)
        junto.resize((junto.width * 3, junto.height * 3), Image.NEAREST).save(
            os.path.join(SAIDA, '_previa', f'{area}.png'))
        print('ok', area)
    W = previas[0].width
    tudo = Image.new('RGBA', (W, sum(p.height + 4 for p in previas)), (10, 10, 12, 255))
    y = 0
    for p in previas:
        tudo.paste(p, (0, y))
        y += p.height + 4
    tudo.resize((tudo.width * 2, tudo.height * 2), Image.NEAREST).save(os.path.join(SAIDA, '_previa', 'todas.png'))


if __name__ == '__main__':
    main()
