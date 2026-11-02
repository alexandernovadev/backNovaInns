import { Module } from '@nestjs/common';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { NovaAiService } from './nova-ai.service';
import { NovaAiTools } from './nova-ai.tools';

@Module({
  controllers: [AssistantController],
  providers: [AssistantService, NovaAiService, NovaAiTools],
})
export class AssistantModule {}
