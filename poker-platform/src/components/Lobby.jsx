import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { 
  apiUrl, getResponseError, normalizeApiGame, normalizeWeb3Game, 
  gameSectionKey, gameAppearance, deduplicateGames, formatBuyIn
} from '../utils/helpers';
import { 
  ESCROW_ADDRESS, USDC_ADDRESS, ERC721_ABI, ERC20_ABI, ESCROW_ABI, 
  CURRENCY, ENABLE_WALLET_CONNECT 
} from '../utils/constants';
import CreateModal from './CreateModal';

export default function Lobby({ session, walletAddress, onSession, onStart, onWallet }) {
  const [displayName, setDisplayName] = useState(session?.display_name || "");
  const [tournaments, setTournaments] = useState([]);
  const [web3Tournaments, setWeb3Tournaments] = useState([]);
  const [assets, setAssets] = useState([]);
  const [contractStatus, setContractStatus] = useState("loading");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState("");
  const [creatorOpen, setCreatorOpen] = useState(false);

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
  }, [session, onSession, walletAddress]);

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
      setBanner("Demo profile ready. Pick a table below.");
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

    if (tournament.isWeb3) {
      if (!walletAddress) {
        setError("You must connect your MetaMask wallet to join a VIP Table.");
        setSubmitting(false);
        return;
      }
      
      try {
        setBanner(`Verifying NFT & Depositing ${tournament.buy_in_usdc} USDC... Please check MetaMask.`);
        const provider = new ethers.BrowserProvider(window.ethereum);
        
        const network = await provider.getNetwork();
        if (network.chainId !== 84532n) {
          await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x14a34' }] });
        }

        const nftContract = new ethers.Contract(tournament.requiredNft, ERC721_ABI, provider);
        const nftBalance = await nftContract.balanceOf(walletAddress);
        if (nftBalance === 0n) {
          throw new Error(`Access Denied: You do not own the required NFT for ${tournament.title}!`);
        }

        const signer = await provider.getSigner();
        const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer);
        const escrowContract = new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, signer);
        const depositAmount = ethers.parseUnits(tournament.buy_in_usdc.toString(), 6);
        
        const approveTx = await usdcContract.approve(ESCROW_ADDRESS, depositAmount);
        await approveTx.wait();
        const depositTx = await escrowContract.buyIn(tournament.id, depositAmount);
        await depositTx.wait();
        
        setBanner("Deposit confirmed! Connecting to table...");
      } catch (err) {
        setError(err.message || "Web3 Transaction failed or was canceled.");
        setSubmitting(false);
        return;
      }
    }

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

  const handleTableCreateSuccess = async (payload) => {
    try {
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
      await fetchTournaments();
    } catch (err) {
      throw err;
    }
  };

  // Merge and de-duplicate all games by id
  let allTournaments = deduplicateGames([...web3Tournaments, ...tournaments]);
  
  // De-duplicate by title and section to clean up seeded duplicates, 
  // keeping exactly one cash game and one sng demo of the same name.
  const seenDemoTypes = new Set();
  allTournaments = allTournaments.filter(g => {
    if (g.access === "nft" || g.isWeb3) return true;
    const demoKey = `${g.title.trim().toLowerCase()}-${gameSectionKey(g)}`;
    if (seenDemoTypes.has(demoKey)) return false;
    seenDemoTypes.add(demoKey);
    return true;
  });
  
  // Split into proper lobby sections
  const gamesBySection = {
    cash: allTournaments.filter(g => gameSectionKey(g) === "cash"),
    sng: allTournaments.filter(g => gameSectionKey(g) === "sng"),
    scheduled: allTournaments.filter(g => gameSectionKey(g) === "scheduled"),
    featured: allTournaments.filter(g => gameSectionKey(g) === "featured"),
  };
  // Combine non-NFT tournaments into one "Live Games" section for cleaner display
  const liveGames = [...gamesBySection.cash, ...gamesBySection.sng, ...gamesBySection.scheduled];

  const renderTableCard = (t) => {
    const isJoinable = t.state === "scheduled" || t.state === "registering" || t.state === "countdown";
    const isFinished = t.state === "finished";
    const isScheduled = t.mode === "tournament_scheduled";
    const appearance = gameAppearance(t);
    const accent = appearance.accent;
    const isNft = t.access === "nft" || t.isWeb3;

    return (
      <div key={t.id} style={{
        borderRadius: 22, padding: 28,
        background: isNft
          ? "linear-gradient(155deg, rgba(20,14,40,0.98) 0%, rgba(12,9,24,0.99) 100%)"
          : "linear-gradient(155deg, rgba(18,16,36,0.95) 0%, rgba(11,10,22,0.98) 100%)",
        border: `1px solid ${isNft ? "rgba(139,92,246,0.2)" : "rgba(255,255,255,0.07)"}`,
        boxShadow: `0 24px 60px rgba(0,0,0,0.45)`,
        display: "flex", flexDirection: "column", gap: 0,
        transition: "transform 0.2s, box-shadow 0.2s",
        cursor: "default",
        opacity: isFinished ? 0.65 : 1,
      }}
        onMouseEnter={e => { if (!isFinished) { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = `0 32px 80px rgba(0,0,0,0.55), 0 0 0 1px ${accent}44`; } }}
        onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 24px 60px rgba(0,0,0,0.45)"; }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase", padding: "4px 10px", borderRadius: 20, background: appearance.badgeBg, color: appearance.badgeColor }}>
            {isFinished ? "CLOSED" : appearance.badgeLabel}
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: accent, border: `1px solid ${accent}44`, borderRadius: 999, padding: "4px 10px" }}>
            {t.seated_count ?? 0}/{t.max_seats ?? 6}
          </span>
        </div>

        <div style={{ fontSize: 36, color: accent, marginBottom: 10, lineHeight: 1 }}>{appearance.icon}</div>
        <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, fontWeight: 900, marginBottom: 10, lineHeight: 1.2 }}>{t.title}</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.6, marginBottom: 20, flex: 1 }}>
          {t.desc}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18, fontSize: 13 }}>
          <span style={{ color: accent, fontWeight: 800 }}>
            Buy-in: {formatBuyIn(t)}
          </span>
          <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 12 }}>
            {isScheduled ? "Scheduled" : isNft ? "NFT Event" : t.category === "cash" ? "Cash Table" : "Sit & Go"}
          </span>
        </div>

        {isNft && !isFinished ? (
          <div style={{ marginBottom: 14, fontSize: 11, color: "rgba(139,92,246,0.85)", background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 10, padding: "8px 12px" }}>
            🔒 Requires NFT ownership to join
          </div>
        ) : null}

        <button
          onClick={() => !isFinished && handleJoin(t)}
          disabled={submitting || isFinished || (isScheduled && t.state === "scheduled")}
          style={{
            width: "100%", padding: "13px 0", borderRadius: 12, border: "none",
            fontWeight: 800, fontSize: 14,
            cursor: (submitting || isFinished || (isScheduled && t.state === "scheduled")) ? "not-allowed" : "pointer",
            background: isFinished
              ? "rgba(255,255,255,0.04)"
              : isScheduled && t.state === "scheduled"
              ? `rgba(201,168,76,0.10)`
              : isNft
              ? "linear-gradient(135deg,#7c3aed,#a78bfa)"
              : "linear-gradient(135deg,#c9a84c,#f0d060)",
            color: isFinished ? "rgba(255,255,255,0.2)" : isScheduled && t.state === "scheduled" ? "#c9a84c" : isNft ? "#fff" : "#08070f",
            transition: "opacity 0.2s",
            ...(isScheduled && t.state === "scheduled" ? { border: "1px solid rgba(201,168,76,0.3)" } : { border: "none" })
          }}>
          {isFinished ? "Closed" : isScheduled && t.state === "scheduled" ? "Registration Opens Soon" : submitting ? "Joining…" : "Join Table →"}
        </button>
      </div>
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: "#08070f", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden", fontFamily: "'Inter', sans-serif", color: "#fff" }}>

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
          <div title={contractStatus === "ok" ? "On-chain contract responding" : "On-chain contract unreachable"} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: contractStatus === "ok" ? "#10b981" : contractStatus === "error" ? "rgba(239,68,68,0.7)" : "rgba(255,255,255,0.2)" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "inline-block", boxShadow: contractStatus === "ok" ? "0 0 6px #10b981" : "none" }} />
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

          {/* This is the ONLY Create Table button now */}
          <button onClick={() => setCreatorOpen(true)} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 999, padding: "10px 18px", color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            + Create Table
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

        {!session ? (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 0, maxWidth: 380, borderRadius: 14, overflow: "hidden", border: "1px solid rgba(201,168,76,0.25)", background: "rgba(255,255,255,0.04)" }}>
              <input
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && createOrResumeSession()}
                placeholder="Your name…"
                maxLength={24}
                style={{ width: "180px", background: "transparent", border: "none", outline: "none", padding: "14px 18px", color: "#fff", fontSize: 14 }}
              />
              <button
                onClick={createOrResumeSession}
                disabled={submitting}
                style={{ background: "linear-gradient(135deg,#c9a84c,#f0d060)", border: "none", padding: "14px 22px", color: "#08070f", fontWeight: 800, fontSize: 13, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.6 : 1, whiteSpace: "nowrap" }}>
                {submitting ? "…" : "Enter Casino"}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 999, padding: "10px 20px" }}>
              <span style={{ fontSize: 18 }}>♠</span>
              <span style={{ color: "#10b981", fontWeight: 700, fontSize: 14 }}>Welcome back, {session.display_name}</span>
              <button onClick={createOrResumeSession} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", fontSize: 11, cursor: "pointer", padding: 0 }}>refresh</button>
            </div>
          </div>
        )}

        {banner ? <p style={{ marginTop: 18, color: "#10b981", fontSize: 13 }}>{banner}</p> : null}
        {error ? <p style={{ marginTop: 14, color: "#f87171", fontSize: 13 }}>{error}</p> : null}
      </section>

      {/* ── LOBBY SECTIONS ── */}
      <section style={{ position: "relative", zIndex: 10, maxWidth: 1140, margin: "0 auto", padding: "0 24px 80px", width: "100%" }}>

        {/* ── SECTION 1: LIVE GAMES (Cash + SnG + Scheduled) ── */}
        <div style={{ marginBottom: 56 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: "#c9a84c", fontWeight: 700, marginBottom: 8 }}>Open Tables</div>
              <h2 style={{ margin: 0, fontFamily: "'Playfair Display', serif", fontSize: 28, fontWeight: 900 }}>Live Games</h2>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 20 }}>
            {liveGames.map(renderTableCard)}
            {liveGames.length === 0 ? (
              <div style={{ gridColumn: "1/-1", padding: "48px 32px", textAlign: "center", borderRadius: 18, border: "1px dashed rgba(201,168,76,0.12)", color: "rgba(255,255,255,0.25)", fontSize: 14 }}>
                No tables open right now. Be the first to create one.
              </div>
            ) : null}
          </div>
        </div>

        {/* ── SECTION 2: FEATURED NFT EVENTS ── */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: "#a78bfa", fontWeight: 700, marginBottom: 8 }}>NFT Holders Only</div>
              <h2 style={{ margin: 0, fontFamily: "'Playfair Display', serif", fontSize: 28, fontWeight: 900 }}>Featured Events</h2>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: contractStatus === "ok" ? "#10b981" : "rgba(255,255,255,0.25)" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
              {contractStatus === "ok" ? "Contract live" : contractStatus === "error" ? "Contract unreachable" : "Checking chain…"}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 20 }}>
            {gamesBySection.featured.map(renderTableCard)}
            {gamesBySection.featured.length === 0 ? (
              <div style={{ gridColumn: "1/-1", padding: "48px 32px", textAlign: "center", borderRadius: 18, border: "1px dashed rgba(139,92,246,0.12)", color: "rgba(255,255,255,0.25)", fontSize: 14 }}>
                {contractStatus === "loading" ? "Fetching on-chain events…" : "No NFT events published on-chain yet."}
              </div>
            ) : null}
          </div>
        </div>

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

      {creatorOpen && (
        <CreateModal 
          onClose={() => setCreatorOpen(false)}
          session={session}
          walletAddress={walletAddress}
          onSuccess={handleTableCreateSuccess}
          assets={assets}
        />
      )}

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