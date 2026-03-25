import { useState, useEffect, useRef } from "react";
import { ethers } from "ethers";

// ─── WEB3 CONSTANTS ──────────────────────────────────────────────────────────
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const ESCROW_ADDRESS = "0x70a915aaFCe8f7eA62BAE2392094BFCEC2DDC78A";
const GENESIS_NFT_ADDRESS = "0x_YOUR_FIRST_NFT_ADDRESS_HERE";
const MUTANT_NFT_ADDRESS = "0x_YOUR_SECOND_NFT_ADDRESS_HERE";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) public returns (bool)",
  "function balanceOf(address account) public view returns (uint256)"
];
const ESCROW_ABI = ["function buyIn(string tableId, uint256 amount) external"];
const ERC721_ABI = ["function balanceOf(address owner) view returns (uint256)"];

const CURRENCIES = [
  { id: "chips", label: "Play Chips", symbol: "♠", color: "#c9a84c" },
  { id: "usdc", label: "USDC", symbol: "$", color: "#2775ca" },
  { id: "btfstr", label: "$BTFSTR", symbol: "B", color: "#8b5cf6" },
];

const TOURNAMENTS = [
  {
    id: "tourney-1",
    title: "Genesis High Roller",
    desc: "Exclusive entry for Genesis NFT holders only.",
    buyIn: 25,
    nftAddress: GENESIS_NFT_ADDRESS,
    icon: "♛",
    tag: "NFT GATED",
    tagColor: "#8b5cf6",
  },
  {
    id: "tourney-2",
    title: "Mutant Ape Showdown",
    desc: "The ultimate showdown for Mutant Ape holders.",
    buyIn: 10,
    nftAddress: MUTANT_NFT_ADDRESS,
    icon: "⚔",
    tag: "NFT GATED",
    tagColor: "#ef4444",
  },
];

// ─── CARD COMPONENT ──────────────────────────────────────────────────────────
function Card({ card, hidden = false, highlight = false, small = false, animate = false }) {
  if (!card && !hidden) return null;
  const isRed = card?.suit === "♥" || card?.suit === "♦";
  const w = small ? 36 : 54;
  const h = small ? 52 : 80;
  const fontSize = small ? 10 : 13;

  return (
    <div style={{
      width: w,
      height: h,
      borderRadius: small ? 5 : 8,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: small ? "3px 4px" : "5px 6px",
      fontWeight: 800,
      userSelect: "none",
      flexShrink: 0,
      background: hidden
        ? "linear-gradient(145deg, #1c1040 0%, #0d0820 60%, #180f35 100%)"
        : "linear-gradient(160deg, #ffffff 0%, #f8f4ec 100%)",
      border: highlight
        ? "2px solid #c9a84c"
        : hidden
          ? "1.5px solid #2d1f55"
          : "1.5px solid #ddd8c8",
      boxShadow: highlight
        ? "0 0 18px rgba(201,168,76,0.6), 0 6px 16px rgba(0,0,0,0.5)"
        : hidden
          ? "0 4px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)"
          : "0 4px 12px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.8) inset",
      animation: animate ? "dealIn 0.35s cubic-bezier(0.175,0.885,0.32,1.275) both" : "none",
      position: "relative",
      overflow: "hidden",
    }}>
      {hidden ? (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "repeating-linear-gradient(45deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 2px, transparent 2px, transparent 8px)",
        }}>
          <span style={{ fontSize: small ? 18 : 28, opacity: 0.15 }}>♠</span>
        </div>
      ) : (
        <>
          <span style={{ color: isRed ? "#c0392b" : "#1a1a2e", fontSize, lineHeight: 1.1, fontFamily: "'Inter', sans-serif" }}>
            {card.rank}<br />{card.suit}
          </span>
          <span style={{ color: isRed ? "#c0392b" : "#1a1a2e", fontSize, lineHeight: 1.1, alignSelf: "flex-end", transform: "rotate(180deg)", fontFamily: "'Inter', sans-serif" }}>
            {card.rank}<br />{card.suit}
          </span>
          <span style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            fontSize: small ? 16 : 24, opacity: 0.08,
            color: isRed ? "#c0392b" : "#1a1a2e",
          }}>{card.suit}</span>
        </>
      )}
    </div>
  );
}

function ChipDisplay({ amount, currency, size = "md" }) {
  const cur = CURRENCIES.find(c => c.id === currency) || CURRENCIES[0];
  const sizes = { sm: 11, md: 14, lg: 20 };
  return (
    <span style={{
      color: cur.color,
      fontWeight: 800,
      fontFamily: "'Inter', monospace",
      fontSize: sizes[size],
      letterSpacing: -0.5,
    }}>
      {cur.symbol}{typeof amount === "number" ? amount.toLocaleString() : amount}
    </span>
  );
}

function Spinner({ color = "#c9a84c", size = 40 }) {
  return (
    <div style={{
      width: size, height: size,
      border: `3px solid ${color}22`,
      borderTopColor: color,
      borderRadius: "50%",
      animation: "spin 0.9s linear infinite",
    }} />
  );
}

// ─── MAIN APP ────────────────────────────────────────────────────────────────
export default function B25Poker() {
  const [screen, setScreen] = useState("lobby");
  const [mode, setMode] = useState(null);
  const [currency, setCurrency] = useState("chips");
  const [walletAddress, setWalletAddress] = useState(null);

  const startGame = (selectedMode) => {
    setMode(selectedMode);
    setScreen("game");
  };

  if (screen === "lobby") {
    return <Lobby onStart={startGame} currency={currency} setCurrency={setCurrency} walletAddress={walletAddress} setWalletAddress={setWalletAddress} />;
  }
  return <GameScreen currency={currency} mode={mode} walletAddress={walletAddress} onLeave={() => setScreen("lobby")} />;
}

// ─── LOBBY ────────────────────────────────────────────────────────────────────
function Lobby({ onStart, currency, setCurrency, walletAddress, setWalletAddress }) {
  const [txStatus, setTxStatus] = useState("");
  const [hoveredCard, setHoveredCard] = useState(null);

  const connectWallet = async () => {
    if (!window.ethereum) {
      alert("MetaMask is not installed. Please install it to play securely!");
      return;
    }
    try {
      let provider = window.ethereum;
      if (window.ethereum.providers) {
        const mm = window.ethereum.providers.find(p => p.isMetaMask);
        if (mm) provider = mm;
      }
      const ethProvider = new ethers.BrowserProvider(provider);
      const signer = await ethProvider.getSigner();
      setWalletAddress(await signer.getAddress());
    } catch (err) {
      console.error(err);
    }
  };

  const handleTournament = async (tournament) => {
    if (!walletAddress) {
      alert("Connect your wallet to enter a Tournament.");
      return;
    }
    try {
      let provider = new ethers.BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();
      if (network.chainId !== 84532n) {
        setTxStatus("Switching to Base Sepolia…");
        try {
          await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x14a34" }] });
          provider = new ethers.BrowserProvider(window.ethereum);
        } catch {
          alert("Please switch your wallet to Base Sepolia.");
          setTxStatus("");
          return;
        }
      }
      setTxStatus(`Verifying VIP access…`);
      const nft = new ethers.Contract(tournament.nftAddress, ERC721_ABI, provider);
      const bal = await nft.balanceOf(walletAddress);
      if (bal === 0n) {
        alert(`Access Denied. You need the required NFT to enter ${tournament.title}.`);
        setTxStatus("");
        return;
      }
      setTxStatus(`Approving ${tournament.buyIn} USDC…`);
      const signer = await provider.getSigner();
      const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer);
      const escrow = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, signer);
      const amt = ethers.parseUnits(tournament.buyIn.toString(), 6);
      await (await usdc.approve(ESCROW_ADDRESS, amt)).wait();
      setTxStatus("Depositing to Escrow…");
      await (await escrow.buyIn(tournament.id, amt)).wait();
      setTxStatus("");
      onStart(tournament.id);
    } catch (err) {
      console.error(err);
      setTxStatus("");
      alert("Transaction failed or cancelled.");
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg)",
      display: "flex",
      flexDirection: "column",
      fontFamily: "'Inter', sans-serif",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Background */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0,
        background: "radial-gradient(ellipse 80% 60% at 50% 70%, rgba(13,61,32,0.45) 0%, transparent 70%), radial-gradient(ellipse 60% 40% at 80% 20%, rgba(139,92,246,0.08) 0%, transparent 60%), #08070f",
      }} />

      {/* Decorative grid lines */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0, opacity: 0.03,
        backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
        backgroundSize: "60px 60px",
      }} />

      {/* Transaction overlay */}
      {txStatus && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(8,7,15,0.92)",
          backdropFilter: "blur(12px)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 20,
        }}>
          <Spinner size={52} />
          <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#fff" }}>{txStatus}</p>
          <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)" }}>Confirm the transaction in your wallet.</p>
        </div>
      )}

      {/* Header bar */}
      <header style={{
        position: "relative", zIndex: 10,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "18px 40px",
        borderBottom: "1px solid var(--border)",
        background: "rgba(8,7,15,0.7)",
        backdropFilter: "blur(20px)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22, fontFamily: "'Playfair Display', serif", fontWeight: 900, color: "var(--gold)" }}>♠</span>
          <span style={{ fontFamily: "'Playfair Display', serif", fontWeight: 700, fontSize: 17, letterSpacing: 0.5, color: "#fff" }}>Royal Flush</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {walletAddress ? (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "rgba(16,185,129,0.08)",
              border: "1px solid rgba(16,185,129,0.25)",
              borderRadius: 100,
              padding: "7px 14px 7px 10px",
            }}>
              <span style={{ width: 8, height: 8, background: "#10b981", borderRadius: "50%", display: "inline-block", boxShadow: "0 0 6px #10b981" }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: "#10b981", letterSpacing: 0.3 }}>
                {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
              </span>
            </div>
          ) : (
            <button
              onClick={connectWallet}
              style={{
                background: "linear-gradient(135deg, #c9a84c, #f0d060)",
                border: "none",
                borderRadius: 100,
                padding: "9px 20px",
                fontSize: 13,
                fontWeight: 700,
                color: "#08070f",
                letterSpacing: 0.3,
                boxShadow: "0 4px 20px rgba(201,168,76,0.3)",
                transition: "all 0.2s",
                cursor: "pointer",
              }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = "0 6px 30px rgba(201,168,76,0.5)"}
              onMouseLeave={e => e.currentTarget.style.boxShadow = "0 4px 20px rgba(201,168,76,0.3)"}
            >
              🦊 Connect Wallet
            </button>
          )}
        </div>
      </header>

      {/* Main content */}
      <main style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "60px 24px 80px",
        position: "relative",
        zIndex: 10,
      }}>

        {/* Hero */}
        <div style={{ textAlign: "center", marginBottom: 64, animation: "fadeUp 0.6s ease both" }}>
          <p style={{
            margin: "0 0 14px",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 5,
            textTransform: "uppercase",
            color: "var(--gold-dim)",
          }}>No Limit Texas Hold'em</p>

          <h1 style={{
            margin: 0,
            fontFamily: "'Playfair Display', serif",
            fontWeight: 900,
            fontSize: "clamp(3.5rem, 10vw, 6rem)",
            lineHeight: 0.92,
            letterSpacing: -2,
          }}>
            <span style={{
              background: "linear-gradient(135deg, #c9a84c 0%, #f0d060 30%, #c9a84c 60%, #f0d060 100%)",
              backgroundSize: "300% auto",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              animation: "shimmer 5s linear infinite",
            }}>ROYAL</span>
            <br />
            <span style={{ color: "#fff" }}>FLUSH</span>
          </h1>

          <p style={{ margin: "20px 0 0", fontSize: 14, color: "var(--text-muted)", maxWidth: 360 }}>
            Play poker with real stakes on the blockchain. Connect your wallet, join a table, and take home the prize pool.
          </p>
        </div>

        {/* Game mode cards */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 18,
          width: "100%",
          maxWidth: 920,
          animation: "fadeUp 0.6s ease 0.1s both",
        }}>
          {/* Tournament cards */}
          {TOURNAMENTS.map((t, idx) => (
            <GameModeCard
              key={t.id}
              icon={t.icon}
              title={t.title}
              description={t.desc}
              tag={t.tag}
              tagColor={t.tagColor}
              metaLeft={`Buy-in: ${t.buyIn} USDC`}
              metaRight="6-Max"
              accentColor={t.tagColor}
              delay={idx * 0.07}
              onClick={() => handleTournament(t)}
              isHovered={hoveredCard === t.id}
              onMouseEnter={() => setHoveredCard(t.id)}
              onMouseLeave={() => setHoveredCard(null)}
            />
          ))}

          {/* Cash game */}
          <GameModeCard
            icon="♟"
            title="Standard Cash Game"
            description="Sit down and leave whenever you like. No NFT required — just bring your A-game."
            tag="OPEN TABLE"
            tagColor="#10b981"
            metaLeft="Buy-in: 1,000 chips"
            metaRight="6-Max"
            accentColor="#10b981"
            delay={TOURNAMENTS.length * 0.07}
            onClick={() => onStart("cash")}
            isHovered={hoveredCard === "cash"}
            onMouseEnter={() => setHoveredCard("cash")}
            onMouseLeave={() => setHoveredCard(null)}
          />
        </div>

        {/* Footer note */}
        <p style={{
          marginTop: 48,
          fontSize: 12,
          color: "var(--text-muted)",
          textAlign: "center",
          animation: "fadeUp 0.6s ease 0.3s both",
        }}>
          Powered by Base Sepolia · Secured by on-chain escrow · New players receive 10,000 free chips
        </p>
      </main>
    </div>
  );
}

function GameModeCard({ icon, title, description, tag, tagColor, metaLeft, metaRight, accentColor, delay, onClick, isHovered, onMouseEnter, onMouseLeave }) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        background: isHovered
          ? `linear-gradient(160deg, rgba(${hexToRgb(accentColor)},0.08) 0%, #0f0e1a 100%)`
          : "linear-gradient(160deg, #121020 0%, #0c0b18 100%)",
        border: isHovered
          ? `1px solid rgba(${hexToRgb(accentColor)},0.35)`
          : "1px solid rgba(255,255,255,0.06)",
        borderRadius: 18,
        padding: "26px 28px",
        textAlign: "left",
        cursor: "pointer",
        color: "#fff",
        transition: "all 0.22s ease",
        transform: isHovered ? "translateY(-5px)" : "translateY(0)",
        boxShadow: isHovered
          ? `0 20px 50px rgba(0,0,0,0.5), 0 0 0 1px rgba(${hexToRgb(accentColor)},0.15)`
          : "0 4px 20px rgba(0,0,0,0.3)",
        animation: `fadeUp 0.5s ease ${delay}s both`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Glow top-right */}
      <div style={{
        position: "absolute", top: -40, right: -40,
        width: 120, height: 120,
        background: `radial-gradient(circle, rgba(${hexToRgb(accentColor)},0.12) 0%, transparent 70%)`,
        pointerEvents: "none",
        transition: "opacity 0.2s",
        opacity: isHovered ? 1 : 0,
      }} />

      {/* Tag */}
      <div style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        background: `rgba(${hexToRgb(accentColor)},0.12)`,
        border: `1px solid rgba(${hexToRgb(accentColor)},0.3)`,
        borderRadius: 100,
        padding: "3px 10px",
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: 1.5,
        color: accentColor,
        marginBottom: 16,
        textTransform: "uppercase",
      }}>
        {tag}
      </div>

      {/* Icon + Title */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
        <span style={{
          fontSize: 28, lineHeight: 1,
          filter: isHovered ? `drop-shadow(0 0 8px ${accentColor}88)` : "none",
          transition: "filter 0.2s",
        }}>{icon}</span>
        <h3 style={{
          margin: 0,
          fontSize: 18,
          fontWeight: 800,
          fontFamily: "'Playfair Display', serif",
          color: "#fff",
          lineHeight: 1.2,
        }}>{title}</h3>
      </div>

      <p style={{
        margin: "0 0 22px",
        fontSize: 13,
        color: "var(--text-secondary)",
        lineHeight: 1.6,
      }}>{description}</p>

      {/* Meta row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: accentColor }}>{metaLeft}</span>
        <span style={{
          fontSize: 11, fontWeight: 600,
          color: "var(--text-muted)",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 100,
          padding: "3px 10px",
        }}>{metaRight}</span>
      </div>
    </button>
  );
}

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? `${parseInt(result[1],16)},${parseInt(result[2],16)},${parseInt(result[3],16)}` : "255,255,255";
}

// ─── GAME SCREEN ──────────────────────────────────────────────────────────────
function GameScreen({ currency, mode, walletAddress, onLeave }) {
  const cur = CURRENCIES.find(c => c.id === currency) || CURRENCIES[0];
  const ws = useRef(null);
  const [liveGame, setLiveGame] = useState(null);
  const [betInput, setBetInput] = useState(40);
  const [localCountdown, setLocalCountdown] = useState(null);

  useEffect(() => {
    const tableId = mode;
    const isTournament = mode !== "cash";
    const walletParam = walletAddress ? `&wallet=${walletAddress}` : "";
    const WS_BASE_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000";
    ws.current = new WebSocket(`${WS_BASE_URL}/ws/table/${tableId}?mode=${isTournament ? "tournament" : "cash"}${walletParam}`);
    ws.current.onopen = () => console.log("🟢 Connected to Casino Table:", tableId);
    ws.current.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "game_state") {
        setLiveGame(msg.data);
        if (msg.data.lobby_countdown > 0) setLocalCountdown(msg.data.lobby_countdown);
        else setLocalCountdown(null);
      }
    };
    return () => { if (ws.current) ws.current.close(); };
  }, [mode, walletAddress]);

  useEffect(() => {
    if (!localCountdown || localCountdown <= 0) return;
    if (localCountdown === 1) {
      ws.current?.readyState === WebSocket.OPEN && ws.current.send(JSON.stringify({ action: "start_tournament" }));
      setLocalCountdown(0);
      return;
    }
    const t = setTimeout(() => setLocalCountdown(p => p - 1), 1000);
    return () => clearTimeout(t);
  }, [localCountdown]);

  useEffect(() => {
    if (liveGame?.big_blind) setBetInput(p => Math.max(p, liveGame.big_blind));
  }, [liveGame?.big_blind, liveGame?.phase]);

  const sendAction = (action, amount = 0) => {
    ws.current?.readyState === WebSocket.OPEN && ws.current.send(JSON.stringify({ action, amount }));
  };

  if (!liveGame) return (
    <div style={{
      minHeight: "100vh", background: "var(--bg)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20,
    }}>
      <Spinner size={48} />
      <p style={{ color: "var(--text-secondary)", fontSize: 15, margin: 0 }}>Connecting to casino floor…</p>
    </div>
  );

  const { phase, community_cards, pot, players, highest_bet, handOver, result, current_turn, dealer, viewer_id, tournament_state, small_blind, big_blind, next_blind_sec } = liveGame;
  const myData = players[viewer_id] || { seat: 0, stack: 0, bet: 0, is_turn: false, eliminated: false };
  const mySeat = myData.seat;
  const callAmt = Math.max(0, highest_bet - (myData.bet || 0));
  const canCheck = callAmt === 0;
  const isMyTurn = myData.is_turn && !handOver && !myData.eliminated;
  const isTournament = mode !== "cash";

  const layoutPositions = [
    { bottom: -56, left: "50%", transform: "translateX(-50%)" },
    { bottom: "8%", left: -64, transform: "translateY(50%)" },
    { top: "8%", left: -64, transform: "translateY(-50%)" },
    { top: -56, left: "50%", transform: "translateX(-50%)" },
    { top: "8%", right: -64, transform: "translateY(-50%)" },
    { bottom: "8%", right: -64, transform: "translateY(50%)" },
  ];

  const renderSeats = () => Object.entries(players).map(([pid, pData]) => {
    const visualIdx = (pData.seat - mySeat + 6) % 6;
    const pos = layoutPositions[visualIdx];
    const isMe = pid === viewer_id;
    const isElim = pData.eliminated;
    const displayName = isMe ? "You" : pid.startsWith("0x") ? `${pid.slice(0,4)}…${pid.slice(-4)}` : `Player ${pData.seat + 1}`;
    const isTurn = pData.is_turn && !handOver;

    return (
      <div key={pid} style={{
        position: "absolute", ...pos,
        display: "flex", flexDirection: "column", alignItems: "center",
        zIndex: 10,
        opacity: isElim ? 0.25 : pData.folded ? 0.5 : 1,
        transition: "opacity 0.3s",
      }}>
        {/* Cards */}
        <div style={{ display: "flex", gap: 3, marginBottom: 5 }}>
          {pData.hole_cards?.map((c, i) => <Card key={i} card={c} hidden={c.hidden} small animate />)}
        </div>

        {/* Bet chip */}
        {pData.bet > 0 && !isElim && (
          <div style={{
            position: "absolute",
            bottom: visualIdx === 0 ? "auto" : "100%",
            top: visualIdx === 0 ? "100%" : "auto",
            marginTop: 4, marginBottom: 4,
            background: "rgba(8,7,15,0.85)",
            border: `1px solid rgba(201,168,76,0.25)`,
            borderRadius: 20,
            padding: "2px 9px",
            fontSize: 11, fontWeight: 700,
            color: "#c9a84c",
            whiteSpace: "nowrap",
            backdropFilter: "blur(4px)",
          }}>
            {cur.symbol}{pData.bet.toLocaleString()}
          </div>
        )}

        {/* Seat panel */}
        <div style={{
          background: isTurn
            ? "linear-gradient(135deg, rgba(16,50,28,0.98), rgba(8,28,14,0.98))"
            : "linear-gradient(135deg, rgba(15,14,26,0.97), rgba(10,9,20,0.97))",
          border: isTurn
            ? `2px solid ${cur.color}`
            : isMe
              ? "1.5px solid rgba(255,255,255,0.12)"
              : "1.5px solid rgba(255,255,255,0.05)",
          borderRadius: 12,
          padding: "8px 14px",
          textAlign: "center",
          minWidth: 96,
          backdropFilter: "blur(10px)",
          boxShadow: isTurn
            ? `0 0 20px rgba(201,168,76,0.35), 0 8px 20px rgba(0,0,0,0.5)`
            : "0 4px 16px rgba(0,0,0,0.4)",
          transition: "all 0.25s",
          position: "relative",
        }}>
          {dealer === pid && !isElim && (
            <div style={{
              position: "absolute", top: -8, right: -8,
              width: 18, height: 18, borderRadius: "50%",
              background: "#fff", color: "#000",
              fontSize: 9, fontWeight: 900,
              display: "flex", alignItems: "center", justifyContent: "center",
              border: "2px solid #ddd",
              boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
            }}>D</div>
          )}

          <div style={{ fontSize: 10, fontWeight: 600, color: isMe ? "#10b981" : "var(--text-muted)", marginBottom: 3, letterSpacing: 0.3 }}>
            {displayName}
          </div>

          {isElim ? (
            <span style={{ fontSize: 10, fontWeight: 800, color: "#ef4444", letterSpacing: 1 }}>ELIMINATED</span>
          ) : (
            <div style={{ fontSize: 13, fontWeight: 800, color: isTurn ? cur.color : "#fff" }}>
              {cur.symbol}{pData.stack.toLocaleString()}
            </div>
          )}
        </div>
      </div>
    );
  });

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg)",
      display: "flex",
      flexDirection: "column",
      fontFamily: "'Inter', sans-serif",
      color: "#fff",
      overflow: "hidden",
      position: "relative",
    }}>
      {/* Modals */}
      {isTournament && tournament_state === "waiting" && (
        <Modal>
          <Spinner size={56} />
          <h2 style={{ margin: "20px 0 6px", fontSize: 22, fontWeight: 800 }}>Waiting for players…</h2>
          <p style={{ margin: "0 0 24px", fontSize: 14, color: cur.color, fontWeight: 700 }}>
            {Object.keys(players).length} / 6 seated
          </p>
          {localCountdown > 0 ? (
            <div style={{
              background: "var(--bg-surface)",
              border: `1px solid rgba(201,168,76,0.2)`,
              borderRadius: 16, padding: "18px 40px", textAlign: "center",
            }}>
              <div style={{ fontSize: 11, letterSpacing: 3, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>Starts in</div>
              <div style={{ fontSize: 52, fontWeight: 900, color: cur.color, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{localCountdown}</div>
            </div>
          ) : Object.keys(players).length >= 2 ? (
            <p style={{ color: cur.color, fontWeight: 800, animation: "pulse 1s infinite" }}>Starting…</p>
          ) : (
            <p style={{ color: "var(--text-muted)", fontSize: 13, maxWidth: 280, textAlign: "center" }}>Need at least 2 players to begin the countdown.</p>
          )}
          <button onClick={onLeave} style={{ marginTop: 28, background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "var(--text-secondary)", padding: "9px 24px", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>
            Leave Lobby
          </button>
        </Modal>
      )}

      {isTournament && tournament_state === "finished" && (
        <Modal>
          <div style={{ fontSize: 56, marginBottom: 10 }}>
            {result?.winners?.includes(viewer_id) ? "🏆" : "💀"}
          </div>
          <h2 style={{ margin: "0 0 8px", fontSize: 26, fontWeight: 900, fontFamily: "'Playfair Display', serif" }}>
            {result?.winners?.includes(viewer_id) ? "Victory!" : "Eliminated"}
          </h2>
          <p style={{ margin: "0 0 32px", color: "var(--text-secondary)", fontSize: 15 }}>
            {result?.winners?.includes(viewer_id)
              ? "Congratulations — the prize pool is yours."
              : "Better luck next time. The chips fall where they may."}
          </p>
          <button
            onClick={onLeave}
            style={{
              background: "linear-gradient(135deg, #c9a84c, #f0d060)",
              border: "none", borderRadius: 10,
              padding: "13px 40px",
              fontSize: 15, fontWeight: 800,
              color: "#08070f", cursor: "pointer",
              boxShadow: "0 4px 20px rgba(201,168,76,0.3)",
            }}>
            Return to Lobby
          </button>
        </Modal>
      )}

      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 24px",
        background: "rgba(8,7,15,0.85)",
        borderBottom: "1px solid var(--border)",
        backdropFilter: "blur(16px)",
        zIndex: 20,
      }}>
        <button
          onClick={onLeave}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "var(--text-muted)",
            padding: "7px 14px",
            borderRadius: 8, fontSize: 13, fontWeight: 500,
            cursor: "pointer",
            transition: "all 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; e.currentTarget.style.color = "#fff"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "var(--text-muted)"; }}
        >
          ← Lobby
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: 2,
            textTransform: "uppercase", color: "var(--text-muted)",
          }}>
            {isTournament ? "🏆 Tournament" : "♟ Cash Game"} · {phase || "Lobby"}
          </div>

          {isTournament && big_blind > 0 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 100, padding: "5px 14px",
            }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Blinds: <strong style={{ color: "#fff" }}>{small_blind}/{big_blind}</strong>
              </span>
              <span style={{ width: 1, height: 12, background: "rgba(255,255,255,0.08)" }} />
              <span style={{ fontSize: 12, color: next_blind_sec < 10 ? "#ef4444" : "var(--gold)" }}>
                Next: <strong>{next_blind_sec}s</strong>
              </span>
            </div>
          )}
        </div>

        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {Object.keys(players).length} / 6 players
        </div>
      </div>

      {/* Table area */}
      <div style={{
        flex: 1,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "60px 80px",
        background: "radial-gradient(ellipse 90% 70% at 50% 50%, rgba(13,61,32,0.3) 0%, transparent 75%), var(--bg)",
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Felt table */}
        <div style={{
          position: "relative",
          width: "100%",
          maxWidth: 820,
          height: 380,
          borderRadius: "50% / 45%",
          background: "radial-gradient(ellipse at 50% 40%, #0f5030 0%, #0b3d22 40%, #08280f 100%)",
          border: "10px solid #1a0e05",
          boxShadow: "0 0 0 3px #2e1a08, 0 0 80px rgba(0,0,0,0.7), inset 0 0 80px rgba(0,0,0,0.4)",
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          overflow: "visible",
        }}>
          {/* Felt inner ring */}
          <div style={{
            position: "absolute", inset: 12,
            borderRadius: "50% / 45%",
            border: "1px solid rgba(255,255,255,0.04)",
            pointerEvents: "none",
          }} />

          {renderSeats()}

          {/* Community cards */}
          <div style={{
            display: "flex", gap: 8,
            alignItems: "center",
            justifyContent: "center",
            zIndex: 5,
            marginBottom: 14,
          }}>
            {community_cards?.map((c, i) => <Card key={i} card={c} animate />)}
            {Array.from({ length: Math.max(0, 5 - (community_cards?.length || 0)) }).map((_, i) => (
              <div key={i} style={{
                width: 54, height: 80, borderRadius: 8,
                border: "1.5px dashed rgba(255,255,255,0.06)",
                background: "rgba(255,255,255,0.015)",
              }} />
            ))}
          </div>

          {/* Pot */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "rgba(0,0,0,0.45)",
            backdropFilter: "blur(6px)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 100,
            padding: "5px 18px",
            zIndex: 5,
          }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "rgba(255,255,255,0.3)" }}>POT</span>
            <span style={{ fontSize: 18, fontWeight: 900, color: "var(--gold)", fontVariantNumeric: "tabular-nums" }}>
              {cur.symbol}{pot?.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Hand result banner */}
      {handOver && result && (
        <div style={{
          padding: "14px 24px",
          textAlign: "center",
          background: result.winners?.includes(viewer_id)
            ? "rgba(16,185,129,0.12)"
            : "rgba(239,68,68,0.1)",
          borderTop: `1px solid ${result.winners?.includes(viewer_id) ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.25)"}`,
        }}>
          <span style={{
            fontSize: 16, fontWeight: 800,
            color: result.winners?.includes(viewer_id) ? "#10b981" : "#ef4444",
          }}>
            {result.reason === "fold" ? "Everyone else folded!" :
              result.winners?.length > 1 ? "Split pot!" :
              result.winners?.includes(viewer_id) ? "You won the pot! 🎉" :
              "Opponent takes the pot."}
          </span>
        </div>
      )}

      {/* Action bar */}
      <div style={{
        padding: "18px 24px",
        background: "rgba(8,7,15,0.9)",
        borderTop: "1px solid var(--border)",
        backdropFilter: "blur(16px)",
        minHeight: 88,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {myData.eliminated ? (
          <p style={{ color: "#ef4444", fontWeight: 700, fontSize: 14, margin: 0 }}>
            You have been eliminated from the tournament.
          </p>

        ) : handOver ? (
          <button
            onClick={() => sendAction("new_hand")}
            style={{
              background: "linear-gradient(135deg, var(--gold), #f0d060)",
              border: "none", borderRadius: 10,
              padding: "13px 44px",
              fontSize: 15, fontWeight: 800,
              color: "#08070f", cursor: "pointer",
              boxShadow: "0 4px 24px rgba(201,168,76,0.35)",
              transition: "all 0.2s",
            }}
            onMouseEnter={e => e.currentTarget.style.transform = "scale(1.03)"}
            onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
          >
            Deal Next Hand
          </button>

        ) : isMyTurn ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center", width: "100%", maxWidth: 560 }}>
            <div style={{ display: "flex", gap: 10, width: "100%" }}>
              <ActionButton
                label="Fold"
                onClick={() => sendAction("fold")}
                variant="danger"
              />
              {canCheck ? (
                <ActionButton label="Check" onClick={() => sendAction("check")} variant="neutral" />
              ) : (
                <ActionButton label={`Call  ${cur.symbol}${callAmt.toLocaleString()}`} onClick={() => sendAction("call")} variant="call" color={cur.color} />
              )}
              <ActionButton
                label={`${canCheck ? "Bet" : "Raise"}  ${cur.symbol}${betInput.toLocaleString()}`}
                onClick={() => sendAction(canCheck ? "bet" : "raise", betInput)}
                disabled={myData.stack <= 0}
                variant="primary"
                color={cur.color}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                {cur.symbol}{big_blind}
              </span>
              <input
                type="range"
                min={big_blind}
                max={myData.stack}
                step={big_blind}
                value={betInput}
                onChange={e => setBetInput(+e.target.value)}
                style={{ flex: 1, accentColor: cur.color, height: 4 }}
              />
              <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                {cur.symbol}{myData.stack?.toLocaleString()}
              </span>
            </div>
          </div>
        ) : (
          <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, animation: "pulse 2s ease-in-out infinite" }}>
            Waiting for other players…
          </p>
        )}
      </div>
    </div>
  );
}

function ActionButton({ label, onClick, variant, color, disabled = false }) {
  const styles = {
    danger: {
      background: "rgba(239,68,68,0.1)",
      border: "1px solid rgba(239,68,68,0.3)",
      color: "#f87171",
    },
    neutral: {
      background: "rgba(255,255,255,0.05)",
      border: "1px solid rgba(255,255,255,0.12)",
      color: "#fff",
    },
    call: {
      background: `rgba(${hexToRgb(color || "#c9a84c")},0.1)`,
      border: `1px solid rgba(${hexToRgb(color || "#c9a84c")},0.35)`,
      color: color || "#c9a84c",
    },
    primary: {
      background: `linear-gradient(135deg, ${color || "#c9a84c"}, ${color ? color + "cc" : "#b08a3c"})`,
      border: "none",
      color: "#08070f",
    },
  };
  const s = styles[variant] || styles.neutral;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        padding: "12px 8px",
        borderRadius: 10,
        fontSize: 13,
        fontWeight: 700,
        fontFamily: "'Inter', sans-serif",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "all 0.15s",
        letterSpacing: 0.2,
        whiteSpace: "nowrap",
        ...s,
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.filter = "brightness(1.15)"; }}
      onMouseLeave={e => { e.currentTarget.style.filter = "brightness(1)"; }}
    >
      {label}
    </button>
  );
}

function Modal({ children }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(8,7,15,0.88)",
      backdropFilter: "blur(12px)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 12,
      animation: "fadeUp 0.3s ease both",
    }}>
      {children}
    </div>
  );
}
