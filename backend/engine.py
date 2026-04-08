import secrets
import time
from typing import Dict, List, Optional

from evaluator import best_hand, compare_tiebreaks

SUITS = ["S", "H", "D", "C"]
RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]
RANK_VAL = {rank: index + 2 for index, rank in enumerate(RANKS)}


class PokerEngine:
    def __init__(self, table_id: str, mode: str = "tournament_sng", max_seats: int = 6, small_blind: int = 20, big_blind: int = 40):
        self.table_id = table_id
        self.mode = mode
        self.max_seats = max_seats
        self.seats: List[Optional[str]] = [None] * max_seats
        self.players: Dict[str, Dict] = {}
        self.deck: List[Dict] = []
        self.community_cards: List[Dict] = []
        self.pot = 0
        self.phase = "waiting"
        self.current_turn: Optional[str] = None
        self.current_turn_started_at = time.time()
        self.dealer_idx = -1
        self.small_blind = small_blind
        self.big_blind = big_blind
        self.highest_bet = 0
        self.min_raise = 0
        self.hand_over = True
        self.result = None
        self.hand_number = 0

    def active_player_ids(self) -> List[str]:
        return [
            pid
            for pid, pdata in self.players.items()
            if pdata["stack"] > 0 and not pdata["eliminated"]
        ]

    def add_player(self, player_id: str, buy_in: int, seat_index: Optional[int] = None) -> bool:
        if player_id in self.players:
            return False

        try:
            if seat_index is None:
                seat_index = self.seats.index(None)
            elif self.seats[seat_index] is not None:
                return False
        except ValueError:
            return False

        self.seats[seat_index] = player_id
        self.players[player_id] = {
            "seat": seat_index,
            "stack": buy_in,
            "hole_cards": [],
            "bet": 0,
            "invested": 0,
            "active": False,
            "folded": False,
            "has_acted": False,
            "eliminated": False,
            "last_action": None,
        }
        return True

    def remove_player(self, player_id: str):
        pdata = self.players.get(player_id)
        if not pdata:
            return
        seat_idx = pdata["seat"]
        self.seats[seat_idx] = None
        del self.players[player_id]
        if self.current_turn == player_id:
            self.current_turn = None

    def mark_disconnected(self, player_id: str):
        pdata = self.players.get(player_id)
        if pdata:
            pdata["last_action"] = "disconnected"

    def _build_deck(self):
        self.deck = [{"suit": suit, "rank": rank, "val": RANK_VAL[rank]} for suit in SUITS for rank in RANKS]
        secrets.SystemRandom().shuffle(self.deck)

    def _get_next_occupied_seat(self, start_idx: int) -> int:
        for offset in range(1, self.max_seats + 1):
            idx = (start_idx + offset) % self.max_seats
            pid = self.seats[idx]
            if pid and self.players[pid]["stack"] > 0 and not self.players[pid]["eliminated"]:
                return idx
        return start_idx

    def _get_next_active_player(self, start_id: Optional[str]) -> Optional[str]:
        if not start_id or start_id not in self.players:
            for pid in self.active_player_ids():
                pdata = self.players[pid]
                if pdata["active"] and not pdata["folded"]:
                    return pid
            return None

        start_idx = self.players[start_id]["seat"]
        for offset in range(1, self.max_seats + 1):
            idx = (start_idx + offset) % self.max_seats
            pid = self.seats[idx]
            if not pid:
                continue
            pdata = self.players[pid]
            if pdata["active"] and not pdata["folded"] and not pdata["eliminated"] and pdata["stack"] >= 0:
                return pid
        return None

    def start_hand(self) -> bool:
        contenders = self.active_player_ids()
        if len(contenders) < 2:
            self.phase = "waiting"
            self.hand_over = True
            return False

        if self.hand_number > 0 and self.hand_number % 10 == 0:
            self.small_blind *= 2
            self.big_blind *= 2

        self.hand_number += 1
        self._build_deck()
        self.community_cards = []
        self.pot = 0
        self.phase = "preflop"
        self.hand_over = False
        self.result = None
        self.dealer_idx = self._get_next_occupied_seat(self.dealer_idx)

        for pid, pdata in self.players.items():
            pdata["bet"] = 0
            pdata["invested"] = 0
            pdata["has_acted"] = False
            pdata["folded"] = pdata["eliminated"] or pdata["stack"] <= 0
            pdata["active"] = not pdata["eliminated"] and pdata["stack"] > 0
            pdata["last_action"] = None
            pdata["hole_cards"] = [self.deck.pop(), self.deck.pop()] if pdata["active"] else []

        sb_idx = self._get_next_occupied_seat(self.dealer_idx)
        bb_idx = self._get_next_occupied_seat(sb_idx)
        sb_pid = self.seats[sb_idx]
        bb_pid = self.seats[bb_idx]

        sb_amt = min(self.small_blind, self.players[sb_pid]["stack"])
        bb_amt = min(self.big_blind, self.players[bb_pid]["stack"])
        self.players[sb_pid]["stack"] -= sb_amt
        self.players[sb_pid]["bet"] = sb_amt
        self.players[sb_pid]["last_action"] = "small_blind"
        self.players[bb_pid]["stack"] -= bb_amt
        self.players[bb_pid]["bet"] = bb_amt
        self.players[bb_pid]["last_action"] = "big_blind"

        self.highest_bet = bb_amt
        self.min_raise = self.big_blind
        self.current_turn = self._get_next_active_player(bb_pid)
        self.current_turn_started_at = time.time()
        return self.current_turn is not None

    def process_action(self, player_id: str, action: str, amount: int = 0) -> bool:
        if self.hand_over or self.current_turn != player_id or player_id not in self.players:
            return False

        pdata = self.players[player_id]
        if pdata["eliminated"] or pdata["folded"]:
            return False

        call_amt = max(0, self.highest_bet - pdata["bet"])

        if action == "fold":
            pdata["folded"] = True
        elif action == "check":
            if call_amt > 0:
                return False
        elif action == "call":
            actual = min(call_amt, pdata["stack"])
            pdata["stack"] -= actual
            pdata["bet"] += actual
        elif action in {"bet", "raise", "allin"}:
            wager = pdata["stack"] if action == "allin" else max(0, min(amount, pdata["stack"]))
            total_bet = pdata["bet"] + wager
            
            if action != "allin" and total_bet < self.highest_bet + self.min_raise:
                return False
                
            pdata["stack"] -= wager
            pdata["bet"] += wager
            
            if pdata["bet"] > self.highest_bet:
                raise_amount = pdata["bet"] - self.highest_bet
                if raise_amount >= self.min_raise or action == "allin":
                    self.min_raise = raise_amount
                    for other_id, other_data in self.players.items():
                        if other_id != player_id and other_data["active"] and not other_data["folded"] and not other_data["eliminated"]:
                            other_data["has_acted"] = False
                self.highest_bet = pdata["bet"]
        else:
            return False

        pdata["has_acted"] = True
        pdata["last_action"] = action
        self._check_phase_advance()
        return True

    def auto_act_current_player(self) -> Optional[str]:
        if not self.current_turn or self.current_turn not in self.players:
            return None
        player_id = self.current_turn
        pdata = self.players[player_id]
        call_amt = max(0, self.highest_bet - pdata["bet"])
        action = "check" if call_amt == 0 else "fold"
        self.process_action(player_id, action)
        return action

    def _check_phase_advance(self):
        contenders = [pid for pid, pdata in self.players.items() if pdata["active"] and not pdata["folded"] and not pdata["eliminated"]]
        if len(contenders) == 1:
            self._award_pot([contenders[0]], "fold")
            return

        round_over = True
        for pid in contenders:
            pdata = self.players[pid]
            if pdata["stack"] > 0 and (not pdata["has_acted"] or pdata["bet"] < self.highest_bet):
                round_over = False
                break

        if round_over:
            for pdata in self.players.values():
                self.pot += pdata["bet"]
                pdata["invested"] += pdata["bet"]
                pdata["bet"] = 0
                pdata["has_acted"] = False
            self.highest_bet = 0
            self.min_raise = self.big_blind
            self.advance_phase()
            if not self.hand_over:
                dealer_pid = self.seats[self.dealer_idx]
                self.current_turn = self._get_next_active_player(dealer_pid)
                self.current_turn_started_at = time.time()
        else:
            self.current_turn = self._get_next_active_player(self.current_turn)
            self.current_turn_started_at = time.time()

    def advance_phase(self):
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
        contenders = [pid for pid, pdata in self.players.items() if pdata["active"] and not pdata["folded"] and not pdata["eliminated"]]
        best_hands: Dict[str, Dict] = {}
        for pid in contenders:
            best_hands[pid] = best_hand(self.players[pid]["hole_cards"], self.community_cards)

        self._award_pot(contenders, "showdown", best_hands)

    def _award_pot(self, contenders: List[str], reason: str, hands: Optional[Dict] = None):
        self.hand_over = True
        self.current_turn = None
        self.phase = "showdown" if reason == "showdown" else self.phase

        for pdata in self.players.values():
            self.pot += pdata["bet"]
            pdata["invested"] += pdata["bet"]
            pdata["bet"] = 0

        payouts = {pid: 0 for pid in self.players.keys()}

        if reason == "showdown" and hands:
            contenders.sort(
                key=lambda pid: (hands[pid]["rank"], hands[pid]["tiebreak"]),
                reverse=True
            )

        while sum(p["invested"] for p in self.players.values()) > 0 and contenders:
            best_pid = contenders[0]
            tied_group = [best_pid]
            if reason == "showdown" and hands:
                for pid in contenders[1:]:
                    if hands[pid]["rank"] == hands[best_pid]["rank"] and hands[pid]["tiebreak"] == hands[best_pid]["tiebreak"]:
                        tied_group.append(pid)

            active_winners = tied_group.copy()
            while active_winners and sum(p["invested"] for p in self.players.values()) > 0:
                cap = min(self.players[pid]["invested"] for pid in active_winners)
                if cap <= 0:
                    active_winners = [pid for pid in active_winners if self.players[pid]["invested"] > 0]
                    continue
                
                sub_pot = 0
                for pdata in self.players.values():
                    contribution = min(pdata["invested"], cap)
                    sub_pot += contribution
                    pdata["invested"] -= contribution
                    
                split_amt = sub_pot // len(active_winners)
                remainder = sub_pot % len(active_winners)
                
                ordered_seats = []
                for offset in range(1, self.max_seats + 1):
                    idx = (self.dealer_idx + offset) % self.max_seats
                    if self.seats[idx]:
                        ordered_seats.append(self.seats[idx])
                
                active_winners.sort(key=lambda pid: ordered_seats.index(pid))
                
                for i, winner_id in enumerate(active_winners):
                    payouts[winner_id] += split_amt + (remainder if i == 0 else 0)

                active_winners = [pid for pid in active_winners if self.players[pid]["invested"] > 0]

            contenders = [pid for pid in contenders if pid not in tied_group]

        for pid, amt in payouts.items():
            if amt > 0:
                self.players[pid]["stack"] += amt

        for pid, pdata in self.players.items():
            if pdata["stack"] <= 0:
                pdata["eliminated"] = True
                pdata["active"] = False

        actual_winners = [pid for pid, amt in payouts.items() if amt > 0]
        actual_winners.sort(key=lambda pid: payouts[pid], reverse=True)
        max_amt = payouts[actual_winners[0]] if actual_winners else 0

        self.pot = sum(payouts.values())

        self.result = {
            "winners": actual_winners,
            "reason": reason,
            "hands": hands or {},
            "amount": max_amt,
            "hand_number": self.hand_number,
        }

    def tournament_finished(self) -> bool:
        return len(self.active_player_ids()) <= 1 and len(self.players) > 0

    def get_game_state(self, viewer_id: Optional[str] = None) -> dict:
        safe_players = {}
        for pid, pdata in self.players.items():
            is_viewer = pid == viewer_id
            show_cards = is_viewer or (self.hand_over and pdata["active"] and not pdata["folded"])
            safe_players[pid] = {
                "seat": pdata["seat"],
                "stack": pdata["stack"],
                "bet": pdata["bet"],
                "active": pdata["active"],
                "folded": pdata["folded"],
                "eliminated": pdata["eliminated"],
                "is_turn": self.current_turn == pid,
                "last_action": pdata["last_action"],
                "hole_cards": pdata["hole_cards"] if show_cards else ([{"hidden": True}, {"hidden": True}] if pdata["active"] and not pdata["folded"] else []),
            }

        dealer_pid = self.seats[self.dealer_idx] if self.dealer_idx >= 0 else None
        return {
            "table_id": self.table_id,
            "mode": self.mode,
            "phase": self.phase,
            "pot": self.pot,
            "community_cards": self.community_cards,
            "players": safe_players,
            "current_turn": self.current_turn,
            "current_turn_started_at": self.current_turn_started_at,
            "dealer": dealer_pid,
            "highest_bet": self.highest_bet,
            "small_blind": self.small_blind,
            "big_blind": self.big_blind,
            "viewer_id": viewer_id,
            "handOver": self.hand_over,
            "result": self.result,
            "hand_number": self.hand_number,
        }
