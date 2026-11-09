// Distancia geográfica y helpers de fechas del Tracker.

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Lista de noches de una estadía: checkOut es exclusivo.
export function nightsBetween(checkIn: string, checkOut: string): string[] {
  const start = new Date(`${checkIn}T12:00:00.000Z`);
  const end = new Date(`${checkOut}T12:00:00.000Z`);
  const out: string[] = [];
  for (
    let d = new Date(start);
    d < end;
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000)
  ) {
    out.push(toIsoDate(d));
  }
  return out;
}

export function nightsCount(checkIn: string, checkOut: string): number {
  const start = new Date(`${checkIn}T12:00:00.000Z`).getTime();
  const end = new Date(`${checkOut}T12:00:00.000Z`).getTime();
  return Math.round((end - start) / (24 * 60 * 60 * 1000));
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}
