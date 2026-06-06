import {
  IsString,
  IsNumber,
  IsEnum,
  IsDateString,
  IsOptional,
  IsMongoId,
  Min,
} from 'class-validator';
import { ExpenseCategory } from '../../../shared/enums';

export class UpdateExpenseDto {
  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  amount?: number;

  @IsEnum(ExpenseCategory)
  @IsOptional()
  category?: ExpenseCategory;

  @IsDateString()
  @IsOptional()
  date?: string;

  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @IsMongoId()
  @IsOptional()
  apartmentId?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
