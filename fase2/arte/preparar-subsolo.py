"""Prepara as silhuetas do fundo subterrâneo (geradas no Canva) para o jogo.

Uso:  python fase2/arte/preparar-subsolo.py
Lê    fase2/arte/subsolo/<nome>-canva.png   (silhueta preta sobre branco)
Grava fase2/arte/subsolo/<nome>.png         (máscara: branco + alfa)
e imprime os pontos de fungo que `fase2/render/subsolo.js` usa.

Por que máscara e não a imagem pronta: o fundo de cada área é pintado com as
cores do TEMA, que são interpoladas pela pureza (a sala muda de cor ao ser
restaurada). Uma imagem colorida ficaria parada na cor errada. A máscara é
pintada em tempo de jogo com a cor do plano (ver `tingir` em subsolo.js).
"""
from pathlib import Path

import numpy as np
from PIL import Image

PASTA = Path(__file__).resolve().parent / 'subsolo'
LARGURA = {'raizes': 900}   # px da máscara (o plano desenha menor)
PONTOS_FUNGO = 14


def main():
    rng = np.random.default_rng(7)
    for nome, larg in LARGURA.items():
        im = Image.open(PASTA / f'{nome}-canva.png').convert('L')
        a = 255 - np.asarray(im).astype(float)            # preto = opaco
        a = np.clip((a - 20) * 255 / 215, 0, 255)          # branco sujo do jpeg sai
        mask = Image.fromarray(a.astype(np.uint8))
        mask = mask.crop(mask.getbbox())
        alt = round(mask.height * larg / mask.width)
        mask = mask.resize((larg, alt), Image.LANCZOS)
        branco = Image.new('L', mask.size, 255)
        Image.merge('LA', (branco, mask)).save(PASTA / f'{nome}.png', optimize=True)
        print(f'{nome}.png: {larg}x{alt}')
        if nome == 'raizes':
            # Fungo pousa na raiz: pontos opacos sorteados abaixo do tronco
            # (o terço de cima é a massa onde as raízes saem do teto).
            m = np.asarray(mask) > 200
            ys, xs = np.nonzero(m[alt // 4:])
            idx = rng.choice(len(xs), PONTOS_FUNGO, replace=False)
            pts = sorted((round(xs[i] / larg, 3), round((ys[i] + alt // 4) / alt, 3)) for i in idx)
            print('const FUNGO_NAS_RAIZES = [' + ', '.join(f'[{x}, {y}]' for x, y in pts) + '];')


if __name__ == '__main__':
    main()
