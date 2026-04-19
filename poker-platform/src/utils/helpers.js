import { API_BASE_URL, WS_BASE_URL, SESSION_KEY, SUIT_SYMBOLS, CURRENCY } from "./constants";

export function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

export async function getResponseError(response, fallbackMessage) {
  try {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await response.json();
      if (typeof data?.detail === "string" && data.detail.trim()) return data.detail;
      if (typeof data?.message === "string" && data.message.trim()) return data.message;
    } else {
      const text = await response.text();
      if (text.trim()) return text.trim();
    }
  } catch {
    // Fall through to the default error message.
  }
  return fallbackMessage;
}

export function loadStoredSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveStoredSession(session) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function suitLabel(suit) {
  return SUIT_SYMBOLS[suit] || suit;
}

export function cardTextColor(suit) {
  return suit === "H" || suit === "D" ? "#c0392b" : "#1a1a2e";
}

export function formatWsUrl(tournamentId, session) {
  return `${WS_BASE_URL}/ws/table/${tournamentId}?player_id=${encodeURIComponent(
    session.player_id
  )}&token=${encodeURIComponent(session.reconnect_token)}`;
}

export function normalizeApiGame(game) {
  // Derive a consistent category from mode when backend doesn't send one
  const isCash = game.category === "cash" || game.mode === "cash";
  const isSng = game.mode === "tournament_sng";
  const category = isCash ? "cash" : "tournament";

  // Cash tables and Sit & Go always use USDC
  const assetSymbol = isCash ? "USDC" : (game.asset_symbol || CURRENCY.symbol);

  return {
    ...game,
    category,
    access: game.access_policy || (game.required_nft ? "nft" : "open"),
    asset_symbol: assetSymbol,
    capacity_label: `${game.seated_count ?? 0}/${game.max_seats ?? 6}`,
  };
}

export function normalizeWeb3Game(game) {
  return {
    ...game,
    category: "tournament",
    access: "nft",
    mode: "tournament_web3",
    asset_symbol: "USDC",
    capacity_label: `${game.seated_count ?? 0}/${game.max_seats ?? 6}`,
  };
}

// De-duplicate a list of games by id, keeping the first occurrence
export function deduplicateGames(games) {
  const seen = new Set();
  return games.filter(g => {
    if (seen.has(g.id)) return false;
    seen.add(g.id);
    return true;
  });
}

// Format a buy-in amount with its currency symbol properly
export function formatBuyIn(game) {
  const amount = game.buy_in_chips ?? game.buy_in_usdc;
  if (amount == null) return "–";
  const symbol = game.asset_symbol || CURRENCY.symbol;
  // For token symbols (USDC, ETH, etc.) show after the number
  // For single-char symbols ($, S) show before
  if (symbol.length > 1) return `${Number(amount).toLocaleString()} ${symbol}`;
  return `${symbol}${Number(amount).toLocaleString()}`;
}

export function gameSectionKey(game) {
  if (game.access === "nft" || game.isWeb3) return "featured";
  if (game.category === "cash") return "cash";
  if (game.mode === "tournament_sng") return "sng";
  if (game.mode === "tournament_scheduled") return "scheduled";
  return "scheduled";
}

export function gameAppearance(game) {
  // Cash tables
  if (game.category === "cash") {
    return {
      icon: "♠",
      accent: "#10b981",
      badgeBg: "rgba(16,185,129,0.15)",
      badgeColor: "#10b981",
      badgeLabel: "CASH TABLE",
    };
  }
  // NFT gated events
  if (game.access === "nft") {
    return {
      icon: "♛",
      accent: "#a78bfa",
      badgeBg: "rgba(124,58,237,0.15)",
      badgeColor: "#a78bfa",
      badgeLabel: "NFT EVENT",
    };
  }
  // Sit & Go (revolving)
  if (game.mode === "tournament_sng") {
    return {
      icon: "♠",
      accent: "#c9a84c",
      badgeBg: "rgba(201,168,76,0.15)",
      badgeColor: "#c9a84c",
      badgeLabel: "SIT & GO",
    };
  }
  // Scheduled tournament (default)
  return {
    icon: "♠",
    accent: "#c9a84c",
    badgeBg: "rgba(201,168,76,0.15)",
    badgeColor: "#c9a84c",
    badgeLabel: "TOURNAMENT",
  };
}
