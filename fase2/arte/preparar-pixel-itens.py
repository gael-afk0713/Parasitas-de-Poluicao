"""Gera os ELEMENTOS DO CHÃO da Fase 2 em pixel art (proposta, fora do jogo).

Uso:  python fase2/arte/preparar-pixel-itens.py
Grava fase2/arte/pixel/itens/lixo.png  + .json  (sala poluída)
      fase2/arte/pixel/itens/vida.png  + .json  (sala restaurada)
      fase2/arte/pixel/_previa/itens.png

Referência: fase2/arte/chao/lixo.png e folhas.png (silhuetas que o jogo
espalha pelo chão). Cada item ocupa uma célula fixa de 32x24 com a BASE na
última linha (pivô = meio de baixo), pra assentar direto na superfície do
chão em pedaços. O que mexe (tambor vazando, sacola no vento, flor e
samambaia balançando) tem quadros; o resto é um quadro só.

A ordem das duas folhas é casada de propósito: o item N do lixo e o item N
da vida ocupam o mesmo lugar, então restaurar pode TROCAR UM PELO OUTRO
(lixo -> planta no mesmo ponto, regra da ARQUITETURA).
"""
import importlib.util
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw

AQUI = os.path.dirname(os.path.abspath(__file__))


def _mod(nome, arq):
    s = importlib.util.spec_from_file_location(nome, os.path.join(AQUI, arq))
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)
    return m


pp = _mod('pp', 'preparar-pixel.py')
pz = _mod('pz', 'preparar-pixel-parasitas.py')
pb = _mod('pb', 'preparar-pixel-bichos.py')
rampa, capsula, circulo, px, C, mix = pp.rampa, pp.capsula, pp.circulo, pp.px, pp.C, pp.mix
elipse, poligono, Pintura = pz.elipse, pz.poligono, pb.Pintura

W, H = 32, 24
B = H - 1                      # linha do chão
SAIDA = os.path.join(AQUI, 'pixel', 'itens')
r_ = pb.r_

PLAST_VERDE = r_(['#0e2420', '#1e4a3e', '#3a7a66', '#6aa894', '#b8e0d0'])
PLAST_AZUL = r_(['#0e1a2a', '#1e3450', '#36587e', '#6a8eb0', '#b0c8e0'])
VIDRO = r_(['#0a2014', '#1a3e26', '#2e6a3e', '#5a9a5e', '#a8d8a0'])
METAL = r_(['#1a1a1c', '#3a3a3e', '#5e5e64', '#8a8a90', '#c0c0c4'])
FERRUGEM = r_(['#1e0e06', '#4a2210', '#7a3a1a', '#a85a2a', '#c8844a'])
BORRACHA = r_(['#050505', '#0e0e10', '#1a1a1e', '#2a2a30', '#3e3e46'])
ISOPOR = r_(['#5a5a54', '#8a8a82', '#b4b4aa', '#d8d8cc', '#f0f0e6'])
COURO = r_(['#140a06', '#2e1a10', '#4e2e1a', '#704428', '#8e5e3a'])
OLEO = r_(['#020203', '#08080a', '#121216', '#1e1e24'], 4)
FOLHA = r_(['#14300e', '#285a18', '#428a24', '#68b036', '#a0d860'])
SECA = r_(['#2a1a0a', '#5a3a16', '#8a5e26', '#b0843a', '#d8b060'])
MADEIRA = r_(['#140c08', '#2e1e10', '#4a3018', '#664424', '#845c34'])
PEDRA = r_(['#1a1a1e', '#34363c', '#50535a', '#6e7178', '#8e9198'])
MUSGO = r_(['#1e3a10', '#3a6a1c', '#5e9a2a', '#8cc444'], 4)


def novo():
    return Pintura(W, H)


# --------------------------------------------------------------- lixo
def garrafa_pet(f=0):
    p = novo()
    m = p.m()
    capsula(m, 7, B - 3, 21, B - 3, 3, 3)
    capsula(m, 21, B - 3, 25, B - 3.5, 2, 1.3)
    p.add(m, PLAST_VERDE, k=4, base=.6)
    m2 = p.m()
    capsula(m2, 25, B - 3.6, 27, B - 3.8, 1.3, 1.3)
    p.add(m2, r_(['#3a0a08', '#7a1a14', '#c03020'], 3), k=2)
    m3 = p.m()
    m3[B - 6:B, 12:16] = True
    p.add(m3 & m, r_(['#5a1a10', '#b84a2a', '#e88a50'], 3), k=1)
    return p.render()


def garrafa_vidro(f=0):
    p = novo()
    m = p.m()
    capsula(m, 16, B - 2, 16, B - 11, 3, 3)
    capsula(m, 16, B - 11, 16, B - 16, 1.5, 1.3)
    poligono(m, [(13, B), (19, B), (17, B - 2), (15, B - 2)])
    p.add(m, VIDRO, k=4, base=.55)
    p.ponto(15, B - 9, '#e0f8e0')
    p.ponto(15, B - 8, '#c0e8c0')
    return p.render()


def lata(f=0):
    p = novo()
    m = p.m()
    poligono(m, [(11, B), (21, B), (22, B - 4), (19, B - 5), (21, B - 9), (11, B - 9), (13, B - 5), (10, B - 4)])
    p.add(m, METAL, k=3)
    m2 = p.m()
    m2[B - 7:B - 3, 10:23] = True
    p.add(m2 & m, r_(['#4a0a08', '#8a1a14', '#c83a28', '#e86a4a'], 4), k=2)
    return p.render()


def pneu(f=0):
    p = novo()
    m = p.m()
    elipse(m, 16, B - 5, 12, 5.5)
    furo = p.m()
    elipse(furo, 16, B - 6, 5, 2)
    p.add(m & ~furo, BORRACHA, k=3, tex=((np.mgrid[0:H, 0:W][1] % 3) == 0) * -.15)
    return p.render()


def sacola(f=0):
    p = novo()
    m = p.m()
    vento = math.sin(f * 2 * math.pi) * 1.5
    poligono(m, [(9, B), (23, B), (22 + vento, B - 6), (25 + vento * 1.5, B - 9), (20 + vento, B - 8),
                 (16 + vento, B - 11), (12 + vento, B - 8), (8 + vento, B - 9), (10, B - 5)])
    p.add(m, r_(['#6a6e66', '#9aa096', '#c4c8bc', '#e4e6dc', '#f8f8f0']), k=2.5, base=.6)
    return p.render()


def saco_preto(f=0):
    p = novo()
    m = p.m()
    elipse(m, 16, B - 5.5, 9, 6)
    poligono(m, [(14, B - 10), (18, B - 10), (19, B - 14), (16, B - 12), (13, B - 14)])
    p.add(m, r_(['#020203', '#0a0a0e', '#16161c', '#262630', '#3e3e4c']), k=4, base=.45)
    p.ponto(11, B - 8, '#5a5a6a')
    return p.render()


def isopor(f=0):
    p = novo()
    m = p.m()
    poligono(m, [(5, B), (27, B), (27, B - 8), (20, B - 9), (17, B - 6), (13, B - 9), (5, B - 8)])
    p.add(m, ISOPOR, k=2.5, base=.5, tex=pp.ruido2(np.random.default_rng(4), H, W, 1) * .25)
    return p.render()


def tambor(f=0):
    p = novo()
    m = p.m()
    m[B - 15:B + 1, 9:23] = True
    elipse(m, 16, B - 15, 7, 1.5)
    p.add(m, FERRUGEM, k=3, tex=(((np.mgrid[0:H, 0:W][0] - (B - 10)) % 5) == 0) * -.3)
    poca = p.m()
    elipse(poca, 22 + f * 2, B, 4 + f * 3, 1.2)
    p.add(poca, OLEO, k=1)
    for k in range(int(1 + f * 3)):
        p.ponto(22, B - 9 + k * 2 + int(f * 2), '#08080a')
    p.ponto(23 + f * 3, B, '#4a3a5a')
    return p.render()


def cano(f=0):
    p = novo()
    m = p.m()
    capsula(m, 4, B - 3, 24, B - 5, 3, 3)
    elipse(m, 24.5, B - 5, 1.6, 3.4)
    p.add(m, r_(['#2a2a2a', '#4a4844', '#6e6a62', '#948e84', '#b8b2a6']), k=3)
    boca = p.m()
    elipse(boca, 25, B - 5, .9, 2.2)
    p.add(boca, OLEO, k=1)
    return p.render()


def sapato(f=0):
    p = novo()
    m = p.m()
    poligono(m, [(7, B), (25, B), (26, B - 3), (21, B - 5), (16, B - 5), (14, B - 9), (9, B - 9), (7, B - 4)])
    p.add(m, COURO, k=3)
    sola = p.m()
    sola[B - 1:B + 1, 7:26] = True
    p.add(sola & m, r_(['#1a1612', '#3a3228', '#5a5040'], 3), k=1)
    return p.render()


def chapa(f=0):
    p = novo()
    m = p.m()
    poligono(m, [(3, B), (28, B), (26, B - 4), (6, B - 6)])
    p.add(m, FERRUGEM, k=2, tex=pp.ruido2(np.random.default_rng(7), H, W, 2) * .5)
    return p.render()


def galao(f=0):
    p = novo()
    m = p.m()
    poligono(m, [(9, B), (22, B), (22, B - 10), (19, B - 13), (11, B - 13), (9, B - 10)])
    capsula(m, 19, B - 13, 19, B - 15, 1.4, 1.4)
    p.add(m, PLAST_AZUL, k=3)
    m2 = p.m()
    capsula(m2, 11, B - 11, 16, B - 11, .6, .6)
    p.add(m2, r_(['#0e1a2a', '#1e3450'], 2), k=1)
    return p.render()


# ---------------------------------------------------------------- vida
def folhas_caidas(f=0):
    p = novo()
    rng = np.random.default_rng(11)
    for k in range(5):
        m = p.m()
        x = 6 + k * 4.5 + rng.uniform(-1, 1)
        pz_ang = rng.uniform(-.5, .5)
        elipse(m, x, B - 1, 3, 1.3, pz_ang)
        p.add(m, SECA if k % 2 else r_(['#3a1a0a', '#7a3a14', '#b05a20', '#d88a3a', '#f0b060']), k=2)
    return p.render()


def cogumelos(f=0):
    p = novo()
    for x, h, r in ((11, 6, 3.4), (17, 4, 2.4), (21, 3, 1.8)):
        m = p.m()
        capsula(m, x, B, x, B - h, .9, .8)
        p.add(m, r_(['#8a8478', '#c8c0b0', '#ece6d8'], 3), k=2)
        m = p.m()
        elipse(m, x, B - h - .5, r, r * .6)
        m &= np.mgrid[0:H, 0:W][0] <= B - h + .5
        p.add(m, r_(['#4a1a0e', '#8a3018', '#c8502a', '#e8804a', '#f8b080']), k=3)
        p.ponto(x - 1, B - h - 1, '#fff0e0')
    return p.render()


def samambaia_chao(f=0):
    img = np.zeros((H, W, 4), np.uint8)
    rng = np.random.default_rng(int(f * 10) + 3)
    g = pp.rampa(['#0c2410', '#1a4418', '#2c6820', '#478a26', '#6aa82e', '#9cc84a'], 6)
    pp.samambaia(img, rng, 16 + math.sin(f * 6.28) * .5, B, g, 9)
    return img


def flores(f=0):
    img = np.zeros((H, W, 4), np.uint8)
    rng = np.random.default_rng(5)
    g = MUSGO
    sw = math.sin(f * 6.28)
    for x, h, c in ((9, 6, '#e890b8'), (14, 9, '#f0d89a'), (19, 7, '#48d9a8'), (24, 5, '#c890e0')):
        for j in range(h):
            px(img, x + (sw * .6 if j > h * .6 else 0), B - j, g[1] if j % 3 else g[2])
        px(img, x - 1, B - 2, g[2])
        pp.flor(img, x + sw * .6, B - h, C(c), rng, grande=True)
    return img


def broto(f=0):
    img = np.zeros((H, W, 4), np.uint8)
    g = pp.rampa(['#0c2410', '#1a4418', '#2c6820', '#478a26', '#6aa82e', '#9cc84a'], 6)
    for dx in (0, 7):
        pp.broto(img, 13 + dx, B + 1, g)
    p = novo()
    return img


def pedras_musgo(f=0):
    p = novo()
    for x, rx, ry in ((11, 6, 4), (20, 4.5, 3), (25, 2.5, 1.8)):
        m = p.m()
        elipse(m, x, B - ry + 1, rx, ry)
        m &= np.mgrid[0:H, 0:W][0] <= B
        p.add(m, PEDRA, k=3)
        mm = p.m()
        elipse(mm, x - 1, B - ry * 2 + 1.5, rx * .8, 1.6)
        p.add(mm & m, MUSGO, k=2, base=.6)
    return p.render()


def tronquinho(f=0):
    p = novo()
    m = p.m()
    capsula(m, 4, B - 3.5, 26, B - 3, 3.5, 3.2)
    p.add(m, MADEIRA, k=3, tex=pp.ruido2(np.random.default_rng(2), H, W, 4, 1) * .4)
    face = p.m()
    elipse(face, 26.5, B - 3, 1.4, 3.2)
    p.add(face & m, r_(['#664424', '#a07a4a', '#c8a070'], 3), k=1)
    mm = p.m()
    capsula(mm, 6, B - 6.5, 20, B - 6.3, 1.2, 1.2)
    p.add(mm, MUSGO, k=2, base=.65)
    return p.render()


def vitoria_regia(f=0):
    p = novo()
    m = p.m()
    elipse(m, 14, B - 1.5, 10, 2.2)
    poligono(m, [(14, B - 1.5), (23, B - 3), (24, B)])
    m2 = p.m()
    poligono(m2, [(14, B - 1.5), (24, B - 3.5), (24, B - 1)])
    p.add(m & ~m2, r_(['#0e3a1a', '#1e6a2a', '#3a9a3a', '#6ac84a', '#a8e870']), k=2.5, base=.55)
    mb = p.m()
    elipse(mb, 14, B - 3.2, 9.5, 1)
    p.add(mb & m, r_(['#6a1a2a', '#a83a4a', '#d8607a'], 3), k=1)
    for dx, dy, c in ((0, -6, '#fff4f8'), (-1, -5, '#f8c8d8'), (1, -5, '#f8c8d8'), (-2, -4, '#f0a8c0'),
                      (2, -4, '#f0a8c0'), (0, -5, '#ffe0a0')):
        p.ponto(13 + dx, B + dy, c)
    return p.render()


def bromelia_chao(f=0):
    img = np.zeros((H, W, 4), np.uint8)
    rng = np.random.default_rng(8)
    g = pp.rampa(['#0c2410', '#1a4418', '#2c6820', '#478a26', '#6aa82e', '#9cc84a'], 6)
    pp.bromelia(img, rng, 16, B, g, C('#d84860'))
    return img


def semente(f=0):
    p = novo()
    m = p.m()
    elipse(m, 14, B - 3, 4, 3)
    p.add(m, r_(['#2a1608', '#5a3014', '#8a4e22', '#b47236', '#d89a58']), k=3)
    m2 = p.m()
    capsula(m2, 14, B - 6, 16, B - 11, .7, .5)
    elipse(m2, 18, B - 11.5, 2.4, 1.2, -.4)
    elipse(m2, 14, B - 10.5, 2, 1, .5)
    p.add(m2, FOLHA, k=2)
    return p.render()


def toco_cogumelo(f=0):
    p = novo()
    m = p.m()
    m[B - 9:B + 1, 10:21] = True
    capsula(m, 10, B, 6, B, 1.5, .8)
    capsula(m, 21, B, 25, B, 1.5, .8)
    p.add(m, MADEIRA, k=3, tex=(((np.mgrid[0:H, 0:W][1]) % 3) == 0) * -.2)
    topo = p.m()
    topo[B - 10:B - 8, 10:21] = True
    p.add(topo, r_(['#664424', '#a07a4a', '#c8a070'], 3), k=1)
    for x, y in ((21, B - 6), (22, B - 4)):
        mc = p.m()
        elipse(mc, x + 1.5, y, 2.4, 1)
        p.add(mc, r_(['#8a6a3a', '#c8a060', '#f0d090'], 3), k=1)
    return p.render()


def ninho(f=0):
    p = novo()
    m = p.m()
    elipse(m, 16, B - 2.5, 8, 3)
    p.add(m, SECA, k=2, tex=(((np.mgrid[0:H, 0:W][1] + np.mgrid[0:H, 0:W][0]) % 2) == 0) * -.25)
    for x in (13.5, 16.5, 19):
        mo = p.m()
        elipse(mo, x, B - 5, 1.5, 1.9)
        p.add(mo, r_(['#7a9aa0', '#b0d0d4', '#e0f4f4'], 3), k=1)
    return p.render()


LIXO = [('garrafa-pet', garrafa_pet, 1), ('garrafa-vidro', garrafa_vidro, 1), ('lata', lata, 1),
        ('pneu', pneu, 1), ('sacola', sacola, 3), ('saco-preto', saco_preto, 1), ('isopor', isopor, 1),
        ('tambor', tambor, 3), ('cano', cano, 1), ('sapato', sapato, 1), ('chapa', chapa, 1), ('galao', galao, 1)]
VIDA = [('folhas-caidas', folhas_caidas, 1), ('cogumelos', cogumelos, 1), ('samambaia', samambaia_chao, 3),
        ('flores', flores, 3), ('broto', broto, 1), ('pedras-musgo', pedras_musgo, 1),
        ('tronquinho', tronquinho, 1), ('vitoria-regia', vitoria_regia, 1), ('bromelia', bromelia_chao, 1),
        ('semente', semente, 1), ('toco-cogumelo', toco_cogumelo, 1), ('ninho', ninho, 1)]


def folha(nome, itens):
    cols = max(n for _, _, n in itens)
    atlas = np.zeros((H * len(itens), W * cols, 4), np.uint8)
    meta = {'celula': [W, H], 'pivo': [W // 2, H - 1], 'escala': 2, 'itens': {}}
    for lin, (n, fn, q) in enumerate(itens):
        for i in range(q):
            atlas[lin * H:(lin + 1) * H, i * W:(i + 1) * W] = fn(i / q)
        meta['itens'][n] = {'linha': lin, 'quadros': q, 'fps': 4 if q > 1 else 0}
    os.makedirs(SAIDA, exist_ok=True)
    Image.fromarray(atlas).save(os.path.join(SAIDA, f'{nome}.png'))
    with open(os.path.join(SAIDA, f'{nome}.json'), 'w', encoding='utf-8') as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=1)
    return atlas


def main():
    lixo, vida = folha('lixo', LIXO), folha('vida', VIDA)
    # prévia: lixo sobre o chão poluído, vida sobre o restaurado, par a par
    Z = 4
    chao_p = Image.open(os.path.join(AQUI, 'pixel', 'raizes', 'chao.png'))
    linhas = []
    for estado, atlas, itens in (('p', lixo, LIXO), ('r', vida, VIDA)):
        fundo = Image.new('RGBA', (len(itens) * W, H + 20), (30, 34, 42, 255) if estado == 'p' else (22, 44, 52, 255))
        r = 0 if estado == 'p' else 1
        for k in range(len(itens) * W // 32 + 1):
            fundo.alpha_composite(chao_p.crop((32, r * 48 + 16 - 1, 64, r * 48 + 16 + 19)), (k * 32, H))
        for i in range(len(itens)):
            fundo.alpha_composite(Image.fromarray(atlas[i * H:(i + 1) * H, 0:W]), (i * W, 1))
        linhas.append(fundo)
    out = Image.new('RGBA', (linhas[0].width, sum(l.height for l in linhas) + 4), (12, 12, 14, 255))
    out.paste(linhas[0], (0, 0))
    out.paste(linhas[1], (0, linhas[0].height + 4))
    out.resize((out.width * Z, out.height * Z), Image.NEAREST).save(os.path.join(AQUI, 'pixel', '_previa', 'itens.png'))
    print('ok')


if __name__ == '__main__':
    main()
