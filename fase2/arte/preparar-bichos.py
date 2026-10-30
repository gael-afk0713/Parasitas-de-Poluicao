"""Prepara os bichos parados do cenário (silhuetas geradas no Canva).

Uso:  python fase2/arte/preparar-bichos.py
Lê    fase2/arte/bichos/fontes/<folha>.png  (silhuetas pretas sobre branco,
                                             soltas, sem grade regular)
Grava fase2/arte/bichos/<folha>.png         (atlas: branco + alfa)
e imprime os retângulos de cada bicho pra colar em `render/bichos.js`.

As peças são achadas por COMPONENTE CONEXO (a IA não respeita grade), numa
cópia reduzida e engordada da máscara — senão a cauda listrada do quati ou
a asa aberta do urubu viravam peças soltas. Nos pendurados, o galho em que
a IA os desenhou é cortado: no jogo eles pendem da borda de baixo do
terreno, e o galho flutuaria.
"""
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

PASTA = Path(__file__).resolve().parent / 'bichos'
FOLHAS = ['bichos', 'urubus', 'pendurados']
LADO = 96
VAO = 2
RED = 4          # fator de redução pra rotular


def componentes(m):
    """Caixas [x0, y0, x1, y1] (na escala de `m`) de cada componente."""
    h, w = m.shape
    vis = np.zeros_like(m, dtype=bool)
    caixas = []
    for y in range(h):
        for x in range(w):
            if not m[y, x] or vis[y, x]:
                continue
            fila = deque([(y, x)]); vis[y, x] = True
            x0 = x1 = x; y0 = y1 = y; n = 0
            while fila:
                cy, cx = fila.popleft(); n += 1
                x0, x1, y0, y1 = min(x0, cx), max(x1, cx), min(y0, cy), max(y1, cy)
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and m[ny, nx] and not vis[ny, nx]:
                        vis[ny, nx] = True; fila.append((ny, nx))
            if n > 20:
                caixas.append([x0, y0, x1 + 1, y1 + 1])
    return caixas


def main():
    for nome in FOLHAS:
        im = Image.open(PASTA / 'fontes' / f'{nome}.png').convert('L')
        a = 255 - np.asarray(im).astype(float)
        a = np.clip((a - 24) * 255 / 200, 0, 255).astype(np.uint8)
        peq = Image.fromarray(a).resize((a.shape[1] // RED, a.shape[0] // RED))
        peq = np.asarray(peq.filter(ImageFilter.MaxFilter(3))) > 60
        caixas = componentes(peq)
        # Ordem de leitura: linha (por faixa de 1/4 da altura), depois x.
        caixas.sort(key=lambda c: (c[1] * 4 // peq.shape[0], c[0]))
        pecas = []
        for c in caixas:
            x0, y0, x1, y1 = (v * RED for v in c)
            m = a[y0:y1, x0:x1].copy()
            if nome == 'pendurados':
                # Corta o galho: a última linha quase cheia no terço de cima
                # (o galho é mais largo que o bicho), e mais 4.
                cheia = (m > 128).mean(1)
                topo = [i for i in range(len(cheia) // 3) if cheia[i] > 0.6]
                if topo:
                    m = m[topo[-1] + 4:]
            bbox = Image.fromarray(((m > 90) * 255).astype(np.uint8)).getbbox()
            p = Image.fromarray(m).crop(bbox)
            k = LADO / max(p.size)
            pecas.append(p.resize((max(1, round(p.width * k)), max(1, round(p.height * k))),
                                  Image.LANCZOS))
        larg = sum(p.width + VAO for p in pecas)
        atlas = Image.new('L', (larg, LADO), 0)
        rects, x = [], 0
        for p in pecas:
            # Pendurados encostam em CIMA (o ponto de apoio); o resto embaixo.
            y = 0 if nome == 'pendurados' else LADO - p.height
            atlas.paste(p, (x, y))
            rects.append((x, y, p.width, p.height))
            x += p.width + VAO
        Image.merge('LA', (Image.new('L', atlas.size, 255), atlas)).save(
            PASTA / f'{nome}.png', optimize=True)
        print(f'{nome}.png {larg}x{LADO} ({len(rects)} peças)')
        print(f'  {nome}: [' + ', '.join(f'[{r[0]}, {r[1]}, {r[2]}, {r[3]}]' for r in rects) + '],')


if __name__ == '__main__':
    main()
