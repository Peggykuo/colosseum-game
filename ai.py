"""
The Colosseum Game — Python AI Module (`ai.py`)

Edit this file to implement your own Python AI agent!
Note: `server.py` automatically hot-reloads `ai.py` whenever you save changes,
so you can edit `custom_ai(state)` mid-game without restarting the server.

Quick Reference (`state: GameState` from `engine.py`):
  - `state.rows`, `state.cols`             : Board dimensions (2..50)
  - `state.current_player`                 : `0` (Player 1) or `1` (Player 2)
  - `state.players`                        : `[(r1, c1), (r2, c2)]`
  - `state.walls`                          : `bytearray(rows * cols)` bitmask (N=1, E=2, S=4, W=8)
  - `state.get_legal_destinations()`       : `List[Tuple[row, col, move_dir]]`
  - `state.get_legal_walls_at(row, col)`   : `List[str]` ('N', 'E', 'S', 'W')
  - `state.get_legal_actions()`            : `List[Action]`
  - `state.simulate_action(action)`        : Returns cloned next `GameState`
  - `state.clone()` / `state.apply_action(action)`
  - `state.compute_reachable_cells(r, c)`  : Fast BFS -> `(count, visited_bytearray)`
"""

from __future__ import annotations

import random
from engine import Action, GameState


def random_move_ai(state: GameState) -> Action:
    """
    Placeholder Random Move AI:
      1. Randomly picks a legal move direction (Up, Down, Left, Right, or Stay).
      2. Randomly picks an open interior border ('N', 'E', 'S', 'W') on that square
         to place the mandatory wall.
    """
    legal_destinations = state.get_legal_destinations(state.current_player)
    if not legal_destinations:
        raise RuntimeError("No legal destinations available for Random AI.")

    candidates = []
    for row, col, move_dir in legal_destinations:
        open_walls = state.get_legal_walls_at(row, col)
        if open_walls:
            candidates.append((row, col, move_dir, open_walls))

    if not candidates:
        raise RuntimeError("No legal wall placements available for Random AI.")

    row, col, move_dir, open_walls = random.choice(candidates)
    wall_dir = random.choice(open_walls)
    return Action(row=row, col=col, wall_dir=wall_dir, move_dir=move_dir)


def custom_ai(state: GameState) -> Action:
    """
    TODO: Implement your custom Python AI strategy here later!
    (Currently delegates to `random_move_ai` as a placeholder.)
    """
    return random_move_ai(state)


def choose_move(state: GameState, agent_type: str = "random") -> Action:
    """Entry point invoked by `server.py` on every AI turn."""
    if agent_type == "custom":
        return custom_ai(state)
    return random_move_ai(state)
