/* =========================================================================
   fase2/sistemas/save.js — progresso da Fase 2 no Firestore
   -------------------------------------------------------------------------
   Segue exatamente o padrão já estabelecido na Fase 1 (ver `fase1.js` e a
   seção de Firestore no CONTEXTO-PROJETO.md), com uma diferença: grava num
   campo PRÓPRIO, `progressoFase2`, dentro do mesmo documento de slot.

       usuarios/{uid}.saves.{slot}.progressoFase2

   Campo separado, e não um merge no `progresso` da Fase 1, por dois motivos:
   as duas fases têm formatos de estado completamente diferentes, e uma
   gravação da Fase 2 nunca pode arriscar corromper o save da Fase 1 do mesmo
   slot. `updateDoc` com caminho de campo grava SÓ aquele ramo.

   TRÊS CUIDADOS que a Fase 1 aprendeu na prática e valem aqui:

   1. NÃO GRAVAR A CADA TICK. O Firestore tem cota diária de escrita mesmo no
      plano gratuito. Aqui a gravação acontece em MOMENTOS (checkpoint, troca
      de área, habilidade nova, chefe morto, semente) e nunca em laço.
   2. PULAR ESCRITA IDÊNTICA. `_ultimoSerializado` guarda o último JSON
      gravado; se nada mudou, a escrita é descartada antes de sair da máquina.
   3. DEGRADAR EM SILÊNCIO. Abrir `fase2.html` direto, sem passar pelo menu,
      tem que funcionar — só não salva. Nenhuma exceção pode vazar para o laço
      do jogo por causa de rede ou sessão ausente.
   ========================================================================= */

const CHAVE_SAVE_ATIVO = 'parasitas-save-ativo';

/* ------------------------------------------------------------- cópia local
   O progresso morava SÓ no Firestore, e o Firestore só existe com sessão
   iniciada pelo menu. Quem abre `fase2.html` direto, quem está sem internet,
   quem tem as regras negando ou o CDN bloqueado jogava com `disponivel =
   false`: nada era gravado, e sair e voltar apagava a fase inteira — as salas
   restauradas voltavam sujas, os fragmentos voltavam ao lugar.

   Agora toda gravação também cai no `localStorage`, e ele é lido quando a
   nuvem não responde ou não tem nada. A nuvem continua sendo a fonte da
   verdade quando existe (é ela que atravessa dispositivos); o local é a rede
   de segurança de quem está só num navegador.
   ------------------------------------------------------------------------- */
function chaveLocal(info) {
  return info?.uid && info?.slot
    ? `fase2:progresso:${info.uid}:${info.slot}`
    : 'fase2:progresso:local';
}

function lerLocal(info) {
  try {
    const cru = localStorage.getItem(chaveLocal(info));
    return cru ? JSON.parse(cru) : null;
  } catch { return null; }
}

function gravarLocal(info, progresso) {
  try {
    localStorage.setItem(chaveLocal(info), JSON.stringify(progresso));
    return true;
  } catch { return false; }   // aba anônima, cota cheia: não é motivo pra parar
}

export class Save {
  /** @param {import('../mundo/mundo.js').Mundo} mundo */
  constructor(mundo) {
    this.mundo = mundo;
    this.pronto = false;
    this.disponivel = false;      // há sessão + slot válidos?
    this.ultimoErro = null;
    this._ultimoSerializado = null;
    this._ultimoLocal = null;
    this._gravando = false;
    this._pendente = false;

    this.info = this._lerSaveAtivo();
    this.aoEstado = null;         // (texto) => void, para a UI
  }

  _lerSaveAtivo() {
    try {
      const cru = localStorage.getItem(CHAVE_SAVE_ATIVO);
      return cru ? JSON.parse(cru) : null;
    } catch { return null; }
  }

  /**
   * Conecta ao Firebase e restaura o progresso, se houver.
   * Import DINÂMICO do SDK: assim, quem abre `fase2.html` sem sessão nem
   * carrega o SDK pela rede — o jogo abre e roda igual, só sem salvar.
   * @returns {Promise<boolean>} true se restaurou algum progresso
   */
  async iniciar() {
    if (!this.info?.uid || !this.info?.slot) {
      // Sem sessão ainda dá pra continuar de onde parou NESTE navegador.
      const local = lerLocal(this.info);
      if (local && this.mundo.aplicarSave(local)) {
        this._ultimoSerializado = JSON.stringify(this.mundo.paraSave());
        this._estado('progresso restaurado deste navegador');
        return true;
      }
      this._estado('sem sessão — o progresso fica só neste navegador');
      return false;
    }
    try {
      const [{ auth, db }, authMod, fsMod] = await Promise.all([
        import('../../firebase-init.js'),
        import('https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js'),
        import('https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js'),
      ]);
      this._db = db;
      this._fs = fsMod;

      // `onAuthStateChanged` é a fonte da verdade de "tá logado", igual à
      // Fase 1 — a sessão restaurada chega de forma assíncrona, e checar
      // `auth.currentUser` direto devolve null numa carga fria.
      const usuario = await new Promise((resolve) => {
        const parar = authMod.onAuthStateChanged(auth, (u) => { parar(); resolve(u); });
      });

      // As três coisas têm que bater: veio do menu, há sessão, e a sessão é
      // da MESMA conta dona do save. Sem isso, uma aba antiga em fase2.html
      // poderia gravar no documento de outra conta depois de uma troca.
      if (!usuario || usuario.uid !== this.info.uid) {
        this._estado('sessão não confere — o progresso não será salvo');
        return false;
      }

      this._ref = fsMod.doc(db, 'usuarios', this.info.uid);
      this.disponivel = true;
      this.pronto = true;

      const snap = await fsMod.getDoc(this._ref);
      const dados = snap.exists()
        ? snap.data()?.saves?.[this.info.slot]?.progressoFase2
        : null;

      const daNuvem = dados || lerLocal(this.info);
      if (daNuvem) {
        const ok = this.mundo.aplicarSave(daNuvem);
        this._ultimoSerializado = JSON.stringify(this.mundo.paraSave());
        this._estado(ok
          ? (dados ? 'progresso restaurado' : 'progresso restaurado deste navegador')
          : 'save inválido — recomeçando');
        return ok;
      }
      this._estado('novo jogo');
      return false;
    } catch (e) {
      // Rede caiu, CDN bloqueado, regras negaram — nada disso pode impedir de
      // jogar, nem de continuar de onde parou.
      this.ultimoErro = e;
      console.warn('[fase2/save] indisponível:', e?.message || e);
      const local = lerLocal(this.info);
      if (local && this.mundo.aplicarSave(local)) {
        this._ultimoSerializado = JSON.stringify(this.mundo.paraSave());
        this._estado('sem conexão — progresso deste navegador');
        return true;
      }
      this._estado('sem conexão — o progresso fica só neste navegador');
      return false;
    }
  }

  /**
   * Grava, se houver o que gravar.
   * @param {string} motivo  só para log/telemetria
   */
  async salvar(motivo = 'manual') {
    const progresso = this.mundo.paraSave();
    const serializado = JSON.stringify(progresso);
    if (serializado === this._ultimoSerializado) return false;

    /* A cópia local vai SEMPRE, e antes da nuvem: é síncrona, não pode
       falhar por rede, e é ela que salva o caso mais comum de perda — fechar
       a aba. O `beforeunload` dispara `salvar`, mas a escrita no Firestore é
       assíncrona e o navegador mata a aba antes de ela terminar; o
       `localStorage` já gravou nesse ponto. */
    const local = gravarLocal(this.info, progresso);
    if (local) this._ultimoLocal = serializado;

    if (!this.disponivel || !this._ref) {
      if (local) {
        this._ultimoSerializado = serializado;
        this._estado('salvo neste navegador');
      }
      return local;
    }

    // Uma gravação por vez. Se pedirem outra no meio, marca pendente e
    // repete ao terminar — sem isso, dois `updateDoc` simultâneos podem
    // gravar fora de ordem e o estado mais VELHO vencer.
    if (this._gravando) { this._pendente = true; return false; }
    this._gravando = true;

    try {
      const caminho = `saves.${this.info.slot}.progressoFase2`;
      await this._fs.updateDoc(this._ref, {
        [caminho]: progresso,
        [`saves.${this.info.slot}.atualizadoEm`]: Date.now(),
      });
      this._ultimoSerializado = serializado;
      this._estado('salvo');
      return true;
    } catch (e) {
      this.ultimoErro = e;
      console.warn(`[fase2/save] falha ao salvar (${motivo}):`, e?.message || e);
      this._estado('falha ao salvar');
      return false;
    } finally {
      this._gravando = false;
      if (this._pendente) { this._pendente = false; this.salvar(motivo); }
    }
  }

  /** Só a cópia deste navegador. Síncrona, sem rede, sem cota. */
  salvarLocal() {
    const progresso = this.mundo.paraSave();
    const serializado = JSON.stringify(progresso);
    if (serializado === this._ultimoLocal) return false;
    if (!gravarLocal(this.info, progresso)) return false;
    this._ultimoLocal = serializado;
    return true;
  }

  /**
   * Liga os momentos em que vale gravar. Chamado uma vez pelo `main.js`.
   *
   * A lista é curta de propósito: são os pontos em que o jogador sentiria
   * perder progresso. Salvar em mais lugares que isso gasta cota sem que
   * ninguém perceba a diferença.
   */
  ligarGatilhos() {
    const anterior = this.mundo.aoEvento;
    const MOMENTOS = new Set([
      'checkpoint',    // o jogador escolheu descansar aqui
      'habilidade',    // conquista permanente
      'semente',       // restaurou uma sala
      'fragmento',     // coletável permanente
      'areaLimpa',     // destravou a semente da área
      'chefeMorto',    // marco grande
    ]);
    this.mundo.aoEvento = (ev) => {
      anterior?.(ev);
      if (MOMENTOS.has(ev.tipo)) this.salvar(ev.tipo);
      /* Cada morte de parasita agora é progresso permanente (é ela que abre a
         semente da área), então perder uma dói. Mas uma escrita no Firestore
         por inimigo morto gastaria cota à toa: a nuvem continua nos marcos da
         lista acima e a morte vai só pro `localStorage`, que é síncrono e de
         graça. */
      else if (ev.tipo === 'inimigoMorto') this.salvarLocal();
    };

    // Melhor esforço ao fechar a aba. O navegador pode matar a aba antes de a
    // escrita assíncrona terminar — por isso os gatilhos acima é que garantem
    // a cobertura de verdade, e não este.
    window.addEventListener('beforeunload', () => { this.salvar('saída'); });
    // `visibilitychange` é mais confiável que `beforeunload` em celular, onde
    // trocar de app costuma não disparar o segundo.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.salvar('oculto');
    });
  }

  _estado(texto) {
    this.estado = texto;
    this.aoEstado?.(texto);
  }
}
