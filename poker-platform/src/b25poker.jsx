import { useEffect, useRef, useState } from "react";
import { ethers } from "ethers";

// ─── WEB3 CONSTANTS ──────────────────────────────────────────────────────────
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Base Sepolia USDC
const ESCROW_ADDRESS = "0xDC01aF397AF8187f26fe1fe50E265c9A0dD48F55";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) public returns (bool)",
  "function balanceOf(address account) public view returns (uint256)"
];
const ERC721_ABI = [
  "function balanceOf(address owner) view returns (uint256)"
];
const ESCROW_ABI = [
  "function buyIn(string tableId, uint256 amount) external",
  "function getAllTournaments() external view returns (tuple(string id, string title, string desc, uint256 buyIn, address requiredNft)[])"
];

// ─── API CONSTANTS ───────────────────────────────────────────────────────────
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const WS_BASE_URL = (() => {
  const explicitWsUrl = (import.meta.env.VITE_WS_URL || "").replace(/\/$/, "");
  if (explicitWsUrl) return explicitWsUrl;
  if (API_BASE_URL) {
    return API_BASE_URL.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
  }
  return `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
})();
const ENABLE_WALLET_CONNECT = import.meta.env.VITE_ENABLE_WALLET_CONNECT !== "false";
const SESSION_KEY = "royal_flush_demo_session";
const CURRENCY = { symbol: "S", color: "#c9a84c" };
const SUIT_SYMBOLS = { S: "♠", H: "♥", D: "♦", C: "♣" };

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

async function getResponseError(response, fallbackMessage) {
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

function loadStoredSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveStoredSession(session) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function suitLabel(suit) {
  return SUIT_SYMBOLS[suit] || suit;
}

function cardTextColor(suit) {
  return suit === "H" || suit === "D" ? "#c0392b" : "#1a1a2e";
}

function formatWsUrl(tournamentId, session) {
  return `${WS_BASE_URL}/ws/table/${tournamentId}?player_id=${encodeURIComponent(
    session.player_id
  )}&token=${encodeURIComponent(session.reconnect_token)}`;
}

function normalizeApiGame(game) {
  return {
    ...game,
    category: game.category || (game.mode === "cash" ? "cash" : "tournament"),
    access: game.access_policy || (game.required_nft ? "nft" : "open"),
    asset_symbol: game.asset_symbol || CURRENCY.symbol,
    capacity_label: `${game.seated_count ?? 0}/${game.max_seats ?? 6}`,
  };
}

function normalizeWeb3Game(game) {
  return {
    ...game,
    category: "tournament",
    access: "nft",
    mode: "tournament_web3",
    asset_symbol: game.asset_symbol || "USDC",
    capacity_label: `${game.seated_count ?? 0}/${game.max_seats ?? 6}`,
  };
}

function gameSectionKey(game) {
  if (game.category === "cash") return "cash";
  if (game.access === "nft") return "featured";
  return "scheduled";
}

function gameSectionMeta(sectionKey) {
  if (sectionKey === "cash") {
    return {
      title: "Cash Tables",
      copy: "Drop in any time, buy chips, and leave with the stack you built.",
    };
  }
  if (sectionKey === "featured") {
    return {
      title: "Featured On-Chain Events",
      copy: "NFT-gated tournaments and partner drops with escrow-backed entry.",
    };
  }
  return {
    title: "Scheduled Tournaments",
    copy: "Structured events with fixed seats, countdown starts, and rising blinds.",
  };
}

function gameAppearance(game) {
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

function gameTypeLabel(game) {
  if (game.category === "cash") return "Open Cash";
  if (game.mode === "tournament_web3") return "Creator Event";
  return "Scheduled SNG";
}

function gameDescription(game) {
  if (game.desc) return game.desc;
  if (game.state === "scheduled" && game.scheduled_start_at) {
    return `Registration opens ahead of a planned start at ${new Date(game.scheduled_start_at).toLocaleString()}.`;
  }
  if (game.state === "countdown") return `Starts in ${game.countdown_remaining}s`;
  if (game.state === "running") return game.category === "cash" ? "Table is live now." : "Tournament is already underway.";
  if (game.category === "cash") return "Sit down, top up, and leave whenever you like.";
  if (game.access === "nft") return "Connect your wallet, verify access, and lock in your entry.";
  return "Register before the countdown ends and play through the blind schedule.";
}

function buyInLabel(game) {
  if (game.buy_in_usdc != null) return `Buy-in: ${game.buy_in_usdc} ${game.asset_symbol}`;
  return `Buy-in: ${game.asset_symbol}${(game.buy_in_chips ?? 1000).toLocaleString()}`;
}

function statusLabel(game) {
  if (game.state === "running") return "Live";
  if (game.state === "countdown") return "Starting";
  if (game.state === "scheduled") return "Scheduled";
  if (game.state === "finished") return "Finished";
  return "Open";
}

function LobbySection({ title, copy, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: "rgba(201,168,76,0.5)", fontWeight: 700 }}>{title}</div>
        <p style={{ margin: "8px 0 0", color: "rgba(255,255,255,0.45)", fontSize: 14, lineHeight: 1.6 }}>{copy}</p>
      </div>
      {children}
    </div>
  );
}

function defaultCreatorForm() {
  const now = new Date();
  const start = new Date(now.getTime() + 60 * 60 * 1000);
  const lateReg = new Date(start.getTime() + 20 * 60 * 1000);
  return {
    title: "",
    desc: "",
    adminSecret: "",
    assetSymbol: "S",
    buyIn: 1000,
    startingStack: 3000,
    minPlayers: 2,
    maxSeats: 6,
    blindLevelDurationSec: 300,
    requiredNft: "",
    scheduledStartAt: start.toISOString().slice(0, 16),
    lateRegistrationEndsAt: lateReg.toISOString().slice(0, 16),
    isRecurring: false,
    recurrenceRule: "WEEKLY",
  };
}

function CreatorTabButton({ active, children, onClick, disabled = false }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        padding: "12px 10px",
        borderRadius: 12,
        border: active ? "1px solid rgba(16,185,129,0.45)" : "1px solid rgba(255,255,255,0.08)",
        background: active ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.04)",
        color: active ? "#10b981" : "rgba(255,255,255,0.72)",
        fontSize: 13,
        fontWeight: 800,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  );
}

function FieldLabel({ children }) {
  return <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.62)", marginBottom: 8 }}>{children}</div>;
}

function CreatorInput(props) {
  return (
    <input
      {...props}
      style={{
        width: "100%",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.04)",
        color: "#fff",
        padding: "12px 14px",
        outline: "none",
        boxSizing: "border-box",
        ...(props.style || {}),
      }}
    />
  );
}

function CreatorSelect(props) {
  return (
    <select
      {...props}
      style={{
        width: "100%",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "#171424",
        color: "#fff",
        padding: "12px 14px",
        outline: "none",
        boxSizing: "border-box",
        ...(props.style || {}),
      }}
    />
  );
}

// ─── UI COMPONENTS ───────────────────────────────────────────────────────────
function Card({ card, hidden = false, small = false, animate = false }) {
  if (!card && !hidden) return null;
  const w = small ? 36 : 54;
  const h = small ? 52 : 80;
  const suit = hidden ? null : suitLabel(card?.suit);

  return (
    <div
      style={{
        width: w, height: h, borderRadius: small ? 5 : 8, display: "flex", flexDirection: "column",
        justifyContent: "space-between", padding: small ? "3px 4px" : "5px 6px", fontWeight: 800,
        userSelect: "none", flexShrink: 0,
        background: hidden ? "linear-gradient(145deg, #1c1040 0%, #0d0820 60%, #180f35 100%)" : "linear-gradient(160deg, #ffffff 0%, #f8f4ec 100%)",
        border: hidden ? "1.5px solid #2d1f55" : "1.5px solid #ddd8c8",
        boxShadow: hidden ? "0 4px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)" : "0 4px 12px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.8) inset",
        animation: animate ? "dealIn 0.35s cubic-bezier(0.175,0.885,0.32,1.275) both" : "none",
        position: "relative", overflow: "hidden",
      }}
    >
      {hidden ? (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "repeating-linear-gradient(45deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 2px, transparent 2px, transparent 8px)" }}>
          <span style={{ fontSize: small ? 18 : 28, opacity: 0.15 }}>♠</span>
        </div>
      ) : (
        <>
          <span style={{ color: cardTextColor(card?.suit), fontSize: small ? 10 : 13, lineHeight: 1.1 }}>{card.rank}<br />{suit}</span>
          <span style={{ color: cardTextColor(card?.suit), fontSize: small ? 10 : 13, lineHeight: 1.1, alignSelf: "flex-end", transform: "rotate(180deg)" }}>{card.rank}<br />{suit}</span>
        </>
      )}
    </div>
  );
}

function Spinner({ size = 42 }) {
  return (
    <div style={{ width: size, height: size, border: "3px solid rgba(201,168,76,0.15)", borderTopColor: "#c9a84c", borderRadius: "50%", animation: "spin 0.9s linear infinite" }} />
  );
}

function Modal({ children }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(8,7,15,0.88)", backdropFilter: "blur(12px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }}>
      {children}
    </div>
  );
}

function ActionButton({ label, onClick, disabled = false, variant = "neutral" }) {
  const styles = {
    neutral: { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff" },
    primary: { background: "linear-gradient(135deg, #c9a84c, #f0d060)", border: "none", color: "#08070f" },
    danger: { background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.4)", color: "#f87171" },
  };

  return (
    <button onClick={onClick} disabled={disabled} style={{ flex: 1, padding: "12px 8px", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.45 : 1, ...styles[variant] }}>
      {label}
    </button>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────────────────────
export default function B25Poker() {
  const [screen, setScreen] = useState("lobby");
  const [session, setSession] = useState(() => loadStoredSession());
  const [walletAddress, setWalletAddress] = useState(() => loadStoredSession()?.wallet_address || null);
  const [selectedTournament, setSelectedTournament] = useState(null);

  const handleSession = (nextSession) => {
    setSession(nextSession);
    setWalletAddress(nextSession.wallet_address || walletAddress);
    saveStoredSession(nextSession);
  };

  if (screen === "game" && selectedTournament && session) {
    return (
      <GameScreen tournament={selectedTournament} session={session} walletAddress={walletAddress} onLeave={() => { setSelectedTournament(null); setScreen("lobby"); }} />
    );
  }

  return (
    <Lobby session={session} walletAddress={walletAddress} onSession={handleSession} onStart={(tournament) => { setSelectedTournament(tournament); setScreen("game"); }} onWallet={setWalletAddress} />
  );
}

// ─── LOBBY ───────────────────────────────────────────────────────────────────
function Lobby({ session, walletAddress, onSession, onStart, onWallet }) {
  const [displayName, setDisplayName] = useState(session?.display_name || "");
  const [tournaments, setTournaments] = useState([]);
  const [web3Tournaments, setWeb3Tournaments] = useState([]);
  const [assets, setAssets] = useState([]);
  const [contractStatus, setContractStatus] = useState("loading"); // "loading" | "ok" | "error"
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState("");
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [creatorTab, setCreatorTab] = useState("sng");
  const [creatorForm, setCreatorForm] = useState(() => defaultCreatorForm());

  const fetchTournaments = async () => {
    // 1. Fetch backend-managed games.
    try {
      const response = await fetch(apiUrl("/api/tournaments"));
      if (response.ok) {
        const data = await response.json();
        setTournaments((data.items || []).map(normalizeApiGame));
      }
    } catch (err) {
      console.warn("Could not load API tournaments:", err);
    }

    try {
      const response = await fetch(apiUrl("/api/assets"));
      if (response.ok) {
        const data = await response.json();
        setAssets(data.items || []);
      }
    } catch (err) {
      console.warn("Could not load assets:", err);
    }

    // 2. Fetch NFT-gated on-chain tournaments.
    try {
      const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
      const escrowContract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, provider);
      const data = await escrowContract.getAllTournaments();
      const formattedWeb3 = data.map(t => normalizeWeb3Game({
        id: t.id,
        title: t.title,
        desc: t.desc,
        buy_in_usdc: Number(t.buyIn),
        requiredNft: t.requiredNft,
        isWeb3: true,
        state: "registering",
        max_seats: 6,
        seated_count: 0,
      }));
      setWeb3Tournaments(formattedWeb3);
      setContractStatus("ok");
    } catch (err) {
      // Contract unreachable or ABI mismatch — free tables still work fine
      setContractStatus("error");
      setWeb3Tournaments([]);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        setLoading(true);
        if (session?.reconnect_token) {
          const response = await fetch(apiUrl("/api/demo/session"), {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reconnect_token: session.reconnect_token, display_name: session.display_name, wallet_address: walletAddress }),
          });
          if (response.ok && !cancelled) onSession(await response.json());
        }
        await fetchTournaments();
      } catch (err) {
        if (!cancelled) setError("Unable to load the lobby.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    boot();
    const interval = window.setInterval(() => { fetchTournaments().catch(() => {}); }, 4000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

  const createOrResumeSession = async () => {
    setSubmitting(true); setError("");
    try {
      const response = await fetch(apiUrl("/api/demo/session"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reconnect_token: session?.reconnect_token, display_name: displayName || "Guest", wallet_address: walletAddress }),
      });
      if (!response.ok) {
        throw new Error(await getResponseError(response, "Could not create your demo seat."));
      }
      const data = await response.json();
      onSession(data);
      setBanner("Demo profile ready. Pick a sit-and-go table below.");
      return data;
    } catch (err) {
      setError(err.message); return null;
    } finally {
      setSubmitting(false);
    }
  };

  const handleJoin = async (tournament) => {
    const activeSession = session || (await createOrResumeSession());
    if (!activeSession) return;

    setSubmitting(true); setError("");

    // 🚀 THE WEB3 INTERCEPTOR
    if (tournament.isWeb3) {
      if (!walletAddress) {
        setError("You must connect your MetaMask wallet to join a VIP Table.");
        setSubmitting(false);
        return;
      }
      
      try {
        setBanner(`Verifying NFT & Depositing ${tournament.buy_in_usdc} USDC... Please check MetaMask.`);
        const provider = new ethers.BrowserProvider(window.ethereum);
        
        // 1. Force Base Sepolia Network
        const network = await provider.getNetwork();
        if (network.chainId !== 84532n) {
          await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x14a34' }] });
        }

        // 2. Check NFT Access
        const nftContract = new ethers.Contract(tournament.requiredNft, ERC721_ABI, provider);
        const nftBalance = await nftContract.balanceOf(walletAddress);
        if (nftBalance === 0n) {
          throw new Error(`Access Denied: You do not own the required NFT for ${tournament.title}!`);
        }

        const signer = await provider.getSigner();
        const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer);
        const escrowContract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, signer);
        const depositAmount = ethers.parseUnits(tournament.buy_in_usdc.toString(), 6);
        
        // 3. Approve and Deposit USDC
        const approveTx = await usdcContract.approve(ESCROW_ADDRESS, depositAmount);
        await approveTx.wait();
        const depositTx = await escrowContract.buyIn(tournament.id, depositAmount);
        await depositTx.wait();
        
        setBanner("Deposit confirmed! Connecting to table...");
      } catch (err) {
        setError(err.message || "Web3 Transaction failed or was canceled.");
        setSubmitting(false);
        return; // Halt if they didn't pay/don't have NFT
      }
    }

    // 📡 THE BACKEND JOIN (Runs for both Free tables and Web3 tables after deposit)
    try {
      const response = await fetch(apiUrl(`/api/tournaments/${tournament.id}/join`), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player_id: activeSession.player_id, reconnect_token: activeSession.reconnect_token }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || data.message || "Could not join this table.");
      await fetchTournaments();
      onStart({ ...tournament, seat_index: data.seat_index });
    } catch (err) {
      setError(err.message || "Join failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const connectWallet = async () => {
    if (!window.ethereum) { setError("MetaMask is not installed."); return; }
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      onWallet(address);
      if (session) {
        const response = await fetch(apiUrl("/api/demo/session"), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reconnect_token: session.reconnect_token, display_name: session.display_name, wallet_address: address }),
        });
        if (response.ok) onSession(await response.json());
      }
    } catch {
      setError("Wallet connection was cancelled.");
    }
  };

  const updateCreatorForm = (patch) => {
    setCreatorForm((current) => ({ ...current, ...patch }));
  };

  const buildBlindSchedule = () => {
    if (creatorTab === "tournament") {
      return [
        { small_blind: 25, big_blind: 50 },
        { small_blind: 50, big_blind: 100 },
        { small_blind: 75, big_blind: 150 },
        { small_blind: 100, big_blind: 200 },
        { small_blind: 150, big_blind: 300 },
        { small_blind: 200, big_blind: 400 },
      ];
    }
    return [
      { small_blind: 20, big_blind: 40 },
      { small_blind: 30, big_blind: 60 },
      { small_blind: 40, big_blind: 80 },
      { small_blind: 60, big_blind: 120 },
    ];
  };

  const handleCreateTable = async () => {
    const activeSession = session || (await createOrResumeSession());
    if (!activeSession) return;

    if (creatorTab === "ring") {
      setError("Ring-game creation UI is staged, but the revolving table backend still needs to be promoted into this API.");
      return;
    }

    setSubmitting(true);
    setError("");
    setBanner("");
    try {
      const registrationOpen = new Date();
      const scheduledStart = creatorTab === "tournament" ? new Date(creatorForm.scheduledStartAt) : null;
      const lateRegEnd = creatorTab === "tournament" && creatorForm.lateRegistrationEndsAt ? new Date(creatorForm.lateRegistrationEndsAt) : null;
      const payload = {
        title: creatorForm.title || (creatorTab === "tournament" ? "Scheduled Tournament" : "Sit & Go"),
        desc: creatorForm.desc,
        buy_in_chips: Number(creatorForm.buyIn),
        starting_stack: Number(creatorForm.startingStack),
        category: "tournament",
        mode: creatorTab === "tournament" ? "tournament_scheduled" : "tournament_sng",
        min_players: Number(creatorForm.minPlayers),
        max_seats: Number(creatorForm.maxSeats),
        blind_level_duration_sec: Number(creatorForm.blindLevelDurationSec),
        blind_schedule: buildBlindSchedule(),
        asset_symbol: creatorForm.assetSymbol,
        required_nft: creatorForm.requiredNft || null,
        creator_player_id: activeSession.player_id,
        creator_wallet_address: walletAddress || null,
        creator_nft_contract: creatorForm.requiredNft || null,
        registration_opens_at: registrationOpen.toISOString(),
        scheduled_start_at: scheduledStart ? scheduledStart.toISOString() : null,
        late_registration_ends_at: lateRegEnd ? lateRegEnd.toISOString() : null,
        is_recurring: creatorTab === "tournament" ? creatorForm.isRecurring : false,
        recurrence_rule: creatorTab === "tournament" && creatorForm.isRecurring ? creatorForm.recurrenceRule : null,
        admin_secret: creatorForm.adminSecret,
      };

      const response = await fetch(apiUrl("/api/tournaments"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || data.message || "Could not create this table.");
      }
      setBanner(`${data.title} created. It is now available in the lobby.`);
      setCreatorOpen(false);
      setCreatorForm(defaultCreatorForm());
      await fetchTournaments();
    } catch (err) {
      setError(err.message || "Creation failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const allTournaments = [...web3Tournaments, ...tournaments];
  const gamesBySection = {
    cash: allTournaments.filter((game) => gameSectionKey(game) === "cash"),
    scheduled: allTournaments.filter((game) => gameSectionKey(game) === "scheduled"),
    featured: allTournaments.filter((game) => gameSectionKey(game) === "featured"),
  };

  return (
    <div style={{ minHeight: "100vh", background: "#08070f", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden", fontFamily: "'Inter', sans-serif", color: "#fff" }}>

      {/* Layered background glows */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse 100% 55% at 50% 85%, rgba(13,61,32,0.55) 0%, transparent 65%), radial-gradient(ellipse 55% 35% at 85% 8%, rgba(201,168,76,0.07) 0%, transparent 60%), #08070f" }} />

      {/* ── HEADER ── */}
      <header style={{ position: "relative", zIndex: 20, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 36px", borderBottom: "1px solid rgba(255,255,255,0.055)", background: "rgba(8,7,15,0.75)", backdropFilter: "blur(20px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22, color: "#c9a84c" }}>♠</span>
          <div>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 20, color: "#c9a84c", fontWeight: 900, lineHeight: 1 }}>Royal Flush</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: 3, textTransform: "uppercase", marginTop: 2 }}>B25Ventures</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {/* Contract status dot */}
          <div title={contractStatus === "ok" ? "On-chain contract responding" : "On-chain contract unreachable"} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: contractStatus === "ok" ? "#10b981" : contractStatus === "error" ? "rgba(239,68,68,0.7)" : "rgba(255,255,255,0.2)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "inline-block", boxShadow: contractStatus === "ok" ? "0 0 6px #10b981" : "none" }} />
            <span style={{ display: "none" }}>Chain</span>
          </div>

          {session ? (
            <div style={{ borderRadius: 999, padding: "7px 14px", border: "1px solid rgba(16,185,129,0.25)", background: "rgba(16,185,129,0.07)", color: "#10b981", fontSize: 12, fontWeight: 700 }}>
              {session.display_name} · {CURRENCY.symbol}{(session.chip_balance ?? 0).toLocaleString()}
            </div>
          ) : null}

          {ENABLE_WALLET_CONNECT ? (
            walletAddress ? (
              <div style={{ borderRadius: 999, padding: "7px 14px", border: "1px solid rgba(201,168,76,0.3)", background: "rgba(201,168,76,0.07)", color: "#c9a84c", fontSize: 12, fontWeight: 700 }}>
                {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
              </div>
            ) : (
              <button onClick={connectWallet} style={{ background: "linear-gradient(135deg,#c9a84c,#f0d060)", border: "none", borderRadius: 999, padding: "10px 20px", color: "#08070f", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
                Connect Wallet
              </button>
            )
          ) : null}
          <button onClick={() => setCreatorOpen(true)} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 999, padding: "10px 18px", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            Create Table
          </button>
        </div>
      </header>

      {/* ── HERO ── */}
      <section style={{ position: "relative", zIndex: 10, textAlign: "center", padding: "72px 24px 56px" }}>
        <div style={{ fontSize: 11, letterSpacing: 6, textTransform: "uppercase", color: "rgba(201,168,76,0.6)", marginBottom: 20, fontWeight: 600 }}>
          No Limit Texas Hold'em
        </div>

        <h1 style={{
          fontFamily: "'Playfair Display', serif", fontWeight: 900,
          fontSize: "clamp(3.8rem, 10vw, 7.5rem)", lineHeight: 0.92,
          margin: "0 0 28px",
          background: "linear-gradient(90deg,#c9a84c 0%,#f0d060 28%,#fffbe0 50%,#f0d060 72%,#c9a84c 100%)",
          backgroundSize: "200% auto",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          animation: "goldShimmer 4s linear infinite",
        }}>
          ROYAL<br />FLUSH
        </h1>

        <p style={{ maxWidth: 480, margin: "0 auto 36px", color: "rgba(255,255,255,0.45)", fontSize: 15, lineHeight: 1.7 }}>
          Play poker with real stakes on the blockchain. Connect your wallet,
          join a table, and take home the prize pool.
        </p>

        {/* Session creation — inline in hero */}
        {!session ? (
          <div style={{ display: "flex", gap: 0, maxWidth: 380, margin: "0 auto", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(201,168,76,0.25)", background: "rgba(255,255,255,0.04)" }}>
            <input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && createOrResumeSession()}
              placeholder="Your name…"
              maxLength={24}
              style={{ flex: 1, background: "transparent", border: "none", outline: "none", padding: "14px 18px", color: "#fff", fontSize: 14 }}
            />
            <button
              onClick={createOrResumeSession}
              disabled={submitting}
              style={{ background: "linear-gradient(135deg,#c9a84c,#f0d060)", border: "none", padding: "14px 22px", color: "#08070f", fontWeight: 800, fontSize: 13, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.6 : 1, whiteSpace: "nowrap" }}>
              {submitting ? "…" : "Enter Casino"}
            </button>
          </div>
        ) : (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 999, padding: "10px 20px" }}>
            <span style={{ fontSize: 18 }}>♠</span>
            <span style={{ color: "#10b981", fontWeight: 700, fontSize: 14 }}>Welcome back, {session.display_name}</span>
            <button onClick={createOrResumeSession} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", fontSize: 11, cursor: "pointer", padding: 0 }}>refresh</button>
          </div>
        )}

        {banner ? <p style={{ marginTop: 18, color: "#10b981", fontSize: 13 }}>{banner}</p> : null}
        {error ? <p style={{ marginTop: 14, color: "#f87171", fontSize: 13 }}>{error}</p> : null}
      </section>

      {/* ── TOURNAMENT CARDS ── */}
      <section style={{ position: "relative", zIndex: 10, maxWidth: 1140, margin: "0 auto", padding: "0 24px 80px", width: "100%" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 20 }}>
          {gamesBySection.cash.length ? <span style={pillStyle()}>Cash Tables {gamesBySection.cash.length}</span> : null}
          {gamesBySection.scheduled.length ? <span style={pillStyle()}>Scheduled Tournaments {gamesBySection.scheduled.length}</span> : null}
          {gamesBySection.featured.length ? <span style={pillStyle()}>Featured Events {gamesBySection.featured.length}</span> : null}
        </div>
        {loading && allTournaments.length === 0 ? (
          <div style={{ textAlign: "center", paddingTop: 40 }}><Spinner size={48} /></div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 20 }}>
            {allTournaments.map(t => {
              const isJoinable = t.state === "scheduled" || t.state === "registering" || t.state === "countdown";
              const appearance = gameAppearance(t);
              const accent = appearance.accent;
              return (
                <div key={t.id} style={{
                  borderRadius: 22, padding: 28,
                  background: "linear-gradient(155deg, rgba(18,16,36,0.95) 0%, rgba(11,10,22,0.98) 100%)",
                  border: `1px solid rgba(255,255,255,0.07)`,
                  boxShadow: `0 24px 60px rgba(0,0,0,0.45)`,
                  display: "flex", flexDirection: "column", gap: 0,
                  transition: "transform 0.2s, box-shadow 0.2s",
                  cursor: "default",
                }}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = `0 32px 80px rgba(0,0,0,0.55), 0 0 0 1px ${accent}33`; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 24px 60px rgba(0,0,0,0.45)"; }}
                >
                  {/* Badge */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                    <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase", padding: "4px 10px", borderRadius: 20, background: appearance.badgeBg, color: appearance.badgeColor }}>
                      {appearance.badgeLabel}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: accent, border: `1px solid ${accent}44`, borderRadius: 999, padding: "4px 10px" }}>
                      {statusLabel(t)}
                    </span>
                  </div>

                  {/* Icon + Title */}
                  <div style={{ fontSize: 36, color: accent, marginBottom: 10, lineHeight: 1 }}>{appearance.icon}</div>
                  <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 900, marginBottom: 10, lineHeight: 1.2 }}>{t.title}</div>
                  <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.6, marginBottom: 20, flex: 1 }}>
                    {gameDescription(t)}
                  </div>

                  {/* Buy-in row */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, fontSize: 13 }}>
                    <span style={{ color: accent, fontWeight: 800 }}>{buyInLabel(t)}</span>
                    <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 12 }}>{gameTypeLabel(t)}</span>
                  </div>

                  {/* Join button */}
                  <button
                    onClick={() => handleJoin(t)}
                    disabled={submitting || !isJoinable}
                    style={{
                      width: "100%", padding: "13px 0", borderRadius: 12, border: "none",
                      fontWeight: 800, fontSize: 14, cursor: submitting || !isJoinable ? "not-allowed" : "pointer",
                      opacity: isJoinable ? 1 : 0.45,
                      background: isJoinable
                        ? (t.isWeb3 ? "linear-gradient(135deg,#7c3aed,#a78bfa)" : "linear-gradient(135deg,#c9a84c,#f0d060)")
                        : "rgba(255,255,255,0.06)",
                      color: isJoinable ? (t.isWeb3 ? "#fff" : "#08070f") : "rgba(255,255,255,0.4)",
                      transition: "opacity 0.2s",
                    }}>
                    {isJoinable
                      ? (t.isWeb3 ? "Connect & Enter" : t.category === "cash" ? "Join Table" : "Register")
                      : (t.state === "running" ? "In Progress" : "Closed")}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ position: "relative", zIndex: 10, textAlign: "center", padding: "24px 24px 36px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 14, color: "rgba(201,168,76,0.5)", letterSpacing: 1 }}>
          Powered by B25Ventures
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: "rgba(255,255,255,0.15)", letterSpacing: 1 }}>
          Base Sepolia Testnet · Play responsibly
        </div>
      </footer>

      {creatorOpen ? (
        <Modal>
          <div style={{ width: "min(680px, 100%)", borderRadius: 24, background: "linear-gradient(160deg, #121020 0%, #0c0b18 100%)", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 28px 80px rgba(0,0,0,0.55)", padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: "rgba(201,168,76,0.55)", fontWeight: 700 }}>Create New Table</div>
                <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 28, fontWeight: 900, color: "#fff", marginTop: 6 }}>NLH Creator</div>
              </div>
              <button onClick={() => setCreatorOpen(false)} style={{ ...secondaryButtonStyle, padding: "8px 14px" }}>Close</button>
            </div>

            <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
              <CreatorTabButton active={creatorTab === "ring"} onClick={() => setCreatorTab("ring")}>Ring Game</CreatorTabButton>
              <CreatorTabButton active={creatorTab === "sng"} onClick={() => setCreatorTab("sng")}>SNG</CreatorTabButton>
              <CreatorTabButton active={creatorTab === "tournament"} onClick={() => setCreatorTab("tournament")}>Tournament</CreatorTabButton>
            </div>

            <div style={{ borderRadius: 18, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.03)", padding: 18 }}>
              {creatorTab === "ring" ? (
                <div>
                  <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 800, marginBottom: 10 }}>Ring Game</div>
                  <p style={{ margin: 0, color: "rgba(255,255,255,0.5)", lineHeight: 1.7 }}>
                    This tab matches the cash-game direction you want, but the current create endpoint is still tournament-first.
                    Once the revolving table backend is promoted into the shared API, this tab can create true drop-in tables.
                  </p>
                </div>
              ) : (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                    <div>
                      <FieldLabel>Table Title</FieldLabel>
                      <CreatorInput value={creatorForm.title} onChange={(e) => updateCreatorForm({ title: e.target.value })} placeholder={creatorTab === "tournament" ? "Friday Builder Cup" : "Fast Sit & Go"} />
                    </div>
                    <div>
                      <FieldLabel>Chip Asset</FieldLabel>
                      <CreatorSelect value={creatorForm.assetSymbol} onChange={(e) => updateCreatorForm({ assetSymbol: e.target.value })}>
                        {(assets.length ? assets : [{ symbol: "S" }, { symbol: "USDC" }]).map((asset) => (
                          <option key={asset.symbol} value={asset.symbol}>{asset.symbol}</option>
                        ))}
                      </CreatorSelect>
                    </div>
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <FieldLabel>Description</FieldLabel>
                    <CreatorInput value={creatorForm.desc} onChange={(e) => updateCreatorForm({ desc: e.target.value })} placeholder="Describe the event, sponsor, or table style" />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 14 }}>
                    <div>
                      <FieldLabel>Buy-In</FieldLabel>
                      <CreatorInput type="number" value={creatorForm.buyIn} onChange={(e) => updateCreatorForm({ buyIn: e.target.value })} />
                    </div>
                    <div>
                      <FieldLabel>Start Stack</FieldLabel>
                      <CreatorInput type="number" value={creatorForm.startingStack} onChange={(e) => updateCreatorForm({ startingStack: e.target.value })} />
                    </div>
                    <div>
                      <FieldLabel>Auto Start</FieldLabel>
                      <CreatorInput type="number" min="2" value={creatorForm.minPlayers} onChange={(e) => updateCreatorForm({ minPlayers: e.target.value })} />
                    </div>
                    <div>
                      <FieldLabel>Seats</FieldLabel>
                      <CreatorInput type="number" min="2" max="9" value={creatorForm.maxSeats} onChange={(e) => updateCreatorForm({ maxSeats: e.target.value })} />
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: creatorTab === "tournament" ? "repeat(3, 1fr)" : "repeat(2, 1fr)", gap: 14, marginBottom: 14 }}>
                    <div>
                      <FieldLabel>Blind Level Seconds</FieldLabel>
                      <CreatorInput type="number" min="60" step="60" value={creatorForm.blindLevelDurationSec} onChange={(e) => updateCreatorForm({ blindLevelDurationSec: e.target.value })} />
                    </div>
                    <div>
                      <FieldLabel>Required NFT</FieldLabel>
                      <CreatorInput value={creatorForm.requiredNft} onChange={(e) => updateCreatorForm({ requiredNft: e.target.value })} placeholder="Optional contract address" />
                    </div>
                    {creatorTab === "tournament" ? (
                      <div>
                        <FieldLabel>Recurring</FieldLabel>
                        <CreatorSelect value={creatorForm.isRecurring ? creatorForm.recurrenceRule : "NONE"} onChange={(e) => updateCreatorForm({ isRecurring: e.target.value !== "NONE", recurrenceRule: e.target.value === "NONE" ? "WEEKLY" : e.target.value })}>
                          <option value="NONE">One Time</option>
                          <option value="WEEKLY">Weekly</option>
                        </CreatorSelect>
                      </div>
                    ) : null}
                  </div>

                  {creatorTab === "tournament" ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                      <div>
                        <FieldLabel>Scheduled Start</FieldLabel>
                        <CreatorInput type="datetime-local" value={creatorForm.scheduledStartAt} onChange={(e) => updateCreatorForm({ scheduledStartAt: e.target.value })} />
                      </div>
                      <div>
                        <FieldLabel>Late Reg Ends</FieldLabel>
                        <CreatorInput type="datetime-local" value={creatorForm.lateRegistrationEndsAt} onChange={(e) => updateCreatorForm({ lateRegistrationEndsAt: e.target.value })} />
                      </div>
                    </div>
                  ) : (
                    <div style={{ borderRadius: 14, padding: "12px 14px", background: "rgba(201,168,76,0.06)", border: "1px solid rgba(201,168,76,0.18)", color: "rgba(255,255,255,0.68)", fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
                      Sit & Go creation starts registering immediately and launches as soon as enough players are seated.
                    </div>
                  )}

                  <div style={{ marginBottom: 18 }}>
                    <FieldLabel>Admin Secret</FieldLabel>
                    <CreatorInput type="password" value={creatorForm.adminSecret} onChange={(e) => updateCreatorForm({ adminSecret: e.target.value })} placeholder="Required by the current backend create endpoint" />
                  </div>

                  <div style={{ display: "flex", gap: 12 }}>
                    <button onClick={() => setCreatorForm(defaultCreatorForm())} style={{ ...secondaryButtonStyle, flex: 1, padding: "14px 18px", fontWeight: 800 }}>Reset</button>
                    <button onClick={handleCreateTable} disabled={submitting} style={{ ...primaryButtonStyle, flex: 1, padding: "14px 18px", fontWeight: 800, opacity: submitting ? 0.6 : 1 }}>
                      {submitting ? "Creating..." : "Create"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </Modal>
      ) : null}

      <style>{`
        @keyframes goldShimmer {
          0% { background-position: 0% center; }
          100% { background-position: 200% center; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        * { box-sizing: border-box; }
        input::placeholder { color: rgba(255,255,255,0.25); }
      `}</style>
    </div>
  );
}

// ─── GAME SCREEN ─────────────────────────────────────────────────────────────
// (This section is entirely untouched so your WebSocket game logic remains flawless!)
function GameScreen({ tournament, session, walletAddress, onLeave }) {
  const ws = useRef(null);
  const [liveGame, setLiveGame] = useState(null);
  const [status, setStatus] = useState("Connecting to table...");
  const [error, setError] = useState("");
  const [betInput, setBetInput] = useState(40);

  useEffect(() => {
    const socket = new WebSocket(formatWsUrl(tournament.id, session));
    ws.current = socket;

    socket.onopen = () => setStatus("Connected");
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "table_state") {
        setError("");
        setLiveGame(message.data);
        setStatus(message.data.tournament_state === "running" ? "Tournament running" : "Waiting for table");
        setBetInput((previous) => Math.max(previous || message.data.big_blind || 40, message.data.big_blind || 40));
      } else if (message.type === "error") {
        setError(message.data.message || "Socket error");
      }
    };
    socket.onerror = () => setError("The table connection dropped.");
    socket.onclose = () => setStatus("Disconnected. Rejoin from the lobby if needed.");

    return () => socket.close();
  }, [tournament.id, session.player_id, session.reconnect_token]);

  const sendAction = (action, amount = 0) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ action, amount }));
    }
  };

  if (!liveGame) {
    return (
      <div style={loadingScreenStyle}>
        <Spinner size={52} />
        <p style={{ margin: 0, color: "var(--text-secondary)" }}>{status}</p>
        {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}
      </div>
    );
  }

  const {
    phase, community_cards, pot, players, highest_bet, handOver, result, dealer, viewer_id,
    tournament_state, small_blind, big_blind, countdown_remaining, turn_timeout_sec, current_turn_started_at, title,
  } = liveGame;
  
  const myData = players[viewer_id] || { seat: 0, stack: 0, bet: 0, is_turn: false, eliminated: false };
  const mySeat = myData.seat || 0;
  const callAmt = Math.max(0, highest_bet - (myData.bet || 0));
  const canCheck = callAmt === 0;
  const isMyTurn = myData.is_turn && !handOver && !myData.eliminated && tournament_state === "running";
  const nowSec = Math.floor(Date.now() / 1000);
  const turnDeadline = current_turn_started_at ? Math.max(0, turn_timeout_sec - Math.max(0, nowSec - Math.floor(current_turn_started_at))) : turn_timeout_sec;

  const layoutPositions = [
    { bottom: -56, left: "50%", transform: "translateX(-50%)" },
    { bottom: "8%", left: -64, transform: "translateY(50%)" },
    { top: "8%", left: -64, transform: "translateY(-50%)" },
    { top: -56, left: "50%", transform: "translateX(-50%)" },
    { top: "8%", right: -64, transform: "translateY(-50%)" },
    { bottom: "8%", right: -64, transform: "translateY(50%)" },
  ];

  const seatViews = Object.entries(players).map(([pid, pdata]) => {
    const visualIdx = (pdata.seat - mySeat + 6) % 6;
    const pos = layoutPositions[visualIdx];
    const isMe = pid === viewer_id;
    const isElim = pdata.eliminated;
    const label = isMe ? "You" : pid.startsWith("player_") ? `Player ${pdata.seat + 1}` : `${pid.slice(0, 6)}...`;

    return (
      <div key={pid} style={{ position: "absolute", ...pos, display: "flex", flexDirection: "column", alignItems: "center", zIndex: 10, opacity: isElim ? 0.25 : pdata.folded ? 0.5 : 1 }}>
        <div style={{ display: "flex", gap: 3, marginBottom: 5 }}>
          {pdata.hole_cards?.map((card, index) => (
            <Card key={`${pid}-${index}`} card={card} hidden={card.hidden} small animate />
          ))}
        </div>

        {pdata.bet > 0 ? (
          <div style={betBadgeStyle}>{CURRENCY.symbol}{pdata.bet.toLocaleString()}</div>
        ) : null}

        <div style={{ ...seatPanelStyle, border: pdata.is_turn ? "2px solid #c9a84c" : seatPanelStyle.border }}>
          {dealer === pid ? <div style={dealerBadgeStyle}>D</div> : null}
          <div style={{ fontSize: 10, color: isMe ? "#10b981" : "var(--text-muted)", marginBottom: 3 }}>{label}</div>
          {isElim ? (
            <span style={{ fontSize: 10, fontWeight: 800, color: "#ef4444" }}>ELIMINATED</span>
          ) : (
            <div style={{ fontSize: 13, fontWeight: 800 }}>{CURRENCY.symbol}{pdata.stack.toLocaleString()}</div>
          )}
        </div>
      </div>
    );
  });

  return (
    <div style={gameShellStyle}>
      {tournament_state === "countdown" ? (
        <Modal>
          <Spinner size={56} />
          <h2 style={{ margin: "18px 0 8px", fontSize: 24 }}>Waiting for the deal</h2>
          <p style={{ margin: 0, color: "var(--text-secondary)" }}>{Object.keys(players).length}/6 seated · starts in {countdown_remaining}s</p>
          <button onClick={onLeave} style={secondaryButtonStyle}>Leave Lobby</button>
        </Modal>
      ) : null}

      {tournament_state === "finished" ? (
        <Modal>
          <div style={{ fontSize: 56 }}>{result?.winners?.includes(viewer_id) ? "🏆" : "♠"}</div>
          <h2 style={{ margin: "0 0 6px", fontSize: 26 }}>{result?.winners?.includes(viewer_id) ? "Victory" : "Tournament Complete"}</h2>
          <p style={{ margin: 0, color: "var(--text-secondary)" }}>{result?.winners?.includes(viewer_id) ? "You won the sit-and-go." : "The final result is locked in."}</p>
          <button onClick={onLeave} style={secondaryButtonStyle}>Return to Lobby</button>
        </Modal>
      ) : null}

      <div style={topBarStyle}>
        <button onClick={onLeave} style={secondaryButtonStyle}>Back to Lobby</button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--text-muted)", textTransform: "uppercase" }}>{title || tournament.title}</div>
          <div style={{ fontWeight: 700 }}>{phase || "waiting"} · blinds {small_blind}/{big_blind}</div>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", textAlign: "right" }}>
          <div>{session.display_name}</div>
          <div>{walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : status}</div>
        </div>
      </div>

      <div style={tableAreaStyle}>
        <div style={tableStyle}>
          {seatViews}
          <div style={{ display: "flex", gap: 8, marginBottom: 16, zIndex: 5 }}>
            {community_cards?.map((card, index) => <Card key={`community-${index}`} card={card} animate />)}
            {Array.from({ length: Math.max(0, 5 - (community_cards?.length || 0)) }).map((_, index) => (
              <div key={`placeholder-${index}`} style={{ width: 54, height: 80, borderRadius: 8, border: "1.5px dashed rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.015)" }} />
            ))}
          </div>
          <div style={potBadgeStyle}>
            <span style={{ fontSize: 10, letterSpacing: 2, color: "rgba(255,255,255,0.3)" }}>POT</span>
            <span style={{ fontSize: 20, fontWeight: 900, color: "var(--gold)" }}>{CURRENCY.symbol}{pot.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {handOver && result ? (
        <div style={handBannerStyle(result.winners?.includes(viewer_id))}>
          <strong>{result.reason === "fold" ? "Pot awarded after a fold." : result.winners?.length > 1 ? "Split pot." : result.winners?.includes(viewer_id) ? "You won the hand." : "Hand complete."}</strong>
        </div>
      ) : null}

      <div style={actionBarStyle}>
        {error ? <p style={{ color: "#f87171", margin: "0 0 12px" }}>{error}</p> : null}
        {myData.eliminated ? (
          <p style={{ color: "#ef4444", fontWeight: 700, margin: 0 }}>You have been eliminated from this tournament.</p>
        ) : handOver ? (
          <p style={{ color: "var(--text-secondary)", margin: 0 }}>Server will deal the next hand automatically.</p>
        ) : isMyTurn ? (
          <div style={{ width: "100%", maxWidth: 640 }}>
            <div style={{ display: "flex", gap: 8, width: "100%" }}>
              <ActionButton label="Fold" onClick={() => sendAction("fold")} variant="danger" />
              <ActionButton label={canCheck ? "Check" : `Call ${CURRENCY.symbol}${callAmt}`} onClick={() => sendAction(canCheck ? "check" : "call")} />
              <ActionButton label={`${canCheck ? "Bet" : "Raise"} ${CURRENCY.symbol}${betInput}`} onClick={() => sendAction(canCheck ? "bet" : "raise", betInput)} variant="primary" disabled={myData.stack <= 0} />
              <ActionButton label={`All-In ${CURRENCY.symbol}${myData.stack}`} onClick={() => sendAction("allin", myData.stack)} variant="danger" disabled={myData.stack <= 0} />
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{CURRENCY.symbol}{big_blind}</span>
              <input type="range" min={big_blind} max={Math.max(big_blind, myData.stack)} step={big_blind} value={Math.min(betInput, Math.max(big_blind, myData.stack))} onChange={(event) => setBetInput(Number(event.target.value))} style={{ flex: 1, accentColor: "#c9a84c" }} />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{CURRENCY.symbol}{myData.stack}</span>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-secondary)" }}>Auto action in about {turnDeadline}s if you disconnect or stall.</div>
          </div>
        ) : (
          <p style={{ color: "var(--text-secondary)", margin: 0 }}>{tournament_state === "running" ? "Waiting for the next action..." : "Waiting for enough players to start."}</p>
        )}
      </div>
    </div>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
function headerButtonStyle() { return { background: "linear-gradient(135deg, #c9a84c, #f0d060)", border: "none", borderRadius: 999, padding: "10px 18px", color: "#08070f", fontWeight: 800 }; }
function panelStyle() { return { background: "linear-gradient(160deg, #121020 0%, #0c0b18 100%)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 22, padding: 24, boxShadow: "0 24px 60px rgba(0,0,0,0.35)" }; }
function tournamentCardStyle() { return { borderRadius: 18, padding: 18, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.03)" }; }
function pillStyle() { return { padding: "5px 10px", borderRadius: 999, border: "1px solid rgba(201,168,76,0.25)", color: "var(--gold)", fontSize: 11, fontWeight: 700 }; }
function handBannerStyle(isWinner) { return { padding: "12px 24px", textAlign: "center", background: isWinner ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.05)" }; }

const heroTitleStyle = { margin: "0 0 12px", fontFamily: "'Playfair Display', serif", fontWeight: 900, fontSize: "clamp(3rem, 8vw, 5.5rem)", lineHeight: 0.95 };
const heroCopyStyle = { maxWidth: 580, margin: 0, color: "var(--text-secondary)", lineHeight: 1.6 };
const sectionEyebrowStyle = { fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "var(--gold-dim)" };
const sectionTitleStyle = { margin: "10px 0 8px", fontSize: 26, fontFamily: "'Playfair Display', serif" };
const sectionCopyStyle = { margin: "0 0 18px", color: "var(--text-secondary)", fontSize: 14 };
const lobbyGridStyle = { maxWidth: 1040, margin: "0 auto", display: "grid", gridTemplateColumns: "minmax(280px, 360px) minmax(320px, 1fr)", gap: 18 };
const sessionBadgeStyle = { borderRadius: 999, padding: "8px 14px", border: "1px solid rgba(16,185,129,0.25)", background: "rgba(16,185,129,0.08)", color: "#10b981", fontSize: 12, fontWeight: 700 };
const walletBadgeStyle = { borderRadius: 999, padding: "8px 14px", border: "1px solid rgba(201,168,76,0.25)", background: "rgba(201,168,76,0.08)", color: "var(--gold)", fontSize: 12, fontWeight: 700 };
const betBadgeStyle = { marginBottom: 5, background: "rgba(8,7,15,0.88)", border: "1px solid rgba(201,168,76,0.25)", borderRadius: 20, padding: "2px 9px", fontSize: 11, fontWeight: 700, color: "#c9a84c" };
const seatPanelStyle = { background: "linear-gradient(135deg, rgba(15,14,26,0.97), rgba(10,9,20,0.97))", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "8px 14px", minWidth: 96, textAlign: "center", position: "relative" };
const dealerBadgeStyle = { position: "absolute", top: -8, right: -8, width: 18, height: 18, borderRadius: "50%", background: "#fff", color: "#000", fontSize: 9, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" };
const inputStyle = { width: "100%", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "#fff", padding: "12px 14px", outline: "none", boxSizing: "border-box" };
const primaryButtonStyle = { background: "linear-gradient(135deg, #c9a84c, #f0d060)", border: "none", borderRadius: 12, padding: "12px 18px", fontWeight: 800, color: "#08070f", cursor: "pointer" };
const secondaryButtonStyle = { background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "var(--text-secondary)", borderRadius: 10, padding: "10px 16px", cursor: "pointer" };
const loadingScreenStyle = { minHeight: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20 };
const gameShellStyle = { minHeight: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column", color: "#fff" };
const topBarStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 24px", background: "rgba(8,7,15,0.85)", borderBottom: "1px solid var(--border)" };
const tableAreaStyle = { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 80px", background: "radial-gradient(ellipse 90% 70% at 50% 50%, rgba(13,61,32,0.3) 0%, transparent 75%), var(--bg)" };
const tableStyle = { position: "relative", width: "100%", maxWidth: 820, height: 380, borderRadius: "50% / 45%", background: "radial-gradient(ellipse at 50% 40%, #0f5030 0%, #0b3d22 40%, #08280f 100%)", border: "10px solid #1a0e05", boxShadow: "0 0 0 3px #2e1a08, 0 0 80px rgba(0,0,0,0.7), inset 0 0 80px rgba(0,0,0,0.4)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" };
const potBadgeStyle = { display: "flex", alignItems: "center", gap: 8, background: "rgba(0,0,0,0.45)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 999, padding: "5px 18px", zIndex: 5 };
const actionBarStyle = { padding: "18px 24px", background: "rgba(8,7,15,0.9)", borderTop: "1px solid var(--border)", minHeight: 88, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" };
