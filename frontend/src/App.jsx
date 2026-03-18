import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine,
  ResponsiveContainer, Tooltip,
} from 'recharts';
import Onboarding from './pages/Onboarding.jsx';

// In production (Railway), the frontend is served by the same Express process,
// so API calls are same-origin (empty string). In local dev, backend runs on :3001.
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3001'
  : '';

// ── Fee calculator (mirrors backend) ─────────────────────────────────────────
function calcFee(contracts, priceDollars) {
  const p = Math.max(0.01, Math.min(0.99, priceDollars));
  return Math.ceil(0.07 * contracts * p * (1 - p) * 100) / 100;
}

function fmtDollar(v) {
  if (v == null) return '$0.00';
  const sign = v >= 0 ? '+' : '';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

function fmtPrice(v) {
  if (v == null) return '$0';
  return '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

// ── Settings Modal ───────────────────────────────────────────────────────────
function SettingsModal({ onConnect, error }) {
  const [apiKey, setApiKey] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [env, setEnv] = useState('Demo');
  const [loading, setLoading] = useState(false);

  const handleConnect = async () => {
    setLoading(true);
    await onConnect(apiKey, privateKey, env);
    setLoading(false);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <div className="modal-header">
          <span className="logo">COMP'D</span>
          <span className="modal-subtitle">alpha-bot</span>
        </div>
        <h3 className="modal-title">Connect Kalshi Account</h3>
        <label className="field-label">API Key ID</label>
        <input
          className="field-input"
          type="text"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder="Enter your Kalshi API Key ID"
        />
        <label className="field-label">Private Key (PEM)</label>
        <textarea
          className="field-input field-textarea"
          value={privateKey}
          onChange={e => setPrivateKey(e.target.value)}
          placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;..."
          rows={4}
        />
        <label className="field-label">Environment</label>
        <div className="env-radio-group">
          <label className={`env-radio ${env === 'Demo' ? 'active' : ''}`}>
            <input type="radio" name="env" value="Demo" checked={env === 'Demo'} onChange={() => setEnv('Demo')} />
            DEMO
          </label>
          <label className={`env-radio ${env === 'Live' ? 'active' : ''}`}>
            <input type="radio" name="env" value="Live" checked={env === 'Live'} onChange={() => setEnv('Live')} />
            LIVE
          </label>
        </div>
        {error && <div className="modal-error">{error}</div>}
        <button className="connect-btn" onClick={handleConnect} disabled={loading || !apiKey}>
          {loading ? 'Connecting...' : 'Connect →'}
        </button>
      </div>
    </div>
  );
}

// ── Custom Tooltip ───────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-time">{label}</div>
      <div className="chart-tooltip-price mono">{fmtPrice(payload[0]?.value)}</div>
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [connected, setConnected] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  // Bot state
  const [btcPrice, setBtcPrice] = useState(null);
  const [candles, setCandles] = useState([]);
  const [activeMarket, setActiveMarket] = useState(null);
  const [config, setConfig] = useState({ strategy: 'swing', maxContractsPerTrade: 10, riskPct: 2, cooldownMinutes: 5 });
  const [botEnabled, setBotEnabled] = useState(false);
  const [lastSignal, setLastSignal] = useState(null);
  const [tradeLog, setTradeLog] = useState([]);
  const [sessionPnl, setSessionPnl] = useState(0);
  const [feesTotal, setFeesTotal] = useState(0);
  const [balance, setBalance] = useState(null);
  const [supabaseEnabled, setSupabaseEnabled] = useState(false);
  const [environment, setEnvironment] = useState('Demo');
  const [externalSignals, setExternalSignals] = useState(null);
  const [cycleCountdown, setCycleCountdown] = useState(15);
  const [sseConnected, setSseConnected] = useState(false);

  const eventSourceRef = useRef(null);
  const countdownRef = useRef(null);

  // Check connection on load:
  // 1. If backend already has credentials (Railway env vars) — go to dashboard.
  // 2. Otherwise fall back to localStorage token from a previous auth.
  // 3. If neither and we're on /, redirect to /onboarding; if on /onboarding, stay.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/status`);
        if (res.ok) {
          const status = await res.json();
          if (status.hasCredentials) {
            setConnected(true);
            setEnvironment(status.environment || 'Live');
            return;
          }
        }
      } catch (_) {}
      const token = localStorage.getItem('alpha_token');
      if (token) {
        setConnected(true);
        setEnvironment(localStorage.getItem('alpha_env') || 'Demo');
      } else {
        setShowSettings(true);
      }
    })();
  }, []);

  // Redirect unauthenticated users from / to /onboarding (after auth check has run)
  useEffect(() => {
    if (location.pathname === '/' && showSettings && !connected) {
      navigate('/onboarding', { replace: true });
    }
  }, [location.pathname, showSettings, connected, navigate]);

  // SSE connection
  useEffect(() => {
    if (!connected) return;

    const es = new EventSource(`${API_BASE}/api/events`);
    eventSourceRef.current = es;

    es.onopen = () => setSseConnected(true);
    es.onerror = () => setSseConnected(false);

    es.addEventListener('snapshot', (e) => {
      const d = JSON.parse(e.data);
      if (d.btcPrice) setBtcPrice(d.btcPrice);
      if (d.candles) setCandles(d.candles);
      if (d.activeMarket) setActiveMarket(d.activeMarket);
      if (d.config) setConfig(d.config);
      if (d.botEnabled != null) setBotEnabled(d.botEnabled);
      if (d.lastSignal) setLastSignal(d.lastSignal);
      if (d.tradeLog) setTradeLog(d.tradeLog);
      if (d.sessionPnl != null) setSessionPnl(d.sessionPnl);
      if (d.feesTotal != null) setFeesTotal(d.feesTotal);
      if (d.balance != null) setBalance(d.balance);
      if (d.supabaseEnabled != null) setSupabaseEnabled(d.supabaseEnabled);
      if (d.externalSignals) setExternalSignals(d.externalSignals);
    });

    es.addEventListener('price', (e) => {
      const d = JSON.parse(e.data);
      if (d.price) setBtcPrice(d.price);
      if (d.candles) setCandles(d.candles);
      setCycleCountdown(15);
    });

    es.addEventListener('market', (e) => {
      setActiveMarket(JSON.parse(e.data));
    });

    es.addEventListener('config', (e) => {
      setConfig(JSON.parse(e.data));
    });

    es.addEventListener('bot_toggle', (e) => {
      const d = JSON.parse(e.data);
      setBotEnabled(d.enabled);
    });

    es.addEventListener('indicators', (e) => {
      setLastSignal(JSON.parse(e.data));
    });

    es.addEventListener('trade', (e) => {
      const t = JSON.parse(e.data);
      setTradeLog(prev => [t, ...prev].slice(0, 100));
    });

    es.addEventListener('balance', (e) => {
      const d = JSON.parse(e.data);
      if (d.balance != null) setBalance(d.balance);
    });

    es.addEventListener('pnl', (e) => {
      const d = JSON.parse(e.data);
      if (d.sessionPnl != null) setSessionPnl(d.sessionPnl);
    });

    return () => { es.close(); setSseConnected(false); };
  }, [connected]);

  // Countdown timer
  useEffect(() => {
    countdownRef.current = setInterval(() => {
      setCycleCountdown(prev => (prev <= 0 ? 15 : prev - 1));
    }, 1000);
    return () => clearInterval(countdownRef.current);
  }, []);

  // Auth connect
  const handleConnect = async (apiKey, privateKey, env) => {
    setAuthError(null);
    try {
      const res = await fetch(`${API_BASE}/api/kalshi/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, privateKey, environment: env }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');
      localStorage.setItem('alpha_token', data.token);
      localStorage.setItem('alpha_env', env);
      setEnvironment(env);
      setBalance(data.balance);
      setConnected(true);
      setShowSettings(false);
    } catch (err) {
      setAuthError(err.message);
    }
  };

  const handleDisconnect = () => {
    localStorage.removeItem('alpha_token');
    localStorage.removeItem('alpha_env');
    setConnected(false);
    setShowSettings(true);
    if (eventSourceRef.current) eventSourceRef.current.close();
  };

  // Bot toggle
  const toggleBot = async () => {
    try {
      await fetch(`${API_BASE}/api/bot/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !botEnabled }),
      });
    } catch (_) {}
  };

  // Config update
  const updateConfig = async (patch) => {
    try {
      await fetch(`${API_BASE}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch (_) {}
  };

  // Chart data
  const chartData = candles.slice(-50).map(c => ({
    time: fmtTime(c.timestamp),
    price: c.close,
  }));

  const entryPrice = lastSignal?.indicators?.entryPrice || null;
  const targetPrice = lastSignal?.targetPrice || null;
  const stopLoss = lastSignal?.stopLoss || null;

  // Trade stats
  const winCount = tradeLog.filter(t => t.pnl > 0).length;
  const lossCount = tradeLog.filter(t => t.pnl < 0).length;
  const totalTrades = tradeLog.filter(t => t.pnl != null).length;
  const winRate = totalTrades > 0 ? Math.round(winCount / totalTrades * 100) : 0;
  const grossPnl = sessionPnl + feesTotal;
  const netPnl = sessionPnl;

  // On /onboarding, render dedicated onboarding page
  if (location.pathname === '/onboarding') {
    return (
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
      </Routes>
    );
  }

  // On /, wait for auth check before showing dashboard or redirecting
  if (!connected && !showSettings) {
    return (
      <div className="app" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <span className="gold">Loading...</span>
      </div>
    );
  }

  // Not connected: redirect to onboarding (effect runs after this render)
  if (showSettings && !connected) {
    return (
      <div className="app" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <span className="gold">Redirecting to onboarding...</span>
      </div>
    );
  }

  return (
    <div className="app">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="header">
        <div className="header-left">
          <span className="logo">COMP'D</span>
          <span className="header-version">alpha-bot v2</span>
        </div>
        <div className="header-right">
          <span className={`env-badge ${environment === 'Live' ? 'env-live' : 'env-demo'}`}>
            {environment === 'Live' ? 'LIVE' : 'DEMO'}
          </span>
          <span className={`supabase-status ${supabaseEnabled ? 'active' : ''}`}>
            {supabaseEnabled ? '● Persisting' : '○ Local Only'}
          </span>
          <button className="disconnect-btn" onClick={handleDisconnect}>⚙</button>
        </div>
      </header>
      <div className="header-rule" />

      {/* ── Three-panel layout ──────────────────────────────────── */}
      <div className="panels">
        {/* ── Left: Chart ─────────────────────────────────────── */}
        <div className="panel panel-chart">
          <div className="panel-header">
            <span className="section-label">LIVE PRICE CHART</span>
            <span className="chart-market-info">
              {activeMarket ? (
                <>
                  <span className="gold">{activeMarket.ticker}</span>
                  {activeMarket.floorStrike && (
                    <span> &middot; Strike <span className="mono">${activeMarket.floorStrike?.toLocaleString()}</span></span>
                  )}
                  {activeMarket.minutesToClose != null && (
                    <span className={activeMarket.minutesToClose < 10 ? ' red' : ' '}
                    > &middot; Closes in <span className="mono">{activeMarket.minutesToClose}m</span></span>
                  )}
                  <span> &middot; YES <span className="mono green">${activeMarket.yesBid?.toFixed(2)}</span></span>
                  <span> &middot; NO <span className="mono red">${activeMarket.noBid?.toFixed(2)}</span></span>
                </>
              ) : (
                <span className="muted">Fetching market...</span>
              )}
            </span>
          </div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={360}>
              <LineChart data={chartData} margin={{ top: 10, right: 60, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1A1A1A" horizontal={true} vertical={false} />
                <XAxis
                  dataKey="time"
                  stroke="#555"
                  tick={{ fill: '#999', fontSize: 11 }}
                  axisLine={{ stroke: '#1A1A1A' }}
                />
                <YAxis
                  orientation="right"
                  stroke="#555"
                  tick={{ fill: '#C9A84C', fontSize: 11 }}
                  axisLine={{ stroke: '#1A1A1A' }}
                  tickFormatter={v => `$${v.toLocaleString()}`}
                  domain={['auto', 'auto']}
                />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke="#C9A84C"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#C9A84C' }}
                />
                {entryPrice && (
                  <ReferenceLine
                    y={entryPrice}
                    stroke="#3B82F6"
                    strokeDasharray="4 4"
                    label={{ value: `Entry $${entryPrice}`, position: 'right', fill: '#3B82F6', fontSize: 10 }}
                  />
                )}
                {targetPrice && (
                  <ReferenceLine
                    y={targetPrice}
                    stroke="#22C55E"
                    strokeDasharray="4 4"
                    label={{ value: `Target $${targetPrice}`, position: 'right', fill: '#22C55E', fontSize: 10 }}
                  />
                )}
                {stopLoss && (
                  <ReferenceLine
                    y={stopLoss}
                    stroke="#EF4444"
                    strokeDasharray="4 4"
                    label={{ value: `Stop $${stopLoss}`, position: 'right', fill: '#EF4444', fontSize: 10 }}
                  />
                )}
                {/* Strike price line — the key Kalshi reference */}
                {activeMarket?.floorStrike && (
                  <ReferenceLine
                    y={activeMarket.floorStrike}
                    stroke="#C9A84C"
                    strokeDasharray="6 3"
                    strokeOpacity={0.6}
                    label={{ value: `Strike $${activeMarket.floorStrike?.toLocaleString()}`, position: 'right', fill: '#C9A84C', fontSize: 10 }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-footer">
            <span className="btc-price-large mono">{fmtPrice(btcPrice)}</span>
            {externalSignals?.btcPrice > 0 && btcPrice && (
              <span className={`btc-change mono ${btcPrice >= externalSignals.btcPrice ? 'green' : 'red'}`}>
                {fmtDollar(btcPrice - externalSignals.btcPrice)}
              </span>
            )}
          </div>
        </div>

        {/* ── Middle: Signal Panel ────────────────────────────── */}
        <div className="panel panel-signal">
          <div className="section-label">SIGNAL ENGINE</div>
          <div className="gold-rule" />

          {/* Strategy selector */}
          <label className="field-label-sm">Strategy</label>
          <select
            className="field-select"
            value={config.strategy || 'swing'}
            onChange={e => updateConfig({ strategy: e.target.value })}
          >
            <option value="swing">Swing</option>
            <option value="theta">Theta Decay</option>
            <option value="scalper">Scalper</option>
            <option value="momentum">Momentum</option>
          </select>

          <label className="field-label-sm">Max Contracts</label>
          <input
            className="field-input-sm"
            type="number"
            value={config.maxContractsPerTrade || 10}
            onChange={e => updateConfig({ maxContractsPerTrade: parseInt(e.target.value) || 10 })}
            min={1} max={100}
          />

          <label className="field-label-sm">Cooldown (min)</label>
          <input
            className="field-input-sm"
            type="number"
            value={config.cooldownMinutes || 5}
            onChange={e => updateConfig({ cooldownMinutes: parseInt(e.target.value) || 5 })}
            min={0} max={60}
          />

          <div className="gold-rule" />

          {/* Bot toggle */}
          <div className="section-label">BOT STATUS</div>
          <div className="toggle-row" onClick={toggleBot}>
            <span className="toggle-label">{botEnabled ? 'ON' : 'OFF'}</span>
            <div className={`toggle-switch ${botEnabled ? 'on' : 'off'}`}>
              <div className="toggle-knob" />
            </div>
          </div>

          <div className="gold-rule" />

          {/* Current signal */}
          <div className="section-label">CURRENT SIGNAL</div>
          {lastSignal ? (
            <>
              <div className={`signal-badge ${lastSignal.signal === 'YES' ? 'signal-yes' : lastSignal.signal === 'NO' ? 'signal-no' : 'signal-none'}`}>
                {lastSignal.signal === 'YES' ? 'BUY YES' : lastSignal.signal === 'NO' ? 'BUY NO' : 'NO SIGNAL'}
              </div>
              <div className="confidence-row">
                <span className="confidence-label">Confidence:</span>
                <span className="confidence-value mono">{lastSignal.confidence || 0}%</span>
              </div>
              <div className="confidence-bar">
                <div className="confidence-fill" style={{ width: `${lastSignal.confidence || 0}%` }} />
              </div>
            </>
          ) : (
            <div className="signal-badge signal-none">WAITING...</div>
          )}

          <div className="gold-rule" />

          {/* Thinking steps */}
          <div className="section-label">THINKING STEPS</div>
          <div className="thinking-steps">
            {(lastSignal?.reasoning || []).map((step, i) => (
              <div key={i} className={`thinking-step ${step.startsWith('✓') ? 'step-pass' : step.startsWith('✗') ? 'step-fail' : 'step-info'}`}>
                {step}
              </div>
            ))}
            {(!lastSignal?.reasoning || lastSignal.reasoning.length === 0) && (
              <div className="thinking-step step-info">Waiting for analysis...</div>
            )}
          </div>
        </div>

        {/* ── Right: Trade Log ────────────────────────────────── */}
        <div className="panel panel-trades">
          <div className="section-label">SESSION P&L</div>
          <div className="gold-rule" />
          <div className="pnl-grid">
            <span className="pnl-label">Gross P&L</span>
            <span className={`pnl-value mono ${grossPnl >= 0 ? 'green' : 'red'}`}>{fmtDollar(grossPnl)}</span>
            <span className="pnl-label">Fees Paid</span>
            <span className="pnl-value mono red">-${feesTotal.toFixed(2)}</span>
            <span className="pnl-label pnl-label-bold">Net P&L</span>
            <span className={`pnl-value pnl-value-bold mono ${netPnl >= 0 ? 'green' : 'red'}`}>{fmtDollar(netPnl)}</span>
            <span className="pnl-label">Win Rate</span>
            <span className="pnl-value mono gold">{winRate}%</span>
            <span className="pnl-label">Trades</span>
            <span className="pnl-value mono">{tradeLog.length}</span>
          </div>

          <div className="gold-rule" />
          <div className="section-label">TRADE LOG</div>
          <div className="trade-list">
            {tradeLog.length === 0 && (
              <div className="trade-empty">No trades yet</div>
            )}
            {tradeLog.map((t, i) => (
              <div key={t.id || i} className="trade-row">
                <span className="trade-time mono">{t.time}</span>
                <span className={`trade-side ${t.signal === 'YES' ? 'green' : 'red'}`}>{t.signal}</span>
                <span className="trade-contracts mono">{t.contracts}c</span>
                <span className={`trade-pnl mono ${(t.pnl || 0) >= 0 ? 'green' : 'red'}`}>
                  {t.pnl != null ? fmtDollar(t.pnl) : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Status Bar ────────────────────────────────────────── */}
      <div className="status-bar">
        <span className={`status-dot ${sseConnected ? 'dot-green' : 'dot-red'}`} />
        <span className="status-text">{sseConnected ? 'CONNECTED' : 'DISCONNECTED'}</span>
        <span className="status-sep">|</span>
        <span className="status-text">
          Market: {activeMarket ? (
            <span className="gold mono">{activeMarket.ticker}</span>
          ) : '—'}
          {activeMarket?.minutesToClose != null && (
            <span className={activeMarket.minutesToClose < 10 ? ' red' : ''}>
              {' '}({activeMarket.minutesToClose}m left)
            </span>
          )}
        </span>
        <span className="status-sep">|</span>
        <span className="status-text mono">BTC: {fmtPrice(btcPrice)}</span>
        <span className="status-sep">|</span>
        <span className="status-text">Cycle: {cycleCountdown}s</span>
        <span className="status-sep">|</span>
        <span className={`status-text ${supabaseEnabled ? 'gold' : ''}`}>
          Supabase: {supabaseEnabled ? 'OK' : 'OFF'}
        </span>
        {balance != null && (
          <>
            <span className="status-sep">|</span>
            <span className="status-text mono gold">Balance: ${balance.toFixed(2)}</span>
          </>
        )}
      </div>
    </div>
  );
}
