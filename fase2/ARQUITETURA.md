# Fase 2 — Arquitetura e contratos

Leia isto inteiro antes de tocar em qualquer arquivo de `fase2/`.

## O que é

Metroidvania 2D em canvas, na mesma stack do resto do projeto: **HTML/CSS/JS
puro, sem build step, sem npm**. Módulos ES carregados direto pelo navegador.
Referências deliberadas: **Hollow Knight** (estrutura de mapa, combate seco,
silhueta), **Ori and the Blind Forest** (luz, parallax, partículas),
**GRIS** (restauração de cor como progressão, movimento fluido).

Narrativa: o jogador é o ex-CEO da Fase 1. A empresa colapsou; ele desce para
restaurar o que destruiu. Veste o que sobrou do casaco corporativo e tem um
broto na cabeça que floresce conforme o mundo revive.

## Como rodar e testar

```bash
python fase2/dev-servidor.py 8766
```

Depois abra `http://127.0.0.1:8766/fase2.html?debug`. O `?debug` expõe
`window.__fase2 = { mundo, camera, laco, render, entrada, tela, audio }`.

> Use **este** servidor, não `python -m http.server`. O servidor padrão
> responde 304 para um módulo ES recém-editado e o navegador executa a versão
> antiga — o sintoma é um `does not provide an export named X` apontando para
> um export que existe no disco.

### Testar física sem depender de requestAnimationFrame

Em painel de navegador automatizado, `requestAnimationFrame` costuma não
disparar (a aba não pinta). Não conclua que o jogo travou: avance o passo fixo
na mão, que é um teste melhor de qualquer forma — determinístico e sem
flakiness de timing.

```js
const { mundo, entrada } = window.__fase2;
const DT = 1/120;
const passos = (n) => { for (let i=0;i<n;i++){ entrada.atualizar(DT); mundo.atualizar(DT, entrada); } };

entrada._pressionar('direita'); passos(60);   // 0,5 s andando
entrada._soltar('direita');
console.log(mundo.jogador.x, mundo.jogador.estado);
```

Para ver a cena, `computer{action:"screenshot"}` funciona mesmo com o laço
parado — o último quadro desenhado continua no canvas. Para forçar um quadro
novo, chame `window.__fase2.laco.desenhar(1, 1/60)`.

## Regras de trabalho

1. **Edite só os arquivos que lhe couberem.** Vários agentes trabalham no
   mesmo repositório ao mesmo tempo; escrever fora da sua área destrói
   trabalho alheio sem aviso.
2. **Não faça `git commit`, `git push`, `git checkout`, `git stash` nem
   `git reset`.** Quem integra e commita é o orquestrador.
3. **Edição pontual**, nunca reescrever um arquivo inteiro do zero
   (preferência estabelecida do autor, ver `CONTEXTO-PROJETO.md`).
4. **Nenhuma cor literal.** Toda cor vem do tema (ver Paleta abaixo). Um
   `'#3a5f2a'` escrito à mão não participa da restauração e fica morto
   enquanto o resto do mundo revive — que é o efeito que o jogo inteiro
   existe para entregar.
5. **Comente o PORQUÊ, não o quê.** O padrão do projeto é registrar a razão
   de uma decisão e as alternativas descartadas, para ninguém refazer o
   caminho errado depois.
6. Português nos identificadores e comentários, como no resto do projeto.

## Núcleo (NÃO editar — peça ao orquestrador)

`core/mat.js` · `core/entrada.js` · `core/laco.js` · `mundo/terreno.js` ·
`mundo/salas.js` · `mundo/mundo.js` · `render/paleta.js` ·
`render/renderizador.js` · `render/particulas.js` · `entidades/jogador.js` ·
`entidades/catalogo.js` · `main.js` · `fase2.html` · `fase2.css`

## Contratos

### Tema (`render/paleta.js`)

`mundo.tema` é recalculado a cada quadro e interpola entre o tema **poluído**
e o **restaurado** da área, conforme a pureza da sala. Chaves disponíveis:

| chave | uso |
|---|---|
| `ceuTopo`, `ceuBase` | gradiente de fundo |
| `bruma` | névoa atmosférica que come a distância |
| `distante`, `medio`, `proximo` | silhuetas de parallax, do fundo pra frente |
| `terreno`, `terrenoFundo` | massa do chão e o miolo interno |
| `borda` | linha de contorno do terreno |
| `crista` | topo iluminado, musgo, luz de borda |
| `primeiroPlano` | silhuetas na frente do jogador (quase preto) |
| `luz` | a fonte de luz dominante da área |
| `luzAmbiente` | tinta geral |
| `particula` | poeira/esporo |
| `acento` | detalhes vivos (flores, olhos, cristais) |
| `densidadeBruma`, `vinheta`, `saturacao`, `brilhoBloom` | números 0..1 |
| `pureza` | 0 poluído .. 1 restaurado — use para densidade de vida |

Helpers: `corPorProfundidade(tema, cor, d)` aplica perspectiva atmosférica;
`misturarHex(a, b, t)`, `rgba(hex, alfa)`, `ajustarBrilho(hex, f)` em
`core/mat.js`.

### Desenho (`render/renderizador.js`)

```js
render.camada(parallax, (ctx, tema, camera) => { … });   // espaço de mundo
render.camadaTela((ctx, tema, largura, altura) => { … }); // colado na tela
render.emissivo(parallax, (ctx, tema, camera) => { … });  // vira BLOOM
```

O passe **emissivo** desenha num buffer separado que é borrado e somado à
cena com `lighter`. É como se consegue glow que vaza e tinge o ambiente —
não use `ctx.shadowBlur` (é por objeto, caríssimo, e não vaza).

Helpers: `luzRadial(ctx, x, y, raio, cor, intensidade)`,
`feixeLuz(ctx, x, y, comprimento, largura, angulo, cor, intensidade)`,
`caminhoDe(ctx, pontos, fechar)`.

Efeitos globais: `render.piscar(cor, valor)`, `render.sacudirCor(v)`,
`camera.sacudir(v)`, `camera.recuar(dx, dy)`, `laco.congelar(segundos)`.

### Entidades

Toda entidade cumpre este contrato — o mundo não sabe nada além dele, então
inimigo novo entra sem tocar em `mundo/mundo.js`:

```js
atualizar(dt, mundo)              // obrigatório
caixa()                           // { x, y, largura, altura }
desenhar(ctx, tema, camera)       // passe normal
desenharLuz(ctx, tema, camera)    // passe emissivo (opcional)
desenharFundo / desenharFrente    // camadas extras (opcional)
receberDano(n, deX, deY, mundo)
morta      // true → removida no fim do passo
perigoso   // false → não machuca ao encostar
dano       // inteiro, padrão 1
```

Acesso útil dentro de `atualizar`: `mundo.jogador`, `mundo.sala.terreno`,
`mundo.tema`, `mundo.emitir(x, y, n, opcoes)`, `mundo.aoEvento({tipo, …})`,
`mundo.laco.congelar(s)`, `mundo.camera.sacudir(v)`.

### Salas (`mundo/salas.js`)

Mapas em ASCII. Caracteres de terreno: `#` sólido, `=` plataforma (atravessa
por baixo), `^` perigo, `~` água, `.` vazio. Caracteres de objeto estão em
`LEGENDA_OBJETOS` — esse conjunto é **congelado**; precisa de um símbolo
novo, peça ao orquestrador em vez de inventar.

`validarRegistro()` roda na carga e reclama no console de porta sem ligação,
ligação apontando pra sala inexistente e destino sem a porta de chegada.
**Confira o console: um erro de ligação só aparece jogando, quando você cai
numa sala sem saída.**

### Física do jogador (para calibrar salas)

Medido no navegador, não estimado:

| | valor |
|---|---|
| altura do pulo | **99 px ≈ 3,09 tiles** (tile = 32 px) |
| tempo até o ápice | 0,342 s |
| corrida | 232 px/s |
| investida | 560 px/s por 0,17 s ≈ **95 px**, na horizontal, sem gravidade |
| caixa de colisão | 22 × 44 px |

Um vão de **3 tiles** é passável com pulo simples; **4 tiles** exige salto
duplo; **5+** exige investida ou parede. Use isso para trancar progressão.

## Direção de arte — o que o jogo É

**Referências são INSPIRAÇÃO, não gabarito.** Comparar com Hollow Knight
serve para medir o nível de acabamento, nunca para chegar perto do visual
dele. Se algo estiver ficando parecido demais com uma das referências, está
errado pelo mesmo motivo que estaria errado se estivesse tosco.

- **O lugar é uma FLORESTA destruída e poluída, AO AR LIVRE.** Não é caverna,
  não é subterrâneo, não é masmorra. Isto já foi errado duas vezes:
  - primeiro por estalactites no primeiro plano — o plano mais próximo é o
    que mais define o lugar, porque é o mais perto e o mais escuro;
  - depois porque **todas as 30 salas tinham teto fechado** (`####` nos quatro
    lados). Teto fechado é a estrutura de caverna do Hollow Knight; com ele o
    céu nunca aparece e a cena lê como corredor por mais árvore que se
    desenhe. Hoje o parser abre o céu sozinho (ver `abrirCeu` em
    `mundo/salas.js`); `ceuAberto: false` na definição mantém a sala fechada,
    e é só pra interior de verdade.
  - Três testes rápidos: **(a)** o céu aparece e é a coisa mais CLARA da tela;
    **(b)** dá pra ver onde as copas distantes TERMINAM (copa que sai pelo
    topo do quadro fecha a cena de novo); **(c)** há espaço vazio grande — a
    referência é GRIS, personagem pequeno num lugar imenso, não corredor
    cheio.
- **O Guardião é inspirado no Ori**: criatura-espírito pequena, PÁLIDA E
  LUMINOSA, olhos grandes e escuros, duas orelhas longas varridas para trás
  em V, cauda com inércia. Ele é a principal fonte de luz móvel do jogo.
- **Os parasitas são inspirados na Sombra de Hollow Knight**: vulto preto
  encapuzado, fendas brancas no lugar de rosto, tentáculos saindo da metade
  DE CIMA como chama fria, barra do manto esfarrapada dissolvendo em fumaça.
  Tentáculo saindo em 360° lê como aranha — mantenha tudo acima da linha de
  ombro.
- **Paleta sombria, na chave fria** (ver `render/paleta.js`). Restaurar não
  clareia a cena: deixa o mundo LUMINOSO, não iluminado. Floresta viva à
  noite, não floresta de dia.
- **Contraste invertido entre herói e inimigo**: ele é claro sobre escuro,
  eles são buracos pretos com dois pontos de luz. Numa tela escura os dois
  continuam legíveis e nunca se confundem.

### Princípios técnicos

Em ordem de impacto:

1. **Silhueta antes de detalhe.** O primeiro plano é quase preto e
   dessaturado. Se você apertar os olhos e a imagem virar papa, está errado —
   deveria continuar legível como recorte.
2. **Profundidade é quatro coisas juntas**, não só velocidade de parallax:
   camada distante desliza mais devagar **e** perde contraste **e** perde
   saturação **e** é comida pela bruma. Só a velocidade dá o efeito de
   adesivos empilhados.
3. **Uma fonte de luz dominante por área**, e ela é a cor mais saturada da
   tela. Luz espalhada em toda parte lava a imagem.
4. **A vida é rara no estado poluído.** Verde/turquesa é a recompensa. Se
   estiver em todo lugar desde o começo, restaurar não significa nada.
5. **Nada é totalmente estático.** Tudo respira, oscila ou deriva devagar —
   mas com períodos DIFERENTES, senão a cena pulsa junto e parece mecânica.
6. **Movimento vende peso.** Squash/stretch proporcional ao impacto, hitstop
   no acerto, recuo da câmera. Sem isso o controle parece "de papel".
