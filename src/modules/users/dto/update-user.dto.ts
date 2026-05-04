import { IsEnum, IsString, IsOptional, IsBoolean } from 'class-validator';
import { Role, Language } from '../../../shared/enums';

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  fullName?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  identificationNumber?: string;

  @IsEnum(Role)
  @IsOptional()
  role?: Role;

  @IsEnum(Language)
  @IsOptional()
  language?: Language;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
