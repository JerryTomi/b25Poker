import React from 'react';
import { suitLabel, cardTextColor } from '../utils/helpers';

export function Card({ card, hidden = false, small = false, animate = false }) {
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

export function Spinner({ size = 42 }) {
  return (
    <div style={{ width: size, height: size, border: "3px solid rgba(201,168,76,0.15)", borderTopColor: "#c9a84c", borderRadius: "50%", animation: "spin 0.9s linear infinite" }} />
  );
}

export function Modal({ children }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(8,7,15,0.88)", backdropFilter: "blur(12px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }}>
      {children}
    </div>
  );
}

export function ActionButton({ label, onClick, disabled = false, variant = "neutral" }) {
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
