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
  return {
    ...game,
    category: game.category || (game.mode === "cash" ? "cash" : "tournament"),
    access: game.access_policy || (game.required_nft ? "nft" : "open"),
    asset_symbol: game.asset_symbol || CURRENCY.symbol,
    capacity_label: `${game.seated_count ?? 0}/${game.max_seats ?? 6}`,
  };
}

export function normalizeWeb3Game(game) {
  return {
    ...game,
    category: "tournament",
    access: "nft",
    mode: "tournament_web3",
    asset_symbol: game.asset_symbol || "USDC",
    capacity_label: `${game.seated_count ?? 0}/${game.max_seats ?? 6}`,
  };
}

export function gameSectionKey(game) {
  if (game.access === "nft" || game.isWeb3) return "featured";
  if (game.category === "cash" || game.mode === "tournament_sng") return "cash";
  if (game.mode === "tournament_scheduled") return "scheduled";
  return "scheduled";
}

export function gameAppearance(game) {
  if (game.category === "cash") {
    return {
      icon: "♠",
      accent: "#10b981",
      badgeBg: "rgba(16,185,129,0.15)",
      badgeColor: "#10b981",
      badgeLabel: "CASH TABLE",
    };
  }
  if (game.access === "nft") {
    return {
      icon: "♛",
      accent: "#a78bfa",
      badgeBg: "rgba(124,58,237,0.15)",
      badgeColor: "#a78bfa",
      badgeLabel: "NFT EVENT",
    };
  }
  return {
    icon: "♠",
    accent: "#c9a84c",
    badgeBg: "rgba(201,168,76,0.15)",
    badgeColor: "#c9a84c",
    badgeLabel: "TOURNAMENT",
  };
}
