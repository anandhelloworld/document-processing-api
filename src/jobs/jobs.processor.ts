import { Process, Processor, OnQueueFailed, OnQueueActive } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { JobsService } from './jobs.service';
import { WebhookService } from '../webhook/webhook.service';
import { S3StorageService } from '../storage/s3-storage.service';
import { JobStatus } from '../database/entities/job.entity';

@Processor('document-processing')   // must match queue name in jobs.service.ts
export class JobsProcessor {
  private readonly logger = new Logger(JobsProcessor.name);

  constructor(
    private readonly jobsService: JobsService,
    private readonly webhookService: WebhookService,
    private readonly s3Storage: S3StorageService,
  ) {}

  // ─── MAIN WORKER ──────────────────────────────────────────────
  // This runs automatically when a job enters the queue
  @Process('process-document')      // must match job name in jobs.service.ts
  async handleProcessDocument(job: Job<{ jobId: string; webhookUrl: string | null }>) {
    const { jobId, webhookUrl } = job.data;
    this.logger.log(`Processing started for job ${jobId}`);

    const record = await this.jobsService.getJobById(jobId);
    if (!record.storedObjectKey) {
      throw new Error(`Job ${jobId} has no storedObjectKey (S3)`);
    }
    const fileBuffer = await this.s3Storage.getFile(record.storedObjectKey);
    this.logger.log(
      `Loaded document from S3 (${fileBuffer.byteLength} bytes) for job ${jobId}`,
    );

    // 1. Mark job as processing in DB
    await this.jobsService.updateJobStatus(jobId, JobStatus.PROCESSING);

    // 2. Simulate document processing (10–20 seconds delay)
    const delay = Math.floor(Math.random() * 10000) + 10000;
    this.logger.log(`Job ${jobId} will take ${delay / 1000}s to process`);
    await new Promise((resolve) => setTimeout(resolve, delay));

    // 3. Randomly fail 20% of the time to demonstrate retry logic
    if (Math.random() < 0.2) {
      throw new Error(`Simulated processing failure for job ${jobId}`);
    }

    // 4. Generate mock result (simulates what real processing would return)
    const result = {
      wordCount: Math.floor(Math.random() * 5000) + 500,
      pageCount: Math.floor(Math.random() * 20) + 1,
      language: 'English',
      sentiment: 'Neutral',
      keywords: ['document', 'processing', 'async', 'nestjs'],
      summary: 'Mock document analysis completed successfully.',
      processedAt: new Date().toISOString(),
    };

    // 5. Mark job as completed in DB with the result
    await this.jobsService.updateJobStatus(
      jobId,
      JobStatus.COMPLETED,
      result,
    );
    this.logger.log(`Job ${jobId} completed successfully`);

    // 6. Fire webhook callback to notify client
    await this.webhookService.fire(webhookUrl, jobId, result);
  }

  // ─── ON JOB ACTIVE ────────────────────────────────────────────
  // Fires when BullMQ picks up a job from the queue
  @OnQueueActive()
  onActive(job: Job) {
    this.logger.log(
      `Job ${job.data.jobId} is now active (attempt ${job.attemptsMade + 1}/3)`,
    );
  }

  // ─── ON JOB FAILED ────────────────────────────────────────────
  // Fires after ALL retries are exhausted
  @OnQueueFailed()
  async onFailed(job: Job, error: Error) {
    const { jobId } = job.data;
    this.logger.error(
      `Job ${jobId} failed after ${job.attemptsMade} attempts: ${error.message}`,
    );
  
    const maxAttempts = job.opts?.attempts ?? 3;
    if (job.attemptsMade >= maxAttempts) {
      await this.jobsService.updateJobStatus(
        jobId,
        JobStatus.FAILED,
        undefined,      // changed null to undefined
        error.message,
      );
    }
  }
}