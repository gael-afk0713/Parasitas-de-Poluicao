"""Prepara os sprites dos parasitas (arte por IA) para o jogo.

Uso:  python fase2/arte/preparar-parasitas.py
Lê    fase2/arte/parasitas/<espécie>.png  (um recorte RGBA por espécie)
Grava fase2/arte/parasitas.png            (atlas: uma linha por espécie,
                                           QUADROS colunas de animação)
e imprime as constantes que `fase2/entidades/parasitas-sprite.js` usa.

Por que os quadros saem daqui e não da IA:
- A IA (Cloudflare Workers AI, sem imagem de referência) não repete a mesma
  criatura entre gerações, nem dentro de uma folha: pedida uma tira de poses,
  ela muda o desenho a cada quadro. Então a IA dá UM desenho por espécie e a
  animação é deformação dele (manto ondulando, respiração, onda do rastejar),
  que fica idêntica de quadro pra quadro por construção.

O que a limpeza faz:
- Escurece o corpo: a IA desenhou cinza-carvão com textura, e o parasita é um
  BURACO no mundo (ARQUITETURA.md). Só a fenda do olho continua branca.
- Tira a cor: as rachaduras laranja do Estopim acendiam o tempo todo, e luz
  no parasita é PERIGO (só no telégrafo, que é do código).
- Apaga o fio do Tecelão (o código já desenha o fio, que vai até o teto), o
  pavio e a tampa do Estopim (bomba de desenho animado: a leitura "vai
  estourar" é o corpo inchando no telégrafo) e os canos do Cuspidor (liam
  como bule/máquina; o parasita é buraco no mundo, não fábrica).
- Olho é só a MAIOR mancha branca (as garras claras do Tecelão passavam por
  olho). O Estopim veio sem olho nenhum, e a fenda é a âncora da espécie:
  ele ganha uma pintada aqui (OLHO_PINTADO).
- Tira pontinhos soltos (fumaça que sobrou do recorte).
"""
import math
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

PASTA = Path(__file__).resolve().parent
ORIGEM = PASTA / 'parasitas'
DESTINO = PASTA / 'parasitas.png'

QUADROS = 6
DENSIDADE = 2.5   # px de atlas por px de mundo (cobre tela de DPR 2 com folga)
FOLGA = 6         # px transparentes em volta (a deformação precisa de espaço)

# Altura na tela (px de mundo) e onde fica o pivô: 'pe' = meio da base,
# 'centro' = meio do desenho. Calibrado contra a silhueta em código, pra não
# mudar a leitura das salas nem a caixa de dano.
ESPECIES = {
    'errante':    {'altura': 36, 'pivo': 'pe'},
    'espreita':   {'altura': 28, 'pivo': 'centro'},
    'cuspidor':   {'altura': 36, 'pivo': 'pe'},
    'rastejante': {'altura': 15, 'pivo': 'pe'},
    'estopim':    {'altura': 32, 'pivo': 'pe'},
    'tecelao':    {'altura': 40, 'pivo': 'centro'},
}

LIMIAR_OLHO = 175   # luminância da fenda (o resto vira corpo escuro)
# Corte do topo: linhas mais estreitas que esta fração do corpo saem (fio, pavio).
CORTE_TOPO = {'tecelao': 0.12, 'estopim': 0.30}
# Abertura morfológica (tamanho do filtro, px do recorte) só na metade de cima:
# apaga apêndices finos (os canos do Cuspidor) e preserva a corcunda. Cortar
# por linha, como no fio, achatava o topo do corpo junto.
ABRIR_TOPO = {'cuspidor': 91}
# Corpo recortado na esfera ajustada pela largura: tira o que sobrou da tampa
# do Estopim sem achatar o topo.
ESFERA = {'estopim'}
# Rachaduras alisadas (raio do desfoque na luminância, px do recorte): no
# Estopim elas faziam dele um objeto fabricado — bomba —, não um buraco.
ALISAR = {'estopim': 7}
# Engorda horizontal: o Tecelão a 1x tinha um tronco de ~8 px e lia como antena.
ALARGAR = {'tecelao': 1.4}
# Fenda pintada: centro (fração do desenho), meia-largura/altura e giro.
OLHO_PINTADO = {'estopim': (0.66, 0.42, 0.055, 0.12, -0.35)}


def componentes(mask):
    """Rótulos 4-conexos (BFS; as imagens aqui já estão pequenas)."""
    H, W = mask.shape
    lab = np.zeros((H, W), np.int32)
    n = 0
    for y0, x0 in zip(*np.nonzero(mask)):
        if lab[y0, x0]:
            continue
        n += 1
        lab[y0, x0] = n
        fila = deque([(y0, x0)])
        while fila:
            y, x = fila.popleft()
            for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= yy < H and 0 <= xx < W and mask[yy, xx] and not lab[yy, xx]:
                    lab[yy, xx] = n
                    fila.append((yy, xx))
    return lab, n


def limpar(nome, im):
    a = np.asarray(im.convert('RGBA')).astype(float)
    if nome in CORTE_TOPO:
        # Linhas do topo em que o desenho é estreito (fio, pavio): corta até a
        # primeira linha "de corpo".
        larg = (a[..., 3] > 128).sum(1)
        corpo = np.flatnonzero(larg > larg.max() * CORTE_TOPO[nome])
        a[:corpo[0]] = 0
    if nome in ABRIR_TOPO:
        m = Image.fromarray((a[..., 3] > 64).astype(np.uint8) * 255)
        t = ABRIR_TOPO[nome]
        aberto = np.asarray(m.filter(ImageFilter.MinFilter(t)).filter(ImageFilter.MaxFilter(t))) > 0
        ys = np.flatnonzero((a[..., 3] > 64).any(1))
        meio = ys[0] + (ys[-1] - ys[0]) * 0.5
        topo = np.arange(a.shape[0])[:, None] < meio
        a[topo & ~aberto] = 0
    if nome in ESFERA:
        larg = (a[..., 3] > 128).sum(1)
        ys, xs = np.nonzero(a[..., 3] > 128)
        r = larg.max() / 2
        cx, cy = (xs.min() + xs.max()) / 2, ys.max() - r
        yy, xx = np.mgrid[0:a.shape[0], 0:a.shape[1]]
        a[(xx - cx) ** 2 + (yy - cy) ** 2 > (r + 1) ** 2] = 0
    lab, n = componentes(a[..., 3] > 64)
    if n > 1:
        tam = np.bincount(lab.ravel())[1:]
        manter = np.flatnonzero(tam >= tam.max() * 0.04) + 1
        a[~np.isin(lab, manter)] = 0
    L = a[..., :3] @ np.array([0.299, 0.587, 0.114])
    if nome in ALISAR:
        borrado = np.asarray(Image.fromarray(np.clip(L, 0, 255).astype(np.uint8))
                             .filter(ImageFilter.GaussianBlur(ALISAR[nome]))).astype(float)
        L = np.where(L > LIMIAR_OLHO, L, np.minimum(borrado, LIMIAR_OLHO - 1))
    branco = (L > LIMIAR_OLHO) & (a[..., 3] > 200)
    lab, n = componentes(branco)
    olho = np.zeros_like(branco)
    if n and nome not in OLHO_PINTADO:
        olho = lab == np.bincount(lab.ravel())[1:].argmax() + 1
    if nome in OLHO_PINTADO:
        ys, xs = np.nonzero(a[..., 3] > 128)
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        fx, fy, rx, ry, giro = OLHO_PINTADO[nome]
        ox, oy = x0 + fx * (x1 - x0), y0 + fy * (y1 - y0)
        rx, ry = rx * (x1 - x0), ry * (y1 - y0)
        yy, xx = np.mgrid[0:a.shape[0], 0:a.shape[1]]
        c, s_ = math.cos(giro), math.sin(giro)
        dx, dy = xx - ox, yy - oy
        olho = ((dx * c + dy * s_) / rx) ** 2 + ((-dx * s_ + dy * c) / ry) ** 2 <= 1
    # Corpo: cinza neutro escuro com o volume da pintura guardado (0..62).
    cinza = np.clip(L * 0.30, 0, 62)
    rgb = np.where(olho[..., None], 245.0, cinza[..., None].repeat(3, 2))
    out = np.dstack([rgb, a[..., 3]]).astype(np.uint8)
    img = Image.fromarray(out, 'RGBA')
    return img.crop(img.getbbox())


def amostrar(src, mx, my):
    """Bilinear com alfa pré-multiplicado (não vaza cor escura na borda)."""
    H, W = src.shape[:2]
    pm = src.copy()
    pm[..., :3] *= pm[..., 3:4] / 255
    x0 = np.floor(mx).astype(int); y0 = np.floor(my).astype(int)
    fx = (mx - x0)[..., None]; fy = (my - y0)[..., None]
    def px(yy, xx):
        ok = (xx >= 0) & (xx < W) & (yy >= 0) & (yy < H)
        v = pm[np.clip(yy, 0, H - 1), np.clip(xx, 0, W - 1)]
        return v * ok[..., None]
    v = (px(y0, x0) * (1 - fx) * (1 - fy) + px(y0, x0 + 1) * fx * (1 - fy)
         + px(y0 + 1, x0) * (1 - fx) * fy + px(y0 + 1, x0 + 1) * fx * fy)
    al = v[..., 3:4]
    rgb = np.where(al > 0, v[..., :3] * 255 / np.maximum(al, 1e-6), 0)
    return np.dstack([rgb, al[..., 0]])


def deformar(nome, src, f):
    """Quadro `f` da animação: mapa inverso (de onde cada pixel vem)."""
    H, W = src.shape[:2]
    ph = 2 * math.pi * f / QUADROS
    yy, xx = np.mgrid[0:H, 0:W].astype(float)
    # coordenadas do desenho (sem a folga), u e v em 0..1
    w, h = W - 2 * FOLGA, H - 2 * FOLGA
    u = (xx - FOLGA) / w
    v = (yy - FOLGA) / h
    cx, base, meio = FOLGA + w / 2, FOLGA + h, FOLGA + h / 2
    sx = sy = 0.0
    if nome == 'errante':
        # Barra do manto ondulando (cresce pra baixo) + respiração do capuz.
        sx = 0.07 * w * v ** 2 * math.sin(ph) + 0.025 * w * v * np.sin(ph + v * 4)
        k = 0.035 * math.sin(ph)
        sy = -(base - yy) * k
    elif nome == 'espreita':
        # Gota respirando: estica em y, aperta em x, e um bambo lateral.
        k = 0.06 * math.sin(ph)
        sx = (xx - cx) * (-k * 0.8) + 0.02 * w * np.sin(ph + v * 4)
        sy = (yy - meio) * k
    elif nome == 'cuspidor':
        # Corcunda inflando devagar (o pivô no pé não sai do lugar).
        k = 0.04 * math.sin(ph)
        sx = (xx - cx) * k * 0.5
        sy = -(base - yy) * k
    elif nome == 'rastejante':
        # Onda que corre de trás pra frente pelo dorso; a barriga fica no chão.
        sy = -0.12 * h * np.sin(ph - u * 2 * math.pi) * (1 - v)
        sx = 0.02 * w * math.sin(ph)
    elif nome == 'estopim':
        # Pulso lento da esfera (o inchar de verdade é o telégrafo, em código).
        k = 0.035 * math.sin(ph)
        sx = (xx - cx) * k
        sy = -(base - yy) * k
    elif nome == 'tecelao':
        # Balanço de pêndulo em volta do topo, onde entra o fio.
        sx = (yy - FOLGA) * 0.07 * math.sin(ph)
    return amostrar(src, xx - sx, yy - sy)


def main():
    linhas, dados, y = [], {}, 0
    for nome, cfg in ESPECIES.items():
        img = limpar(nome, Image.open(ORIGEM / f'{nome}.png'))
        alvo = round(cfg['altura'] * DENSIDADE)
        img = img.resize((max(1, round(img.width * alvo / img.height * ALARGAR.get(nome, 1))), alvo),
                         Image.LANCZOS)
        W, H = img.width + 2 * FOLGA, img.height + 2 * FOLGA
        src = np.zeros((H, W, 4))
        src[FOLGA:FOLGA + img.height, FOLGA:FOLGA + img.width] = np.asarray(img)
        quadros = [deformar(nome, src, f) for f in range(QUADROS)]
        pivoX = W / 2
        pivoY = FOLGA + img.height if cfg['pivo'] == 'pe' else FOLGA + img.height / 2
        olhos = []
        for q in quadros:
            m = (q[..., 0] > 200) & (q[..., 3] > 200)
            ys, xs = np.nonzero(m)
            olhos.append((round(xs.mean() - pivoX, 1), round(ys.mean() - pivoY, 1)))
        m0 = (quadros[0][..., 0] > 200) & (quadros[0][..., 3] > 200)
        ys, xs = np.nonzero(m0)
        raio = (round((xs.max() - xs.min() + 1) / 2, 1), round((ys.max() - ys.min() + 1) / 2, 1))
        linha = np.concatenate(quadros, 1)
        linhas.append(linha)
        dados[nome] = dict(y=y, w=W, h=H, pivoX=round(pivoX, 1), pivoY=round(pivoY, 1),
                           escala=round(1 / DENSIDADE, 4), olhos=olhos, olhoR=raio)
        y += H
    largura = max(l.shape[1] for l in linhas)
    atlas = np.zeros((y, largura, 4))
    yy = 0
    for l in linhas:
        atlas[yy:yy + l.shape[0], :l.shape[1]] = l
        yy += l.shape[0]
    Image.fromarray(np.clip(atlas, 0, 255).astype(np.uint8), 'RGBA').save(DESTINO, optimize=True)
    for n, d in dados.items():
        assert max(d['olhoR']) < 12, f'{n}: olho grande demais, confira a máscara'
    print(f'{DESTINO.name}: {largura}x{y}, {QUADROS} quadros')
    print('const QUADROS =', QUADROS, ';')
    print('const ESPECIES = {')
    for n, d in dados.items():
        olhos = ', '.join(f'[{a}, {b}]' for a, b in d['olhos'])
        print(f"  {n}: {{ y: {d['y']}, w: {d['w']}, h: {d['h']}, pivoX: {d['pivoX']}, "
              f"pivoY: {d['pivoY']}, escala: {d['escala']},\n"
              f"    olhoR: [{d['olhoR'][0]}, {d['olhoR'][1]}], olhos: [{olhos}] }},")
    print('};')


if __name__ == '__main__':
    main()
