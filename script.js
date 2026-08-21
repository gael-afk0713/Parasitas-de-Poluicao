// ============ FIREBASE: AUTENTICAÇÃO + SAVES NA NUVEM ============
// Conta de verdade (Firebase Authentication, e-mail/senha) e saves
// persistidos no Firestore — substitui o sistema anterior, que era só um
// separador local por navegador (localStorage, sem verificação real).
// Precisa de firebase-config.js preenchido com as chaves do SEU projeto
// Firebase (ver CONTEXTO-PROJETO.md, seção "Como configurar o Firebase").
import { auth, db } from './firebase-init.js';
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  doc, getDoc, setDoc, updateDoc, deleteField,
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const painelLogin = document.getElementById('painel-login');
const campoLoginEmail = document.getElementById('campo-login-email');
const campoLoginSenha = document.getElementById('campo-login-senha');
const statusLogin = document.getElementById('status-login');
const footerConta = document.getElementById('footer-conta');
const footerContaSep = document.getElementById('footer-conta-sep');

let usuarioAtual = null; // objeto User do Firebase Auth, ou null se deslogado

function tremerPainelLogin() {
  const conteudo = painelLogin.querySelector('.painel-conteudo');
  conteudo.classList.remove('tremer');
  void conteudo.offsetWidth;
  conteudo.classList.add('tremer');
}
function mostrarStatusLogin(mensagem, sucesso) {
  statusLogin.textContent = mensagem;
  statusLogin.classList.add('visivel');
  statusLogin.classList.toggle('painel-status--sucesso', !!sucesso);
}
function abrirGateLogin() {
  painelLogin.classList.add('aberto');
  painelLogin.setAttribute('aria-hidden', 'false');
  campoLoginEmail.focus();
}
function fecharGateLogin() {
  painelLogin.classList.remove('aberto');
  painelLogin.setAttribute('aria-hidden', 'true');
}

function atualizarIndicadorConta() {
  if (!usuarioAtual) {
    footerConta.hidden = true;
    footerContaSep.hidden = true;
    return;
  }
  footerConta.hidden = false;
  footerContaSep.hidden = false;
  footerConta.textContent = '';
  const nomeEl = document.createElement('span');
  nomeEl.className = 'footer-conta-usuario';
  nomeEl.textContent = usuarioAtual.email;
  const botaoSair = document.createElement('button');
  botaoSair.className = 'footer-conta-sair';
  botaoSair.textContent = 'Sair';
  botaoSair.addEventListener('click', () => signOut(auth));
  footerConta.append(nomeEl, ' · ', botaoSair);
}

// tradução das mensagens de erro mais comuns do Firebase Auth — lista
// completa de códigos em https://firebase.google.com/docs/auth/admin/errors
const ERROS_AUTH = {
  'auth/invalid-email': 'E-mail inválido.',
  'auth/missing-password': 'Preencha a senha.',
  'auth/weak-password': 'Senha fraca — use pelo menos 6 caracteres.',
  'auth/email-already-in-use': 'Já existe uma conta com esse e-mail. Tenta Entrar em vez de Criar Conta.',
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/wrong-password': 'E-mail ou senha incorretos.',
  'auth/user-not-found': 'Não existe conta com esse e-mail. Tenta Criar Conta.',
  'auth/too-many-requests': 'Muitas tentativas seguidas — espera um pouco e tenta de novo.',
  'auth/network-request-failed': 'Falha de rede — confere sua internet e tenta de novo.',
  'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'Firebase ainda não configurado (firebase-config.js com placeholders).',
};
function mensagemErroAuth(erro) {
  return ERROS_AUTH[erro?.code] || 'Não deu pra completar. Tenta de novo.';
}

// documento Firestore da conta logada — cria com os 3 slots vazios se
// ainda não existir (ex: acabou de criar a conta agora)
async function garantirDocumentoConta(uid) {
  const ref = doc(db, 'usuarios', uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { criadoEm: Date.now(), saves: { 1: null, 2: null, 3: null } });
  }
}

document.getElementById('btn-entrar').addEventListener('click', async () => {
  const email = campoLoginEmail.value.trim();
  const senha = campoLoginSenha.value;
  if (!email || !senha) {
    mostrarStatusLogin('Preencha e-mail e senha.');
    tremerPainelLogin();
    return;
  }
  mostrarStatusLogin('Entrando...');
  try {
    await signInWithEmailAndPassword(auth, email, senha);
  } catch (erro) {
    mostrarStatusLogin(mensagemErroAuth(erro));
    tremerPainelLogin();
    campoLoginSenha.value = '';
    campoLoginSenha.focus();
  }
});

document.getElementById('btn-criar-conta').addEventListener('click', async () => {
  const email = campoLoginEmail.value.trim();
  const senha = campoLoginSenha.value;
  if (!email || !senha) {
    mostrarStatusLogin('Preencha e-mail e senha.');
    tremerPainelLogin();
    return;
  }
  mostrarStatusLogin('Criando conta...');
  try {
    const credencial = await createUserWithEmailAndPassword(auth, email, senha);
    await garantirDocumentoConta(credencial.user.uid);
  } catch (erro) {
    mostrarStatusLogin(mensagemErroAuth(erro));
    tremerPainelLogin();
  }
});

document.getElementById('btn-esqueci-senha').addEventListener('click', async () => {
  const email = campoLoginEmail.value.trim();
  if (!email) {
    mostrarStatusLogin('Digita seu e-mail ali em cima primeiro.');
    tremerPainelLogin();
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    mostrarStatusLogin('Link de redefinição enviado pro seu e-mail.', true);
  } catch (erro) {
    mostrarStatusLogin(mensagemErroAuth(erro));
    tremerPainelLogin();
  }
});

campoLoginSenha.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-entrar').click();
});

// onAuthStateChanged é a fonte da verdade de "tá logado ou não" — dispara
// na carga da página (assim que o SDK restaura a sessão, se houver) e de
// novo a cada login/logout/criação de conta. O painel de login já nasce
// "aberto" no HTML (cobrindo a tela) pra nunca deixar o menu clicável
// antes desse primeiro disparo confirmar o estado real.
onAuthStateChanged(auth, (user) => {
  usuarioAtual = user;
  atualizarIndicadorConta();
  if (user) {
    campoLoginSenha.value = '';
    statusLogin.classList.remove('visivel');
    fecharGateLogin();
  } else {
    abrirGateLogin();
  }
});

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
  if (!botao.dataset.fechar) return; // "Criar Conta" reaproveita a classe mas não fecha nada
  botao.addEventListener('click', () => fecharPainel(botao.dataset.fechar));
});

// ============ PAINEL NOVO JOGO — saves na nuvem (Firestore) ============
// os 3 slots vivem em usuarios/{uid}.saves.{1,2,3} no Firestore — cada
// slot é gravado/lido individualmente (não o documento inteiro), tanto
// pra ser mais barato de cota gratuita quanto pra nunca sobrescrever os
// outros dois slots sem querer
function dadosVaziosSlot() {
  return { nomeSave: '', jogador: '', empresa: '', dificuldade: 'Iniciante' };
}
function docContaAtual() {
  return usuarioAtual ? doc(db, 'usuarios', usuarioAtual.uid) : null;
}
async function carregarSavesConta() {
  const ref = docContaAtual();
  if (!ref) return { 1: null, 2: null, 3: null };
  try {
    const snap = await getDoc(ref);
    const dados = snap.data()?.saves || {};
    return { 1: dados[1] || null, 2: dados[2] || null, 3: dados[3] || null };
  } catch {
    return { 1: null, 2: null, 3: null };
  }
}
async function salvarSlotConta(slot, dadosSlot) {
  const ref = docContaAtual();
  if (!ref) return;
  await updateDoc(ref, { [`saves.${slot}`]: dadosSlot });
}
async function apagarSlotConta(slot) {
  const ref = docContaAtual();
  if (!ref) return;
  await updateDoc(ref, { [`saves.${slot}`]: deleteField() });
}
function formatarDinheiroSimples(valor) {
  return 'R$ ' + Math.round(valor || 0).toLocaleString('pt-BR');
}

let savesConta = { 1: null, 2: null, 3: null };
let slotAtual = 1;
let snapshotSlotAtual = null; // config do save no momento em que o slot foi escolhido
let carregandoSaves = false;

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
    if (carregandoSaves) { sub.textContent = 'carregando...'; return; }
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

// recarrega os saves da conta atual (da nuvem) e volta pro slot 1 toda
// vez que o painel Novo Jogo abre — evita mostrar dado de outra sessão
// antiga e sempre reflete o estado mais recente (útil se o jogador jogou
// em outro dispositivo)
document.getElementById('btn-novo-jogo').addEventListener('click', async () => {
  slotAtual = 1;
  document.querySelectorAll('.slot').forEach((s) => s.classList.toggle('slot-ativo', Number(s.dataset.slot) === 1));
  carregandoSaves = true;
  atualizarRotulosSlots();
  savesConta = await carregarSavesConta();
  carregandoSaves = false;
  renderSlotAtual();
});

document.querySelectorAll('.slot').forEach((botao) => {
  botao.addEventListener('click', () => {
    slotAtual = Number(botao.dataset.slot);
    document.querySelectorAll('.slot').forEach((s) => s.classList.toggle('slot-ativo', s === botao));
    renderSlotAtual();
  });
});

// os campos NÃO gravam na nuvem a cada tecla digitada (diferente da
// versão local antiga) — isso gastaria a cota gratuita de escrita do
// Firestore muito rápido. Só atualizam o estado em memória; a gravação de
// verdade acontece quando o campo perde o foco (blur) e sempre ao clicar
// Começar, que é a garantia final de que nada fica sem salvar
function valorAtualDoSlot() {
  if (!savesConta[slotAtual]) {
    savesConta[slotAtual] = { slot: slotAtual, ...dadosVaziosSlot(), progresso: null, criadoEm: Date.now() };
  }
  return savesConta[slotAtual];
}
function atualizarCampoSlotEmMemoria(campo, valor) {
  valorAtualDoSlot()[campo] = valor;
  atualizarRotulosSlots();
}
async function persistirSlotAtual() {
  const dadosSlot = savesConta[slotAtual];
  if (!dadosSlot) return;
  dadosSlot.atualizadoEm = Date.now();
  try {
    await salvarSlotConta(slotAtual, dadosSlot);
  } catch {
    mostrarStatus('Não deu pra salvar na nuvem agora — confere sua internet.', false);
  }
}

campoNomeSave.addEventListener('input', () => atualizarCampoSlotEmMemoria('nomeSave', campoNomeSave.value));
campoJogador.addEventListener('input', () => atualizarCampoSlotEmMemoria('jogador', campoJogador.value));
campoEmpresa.addEventListener('input', () => atualizarCampoSlotEmMemoria('empresa', campoEmpresa.value));
[campoNomeSave, campoJogador, campoEmpresa].forEach((campo) => campo.addEventListener('blur', persistirSlotAtual));

document.querySelectorAll('.dificuldade').forEach((botao) => {
  botao.addEventListener('click', () => {
    atualizarCampoSlotEmMemoria('dificuldade', botao.dataset.dificuldade);
    document.querySelectorAll('.dificuldade').forEach((d) => d.classList.toggle('dificuldade-ativa', d === botao));
    persistirSlotAtual();
  });
});

function mostrarStatus(mensagem, sucesso) {
  statusNovoJogo.textContent = mensagem;
  statusNovoJogo.classList.add('visivel');
  statusNovoJogo.classList.toggle('painel-status--sucesso', !!sucesso);
}

document.getElementById('btn-comecar').addEventListener('click', async () => {
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

  mostrarStatus('Salvando na nuvem...', true);
  try {
    await salvarSlotConta(slotAtual, savesConta[slotAtual]);
  } catch {
    mostrarStatus('Não deu pra salvar na nuvem — confere sua internet e tenta de novo.', false);
    return;
  }

  mostrarStatus(continuando ? 'Continuando de onde você parou...' : 'Save criado! Preparando a Fase 1...', true);
  localStorage.setItem('parasitas-save-ativo', JSON.stringify({
    uid: usuarioAtual.uid, slot: slotAtual, nomeSave, jogador, empresa, dificuldade,
  }));
  setTimeout(() => {
    window.location.href = 'fase1.html';
  }, 900);
});

// ---- apagar save: primeiro clique arma a confirmação (fica vermelho
// por alguns segundos), segundo clique dentro da janela apaga de
// verdade. Sem confirm() nativo, pra combinar com o resto da UI do jogo. ----
let apagarArmadoSlot = null;
let timerApagarArmado = null;
function desarmarApagar(botao, slot) {
  botao.classList.remove('slot-apagar--confirmando');
  botao.setAttribute('aria-label', `Apagar Save ${slot}`);
  apagarArmadoSlot = null;
}
document.querySelectorAll('.slot-apagar').forEach((botao) => {
  botao.addEventListener('click', async (e) => {
    e.stopPropagation(); // não deixa o clique também selecionar o slot por baixo
    const slot = Number(botao.dataset.slot);

    if (apagarArmadoSlot !== slot) {
      apagarArmadoSlot = slot;
      botao.classList.add('slot-apagar--confirmando');
      botao.setAttribute('aria-label', `Confirmar apagar Save ${slot}`);
      clearTimeout(timerApagarArmado);
      timerApagarArmado = setTimeout(() => desarmarApagar(botao, slot), 4000);
      return;
    }

    clearTimeout(timerApagarArmado);
    desarmarApagar(botao, slot);
    try {
      await apagarSlotConta(slot);
    } catch {
      mostrarStatus('Não deu pra apagar agora — confere sua internet.', false);
      return;
    }
    savesConta[slot] = null;
    if (slot === slotAtual) renderSlotAtual();
    else atualizarRotulosSlots();
    mostrarStatus(`Save ${slot} apagado.`, true);
  });
});

// ---- botão "Continuar": pega o save mais recente da conta logada ----
document.getElementById('btn-continuar').addEventListener('click', async () => {
  if (!usuarioAtual) { abrirGateLogin(); return; }
  const saves = await carregarSavesConta();
  const existentes = [1, 2, 3].map((n) => saves[n]).filter(Boolean);
  if (existentes.length === 0) {
    // sem nenhum save ainda: manda pro Novo Jogo em vez de não fazer nada
    document.getElementById('btn-novo-jogo').click();
    setTimeout(() => mostrarStatus('Nenhum save ainda — crie um pra começar.', false), 260);
    return;
  }
  const maisRecente = existentes.sort((a, b) => (b.atualizadoEm || 0) - (a.atualizadoEm || 0))[0];
  localStorage.setItem('parasitas-save-ativo', JSON.stringify({
    uid: usuarioAtual.uid, slot: maisRecente.slot, nomeSave: maisRecente.nomeSave,
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
