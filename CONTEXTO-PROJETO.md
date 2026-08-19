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
  usina-carvao.png         sprite isométrico da Usina de Carvão, PNG RGBA transparente, 644x740
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
`background-size:cover`. Como o grid é desenhado por JS (não é parte da
imagem), existe uma função `imagemParaTela(ponto)` que replica exatamente a
matemática do `background-size:cover` (escala = `max(vw/IMG_W, vh/IMG_H)`,
depois centraliza) pra converter qualquer ponto do **espaço da imagem
original** (1024x572) pro **pixel de tela atual**. Isso é usado em tudo:
grid, sprites de fábrica, cálculo de célula sob o cursor. Se a janela for
redimensionada, tudo reflui corretamente porque nada depende de posição
absoluta fixa — só de `window.innerWidth/innerHeight` recalculados.

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
snap pra célula válida mais próxima. `centroCelulaNaTela(col, row)` devolve
o centro de uma célula específica (`pontoNaTela(col+0.5, row+0.5)`).

**HUD** (`.hud-fase1`, topo da tela): três blocos — **Empresa** (vem do save
ativo, ou "—" se abrir a página direto sem passar pelo Novo Jogo),
**Caixa** (dinheiro, formatado em `pt-BR` via `toLocaleString`, começa em
`R$ 50.000`) e **Fábricas** (contador, começa em `1` — a fábrica inicial da
empresa, que hoje é só o número no HUD, **não tem sprite no grid**).

**Toast de boas-vindas:** se existe save ativo no localStorage, mostra
"Bem-vindo(a), {jogador}. A {empresa} está pronta pra crescer." por ~4s ao
carregar a Fase 1.

**Botão "Fábricas"** (fixo embaixo, centro) abre um painel-gaveta
(`.painel-fabricas`, sobe de baixo) com cards de construção. Hoje só existe
um: **Usina de Carvão** (`custo: 8000`, sprite `usina-carvao.png`,
`larguraImagem: TILE_W` — ver seção de bug corrigido abaixo). O card fica
`disabled` automaticamente se o saldo não for suficiente
(`atualizarCartasFabricas()`, chamada sempre que o painel abre).

**Fluxo de construção completo** (estado controlado por `estadoConstrucao`,
objeto global em `fase1.js`):

1. Clicar no card fecha o painel e chama `iniciarColocacao(tipo)`, que cria
   um `<div class="fabrica-instancia fabrica-instancia--fantasma">`
   (`position:fixed`, `pointer-events:none`, `transform:translate(-50%,-100%)`
   — âncora é o **centro-inferior** do sprite) contendo o `<img>` do sprite
   (opacity 0.5 via CSS) mais uma `<div class="fabrica-tinta">` usada só
   pro flash de confirmar/cancelar (ver abaixo).
2. `window.addEventListener('mousemove', ...)` chama
   `reposicionarFantasma(x, y)` a cada movimento, que acha a célula mais
   próxima e reposiciona o wrapper ali (`posicionarInstancia`). Se a célula
   já está ocupada (`celulasOcupadas`, um `Set` de chaves `"col,row"`), o
   sprite fica meio acinzentado (`filter:grayscale(...)`) como aviso.
3. Um listener de `click` no `window` (**só é anexado depois de um
   `setTimeout(…, 0)`**, pra não capturar o mesmo clique que abriu a
   colocação) chama `aoClicarDurantePlacement`: se a célula atual estiver
   ocupada, ignora o clique (não trava); senão, chama `travarColocacao()` —
   sprite fica opaco, aparecem os botões flutuantes **Confirmar**/
   **Cancelar** (reaproveitam as classes `.painel-confirmar`/
   `.painel-voltar` já existentes, mesma paleta do resto do jogo).
4. **Confirmar:** aplica `.fabrica-tinta--sucesso` (pisca `--moss-bright`
   via `mask-image` recortada no formato exato do sprite, não é um
   retângulo), desconta o custo do `dinheiro`, incrementa
   `totalFabricas`, marca a célula em `celulasOcupadas`, guarda a
   instância em `instanciasConstruidas` (array, usado pra reposicionar
   tudo em resize).
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

**Tamanho do sprite:** hoje `larguraImagem: TILE_W` (80, no espaço da
imagem) — ou seja, a fábrica renderiza com a **mesma largura do
quadradinho do grid**, escalando junto com ele em qualquer resolução (usa a
mesma `escalaAtual()` que o resto).

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
- Mais tipos de fábrica além da Usina de Carvão (o painel de construção já
  é genérico via objeto `FABRICAS`, é só adicionar entradas — mas cada uma
  precisa de um sprite isométrico no mesmo ângulo).
- Nenhuma mecânica de dano ambiental, poluição, ou "custo ecológico" ainda
  — o card da usina já tem a frase "alto custo ambiental" mas isso não
  afeta nada no jogo hoje.
- Nenhum evento de colapso da empresa nem a segunda metade do jogo
  ("Guardião da Natureza" / restauração).
- Botão "Continuar" no menu principal existe visualmente mas não tem
  handler de clique ainda (não carrega um save salvo).
- Sem persistência real de save entre sessões do navegador além do
  `localStorage['parasitas-save-ativo']` (que guarda só o save *ativo*, não
  os 3 slots — os 3 slots do painel Novo Jogo vivem só em memória durante
  aquela visita à tela de menu, não sobrevivem a um F5).
