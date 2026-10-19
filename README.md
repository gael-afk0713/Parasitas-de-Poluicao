# Parasitas de Poluição

Jogo de navegador em HTML/CSS/JS puro (sem build), publicado no GitHub Pages.

- **Fase 1** — você faz uma empresa crescer num grid isométrico, à custa da
  floresta: lucro e poluição sobem juntos, até a meta ou o colapso.
- **Fase 2: o Guardião** — a empresa caiu; um metroidvania em canvas em que
  você desce pela floresta destruída restaurando o que ela destruiu.

Contas e saves na nuvem com Firebase (Authentication + Firestore).

## Rodar localmente

```bash
python fase2/dev-servidor.py 8771
```

Abra `http://127.0.0.1:8771/index.html` (menu) ou `fase2.html?debug`.

## Para quem vai mexer no código

- [CONTEXTO-PROJETO.md](CONTEXTO-PROJETO.md) — tudo que já foi construído e por quê.
- [DESIGN.md](DESIGN.md) — sistema de design (cores, tipografia, textos, HUDs).
- [fase2/ARQUITETURA.md](fase2/ARQUITETURA.md) — contratos e direção de arte da Fase 2.
- [CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS.md) — regras de trabalho para agentes de código.
- `node fase2/verificar-mapas.mjs` — verifica os mapas da Fase 2.
