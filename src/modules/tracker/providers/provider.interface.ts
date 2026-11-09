export interface QuoteInput {
  checkIn: string;
  checkOut: string;
  guests: number;
  nights: number;
}

export interface NightRate {
  date: string;
  price: number | null;
  available: boolean;
  minStay?: number;
}

// Forma mínima que necesita un provider: sirve tanto para un documento de
// Mongo como para los competidores sintéticos del modo demo.
export interface CompetitorLike {
  _id?: any;
  name: string;
  platform: string;
  url: string;
  externalId?: string;
  lat?: number;
  lng?: number;
}

export interface ProviderResult {
  competitorId?: string;
  competitorName: string;
  platform: string;
  url: string;
  synthetic?: boolean;
  status: 'ok' | 'blocked' | 'error';
  nights: NightRate[];
  avgNightly: number | null;
  available: boolean;
  minStay?: number;
  error?: string;
  source: string;
  raw?: unknown;
}

export interface TrackerProvider {
  readonly platform: string;
  quote(input: QuoteInput, competitor: CompetitorLike): Promise<ProviderResult>;
  dispose?(): Promise<void>;
}
