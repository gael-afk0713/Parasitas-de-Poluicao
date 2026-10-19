#!/usr/bin/env python3
"""PreToolUse (Edit|Write): pede confirmacao extra antes de editar
firestore.rules, ja que esse arquivo controla a seguranca dos dados reais
de usuario (login/senha, saves)."""
import json
import sys

try:
    dados = json.load(sys.stdin)
except Exception:
    sys.exit(0)

caminho = (dados.get("tool_input") or {}).get("file_path") or ""

if caminho.endswith("firestore.rules"):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": (
                "firestore.rules controla a seguranca dos dados reais de "
                "usuario (login/senha, saves) - confirme que essa mudanca "
                "foi revisada com cuidado antes de aplicar."
            ),
        }
    }))
