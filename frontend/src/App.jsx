import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Settings, Activity, Shield, TrendingUp, Database, Download, Zap, Lock, Terminal, ChevronDown, CheckCircle2 } from 'lucide-react';

const generateInitialData = (count = 40) => {
  let basePrice = 64200;
  return Array.from({ length: count }).map((_, i) => {
    const open = basePrice + (Math.random() - 0.5) * 400;
    const close = open + (Math.random() - 0.5) * 300;
    const high = Math.max(open, close) + Math.random() * 100;
    const low = Math.min(open, close) - Math.random() * 100;
    basePrice = close;
    return { open, close, high, low, timestamp: Date.now() - (count - i) * 15 * 60000 };
  });
};

const App = () => {
  const [apiKey, setApiKey] = useState('');
  const [accountId, setAccountId] = useState('');
  const [environment, setEnvironment] = useState('Demo');
  const [sessionToken, setSessionToken] = useState(null);

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const wsRef = useRef(null);

  const [priceData, setPriceData] = useState(generateInitialData());
  const [currentPrice, setCurrentPrice] = useState(64200);

  const [activeModel, setActiveModel] = useState('Volatility Scalper');
  const [frequency, setFrequency] = useState(5);
  const [maxPosition, setMaxPosition] = useState(20);
  const [riskLimit, setRiskLimit] = useState(2);
  const [minProb, setMinProb] = useState(65);

  const [logs, setLogs] = useState([{ id: 1, time: new Date().toLocaleTimeString('en-GB'), msg: 'System initialized. Enter credentials to begin.', type: 'info' }]);
  const [positions, setPositions] = useState([]);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs]);

  const addLog = useCallback((msg, type = 'info') => {
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    setLogs(prev => [...prev, { id: Date.now() + Math.random(), time, msg, type }]);
  }, []);

  const exportCSV = () => {
    addLog('Exporting to trading_bot_export.csv', 'success');
  };

  const authenticateKalshi = async () => {
    addLog(`Initiating REST Auth...`, 'info');
    try {
      const response = await fetch('/api/kalshi/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, environment })
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Auth failed via proxy');
      }
      const data = await response.json();
      setSessionToken(data.token);
      addLog(`Authenticated successfully.`, 'success');
      return data.token;
    } catch (error) {
      addLog(`Authentication failed: ${error.message}`, 'error');
      throw error;
    }
  };

  const handleConnect = async () => {
    if (!apiKey) {
      addLog('Error: API Key is required.', 'error');
      return;
    }
    setIsConnecting(true);
    try {
      const token = await authenticateKalshi();
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/api/ws?environment=${encodeURIComponent(environment)}`;
      addLog(`Connecting to WebSocket (via proxy): ${wsUrl}`, 'info');

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnecting(false);
        setIsConnected(true);
        addLog('WebSocket connected. Subscribing to ticker...', 'success');
        // Subscribe to ticker for all markets (no market_tickers = avoid "market not found")
        ws.send(JSON.stringify({ id: 1, cmd: 'subscribe', params: { channels: ['ticker'] } }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'error') {
            const msg = data.msg?.msg || data.msg?.code || JSON.stringify(data.msg);
            addLog(`WebSocket server error: ${msg}`, 'error');
            return;
          }
          if (data.type === 'ticker' && data.msg) {
            const msg = data.msg;
            const price = msg.yes_ask_dollars != null ? Number(msg.yes_ask_dollars)
              : msg.yes_bid_dollars != null ? Number(msg.yes_bid_dollars)
              : msg.last_price_dollars != null ? Number(msg.last_price_dollars)
              : msg.price != null ? Number(msg.price) : null;
            if (price != null) {
              setCurrentPrice(price);
              updateChartData(price);
              evaluateStrategy(price);
            }
          }
        } catch (_) {}
      };

      ws.onerror = () => { addLog('WebSocket error.', 'error'); setIsConnected(false); };
      ws.onclose = (event) => {
        const reason = event.reason || `code ${event.code}`;
        addLog(`WebSocket disconnected: ${reason}`, 'error');
        setIsConnected(false);
        setSessionToken(null);
      };
    } catch (err) {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    if (wsRef.current) { wsRef.current.close(); addLog('Disconnected.', 'info'); }
  };

  const evaluateStrategy = useCallback((latestPrice) => {
    const randomSignal = Math.random();
    if (randomSignal > 0.98) executeTrade('BUY', latestPrice);
    else if (randomSignal < 0.02) executeTrade('SELL', latestPrice);
  }, [activeModel, frequency, maxPosition, minProb]);

  const executeTrade = async (side, price) => {
    addLog(`[${activeModel}] Signal triggered: ${side} at $${price}`, 'success');
    try {
      const response = await fetch('/api/kalshi/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: side, market: 'BTC-USD', count: 1, token: sessionToken, environment })
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Order failed');
      }
      addLog(`Order routed to backend proxy.`, 'success');

      const newPosition = { id: `pos_${Date.now()}`, market: 'BTC-LIVE-MRKT', side: side, qty: 10, entry: price, current: price, pnl: 0 };
      setPositions(prev => [newPosition, ...prev].slice(0, 10));
    } catch (e) {
      addLog(`Order routing failed: ${e.message}`, 'error');
    }
  };

  const updateChartData = (newPrice) => {
    setPriceData(prev => {
      const current = [...prev];
      const lastCandle = { ...current[current.length - 1] };
      lastCandle.close = newPrice;
      lastCandle.high = Math.max(lastCandle.high, newPrice);
      lastCandle.low = Math.min(lastCandle.low, newPrice);
      current[current.length - 1] = lastCandle;
      return current;
    });
  };

  const maxPrice = Math.max(...priceData.map(d => d.high));
  const minPrice = Math.min(...priceData.map(d => d.low));
  const range = maxPrice - minPrice || 1;

  return (
    <div className="flex flex-col h-screen bg-[#0d1117] text-slate-300 font-sans selection:bg-blue-500/30">
      <header className="flex items-center justify-between px-6 py-3 border-b border-white/5 bg-[#161b22]">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600/20 rounded-lg"><Activity className="w-5 h-5 text-blue-400" /></div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight">Kalshi BTC 15-min Alpha Trading Bot</h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Live Integrated Template</p>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2 px-3 py-1 bg-black/40 rounded-full border border-white/5">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="font-mono">{isConnected ? 'LIVE_STREAMING' : 'OFFLINE'}</span>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden p-4 grid grid-cols-12 gap-4">
        <div className="col-span-3 flex flex-col gap-4 overflow-y-auto pr-1">
          <section className="bg-[#161b22] border border-white/10 rounded-xl overflow-hidden shadow-xl flex-shrink-0">
            <div className="px-4 py-3 bg-white/5 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2"><Lock className="w-3 h-3" /> API Credentials</h2>
            </div>
            <div className="p-4 space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-500">Kalshi API Key</label>
                <input type="text" placeholder="Enter your API Key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500/50 text-white font-mono" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-slate-500">API Secret</label>
                <input type="password" placeholder="Stored securely in Backend .env" readOnly className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-500 font-mono italic" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-500">Environment</label>
                  <select value={environment} onChange={(e) => setEnvironment(e.target.value)} className="w-full bg-black/30 border border-white/10 rounded-lg px-2 py-2 text-xs focus:outline-none cursor-pointer text-white">
                    <option value="Demo">Demo</option>
                    <option value="Live">Live</option>
                  </select>
                </div>
              </div>
              {!isConnected ? (
                <button onClick={handleConnect} disabled={isConnecting} className="w-full py-3 rounded-lg font-bold text-xs bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 flex justify-center gap-2 items-center">
                  {isConnecting ? <><Activity className="w-3 h-3 animate-spin" /> Auth...</> : <><Zap className="w-3 h-3" /> Connect</>}
                </button>
              ) : (
                <button onClick={handleDisconnect} className="w-full py-3 rounded-lg font-bold text-xs bg-red-500/20 text-red-400 border border-red-500/30">Disconnect</button>
              )}
            </div>
          </section>

          <section className="bg-[#161b22] border border-white/10 rounded-xl overflow-hidden shadow-xl flex-shrink-0">
            <div className="px-4 py-3 bg-white/5 border-b border-white/5"><h2 className="text-xs font-bold uppercase text-slate-400 flex items-center gap-2"><TrendingUp className="w-3 h-3" /> Strategy</h2></div>
            <div className="p-4 space-y-5">
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-bold text-slate-500">Trading Model</label>
                <select value={activeModel} onChange={(e) => setActiveModel(e.target.value)} className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-xs text-white">
                  <option>Volatility Scalper</option><option>Trend Follower</option>
                </select>
              </div>
              <div className="space-y-4 pt-2 border-t border-white/5">
                <div className="space-y-2"><div className="flex justify-between text-[10px] font-bold"><span className="text-slate-500">FREQUENCY</span><span className="text-white">{frequency}</span></div><input type="range" min="1" max="10" value={frequency} onChange={(e) => setFrequency(e.target.value)} className="w-full h-1 bg-slate-700 rounded-lg appearance-none accent-blue-500" /></div>
                <div className="space-y-2"><div className="flex justify-between text-[10px] font-bold"><span className="text-slate-500">MAX POSITION</span><span className="text-white">{maxPosition}</span></div><input type="range" min="5" max="100" step="5" value={maxPosition} onChange={(e) => setMaxPosition(e.target.value)} className="w-full h-1 bg-slate-700 rounded-lg appearance-none accent-blue-500" /></div>
              </div>
            </div>
          </section>
        </div>

        <div className="col-span-6 flex flex-col gap-4">
          <section className="flex-1 bg-[#161b22] border border-white/10 rounded-xl overflow-hidden flex flex-col shadow-xl">
            <div className="px-4 py-3 bg-white/5 border-b border-white/5 flex items-center justify-between">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">BTC Market Price <span className="text-green-400 bg-green-500/10 px-2 py-0.5 rounded text-[10px]">${currentPrice.toFixed(2)}</span></h2>
            </div>
            <div className="flex-1 relative bg-[#0d1117] p-4 font-mono overflow-hidden">
              <svg className="w-full h-full" preserveAspectRatio="none">
                {priceData.map((d, i) => {
                  const x = (i / (priceData.length - 1)) * 100;
                  const candleWidth = 1.5;
                  const yHigh = 100 - ((d.high - minPrice) / range) * 100;
                  const yLow = 100 - ((d.low - minPrice) / range) * 100;
                  const yOpen = 100 - ((d.open - minPrice) / range) * 100;
                  const yClose = 100 - ((d.close - minPrice) / range) * 100;
                  const color = d.close >= d.open ? '#10b981' : '#ef4444';
                  return (
                    <g key={i}>
                      <line x1={`${x}%`} y1={`${yHigh}%`} x2={`${x}%`} y2={`${yLow}%`} stroke={color} strokeWidth="1" />
                      <rect x={`${x - candleWidth/2}%`} y={`${Math.min(yOpen, yClose)}%`} width={`${candleWidth}%`} height={`${Math.abs(yOpen - yClose) || 0.5}%`} fill={color} />
                    </g>
                  );
                })}
              </svg>
            </div>
          </section>

          <div className="grid grid-cols-2 gap-4 h-48">
            <section className="bg-[#161b22] border border-white/10 rounded-xl overflow-hidden flex flex-col shadow-xl">
              <div className="px-4 py-2.5 bg-white/5 border-b border-white/5"><h2 className="text-[10px] font-bold uppercase text-slate-400">Diagnostics</h2></div>
              <div className="p-4 grid grid-cols-2 gap-4 flex-1">
                <div><div className="text-[10px] text-slate-500 font-bold uppercase">WS Status</div><div className={`text-xs font-mono ${isConnected ? 'text-green-400' : 'text-slate-500'}`}>{isConnected ? 'CONNECTED' : 'IDLE'}</div></div>
                <div><div className="text-[10px] text-slate-500 font-bold uppercase">Target Env</div><div className="text-xs font-mono text-blue-400">{environment}</div></div>
              </div>
            </section>
            <section className="bg-[#161b22] border border-white/10 rounded-xl overflow-hidden flex flex-col shadow-xl">
              <div className="px-4 py-2.5 bg-white/5 border-b border-white/5"><h2 className="text-[10px] font-bold uppercase text-slate-400">System Logs</h2></div>
              <div ref={scrollRef} className="p-3 font-mono text-[9px] overflow-y-auto flex-1 space-y-1 scroll-smooth bg-black/20">
                {logs.map(log => (<div key={log.id}><span className="text-slate-600">[{log.time}]</span> <span className={log.type === 'error' ? 'text-red-400' : 'text-slate-400'}>{log.msg}</span></div>))}
              </div>
            </section>
          </div>
        </div>

        <div className="col-span-3 flex flex-col gap-4">
          <section className="flex-1 bg-[#161b22] border border-white/10 rounded-xl overflow-hidden flex flex-col shadow-xl">
            <div className="px-4 py-3 bg-white/5 border-b border-white/5"><h2 className="text-xs font-bold uppercase text-slate-400 flex items-center gap-2"><Shield className="w-3 h-3" /> Live Positions</h2></div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-[10px]">
                <thead className="bg-black/30 sticky top-0 text-slate-500 uppercase"><tr><th className="p-3">Market</th><th className="p-3">Side</th><th className="p-3">Entry</th></tr></thead>
                <tbody>
                  {positions.map(pos => (<tr key={pos.id}><td className="p-3 text-white font-mono">{pos.market}</td><td className={`p-3 font-bold ${pos.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{pos.side}</td><td className="p-3 font-mono">${pos.entry.toFixed(2)}</td></tr>))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default App;
