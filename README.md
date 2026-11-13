# Colosseum Game

> **Note:** Reupload from a Nov 2023 project to code an AI agent for a zero-sum game. The game and UI is completed AI generated to showcase the AI agent.

Try the game at https://peggykuo.github.io/colosseum-game/

A two-player zero-sum territory strategy game with an HTML5 `<canvas>` UI and Python AI backend.

## Rules

- **Setup:** Two players start on opposite ends of a grid (default `5 × 10`) and alternate turns.
- **Turn:** Move up to **1 orthogonal step** (or stay in place) without crossing walls or the opponent, then place **1 permanent wall** on an open border of your destination square.
- **Win Condition:** The game ends when walls completely separate both players. Each player scores 1 point per reachable square in their enclosed territory; highest score wins.

## Quick Start

Run locally with Python 3.8+ (standard library only):

```bash
python3 server.py
```

Open `http://localhost:8000`. Edits to `custom_ai(state)` in `ai.py` hot-reload automatically. Also works as a static site.
