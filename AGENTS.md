# Instruções pro Codex neste projeto

Leia **[CONTEXTO-PROJETO.md](CONTEXTO-PROJETO.md)** inteiro antes de mexer em
qualquer coisa — tem o contexto completo do jogo, o que já foi construído,
como foi implementado e as preferências de trabalho do autor.

Antes de mexer em qualquer coisa VISUAL (menu, painéis, HUDs, textos de
interface, arte da Fase 2), leia também **[DESIGN.md](DESIGN.md)** — o
sistema de design do jogo (identidade "estêncil industrial", tokens, regras
de texto, HUDs). Na Fase 2, **[fase2/ARQUITETURA.md](fase2/ARQUITETURA.md)**
tem os contratos do código e a direção de arte.

O jogo é HTML/CSS/JS puro, sem build: menu (`index.html` + `script.js`),
Fase 1 isométrica (`fase1.html` + `fase1.js`), Fase 2 metroidvania em canvas
(`fase2.html` + `fase2.css` + módulos ES em `fase2/`). Publicado no GitHub
Pages a partir de `origin/main`. Contas e saves no Firebase.

## Regra fixa: manter a pasta local e o GitHub sempre sincronizados

A partir de quando essa regra foi definida: **toda vez que o usuário pedir
uma mudança**, depois de editar os arquivos locais e testar, faça também o
commit e o push pro repositório remoto (`origin/main`) — sem precisar
perguntar de novo a cada pedido, isso já está autorizado.

Fluxo esperado a cada pedido:
1. Editar os arquivos locais de forma pontual (ver preferência abaixo).
2. Testar no navegador (servidor local, checar console).
3. `git add` só dos arquivos relevantes à mudança, `git commit` com mensagem
   curta e clara descrevendo o que mudou, `git push`.

Se o `git push` pedir autenticação, o Git Credential Manager (já vem com o
Git for Windows) abre uma janela de login no navegador — isso é esperado,
não é um erro.

Exceção: se uma mudança for grande/arriscada o suficiente pra merecer
confirmação antes de subir (ex: mudança estrutural grande, algo destrutivo),
ainda vale confirmar antes — a autorização acima é pro fluxo normal do dia a
dia, não uma licença geral pra ações irreversíveis sem aviso.

## Outras preferências já estabelecidas (detalhadas no CONTEXTO-PROJETO.md)

- Editar arquivos existentes de forma pontual, nunca reescrever do zero.
  Pra substituições de várias linhas, um script Python curto (ler, `assert`
  que o trecho antigo existe UMA vez, trocar, gravar com `newline=''`) é mais
  seguro que `sed`.
- Seguir o [DESIGN.md](DESIGN.md): reaproveitar os tokens de `:root` em
  `style.css` (cores e `--fonte-marca`/`--fonte-texto`) em vez de valores
  soltos; texto de interface em caixa normal, sem rótulo em caixa alta com
  espaçamento largo, sem fonte mono, sem `·` juntando metadados, sem seta em
  botão.
- Perguntar antes de decisões de design ambíguas, em vez de assumir (inclui
  mudar mapa/level design da Fase 2: aponte o achado e pergunte).
- Atualizar o bloco `@media (prefers-reduced-motion: reduce)` sempre que
  uma animação nova for adicionada. Na Fase 2 o canvas é atenuado por JS
  (`movimentoReduzido` em `render`/`hud`), e o fim do `fase2.css` mantém um
  ÍNDICE comentado de tudo que anima no canvas — atualize-o também.
- Depois de mudança relevante, atualizar a seção correspondente do
  `CONTEXTO-PROJETO.md` (skill `atualizar-contexto`), no mesmo commit.

## Cache-busting (`?v=N`) — vale pros três HTMLs

- `style.css` é carregado por `index.html`, `fase1.html` E `fase2.html`:
  **ao editá-lo, subir o `?v=N` nos três, sempre com o mesmo número.**
- `script.js` (só `index.html`), `fase1.js` (só `fase1.html`), `fase2.css` e
  `fase2/main.js` (só `fase2.html`): subir o `?v=N` correspondente.
- Os OUTROS módulos da Fase 2 (`fase2/ui/hud.js`, `fase2/entidades/*`...)
  são importados sem `?v`, e o GitHub Pages guarda cache por ~10 min: logo
  depois de um deploy o navegador pode misturar módulo novo com velho. Ao
  chamar uma função NOVA de outro módulo, use chamada opcional
  (`hud.mostrarArea?.(5)`, `terreno.apoiadoEmPlataforma?.(...)`) pra a
  mistura não quebrar o jogo. (Solução definitiva pendente: import map.)

## Como testar

- **Servidor**: `python fase2/dev-servidor.py 8771` (configuração
  `fase2-dev` em `.claude/launch.json`, no Claude Code). Use esse, não `python -m
  http.server`: ele nunca responde 304 (módulo ES editado não vem velho) e
  aceita `POST /captura/<nome>.png` com um data URL, gravando em
  `fase2/_capturas/` (fora do git) — é como se tira foto do canvas.
- **Fase 2**: `fase2.html?debug` expõe `window.__fase2` (`mundo`, `camera`,
  `hud`, `passo`, `quadro`...). Com o painel do navegador ESCONDIDO o
  `requestAnimationFrame` não roda e o viewport pode ser 0×0: emule um
  tamanho (1280×720) ANTES de carregar a página e avance o jogo na mão
  (`F.passo(1/120)` duas vezes + `F.quadro(1, 1/60)` por quadro). Lotes
  longos no navegador estouram o tempo da ferramenta: no máximo ~5 salas
  por chamada, uma chamada por vez.
- O navegador do painel costuma estar com **movimento reduzido ligado** —
  animações de CSS/HUD aparecem no estado final. Pra ver o caminho animado,
  force `hud.movimentoReduzido = false` no `?debug`.
- **Login**: não criar conta nem digitar senha no jogo (é Firebase de
  verdade); feche o gate pelo DOM só pra inspeção visual e avise o usuário
  que o login em si ele testa.
- **Mapas da Fase 2**: sempre `node fase2/verificar-mapas.mjs` depois de
  mexer num mapa (inclui a checagem de "espaço do corpo" dentro da sala).
  Pra perguntas de alcance que dependem de altura de pulo, simule a física
  real do `Jogador` — e lembre: soltar o botão de pulo no quadro errado
  corta o pulo duplo, e espinho precisa MATAR a tentativa (simular
  invulnerável anda por cima de poço de espinho).
- **Sintaxe** sem navegador: `node --input-type=module --check < arquivo.js`.

## Revisão antes de subir

Mudança grande (várias telas, lógica de jogo, economia, save): rode o
agente `code-reviewer` (`.codex/agents/`) no diff antes do push e corrija o que ele
confirmar. Mexeu em `firestore.rules`, `firebase-config.js` ou no fluxo de
login/senha do `script.js`: `security-reviewer`. Mexeu em
algo visual (CSS, HTMLs, textos de interface, HUDs): `design-reviewer`, que
confere o diff contra o DESIGN.md. `firestore.rules` tem hook
que pede confirmação — ele controla a segurança de dados reais de usuário.

## Mensagens de commit

Curtas, em português, dizendo o que mudou e por quê (o histórico é lido por
quem continua o trabalho). Terminam com a linha de coautoria pedida pelo
ambiente.
