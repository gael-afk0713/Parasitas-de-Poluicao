// ============ GRID ISOMÉTRICO DA FASE 1 ============
// coordenadas abaixo são todas no espaço original da imagem de fundo
// (mapa-fase1-clareira.jpg, 1024x572px), depois convertidas pra tela
// replicando o mesmo enquadramento que "background-size:cover" faz —
// assim o grid acompanha a imagem em qualquer tamanho de janela.
const IMG_W = 1024;
const IMG_H = 572;

// 12x12 células (mesma quantidade), tile 80x40 (proporção 2:1) — grid
// grande, ocupando quase toda a clareira, centralizado nela
const GRID_N = 12;
const TILE_W = 80;
const TILE_H = 40;
const GRID_CENTER_X = 512;
const GRID_CENTER_Y = 280;

const canvas = document.getElementById('grid-fase1');
const ctx = canvas.getContext('2d');

// x = (coluna - linha) * (largura/2), y = (coluna + linha) * (altura/2)
function pontoDaGrade(col, row) {
  const localX = (col - row) * (TILE_W / 2);
  const localY = (col + row) * (TILE_H / 2) - (GRID_N * TILE_H) / 2;
  return { x: GRID_CENTER_X + localX, y: GRID_CENTER_Y + localY };
}

// mesma matemática do background-size:contain, pra mapear um ponto
// do espaço da imagem pro pixel de tela correspondente — a imagem inteira
// sempre cabe na tela (com barras no soot dos lados/em cima), nunca corta
// pedaço nem estica, mesmo em resoluções bem mais largas ou mais altas
function imagemParaTela(ponto) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const escala = Math.min(vw / IMG_W, vh / IMG_H);
  const offsetX = (vw - IMG_W * escala) / 2;
  const offsetY = (vh - IMG_H * escala) / 2;
  return { x: offsetX + ponto.x * escala, y: offsetY + ponto.y * escala };
}

function pontoNaTela(col, row) {
  return imagemParaTela(pontoDaGrade(col, row));
}

function redimensionarCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function tracarLinhasInternas() {
  ctx.beginPath();
  for (let r = 1; r < GRID_N; r++) {
    const p1 = pontoNaTela(0, r);
    const p2 = pontoNaTela(GRID_N, r);
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
  }
  for (let c = 1; c < GRID_N; c++) {
    const p1 = pontoNaTela(c, 0);
    const p2 = pontoNaTela(c, GRID_N);
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
  }
}

function desenharGrid() {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  // halo escuro por baixo, pra garantir contraste sobre a imagem colorida
  ctx.strokeStyle = 'rgba(11, 9, 6, 0.55)';
  ctx.lineWidth = 3;
  tracarLinhasInternas();
  ctx.stroke();

  // contorno claro por cima
  ctx.strokeStyle = 'rgba(239, 232, 214, 0.85)';
  ctx.lineWidth = 1.25;
  tracarLinhasInternas();
  ctx.stroke();
}

function atualizarTudo() {
  redimensionarCanvas();
  desenharGrid();
}

window.addEventListener('resize', atualizarTudo);
atualizarTudo();

// ============ SAVE ATIVO (vindo do painel Novo Jogo) ============
function lerSaveAtivo() {
  try {
    return JSON.parse(localStorage.getItem('parasitas-save-ativo'));
  } catch {
    return null;
  }
}

// toast único (#boas-vindas) reaproveitado tanto pra mensagem de boas-vindas
// quanto pro aviso narrativo de poluição — mesmo elemento, conteúdo trocado
let timerToast = null;
function mostrarToast(...conteudo) {
  const el = document.getElementById('boas-vindas');
  if (!el) return;
  el.textContent = '';
  el.append(...conteudo);
  el.classList.remove('visivel');
  void el.offsetWidth; // força reflow, garante que reinicia a transição mesmo se já estava visível
  requestAnimationFrame(() => el.classList.add('visivel'));
  clearTimeout(timerToast);
  timerToast = setTimeout(() => el.classList.remove('visivel'), 5200);
}

function aplicarSaveAtivo() {
  const saveAtivo = lerSaveAtivo();
  if (!saveAtivo) return;

  const hudEmpresa = document.getElementById('hud-empresa');
  if (hudEmpresa) hudEmpresa.textContent = saveAtivo.empresa;
  document.title = `${saveAtivo.empresa} · Fase 1 · Parasitas de Poluição`;

  const nomeJogador = document.createElement('strong');
  nomeJogador.textContent = saveAtivo.jogador;
  const nomeEmpresa = document.createElement('strong');
  nomeEmpresa.textContent = saveAtivo.empresa;
  mostrarToast('Bem-vindo(a), ', nomeJogador, '. A ', nomeEmpresa, ' está pronta pra crescer.');
}
aplicarSaveAtivo();

// ============ PAINEL DE FÁBRICAS ============
const btnFabricas = document.getElementById('btn-fabricas');
const painelFabricas = document.getElementById('painel-fabricas');
const fecharFabricasBtn = document.getElementById('fechar-fabricas');

function abrirPainelFabricas() {
  atualizarCartasFabricas();
  painelFabricas.classList.add('aberto');
  painelFabricas.setAttribute('aria-hidden', 'false');
  btnFabricas.setAttribute('aria-expanded', 'true');
}
function fecharPainelFabricas() {
  painelFabricas.classList.remove('aberto');
  painelFabricas.setAttribute('aria-hidden', 'true');
  btnFabricas.setAttribute('aria-expanded', 'false');
}

btnFabricas.addEventListener('click', () => {
  const aberto = painelFabricas.classList.contains('aberto');
  aberto ? fecharPainelFabricas() : abrirPainelFabricas();
});
fecharFabricasBtn.addEventListener('click', fecharPainelFabricas);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    fecharPainelFabricas();
    abortarColocacao();
  }
});

// delegação no container (os cards são renderizados dinamicamente a
// partir de FABRICAS, então não existem ainda neste ponto do script)
document.getElementById('lista-fabricas').addEventListener('click', (e) => {
  const carta = e.target.closest('.carta-fabrica');
  if (!carta || carta.disabled) return;
  fecharPainelFabricas();
  iniciarColocacao(carta.dataset.fabrica);
});

// ============ ECONOMIA ============
// ícones reaproveitados nos cards de construção (mesmo viewBox 24x24 e
// classe .icone-fabrica dos outros ícones do HUD)
const ICONES_CONSTRUCAO = {
  fabrica: '<path d="M3 21V13l4 3v-3l4 3v-3l4 3v5H3Z"/><rect x="17" y="7" width="3" height="14"/><path d="M2 21h20"/>',
  usina: '<path d="M12 2C12 2 5 10.5 5 15a7 7 0 0 0 14 0C19 10.5 12 2 12 2Z"/><path d="M8.5 15a3.5 3.5 0 0 0 3.5 3.5"/>',
};

// celulasCol/celulasRow = pegada da construção no grid.
// ganhoPorTick/poluicaoPorTick = quanto cada UNIDADE rende/polui a cada
// tick de TICK_ECONOMIA_MS (multiplicado pela quantidade possuída).
// bonusAdjacencia = fração extra de ganho que essa construção dá a CADA
// vizinha ortogonal (só usinas de suporte têm isso — ver calcularGanhoInstancia)
const FABRICAS = {
  'usina-carvao': {
    nome: 'Usina de Carvão', categoria: 'Fábrica', icone: 'fabrica',
    descricao: 'Energia barata, alto custo ambiental.',
    custo: 4500, ganhoPorTick: 225, poluicaoPorTick: 15,
    sprite: 'imagens/usina-carvao.png', celulasCol: 2, celulasRow: 1,
  },
  'usina-agua': {
    nome: 'Usina de Água', categoria: 'Usina', icone: 'usina',
    descricao: 'Pouca poluição; turbina o ganho das vizinhas.',
    custo: 3000, ganhoPorTick: 100, poluicaoPorTick: 2, bonusAdjacencia: 0.20,
    sprite: 'imagens/usina-agua.svg', celulasCol: 1, celulasRow: 1,
  },
};

// teto global: uma construção não pode receber mais que +60% de ganho
// somando o bônus de TODAS as usinas vizinhas — sem isso, cercar uma
// fábrica de usinas de água vira ganho infinito
const BONUS_ADJACENCIA_MAX = 0.60;

function renderizarCartasFabricas() {
  const lista = document.getElementById('lista-fabricas');
  for (const tipo in FABRICAS) {
    const config = FABRICAS[tipo];
    const carta = document.createElement('button');
    carta.className = 'carta-fabrica';
    carta.dataset.fabrica = tipo;
    carta.innerHTML = `
      <svg class="icone-fabrica" viewBox="0 0 24 24" aria-hidden="true">${ICONES_CONSTRUCAO[config.icone] || ICONES_CONSTRUCAO.fabrica}</svg>
      <span class="carta-fabrica-texto">
        <span class="carta-fabrica-categoria">${config.categoria}</span>
        <span class="carta-fabrica-nome">${config.nome}</span>
        <span class="carta-fabrica-desc">${config.descricao}</span>
      </span>
      <span class="carta-fabrica-custo"></span>
    `;
    lista.appendChild(carta);
  }
}
renderizarCartasFabricas();

// cada unidade adicional da MESMA construção custa 15% a mais que a
// anterior: preço da unidade N = custo base × 1.15^(N-1) — genérico pra
// qualquer entrada de FABRICAS, não só a usina de carvão
const MULTIPLICADOR_CUSTO_REPETIDO = 1.15;
const TICK_ECONOMIA_MS = 3000;
const quantidadePorTipo = {};

function precoAtual(tipo) {
  const config = FABRICAS[tipo];
  const quantidade = quantidadePorTipo[tipo] || 0;
  return Math.round(config.custo * Math.pow(MULTIPLICADOR_CUSTO_REPETIDO, quantidade));
}

let dinheiro = 5000;
let poluicaoTotal = 0;
let totalFabricas = 1;
const celulasOcupadas = new Set();

const hudDinheiroEl = document.getElementById('hud-dinheiro');
const hudFabricasEl = document.getElementById('hud-fabricas');
const hudPoluicaoEl = document.getElementById('hud-poluicao');
const hudStatPoluicaoEl = document.querySelector('.hud-stat--poluicao');

function formatarDinheiro(valor) {
  return 'R$ ' + valor.toLocaleString('pt-BR');
}
function atualizarHudDinheiro() {
  hudDinheiroEl.textContent = formatarDinheiro(dinheiro);
}
function atualizarHudFabricas() {
  hudFabricasEl.textContent = String(totalFabricas);
}
function atualizarCartasFabricas() {
  document.querySelectorAll('.carta-fabrica').forEach((carta) => {
    const tipo = carta.dataset.fabrica;
    const preco = precoAtual(tipo);
    const custoEl = carta.querySelector('.carta-fabrica-custo');
    if (custoEl) custoEl.textContent = formatarDinheiro(preco);
    carta.disabled = preco > dinheiro;
  });
}

// níveis de severidade visual do HUD de poluição — puramente estético
// por enquanto, sem nenhum efeito de jogo além do aviso narrativo abaixo
const LIMIAR_POLUICAO_ATENCAO = 500;
const LIMIAR_POLUICAO_CRITICO = 1500;
let avisoPoluicaoMostrado = false;

function atualizarHudPoluicao() {
  hudPoluicaoEl.textContent = poluicaoTotal.toLocaleString('pt-BR');
  const nivel = poluicaoTotal >= LIMIAR_POLUICAO_CRITICO ? 'critico'
    : poluicaoTotal >= LIMIAR_POLUICAO_ATENCAO ? 'atencao' : 'normal';
  hudStatPoluicaoEl.dataset.nivel = nivel;
  if (nivel === 'critico' && !avisoPoluicaoMostrado) {
    avisoPoluicaoMostrado = true;
    const forte = document.createElement('strong');
    forte.textContent = 'níveis críticos';
    mostrarToast('Os índices de poluição da região já atingem ', forte, '. A floresta ao redor sente cada usina.');
  }
}

function pulsarGanhoNoHud() {
  hudDinheiroEl.classList.remove('pulso-ganho');
  void hudDinheiroEl.offsetWidth; // força reflow pra reiniciar a animação
  hudDinheiroEl.classList.add('pulso-ganho');
}

atualizarHudDinheiro();
atualizarHudFabricas();
atualizarHudPoluicao();
atualizarCartasFabricas();

// ============ TICK DE ECONOMIA (ganho + poluição por construção) ============
// duas pegadas (col/row/colSpan/rowSpan) são vizinhas ortogonais se
// alguma célula de uma encosta numa célula da outra — diagonal não conta
function footprintsVizinhos(a, b) {
  for (let dc = 0; dc < a.colSpan; dc++) {
    for (let dr = 0; dr < a.rowSpan; dr++) {
      const col = a.col + dc, row = a.row + dr;
      const candidatas = [[col + 1, row], [col - 1, row], [col, row + 1], [col, row - 1]];
      for (const [vc, vr] of candidatas) {
        if (vc >= b.col && vc < b.col + b.colSpan && vr >= b.row && vr < b.row + b.rowSpan) return true;
      }
    }
  }
  return false;
}

// ganho efetivo de UMA instância construída no tick atual, já somando o
// bônus de todas as vizinhas ortogonais com bonusAdjacencia (ex: Usina
// de Água), respeitando o teto BONUS_ADJACENCIA_MAX
function calcularGanhoInstancia(instancia) {
  const config = FABRICAS[instancia.tipo];
  let bonus = 0;
  for (const outra of instanciasConstruidas) {
    if (outra === instancia) continue;
    const configOutra = FABRICAS[outra.tipo];
    if (!configOutra.bonusAdjacencia) continue;
    if (footprintsVizinhos(instancia, outra)) bonus += configOutra.bonusAdjacencia;
  }
  bonus = Math.min(bonus, BONUS_ADJACENCIA_MAX);
  return Math.round(config.ganhoPorTick * (1 + bonus));
}

function mostrarNumeroFlutuante(instancia, valor) {
  const ponto = centroFootprintNaTela(instancia.col, instancia.row, instancia.colSpan, instancia.rowSpan);
  const numero = document.createElement('div');
  numero.className = 'numero-flutuante';
  numero.textContent = '+' + formatarDinheiro(valor);
  numero.style.left = ponto.x + 'px';
  numero.style.top = ponto.y + 'px';
  document.body.appendChild(numero);
  setTimeout(() => numero.remove(), 1150);
}

function tickEconomia() {
  if (instanciasConstruidas.length === 0) return;
  let ganhoDoTick = 0;
  instanciasConstruidas.forEach((instancia) => {
    const config = FABRICAS[instancia.tipo];
    const ganho = calcularGanhoInstancia(instancia);
    ganhoDoTick += ganho;
    poluicaoTotal += config.poluicaoPorTick;
    mostrarNumeroFlutuante(instancia, ganho);
  });
  dinheiro += ganhoDoTick;
  atualizarHudDinheiro();
  atualizarHudPoluicao();
  pulsarGanhoNoHud();
  if (painelFabricas.classList.contains('aberto')) atualizarCartasFabricas();
}
setInterval(tickEconomia, TICK_ECONOMIA_MS);

// ============ COLOCAÇÃO DE FÁBRICAS NO GRID ============
function chaveCelula(col, row) {
  return col + ',' + row;
}

// inverte a matemática isométrica: de um ponto de tela pra qual
// célula (col, row) do grid está mais perto do cursor
function celulaMaisProxima(mx, my) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const escala = Math.min(vw / IMG_W, vh / IMG_H);
  const offsetX = (vw - IMG_W * escala) / 2;
  const offsetY = (vh - IMG_H * escala) / 2;
  const imgX = (mx - offsetX) / escala;
  const imgY = (my - offsetY) / escala;
  const localX = imgX - GRID_CENTER_X;
  const localY = imgY - GRID_CENTER_Y + (GRID_N * TILE_H) / 2;
  const latCol = localX / TILE_W + localY / TILE_H;
  const latRow = localY / TILE_H - localX / TILE_W;
  return {
    col: Math.min(GRID_N - 1, Math.max(0, Math.floor(latCol))),
    row: Math.min(GRID_N - 1, Math.max(0, Math.floor(latRow))),
  };
}

// centro na tela de uma pegada de colSpan x rowSpan células, começando
// em (col, row) — pra pegada 1x1 isso é o mesmo que o centro da célula
function centroFootprintNaTela(col, row, colSpan, rowSpan) {
  return pontoNaTela(col + colSpan / 2, row + rowSpan / 2);
}

// largura visual (no espaço da imagem) da pegada isométrica de
// colSpan x rowSpan células — parte do contorno do losango isométrico
// (colSpan+rowSpan)*(TILE_W/2), com uma margem de 15% pra dentro, já que
// o sprite é um retângulo (não um losango) e sem essa folga os cantos
// dele passam visualmente da pegada de 2 células
function larguraImagemParaFootprint(colSpan, rowSpan) {
  return (colSpan + rowSpan) * (TILE_W / 2) * 0.85;
}

function escalaAtual() {
  return Math.min(window.innerWidth / IMG_W, window.innerHeight / IMG_H);
}

function posicionarInstancia(instancia) {
  const ponto = centroFootprintNaTela(instancia.col, instancia.row, instancia.colSpan, instancia.rowSpan);
  instancia.wrapper.style.left = ponto.x + 'px';
  instancia.wrapper.style.top = ponto.y + 'px';
  instancia.wrapper.style.width = (instancia.larguraImagem * escalaAtual()) + 'px';
}

function reposicionarAcoesFlutuantes() {
  if (!estadoConstrucao || !estadoConstrucao.barra) return;
  const barra = estadoConstrucao.barra;
  const ponto = centroFootprintNaTela(estadoConstrucao.col, estadoConstrucao.row, estadoConstrucao.colSpan, estadoConstrucao.rowSpan);
  barra.style.top = (ponto.y + 16) + 'px';
  // clampa o centro horizontal pra barra (agora com 3 botões) nunca
  // vazar pra fora da tela em telas estreitas, perto das bordas do grid
  const margem = 8;
  const metadeLargura = barra.offsetWidth / 2;
  const minCentro = metadeLargura + margem;
  const maxCentro = window.innerWidth - metadeLargura - margem;
  const centroX = Math.min(Math.max(ponto.x, minCentro), maxCentro);
  barra.style.left = centroX + 'px';
}

// true se alguma célula da pegada colSpan x rowSpan (a partir de col,row)
// já estiver ocupada
function footprintOcupado(col, row, colSpan, rowSpan) {
  for (let dc = 0; dc < colSpan; dc++) {
    for (let dr = 0; dr < rowSpan; dr++) {
      if (celulasOcupadas.has(chaveCelula(col + dc, row + dr))) return true;
    }
  }
  return false;
}

function marcarFootprintOcupado(col, row, colSpan, rowSpan) {
  for (let dc = 0; dc < colSpan; dc++) {
    for (let dr = 0; dr < rowSpan; dr++) {
      celulasOcupadas.add(chaveCelula(col + dc, row + dr));
    }
  }
}

// garante que a pegada colSpan x rowSpan, começando em (col,row), caiba
// inteira dentro do grid — desliza a âncora pra dentro se preciso
function clampFootprint(col, row, colSpan, rowSpan) {
  return {
    col: Math.min(Math.max(col, 0), GRID_N - colSpan),
    row: Math.min(Math.max(row, 0), GRID_N - rowSpan),
  };
}

let ultimoMouseX = window.innerWidth / 2;
let ultimoMouseY = window.innerHeight / 2;
let estadoConstrucao = null;
const instanciasConstruidas = [];

function criarSprite(config) {
  const wrapper = document.createElement('div');
  wrapper.className = 'fabrica-instancia';

  const img = document.createElement('img');
  img.className = 'fabrica-sprite';
  img.src = config.sprite;
  img.alt = config.nome;
  wrapper.appendChild(img);

  const tinta = document.createElement('div');
  tinta.className = 'fabrica-tinta';
  tinta.style.webkitMaskImage = `url('${config.sprite}')`;
  tinta.style.maskImage = `url('${config.sprite}')`;
  wrapper.appendChild(tinta);

  document.body.appendChild(wrapper);
  return { wrapper, tinta };
}

function iniciarColocacao(tipo) {
  const config = FABRICAS[tipo];
  if (!config) return;
  abortarColocacao();

  const { wrapper, tinta } = criarSprite(config);
  wrapper.classList.add('fabrica-instancia--fantasma');

  const colSpan = config.celulasCol;
  const rowSpan = config.celulasRow;
  estadoConstrucao = {
    tipo, config, wrapper, tinta,
    colSpan, rowSpan,
    // preço travado no início da colocação (com a escala por quantidade
    // já possuída), pra cobrar o mesmo valor mostrado no card
    precoCompra: precoAtual(tipo),
    larguraImagem: larguraImagemParaFootprint(colSpan, rowSpan),
    travado: false, col: null, row: null, barra: null,
  };

  btnFabricas.disabled = true;

  reposicionarFantasma(ultimoMouseX, ultimoMouseY);
  setTimeout(() => {
    window.addEventListener('pointerdown', aoPressionarDurantePlacement);
    window.addEventListener('pointerup', aoSoltarDurantePlacement);
  }, 0);
}

function reposicionarFantasma(mx, my) {
  if (!estadoConstrucao || estadoConstrucao.travado) return;
  const bruto = celulaMaisProxima(mx, my);
  const { col, row } = clampFootprint(bruto.col, bruto.row, estadoConstrucao.colSpan, estadoConstrucao.rowSpan);
  estadoConstrucao.col = col;
  estadoConstrucao.row = row;
  posicionarInstancia(estadoConstrucao);
  const ocupada = footprintOcupado(col, row, estadoConstrucao.colSpan, estadoConstrucao.rowSpan);
  estadoConstrucao.wrapper.classList.toggle('fabrica-instancia--ocupada', ocupada);
}

// ---- controle unificado de mouse/toque/caneta via Pointer Events ----
// um único caminho de código pras três formas de entrada, pra nunca ter
// mouse e toque disputando o mesmo estado num dispositivo híbrido
// (notebook com tela sensível ao toque, tablet com mouse, etc.)
window.addEventListener('pointermove', (e) => {
  ultimoMouseX = e.clientX;
  ultimoMouseY = e.clientY;
  reposicionarFantasma(e.clientX, e.clientY);
});

// no toque não existe "hover": o fantasma só chega onde o dedo encostou
// quando o pointerdown acontece (no mouse isso é redundante com o
// pointermove de hover, que já reposicionou antes)
function aoPressionarDurantePlacement(e) {
  if (!estadoConstrucao || estadoConstrucao.travado) return;
  ultimoMouseX = e.clientX;
  ultimoMouseY = e.clientY;
  reposicionarFantasma(e.clientX, e.clientY);
}

function aoSoltarDurantePlacement(e) {
  if (!estadoConstrucao || estadoConstrucao.travado) return;
  // evita o click de compatibilidade que alguns navegadores disparam
  // logo depois do toque, que poderia acertar o botão Confirmar/Cancelar
  // assim que ele aparece embaixo do dedo
  e.preventDefault();
  ultimoMouseX = e.clientX;
  ultimoMouseY = e.clientY;
  reposicionarFantasma(e.clientX, e.clientY);
  if (footprintOcupado(estadoConstrucao.col, estadoConstrucao.row, estadoConstrucao.colSpan, estadoConstrucao.rowSpan)) return;
  travarColocacao();
}

function travarColocacao() {
  estadoConstrucao.travado = true;
  estadoConstrucao.wrapper.classList.remove('fabrica-instancia--fantasma');
  estadoConstrucao.wrapper.classList.add('fabrica-instancia--travada');
  mostrarAcoesFlutuantes();
}

function mostrarAcoesFlutuantes() {
  const barra = document.createElement('div');
  barra.className = 'fabrica-acoes-flutuantes';

  const btnCancelar = document.createElement('button');
  btnCancelar.className = 'painel-voltar';
  btnCancelar.textContent = 'Cancelar';

  const btnConfirmar = document.createElement('button');
  btnConfirmar.className = 'painel-confirmar';
  btnConfirmar.textContent = 'Confirmar';

  barra.append(btnCancelar, btnConfirmar);
  document.body.appendChild(barra);
  estadoConstrucao.barra = barra;
  reposicionarAcoesFlutuantes();

  // só liga os botões no próximo tick: assim o mesmo toque/clique que
  // travou a colocação (e que pode terminar embaixo do botão Confirmar,
  // já que a barra nasce colada na célula travada) nunca aciona os botões
  setTimeout(() => {
    btnCancelar.addEventListener('click', cancelarConstrucao);
    btnConfirmar.addEventListener('click', confirmarConstrucao);
  }, 0);
}

function removerAcoesFlutuantes() {
  if (estadoConstrucao && estadoConstrucao.barra) {
    estadoConstrucao.barra.remove();
    estadoConstrucao.barra = null;
  }
}

function encerrarEstadoConstrucao() {
  window.removeEventListener('pointerdown', aoPressionarDurantePlacement);
  window.removeEventListener('pointerup', aoSoltarDurantePlacement);
  estadoConstrucao = null;
  btnFabricas.disabled = false;
}

function confirmarConstrucao() {
  if (!estadoConstrucao) return;
  const { wrapper, tinta, col, row, colSpan, rowSpan, tipo, precoCompra, larguraImagem } = estadoConstrucao;
  // segurança: não deixa confirmar em cima de célula já ocupada
  if (footprintOcupado(col, row, colSpan, rowSpan)) return;
  removerAcoesFlutuantes();

  tinta.classList.add('fabrica-tinta--sucesso');
  wrapper.classList.add('fabrica-instancia--construida');

  dinheiro -= precoCompra;
  totalFabricas += 1;
  quantidadePorTipo[tipo] = (quantidadePorTipo[tipo] || 0) + 1;
  atualizarHudDinheiro();
  atualizarHudFabricas();
  marcarFootprintOcupado(col, row, colSpan, rowSpan);
  instanciasConstruidas.push({ wrapper, col, row, colSpan, rowSpan, larguraImagem, tipo });

  setTimeout(() => tinta.remove(), 550);
  encerrarEstadoConstrucao();
}

function cancelarConstrucao() {
  if (!estadoConstrucao) return;
  const { wrapper, tinta } = estadoConstrucao;
  removerAcoesFlutuantes();

  tinta.classList.add('fabrica-tinta--erro');
  setTimeout(() => wrapper.remove(), 550);

  encerrarEstadoConstrucao();
}

function abortarColocacao() {
  if (!estadoConstrucao) return;
  removerAcoesFlutuantes();
  estadoConstrucao.wrapper.remove();
  encerrarEstadoConstrucao();
}

window.addEventListener('resize', () => {
  if (estadoConstrucao) posicionarInstancia(estadoConstrucao);
  instanciasConstruidas.forEach(posicionarInstancia);
  reposicionarAcoesFlutuantes();
});
