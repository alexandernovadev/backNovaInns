import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { Role, Language } from '../../../shared/enums';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({
    type: {
      email: { type: String, required: true, unique: true, lowercase: true },
      passwordHash: { type: String, required: true },
      role: { type: String, enum: Object.values(Role), default: Role.STAFF },
    },
    required: true,
    _id: false,
  })
  auth!: {
    email: string;
    passwordHash: string;
    role: Role;
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
      language: { type: String, enum: Object.values(Language), default: Language.ES },
      notificationsEnabled: { type: Boolean, default: true },
    },
    _id: false,
  })
  preferences!: {
    language: Language;
    notificationsEnabled: boolean;
  };
}

export const UserSchema = SchemaFactory.createForClass(User);
