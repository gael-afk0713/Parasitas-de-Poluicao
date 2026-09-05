---
name: testar-fluxo
description: Sobe o servidor local e testa o fluxo completo do jogo (menu, Novo Jogo, Fase 1, construção) no navegador, checando o console
---

# Testar o fluxo completo do jogo

Este é o roteiro de teste manual já usado várias vezes no desenvolvimento do
"Parasitas de Poluição" (jogo estático em HTML/CSS/JS, sem build step).
Sempre que uma mudança relevante for feita — em `index.html`, `fase1.html`,
`script.js`, `fase1.js` ou `style.css` — rode esse roteiro antes de dar por
encerrada a tarefa.

## 1. Subir o servidor local

Verifique antes se já não há um servidor rodando na porta escolhida
(`netstat -ano | grep ":8000"` no Windows/Git Bash). Se a 8000 já estiver em
uso (é comum o usuário já ter um aberto), use outra porta.

```bash
cd "caminho/do/projeto"
python -m http.server 8000
```

Rode em background (o comando não retorna sozinho).

## 2. Abrir no navegador

Use a ferramenta de navegador disponível (não pergunte, apenas abra):

- `http://localhost:8000/index.html` — tela de menu
- `http://localhost:8000/fase1.html` — Fase 1 direto (útil pra testar só o
  grid/construção sem passar pelo menu)

**Importante**: o jogo tem um gate de login via Firebase Authentication na
tela de menu. Criar conta ou digitar senha é algo que Claude não deve fazer
(mesmo sendo o próprio app do usuário) — teste até onde der sem autenticar,
e avise o usuário que a parte de login/cadastro precisa ser validada por
ele mesmo.

## 3. Roteiro de navegação

1. **Menu principal** (`index.html`): confira se o título, animações de
   entrada e o HUD (relógio, moldura, status "Sistema Corporativo Online")
   carregam sem erro. Teste os painéis "Como Jogar" e "Créditos" (abrir e
   fechar com o botão Voltar e com Esc).
2. **Novo Jogo**: abra o painel, troque entre os 3 slots, preencha nome do
   save/jogador/empresa, teste a validação (tente confirmar vazio — deve
   tremer e mostrar erro), escolha uma dificuldade, e confirme. Isso deve
   salvar no `localStorage` (`parasitas-save-ativo`) e redirecionar pra
   `fase1.html`.
3. **Fase 1** (`fase1.html`): confira se o grid isométrico aparece
   corretamente sobre a imagem de fundo, se o HUD mostra Empresa/Caixa/
   Fábricas/Poluição, e se o toast de boas-vindas aparece quando vem de um
   save recém-criado.
4. **Testar uma construção**: clique no botão "Fábricas" (abre o painel de
   construção), escolha uma fábrica (ex: Usina de Carvão), confirme que:
   - o sprite translúcido aparece e segue o cursor, fazendo snap pro
     quadrado mais próximo do grid;
   - clicar com o botão esquerdo trava a posição, ela fica opaca e os
     botões Confirmar/Cancelar aparecem;
   - **Confirmar**: pisca verde, desconta o valor do HUD "Caixa", e a
     célula fica ocupada (tentar construir de novo ali deve ser bloqueado
     ou desabilitado);
   - **Cancelar**: pisca vermelho, o sprite some, nada é descontado.

## 4. Checar o console

Depois de cada passo acima (ou pelo menos ao final do roteiro), confira o
console do navegador por erros — qualquer `Uncaught`, erro de rede (404 em
algum `.js`/`.css`/imagem) ou aviso do Firebase deve ser investigado antes
de reportar a tarefa como concluída.

## 5. Encerrar

Pare o servidor local ao final do teste (não deixe processos python
zumbis acumulando entre sessões de teste).
