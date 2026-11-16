"""Gera o Guardião em PIXEL ART (proposta, ainda fora do jogo).

Uso:  python fase2/arte/preparar-pixel-guardiao.py
Grava fase2/arte/pixel/guardiao/<animacao>-<n>.png   (célula 40x40)
      fase2/arte/pixel/guardiao/guardiao.png         (atlas: uma linha por animação)
      fase2/arte/pixel/guardiao/guardiao.json        (linhas, quadros, fps, pivô)
      fase2/arte/pixel/_previa/guardiao.png          (atlas ampliado, pra revisar)

O modelo antigo (folha de IA, `guardiao.png`) é só REFERÊNCIA de identidade:
cabeça creme redonda, olho grande, duas folhas varridas pra trás, gola de
folha, faixa laranja, corpo escuro, mãos e pés creme, cauda de cipó.

Aqui ele é um ESQUELETO: cada pose é um punhado de ângulos (coxa, canela,
braço, folhas, cauda) e o desenho sai das juntas. Por isso a forma não varia
de um quadro pro outro — o problema que a folha de IA tinha e que obrigou o
`preparar-guardiao.py` a realinhar tudo. Mesma escala dos cenários: 1 px de
arte = 2 px do jogo; a caixa de colisão (22x44) dá 11x22 px de arte.

Pivô = PÉ: (20, 37) na célula. Quadros de chão são assentados nessa linha.
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
rampa, capsula, valor, aplicar, contorno, px, C, mix, desloca = (
    pp.rampa, pp.capsula, pp.valor, pp.aplicar, pp.contorno, pp.px, pp.C, pp.mix, pp.desloca)

S = 40                 # célula
PE = (20, 37)          # pivô
SAIDA = os.path.join(AQUI, 'pixel', 'guardiao')

CREME = rampa(['#4a4234', '#9a8e72', '#cfc4a6', '#ece4cc', '#fffaee'], 5)
CORPO = rampa(['#0e0e12', '#1c1c22', '#2c2c34', '#40404a'], 4)
CORPO_T = rampa(['#0a0a0d', '#141418', '#202026', '#2e2e36'], 4)
LARANJA = rampa(['#5a2a10', '#a85420', '#e08a30', '#f8b860'], 4)
FOLHA_F = rampa(['#1a3e18', '#2e6a26', '#4e9a34', '#7cc450', '#b4e48a'], 5)
FOLHA_T = rampa(['#122e14', '#22521e', '#3a7a2a', '#5c9e3c', '#86c060'], 5)
CIPO = rampa(['#10240e', '#1e3e18', '#2e5a22'], 3)
CONTORNO = C('#08080a')
OLHO = C('#0a0a10')

PADRAO = dict(
    ox=0.0, oy=0.0, lean=0.0, rot=0.0, hd=(0.0, 0.0), chao=True,
    coxa_f=.12, canela_f=.05, coxa_t=-.12, canela_t=-.1,
    braco_f=.25, ante_f=.45, braco_t=-.2, ante_t=-.05,
    orelha_f=math.pi + .45, orelha_t=math.pi + .95, l_orelha=(13, 11), curva_orelha=-.03,
    cauda=math.pi - .55, enrola=1.0,
    olho='aberto', boca=None, extra=None,
)


def rot(p, c, a):
    if not a:
        return p
    x, y = p[0] - c[0], p[1] - c[1]
    ca, sa = math.cos(a), math.sin(a)
    return (c[0] + x * ca - y * sa, c[1] + x * sa + y * ca)


def membro(ini, a1, l1, a2, l2):
    """Ângulos medidos a partir de 'pra baixo'; positivo = pra frente (+x)."""
    m = (ini[0] + math.sin(a1) * l1, ini[1] + math.cos(a1) * l1)
    f = (m[0] + math.sin(a2) * l2, m[1] + math.cos(a2) * l2)
    return m, f


def folha(m, base, ang, L, W, curva, nervura=None):
    """Folha afilada nas duas pontas, com a linha central curvando."""
    n = max(4, int(L * 1.5))
    x, y = base
    pts = []
    for k in range(n + 1):
        s = k / n
        r = max(.5, W / 2 * math.sin(math.pi * min(1, s * .92 + .08)) ** .75)
        pts.append((x, y, r))
        a = ang + curva * k
        x += math.cos(a) * L / n
        y += math.sin(a) * L / n
    for (x0, y0, r0), (x1, y1, r1) in zip(pts, pts[1:]):
        capsula(m, x0, y0, x1, y1, r0, r1)
    if nervura is not None:
        for x0, y0, _ in pts[1:-2]:
            nervura.append((x0, y0))


def montar(P):
    """Calcula todas as juntas da pose (antes de assentar no chão)."""
    hip = (20 + P['ox'], 30 + P['oy'])
    lean = P['lean']
    peito = (hip[0] + math.sin(lean) * 5, hip[1] - math.cos(lean) * 5)
    cab = (peito[0] + 1 + math.sin(lean) * 4 + P['hd'][0], peito[1] - 5 + P['hd'][1])
    ombro = (peito[0] + math.sin(lean) * -1, peito[1] + 1)
    J = dict(hip=hip, peito=peito, cab=cab, ombro=ombro)
    J['joelho_f'], J['pe_f'] = membro(hip, P['coxa_f'], 3.6, P['canela_f'], 3.6)
    J['joelho_t'], J['pe_t'] = membro(hip, P['coxa_t'], 3.6, P['canela_t'], 3.6)
    J['cot_f'], J['mao_f'] = membro(ombro, P['braco_f'], 3.0, P['ante_f'], 3.0)
    J['cot_t'], J['mao_t'] = membro(ombro, P['braco_t'], 3.0, P['ante_t'], 3.0)
    J['base_orelha'] = (cab[0] - 1.5, cab[1] - 3.6)
    J['base_orelha_t'] = (cab[0] - 2.8, cab[1] - 4.2)
    # cauda: cipó saindo de trás do quadril, enrolando na ponta
    pts = [(hip[0] - 1.5, hip[1])]
    a = P['cauda']
    for k in range(5):
        a += P['enrola'] * .22
        x, y = pts[-1]
        pts.append((x + math.cos(a) * 1.4, y + math.sin(a) * 1.4))
    J['cauda'] = pts
    return J


def desenhar(P):
    J = montar(P)
    # gira em torno do MEIO do corpo (giro do salto duplo, corpo deitado)
    c = ((J['hip'][0] + J['peito'][0]) / 2, (J['hip'][1] + J['peito'][1]) / 2)
    a = P['rot']
    T = {k: (rot(v, c, a) if isinstance(v, tuple) else [rot(p, c, a) for p in v]) for k, v in J.items()}

    img = np.zeros((S, S, 4), np.uint8)
    uniao = pp.vazio(S, S)
    camadas = []

    def camada(cor, mask, k=4.0, base=.5):
        camadas.append((mask, cor, k, base))

    def nova():
        return pp.vazio(S, S)

    # 1. folha de trás
    m, nerv_t = nova(), []
    folha(m, T['base_orelha_t'], P['orelha_t'] + a, P['l_orelha'][1], 4.6, P['curva_orelha'], nerv_t)
    camada(FOLHA_T, m)
    # 2. braço e perna de trás
    m = nova()
    capsula(m, *T['ombro'], *T['cot_t'], .9, .8)
    capsula(m, *T['cot_t'], *T['mao_t'], .8, .7)
    capsula(m, *T['hip'], *T['joelho_t'], 1.1, .9)
    capsula(m, *T['joelho_t'], *T['pe_t'], .9, .8)
    camada(CORPO_T, m)
    # 3. cauda
    m = nova()
    for p0, p1 in zip(T['cauda'], T['cauda'][1:]):
        capsula(m, *p0, *p1, .55, .5)
    camada(CIPO, m, k=1, base=.6)
    m_ponta = nova()
    x1, y1 = T['cauda'][-1]
    x0, y0 = T['cauda'][-2]
    folha(m_ponta, (x1, y1), math.atan2(y1 - y0, x1 - x0) + .6, 4, 2.6, .05)
    camada(FOLHA_F, m_ponta)
    # 4. tronco
    m_tronco = nova()
    capsula(m_tronco, *T['hip'], *T['peito'], 2.6, 2.5)
    camada(CORPO, m_tronco)
    # 5. perna da frente
    m = nova()
    capsula(m, *T['hip'], *T['joelho_f'], 1.1, .9)
    capsula(m, *T['joelho_f'], *T['pe_f'], .9, .8)
    camada(CORPO, m)
    # 6. faixa laranja (no quadril) — sai da máscara do tronco
    hx, hy = T['hip']
    pc = T['peito']
    yy, xx = np.mgrid[0:S, 0:S] + .5
    eixo = np.array([pc[0] - hx, pc[1] - hy])
    eixo = eixo / (np.hypot(*eixo) or 1)
    proj = (xx - hx) * eixo[0] + (yy - hy) * eixo[1]
    faixa = m_tronco & (proj > .4) & (proj < 2.4)
    camada(LARANJA, faixa, k=3, base=.55)
    # 7. gola de folha
    m = nova()
    gx, gy = pc[0] + .5, pc[1] - .6
    for dx in (-2.6, -1.2, .4, 1.8, 3.0):
        capsula(m, gx + dx, gy - .5, gx + dx * 1.15, gy + 1.6, 1.1, .5)
    camada(FOLHA_F, m, k=3, base=.45)
    # 8. cabeça
    m = nova()
    cx, cy = T['cab']
    m |= (((xx - cx) / 5.4) ** 2 + ((yy - cy) / 4.9) ** 2) <= 1
    camada(CREME, m, k=5, base=.62)
    m_cab = m
    # 9. folha da frente
    m, nerv_f = nova(), []
    folha(m, T['base_orelha'], P['orelha_f'] + a, P['l_orelha'][0], 5.6,
          P['curva_orelha'], nerv_f)
    camada(FOLHA_F, m)
    # 10. braço da frente, mãos e pés
    m = nova()
    capsula(m, *T['ombro'], *T['cot_f'], .9, .8)
    capsula(m, *T['cot_f'], *T['mao_f'], .8, .7)
    camada(CORPO, m)
    m = nova()
    for k in ('mao_f', 'mao_t'):
        x, y = T[k]
        capsula(m, x, y, x + .3, y + .3, .8, .8)
    for k in ('pe_f', 'pe_t'):
        x, y = T[k]
        capsula(m, x - .2, y - .4, x + 1.2 * math.cos(a), y + 1.2 * math.sin(a) - .4, .6, .6)
    camada(CREME, m, k=2, base=.6)

    for mask, cor, k, base in camadas:
        livre = mask
        v = valor(mask, 1, k=k, base=base)
        aplicar(img, livre, cor, v, dither=.25)
        uniao |= mask
    for x, y in nerv_t:
        px(img, x, y, FOLHA_T[1])
    for x, y in nerv_f:
        px(img, x, y, FOLHA_F[2])
    contorno(img, uniao, CONTORNO)

    # rosto (olho sempre pra frente)
    ex, ey = cx + 1.6, cy - .2
    if P['olho'] == 'aberto':
        for dx in (0, 1):
            for dy in (-1, 0, 1):
                px(img, ex + dx, ey + dy, OLHO)
        px(img, ex, ey - 1, '#ffffff')
    elif P['olho'] == 'fechado':
        px(img, ex, ey + .5, CREME[0])
        px(img, ex + 1, ey + .5, CREME[0])
        px(img, ex - 1, ey, CREME[1])
    elif P['olho'] == 'dor':
        px(img, ex, ey - 1, OLHO)
        px(img, ex + 1, ey, OLHO)
        px(img, ex, ey + 1, OLHO)
    elif P['olho'] == 'x':
        for dx, dy in ((0, -1), (1, 0), (0, 1), (-1, 1), (1, -1) if False else (2, -1)):
            px(img, ex + dx - .5, ey + dy, OLHO)
    elif P['olho'] == 'meio':
        for dx in (0, 1):
            px(img, ex + dx, ey, OLHO)
            px(img, ex + dx, ey + 1, OLHO)
    if P['boca'] == 'aberta':
        px(img, cx + 3.2, cy + 2.6, '#3a1e1a')
        px(img, cx + 3.2, cy + 3.4, '#5a2e28')
    # bochecha
    if P['olho'] in ('aberto', 'fechado', 'meio'):
        px(img, ex - .5, ey + 2.2, '#e8b4a0')

    if P['chao']:
        linhas = np.where(img[..., 3].any(1))[0]
        dy = (PE[1] + 1) - linhas.max()
        img = np.roll(img, dy, 0)
        if dy > 0:
            img[:dy] = 0
        elif dy < 0:
            img[dy:] = 0
        cy += dy
        hx, hy = hx, hy + dy

    ext = P['extra']
    if ext == 'estrelas':
        f = P.get('fase', 0)
        for k in range(3):
            ang = f * 2.1 + k * 2.09
            px(img, cx + math.cos(ang) * 5, cy - 6 + math.sin(ang) * 1.5, '#f0e070' if k != 1 else '#b8f0d8')
    elif ext == 'rastro':
        for k, (dy, L) in enumerate(((-3, 9), (0, 12), (3, 8))):
            for j in range(L):
                if (j + k + P.get('fase', 0)) % 3 != 0:
                    px(img, hx - 5 - j, hy - 2 + dy, FOLHA_F[3] if j < L // 2 else FOLHA_F[2])
    elif ext == 'folhinhas':
        f = P.get('fase', 0)
        for k in range(5):
            ang = k * 1.26 + f * .5
            rr = 6 + f * 1.5
            px(img, cx + math.cos(ang) * rr, cy + 6 + math.sin(ang) * rr * .5, FOLHA_F[3])
    elif ext == 'canto':
        f = P.get('fase', 0)
        for k in range(8):
            ang = k * .785 + f * .3
            rr = 7 + f * 2
            px(img, cx + math.cos(ang) * rr, cy + 3 + math.sin(ang) * rr * .8, FOLHA_F[4] if k % 2 else '#b8f0d8')
    return img


# ------------------------------------------------------------ animações
def pose(**k):
    p = dict(PADRAO)
    p.update(k)
    return p


def parado(i):
    s = math.sin(i / 4 * 2 * math.pi)
    return pose(oy=0, hd=(0, -.4 * max(0, s)), orelha_f=math.pi + .32 + .06 * s, orelha_t=math.pi + .78 + .05 * s,
                cauda=math.pi - .35 + .1 * s, braco_f=.25 + .04 * s, olho='fechado' if i == 3 else 'aberto')


def correndo(i):
    f = i / 6 * 2 * math.pi
    sf, cf = math.sin(f), math.cos(f)
    return pose(lean=.28, oy=-abs(sf) * 1.2,
                coxa_f=.75 * sf, canela_f=.75 * sf - (.25 + 1.1 * max(0, cf)),
                coxa_t=-.75 * sf, canela_t=-.75 * sf - (.25 + 1.1 * max(0, -cf)),
                braco_f=-.7 * sf, ante_f=-.7 * sf + 1.1, braco_t=.7 * sf, ante_t=.7 * sf + 1.0,
                orelha_f=math.pi + .12 + .07 * sf, orelha_t=math.pi + .42 - .06 * sf,
                cauda=math.pi - .08 + .12 * sf, enrola=.3)


def aterrissar(i):
    return pose(oy=[3, 1.5][i], lean=[.35, .2][i], coxa_f=[1.25, .8][i], canela_f=[-.5, -.3][i],
                coxa_t=[.9, .55][i], canela_t=[-.7, -.45][i], braco_f=[.7, .45][i], ante_f=[1.2, .8][i],
                orelha_f=math.pi - .25 + .3 * i, orelha_t=math.pi + .1 + .3 * i, hd=(0, [1, .5][i]))


def subindo(i):
    return pose(chao=False, lean=.12, coxa_f=1.0, canela_f=-.1 + .2 * i, coxa_t=-.3, canela_t=-.7,
                braco_f=2.5, ante_f=2.8, braco_t=-.6, ante_t=-.3,
                orelha_f=math.pi - .55 - .1 * i, orelha_t=math.pi - .25 - .1 * i, cauda=math.pi * .62, enrola=.2)


def apice(i):
    return pose(chao=False, lean=.08, coxa_f=.7, canela_f=.2, coxa_t=-.2, canela_t=-.4,
                braco_f=1.7, ante_f=2.2, braco_t=-1.2, ante_t=-1.4,
                orelha_f=math.pi + .1, orelha_t=math.pi + .45, cauda=math.pi * .85)


def caindo(i):
    return pose(chao=False, lean=-.05, coxa_f=.3, canela_f=.1 - .1 * i, coxa_t=-.15, canela_t=0,
                braco_f=2.2 + .15 * i, ante_f=2.6, braco_t=-2.0 - .15 * i, ante_t=-2.5,
                orelha_f=math.pi + .95 + .08 * i, orelha_t=math.pi + 1.3 + .08 * i, cauda=math.pi + .6, enrola=-.2)


def salto_duplo(i):
    return pose(chao=False, oy=-5, rot=i * math.pi / 2, coxa_f=1.6, canela_f=-.9, coxa_t=1.3, canela_t=-1.0,
                braco_f=1.4, ante_f=-.2, braco_t=1.0, ante_t=-.3, lean=.5,
                orelha_f=math.pi - .4, orelha_t=math.pi - .1, l_orelha=(9, 8), cauda=math.pi * .6, enrola=1.4,
                olho='fechado' if i % 2 else 'aberto')


def planeio(i):
    b = .1 * (1 if i else -1)
    return pose(chao=False, lean=.15, coxa_f=.35, canela_f=.25, coxa_t=-.1, canela_t=-.25,
                braco_f=1.9, ante_f=1.6, braco_t=-1.9, ante_t=-1.6,
                orelha_f=-math.pi / 2 + .55 + b, orelha_t=-math.pi / 2 - .75 - b, l_orelha=(13, 12),
                curva_orelha=.05, cauda=math.pi * .55, enrola=.3, hd=(0, -.5 * i))


def ataque(i):
    T = [dict(lean=-.15, braco_f=-1.3, ante_f=-.9, braco_t=.4, ante_t=.8, coxa_f=.35, canela_f=.1,
              coxa_t=-.45, canela_t=-.3, orelha_f=math.pi + .55, orelha_t=math.pi + .95, hd=(-.5, 0)),
         dict(lean=.4, braco_f=1.6, ante_f=1.57, braco_t=-.9, ante_t=-.6, coxa_f=.7, canela_f=.15,
              coxa_t=-.7, canela_t=-.45, orelha_f=math.pi + .05, orelha_t=math.pi + .3, hd=(1, 0), olho='meio'),
         dict(lean=.35, braco_f=1.85, ante_f=2.0, braco_t=-.8, ante_t=-.5, coxa_f=.65, canela_f=.15,
              coxa_t=-.65, canela_t=-.4, orelha_f=math.pi + .1, orelha_t=math.pi + .35, hd=(1, 0)),
         dict(lean=.12, braco_f=.8, ante_f=1.2, braco_t=-.3, ante_t=-.1, coxa_f=.3, canela_f=.1,
              coxa_t=-.35, canela_t=-.2, orelha_f=math.pi + .25, orelha_t=math.pi + .65)][i]
    return pose(**T)


def ataque_ar(i):
    T = [dict(braco_f=-1.2, ante_f=-.8, lean=-.1, orelha_f=math.pi + .5),
         dict(braco_f=1.6, ante_f=1.57, lean=.35, orelha_f=math.pi + .05, olho='meio'),
         dict(braco_f=1.9, ante_f=2.1, lean=.25, orelha_f=math.pi + .15)][i]
    return pose(chao=False, coxa_f=1.0, canela_f=-.3, coxa_t=.2, canela_t=-.6, braco_t=-.8, ante_t=-.5,
                orelha_t=math.pi + .4, cauda=math.pi * .8, **T)


def investida(i):
    return pose(chao=False, lean=1.0, oy=-4, coxa_f=-1.2, canela_f=-1.45, coxa_t=-1.45, canela_t=-1.6,
                braco_f=1.75, ante_f=1.7, braco_t=-1.4, ante_t=-1.5, hd=(1.2, 2.2),
                orelha_f=math.pi + .02 + .03 * i, orelha_t=math.pi + .15 - .03 * i, l_orelha=(13, 11),
                cauda=math.pi - .05, enrola=.1, extra='rastro', fase=i, olho='meio')


def parede(i):
    return pose(chao=False, ox=1.5, lean=-.05, coxa_f=1.0, canela_f=.15, coxa_t=.15, canela_t=.05 + .1 * i,
                braco_f=2.75, ante_f=2.95, braco_t=-.4, ante_t=-.2,
                orelha_f=math.pi + .9 + .05 * i, orelha_t=math.pi + 1.2 + .05 * i, cauda=math.pi * .55,
                enrola=-.1, hd=(-.5, 0))


def salto_parede(i):
    return pose(chao=False, lean=[-.25, .1][i], coxa_f=[-.5, .6][i], canela_f=[-.9, .1][i],
                coxa_t=[-.9, -.4][i], canela_t=[-1.1, -.7][i], braco_f=[2.3, 2.0][i], ante_f=[2.6, 2.4][i],
                braco_t=[-2.4, -1.5][i], ante_t=[-2.7, -1.8][i],
                orelha_f=math.pi - .35, orelha_t=math.pi - .05, cauda=math.pi * .7)


def canto(i):
    abre = [.2, .55, .9, 1.0][i]
    return pose(lean=-.08 * abre, hd=(-.3, -.8 * abre), braco_f=.3 + 1.9 * abre, ante_f=.5 + 2.0 * abre,
                braco_t=-.3 - 1.9 * abre, ante_t=-.2 - 2.0 * abre,
                orelha_f=math.pi + .32 + .7 * abre, orelha_t=math.pi + .78 + .6 * abre,
                olho='fechado', boca='aberta' if i >= 1 else None,
                extra='canto' if i >= 2 else None, fase=i - 2)


def dano(i):
    return pose(lean=[-.5, -.3][i], ox=[-1.5, -1][i], hd=(-1, 0), coxa_f=[.5, .4][i], canela_f=.2,
                coxa_t=[-.3, -.25][i], canela_t=-.1, braco_f=[1.2, .9][i], ante_f=[2.4, 2.0][i],
                braco_t=[-1.0, -.7][i], ante_t=-.6, orelha_f=math.pi - .45, orelha_t=math.pi - .15,
                olho='dor', cauda=math.pi * .7)


def atordoado(i):
    return pose(oy=4, coxa_f=1.45, canela_f=1.55, coxa_t=1.3, canela_t=1.5, lean=-.15,
                braco_f=.15, ante_f=.5, braco_t=-.25, ante_t=-.1, hd=(0, .5),
                orelha_f=math.pi - .55 + .06 * i, orelha_t=math.pi - .25 - .06 * i, olho='x',
                extra='estrelas', fase=i, cauda=math.pi * .9, enrola=.2)


def morte(i):
    if i == 0:
        return dano(0)
    if i == 1:
        return pose(oy=3, lean=.5, coxa_f=1.55, canela_f=-1.4, coxa_t=1.45, canela_t=-1.5, braco_f=.1,
                    ante_f=.2, braco_t=-.1, ante_t=0, orelha_f=math.pi - .7, orelha_t=math.pi - .4,
                    olho='fechado', hd=(1, 1.5))
    return pose(chao=True, rot=math.pi / 2 - .15, coxa_f=.3, canela_f=.4, coxa_t=.1, canela_t=.2,
                braco_f=.4, ante_f=.6, braco_t=0, ante_t=.1, orelha_f=math.pi - .2, orelha_t=math.pi + .2,
                olho='fechado', extra='folhinhas' if i == 3 else None, fase=1, cauda=math.pi * .4, enrola=0)


ANIMACOES = [   # nome, função, quadros, fps, repete
    ('parado', parado, 4, 4, True),
    ('correndo', correndo, 6, 12, True),
    ('aterrissar', aterrissar, 2, 14, False),
    ('subindo', subindo, 2, 10, True),
    ('apice', apice, 1, 1, False),
    ('caindo', caindo, 2, 8, True),
    ('salto-duplo', salto_duplo, 4, 18, False),
    ('planeio', planeio, 2, 6, True),
    ('ataque', ataque, 4, 18, False),
    ('ataque-ar', ataque_ar, 3, 16, False),
    ('investida', investida, 3, 16, True),
    ('parede', parede, 2, 6, True),
    ('salto-parede', salto_parede, 2, 10, False),
    ('canto', canto, 4, 4, False),
    ('dano', dano, 2, 12, False),
    ('atordoado', atordoado, 2, 4, True),
    ('morte', morte, 4, 6, False),
]


def main():
    os.makedirs(SAIDA, exist_ok=True)
    cols = max(n for _, _, n, _, _ in ANIMACOES)
    atlas = np.zeros((S * len(ANIMACOES), S * cols, 4), np.uint8)
    meta = {'celula': S, 'pivo': list(PE), 'escala': 2, 'animacoes': {}}
    for lin, (nome, fn, n, fps, repete) in enumerate(ANIMACOES):
        for i in range(n):
            q = desenhar(fn(i))
            atlas[lin * S:(lin + 1) * S, i * S:(i + 1) * S] = q
            Image.fromarray(q).save(os.path.join(SAIDA, f'{nome}-{i + 1}.png'))
        meta['animacoes'][nome] = {'linha': lin, 'quadros': n, 'fps': fps, 'repete': repete}
    Image.fromarray(atlas).save(os.path.join(SAIDA, 'guardiao.png'))
    with open(os.path.join(SAIDA, 'guardiao.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    # prévia: fundo escuro de jogo, rótulo de cada linha
    Z = 5
    prev = Image.new('RGBA', (atlas.shape[1] * Z + 170, atlas.shape[0] * Z), (20, 26, 32, 255))
    big = Image.fromarray(atlas).resize((atlas.shape[1] * Z, atlas.shape[0] * Z), Image.NEAREST)
    prev.alpha_composite(big, (170, 0))
    dr = ImageDraw.Draw(prev)
    for lin, (nome, _, n, _, _) in enumerate(ANIMACOES):
        dr.text((10, lin * S * Z + S * Z // 2 - 6), nome, fill=(232, 228, 218, 255))
        for i in range(cols + 1):
            x = 170 + i * S * Z
            dr.line([(x, lin * S * Z), (x, (lin + 1) * S * Z)], fill=(255, 255, 255, 18))
        dr.line([(170, lin * S * Z), (prev.width, lin * S * Z)], fill=(255, 255, 255, 18))
        y = lin * S * Z + PE[1] * Z + Z
        dr.line([(170, y), (170 + n * S * Z, y)], fill=(72, 217, 168, 60))
    prev.save(os.path.join(AQUI, 'pixel', '_previa', 'guardiao.png'))
    print('ok', sum(n for _, _, n, _, _ in ANIMACOES), 'quadros')


if __name__ == '__main__':
    main()
