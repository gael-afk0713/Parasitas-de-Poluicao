"""Prepara as silhuetas de cenário (geradas por IA) para o jogo.

Uso:  python fase2/arte/preparar-cenario.py
Lê    fase2/arte/cenario/fontes/<nome>.jpg  (silhueta preta sobre branco,
                                              Cloudflare Workers AI)
      ou fontes/<nome>.png                  (idem, gerada no Canva)
Grava fase2/arte/cenario/<nome>.png         (máscara: branco + alfa, recortada)
e imprime o tamanho de cada uma.

Por que máscara e não a imagem pronta: cada plano do parallax é pintado com
a cor do TEMA da área, interpolada pela pureza (a sala muda de cor ao ser
restaurada). Uma imagem colorida ficaria parada na cor errada. A máscara é
tingida em tempo de jogo (`render/silhuetas.js`) com a cor do plano.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

PASTA = Path(__file__).resolve().parent / 'cenario'

# Lado maior da máscara em px. O jogo desenha bem menor que isso na maior
# parte do tempo; o teto é o plano de perto numa tela de DPR 2.
TAMANHO = {
    'arvore-morta-1': 600, 'arvore-morta-2': 600,
    'arvore-viva-1': 600, 'arvore-viva-2': 600,
    'ruinas': 1100,
    'galho-morto': 800, 'galho-vivo': 800,
    'moita': 1100,
    # Várzea (fontes do Canva, em .png)
    'buriti-morto': 600, 'buriti-vivo': 600,
    'cano': 1100,
    'junco-seco': 800, 'junco-vivo': 800,
    'aguape': 1100,
}

# Engorda (px da FONTE, filtro de máximo) antes de reduzir. A IA desenha
# galho de 1-2 px; reduzido a ~0,3 no jogo ele virava fio cinza serrilhado,
# longe da massa chapada das formas procedurais (design-reviewer).
ENGORDA = {
    'arvore-morta-1': 5, 'arvore-morta-2': 5,
    'arvore-viva-1': 5, 'arvore-viva-2': 5,
    'galho-morto': 7, 'galho-vivo': 5,
    'buriti-morto': 5, 'buriti-vivo': 3,
    'junco-seco': 7, 'junco-vivo': 3,
}

# Ruínas: a fonte tem uma laje preta chapada na base (lia como barra, não
# chão). Sai tudo abaixo da linha onde o desenho vira faixa cheia.
SEM_LAJE = {'ruinas'}


def main():
    for nome, lado in TAMANHO.items():
        fonte = PASTA / 'fontes' / f'{nome}.jpg'
        if not fonte.exists():
            fonte = fonte.with_suffix('.png')      # as do Canva vêm em png
        im = Image.open(fonte).convert('L')
        a = 255 - np.asarray(im).astype(float)            # preto = opaco
        a = np.clip((a - 24) * 255 / 200, 0, 255)          # o branco do jpeg sai
        if nome in SEM_LAJE:
            cheia = np.flatnonzero((a > 128).mean(1) > 0.9)
            if len(cheia):
                a[cheia[0] + 6:] = 0          # 6 px de base pra não flutuar
        if nome in ENGORDA:
            k = ENGORDA[nome] | 1
            a = np.asarray(Image.fromarray(a.astype(np.uint8))
                           .filter(ImageFilter.MaxFilter(k))).astype(float)
        # A IA deixa uma moldura cinza-clara nas bordas de algumas imagens:
        # só fica o que é escuro de verdade.
        mask = Image.fromarray(a.astype(np.uint8))
        bbox = Image.fromarray(((a > 90) * 255).astype(np.uint8)).getbbox()
        mask = mask.crop(bbox)
        k = lado / max(mask.size)
        mask = mask.resize((round(mask.width * k), round(mask.height * k)), Image.LANCZOS)
        branco = Image.new('L', mask.size, 255)
        Image.merge('LA', (branco, mask)).save(PASTA / f'{nome}.png', optimize=True)
        print(f'{nome}.png: {mask.width}x{mask.height}')


if __name__ == '__main__':
    main()
