# Colosseum Game

> **Note:** Reupload from a Nov 2023 project.

A two-player zero-sum territory strategy game featuring an interactive HTML5 `<canvas>` arena UI and a Python AI backend.

## Game Rules

- **Board & Starting Positions:**
  - Two players compete on a rectangular grid (default **5 × 10**, customizable from **2 × 2** up to **50 × 50**).
  - Players begin at centered positions on opposite sides of the arena (e.g., `(R3, C1)` and `(R3, C10)` on a `5 × 10` board) and alternate turns.
  - The outer perimeter of the board acts as a solid boundary from the start.
- **Movement (`Up` / `Down` / `Left` / `Right` / `Stay`):**
  - On each turn, the active player moves up to **1 orthogonal step** (`Up`, `Down`, `Left`, or `Right`) or chooses to **Stay** on their current square.
  - Players **cannot** cross existing walls, exit the board, or move onto the square currently occupied by the other player.
- **Mandatory Wall Placement:**
  - Every turn, after selecting their destination square (including when staying in place), the player **must** place **one permanent thin wall** along one of the open interior borders (`North`, `East`, `South`, or `West`) of that square.
  - Walls cannot be placed on top of existing walls or along the outer perimeter of the board.
- **Move Confirmation & No Undo:**
  - Both the destination square and wall border are selected directly on the board and previewed before taking effect.
  - Every move requires explicit confirmation (**Confirm & Lock Move**). Once confirmed, moves and walls are permanent—there is **no undo**.
- **Objective, End Condition & Scoring:**
  - The game ends immediately as soon as placed walls **completely separate** the two players so that no wall-free path exists between them.
  - Each player's score is the total number of squares reachable from their position without crossing walls (their enclosed territory).
  - The player with strictly **more space** on their side wins; equal territory counts result in a draw.

## Running Locally (Hot-Reload Python Server)

Requires Python 3.8+ (uses standard library only—no external packages needed):

```bash
python3 server.py
```

Open `http://localhost:8000` in your browser (or set `PORT=3000 python3 server.py` for a custom port). When running via `server.py`, edits to `ai.py` hot-reload automatically on every move.

## Hosting on GitHub Pages (Zero Backend Required)

This repository works directly on **GitHub Pages** out of the box—while still running your real Python `engine.py` and `ai.py` code:

1. Push this repository to GitHub (branch `main`).
2. In your GitHub repository, open **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**, select **`main`** and **`/ (root)`**, and click **Save**.

When hosted statically on GitHub Pages (where `server.py` is not running), `app.js` automatically detects static mode and boots **`pyodide-worker.js`** (Python 3 compiled to WebAssembly in a background Web Worker), loading `engine.py` and `ai.py` directly in the browser.

## Building Your Own Python AI

Edit `custom_ai(state)` in `ai.py`:
- **Locally (`python3 server.py`):** `server.py` hot-reloads `ai.py` whenever it changes on disk, so you can test new heuristics or search algorithms live without restarting.
- **On GitHub Pages:** Any committed updates to `ai.py` (including pure-Python packages or Pyodide-supported packages like `numpy`) are automatically fetched and executed in the browser Web Worker.

## Project Structure

- `index.html` / `styles.css` — Layout and travertine-inspired UI styling
- `app.js` — Interactive HiDPI `<canvas>` board, pan/zoom camera, pre-move confirmation workflow, and Python runtime switcher
- `engine.js` — Client-side bitmask wall grid and BFS separation/territory logic
- `engine.py` — Pure Python `GameState` and `Action` engine for AI search and validation
- `ai.py` — Placeholder `random_move_ai` and `custom_ai` entry point
- `server.py` — Local Python HTTP server with `ai.py` hot-reloading (`/api/ai-move`)
- `pyodide-worker.js` — In-browser Python WebAssembly worker fallback for static GitHub Pages hosting
- `.nojekyll` — Ensures GitHub Pages serves all static files without Jekyll filtering
