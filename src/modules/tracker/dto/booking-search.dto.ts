import { IsDateString, IsInt, Max, Min } from 'class-validator';

export class BookingSearchDto {
  @IsDateString() checkIn!: string;
  @IsDateString() checkOut!: string;
  @IsInt() @Min(1) @Max(16) adults = 4;
  @IsInt() @Min(0) @Max(10) children = 1;
  @IsInt() @Min(0) @Max(17) childAge = 4;
}
