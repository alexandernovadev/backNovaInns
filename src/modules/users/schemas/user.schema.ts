import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({
    type: {
      email: { type: String, required: true, unique: true, lowercase: true },
      passwordHash: { type: String, required: true },
      role: { type: String, enum: ['SUPER_ADMIN', 'ADMIN', 'STAFF', 'GUEST'], default: 'STAFF' },
    },
    required: true,
    _id: false,
  })
  auth!: {
    email: string;
    passwordHash: string;
    role: 'SUPER_ADMIN' | 'ADMIN' | 'STAFF' | 'GUEST';
  };

  @Prop({
    type: {
      fullName: { type: String, required: true },
      phone: { type: String, required: true },
      identificationNumber: { type: String },
      avatarUrl: { type: String },
    },
    required: true,
    _id: false,
  })
  profile!: {
    fullName: string;
    phone: string;
    identificationNumber?: string;
    avatarUrl?: string;
  };

  @Prop({
    type: {
      assignedApartments: [{ type: 'ObjectId', ref: 'Apartment' }],
      lastLogin: { type: Date },
      isActive: { type: Boolean, default: true },
    },
    _id: false,
  })
  workContext!: {
    assignedApartments: any[];
    lastLogin: Date;
    isActive: boolean;
  };

  @Prop({
    type: {
      language: { type: String, enum: ['es', 'pt', 'en'], default: 'es' },
      notificationsEnabled: { type: Boolean, default: true },
    },
    _id: false,
  })
  preferences!: {
    language: 'es' | 'pt' | 'en';
    notificationsEnabled: boolean;
  };
}

export const UserSchema = SchemaFactory.createForClass(User);
