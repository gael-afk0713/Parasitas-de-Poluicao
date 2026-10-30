"""Prepara os detalhes do chão (lixo e folhas caídas, gerados no Canva).

Uso:  python fase2/arte/preparar-chao.py
Lê    fase2/arte/chao/fontes/<folha>.png  (silhuetas pretas sobre branco,
                                           numa grade regular)
Grava fase2/arte/chao/<folha>.png         (atlas: branco + alfa, uma peça
                                           ao lado da outra)
e imprime os retângulos de cada peça pra colar em `render/chao.js`.

Como o cenário (`preparar-cenario.py`), cada peça é só MÁSCARA: o jogo a
tinge com a cor do terreno da área, que muda com a pureza.
"""
from pathlib import Path

import numpy as np
from PIL import Image

PASTA = Path(__file__).resolve().parent / 'chao'
# folha -> (colunas, linhas) da grade em que a IA desenhou as peças
GRADE = {'lixo': (3, 4), 'folhas': (4, 4)}
LADO = 64        # lado maior de cada peça no atlas (o jogo desenha ~10-30 px)
VAO = 2          # px entre peças, pra a filtragem não vazar pra vizinha


def main():
    for nome, (cols, lins) in GRADE.items():
        im = Image.open(PASTA / 'fontes' / f'{nome}.png').convert('L')
        a = 255 - np.asarray(im).astype(float)
        a = np.clip((a - 24) * 255 / 200, 0, 255).astype(np.uint8)
        h, w = a.shape
        pecas = []
        for j in range(lins):
            for i in range(cols):
                cel = a[j * h // lins:(j + 1) * h // lins, i * w // cols:(i + 1) * w // cols]
                bbox = Image.fromarray(((cel > 90) * 255).astype(np.uint8)).getbbox()
                if not bbox:
                    continue
                m = Image.fromarray(cel).crop(bbox)
                k = LADO / max(m.size)
                pecas.append(m.resize((max(1, round(m.width * k)), max(1, round(m.height * k))),
                                      Image.LANCZOS))
        larg = sum(p.width + VAO for p in pecas)
        atlas = Image.new('L', (larg, LADO), 0)
        rects, x = [], 0
        for p in pecas:
            # Encostadas embaixo: o pé de cada peça é a base do atlas.
            atlas.paste(p, (x, LADO - p.height))
            rects.append((x, LADO - p.height, p.width, p.height))
            x += p.width + VAO
        branco = Image.new('L', atlas.size, 255)
        Image.merge('LA', (branco, atlas)).save(PASTA / f'{nome}.png', optimize=True)
        print(f'{nome}.png {larg}x{LADO}')
        print(f'  {nome}: [' + ', '.join(f'[{r[0]}, {r[1]}, {r[2]}, {r[3]}]' for r in rects) + '],')


if __name__ == '__main__':
    main()
