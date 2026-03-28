import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { JobsProcessor } from './jobs.processor';
import { Job } from '../database/entities/job.entity';
import { WebhookModule } from '../webhook/webhook.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    // Give this module access to the Job table in PostgreSQL
    TypeOrmModule.forFeature([Job]),

    // Register the BullMQ queue — same name used in service + processor
    BullModule.registerQueue({
      name: 'document-processing',
    }),

    // Import WebhookModule so WebhookService can be injected into processor
    WebhookModule,
    StorageModule,
  ],
  controllers: [JobsController],
  providers: [JobsService, JobsProcessor],
})
export class JobsModule {}