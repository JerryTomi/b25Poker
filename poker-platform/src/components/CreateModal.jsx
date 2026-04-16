import React, { useState } from 'react';
import { ethers } from 'ethers';
import { Modal } from './shared';
import { ERC721_ABI } from '../utils/constants';

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
    // Advanced blind schedule
    customBlindsEnabled: false,
    blindSchedule: [
      { small_blind: 25, big_blind: 50 },
      { small_blind: 50, big_blind: 100 },
      { small_blind: 75, big_blind: 150 },
      { small_blind: 100, big_blind: 200 }
    ],
    // Admin custom asset
    adminNftAddress: "",
    customAssetAddress: "",
  };
}

function CreatorTabButton({ active, children, onClick, disabled = false }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1, padding: "14px 10px", borderRadius: 14,
        border: active ? "1px solid rgba(201,168,76,0.6)" : "1px solid rgba(255,255,255,0.08)",
        background: active ? "rgba(201,168,76,0.15)" : "rgba(255,255,255,0.04)",
        color: active ? "#f0d060" : "rgba(255,255,255,0.72)",
        fontSize: 14, fontWeight: 800,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1, transition: "all 0.2s"
      }}
    >
      {children}
    </button>
  );
}

function FieldLabel({ children }) {
  return <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.6)", marginBottom: 8 }}>{children}</div>;
}

function CreatorInput(props) {
  return (
    <input
      {...props}
      style={{
        width: "100%", borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)",
        color: "#fff", padding: "14px 16px", outline: "none", boxSizing: "border-box", fontSize: 14,
        transition: "border 0.2s, background 0.2s",
        ...(props.style || {}),
      }}
      onFocus={(e) => { e.target.style.border = "1px solid rgba(201,168,76,0.5)"; e.target.style.background = "rgba(255,255,255,0.08)"; }}
      onBlur={(e) => { e.target.style.border = "1px solid rgba(255,255,255,0.1)"; e.target.style.background = "rgba(255,255,255,0.04)"; }}
    />
  );
}

function CreatorSelect(props) {
  return (
    <select
      {...props}
      style={{
        width: "100%", borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.1)", background: "rgba(18,16,36,0.95)",
        color: "#fff", padding: "14px 16px", outline: "none", boxSizing: "border-box", fontSize: 14,
        ...(props.style || {}),
      }}
    />
  );
}

export default function CreateModal({ onClose, session, walletAddress, onSuccess, assets }) {
  const [creatorTab, setCreatorTab] = useState("sng"); // "sng" = Revolving, "tournament" = Scheduled
  const [creatorForm, setCreatorForm] = useState(() => defaultCreatorForm());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [nftValidated, setNftValidated] = useState(false);
  const [validatingNft, setValidatingNft] = useState(false);

  const primaryButtonStyle = { background: "linear-gradient(135deg, #c9a84c, #f0d060)", border: "none", borderRadius: 14, padding: "14px 18px", fontWeight: 800, color: "#08070f", cursor: "pointer", fontSize: 14 };
  const secondaryButtonStyle = { background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "#fff", borderRadius: 14, padding: "14px 18px", fontWeight: 700, cursor: "pointer", fontSize: 14 };

  const updateCreatorForm = (patch) => {
    setCreatorForm((current) => ({ ...current, ...patch }));
  };

  const validateAdminNft = async () => {
    if (!walletAddress) {
      setError("Please connect your wallet first to validate NFT ownership.");
      return;
    }
    if (!creatorForm.adminNftAddress) {
      setError("Please enter the NFT contract address to validate.");
      return;
    }

    setValidatingNft(true);
    setError("");
    try {
      if (!window.ethereum) throw new Error("MetaMask not found.");
      const provider = new ethers.BrowserProvider(window.ethereum);
      
      // We assume it's on the correct network (Base Sepolia in this codebase, but we just check the contract)
      const nftContract = new ethers.Contract(creatorForm.adminNftAddress, ERC721_ABI, provider);
      
      // Attempt to check balance
      const balance = await nftContract.balanceOf(walletAddress);
      
      if (balance > 0n) {
        setNftValidated(true);
      } else {
        throw new Error("You do not own an NFT from this contract.");
      }
    } catch (err) {
      console.error(err);
      setError("NFT Validation failed: " + (err.reason || err.message || "Invalid contract or no balance."));
      setNftValidated(false);
    } finally {
      setValidatingNft(false);
    }
  };

  const handleAddBlindLevel = () => {
    const last = creatorForm.blindSchedule[creatorForm.blindSchedule.length - 1];
    updateCreatorForm({
      blindSchedule: [...creatorForm.blindSchedule, {
        small_blind: last ? last.small_blind * 2 : 100,
        big_blind: last ? last.big_blind * 2 : 200
      }]
    });
  };

  const updateBlind = (index, field, value) => {
    const newSchedule = [...creatorForm.blindSchedule];
    newSchedule[index][field] = Number(value);
    updateCreatorForm({ blindSchedule: newSchedule });
  };
  
  const removeBlind = (index) => {
    if (creatorForm.blindSchedule.length <= 1) return;
    const newSchedule = creatorForm.blindSchedule.filter((_, i) => i !== index);
    updateCreatorForm({ blindSchedule: newSchedule });
  };

  const buildBlindSchedule = () => {
    if (creatorTab === "tournament" && creatorForm.customBlindsEnabled) {
      return creatorForm.blindSchedule;
    }
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
    setSubmitting(true);
    setError("");
    try {
      const registrationOpen = new Date();
      const scheduledStart = creatorTab === "tournament" ? new Date(creatorForm.scheduledStartAt) : null;
      const lateRegEnd = creatorTab === "tournament" && creatorForm.lateRegistrationEndsAt ? new Date(creatorForm.lateRegistrationEndsAt) : null;
      
      const assetToUse = nftValidated && creatorForm.customAssetAddress ? creatorForm.customAssetAddress : creatorForm.assetSymbol;

      const payload = {
        title: creatorForm.title || (creatorTab === "tournament" ? "Scheduled Tournament" : "Revolving Table"),
        desc: creatorForm.desc,
        buy_in_chips: Number(creatorForm.buyIn),
        starting_stack: Number(creatorForm.startingStack),
        category: "tournament",
        mode: creatorTab === "tournament" ? "tournament_scheduled" : "tournament_sng",
        min_players: Number(creatorForm.minPlayers),
        max_seats: Number(creatorForm.maxSeats),
        blind_level_duration_sec: Number(creatorForm.blindLevelDurationSec),
        blind_schedule: buildBlindSchedule(),
        asset_symbol: assetToUse,
        required_nft: creatorForm.requiredNft || null,
        creator_player_id: session.player_id,
        creator_wallet_address: walletAddress || null,
        creator_nft_contract: creatorForm.requiredNft || null,
        registration_opens_at: registrationOpen.toISOString(),
        scheduled_start_at: scheduledStart ? scheduledStart.toISOString() : null,
        late_registration_ends_at: lateRegEnd ? lateRegEnd.toISOString() : null,
        is_recurring: false,
        recurrence_rule: null,
        admin_secret: creatorForm.adminSecret,
      };

      await onSuccess(payload);

    } catch (err) {
      setError(err.message || "Creation failed.");
      setSubmitting(false); // only re-enable if failed, on success modal closes
    }
  };

  return (
    <Modal>
      <div style={{ width: "min(720px, 100%)", borderRadius: 28, background: "linear-gradient(160deg, rgba(22,20,38,0.98) 0%, rgba(12,11,24,0.98) 100%)", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "0 32px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1)", padding: 32, maxHeight: "90vh", overflowY: "auto" }}>
        
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: "var(--gold)", fontWeight: 700 }}>Host a Game</div>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 32, fontWeight: 900, color: "#fff", marginTop: 4 }}>Table Creator</div>
          </div>
          <button onClick={onClose} style={{ ...secondaryButtonStyle, padding: "8px 16px", fontSize: 13, border: "none", background: "rgba(255,255,255,0.05)" }}>✕ Close</button>
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
          <CreatorTabButton active={creatorTab === "sng"} onClick={() => setCreatorTab("sng")}>Revolving Table</CreatorTabButton>
          <CreatorTabButton active={creatorTab === "tournament"} onClick={() => setCreatorTab("tournament")}>Scheduled Tournament</CreatorTabButton>
        </div>

        <div style={{ borderRadius: 20, border: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.2)", padding: 24 }}>
          
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 16 }}>
            <div>
              <FieldLabel>Table Title</FieldLabel>
              <CreatorInput value={creatorForm.title} onChange={(e) => updateCreatorForm({ title: e.target.value })} placeholder={creatorTab === "tournament" ? "e.g. Sunday Million" : "e.g. Midnight Action"} />
            </div>
            <div>
              <FieldLabel>Asset Selection</FieldLabel>
              <CreatorSelect value={creatorForm.assetSymbol} onChange={(e) => updateCreatorForm({ assetSymbol: e.target.value })}>
                {(assets.length ? assets : [{ symbol: "S" }, { symbol: "USDC" }]).map((asset) => (
                  <option key={asset.symbol} value={asset.symbol}>{asset.symbol}</option>
                ))}
              </CreatorSelect>
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <FieldLabel>Description</FieldLabel>
            <CreatorInput value={creatorForm.desc} onChange={(e) => updateCreatorForm({ desc: e.target.value })} placeholder="Describe the format, prize pool, or sponsor" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 24 }}>
            <div>
              <FieldLabel>Buy-In Amount</FieldLabel>
              <CreatorInput type="number" value={creatorForm.buyIn} onChange={(e) => updateCreatorForm({ buyIn: e.target.value })} />
            </div>
            <div>
              <FieldLabel>Starting Stack</FieldLabel>
              <CreatorInput type="number" value={creatorForm.startingStack} onChange={(e) => updateCreatorForm({ startingStack: e.target.value })} />
            </div>
            <div>
              <FieldLabel>Min Players</FieldLabel>
              <CreatorInput type="number" min="2" value={creatorForm.minPlayers} onChange={(e) => updateCreatorForm({ minPlayers: e.target.value })} />
            </div>
            <div>
              <FieldLabel>Max Seats</FieldLabel>
              <CreatorInput type="number" min="2" max="9" value={creatorForm.maxSeats} onChange={(e) => updateCreatorForm({ maxSeats: e.target.value })} />
            </div>
          </div>

          <div style={{ borderTop: "1px dotted rgba(255,255,255,0.1)", margin: "24px 0" }}></div>

          <div style={{ display: "grid", gridTemplateColumns: creatorTab === "tournament" ? "1fr 1fr" : "1fr", gap: 16, marginBottom: 24 }}>
            <div>
              <FieldLabel>Blind Level Duration (Seconds)</FieldLabel>
              <CreatorInput type="number" min="30" step="30" value={creatorForm.blindLevelDurationSec} onChange={(e) => updateCreatorForm({ blindLevelDurationSec: e.target.value })} />
            </div>
            {creatorTab === "tournament" && (
              <div>
                <FieldLabel>Required NFT Gate (Optional)</FieldLabel>
                <CreatorInput value={creatorForm.requiredNft} onChange={(e) => updateCreatorForm({ requiredNft: e.target.value })} placeholder="0x..." />
              </div>
            )}
          </div>

          {creatorTab === "tournament" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
                <div>
                  <FieldLabel>Scheduled Start Time</FieldLabel>
                  <CreatorInput type="datetime-local" value={creatorForm.scheduledStartAt} onChange={(e) => updateCreatorForm({ scheduledStartAt: e.target.value })} />
                </div>
                <div>
                  <FieldLabel>Late Registration Ends</FieldLabel>
                  <CreatorInput type="datetime-local" value={creatorForm.lateRegistrationEndsAt} onChange={(e) => updateCreatorForm({ lateRegistrationEndsAt: e.target.value })} />
                </div>
              </div>

              {/* Dynamic Blinds Area */}
              <div style={{ background: "rgba(201,168,76,0.05)", border: "1px solid rgba(201,168,76,0.15)", borderRadius: 16, padding: 20, marginBottom: 24 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "var(--gold)", fontFamily: "'Playfair Display', serif" }}>Custom Blind Schedule</div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, color: "rgba(255,255,255,0.7)" }}>
                    <input type="checkbox" checked={creatorForm.customBlindsEnabled} onChange={(e) => updateCreatorForm({ customBlindsEnabled: e.target.checked })} style={{ accentColor: "#c9a84c", width: 16, height: 16 }} />
                    Enable Custom Blinds
                  </label>
                </div>
                
                {creatorForm.customBlindsEnabled ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div style={{ display: "flex", gap: 10, padding: "0 10px" }}>
                      <div style={{ flex: 1, fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Level</div>
                      <div style={{ flex: 3, fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Small Blind</div>
                      <div style={{ flex: 3, fontSize: 12, color: "rgba(255,255,255,0.4)" }}>Big Blind</div>
                      <div style={{ flex: 1 }}></div>
                    </div>
                    {creatorForm.blindSchedule.map((lvl, i) => (
                      <div key={i} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <div style={{ flex: 1, textAlign: "center", fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.3)" }}>{i + 1}</div>
                        <CreatorInput style={{ flex: 3, padding: "8px 12px" }} type="number" value={lvl.small_blind} onChange={(e) => updateBlind(i, "small_blind", e.target.value)} />
                        <CreatorInput style={{ flex: 3, padding: "8px 12px" }} type="number" value={lvl.big_blind} onChange={(e) => updateBlind(i, "big_blind", e.target.value)} />
                        <button onClick={() => removeBlind(i)} style={{ flex: 1, background: "rgba(239,68,68,0.1)", border: "none", color: "#f87171", borderRadius: 8, cursor: "pointer", padding: "8px", fontWeight: 800 }}>✕</button>
                      </div>
                    ))}
                    <button onClick={handleAddBlindLevel} style={{ background: "rgba(255,255,255,0.05)", border: "1px dashed rgba(255,255,255,0.2)", color: "#fff", borderRadius: 10, padding: "10px", marginTop: 10, cursor: "pointer", fontWeight: 700 }}>+ Add Level</button>
                  </div>
                ) : (
                  <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>Standard escalating tournament blinds will be applied.</div>
                )}
              </div>

              {/* Admin Asset Selection Area */}
              <div style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 16, padding: 20, marginBottom: 16 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: "#a78bfa", fontFamily: "'Playfair Display', serif", marginBottom: 6 }}>Admin Custom Asset</div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: 16 }}>Hold an approved NFT to set a custom ERC20 contract address as the exclusive table chip.</div>
                
                <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                  <div style={{ flex: 3 }}>
                    <FieldLabel>Your Admin NFT Address</FieldLabel>
                    <CreatorInput placeholder="0x..." value={creatorForm.adminNftAddress} onChange={(e) => { updateCreatorForm({ adminNftAddress: e.target.value }); setNftValidated(false); }} disabled={nftValidated} />
                  </div>
                  <div style={{ flex: 1, display: "flex", alignItems: "flex-end" }}>
                    <button onClick={validateAdminNft} disabled={validatingNft || nftValidated} style={{ ...secondaryButtonStyle, width: "100%", padding: "14px", border: nftValidated ? "1px solid rgba(16,185,129,0.5)" : "1px solid rgba(139,92,246,0.4)", color: nftValidated ? "#10b981" : "#a78bfa" }}>
                      {validatingNft ? "Checking..." : nftValidated ? "Verified ✓" : "Validate"}
                    </button>
                  </div>
                </div>

                {nftValidated && (
                  <div style={{ animation: "fadeUp 0.3s ease-out" }}>
                    <FieldLabel>Custom ERC20 Chip Contract</FieldLabel>
                    <CreatorInput placeholder="0x..." value={creatorForm.customAssetAddress} onChange={(e) => updateCreatorForm({ customAssetAddress: e.target.value })} style={{ border: "1px solid rgba(16,185,129,0.3)" }} />
                    <div style={{ fontSize: 12, color: "#10b981", marginTop: 8 }}>✓ Admin access unlocked. You may define a custom token for this tournament.</div>
                  </div>
                )}
              </div>
            </>
          )}

          {creatorTab === "sng" && (
            <div style={{ borderRadius: 14, padding: "14px 18px", background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.18)", color: "#10b981", fontSize: 13, lineHeight: 1.6, marginBottom: 24, display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 24 }}>♠</span>
              <div>Revolving Tables start immediately when minimal players sit down. Buy-in stays with the player securely.</div>
            </div>
          )}

          <div style={{ marginBottom: 20 }}>
            <FieldLabel>Admin Secret (API Demo Requirement)</FieldLabel>
            <CreatorInput type="password" value={creatorForm.adminSecret} onChange={(e) => updateCreatorForm({ adminSecret: e.target.value })} placeholder="Your backend creation password" />
          </div>

          {error && <div style={{ color: "#f87171", fontSize: 14, marginBottom: 16, background: "rgba(239,68,68,0.1)", padding: 12, borderRadius: 10 }}>⚠️ {error}</div>}

          <div style={{ display: "flex", gap: 12 }}>
            <button onClick={() => setCreatorForm(defaultCreatorForm())} style={{ ...secondaryButtonStyle, flex: 1, padding: "16px 18px", fontWeight: 800 }}>Reset to Defaults</button>
            <button onClick={handleCreateTable} disabled={submitting} style={{ ...primaryButtonStyle, flex: 2, padding: "16px 18px", fontWeight: 800, opacity: submitting ? 0.6 : 1 }}>
              {submitting ? "Opening Table..." : creatorTab === "tournament" ? "Schedule Tournament" : "Open Revolving Table"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
