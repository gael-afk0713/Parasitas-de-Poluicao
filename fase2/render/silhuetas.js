/* =========================================================================
   fase2/render/silhuetas.js — silhuetas de cenário feitas por IA, tingidas
   -------------------------------------------------------------------------
   As formas do cenário (árvores, ruínas, moldura) são desenhadas em código;
   algumas agora vêm de IMAGEM (pedido do autor: "faça os elementos do
   cenário"). Cada imagem é só uma MÁSCARA — silhueta preta gerada por IA,
   convertida em branco + alfa por `fase2/arte/preparar-cenario.py` — e é
   tingida aqui com a cor do plano em que entra. Imagem colorida ficaria
   parada na cor errada: o tema de cada área é interpolado pela pureza.

   Até a imagem carregar (ou se falhar), `silhueta()` devolve null e quem
   desenha só pula aquele elemento — o cenário procedural continua inteiro.
   ========================================================================= */

const _imagens = new Map();

/** A máscara `nome` (fase2/arte/cenario/<nome>.png), já carregada, ou null. */
export function silhueta(nome, pasta = 'cenario') {
  const chave = `${pasta}/${nome}`;
  let img = _imagens.get(chave);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.src = new URL(`../arte/${pasta}/${nome}.png?v=1`, import.meta.url).href;
    _imagens.set(chave, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/* A cor do tema muda um pouquinho a cada quadro enquanto a sala é
   restaurada. Sem arredondar, cada quadro dessa transição criava uma máscara
   tingida nova por imagem — engasgo justo na animação de restaurar. Passo de
   8 por canal numa paleta tão escura não se vê. */
function arredondar(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  const c = (s) => Math.min(255, Math.round(((n >> s) & 255) / 8) * 8);
  return `#${((c(16) << 16) | (c(8) << 8) | c(0)).toString(16).padStart(6, '0')}`;
}

const _tingidas = new Map();

/**
 * A máscara tingida. Com `corAlto`, o tingimento é um degradê vertical (topo
 * em `corAlto`, base em `cor`) — o mesmo que os troncos procedurais usam pra
 * a silhueta escurecer no alto do céu, em vez de ficar mais clara que ele.
 */
export function tingir(img, cor, corAlto = null) {
  const c1 = arredondar(cor), c0 = corAlto ? arredondar(corAlto) : null;
  const chave = `${img.src}|${c1}|${c0}`;
  let c = _tingidas.get(chave);
  if (c) return c;
  // Sai só a mais antiga (Map guarda a ordem de inserção): limpar tudo de
  // uma vez recriava todas as máscaras no quadro seguinte.
  if (_tingidas.size >= 96) _tingidas.delete(_tingidas.keys().next().value);
  c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-in';
  if (c0) {
    const grad = g.createLinearGradient(0, 0, 0, c.height);
    grad.addColorStop(0, c0);
    grad.addColorStop(1, c1);
    g.fillStyle = grad;
  } else {
    g.fillStyle = c1;
  }
  g.fillRect(0, 0, c.width, c.height);
  _tingidas.set(chave, c);
  return c;
}
