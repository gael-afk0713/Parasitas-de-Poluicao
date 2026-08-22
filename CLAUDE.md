# Instruções pro Claude Code neste projeto

Leia **[CONTEXTO-PROJETO.md](CONTEXTO-PROJETO.md)** inteiro antes de mexer em
qualquer coisa — tem o contexto completo do jogo, o que já foi construído,
como foi implementado e as preferências de trabalho do autor.

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
- Reaproveitar a paleta de cores e tipografia já definidas em `style.css`.
- Perguntar antes de decisões de design ambíguas, em vez de assumir.
- Atualizar o bloco `@media (prefers-reduced-motion: reduce)` sempre que
  uma animação nova for adicionada.
- `style.css`, `script.js` e `fase1.js` são carregados com `?v=N` no
  `<script>`/`<link>` de `index.html` e `fase1.html`, pra evitar que o
  navegador sirva uma versão em cache depois de um deploy (sem isso, uma
  correção publicada pode parecer "não aplicada" só por causa de cache).
  **Sempre que editar um desses três arquivos, incrementar o `?v=N`
  correspondente nos HTMLs que o carregam** (mesmo número pros dois, se
  os dois `<script>`/`<link>` daquele arquivo existirem em ambos os
  HTMLs).
