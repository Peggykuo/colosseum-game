"""
The Colosseum Game — Python HTTP & AI Server (`server.py`)

Serves the interactive web UI and executes Python AI moves via `POST /api/ai-move`.
Automatically hot-reloads `ai.py` whenever it is modified on disk so you can iterate
on your Python AI live without restarting the server.
"""

from __future__ import annotations

import importlib
import json
import os
import sys
import traceback
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

import ai  # noqa: E402
from engine import Action, GameState  # noqa: E402

AI_FILE = BASE_DIR / "ai.py"
_last_ai_mtime: float = AI_FILE.stat().st_mtime if AI_FILE.exists() else 0.0


def get_fresh_ai_module():
    """Hot-reloads `ai.py` if its file modification timestamp changed."""
    global _last_ai_mtime
    try:
        mtime = AI_FILE.stat().st_mtime
        if mtime != _last_ai_mtime:
            importlib.reload(ai)
            _last_ai_mtime = mtime
    except OSError:
        pass
    return ai


class ColosseumRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def log_message(self, format: str, *args) -> None:
        # Keep logs concise
        sys.stdout.write("[Colosseum] " + (format % args) + "\n")
        sys.stdout.flush()

    def _send_json(self, status: int, payload: dict) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        if self.path == "/api/health":
            self._send_json(
                HTTPStatus.OK,
                {"status": "ok", "aiFile": str(AI_FILE.name)},
            )
            return
        super().do_GET()

    def do_POST(self) -> None:
        if self.path != "/api/ai-move":
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Unknown endpoint"})
            return

        try:
            content_len = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(content_len).decode("utf-8")
            payload = json.loads(body)

            state = GameState.from_dict(payload["state"])
            if state.game_over:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Game is already over."})
                return

            agent_type = str(payload.get("agentType", "random"))
            ai_mod = get_fresh_ai_module()
            chosen = ai_mod.choose_move(state.clone(), agent_type=agent_type)

            # Accept either an `Action` instance or a dict/tuple from user's future custom AI
            if isinstance(chosen, dict):
                chosen = Action(
                    row=int(chosen["row"]),
                    col=int(chosen["col"]),
                    wall_dir=str(chosen.get("wall_dir") or chosen.get("wallDir")),
                    move_dir=chosen.get("move_dir") or chosen.get("moveDir"),
                )
            elif isinstance(chosen, (tuple, list)) and len(chosen) >= 3:
                chosen = Action(
                    row=int(chosen[0]),
                    col=int(chosen[1]),
                    wall_dir=str(chosen[2]),
                    move_dir=str(chosen[3]) if len(chosen) > 3 else None,
                )

            if not isinstance(chosen, Action) or not state.is_valid_action(chosen):
                raise ValueError(f"AI returned an illegal action: {chosen!r}")

            move_dir = chosen.move_dir or state.infer_move_dir(
                state.players[state.current_player], chosen.row, chosen.col
            )
            result = Action(
                row=chosen.row,
                col=chosen.col,
                wall_dir=chosen.wall_dir,
                move_dir=move_dir,
            )
            self._send_json(
                HTTPStatus.OK,
                {
                    "action": result.to_dict(),
                    "agentType": agent_type,
                },
            )
        except Exception as exc:
            traceback.print_exc()
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": str(exc)},
            )


def run_server(host: str = "0.0.0.0", port: int = 8000) -> None:
    server = ThreadingHTTPServer((host, port), ColosseumRequestHandler)
    print(f"Colosseum Game Python Server listening on http://localhost:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    port_arg = int(os.environ.get("PORT", "8000"))
    run_server(host="0.0.0.0", port=port_arg)
