import { JobStatus } from '../../database/entities/job.entity';

export class JobResponseDto {
  id: string;                    // unique job ID
  status: JobStatus;             // queued | processing | completed | failed
  originalFileName: string;      // name of the file submitted
  fileUrl: string;               // URL if submitted via URL
  retryCount: number;            // how many retries happened
  result: object;                // mock result (only when completed)
  errorMessage: string;          // error details (only when failed)
  webhookUrl: string;            // callback URL if provided
  createdAt: Date;               // when job was created
  processingStartedAt: Date;     // when worker picked it up
  completedAt: Date;             // when job finished
  updatedAt: Date;               // last update time
}