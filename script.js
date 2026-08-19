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
const saves = {
  1: { nomeSave: '', jogador: '', empresa: '', dificuldade: 'Iniciante' },
  2: { nomeSave: '', jogador: '', empresa: '', dificuldade: 'Iniciante' },
  3: { nomeSave: '', jogador: '', empresa: '', dificuldade: 'Iniciante' },
};
let slotAtual = 1;

const campoNomeSave = document.getElementById('campo-nome-save');
const campoJogador = document.getElementById('campo-nome-jogador');
const campoEmpresa = document.getElementById('campo-nome-empresa');
const statusNovoJogo = document.getElementById('status-novo-jogo');

function renderSlotAtual() {
  const dados = saves[slotAtual];
  campoNomeSave.value = dados.nomeSave;
  campoJogador.value = dados.jogador;
  campoEmpresa.value = dados.empresa;

  document.querySelectorAll('.dificuldade').forEach((botao) => {
    botao.classList.toggle('dificuldade-ativa', botao.dataset.dificuldade === dados.dificuldade);
  });

  statusNovoJogo.textContent = '';
  statusNovoJogo.classList.remove('visivel', 'painel-status--sucesso');
}

document.querySelectorAll('.slot').forEach((botao) => {
  botao.addEventListener('click', () => {
    slotAtual = Number(botao.dataset.slot);
    document.querySelectorAll('.slot').forEach((s) => s.classList.toggle('slot-ativo', s === botao));
    renderSlotAtual();
  });
});

campoNomeSave.addEventListener('input', () => { saves[slotAtual].nomeSave = campoNomeSave.value; });
campoJogador.addEventListener('input', () => { saves[slotAtual].jogador = campoJogador.value; });
campoEmpresa.addEventListener('input', () => { saves[slotAtual].empresa = campoEmpresa.value; });

document.querySelectorAll('.dificuldade').forEach((botao) => {
  botao.addEventListener('click', () => {
    saves[slotAtual].dificuldade = botao.dataset.dificuldade;
    document.querySelectorAll('.dificuldade').forEach((d) => d.classList.toggle('dificuldade-ativa', d === botao));
  });
});

function mostrarStatus(mensagem, sucesso) {
  statusNovoJogo.textContent = mensagem;
  statusNovoJogo.classList.add('visivel');
  statusNovoJogo.classList.toggle('painel-status--sucesso', !!sucesso);
}

document.getElementById('btn-comecar').addEventListener('click', () => {
  const dados = saves[slotAtual];
  if (!dados.nomeSave.trim() || !dados.jogador.trim() || !dados.empresa.trim()) {
    mostrarStatus('Preencha todos os campos antes de começar.', false);
    const conteudo = document.querySelector('#painel-novo-jogo .painel-conteudo');
    conteudo.classList.remove('tremer');
    void conteudo.offsetWidth;
    conteudo.classList.add('tremer');
    return;
  }
  mostrarStatus('Save criado! Preparando a Fase 1...', true);
  localStorage.setItem('parasitas-save-ativo', JSON.stringify({
    slot: slotAtual,
    nomeSave: dados.nomeSave.trim(),
    jogador: dados.jogador.trim(),
    empresa: dados.empresa.trim(),
    dificuldade: dados.dificuldade,
  }));
  setTimeout(() => {
    window.location.href = 'fase1.html';
  }, 900);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.painel.aberto').forEach((p) => fecharPainel(p.id));
  }
});
