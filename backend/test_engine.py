import unittest

from engine import PokerEngine


class PokerEngineTests(unittest.TestCase):
    def test_start_hand_requires_two_players(self):
        engine = PokerEngine("table-1")
        engine.add_player("p1", 1000, seat_index=0)
        self.assertFalse(engine.start_hand())

        engine.add_player("p2", 1000, seat_index=1)
        self.assertTrue(engine.start_hand())
        self.assertEqual(engine.phase, "preflop")
        self.assertIsNotNone(engine.current_turn)

    def test_fold_awards_pot(self):
        engine = PokerEngine("table-1")
        engine.add_player("p1", 1000, seat_index=0)
        engine.add_player("p2", 1000, seat_index=1)
        engine.start_hand()
        current = engine.current_turn
        loser = current
        winner = "p1" if loser == "p2" else "p2"

        self.assertTrue(engine.process_action(loser, "fold"))
        self.assertTrue(engine.hand_over)
        self.assertEqual(engine.result["reason"], "fold")
        self.assertEqual(engine.result["winners"], [winner])

    def test_invalid_check_is_rejected_when_facing_bet(self):
        engine = PokerEngine("table-1")
        engine.add_player("p1", 1000, seat_index=0)
        engine.add_player("p2", 1000, seat_index=1)
        engine.start_hand()
        self.assertFalse(engine.process_action(engine.current_turn, "check"))


if __name__ == "__main__":
    unittest.main()
