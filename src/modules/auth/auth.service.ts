import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument } from '../users';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.userModel.findOne({ 'auth.email': dto.email });
    if (!user) throw new UnauthorizedException('Credenciales inválidas');

    const passwordMatch = await bcrypt.compare(dto.password, user.auth.passwordHash);
    if (!passwordMatch) throw new UnauthorizedException('Credenciales inválidas');

    await this.userModel.updateOne(
      { _id: user._id },
      { 'workContext.lastLogin': new Date() },
    );

    const payload = {
      sub: user._id,
      email: user.auth.email,
      role: user.auth.role,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user._id,
        fullName: user.profile.fullName,
        email: user.auth.email,
        role: user.auth.role,
      },
    };
  }
}
