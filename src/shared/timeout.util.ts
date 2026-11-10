import { ServiceUnavailableException } from '@nestjs/common';

// Las llamadas a Gemini/Playwright pueden colgarse (el SDK no trae deadline).
// Sin esto, un request cuelgado deja el hilo de la UI esperando indefinidamente.
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new ServiceUnavailableException(
                `${label} tardó demasiado (${Math.round(ms / 1000)} s). Intenta de nuevo.`,
              ),
            ),
          ms,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Timeout configurable por entorno (GEMINI_TIMEOUT_MS, en segundos)
export function timeoutSeconds(
  value: string | undefined,
  fallback: number,
): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n * 1000 : fallback * 1000;
}
