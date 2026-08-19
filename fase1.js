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

// mesma matemática do background-size:cover, pra mapear um ponto
// do espaço da imagem pro pixel de tela correspondente
function imagemParaTela(ponto) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const escala = Math.max(vw / IMG_W, vh / IMG_H);
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

function aplicarSaveAtivo() {
  const saveAtivo = lerSaveAtivo();
  if (!saveAtivo) return;

  const hudEmpresa = document.getElementById('hud-empresa');
  if (hudEmpresa) hudEmpresa.textContent = saveAtivo.empresa;
  document.title = `${saveAtivo.empresa} · Fase 1 · Parasitas de Poluição`;

  const boasVindas = document.getElementById('boas-vindas');
  if (boasVindas) {
    boasVindas.textContent = '';
    const nomeJogador = document.createElement('strong');
    nomeJogador.textContent = saveAtivo.jogador;
    const nomeEmpresa = document.createElement('strong');
    nomeEmpresa.textContent = saveAtivo.empresa;
    boasVindas.append('Bem-vindo(a), ', nomeJogador, '. A ', nomeEmpresa, ' está pronta pra crescer.');
    requestAnimationFrame(() => boasVindas.classList.add('visivel'));
    setTimeout(() => boasVindas.classList.remove('visivel'), 4200);
  }
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

document.querySelectorAll('.carta-fabrica').forEach((carta) => {
  carta.addEventListener('click', () => {
    if (carta.disabled) return;
    fecharPainelFabricas();
    iniciarColocacao(carta.dataset.fabrica);
  });
});

// ============ ECONOMIA ============
const FABRICAS = {
  'usina-carvao': { nome: 'Usina de Carvão', custo: 8000, sprite: 'imagens/usina-carvao.png', larguraImagem: TILE_W },
};

let dinheiro = 50000;
let totalFabricas = 1;
const celulasOcupadas = new Set();

const hudDinheiroEl = document.getElementById('hud-dinheiro');
const hudFabricasEl = document.getElementById('hud-fabricas');

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
    const config = FABRICAS[carta.dataset.fabrica];
    carta.disabled = config.custo > dinheiro;
  });
}
atualizarHudDinheiro();
atualizarHudFabricas();

// ============ COLOCAÇÃO DE FÁBRICAS NO GRID ============
function chaveCelula(col, row) {
  return col + ',' + row;
}

// inverte a matemática isométrica: de um ponto de tela pra qual
// célula (col, row) do grid está mais perto do cursor
function celulaMaisProxima(mx, my) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const escala = Math.max(vw / IMG_W, vh / IMG_H);
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

function centroCelulaNaTela(col, row) {
  return pontoNaTela(col + 0.5, row + 0.5);
}

function escalaAtual() {
  return Math.max(window.innerWidth / IMG_W, window.innerHeight / IMG_H);
}

function posicionarInstancia(instancia) {
  const ponto = centroCelulaNaTela(instancia.col, instancia.row);
  instancia.wrapper.style.left = ponto.x + 'px';
  instancia.wrapper.style.top = ponto.y + 'px';
  instancia.wrapper.style.width = (instancia.larguraImagem * escalaAtual()) + 'px';
}

function reposicionarAcoesFlutuantes() {
  if (!estadoConstrucao || !estadoConstrucao.barra) return;
  const ponto = centroCelulaNaTela(estadoConstrucao.col, estadoConstrucao.row);
  estadoConstrucao.barra.style.left = ponto.x + 'px';
  estadoConstrucao.barra.style.top = (ponto.y + 16) + 'px';
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

  estadoConstrucao = {
    tipo, config, wrapper, tinta,
    larguraImagem: config.larguraImagem,
    travado: false, col: null, row: null, barra: null,
  };

  btnFabricas.disabled = true;

  reposicionarFantasma(ultimoMouseX, ultimoMouseY);
  setTimeout(() => window.addEventListener('click', aoClicarDurantePlacement), 0);
}

function reposicionarFantasma(mx, my) {
  if (!estadoConstrucao || estadoConstrucao.travado) return;
  const { col, row } = celulaMaisProxima(mx, my);
  estadoConstrucao.col = col;
  estadoConstrucao.row = row;
  posicionarInstancia(estadoConstrucao);
  const ocupada = celulasOcupadas.has(chaveCelula(col, row));
  estadoConstrucao.wrapper.classList.toggle('fabrica-instancia--ocupada', ocupada);
}

window.addEventListener('mousemove', (e) => {
  ultimoMouseX = e.clientX;
  ultimoMouseY = e.clientY;
  reposicionarFantasma(e.clientX, e.clientY);
});

function aoClicarDurantePlacement(e) {
  if (!estadoConstrucao || estadoConstrucao.travado) return;
  if (e.target instanceof Element && e.target.closest('.fabrica-acoes-flutuantes')) return;
  if (celulasOcupadas.has(chaveCelula(estadoConstrucao.col, estadoConstrucao.row))) return;
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
  btnCancelar.addEventListener('click', cancelarConstrucao);

  const btnConfirmar = document.createElement('button');
  btnConfirmar.className = 'painel-confirmar';
  btnConfirmar.textContent = 'Confirmar';
  btnConfirmar.addEventListener('click', confirmarConstrucao);

  barra.append(btnCancelar, btnConfirmar);
  document.body.appendChild(barra);
  estadoConstrucao.barra = barra;
  reposicionarAcoesFlutuantes();
}

function removerAcoesFlutuantes() {
  if (estadoConstrucao && estadoConstrucao.barra) {
    estadoConstrucao.barra.remove();
    estadoConstrucao.barra = null;
  }
}

function encerrarEstadoConstrucao() {
  window.removeEventListener('click', aoClicarDurantePlacement);
  estadoConstrucao = null;
  btnFabricas.disabled = false;
}

function confirmarConstrucao() {
  if (!estadoConstrucao) return;
  const { wrapper, tinta, col, row, config } = estadoConstrucao;
  removerAcoesFlutuantes();

  tinta.classList.add('fabrica-tinta--sucesso');
  wrapper.classList.add('fabrica-instancia--construida');

  dinheiro -= config.custo;
  totalFabricas += 1;
  atualizarHudDinheiro();
  atualizarHudFabricas();
  celulasOcupadas.add(chaveCelula(col, row));
  instanciasConstruidas.push({ wrapper, col, row, larguraImagem: config.larguraImagem });

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
