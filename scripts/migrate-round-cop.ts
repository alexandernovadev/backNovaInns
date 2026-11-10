import mongoose from 'mongoose';

// En Colombia no se usan centavos: los montos de una reserva se guardan en
// múltiplos de 100 COP. Esta migración trunca hacia abajo lo que ya está en la
// base (556.874 → 556.800) y recalcula el total como base + extras.
//
//   pnpm migrate:round-cop --dry   → muestra lo que cambiaría, no toca nada
//   pnpm migrate:round-cop         → aplica los cambios

const MONGODB_URI =
  process.env.MONGODB_URI ?? 'mongodb://localhost:27017/nova-inns';
const STEP = 100;

interface ExtraService {
  price?: number;
  quantity?: number;
  [key: string]: unknown;
}

interface Billing {
  basePrice?: number;
  totalAmount?: number;
  amountReceived?: number;
  extraServices?: ExtraService[];
}

interface BookingRow {
  _id: unknown;
  group?: { host?: { fullName?: string } };
  billing?: Billing;
}

const down = (n: number | undefined): number =>
  typeof n === 'number' && Number.isFinite(n)
    ? Math.floor(n / STEP) * STEP
    : 0;

async function migrate() {
  const dry = process.argv.includes('--dry');
  await mongoose.connect(MONGODB_URI);
  const col =
    mongoose.connection.db!.collection<BookingRow>('bookings');

  let checked = 0;
  let changed = 0;

  for await (const b of col.find({})) {
    checked++;
    const bill = b.billing;
    if (!bill) continue;

    const extraServices = (bill.extraServices ?? []).map((s) => ({
      ...s,
      price: down(s.price),
    }));
    const extras = extraServices.reduce(
      (sum, s) => sum + (s.price ?? 0) * (s.quantity ?? 1),
      0,
    );
    const basePrice = down(bill.basePrice);
    const amountReceived = down(bill.amountReceived);
    const totalAmount = basePrice + extras;

    const sinCambios =
      basePrice === bill.basePrice &&
      amountReceived === (bill.amountReceived ?? 0) &&
      totalAmount === bill.totalAmount &&
      extraServices.every(
        (s, i) => s.price === (bill.extraServices?.[i]?.price ?? 0),
      );
    if (sinCambios) continue;

    changed++;
    console.log(
      `${dry ? '[dry] ' : ''}${b.group?.host?.fullName ?? String(b._id)}: ` +
        `base ${bill.basePrice} → ${basePrice} · ` +
        `total ${bill.totalAmount} → ${totalAmount} · ` +
        `recibido ${bill.amountReceived ?? 0} → ${amountReceived}`,
    );

    if (!dry)
      await col.updateOne(
        { _id: b._id },
        {
          $set: {
            billing: { ...bill, basePrice, amountReceived, totalAmount, extraServices },
          },
        },
      );
  }

  console.log(
    `\n✅ Revisadas ${checked}, con cambios ${changed}` +
      (dry ? ' (no se aplicó nada, es --dry)' : ''),
  );
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error('❌ Error en migración:', err);
  process.exit(1);
});
