/**
 * The Colosseum Game — Core Engine
 *
 * Pure, deterministic, zero-DOM game logic and fast state utilities.
 * Designed for both interactive play and high-speed tree search (Minimax / MCTS)
 * on boards from 2x2 up to 50x50.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ColosseumEngine = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIN_SIZE = 2;
  const MAX_SIZE = 50;
  const DEFAULT_ROWS = 5;
  const DEFAULT_COLS = 10;

  // Bitmask flags for walls on each cell
  const WALL_BITS = {
    N: 1,
    E: 2,
    S: 4,
    W: 8,
  };

  const WALL_DIRS = ['N', 'E', 'S', 'W'];

  const DIR_DELTAS = {
    STAY: { dr: 0, dc: 0, label: 'Stay' },
    N: { dr: -1, dc: 0, label: 'Up' },
    E: { dr: 0, dc: 1, label: 'Right' },
    S: { dr: 1, dc: 0, label: 'Down' },
    W: { dr: 0, dc: -1, label: 'Left' },
  };

  const OPPOSITE_DIR = {
    N: 'S',
    E: 'W',
    S: 'N',
    W: 'E',
  };

  const MOVE_DIRS = ['STAY', 'N', 'E', 'S', 'W'];

  function clampBoardSize(val, fallback) {
    const parsed = Number.parseInt(val, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.max(MIN_SIZE, Math.min(MAX_SIZE, parsed));
  }

  /**
   * Computes opposite-side starting coordinates for Player 1 and Player 2.
   * Default 5x10 places Player 1 at (2, 0) [left center] and Player 2 at (2, 9) [right center].
   * If rows > cols, places players at top center and bottom center along the longer axis.
   */
  function getInitialPositions(rows, cols) {
    if (cols >= rows) {
      const midRow = Math.floor((rows - 1) / 2);
      return [
        { row: midRow, col: 0 },
        { row: rows - 1 - midRow, col: cols - 1 },
      ];
    }
    const midCol = Math.floor((cols - 1) / 2);
    return [
      { row: 0, col: midCol },
      { row: rows - 1, col: cols - 1 - midCol },
    ];
  }

  /**
   * Creates a fresh game state.
   * Note: Outer perimeter edges are implicitly impassable arena bounds and cannot
   * have player walls placed on them. Interior walls are stored symmetrically in `walls`.
   */
  function createGameState(rows = DEFAULT_ROWS, cols = DEFAULT_COLS) {
    const r = clampBoardSize(rows, DEFAULT_ROWS);
    const c = clampBoardSize(cols, DEFAULT_COLS);
    const total = r * c;
    const walls = new Uint8Array(total);
    const players = getInitialPositions(r, c);

    const state = {
      rows: r,
      cols: c,
      walls, // Uint8Array(rows * cols), bitmask of WALL_BITS per cell
      players, // [{ row, col }, { row, col }] for Player 1 (index 0) & Player 2 (index 1)
      currentPlayer: 0, // 0 = Player 1, 1 = Player 2
      turnNumber: 1,
      gameOver: false,
      winner: null, // 0 = Player 1, 1 = Player 2, -1 = Draw, null = ongoing
      scores: [total, total],
      neutralCount: 0,
      territoryMap: null, // Int8Array(rows * cols): 0 = P1, 1 = P2, -1 = shared/contestable, -2 = sealed dead space
      lastAction: null,
      history: [], // Read-only log of committed moves (no undo supported by design)
    };

    updateTerritoryInfo(state);
    return state;
  }

  /**
   * Fast deep clone of game state for AI search / simulation (omits UI log overhead).
   */
  function cloneState(state) {
    return {
      rows: state.rows,
      cols: state.cols,
      walls: new Uint8Array(state.walls),
      players: [
        { row: state.players[0].row, col: state.players[0].col },
        { row: state.players[1].row, col: state.players[1].col },
      ],
      currentPlayer: state.currentPlayer,
      turnNumber: state.turnNumber,
      gameOver: state.gameOver,
      winner: state.winner,
      scores: [state.scores[0], state.scores[1]],
      neutralCount: state.neutralCount,
      territoryMap: state.territoryMap ? new Int8Array(state.territoryMap) : null,
      lastAction: state.lastAction ? { ...state.lastAction } : null,
      history: [],
    };
  }

  function cellIndex(cols, row, col) {
    return row * cols + col;
  }

  function inBounds(rows, cols, row, col) {
    return row >= 0 && row < rows && col >= 0 && col < cols;
  }

  /**
   * Checks whether moving or tracing across edge `dir` from `(row, col)` is blocked
   * by either the outer arena boundary or a placed interior wall.
   */
  function isEdgeBlocked(state, row, col, dir) {
    const { rows, cols, walls } = state;
    if (dir === 'N' && row === 0) return true;
    if (dir === 'S' && row === rows - 1) return true;
    if (dir === 'W' && col === 0) return true;
    if (dir === 'E' && col === cols - 1) return true;
    return (walls[row * cols + col] & WALL_BITS[dir]) !== 0;
  }

  /**
   * Checks if an interior wall already exists on `dir` of `(row, col)`.
   */
  function hasInteriorWall(state, row, col, dir) {
    return (state.walls[row * state.cols + col] & WALL_BITS[dir]) !== 0;
  }

  /**
   * Places a permanent thin barrier on edge `dir` of `(row, col)` and mirrors it on the neighbor.
   */
  function placeInteriorWall(state, row, col, dir) {
    const { rows, cols, walls } = state;
    const delta = DIR_DELTAS[dir];
    const nr = row + delta.dr;
    const nc = col + delta.dc;
    if (!inBounds(rows, cols, nr, nc)) {
      throw new Error('Cannot place wall on outer arena boundary.');
    }
    walls[row * cols + col] |= WALL_BITS[dir];
    walls[nr * cols + nc] |= WALL_BITS[OPPOSITE_DIR[dir]];
  }

  /**
   * Returns all legal destination squares (up, down, left, right, stay) for `playerIdx`.
   * A player cannot cross walls/bounds and cannot move onto the other player's cell.
   */
  function getLegalDestinations(state, playerIdx = state.currentPlayer) {
    if (state.gameOver) return [];
    const pos = state.players[playerIdx];
    const opp = state.players[1 - playerIdx];
    const destinations = [];

    for (let i = 0; i < MOVE_DIRS.length; i++) {
      const moveDir = MOVE_DIRS[i];
      if (moveDir === 'STAY') {
        destinations.push({
          row: pos.row,
          col: pos.col,
          moveDir: 'STAY',
        });
        continue;
      }

      if (isEdgeBlocked(state, pos.row, pos.col, moveDir)) continue;
      const delta = DIR_DELTAS[moveDir];
      const nr = pos.row + delta.dr;
      const nc = pos.col + delta.dc;
      if (nr === opp.row && nc === opp.col) continue;

      destinations.push({
        row: nr,
        col: nc,
        moveDir,
      });
    }

    return destinations;
  }

  /**
   * Returns all legal open interior wall directions ('N' | 'E' | 'S' | 'W') on `(row, col)`.
   */
  function getLegalWallsAt(state, row, col) {
    if (state.gameOver) return [];
    const { rows, cols } = state;
    if (!inBounds(rows, cols, row, col)) return [];

    const openWalls = [];
    for (let i = 0; i < WALL_DIRS.length; i++) {
      const dir = WALL_DIRS[i];
      if (!isEdgeBlocked(state, row, col, dir)) {
        openWalls.push(dir);
      }
    }
    return openWalls;
  }

  /**
   * Generates every legal `{ row, col, moveDir, wallDir }` action for `playerIdx`.
   * Useful for AI agents (Minimax, Alpha-Beta, MCTS).
   */
  function getAllLegalActions(state, playerIdx = state.currentPlayer) {
    if (state.gameOver) return [];
    const dests = getLegalDestinations(state, playerIdx);
    const actions = [];
    for (let i = 0; i < dests.length; i++) {
      const d = dests[i];
      const walls = getLegalWallsAt(state, d.row, d.col);
      for (let j = 0; j < walls.length; j++) {
        actions.push({
          row: d.row,
          col: d.col,
          moveDir: d.moveDir,
          wallDir: walls[j],
        });
      }
    }
    return actions;
  }

  /**
   * Validates an action `{ row, col, wallDir }` for `playerIdx`.
   */
  function isValidAction(state, action, playerIdx = state.currentPlayer) {
    if (!action || state.gameOver) return false;
    const { row, col, wallDir } = action;
    if (!WALL_BITS[wallDir]) return false;

    const dests = getLegalDestinations(state, playerIdx);
    let foundDest = null;
    for (let i = 0; i < dests.length; i++) {
      if (dests[i].row === row && dests[i].col === col) {
        foundDest = dests[i];
        break;
      }
    }
    if (!foundDest) return false;

    return !isEdgeBlocked(state, row, col, wallDir);
  }

  /**
   * Fast Breadth-First Search from `(startRow, startCol)` respecting walls & bounds.
   * Returns `{ count, visited }` where `visited` is a `Uint8Array(rows * cols)`.
   */
  function computeReachableCells(state, startRow, startCol) {
    const { rows, cols, walls } = state;
    const total = rows * cols;
    const visited = new Uint8Array(total);
    const queue = new Int32Array(total);

    const startIdx = startRow * cols + startCol;
    visited[startIdx] = 1;
    queue[0] = startIdx;

    let head = 0;
    let tail = 1;

    while (head < tail) {
      const idx = queue[head++];
      const w = walls[idx];
      const r = (idx / cols) | 0;
      const c = idx - r * cols;

      // North
      if (r > 0 && (w & 1) === 0) {
        const nIdx = idx - cols;
        if (!visited[nIdx]) {
          visited[nIdx] = 1;
          queue[tail++] = nIdx;
        }
      }
      // East
      if (c < cols - 1 && (w & 2) === 0) {
        const eIdx = idx + 1;
        if (!visited[eIdx]) {
          visited[eIdx] = 1;
          queue[tail++] = eIdx;
        }
      }
      // South
      if (r < rows - 1 && (w & 4) === 0) {
        const sIdx = idx + cols;
        if (!visited[sIdx]) {
          visited[sIdx] = 1;
          queue[tail++] = sIdx;
        }
      }
      // West
      if (c > 0 && (w & 8) === 0) {
        const wIdx = idx - 1;
        if (!visited[wIdx]) {
          visited[wIdx] = 1;
          queue[tail++] = wIdx;
        }
      }
    }

    return { count: tail, visited };
  }

  /**
   * Evaluates whether the two players are separated by walls and computes territory map.
   * `territoryMap` cell values:
   *  -1 = shared/contestable (reachable by both players)
   *   0 = exclusively reachable by Player 1
   *   1 = exclusively reachable by Player 2
   *  -2 = sealed off (unreachable by either player)
   */
  function updateTerritoryInfo(state) {
    const { rows, cols, players } = state;
    const total = rows * cols;
    const p1Reach = computeReachableCells(state, players[0].row, players[0].col);
    const p2Idx = players[1].row * cols + players[1].col;
    const separated = p1Reach.visited[p2Idx] === 0;

    const territoryMap = new Int8Array(total);

    if (!separated) {
      // Both players share the same connected component `p1Reach`
      let sealed = 0;
      for (let i = 0; i < total; i++) {
        if (p1Reach.visited[i]) {
          territoryMap[i] = -1;
        } else {
          territoryMap[i] = -2;
          sealed++;
        }
      }
      state.scores = [p1Reach.count, p1Reach.count];
      state.neutralCount = sealed;
      state.territoryMap = territoryMap;
      state.gameOver = false;
      state.winner = null;
      return { separated: false, scores: state.scores, winner: null };
    }

    // Separated! Compute Player 2's isolated reachable region
    const p2Reach = computeReachableCells(state, players[1].row, players[1].col);
    let sealed = 0;
    for (let i = 0; i < total; i++) {
      if (p1Reach.visited[i]) {
        territoryMap[i] = 0;
      } else if (p2Reach.visited[i]) {
        territoryMap[i] = 1;
      } else {
        territoryMap[i] = -2;
        sealed++;
      }
    }

    state.scores = [p1Reach.count, p2Reach.count];
    state.neutralCount = sealed;
    state.territoryMap = territoryMap;
    state.gameOver = true;

    if (p1Reach.count > p2Reach.count) {
      state.winner = 0;
    } else if (p2Reach.count > p1Reach.count) {
      state.winner = 1;
    } else {
      state.winner = -1; // Tie
    }

    return {
      separated: true,
      scores: state.scores,
      winner: state.winner,
    };
  }

  /**
   * Infers the move direction ('STAY' | 'N' | 'E' | 'S' | 'W') from player's current cell.
   */
  function inferMoveDir(fromPos, toRow, toCol) {
    const dr = toRow - fromPos.row;
    const dc = toCol - fromPos.col;
    if (dr === 0 && dc === 0) return 'STAY';
    if (dr === -1 && dc === 0) return 'N';
    if (dr === 1 && dc === 0) return 'S';
    if (dr === 0 && dc === -1) return 'W';
    if (dr === 0 && dc === 1) return 'E';
    return null;
  }

  /**
   * Commits a validated `{ row, col, wallDir }` action onto `state` (mutates `state`).
   * Permanently moves the active player, places the mandatory wall, checks separation,
   * and advances the turn if the game is still active.
   */
  function applyAction(state, action, options = { recordHistory: true }) {
    if (!isValidAction(state, action, state.currentPlayer)) {
      throw new Error('Illegal Colosseum move or wall placement.');
    }

    const playerIdx = state.currentPlayer;
    const prevPos = { ...state.players[playerIdx] };
    const moveDir = action.moveDir || inferMoveDir(prevPos, action.row, action.col);

    // 1. Move player
    state.players[playerIdx] = { row: action.row, col: action.col };

    // 2. Place mandatory wall on destination square's chosen edge
    placeInteriorWall(state, action.row, action.col, action.wallDir);

    const committed = {
      turn: state.turnNumber,
      player: playerIdx,
      from: prevPos,
      to: { row: action.row, col: action.col },
      moveDir,
      wallDir: action.wallDir,
    };

    state.lastAction = committed;
    if (options && options.recordHistory && state.history) {
      state.history.push(committed);
    }

    // 3. Evaluate separation & territory counts
    updateTerritoryInfo(state);

    // 4. Advance turn if arena is not yet separated
    if (!state.gameOver) {
      state.currentPlayer = 1 - playerIdx;
      state.turnNumber += 1;
    }

    return state;
  }

  /**
   * Pure simulation helper for AI tree search: clones `state`, applies `action`
   * without history allocation, and returns the resulting next state.
   */
  function simulateAction(state, action) {
    const next = cloneState(state);
    return applyAction(next, action, { recordHistory: false });
  }

  return {
    MIN_SIZE,
    MAX_SIZE,
    DEFAULT_ROWS,
    DEFAULT_COLS,
    WALL_BITS,
    WALL_DIRS,
    MOVE_DIRS,
    DIR_DELTAS,
    OPPOSITE_DIR,
    clampBoardSize,
    getInitialPositions,
    createGameState,
    cloneState,
    cellIndex,
    inBounds,
    isEdgeBlocked,
    hasInteriorWall,
    getLegalDestinations,
    getLegalWallsAt,
    getAllLegalActions,
    isValidAction,
    computeReachableCells,
    updateTerritoryInfo,
    inferMoveDir,
    applyAction,
    simulateAction,
  };
});
