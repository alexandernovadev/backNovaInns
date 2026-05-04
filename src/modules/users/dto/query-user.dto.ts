import { IsEnum, IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Role } from '../../../shared/enums';

export class QueryUserDto {
  @IsString()
  @IsOptional()
  search?: string;

  @IsEnum(Role)
  @IsOptional()
  role?: string;

  @IsEnum(['true', 'false'])
  @IsOptional()
  isActive?: string;

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
