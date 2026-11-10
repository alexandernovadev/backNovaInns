// En Colombia el dinero se maneja en múltiplos de 100 COP: no se usan centavos.
// Lo que llega con decenas o unidades se trunca hacia abajo (556.874 → 556.800).
export const COP_STEP = 100;

export function roundCopDown(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.floor(value / COP_STEP) * COP_STEP;
}

export interface ExtraServiceAmount {
  price?: number;
  quantity?: number;
}

// Montos de billing que se redondean. Los demás campos (platform, status,
// paymentMethod) se copian tal cual en los objetos que devuelven estas funciones
export interface BillingAmounts {
  basePrice?: number;
  totalAmount?: number;
  amountReceived?: number;
  extraServices?: ExtraServiceAmount[];
}

const MONEY_PATHS: readonly string[] = [
  'billing.basePrice',
  'billing.totalAmount',
  'billing.amountReceived',
];
const EXTRAS_PATH = 'billing.extraServices';

function roundExtraServiceCop(service: ExtraServiceAmount): ExtraServiceAmount {
  if (typeof service?.price !== 'number') return service;
  return { ...service, price: roundCopDown(service.price) };
}

export interface MutableBillingAmounts {
  basePrice?: number;
  totalAmount?: number;
  amountReceived?: number;
  extraServices?: ExtraServiceAmount[] | null;
}

// Redondea en el sitio (mutando): es lo único que funciona con los
// subdocumentos de mongoose, que no se pueden expandir con spread
export function applyBillingCop(billing: MutableBillingAmounts): void {
  const { extraServices: extras } = billing;

  if (typeof billing.basePrice === 'number')
    billing.basePrice = roundCopDown(billing.basePrice);
  if (Array.isArray(extras))
    for (const s of extras)
      if (typeof s?.price === 'number') s.price = roundCopDown(s.price);
  if (typeof billing.amountReceived === 'number')
    billing.amountReceived = roundCopDown(billing.amountReceived);

  // El total de la app siempre es precio base + extras
  if (typeof billing.basePrice === 'number' && Array.isArray(extras)) {
    const total = extras.reduce(
      (sum, s) => sum + (s.price ?? 0) * (s.quantity ?? 1),
      0,
    );
    billing.totalAmount = billing.basePrice + total;
  } else if (typeof billing.totalAmount === 'number') {
    billing.totalAmount = roundCopDown(billing.totalAmount);
  }
}

// Copia de billing con los montos redondeados (para objetos planos: body HTTP,
// JSON de la IA, borrador de NovaAI)
export function roundBillingCop(billing: BillingAmounts): BillingAmounts {
  const b: BillingAmounts = { ...billing };
  applyBillingCop(b);
  return b;
}

type UpdateLike = { $set?: Record<string, unknown> } & Record<string, unknown>;

// Redondea el dinero dentro de un update de mongoose: acepta el objeto billing
// completo ($set.billing o replacement) o rutas punteadas ($set['billing.basePrice'])
export function roundBillingUpdateCop(update: any): any {
  if (!update || typeof update !== 'object') return update;
  const u = update as UpdateLike;
  const set = u.$set ?? u;

  const billing = set.billing as BillingAmounts | undefined;
  if (billing && typeof billing === 'object')
    set.billing = roundBillingCop(billing);

  for (const path of MONEY_PATHS)
    if (typeof set[path] === 'number') set[path] = roundCopDown(set[path]);

  const extras = set[EXTRAS_PATH];
  if (Array.isArray(extras))
    set[EXTRAS_PATH] = extras.map((s: ExtraServiceAmount) =>
      roundExtraServiceCop(s),
    );

  return update;
}

// Redondea el valor de un campo suelto de una reserva (lo usan los cambios
// que aplica NovaAI, que se guardan con colección cruda)
export function roundMoneyValueCop(field: string, value: unknown): unknown {
  if (MONEY_PATHS.includes(field))
    return typeof value === 'number' ? roundCopDown(value) : value;
  if (field === EXTRAS_PATH && Array.isArray(value))
    return (value as ExtraServiceAmount[]).map(roundExtraServiceCop);
  return value;
}
