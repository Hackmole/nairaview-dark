/* Shared domain types for Nairaview React islands. */

export interface ApiStock {
  symbol: string;
  name: string;
  current_price: number;
  previous_close?: number | null;
  change_percent?: number | null;
  official_change_percent?: number | null;
  volume?: number;
  market_cap?: number;
  sector?: string;
  trade_date?: string;
}

export interface PricesResponse {
  stocks: {
    stocks: ApiStock[];
    as_of?: string;
  };
  updated_at?: number;
}

/* Directory row shape shared with the vanilla site (assets/data.js). */
export interface DirectoryRow {
  s: string;
  c: string;
  g: string;
  p?: string;
  m?: string;
  d?: string;
  pv?: number | null;
  cv?: number | null;
  vol?: boolean;
  volNum?: number;
  mc?: number;
  noSnap?: boolean;
}

export interface HistoryPoint {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume?: number | null;
}

export interface HistoryResponse {
  prices?: HistoryPoint[];
  symbol?: string;
}

export interface Asipoint {
  date: string;
  value: number;
}

export interface AsiHistoryResponse {
  history?: Asipoint[];
  data?: Asipoint[];
}

export interface FxLegs {
  official: number;
  official_date?: string;
  parallel: number;
  parallel_updated_at?: string;
}

export interface FxHistoryPoint {
  date: string;
  official: number;
  parallel: number;
}

export interface FxDoc {
  latest?: Record<string, FxLegs>;
  history?: Record<string, FxHistoryPoint[]>;
  pulled_at?: string;
}

export interface Holding {
  ticker: string;
  shares: number;
  avg_cost: number;
}

declare global {
  interface Window {
    directory?: DirectoryRow[];
    nvBadgeHTML?: (sym: string, size?: string) => string;
    nvOpenModal?: (sym: string, opener?: Element | null) => void;
    NV_ISLANDS?: Record<string, boolean>;
    NVLivePrices?: Record<string, number>;
  }
}

export {};
