import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import {
  COMPETITOR_PLATFORMS,
  COMPETITOR_STATUSES,
} from '../schemas/competitor.schema';
import type {
  CompetitorPlatform,
  CompetitorStatus,
} from '../schemas/competitor.schema';

export class CreateCompetitorDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsIn(COMPETITOR_PLATFORMS)
  platform!: CompetitorPlatform;

  @IsString()
  @MinLength(8)
  url!: string;

  @IsOptional()
  @IsString()
  externalId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bedrooms?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(16)
  guests?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsIn(COMPETITOR_STATUSES)
  status?: CompetitorStatus;
}

export class UpdateCompetitorDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsIn(COMPETITOR_PLATFORMS)
  platform?: CompetitorPlatform;

  @IsOptional()
  @IsString()
  @MinLength(8)
  url?: string;

  @IsOptional()
  @IsString()
  externalId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bedrooms?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(16)
  guests?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsIn(COMPETITOR_STATUSES)
  status?: CompetitorStatus;
}
