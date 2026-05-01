import React, { useEffect, useState, useRef } from 'react';
import { formatWsUrl } from '../utils/helpers';
import { CURRENCY } from '../utils/constants';
import { Card, Spinner, Modal, ActionButton } from './shared';

// ─── STYLES ──────────────────────────────────────────────────────────────────
function tournamentCardStyle() { return { borderRadius: 18, padding: 18, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.03)" }; }
function handBannerStyle(isWinner) { return { padding: "12px 24px", textAlign: "center", background: isWinner ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.05)" }; }

const betBadgeStyle = { marginBottom: 5, background: "rgba(8,7,15,0.88)", border: "1px solid rgba(201,168,76,0.25)", borderRadius: 20, padding: "2px 9px", fontSize: 11, fontWeight: 700, color: "#c9a84c" };
const seatPanelStyle = { background: "linear-gradient(135deg, rgba(15,14,26,0.97), rgba(10,9,20,0.97))", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "8px 14px", minWidth: 96, textAlign: "center", position: "relative" };
const dealerBadgeStyle = { position: "absolute", top: -8, right: -8, width: 18, height: 18, borderRadius: "50%", background: "#fff", color: "#000", fontSize: 9, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" };
const secondaryButtonStyle = { background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "#9a90b4", borderRadius: 10, padding: "10px 16px", cursor: "pointer" };
const loadingScreenStyle = { minHeight: "100vh", background: "#08070f", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20 };
const gameShellStyle = { minHeight: "100vh", background: "#08070f", display: "flex", flexDirection: "column", color: "#fff" };
const topBarStyle = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 24px", background: "rgba(8,7,15,0.85)", borderBottom: "1px solid rgba(255,255,255,0.06)" };
const tableAreaStyle = { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 80px", background: "radial-gradient(ellipse 90% 70% at 50% 50%, rgba(13,61,32,0.3) 0%, transparent 75%), #08070f" };
const tableStyle = { position: "relative", width: "100%", maxWidth: 820, height: 380, borderRadius: "50% / 45%", background: "radial-gradient(ellipse at 50% 40%, #0f5030 0%, #0b3d22 40%, #08280f 100%)", border: "10px solid #1a0e05", boxShadow: "0 0 0 3px #2e1a08, 0 0 80px rgba(0,0,0,0.7), inset 0 0 80px rgba(0,0,0,0.4)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" };
const potBadgeStyle = { display: "flex", alignItems: "center", gap: 8, background: "rgba(0,0,0,0.45)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 999, padding: "5px 18px", zIndex: 5 };
const actionBarStyle = { padding: "18px 24px", background: "rgba(8,7,15,0.9)", borderTop: "1px solid rgba(255,255,255,0.06)", minHeight: 88, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" };


export default function GameScreen({ tournament, session, walletAddress, onLeave }) {
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
        <p style={{ margin: 0, color: "#9a90b4" }}>{status}</p>
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

  const handleLeaveClick = async () => {
    if (tournament_state === "registering" || tournament_state === "countdown" || tournament_state === "finished") {
      try {
        await fetch(apiUrl(`/api/tournaments/${tournament.id}/leave`), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ player_id: session.player_id, reconnect_token: session.reconnect_token })
        });
      } catch (err) {
        console.warn("Could not gracefully leave table:", err);
      }
    }
    onLeave();
  };

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
          <div style={{ fontSize: 10, color: isMe ? "#10b981" : "#5a5472", marginBottom: 3 }}>{label}</div>
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
          <p style={{ margin: 0, color: "#9a90b4" }}>{Object.keys(players).length}/6 seated · starts in {countdown_remaining}s</p>
          <button onClick={handleLeaveClick} style={secondaryButtonStyle}>Leave Lobby</button>
        </Modal>
      ) : null}

      {tournament_state === "finished" ? (
        <Modal>
          <div style={{ fontSize: 56 }}>{result?.winners?.includes(viewer_id) ? "🏆" : "♠"}</div>
          <h2 style={{ margin: "0 0 6px", fontSize: 26 }}>{result?.winners?.includes(viewer_id) ? "Victory" : "Tournament Complete"}</h2>
          <p style={{ margin: 0, color: "#9a90b4" }}>{result?.winners?.includes(viewer_id) ? "You won the sit-and-go." : "The final result is locked in."}</p>
          <button onClick={handleLeaveClick} style={secondaryButtonStyle}>Return to Lobby</button>
        </Modal>
      ) : null}

      <div style={topBarStyle}>
        <button onClick={handleLeaveClick} style={secondaryButtonStyle}>Back to Lobby</button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: 2, color: "#5a5472", textTransform: "uppercase" }}>{title || tournament.title}</div>
          <div style={{ fontWeight: 700 }}>{phase || "waiting"} · blinds {small_blind}/{big_blind}</div>
        </div>
        <div style={{ fontSize: 12, color: "#9a90b4", textAlign: "right" }}>
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
            <span style={{ fontSize: 20, fontWeight: 900, color: "#c9a84c" }}>{CURRENCY.symbol}{pot.toLocaleString()}</span>
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
          <p style={{ color: "#9a90b4", margin: 0 }}>Server will deal the next hand automatically.</p>
        ) : isMyTurn ? (
          <div style={{ width: "100%", maxWidth: 640 }}>
            <div style={{ display: "flex", gap: 8, width: "100%" }}>
              <ActionButton label="Fold" onClick={() => sendAction("fold")} variant="danger" />
              <ActionButton label={canCheck ? "Check" : `Call ${CURRENCY.symbol}${callAmt}`} onClick={() => sendAction(canCheck ? "check" : "call")} />
              <ActionButton label={`${canCheck ? "Bet" : "Raise"} ${CURRENCY.symbol}${betInput}`} onClick={() => sendAction(canCheck ? "bet" : "raise", betInput)} variant="primary" disabled={myData.stack <= 0} />
              <ActionButton label={`All-In ${CURRENCY.symbol}${myData.stack}`} onClick={() => sendAction("allin", myData.stack)} variant="danger" disabled={myData.stack <= 0} />
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
              <span style={{ fontSize: 11, color: "#5a5472" }}>{CURRENCY.symbol}{big_blind}</span>
              <input type="range" min={big_blind} max={Math.max(big_blind, myData.stack)} step={big_blind} value={Math.min(betInput, Math.max(big_blind, myData.stack))} onChange={(event) => setBetInput(Number(event.target.value))} style={{ flex: 1, accentColor: "#c9a84c" }} />
              <span style={{ fontSize: 11, color: "#5a5472" }}>{CURRENCY.symbol}{myData.stack}</span>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: "#9a90b4" }}>Auto action in about {turnDeadline}s if you disconnect or stall.</div>
          </div>
        ) : (
          <p style={{ color: "#9a90b4", margin: 0 }}>{tournament_state === "running" ? "Waiting for the next action..." : "Waiting for enough players to start."}</p>
        )}
      </div>
    </div>
  );
}

