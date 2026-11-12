# Colosseum Game

A two-player zero-sum territory strategy game with an interactive HTML5 `<canvas>` UI and a hot-reloading Python AI backend.

## Rules

1. **Opposite Starts:** Two gladiators begin at opposite ends of the arena (default **5 × 10**, adjustable from **2 × 2** up to **50 × 50**).
2. **Move or Stay:** Each turn, click on the board to move **Up, Down, Left, Right, or Stay**. You cannot move through walls or onto the other player's square.
3. **Mandatory Wall:** Click one of the open interior borders (`N`, `E`, `S`, `W`) around your destination square to erect a permanent wall.
4. **Confirm (No Undo):** Review your drafted move and wall on the board, then click **Confirm & Lock Move**. Confirmed moves are permanent.
5. **Victory by Division:** As soon as walls completely separate the two players, the game ends and the player with strictly **more reachable squares** wins.

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
