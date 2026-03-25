import { useState, useEffect, useRef } from "react";
import { ethers } from "ethers";

// ─── WEB3 CONSTANTS ──────────────────────────────────────────────────────────
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Official Base Sepolia USDC
const ESCROW_ADDRESS = "0x70a915aaFCe8f7eA62BAE2392094BFCEC2DDC78A"; 
// Replace these with your actual NFT Contract addresses when you deploy them
const GENESIS_NFT_ADDRESS = "0x_YOUR_FIRST_NFT_ADDRESS_HERE"; 
const MUTANT_NFT_ADDRESS = "0x_YOUR_SECOND_NFT_ADDRESS_HERE";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) public returns (bool)",
  "function balanceOf(address account) public view returns (uint256)"
];
const ESCROW_ABI = [
  "function buyIn(string tableId, uint256 amount) external"
];
const ERC721_ABI = [
  "function balanceOf(address owner) view returns (uint256)"
];

// ─── CURRENCIES ──────────────────────────────────────────────────────────────
const CURRENCIES = [
  { id: "chips", label: "Play Chips", symbol: "CHIP", color: "#f59e0b" },
  { id: "usdc", label: "USDC", symbol: "$", color: "#2775ca" },
  { id: "btfstr", label: "$BTFSTR", symbol: "B", color: "#a78bfa" },
];

// ─── TOURNAMENT DIRECTORY ────────────────────────────────────────────────────
const TOURNAMENTS = [
  { 
    id: "tourney-1", 
    title: "The Genesis High Roller", 
    desc: "Requires Genesis NFT to enter.",
    buyIn: 25, 
    nftAddress: GENESIS_NFT_ADDRESS 
  },
  { 
    id: "tourney-2", 
    title: "Mutant Ape Showdown", 
    desc: "Requires Mutant NFT to enter.",
    buyIn: 10, 
    nftAddress: MUTANT_NFT_ADDRESS 
  }
];

// ─── CARD COMPONENT ──────────────────────────────────────────────────────────
function Card({ card, hidden = false, highlight = false, small = false, animate = false }) {
  if (!card && !hidden) return null;
  const red = card?.suit === "♥" || card?.suit === "♦";
  const w = small ? 38 : 52; const h = small ? 54 : 76;
  return (
    <div style={{
      width: w, height: h, borderRadius: 6, display: "flex", flexDirection: "column",
      justifyContent: "space-between", padding: 4, fontWeight: 900, userSelect: "none",
      background: hidden ? "linear-gradient(135deg,#1a1040,#0d0820)" : "linear-gradient(160deg,#fff 0%,#f5f0e8 100%)",
      border: highlight ? "2px solid #f59e0b" : hidden ? "2px solid #3a2a60" : "2px solid #d4c8a8",
      boxShadow: highlight ? "0 0 15px #f59e0b88, 0 4px 8px #0008" : hidden ? "0 4px 8px #0006" : "0 4px 8px #0005",
      animation: animate ? "dealIn 0.3s cubic-bezier(0.175,0.885,0.32,1.275) both" : "none",
    }}>
      {hidden ? (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: small ? 16 : 24, opacity: 0.4 }}>🂠</div>
      ) : (
        <>
          <span style={{ color: red ? "#c0392b" : "#1a1a2e", fontSize: small ? 10 : 12, lineHeight: 1 }}>{card.rank}<br />{card.suit}</span>
          <span style={{ color: red ? "#c0392b" : "#1a1a2e", fontSize: small ? 10 : 12, lineHeight: 1, alignSelf: "flex-end", transform: "rotate(180deg)" }}>{card.rank}<br />{card.suit}</span>
        </>
      )}
    </div>
  );
}

function ChipDisplay({ amount, currency }) {
  const cur = CURRENCIES.find(c => c.id === currency) || CURRENCIES[0];
  return (
    <span style={{ color: cur.color, fontWeight: 900, fontFamily: "'Courier New',monospace", fontSize: 13 }}>
      {cur.symbol}{typeof amount === "number" ? amount.toLocaleString() : amount}
    </span>
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

  if (screen === "lobby") return <Lobby onStart={startGame} currency={currency} setCurrency={setCurrency} walletAddress={walletAddress} setWalletAddress={setWalletAddress} />;
  return <GameScreen currency={currency} mode={mode} walletAddress={walletAddress} onLeave={() => setScreen("lobby")} />;
}

// ─── LOBBY SCREEN ────────────────────────────────────────────────────────────
function Lobby({ onStart, currency, setCurrency, walletAddress, setWalletAddress }) {
  const cur = CURRENCIES.find(c => c.id === currency) || CURRENCIES[0];
  const [txStatus, setTxStatus] = useState("");

  const connectWallet = async () => {
    if (window.ethereum) {
      try {
        let injectedProvider = window.ethereum;
        if (window.ethereum.providers) {
          const metamaskProvider = window.ethereum.providers.find(p => p.isMetaMask);
          if (metamaskProvider) injectedProvider = metamaskProvider;
        } else if (window.ethereum.isMetaMask) {
          injectedProvider = window.ethereum;
        }

        const provider = new ethers.BrowserProvider(injectedProvider);
        const signer = await provider.getSigner();
        const address = await signer.getAddress();
        setWalletAddress(address);
      } catch (err) {
        console.error("User rejected request or error occurred", err);
      }
    } else {
      alert("MetaMask is not installed. Please install it to play securely!");
    }
  };

  const handleModeSelection = async (tournament) => {
    if (!walletAddress) {
      alert("You must connect your wallet to play in a Tournament!");
      return;
    }
    
    try {
      let provider = new ethers.BrowserProvider(window.ethereum);
      
      const network = await provider.getNetwork();
      if (network.chainId !== 84532n) {
        setTxStatus("Switching to Base Sepolia...");
        try {
          await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x14a34' }] });
          provider = new ethers.BrowserProvider(window.ethereum);
        } catch (switchError) {
          alert("Please switch your wallet network to Base Sepolia to play!");
          setTxStatus("");
          return;
        }
      }

      setTxStatus(`Checking VIP Pass for ${tournament.title}...`);
      const nftContract = new ethers.Contract(tournament.nftAddress, ERC721_ABI, provider);
      const nftBalance = await nftContract.balanceOf(walletAddress);
      
      if (nftBalance === 0n) {
        alert(`Access Denied! You must own the required NFT to enter ${tournament.title}.`);
        setTxStatus("");
        return; 
      }

      setTxStatus(`Approving ${tournament.buyIn} USDC...`);
      let signer = await provider.getSigner();
      
      const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer);
      const escrowContract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, signer);
      
      const depositAmount = ethers.parseUnits(tournament.buyIn.toString(), 6);
      
      const approveTx = await usdcContract.approve(ESCROW_ADDRESS, depositAmount);
      await approveTx.wait();
      
      setTxStatus("Depositing funds to Escrow...");
      const depositTx = await escrowContract.buyIn(tournament.id, depositAmount);
      await depositTx.wait();
      
      setTxStatus("");
      onStart(tournament.id); 
      
    } catch (err) {
      console.error(err);
      setTxStatus("");
      alert("Transaction failed or was canceled.");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#07060f", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "'Georgia',serif", padding: 20, position: "relative" }}>
      <style>{`
        @keyframes goldShimmer{0%{background-position:200% center}100%{background-position:-200% center}}
        .mode-card{transition:transform 0.2s,box-shadow 0.2s;cursor:pointer}
        .mode-card:hover{transform:translateY(-6px)!important}
        .btn-action{transition:all 0.15s;cursor:pointer}
        .btn-action:hover{filter:brightness(1.15);transform:scale(1.03)}
        .btn-action:active{transform:scale(0.97)}
      `}</style>
      
      {txStatus && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(7,6,15,0.9)", backdropFilter: "blur(8px)", zIndex: 100, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 50, height: 50, border: `4px solid ${cur.color}33`, borderTopColor: cur.color, borderRadius: "50%", animation: "logo-spin 1s linear infinite", marginBottom: 20 }} />
          <h2 style={{ color: "#fff", fontSize: 24 }}>{txStatus}</h2>
          <p style={{ color: "#888", marginTop: 10 }}>Please confirm the transaction in your wallet.</p>
        </div>
      )}

      <div style={{ position: "fixed", inset: 0, background: "radial-gradient(ellipse at 50% 60%,#0d2a18 0%,#07060f 70%)", zIndex: 0 }} />
      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 650, textAlign: "center" }}>
        
        <div style={{ position: "absolute", top: -60, right: 0 }}>
          {walletAddress ? (
            <div style={{ background: "#1a1a2e", border: "1px solid #333", padding: "6px 12px", borderRadius: 20, fontSize: 12, color: "#a78bfa", fontWeight: 700 }}>
              🟢 {walletAddress.substring(0, 6)}...{walletAddress.substring(walletAddress.length - 4)}
            </div>
          ) : (
            <button className="btn-action" onClick={connectWallet} style={{ background: "linear-gradient(135deg,#f59e0b,#d97706)", border: "none", padding: "8px 16px", borderRadius: 20, fontSize: 13, color: "#fff", fontWeight: 900, boxShadow: "0 4px 15px rgba(245,158,11,0.3)" }}>
              🦊 Connect Wallet
            </button>
          )}
        </div>

        <h1 style={{ margin: "0 0 4px", fontSize: "clamp(2.5rem,8vw,4.5rem)", fontWeight: 900, lineHeight: 0.95, letterSpacing: -2 }}>
          <span style={{ background: "linear-gradient(135deg,#d4af37,#ffe066,#b8860b,#ffe066)", backgroundSize: "200%", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", animation: "goldShimmer 4s linear infinite" }}>ROYAL</span><br /><span style={{ color: "#fff" }}>FLUSH</span>
        </h1>
        <p style={{ color: "#5a5070", fontSize: 13, margin: "12px 0 28px", letterSpacing: 2, textTransform: "uppercase" }}>No Limit Texas Hold'em</p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginBottom: 28 }}>
          
          {TOURNAMENTS.map(t => (
            <button key={t.id} className="mode-card" onClick={() => handleModeSelection(t)} style={{ borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", background: "linear-gradient(160deg,#11101e,#0c0b18)", padding: 22, textAlign: "left", color: "inherit" }}>
              <div style={{ fontWeight: 900, fontSize: 17, color: "#fff", marginBottom: 6 }}>🏆 {t.title}</div>
              <div style={{ color: "#5a5070", fontSize: 12, lineHeight: 1.5, marginBottom: 8 }}>{t.desc}</div>
              <div style={{ fontSize: 13, color: "#10b981", fontWeight: 700 }}>Buy-in: {t.buyIn} USDC</div>
            </button>
          ))}

          <button className="mode-card" onClick={() => onStart("cash")} style={{ borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)", background: "linear-gradient(160deg,#11101e,#0c0b18)", padding: 22, textAlign: "left", color: "inherit" }}>
            <div style={{ fontWeight: 900, fontSize: 17, color: "#fff", marginBottom: 6 }}>💵 Standard Cash Game</div>
            <div style={{ color: "#5a5070", fontSize: 12, lineHeight: 1.5 }}>Sit down and walk away whenever you like with your stack. No NFT required.</div>
          </button>

        </div>
      </div>
    </div>
  );
}

// ─── GAME SCREEN ─────────────────────────────────────────────────────────────
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
    
    ws.current.onopen = () => console.log(`🟢 Connected to Casino Table: ${tableId}!`);
    ws.current.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "game_state") {
        setLiveGame(msg.data);
        if (msg.data.lobby_countdown > 0) {
          setLocalCountdown(msg.data.lobby_countdown);
        } else {
          setLocalCountdown(null);
        }
      }
    };
    return () => { if (ws.current) ws.current.close(); };
  }, [mode, walletAddress]);

  useEffect(() => {
    if (localCountdown === null || localCountdown <= 0) return;
    if (localCountdown === 1) {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ action: "start_tournament" }));
      }
      setLocalCountdown(0);
      return;
    }
    const timer = setTimeout(() => {
      setLocalCountdown(prev => prev - 1);
    }, 1000);
    return () => clearTimeout(timer);
  }, [localCountdown]);

  useEffect(() => {
    if (liveGame && liveGame.big_blind) {
      setBetInput(prev => Math.max(prev, liveGame.big_blind));
    }
  }, [liveGame?.big_blind, liveGame?.phase]);

  const sendAction = (action, amount = 0) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ action, amount }));
    }
  };

  if (!liveGame) return <div style={{ minHeight: "100vh", background: "#07060f", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>Connecting to Casino Floor...</div>;

  const { phase, community_cards, pot, players, highest_bet, handOver, result, current_turn, dealer, viewer_id, tournament_state, small_blind, big_blind, next_blind_sec } = liveGame;
  
  const myData = players[viewer_id] || { seat: 0, stack: 0, bet: 0, is_turn: false, eliminated: false };
  const mySeat = myData.seat;

  const callAmt = Math.max(0, highest_bet - (myData.bet || 0));
  const canCheck = callAmt === 0;
  const isMyTurn = myData.is_turn && !handOver && !myData.eliminated;
  const isTournament = mode !== "cash";

  const renderSeats = () => {
    const seatElements = [];
    const layoutPositions = [
      { bottom: -40, left: "50%", transform: "translateX(-50%)" }, 
      { bottom: "10%", left: -40, transform: "translateY(50%)" },  
      { top: "10%", left: -40, transform: "translateY(-50%)" },    
      { top: -40, left: "50%", transform: "translateX(-50%)" },    
      { top: "10%", right: -40, transform: "translateY(-50%)" },   
      { bottom: "10%", right: -40, transform: "translateY(50%)" }, 
    ];

    Object.entries(players).forEach(([pid, pData]) => {
      const visualIdx = (pData.seat - mySeat + 6) % 6; 
      const pos = layoutPositions[visualIdx];
      const isMe = pid === viewer_id; 
      const isEliminated = pData.eliminated;
      const opacity = isEliminated ? 0.3 : pData.folded ? 0.6 : 1;
      
      const displayName = isMe ? "You" : pid.startsWith("0x") ? `${pid.substring(0,4)}...${pid.substring(pid.length-4)}` : `Player ${pData.seat + 1}`;

      seatElements.push(
        <div key={pid} style={{ position: "absolute", ...pos, display: "flex", flexDirection: "column", alignItems: "center", zIndex: 10, opacity }}>
          {pData.bet > 0 && !isEliminated && (
            <div style={{ position: "absolute", [visualIdx === 3 ? "bottom" : "top"]: visualIdx === 0 ? -30 : visualIdx === 3 ? -30 : 0, [visualIdx === 1 || visualIdx === 2 ? "left" : "right"]: visualIdx !== 0 && visualIdx !== 3 ? -60 : "auto", background: "#0a1a10", border: `1px solid ${cur.color}33`, borderRadius: 20, padding: "2px 8px", fontSize: 11, color: cur.color }}>
              <ChipDisplay amount={pData.bet} currency={currency} />
            </div>
          )}
          
          <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
            {pData.hole_cards?.map((c, i) => <Card key={i} card={c} hidden={c.hidden} small animate />)}
          </div>
          
          <div style={{ position: "relative", background: pData.is_turn ? "linear-gradient(135deg,#2a4020,#1a3010)" : "linear-gradient(135deg,#1a1a2e,#0f0f1a)", border: `2px solid ${pData.is_turn ? cur.color : "#333"}`, borderRadius: 8, padding: "6px 12px", textAlign: "center", minWidth: 90, boxShadow: pData.is_turn ? `0 0 15px ${cur.color}66` : "none" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: isMe ? "#7a9a7a" : "#9a8aac" }}>{displayName}</div>
            {isEliminated ? (
              <span style={{color: "#ef4444", fontSize: 12, fontWeight: 900}}>OUT</span>
            ) : (
              <ChipDisplay amount={pData.stack} currency={currency} />
            )}
            {isEliminated && (
              <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%) rotate(-10deg)", background: "#ef4444", color: "#fff", padding: "2px 6px", borderRadius: 4, fontSize: 10, fontWeight: 900, letterSpacing: 1, border: "1px solid #7f1d1d" }}>
                ELIMINATED
              </div>
            )}
          </div>

          {dealer === pid && !isEliminated && <div style={{ position: "absolute", right: -15, bottom: -10, width: 20, height: 20, borderRadius: "50%", background: "#fff", color: "#000", fontSize: 10, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid #ccc" }}>D</div>}
        </div>
      );
    });
    return seatElements;
  };

  return (
    <div style={{ minHeight: "100vh", background: "#07060f", display: "flex", flexDirection: "column", fontFamily: "'Georgia',serif", color: "#fff", overflow: "hidden", position: "relative" }}>
      <style>{`
        @keyframes dealIn{from{transform:translateY(-25px) scale(0.8);opacity:0}to{transform:none;opacity:1}}
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .act-btn{transition:all 0.15s;cursor:pointer;font-family:'Georgia',serif}
        .act-btn:hover{filter:brightness(1.2);transform:translateY(-1px)}
      `}</style>

      {isTournament && tournament_state === "waiting" && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(7,6,15,0.85)", backdropFilter: "blur(5px)", zIndex: 100, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 60, height: 60, border: `4px solid ${cur.color}33`, borderTopColor: cur.color, borderRadius: "50%", animation: "logo-spin 1s linear infinite", marginBottom: 20 }} />
          <h2 style={{ fontSize: 24, margin: "0 0 10px" }}>Waiting for players...</h2>
          <div style={{ fontSize: 16, color: cur.color, fontWeight: 700, marginBottom: 20 }}>{Object.keys(players).length} / 6 Seated</div>
          
          {localCountdown !== null && localCountdown > 0 ? (
            <div style={{ marginTop: 10, textAlign: "center", background: "#1a1a2e", padding: "16px 32px", borderRadius: 16, border: `2px solid ${cur.color}44` }}>
              <div style={{ fontSize: 13, color: "#a0908c", textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 }}>Game Starts In</div>
              <div style={{ fontSize: 48, fontWeight: 900, color: cur.color, fontVariantNumeric: "tabular-nums" }}>{localCountdown}s</div>
            </div>
          ) : Object.keys(players).length >= 2 ? (
            <div style={{ marginTop: 20, fontSize: 18, color: cur.color, fontWeight: 900, animation: "pulse 1s infinite" }}>Starting...</div>
          ) : (
            <p style={{ color: "#888", fontSize: 13, maxWidth: 300, textAlign: "center", marginTop: 10 }}>Waiting for at least 2 players to start the countdown.</p>
          )}
          
          <button onClick={onLeave} style={{ marginTop: 30, background: "transparent", border: "1px solid #5a5070", color: "#a0908c", padding: "8px 20px", borderRadius: 6, cursor: "pointer" }}>Leave Lobby</button>
        </div>
      )}

      {isTournament && tournament_state === "finished" && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(7,6,15,0.9)", backdropFilter: "blur(8px)", zIndex: 100, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <h1 style={{ color: cur.color, fontSize: 32, marginBottom: 10 }}>🏆 Tournament Complete 🏆</h1>
          <h2 style={{ fontSize: 24, color: "#fff", marginBottom: 30 }}>{result?.winners?.includes(viewer_id) ? "Congratulations, you won!" : "You have been eliminated."}</h2>
          <button onClick={onLeave} style={{ padding: "12px 40px", borderRadius: 8, border: "none", background: "linear-gradient(135deg,#7c3aed,#5b21b6)", color: "#fff", fontWeight: 900, fontSize: 15, cursor: "pointer" }}>Return to Lobby</button>
        </div>
      )}

      <div style={{ padding: "10px 20px", borderBottom: "1px solid #ffffff0a", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#09080f" }}>
        <button onClick={onLeave} className="act-btn" style={{ background: "none", border: "1px solid #ffffff15", color: "#5a5070", padding: "6px 14px", borderRadius: 6, fontSize: 13 }}>{"<- Lobby"}</button>
        
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ fontSize: 11, color: "#a0908c", textTransform: "uppercase", letterSpacing: 2 }}>{isTournament ? "Tournament" : "Cash Game"} • {phase}</div>
          
          {isTournament && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, background: "#1a1a2e", padding: "4px 12px", borderRadius: 20, border: "1px solid #333" }}>
              <span style={{ fontSize: 11, color: "#888" }}>Blinds: <strong style={{ color: "#fff" }}>{small_blind}/{big_blind}</strong></span>
              <span style={{ width: 1, height: 12, background: "#444" }} />
              <span style={{ fontSize: 11, color: next_blind_sec < 10 ? "#ef4444" : cur.color }}>Next level in: <strong>{next_blind_sec}s</strong></span>
            </div>
          )}
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 20px", background: "radial-gradient(ellipse at 50% 50%,#0d2a18 0%,#07060f 80%)" }}>
        <div style={{ position: "relative", width: "100%", maxWidth: 800, height: 380, borderRadius: "200px", background: "linear-gradient(160deg,#0d4020 0%,#08280f 50%,#051a0a 100%)", border: "8px solid #2a1a05", boxShadow: "0 0 60px #0d401544, inset 0 0 50px #00000055", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          {renderSeats()}
          <div style={{ display: "flex", gap: 8, minHeight: 80, alignItems: "center", justifyContent: "center", zIndex: 5 }}>
            {community_cards?.map((c, i) => <Card key={i} card={c} animate />)}
            {Array.from({ length: Math.max(0, 5 - (community_cards?.length || 0)) }).map((_, i) => (
              <div key={i} style={{ width: 52, height: 76, borderRadius: 6, border: "1px dashed #ffffff11", background: "#ffffff03" }} />
            ))}
          </div>
          <div style={{ position: "absolute", top: "65%", display: "flex", alignItems: "center", gap: 8, background: "#00000066", padding: "4px 16px", borderRadius: 20 }}>
            <span style={{ fontSize: 11, color: "#ffffff66", letterSpacing: 2, textTransform: "uppercase" }}>Pot</span>
            <span style={{ fontSize: 18, fontWeight: 900, color: cur.color, fontFamily: "'Courier New',monospace" }}>{cur.symbol}{pot.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {handOver && result && (
        <div style={{ padding: "12px 20px", textAlign: "center", background: result.winners?.includes(viewer_id) ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.12)", borderTop: `1px solid ${result.winners?.includes(viewer_id) ? "#10b981" : "#ef4444"}33` }}>
          <span style={{ fontSize: 18, fontWeight: 900, color: result.winners?.includes(viewer_id) ? "#10b981" : "#ef4444" }}>
            {result.reason === "fold" ? "Everyone else folded!" : 
             result.winners?.length > 1 ? "Showdown! Split Pot!" : 
             result.winners?.includes(viewer_id) ? "Showdown! You won the pot!" : 
             "Showdown! Opponent won the pot."}
          </span>
        </div>
      )}

      <div style={{ padding: "16px 20px", background: "#09080f", borderTop: "1px solid #ffffff08", minHeight: 90 }}>
        {myData.eliminated ? (
          <div style={{ textAlign: "center", color: "#ef4444", fontSize: 16, fontWeight: 900, padding: "8px 0" }}>You have been eliminated from the tournament.</div>
        ) : handOver ? (
          <div style={{ display: "flex", justifyContent: "center" }}>
            <button className="act-btn" onClick={() => sendAction("new_hand")} style={{ padding: "12px 40px", borderRadius: 8, border: "none", background: `linear-gradient(135deg,${cur.color},${cur.color}bb)`, color: "#000", fontWeight: 900, fontSize: 15 }}>
              Deal Next Hand
            </button>
          </div>
        ) : isMyTurn ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", maxWidth: 600, margin: "0 auto" }}>
            <div style={{ display: "flex", gap: 8, width: "100%", justifyContent: "center" }}>
              <button className="act-btn" onClick={() => sendAction("fold")} style={{ flex: 1, padding: "11px", borderRadius: 8, background: "rgba(239,68,68,0.08)", color: "#f87171", border: "1px solid #ef444444" }}>Fold</button>
              {canCheck ? (
                <button className="act-btn" onClick={() => sendAction("check")} style={{ flex: 1, padding: "11px", borderRadius: 8, background: "rgba(255,255,255,0.05)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)" }}>Check</button>
              ) : (
                <button className="act-btn" onClick={() => sendAction("call")} style={{ flex: 1, padding: "11px", borderRadius: 8, background: `${cur.color}15`, color: cur.color, border: `1px solid ${cur.color}55`, fontWeight: 700 }}>Call {cur.symbol}{callAmt.toLocaleString()}</button>
              )}
              <button className="act-btn" onClick={() => sendAction(canCheck ? "bet" : "raise", betInput)} disabled={myData.stack <= 0} style={{ flex: 1, padding: "11px", borderRadius: 8, background: `linear-gradient(135deg,${cur.color},${cur.color}aa)`, color: "#000", fontWeight: 900, border: "none" }}>{canCheck ? "Bet" : "Raise"} {cur.symbol}{betInput.toLocaleString()}</button>
            </div>
            <input type="range" min={big_blind} max={myData.stack} step={big_blind} value={betInput} onChange={e => setBetInput(+e.target.value)} style={{ width: "100%", accentColor: cur.color }} />
          </div>
        ) : (
          <div style={{ textAlign: "center", color: "#3a3050", fontSize: 13, padding: "8px 0" }}>Waiting for other players...</div>
        )}
      </div>
    </div>
  );
}