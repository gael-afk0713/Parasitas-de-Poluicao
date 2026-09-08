/* =========================================================================
   fase2/ui/paineis.js — pausa, morte e fim de jogo
   -------------------------------------------------------------------------
   Estes são DOM, não canvas — ao contrário do HUD e do mapa. A razão é
   concreta: eles têm BOTÕES, e botão precisa de foco, navegação por teclado,
   leitor de tela e alvo de toque de tamanho decente. Reimplementar isso em
   canvas é trabalho grande para chegar num resultado pior.

   E reaproveitam as classes `.painel` / `.painel-conteudo` / `.painel-voltar`
   de `style.css`, como o resto do projeto — o menu, a Fase 1 e as telas de
   fim já usam esse padrão, então a Fase 2 herda o visual sem CSS novo.

   Sobre a tela de morte: ela NÃO oferece "tentar de novo" como botão. Morrer
   já devolve o jogador ao último ponto de salvamento sozinho, e um botão ali
   transformaria a morte num diálogo modal — exatamente o oposto do ritmo que
   o gênero quer. A tela aparece, diz o que aconteceu, e sai.
   ========================================================================= */

import { nomeArea } from '../render/paleta.js';

const TEXTOS_MORTE = [
  'A floresta te recolhe.',
  'A luz se apaga, e volta.',
  'Nem tudo que cai está perdido.',
  'A raiz lembra o caminho.',
];

export class Paineis {
  /**
   * @param {import('../mundo/mundo.js').Mundo} mundo
   * @param {import('../core/laco.js').Laco} laco
   */
  constructor(mundo, laco, { aoSalvar } = {}) {
    this.mundo = mundo;
    this.laco = laco;
    this.aoSalvar = aoSalvar;
    this.aberto = null;   // null | 'pausa' | 'morte' | 'fim'

    this.el = {
      pausa: document.getElementById('painel-pausa'),
      morte: document.getElementById('painel-morte'),
      fim: document.getElementById('painel-fim'),
    };
    this._ligarBotoes();
  }

  _ligarBotoes() {
    const q = (id) => document.getElementById(id);

    q('btn-pausa-continuar')?.addEventListener('click', () => this.fechar());
    q('btn-pausa-salvar')?.addEventListener('click', async () => {
      const status = q('status-pausa');
      if (status) status.textContent = 'salvando...';
      const ok = await this.aoSalvar?.('manual');
      if (status) status.textContent = ok ? 'salvo' : 'nada novo para salvar';
    });
    q('btn-pausa-menu')?.addEventListener('click', async () => {
      await this.aoSalvar?.('menu');
      window.location.href = 'index.html';
    });
  }

  /* --------------------------------------------------------------------- */

  abrir(qual) {
    if (this.aberto === qual) return;
    this.fechar();
    const el = this.el[qual];
    if (!el) return;
    this.aberto = qual;
    el.classList.add('aberto');
    el.setAttribute('aria-hidden', 'false');

    if (qual === 'pausa') {
      this._preencherPausa();
      // Foco no primeiro botão: sem isso, quem joga no teclado precisa pegar
      // o mouse para interagir com o painel que ele abriu pelo teclado.
      requestAnimationFrame(() => document.getElementById('btn-pausa-continuar')?.focus());
    }
    if (qual === 'morte') this._preencherMorte();
  }

  fechar() {
    if (!this.aberto) return;
    const el = this.el[this.aberto];
    el?.classList.remove('aberto');
    el?.setAttribute('aria-hidden', 'true');
    this.aberto = null;
  }

  alternarPausa() {
    if (this.aberto === 'pausa') { this.fechar(); this.laco.pausado = false; }
    else if (!this.aberto) { this.abrir('pausa'); this.laco.pausado = true; }
  }

  _preencherPausa() {
    const m = this.mundo;
    const def = (id, valor) => { const e = document.getElementById(id); if (e) e.textContent = valor; };
    /* Só salas-marco têm `titulo`; nas outras isto caía no ID cru e o painel
       mostrava "VARZEA-02" em caixa alta no lugar do nome do lugar. O nome da
       ÁREA sempre existe e é o que o jogador reconhece. */
    def('pausa-area', m.sala
      ? (m.sala.def.titulo || nomeArea(m.sala.area, m.purezaDaArea(m.sala.area)))
      : '—');
    def('pausa-restaurado', `${Math.round(m.purezaGlobal * 100)}%`);
    def('pausa-fragmentos', String(m.fragmentosColetados.size));
    def('pausa-habilidades', m.jogador.habilidades.size
      ? [...m.jogador.habilidades].length + ' de 5'
      : 'nenhuma');
    const status = document.getElementById('status-pausa');
    if (status) status.textContent = '';
  }

  _preencherMorte() {
    const e = document.getElementById('morte-frase');
    if (e) e.textContent = TEXTOS_MORTE[Math.floor(Math.random() * TEXTOS_MORTE.length)];
  }

  /**
   * A tela de morte se mostra e some sozinha. `mundo` já cuida do respawn.
   */
  mostrarMorte() {
    this.abrir('morte');
    clearTimeout(this._timerMorte);
    this._timerMorte = setTimeout(() => {
      if (this.aberto === 'morte') this.fechar();
    }, 2200);
  }

  /** Fim de jogo: chamado quando o Coração cai. */
  mostrarFim() {
    const m = this.mundo;
    const def = (id, valor) => { const e = document.getElementById(id); if (e) e.textContent = valor; };
    def('fim-restaurado', `${Math.round(m.purezaGlobal * 100)}%`);
    def('fim-fragmentos', String(m.fragmentosColetados.size));
    def('fim-salas', String(m.pureza.size));
    this.abrir('fim');
    this.laco.pausado = true;
  }

  get bloqueiaJogo() { return this.aberto === 'pausa' || this.aberto === 'fim'; }
}
