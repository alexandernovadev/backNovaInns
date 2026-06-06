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

export class CreateExpenseDto {
  @IsString()
  description!: string;

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsEnum(ExpenseCategory)
  category!: ExpenseCategory;

  @IsDateString()
  date!: string;

  @IsString()
  paymentMethod!: string;

  @IsMongoId()
  @IsOptional()
  apartmentId?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
