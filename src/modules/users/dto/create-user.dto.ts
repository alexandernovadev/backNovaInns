import { IsEmail, IsEnum, IsString, MinLength, IsOptional } from 'class-validator';
import { Role } from '../../../shared/enums';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsEnum(Role)
  @IsOptional()
  role?: Role;

  @IsString()
  fullName!: string;

  @IsString()
  phone!: string;

  @IsString()
  @IsOptional()
  identificationNumber?: string;
}
