---
name: atualizar-contexto
description: Depois de uma mudança relevante no jogo, atualiza a seção correspondente do CONTEXTO-PROJETO.md
user-invocable: false
---

# Manter o CONTEXTO-PROJETO.md sincronizado

`CONTEXTO-PROJETO.md` é a fonte de verdade do projeto "Parasitas de
Poluição" — é o que qualquer sessão nova (inclusive sessões na nuvem, em
outra máquina, ou depois de meses parado) lê primeiro pra entender o que já
foi construído. Ele só continua útil se for atualizado junto com o código,
não depois, e não só quando o usuário pedir explicitamente.

## Quando agir

Depois de qualquer mudança **relevante** no jogo — uma feature nova, uma
mudança de mecânica/economia, um arquivo novo, uma decisão de design que
teve trade-offs (ex: tamanho do grid, escolha de paleta), um bug corrigido
que valha a pena documentar pra não ser reintroduzido — atualize a seção
correspondente do `CONTEXTO-PROJETO.md` **sem esperar o usuário pedir**.

Não precisa atualizar pra:
- ajustes triviais de estilo/texto que não mudam comportamento;
- experimentos que foram revertidos na mesma tarefa;
- correções de digitação.

## Como agir

1. Releia a seção existente do `CONTEXTO-PROJETO.md` que fala sobre a área
   que você acabou de mexer (ex: "Fase 1", "Painel Novo Jogo", "Fluxo de
   dados entre telas") antes de editar — o documento já tem uma estrutura e
   um tom estabelecidos, mantenha consistência com eles.
2. Edite de forma pontual (a mesma preferência de "não reescrever do zero"
   que vale pro código vale pra esse arquivo) — atualize só o trecho que
   mudou, sem reescrever seções inteiras que continuam corretas.
3. Se a mudança introduziu um bug que foi corrigido e vale a pena que
   sessões futuras não reintroduzam, documente a causa raiz e a correção
   (o documento já tem um precedente disso, na seção sobre o bug de
   `larguraImagem`/NaN na Fase 1).
4. Se a mudança adicionou um arquivo novo, atualize a árvore de arquivos no
   topo do documento.
5. Se ficou alguma coisa pra próxima etapa (ex: uma mecânica ainda não
   implementada), atualize a seção "O que falta / próximos passos".

## Depois de editar

Trate isso como parte natural da tarefa, não como um passo extra a
anunciar — não é necessário dizer "também atualizei o CONTEXTO-PROJETO.md"
como destaque principal da resposta, mas é razoável mencionar de passagem
se o resumo final da tarefa já lista os arquivos alterados.

Se o fluxo do projeto também pedir sincronizar com o GitHub (ver
`CLAUDE.md` na raiz), a atualização deste arquivo entra no mesmo commit da
mudança que a motivou — não em um commit separado.
