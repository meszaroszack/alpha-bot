import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

type Payload = {
  keyId?: string;
  privateKey?: string;
  baseUrl?: string;
};

function signedHeaders(keyId: string, privateKey: string, path: string) {
  const timestamp = Date.now().toString();
  const message = `${timestamp}GET${path}`;
  const signature = crypto.sign("sha256", Buffer.from(message), {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  });
  return {
    Accept: "application/json",
    "KALSHI-ACCESS-KEY": keyId,
    "KALSHI-ACCESS-TIMESTAMP": timestamp,
    "KALSHI-ACCESS-SIGNATURE": signature.toString("base64"),
  };
}

async function signedGet(
  baseUrl: string,
  keyId: string,
  privateKey: string,
  path: string
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: signedHeaders(keyId, privateKey, path),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Kalshi ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? (JSON.parse(text) as unknown) : null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Payload;
    const keyId = body.keyId?.trim();
    const privateKey = body.privateKey?.trim();
    const baseUrl = (
      body.baseUrl?.trim() ||
      process.env.NEXT_PUBLIC_KALSHI_BASE_URL ||
      "https://api.elections.kalshi.com/trade-api/v2"
    ).replace(/\/$/, "");

    if (!keyId || !privateKey) {
      return NextResponse.json(
        { ok: false, error: "Missing keyId or privateKey." },
        { status: 400 }
      );
    }

    const [balanceRaw, positionsRaw] = await Promise.allSettled([
      signedGet(baseUrl, keyId, privateKey, "/portfolio/balance"),
      signedGet(baseUrl, keyId, privateKey, "/portfolio/positions?limit=200"),
    ]);

    const balance =
      balanceRaw.status === "fulfilled"
        ? balanceRaw.value
        : { error: balanceRaw.reason instanceof Error ? balanceRaw.reason.message : "Failed" };
    const positions =
      positionsRaw.status === "fulfilled" ? positionsRaw.value : { market_positions: [] };

    const positionList = Array.isArray((positions as { market_positions?: unknown[] }).market_positions)
      ? ((positions as { market_positions: unknown[] }).market_positions ?? [])
      : [];

    return NextResponse.json({
      ok: true,
      user: {
        keyId,
        trackedAt: new Date().toISOString(),
        openPositions: positionList.length,
      },
      balance,
      positions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
