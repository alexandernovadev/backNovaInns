import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { NovaAiService } from './nova-ai.service';

@Module({
  controllers: [AssistantController],
  providers: [AssistantService, NovaAiService],
})
export class AssistantModule {}
