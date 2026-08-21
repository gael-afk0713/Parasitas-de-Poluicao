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
  usina-agua.png            sprite da Usina de Água, PNG RGBA transparente, 414x1299 (torre estreita
                              e alta), gerado com IA a partir da descrição escrita pelo Claude
  madeireira.png             sprite da Madeireira, PNG RGBA transparente, 1342x677 (composição bem
                              larga: pilha de toras + galpão + tábuas lado a lado), gerado com IA
  refinaria-petroleo.png     sprite da Refinaria de Petróleo, PNG RGBA transparente, 900x789
                              (quase quadrado — sobe mais do que se espalha no chão), gerado com IA
  usina-eolica.png           sprite da Usina Eólica, PNG RGBA transparente, 474x1327 (torre estreita
                              e alta), gerado com IA
  estacao-tratamento.png     sprite da Estação de Tratamento, PNG RGBA transparente, 996x731 (dois
                              tanques lado a lado), gerado com IA
```

Todos os 6 sprites de construção hoje são PNGs de verdade (gerados com IA a
partir de descrições que o Claude escreveu, no mesmo estilo isométrico —
fundo transparente, sem sombra de chão, sem texto/marca d'água). Os SVGs
desenhados à mão que existiram como placeholder temporário (madeireira,
refinaria, água, eólica, tratamento) foram **removidos** do repositório
depois que a arte final chegou — não ficaram como fallback, pra não haver
dois arquivos por construção confundindo qual está em uso. O pipeline de
sprite/máscara (`criarSprite` em `fase1.js`) continua aceitando `.svg` sem
mudança de código nenhuma, caso alguma construção futura precise de novo de
um placeholder desenhado à mão antes da arte final ficar pronta.

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
`centroCelulaNaTela`, que só existia pra 1x1) — usado só pra elementos de
UI que devem ficar "no meio" da pegada (barra de Confirmar/Cancelar,
número flutuante de ganho).

**Ancoragem do SPRITE em si é outra função, `baseFootprintNaTela`, não
`centroFootprintNaTela`** — bug real corrigido nessa sessão, não
reintroduzir. `posicionarInstancia` (que define `left`/`top`/`width` do
wrapper do sprite, com `transform:translate(-50%,-100%)` no CSS ancorando
a base do sprite no ponto dado) usava `centroFootprintNaTela` originalmente,
ancorando a base do sprite no CENTRO GEOMÉTRICO do losango da pegada. Isso
deixava a metade "da frente" do losango — do centro até o vértice mais
próximo do jogador — sem nenhum pixel de sprite em cima, mesmo essas
células estando ocupadas/reservadas. Numa pegada pequena (1x1, 2x1) o
efeito é sutil; numa pegada maior (3x1, como a Madeireira) vira uma faixa
grande de "chão vazio" na frente da construção — foi relatado pelo autor
como "as dimensões do grid que tá ocupando tá uma merda" antes de eu medir
e confirmar a causa exata via `getBoundingClientRect()` comparado aos 4
cantos do losango. `baseFootprintNaTela(col, row, colSpan, rowSpan)`
corrige isso: mantém o **X** do centro (sprite fica simétrico
esquerda/direita mesmo em pegadas não-quadradas) mas troca o **Y** pro
vértice do losango mais próximo do jogador
(`pontoNaTela(col+colSpan, row+rowSpan)`) — a base do sprite passa a
cobrir a pegada inteira, e a estrutura ainda sobe visualmente acima do
losango (efeito de altura de construção, normal e esperado numa cena
isométrica).

`larguraImagemParaFootprint(colSpan, rowSpan)` calcula a largura-ALVO do
sprite a partir do contorno do losango isométrico da pegada
(`(colSpan+rowSpan)*(TILE_W/2)`), com uma margem de 15% pra dentro — o
sprite é um retângulo, a pegada é um losango, sem essa folga os cantos do
retângulo escapam visualmente da pegada. Essa largura-alvo sozinha **não**
é o tamanho final usado — ver `tamanhoRenderizado()` logo abaixo dela no
código, que ajusta esse alvo pela proporção real de cada imagem.
`footprintOcupado`/
`marcarFootprintOcupado` conferem/marcam **todas** as células da pegada em
`celulasOcupadas` (um `Set` de chaves `"col,row"`), não só uma.
`clampFootprint` desliza a pegada pra dentro do grid se o cursor estiver
perto da borda, garantindo que ela sempre caiba inteira.

**HUD** (`.hud-fase1`, topo da tela): quatro blocos — **Empresa** (vem do
save ativo, ou "—" se abrir a página direto sem passar pelo Novo Jogo),
**Caixa** (dinheiro, formatado em `pt-BR` via `toLocaleString`, começa em
`R$ 5.000` — pulsa em `--moss-bright` por um instante toda vez que rende
dinheiro num tick, classe `.pulso-ganho`), **Fábricas** (`totalFabricas`,
contador de TODAS as construções — começa em `0` e é sempre igual a
`instanciasConstruidas.length`, incrementado ao confirmar uma construção e
decrementado ao vender uma. **Bug já corrigido, não reintroduzir**: até
essa correção o contador começava em `1` — pensado como "a fábrica inicial
da empresa" que não tem sprite no grid — e por isso mostrava sempre um a
mais do que o número real de construções no grid; com o recurso de venda
isso ficou visivelmente errado (vender a única construção ainda mostrava
`1` em vez de `0`). `restaurarProgresso()` recalcula esse valor a partir do
array de instâncias reconstruído, em vez de confiar no número salvo — isso
autocorrige saves antigos que ainda carregavam a contagem inflada) e
**Poluição** (total acumulado,
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
| Madeireira | Fábrica | 3x1 | R$ 3.500 | R$ 160 | 8 | mais barata, rende menos, polui menos que o carvão |
| Refinaria de Petróleo | Fábrica | 2x2 | R$ 12.000 | R$ 600 | 48 | ganho pesado, poluição desproporcional — alto risco/retorno |
| Usina de Água | Usina | 1x1 | R$ 3.000 | R$ 100 | 2 | `bonusAdjacencia` +20%/vizinha (teto 60%) |
| Usina Eólica | Usina | 1x1 | R$ 2.500 | R$ 60 | 1 | `reducaoPoluicaoAdjacencia` -25%/vizinha (teto 50%) |
| Estação de Tratamento | Usina | 2x1 | R$ 5.000 | R$ 0 | 0 | `reducaoGlobalPorTick` -20 (fixo, jogo inteiro, todo tick) |

As pegadas de Madeireira/Refinaria/Estação foram ajustadas depois que a
arte final (PNG) chegou, substituindo os chutes originais feitos em cima
dos placeholders SVG: a regra usada foi "pegada elongada (ex: 3x1) pra
desenho bem espalhado na horizontal, pegada compacta (ex: 2x2) pra desenho
quase quadrado (sobe mais do que se espalha)". A largura-ALVO derivada da
pegada (`celulasCol + celulasRow`, ver `larguraImagemParaFootprint`)
define **qual formato de célula é reservado no grid**, não de qual dos
dois é maior (2x2 vs 3x1 vs 1x3, todas somam 4, reservam formas
diferentes de célula mas pedem a mesma largura-alvo).

**Bug real corrigido nessa passada (não reintroduzir): a largura-alvo da
pegada sozinha NÃO é o tamanho final do sprite.** Antes dessa correção, o
código usava `larguraImagemParaFootprint(...)` direto como
`instancia.larguraImagem`, e a altura ficava inteiramente por conta do
`height:auto` do CSS — ou seja, a altura final era sempre
`larguraAlvo × (alturaNaturalDoPNG / larguraNaturalDoPNG)`, sem NENHUM
teto. Isso é inofensivo pra imagens com proporção parecida com a da Usina
de Carvão (h/w ≈ 0.87–1.15), mas quebra completamente pra proporções
extremas: a Usina de Água (414×1299px, h/w ≈ 3.14) numa pegada 1x1 virava
uma torre gigantesca (~213 de altura, quase o dobro da Usina de Carvão),
enquanto a Madeireira (1342×677px, h/w ≈ 0.50) numa pegada larga ficava
achatada e pequena demais pro tanto de grid que reservava.

A correção é `tamanhoRenderizado(config, colSpan, rowSpan)` (em
`fase1.js`, logo abaixo de `larguraImagemParaFootprint`): calcula a altura
que a largura-alvo implicaria (mantendo a proporção REAL do arquivo, via
`config.larguraImagemPx`/`alturaImagemPx` — dimensões nativas de cada PNG,
guardadas direto em `FABRICAS`) e, se essa altura estourar
`ALTURA_MAX_SPRITE` (`TILE_H * 3.75` = 150, calibrado olhando as 6
construções lado a lado), reduz a LARGURA proporcionalmente até a altura
caber no teto — efeito "contain" dentro de uma caixa
largura-da-pegada×altura-máxima, nunca estica a imagem, só encolhe quando
a proporção pede. Isso é por que a Usina de Água/Eólica hoje renderizam
mais ESTREITAS que a largura-alvo da pegada 1x1 sugeriria (a torre não
precisa preencher a célula inteira, só precisa ter uma altura razoável) —
é o comportamento correto, não um bug. `tamanhoRenderizado` recebe
`colSpan`/`rowSpan` À PARTE (não lê de `config.celulasCol/celulasRow`)
porque uma instância restaurada de um save antigo pode ter sido construída
sob uma pegada diferente da que `FABRICAS` define hoje pro mesmo tipo —
ver `restaurarProgresso`.

Caixa inicial do jogador: R$ 5.000. Filosofia: a primeira construção deve
consumir a maior parte do caixa inicial (decisão pesada) mas se pagar em
~1 minuto de jogo (não travar o ritmo). As 4 construções novas foram
desenhadas pra dar variedade de arquétipo (barata/suja, cara/agressiva,
suporte de ganho, suporte de limpeza local, suporte de limpeza global) em
vez de só "mais uma fábrica com número diferente" — o objetivo era reduzir
a monotonia relatada pelo jogador ("só comprar fábrica e deixar farmar").

### Destaque da própria pegada + adjacência no grid (durante a colocação)

Enquanto uma colocação está em andamento, o grid destaca com preenchimento
colorido do losango isométrico das células (`preencherCelula`/
`preencherFootprint` em `fase1.js`), em duas camadas:

**1. A pegada do próprio fantasma** (`desenharFootprintFantasma()`) —
âmbar (`--amber`) se as células estão livres (dá pra confirmar ali),
ferrugem (`--rust`) se alguma célula já está ocupada (mesma cor usada em
"cancelar" no resto do jogo) — mostra exatamente quais células vão virar
aquela construção, sem precisar adivinhar pelos limites do sprite
(sprites têm folga/transparência ao redor do desenho, então o contorno
visual do PNG não corresponde exatamente ao contorno da pegada).

**2. Adjacência** (`desenharDestaquesAdjacencia()`) — verde (família do
`--moss-bright`) pra efeito de ganho, azul (família do `--agua`) pra
efeito de redução de poluição:

- **Sempre** que há uma colocação ativa: os quadrados de construções JÁ
  existentes que hoje dão/recebem efeito de adjacência umas das outras
  (a "rede" atual), num tom mais fraco (`COR_DESTAQUE_*_EXISTENTE`) — puramente
  informativo, não depende do que está sendo colocado.
- **Só se** a construção sendo colocada tiver ela mesma `bonusAdjacencia`
  ou `reducaoPoluicaoAdjacencia`: os quadrados das vizinhas que ela vai
  afetar SE for confirmada na posição atual do fantasma, num tom mais
  forte (`COR_DESTAQUE_*_FANTASMA`) com contorno — o jogador vê o efeito
  antes de confirmar, não precisa adivinhar ou confirmar-e-conferir.

As duas camadas são chamadas juntas por `redesenharCena()` (grid base +
pegada do fantasma + adjacência, nessa ordem — a pegada fica "por baixo",
a adjacência por cima) sempre que a célula sob o fantasma muda
(`reposicionarFantasma`, com uma checagem de "mudou de célula" pra não
redesenhar o canvas inteiro a cada pixel de movimento do mouse) e ao
encerrar qualquer colocação (`encerrarEstadoConstrucao`, que redesenha sem
destaques já que `estadoConstrucao` volta a `null`). **A função de desenho
da grade original, `desenharGrid()`, continua chamada sozinha (sem
destaques) na pintura inicial da página e no listener de resize do topo
do arquivo** — nesse ponto do carregamento
`FABRICAS`/`instanciasConstruidas`/`estadoConstrucao` ainda não existem
(TDZ), então nem `desenharFootprintFantasma()` nem
`desenharDestaquesAdjacencia()` podem ser chamadas ali; `redesenharCena()`
fica
definida perto de `reposicionarFantasma`, não lá no topo.

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

### Gerenciar construção (clicar numa já construída): vender e melhorar

Clicar em qualquer construção **já construída** no grid (`--construida`, não
durante a colocação) abre `#painel-instancia` com as estatísticas atuais
dela (rende/tick, polui/tick, nível de melhoria) e dois botões:

- **Melhorar** — paga pra subir o nível da instância (até
  `NIVEL_UPGRADE_MAX` = 3 níveis), cada nível aplicando
  `multiplicadorUpgrade(instancia)` = `1 + nivel × MULT_UPGRADE_GANHO`
  (25% por nível, então nível 3 = +75%) sobre a **métrica principal** dela.
  Pra quem rende dinheiro (`ganhoPorTick > 0`), a métrica é o ganho — ver
  `calcularGanhoInstancia`. Pra quem não rende mas tem
  `reducaoGlobalPorTick` (só a Estação de Tratamento hoje), a métrica é a
  limpeza — ver o cálculo em `tickEconomia`. **A poluição/tick escala
  pelo mesmo multiplicador** (`calcularPoluicaoInstancia`) — de propósito:
  rende mais, também polui mais, mantendo a tensão central do jogo em vez
  de virar um upgrade "de graça". Custo do próximo upgrade
  (`custoProximoUpgrade`): primeiro nível custa 50% do preço-base da
  construção, cada nível seguinte NA MESMA instância custa 30% a mais que
  o anterior (`FATOR_CUSTO_UPGRADE` × `MULT_CUSTO_UPGRADE_REPETIDO^nivel`)
  — mesma lógica de escalonamento do preço por unidade repetida
  (`precoAtual`), só que por instância em vez de por tipo.
- **Vender** — remove a construção do grid, libera as células dela
  (`desmarcarFootprintOcupado`, pra dar pra construir ali de novo),
  decrementa `totalFabricas`/`quantidadePorTipo[tipo]` (então o **próximo**
  da mesma linha volta a ficar mais barato, já que a escala de preço é por
  quantidade possuída) e devolve `FATOR_VENDA` (70%) do que foi **investido
  de verdade** na instância — `instancia.investimentoTotal`, que é o preço
  de compra somado a todo upgrade pago nela, não o preço-base cru. Vender
  não devolve o valor cheio de propósito: comprar-e-vender em loop sempre
  perde 30%, então nunca vira uma forma grátis de resetar o escalonamento
  de preço ou farmar dinheiro.

Cada instância guarda `precoCompra`, `investimentoTotal` e `nivelUpgrade` —
todos persistidos no save (`progresso.instancias[].{precoCompra,
investimentoTotal,nivelUpgrade}`) e restaurados em `restaurarProgresso`
(com fallback pro preço-base em saves antigos, de antes desse recurso
existir, que não têm esses campos). O clique só funciona em construções
`--construida` (`.fabrica-instancia--construida{pointer-events:auto;
cursor:pointer;}` — o resto continua `pointer-events:none` de propósito,
pra não disputar com o fluxo de arrastar/soltar da colocação), e só abre o
painel se não houver colocação em andamento nem o jogo já ter terminado
(`abrirPainelInstancia` checa `estadoConstrucao`/`jogoEncerrado`). Fica
mais uma camada na cadeia do Esc, a mais interna de todas (fecha antes até
das Configurações — ver seção abaixo).

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
  if (painelInstancia.classList.contains('aberto')) { fecharPainelInstancia(); return; }
  if (painelConfig.classList.contains('aberto')) { fecharPainelConfig(); return; }
  const haAlgoParaFechar = painelFabricas.classList.contains('aberto') || estadoConstrucao !== null;
  if (haAlgoParaFechar) { fecharPainelFabricas(); abortarColocacao(); return; }
  abrirPainelConfig();
});
```
Ordem de prioridade, do mais "por cima" pro mais "por baixo": painel de
gerenciar construção (`#painel-instancia`) → Configurações → painel de
Fábricas/colocação em andamento → (nada mais aberto) abre Configurações.
Cada Esc só fecha UMA camada, nunca duas de uma vez. Fica desabilitado
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

- **Venda e melhoria por instância** (clicar numa construção do grid) só
  afeta a métrica principal dela (ganho, ou a redução global da Estação de
  Tratamento) — não escala `bonusAdjacencia`/`reducaoPoluicaoAdjacencia`
  (os efeitos que uma construção dá às vizinhas). Foi decisão deliberada
  pra não empilhar upgrade com adjacência de forma difícil de comunicar no
  card/painel, mas é um ponto de rebalanceamento possível se upgrade em
  Usina de Água/Eólica parecer fraco perto de melhorar uma Fábrica.
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
- ~~4 construções novas usavam sprites SVG placeholder~~ — **resolvido**: o
  autor gerou a arte final via IA a partir das descrições de prompt e
  mandou os PNGs, já trocados em `FABRICAS` e commitados; os SVGs foram
  removidos do repositório (ver seção de imagens no topo do arquivo).
- Valores de balanceamento (multiplicadores de dificuldade, `FATOR_MULTA`,
  `FISCALIZACAO_INTERVALO_MS`, `META_CAIXA` = 90000, `LIMIAR_COLAPSO` = 6000,
  custo/ganho/poluição das 6 construções) são ajustados por raciocínio +
  automação de navegador, não por playtesting humano longo — vale jogar de
  verdade pra sentir o ritmo e ajustar se ainda estiver monótono ou rápido
  demais.
- Painel de Configurações (Esc / engrenagem) cobre salvar/menu/sair — não
  tem ainda opções de áudio, idioma, ou dificuldade-em-tempo-real (a
  dificuldade é fixada na criação do save, não muda depois).
