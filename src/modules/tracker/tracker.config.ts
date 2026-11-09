// Configuración base del Tracker de competencia.
// El compset se valida contra el casco urbano de Zipaquirá; todo lo que caiga
// fuera del radio se descarta para que no contamine la mediana del mercado.

export const ZIPAQUIRA = {
  name: 'Zipaquirá',
  lat: 5.0221,
  lng: -74.0048,
};

export const TRACKER_DEFAULTS = {
  radiusKm: 5,
  maxNights: 30,
  maxGuests: 16,
  concurrency: 3,
  cacheMinutes: 30,
};

export type TrackerMode = 'demo' | 'live';
