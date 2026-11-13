# Colosseum Game

> **Note:** Reupload from a Nov 2023 project to code an AI agent for a zero-sum game. The game and UI is completed AI generated to showcase the AI agent.

Try the game at https://peggykuo.github.io/colosseum-game/

A two-player zero-sum territory strategy game with an HTML5 `<canvas>` UI and Python AI backend.

## Rules

- **Setup:** Two players start on opposite ends of a grid (default `5 × 10`) and alternate turns.
- **Turn:** Move up to **1 orthogonal step** (or stay in place) without crossing walls or the opponent, then place **1 permanent wall** on an open border of your destination square.
- **Win Condition:** The game ends when walls completely separate both players. Each player scores 1 point per reachable square in their enclosed territory; highest score wins.

## AI Agent Strategy (`agents/student_agent.py`)

- **BFS Move Generation (`get_possible_moves`):** Performs a Breadth-First Search from the agent's current position up to `max_step` to enumerate all reachable destination squares and open wall placements without crossing walls or the opponent.
- **Endgame & Outcome Classification (`check_endgame` & `sorted_moves`):** Simulates every legal move using Union-Find connected components to categorize actions into immediate `wins` (sorted by highest enclosed territory), `ties`, `losses`, and non-terminal (`neither`) moves—immediately executing the highest-scoring winning enclosure when available.
- **Spatial Distance Heuristic (`distance_to_all_cells` & `calc_heuristic`):** For non-terminal moves, computes full-board BFS shortest-path distance matrices from both the agent (`my_potential`) and the opponent (`opp_potential`), ranking moves in a min-heap by total reachability advantage (`np.sum(my_potential - opp_potential)`).
- **Opponent Win Lookahead (`best_move`):** Simulates the top-ranked heuristic move and checks the opponent's next-turn responses (`op_wins`) to avoid moves that hand the opponent an immediate winning enclosure.

## Quick Start

Run locally with Python 3.8+ (standard library only):

```bash
python3 server.py
```

Open `http://localhost:8000`. Edits to `agents/student_agent.py` and `ai.py` hot-reload automatically. Also works as a static site.
