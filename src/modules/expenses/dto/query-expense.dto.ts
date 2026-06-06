import {
  IsOptional,
  IsString,
  IsEnum,
  IsDateString,
  IsInt,
  Min,
  IsMongoId,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ExpenseCategory } from '../../../shared/enums';

export class QueryExpenseDto {
  @IsString()
  @IsOptional()
  search?: string;

  @IsEnum(ExpenseCategory)
  @IsOptional()
  category?: ExpenseCategory;

  @IsDateString()
  @IsOptional()
  fromDate?: string;

  @IsDateString()
  @IsOptional()
  toDate?: string;

  @IsMongoId()
  @IsOptional()
  apartmentId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 20;
}
