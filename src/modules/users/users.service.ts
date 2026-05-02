import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryUserDto } from './dto/query-user.dto';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async create(dto: CreateUserDto): Promise<UserDocument> {
    const exists = await this.userModel.findOne({ 'auth.email': dto.email });
    if (exists) throw new ConflictException('El email ya está registrado');

    const passwordHash = await bcrypt.hash(dto.password, 10);

    return new this.userModel({
      auth: { email: dto.email, passwordHash, role: dto.role ?? 'STAFF' },
      profile: { fullName: dto.fullName, phone: dto.phone, identificationNumber: dto.identificationNumber },
      workContext: { assignedApartments: [], isActive: true },
      preferences: { language: 'es', notificationsEnabled: true },
    }).save();
  }

  async findAll(query: QueryUserDto) {
    const { search, role, isActive, page = 1, limit = 10 } = query;
    const filter: Record<string, any> = {};

    if (search) {
      filter.$or = [
        { 'profile.fullName': { $regex: search, $options: 'i' } },
        { 'auth.email':       { $regex: search, $options: 'i' } },
      ];
    }

    if (role) filter['auth.role'] = role;
    if (isActive !== undefined) filter['workContext.isActive'] = isActive === 'true';

    const total = await this.userModel.countDocuments(filter);
    const data  = await this.userModel
      .find(filter)
      .select('-auth.passwordHash')
      .sort({ 'profile.fullName': 1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findById(id: string): Promise<UserDocument> {
    const user = await this.userModel.findById(id).select('-auth.passwordHash');
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserDocument> {
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('Usuario no encontrado');

    if (dto.fullName)            user.profile.fullName           = dto.fullName;
    if (dto.phone)               user.profile.phone              = dto.phone;
    if (dto.identificationNumber !== undefined) user.profile.identificationNumber = dto.identificationNumber;
    if (dto.role)                user.auth.role                  = dto.role;
    if (dto.language)            user.preferences.language       = dto.language;
    if (dto.isActive !== undefined) user.workContext.isActive     = dto.isActive;

    return user.save();
  }

  async remove(id: string): Promise<void> {
    const result = await this.userModel.findByIdAndDelete(id);
    if (!result) throw new NotFoundException('Usuario no encontrado');
  }

  async toggleActive(id: string): Promise<UserDocument> {
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('Usuario no encontrado');
    user.workContext.isActive = !user.workContext.isActive;
    return user.save();
  }
}
