import itertools
from collections import Counter

def evaluate_5cards(cards):
    vals = sorted([c["val"] for c in cards], reverse=True)
    suits = [c["suit"] for c in cards]
    is_flush = len(set(suits)) == 1

    sorted_vals = sorted(vals)
    # Check for the A-2-3-4-5 wheel
    is_wheel = sorted_vals == [2, 3, 4, 5, 14]

    is_straight = is_wheel or all(sorted_vals[i] == sorted_vals[i-1] + 1 for i in range(1, 5))
    straight_high = 5 if is_wheel else vals[0]

    # Count frequencies and sort by count (desc), then value (desc)
    counts = Counter(vals)
    groups = sorted(counts.items(), key=lambda x: (x[1], x[0]), reverse=True)

    g0_val, g0_count = groups[0]
    g1_val, g1_count = groups[1] if len(groups) > 1 else (None, 0)

    if is_flush and is_straight:
        if straight_high == 14 and not is_wheel:
            return {"rank": 9, "tiebreak": [straight_high], "name": "Royal Flush"}
        return {"rank": 8, "tiebreak": [straight_high], "name": "Straight Flush"}

    if g0_count == 4:
        return {"rank": 7, "tiebreak": [g0_val, g1_val], "name": "Four of a Kind"}

    if g0_count == 3 and g1_count == 2:
        return {"rank": 6, "tiebreak": [g0_val, g1_val], "name": "Full House"}

    if is_flush:
        return {"rank": 5, "tiebreak": vals, "name": "Flush"}

    if is_straight:
        return {"rank": 4, "tiebreak": [straight_high], "name": "Straight"}

    if g0_count == 3:
        tiebreak = [g0_val] + [g[0] for g in groups[1:]]
        return {"rank": 3, "tiebreak": tiebreak, "name": "Three of a Kind"}

    if g0_count == 2 and g1_count == 2:
        tiebreak = [g0_val, g1_val] + [g[0] for g in groups[2:]]
        return {"rank": 2, "tiebreak": tiebreak, "name": "Two Pair"}

    if g0_count == 2:
        tiebreak = [g0_val] + [g[0] for g in groups[1:]]
        return {"rank": 1, "tiebreak": tiebreak, "name": "One Pair"}

    return {"rank": 0, "tiebreak": vals, "name": "High Card"}

def compare_tiebreaks(t1, t2):
    for v1, v2 in zip(t1, t2):
        if v1 > v2: return 1
        if v1 < v2: return -1
    return 0

def best_hand(hole_cards, community):
    all_cards = hole_cards + community
    best = None
    
    # Check all combinations of 5 cards out of the 7 available
    for combo in itertools.combinations(all_cards, 5):
        ev = evaluate_5cards(list(combo))
        if not best:
            best = ev
        elif ev["rank"] > best["rank"]:
            best = ev
        elif ev["rank"] == best["rank"]:
            if compare_tiebreaks(ev["tiebreak"], best["tiebreak"]) > 0:
                best = ev
    return best

def determine_winner(p1_hole, p2_hole, community):
    h1 = best_hand(p1_hole, community)
    h2 = best_hand(p2_hole, community)

    if h1["rank"] > h2["rank"]:
        return {"winner": "player_1", "hand": h1, "oppHand": h2}
    if h2["rank"] > h1["rank"]:
        return {"winner": "opponent_1", "hand": h2, "oppHand": h1}

    tb = compare_tiebreaks(h1["tiebreak"], h2["tiebreak"])
    if tb > 0: return {"winner": "player_1", "hand": h1, "oppHand": h2}
    if tb < 0: return {"winner": "opponent_1", "hand": h2, "oppHand": h1}

    return {"winner": "tie", "hand": h1, "oppHand": h2}