import { IsEnum, IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryUserDto {
  @IsString()
  @IsOptional()
  search?: string; // busca en fullName y email

  @IsEnum(['SUPER_ADMIN', 'ADMIN', 'STAFF', 'GUEST'])
  @IsOptional()
  role?: string;

  @IsEnum(['true', 'false'])
  @IsOptional()
  isActive?: string; // viene como string desde query param

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 10;
}
