#!/usr/bin/env python3
"""PostToolUse (Edit|Write): lembra de subir o ?v=N quando script.js,
fase1.js ou style.css forem editados, pra evitar cache antigo no navegador."""
import json
import sys
import os

ARQUIVOS_COM_CACHE_BUSTING = ("script.js", "fase1.js", "style.css")

try:
    dados = json.load(sys.stdin)
except Exception:
    sys.exit(0)

tool_input = dados.get("tool_input") or {}
tool_response = dados.get("tool_response") or {}
caminho = tool_input.get("file_path") or tool_response.get("filePath") or ""
nome = os.path.basename(caminho)

if nome in ARQUIVOS_COM_CACHE_BUSTING:
    mensagem = (
        "Lembrete: voce editou " + nome + " - confira se precisa subir o "
        "numero de versao (?v=N) dele em index.html/fase1.html, senao o "
        "navegador pode servir a versao antiga em cache."
    )
    print(json.dumps({"systemMessage": mensagem}))
