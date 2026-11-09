// Tipos del dominio del Tracker compartidos entre el servicio que calcula
// las estadísticas y el servicio que las analiza (Gemini / determinista).

export interface TrackerNightStat {
  date: string;
  availableCount: number;
  prices: Record<string, number | null>;
  median: number | null;
  p25: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
}

export interface TrackerStats {
  competitorCount: number;
  availableCompetitors: number;
  failedCompetitors: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
  nights: TrackerNightStat[];
}

export interface OurReference {
  avgNightly: number | null;
  sampleSize: number;
  source: string;
}
