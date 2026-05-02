import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async create(dto: CreateUserDto): Promise<UserDocument> {
    const exists = await this.userModel.findOne({ 'auth.email': dto.email });
    if (exists) throw new ConflictException('El email ya está registrado');

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = new this.userModel({
      auth: { email: dto.email, passwordHash, role: dto.role ?? 'STAFF' },
      profile: { fullName: dto.fullName, phone: dto.phone, identificationNumber: dto.identificationNumber },
      workContext: { assignedApartments: [], isActive: true },
      preferences: { language: 'es', notificationsEnabled: true },
    });

    return user.save();
  }

  async findAll(): Promise<UserDocument[]> {
    return this.userModel.find().select('-auth.passwordHash');
  }

  async findById(id: string): Promise<UserDocument> {
    const user = await this.userModel.findById(id).select('-auth.passwordHash');
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  async toggleActive(id: string): Promise<UserDocument> {
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('Usuario no encontrado');
    user.workContext.isActive = !user.workContext.isActive;
    return user.save();
  }
}
