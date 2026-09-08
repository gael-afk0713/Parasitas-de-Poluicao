/* =========================================================================
   fase2/main.js — montagem e laço de desenho
   -------------------------------------------------------------------------
   Este arquivo só LIGA as peças. Nenhuma regra de jogo mora aqui: se você
   estiver prestes a escrever um `if` sobre vida, dano ou progressão neste
   arquivo, ele pertence a mundo/mundo.js ou a uma entidade.
   ========================================================================= */

import { Tela, Laco, Camera, Transicao } from './core/laco.js';
import { Entrada } from './core/entrada.js';
import { Renderizador, luzRadial, feixeLuz } from './render/renderizador.js';
import { Mundo } from './mundo/mundo.js';
import { validarRegistro } from './mundo/salas.js';
import { desenharParallax, desenharPrimeiroPlano } from './render/parallax.js';
import { desenharParticulas, desenharNevoa } from './render/particulas.js';
import { criarEntidade } from './entidades/catalogo.js';
import { Hud } from './ui/hud.js';
import { TelaMapa } from './ui/mapa.js';
import { Audio } from './audio/audio.js';
import { Save } from './sistemas/save.js';
import { Efeitos } from './render/efeitos.js';
import { Paineis } from './ui/paineis.js';

// Registram-se sozinhas ao serem importadas (ver `registrarSala`).
// A ORDEM é a ordem narrativa, e importa: `validarRegistro` reclama de
// ligação para sala ainda não registrada, então uma área não pode citar outra
// que venha depois — hoje todas as ligações apontam para frente, então a
// ordem narrativa e a ordem de carga coincidem.
import './mundo/salas-raizes.js';
import './mundo/salas-varzea.js';
import './mundo/salas-clareira.js';
import './mundo/salas-dossel.js';
import './mundo/salas-coracao.js';
import './mundo/salas-ramos.js';   // ramos, atalhos e trancas por habilidade

/* ---------------------------------------------------------------- montagem -- */

const canvas = document.getElementById('tela-fase2');
const tela = new Tela(canvas);
const camera = new Camera(tela.largura, tela.altura);
const entrada = new Entrada(window);
const render = new Renderizador(tela);
const transicao = new Transicao();
const audio = new Audio();

const laco = new Laco(passo, quadro);
const mundo = new Mundo(camera, laco, render);
const hud = new Hud(document.getElementById('hud-fase2'), mundo);
const mapa = new TelaMapa(mundo);
const efeitos = new Efeitos();
let paineis = null;   // criado depois do `save`, de quem depende

mundo.fabricaEntidade = criarEntidade;
mundo._transicao = (cb) => transicao.cortar(cb, 0.3);
mundo.aoEvento = (ev) => { efeitoDeEvento(ev); audio.aoEvento(ev, mundo); };
mundo.aoTrocarSala = (sala) => {
  efeitos.limpar();   // efeito de outra sala aparecendo na nova é o bug mais
                      // óbvio possível, e o mais fácil de esquecer
  hud.anunciarSala(sala, mundo);
  audio.trocarAmbiente(sala, mundo);
};

tela.aoRedimensionar = (w, h) => camera.redimensionar(w, h);
entrada.ligar();
entrada.ligarToque(document.getElementById('toque-fase2'));

const problemas = validarRegistro();
if (problemas.length) console.warn('[fase2] Problemas no mapa:\n' + problemas.join('\n'));

mundo.entrarNaSala('raizes-01');
laco.iniciar();

/* ----------------------------------------------------------------- save -- */
// A restauração é assíncrona (o Firebase confirma a sessão pela rede), então o
// jogo já começa jogável na sala inicial e o save TROCA a sala se houver
// progresso. É o mesmo padrão da Fase 1 — nunca deixar a tela esperando a rede.
const save = new Save(mundo);
paineis = new Paineis(mundo, laco, { aoSalvar: (motivo) => save.salvar(motivo) });
save.iniciar()
  .then((restaurou) => {
    save.ligarGatilhos();
    if (restaurou) hud.anunciar('Continuando', save.estado, 2.8);
  })
  .catch(() => { /* `iniciar` já degrada sozinho; nada a fazer aqui */ });

/* -------------------------------------------------------------- abertura -- */
// O laço já roda por trás da tela de abertura (a cena aparece viva assim que
// o overlay some, sem um frame preto). Só a ENTRADA fica bloqueada até lá.
const abertura = document.getElementById('abertura-fase2');
laco.pausado = true;

document.getElementById('btn-comecar-fase2')?.addEventListener('click', () => {
  abertura.classList.add('escondida');
  laco.pausado = false;
  entrada.limparTudo();   // o clique/tecla que abriu não deve virar uma ação
  canvas.focus?.();
});

/* Cursor some enquanto se joga no teclado e volta ao mexer o mouse. */
let timerCursor = null;
window.addEventListener('pointermove', () => {
  document.body.classList.remove('cursor-oculto');
  clearTimeout(timerCursor);
  timerCursor = setTimeout(() => document.body.classList.add('cursor-oculto'), 1800);
});

/* Respeita a preferência do sistema: sem shake, sem aberração, sem flash forte. */
const movimentoReduzido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (movimentoReduzido) {
  camera.sacudir = () => {};
  render.sacudirCor = () => {};
  render.piscar = (cor, v) => { render.flash.cor = cor; render.flash.valor = Math.min(v, 0.12); };
}

/* -------------------------------------------------------------------- passo -- */

function passo(dt) {
  entrada.atualizar(dt);

  // Mapa: Tab alterna. Enquanto aberto o mundo congela — em jogo de
  // atmosfera, consultar o mapa é uma pausa narrativa, não um risco.
  if (entrada.acabouDePressionar('mapa')) mapa.alternar();
  if (entrada.acabouDePressionar('pausa')) {
    if (mapa.aberta) mapa.fechar();
    else paineis?.alternarPausa();
  }
  if (laco.pausado || mapa.aberta || paineis?.bloqueiaJogo) return;

  mundo.atualizar(dt, entrada);
}

/* ------------------------------------------------------------------ quadro -- */

function quadro(alpha, dtReal) {
  transicao.atualizar(dtReal);
  mundo.atualizarApresentacao(dtReal);
  audio.atualizar(dtReal, mundo);

  const tema = mundo.tema;
  const sala = mundo.sala;
  if (!sala) return;

  render.iniciarFrame(tema, camera);

  // 1 · céu
  render.desenharCeu(sala.altura);

  // 2-5 · parallax + luz volumétrica
  desenharParallax(render, sala, mundo);

  // 6 · decoração de fundo colada ao terreno
  render.camada(1, (ctx) => {
    for (const e of mundo.entidades) e.desenharFundo?.(ctx, tema, camera);
  });

  // 7 · terreno (inclui plataformas e perigos)
  render.camada(1, (ctx) => mundo.arteTerreno.desenhar(ctx, tema, camera));
  render.emissivo(1, (ctx) => {
    mundo.arteTerreno.desenharLuz(ctx, tema);
    mundo.arteTerreno.desenharLuzEspeciais(ctx, tema, camera, laco.tempo);
  });

  // 8 · entidades + jogador
  render.camada(1, (ctx) => {
    for (const e of mundo.entidades) e.desenhar?.(ctx, tema, camera);
    mundo.arteJogador.desenhar(ctx, mundo.jogador, tema);
  });
  render.emissivo(1, (ctx) => {
    for (const e of mundo.entidades) e.desenharLuz?.(ctx, tema, camera);
    mundo.arteJogador.desenharLuz(ctx, mundo.jogador, tema);
    for (const l of sala.luzes) {
      if (l.feixe) feixeLuz(ctx, l.x, l.y, sala.altura, 130, l.angulo ?? 0, tema.luz, l.intensidade ?? 1);
      else luzRadial(ctx, l.x, l.y, l.raio, tema.luz, l.intensidade ?? 1);
    }
  });

  // 8b · efeitos de impacto, na frente das entidades
  render.camada(1, (ctx) => efeitos.desenhar(ctx, tema, camera));
  render.emissivo(1, (ctx) => efeitos.desenharLuz(ctx, tema, camera));

  // 9 · água — DEPOIS das entidades, de propósito: quem entra nela precisa
  //     aparecer submerso, e isso só acontece com a lâmina por cima.
  render.camada(1, (ctx) => mundo.arteTerreno.desenharAgua(ctx, tema, camera, laco.tempo));

  // 10 · névoa rasteira + partículas
  desenharNevoa(render, mundo);
  desenharParticulas(render, mundo);

  // 11 · primeiro plano
  render.camada(1.28, (ctx) => {
    for (const e of mundo.entidades) e.desenharFrente?.(ctx, tema, camera);
  });
  desenharPrimeiroPlano(render, mundo);

  // 12 · composição
  render.finalizar(dtReal);

  // Efeitos colados na tela (vinheta de dano), antes da transição.
  render.camadaTela((ctx, t, w, h) => efeitos.desenharTela(ctx, t, w, h));

  transicao.desenhar(tela.ctx, tela.largura, tela.altura);
  efeitos.atualizar(dtReal);
  mapa.atualizar(dtReal);
  hud.desenhar(dtReal, tema);
  if (mapa.visivel) {
    const ctxHud = hud.ctx;
    if (ctxHud) mapa.desenhar(ctxHud, hud.larguraCss, hud.alturaCss, tema);
  }
}

/* ------------------------------------------------------------------ efeitos -- */

function efeitoDeEvento(ev) {
  const j = mundo.jogador;
  const tema = mundo.tema;
  switch (ev.tipo) {
    case 'pulo':
      mundo.emitir(j.pesX, j.pesY, ev.variante === 'duplo' ? 12 : 5, {
        angulo: Math.PI / 2, espalhamento: 1.6, velMin: 30, velMax: 110, g: 160,
        cor: ev.variante === 'duplo' ? tema.acento : tema.particula,
        brilha: ev.variante === 'duplo',
      });
      break;
    case 'habilidade':
      hud.anunciarHabilidade(ev.habilidade);
      render.piscar(tema.crista, 0.55);
      laco.definirEscalaTempo(0.3, 0.15);
      setTimeout(() => laco.definirEscalaTempo(1, 0.8), 800);
      break;
    case 'aterrissar': {
      efeitos.aterrissagem(ev.x, ev.y, ev.impacto);
      // Em área restaurada o impacto levanta FOLHAS além da poeira — o mesmo
      // gesto conta coisas diferentes conforme o mundo revive.
      if ((tema.pureza ?? 0) > 0.35 && ev.impacto > 0.2) {
        efeitos.folhas(ev.x, ev.y, { n: Math.round(3 + ev.impacto * 7) });
      }
      if (ev.impacto > 0.45) { camera.sacudir(ev.impacto * 0.3); camera.recuar(0, ev.impacto * 7); }
      break;
    }
    case 'investida':
      mundo.emitir(j.centroX, j.centroY, 12, {
        angulo: ev.direcao > 0 ? Math.PI : 0, espalhamento: 0.8,
        velMin: 80, velMax: 260, g: 20, cor: tema.acento, brilha: true,
      });
      camera.recuar(-ev.direcao * 9, 0);
      break;
    case 'acerto':
      efeitos.impacto(j.centroX + ev.direcao * 34, j.centroY - 4, ev.direcao);
      break;
    case 'dano':
      render.piscar('#ff5a4a', 0.42);
      render.sacudirCor(0.9);
      camera.sacudir(0.6);
      laco.congelar(0.09);
      efeitos.vinhetaDano();
      efeitos.faiscas(j.centroX, j.centroY, { n: 16, cor: 'rust', forca: 1.2 });
      break;
    case 'morte':
      paineis?.mostrarMorte();
      efeitos.dissolucao(j.centroX, j.centroY);
      efeitos.vinhetaDano({ forca: 1.4, dur: 1.6 });
      render.piscar('#ffffff', 0.7);
      laco.congelar(0.16);
      camera.sacudir(1);
      break;
    case 'inimigoMorto':
      efeitos.dissolucao(ev.x, ev.y, { escala: 0.6 });
      break;
    case 'barreiraQuebrada':
      efeitos.anelChoque(ev.x, ev.y, { raio: 46, cor: 'crista' });
      break;
    case 'canto':
      efeitos.ondaCanto(j.centroX, j.centroY, { raio: ev.raio ?? 190 });
      render.piscar(tema.crista, 0.22);
      break;
    case 'fragmento':
      hud.anunciar(
        ev.subiuVida ? 'Vitalidade' : 'Fragmento',
        ev.subiuVida ? 'a vida máxima cresceu' : `faltam ${ev.faltam} para o próximo`,
        2.6
      );
      render.piscar(tema.crista, 0.3);
      break;
    case 'chefeFase':
      render.sacudirCor(0.8);
      break;
    case 'chefeMorto':
      hud.anunciar(ev.nome, 'silenciado', 4);
      laco.definirEscalaTempo(0.25, 0.2);
      setTimeout(() => laco.definirEscalaTempo(1, 1.4), 1600);
      // O Coração é o último: derrubá-lo encerra o jogo. Com folga pra a
      // animação de morte dele terminar antes da tela aparecer.
      if (ev.nome === 'O Coração') setTimeout(() => paineis?.mostrarFim(), 3200);
      break;
    case 'portaoTrancado':
      hud.anunciar('Trancado', 'algo que você ainda não sabe fazer', 2.2);
      break;
    case 'lore':
      if (ev.texto) hud.anunciar('', ev.texto, 4.5);
      break;
    case 'semente':
      render.piscar(tema.acento, 0.5);
      camera.sacudir(0.3);
      laco.definirEscalaTempo(0.35, 0.2);
      setTimeout(() => laco.definirEscalaTempo(1, 0.7), 900);
      break;
  }
}

/* ------------------------------------------------------------------ debug --- */

if (new URLSearchParams(location.search).has('debug')) {
  window.__fase2 = { mundo, camera, laco, render, entrada, tela, audio, hud, mapa, save, efeitos, paineis, passo, quadro };
  console.info('[fase2] modo debug: window.__fase2 disponível');
}
