import {
    Controller,
    Post,
    Get,
    Param,
    Query,
    UploadedFiles,
    UseInterceptors,
    Body,
    BadRequestException,
    Logger,
  } from '@nestjs/common';
  import { FilesInterceptor } from '@nestjs/platform-express';
  import { JobsService } from './jobs.service';
  import { CreateJobDto } from './dto/create-job.dto';
  import { JobStatus } from '../database/entities/job.entity';
  
  @Controller('api/jobs')
  export class JobsController {
    private readonly logger = new Logger(JobsController.name);
  
    constructor(private readonly jobsService: JobsService) {}
  
    // ─── POST /api/jobs/submit ─────────────────────────────────────
    // Client submits a document file OR a URL for processing
    @Post('submit')
    @UseInterceptors(FilesInterceptor('file', 10))
    async submitJob(
      @UploadedFiles() files: Express.Multer.File[],
      @Body() createJobDto: CreateJobDto,
    ) {
      if (files?.length > 1) {
        throw new BadRequestException(
          'Only one file is allowed per request. Submit additional documents as separate jobs.',
        );
      }

      const file = files?.[0];

      // Must provide either a file or a URL — not neither
      if (!file && !createJobDto.fileUrl) {
        throw new BadRequestException(
          'Please provide either a file upload or a fileUrl',
        );
      }
  
      this.logger.log(
        `Job submission received: ${file ? file.originalname : createJobDto.fileUrl}`,
      );
  
      const job = await this.jobsService.createJob(createJobDto, file);
  
      // Return immediately — client doesn't wait for processing
      return {
        success: true,
        message: 'Document submitted successfully, processing started',
        jobId: job.id,
        status: JobStatus.QUEUED,
        createdAt: job.createdAt,
      };
    }
  
    // ─── GET /api/jobs ─────────────────────────────────────────────
    // List all jobs, optionally filter by status
    // Example: GET /api/jobs?status=completed
    @Get()
    async listJobs(@Query('status') status?: JobStatus) {
      this.logger.log(`Listing jobs${status ? ` with status: ${status}` : ''}`);
      const jobs = await this.jobsService.getAllJobs(status);
  
      return {
        success: true,
        count: jobs.length,
        jobs,
      };
    }
  
    // ─── GET /api/jobs/:id ─────────────────────────────────────────
    // Get status + result of a specific job by ID
    // Client polls this endpoint to track progress
    @Get(':id')
    async getJob(@Param('id') id: string) {
      this.logger.log(`Fetching job: ${id}`);
      const job = await this.jobsService.getJobById(id);
  
      return {
        success: true,
        job: {
          id: job.id,
          status: job.status,
          originalFileName: job.originalFileName,
          fileUrl: job.fileUrl,
          storedObjectKey: job.storedObjectKey,
          retryCount: job.retryCount,
          result: job.result,
          errorMessage: job.errorMessage,
          timestamps: {
            createdAt: job.createdAt,
            processingStartedAt: job.processingStartedAt,
            completedAt: job.completedAt,
            updatedAt: job.updatedAt,
          },
        },
      };
    }
  }