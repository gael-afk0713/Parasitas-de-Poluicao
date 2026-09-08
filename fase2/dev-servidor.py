#!/usr/bin/env python3
"""
Servidor local de desenvolvimento da Fase 2.

Por que não `python -m http.server`: o navegador guarda módulos ES em cache
por URL, e o servidor padrão responde 304 pra arquivo remendado no mesmo
segundo. Na prática, você edita `fase2/core/mat.js`, recarrega e o navegador
executa a versão ANTIGA — o sintoma é um `does not provide an export named X`
apontando pra um export que existe no disco. Este servidor manda `no-store`
em tudo, então recarregar sempre traz o arquivo do disco.

Uso:
    python fase2/dev-servidor.py [porta]

Só para desenvolvimento. O jogo publicado (GitHub Pages) usa o
cache-busting `?v=N` dos HTMLs, como o resto do projeto.
"""

import sys
import os
import base64
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAPTURAS = os.path.join(RAIZ, "fase2", "_capturas")


class SemCache(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=RAIZ, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_response(self, code, message=None):
        # Nunca responder 304: é exatamente o que devolve o módulo velho.
        if code == 304:
            code = 200
        super().send_response(code, message)

    def do_POST(self):
        """POST /captura/<nome>.png com o corpo em data URL grava um PNG.

        Existe para a revisao visual: o quadro composto (cena + HUD) sai do
        canvas e vira arquivo no disco, que pode ser aberto e comparado sem
        passar por lugar nenhum. So roda no servidor de desenvolvimento.
        """
        if not self.path.startswith("/captura/"):
            self.send_error(404)
            return
        nome = re.sub(r"[^A-Za-z0-9_.-]", "", self.path[len("/captura/"):]) or "captura.png"
        tam = int(self.headers.get("Content-Length", 0))
        corpo = self.rfile.read(tam).decode("utf-8", "replace")
        corpo = corpo.split(",", 1)[-1]
        os.makedirs(CAPTURAS, exist_ok=True)
        with open(os.path.join(CAPTURAS, nome), "wb") as f:
            f.write(base64.b64decode(corpo))
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, fmt, *args):
        # Só erros. O log de cada .js torra o terminal a cada recarga.
        if args and str(args[1]).startswith(("4", "5")):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main():
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    servidor = ThreadingHTTPServer(("127.0.0.1", porta), SemCache)
    print(f"Fase 2 em http://127.0.0.1:{porta}/fase2.html")
    print(f"Servindo {RAIZ} (sem cache). Ctrl+C para parar.")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nparado")


if __name__ == "__main__":
    main()
