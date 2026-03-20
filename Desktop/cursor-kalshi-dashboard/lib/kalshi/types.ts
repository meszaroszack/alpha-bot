/** Kalshi API object shapes (public trade API v2). */

export interface KalshiSeries {
  ticker: string;
  title: string;
  category?: string;
  frequency?: string;
  tags?: string[];
  last_updated_ts?: string;
}

export interface KalshiSeriesListResponse {
  series: KalshiSeries[];
  cursor?: string;
}

export interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  title: string;
  subtitle?: string;
  status?: string;
  market_type?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  no_bid_dollars?: string;
  no_ask_dollars?: string;
  last_price_dollars?: string;
  previous_price_dollars?: string;
  volume_fp?: string;
  volume_24h_fp?: string;
  open_interest_fp?: string;
  liquidity_dollars?: string;
  yes_bid_size_fp?: string;
  yes_ask_size_fp?: string;
  rules_primary?: string;
  rules_secondary?: string;
  close_time?: string;
  expiration_time?: string;
  expected_expiration_time?: string;
  open_time?: string;
  settlement_timer_seconds?: number;
  tick_size?: number;
  strike_type?: string;
  floor_strike?: string | number;
  cap_strike?: string | number;
}

export interface KalshiEvent {
  event_ticker: string;
  series_ticker: string;
  title: string;
  sub_title?: string;
  category: string;
  mutually_exclusive?: boolean;
  last_updated_ts?: string;
  markets?: KalshiMarket[];
}

export interface KalshiEventsResponse {
  events: KalshiEvent[];
  cursor?: string;
  milestones?: unknown[];
}

export interface KalshiMarketsResponse {
  markets: KalshiMarket[];
  cursor?: string;
}

export interface KalshiMarketResponse {
  market: KalshiMarket;
}

export interface KalshiOrderBookFp {
  yes_dollars?: [string, string][];
  no_dollars?: [string, string][];
}

export interface KalshiOrderBookResponse {
  orderbook_fp?: KalshiOrderBookFp;
}

export interface KalshiBidAskOhlc {
  open_dollars: string;
  high_dollars: string;
  low_dollars: string;
  close_dollars: string;
}

export interface KalshiMarketCandlestick {
  end_period_ts: number;
  yes_bid: KalshiBidAskOhlc;
  yes_ask: KalshiBidAskOhlc;
  volume_fp: string;
  open_interest_fp: string;
}

export interface KalshiCandlesticksResponse {
  ticker: string;
  candlesticks: KalshiMarketCandlestick[];
}

export interface KalshiTrade {
  trade_id: string;
  ticker: string;
  yes_price_dollars: string;
  no_price_dollars: string;
  count_fp: string;
  taker_side: "yes" | "no";
  created_time?: string;
}

export interface KalshiTradesResponse {
  trades: KalshiTrade[];
  cursor: string;
}

export interface KalshiEventResponse {
  event: KalshiEvent;
  markets: KalshiMarket[];
}

/** Enriched row for dashboard tables */
export interface MarketRow {
  ticker: string;
  title: string;
  category: string;
  eventTitle: string;
  seriesTicker: string;
  eventTicker: string;
  market: KalshiMarket;
}
