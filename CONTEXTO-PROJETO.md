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
```

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
- Painel **Novo Jogo**:
  - 3 slots de save guardados **em memória** (objeto `saves` em `script.js`,
    não em localStorage) enquanto o jogador está nessa tela — trocar de slot
    troca os campos exibidos.
  - Campos: nome do save, nome do jogador, nome da empresa, dificuldade
    (Iniciante/Médio/Expert).
  - Validação com "tremor" visual se faltar campo.
  - Ao clicar **Começar** com os campos válidos: salva
    `{slot, nomeSave, jogador, empresa, dificuldade}` no
    `localStorage['parasitas-save-ativo']` e redireciona (após ~900ms, pra
    dar tempo de ver a mensagem de sucesso) pra `fase1.html`.
- Todos os painéis compartilham o padrão `.painel` / `.painel-conteudo` /
  `.painel-voltar` — abrir/fechar via classe `.aberto`, Escape fecha.
- Há um bloco `@media (prefers-reduced-motion: reduce)` que desliga as
  animações decorativas — **sempre atualizar esse bloco ao adicionar uma
  animação nova**, é convenção já estabelecida no projeto.

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

**Valores atuais** (ajustar aqui se rebalancear):

| Construção | categoria | pegada | custo base | ganho/tick | poluição/tick | bônus adjacência |
|---|---|---|---|---|---|---|
| Usina de Carvão | Fábrica | 2x1 | R$ 4.500 | R$ 225 | 15 | — |
| Usina de Água | Usina | 1x1 | R$ 3.000 | R$ 100 | 2 | +20%/vizinha (teto 60%) |

Caixa inicial do jogador: R$ 5.000. Filosofia: a primeira construção deve
consumir a maior parte do caixa inicial (decisão pesada) mas se pagar em
~1 minuto de jogo (não travar o ritmo).

## Fluxo de dados entre telas

Única ponte entre `index.html` e `fase1.html`: `localStorage`, chave
**`parasitas-save-ativo`**, formato:

```json
{ "slot": 1, "nomeSave": "...", "jogador": "...", "empresa": "...", "dificuldade": "Iniciante" }
```

Escrito por `script.js` (painel Novo Jogo) ao confirmar; lido por
`fase1.js` (`lerSaveAtivo()` / `aplicarSaveAtivo()`) ao carregar a Fase 1.
Se não existir (ex: abrir `fase1.html` direto), a página cai em valores
padrão sem quebrar.

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
- Mais construções além de Usina de Carvão e Usina de Água — o painel já é
  100% genérico via `FABRICAS` (cards renderizados dinamicamente, escala de
  preço e bônus de adjacência já genéricos), é só adicionar entrada nova +
  sprite (`.png` ou `.svg`, o pipeline aceita os dois).
- Rotação de pegada (2x1 ↔ 1x2) já existiu e foi removida a pedido do
  usuário — a infraestrutura de pegada multi-célula continua, reintroduzir
  é reversível (ver seção "Rotação" acima).
- **Poluição** agora existe e acumula de verdade (`poluicaoTotal`, HUD com
  severidade de cor, toast único ao cruzar o limiar crítico), mas ainda é
  só atmosférico — não afeta nada mecanicamente (não reduz ganho, não
  aproxima o colapso da empresa de verdade). Esse é o próximo elo natural
  pra puxar a narrativa: ligar `poluicaoTotal` a algum evento de colapso.
- Nenhum evento de colapso da empresa nem a segunda metade do jogo
  ("Guardião da Natureza" / restauração) — só a pincelada narrativa do
  toast de poluição crítica, sem gameplay real de fase 2.
- Botão "Continuar" no menu principal existe visualmente mas não tem
  handler de clique ainda (não carrega um save salvo).
- Sem persistência real de save entre sessões do navegador além do
  `localStorage['parasitas-save-ativo']` (que guarda só o save *ativo*, não
  os 3 slots — os 3 slots do painel Novo Jogo vivem só em memória durante
  aquela visita à tela de menu, não sobrevivem a um F5).
- Gerador de imagem IA ficou sem crédito durante essa sessão — a Usina de
  Água usa um SVG desenhado à mão em vez de um PNG gerado (ver seção de
  imagens no topo do arquivo). Se quiser trocar por um PNG no estilo do
  carvão mais pra frente, é só gerar e trocar o campo `sprite`.
