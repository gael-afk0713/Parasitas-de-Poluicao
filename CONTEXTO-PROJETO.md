# Parasitas de Poluição — Contexto do Projeto

> Este arquivo existe pra dar contexto completo a uma sessão nova (inclusive
> em outro ambiente/chat) sobre o que é o jogo, o que já foi construído, como
> as coisas foram implementadas e quais as preferências de trabalho do autor.
> Se você é uma instância nova do Claude lendo isso: leia inteiro antes de
> mexer em qualquer arquivo.

## O jogo

Jogo em **HTML/CSS/JS puro**, sem frameworks, pra hospedar no **GitHub
Pages**. Tema: você é o CEO de uma empresa que cresce à custa da natureza
(desmatamento, poluição de rios, fábricas) até a empresa colapsar — a partir
daí o jogador vira o **"Guardião da Natureza"** e precisa restaurar o que foi
destruído. Essa segunda metade (fase de restauração) ainda **não foi
construída** — por enquanto o jogo cobre só a fase de expansão da empresa.

## Estrutura de arquivos

```
index.html              tela de menu + painéis (Como Jogar, Créditos, Novo Jogo)
style.css               TODO o CSS do jogo (menu + Fase 1, um arquivo só)
script.js               JS da tela de menu e dos painéis de index.html
fase1.html              cena da Fase 1 (grid isométrico + HUD + construção)
fase1.js                JS da Fase 1 (grid, câmera/escala, construção de fábricas)
imagens/
  fabrica-fundo.png       fundo da tela de menu (gerado com IA)
  mapa-fase1-clareira.jpg fundo original da Fase 1 (floresta + clareira + lagoa), 1024x572
  mapa-fase1-clareira-hd.jpg  mesma imagem, upscale local 2x (Lanczos+sharpen) — é a que
                              está em uso hoje no CSS, pra não ficar borrada em telas grandes
  usina-carvao.png         sprite isométrico da Usina de Carvão, PNG RGBA transparente, 644x740,
                              gerado com IA
  usina-agua.svg            sprite isométrico da Usina de Água, SVG desenhado à mão (não IA —
                              o gerador de imagem ficou sem crédito nessa sessão; se algum dia
                              gerar uma versão em PNG no mesmo estilo do carvão, é só trocar o
                              campo `sprite` da entrada 'usina-agua' em FABRICAS, o pipeline de
                              sprite/máscara aceita os dois formatos sem mudança de código)
  madeireira.svg             sprite da Madeireira, SVG à mão (mesmo motivo acima)
  refinaria-petroleo.svg     sprite da Refinaria de Petróleo, SVG à mão, pegada 3x1
  usina-eolica.svg           sprite da Usina Eólica, SVG à mão
  estacao-tratamento.svg     sprite da Estação de Tratamento, SVG à mão
```

Os quatro últimos são **placeholders temporários** — o autor vai gerar a arte
final via IA a partir das descrições que o Claude escreveu num chat separado
(mesmo estilo isométrico da `usina-carvao.png`, fundo transparente, sem
sombra de chão, sem texto/marca d'água) e trocar o campo `sprite` de cada
entrada em `FABRICAS` quando a imagem chegar — o pipeline aceita `.png` ou
`.svg` sem mudança de código.

Não existe build step, bundler ou dependências — é tudo `<script>`/`<link>`
direto. `index.html` e `fase1.html` carregam o **mesmo** `style.css`.

## Paleta e tipografia (usar em tudo daqui pra frente)

```css
--soot:#0b0906;        /* fundo escuro industrial */
--paper:#efe8d6;        /* texto claro principal */
--paper-dim:#9d947f;    /* texto secundário/apagado */
--amber:#d99a35;        /* cor de destaque (CTAs, bordas ativas, glow) */
--amber-dim:#8a5d1f;
--rust:#8a4a2f;          /* usada como "cor de erro/cancelar" no lugar de vermelho puro */
--moss-bright:#8fbf72;   /* usada como "cor de sucesso/confirmar" */
--agua:#5f97a6;          /* acento das construções de categoria "Usina" (água), contraste
                             de propósito com o âmbar/rust do carvão — só usado no sprite/
                             ícone da Usina de Água, a UI/chrome continua toda em âmbar */
--agua-dim:#3f7383;
```

Fontes (Google Fonts, já linkadas no `<head>` dos dois HTMLs):
- **Space Grotesk** (500/700/900) — títulos, valores de HUD, texto normal
- **JetBrains Mono** (400/600) — rótulos, botões, tudo que é "UI/HUD"

Estilo geral: uppercase + letter-spacing largo nos rótulos mono, bordas finas
em vez de sombras pesadas, glow sutil em âmbar pra estados ativos/hover.

## O que já está pronto

### `index.html` / `script.js` / `style.css` — Menu principal

- Tela de menu com título animado, fundo com respiração/parallax sutil pelo
  mouse, flicker de luz industrial, camada de "raios" girando, partículas de
  fuligem caindo, moldura HUD com cantos e status "Sistema Corporativo
  Online", relógio ao vivo no rodapé, flash de "power-on" na abertura.
- Navegação do menu por teclado (setas + Enter/Espaço nativo dos botões).
- Painel **Como Jogar** — lista estática de regras.
- Painel **Créditos**.
- Todos os painéis compartilham o padrão `.painel` / `.painel-conteudo` /
  `.painel-voltar` — abrir/fechar via classe `.aberto`, Escape fecha.
- Há um bloco `@media (prefers-reduced-motion: reduce)` que desliga as
  animações decorativas — **sempre atualizar esse bloco ao adicionar uma
  animação nova**, é convenção já estabelecida no projeto.

#### Contas locais (login/cadastro obrigatório)

`#painel-login` é um `.painel` **sempre aberto ao carregar a página se não
houver sessão válida** (`abrirGateLogin()` chamado direto no fim do script,
não depende de clique em nada) — cobre a tela inteira e bloqueia interação
com o menu atrás até logar. **Diferente dos outros painéis, o Escape global
pula esse aqui de propósito** (`document.querySelectorAll('.painel.aberto:not(#painel-login)')`)
— não dá pra sair sem entrar.

**Isso NÃO é autenticação de verdade.** Não existe servidor (é só
HTML/JS/CSS estático, GitHub Pages). Usuário+senha ficam 100% no
`localStorage` do navegador:

```js
localStorage['parasitas-contas']  // { [usuarioMinusculo]: { usuario, senhaHash, criadoEm } }
localStorage['parasitas-sessao']  // usuarioMinusculo logado, ou ausente
```

- `hashSenha(usuario, senha)` usa `crypto.subtle.digest('SHA-256', ...)`
  (Web Crypto — exige contexto seguro: `https://` ou `http://localhost`,
  os dois ambientes usados neste projeto) com um salt fixo + o usuário, só
  pra não guardar a senha em texto puro. **Não é criptografia robusta**,
  não tem como recuperar senha esquecida, e qualquer pessoa com acesso ao
  mesmo navegador pode inspecionar/apagar isso pelo DevTools. Serve só pra
  separar o progresso de pessoas diferentes no mesmo computador — a tela de
  login já deixa esse aviso explícito pro jogador.
- Mesmo formulário faz login E cadastro: usuário existe → confere a senha;
  não existe → cria a conta na hora com essa senha.
- `sessaoAtual()` devolve a chave (usuário em minúsculas) logada, ou `null`
  se não houver sessão ou se a sessão apontar pra uma conta apagada.
- Indicador no rodapé (`#footer-conta`, escondido via `hidden` até logar)
  mostra o usuário + botão **Sair** (`encerrarSessao()` + reabre o gate).

#### Painel Novo Jogo — saves persistidos de verdade, por conta

Os 3 slots **não vivem mais só em memória** — persistem em
`localStorage['parasitas-saves-{usuario}']` (namespaced pela conta logada,
via `chaveSavesConta()`), formato:

```js
{ 1: { slot, nomeSave, jogador, empresa, dificuldade, criadoEm, atualizadoEm,
       progresso: null | {...} } | null,
  2: ..., 3: ... }
```

- `renderSlotAtual()` pré-preenche os campos com o que já estiver salvo
  naquele slot (ou campos vazios); os botões de slot mostram um subtítulo
  (`.slot-sub`) com o nome da empresa, "vazio", ou "{empresa} · R$ X" se já
  tiver progresso jogado.
- **Cada campo grava no localStorage a cada tecla digitada**
  (`atualizarCampoSlot`) — um rascunho sobrevive a um F5 mesmo sem clicar
  Começar.
- **Começar decide entre continuar ou recomeçar**: se nome/jogador/empresa/
  dificuldade batem exatamente com o que já estava salvo naquele slot
  (`snapshotSlotAtual`, capturado ao selecionar o slot) E existe
  `progresso`, o progresso é preservado; qualquer campo diferente conta
  como recomeçar do zero (zera `progresso`). Escreve
  `localStorage['parasitas-save-ativo']` com `{usuario, slot, nomeSave,
  jogador, empresa, dificuldade}` (agora inclui `usuario` — é a ponte que
  `fase1.js` usa pra saber onde ler/gravar o progresso) e redireciona.
- **Botão "Continuar"** (menu principal, hoje funcional): pega o save de
  `atualizadoEm` mais recente entre os 3 slots da conta logada e vai direto
  pra `fase1.html`; se a conta não tiver nenhum save ainda, abre o painel
  Novo Jogo com um aviso em vez de não fazer nada.

### `fase1.html` / `fase1.js` — Fase 1 (grid + construção)

**Fundo e câmera:** a imagem de fundo é um `<div class="fase1-bg">` com
`background-size:contain` (era `cover` até essa mudança — `cover` cortava a
imagem em telas com proporção bem diferente da imagem original, tipo
monitores ultrawide ou notebooks comuns; `contain` sempre mostra a imagem
inteira, sobrando faixa no `--soot` dos lados ou em cima/embaixo quando a
proporção não bate, mas nunca corta nem estica). Como o grid é desenhado por
JS (não é parte da imagem), existe uma função `imagemParaTela(ponto)` que
replica exatamente a mesma matemática do `background-size:contain` (escala =
`min(vw/IMG_W, vh/IMG_H)`, depois centraliza) pra converter qualquer ponto do
**espaço da imagem original** (1024x572) pro **pixel de tela atual**. Isso é
usado em tudo: grid, sprites de construção, cálculo de célula sob o cursor.
Se a janela for redimensionada, tudo reflui corretamente porque nada depende
de posição absoluta fixa — só de `window.innerWidth/innerHeight`
recalculados. **Se algum dia trocar de `contain` pra `cover` no CSS de
novo, tem que trocar `min` por `max` em `imagemParaTela`, `celulaMaisProxima`
e `escalaAtual` juntos — os três têm que usar a mesma fórmula.**

**Grid isométrico:** desenhado num `<canvas id="grid-fase1">` por cima do
fundo (não redesenha a imagem, só traça linhas). Constantes em `fase1.js`:

```js
GRID_N = 12          // células por lado (12x12 = 144 células)
TILE_W = 80           // largura do tile no espaço da imagem (não em tela)
TILE_H = 40            // altura do tile (proporção 2:1, isométrico clássico)
GRID_CENTER_X = 512    // centro do grid no espaço da imagem
GRID_CENTER_Y = 280
```

Projeção isométrica matemática pura (**sem** `transform` 3D de CSS):

```
x = (coluna - linha) * (TILE_W / 2)
y = (coluna + linha) * (TILE_H / 2)
```

`pontoDaGrade(col, row)` calcula isso pra um ponto de rede (lattice) do
grid; `pontoNaTela(col, row)` já devolve em pixel de tela. O grid vai de
`(0,0)` a `(GRID_N, GRID_N)` em pontos de rede, formando `GRID_N × GRID_N`
células. O contorno é claro/branco com halo escuro por baixo (pra
contrastar com a imagem colorida) — **não tem mais borda âmbar externa**,
foi removida a pedido do usuário.

**Célula sob o cursor:** `celulaMaisProxima(mx, my)` faz o caminho inverso
(de pixel de tela pra `{col, row}`) invertendo a mesma matemática. Sempre
clampa pro grid (`0` a `GRID_N-1`), então mesmo o cursor fora do grid faz
snap pra célula válida mais próxima.

**Pegada multi-célula (footprint):** cada construção ocupa `celulasCol` x
`celulasRow` células (não necessariamente 1x1 — a Usina de Carvão é 2x1, a
Usina de Água é 1x1). `centroFootprintNaTela(col, row, colSpan, rowSpan)`
devolve o centro na tela de toda a pegada (generaliza o antigo
`centroCelulaNaTela`, que só existia pra 1x1).
`larguraImagemParaFootprint(colSpan, rowSpan)` calcula a largura visual do
sprite a partir do contorno do losango isométrico da pegada
(`(colSpan+rowSpan)*(TILE_W/2)`), com uma margem de 15% pra dentro — o
sprite é um retângulo, a pegada é um losango, sem essa folga os cantos do
retângulo escapam visualmente da pegada. `footprintOcupado`/
`marcarFootprintOcupado` conferem/marcam **todas** as células da pegada em
`celulasOcupadas` (um `Set` de chaves `"col,row"`), não só uma.
`clampFootprint` desliza a pegada pra dentro do grid se o cursor estiver
perto da borda, garantindo que ela sempre caiba inteira.

**HUD** (`.hud-fase1`, topo da tela): quatro blocos — **Empresa** (vem do
save ativo, ou "—" se abrir a página direto sem passar pelo Novo Jogo),
**Caixa** (dinheiro, formatado em `pt-BR` via `toLocaleString`, começa em
`R$ 5.000` — pulsa em `--moss-bright` por um instante toda vez que rende
dinheiro num tick, classe `.pulso-ganho`), **Fábricas** (contador de TODAS
as construções, começa em `1` — a fábrica inicial da empresa, que é só o
número no HUD, **não tem sprite no grid**) e **Poluição** (total acumulado,
puramente informativo/atmosférico por enquanto — muda de cor conforme a
gravidade via `data-nivel` no `.hud-stat--poluicao`: `normal` até 500,
`atencao` até 1500, `critico` depois disso; cruzar o `critico` dispara um
toast único de aviso narrativo, ver abaixo).

**Toast (`#boas-vindas`, reaproveitado):** a função genérica `mostrarToast(...conteudo)`
troca o conteúdo do elemento e reinicia a transição — é usada tanto pra
"Bem-vindo(a), {jogador}..." ao carregar a fase (se existe save ativo) quanto
pro aviso de poluição crítica. Não crie um segundo elemento de toast pra
uma mensagem nova; reaproveite `mostrarToast`.

**Botão "Fábricas"** (fixo embaixo, centro) abre um painel-gaveta
(`.painel-fabricas`, sobe de baixo). **Os cards não são mais HTML
hardcoded** — `renderizarCartasFabricas()` gera um `<button class="carta-fabrica">`
pra cada entrada de `FABRICAS` (ícone via `ICONES_CONSTRUCAO[config.icone]`,
nome, categoria, descrição; o preço é preenchido depois por
`atualizarCartasFabricas()`). Adicionar uma construção nova é só adicionar
uma entrada em `FABRICAS` — não mexe em `fase1.html`. Os clicks nos cards
usam **delegação de evento** no container `#lista-fabricas` (não
`querySelectorAll(...).forEach(...)`), porque os cards não existem no DOM
no momento em que o script começa a rodar. O card fica `disabled`
automaticamente se o saldo não for suficiente pro preço **atual** daquele
tipo (ver escala de preço abaixo).

**Fluxo de construção completo** (estado controlado por `estadoConstrucao`,
objeto global em `fase1.js`):

1. Clicar no card fecha o painel e chama `iniciarColocacao(tipo)`, que cria
   um `<div class="fabrica-instancia fabrica-instancia--fantasma">`
   (`position:fixed`, `pointer-events:none`, `transform:translate(-50%,-100%)`
   — âncora é o **centro-inferior** da pegada, não de uma célula) contendo o
   `<img>` do sprite (opacity 0.5 via CSS, aceita `.png` ou `.svg`) mais uma
   `<div class="fabrica-tinta">` usada só pro flash de confirmar/cancelar.
2. **Controle unificado por Pointer Events** (`pointermove`/`pointerdown`/
   `pointerup` — não mouse e touch separados): `pointermove` no `window`
   chama `reposicionarFantasma(x, y)` continuamente (cobre hover de mouse E
   arrastar o dedo no toque), que acha a pegada mais próxima do cursor
   (já clampada pro grid) e reposiciona o wrapper ali (`posicionarInstancia`).
   Se alguma célula da pegada já está ocupada, o sprite fica acinzentado
   (`filter:grayscale(...)`) como aviso. Um único código funciona pra
   mouse, toque e caneta ao mesmo tempo — importante em dispositivo híbrido
   (notebook touchscreen, tablet com mouse), onde dois sistemas separados
   já causaram bug de conflito antes.
3. `pointerdown`/`pointerup` no `window` (**só são anexados depois de um
   `setTimeout(…, 0)`**, pra não capturar o mesmo evento que abriu a
   colocação) chamam `aoPressionarDurantePlacement`/`aoSoltarDurantePlacement`:
   no `pointerup`, se a pegada atual estiver ocupada, ignora (não trava);
   senão, chama `travarColocacao()` — sprite fica opaco, aparecem os botões
   flutuantes **Confirmar**/**Cancelar** (reaproveitam `.painel-confirmar`/
   `.painel-voltar`). `aoSoltarDurantePlacement` chama `e.preventDefault()`
   pra evitar o click de compatibilidade que alguns navegadores disparam
   logo após um toque, que senão acertaria o botão Confirmar assim que ele
   aparece embaixo do dedo. Pelo mesmo motivo, os `click` listeners dos
   botões Confirmar/Cancelar só são ligados um tick depois de criados.
4. **Confirmar:** aplica `.fabrica-tinta--sucesso` (pisca `--moss-bright`
   via `mask-image` recortada no formato exato do sprite), desconta o
   **preço travado no início da colocação** (`estadoConstrucao.precoCompra`,
   não o `config.custo` cru — ver escala de preço abaixo) do `dinheiro`,
   incrementa `totalFabricas` e `quantidadePorTipo[tipo]`, marca todas as
   células da pegada em `celulasOcupadas`, guarda a instância (com `tipo`!)
   em `instanciasConstruidas` (array, é a fonte de verdade pro tick de
   economia E pra reposicionar tudo em resize).
5. **Cancelar:** aplica `.fabrica-tinta--erro` (pisca `--rust`), remove o
   sprite depois da animação, nada é descontado.
6. **Escape** a qualquer momento cancela silenciosamente
   (`abortarColocacao`, sem flash) e fecha o painel de fábricas se estiver
   aberto.
7. Enquanto há uma colocação em andamento (fantasma ou travada), o botão
   "Fábricas" fica `disabled` — não dá pra abrir o menu de novo no meio do
   processo.

**Bug já corrigido (pra não reintroduzir):** o objeto `estadoConstrucao`
precisa ter `larguraImagem` **direto nele** (não só dentro de
`estadoConstrucao.config.larguraImagem`), porque `posicionarInstancia` lê
`instancia.larguraImagem` diretamente. Sem isso, o cálculo vira `NaN`, o
`style.width` é rejeitado silenciosamente pelo navegador, e o sprite cai num
tamanho "auto" instável que parecia mudar de tamanho conforme a posição na
tela. A correção está em `iniciarColocacao()`.

**Rotação:** já existiu (tecla R + botão "Girar", trocava 2x1 por 1x2) e foi
**removida a pedido do usuário** — a pegada da Usina de Carvão é fixa em 2x1
hoje. A infraestrutura de pegada multi-célula continua toda lá; reintroduzir
rotação seria só voltar a trocar `colSpan`/`rowSpan` num botão/tecla, igual
antes.

### Economia: escala de preço, tick, adjacência

**Escala de preço por unidade repetida** (genérica, vale pra qualquer
entrada de `FABRICAS`): cada unidade adicional da MESMA construção custa
15% a mais que a anterior — preço da unidade N = `custo` base ×
`MULTIPLICADOR_CUSTO_REPETIDO^(N-1)`, calculado em `precoAtual(tipo)` a
partir de `quantidadePorTipo[tipo]`. O preço é **travado no momento em que
a colocação começa** (`estadoConstrucao.precoCompra`), não recalculado no
confirmar — evita cobrar um valor diferente do que apareceu no card.

**Tick de economia** (`tickEconomia()`, `setInterval` a cada
`TICK_ECONOMIA_MS` = 3000ms): itera **por instância construída**
(`instanciasConstruidas`), não por tipo/quantidade agregado — isso é
necessário porque o bônus de adjacência é por construção específica, não
por tipo. Pra cada instância: calcula o ganho efetivo
(`calcularGanhoInstancia`), soma no `dinheiro`, soma a poluição base
(`config.poluicaoPorTick`, sem bônus — o bônus de adjacência só afeta
ganho, não poluição) no `poluicaoTotal`, e mostra um número flutuante
(`mostrarNumeroFlutuante`, `.numero-flutuante`, sobe e some em ~1.15s) com
o valor já bonificado sobre a construção.

**Bônus de adjacência** (`bonusAdjacencia` na config de uma construção —
hoje só a Usina de Água tem, `0.20` = +20%): `footprintsVizinhos(a, b)`
detecta se duas pegadas são vizinhas **ortogonais** (compartilham uma
aresta — diagonal não conta, foi escolha deliberada porque diagonal em
grid isométrico é visualmente confuso pro jogador). `calcularGanhoInstancia`
soma o `bonusAdjacencia` de CADA vizinha que tiver essa propriedade e
aplica o total ao `ganhoPorTick` da instância, com teto em
`BONUS_ADJACENCIA_MAX` (0.60 = +60%) pra impedir cercar uma fábrica de
usinas de água pra ganho descontrolado. O sistema é genérico: qualquer
construção futura com `bonusAdjacencia` funciona igual, sem código novo.

**Redução de poluição por adjacência** (`reducaoPoluicaoAdjacencia` na
config — hoje só a Usina Eólica tem, `0.25` = -25%): espelha o mecanismo
acima, mas em vez de bonificar o ganho da vizinha, reduz a poluição/tick
dela. `calcularPoluicaoInstancia(instancia)` soma o `reducaoPoluicaoAdjacencia`
de cada vizinha ortogonal que tiver essa propriedade, aplica com teto em
`REDUCAO_ADJACENCIA_MAX` (0.50 = -50%) sobre o `poluicaoPorTick` **antes**
de aplicar o `multPoluicao` da dificuldade. É o mecanismo oposto e
simétrico ao bônus de ganho — dá pra rodear uma fábrica suja de eólicas pra
mitigar (não eliminar) o dano ambiental dela, sem tocar no ganho.

**Redução global de poluição** (`reducaoGlobalPorTick` na config — hoje só
a Estação de Tratamento tem, `20`): diferente dos dois mecanismos acima,
**não é por adjacência** — é um valor fixo abatido uma vez por tick do
`poluicaoTotal` do jogo inteiro, não importa onde a construção está no
grid. Somado em `tickEconomia` (`reducaoGlobalDoTick`) e aplicado depois de
somar toda a poluição do tick, sempre travado em `Math.max(0, ...)` pra não
deixar `poluicaoTotal` negativo. Deliberadamente **não passa pelo
`multPoluicao` da dificuldade** — a eficácia absoluta da Estação é
constante em qualquer dificuldade, então ela fica proporcionalmente mais
fraca contra o ritmo mais rápido de poluição do Expert (empurra o jogador a
construir mais de uma se estiver jogando no nível difícil). A Estação não
rende dinheiro nenhum (`ganhoPorTick: 0`) — é puramente uma ferramenta de
mitigação, o preço dela compete por espaço no orçamento contra construções
que rendem.

**Valores atuais** (ajustar aqui se rebalancear):

| Construção | categoria | pegada | custo base | ganho/tick | poluição/tick | mecanismo especial |
|---|---|---|---|---|---|---|
| Usina de Carvão | Fábrica | 2x1 | R$ 4.500 | R$ 225 | 15 | — |
| Madeireira | Fábrica | 2x1 | R$ 3.500 | R$ 160 | 8 | mais barata, rende menos, polui menos que o carvão |
| Refinaria de Petróleo | Fábrica | 3x1 | R$ 12.000 | R$ 600 | 48 | ganho pesado, poluição desproporcional — alto risco/retorno |
| Usina de Água | Usina | 1x1 | R$ 3.000 | R$ 100 | 2 | `bonusAdjacencia` +20%/vizinha (teto 60%) |
| Usina Eólica | Usina | 1x1 | R$ 2.500 | R$ 60 | 1 | `reducaoPoluicaoAdjacencia` -25%/vizinha (teto 50%) |
| Estação de Tratamento | Usina | 1x1 | R$ 5.000 | R$ 0 | 0 | `reducaoGlobalPorTick` -20 (fixo, jogo inteiro, todo tick) |

Caixa inicial do jogador: R$ 5.000. Filosofia: a primeira construção deve
consumir a maior parte do caixa inicial (decisão pesada) mas se pagar em
~1 minuto de jogo (não travar o ritmo). As 4 construções novas foram
desenhadas pra dar variedade de arquétipo (barata/suja, cara/agressiva,
suporte de ganho, suporte de limpeza local, suporte de limpeza global) em
vez de só "mais uma fábrica com número diferente" — o objetivo era reduzir
a monotonia relatada pelo jogador ("só comprar fábrica e deixar farmar").

### Dificuldade, fiscalização, meta de vitória e colapso

A dificuldade escolhida no Novo Jogo (`saveAtivoInfo.dificuldade`) **era
capturada e nunca usada** — agora alimenta uma tabela de multiplicadores,
`DIFICULDADES` (`configDificuldade()` lê a do save ativo, cai pra 'Médio'
se faltar/for desconhecida):

| Dificuldade | ganho | poluição | multa | intenção |
|---|---|---|---|---|
| Iniciante | 1.0x | 0.65x | 0.6x | mais seguro, ritmo normal |
| Médio | 1.0x | 1.0x | 1.0x | padrão |
| Expert | 1.3x | 1.5x | 1.5x | cresce mais rápido, mas colapsa mais rápido também |

`multGanho` entra em `calcularGanhoInstancia` (depois do bônus de
adjacência); `multPoluicao` entra no acúmulo de `poluicaoTotal` dentro de
`tickEconomia`; `multMulta` entra na fiscalização abaixo. Isso também dá um
motivo estratégico real pra Usina de Água: ela é a ferramenta pra crescer
sem escalar a poluição na mesma proporção, especialmente relevante no
Expert.

**Fiscalização ambiental** (`aplicarFiscalizacao()`, `setInterval` a cada
`FISCALIZACAO_INTERVALO_MS` = 25000ms): se `poluicaoTotal > 0`, desconta
`multa = round(poluicaoTotal * FATOR_MULTA(0.3) * multMulta)` do `dinheiro`
(nunca deixa negativo, `Math.max(0, ...)`), pulsa a Caixa em `--rust`
(`.pulso-multa`, mesma ideia do `.pulso-ganho` mas pra multa) e mostra
toast via `mostrarToast`. Como `poluicaoTotal` nunca diminui, a multa cresce
ao longo da partida — é intencional, cria uma rampa de pressão que fica
pesada perto do limiar de colapso.

**Meta de vitória / colapso** (`verificarFimDeJogo()`, chamada no fim de
todo `tickEconomia`): `META_CAIXA` = 90000 e `LIMIAR_COLAPSO` = 6000 (+50%
em relação aos valores anteriores — reajustados quando as 4 construções
novas entraram, porque o ganho/tick disponível subiu bastante com a
Refinaria e a Madeireira, e as metas antigas ficavam curtas demais/rápidas
demais em cima do novo teto de ganho) são **iguais nas três dificuldades** — só a VELOCIDADE de chegar neles muda
(via os multiplicadores acima), não os alvos. Colapso é checado antes da
vitória (se os dois baterem no mesmo tick, colapso ganha — o tema do jogo é
que o crescimento insustentável cobra a conta). `jogoEncerrado` (`null` |
`'colapso'` | `'vitoria'`) trava novas construções
(`iniciarColocacao`/`btnFabricas.disabled`) e mostra uma tela cheia
(`#tela-vitoria` / `#tela-colapso`, reaproveitam o padrão `.painel`) com
estatísticas da partida e um link "Voltar ao Menu". **Isso não é a Fase 2
de verdade** — as duas telas dizem explicitamente que o "Guardião da
Natureza" ainda não existe, é só o gancho narrativo onde a Fase 1 termina
por enquanto.

### Autosave e restauração de progresso

O progresso da Fase 1 vive **dentro do mesmo save** persistido pelo menu
(`localStorage['parasitas-saves-{usuario}'][slot].progresso`), não numa
chave separada:

```js
progresso: {
  dinheiro, poluicaoTotal, totalFabricas, quantidadePorTipo,
  instancias: [{ tipo, col, row, colSpan, rowSpan }],  // sem o wrapper DOM, só os dados
  tempoJogadoSegundos, colapsada, vitoriaAlcancada,
}
```

- `salvarProgresso()` é chamada: a cada `tickEconomia` (3s), depois de
  `confirmarConstrucao`, e num listener de `beforeunload` (rede de
  segurança pra pegar o estado mais recente mesmo se o jogador fechar a
  aba entre ticks). Se `saveAtivoInfo` não tiver `usuario`/`slot` (ex:
  abriu `fase1.html` direto, sem vir do menu), é um no-op silencioso.
- `restaurarProgresso()` roda **uma vez, no fim do carregamento** (depois
  de tudo mais estar definido — precisa de `FABRICAS`, `criarSprite`,
  `posicionarInstancia` etc.). Recria cada instância salva chamando
  `criarSprite` normalmente, mas pulando o fantasma/travamento: aplica
  direto as classes `--travada --construida` (o mesmo estado final de uma
  construção confirmada) e remove a `.fabrica-tinta` na hora (ela só existe
  during o flash de confirmação, que não faz sentido pra algo restaurado).
  Se `colapsada`/`vitoriaAlcancada` estiver marcado, mostra a tela de fim
  imediatamente — um save que colapsou continua colapsado ao reabrir, não
  dá pra "revivê-lo" jogando de novo.
- `tempoJogadoSegundos` acumula corretamente entre sessões:
  `tempoJogadoAcumulado` (vem do progresso restaurado) +
  `Date.now() - inicioSessaoMs` (tempo da sessão atual), calculado em
  `segundosJogados()`.

### Painel de Configurações (Esc / botão de engrenagem)

`#painel-config` (mesmo padrão `.painel`/`.painel-conteudo` dos outros) é
acessível de duas formas equivalentes: a tecla **Esc** ou o botão de
engrenagem fixo no canto superior direito (`#btn-config`) — o botão existe
porque não há tecla Esc em celular/tablet. De dentro dele: **Salvar agora**
(chama `salvarProgresso()` fora do ciclo normal do tick e mostra confirmação
em `#status-config`), **Voltar ao Menu** (salva e redireciona pra
`index.html` sem encerrar a sessão) e **Sair da Sessão** (salva, remove
`parasitas-sessao` do `localStorage` e redireciona — volta a pedir login).

**Esc é "em camadas"**, não abre o painel de configurações incondicionalmente:
```js
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || jogoEncerrado) return;
  if (painelConfig.classList.contains('aberto')) { fecharPainelConfig(); return; }
  const haAlgoParaFechar = painelFabricas.classList.contains('aberto') || estadoConstrucao !== null;
  if (haAlgoParaFechar) { fecharPainelFabricas(); abortarColocacao(); return; }
  abrirPainelConfig();
});
```
Ou seja: se as Configurações já estão abertas, Esc fecha elas. Senão, se
tiver o painel de Fábricas aberto OU uma colocação em andamento, Esc fecha
**isso** primeiro (comportamento que já existia). Só quando não há mais
nada pra fechar é que Esc abre as Configurações. Fica desabilitado
inteiramente se `jogoEncerrado` (não faz sentido pausar numa tela de fim de
jogo). **Se algum painel novo for adicionado no futuro, ele precisa entrar
nessa cadeia de prioridade antes do `abrirPainelConfig()` final**, senão Esc
vai pular direto pras Configurações em vez de fechar o painel novo.

### HUD responsivo (mobile)

`.hud-fase1` não tinha nenhuma regra de responsividade — com o botão de
engrenagem novo no canto e nomes de empresa mais longos, em telas estreitas
(testado em iPhone 13, 390px) o botão sobrepunha a Caixa e as estatísticas
de Fábricas/Poluição saíam inteiramente da tela. As regras de correção
ficam no **final do arquivo `style.css`, de propósito** (não dentro do
`@media (max-width:640px)` original lá no topo, que cobre só `index.html`):
como a regra de mobile e a regra "base" de `.hud-fase1`/`.hud-stat` têm a
mesma especificidade CSS, a que vem **depois** no arquivo vence o empate —
colocar o bloco mobile antes das regras base (erro cometido e corrigido
nessa sessão) faz ele ser silenciosamente ignorado em qualquer largura de
tela. **Se mexer em `.hud-fase1`/`.hud-stat*` de novo, lembrar que existe
uma segunda definição pra mobile lá embaixo no arquivo.** A correção
também precisou de `min-width:0` no `.hud-stat--empresa` e no
`.hud-stat-texto` dele — sem isso, o `max-width`/`text-overflow:ellipsis`
do nome da empresa não tem efeito nenhum dentro de um item flex, é um
detalhe clássico (e não óbvio) do modelo de flexbox.

## Fluxo de dados entre telas

Duas pontes entre `index.html` e `fase1.html`, ambas em `localStorage`:

1. **`parasitas-save-ativo`** — qual save está em uso agora:
   ```json
   { "usuario": "fulano", "slot": 1, "nomeSave": "...", "jogador": "...", "empresa": "...", "dificuldade": "Iniciante" }
   ```
   Escrito por `script.js` (Começar ou Continuar); lido por `fase1.js`
   (`lerSaveAtivo()`, guardado em `saveAtivoInfo`) ao carregar a Fase 1.
   Se não existir (ex: abrir `fase1.html` direto), a página cai em valores
   padrão sem quebrar — só não autosalva nem restaura nada, já que não sabe
   pra qual conta/slot gravar.
2. **`parasitas-saves-{usuario}`** — os 3 slots daquela conta, incluindo o
   `progresso` de cada um (ver seção acima). Escrito tanto por `script.js`
   (campos do formulário) quanto por `fase1.js` (autosave do progresso).

E uma terceira chave que não é save, é sessão: **`parasitas-sessao`** (qual
conta está logada) + **`parasitas-contas`** (todas as contas locais, ver
seção de login acima).

## Preferências de fluxo de trabalho do autor

- **Editar arquivos existentes de forma pontual** (tipo find & replace) —
  nunca reescrever um arquivo inteiro do zero, a não ser que a mudança
  peça explicitamente uma reestruturação grande.
- Antes de decisões de design/dimensionamento ambíguas (ex: tamanho do
  grid), **propor opções e perguntar antes de codar**, não assumir.
- Sempre **testar no navegador de verdade** antes de dizer que terminou —
  esse projeto tem histórico de rodar `python -m http.server` numa porta
  local, abrir no browser da ferramenta, clicar/testar o fluxo inteiro e
  checar o console por erros antes de reportar como pronto.
- Reaproveitar paleta/tipografia/classes já existentes em vez de inventar
  estilo novo (ex: os botões Confirmar/Cancelar da construção reaproveitam
  `.painel-confirmar`/`.painel-voltar` já usadas nos outros painéis).

## O que falta / próximos passos possíveis

- Sprite da "fábrica inicial" (hoje é só um número `1` no HUD, sem
  representação visual no grid).
- Rotação de pegada (2x1 ↔ 1x2) já existiu e foi removida a pedido do
  usuário — a infraestrutura de pegada multi-célula continua, reintroduzir
  é reversível (ver seção "Rotação" acima).
- **Poluição agora afeta o jogo de verdade**: multa periódica proporcional
  (fiscalização), e cruzar `LIMIAR_COLAPSO` termina a partida (tela de
  colapso). O que ainda falta é a Fase 2 jogável de verdade ("Guardião da
  Natureza" / restauração) — hoje colapso e vitória são as DUAS telas de
  fim da Fase 1, cada uma com uma nota explícita de que a próxima etapa
  ainda não existe.
- **Contas locais, saves persistidos e autosave já funcionam** (login
  obrigatório, 3 slots reais por conta, progresso da Fase 1 salvo e
  restaurado). O que ainda falta nessa frente:
  - Sem recuperação de senha (não tem como, não existe backend/e-mail).
  - Sem exportar/importar save (útil pra levar progresso pra outro
    navegador, já que a "conta" não sincroniza de verdade).
  - Só 3 slots por conta, sem opção de apagar um slot individualmente pelo
    painel Novo Jogo (dá pra sobrescrever mudando os campos, mas não tem
    botão "apagar save").
- **4 construções novas (Madeireira, Refinaria de Petróleo, Usina Eólica,
  Estação de Tratamento) usam sprites SVG placeholder desenhados à mão** —
  igual aconteceu com a Usina de Água, o gerador de imagem IA ficou sem
  crédito. O autor vai gerar a arte final a partir de descrições de prompt
  (escritas num chat separado) e trocar o campo `sprite` de cada entrada em
  `FABRICAS` quando a imagem chegar — o pipeline aceita `.png` ou `.svg`
  sem mudança de código, é literalmente só trocar o valor da string.
- Valores de balanceamento (multiplicadores de dificuldade, `FATOR_MULTA`,
  `FISCALIZACAO_INTERVALO_MS`, `META_CAIXA` = 90000, `LIMIAR_COLAPSO` = 6000,
  custo/ganho/poluição das 6 construções) são ajustados por raciocínio +
  automação de navegador, não por playtesting humano longo — vale jogar de
  verdade pra sentir o ritmo e ajustar se ainda estiver monótono ou rápido
  demais.
- Painel de Configurações (Esc / engrenagem) cobre salvar/menu/sair — não
  tem ainda opções de áudio, idioma, ou dificuldade-em-tempo-real (a
  dificuldade é fixada na criação do save, não muda depois).
