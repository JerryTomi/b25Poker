import random
import time
from typing import Dict, List, Optional
from evaluator import best_hand, compare_tiebreaks

SUITS = ["♠", "♥", "♦", "♣"]
RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]
RANK_VAL = {r: i + 2 for i, r in enumerate(RANKS)}

class PokerEngine:
    def __init__(self, table_id: str, mode: str = "cash", max_seats: int = 6):
        self.table_id = table_id
        self.mode = mode
        self.max_seats = max_seats
        
        self.tournament_state = "waiting"
        self.blind_levels = [(20, 40), (50, 100), (100, 200), (200, 400), (500, 1000), (1000, 2000)]
        self.current_blind_idx = 0
        self.blind_timer = 60 
        self.last_blind_time = time.time()
        
        self.lobby_start_time = None 
        
        self.seats: List[Optional[str]] = [None] * max_seats
        self.players: Dict[str, Dict] = {} 
        
        self.deck: List[Dict] = []
        self.community_cards: List[Dict] = []
        self.pot = 0
        self.phase = "preflop"
        self.current_turn = None 
        self.dealer_idx = -1  
        self.small_blind = self.blind_levels[0][0] if mode == "tournament" else 20
        self.big_blind = self.blind_levels[0][1] if mode == "tournament" else 40
        self.highest_bet = 0
        self.hand_over = False
        self.result = None

    def _update_lobby_timer(self):
        if self.tournament_state != "waiting":
            return

        active_count = sum(1 for p in self.seats if p and self.players[p]["stack"] > 0)
        wait_secs = 10 if self.mode == "cash" else 15

        if active_count >= 2:
            if self.lobby_start_time is None:
                self.lobby_start_time = time.time() + wait_secs

            if active_count == self.max_seats:
                time_left = self.lobby_start_time - time.time()
                if time_left > 3:
                    self.lobby_start_time = time.time() + 3
        else:
            self.lobby_start_time = None

    def add_player(self, player_id: str, buy_in: int):
        if self.mode == "tournament" and self.tournament_state != "waiting":
            return False 
            
        if player_id in self.players:
            return False
            
        try:
            empty_idx = self.seats.index(None)
            self.seats[empty_idx] = player_id
            self.players[player_id] = {
                "seat": empty_idx, "stack": buy_in, "hole_cards": [], 
                "bet": 0, "active": False, "folded": False, 
                "has_acted": False, "eliminated": False 
            }
            self._update_lobby_timer() 
            return True
        except ValueError:
            return False 

    def remove_player(self, player_id: str):
        if player_id in self.players:
            if self.current_turn == player_id and not self.hand_over:
                self.process_action(player_id, "fold")
            
            if self.mode == "tournament":
                self.players[player_id]["eliminated"] = True
                self.players[player_id]["stack"] = 0
            else:
                seat_idx = self.players[player_id]["seat"]
                self.seats[seat_idx] = None
                del self.players[player_id]
                
            self._update_lobby_timer() 

    def _get_next_occupied_seat(self, start_idx: int) -> int:
        for i in range(1, self.max_seats + 1):
            idx = (start_idx + i) % self.max_seats
            pid = self.seats[idx]
            if pid and self.players[pid]["stack"] > 0 and not self.players[pid]["eliminated"]:
                return idx
        return start_idx

    def _get_next_active_player(self, start_id: str) -> str:
        if not start_id: return None
        start_idx = self.players[start_id]["seat"]
        for i in range(1, self.max_seats + 1):
            idx = (start_idx + i) % self.max_seats
            pid = self.seats[idx]
            if pid and self.players[pid]["active"] and not self.players[pid]["folded"] and not self.players[pid]["eliminated"] and self.players[pid]["stack"] > 0:
                return pid
        return None

    def start_hand(self):
        # 🛡️ FIXED: Never restart a hand that is actively being played!
        if not getattr(self, "hand_over", True) and getattr(self, "pot", 0) > 0:
            return False
            
        active_players = [p for p in self.seats if p and not self.players[p]["eliminated"] and self.players[p]["stack"] > 0]
        
        if self.tournament_state == "waiting":
            if len(active_players) >= 2:
                self.tournament_state = "running"
                self.last_blind_time = time.time()
                self.lobby_start_time = None
            else:
                return False

        if self.mode == "tournament":
            if self.tournament_state == "finished":
                return False

            if len(active_players) <= 1:
                self.tournament_state = "finished"
                self.hand_over = True
                self.result = {"winners": active_players, "reason": "tournament_win", "hands": {}, "amount": 0}
                return False

            if time.time() - self.last_blind_time >= self.blind_timer:
                self.current_blind_idx = min(self.current_blind_idx + 1, len(self.blind_levels) - 1)
                self.small_blind, self.big_blind = self.blind_levels[self.current_blind_idx]
                self.last_blind_time = time.time()
        else:
            if len(active_players) < 2: return False

        self.deck = [{"suit": s, "rank": r, "val": RANK_VAL[r]} for s in SUITS for r in RANKS]
        random.shuffle(self.deck)
        
        self.community_cards = []
        self.pot = 0
        self.phase = "preflop"
        self.hand_over = False
        self.result = None
        
        for pid, pdata in self.players.items():
            pdata["bet"] = 0
            pdata["has_acted"] = False
            pdata["folded"] = False
            if pdata["stack"] > 0 and not pdata["eliminated"]:
                pdata["active"] = True
                pdata["hole_cards"] = [self.deck.pop(), self.deck.pop()]
            else:
                pdata["active"] = False

        self.dealer_idx = self._get_next_occupied_seat(self.dealer_idx)
        sb_idx = self._get_next_occupied_seat(self.dealer_idx)
        bb_idx = self._get_next_occupied_seat(sb_idx)
        
        sb_pid = self.seats[sb_idx]
        bb_pid = self.seats[bb_idx]

        sb_amt = min(self.small_blind, self.players[sb_pid]["stack"])
        self.players[sb_pid]["stack"] -= sb_amt
        self.players[sb_pid]["bet"] = sb_amt

        bb_amt = min(self.big_blind, self.players[bb_pid]["stack"])
        self.players[bb_pid]["stack"] -= bb_amt
        self.players[bb_pid]["bet"] = bb_amt

        self.highest_bet = self.big_blind
        self.current_turn = self._get_next_active_player(bb_pid)
        return True

    def process_action(self, player_id: str, action: str, amount: int = 0):
        if self.hand_over or self.current_turn != player_id: return

        p_data = self.players[player_id]
        call_amt = max(0, self.highest_bet - p_data["bet"])

        if action == "fold":
            p_data["folded"] = True
            p_data["has_acted"] = True
        elif action == "check":
            if call_amt > 0: return 
            p_data["has_acted"] = True
        elif action == "call":
            actual = min(call_amt, p_data["stack"])
            p_data["stack"] -= actual
            p_data["bet"] += actual
            p_data["has_acted"] = True
        elif action in ["bet", "raise", "allin"]:
            bet_amt = p_data["stack"] if action == "allin" else min(amount, p_data["stack"])
            
            # 🛡️ FIXED: Auto-correct bad slider inputs to a simple Call instead of freezing!
            if bet_amt + p_data["bet"] <= self.highest_bet and action != "allin":
                actual = min(call_amt, p_data["stack"])
                p_data["stack"] -= actual
                p_data["bet"] += actual
                p_data["has_acted"] = True
            else:
                p_data["stack"] -= bet_amt
                p_data["bet"] += bet_amt
                self.highest_bet = max(self.highest_bet, p_data["bet"])
                p_data["has_acted"] = True
                
                for pid, d in self.players.items():
                    if pid != player_id and d["active"] and not d["folded"] and d["stack"] > 0:
                        d["has_acted"] = False

        self._check_phase_advance()

    def _check_phase_advance(self):
        active_in_hand = [pid for pid, d in self.players.items() if d["active"] and not d["folded"]]
        
        if len(active_in_hand) == 1:
            self._award_pot([active_in_hand[0]], reason="fold")
            return

        round_over = True
        for pid in active_in_hand:
            d = self.players[pid]
            if d["stack"] > 0: 
                if not d["has_acted"] or d["bet"] < self.highest_bet:
                    round_over = False
                    break

        if round_over:
            for d in self.players.values():
                self.pot += d["bet"]
                d["bet"] = 0
            self.highest_bet = 0
            
            self.advance_phase()
            
            players_with_chips = [pid for pid in active_in_hand if self.players[pid]["stack"] > 0]
            if len(players_with_chips) <= 1 and self.phase != "showdown" and not self.hand_over:
                while self.phase != "showdown" and not self.hand_over:
                    self.advance_phase()
            else:
                dealer_pid = self.seats[self.dealer_idx]
                self.current_turn = self._get_next_active_player(dealer_pid)
        else:
            self.current_turn = self._get_next_active_player(self.current_turn)

    def advance_phase(self):
        if self.hand_over: return
        for d in self.players.values(): d["has_acted"] = False

        if self.phase == "preflop":
            self.phase = "flop"
            self.community_cards.extend([self.deck.pop() for _ in range(3)])
        elif self.phase == "flop":
            self.phase = "turn"
            self.community_cards.append(self.deck.pop())
        elif self.phase == "turn":
            self.phase = "river"
            self.community_cards.append(self.deck.pop())
        elif self.phase == "river":
            self.phase = "showdown"
            self._evaluate_showdown()

    def _evaluate_showdown(self):
        contenders = [pid for pid, d in self.players.items() if d["active"] and not d["folded"]]
        best_rank = -1
        winners = []
        best_hands = {}

        for pid in contenders:
            h = best_hand(self.players[pid]["hole_cards"], self.community_cards)
            best_hands[pid] = h
            
            if not winners:
                winners = [pid]
                best_rank = h["rank"]
            elif h["rank"] > best_rank:
                winners = [pid]
                best_rank = h["rank"]
            elif h["rank"] == best_rank:
                tb = compare_tiebreaks(h["tiebreak"], best_hands[winners[0]]["tiebreak"])
                if tb > 0: winners = [pid]
                elif tb == 0: winners.append(pid) 

        self._award_pot(winners, reason="showdown", hands=best_hands)

    def _award_pot(self, winners: List[str], reason: str, hands: dict = None):
        self.hand_over = True
        self.current_turn = None
        
        for d in self.players.values():
            self.pot += d["bet"]
            d["bet"] = 0
        
        split_amt = self.pot // len(winners)
        remainder = self.pot % len(winners)
        for i, w in enumerate(winners):
            self.players[w]["stack"] += split_amt + (1 if i == 0 else 0) * remainder
            
        if self.mode == "tournament":
            for d in self.players.values():
                if d["stack"] <= 0:
                    d["eliminated"] = True
        
        self.result = {"winners": winners, "reason": reason, "hands": hands if hands else {}, "amount": split_amt}

    def get_game_state(self, viewer_id: str = None) -> dict:
        safe_players = {}
        for pid, pdata in self.players.items():
            is_viewer = (pid == viewer_id)
            show_cards = is_viewer or (self.phase == "showdown" and pdata["active"] and not pdata["folded"])
            
            safe_players[pid] = {
                "seat": pdata["seat"], "stack": pdata["stack"], "bet": pdata["bet"],
                "active": pdata["active"], "folded": pdata["folded"], "eliminated": pdata.get("eliminated", False),
                "is_turn": self.current_turn == pid,
                "hole_cards": pdata["hole_cards"] if show_cards else [{"hidden": True}, {"hidden": True}] if pdata["active"] and not pdata["folded"] else []
            }
            
        dealer_pid = self.seats[self.dealer_idx] if self.dealer_idx >= 0 else None
        time_to_next = int(self.blind_timer - (time.time() - self.last_blind_time)) if self.tournament_state == "running" else 0
        
        lobby_countdown = 0
        if self.tournament_state == "waiting" and self.lobby_start_time:
            lobby_countdown = max(0, int(self.lobby_start_time - time.time()))

        return {
            "table_id": self.table_id, "mode": self.mode, "tournament_state": self.tournament_state,
            "phase": self.phase, "pot": self.pot, "community_cards": self.community_cards,
            "players": safe_players, "current_turn": self.current_turn, "dealer": dealer_pid,
            "highest_bet": self.highest_bet, "small_blind": self.small_blind, "big_blind": self.big_blind,
            "next_blind_sec": max(0, time_to_next), "viewer_id": viewer_id, 
            "lobby_countdown": lobby_countdown,
            "handOver": getattr(self, "hand_over", False), "result": getattr(self, "result", None)
        }