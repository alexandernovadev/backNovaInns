import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/nova-inns';

async function migrate() {
  await mongoose.connect(MONGODB_URI);
  const db = mongoose.connection.db!;

  const result = await db.collection('bookings').updateMany(
    { 'billing.extraServices.type': { $in: ['CAR', 'MOTORCYCLE'] } },
    [
      {
        $set: {
          'billing.extraServices': {
            $map: {
              input: '$billing.extraServices',
              as: 'svc',
              in: {
                $mergeObjects: [
                  '$$svc',
                  { type: 'PARKING', vehicleType: '$$svc.type' },
                ],
              },
            },
          },
        },
      },
    ],
  );

  console.log(`✅ Migradas ${result.modifiedCount} reservas`);
  console.log(`📦 Coincidieron ${result.matchedCount} documentos`);

  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error('❌ Error en migración:', err);
  process.exit(1);
});
