"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useEffect, useMemo, useState } from "react";
import { Settings } from "lucide-react";

type UserDetails = {
  ok: boolean;
  error?: string;
  user?: {
    keyId: string;
    trackedAt: string;
    openPositions: number;
  };
  balance?: Record<string, unknown>;
  positions?: { market_positions?: unknown[] };
};

const STORAGE_KEY = "kalshi.credentials.v1";

export function KalshiCredentialsDialog() {
  const [open, setOpen] = useState(false);
  const [keyId, setKeyId] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<UserDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { keyId?: string; privateKey?: string };
      if (parsed.keyId) setKeyId(parsed.keyId);
      if (parsed.privateKey) setPrivateKey(parsed.privateKey);
    } catch {
      // ignore
    }
  }, []);

  const hasCreds = keyId.trim().length > 0 && privateKey.trim().length > 0;

  const balanceSummary = useMemo(() => {
    const raw = details?.balance;
    if (!raw || typeof raw !== "object") return [];
    const entries = Object.entries(raw).filter(([, v]) => {
      return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
    });
    return entries.slice(0, 8);
  }, [details]);

  async function fetchDetails() {
    setLoading(true);
    setError(null);
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ keyId: keyId.trim(), privateKey: privateKey.trim() })
      );

      const res = await fetch("/api/kalshi/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyId: keyId.trim(), privateKey: privateKey.trim() }),
      });
      const data = (await res.json()) as UserDetails;
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Failed to fetch user details.");
      }
      setDetails(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to fetch user details.");
    } finally {
      setLoading(false);
    }
  }

  function clearCredentials() {
    localStorage.removeItem(STORAGE_KEY);
    setPrivateKey("");
    setKeyId("");
    setDetails(null);
    setError(null);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="Kalshi settings">
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Kalshi Credentials & User Tracking</DialogTitle>
          <DialogDescription>
            Enter a Kalshi API key ID and private key PEM to track this specific user account.
            Credentials are stored locally in your browser on this machine.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-[#6B6B8A]">KALSHI_API_KEY_ID</label>
            <Input value={keyId} onChange={(e) => setKeyId(e.target.value)} placeholder="your_key_id" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-[#6B6B8A]">KALSHI_PRIVATE_KEY (PEM)</label>
            <textarea
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder="-----BEGIN PRIVATE KEY-----"
              className="min-h-28 w-full rounded-md border border-[#1E1E2E] bg-[#12121A] px-3 py-2 text-sm text-[#E8E8F0] placeholder:text-[#6B6B8A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4AA]/40"
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="accent" disabled={!hasCreds || loading} onClick={fetchDetails}>
              {loading ? "Fetching..." : "Track User Details"}
            </Button>
            <Button type="button" variant="ghost" onClick={clearCredentials}>
              Clear
            </Button>
          </div>
          {error && <div className="text-sm text-[#FF4757]">{error}</div>}
        </div>

        {details?.user && (
          <div className="mt-4 rounded-md border border-[#1E1E2E] bg-[#0A0A0F] p-3 text-sm">
            <div className="text-xs uppercase text-[#6B6B8A]">Tracked account</div>
            <div className="mt-1 text-[#E8E8F0]">
              Key: <span className="font-mono">{details.user.keyId}</span>
            </div>
            <div className="text-[#6B6B8A]">Open positions: {details.user.openPositions}</div>
            <div className="text-[#6B6B8A]">Updated: {new Date(details.user.trackedAt).toLocaleString()}</div>
            {balanceSummary.length > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                {balanceSummary.map(([k, v]) => (
                  <div key={k} className="rounded border border-[#1E1E2E] px-2 py-1">
                    <span className="text-[#6B6B8A]">{k}:</span>{" "}
                    <span className="font-mono text-[#E8E8F0]">{String(v)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
