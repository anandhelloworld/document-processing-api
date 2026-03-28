import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { Job as JobEntity, JobStatus } from '../database/entities/job.entity';
import { readFile } from 'fs/promises';
import { CreateJobDto } from './dto/create-job.dto';
import { S3StorageService } from '../storage/s3-storage.service';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @InjectRepository(JobEntity)
    private readonly jobRepository: Repository<JobEntity>,

    @InjectQueue('document-processing')
    private readonly documentQueue: Queue,

    private readonly s3Storage: S3StorageService,
  ) {}

  async createJob(
    createJobDto: CreateJobDto,
    file?: Express.Multer.File,
  ): Promise<JobEntity> {
    let storedObjectKey: string;
    if (file) {
      const buffer = file.buffer
        ? file.buffer
        : file.path
          ? await readFile(file.path)
          : null;
      if (!buffer?.length) {
        throw new BadRequestException(
          'Uploaded file is empty or could not be read — use memory storage or ensure Multer wrote the file.',
        );
      }
      storedObjectKey = await this.s3Storage.addFile(
        buffer,
        file.originalname,
        file.mimetype,
      );
    } else if (createJobDto.fileUrl) {
      try {
        const url = new URL(createJobDto.fileUrl);
        const pathTail =
          url.pathname.split('/').filter(Boolean).pop() ?? 'remote';
        storedObjectKey = await this.s3Storage.addFileFromUrl(
          createJobDto.fileUrl,
          pathTail,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new BadRequestException(`Failed to fetch or store fileUrl: ${msg}`);
      }
    } else {
      throw new BadRequestException(
        'Please provide either a file upload or a fileUrl',
      );
    }

    const job = new JobEntity();
    job.originalFileName = file ? file.originalname : 'url-submission';
    job.fileUrl = createJobDto.fileUrl ?? null;
    job.storedObjectKey = storedObjectKey;
    job.webhookUrl = createJobDto.webhookUrl ?? null;
    job.status = JobStatus.QUEUED;
    job.retryCount = 0;

    const savedJob = await this.jobRepository.save(job);
    this.logger.log(`Job created: ${savedJob.id}`);

    await this.documentQueue.add(
      'process-document',
      {
        jobId: savedJob.id,
        webhookUrl: savedJob.webhookUrl,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 3000,
        },
      },
    );

    this.logger.log(`Job ${savedJob.id} added to queue`);
    return savedJob;
  }

  async getJobById(id: string): Promise<JobEntity> {
    const job = await this.jobRepository.findOne({ where: { id } });
    if (!job) {
      throw new NotFoundException(`Job ${id} not found`);
    }
    return job;
  }

  async getAllJobs(status?: JobStatus): Promise<JobEntity[]> {
    if (status) {
      return this.jobRepository.find({
        where: { status: status as any },
      });
    }
    return this.jobRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async updateJobStatus(
    id: string,
    status: JobStatus,
    result?: object,
    errorMessage?: string,
  ): Promise<void> {
    const update: any = { status };

    if (status === JobStatus.PROCESSING) {
      update.processingStartedAt = new Date();
    }

    if (status === JobStatus.COMPLETED || status === JobStatus.FAILED) {
      update.completedAt = new Date();
    }

    if (result) update.result = result;
    if (errorMessage) update.errorMessage = errorMessage;

    await this.jobRepository.update(id, update);
    this.logger.log(`Job ${id} status updated to ${status}`);
  }
}
