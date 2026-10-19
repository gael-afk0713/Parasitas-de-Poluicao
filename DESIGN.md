# DESIGN.md — sistema de design do "Parasitas de Poluição"

Leia antes de mexer em qualquer coisa visual: menu, painéis, HUDs, textos de
interface, arte da Fase 2. O histórico de por que cada coisa é assim mora no
[CONTEXTO-PROJETO.md](CONTEXTO-PROJETO.md); a arquitetura e a direção de arte
detalhada da Fase 2, em [fase2/ARQUITETURA.md](fase2/ARQUITETURA.md). Este
arquivo é a REGRA atual, curta, pra consultar rápido.

Direção escolhida pelo autor (out/2026, com a skill Frontend-Design):
**"estêncil industrial"**.

---

## 1. A ideia em uma frase

O jogo tem dois lados, e o design conta essa história: na **Fase 1 a empresa
fala** (estêncil pintado, âmbar = lucro, números grandes); na **Fase 2 a
empresa caiu** (o estêncil some, sobra a floresta: Archivo leve, verde, folhas).

## 2. Cores (tokens em `:root` de `style.css`)

| token | valor | quando usar |
|---|---|---|
| `--soot` | `#0b0906` | fundo base (fuligem) |
| `--paper` | `#efe8d6` | texto principal, foco de teclado |
| `--paper-dim` | `#9d947f` | texto secundário, rótulos |
| `--amber` | `#d99a35` | **lucro**: CTA principal, dinheiro, seleção |
| `--amber-dim` | `#8a5d1f` | âmbar apagado |
| `--rust` | `#8a4a2f` | ação destrutiva/perigo (fundo, borda) |
| `--rust-claro` | `#d0805e` | ferrugem pra TEXTO e traço (o `--rust` puro não lê no escuro) |
| `--moss-bright` | `#8fbf72` | sucesso/confirmação |
| `--patina` | `#6fae93` | **floresta**: o botão "Fase 2: o Guardião" |
| `--agua` / `--agua-dim` | `#5f97a6` / `#3f7383` | só o sprite/ícone da Usina de Água |

Fase 2 (`:root` de `fase2.css`): `--f2-fundo #070a0c`, `--f2-vivo #7fd8a6`
(acento dos painéis da Fase 2 — troca o âmbar), `--f2-vivo-dim #2f6a5c`,
`--f2-vidro`, `--f2-borda` (botões de toque).

Regras:
- **Cor tem significado, nunca enfeite.** Âmbar é lucro; pátina/verde é
  floresta; ferrugem é perigo. Não use âmbar "porque fica bonito".
- Valor solto repetido vira token em `:root` (foi assim com `--rust-claro`).
- No canvas da Fase 2, contraste vem de um **par fixo** (`PAPEL`/`BREU`, os
  mesmos `--paper`/`--soot`); o tema da sala entra só como matiz/acento.
  Com as cores do tema o HUD ia de 1,17:1 a 10,4:1 conforme a sala.

## 3. Tipografia — duas vozes

- **`--fonte-marca`: Big Shoulders Stencil Display (800/900)** — a empresa
  falando. Só em: título do menu, nome da empresa e números grandes do HUD da
  Fase 1 (caixa, poluição, construções), preços do catálogo "Construir".
  **Nunca na Fase 2.**
- **`--fonte-texto`: Archivo** (variável: largura 62–125, peso 400–800; a
  Fase 2 carrega 300–800). Todo o resto. O tom varia pela largura
  (`font-stretch`) e peso, não por outra fonte:
  - títulos de painel: 800, `font-stretch:112%` ("papel timbrado");
  - itens do menu: 600, 92%;
  - título da abertura da Fase 2 ("O Guardião"): **300, 125%** — leve e
    largo, o avesso do estêncil;
  - texto corrido: 400–500, 100%; números de tabela com
    `font-variant-numeric: tabular-nums`.
- No canvas: `"Archivo", system-ui, sans-serif`; títulos de marco com
  `ctx.fontStretch = 'semi-expanded'` (se o navegador suportar).
- Google Fonts linkado no `<head>`: menu e Fase 1 com Archivo + estêncil,
  Fase 2 só Archivo. Space Grotesk e JetBrains Mono **saíram do projeto**.

## 4. Texto de interface (copy)

- **Caixa normal** sempre ("Novo jogo", "Voltar ao menu"). Nada de rótulo em
  CAIXA ALTA com espaçamento largo, nada de fonte mono pra rótulo pequeno.
- **Sem** `·` juntando metadados (use vírgula ou outra linha), **sem** `→`/`←`
  em botão, **sem** "PALAVRA — fragmento" como rótulo.
- Rótulo acima de título (`.painel-rotulo`) só quando diz algo que o título
  não diz (categoria da construção, "Fase 1 completa"). Se repete o título,
  sai.
- Botão diz o que acontece ("Ir para a Fase 2", "Sair da conta",
  "Construir"); o mesmo nome a ação inteira.
- Fala pro jogador, não pro sistema: "Seu progresso fica salvo na sua conta",
  não "Firebase Authentication".
- Erro diz o que houve e o que fazer; aviso de jogo é curto e concreto
  ("A semente não abre: 3 parasitas ainda respiram na área").
- Subtítulos de aviso na Fase 2 começam em minúscula ("a semente pode ser
  colhida"), como fala, não como manchete.

## 5. Movimento

- Um momento orquestrado por tela, não efeito espalhado. No menu é a
  **passada de spray** do título (`@keyframes borrifar`, máscara de borda
  macia) e só; o resto entra com um fade único.
- Movimento que responde a ação é bem-vindo (folha caindo no golpe, broto
  acendendo no fragmento, painel abrindo).
- Proibido de volta: flash de "power-on", raios girando, grão/scanline,
  flicker, cantos de moldura "HUD", relógio de rodapé, status "online".
- **Movimento reduzido**: todo `@keyframes`/transição novo entra no bloco
  `@media (prefers-reduced-motion: reduce)`. No canvas da Fase 2 a atenuação
  é por JS (`render.movimentoReduzido`, `hud.movimentoReduzido`) e o fim do
  `fase2.css` tem um ÍNDICE comentado de tudo que anima no canvas.

## 6. Telas

### Menu (`index.html`)
Título em estêncil no alto à esquerda ("de Poluição" na cor do lucro), linha
de apoio, menu em coluna: **Novo jogo** (âmbar), **Continuar** (com a linha
"Save 2, Nortec Ind., R$ 48.250" dizendo qual save abre), **Fase 2: o
Guardião** (pátina), Como jogar, Créditos. Rodapé: só a conta (e-mail + Sair).
Foco por teclado = faixa de tinta à esquerda + recuo. Tela baixa
(`max-height:560px`) compacta e deixa o `<main>` rolar; abaixo de 340 px a
linha de apoio some.

### Painéis (`.painel`, compartilhado pelas 3 páginas)
Fundo escuro com blur, conteúdo à esquerda, título Archivo larga 800,
primário âmbar cheio (`.painel-confirmar`), secundário contornado
(`.painel-voltar`) que no hover só clareia. Na Fase 2 o acento vira
`--f2-vivo`. Campos (`.campo input`) valem pra texto, e-mail e senha.

### HUD da Fase 1 — o livro-caixa da empresa
Faixa no topo: **nome da empresa em estêncil** | **Caixa** (número em
estêncil + barra até a meta) | **Poluição** (número + trilho de 0 ao
COLAPSO, com um risco na meta a 75% e o trecho depois dela em ferrugem) |
**Construções**. A cor da poluição sobe com a gravidade (papel → âmbar →
ferrugem clara). Botão de pausa (ícone ❚❚) no canto; "Construir" embaixo
abre um **catálogo em linhas agrupado** (Fábricas/Usinas), não cartões
iguais. Bloco mobile no FIM do `style.css` (especificidade).

### HUD da Fase 2 — o ramo (`fase2/ui/hud.js`)
Não pode lembrar o Hollow Knight (era uma fila de máscaras). É um **galho que
brota da borda** da tela:
- uma **folha por ponto de vida** (alternando em cima/embaixo); dano = a
  folha se solta e cai secando, no quadro do golpe; cura = ela se abre;
  vazio = contorno da folha + toco do pecíolo; fumaça acinzenta as folhas;
- **broto** na ponta enche um quarto por fragmento e vira folha nova no 4º;
- **linha da área** embaixo: "3 parasitas seguram a semente" (contextual) /
  "A semente da área está livre" (fixa até colher);
- avisos em **dois canais**: título no alto (`marco` grita, `normal` fala) e
  sussurro embaixo; prioridade + fila; o relógio do HUD congela na pausa,
  no mapa e na abertura; no toque, barra do chefe e avisos sobem (a base é
  dos polegares); margem segura (notch) respeitada.
Cores fixas do ramo: folha `#a3d483`, nervura `#46723a`, seca `#a27a45`,
sufocada `#6f6a62`, casca `#7d6650`.

## 7. Direção de arte da Fase 2 (resumo)

- **Floresta destruída e poluída**, restaurada aos poucos — não caverna, não
  fábrica. Restaurar deixa o mundo **luminoso**, não claro (floresta viva à
  noite).
- **O Guardião** (inspiração Ori, não cópia): espírito pequeno, pálido,
  luminoso, olhos grandes escuros, orelhas longas pra trás, cauda com
  inércia — e **bicho da floresta, não máscara**: focinho com nariz, tufos na
  bochecha, orelhas em FOLHA deitadas pra trás com nervura que acende com a
  restauração, gola de folhas, pernas de corço com pata clara, folhinha na
  ponta da cauda. Faixa âmbar na cintura é a assinatura (`AMBAR #eaa24f`,
  únicas cores dele que não vêm do tema). O verde das folhas do corpo é o
  mesmo das folhas do HUD.
  **Desde out/2026 ele é sprite** (folha gerada por IA, `fase2/arte/`), com
  o desenho em código só de reserva. No sprite o verde puxa pro amarelo, e
  ficaram SÓ na reserva: nervura acendendo com a restauração, cauda e
  orelhas com mola, piscar, tinta do tema. Arco do golpe, Canto e luz
  seguem em código.
- **Parasitas**: vulto preto encapuzado (inspiração na Sombra do HK),
  tentáculos só da metade de cima. Contraste invertido: herói claro sobre
  escuro, inimigo buraco preto com pontos de luz.
- Forma orgânica afina (espessura constante lê como antena); espaçamento
  regular denuncia arte gerada; contorno claro por dentro + escuro por fora
  lê em qualquer fundo.

## 8. Qualidade mínima (toda tela)

Responsivo até celular (inclusive deitado e baixo), foco de teclado visível,
movimento reduzido respeitado, contraste legível, sem rolagem horizontal.
Antes de dar por pronto: olhe uma captura de verdade (screenshot ou
`/captura/` do `dev-servidor.py`) em desktop e celular.
