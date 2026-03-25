# Poker Platform

A full-stack poker platform with a React frontend and a FastAPI WebSocket backend, featuring blockchain-based prize payouts.

## Architecture

- **Frontend**: React + Vite (`poker-platform/`) — runs on port 5000
- **Backend**: FastAPI WebSocket server (`backend/`) — runs on port 8000
- **Database**: SQLite (`backend/casino.db`) via SQLAlchemy
- **Blockchain**: Web3 integration with Base Sepolia testnet for tournament payouts

## Project Structure

```
poker-platform/     # React + Vite frontend
  src/
    App.jsx
    main.jsx
    b25poker.jsx    # Main poker component
  vite.config.js    # Configured for Replit (host: 0.0.0.0, port: 5000, allowedHosts: true)

backend/            # FastAPI Python backend
  main.py           # WebSocket server + game room management
  engine.py         # Poker game engine
  evaluator.py      # Hand evaluator
  blockchain.py     # Web3 payout integration
  database.py       # SQLAlchemy setup (SQLite by default)
  models.py         # Player DB model
  requirements.txt  # Python dependencies
  .env              # Blockchain credentials (Base Sepolia)
```

## Workflows

- **Start application** (webview, port 5000): `cd poker-platform && npm run dev`
- **Backend API** (console, port 8000): `cd backend && uvicorn main:app --host 0.0.0.0 --port 8000 --reload`

## Key Features

- Real-time multiplayer poker via WebSockets
- Player bankroll persistence in SQLite database
- Tournament mode with automatic blockchain payouts
- MetaMask wallet connection support (Web3/ethers.js)
- Cash game and tournament modes

## Dependencies

### Frontend (npm)
- React 19, React DOM
- ethers.js v6 (Web3/wallet integration)
- Vite 7, @vitejs/plugin-react

### Backend (pip)
- FastAPI + Uvicorn
- SQLAlchemy
- web3.py
- python-dotenv
- psycopg2-binary (for optional PostgreSQL)

## Environment Variables (backend/.env)

- `BASE_SEPOLIA_RPC` — RPC URL for Base Sepolia network
- `SERVER_PRIVATE_KEY` — Server wallet private key for signing payouts
- `ESCROW_CONTRACT_ADDRESS` — Deployed escrow smart contract address
- `DATABASE_URL` — Optional; defaults to SQLite `./casino.db`
