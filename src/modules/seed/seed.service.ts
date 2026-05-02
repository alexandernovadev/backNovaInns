import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class SeedService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async run() {
    const exists = await this.userModel.findOne({ 'auth.email': 'admin@novainns.com' });
    if (exists) return { message: 'Seed ya ejecutado — usuario ya existe' };

    const passwordHash = await bcrypt.hash('nova1234', 10);

    await this.userModel.create({
      auth: { email: 'admin@novainns.com', passwordHash, role: 'SUPER_ADMIN' },
      profile: { fullName: 'Admin Nova', phone: '3001234567' },
      workContext: { assignedApartments: [], isActive: true },
      preferences: { language: 'es', notificationsEnabled: true },
    });

    return {
      message: 'Seed ejecutado',
      credentials: { email: 'admin@novainns.com', password: 'nova1234' },
    };
  }

  async clear() {
    await this.userModel.deleteMany({ 'auth.email': 'admin@novainns.com' });
    return { message: 'Seed eliminado' };
  }
}
