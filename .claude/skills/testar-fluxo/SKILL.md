---
name: testar-fluxo
description: Sobe o servidor local e testa o fluxo completo do jogo (menu, Novo Jogo, Fase 1, construção, Fase 2) no navegador, checando o console
---

# Testar o fluxo completo do jogo

Este é o roteiro de teste manual já usado várias vezes no desenvolvimento do
"Parasitas de Poluição" (jogo estático em HTML/CSS/JS, sem build step).
Sempre que uma mudança relevante for feita — em `index.html`, `fase1.html`,
`fase2.html`, `script.js`, `fase1.js`, `style.css`, `fase2.css` ou `fase2/` —
rode esse roteiro antes de dar por encerrada a tarefa. O que conferir no
visual está em `DESIGN.md`.

## 1. Subir o servidor local

Verifique antes se já não há um servidor rodando na porta escolhida
(`netstat -ano | grep ":8000"` no Windows/Git Bash). Se a 8000 já estiver em
uso (é comum o usuário já ter um aberto), use outra porta.

```bash
python fase2/dev-servidor.py 8771
```

Rode em background (o comando não retorna sozinho) — ou, no Claude Code, a
configuração `fase2-dev` do `.claude/launch.json`. Use este servidor e não
`python -m http.server`: o padrão responde 304 pra módulo ES recém-editado e
a Fase 2 roda a versão velha. Os endereços abaixo usam a porta 8771.

## 2. Abrir no navegador

Use a ferramenta de navegador disponível (não pergunte, apenas abra):

- `http://localhost:8771/index.html` — tela de menu
- `http://localhost:8771/fase1.html` — Fase 1 direto (útil pra testar só o
  grid/construção sem passar pelo menu)

**Importante**: o jogo tem um gate de login via Firebase Authentication na
tela de menu. Criar conta ou digitar senha é algo que Claude não deve fazer
(mesmo sendo o próprio app do usuário) — teste até onde der sem autenticar,
e avise o usuário que a parte de login/cadastro precisa ser validada por
ele mesmo.

## 3. Roteiro de navegação

1. **Menu principal** (`index.html`): o gate de login cobre o menu; pra
   inspecionar o menu sem logar, feche `#painel-login` pelo console (só
   inspeção). Confira o título em estêncil, a linha de apoio, o menu
   (Novo jogo, Continuar, Fase 2: o Guardião, Como jogar, Créditos), foco
   por teclado (setas) e os painéis "Como jogar" e "Créditos" (abrir e
   fechar com Voltar e com Esc). Confira também em celular (375×812) e em
   tela baixa (ex.: 828×295: os cinco itens têm que aparecer).
2. **Novo Jogo**: abra o painel, troque entre os 3 slots, preencha nome do
   save/jogador/empresa, teste a validação (tente confirmar vazio — deve
   tremer e mostrar erro), escolha uma dificuldade, e confirme. Isso deve
   salvar no `localStorage` (`parasitas-save-ativo`) e redirecionar pra
   `fase1.html`.
3. **Fase 1** (`fase1.html`): confira se o grid isométrico aparece
   corretamente sobre a imagem de fundo, se o HUD mostra o nome da empresa
   em estêncil, Caixa (com barra até a meta), Poluição (com o trilho até o
   colapso) e Construções, e se o toast de boas-vindas aparece quando vem
   de um save recém-criado. Esc abre "Pausado": com ele aberto o caixa NÃO
   pode mudar.
4. **Testar uma construção**: clique no botão "Construir" (abre o catálogo
   agrupado em Fábricas/Usinas), escolha uma (ex: Usina de Carvão), confirme
   que:
   - o sprite translúcido aparece e segue o cursor, fazendo snap pro
     quadrado mais próximo do grid;
   - clicar com o botão esquerdo trava a posição, ela fica opaca e os
     botões Confirmar/Cancelar aparecem;
   - **Confirmar**: pisca verde, desconta o valor do HUD "Caixa", e a
     célula fica ocupada (tentar construir de novo ali deve ser bloqueado
     ou desabilitado);
   - **Cancelar**: pisca vermelho, o sprite some, nada é descontado.

5. **Fase 2** (`fase2.html?debug`): clique "Descer"; confira o ramo de
   folhas no canto (vida), o broto na ponta e a linha "N parasitas seguram a
   semente". Com o painel do navegador escondido o jogo não anda sozinho:
   emule 1280×720 ANTES de carregar e avance na mão pelo `window.__fase2`
   (`passo(1/120)` ×2 + `quadro(1, 1/60)` por quadro). Fotos do canvas:
   `POST /captura/<nome>.png` com data URL (vão pra `fase2/_capturas/`).
   Mexeu em mapa: `node fase2/verificar-mapas.mjs` tem que sair sem
   PROBLEMA.

## 4. Checar o console

Depois de cada passo acima (ou pelo menos ao final do roteiro), confira o
console do navegador por erros — qualquer `Uncaught`, erro de rede (404 em
algum `.js`/`.css`/imagem) ou aviso do Firebase deve ser investigado antes
de reportar a tarefa como concluída.

## 5. Encerrar

Pare o servidor local ao final do teste (não deixe processos python
zumbis acumulando entre sessões de teste).
