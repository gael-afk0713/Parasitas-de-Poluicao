"""Prepara a folha de sprites do Guardião gerada por IA para o jogo.

Uso:  python fase2/arte/preparar-guardiao.py
Lê    fase2/arte/guardiao-folha-original.png  (6 x 4 quadros, ordem em QUADROS)
Grava fase2/arte/guardiao.png                 (atlas 6 x 4 de células iguais)
e imprime as constantes que `fase2/entidades/jogador-sprite.js` usa.

Por que existe (em vez de usar a folha crua):
- A IA NÃO respeita a grade pedida de 256 px: os pés da linha 1 caem dentro
  da linha 2 e vários quadros vazam pra célula vizinha. Cortar pela grade
  decepava pés e orelhas; aqui cada quadro é achado pelo próprio desenho
  (faixas vazias entre linhas e colunas).
- Cada quadro tem a linha de base num lugar: sem um pivô comum o personagem
  treme na tela. O pivô é o PÉ (meio do corpo em x, chão em y) nos quadros de
  chão; nos quadros de ar, o centro de massa fica à mesma altura do quadro
  parado, pra o corpo não pular de lugar ao sair do chão.
- 55% da folha é um brilho de alfa 1..49 (névoa esverdeada sobre o fundo do
  jogo). O brilho do Guardião já vem do passe emissivo em código, então ele sai.
- Folhinhas soltas, o arco do golpe e os anéis do canto, quando desenhados
  separados do corpo, saem também: o código já desenha esses efeitos no tempo
  e no alcance reais do golpe, e em dobro eles brigavam.
"""
import collections
from pathlib import Path

import numpy as np
from PIL import Image

PASTA = Path(__file__).resolve().parent
ORIGEM = PASTA / 'guardiao-folha-original.png'
DESTINO = PASTA / 'guardiao.png'

# Ordem da folha (6 por linha) — a mesma do prompt do ChatGPT.
QUADROS = [
    'parado', 'respiro', 'corrida1', 'corrida2', 'corrida3', 'corrida4',
    'agachado', 'subindo', 'apice', 'caindo', 'saltoDuplo', 'planeio',
    'ataque1', 'ataque2', 'ataque3', 'investida', 'parede', 'saltoParede',
    'canto1', 'canto2', 'canto3', 'dano', 'atordoado', 'morte',
]
# Quadros com os pés no chão: pivô y = ponto mais baixo do corpo.
NO_CHAO = {'parado', 'respiro', 'corrida1', 'corrida2', 'corrida3', 'agachado',
           'ataque1', 'ataque2', 'ataque3', 'canto1', 'canto2', 'canto3',
           'dano', 'atordoado', 'morte'}

ALFA_MIN = 40          # abaixo disso é a névoa de brilho
ESCALA_ATLAS = 0.75    # o jogo desenha o atlas a ~0,44; 0,75 cobre tela de DPR 2
FOLGA = 4              # px transparentes em volta de cada célula


def faixas(v, juntar):
    """Trechos onde `v` > 0, juntando buracos menores que `juntar`."""
    on = np.flatnonzero(v > 0)
    if not len(on):
        return []
    res, ini, ant = [], on[0], on[0]
    for i in on[1:]:
        if i - ant > juntar:
            res.append((ini, ant))
            ini = i
        ant = i
    res.append((ini, ant))
    return res


def maior_componente(mask):
    """Máscara do maior componente 8-conexo (o corpo). O que fica a mais de
    3 px dele (folhinha solta, arco do golpe) sai na limpeza — confira no
    atlas que nenhum membro destacado sumiu ao trocar de folha."""
    H, W = mask.shape
    lab = np.zeros((H, W), np.int32)
    tamanhos = [0]
    n = 0
    for y, x in zip(*np.nonzero(mask)):
        if lab[y, x]:
            continue
        n += 1
        lab[y, x] = n
        fila = collections.deque([(y, x)])
        t = 0
        while fila:
            cy, cx = fila.popleft()
            t += 1
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < H and 0 <= nx < W and mask[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = n
                        fila.append((ny, nx))
        tamanhos.append(t)
    assert n, 'quadro sem nenhum pixel opaco'
    return lab == int(np.argmax(tamanhos))


def dilatar(mask, r):
    out = mask.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dy * dy + dx * dx <= r * r:
                out |= np.roll(np.roll(mask, dy, 0), dx, 1)
    return out


def main():
    img = np.array(Image.open(ORIGEM).convert('RGBA'))
    alfa = img[..., 3]
    solido = alfa >= 128

    # 1. Acha os 24 quadros pelas faixas vazias (a grade pedida não vale).
    linhas = faixas(solido.sum(1), juntar=12)
    assert len(linhas) == 4, f'esperava 4 linhas, achei {linhas}'
    caixas = []
    for y0, y1 in linhas:
        cols = faixas(solido[y0:y1 + 1].sum(0), juntar=12)
        # Faíscas soltas viram "colunas" finas: fica com as 6 mais largas.
        cols = sorted(sorted(cols, key=lambda c: c[1] - c[0])[-6:])
        assert len(cols) == 6, f'linha {y0}-{y1}: {cols}'
        # Margem pra pegar o brilho fraco que a faixa sólida não viu.
        caixas += [(max(x0 - 24, 0), max(y0 - 24, 0), x1 + 25, y1 + 25) for x0, x1 in cols]

    # 2. Limpa cada quadro e mede o pivô.
    recortes = []
    for nome, (x0, y0, x1, y1) in zip(QUADROS, caixas):
        q = img[y0:y1, x0:x1].copy()
        assert (q[..., 3] >= 128).any(), f'quadro {nome} vazio'
        corpo = maior_componente(q[..., 3] >= 128)
        q[~dilatar(corpo, 3), 3] = 0
        a = q[..., 3].astype(float)
        lum = q[..., :3].astype(float).mean(2)
        # Brilho preso ao corpo (anéis do canto, morte) traz pixels ESCUROS
        # semitransparentes que, sobre o fundo do jogo, liam como fumaça
        # cinza. Contorno de verdade é escuro mas opaco, ou colado num opaco.
        perto_opaco = dilatar(q[..., 3] >= 200, 2)
        q[(a < 200) & (lum < 110) & ~perto_opaco, 3] = 0
        a = q[..., 3].astype(float)
        q[..., 3] = np.clip((a - ALFA_MIN) / (255 - ALFA_MIN) * 255, 0, 255).astype(np.uint8)

        # Centro pelos pixels ESCUROS do corpo (pernas, braços, olhos,
        # contorno): o rastro da investida e os anéis são claros e puxavam o
        # centro de massa pra fora do corpo.
        ys, xs = np.nonzero(corpo & (q[..., 3] >= 200) & (lum < 100))
        if len(xs) < 50:
            # Quadro todo claro (brilho forte): cai no corpo inteiro.
            print(f'aviso: {nome} quase sem pixel escuro; centro pelo corpo todo')
            ys, xs = np.nonzero(corpo)
        cx, cy = float(xs.mean()), float(ys.mean())
        recortes.append(dict(nome=nome, img=q, cx=cx, cy=cy,
                             base=float(np.nonzero(corpo)[0].max())))

    # Distância centro→pés do quadro parado: dá a altura dos quadros de ar.
    ref = recortes[0]
    centro_pes = ref['base'] - ref['cy']
    for r in recortes:
        r['px'] = r['cx']
        r['py'] = r['base'] if r['nome'] in NO_CHAO else r['cy'] + centro_pes

    # 3. Célula comum: cabe o maior alcance em volta do pivô.
    esq = max(r['px'] for r in recortes)
    dir_ = max(r['img'].shape[1] - r['px'] for r in recortes)
    cima = max(r['py'] for r in recortes)
    baixo = max(r['img'].shape[0] - r['py'] for r in recortes)
    cw = int(np.ceil((max(esq, dir_) * 2) * ESCALA_ATLAS)) + FOLGA * 2
    ch = int(np.ceil((cima + baixo) * ESCALA_ATLAS)) + FOLGA * 2
    pivo_x = cw / 2
    pivo_y = FOLGA + cima * ESCALA_ATLAS

    atlas = Image.new('RGBA', (cw * 6, ch * 4), (0, 0, 0, 0))
    for i, r in enumerate(recortes):
        q = Image.fromarray(r['img'])
        q = q.resize((round(q.width * ESCALA_ATLAS), round(q.height * ESCALA_ATLAS)), Image.LANCZOS)
        ox = (i % 6) * cw + round(pivo_x - r['px'] * ESCALA_ATLAS)
        oy = (i // 6) * ch + round(pivo_y - r['py'] * ESCALA_ATLAS)
        atlas.alpha_composite(q, (ox, oy))
    atlas.save(DESTINO, optimize=True)

    altura_parado = (ref['base'] - np.nonzero(ref['img'][..., 3] >= 128)[0].min()) * ESCALA_ATLAS
    print(f'{DESTINO.name}: {atlas.width}x{atlas.height}')
    print(f'CELULA = {{ largura: {cw}, altura: {ch}, pivoX: {pivo_x:.1f}, pivoY: {pivo_y:.1f} }}')
    print(f'ALTURA_PARADO_ATLAS = {altura_parado:.1f}')


if __name__ == '__main__':
    main()
