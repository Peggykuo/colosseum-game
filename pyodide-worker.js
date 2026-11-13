/**
 * The Colosseum Game — Pyodide (Python-in-WebAssembly) Web Worker
 *
 * Enables 100% static hosting (e.g. GitHub Pages) while executing the exact
 * same `world.py`, `agents/` (`student_agent.py`, `random_agent.py`), `engine.py`,
 * and `ai.py` Python codebase directly inside the browser.
 */
/* global importScripts */
'use strict';

const PYODIDE_BASE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';

let initPromise = null;
let runPythonAICallable = null;

const PYTHON_FILES = [
  'constants.py',
  'store.py',
  'utils.py',
  'world.py',
  'agents/__init__.py',
  'agents/agent.py',
  'agents/human_agent.py',
  'agents/student_agent.py',
  'engine.py',
  'ai.py',
];

const PYTHON_BOOTSTRAP = `
import json
import sys

if "." not in sys.path:
    sys.path.insert(0, ".")

import ai
from engine import Action, GameState


def _colosseum_choose_move(payload_json: str) -> str:
    payload = json.loads(payload_json)
    state = GameState.from_dict(payload["state"])
    if state.game_over:
        raise ValueError("Game is already over.")

    agent_type = str(payload.get("agentType", "custom"))
    chosen = ai.choose_move(state.clone(), agent_type=agent_type)

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
    return json.dumps({
        "action": result.to_dict(),
        "agentType": agent_type,
    })
`;

async function fetchPythonSource(relPath) {
  const url = new URL(relPath, self.location.href);
  const res = await fetch(url.toString(), { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${relPath} (HTTP ${res.status})`);
  }
  return res.text();
}

function ensurePyodideReady() {
  if (!initPromise) {
    initPromise = (async () => {
      if (typeof self.loadPyodide !== 'function') {
        importScripts(PYODIDE_BASE + 'pyodide.js');
      }

      const [pyodide, ...sources] = await Promise.all([
        self.loadPyodide({ indexURL: PYODIDE_BASE }),
        ...PYTHON_FILES.map((relPath) => fetchPythonSource('./' + relPath)),
      ]);

      try {
        pyodide.FS.mkdir('agents');
      } catch (_) {
        // Directory already exists
      }

      for (let i = 0; i < PYTHON_FILES.length; i++) {
        pyodide.FS.writeFile(PYTHON_FILES[i], sources[i], { encoding: 'utf8' });
      }

      await pyodide.loadPackage('numpy');
      await pyodide.runPythonAsync(PYTHON_BOOTSTRAP);
      runPythonAICallable = pyodide.globals.get('_colosseum_choose_move');
      return pyodide;
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  const { id, type, payload } = msg;

  try {
    await ensurePyodideReady();

    if (type === 'init') {
      self.postMessage({ id, ok: true, status: 'ready' });
      return;
    }

    if (type === 'ai-move') {
      const resultJson = runPythonAICallable(JSON.stringify(payload));
      const data = JSON.parse(resultJson);
      self.postMessage({ id, ok: true, data });
      return;
    }

    throw new Error(`Unknown worker message type: ${String(type)}`);
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
  }
};
