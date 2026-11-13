"""
The Colosseum Game — Python AI Module (`ai.py`)

Delegates AI turns to the registered agents in `agents/` (`StudentAgent` in
`agents/student_agent.py` and `RandomAgent` in `agents/random_agent.py`).
"""

from __future__ import annotations

from copy import deepcopy
from agents.random_agent import RandomAgent
from agents.student_agent import StudentAgent
from engine import DIR_TO_WALL, Action, GameState
from store import AGENT_REGISTRY


def _run_agent(state: GameState, agent_name: str) -> Action:
    agent_cls = AGENT_REGISTRY.get(agent_name)
    if agent_cls is None:
        agent_cls = StudentAgent if agent_name == "student_agent" else RandomAgent
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


def random_move_ai(state: GameState) -> Action:
    """Executes `RandomAgent.step` from `agents/random_agent.py`."""
    return _run_agent(state, "random_agent")


def custom_ai(state: GameState) -> Action:
    """Executes `StudentAgent.step` from `agents/student_agent.py`."""
    return _run_agent(state, "student_agent")


def choose_move(state: GameState, agent_type: str = "custom") -> Action:
    """Entry point invoked by `server.py` and `pyodide-worker.js` on every AI turn."""
    if agent_type in ("random", "random_agent"):
        return random_move_ai(state)
    return custom_ai(state)
