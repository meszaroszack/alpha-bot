import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3001'
  : '';

export default function Onboarding() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [apiKey, setApiKey] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [environment, setEnvironment] = useState('Demo');
  const [bankroll, setBankroll] = useState('1000');
  const [maxTradePct, setMaxTradePct] = useState(3);
  const [ballDontLieKey, setBallDontLieKey] = useState('');
  const [perplexityKey, setPerplexityKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === 'string') setPrivateKey(text.trim());
    };
    reader.readAsText(file);
  };

  const handleLaunch = async () => {
    setError(null);
    if (!apiKey.trim()) {
      setError('Access Key ID is required.');
      return;
    }
    if (!privateKey.trim()) {
      setError('Private key is required. Upload a .key file or paste PEM.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/kalshi/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          privateKey: privateKey.trim(),
          environment,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');
      localStorage.setItem('alpha_token', data.token);
      localStorage.setItem('alpha_env', environment);
      if (bankroll) localStorage.setItem('alpha_bankroll', bankroll);
      if (maxTradePct) localStorage.setItem('alpha_max_trade_pct', String(maxTradePct));
      navigate('/', { replace: true });
      window.location.reload(); // ensure dashboard picks up token
    } catch (err) {
      setError(err.message || 'Launch failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="onboarding-page">
      <div className="onboarding-card">
        <h1 className="onboarding-title">Secure Credential Onboarding</h1>
        <p className="onboarding-subtitle">
          Keys are stored in memory only — never persisted to disk or database
        </p>

        <section className="onboarding-section">
          <h2 className="onboarding-section-title">KALSHI</h2>
          <label className="field-label">ACCESS KEY ID (UUID)</label>
          <input
            className="field-input"
            type="text"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Your Kalshi API Key ID"
          />
          <label className="field-label">PRIVATE KEY (.key file) — Upload or paste PEM</label>
          <div className="private-key-row">
            <button
              type="button"
              className="upload-key-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              Upload .key
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".key,.pem"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
          </div>
          <textarea
            className="field-input field-textarea"
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;..."
            rows={4}
          />
        </section>

        <section className="onboarding-section optional">
          <h2 className="onboarding-section-title">
            BALLDONTLIE <span className="optional-tag">OPTIONAL</span>
          </h2>
          <p className="onboarding-hint">Enhances rebound signal</p>
          <input
            className="field-input"
            type="password"
            value={ballDontLieKey}
            onChange={(e) => setBallDontLieKey(e.target.value)}
            placeholder="API key"
          />
        </section>

        <section className="onboarding-section optional">
          <h2 className="onboarding-section-title">
            PERPLEXITY SENTIMENT GUARDRAIL <span className="optional-tag">OPTIONAL</span>
          </h2>
          <input
            className="field-input"
            type="password"
            value={perplexityKey}
            onChange={(e) => setPerplexityKey(e.target.value)}
            placeholder="API key"
          />
        </section>

        <section className="onboarding-section">
          <h2 className="onboarding-section-title">RISK CONFIGURATION</h2>
          <label className="field-label">BANKROLL (USD)</label>
          <input
            className="field-input"
            type="number"
            min="1"
            value={bankroll}
            onChange={(e) => setBankroll(e.target.value)}
            placeholder="1000"
          />
          <label className="field-label">Max per trade: ${maxTradePct > 0 ? (Number(bankroll) * (maxTradePct / 100)).toFixed(2) : '0'} ({maxTradePct}%)</label>
          <input
            className="field-input"
            type="range"
            min="1"
            max="10"
            value={maxTradePct}
            onChange={(e) => setMaxTradePct(Number(e.target.value))}
          />
        </section>

        <section className="onboarding-section">
          <h2 className="onboarding-section-title">EXECUTION MODE</h2>
          <div className="env-radio-group">
            <label className={`env-radio ${environment === 'Demo' ? 'active' : ''}`}>
              <input
                type="radio"
                name="onboard-env"
                value="Demo"
                checked={environment === 'Demo'}
                onChange={() => setEnvironment('Demo')}
              />
              DEMO
            </label>
            <label className={`env-radio ${environment === 'Live' ? 'active' : ''}`}>
              <input
                type="radio"
                name="onboard-env"
                value="Live"
                checked={environment === 'Live'}
                onChange={() => setEnvironment('Live')}
              />
              SIMLIVE
            </label>
          </div>
        </section>

        {error && <div className="modal-error">{error}</div>}
        <button
          className="connect-btn onboarding-launch-btn"
          onClick={handleLaunch}
          disabled={loading || !apiKey.trim() || !privateKey.trim()}
        >
          {loading ? 'Connecting...' : 'LAUNCH APOLLO-AGENT →'}
        </button>

        <p className="onboarding-footer">
          Quarter-Kelly (0.25x) · 3% max per contract · 0.1% halt threshold · RSA-PSS signed
        </p>
      </div>
    </div>
  );
}
