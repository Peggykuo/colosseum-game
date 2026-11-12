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

## Running Locally

Requires Python 3.8+ (uses standard library only—no external packages needed):

```bash
python3 server.py
```

Open `http://localhost:8000` in your browser (or set `PORT=3000 python3 server.py` for a custom port).

## Building Your Own Python AI

Edit `custom_ai(state)` in `ai.py`. `server.py` automatically hot-reloads `ai.py` whenever it changes on disk, so you can test new heuristics or search algorithms live without restarting the server.

## Project Structure

- `index.html` / `styles.css` — Layout and travertine-inspired UI styling
- `app.js` — Interactive HiDPI `<canvas>` board, pan/zoom camera, and pre-move confirmation workflow
- `engine.js` — Client-side bitmask wall grid and BFS separation/territory logic
- `engine.py` — Pure Python `GameState` and `Action` engine for AI search and server validation
- `ai.py` — Placeholder `random_move_ai` and `custom_ai` entry point
- `server.py` — Lightweight Python HTTP server and `/api/ai-move` JSON endpoint
