import { useEffect, useRef, useState } from "react";
import { ethers } from "ethers";

// ─── WEB3 CONSTANTS ──────────────────────────────────────────────────────────
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Base Sepolia USDC
const ESCROW_ADDRESS = "0xd9145CCE52D386f254917e481eB44e9943F39138";
// Set to true once you confirm getAllTournaments() is live on-chain
const ONCHAIN_TOURNAMENTS_ENABLED = false;

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
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";
const WS_BASE_URL =
  import.meta.env.VITE_WS_URL ||
  `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}`;
const ENABLE_WALLET_CONNECT = import.meta.env.VITE_ENABLE_WALLET_CONNECT !== "false";
const SESSION_KEY = "royal_flush_demo_session";
const CURRENCY = { symbol: "S", color: "#c9a84c" };
const SUIT_SYMBOLS = { S: "♠", H: "♥", D: "♦", C: "♣" };

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
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
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState("");

  const fetchTournaments = async () => {
    // 1. Fetch free API tournaments
    try {
      const response = await fetch(apiUrl("/api/tournaments"));
      if (response.ok) {
        const data = await response.json();
        setTournaments(data.items || []);
      }
    } catch (err) {
      console.warn("Could not load API tournaments:", err);
    }

    // 2. Fetch Web3 Blockchain tournaments (only when explicitly enabled)
    if (ONCHAIN_TOURNAMENTS_ENABLED) {
      try {
        const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
        const escrowContract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, provider);
        const data = await escrowContract.getAllTournaments();
        const formattedWeb3 = data.map(t => ({
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
      } catch (err) {
        console.warn("Could not load on-chain tournaments (contract may not be deployed or ABI mismatch):", err?.shortMessage || err?.message || err);
        setWeb3Tournaments([]);
      }
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
      if (!response.ok) throw new Error("Could not create your demo seat.");
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
      if (!response.ok) throw new Error(data.detail || "Could not join this table.");
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

  // Combine the arrays for the UI render
  const allTournaments = [...web3Tournaments, ...tournaments];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "fixed", inset: 0, zIndex: 0, background: "radial-gradient(ellipse 80% 60% at 50% 70%, rgba(13,61,32,0.45) 0%, transparent 70%), radial-gradient(ellipse 60% 40% at 80% 20%, rgba(201,168,76,0.09) 0%, transparent 60%), #08070f" }} />

      <header style={{ position: "relative", zIndex: 10, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 32px", borderBottom: "1px solid var(--border)", background: "rgba(8,7,15,0.78)", backdropFilter: "blur(18px)" }}>
        <div>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 24, color: "var(--gold)", fontWeight: 800 }}>Royal Flush</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", letterSpacing: 2, textTransform: "uppercase" }}>Web3 Casino Prototype</div>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          {session ? (
            <div style={sessionBadgeStyle}>
              {session.display_name} · {CURRENCY.symbol}{session.chip_balance?.toLocaleString?.() ?? session.chip_balance}
            </div>
          ) : null}

          {ENABLE_WALLET_CONNECT ? (
            walletAddress ? (
              <div style={walletBadgeStyle}>{walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</div>
            ) : (
              <button onClick={connectWallet} style={headerButtonStyle()}>Connect Wallet</button>
            )
          ) : null}
        </div>
      </header>

      <main style={{ position: "relative", zIndex: 10, flex: 1, padding: "44px 24px 72px" }}>
        <section style={{ maxWidth: 1040, margin: "0 auto 28px" }}>
          <h1 style={heroTitleStyle}>High Stakes Tables</h1>
          <p style={heroCopyStyle}>Connect your wallet to join exclusive NFT-gated tables, or jump into a free play-chip game below to test the engine.</p>
        </section>

        <section style={lobbyGridStyle}>
          <div style={panelStyle()}>
            <div style={sectionEyebrowStyle}>Demo Profile</div>
            <h2 style={sectionTitleStyle}>Seat yourself</h2>
            <p style={sectionCopyStyle}>Profiles persist in local storage so reconnecting to the same browser resumes your bankroll.</p>

            <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>Display name</label>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Guest Shark" style={inputStyle} maxLength={24} />

            <button onClick={createOrResumeSession} disabled={submitting} style={{ ...primaryButtonStyle, width: "100%", marginTop: 14 }}>
              {session ? "Refresh Demo Session" : "Create Demo Session"}
            </button>

            {banner ? <p style={{ marginTop: 14, color: "#10b981", fontSize: 13 }}>{banner}</p> : null}
            {error ? <p style={{ marginTop: 14, color: "#f87171", fontSize: 13 }}>{error}</p> : null}
          </div>

          <div style={panelStyle()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
              <div>
                <div style={sectionEyebrowStyle}>Sit-and-Go Lobby</div>
                <h2 style={sectionTitleStyle}>Join a Table</h2>
              </div>
              {loading || submitting ? <Spinner size={30} /> : null}
            </div>

            <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
              {allTournaments.map((tournament) => {
                const isJoinable = tournament.state === "registering" || tournament.state === "countdown";
                return (
                  <div key={tournament.id} style={tournamentCardStyle()}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                      <div>
                        {tournament.isWeb3 ? (
                          <div style={{ display: "inline-block", background: "rgba(124, 58, 237, 0.15)", color: "#a78bfa", fontSize: 10, fontWeight: 900, padding: "3px 8px", borderRadius: 20, letterSpacing: 1, marginBottom: 8 }}>NFT GATED</div>
                        ) : (
                          <div style={{ display: "inline-block", background: "rgba(16, 185, 129, 0.15)", color: "#10b981", fontSize: 10, fontWeight: 900, padding: "3px 8px", borderRadius: 20, letterSpacing: 1, marginBottom: 8 }}>OPEN TABLE</div>
                        )}
                        <div style={{ fontSize: 18, fontWeight: 800 }}>{tournament.title}</div>
                        <div style={{ marginTop: 6, fontSize: 13, color: "var(--text-secondary)" }}>
                           {tournament.desc || (tournament.state === "countdown" ? `Starts in ${tournament.countdown_remaining}s` : tournament.state === "running" ? "Tournament is live" : "Registering now")}
                        </div>
                      </div>
                      <span style={pillStyle()}>{tournament.seated_count}/{tournament.max_seats}</span>
                    </div>

                    <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", color: "var(--text-muted)", fontSize: 12 }}>
                      {tournament.isWeb3 ? (
                        <span style={{ color: "#a78bfa", fontWeight: 700 }}>Buy-in: {tournament.buy_in_usdc} USDC</span>
                      ) : (
                        <span style={{ color: "#10b981", fontWeight: 700 }}>Buy-in: {CURRENCY.symbol}{tournament.buy_in_chips?.toLocaleString()}</span>
                      )}
                      <span>6-Max SNG</span>
                    </div>

                    <button onClick={() => handleJoin(tournament)} disabled={submitting || !isJoinable} style={{ ...primaryButtonStyle, marginTop: 16, width: "100%", opacity: isJoinable ? 1 : 0.55 }}>
                      {isJoinable ? "Join Table" : tournament.state === "running" ? "In Progress" : "Closed"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </main>
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