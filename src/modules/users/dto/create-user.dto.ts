import { IsEmail, IsEnum, IsString, MinLength, IsOptional } from 'class-validator';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsEnum(['SUPER_ADMIN', 'ADMIN', 'STAFF', 'GUEST'])
  @IsOptional()
  role?: 'SUPER_ADMIN' | 'ADMIN' | 'STAFF' | 'GUEST';

  @IsString()
  fullName!: string;

  @IsString()
  phone!: string;

  @IsString()
  @IsOptional()
  identificationNumber?: string;
}
