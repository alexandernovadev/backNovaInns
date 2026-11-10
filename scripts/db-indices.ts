import mongoose from 'mongoose';
import { BookingSchema } from '../src/modules/bookings/schemas/booking.schema';
import { ExpenseSchema } from '../src/modules/expenses/schemas/expense.schema';
import { ApartmentSchema } from '../src/modules/apartments/schemas/apartment.schema';
import { AssistantActionSchema } from '../src/modules/assistant/schemas/assistant-action.schema';

// Construye los índices declarados en los schemas. En producción el app arranca
// con autoIndex: false, así que esto es paso obligatorio del deploy:
//   pnpm db:indices
const MONGODB_URI =
  process.env.MONGODB_URI ?? 'mongodb://localhost:27017/nova-inns';

const models: [string, mongoose.Schema][] = [
  ['Booking', BookingSchema],
  ['Expense', ExpenseSchema],
  ['Apartment', ApartmentSchema],
  ['AssistantAction', AssistantActionSchema],
];

async function main() {
  await mongoose.connect(MONGODB_URI);
  for (const [name, schema] of models) {
    const model = mongoose.models[name] ?? mongoose.model(name, schema);
    const created = await model.ensureIndexes();
    const indexes = await model.collection.listIndexes().toArray();
    console.log(`✅ ${name}: ${indexes.length} índices`);
    for (const idx of indexes)
      console.log(
        `   ${JSON.stringify(idx.key)}${idx.unique ? ' (único)' : ''}`,
      );
    void created;
  }
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌ Error creando índices:', err);
  process.exit(1);
});
