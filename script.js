// ============ CONTAS LOCAIS (login/cadastro) ============
// Sem servidor: usuário+senha ficam só no localStorage deste navegador,
// senha guardada como hash (nunca em texto puro). Isso NÃO é autenticação
// de verdade nem sincroniza entre aparelhos — é só uma forma de separar o
// progresso de pessoas diferentes usando o mesmo computador/navegador
// (aviso disso já fica explícito na tela de login pro jogador).
const CHAVE_CONTAS = 'parasitas-contas';
const CHAVE_SESSAO = 'parasitas-sessao';

async function hashSenha(usuario, senha) {
  const dados = new TextEncoder().encode('parasitas-salt::' + usuario.toLowerCase() + '::' + senha);
  const buffer = await crypto.subtle.digest('SHA-256', dados);
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function carregarContas() {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_CONTAS)) || {};
  } catch {
    return {};
  }
}
function salvarContas(contas) {
  localStorage.setItem(CHAVE_CONTAS, JSON.stringify(contas));
}

// devolve a chave (usuário em minúsculas) da conta logada, ou null —
// também null se a sessão apontar pra uma conta que não existe mais
function sessaoAtual() {
  const chave = localStorage.getItem(CHAVE_SESSAO);
  if (!chave) return null;
  return carregarContas()[chave] ? chave : null;
}
function iniciarSessao(chave) {
  localStorage.setItem(CHAVE_SESSAO, chave);
}
function encerrarSessao() {
  localStorage.removeItem(CHAVE_SESSAO);
}

// entra na conta se a senha bater; cria a conta na hora se o usuário
// ainda não existir (mesmo formulário serve pra login e cadastro)
async function entrarOuCriarConta(usuario, senha) {
  const hash = await hashSenha(usuario, senha);
  const contas = carregarContas();
  const chave = usuario.toLowerCase();
  const existente = contas[chave];
  if (existente) {
    if (existente.senhaHash !== hash) return { ok: false, motivo: 'Senha incorreta.' };
  } else {
    contas[chave] = { usuario, senhaHash: hash, criadoEm: Date.now() };
    salvarContas(contas);
  }
  iniciarSessao(chave);
  return { ok: true };
}

const painelLogin = document.getElementById('painel-login');
const campoLoginUsuario = document.getElementById('campo-login-usuario');
const campoLoginSenha = document.getElementById('campo-login-senha');
const statusLogin = document.getElementById('status-login');
const footerConta = document.getElementById('footer-conta');
const footerContaSep = document.getElementById('footer-conta-sep');

function tremerPainelLogin() {
  const conteudo = painelLogin.querySelector('.painel-conteudo');
  conteudo.classList.remove('tremer');
  void conteudo.offsetWidth;
  conteudo.classList.add('tremer');
}
function mostrarStatusLogin(mensagem) {
  statusLogin.textContent = mensagem;
  statusLogin.classList.add('visivel');
}
function abrirGateLogin() {
  painelLogin.classList.add('aberto');
  painelLogin.setAttribute('aria-hidden', 'false');
  campoLoginUsuario.focus();
}
function fecharGateLogin() {
  painelLogin.classList.remove('aberto');
  painelLogin.setAttribute('aria-hidden', 'true');
}

function atualizarIndicadorConta() {
  const chave = sessaoAtual();
  if (!chave) {
    footerConta.hidden = true;
    footerContaSep.hidden = true;
    return;
  }
  footerConta.hidden = false;
  footerContaSep.hidden = false;
  footerConta.textContent = '';
  const nomeEl = document.createElement('span');
  nomeEl.className = 'footer-conta-usuario';
  nomeEl.textContent = carregarContas()[chave].usuario;
  const botaoSair = document.createElement('button');
  botaoSair.className = 'footer-conta-sair';
  botaoSair.textContent = 'Sair';
  botaoSair.addEventListener('click', () => {
    encerrarSessao();
    atualizarIndicadorConta();
    abrirGateLogin();
  });
  footerConta.append(nomeEl, ' · ', botaoSair);
}

document.getElementById('btn-entrar').addEventListener('click', async () => {
  const usuario = campoLoginUsuario.value.trim();
  const senha = campoLoginSenha.value;
  if (!usuario || !senha) {
    mostrarStatusLogin('Preencha usuário e senha.');
    tremerPainelLogin();
    return;
  }
  mostrarStatusLogin('Entrando...');
  try {
    const resultado = await entrarOuCriarConta(usuario, senha);
    if (!resultado.ok) {
      mostrarStatusLogin(resultado.motivo);
      tremerPainelLogin();
      campoLoginSenha.value = '';
      campoLoginSenha.focus();
      return;
    }
  } catch {
    mostrarStatusLogin('Não deu pra entrar neste navegador. Tenta de novo.');
    tremerPainelLogin();
    return;
  }
  campoLoginSenha.value = '';
  statusLogin.classList.remove('visivel');
  fecharGateLogin();
  atualizarIndicadorConta();
});

campoLoginSenha.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-entrar').click();
});

if (!sessaoAtual()) {
  abrirGateLogin();
} else {
  atualizarIndicadorConta();
}

// gera partículas de fuligem caindo, densidade contida
const campo = document.getElementById('fuligem');
const total = window.innerWidth < 640 ? 8 : 14;

for (let i = 0; i < total; i++) {
  const p = document.createElement('div');
  p.className = 'particula';
  const dur = 9 + Math.random() * 10;
  const delay = Math.random() * 10;
  const size = 2 + Math.random() * 2;
  p.style.left = Math.random() * 100 + 'vw';
  p.style.width = size + 'px';
  p.style.height = size + 'px';
  p.style.animationDuration = dur + 's';
  p.style.animationDelay = '-' + delay + 's';
  p.style.opacity = (0.15 + Math.random() * 0.25).toFixed(2);
  campo.appendChild(p);
}

const reduzMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// relógio do rodapé, tipo HUD
function atualizarRelogio() {
  const relogio = document.getElementById('relogio');
  if (!relogio) return;
  const agora = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  relogio.textContent = `${pad(agora.getHours())}:${pad(agora.getMinutes())}:${pad(agora.getSeconds())}`;
}
atualizarRelogio();
setInterval(atualizarRelogio, 1000);

// parallax sutil do fundo seguindo o mouse
const bgEl = document.querySelector('.bg');
if (bgEl && !reduzMovimento) {
  let alvoX = 0, alvoY = 0, atualX = 0, atualY = 0;
  window.addEventListener('mousemove', (e) => {
    alvoX = (e.clientX / window.innerWidth - 0.5) * 2;
    alvoY = (e.clientY / window.innerHeight - 0.5) * 2;
  });
  (function animarParallax() {
    atualX += (alvoX - atualX) * 0.04;
    atualY += (alvoY - atualY) * 0.04;
    bgEl.style.backgroundPosition = `calc(50% - ${(atualX * 1.4).toFixed(2)}%) calc(38% - ${(atualY * 1).toFixed(2)}%)`;
    requestAnimationFrame(animarParallax);
  })();
}

// navegação do menu por teclado (setas + Enter/Espaço nativos do botão)
const itensMenu = Array.from(document.querySelectorAll('nav.menu .item'));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  if (document.querySelector('.painel.aberto')) return;
  e.preventDefault();
  const atual = itensMenu.indexOf(document.activeElement);
  let proximo;
  if (atual === -1) {
    proximo = e.key === 'ArrowDown' ? 0 : itensMenu.length - 1;
  } else {
    const delta = e.key === 'ArrowDown' ? 1 : -1;
    proximo = (atual + delta + itensMenu.length) % itensMenu.length;
  }
  itensMenu[proximo].focus();
});

// feedback de clique nos botões do menu
document.querySelectorAll('.item').forEach((botao) => {
  botao.addEventListener('click', () => {
    botao.classList.remove('clicado');
    // força reflow pra permitir reiniciar a animação em cliques seguidos
    void botao.offsetWidth;
    botao.classList.add('clicado');
    setTimeout(() => botao.classList.remove('clicado'), 220);
  });
});

// abrir / fechar painéis (Como Jogar, Créditos)
function abrirPainel(id) {
  const painel = document.getElementById(id);
  if (!painel) return;
  painel.classList.add('aberto');
  painel.setAttribute('aria-hidden', 'false');
}
function fecharPainel(id) {
  const painel = document.getElementById(id);
  if (!painel) return;
  painel.classList.remove('aberto');
  painel.setAttribute('aria-hidden', 'true');
}

document.getElementById('btn-como-jogar').addEventListener('click', () => {
  setTimeout(() => abrirPainel('painel-como-jogar'), 150);
});
document.getElementById('btn-creditos').addEventListener('click', () => {
  setTimeout(() => abrirPainel('painel-creditos'), 150);
});
document.getElementById('btn-novo-jogo').addEventListener('click', () => {
  setTimeout(() => abrirPainel('painel-novo-jogo'), 150);
});

document.querySelectorAll('.painel-voltar').forEach((botao) => {
  botao.addEventListener('click', () => fecharPainel(botao.dataset.fechar));
});

// ============ PAINEL NOVO JOGO ============
// os 3 slots agora persistem de verdade em localStorage, namespaced por
// conta logada (parasitas-saves-{usuario}) — nada mais vive só em memória
function chaveSavesConta() {
  const conta = sessaoAtual();
  return conta ? `parasitas-saves-${conta}` : null;
}
function dadosVaziosSlot() {
  return { nomeSave: '', jogador: '', empresa: '', dificuldade: 'Iniciante' };
}
function carregarSavesConta() {
  const chave = chaveSavesConta();
  if (!chave) return { 1: null, 2: null, 3: null };
  try {
    const dados = JSON.parse(localStorage.getItem(chave)) || {};
    return { 1: dados[1] || null, 2: dados[2] || null, 3: dados[3] || null };
  } catch {
    return { 1: null, 2: null, 3: null };
  }
}
function salvarSavesConta() {
  const chave = chaveSavesConta();
  if (!chave) return;
  localStorage.setItem(chave, JSON.stringify(savesConta));
}
function formatarDinheiroSimples(valor) {
  return 'R$ ' + Math.round(valor || 0).toLocaleString('pt-BR');
}

let savesConta = { 1: null, 2: null, 3: null };
let slotAtual = 1;
let snapshotSlotAtual = null; // config do save no momento em que o slot foi escolhido

const campoNomeSave = document.getElementById('campo-nome-save');
const campoJogador = document.getElementById('campo-nome-jogador');
const campoEmpresa = document.getElementById('campo-nome-empresa');
const statusNovoJogo = document.getElementById('status-novo-jogo');

function atualizarRotulosSlots() {
  document.querySelectorAll('.slot').forEach((botao) => {
    const slot = Number(botao.dataset.slot);
    const salvo = savesConta[slot];
    const sub = botao.querySelector('.slot-sub');
    if (!sub) return;
    if (!salvo) sub.textContent = 'vazio';
    else if (salvo.progresso) sub.textContent = `${salvo.empresa} · ${formatarDinheiroSimples(salvo.progresso.dinheiro)}`;
    else sub.textContent = salvo.empresa || 'rascunho';
  });
}

function renderSlotAtual() {
  const salvo = savesConta[slotAtual];
  const dados = salvo || dadosVaziosSlot();
  campoNomeSave.value = dados.nomeSave;
  campoJogador.value = dados.jogador;
  campoEmpresa.value = dados.empresa;

  document.querySelectorAll('.dificuldade').forEach((botao) => {
    botao.classList.toggle('dificuldade-ativa', botao.dataset.dificuldade === dados.dificuldade);
  });

  snapshotSlotAtual = salvo
    ? { nomeSave: salvo.nomeSave, jogador: salvo.jogador, empresa: salvo.empresa, dificuldade: salvo.dificuldade }
    : null;

  statusNovoJogo.textContent = '';
  statusNovoJogo.classList.remove('visivel', 'painel-status--sucesso');
  atualizarRotulosSlots();
}

// recarrega os saves da conta atual e volta pro slot 1 toda vez que o
// painel Novo Jogo abre — evita mostrar dado de outra conta/sessão antiga
document.getElementById('btn-novo-jogo').addEventListener('click', () => {
  savesConta = carregarSavesConta();
  slotAtual = 1;
  document.querySelectorAll('.slot').forEach((s) => s.classList.toggle('slot-ativo', Number(s.dataset.slot) === 1));
  renderSlotAtual();
});

document.querySelectorAll('.slot').forEach((botao) => {
  botao.addEventListener('click', () => {
    slotAtual = Number(botao.dataset.slot);
    document.querySelectorAll('.slot').forEach((s) => s.classList.toggle('slot-ativo', s === botao));
    renderSlotAtual();
  });
});

// grava o campo editado no slot atual imediatamente (cria o slot em
// memória se ele ainda não existir) e persiste — um save "rascunho"
// sobrevive a um F5 mesmo antes de clicar Começar
function atualizarCampoSlot(campo, valor) {
  if (!savesConta[slotAtual]) {
    savesConta[slotAtual] = { slot: slotAtual, ...dadosVaziosSlot(), progresso: null, criadoEm: Date.now() };
  }
  savesConta[slotAtual][campo] = valor;
  savesConta[slotAtual].atualizadoEm = Date.now();
  salvarSavesConta();
  atualizarRotulosSlots();
}

campoNomeSave.addEventListener('input', () => atualizarCampoSlot('nomeSave', campoNomeSave.value));
campoJogador.addEventListener('input', () => atualizarCampoSlot('jogador', campoJogador.value));
campoEmpresa.addEventListener('input', () => atualizarCampoSlot('empresa', campoEmpresa.value));

document.querySelectorAll('.dificuldade').forEach((botao) => {
  botao.addEventListener('click', () => {
    atualizarCampoSlot('dificuldade', botao.dataset.dificuldade);
    document.querySelectorAll('.dificuldade').forEach((d) => d.classList.toggle('dificuldade-ativa', d === botao));
  });
});

function mostrarStatus(mensagem, sucesso) {
  statusNovoJogo.textContent = mensagem;
  statusNovoJogo.classList.add('visivel');
  statusNovoJogo.classList.toggle('painel-status--sucesso', !!sucesso);
}

document.getElementById('btn-comecar').addEventListener('click', () => {
  const nomeSave = campoNomeSave.value.trim();
  const jogador = campoJogador.value.trim();
  const empresa = campoEmpresa.value.trim();
  const dificuldade = document.querySelector('.dificuldade-ativa')?.dataset.dificuldade || 'Iniciante';

  if (!nomeSave || !jogador || !empresa) {
    mostrarStatus('Preencha todos os campos antes de começar.', false);
    const conteudo = document.querySelector('#painel-novo-jogo .painel-conteudo');
    conteudo.classList.remove('tremer');
    void conteudo.offsetWidth;
    conteudo.classList.add('tremer');
    return;
  }

  // só continua o progresso salvo se os dados batem com o que já estava
  // naquele slot — mudar nome/empresa/dificuldade conta como recomeçar
  const salvoAnterior = savesConta[slotAtual];
  const mesmaConfiguracao = snapshotSlotAtual
    && snapshotSlotAtual.nomeSave === nomeSave
    && snapshotSlotAtual.jogador === jogador
    && snapshotSlotAtual.empresa === empresa
    && snapshotSlotAtual.dificuldade === dificuldade;
  const continuando = mesmaConfiguracao && salvoAnterior && !!salvoAnterior.progresso;

  savesConta[slotAtual] = {
    slot: slotAtual, nomeSave, jogador, empresa, dificuldade,
    criadoEm: salvoAnterior?.criadoEm || Date.now(),
    atualizadoEm: Date.now(),
    progresso: continuando ? salvoAnterior.progresso : null,
  };
  salvarSavesConta();

  mostrarStatus(continuando ? 'Continuando de onde você parou...' : 'Save criado! Preparando a Fase 1...', true);
  localStorage.setItem('parasitas-save-ativo', JSON.stringify({
    usuario: sessaoAtual(), slot: slotAtual, nomeSave, jogador, empresa, dificuldade,
  }));
  setTimeout(() => {
    window.location.href = 'fase1.html';
  }, 900);
});

// ---- botão "Continuar": pega o save mais recente da conta logada ----
document.getElementById('btn-continuar').addEventListener('click', () => {
  const conta = sessaoAtual();
  const saves = carregarSavesConta();
  const existentes = [1, 2, 3].map((n) => saves[n]).filter(Boolean);
  if (existentes.length === 0) {
    // sem nenhum save ainda: manda pro Novo Jogo em vez de não fazer nada
    document.getElementById('btn-novo-jogo').click();
    setTimeout(() => mostrarStatus('Nenhum save ainda — crie um pra começar.', false), 260);
    return;
  }
  const maisRecente = existentes.sort((a, b) => (b.atualizadoEm || 0) - (a.atualizadoEm || 0))[0];
  localStorage.setItem('parasitas-save-ativo', JSON.stringify({
    usuario: conta, slot: maisRecente.slot, nomeSave: maisRecente.nomeSave,
    jogador: maisRecente.jogador, empresa: maisRecente.empresa, dificuldade: maisRecente.dificuldade,
  }));
  window.location.href = 'fase1.html';
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // exceto o gate de login: não dá pra escapar dele sem entrar
    document.querySelectorAll('.painel.aberto:not(#painel-login)').forEach((p) => fecharPainel(p.id));
  }
});
