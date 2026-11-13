"""
The Colosseum Game — Python AI Module (`ai.py`)

Delegates AI turns to `StudentAgent` in `agents/student_agent.py`.
"""

from __future__ import annotations

from copy import deepcopy
from agents.student_agent import StudentAgent
from engine import DIR_TO_WALL, Action, GameState
from store import AGENT_REGISTRY


def custom_ai(state: GameState) -> Action:
    """Executes `StudentAgent.step` from `agents/student_agent.py`."""
    agent_cls = AGENT_REGISTRY.get("student_agent", StudentAgent)
    agent = agent_cls()

    chess_board = state.to_chess_board()
    my_pos = tuple(state.players[state.current_player])
    adv_pos = tuple(state.players[1 - state.current_player])

    next_pos, barrier_dir = agent.step(
        deepcopy(chess_board),
        my_pos,
        adv_pos,
        state.max_step,
    )
    row, col = int(next_pos[0]), int(next_pos[1])
    wall_dir = DIR_TO_WALL[int(barrier_dir)]
    move_dir = state.infer_move_dir(my_pos, row, col)
    return Action(row=row, col=col, wall_dir=wall_dir, move_dir=move_dir)


def choose_move(state: GameState, agent_type: str = "custom") -> Action:
    """Entry point invoked by `server.py` and `pyodide-worker.js` on every AI turn."""
    return custom_ai(state)
