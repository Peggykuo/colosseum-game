/**
 * The Colosseum Game — Interactive UI & HiDPI Canvas Controller
 *
 * Supports:
 * - Direct click-on-board move + mandatory wall selection
 * - Mandatory pre-move confirmation with strictly no undo
 * - Dual Python AI runtime:
 *   1. Local `server.py` (`POST ./api/ai-move` -> `ai.py` with live hot-reload)
 *   2. Automatic Pyodide WebAssembly Worker fallback (`./pyodide-worker.js`)
 *      running `engine.py` + `ai.py` directly in the browser on GitHub Pages
 */
(function () {
  'use strict';

  const Engine = window.ColosseumEngine;

  const DIR_LABELS = {
    STAY: 'Stay',
    N: 'Up (North)',
    E: 'Right (East)',
    S: 'Down (South)',
    W: 'Left (West)',
  };

  const WALL_LABELS = {
    N: 'North Wall',
    E: 'East Wall',
    S: 'South Wall',
    W: 'West Wall',
  };

  // Mode controller descriptors: 'human' | 'random' | 'custom'
  const MODE_CONTROLLERS = {
    'p1-vs-random': ['human', 'random'],
    'random-vs-p2': ['random', 'human'],
    pvp: ['human', 'human'],
    'random-vs-random': ['random', 'random'],
    'custom-vs-random': ['custom', 'random'],
  };

  // Application State
  let gameState = Engine.createGameState(Engine.DEFAULT_ROWS, Engine.DEFAULT_COLS);
  let gameMode = 'p1-vs-random';
  let sessionId = 0; // Cancels in-flight AI requests on New Arena / Mode change
  let aiBusy = false;
  let aiError = null;
  let aiPreview = null; // Brief visual preview of Python AI's chosen { row, col, moveDir, wallDir }

  // Python runtime state: 'probing' | 'server' | 'pyodide'
  let aiBackendMode = 'probing';
  let backendProbePromise = null;
  let pyodideWorker = null;
  let pyodideReady = false;
  let pyodideInitPromise = null;
  let workerReqSeq = 0;
  const pendingWorkerReqs = new Map();

  // Pre-confirmation draft state for human turns (no undo after confirmation)
  let draftMove = null;
  let draftWall = null;
  let hoverCell = null;
  let hoverWall = null;

  // Camera state for boards up to 50x50
  const camera = {
    zoom: 1,
    panX: 0,
    panY: 0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    panStartX: 0,
    panStartY: 0,
    movedDuringDrag: false,
  };

  let layout = {
    width: 800,
    height: 540,
    dpr: 1,
    baseCell: 48,
    cellPx: 48,
    originX: 0,
    originY: 0,
  };

  // DOM References
  const canvas = document.getElementById('arena-canvas');
  const canvasWrap = document.getElementById('canvas-wrap');
  const ctx = canvas.getContext('2d');

  const rowsInput = document.getElementById('input-rows');
  const colsInput = document.getElementById('input-cols');
  const modeSelect = document.getElementById('select-mode');
  const newGameBtn = document.getElementById('btn-new-game');

  const badgeP1 = document.getElementById('badge-p1');
  const badgeP2 = document.getElementById('badge-p2');
  const nameP1 = document.getElementById('name-p1');
  const nameP2 = document.getElementById('name-p2');
  const statP1 = document.getElementById('stat-p1');
  const statP2 = document.getElementById('stat-p2');
  const turnPill = document.getElementById('turn-pill');
  const stepPrompt = document.getElementById('step-prompt');

  const confirmBar = document.getElementById('confirm-bar');
  const confirmTitle = document.getElementById('confirm-title');
  const confirmDetail = document.getElementById('confirm-detail');
  const clearDraftBtn = document.getElementById('btn-clear-draft');
  const confirmMoveBtn = document.getElementById('btn-confirm-move');

  const zoomOutBtn = document.getElementById('btn-zoom-out');
  const zoomInBtn = document.getElementById('btn-zoom-in');
  const fitBoardBtn = document.getElementById('btn-fit-board');
  const focusTurnBtn = document.getElementById('btn-focus-turn');
  const zoomReadout = document.getElementById('zoom-readout');

  const logList = document.getElementById('move-log');
  const aiRuntimeNote = document.getElementById('ai-runtime-note');

  function getControllerType(playerIdx) {
    const pair = MODE_CONTROLLERS[gameMode] || MODE_CONTROLLERS.pvp;
    return pair[playerIdx];
  }

  function isHumanTurn() {
    if (gameState.gameOver || aiBusy) return false;
    return getControllerType(gameState.currentPlayer) === 'human';
  }

  function getPlayerLabel(idx) {
    const ctrl = getControllerType(idx);
    const roman = idx === 0 ? 'I' : 'II';
    if (ctrl === 'random') return `Gladiator ${roman} (Random AI)`;
    if (ctrl === 'custom') return `Gladiator ${roman} (Custom AI)`;
    return `Gladiator ${roman}`;
  }

  function startNewGame(rows, cols) {
    sessionId += 1;
    const r = Engine.clampBoardSize(rows, Engine.DEFAULT_ROWS);
    const c = Engine.clampBoardSize(cols, Engine.DEFAULT_COLS);
    rowsInput.value = String(r);
    colsInput.value = String(c);

    gameState = Engine.createGameState(r, c);
    aiBusy = false;
    aiError = null;
    aiPreview = null;
    draftMove = null;
    draftWall = null;
    hoverCell = null;
    hoverWall = null;

    resetCameraForBoard();
    syncUI();
    draw();
    maybeTriggerAITurn(sessionId);
  }

  function resetCameraForBoard() {
    camera.zoom = 1;
    camera.panX = 0;
    camera.panY = 0;
    updateLayoutMetrics();

    const bothAI =
      getControllerType(0) !== 'human' && getControllerType(1) !== 'human';
    if (!bothAI && (gameState.rows > 18 || gameState.cols > 18) && layout.cellPx < 24) {
      focusCameraOnPlayer(gameState.currentPlayer, 40);
    }
  }

  function focusCameraOnPlayer(playerIdx, minCellPx = 42) {
    camera.zoom = 1;
    camera.panX = 0;
    camera.panY = 0;
    updateLayoutMetrics();

    const baseCell = layout.baseCell;
    if (baseCell <= 0) return;

    camera.zoom = Math.min(8, Math.max(1, minCellPx / baseCell));
    const cellPx = baseCell * camera.zoom;
    const pos = gameState.players[playerIdx];

    camera.panX = -((pos.col + 0.5) * cellPx - (gameState.cols * cellPx) / 2);
    camera.panY = -((pos.row + 0.5) * cellPx - (gameState.rows * cellPx) / 2);
    clampPan();
    updateLayoutMetrics();
  }

  function clampPan() {
    const pad = 28;
    const availW = Math.max(120, layout.width - pad * 2);
    const availH = Math.max(120, layout.height - pad * 2);
    const baseCell = Math.min(availW / gameState.cols, availH / gameState.rows);
    const cellPx = baseCell * camera.zoom;
    const maxPanX = Math.max(0, (gameState.cols * cellPx) / 2);
    const maxPanY = Math.max(0, (gameState.rows * cellPx) / 2);
    camera.panX = Math.max(-maxPanX, Math.min(maxPanX, camera.panX));
    camera.panY = Math.max(-maxPanY, Math.min(maxPanY, camera.panY));
  }

  function updateLayoutMetrics() {
    const rect = canvasWrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(260, Math.floor(rect.width));
    const height = Math.max(300, Math.floor(rect.height));

    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }

    const pad = 28;
    const availW = Math.max(120, width - pad * 2);
    const availH = Math.max(120, height - pad * 2);
    const baseCell = Math.min(availW / gameState.cols, availH / gameState.rows);
    const cellPx = baseCell * camera.zoom;

    layout = {
      width,
      height,
      dpr,
      baseCell,
      cellPx,
      originX: (width - gameState.cols * cellPx) / 2 + camera.panX,
      originY: (height - gameState.rows * cellPx) / 2 + camera.panY,
    };

    zoomReadout.textContent = `${Math.round(camera.zoom * 100)}%`;
  }

  function formatCoord(row, col) {
    return `(R${row + 1}, C${col + 1})`;
  }

  function syncUI() {
    nameP1.textContent = getPlayerLabel(0);
    nameP2.textContent = getPlayerLabel(1);

    badgeP1.classList.toggle('active-p1', !gameState.gameOver && gameState.currentPlayer === 0);
    badgeP2.classList.toggle('active-p2', !gameState.gameOver && gameState.currentPlayer === 1);

    if (gameState.gameOver) {
      statP1.textContent = `Enclosed Space: ${gameState.scores[0]} sq`;
      statP2.textContent = `Enclosed Space: ${gameState.scores[1]} sq`;
      turnPill.textContent = `Arena Divided · ${gameState.history.length} Moves`;

      let outcomeText = 'Draw — Equal Arena Space!';
      if (gameState.winner === 0) {
        outcomeText = `${getPlayerLabel(0)} Wins (${gameState.scores[0]} vs ${gameState.scores[1]})!`;
      } else if (gameState.winner === 1) {
        outcomeText = `${getPlayerLabel(1)} Wins (${gameState.scores[1]} vs ${gameState.scores[0]})!`;
      }
      stepPrompt.textContent = outcomeText;

      confirmBar.classList.remove('ready');
      confirmBar.classList.add('gameover');
      confirmTitle.textContent = outcomeText;
      const neutralNote =
        gameState.neutralCount > 0 ? ` · ${gameState.neutralCount} unreachable sealed sq` : '';
      confirmDetail.textContent = `Final Territory — ${getPlayerLabel(0)}: ${gameState.scores[0]} sq | ${getPlayerLabel(1)}: ${gameState.scores[1]} sq${neutralNote}`;
      clearDraftBtn.disabled = true;
      confirmMoveBtn.disabled = true;
    } else {
      confirmBar.classList.remove('gameover');
      const p1Pos = gameState.players[0];
      const p2Pos = gameState.players[1];
      statP1.textContent = `Pos ${formatCoord(p1Pos.row, p1Pos.col)} · Shared ${gameState.scores[0]} sq`;
      statP2.textContent = `Pos ${formatCoord(p2Pos.row, p2Pos.col)} · Shared ${gameState.scores[1]} sq`;

      const activeName = getPlayerLabel(gameState.currentPlayer);
      turnPill.textContent = `Turn ${gameState.turnNumber} · ${activeName}`;

      if (!isHumanTurn()) {
        if (aiError) {
          stepPrompt.textContent = 'Python AI Error — check ai.py and click New Arena';
          confirmBar.classList.remove('ready');
          confirmTitle.textContent = `Python AI Exception (${activeName})`;
          confirmDetail.textContent = aiError;
        } else {
          const loadingPyodide = aiBackendMode === 'pyodide' && !pyodideReady;
          stepPrompt.textContent = aiPreview
            ? `${activeName}: ${DIR_LABELS[aiPreview.moveDir]} → ${formatCoord(aiPreview.row, aiPreview.col)} + ${WALL_LABELS[aiPreview.wallDir]}`
            : loadingPyodide
              ? 'Loading Python 3 WebAssembly runtime (Pyodide) for first AI turn...'
              : `${activeName} is computing move in Python (ai.py)...`;
          confirmBar.classList.remove('ready');
          confirmTitle.textContent = `${activeName} Turn (Python)`;
          confirmDetail.textContent =
            aiBackendMode === 'pyodide'
              ? loadingPyodide
                ? 'Booting in-browser Python 3 WebAssembly worker (./pyodide-worker.js → engine.py + ai.py)...'
                : 'Executing ai.py directly in your browser via Pyodide WebAssembly Worker.'
              : 'Requesting move from local Python server (./api/ai-move → ai.py).';
        }
        clearDraftBtn.disabled = true;
        confirmMoveBtn.disabled = true;
      } else if (!draftMove) {
        stepPrompt.textContent = 'Step 1 of 3: Click a highlighted square (or your gladiator to stay)';
        confirmBar.classList.remove('ready');
        confirmTitle.textContent = `${activeName}: Select Destination Square`;
        confirmDetail.textContent =
          'Click Up, Down, Left, Right, or your own square on the board. Every move requires a wall and confirmation.';
        clearDraftBtn.disabled = true;
        confirmMoveBtn.disabled = true;
      } else if (!draftWall) {
        stepPrompt.textContent = 'Step 2 of 3: Click an open border on your chosen square to place a wall';
        confirmBar.classList.remove('ready');
        confirmTitle.textContent = `${activeName}: Move ${DIR_LABELS[draftMove.moveDir]} → ${formatCoord(draftMove.row, draftMove.col)}`;
        confirmDetail.textContent =
          'Now click one of the highlighted borders around that square to place your mandatory wall.';
        clearDraftBtn.disabled = false;
        confirmMoveBtn.disabled = true;
      } else {
        stepPrompt.textContent = 'Step 3 of 3: Review on board and confirm (permanent — no undo)';
        confirmBar.classList.add('ready');
        confirmTitle.textContent = `Confirm ${activeName}: ${DIR_LABELS[draftMove.moveDir]} → ${formatCoord(draftMove.row, draftMove.col)} + ${WALL_LABELS[draftWall]}?`;
        confirmDetail.textContent =
          'Once confirmed, this move and wall are permanent (no undo). Click Re-select to adjust before confirming.';
        clearDraftBtn.disabled = false;
        confirmMoveBtn.disabled = false;
      }
    }

    syncRuntimeNote();
    renderMoveLog();
  }

  function syncRuntimeNote() {
    if (!aiRuntimeNote) return;
    if (aiBackendMode === 'server') {
      aiRuntimeNote.innerHTML =
        '<strong>Python AI Connected (<code>ai.py</code>):</strong> Running via local <code>server.py</code>. Edit <code>custom_ai</code> in <code>ai.py</code>—changes hot-reload automatically!';
    } else if (aiBackendMode === 'pyodide') {
      aiRuntimeNote.innerHTML = pyodideReady
        ? '<strong>Python AI Ready (Pyodide WASM):</strong> Running <code>engine.py</code> &amp; <code>ai.py</code> directly in your browser via WebAssembly—no backend server required.'
        : '<strong>Python AI (Static / GitHub Pages Mode):</strong> Loading Pyodide WebAssembly Worker to run <code>engine.py</code> &amp; <code>ai.py</code> in your browser...';
    }
  }

  function renderMoveLog() {
    logList.innerHTML = '';
    if (gameState.history.length === 0) {
      const li = document.createElement('li');
      li.className = 'log-empty';
      li.textContent = 'No moves committed yet.';
      logList.appendChild(li);
      return;
    }

    for (let i = gameState.history.length - 1; i >= 0; i--) {
      const item = gameState.history[i];
      const li = document.createElement('li');
      li.className = 'log-item';

      const left = document.createElement('span');
      const tagClass = item.player === 0 ? 'p1-tag' : 'p2-tag';
      left.innerHTML = `#${item.turn} <span class="${tagClass}">P${item.player + 1}</span> ${DIR_LABELS[item.moveDir].split(' ')[0]}`;

      const right = document.createElement('span');
      right.textContent = `${formatCoord(item.to.row, item.to.col)} · ${item.wallDir}-Wall`;

      li.appendChild(left);
      li.appendChild(right);
      logList.appendChild(li);
    }
  }

  function getEdgeSegmentScreen(row, col, dir) {
    const x0 = layout.originX + col * layout.cellPx;
    const y0 = layout.originY + row * layout.cellPx;
    const x1 = x0 + layout.cellPx;
    const y1 = y0 + layout.cellPx;

    if (dir === 'N') return { x1: x0, y1: y0, x2: x1, y2: y0, cx: (x0 + x1) / 2, cy: y0 };
    if (dir === 'S') return { x1: x0, y1: y1, x2: x1, y2: y1, cx: (x0 + x1) / 2, cy: y1 };
    if (dir === 'W') return { x1: x0, y1: y0, x2: x0, y2: y1, cx: x0, cy: (y0 + y1) / 2 };
    return { x1: x1, y1: y0, x2: x1, y2: y1, cx: x1, cy: (y0 + y1) / 2 };
  }

  function pointToSegmentDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0.12, Math.min(0.88, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function hitTestDraftWall(px, py) {
    if (!draftMove) return null;
    const openWalls = Engine.getLegalWallsAt(gameState, draftMove.row, draftMove.col);
    const threshold = Math.max(13, layout.cellPx * 0.27);
    let bestDir = null;
    let bestDist = Infinity;

    for (let i = 0; i < openWalls.length; i++) {
      const dir = openWalls[i];
      const seg = getEdgeSegmentScreen(draftMove.row, draftMove.col, dir);
      const dist = pointToSegmentDist(px, py, seg.x1, seg.y1, seg.x2, seg.y2);
      if (dist <= threshold && dist < bestDist) {
        bestDist = dist;
        bestDir = dir;
      }
    }
    return bestDir;
  }

  function screenToCell(px, py) {
    const col = Math.floor((px - layout.originX) / layout.cellPx);
    const row = Math.floor((py - layout.originY) / layout.cellPx);
    if (!Engine.inBounds(gameState.rows, gameState.cols, row, col)) return null;
    return { row, col };
  }

  function handleBoardClick(px, py) {
    if (!isHumanTurn()) return;

    const legalDests = Engine.getLegalDestinations(gameState, gameState.currentPlayer);

    if (draftMove) {
      const clickedWall = hitTestDraftWall(px, py);
      if (clickedWall) {
        draftWall = clickedWall;
        syncUI();
        draw();
        return;
      }
    }

    const cell = screenToCell(px, py);
    if (!cell) return;

    const matchingDest = legalDests.find((d) => d.row === cell.row && d.col === cell.col);
    if (matchingDest) {
      const changedSquare =
        !draftMove || draftMove.row !== matchingDest.row || draftMove.col !== matchingDest.col;
      draftMove = matchingDest;
      if (changedSquare) draftWall = null;
      syncUI();
      draw();
      return;
    }

    if (draftMove) {
      const dr = cell.row - draftMove.row;
      const dc = cell.col - draftMove.col;
      let impliedDir = null;
      if (dr === -1 && dc === 0) impliedDir = 'N';
      else if (dr === 1 && dc === 0) impliedDir = 'S';
      else if (dr === 0 && dc === -1) impliedDir = 'W';
      else if (dr === 0 && dc === 1) impliedDir = 'E';

      if (impliedDir && !Engine.isEdgeBlocked(gameState, draftMove.row, draftMove.col, impliedDir)) {
        draftWall = impliedDir;
        syncUI();
        draw();
      }
    }
  }

  function commitConfirmedHumanMove() {
    if (!isHumanTurn() || !draftMove || !draftWall) return;

    const action = {
      row: draftMove.row,
      col: draftMove.col,
      moveDir: draftMove.moveDir,
      wallDir: draftWall,
    };

    if (!Engine.isValidAction(gameState, action, gameState.currentPlayer)) return;

    Engine.applyAction(gameState, action, { recordHistory: true });
    draftMove = null;
    draftWall = null;
    hoverWall = null;

    if (
      !gameState.gameOver &&
      getControllerType(gameState.currentPlayer) === 'human' &&
      (gameState.rows > 18 || gameState.cols > 18) &&
      camera.zoom > 1.3
    ) {
      focusCameraOnPlayer(gameState.currentPlayer, layout.cellPx);
    } else if (gameState.gameOver && camera.zoom > 1) {
      camera.zoom = 1;
      camera.panX = 0;
      camera.panY = 0;
      updateLayoutMetrics();
    }

    syncUI();
    draw();
    maybeTriggerAITurn(sessionId);
  }

  function sendWorkerMessage(type, payload) {
    if (!pyodideWorker) {
      pyodideWorker = new Worker('./pyodide-worker.js');
      pyodideWorker.onmessage = (event) => {
        const msg = event.data || {};
        const pending = pendingWorkerReqs.get(msg.id);
        if (!pending) return;
        pendingWorkerReqs.delete(msg.id);
        if (msg.ok) {
          pending.resolve(msg);
        } else {
          pending.reject(new Error(msg.error || 'Pyodide worker error'));
        }
      };
      pyodideWorker.onerror = (err) => {
        const message =
          (err && err.message) || 'Failed to load Pyodide WebAssembly worker (./pyodide-worker.js).';
        pendingWorkerReqs.forEach((p) => p.reject(new Error(message)));
        pendingWorkerReqs.clear();
      };
    }

    const id = ++workerReqSeq;
    return new Promise((resolve, reject) => {
      pendingWorkerReqs.set(id, { resolve, reject });
      pyodideWorker.postMessage({ id, type, payload });
    });
  }

  function ensurePyodideWorkerReady() {
    if (!pyodideInitPromise) {
      pyodideInitPromise = sendWorkerMessage('init', null)
        .then(() => {
          pyodideReady = true;
          syncUI();
        })
        .catch((err) => {
          pyodideInitPromise = null;
          throw err;
        });
    }
    return pyodideInitPromise;
  }

  function enablePyodideFallback() {
    if (aiBackendMode !== 'pyodide') {
      aiBackendMode = 'pyodide';
      syncUI();
    }
    // Pre-warm Python 3 WebAssembly in the background so it is ready when AI moves
    ensurePyodideWorkerReady().catch(() => {
      // Any initialization failure will surface cleanly if/when an AI turn runs
    });
  }

  function probeBackendRuntime() {
    if (!backendProbePromise) {
      backendProbePromise = (async () => {
        try {
          const res = await fetch('./api/health', { method: 'GET', cache: 'no-store' });
          const contentType = res.headers.get('content-type') || '';
          if (res.ok && contentType.includes('application/json')) {
            const data = await res.json();
            if (data && data.status === 'ok') {
              aiBackendMode = 'server';
              syncUI();
              return 'server';
            }
          }
        } catch (_) {
          // Static host or offline server -> switch to Pyodide Web Worker
        }
        enablePyodideFallback();
        return 'pyodide';
      })();
    }
    return backendProbePromise;
  }

  async function requestPyodideAIMove(payload) {
    await ensurePyodideWorkerReady();
    const res = await sendWorkerMessage('ai-move', payload);
    return res.data.action;
  }

  async function requestPythonAIMove(state, agentType) {
    const payload = {
      agentType,
      state: {
        rows: state.rows,
        cols: state.cols,
        walls: Array.from(state.walls),
        players: state.players,
        currentPlayer: state.currentPlayer,
        turnNumber: state.turnNumber,
      },
    };

    if (aiBackendMode === 'probing') {
      await probeBackendRuntime();
    }

    if (aiBackendMode === 'server') {
      let response;
      try {
        response = await fetch('./api/ai-move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (_) {
        // Local server stopped or unreachable -> fall back to in-browser Pyodide
        enablePyodideFallback();
        return requestPyodideAIMove(payload);
      }

      const contentType = response.headers.get('content-type') || '';
      if (
        response.status === 404 ||
        response.status === 405 ||
        response.status === 501 ||
        !contentType.includes('application/json')
      ) {
        // Hosted statically (e.g. GitHub Pages) -> fall back to in-browser Pyodide
        enablePyodideFallback();
        return requestPyodideAIMove(payload);
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Python AI server returned HTTP ${response.status}`);
      }
      return data.action;
    }

    return requestPyodideAIMove(payload);
  }

  async function maybeTriggerAITurn(activeSession) {
    if (activeSession !== sessionId || gameState.gameOver || aiBusy || aiError) return;
    const ctrlType = getControllerType(gameState.currentPlayer);
    if (ctrlType === 'human') return;

    aiBusy = true;
    aiPreview = null;
    syncUI();
    draw();

    const bothAI = getControllerType(0) !== 'human' && getControllerType(1) !== 'human';
    const minDelayMs = bothAI ? 80 : 180;
    const previewMs = bothAI ? 90 : 240;

    try {
      const [chosen] = await Promise.all([
        requestPythonAIMove(gameState, ctrlType),
        new Promise((resolve) => setTimeout(resolve, minDelayMs)),
      ]);
      if (activeSession !== sessionId || gameState.gameOver) return;

      if (!Engine.isValidAction(gameState, chosen, gameState.currentPlayer)) {
        throw new Error(`Invalid action returned by Python AI: ${JSON.stringify(chosen)}`);
      }

      // Show brief visual preview of Python AI's move + wall before committing
      aiPreview = chosen;
      syncUI();
      draw();

      await new Promise((resolve) => setTimeout(resolve, previewMs));
      if (activeSession !== sessionId || gameState.gameOver) return;

      aiPreview = null;
      Engine.applyAction(gameState, chosen, { recordHistory: true });

      if (gameState.gameOver && camera.zoom > 1) {
        camera.zoom = 1;
        camera.panX = 0;
        camera.panY = 0;
        updateLayoutMetrics();
      }
    } catch (err) {
      if (activeSession === sessionId) {
        aiError = err && err.message ? err.message : String(err);
      }
    } finally {
      if (activeSession === sessionId) {
        aiBusy = false;
        aiPreview = null;
        syncUI();
        draw();
        if (!aiError && !gameState.gameOver && getControllerType(gameState.currentPlayer) !== 'human') {
          maybeTriggerAITurn(activeSession);
        }
      }
    }
  }

  function draw() {
    updateLayoutMetrics();
    const { width, height, dpr, cellPx, originX, originY } = layout;
    const { rows, cols, players, territoryMap, gameOver } = gameState;

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#ddd4c5';
    ctx.fillRect(0, 0, width, height);

    const boardW = cols * cellPx;
    const boardH = rows * cellPx;

    ctx.save();
    ctx.shadowColor = 'rgba(32, 22, 14, 0.16)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#f8f4ec';
    ctx.fillRect(originX, originY, boardW, boardH);
    ctx.restore();

    for (let r = 0; r < rows; r++) {
      const y = originY + r * cellPx;
      if (y + cellPx < 0 || y > height) continue;

      for (let c = 0; c < cols; c++) {
        const x = originX + c * cellPx;
        if (x + cellPx < 0 || x > width) continue;

        const tVal = territoryMap ? territoryMap[r * cols + c] : -1;
        const isAlt = (r + c) % 2 === 1;
        let fill = isAlt ? '#f3ede2' : '#f9f5ee';

        if (gameOver) {
          if (tVal === 0) fill = isAlt ? 'rgba(198, 69, 37, 0.24)' : 'rgba(198, 69, 37, 0.18)';
          else if (tVal === 1) fill = isAlt ? 'rgba(33, 107, 161, 0.24)' : 'rgba(33, 107, 161, 0.18)';
          else if (tVal === -2) fill = '#cfc6b8';
        } else if (tVal === -2) {
          fill = '#dad1c3';
        }

        ctx.fillStyle = fill;
        ctx.fillRect(x, y, cellPx, cellPx);
      }
    }

    const humanActive = isHumanTurn();
    const activeIdx = gameState.currentPlayer;
    const activeColor = activeIdx === 0 ? '#c64525' : '#216ba1';
    const activeSoft = activeIdx === 0 ? 'rgba(198, 69, 37, 0.16)' : 'rgba(33, 107, 161, 0.16)';

    if (humanActive) {
      const legalDests = Engine.getLegalDestinations(gameState, activeIdx);
      for (let i = 0; i < legalDests.length; i++) {
        const d = legalDests[i];
        const x = originX + d.col * cellPx;
        const y = originY + d.row * cellPx;
        const isSelected = draftMove && draftMove.row === d.row && draftMove.col === d.col;
        const isHovered = hoverCell && hoverCell.row === d.row && hoverCell.col === d.col && !hoverWall;

        ctx.fillStyle = isSelected
          ? activeIdx === 0
            ? 'rgba(198, 69, 37, 0.26)'
            : 'rgba(33, 107, 161, 0.26)'
          : isHovered
            ? activeIdx === 0
              ? 'rgba(198, 69, 37, 0.22)'
              : 'rgba(33, 107, 161, 0.22)'
            : activeSoft;

        ctx.fillRect(x + 1, y + 1, Math.max(1, cellPx - 2), Math.max(1, cellPx - 2));

        if (!isSelected && cellPx >= 14) {
          ctx.beginPath();
          ctx.arc(x + cellPx / 2, y + cellPx / 2, Math.max(2.5, cellPx * 0.09), 0, Math.PI * 2);
          ctx.fillStyle = activeColor;
          ctx.globalAlpha = d.moveDir === 'STAY' ? 0.35 : 0.6;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }

    if (gameState.lastAction && !gameOver) {
      const la = gameState.lastAction;
      const lx = originX + la.to.col * cellPx;
      const ly = originY + la.to.row * cellPx;
      ctx.strokeStyle = la.player === 0 ? 'rgba(198, 69, 37, 0.38)' : 'rgba(33, 107, 161, 0.38)';
      ctx.lineWidth = Math.max(1.5, cellPx * 0.04);
      ctx.strokeRect(lx + 2, ly + 2, Math.max(1, cellPx - 4), Math.max(1, cellPx - 4));
    }

    ctx.strokeStyle = 'rgba(84, 68, 52, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let r = 1; r < rows; r++) {
      const y = Math.round(originY + r * cellPx) + 0.5;
      ctx.moveTo(originX, y);
      ctx.lineTo(originX + boardW, y);
    }
    for (let c = 1; c < cols; c++) {
      const x = Math.round(originX + c * cellPx) + 0.5;
      ctx.moveTo(x, originY);
      ctx.lineTo(x, originY + boardH);
    }
    ctx.stroke();

    if (cellPx >= 30) {
      ctx.fillStyle = 'rgba(84, 68, 52, 0.62)';
      ctx.font = `600 ${Math.min(11, Math.max(9, Math.floor(cellPx * 0.22)))}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      for (let c = 0; c < cols; c++) ctx.fillText(`C${c + 1}`, originX + (c + 0.5) * cellPx, originY - 6);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let r = 0; r < rows; r++) ctx.fillText(`R${r + 1}`, originX - 7, originY + (r + 0.5) * cellPx);
    }

    const outerWallW = Math.max(3, Math.min(7, cellPx * 0.12));
    ctx.strokeStyle = '#3b2f26';
    ctx.lineWidth = outerWallW;
    ctx.lineJoin = 'round';
    ctx.strokeRect(originX, originY, boardW, boardH);

    const wallThickness = Math.max(3, Math.min(8, cellPx * 0.14));
    ctx.strokeStyle = '#2d231c';
    ctx.lineWidth = wallThickness;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const w = gameState.walls[r * cols + c];
        if (w === 0) continue;
        const x0 = originX + c * cellPx;
        const y0 = originY + r * cellPx;
        if ((w & 2) !== 0 && c < cols - 1) {
          ctx.moveTo(x0 + cellPx, y0);
          ctx.lineTo(x0 + cellPx, y0 + cellPx);
        }
        if ((w & 4) !== 0 && r < rows - 1) {
          ctx.moveTo(x0, y0 + cellPx);
          ctx.lineTo(x0 + cellPx, y0 + cellPx);
        }
      }
    }
    ctx.stroke();

    if (gameState.lastAction) {
      const la = gameState.lastAction;
      const seg = getEdgeSegmentScreen(la.to.row, la.to.col, la.wallDir);
      ctx.strokeStyle = la.player === 0 ? '#9e3318' : '#18527d';
      ctx.lineWidth = wallThickness + 1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
      ctx.stroke();
    }

    const activeDraftMove = humanActive ? draftMove : aiPreview;
    const activeDraftWall = humanActive ? draftWall : aiPreview ? aiPreview.wallDir : null;

    if (humanActive && draftMove) {
      const openWalls = Engine.getLegalWallsAt(gameState, draftMove.row, draftMove.col);
      for (let i = 0; i < openWalls.length; i++) {
        const dir = openWalls[i];
        const seg = getEdgeSegmentScreen(draftMove.row, draftMove.col, dir);
        const isChosen = draftWall === dir;
        const isHover = hoverWall === dir;
        const dx = seg.x2 - seg.x1;
        const dy = seg.y2 - seg.y1;
        const inset = 0.12;

        ctx.save();
        ctx.lineCap = 'round';
        if (isChosen) {
          ctx.strokeStyle = '#d98218';
          ctx.lineWidth = Math.max(5, wallThickness + 3);
          ctx.beginPath();
          ctx.moveTo(seg.x1, seg.y1);
          ctx.lineTo(seg.x2, seg.y2);
          ctx.stroke();
        } else {
          ctx.strokeStyle = isHover ? 'rgba(217, 130, 24, 0.85)' : 'rgba(217, 130, 24, 0.48)';
          ctx.lineWidth = Math.max(4, wallThickness + (isHover ? 2 : 0));
          if (!isHover) ctx.setLineDash([Math.max(3, cellPx * 0.1), Math.max(3, cellPx * 0.08)]);
          ctx.beginPath();
          ctx.moveTo(seg.x1 + dx * inset, seg.y1 + dy * inset);
          ctx.lineTo(seg.x2 - dx * inset, seg.y2 - dy * inset);
          ctx.stroke();
        }

        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(seg.cx, seg.cy, Math.max(3.5, Math.min(6, cellPx * 0.11)), 0, Math.PI * 2);
        ctx.fillStyle = isChosen ? '#b8680a' : isHover ? '#d98218' : '#e69d38';
        ctx.fill();
        ctx.restore();
      }
    } else if (aiPreview) {
      const seg = getEdgeSegmentScreen(aiPreview.row, aiPreview.col, aiPreview.wallDir);
      ctx.save();
      ctx.strokeStyle = '#d98218';
      ctx.lineWidth = Math.max(5, wallThickness + 3);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
      ctx.stroke();
      ctx.restore();
    }

    for (let p = 0; p < 2; p++) {
      const pos = players[p];
      const isMovingThisTurn =
        p === activeIdx &&
        activeDraftMove &&
        (activeDraftMove.row !== pos.row || activeDraftMove.col !== pos.col);

      drawPawn(
        originX + (pos.col + 0.5) * cellPx,
        originY + (pos.row + 0.5) * cellPx,
        cellPx,
        p,
        isMovingThisTurn ? 0.35 : 1,
        !gameOver && p === activeIdx && !activeDraftMove
      );
    }

    if (activeDraftMove) {
      const curPos = players[activeIdx];
      if (activeDraftMove.moveDir !== 'STAY') {
        ctx.save();
        ctx.strokeStyle = activeColor;
        ctx.lineWidth = Math.max(2, cellPx * 0.06);
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(originX + (curPos.col + 0.5) * cellPx, originY + (curPos.row + 0.5) * cellPx);
        ctx.lineTo(
          originX + (activeDraftMove.col + 0.5) * cellPx,
          originY + (activeDraftMove.row + 0.5) * cellPx
        );
        ctx.stroke();
        ctx.restore();
      }

      drawPawn(
        originX + (activeDraftMove.col + 0.5) * cellPx,
        originY + (activeDraftMove.row + 0.5) * cellPx,
        cellPx,
        activeIdx,
        0.92,
        true
      );
    }

    ctx.restore();
  }

  function drawPawn(cx, cy, cellPx, playerIdx, alpha, showActiveRing) {
    const radius = Math.max(4, Math.min(cellPx * 0.34, 26));
    const fillMain = playerIdx === 0 ? '#c64525' : '#216ba1';
    const strokeDark = playerIdx === 0 ? '#7d2611' : '#123f61';

    ctx.save();
    ctx.globalAlpha = alpha;

    if (showActiveRing) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius + Math.max(2.5, cellPx * 0.06), 0, Math.PI * 2);
      ctx.strokeStyle = playerIdx === 0 ? 'rgba(198, 69, 37, 0.45)' : 'rgba(33, 107, 161, 0.45)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = fillMain;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, radius * 0.14);
    ctx.strokeStyle = strokeDark;
    ctx.stroke();

    if (radius >= 8) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.68, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 250, 240, 0.45)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    if (radius >= 11) {
      ctx.fillStyle = '#fffaf3';
      ctx.font = `700 ${Math.round(radius * 0.88)}px Cinzel, Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(playerIdx === 0 ? 'I' : 'II', cx, cy + 0.5);
    }

    ctx.restore();
  }

  function getCanvasPointer(evt) {
    const rect = canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  canvas.addEventListener('pointerdown', (evt) => {
    if (evt.button !== 0 && evt.pointerType === 'mouse') return;
    canvas.setPointerCapture(evt.pointerId);
    camera.isDragging = true;
    camera.movedDuringDrag = false;
    camera.dragStartX = evt.clientX;
    camera.dragStartY = evt.clientY;
    camera.panStartX = camera.panX;
    camera.panStartY = camera.panY;
  });

  canvas.addEventListener('pointermove', (evt) => {
    const pt = getCanvasPointer(evt);

    if (camera.isDragging) {
      const dx = evt.clientX - camera.dragStartX;
      const dy = evt.clientY - camera.dragStartY;
      if (Math.hypot(dx, dy) > 5) camera.movedDuringDrag = true;
      if (camera.movedDuringDrag && camera.zoom > 1) {
        camera.panX = camera.panStartX + dx;
        camera.panY = camera.panStartY + dy;
        clampPan();
        draw();
        return;
      }
    }

    if (!isHumanTurn()) {
      hoverCell = null;
      hoverWall = null;
      return;
    }

    const prevHoverWall = hoverWall;
    const prevHoverRow = hoverCell ? hoverCell.row : -1;
    const prevHoverCol = hoverCell ? hoverCell.col : -1;

    hoverWall = draftMove ? hitTestDraftWall(pt.x, pt.y) : null;
    hoverCell = screenToCell(pt.x, pt.y);

    const cellChanged =
      (hoverCell ? hoverCell.row : -1) !== prevHoverRow ||
      (hoverCell ? hoverCell.col : -1) !== prevHoverCol;

    if (hoverWall !== prevHoverWall || cellChanged) {
      draw();
    }
  });

  canvas.addEventListener('pointerup', (evt) => {
    if (!camera.isDragging) return;
    const wasDrag = camera.movedDuringDrag && camera.zoom > 1;
    camera.isDragging = false;
    camera.movedDuringDrag = false;
    if (!wasDrag) {
      const pt = getCanvasPointer(evt);
      handleBoardClick(pt.x, pt.y);
    }
  });

  canvas.addEventListener('pointerleave', () => {
    if (!camera.isDragging && (hoverWall || hoverCell)) {
      hoverWall = null;
      hoverCell = null;
      draw();
    }
  });

  canvas.addEventListener(
    'wheel',
    (evt) => {
      evt.preventDefault();
      const factor = evt.deltaY < 0 ? 1.18 : 1 / 1.18;
      const nextZoom = Math.max(1, Math.min(8, camera.zoom * factor));
      if (Math.abs(nextZoom - camera.zoom) < 0.001) return;

      const pt = getCanvasPointer(evt);
      const wx = pt.x - layout.width / 2 - camera.panX;
      const wy = pt.y - layout.height / 2 - camera.panY;
      const ratio = nextZoom / camera.zoom;

      camera.zoom = nextZoom;
      camera.panX = nextZoom === 1 ? 0 : pt.x - layout.width / 2 - wx * ratio;
      camera.panY = nextZoom === 1 ? 0 : pt.y - layout.height / 2 - wy * ratio;
      clampPan();
      draw();
    },
    { passive: false }
  );

  confirmMoveBtn.addEventListener('click', commitConfirmedHumanMove);

  clearDraftBtn.addEventListener('click', () => {
    if (!isHumanTurn()) return;
    draftMove = null;
    draftWall = null;
    hoverWall = null;
    syncUI();
    draw();
  });

  newGameBtn.addEventListener('click', () => {
    startNewGame(rowsInput.value, colsInput.value);
  });

  modeSelect.addEventListener('change', () => {
    gameMode = modeSelect.value;
    startNewGame(rowsInput.value, colsInput.value);
  });

  document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [r, c] = btn.getAttribute('data-preset').split('x').map(Number);
      startNewGame(r, c);
    });
  });

  zoomInBtn.addEventListener('click', () => {
    camera.zoom = Math.min(8, camera.zoom * 1.35);
    clampPan();
    draw();
  });

  zoomOutBtn.addEventListener('click', () => {
    camera.zoom = Math.max(1, camera.zoom / 1.35);
    if (camera.zoom === 1) {
      camera.panX = 0;
      camera.panY = 0;
    } else {
      clampPan();
    }
    draw();
  });

  fitBoardBtn.addEventListener('click', () => {
    camera.zoom = 1;
    camera.panX = 0;
    camera.panY = 0;
    draw();
  });

  focusTurnBtn.addEventListener('click', () => {
    focusCameraOnPlayer(gameState.currentPlayer, 44);
    draw();
  });

  window.addEventListener('resize', () => {
    clampPan();
    draw();
  });

  // Probe local Python server (`./api/health`) vs. static GitHub Pages Pyodide mode, then boot 5x10 arena
  probeBackendRuntime();
  startNewGame(Engine.DEFAULT_ROWS, Engine.DEFAULT_COLS);
})();
