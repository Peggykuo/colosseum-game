"""
The Colosseum Game — Pure Python Rules & State Engine (`engine.py`)

Designed for both serving the interactive UI backend and running fast
Python AI search algorithms (Minimax, Alpha-Beta, Monte Carlo Tree Search)
on board sizes from 2x2 up to 50x50 (default 5x10).
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

MIN_SIZE = 2
MAX_SIZE = 50
DEFAULT_ROWS = 5
DEFAULT_COLS = 10

WALL_BITS: Dict[str, int] = {
    "N": 1,
    "E": 2,
    "S": 4,
    "W": 8,
}

WALL_DIRS: Tuple[str, ...] = ("N", "E", "S", "W")
MOVE_DIRS: Tuple[str, ...] = ("STAY", "N", "E", "S", "W")

DIR_DELTAS: Dict[str, Tuple[int, int]] = {
    "STAY": (0, 0),
    "N": (-1, 0),
    "E": (0, 1),
    "S": (1, 0),
    "W": (0, -1),
}

OPPOSITE_DIR: Dict[str, str] = {
    "N": "S",
    "E": "W",
    "S": "N",
    "W": "E",
}


@dataclass(frozen=True)
class Action:
    """Represents one complete turn: moving (or staying) to `(row, col)` and placing `wall_dir`."""

    row: int
    col: int
    wall_dir: str
    move_dir: Optional[str] = None

    def to_dict(self) -> dict:
        out = {
            "row": self.row,
            "col": self.col,
            "wallDir": self.wall_dir,
        }
        if self.move_dir is not None:
            out["moveDir"] = self.move_dir
        return out


def clamp_board_size(value: int, fallback: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(MIN_SIZE, min(MAX_SIZE, parsed))


def get_initial_positions(rows: int, cols: int) -> List[Tuple[int, int]]:
    """Computes opposite-side starting coordinates for Player 1 (idx 0) and Player 2 (idx 1)."""
    if cols >= rows:
        mid_row = (rows - 1) // 2
        return [(mid_row, 0), (rows - 1 - mid_row, cols - 1)]
    mid_col = (cols - 1) // 2
    return [(0, mid_col), (rows - 1, cols - 1 - mid_col)]


class GameState:
    """
    Mutable game state with fast `.clone()` and `.simulate_action()` helpers for AI search.
    """

    __slots__ = (
        "rows",
        "cols",
        "walls",
        "players",
        "current_player",
        "turn_number",
        "game_over",
        "winner",
        "scores",
        "neutral_count",
    )

    def __init__(
        self,
        rows: int = DEFAULT_ROWS,
        cols: int = DEFAULT_COLS,
        walls: Optional[bytearray] = None,
        players: Optional[List[Tuple[int, int]]] = None,
        current_player: int = 0,
        turn_number: int = 1,
        skip_eval: bool = False,
    ) -> None:
        self.rows: int = clamp_board_size(rows, DEFAULT_ROWS)
        self.cols: int = clamp_board_size(cols, DEFAULT_COLS)
        total = self.rows * self.cols
        self.walls: bytearray = bytearray(walls) if walls is not None else bytearray(total)
        self.players: List[Tuple[int, int]] = (
            list(players) if players is not None else get_initial_positions(self.rows, self.cols)
        )
        self.current_player: int = int(current_player)
        self.turn_number: int = int(turn_number)
        self.game_over: bool = False
        self.winner: Optional[int] = None  # 0 = P1, 1 = P2, -1 = Draw, None = Ongoing
        self.scores: Tuple[int, int] = (total, total)
        self.neutral_count: int = 0

        if not skip_eval:
            self.update_territory_info()

    def clone(self) -> GameState:
        """Fast deep copy suitable for tight MCTS / Minimax loops."""
        copy = GameState(
            rows=self.rows,
            cols=self.cols,
            walls=bytearray(self.walls),
            players=[self.players[0], self.players[1]],
            current_player=self.current_player,
            turn_number=self.turn_number,
            skip_eval=True,
        )
        copy.game_over = self.game_over
        copy.winner = self.winner
        copy.scores = self.scores
        copy.neutral_count = self.neutral_count
        return copy

    def in_bounds(self, row: int, col: int) -> bool:
        return 0 <= row < self.rows and 0 <= col < self.cols

    def is_edge_blocked(self, row: int, col: int, wall_dir: str) -> bool:
        """Returns True if `wall_dir` from `(row, col)` is an outer arena boundary or has a wall."""
        if wall_dir == "N" and row == 0:
            return True
        if wall_dir == "S" and row == self.rows - 1:
            return True
        if wall_dir == "W" and col == 0:
            return True
        if wall_dir == "E" and col == self.cols - 1:
            return True
        return (self.walls[row * self.cols + col] & WALL_BITS[wall_dir]) != 0

    def place_interior_wall(self, row: int, col: int, wall_dir: str) -> None:
        dr, dc = DIR_DELTAS[wall_dir]
        nr, nc = row + dr, col + dc
        if not self.in_bounds(nr, nc):
            raise ValueError("Cannot place a wall on the outer perimeter of the board.")
        self.walls[row * self.cols + col] |= WALL_BITS[wall_dir]
        self.walls[nr * self.cols + nc] |= WALL_BITS[OPPOSITE_DIR[wall_dir]]

    def get_legal_destinations(
        self, player_idx: Optional[int] = None
    ) -> List[Tuple[int, int, str]]:
        """
        Returns legal `(row, col, move_dir)` moves (STAY, N, E, S, W) for `player_idx`.
        Players cannot cross walls/boundaries or step onto the opponent's square.
        """
        if self.game_over:
            return []
        p_idx = self.current_player if player_idx is None else player_idx
        r, c = self.players[p_idx]
        opp_r, opp_c = self.players[1 - p_idx]

        destinations: List[Tuple[int, int, str]] = [(r, c, "STAY")]
        for move_dir in WALL_DIRS:
            if self.is_edge_blocked(r, c, move_dir):
                continue
            dr, dc = DIR_DELTAS[move_dir]
            nr, nc = r + dr, c + dc
            if nr == opp_r and nc == opp_c:
                continue
            destinations.append((nr, nc, move_dir))
        return destinations

    def get_legal_walls_at(self, row: int, col: int) -> List[str]:
        """Returns open interior wall directions ('N', 'E', 'S', 'W') on `(row, col)`."""
        if self.game_over or not self.in_bounds(row, col):
            return []
        return [d for d in WALL_DIRS if not self.is_edge_blocked(row, col, d)]

    def get_legal_actions(self, player_idx: Optional[int] = None) -> List[Action]:
        """Enumerates every legal `Action(row, col, wall_dir, move_dir)` for `player_idx`."""
        if self.game_over:
            return []
        actions: List[Action] = []
        for r, c, move_dir in self.get_legal_destinations(player_idx):
            for wall_dir in self.get_legal_walls_at(r, c):
                actions.append(Action(row=r, col=c, wall_dir=wall_dir, move_dir=move_dir))
        return actions

    def infer_move_dir(self, from_pos: Tuple[int, int], to_row: int, to_col: int) -> Optional[str]:
        dr = to_row - from_pos[0]
        dc = to_col - from_pos[1]
        for move_dir, (mdr, mdc) in DIR_DELTAS.items():
            if dr == mdr and dc == mdc:
                return move_dir
        return None

    def is_valid_action(self, action: Action, player_idx: Optional[int] = None) -> bool:
        if self.game_over or action.wall_dir not in WALL_BITS:
            return False
        legal_dests = self.get_legal_destinations(player_idx)
        if not any(r == action.row and c == action.col for r, c, _ in legal_dests):
            return False
        return not self.is_edge_blocked(action.row, action.col, action.wall_dir)

    def compute_reachable_cells(self, start_row: int, start_col: int) -> Tuple[int, bytearray]:
        """Fast BFS returning `(reachable_count, visited_mask)`."""
        rows, cols, walls = self.rows, self.cols, self.walls
        visited = bytearray(rows * cols)
        start_idx = start_row * cols + start_col
        visited[start_idx] = 1
        q = deque([start_idx])
        count = 1

        while q:
            idx = q.popleft()
            w = walls[idx]
            r, c = divmod(idx, cols)

            if r > 0 and (w & 1) == 0:
                n_idx = idx - cols
                if not visited[n_idx]:
                    visited[n_idx] = 1
                    count += 1
                    q.append(n_idx)
            if c < cols - 1 and (w & 2) == 0:
                e_idx = idx + 1
                if not visited[e_idx]:
                    visited[e_idx] = 1
                    count += 1
                    q.append(e_idx)
            if r < rows - 1 and (w & 4) == 0:
                s_idx = idx + cols
                if not visited[s_idx]:
                    visited[s_idx] = 1
                    count += 1
                    q.append(s_idx)
            if c > 0 and (w & 8) == 0:
                w_idx = idx - 1
                if not visited[w_idx]:
                    visited[w_idx] = 1
                    count += 1
                    q.append(w_idx)

        return count, visited

    def update_territory_info(self) -> None:
        """Checks whether walls separate the two players and updates scores & winner."""
        total = self.rows * self.cols
        p1_r, p1_c = self.players[0]
        p2_r, p2_c = self.players[1]

        p1_count, p1_vis = self.compute_reachable_cells(p1_r, p1_c)
        separated = p1_vis[p2_r * self.cols + p2_c] == 0

        if not separated:
            self.scores = (p1_count, p1_count)
            self.neutral_count = total - p1_count
            self.game_over = False
            self.winner = None
            return

        p2_count, _ = self.compute_reachable_cells(p2_r, p2_c)
        self.scores = (p1_count, p2_count)
        self.neutral_count = total - p1_count - p2_count
        self.game_over = True

        if p1_count > p2_count:
            self.winner = 0
        elif p2_count > p1_count:
            self.winner = 1
        else:
            self.winner = -1

    def apply_action(self, action: Action) -> GameState:
        """Mutates `self` by applying `action`, checking separation, and advancing the turn."""
        if not self.is_valid_action(action, self.current_player):
            raise ValueError(f"Illegal Colosseum action: {action}")

        p_idx = self.current_player
        self.players[p_idx] = (action.row, action.col)
        self.place_interior_wall(action.row, action.col, action.wall_dir)
        self.update_territory_info()

        if not self.game_over:
            self.current_player = 1 - p_idx
            self.turn_number += 1
        return self

    def simulate_action(self, action: Action) -> GameState:
        """Non-mutating helper: clones `self` and applies `action`."""
        return self.clone().apply_action(action)

    @classmethod
    def from_dict(cls, data: dict) -> GameState:
        rows = int(data["rows"])
        cols = int(data["cols"])
        raw_walls = data["walls"]
        walls = bytearray(int(x) for x in raw_walls)
        if len(walls) != rows * cols:
            raise ValueError("Invalid walls array length.")

        raw_players = data["players"]
        players: List[Tuple[int, int]] = []
        for p in raw_players:
            if isinstance(p, dict):
                players.append((int(p["row"]), int(p["col"])))
            else:
                players.append((int(p[0]), int(p[1])))

        return cls(
            rows=rows,
            cols=cols,
            walls=walls,
            players=players,
            current_player=int(data.get("currentPlayer", 0)),
            turn_number=int(data.get("turnNumber", 1)),
        )

    def to_dict(self) -> dict:
        return {
            "rows": self.rows,
            "cols": self.cols,
            "walls": list(self.walls),
            "players": [
                {"row": self.players[0][0], "col": self.players[0][1]},
                {"row": self.players[1][0], "col": self.players[1][1]},
            ],
            "currentPlayer": self.current_player,
            "turnNumber": self.turn_number,
            "gameOver": self.game_over,
            "winner": self.winner,
            "scores": list(self.scores),
            "neutralCount": self.neutral_count,
        }
