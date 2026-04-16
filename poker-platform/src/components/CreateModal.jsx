import React, { useState } from 'react';
import { ethers } from 'ethers';
import { Modal } from './shared';
import { ERC721_ABI } from '../utils/constants';

// ─── DEFAULT FORM STATE ───────────────────────────────────────────────────────
function defaultForm() {
  const now = new Date();
  const start = new Date(now.getTime() + 60 * 60 * 1000);
  const lateReg = new Date(start.getTime() + 20 * 60 * 1000);
  return {
    title: '',
    desc: '',
    assetSymbol: 'S',
    buyIn: 1000,
    startingStack: 3000,
    minPlayers: 2,
    maxSeats: 6,
    blindLevelDurationSec: 300,
    // Scheduled tournament fields
    scheduledStartAt: start.toISOString().slice(0, 16),
    lateRegistrationEndsAt: lateReg.toISOString().slice(0, 16),
    // NFT Gate
    requiredNft: '',
    // Advanced: custom blind schedule
    customBlindsEnabled: false,
    blindSchedule: [
      { small_blind: 25, big_blind: 50 },
      { small_blind: 50, big_blind: 100 },
      { small_blind: 75, big_blind: 150 },
      { small_blind: 100, big_blind: 200 },
    ],
    // SC-Ready: admin NFT for custom asset (unlocked via on-chain check)
    adminNftAddress: '',
    customAssetAddress: '',
  };
}

// ─── STYLE PRIMITIVES ─────────────────────────────────────────────────────────
const inputBase = {
  width: '100%', borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.04)',
  color: '#fff', padding: '13px 16px',
  outline: 'none', boxSizing: 'border-box',
  fontSize: 14, fontFamily: "'Inter', sans-serif",
  transition: 'border 0.2s, background 0.2s',
};

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </div>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 5 }}>{hint}</div>}
    </div>
  );
}

function StyledInput({ style, onFocus, onBlur, ...rest }) {
  return (
    <input
      {...rest}
      style={{ ...inputBase, ...style }}
      onFocus={e => { e.target.style.border = '1px solid rgba(201,168,76,0.5)'; e.target.style.background = 'rgba(255,255,255,0.07)'; if (onFocus) onFocus(e); }}
      onBlur={e => { e.target.style.border = '1px solid rgba(255,255,255,0.1)'; e.target.style.background = 'rgba(255,255,255,0.04)'; if (onBlur) onBlur(e); }}
    />
  );
}

function StyledSelect(props) {
  return (
    <select
      {...props}
      style={{ ...inputBase, background: 'rgba(18,16,36,0.95)', cursor: 'pointer', ...(props.style || {}) }}
    />
  );
}

function TabBtn({ active, children, onClick }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: '13px 12px', borderRadius: 12,
      border: active ? '1px solid rgba(201,168,76,0.5)' : '1px solid rgba(255,255,255,0.07)',
      background: active ? 'rgba(201,168,76,0.12)' : 'rgba(255,255,255,0.03)',
      color: active ? '#f0d060' : 'rgba(255,255,255,0.6)',
      fontSize: 13, fontWeight: 800, cursor: 'pointer',
      transition: 'all 0.2s', fontFamily: "'Inter', sans-serif",
    }}>
      {children}
    </button>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function CreateModal({ onClose, session, walletAddress, onSuccess, assets }) {
  const [tab, setTab] = useState('sng'); // 'sng' = Sit & Go (Revolving), 'scheduled' = Scheduled Tournament
  const [form, setForm] = useState(defaultForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // SC-Ready admin NFT validation state (will become on-chain signature in production)
  const [nftValidated, setNftValidated] = useState(false);
  const [validatingNft, setValidatingNft] = useState(false);

  const patch = (update) => setForm(f => ({ ...f, ...update }));

  // ── Blind Schedule Helpers ──────────────────────────────────────────────────
  const addBlindLevel = () => {
    const last = form.blindSchedule[form.blindSchedule.length - 1];
    patch({ blindSchedule: [...form.blindSchedule, { small_blind: (last?.small_blind || 50) * 2, big_blind: (last?.big_blind || 100) * 2 }] });
  };
  const updateBlind = (i, field, val) => {
    const next = [...form.blindSchedule];
    next[i] = { ...next[i], [field]: Number(val) };
    patch({ blindSchedule: next });
  };
  const removeBlind = (i) => {
    if (form.blindSchedule.length <= 1) return;
    patch({ blindSchedule: form.blindSchedule.filter((_, idx) => idx !== i) });
  };

  const buildBlindSchedule = () => {
    if (tab === 'scheduled' && form.customBlindsEnabled) return form.blindSchedule;
    if (tab === 'scheduled') return [
      { small_blind: 25, big_blind: 50 }, { small_blind: 50, big_blind: 100 },
      { small_blind: 75, big_blind: 150 }, { small_blind: 100, big_blind: 200 },
      { small_blind: 150, big_blind: 300 }, { small_blind: 200, big_blind: 400 },
    ];
    return [
      { small_blind: 20, big_blind: 40 }, { small_blind: 30, big_blind: 60 },
      { small_blind: 40, big_blind: 80 }, { small_blind: 60, big_blind: 120 },
    ];
  };

  // ── SC-Ready: Admin NFT Validation ─────────────────────────────────────────
  // In production, this will be replaced by an on-chain signature / ownership proof.
  const validateAdminNft = async () => {
    if (!walletAddress) { setError('Connect your wallet first to validate NFT ownership.'); return; }
    if (!form.adminNftAddress) { setError('Enter the NFT contract address to validate.'); return; }
    setValidatingNft(true); setError('');
    try {
      if (!window.ethereum) throw new Error('MetaMask not found.');
      const provider = new ethers.BrowserProvider(window.ethereum);
      const nftContract = new ethers.Contract(form.adminNftAddress, ERC721_ABI, provider);
      const balance = await nftContract.balanceOf(walletAddress);
      if (balance > 0n) { setNftValidated(true); }
      else throw new Error('You do not own an NFT from this contract.');
    } catch (err) {
      setError('NFT check failed: ' + (err.reason || err.message || 'Invalid contract or no balance.'));
      setNftValidated(false);
    } finally {
      setValidatingNft(false);
    }
  };

  // ── Build & Submit ──────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!session) { setError('You must enter the casino (create a profile) before hosting a table.'); return; }

    setSubmitting(true); setError('');
    try {
      const registrationOpen = new Date();
      const scheduledStart = tab === 'scheduled' ? new Date(form.scheduledStartAt) : null;
      const lateRegEnd = tab === 'scheduled' && form.lateRegistrationEndsAt ? new Date(form.lateRegistrationEndsAt) : null;
      const assetToUse = nftValidated && form.customAssetAddress ? form.customAssetAddress : form.assetSymbol;

      // SC-READY payload: all fields are structured to map cleanly to a smart contract call later.
      // When integrating contracts: admin_secret is removed, auth comes from wallet signature.
      const payload = {
        // Core identity
        title: form.title.trim() || (tab === 'scheduled' ? 'Scheduled Tournament' : 'Revolving Table'),
        desc: form.desc.trim(),
        category: 'tournament',
        mode: tab === 'scheduled' ? 'tournament_scheduled' : 'tournament_sng',

        // Buy-in & stack
        buy_in_chips: Number(form.buyIn),
        starting_stack: Number(form.startingStack),
        asset_symbol: assetToUse,

        // Table config
        min_players: Number(form.minPlayers),
        max_seats: Number(form.maxSeats),
        blind_level_duration_sec: Number(form.blindLevelDurationSec),
        blind_schedule: buildBlindSchedule(),

        // Access control — maps directly to future on-chain access policy
        required_nft: form.requiredNft.trim() || null,
        access_policy: form.requiredNft.trim() ? 'nft' : 'open',

        // Timing
        registration_opens_at: registrationOpen.toISOString(),
        scheduled_start_at: scheduledStart ? scheduledStart.toISOString() : null,
        late_registration_ends_at: lateRegEnd ? lateRegEnd.toISOString() : null,

        // Creator identity — in SC integration, this becomes msg.sender
        creator_player_id: session.player_id,
        creator_wallet_address: walletAddress || null,
        creator_nft_contract: form.adminNftAddress.trim() || null,

        // SC-Ready: custom asset (unlocked via on-chain NFT check)
        custom_asset_address: nftValidated && form.customAssetAddress ? form.customAssetAddress : null,

        // Schedule flags
        is_recurring: false,
        recurrence_rule: null,
      };

      await onSuccess(payload);
    } catch (err) {
      setError(err.message || 'Could not create the table.');
      setSubmitting(false);
    }
  };

  // ── Styles ──────────────────────────────────────────────────────────────────
  const primaryBtn = {
    background: 'linear-gradient(135deg, #c9a84c, #f0d060)',
    border: 'none', borderRadius: 14, padding: '15px 20px',
    fontWeight: 800, color: '#08070f', cursor: 'pointer', fontSize: 14,
    fontFamily: "'Inter', sans-serif",
  };
  const ghostBtn = {
    background: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
    color: 'rgba(255,255,255,0.7)', borderRadius: 14, padding: '15px 20px',
    fontWeight: 700, cursor: 'pointer', fontSize: 14,
    fontFamily: "'Inter', sans-serif",
  };

  return (
    <Modal>
      <div style={{
        width: 'min(700px, 96vw)', borderRadius: 28,
        background: 'linear-gradient(160deg, rgba(22,20,38,0.99) 0%, rgba(10,9,20,0.99) 100%)',
        border: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 40px 100px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.08)',
        maxHeight: '92vh', overflowY: 'auto',
        fontFamily: "'Inter', sans-serif",
      }}>

        {/* Header */}
        <div style={{ padding: '28px 32px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', color: 'var(--gold, #c9a84c)', fontWeight: 700 }}>Host a Game</div>
            <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 28, fontWeight: 900, color: '#fff', marginTop: 4 }}>Table Creator</div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 10, padding: '8px 14px', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>

        {/* Tab Selector */}
        <div style={{ padding: '20px 32px 0', display: 'flex', gap: 10 }}>
          <TabBtn active={tab === 'sng'} onClick={() => setTab('sng')}>
            ♠ Revolving Table (Sit &amp; Go)
          </TabBtn>
          <TabBtn active={tab === 'scheduled'} onClick={() => setTab('scheduled')}>
            📅 Scheduled Tournament
          </TabBtn>
        </div>

        {/* Mode description */}
        <div style={{ margin: '14px 32px 0', borderRadius: 12, padding: '12px 16px', background: tab === 'sng' ? 'rgba(16,185,129,0.06)' : 'rgba(201,168,76,0.06)', border: `1px solid ${tab === 'sng' ? 'rgba(16,185,129,0.15)' : 'rgba(201,168,76,0.15)'}`, fontSize: 12.5, color: tab === 'sng' ? '#10b981' : '#c9a84c', lineHeight: 1.6 }}>
          {tab === 'sng'
            ? '♠  Revolving tables start automatically when the minimum number of players sit down. Great for casual games that run continuously.'
            : '📅  Scheduled tournaments have a fixed start time. Players register in advance. Use late registration to allow latecomers.'}
        </div>

        {/* Form Body */}
        <div style={{ padding: '24px 32px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Title & Asset */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
            <Field label="Table Name">
              <StyledInput
                value={form.title}
                onChange={e => patch({ title: e.target.value })}
                placeholder={tab === 'scheduled' ? 'e.g. Sunday Million' : 'e.g. Midnight Action'}
                maxLength={60}
              />
            </Field>
            <Field label="Chip Asset">
              <StyledSelect value={form.assetSymbol} onChange={e => patch({ assetSymbol: e.target.value })}>
                {(assets.length ? assets : [{ symbol: 'S' }, { symbol: 'USDC' }]).map(a => (
                  <option key={a.symbol} value={a.symbol}>{a.symbol}</option>
                ))}
              </StyledSelect>
            </Field>
          </div>

          <Field label="Description (optional)">
            <StyledInput
              value={form.desc}
              onChange={e => patch({ desc: e.target.value })}
              placeholder="Describe the format, prize pool, or sponsor"
              maxLength={140}
            />
          </Field>

          {/* Core numbers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <Field label="Buy-In">
              <StyledInput type="number" value={form.buyIn} onChange={e => patch({ buyIn: e.target.value })} min={100} />
            </Field>
            <Field label="Starting Stack">
              <StyledInput type="number" value={form.startingStack} onChange={e => patch({ startingStack: e.target.value })} min={100} />
            </Field>
            <Field label="Min Players" hint="Game starts at this count">
              <StyledInput type="number" value={form.minPlayers} onChange={e => patch({ minPlayers: e.target.value })} min={2} max={9} />
            </Field>
            <Field label="Max Seats">
              <StyledInput type="number" value={form.maxSeats} onChange={e => patch({ maxSeats: e.target.value })} min={2} max={9} />
            </Field>
          </div>

          {/* Blind duration + NFT gate */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Field label="Blind Level Duration" hint="Seconds per blind level">
              <StyledInput type="number" value={form.blindLevelDurationSec} onChange={e => patch({ blindLevelDurationSec: e.target.value })} min={30} step={30} />
            </Field>
            <Field label="NFT Gate (Optional)" hint="Leave blank for an open table">
              <StyledInput
                value={form.requiredNft}
                onChange={e => patch({ requiredNft: e.target.value })}
                placeholder="0x… contract address"
              />
            </Field>
          </div>

          {/* ── Scheduled-only fields ── */}
          {tab === 'scheduled' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <Field label="Scheduled Start">
                  <StyledInput type="datetime-local" value={form.scheduledStartAt} onChange={e => patch({ scheduledStartAt: e.target.value })} />
                </Field>
                <Field label="Late Registration Ends">
                  <StyledInput type="datetime-local" value={form.lateRegistrationEndsAt} onChange={e => patch({ lateRegistrationEndsAt: e.target.value })} />
                </Field>
              </div>

              {/* Custom Blind Schedule */}
              <div style={{ borderRadius: 16, border: '1px solid rgba(201,168,76,0.18)', background: 'rgba(201,168,76,0.04)', padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#c9a84c' }}>Custom Blind Schedule</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5, color: 'rgba(255,255,255,0.6)' }}>
                    <input type="checkbox" checked={form.customBlindsEnabled} onChange={e => patch({ customBlindsEnabled: e.target.checked })} style={{ accentColor: '#c9a84c', width: 15, height: 15 }} />
                    Enable Custom Blinds
                  </label>
                </div>

                {form.customBlindsEnabled ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 1fr 32px', gap: 8, paddingBottom: 4, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      {['#', 'Small Blind', 'Big Blind', ''].map(h => (
                        <div key={h} style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontWeight: 700 }}>{h}</div>
                      ))}
                    </div>
                    {form.blindSchedule.map((lvl, i) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '32px 1fr 1fr 32px', gap: 8, alignItems: 'center' }}>
                        <div style={{ textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.25)', fontWeight: 700 }}>{i + 1}</div>
                        <StyledInput style={{ padding: '9px 12px' }} type="number" value={lvl.small_blind} onChange={e => updateBlind(i, 'small_blind', e.target.value)} />
                        <StyledInput style={{ padding: '9px 12px' }} type="number" value={lvl.big_blind} onChange={e => updateBlind(i, 'big_blind', e.target.value)} />
                        <button onClick={() => removeBlind(i)} style={{ background: 'rgba(239,68,68,0.1)', border: 'none', color: '#f87171', borderRadius: 8, cursor: 'pointer', padding: '6px', fontWeight: 800, aspectRatio: '1' }}>✕</button>
                      </div>
                    ))}
                    <button onClick={addBlindLevel} style={{ background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.5)', borderRadius: 10, padding: '9px', marginTop: 4, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                      + Add Blind Level
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.35)' }}>
                    Standard escalating tournament blinds will be applied automatically.
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── SC-Ready: Admin Custom Asset ── */}
          {tab === 'scheduled' && (
            <div style={{ borderRadius: 16, border: '1px solid rgba(139,92,246,0.2)', background: 'rgba(139,92,246,0.05)', padding: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#a78bfa', marginBottom: 4 }}>Admin Custom Asset</div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 14, lineHeight: 1.6 }}>
                Hold an approved NFT to use a custom ERC-20 token as the table chip. <span style={{ color: 'rgba(139,92,246,0.7)' }}>In production, this will be enforced on-chain.</span>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <StyledInput
                  placeholder="Your Admin NFT Address (0x…)"
                  value={form.adminNftAddress}
                  onChange={e => { patch({ adminNftAddress: e.target.value }); setNftValidated(false); }}
                  disabled={nftValidated}
                  style={{ flex: 3 }}
                />
                <button
                  onClick={validateAdminNft}
                  disabled={validatingNft || nftValidated}
                  style={{
                    flex: 1, borderRadius: 12, padding: '13px 10px',
                    border: nftValidated ? '1px solid rgba(16,185,129,0.5)' : '1px solid rgba(139,92,246,0.4)',
                    background: 'transparent',
                    color: nftValidated ? '#10b981' : '#a78bfa',
                    cursor: (validatingNft || nftValidated) ? 'default' : 'pointer',
                    fontWeight: 700, fontSize: 13,
                    fontFamily: "'Inter', sans-serif",
                  }}
                >
                  {validatingNft ? 'Checking…' : nftValidated ? '✓ Verified' : 'Validate'}
                </button>
              </div>
              {nftValidated && (
                <div style={{ marginTop: 14 }}>
                  <Field label="Custom ERC-20 Chip Contract" hint="This token will be used as the exclusive chip for this table">
                    <StyledInput
                      placeholder="ERC-20 token address (0x…)"
                      value={form.customAssetAddress}
                      onChange={e => patch({ customAssetAddress: e.target.value })}
                      style={{ border: '1px solid rgba(16,185,129,0.3)' }}
                    />
                  </Field>
                  <div style={{ fontSize: 11, color: '#10b981', marginTop: 6 }}>✓ Admin access confirmed. Custom token enabled for this tournament.</div>
                </div>
              )}
            </div>
          )}

          {/* ── Demo Notice (explains what "api secret" was) ── */}
          <div style={{ borderRadius: 12, padding: '12px 16px', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)', fontSize: 12, color: 'rgba(100,160,255,0.8)', lineHeight: 1.6 }}>
            <strong style={{ color: 'rgba(100,160,255,1)' }}>Demo Mode:</strong> Tables are created freely for this demo. In production, tournament creation will require a valid wallet signature or on-chain NFT ownership — no API secret needed.
          </div>

          {/* Error */}
          {error && (
            <div style={{ borderRadius: 10, padding: '12px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', fontSize: 13 }}>
              ⚠ {error}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
            <button onClick={() => setForm(defaultForm())} style={{ ...ghostBtn, flex: 1 }}>Reset</button>
            <button onClick={handleSubmit} disabled={submitting} style={{ ...primaryBtn, flex: 2, opacity: submitting ? 0.6 : 1, cursor: submitting ? 'not-allowed' : 'pointer' }}>
              {submitting
                ? 'Creating…'
                : tab === 'scheduled'
                ? '📅 Schedule Tournament'
                : '♠ Open Revolving Table'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
