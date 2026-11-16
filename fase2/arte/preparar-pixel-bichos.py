"""Gera os animais da Fase 2 em PIXEL ART (proposta, ainda fora do jogo).

Uso:  python fase2/arte/preparar-pixel-bichos.py
Grava fase2/arte/pixel/bichos/<bicho>.png + .json (uma linha por animação)
      fase2/arte/pixel/_previa/bichos.png

Referência: as silhuetas de fase2/arte/bichos/ e as espécies que o jogo usa
(render/catastrofe.js: veado, capivara e tamanduá fugindo no horizonte;
render/fauna.js: aves pousadas e urubus; render/bichos.js: fauna parada da
sala restaurada e os pendurados). Mesma técnica do Guardião: esqueleto de
partes + poses, contorno escuro, luz de cima-esquerda.
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
elipse, poligono = pz.elipse, pz.poligono

SAIDA = os.path.join(AQUI, 'pixel', 'bichos')
CONT = C('#0a0806')


def r_(cores, n=5):
    return rampa(cores, n)


class Pintura:
    """Junta camadas (máscara + rampa) e pinta de trás pra frente."""

    def __init__(self, W, H):
        self.W, self.H = W, H
        self.camadas = []
        self.pixels = []

    def m(self):
        return vazio(self.H, self.W)

    def add(self, mask, ramp, k=3.5, base=.52, tex=None):
        self.camadas.append((mask, ramp, k, base, tex))

    def ponto(self, x, y, cor):
        self.pixels.append((x, y, cor))

    def render(self):
        img = np.zeros((self.H, self.W, 4), np.uint8)
        uniao = vazio(self.H, self.W)
        for mask, ramp, k, base, tex in self.camadas:
            v = valor(mask, 1, k=k, base=base)
            if tex is not None:
                v = v + tex
            aplicar(img, mask, ramp, v, dither=.3)
            uniao |= mask
        pp.contorno(img, uniao, CONT)
        for x, y, c in self.pixels:
            px(img, x, y, c)
        return img


# ------------------------------------------------------------ quadrúpedes
QUAD = {
    'veado': dict(W=48, H=40, corpo=(12.5, 5), perna=(7, 6.5), grossura=1.2, pescoco=(9, -1.25), cabeca=(4.5, 2.8),
                  focinho=2.5, orelha=3.2, cauda=(2.5, .6, 1.3), cor=['#2a170c', '#5a361c', '#8a5a30', '#b07a44', '#d4a46a'],
                  barriga='#e8d8b8', rabo_cor='#f0e8d8'),
    'capivara': dict(W=48, H=32, corpo=(16, 8), perna=(3, 2.5), grossura=2.0, pescoco=(1.5, -.3), cabeca=(6.5, 4.5),
                     focinho=1.5, orelha=1.5, cauda=None, cor=['#24160c', '#4a3018', '#704a28', '#946a3c', '#b08a58'],
                     barriga='#8a6a48'),
    'tamandua': dict(W=56, H=40, corpo=(16, 7), perna=(4, 3.5), grossura=1.8, pescoco=(5, -.15), cabeca=(3.5, 2.5),
                     focinho=8, orelha=1.2, cauda=(13, -2.6, 4.5), cor=['#1a1612', '#3a322a', '#5e5444', '#857860', '#a89a80'],
                     barriga='#3a3028', faixa=True),
    'quati': dict(W=40, H=32, corpo=(11, 4.5), perna=(3, 2.5), grossura=1.2, pescoco=(2, -.4), cabeca=(3.5, 2.6),
                  focinho=4, orelha=1.5, cauda=(11, .95, 1.6), cor=['#24120a', '#4e2a14', '#7a4422', '#a06234', '#c88a52'],
                  barriga='#d8b890', aneis=True),
    'tatu': dict(W=36, H=24, corpo=(10, 5.5), perna=(1.8, 1.5), grossura=1.3, pescoco=(1, .1), cabeca=(2.6, 2),
                 focinho=3, orelha=1.4, cauda=(6, 3.0, 1.2), cor=['#2a2018', '#544232', '#7e6a52', '#a8927a', '#c8b498'],
                 barriga='#9a8470', casco=True),
}


def quadrupede(nome, modo, f):
    P = QUAD[nome]
    W, H = P['W'], P['H']
    pin = Pintura(W, H)
    cor = r_(P['cor'])
    cor_t = r_([mix(c, '#000000', .3) for c in P['cor']])
    L, A = P['corpo']
    l1, l2 = P['perna']
    chao = H - 2
    ph = f * 2 * math.pi
    alt_perna = l1 + l2
    cy = chao - alt_perna - A * .6
    cx = W / 2 - 2
    inc = 0.0
    cab_ang = P['pescoco'][1]
    if modo == 'correr':
        cy += -abs(math.sin(ph)) * 2 + 1
        inc = .12 * math.sin(ph)
        cab_ang = P['pescoco'][1] + .55
    elif modo == 'pastar':
        cab_ang = 1.25
    elif modo == 'deitado':
        cy = chao - A * .9
    elif modo == 'andar':
        cy += -abs(math.sin(ph)) * .6
    # pernas (de trás pra frente: par de trás do lado de lá)
    pernas = [(-L + 4, 'tras', .0), (L - 4, 'frente', .0), (-L + 5.5, 'tras', math.pi), (L - 2.5, 'frente', math.pi)]
    for i, (dx, qual, off) in enumerate(pernas):
        lado_la = i < 2
        hx, hy = cx + dx, cy + A * .4 - math.sin(inc) * dx
        if modo == 'deitado':
            a1, a2 = (1.35, -1.6) if qual == 'frente' else (-1.2, 1.5)
            l1b, l2b = l1 * .8, l2 * .8
        else:
            l1b, l2b = l1, l2
            if modo == 'correr':
                s = math.sin(ph + (0 if qual == 'frente' else 1.4) + off * .15)
                a1 = s * .9 + (.25 if qual == 'frente' else -.25)
                a2 = a1 - (.9 * max(0, math.cos(ph + (0 if qual == 'frente' else 1.4))) if qual == 'frente' else -.7 * max(0, -s))
            elif modo == 'andar':
                s = math.sin(ph + off + (math.pi / 2 if qual == 'tras' else 0))
                a1 = s * .4
                a2 = a1 - .35 * max(0, math.cos(ph + off))
            else:
                a1, a2 = (.05, 0) if qual == 'frente' else (-.05, 0)
        jx, jy = hx + math.sin(a1) * l1b, hy + math.cos(a1) * l1b
        fx, fy = jx + math.sin(a2) * l2b, jy + math.cos(a2) * l2b
        m = pin.m()
        g = P['grossura']
        capsula(m, hx, hy, jx, jy, g * 1.3, g)
        capsula(m, jx, jy, fx, fy, g, g * .8)
        pin.add(m, cor_t if lado_la else cor, k=2)
    # cauda (atrás do corpo)
    if P['cauda']:
        cl, ca, cg = P['cauda']
        m = pin.m()
        x, y = cx - L + 1, cy - A * .2
        a = math.pi + ca + (.25 * math.sin(ph * 2) if modo == 'correr' else .08 * math.sin(ph))
        if nome == 'tamandua':
            a = math.pi + (.35 if modo == 'correr' else .55)
        n = 6
        for k in range(n):
            nx, ny = x + math.cos(a) * cl / n, y + math.sin(a) * cl / n
            r0 = cg * (1 - k / n * .3) if nome == 'tamandua' else cg * (1 - k / n * .5)
            capsula(m, x, y, nx, ny, r0, r0 * .9)
            x, y = nx, ny
            a += (-.1 if nome == 'quati' else .03)
        if P.get('aneis'):
            tex = np.zeros((H, W))
            yy, xx = np.mgrid[0:H, 0:W]
            tex -= (((xx + yy) // 2) % 2 == 0) * .45
            pin.add(m, cor, k=2, tex=tex)
        else:
            rc = r_([P['cor'][1], P['cor'][2], P.get('rabo_cor', P['cor'][3]), P.get('rabo_cor', P['cor'][4])], 4)
            pin.add(m, rc if nome == 'veado' else cor, k=2, tex=pp.ruido2(np.random.default_rng(3), H, W, 1, 3) * .3)
    # corpo
    m = pin.m()
    elipse(m, cx, cy, L, A, inc)
    elipse(m, cx + L * .55, cy - A * .15, A * 1.0, A * 1.05)     # peito
    elipse(m, cx - L * .55, cy - A * .1, A * 1.05, A)             # anca
    tex = None
    if P.get('casco'):
        yy, xx = np.mgrid[0:H, 0:W]
        tex = ((xx.astype(int) % 3) == 0) * -.25
        m &= ~((np.mgrid[0:H, 0:W][0] > cy + A * .65))
    pin.add(m, cor, tex=tex)
    if P.get('faixa'):        # faixa preta de borda clara, diagonal (tamanduá)
        fm = pin.m()
        poligono(fm, [(cx + L * .55, cy - A), (cx + L * .9, cy - A * .6), (cx - L * .2, cy + A * .55), (cx - L * .45, cy + A * .1)])
        fm &= m
        pin.add(fm, r_(['#060504', '#0e0c0a', '#1a1612', '#262018'], 4), k=1)
        borda = pin.m()
        poligono(borda, [(cx + L * .5, cy - A * 1.05), (cx + L * .95, cy - A * .7), (cx + L * .9, cy - A * .6), (cx + L * .55, cy - A)])
        pin.add(borda & m, r_(['#a8a090', '#d8d0c0', '#f0ece0'], 3), k=1)
    # pescoço e cabeça
    pl = P['pescoco'][0]
    nx0, ny0 = cx + L * .75, cy - A * (.6 if nome == 'veado' else .3)
    hx, hy = nx0 + math.cos(-math.pi / 2 + 1.0 + cab_ang) * pl, ny0 + math.sin(-math.pi / 2 + 1.0 + cab_ang) * pl
    if modo == 'deitado':
        hx, hy = nx0 + pl * .7, ny0 - pl * .4
    m = pin.m()
    capsula(m, nx0, ny0, hx, hy, A * .55, P['cabeca'][1] * .7)
    cl, ch = P['cabeca']
    elipse(m, hx + 1, hy, cl * .7, ch, cab_ang * .3)
    fa = cab_ang * .6 + (.6 if nome == 'tamandua' else .2)
    fx, fy = hx + 1 + math.cos(fa) * (cl * .5 + P['focinho']), hy + math.sin(fa) * (cl * .5 + P['focinho'])
    capsula(m, hx + 1, hy, fx, fy, ch * .75, max(.6, ch * .35 if nome in ('tamandua', 'quati', 'tatu') else ch * .6))
    pin.add(m, cor)
    # orelha
    m = pin.m()
    capsula(m, hx - 1, hy - ch * .6, hx - 2.5, hy - ch * .6 - P['orelha'], 1.1, .6)
    pin.add(m, cor_t, k=2)
    # olho e nariz
    pin.ponto(hx + 1.5, hy - ch * .2, '#060504')
    pin.ponto(fx, fy, '#120c08')
    if nome == 'veado' and modo != 'deitado':
        pin.ponto(nx0 + 1, ny0 + 2, '#e8d8b8')
    return pin.render()


# ------------------------------------------------------------------ aves
AVES = {
    'ave': dict(W=20, H=18, corpo=(4.2, 3.2), cab=2.4, bico=(2.2, .6, '#c8a050'), cauda=(4, .35),
                cor=['#1e140c', '#4a3220', '#7a5634', '#a07a50', '#c8a878'], peito='#c89060', asa_l=8),
    'urubu': dict(W=36, H=32, corpo=(7.5, 6), cab=2.6, bico=(2.6, 1.0, '#c8c0b0'), cauda=(6, .3),
                  cor=['#050505', '#0e0e10', '#1a1a1e', '#2a2a30', '#3c3c44'], peito=None, asa_l=17,
                  cabeca_cor=['#2a2624', '#4a4440', '#6a625c', '#8a8078'], ponta_asa='#9a9890'),
    'tucano': dict(W=28, H=28, corpo=(5, 4.5), cab=3.2, bico=(8, 2.8, '#f08a20'), cauda=(5, .1),
                   cor=['#040404', '#0c0c0e', '#18181c', '#26262c', '#363640'], peito='#f4f0d8', asa_l=11,
                   olho_aro='#4ac0e0'),
    'arara': dict(W=28, H=36, corpo=(4.8, 4.2), cab=3.0, bico=(3.2, 2.4, '#f0e8d8'), cauda=(13, .05),
                  cor=['#3a0806', '#7a1410', '#b82418', '#e04428', '#f88a58'], peito=None, asa_l=13,
                  asa_cor=['#0a1e4a', '#14408a', '#2a6ac8', '#e8c030', '#f8e070'], rosto='#f4ece0'),
    'coruja': dict(W=24, H=26, corpo=(5, 6.2), cab=4.6, bico=(1.2, .8, '#a89058'), cauda=(2, .2),
                   cor=['#1a120a', '#3e2c1a', '#6a5032', '#937552', '#bca07a'], peito='#c8b088', asa_l=10,
                   tufos=True, olhos_grandes=True),
    'beijaflor': dict(W=20, H=18, corpo=(3, 2), cab=1.8, bico=(5, .4, '#1a1a1a'), cauda=(3, .3),
                      cor=['#04201a', '#0a4a38', '#148a5a', '#30c080', '#80f0b0'], peito='#2a8ab8', asa_l=6),
}


def ave(nome, modo, f):
    P = AVES[nome]
    W, H = P['W'], P['H']
    pin = Pintura(W, H)
    cor = r_(P['cor'])
    L, A = P['corpo']
    pousada = modo in ('pousado', 'bicar', 'asas', 'piscar', 'virar')
    ph = f * 2 * math.pi
    cx = W / 2 - 1
    cy = H - 3 - A - (2 if pousada else 0) if pousada else H / 2 + 1
    inc = -.55 if pousada and nome not in ('coruja',) else 0
    if nome == 'coruja':
        inc = -1.4
    if nome in ('tucano', 'arara') and pousada:
        inc = -.9
    if modo == 'voar' or modo == 'pairar':
        inc = .05 if nome != 'beijaflor' else -.6
    # cauda
    m = pin.m()
    cl, ca = P['cauda']
    tx = cx - math.cos(inc) * L * .8
    ty = cy - math.sin(inc) * L * .8
    a = math.pi + inc + ca
    capsula(m, tx, ty, tx + math.cos(a) * cl, ty + math.sin(a) * cl, A * .5, .7)
    pin.add(m, r_(P.get('asa_cor', P['cor'])) if nome == 'arara' else cor, k=2)
    # asa de trás (voando)
    asa_ang = None
    if modo in ('voar', 'pairar', 'asas', 'decolar'):
        if modo == 'pairar':
            asa_ang = -1.2 + .9 * (f > .4)
        elif modo == 'asas':
            asa_ang = -1.0 - .25 * math.sin(ph)
        else:
            asa_ang = -1.25 * math.cos(ph) * (1 if modo == 'voar' else .8) - .1
        m = pin.m()
        al = P['asa_l']
        bx, by = cx + 1, cy - A * .3
        ex, ey = bx - al * .55, by + math.sin(asa_ang) * al * .85
        poligono(m, [(bx + 2, by), (bx + 1 - al * .2, by + math.sin(asa_ang) * al * .5), (ex, ey),
                     (ex - 1.5, ey + (2 if asa_ang < 0 else -2)), (bx - L * .9, by + 1)])
        pin.add(m, r_([mix(c, '#000000', .35) for c in P.get('asa_cor', P['cor'])]), k=2)
    # pernas (pousado)
    if pousada:
        m = pin.m()
        for dx in (-1, 1):
            capsula(m, cx + dx, cy + A * .7, cx + dx + .5, H - 2, .5, .5)
        pin.add(m, r_(['#3a2a1a', '#6a5030', '#8a7050'], 3), k=1)
    # corpo
    m = pin.m()
    elipse(m, cx, cy, L, A, inc)
    pin.add(m, cor)
    if P.get('peito'):
        mp = pin.m()
        elipse(mp, cx + math.cos(inc) * L * .3 + 1, cy + A * .25, L * .55, A * .7, inc)
        pin.add(mp & m, r_([mix(P['peito'], '#000000', .4), P['peito'], mix(P['peito'], '#ffffff', .3)], 3), k=2)
    # asa de cima / asa dobrada
    m = pin.m()
    if asa_ang is None:
        elipse(m, cx - .5, cy - .3, L * .75, A * .6, inc)
    else:
        al = P['asa_l']
        bx, by = cx, cy - A * .4
        ex, ey = bx - al * .45, by + math.sin(asa_ang) * al
        poligono(m, [(bx + 2.5, by), (bx + 2 - al * .15, by + math.sin(asa_ang) * al * .6), (ex, ey),
                     (ex - 2, ey + (2.5 if asa_ang < 0 else -2.5)), (bx - L * .8, by + 1.5)])
        if P.get('ponta_asa'):
            pontas = pin.m()
            circulo(pontas, ex, ey, 2.5)
            pin.add(m & ~pontas, r_(P['cor']), k=2)
            pin.add(m & pontas, r_(['#4a4844', P['ponta_asa'], '#c8c6be'], 3), k=1)
            m = pin.m()
    if m.any():
        pin.add(m, r_(P.get('asa_cor', P['cor'])), k=2.5)
    # cabeça
    hx = cx + math.cos(inc) * L * .85 + (0 if nome != 'coruja' else 0)
    hy = cy + math.sin(inc) * L * .85 - P['cab'] * (.3 if pousada else .2)
    if nome == 'coruja':
        hx, hy = cx, cy - A - P['cab'] * .55
    if modo == 'bicar':
        hx, hy = hx + 2 + f * 2, hy + 4 + f * 3
    m = pin.m()
    circulo(m, hx, hy, P['cab'])
    if P.get('tufos'):
        for s in (-1, 1):
            capsula(m, hx + s * 2.6, hy - 3, hx + s * 3.4, hy - 5.6, 1, .5)
    pin.add(m, r_(P['cabeca_cor'], 4) if P.get('cabeca_cor') else cor)
    if P.get('rosto'):
        mr = pin.m()
        circulo(mr, hx + 1, hy + .5, P['cab'] * .55)
        pin.add(mr & m, r_(['#a89888', P['rosto'], '#ffffff'], 3), k=1)
    # bico
    bl, bh, bc = P['bico']
    m = pin.m()
    ba = .2 if nome not in ('beijaflor',) else .05
    if modo == 'bicar':
        ba = 1.0
    if nome == 'coruja':
        ba = 1.4
    bx0 = hx + P['cab'] * .7 if nome != 'coruja' else hx
    by0 = hy if nome != 'coruja' else hy + 1
    capsula(m, bx0, by0, bx0 + math.cos(ba) * bl, by0 + math.sin(ba) * bl + (bh * .4 if nome == 'arara' else 0), bh, .5)
    br = r_([mix(bc, '#000000', .45), mix(bc, '#000000', .15), bc, mix(bc, '#ffffff', .35)], 4)
    pin.add(m, br, k=2.5)
    if nome == 'tucano':
        pin.ponto(bx0 + math.cos(ba) * bl - .5, by0 + math.sin(ba) * bl, '#1a0a04')
    # olho
    piscar = modo == 'piscar' and f > .4
    if P.get('olhos_grandes'):
        for s in (-1, 1):
            ox = hx + s * 1.8 + (1 if modo == 'virar' else 0)
            if piscar:
                pin.ponto(ox, hy, '#3e2c1a')
                pin.ponto(ox + .5 * s, hy, '#3e2c1a')
            else:
                for dx, dy in ((0, 0), (s, 0), (0, -1), (s, -1)):
                    pin.ponto(ox + dx * .5, hy - .5 + dy, '#f0c030')
                pin.ponto(ox, hy - .5, '#060504')
    else:
        ex_, ey_ = hx + P['cab'] * .3, hy - P['cab'] * .3
        if P.get('olho_aro'):
            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                pin.ponto(ex_ + dx, ey_ + dy, P['olho_aro'])
        pin.ponto(ex_, ey_, '#060504' if not piscar else P['cor'][2])
    return pin.render()


# ---------------------------------------------------------- avulsos
def sapo(modo, f):
    W, H = 20, 20
    pin = Pintura(W, H)
    cor = r_(['#0e2a10', '#1e5a1c', '#3a8a2a', '#64b43c', '#a0e070'])
    pulo = {'parado': 0, 'preparar': 0, 'pular': 6, 'cair': 2}[modo]
    esm = .8 if modo == 'preparar' else (1.15 if modo == 'pular' else 1)
    cx, cy = 10, 15 - pulo
    m = pin.m()
    if modo == 'pular':
        capsula(m, cx - 3, cy + 1, cx - 7, cy + 4, 1.4, .8)
        capsula(m, cx + 2, cy + 1, cx + 5, cy + 3, 1, .6)
    else:
        elipse(m, cx - 3, cy + 1.5, 3, 2)
        capsula(m, cx + 3, cy + 1, cx + 4, H - 2, .9, .7)
    pin.add(m, r_(['#0a2008', '#14401a', '#2a6a24', '#4a9030']), k=2)
    m = pin.m()
    elipse(m, cx, cy, 5 / esm ** .5, 3.2 * esm, -.2)
    circulo(m, cx + 2.5, cy - 3 * esm, 1.8)
    pin.add(m, cor)
    pin.ponto(cx + 3, cy - 3.2 * esm, '#f0d040')
    pin.ponto(cx + 3.5, cy - 3.2 * esm, '#060504')
    pin.ponto(cx + 4, cy + .5, '#e8d090')
    if modo == 'parado' and f > .4:      # papo
        pin.ponto(cx + 3, cy + 1.5, '#e8e0a8')
        pin.ponto(cx + 3, cy + 2.5, '#e8e0a8')
    return pin.render()


def tartaruga(modo, f):
    W, H = 28, 18
    pin = Pintura(W, H)
    pe = math.sin(f * 2 * math.pi) * 1.5 if modo == 'andar' else 0
    m = pin.m()
    if modo != 'esconder':
        capsula(m, 9 + pe, 12, 8 + pe, 16, 1.3, 1.1)
        capsula(m, 18 - pe, 12, 19 - pe, 16, 1.3, 1.1)
        capsula(m, 20, 11, 24, 9.5, 1.6, 1.8)
    pin.add(m, r_(['#2a2a14', '#4a4a24', '#707040', '#989860']), k=2)
    m = pin.m()
    elipse(m, 13.5, 11, 8, 6)
    m &= np.mgrid[0:H, 0:W][0] <= 13
    yy, xx = np.mgrid[0:H, 0:W]
    tex = (((xx // 3 + yy // 3) % 2) == 0) * -.22
    pin.add(m, r_(['#1a140a', '#3a2c14', '#5e4a22', '#866c34', '#a8904a']), tex=tex)
    if modo != 'esconder':
        pin.ponto(24, 9, '#060504')
    return pin.render()


def preguica(modo, f):
    W, H = 32, 32
    pin = Pintura(W, H)
    cor = r_(['#2a2218', '#4e4232', '#76684e', '#9a8c70', '#bcae90'])
    sw = math.sin(f * 2 * math.pi) * 1.2
    m = pin.m()
    capsula(m, 0, 3, W, 3, 1.6, 1.6)
    pin.add(m, r_(CASCA_G, 4), k=2)
    m = pin.m()
    for gx in (9, 22):
        capsula(m, gx, 4, gx + sw * .5, 13, 1.6, 1.8)
    elipse(m, 16 + sw, 15, 9, 5)
    pin.add(m, cor, tex=pp.ruido2(np.random.default_rng(2), H, W, 1, 3) * .3)
    m = pin.m()
    circulo(m, 24 + sw, 18.5, 3.2)
    pin.add(m, r_(['#4e4232', '#9a8c70', '#d8ccb0', '#eee4cc'], 4))
    pin.ponto(24 + sw, 18, '#1a1410')
    pin.ponto(25 + sw, 18, '#1a1410')
    pin.ponto(24.5 + sw, 20, '#3a2e22')
    return pin.render()


CASCA_G = ['#24170e', '#3a2717', '#523a24', '#6e5234']


def macaco(modo, f):
    W, H = 28, 36
    pin = Pintura(W, H)
    cor = r_(['#1a0e06', '#3a2010', '#5e3618', '#844e26', '#a8703c'])
    sw = math.sin(f * 2 * math.pi) * .35
    if modo == 'pendurado':
        m = pin.m()
        capsula(m, 0, 3, W, 3, 1.6, 1.6)
        pin.add(m, r_(CASCA_G, 4), k=2)
        piv = (14, 4)
        a = sw
        def P(dx, dy):
            return (piv[0] + dx * math.cos(a) - dy * math.sin(a), piv[1] + dx * math.sin(a) + dy * math.cos(a))
        m = pin.m()
        pts = [P(0, 0), P(1, 3), P(0, 6)]
        for p0, p1 in zip(pts, pts[1:]):
            capsula(m, *p0, *p1, .8, .8)
        capsula(m, *P(0, 6), *P(0, 15), 3.2, 3.6)
        capsula(m, *P(-2, 9), *P(-6, 18), 1, .8)
        capsula(m, *P(2, 9), *P(5, 17), 1, .8)
        capsula(m, *P(-1, 15), *P(-3, 22), 1.1, .9)
        capsula(m, *P(1, 15), *P(3, 22), 1.1, .9)
        circulo(m, *P(0, 19.5 - 21 + 21), 3.4) if False else None
        cab = P(.5, 20)
        circulo(m, *P(0, 20), 3.3)
        pin.add(m, cor)
        mr = pin.m()
        circulo(mr, *P(1, 20.5), 2)
        pin.add(mr, r_(['#8a6a50', '#c8a888', '#e8d0b0'], 3), k=1)
        x, y = P(1.5, 20)
        pin.ponto(x, y, '#120804')
    else:
        m = pin.m()
        sx, sy = 13, 14
        elipse(m, sx, sy + 5, 4.5, 5.5)
        capsula(m, sx + 2, sy + 4, sx + 5 + sw * 3, sy + 1 - (3 if f > .5 else 0), 1, .9)
        capsula(m, sx - 3, sy + 9, sx - 6, sy + 13, 1, .8)
        capsula(m, sx - 4, sy + 7, sx - 10, sy + 2 - sw * 4, .7, .6)
        circulo(m, sx + 1, sy - 2, 3.6)
        pin.add(m, cor)
        mr = pin.m()
        circulo(mr, sx + 2, sy - 1.5, 2.2)
        pin.add(mr, r_(['#8a6a50', '#c8a888', '#e8d0b0'], 3), k=1)
        pin.ponto(sx + 2.5, sy - 2.5, '#120804')
        mg = pin.m()
        capsula(mg, 0, 23, W, 23, 2, 2)
        pin.add(mg, r_(CASCA_G, 4), k=2)
    return pin.render()


def morcego(modo, f):
    W, H = 24, 20
    pin = Pintura(W, H)
    cor = r_(['#0c0a0c', '#1e1a20', '#322c36', '#4a4250', '#625a68'])
    m = pin.m()
    if modo == 'pendurado':
        capsula(m, 0, 2, W, 2, 1.4, 1.4)
        pin.add(m, r_(CASCA_G, 4), k=2)
        m = pin.m()
        elipse(m, 12, 9 + math.sin(f * 6.28) * .4, 3, 5.5)
        capsula(m, 12, 3, 12, 5, .7, .7)
        circulo(m, 12, 14, 2.4)
        capsula(m, 10.5, 15.5, 10, 17.5, .8, .5)
        capsula(m, 13.5, 15.5, 14, 17.5, .8, .5)
        pin.add(m, cor)
        pin.ponto(11, 14, '#e0d070')
        pin.ponto(13, 14, '#e0d070')
    else:
        a = math.cos(f * 6.28) * 5
        elipse(m, 12, 10, 3, 2.4)
        circulo(m, 15, 9, 1.8)
        for s in (-1, 1):
            poligono(m, [(12, 9), (12 + s * 10, 10 - a), (12 + s * 8, 12 - a * .4), (12 + s * 5, 11), (12 + s * 3, 12)])
        pin.add(m, cor, k=2)
        pin.ponto(16, 8.5, '#e0d070')
    return pin.render()


def cobra(modo, f):
    W, H = 24, 32
    pin = Pintura(W, H)
    cor = r_(['#0e2008', '#1e4a14', '#3a7a24', '#5ea83a', '#90d060'])
    m = pin.m()
    capsula(m, 0, 3, W, 3, 1.6, 1.6)
    pin.add(m, r_(CASCA_G, 4), k=2)
    m = pin.m()
    pts = [(4, 4), (9, 2), (14, 4), (18, 3)]
    sw = math.sin(f * 6.28)
    for k in range(10):
        pts.append((12 + math.sin(k * .7 + sw * .4) * 3 * (1 - k / 14), 6 + k * 2.2))
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        capsula(m, x0, y0, x1, y1, 1.6, 1.6)
    hx, hy = pts[-1]
    elipse(m, hx + 1, hy + 1.5, 2.2, 1.8)
    yy, xx = np.mgrid[0:H, 0:W]
    pin.add(m, cor, tex=((yy % 3) == 0) * -.2)
    pin.ponto(hx + 2, hy + 1, '#f0d040')
    if f > .4:
        pin.ponto(hx + 3, hy + 3, '#d03030')
        pin.ponto(hx + 4, hy + 4, '#d03030')
    return pin.render()


# ---------------------------------------------------------------- saída
def folha_de(nome, celula, pivo, anims):
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
    with open(os.path.join(SAIDA, f'{nome}.json'), 'w', encoding='utf-8') as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=1)
    return nome, atlas, anims


def main():
    todas = []
    for nome in ('veado', 'capivara', 'tamandua', 'quati', 'tatu'):
        P = QUAD[nome]
        anims = [('correr', [quadrupede(nome, 'correr', i / 6) for i in range(6)], 12, True),
                 ('andar', [quadrupede(nome, 'andar', i / 4) for i in range(4)], 6, True),
                 ('pastar', [quadrupede(nome, 'pastar', i / 2) for i in range(2)], 2, True),
                 ('deitado', [quadrupede(nome, 'deitado', 0)], 1, False)]
        todas.append(folha_de(nome, (P['W'], P['H']), [P['W'] // 2, P['H'] - 2], anims))
    for nome in ('ave', 'urubu', 'tucano', 'arara', 'coruja', 'beijaflor'):
        P = AVES[nome]
        if nome == 'beijaflor':
            anims = [('pairar', [ave(nome, 'pairar', i / 2) for i in range(2)], 20, True),
                     ('voar', [ave(nome, 'voar', i / 4) for i in range(4)], 16, True)]
        elif nome == 'coruja':
            anims = [('pousado', [ave(nome, 'pousado', 0)], 1, True),
                     ('piscar', [ave(nome, 'piscar', 0), ave(nome, 'piscar', .5)], 4, False),
                     ('virar', [ave(nome, 'virar', 0)], 1, False),
                     ('voar', [ave(nome, 'voar', i / 4) for i in range(4)], 8, True)]
        else:
            anims = [('pousado', [ave(nome, 'pousado', i / 2) for i in range(2)], 2, True),
                     ('bicar', [ave(nome, 'bicar', i / 2) for i in range(2)], 6, False),
                     ('asas', [ave(nome, 'asas', i / 2) for i in range(2)], 4, True),
                     ('decolar', [ave(nome, 'decolar', i / 2) for i in range(2)], 10, False),
                     ('voar', [ave(nome, 'voar', i / 4) for i in range(4)], 10 if nome != 'urubu' else 6, True)]
        todas.append(folha_de(nome, (P['W'], P['H']), [P['W'] // 2, P['H'] - 2], anims))
    todas.append(folha_de('sapo', (20, 20), [10, 18], [
        ('parado', [sapo('parado', 0), sapo('parado', .5)], 2, True),
        ('pular', [sapo('preparar', 0), sapo('pular', 0), sapo('cair', 0)], 10, False)]))
    todas.append(folha_de('tartaruga', (28, 18), [14, 16], [
        ('andar', [tartaruga('andar', i / 2) for i in range(2)], 3, True),
        ('esconder', [tartaruga('esconder', 0)], 1, False)]))
    todas.append(folha_de('preguica', (32, 32), [16, 3], [
        ('pendurado', [preguica('p', i / 4) for i in range(4)], 2, True)]))
    todas.append(folha_de('macaco', (28, 36), [14, 3], [
        ('pendurado', [macaco('pendurado', i / 4) for i in range(4)], 4, True),
        ('sentado', [macaco('sentado', i / 2) for i in range(2)], 2, True)]))
    todas.append(folha_de('morcego', (24, 20), [12, 2], [
        ('pendurado', [morcego('pendurado', i / 2) for i in range(2)], 2, True),
        ('voar', [morcego('voar', i / 4) for i in range(4)], 14, True)]))
    todas.append(folha_de('cobra', (24, 32), [12, 3], [
        ('balancar', [cobra('b', i / 4) for i in range(4)], 3, True)]))

    Z = 4
    blocos = []
    for nome, atlas, anims in todas:
        h, w = atlas.shape[:2]
        fundo = Image.new('RGBA', (w, h), (22, 44, 52, 255))
        fundo.alpha_composite(Image.fromarray(atlas))
        im = fundo.resize((w * Z, h * Z), Image.NEAREST)
        cab = Image.new('RGBA', (im.width + 110, im.height), (12, 12, 14, 255))
        cab.paste(im, (110, 0))
        dr = ImageDraw.Draw(cab)
        dr.text((6, 4), nome, fill=(232, 228, 218, 255))
        lh = h // len(anims) * Z
        for i, (an, *_) in enumerate(anims):
            dr.text((6, i * lh + lh // 2 + 6), an, fill=(150, 146, 136, 255))
        blocos.append(cab)
    # duas colunas
    meio = (len(blocos) + 1) // 2
    cols = [blocos[:meio], blocos[meio:]]
    Wc = [max(b.width for b in c) for c in cols]
    Hc = [sum(b.height + 6 for b in c) for c in cols]
    out = Image.new('RGBA', (sum(Wc) + 10, max(Hc)), (12, 12, 14, 255))
    x = 0
    for c, wc in zip(cols, Wc):
        y = 0
        for b in c:
            out.paste(b, (x, y))
            y += b.height + 6
        x += wc + 10
    out.save(os.path.join(AQUI, 'pixel', '_previa', 'bichos.png'))
    print('ok', out.size)


if __name__ == '__main__':
    main()
