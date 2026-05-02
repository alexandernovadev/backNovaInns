import { IsEnum, IsString, IsOptional, IsBoolean } from 'class-validator';

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

  @IsEnum(['SUPER_ADMIN', 'ADMIN', 'STAFF', 'GUEST'])
  @IsOptional()
  role?: 'SUPER_ADMIN' | 'ADMIN' | 'STAFF' | 'GUEST';

  @IsEnum(['es', 'pt', 'en'])
  @IsOptional()
  language?: 'es' | 'pt' | 'en';

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
