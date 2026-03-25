from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from typing import Dict, List
import json
import uuid
import os
from engine import PokerEngine

# --- Database & Web3 Imports ---
import models
from database import engine, SessionLocal
import blockchain  # 👈 The Oracle Bridge

# Create the database file if it doesn't exist
models.Base.metadata.create_all(bind=engine)

app = FastAPI()
active_games: Dict[str, PokerEngine] = {}

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[dict]] = {}

    async def connect(self, websocket: WebSocket, table_id: str, player_id: str):
        await websocket.accept()
        if table_id not in self.active_connections:
            self.active_connections[table_id] = []
        self.active_connections[table_id].append({"ws": websocket, "player_id": player_id})

    def disconnect(self, websocket: WebSocket, table_id: str):
        if table_id in self.active_connections:
            self.active_connections[table_id] = [c for c in self.active_connections[table_id] if c["ws"] != websocket]
            if not self.active_connections[table_id]:
                del self.active_connections[table_id]

    async def broadcast_state(self, table_id: str, game_engine: PokerEngine):
        if table_id in self.active_connections:
            for conn in self.active_connections[table_id][:]:
                try:
                    safe_state = game_engine.get_game_state(viewer_id=conn["player_id"])
                    await conn["ws"].send_text(json.dumps({"type": "game_state", "data": safe_state}))
                except Exception:
                    self.disconnect(conn["ws"], table_id)

manager = ConnectionManager()

@app.websocket("/ws/table/{table_id}")
async def websocket_endpoint(websocket: WebSocket, table_id: str, mode: str = "cash", wallet: str = None):
    
    # 🦊 THE WEB3 UPGRADE: Use their real wallet address if they connected one!
    player_id = wallet.lower() if wallet else f"player_{uuid.uuid4().hex[:6]}"
    room_key = f"{table_id}-{mode}"
    
    # ==========================================
    # 🏦 THE CASHIER: DB LOOKUP & BUY-IN
    # ==========================================
    db = SessionLocal()
    db_player = db.query(models.PlayerDB).filter(models.PlayerDB.id == player_id).first()
    
    # 1. If new player, create their account with 10,000 chips
    if not db_player:
        db_player = models.PlayerDB(id=player_id, chip_balance=10000)
        db.add(db_player)
        db.commit()
        db.refresh(db_player)
        
    # 2. Check if they have enough to buy in
    buy_in_amount = 1000
    if db_player.chip_balance < buy_in_amount:
        await websocket.accept()
        await websocket.close(code=1008, reason="Insufficient funds in Bankroll")
        db.close()
        return
        
    # 3. Deduct buy-in from their DB bankroll
    db_player.chip_balance -= buy_in_amount
    db.commit()
    # ==========================================

    # --- Table Management ---
    if room_key in active_games:
        if getattr(active_games[room_key], "tournament_state", "") == "finished":
            del active_games[room_key]
            
    if room_key not in active_games:
        active_games[room_key] = PokerEngine(room_key, mode=mode)
        
    game_engine = active_games[room_key]
    
    # Sit the player down with the chips we just deducted
    success = game_engine.add_player(player_id, buy_in_amount)
    if not success:
        # If the table is full, refund the buy-in to the DB before rejecting them!
        db_player.chip_balance += buy_in_amount
        db.commit()
        db.close()
        await websocket.accept()
        await websocket.close(code=1008, reason="Table full or registration closed")
        return
        
    await manager.connect(websocket, room_key, player_id)
    await manager.broadcast_state(room_key, game_engine)
    
    try:
        while True:
            data = await websocket.receive_text()
            try:
                payload = json.loads(data)
                action = payload.get("action")
                amount = int(payload.get("amount", 0))
                
                if action == "start_tournament":
                    game_engine.start_hand()
                    await manager.broadcast_state(room_key, game_engine)
                    continue

                if action == "new_hand":
                    game_engine.start_hand()
                    await manager.broadcast_state(room_key, game_engine)
                    continue

                if action in ["fold", "check", "call", "bet", "raise", "allin"]:
                    game_engine.process_action(player_id, action, amount)
                    await manager.broadcast_state(room_key, game_engine)
                    
                    # ==========================================
                    # 🏆 THE ORACLE: PAYOUT TRIGGER
                    # ==========================================
                    # Check if the tournament just finished, and make sure we haven't paid out yet
                    if getattr(game_engine, "tournament_state", "") == "finished" and not getattr(game_engine, "payout_triggered", False):
                        game_engine.payout_triggered = True # Lock it so we don't double-pay!
                        
                        # Get the winner's wallet address from the results
                        winners = getattr(game_engine, "result", {}).get("winners", [])
                        if winners:
                            winner_wallet = winners[0]
                            print(f"🎉 Tournament over! Initiating payout for {winner_wallet}")
                            
                            # Run the payout! 
                            blockchain.payout_winner(table_id, winner_wallet)
                    # ==========================================
                    
            except Exception as e:
                print(f"Ignored invalid action payload: {e}")
                
    except WebSocketDisconnect:
        pass # Handled in the finally block below
    except Exception as e:
        print(f"Connection Error: {e}")
    finally:
        # ==========================================
        # 🏦 THE CASHIER: CASH OUT
        # ==========================================
        if player_id in game_engine.players:
            final_stack = game_engine.players[player_id]["stack"]
            db_player.chip_balance += final_stack
            db.commit()
            
        db.close()
        # ==========================================
        
        game_engine.remove_player(player_id)
        manager.disconnect(websocket, room_key)
        await manager.broadcast_state(room_key, game_engine)

# ─── SERVE BUILT FRONTEND (production) ───────────────────────────────────────
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(STATIC_DIR):
    assets_dir = os.path.join(STATIC_DIR, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="static-assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = os.path.join(STATIC_DIR, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))