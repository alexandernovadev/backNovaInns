import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SeedController } from './seed.controller';
import { SeedService } from './seed.service';
import { User, UserSchema } from '../users';

@Module({
  imports: [MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  controllers: [SeedController],
  providers: [SeedService],
})
export class SeedModule {}
