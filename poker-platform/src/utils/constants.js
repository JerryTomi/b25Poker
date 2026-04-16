export const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Base Sepolia USDC
export const ESCROW_ADDRESS = "0xDC01aF397AF8187f26fe1fe50E265c9A0dD48F55";

export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) public returns (bool)",
  "function balanceOf(address account) public view returns (uint256)"
];
export const ERC721_ABI = [
  "function balanceOf(address owner) view returns (uint256)"
];
export const ESCROW_ABI = [
  "function buyIn(string tableId, uint256 amount) external",
  "function getAllTournaments() external view returns (tuple(string id, string title, string desc, uint256 buyIn, address requiredNft)[])"
];

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
export const WS_BASE_URL = (() => {
  const explicitWsUrl = (import.meta.env.VITE_WS_URL || "").replace(/\/$/, "");
  if (explicitWsUrl) return explicitWsUrl;
  if (API_BASE_URL) {
    return API_BASE_URL.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
  }
  return `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
})();
export const ENABLE_WALLET_CONNECT = import.meta.env.VITE_ENABLE_WALLET_CONNECT !== "false";
export const SESSION_KEY = "royal_flush_demo_session";
export const CURRENCY = { symbol: "S", color: "#c9a84c" };
export const SUIT_SYMBOLS = { S: "♠", H: "♥", D: "♦", C: "♣" };
