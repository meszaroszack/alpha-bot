import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Activity, Shield, TrendingUp, Zap, Lock,
  ToggleLeft, ToggleRight, AlertTriangle, BarChart2,
  RefreshCw, DollarSign, Target, Layers
} from 'lucide-react';

// ─── Fee calculator (mirrors backend) ─────────────────────────────────────
function calcFee(contracts, priceDollars, maker = true) {
  const mult = maker ? 0.0175 : 0.07;
  const p = Math.max(0.01, Math.min(0.99, priceDollars));
  return Math.ceil(mult * contracts * p * (1 - p) * 100) / 100;
}

// ─── Candlestick chart ─────────────────────────────────────────────────────
function CandleChart({ candles, currentPrice, strikePrice }) {
  if (!candles || candles.length < 2) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-600 text-xs font-mono">
        Waiting for price data...
      </div>
    );
  }

  const display = candles.slice(-50);
  const allHighs = display.map(c => c.high);
  const allLows = display.map(c => c.low);
  const maxP = Math.max(...allHighs);
  const minP = Math.min(...allLows);
  const range = (maxP - minP) || 1;
  const pad = range * 0.06;
  const top = maxP + pad;
  const bot = minP - pad;
  const totalRange = top - bot;

  const toY = (price) => ((top - price) / totalRange) * 100;

  const W = 100 / display.length;
  const body = W * 0.55;

  return (
    <div className="flex-1 relative bg-[#0a0d12] overflow-hidden">
      <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
        {/* Strike price line */}
        {strikePrice && (
          <line
            x1="0" y1={`${toY(strikePrice)}%`}
            x2="100%" y2={`${toY(strikePrice)}%`}
            stroke="#f59e0b" strokeWidth="0.3" strokeDasharray="1.5,1"
          />
        )}
        {/* Current price line */}
        {currentPrice && (
          <line
            x1="0" y1={`${toY(currentPrice)}%`}
            x2="100%" y2={`${toY(currentPrice)}%`}
            stroke="#3b82f6" strokeWidth="0.2" strokeDasharray="0.5,0.5" opacity="0.6"
          />
        )}
        {/* Candles */}
        {display.map((c, i) => {
          const x = i * W + W / 2;
          const color = c.close >= c.open ? '#10b981' : '#ef4444';
          const yH = toY(c.high);
          const yL = toY(c.low);
          const yO = toY(c.open);
          const yC = toY(c.close);
          const bodyTop = Math.min(yO, yC);
          const bodyH = Math.max(Math.abs(yO - yC), 0.3);
          return (
            <g key={i}>
              <line x1={`${x}%`} y1={`${yH}%`} x2={`${x}%`} y2={`${yL}%`}
                stroke={color} strokeWidth="0.25" />
              <rect x={`${x - body / 2}%`} y={`${bodyTop}%`}
                width={`${body}%`} height={`${bodyH}%`}
                fill={color} opacity="0.9" />
            </g>
          );
        })}
      </svg>
      {/* Labels */}
      {strikePrice && (
        <div
          className="absolute right-2 text-[8px] font-mono text-amber-400 bg-black/60 px-1 rounded"
          style={{ top: `${toY(strikePrice)}%`, transform: 'translateY(-50%)' }}
        >
          STRIKE ${strikePrice.toLocaleString()}
        </div>
      )}
      {currentPrice && (
        <div
          className="absolute right-2 text-[8px] font-mono text-blue-400 bg-black/60 px-1 rounded"
          style={{ top: `${Math.max(2, Math.min(95, toY(currentPrice)))}%`, transform: 'translateY(-50%)' }}
        >
          ${currentPrice.toLocaleString()}
        </div>
      )}
    </div>
  );
}

// ─── Bot toggle switch ─────────────────────────────────────────────────────
function BotToggle({ enabled, onToggle, disabled }) {
  return (
    <button
      onClick={() => !disabled && onToggle(!enabled)}
      disabled={disabled}
      className={`flex items-center gap-2 w-full py-3.5 px-4 rounded-xl font-bold text-sm transition-all duration-200 ${
        disabled ? 'opacity-40 cursor-not-allowed bg-slate-800 text-slate-600' :
        enabled
          ? 'bg-green-500/20 border border-green-500/40 text-green-400 hover:bg-green-500/30'
          : 'bg-slate-800 border border-white/10 text-slate-400 hover:bg-slate-700'
      }`}
    >
      {enabled
        ? <ToggleRight className="w-5 h-5 text-green-400" />
        : <ToggleLeft className="w-5 h-5" />
      }
      <span>{enabled ? 'BOT LIVE — TRADING' : 'BOT OFF — SIGNALS ONLY'}</span>
      {enabled && <span className="ml-auto w-2 h-2 rounded-full bg-green-400 animate-pulse" />}
    </button>
  );
}

// ─── Slider row ────────────────────────────────────────────────────────────
function SliderRow({ label, value, min, max, step = 1, onChange, unit = '' }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[10px] font-bold">
        <span className="text-slate-500 uppercase">{label}</span>
        <span className="text-white">{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1 rounded-lg appearance-none bg-slate-700 accent-blue-500" />
    </div>
  );
}

// ─── Stat card ─────────────────────────────────────────────────────────────
function Stat({ label, value, sub, color = 'text-white' }) {
  return (
    <div className="bg-black/20 rounded-lg p-3 space-y-0.5">
      <div className="text-[9px] uppercase font-bold text-slate-500">{label}</div>
      <div className={`text-sm font-mono font-bold ${color}`}>{value}</div>
      {sub && <div className="text-[9px] text-slate-600 font-mono">{sub}</div>}
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────
export default function App() {
  // Auth
  const [apiKey, setApiKey] = useState('');
  const [environment, setEnvironment] = useState('Demo');
  const [sessionToken, setSessionToken] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  // Bot state (driven by SSE from backend)
  const [botEnabled, setBotEnabled] = useState(false);
  const [balance, setBalance] = useState(null);
  const [sessionStartBalance, setSessionStartBalance] = useState(null);
  const [candles, setCandles] = useState([]);
  const [currentCandle, setCurrentCandle] = useState(null);
  const [btcPrice, setBtcPrice] = useState(null);
  const [activeMarket, setActiveMarket] = useState(null);
  const [positions, setPositions] = useState([]);
  const [indicators, setIndicators] = useState(null);
  const [tradeLog, setTradeLog] = useState([]);
  const [evalLog, setEvalLog] = useState([]);
  const [feesTotal, setFeesTotal] = useState(0);

  // Config
  const [strategy, setStrategy] = useState('algo');
  const [algoMode, setAlgoMode] = useState('momentum');
  const [riskPct, setRiskPct] = useState(25);
  const [maxPositions, setMaxPositions] = useState(3);
  const [minConfidence, setMinConfidence] = useState(65);
  const [dailyLossLimitPct, setDailyLossLimitPct] = useState(20);
  const [maxTradeSize, setMaxTradeSize] = useState(50);

  // UI state
  const [logs, setLogs] = useState([{
    id: 1, time: new Date().toLocaleTimeString('en-GB'), msg: 'System initialized. Enter credentials to begin.', type: 'info'
  }]);
  const [activeTab, setActiveTab] = useState('chart'); // 'chart' | 'positions' | 'tradelog'

  const logsRef = useRef(null);
  const evalRef = useRef(null);
  const wsRef = useRef(null);
  const sseRef = useRef(null);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);
  useEffect(() => {
    if (evalRef.current) evalRef.current.scrollTop = evalRef.current.scrollHeight;
  }, [evalLog]);

  const addLog = useCallback((msg, type = 'info') => {
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    setLogs(prev => [...prev.slice(-200), { id: Date.now() + Math.random(), time, msg, type }]);
  }, []);

  // ── SSE listener ──────────────────────────────────────────────────────────
  const startSSE = useCallback(() => {
    if (sseRef.current) sseRef.current.close();
    const es = new EventSource('/api/events');
    sseRef.current = es;

    const handle = (type, fn) => es.addEventListener(type, e => {
      try { fn(JSON.parse(e.data)); } catch (_) {}
    });

    handle('snapshot', (d) => {
      if (d.btcPrice) setBtcPrice(d.btcPrice);
      if (d.candles?.length) setCandles(d.candles);
      if (d.balance != null) setBalance(d.balance);
      if (d.sessionStartBalance != null) setSessionStartBalance(d.sessionStartBalance);
      if (d.activeMarket) setActiveMarket(d.activeMarket);
      if (d.openPositions) setPositions(d.openPositions);
      if (d.indicators) setIndicators(d.indicators);
      if (d.tradeLog) setTradeLog(d.tradeLog);
      if (d.feesTotal != null) setFeesTotal(d.feesTotal);
      if (d.config) {
        setStrategy(d.config.strategy);
        setAlgoMode(d.config.algoMode);
        setRiskPct(d.config.riskPct);
        setMaxPositions(d.config.maxPositions);
        setMinConfidence(d.config.minConfidence);
        setDailyLossLimitPct(d.config.dailyLossLimitPct);
        setMaxTradeSize(d.config.maxTradeSize);
        setBotEnabled(d.config.botEnabled);
      }
    });

    handle('price', (d) => {
      if (d.price) setBtcPrice(d.price);
      if (d.candles?.length) setCandles(d.candles);
      if (d.currentCandle) setCurrentCandle(d.currentCandle);
    });

    handle('indicators', (d) => setIndicators(d));

    handle('balance', (d) => {
      if (d.balance != null) setBalance(d.balance);
      if (d.sessionStartBalance != null) setSessionStartBalance(d.sessionStartBalance);
    });

    handle('market', (d) => setActiveMarket(d));

    handle('positions', (d) => { if (d.positions) setPositions(d.positions); });

    handle('trade', (d) => {
      setTradeLog(prev => [d, ...prev].slice(0, 100));
      setFeesTotal(prev => prev + (d.fee || 0));
    });

    handle('eval', (d) => {
      setEvalLog(prev => [...prev.slice(-300), d]);
    });

    handle('log', (d) => addLog(d.msg, d.type));

    handle('bot_toggle', (d) => {
      setBotEnabled(d.enabled);
      if (d.reason === 'balance_floor') addLog('Bot auto-paused: balance floor hit', 'error');
      if (d.reason === 'daily_loss_limit') addLog('Bot auto-paused: daily loss limit hit', 'error');
      if (d.reason === 'loss_streak') addLog('Bot auto-paused: consecutive loss streak', 'error');
    });

    handle('config', (d) => {
      if (d.strategy) setStrategy(d.strategy);
    });

    es.onerror = () => addLog('SSE stream error — reconnecting...', 'error');
  }, [addLog]);

  // ── Kalshi WS (market data) ────────────────────────────────────────────────
  const connectKalshiWs = useCallback((token) => {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/api/ws?environment=${encodeURIComponent(environment)}&token=${encodeURIComponent(token)}`;
    addLog(`Connecting WebSocket proxy...`, 'info');

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      setIsConnecting(false);
      addLog('WebSocket connected. Subscribing to ticker...', 'success');
      ws.send(JSON.stringify({ id: 1, cmd: 'subscribe', params: { channels: ['ticker'] } }));
    };

    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === 'system') { addLog(d.msg, 'info'); return; }
        if (d.type === 'error') {
          addLog(`WS error: ${d.msg?.msg || d.msg?.code || JSON.stringify(d.msg)}`, 'error');
        }
        // Ticker data is now driven by the backend price engine via SSE
        // WS still used as fallback real-time feed from Kalshi
      } catch (_) {}
    };

    ws.onerror = () => { addLog('WebSocket error', 'error'); setIsConnected(false); };
    ws.onclose = (e) => {
      addLog(`WebSocket disconnected: ${e.reason || `code ${e.code}`}`, 'error');
      setIsConnected(false);
    };
  }, [environment, addLog]);

  // ── Auth & connect ─────────────────────────────────────────────────────────
  const handleConnect = async () => {
    if (!apiKey) { addLog('API Key is required', 'error'); return; }
    setIsConnecting(true);
    addLog('Initiating REST Auth...', 'info');
    try {
      const res = await fetch('/api/kalshi/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, environment }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Auth failed');
      }
      const { token, balance: bal } = await res.json();
      setSessionToken(token);
      setBalance(bal);
      addLog(`Authenticated. Balance: $${bal?.toFixed(2)}`, 'success');
      startSSE();
      connectKalshiWs(token);
    } catch (err) {
      addLog(`Authentication failed: ${err.message}`, 'error');
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    if (wsRef.current) wsRef.current.close();
    if (sseRef.current) sseRef.current.close();
    setIsConnected(false);
    setSessionToken(null);
    addLog('Disconnected', 'info');
  };

  // ── Bot toggle ─────────────────────────────────────────────────────────────
  const handleBotToggle = async (val) => {
    try {
      await fetch('/api/bot/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: val }),
      });
      setBotEnabled(val);
    } catch (e) {
      addLog(`Toggle failed: ${e.message}`, 'error');
    }
  };

  // ── Config push (debounced via useEffect) ──────────────────────────────────
  useEffect(() => {
    if (!isConnected) return;
    const t = setTimeout(() => {
      fetch('/api/bot/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy, algoMode, riskPct, maxPositions, minConfidence, dailyLossLimitPct, maxTradeSize }),
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [strategy, algoMode, riskPct, maxPositions, minConfidence, dailyLossLimitPct, maxTradeSize, isConnected]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const sessionPnl = balance != null && sessionStartBalance != null ? balance - sessionStartBalance : null;
  const pnlColor = sessionPnl == null ? 'text-slate-500' : sessionPnl >= 0 ? 'text-green-400' : 'text-red-400';

  const allCandles = currentCandle ? [...candles, currentCandle] : candles;
  const strikePrice = activeMarket?.floorStrike;

  // Countdown to market close
  const [countdown, setCountdown] = useState('');
  useEffect(() => {
    if (!activeMarket?.closeTime) { setCountdown(''); return; }
    const update = () => {
      const ms = new Date(activeMarket.closeTime) - Date.now();
      if (ms <= 0) { setCountdown('CLOSING'); return; }
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setCountdown(`${m}:${s.toString().padStart(2, '0')}`);
    };
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, [activeMarket]);

  // Fee preview for manual trade estimates
  const estContracts = balance ? Math.max(1, Math.floor(balance * riskPct / 100 / 0.5)) : 0;
  const estFee = calcFee(estContracts, 0.5, true);
  const estNetWin = estContracts * 1.00 - estContracts * 0.5 - estFee;

  const envColor = environment === 'Live' ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'bg-orange-500/20 text-orange-400 border-orange-500/30';

  return (
    <div className="flex flex-col h-screen bg-[#0a0d12] text-slate-300 font-sans overflow-hidden">

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-white/5 bg-[#111418] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-blue-600/20 rounded-lg">
            <Activity className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xs font-bold text-white tracking-tight">Kalshi BTC 15-min Alpha Bot</h1>
            <p className="text-[9px] text-slate-600 uppercase tracking-widest">v2 · Real Engine</p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[10px]">
          {/* Balance */}
          {balance != null && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-black/40 rounded-full border border-white/5">
              <DollarSign className="w-3 h-3 text-slate-400" />
              <span className="font-mono text-white">${balance.toFixed(2)}</span>
              {sessionPnl != null && (
                <span className={`font-mono ${pnlColor}`}>
                  ({sessionPnl >= 0 ? '+' : ''}${sessionPnl.toFixed(2)})
                </span>
              )}
            </div>
          )}
          {/* Fees */}
          {feesTotal > 0 && (
            <div className="flex items-center gap-1 px-2.5 py-1 bg-black/40 rounded-full border border-white/5 text-amber-400">
              <span className="font-mono">Fees: ${feesTotal.toFixed(2)}</span>
            </div>
          )}
          {/* Market */}
          {activeMarket && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-black/40 rounded-full border border-white/5">
              <Target className="w-3 h-3 text-slate-400" />
              <span className="font-mono text-slate-300">{activeMarket.ticker?.split('-').slice(-1)[0]}</span>
              <span className="font-mono text-amber-400">{countdown}</span>
            </div>
          )}
          {/* Env badge */}
          <div className={`px-2.5 py-1 rounded-full border text-[9px] font-bold uppercase ${envColor}`}>
            {environment}
          </div>
          {/* Connection status */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-black/40 rounded-full border border-white/5">
            <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="font-mono">{isConnected ? 'LIVE' : 'OFFLINE'}</span>
          </div>
        </div>
      </header>

      {/* ── Main layout ── */}
      <main className="flex-1 overflow-hidden p-3 grid grid-cols-12 gap-3">

        {/* ── Left panel ── */}
        <div className="col-span-3 flex flex-col gap-3 overflow-y-auto pr-0.5">

          {/* Credentials */}
          <section className="bg-[#111418] border border-white/8 rounded-xl overflow-hidden flex-shrink-0">
            <div className="px-3 py-2.5 bg-white/4 border-b border-white/5 flex items-center gap-2">
              <Lock className="w-3 h-3 text-slate-500" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Credentials</span>
            </div>
            <div className="p-3 space-y-3">
              <div className="space-y-1">
                <label className="text-[9px] uppercase font-bold text-slate-600">Kalshi API Key</label>
                <input
                  type="text" value={apiKey} onChange={e => setApiKey(e.target.value)}
                  placeholder="Paste your API Key ID"
                  disabled={isConnected}
                  className="w-full bg-black/30 border border-white/8 rounded-lg px-3 py-2 text-[10px] focus:outline-none focus:border-blue-500/50 text-white font-mono disabled:opacity-50"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] uppercase font-bold text-slate-600">API Secret</label>
                <input
                  readOnly type="password" placeholder="Stored in backend .env"
                  className="w-full bg-black/20 border border-white/5 rounded-lg px-3 py-2 text-[10px] text-slate-600 font-mono italic"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] uppercase font-bold text-slate-600">Environment</label>
                <select
                  value={environment} onChange={e => setEnvironment(e.target.value)}
                  disabled={isConnected}
                  className="w-full bg-black/30 border border-white/8 rounded-lg px-2 py-2 text-[10px] text-white focus:outline-none cursor-pointer disabled:opacity-50"
                >
                  <option value="Demo">Demo</option>
                  <option value="Live">Live</option>
                </select>
              </div>
              {!isConnected ? (
                <button
                  onClick={handleConnect} disabled={isConnecting}
                  className="w-full py-2.5 rounded-lg font-bold text-[10px] bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 flex justify-center gap-2 items-center"
                >
                  {isConnecting
                    ? <><RefreshCw className="w-3 h-3 animate-spin" /> Connecting...</>
                    : <><Zap className="w-3 h-3" /> Connect</>}
                </button>
              ) : (
                <button
                  onClick={handleDisconnect}
                  className="w-full py-2.5 rounded-lg font-bold text-[10px] bg-red-500/15 text-red-400 border border-red-500/25 hover:bg-red-500/25"
                >
                  Disconnect
                </button>
              )}
            </div>
          </section>

          {/* Bot toggle */}
          <section className="bg-[#111418] border border-white/8 rounded-xl p-3 flex-shrink-0">
            <BotToggle enabled={botEnabled} onToggle={handleBotToggle} disabled={!isConnected} />
            {botEnabled && (
              <div className="mt-2 text-[9px] text-amber-400/80 bg-amber-400/5 border border-amber-400/15 rounded-lg px-3 py-2">
                Live orders will be placed automatically. Monitor closely.
              </div>
            )}
          </section>

          {/* Strategy */}
          <section className="bg-[#111418] border border-white/8 rounded-xl overflow-hidden flex-shrink-0">
            <div className="px-3 py-2.5 bg-white/4 border-b border-white/5 flex items-center gap-2">
              <TrendingUp className="w-3 h-3 text-slate-500" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Strategy</span>
            </div>
            <div className="p-3 space-y-4">
              {/* Strategy tabs */}
              <div className="flex gap-1 bg-black/30 rounded-lg p-0.5">
                {[['algo', 'Algo (RSI+MACD)'], ['scalper', 'Vol Scalper']].map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setStrategy(val)}
                    className={`flex-1 py-1.5 rounded-md text-[9px] font-bold transition-all ${
                      strategy === val
                        ? 'bg-blue-600 text-white shadow'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Algo mode */}
              {strategy === 'algo' && (
                <div className="flex gap-1 bg-black/20 rounded-lg p-0.5">
                  {[['momentum', 'Momentum'], ['mean_reversion', 'Mean Rev']].map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setAlgoMode(val)}
                      className={`flex-1 py-1.5 rounded-md text-[9px] font-bold transition-all ${
                        algoMode === val
                          ? 'bg-slate-600 text-white'
                          : 'text-slate-600 hover:text-slate-400'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-3 pt-1 border-t border-white/5">
                <SliderRow label="Risk per trade" value={riskPct} min={5} max={50} step={5} onChange={setRiskPct} unit="%" />
                <SliderRow label="Max positions" value={maxPositions} min={1} max={10} onChange={setMaxPositions} />
                <SliderRow label="Min confidence" value={minConfidence} min={50} max={95} step={5} onChange={setMinConfidence} unit="%" />
                <SliderRow label="Max trade $" value={maxTradeSize} min={5} max={200} step={5} onChange={setMaxTradeSize} unit="" />
                <SliderRow label="Daily loss limit" value={dailyLossLimitPct} min={5} max={50} step={5} onChange={setDailyLossLimitPct} unit="%" />
              </div>
            </div>
          </section>

          {/* Signal readout */}
          <section className="bg-[#111418] border border-white/8 rounded-xl overflow-hidden flex-shrink-0">
            <div className="px-3 py-2.5 bg-white/4 border-b border-white/5 flex items-center gap-2">
              <BarChart2 className="w-3 h-3 text-slate-500" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Live Signal</span>
            </div>
            <div className="p-3 space-y-2">
              {indicators ? (
                <>
                  {/* Signal badge */}
                  <div className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                    indicators.signal === 'YES' ? 'bg-green-500/10 border border-green-500/20' :
                    indicators.signal === 'NO' ? 'bg-red-500/10 border border-red-500/20' :
                    'bg-black/30 border border-white/5'
                  }`}>
                    <span className="text-[10px] font-bold text-slate-400">SIGNAL</span>
                    <span className={`text-sm font-bold font-mono ${
                      indicators.signal === 'YES' ? 'text-green-400' :
                      indicators.signal === 'NO' ? 'text-red-400' :
                      'text-slate-500'
                    }`}>
                      {indicators.signal || 'NONE'}
                    </span>
                    {indicators.signal && (
                      <span className="text-[10px] font-mono text-slate-400">{indicators.confidence}%</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {indicators.rsi != null && (
                      <Stat label="RSI(14)" value={indicators.rsi.toFixed(1)}
                        color={indicators.rsi > 70 ? 'text-red-400' : indicators.rsi < 30 ? 'text-green-400' : 'text-white'} />
                    )}
                    {indicators.macd != null && (
                      <Stat label="MACD" value={indicators.macd.toFixed(2)}
                        color={indicators.macd > 0 ? 'text-green-400' : 'text-red-400'} />
                    )}
                    {indicators.histogram != null && (
                      <Stat label="Histogram" value={indicators.histogram.toFixed(2)}
                        color={indicators.histogram > 0 ? 'text-green-400' : 'text-red-400'} />
                    )}
                    {indicators.atr != null && (
                      <Stat label="ATR(14)" value={indicators.atr.toFixed(0)}
                        sub={indicators.atrExpanding ? '↑ expanding' : '↓ contracting'}
                        color={indicators.atrExpanding ? 'text-amber-400' : 'text-slate-400'} />
                    )}
                    {indicators.bb && (
                      <Stat label="BB Position" value={`${(indicators.bbPosition * 100).toFixed(0)}%`}
                        color={indicators.bbPosition < 0.15 ? 'text-green-400' : indicators.bbPosition > 0.85 ? 'text-red-400' : 'text-white'} />
                    )}
                  </div>
                </>
              ) : (
                <div className="text-[10px] text-slate-600 text-center py-3">Waiting for data...</div>
              )}
            </div>
          </section>

          {/* Fee preview */}
          {balance != null && balance > 0 && (
            <section className="bg-[#111418] border border-amber-500/10 rounded-xl overflow-hidden flex-shrink-0">
              <div className="px-3 py-2.5 bg-white/4 border-b border-white/5 flex items-center gap-2">
                <DollarSign className="w-3 h-3 text-amber-500" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500/70">Fee Preview</span>
              </div>
              <div className="p-3 text-[9px] space-y-1.5 font-mono text-slate-500">
                <div className="flex justify-between"><span>Est contracts @50¢</span><span className="text-white">{estContracts}</span></div>
                <div className="flex justify-between"><span>Trade size ({riskPct}% of bal)</span><span className="text-white">${(balance * riskPct / 100).toFixed(2)}</span></div>
                <div className="flex justify-between text-amber-400"><span>Taker fee (maker ×0.25)</span><span>${estFee.toFixed(2)}</span></div>
                <div className="border-t border-white/5 pt-1.5 flex justify-between text-green-400"><span>Net if WIN</span><span>+${estNetWin.toFixed(2)}</span></div>
                <div className="flex justify-between text-red-400"><span>Net if LOSE</span><span>-${(balance * riskPct / 100 + estFee).toFixed(2)}</span></div>
                <div className="flex justify-between text-slate-400"><span>Break-even rate</span><span>{((balance * riskPct / 100 + estFee) / estContracts * 100).toFixed(0)}¢</span></div>
              </div>
            </section>
          )}
        </div>

        {/* ── Center panel ── */}
        <div className="col-span-6 flex flex-col gap-3 min-h-0">
          {/* Chart header */}
          <section className="bg-[#111418] border border-white/8 rounded-xl overflow-hidden flex flex-col flex-1 min-h-0">
            <div className="px-4 py-2.5 bg-white/4 border-b border-white/5 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white">BTC/USD 15m</span>
                {btcPrice && (
                  <span className="text-xs font-mono text-green-400 bg-green-500/10 px-2 py-0.5 rounded">
                    ${btcPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-[9px]">
                {strikePrice && (
                  <span className="text-amber-400 font-mono">Strike: ${strikePrice.toLocaleString()}</span>
                )}
                {activeMarket && (
                  <span className="font-mono text-slate-500">{activeMarket.ticker}</span>
                )}
                {countdown && (
                  <span className={`font-mono font-bold ${
                    parseInt(countdown) < 2 ? 'text-red-400' : 'text-slate-400'
                  }`}>{countdown}</span>
                )}
              </div>
            </div>
            <CandleChart
              candles={allCandles}
              currentPrice={btcPrice}
              strikePrice={strikePrice}
            />
          </section>

          {/* Bottom tabs */}
          <div className="bg-[#111418] border border-white/8 rounded-xl overflow-hidden flex-shrink-0" style={{ height: '220px' }}>
            <div className="flex border-b border-white/5 flex-shrink-0">
              {[['chart', 'System Logs'], ['positions', 'Positions'], ['tradelog', 'Trade Log'], ['evallog', 'Signal Log']].map(([tab, label]) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-2 text-[9px] font-bold uppercase tracking-wider transition-colors ${
                    activeTab === tab
                      ? 'text-blue-400 border-b border-blue-500'
                      : 'text-slate-600 hover:text-slate-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* System logs */}
            {activeTab === 'chart' && (
              <div ref={logsRef} className="p-2 font-mono text-[9px] overflow-y-auto space-y-0.5 bg-black/10 h-full">
                {logs.map(l => (
                  <div key={l.id} className="flex gap-2">
                    <span className="text-slate-700 flex-shrink-0">[{l.time}]</span>
                    <span className={l.type === 'error' ? 'text-red-400' : l.type === 'success' ? 'text-green-400' : 'text-slate-400'}>{l.msg}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Positions */}
            {activeTab === 'positions' && (
              <div className="overflow-y-auto h-full">
                <table className="w-full text-[9px]">
                  <thead className="bg-black/30 sticky top-0">
                    <tr className="text-slate-500 uppercase">
                      <th className="p-2 text-left">Market</th>
                      <th className="p-2 text-right">YES</th>
                      <th className="p-2 text-right">NO</th>
                      <th className="p-2 text-right">Cost</th>
                      <th className="p-2 text-right">Fees</th>
                      <th className="p-2 text-right">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.length === 0 && (
                      <tr><td colSpan={6} className="text-center text-slate-600 py-4 text-[9px]">No open positions</td></tr>
                    )}
                    {positions.map((p, i) => (
                      <tr key={i} className="border-t border-white/3 hover:bg-white/2">
                        <td className="p-2 font-mono text-white text-[8px]">{p.ticker}</td>
                        <td className="p-2 text-right font-mono text-green-400">{p.yesContracts}</td>
                        <td className="p-2 text-right font-mono text-red-400">{p.noContracts}</td>
                        <td className="p-2 text-right font-mono">${p.totalCost?.toFixed(2)}</td>
                        <td className="p-2 text-right font-mono text-amber-400">${p.feesPaid?.toFixed(2)}</td>
                        <td className={`p-2 text-right font-mono font-bold ${p.realizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {p.realizedPnl >= 0 ? '+' : ''}${p.realizedPnl?.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Trade log */}
            {activeTab === 'tradelog' && (
              <div className="overflow-y-auto h-full">
                <table className="w-full text-[9px]">
                  <thead className="bg-black/30 sticky top-0">
                    <tr className="text-slate-500 uppercase">
                      <th className="p-2 text-left">Time</th>
                      <th className="p-2 text-left">Market</th>
                      <th className="p-2 text-right">Side</th>
                      <th className="p-2 text-right">Qty</th>
                      <th className="p-2 text-right">Price</th>
                      <th className="p-2 text-right">Fee</th>
                      <th className="p-2 text-right">Conf</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tradeLog.length === 0 && (
                      <tr><td colSpan={7} className="text-center text-slate-600 py-4">No trades this session</td></tr>
                    )}
                    {tradeLog.map((t, i) => (
                      <tr key={i} className="border-t border-white/3 hover:bg-white/2">
                        <td className="p-2 font-mono text-slate-500">{t.time}</td>
                        <td className="p-2 font-mono text-white text-[8px]">{t.market}</td>
                        <td className={`p-2 text-right font-bold ${t.signal === 'YES' ? 'text-green-400' : 'text-red-400'}`}>{t.signal}</td>
                        <td className="p-2 text-right font-mono">{t.contracts}</td>
                        <td className="p-2 text-right font-mono">{(t.price * 100).toFixed(0)}¢</td>
                        <td className="p-2 text-right font-mono text-amber-400">${t.fee?.toFixed(2)}</td>
                        <td className="p-2 text-right font-mono text-blue-400">{t.confidence}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Signal eval log */}
            {activeTab === 'evallog' && (
              <div ref={evalRef} className="p-2 font-mono text-[8px] overflow-y-auto space-y-0.5 h-full">
                {evalLog.length === 0 && <div className="text-slate-600 text-center py-4">Waiting for evaluations...</div>}
                {[...evalLog].reverse().map((e, i) => (
                  <div key={i} className="flex gap-2 border-b border-white/3 pb-0.5">
                    <span className="text-slate-700 flex-shrink-0">{e.time}</span>
                    <span className="text-slate-500 flex-shrink-0">${Number(e.price || 0).toLocaleString()}</span>
                    <span className="text-slate-600">RSI:{e.rsi}</span>
                    <span className="text-slate-600">MACD:{e.macd}</span>
                    <span className={`font-bold flex-shrink-0 ${
                      e.action?.includes('YES') ? 'text-green-400' :
                      e.action?.includes('NO') ? 'text-red-400' :
                      'text-slate-600'
                    }`}>{e.action}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Right panel ── */}
        <div className="col-span-3 flex flex-col gap-3">
          {/* Stats */}
          <section className="bg-[#111418] border border-white/8 rounded-xl p-3 flex-shrink-0">
            <div className="grid grid-cols-2 gap-2">
              <Stat
                label="Balance"
                value={balance != null ? `$${balance.toFixed(2)}` : '—'}
                sub={sessionStartBalance ? `Started: $${sessionStartBalance.toFixed(2)}` : ''}
              />
              <Stat
                label="Session P&L"
                value={sessionPnl != null ? `${sessionPnl >= 0 ? '+' : ''}$${sessionPnl.toFixed(2)}` : '—'}
                color={pnlColor}
              />
              <Stat
                label="Fees Paid"
                value={`$${feesTotal.toFixed(2)}`}
                color="text-amber-400"
                sub="This session"
              />
              <Stat
                label="Open Positions"
                value={positions.length}
                sub={`Max: ${maxPositions}`}
                color={positions.length >= maxPositions ? 'text-red-400' : 'text-white'}
              />
            </div>
          </section>

          {/* Market info */}
          {activeMarket && (
            <section className="bg-[#111418] border border-white/8 rounded-xl p-3 flex-shrink-0">
              <div className="flex items-center gap-2 mb-2">
                <Layers className="w-3 h-3 text-slate-500" />
                <span className="text-[10px] font-bold uppercase text-slate-400">Active Market</span>
              </div>
              <div className="space-y-1.5 text-[9px] font-mono">
                <div className="flex justify-between"><span className="text-slate-600">Ticker</span><span className="text-white">{activeMarket.ticker}</span></div>
                {activeMarket.floorStrike && (
                  <div className="flex justify-between"><span className="text-slate-600">Strike</span><span className="text-amber-400">${activeMarket.floorStrike?.toLocaleString()}</span></div>
                )}
                {btcPrice && activeMarket.floorStrike && (
                  <div className="flex justify-between">
                    <span className="text-slate-600">BTC vs Strike</span>
                    <span className={btcPrice >= activeMarket.floorStrike ? 'text-green-400' : 'text-red-400'}>
                      {btcPrice >= activeMarket.floorStrike ? '▲ ABOVE' : '▼ BELOW'}
                    </span>
                  </div>
                )}
                <div className="border-t border-white/5 pt-1.5 grid grid-cols-2 gap-x-4">
                  <div className="flex justify-between"><span className="text-slate-600">YES bid</span><span className="text-green-400">{((activeMarket.yesBid || 0) * 100).toFixed(0)}¢</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">ask</span><span className="text-green-400">{((activeMarket.yesAsk || 0) * 100).toFixed(0)}¢</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">NO bid</span><span className="text-red-400">{((activeMarket.noBid || 0) * 100).toFixed(0)}¢</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">ask</span><span className="text-red-400">{((activeMarket.noAsk || 0) * 100).toFixed(0)}¢</span></div>
                </div>
                <div className="text-[9px] text-slate-700 pt-1">
                  Fee formula: 0.07×C×P×(1-P) | Maker: 0.0175×
                </div>
              </div>
            </section>
          )}

          {/* Diagnostics */}
          <section className="bg-[#111418] border border-white/8 rounded-xl p-3 flex-shrink-0">
            <div className="text-[9px] font-bold uppercase text-slate-500 mb-2">Diagnostics</div>
            <div className="space-y-1.5 text-[9px] font-mono">
              <div className="flex justify-between"><span className="text-slate-600">WS Status</span><span className={isConnected ? 'text-green-400' : 'text-slate-500'}>{isConnected ? 'CONNECTED' : 'IDLE'}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">Environment</span><span className={environment === 'Live' ? 'text-red-400' : 'text-orange-400'}>{environment.toUpperCase()}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">Strategy</span><span className="text-blue-400">{strategy === 'algo' ? `Algo / ${algoMode}` : 'Vol Scalper'}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">Bot state</span><span className={botEnabled ? 'text-green-400' : 'text-slate-500'}>{botEnabled ? 'TRADING' : 'OFF'}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">Candles loaded</span><span className="text-white">{allCandles.length}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">Trades placed</span><span className="text-white">{tradeLog.length}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">Signals evaluated</span><span className="text-white">{evalLog.length}</span></div>
            </div>
          </section>

          {/* Risk warnings */}
          {botEnabled && balance != null && (
            <section className="bg-amber-500/5 border border-amber-500/15 rounded-xl p-3 flex-shrink-0">
              <div className="flex items-center gap-1.5 mb-2">
                <AlertTriangle className="w-3 h-3 text-amber-500" />
                <span className="text-[9px] font-bold uppercase text-amber-500/70">Risk Limits Active</span>
              </div>
              <div className="space-y-1 text-[9px] font-mono text-slate-500">
                <div className="flex justify-between"><span>Daily loss limit</span><span className="text-amber-400">{dailyLossLimitPct}%</span></div>
                <div className="flex justify-between"><span>Balance floor</span><span className="text-amber-400">$5.00</span></div>
                <div className="flex justify-between"><span>Max trade</span><span className="text-amber-400">${maxTradeSize}</span></div>
                <div className="flex justify-between"><span>Auto-pause after</span><span className="text-amber-400">3 failures</span></div>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
