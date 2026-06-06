import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ExpenseCategory } from '../../../shared/enums';

export type ExpenseDocument = HydratedDocument<Expense>;

@Schema({ timestamps: true })
export class Expense {
  @Prop({ required: true })
  description!: string;

  @Prop({ required: true, min: 0 })
  amount!: number;

  @Prop({ required: true, enum: Object.values(ExpenseCategory) })
  category!: ExpenseCategory;

  @Prop({ required: true, type: Date })
  date!: Date;

  @Prop({ required: true })
  paymentMethod!: string;

  @Prop({ type: Types.ObjectId, ref: 'Apartment', default: null })
  apartmentId?: Types.ObjectId;

  @Prop({ default: '' })
  notes?: string;

  @Prop({
    type: {
      url: { type: String },
      publicId: { type: String },
    },
    default: null,
    _id: false,
  })
  receipt?: { url: string; publicId: string } | null;
}

export const ExpenseSchema = SchemaFactory.createForClass(Expense);
