import React, { useState } from "react";
import Lobby from "./components/Lobby";
import GameScreen from "./components/GameScreen";
import { loadStoredSession, saveStoredSession } from "./utils/helpers";

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
      <GameScreen 
        tournament={selectedTournament} 
        session={session} 
        walletAddress={walletAddress} 
        onLeave={() => { setSelectedTournament(null); setScreen("lobby"); }} 
      />
    );
  }

  return (
    <Lobby 
      session={session} 
      walletAddress={walletAddress} 
      onSession={handleSession} 
      onStart={(tournament) => { setSelectedTournament(tournament); setScreen("game"); }} 
      onWallet={setWalletAddress} 
    />
  );
}