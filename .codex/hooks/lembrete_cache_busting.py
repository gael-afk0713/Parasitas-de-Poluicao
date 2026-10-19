#!/usr/bin/env python3
"""PostToolUse (Edit|Write): lembra de subir o ?v=N quando um arquivo com
cache-busting for editado, pra evitar cache antigo no navegador."""
import json
import sys
import os

# arquivo -> HTMLs que o carregam com ?v=N (style.css: MESMO numero nos tres)
ARQUIVOS_COM_CACHE_BUSTING = {
    "style.css": "index.html, fase1.html e fase2.html (mesmo numero nos tres)",
    "script.js": "index.html",
    "fase1.js": "fase1.html",
    "fase2.css": "fase2.html",
    "main.js": "fase2.html (fase2/main.js)",
}

try:
    dados = json.load(sys.stdin)
except Exception:
    sys.exit(0)

tool_input = dados.get("tool_input") or {}
tool_response = dados.get("tool_response") or {}
caminho = tool_input.get("file_path") or tool_response.get("filePath") or ""
nome = os.path.basename(caminho)

eh_main_fase2 = nome == "main.js" and "fase2" in caminho.replace("\\", "/")
if nome in ARQUIVOS_COM_CACHE_BUSTING and (nome != "main.js" or eh_main_fase2):
    mensagem = (
        "Lembrete: voce editou " + nome + " - suba o numero de versao (?v=N) "
        "dele em " + ARQUIVOS_COM_CACHE_BUSTING[nome] + ", senao o navegador "
        "pode servir a versao antiga em cache."
    )
    print(json.dumps({"systemMessage": mensagem}))
elif "/fase2/" in caminho.replace("\\", "/") and nome.endswith(".js"):
    mensagem = (
        "Lembrete: " + nome + " e modulo da Fase 2 sem ?v proprio - suba o "
        "?v=N de fase2/main.js em fase2.html, e chame funcao NOVA de outro "
        "modulo com ?. (modulo velho pode vir do cache por ~10 min)."
    )
    print(json.dumps({"systemMessage": mensagem}))
