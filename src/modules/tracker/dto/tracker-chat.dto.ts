import {
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class TrackerChatTurnDto {
  @IsString()
  role!: 'user' | 'assistant';

  @IsString()
  text!: string;
}

export class TrackerChatDto {
  @IsString()
  @MaxLength(2000)
  message!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TrackerChatTurnDto)
  history?: TrackerChatTurnDto[];

  // Contexto armado desde localStorage del navegador:
  // { current, previousSameSearch, recentSnapshots, diff }
  @IsOptional()
  context?: Record<string, unknown>;
}
