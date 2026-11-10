import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class QuoteDto {
  @IsDateString()
  checkIn!: string;

  @IsDateString()
  checkOut!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(16)
  guests!: number;

  /** salta la caché y raspa de nuevo */
  @IsOptional()
  @IsBoolean()
  refresh?: boolean;
}
