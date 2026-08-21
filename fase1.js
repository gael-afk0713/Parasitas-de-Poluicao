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

// info do save escolhido no menu — inclui `usuario` (dona da conta) e
// `slot`, usados mais abaixo pra ler/gravar o progresso persistido
const saveAtivoInfo = lerSaveAtivo();

function aplicarSaveAtivo() {
  if (!saveAtivoInfo) return;

  const hudEmpresa = document.getElementById('hud-empresa');
  if (hudEmpresa) hudEmpresa.textContent = saveAtivoInfo.empresa;
  document.title = `${saveAtivoInfo.empresa} · Fase 1 · Parasitas de Poluição`;

  const nomeJogador = document.createElement('strong');
  nomeJogador.textContent = saveAtivoInfo.jogador;
  const nomeEmpresa = document.createElement('strong');
  nomeEmpresa.textContent = saveAtivoInfo.empresa;
  mostrarToast('Bem-vindo(a), ', nomeJogador, '. A ', nomeEmpresa, ' está pronta pra crescer.');
}
aplicarSaveAtivo();

// ============ DIFICULDADE ============
// escolhida no painel Novo Jogo, ignorada até agora — passa a valer pra
// ganho (recompensa o risco), velocidade de acúmulo de poluição e
// severidade das multas de fiscalização (ver seções mais abaixo)
const DIFICULDADES = {
  'Iniciante': { multGanho: 1.0, multPoluicao: 0.65, multMulta: 0.6 },
  'Médio': { multGanho: 1.0, multPoluicao: 1.0, multMulta: 1.0 },
  'Expert': { multGanho: 1.3, multPoluicao: 1.5, multMulta: 1.5 },
};
function configDificuldade() {
  return DIFICULDADES[saveAtivoInfo?.dificuldade] || DIFICULDADES['Médio'];
}

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

// ============ PAINEL DE CONFIGURAÇÕES (Esc / botão de engrenagem) ============
const btnConfig = document.getElementById('btn-config');
const painelConfig = document.getElementById('painel-config');
const statusConfig = document.getElementById('status-config');

function abrirPainelConfig() {
  statusConfig.textContent = '';
  statusConfig.classList.remove('visivel');
  painelConfig.classList.add('aberto');
  painelConfig.setAttribute('aria-hidden', 'false');
}
function fecharPainelConfig() {
  painelConfig.classList.remove('aberto');
  painelConfig.setAttribute('aria-hidden', 'true');
}
btnConfig.addEventListener('click', abrirPainelConfig);

document.getElementById('btn-config-continuar').addEventListener('click', fecharPainelConfig);

document.getElementById('btn-config-salvar').addEventListener('click', () => {
  salvarProgresso();
  statusConfig.textContent = 'Progresso salvo.';
  statusConfig.classList.add('visivel', 'painel-status--sucesso');
});

document.getElementById('btn-config-menu').addEventListener('click', () => {
  salvarProgresso();
  window.location.href = 'index.html';
});

document.getElementById('btn-config-sair').addEventListener('click', () => {
  salvarProgresso();
  localStorage.removeItem('parasitas-sessao');
  window.location.href = 'index.html';
});

// Esc é em camadas: primeiro fecha o que estiver por cima (o painel de
// gerenciar uma construção clicada, depois o de Configurações, depois o
// painel de construção/colocação em andamento); só quando não há mais
// nada pra fechar é que abre a tela de configurações. Assim uma tecla só
// nunca faz duas coisas de uma vez.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || jogoEncerrado) return;
  if (painelInstancia.classList.contains('aberto')) {
    fecharPainelInstancia();
    return;
  }
  if (painelConfig.classList.contains('aberto')) {
    fecharPainelConfig();
    return;
  }
  const haAlgoParaFechar = painelFabricas.classList.contains('aberto') || estadoConstrucao !== null;
  if (haAlgoParaFechar) {
    fecharPainelFabricas();
    abortarColocacao();
    return;
  }
  abrirPainelConfig();
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
// ícones dos cards de construção (viewBox 24x24, classe .icone-fabrica
// compartilhada com os outros ícones do HUD) — um por construção
const ICONES_CONSTRUCAO = {
  fabrica: '<path d="M3 21V13l4 3v-3l4 3v-3l4 3v5H3Z"/><rect x="17" y="7" width="3" height="14"/><path d="M2 21h20"/>',
  usina: '<path d="M12 2C12 2 5 10.5 5 15a7 7 0 0 0 14 0C19 10.5 12 2 12 2Z"/><path d="M8.5 15a3.5 3.5 0 0 0 3.5 3.5"/>',
  madeireira: '<path d="M12 2 8 10h2.5L7 18h10l-3.5-8H16Z"/><rect x="10.5" y="18" width="3" height="3"/>',
  refinaria: '<rect x="9" y="4" width="6" height="14"/><path d="M6 20h12M9 4V2M15 4V2"/><circle cx="12" cy="9.5" r="1.4"/>',
  eolica: '<circle cx="12" cy="10" r="1.3"/><path d="M12 10 12 21M12 10 18 6M12 10 7 4M12 10 6 13"/>',
  tratamento: '<path d="M4 4h16l-6.5 8.5V19l-3 2v-8.5Z"/>',
};

// celulasCol/celulasRow = pegada da construção no grid.
// ganhoPorTick/poluicaoPorTick = quanto cada UNIDADE rende/polui a cada
// tick de TICK_ECONOMIA_MS (multiplicado pela quantidade possuída).
// bonusAdjacencia = fração extra de GANHO que essa construção dá a CADA
// vizinha ortogonal (ver calcularGanhoInstancia).
// reducaoPoluicaoAdjacencia = fração de POLUIÇÃO a menos que essa
// construção tira de CADA vizinha ortogonal (ver calcularPoluicaoInstancia)
// — é o "oposto" do bônus de ganho, efeito diferente, não empilha com ele.
// reducaoGlobalPorTick = quanto essa construção tira do poluicaoTotal
// GERAL a cada tick (não é adjacência, não depende de vizinhança).
// larguraImagemPx/alturaImagemPx = dimensão NATIVA (em pixels) do arquivo
// de sprite — usada só pra calcular a proporção real da imagem em
// tamanhoRenderizado(), pra desenhos muito estreitos-e-altos (torres) ou
// muito largos-e-baixos (galpões) não ficarem com altura/largura absurda
// só porque a pegada deles no grid é pequena ou grande (ver comentário
// completo em tamanhoRenderizado, logo abaixo de FABRICAS)
const FABRICAS = {
  'usina-carvao': {
    nome: 'Usina de Carvão', categoria: 'Fábrica', icone: 'fabrica',
    descricao: 'Energia barata, alto custo ambiental.',
    custo: 4500, ganhoPorTick: 225, poluicaoPorTick: 15,
    sprite: 'imagens/usina-carvao.png', celulasCol: 2, celulasRow: 1,
    larguraImagemPx: 644, alturaImagemPx: 740,
  },
  'madeireira': {
    nome: 'Madeireira', categoria: 'Fábrica', icone: 'madeireira',
    descricao: 'Desmatamento: mais barata, rende menos, polui menos.',
    custo: 3500, ganhoPorTick: 160, poluicaoPorTick: 8,
    // pegada larga (3x1): o desenho real é bem espalhado na horizontal
    // (pilha de toras + galpão + tábuas lado a lado) — o tamanho
    // renderizado em si já ficava bom nessa pegada, o problema real era
    // o sprite ficar mal ancorado dentro dela (ver baseFootprintNaTela)
    sprite: 'imagens/madeireira.png', celulasCol: 3, celulasRow: 1,
    larguraImagemPx: 1342, alturaImagemPx: 677,
  },
  'refinaria-petroleo': {
    nome: 'Refinaria de Petróleo', categoria: 'Fábrica', icone: 'refinaria',
    descricao: 'Ganho pesado, poluição desproporcional. Alto risco.',
    custo: 12000, ganhoPorTick: 600, poluicaoPorTick: 48,
    // pegada compacta (2x2): o desenho real é praticamente quadrado
    // (torres sobem mais do que se espalham no chão)
    sprite: 'imagens/refinaria-petroleo.png', celulasCol: 2, celulasRow: 2,
    larguraImagemPx: 900, alturaImagemPx: 789,
  },
  'usina-agua': {
    nome: 'Usina de Água', categoria: 'Usina', icone: 'usina',
    descricao: 'Pouca poluição; turbina o ganho das vizinhas.',
    custo: 3000, ganhoPorTick: 100, poluicaoPorTick: 2, bonusAdjacencia: 0.20,
    sprite: 'imagens/usina-agua.png', celulasCol: 1, celulasRow: 1,
    larguraImagemPx: 414, alturaImagemPx: 1299,
  },
  'usina-eolica': {
    nome: 'Usina Eólica', categoria: 'Usina', icone: 'eolica',
    descricao: 'Quase não polui; reduz a poluição das vizinhas.',
    custo: 2500, ganhoPorTick: 60, poluicaoPorTick: 1, reducaoPoluicaoAdjacencia: 0.25,
    sprite: 'imagens/usina-eolica.png', celulasCol: 1, celulasRow: 1,
    larguraImagemPx: 474, alturaImagemPx: 1327,
  },
  'estacao-tratamento': {
    nome: 'Estação de Tratamento', categoria: 'Usina', icone: 'tratamento',
    descricao: 'Não rende nada; limpa poluição acumulada da região inteira.',
    custo: 5000, ganhoPorTick: 0, poluicaoPorTick: 0, reducaoGlobalPorTick: 20,
    // pegada 2x1: são dois tanques lado a lado, mais larga que uma
    // construção de célula única
    sprite: 'imagens/estacao-tratamento.png', celulasCol: 2, celulasRow: 1,
    larguraImagemPx: 996, alturaImagemPx: 731,
  },
};

// tetos globais: uma construção não pode ganhar mais que +60% de ganho
// nem perder mais que -50% de poluição só de vizinhança — sem isso,
// cercar uma fábrica de usinas vira ganho infinito ou poluição zerada
const BONUS_ADJACENCIA_MAX = 0.60;
const REDUCAO_ADJACENCIA_MAX = 0.50;

// ---- melhoria e venda de construções já colocadas (clique numa
// construção construída pra abrir #painel-instancia) ----
// cada nível de melhoria aumenta em MULT_UPGRADE_GANHO a "métrica
// principal" da construção: o ganho/tick pra quem rende dinheiro, ou a
// reducaoGlobalPorTick pra quem não rende (ex: Estação de Tratamento) —
// ver multiplicadorUpgrade(). A poluição/tick escala junto (mesmo
// multiplicador): rende mais, também polui mais, de propósito — não
// existe upgrade de graça nesse jogo.
const NIVEL_UPGRADE_MAX = 3;
const MULT_UPGRADE_GANHO = 0.25;
// primeiro upgrade custa 50% do preço-base da construção; cada upgrade
// seguinte NA MESMA instância custa 30% a mais que o anterior (mesma
// lógica de escalonamento de MULTIPLICADOR_CUSTO_REPETIDO, só que por
// instância em vez de por tipo)
const FATOR_CUSTO_UPGRADE = 0.5;
const MULT_CUSTO_UPGRADE_REPETIDO = 1.3;
// vender devolve 70% do total investido na instância (preço de compra +
// upgrades pagos) — nunca o preço cheio, senão comprar-e-vender vira
// forma grátis de "resetar" o escalonamento de preço por tipo
const FATOR_VENDA = 0.7;

function multiplicadorUpgrade(instancia) {
  return 1 + (instancia.nivelUpgrade || 0) * MULT_UPGRADE_GANHO;
}

function custoProximoUpgrade(instancia) {
  const config = FABRICAS[instancia.tipo];
  const nivel = instancia.nivelUpgrade || 0;
  if (nivel >= NIVEL_UPGRADE_MAX) return null;
  return Math.round(config.custo * FATOR_CUSTO_UPGRADE * Math.pow(MULT_CUSTO_UPGRADE_REPETIDO, nivel));
}

function valorVenda(instancia) {
  const config = FABRICAS[instancia.tipo];
  const investido = instancia.investimentoTotal ?? instancia.precoCompra ?? config.custo;
  return Math.round(investido * FATOR_VENDA);
}

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
let totalFabricas = 0;
let tempoJogadoAcumulado = 0; // segundos, restaurado do progresso salvo (se houver)
const inicioSessaoMs = Date.now();
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
  return Math.round(config.ganhoPorTick * (1 + bonus) * multiplicadorUpgrade(instancia) * configDificuldade().multGanho);
}

// poluição efetiva de UMA instância no tick atual, já descontando a
// redução de todas as vizinhas ortogonais com reducaoPoluicaoAdjacencia
// (ex: Usina Eólica), respeitando o teto REDUCAO_ADJACENCIA_MAX — a
// dificuldade entra por último, igual em calcularGanhoInstancia
function calcularPoluicaoInstancia(instancia) {
  const config = FABRICAS[instancia.tipo];
  if (!config.poluicaoPorTick) return 0;
  let reducao = 0;
  for (const outra of instanciasConstruidas) {
    if (outra === instancia) continue;
    const configOutra = FABRICAS[outra.tipo];
    if (!configOutra.reducaoPoluicaoAdjacencia) continue;
    if (footprintsVizinhos(instancia, outra)) reducao += configOutra.reducaoPoluicaoAdjacencia;
  }
  reducao = Math.min(reducao, REDUCAO_ADJACENCIA_MAX);
  return Math.round(config.poluicaoPorTick * multiplicadorUpgrade(instancia) * (1 - reducao) * configDificuldade().multPoluicao);
}

function mostrarNumeroFlutuante(instancia, texto, classeExtra) {
  const ponto = centroFootprintNaTela(instancia.col, instancia.row, instancia.colSpan, instancia.rowSpan);
  const numero = document.createElement('div');
  numero.className = 'numero-flutuante' + (classeExtra ? ' ' + classeExtra : '');
  numero.textContent = texto;
  numero.style.left = ponto.x + 'px';
  numero.style.top = ponto.y + 'px';
  document.body.appendChild(numero);
  setTimeout(() => numero.remove(), 1150);
}

function tickEconomia() {
  if (jogoEncerrado || instanciasConstruidas.length === 0) return;
  let ganhoDoTick = 0;
  let reducaoGlobalDoTick = 0;
  instanciasConstruidas.forEach((instancia) => {
    const config = FABRICAS[instancia.tipo];
    const ganho = calcularGanhoInstancia(instancia);
    ganhoDoTick += ganho;
    poluicaoTotal += calcularPoluicaoInstancia(instancia);
    if (ganho > 0) mostrarNumeroFlutuante(instancia, '+' + formatarDinheiro(ganho));
    if (config.reducaoGlobalPorTick) {
      const reducao = Math.round(config.reducaoGlobalPorTick * multiplicadorUpgrade(instancia));
      reducaoGlobalDoTick += reducao;
      mostrarNumeroFlutuante(instancia, '−' + reducao + ' poluição', 'numero-flutuante--poluicao');
    }
  });
  poluicaoTotal = Math.max(0, poluicaoTotal - reducaoGlobalDoTick);
  dinheiro += ganhoDoTick;
  atualizarHudDinheiro();
  atualizarHudPoluicao();
  pulsarGanhoNoHud();
  if (painelFabricas.classList.contains('aberto')) atualizarCartasFabricas();
  verificarFimDeJogo();
  salvarProgresso();
}
setInterval(tickEconomia, TICK_ECONOMIA_MS);

// ============ GERENCIAR CONSTRUÇÃO (clicar numa já construída) ============
// clicar em qualquer construção já construída no grid abre este painel com
// duas ações: Melhorar (paga pra aumentar a métrica principal dela, ver
// multiplicadorUpgrade) e Vender (remove do grid, devolve FATOR_VENDA do
// que foi investido nela e libera as células pra construir de novo ali)
const painelInstancia = document.getElementById('painel-instancia');
const instanciaCategoriaEl = document.getElementById('instancia-categoria');
const instanciaNomeEl = document.getElementById('instancia-nome');
const instanciaGanhoEl = document.getElementById('instancia-ganho');
const instanciaPoluicaoEl = document.getElementById('instancia-poluicao');
const instanciaNivelEl = document.getElementById('instancia-nivel');
const statusInstancia = document.getElementById('status-instancia');
const btnInstanciaMelhorar = document.getElementById('btn-instancia-melhorar');
const btnInstanciaVender = document.getElementById('btn-instancia-vender');
let instanciaSelecionada = null;

// texto da "métrica principal": ganho em dinheiro pra quem rende, ou a
// redução de poluição global pra quem não rende (ex: Estação de
// Tratamento, ganhoPorTick 0) — sempre o que multiplicadorUpgrade afeta
function textoMetricaPrincipal(instancia) {
  const config = FABRICAS[instancia.tipo];
  if (!config.ganhoPorTick && config.reducaoGlobalPorTick) {
    const reducao = Math.round(config.reducaoGlobalPorTick * multiplicadorUpgrade(instancia));
    return '−' + reducao.toLocaleString('pt-BR') + ' poluição/tick (geral)';
  }
  return '+' + formatarDinheiro(calcularGanhoInstancia(instancia)) + '/tick';
}

function atualizarPainelInstancia() {
  if (!instanciaSelecionada) return;
  const config = FABRICAS[instanciaSelecionada.tipo];
  instanciaCategoriaEl.textContent = config.categoria;
  instanciaNomeEl.textContent = config.nome;
  instanciaGanhoEl.textContent = textoMetricaPrincipal(instanciaSelecionada);
  instanciaPoluicaoEl.textContent = calcularPoluicaoInstancia(instanciaSelecionada).toLocaleString('pt-BR') + '/tick';
  instanciaNivelEl.textContent = `${instanciaSelecionada.nivelUpgrade || 0} / ${NIVEL_UPGRADE_MAX}`;

  const custoUpgrade = custoProximoUpgrade(instanciaSelecionada);
  if (custoUpgrade === null) {
    btnInstanciaMelhorar.textContent = 'Nível máximo';
    btnInstanciaMelhorar.disabled = true;
  } else {
    btnInstanciaMelhorar.textContent = `Melhorar — ${formatarDinheiro(custoUpgrade)}`;
    btnInstanciaMelhorar.disabled = custoUpgrade > dinheiro;
  }
  btnInstanciaVender.textContent = `Vender — +${formatarDinheiro(valorVenda(instanciaSelecionada))}`;
}

function abrirPainelInstancia(instancia) {
  // não abre no meio de uma colocação em andamento, nem depois do fim de jogo
  if (jogoEncerrado || estadoConstrucao) return;
  instanciaSelecionada = instancia;
  statusInstancia.textContent = '';
  statusInstancia.classList.remove('visivel', 'painel-status--sucesso');
  atualizarPainelInstancia();
  painelInstancia.classList.add('aberto');
  painelInstancia.setAttribute('aria-hidden', 'false');
}
function fecharPainelInstancia() {
  painelInstancia.classList.remove('aberto');
  painelInstancia.setAttribute('aria-hidden', 'true');
  instanciaSelecionada = null;
}
document.getElementById('btn-instancia-fechar').addEventListener('click', fecharPainelInstancia);

btnInstanciaMelhorar.addEventListener('click', () => {
  if (!instanciaSelecionada) return;
  const custoUpgrade = custoProximoUpgrade(instanciaSelecionada);
  if (custoUpgrade === null || custoUpgrade > dinheiro) return;

  dinheiro -= custoUpgrade;
  instanciaSelecionada.nivelUpgrade = (instanciaSelecionada.nivelUpgrade || 0) + 1;
  instanciaSelecionada.investimentoTotal = (instanciaSelecionada.investimentoTotal || 0) + custoUpgrade;

  const tinta = instanciaSelecionada.wrapper.querySelector('.fabrica-tinta');
  if (tinta) {
    tinta.classList.remove('fabrica-tinta--sucesso');
    void tinta.offsetWidth;
    tinta.classList.add('fabrica-tinta--sucesso');
  }

  atualizarHudDinheiro();
  atualizarCartasFabricas();
  atualizarPainelInstancia();
  statusInstancia.textContent = 'Melhoria aplicada.';
  statusInstancia.classList.add('visivel', 'painel-status--sucesso');
  salvarProgresso();
});

btnInstanciaVender.addEventListener('click', () => {
  if (!instanciaSelecionada) return;
  const instancia = instanciaSelecionada;
  const valor = valorVenda(instancia);

  dinheiro += valor;
  totalFabricas = Math.max(0, totalFabricas - 1);
  quantidadePorTipo[instancia.tipo] = Math.max(0, (quantidadePorTipo[instancia.tipo] || 1) - 1);
  desmarcarFootprintOcupado(instancia.col, instancia.row, instancia.colSpan, instancia.rowSpan);
  const indice = instanciasConstruidas.indexOf(instancia);
  if (indice !== -1) instanciasConstruidas.splice(indice, 1);
  instancia.wrapper.remove();

  atualizarHudDinheiro();
  atualizarHudFabricas();
  atualizarCartasFabricas();
  fecharPainelInstancia();
  salvarProgresso();
});

// ============ FISCALIZAÇÃO AMBIENTAL (multas por poluição) ============
const FISCALIZACAO_INTERVALO_MS = 25000;
const FATOR_MULTA = 0.3;

function pulsarMultaNoHud() {
  hudDinheiroEl.classList.remove('pulso-multa');
  void hudDinheiroEl.offsetWidth;
  hudDinheiroEl.classList.add('pulso-multa');
}

function aplicarFiscalizacao() {
  if (jogoEncerrado || poluicaoTotal <= 0) return;
  const multa = Math.round(poluicaoTotal * FATOR_MULTA * configDificuldade().multMulta);
  if (multa <= 0) return;
  dinheiro = Math.max(0, dinheiro - multa);
  atualizarHudDinheiro();
  atualizarCartasFabricas();
  pulsarMultaNoHud();
  const valorEl = document.createElement('strong');
  valorEl.textContent = formatarDinheiro(multa);
  mostrarToast('Fiscalização ambiental: multa de ', valorEl, ' pela poluição acumulada.');
  salvarProgresso();
}
setInterval(aplicarFiscalizacao, FISCALIZACAO_INTERVALO_MS);

// ============ META DE VITÓRIA / COLAPSO DA EMPRESA ============
// aumentados em +50% em relação ao valor original (60000/4000) — com 6
// construções diferentes agora, o jogo precisa de mais fôlego pra dar
// tempo de experimentar a economia toda antes de acabar
const META_CAIXA = 90000;
const LIMIAR_COLAPSO = 6000;
let jogoEncerrado = null; // null | 'colapso' | 'vitoria'

function segundosJogados() {
  return tempoJogadoAcumulado + Math.floor((Date.now() - inicioSessaoMs) / 1000);
}
function formatarTempo(segundosTotais) {
  const min = Math.floor(segundosTotais / 60);
  const seg = segundosTotais % 60;
  return `${min}min ${String(seg).padStart(2, '0')}s`;
}
function preencherEstatisticasFim(prefixo) {
  document.getElementById(`${prefixo}-tempo`).textContent = formatarTempo(segundosJogados());
  document.getElementById(`${prefixo}-caixa`).textContent = formatarDinheiro(dinheiro);
  document.getElementById(`${prefixo}-poluicao`).textContent = poluicaoTotal.toLocaleString('pt-BR');
  document.getElementById(`${prefixo}-fabricas`).textContent = String(totalFabricas);
}
function pausarConstrucao() {
  abortarColocacao();
  btnFabricas.disabled = true;
}
function mostrarTelaVitoria() {
  pausarConstrucao();
  preencherEstatisticasFim('vitoria');
  document.getElementById('tela-vitoria').classList.add('aberto');
}
function mostrarTelaColapso() {
  pausarConstrucao();
  preencherEstatisticasFim('colapso');
  document.getElementById('tela-colapso').classList.add('aberto');
}
function verificarFimDeJogo() {
  if (jogoEncerrado) return;
  if (poluicaoTotal >= LIMIAR_COLAPSO) {
    jogoEncerrado = 'colapso';
    mostrarTelaColapso();
  } else if (dinheiro >= META_CAIXA) {
    jogoEncerrado = 'vitoria';
    mostrarTelaVitoria();
  }
}
const hudMetaEl = document.getElementById('hud-meta');
if (hudMetaEl) hudMetaEl.textContent = 'meta ' + formatarDinheiro(META_CAIXA);

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
// em (col, row) — pra pegada 1x1 isso é o mesmo que o centro da célula.
// Usado só pra UI que deve ficar "no meio" da pegada (barra de
// Confirmar/Cancelar, número flutuante de ganho) — NÃO usar pra
// posicionar o sprite em si, ver baseFootprintNaTela logo abaixo.
function centroFootprintNaTela(col, row, colSpan, rowSpan) {
  return pontoNaTela(col + colSpan / 2, row + rowSpan / 2);
}

// ponto de ancoragem da BASE do sprite de uma construção: o vértice do
// losango mais próximo do jogador (maior coluna E maior linha ao mesmo
// tempo — é aí que o losango "aponta" pra frente), não o centro
// geométrico da pegada. Horizontalmente ainda usa o centro (mantém o
// sprite simétrico esquerda/direita mesmo em pegadas não-quadradas, tipo
// 3x2); só o eixo vertical muda pro vértice.
//
// Bug real que isso corrige: com o sprite ancorado pelo CENTRO (como era
// antes), a metade "da frente" do losango — do centro até o vértice mais
// próximo — ficava sem nenhum pixel de sprite em cima, mesmo essas
// células estando ocupadas/reservadas. Numa pegada pequena (1x1, 2x1)
// isso quase não se notava; numa pegada maior (3x2, como a Madeireira)
// virava uma faixa enorme de "chão vazio" na frente da construção, dando
// a impressão de que ela não preenche direito o próprio espaço reservado.
function baseFootprintNaTela(col, row, colSpan, rowSpan) {
  const centro = centroFootprintNaTela(col, row, colSpan, rowSpan);
  const verticeProximo = pontoNaTela(col + colSpan, row + rowSpan);
  return { x: centro.x, y: verticeProximo.y };
}

// largura visual (no espaço da imagem) da pegada isométrica de
// colSpan x rowSpan células — parte do contorno do losango isométrico
// (colSpan+rowSpan)*(TILE_W/2), com uma margem de 15% pra dentro, já que
// o sprite é um retângulo (não um losango) e sem essa folga os cantos
// dele passam visualmente da pegada de 2 células
function larguraImagemParaFootprint(colSpan, rowSpan) {
  return (colSpan + rowSpan) * (TILE_W / 2) * 0.85;
}

// altura MÁXIMA (no espaço da imagem) que qualquer sprite pode ocupar,
// não importa a pegada — sem esse teto, um desenho muito estreito e alto
// (torre, chaminé isolada) acaba com uma altura ABSURDA só porque a
// largura dele (vinda só da pegada, larguraImagemParaFootprint) é pequena
// e a proporção da imagem é extrema: uma imagem 3x mais alta que larga
// numa pegada 1x1 (largura ~68) resultaria em ~213 de altura — quase o
// dobro da Usina de Carvão (~117), completamente fora de escala com o
// resto do cenário. 150 foi escolhido comparando as 6 construções lado a
// lado: dá folga pra torres (água/eólica) ficarem visivelmente mais altas
// que uma fábrica comum, sem dominar a cena.
const ALTURA_MAX_SPRITE = TILE_H * 3.75; // 150

// tamanho final (em espaço de imagem) que o sprite de uma construção deve
// ocupar: começa do alvo de largura dado pela pegada
// (larguraImagemParaFootprint) e mantém a PROPORÇÃO REAL do arquivo
// (config.larguraImagemPx/alturaImagemPx) — só reduz a largura abaixo do
// alvo da pegada se isso for necessário pra não estourar ALTURA_MAX_SPRITE
// (efeito "contain" dentro de uma caixa largura-da-pegada × altura-máxima,
// nunca estica a imagem, só encolhe quando a proporção pede). Recebe
// colSpan/rowSpan à parte (não lê de config.celulasCol/celulasRow) porque
// uma instância restaurada de um save antigo pode ter sido construída sob
// uma pegada diferente da que o FABRICAS de hoje define pro mesmo tipo.
function tamanhoRenderizado(config, colSpan, rowSpan) {
  const larguraAlvo = larguraImagemParaFootprint(colSpan, rowSpan);
  const razaoAltura = config.alturaImagemPx / config.larguraImagemPx;
  let largura = larguraAlvo;
  let altura = larguraAlvo * razaoAltura;
  if (altura > ALTURA_MAX_SPRITE) {
    altura = ALTURA_MAX_SPRITE;
    largura = altura / razaoAltura;
  }
  return { largura, altura };
}

function escalaAtual() {
  return Math.min(window.innerWidth / IMG_W, window.innerHeight / IMG_H);
}

function posicionarInstancia(instancia) {
  const ponto = baseFootprintNaTela(instancia.col, instancia.row, instancia.colSpan, instancia.rowSpan);
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

// inverso de marcarFootprintOcupado — libera as células de uma construção
// vendida, pra dar pra construir ali de novo
function desmarcarFootprintOcupado(col, row, colSpan, rowSpan) {
  for (let dc = 0; dc < colSpan; dc++) {
    for (let dr = 0; dr < rowSpan; dr++) {
      celulasOcupadas.delete(chaveCelula(col + dc, row + dr));
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
  if (jogoEncerrado) return;
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
    larguraImagem: tamanhoRenderizado(config, colSpan, rowSpan).largura,
    travado: false, col: null, row: null, barra: null,
  };

  btnFabricas.disabled = true;

  reposicionarFantasma(ultimoMouseX, ultimoMouseY);
  setTimeout(() => {
    window.addEventListener('pointerdown', aoPressionarDurantePlacement);
    window.addEventListener('pointerup', aoSoltarDurantePlacement);
  }, 0);
}

// ---- destaque no grid dos quadrados afetados por adjacência, enquanto
// uma colocação está em andamento ----
// preenche o losango isométrico de UMA célula com uma cor (mesmo contorno
// de losango usado pra desenhar o grid, só que preenchido em vez de traçado)
function preencherCelula(col, row, corPreenchimento, corContorno) {
  const p1 = pontoNaTela(col, row);
  const p2 = pontoNaTela(col + 1, row);
  const p3 = pontoNaTela(col + 1, row + 1);
  const p4 = pontoNaTela(col, row + 1);
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.lineTo(p4.x, p4.y);
  ctx.closePath();
  ctx.fillStyle = corPreenchimento;
  ctx.fill();
  if (corContorno) {
    ctx.strokeStyle = corContorno;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}
function preencherFootprint(col, row, colSpan, rowSpan, corPreenchimento, corContorno) {
  for (let dc = 0; dc < colSpan; dc++) {
    for (let dr = 0; dr < rowSpan; dr++) {
      preencherCelula(col + dc, row + dr, corPreenchimento, corContorno);
    }
  }
}

// âmbar (--amber) = pegada livre, onde o fantasma pode ser confirmado;
// ferrugem (--rust) = pegada ocupada, não dá pra confirmar ali
const COR_FOOTPRINT_LIVRE = 'rgba(217,154,53,0.30)';
const COR_FOOTPRINT_OCUPADO = 'rgba(138,74,47,0.40)';
const COR_CONTORNO_FOOTPRINT = 'rgba(217,154,53,0.75)';

// verde (mesma família do --moss-bright) pro efeito de ganho, azul (mesma
// família do --agua) pro efeito de redução de poluição — "existente" é
// mais fraco (rede já montada, só informativo), "fantasma" é mais forte
// (o que ESSA colocação vai criar se for confirmada onde está agora)
const COR_DESTAQUE_GANHO_EXISTENTE = 'rgba(143,191,114,0.16)';
const COR_DESTAQUE_GANHO_FANTASMA = 'rgba(143,191,114,0.42)';
const COR_DESTAQUE_POLUICAO_EXISTENTE = 'rgba(95,151,166,0.16)';
const COR_DESTAQUE_POLUICAO_FANTASMA = 'rgba(95,151,166,0.42)';
const COR_CONTORNO_DESTAQUE = 'rgba(239,232,214,0.55)';

// enquanto uma colocação está em andamento, marca no grid as células que a
// PRÓPRIA pegada do fantasma vai ocupar — âmbar se livre (pode confirmar
// ali), ferrugem se alguma célula já está ocupada (mesma cor de "cancelar"
// usada no resto do jogo). Sem isso não tinha nenhuma indicação visual de
// "essas são as células que vão virar essa construção", só o sprite meio
// transparente por cima, que não deixa claro os limites exatos da pegada.
function desenharFootprintFantasma() {
  if (!estadoConstrucao || estadoConstrucao.col === null) return;
  const { col, row, colSpan, rowSpan } = estadoConstrucao;
  const ocupada = footprintOcupado(col, row, colSpan, rowSpan);
  const cor = ocupada ? COR_FOOTPRINT_OCUPADO : COR_FOOTPRINT_LIVRE;
  preencherFootprint(col, row, colSpan, rowSpan, cor, COR_CONTORNO_FOOTPRINT);
}

// enquanto uma colocação está em andamento, destaca: (1) os quadrados de
// construções JÁ existentes que hoje dão/recebem efeito de adjacência
// umas nas outras (a rede atual, sempre visível durante a colocação,
// independente do que está sendo colocado) e (2) se a construção sendo
// colocada tiver ela mesma um efeito de adjacência, os quadrados das
// vizinhas que ela vai afetar SE for confirmada na posição atual do
// fantasma (destaque mais forte que o da rede existente)
function desenharDestaquesAdjacencia() {
  if (!estadoConstrucao) return;

  instanciasConstruidas.forEach((origem) => {
    const config = FABRICAS[origem.tipo];
    if (!config.bonusAdjacencia && !config.reducaoPoluicaoAdjacencia) return;
    const cor = config.bonusAdjacencia ? COR_DESTAQUE_GANHO_EXISTENTE : COR_DESTAQUE_POLUICAO_EXISTENTE;
    instanciasConstruidas.forEach((vizinha) => {
      if (vizinha === origem) return;
      if (footprintsVizinhos(origem, vizinha)) preencherFootprint(vizinha.col, vizinha.row, vizinha.colSpan, vizinha.rowSpan, cor);
    });
  });

  const configFantasma = estadoConstrucao.config;
  const temEfeito = configFantasma.bonusAdjacencia || configFantasma.reducaoPoluicaoAdjacencia;
  if (temEfeito && estadoConstrucao.col !== null) {
    const cor = configFantasma.bonusAdjacencia ? COR_DESTAQUE_GANHO_FANTASMA : COR_DESTAQUE_POLUICAO_FANTASMA;
    const alvo = { col: estadoConstrucao.col, row: estadoConstrucao.row, colSpan: estadoConstrucao.colSpan, rowSpan: estadoConstrucao.rowSpan };
    instanciasConstruidas.forEach((vizinha) => {
      if (footprintsVizinhos(alvo, vizinha)) preencherFootprint(vizinha.col, vizinha.row, vizinha.colSpan, vizinha.rowSpan, cor, COR_CONTORNO_DESTAQUE);
    });
  }
}

// grid base + destaques por cima — usada em todo redesenho depois que o
// jogo termina de carregar (a primeira pintura do grid, lá no topo do
// arquivo, continua chamando desenharGrid() sozinha: FABRICAS/
// instanciasConstruidas/estadoConstrucao ainda não existem nesse ponto)
function redesenharCena() {
  desenharGrid();
  desenharFootprintFantasma();
  desenharDestaquesAdjacencia();
}

function reposicionarFantasma(mx, my) {
  if (!estadoConstrucao || estadoConstrucao.travado) return;
  const bruto = celulaMaisProxima(mx, my);
  const { col, row } = clampFootprint(bruto.col, bruto.row, estadoConstrucao.colSpan, estadoConstrucao.rowSpan);
  const mudouCelula = estadoConstrucao.col !== col || estadoConstrucao.row !== row;
  estadoConstrucao.col = col;
  estadoConstrucao.row = row;
  posicionarInstancia(estadoConstrucao);
  const ocupada = footprintOcupado(col, row, estadoConstrucao.colSpan, estadoConstrucao.rowSpan);
  estadoConstrucao.wrapper.classList.toggle('fabrica-instancia--ocupada', ocupada);
  if (mudouCelula) redesenharCena();
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
  redesenharCena(); // limpa os destaques de adjacência do grid (estadoConstrucao já é null aqui)
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
  const instancia = {
    wrapper, col, row, colSpan, rowSpan, larguraImagem, tipo,
    precoCompra, investimentoTotal: precoCompra, nivelUpgrade: 0,
  };
  instanciasConstruidas.push(instancia);
  wrapper.addEventListener('click', () => abrirPainelInstancia(instancia));

  setTimeout(() => tinta.remove(), 550);
  encerrarEstadoConstrucao();
  salvarProgresso();
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
  redesenharCena(); // reafirma os destaques por cima do grid limpo que atualizarTudo() acabou de redesenhar
});

// ============ AUTOSAVE / RESTAURAÇÃO DE PROGRESSO ============
// progresso vive dentro do mesmo save persistido pelo menu
// (parasitas-saves-{usuario}[slot].progresso) — não é uma chave separada
function chaveSavesContaAtual() {
  return saveAtivoInfo?.usuario ? `parasitas-saves-${saveAtivoInfo.usuario}` : null;
}
function lerTodosSavesContaAtual() {
  const chave = chaveSavesContaAtual();
  if (!chave) return {};
  try {
    return JSON.parse(localStorage.getItem(chave)) || {};
  } catch {
    return {};
  }
}

function salvarProgresso() {
  const chave = chaveSavesContaAtual();
  if (!chave || !saveAtivoInfo?.slot) return; // abriu fase1.html sem vir do menu — nada pra gravar
  const todos = lerTodosSavesContaAtual();
  const existente = todos[saveAtivoInfo.slot] || {};
  todos[saveAtivoInfo.slot] = {
    ...existente,
    slot: saveAtivoInfo.slot,
    nomeSave: saveAtivoInfo.nomeSave,
    jogador: saveAtivoInfo.jogador,
    empresa: saveAtivoInfo.empresa,
    dificuldade: saveAtivoInfo.dificuldade,
    atualizadoEm: Date.now(),
    progresso: {
      dinheiro,
      poluicaoTotal,
      totalFabricas,
      quantidadePorTipo: { ...quantidadePorTipo },
      instancias: instanciasConstruidas.map((i) => ({
        tipo: i.tipo, col: i.col, row: i.row, colSpan: i.colSpan, rowSpan: i.rowSpan,
        precoCompra: i.precoCompra, investimentoTotal: i.investimentoTotal, nivelUpgrade: i.nivelUpgrade || 0,
      })),
      tempoJogadoSegundos: segundosJogados(),
      colapsada: jogoEncerrado === 'colapso',
      vitoriaAlcancada: jogoEncerrado === 'vitoria',
    },
  };
  localStorage.setItem(chave, JSON.stringify(todos));
}
window.addEventListener('beforeunload', salvarProgresso);

// reconstrói o estado salvo (dinheiro, poluição, construções no grid) em
// vez de começar do zero — chamada uma vez, no fim do carregamento
function restaurarProgresso() {
  const chave = chaveSavesContaAtual();
  if (!chave || !saveAtivoInfo?.slot) return;
  const progresso = lerTodosSavesContaAtual()[saveAtivoInfo.slot]?.progresso;
  if (!progresso) return;

  dinheiro = progresso.dinheiro ?? dinheiro;
  poluicaoTotal = progresso.poluicaoTotal ?? poluicaoTotal;
  Object.assign(quantidadePorTipo, progresso.quantidadePorTipo || {});
  tempoJogadoAcumulado = progresso.tempoJogadoSegundos || 0;

  (progresso.instancias || []).forEach((dados) => {
    const config = FABRICAS[dados.tipo];
    if (!config) return; // segurança: construção que não existe mais no jogo
    const { wrapper, tinta } = criarSprite(config);
    tinta.remove(); // instância restaurada já nasce "pronta", sem flash de confirmação
    wrapper.classList.add('fabrica-instancia--travada', 'fabrica-instancia--construida');
    const instancia = {
      wrapper, tipo: dados.tipo, col: dados.col, row: dados.row,
      colSpan: dados.colSpan, rowSpan: dados.rowSpan,
      larguraImagem: tamanhoRenderizado(config, dados.colSpan, dados.rowSpan).largura,
      // saves de antes desse recurso não têm esses campos — cai pro preço
      // base como estimativa razoável do que foi investido
      precoCompra: dados.precoCompra ?? config.custo,
      investimentoTotal: dados.investimentoTotal ?? dados.precoCompra ?? config.custo,
      nivelUpgrade: dados.nivelUpgrade || 0,
    };
    posicionarInstancia(instancia);
    marcarFootprintOcupado(instancia.col, instancia.row, instancia.colSpan, instancia.rowSpan);
    instanciasConstruidas.push(instancia);
    wrapper.addEventListener('click', () => abrirPainelInstancia(instancia));
  });

  // recalculado a partir das instâncias de verdade (não confia no número
  // salvo) — assim autocorrige saves antigos, de antes da contagem bater
  // certo com o que está realmente construído no grid
  totalFabricas = instanciasConstruidas.length;

  atualizarHudDinheiro();
  atualizarHudFabricas();
  atualizarHudPoluicao();
  atualizarCartasFabricas();

  if (progresso.colapsada) {
    jogoEncerrado = 'colapso';
    mostrarTelaColapso();
  } else if (progresso.vitoriaAlcancada) {
    jogoEncerrado = 'vitoria';
    mostrarTelaVitoria();
  }
}
restaurarProgresso();
