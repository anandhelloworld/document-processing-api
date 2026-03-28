import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { Job as JobEntity } from '../database/entities/job.entity';
import { REDIS_CLIENT } from './redis.constants';

const JOB_CACHE_KEY_PREFIX = 'job:by-id:';
const JOB_CACHE_TTL_SEC = 300;

@Injectable()
export class RedisService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private jobCacheKey(id: string): string {
    return `${JOB_CACHE_KEY_PREFIX}${id}`;
  }

  async getCachedJob(id: string): Promise<JobEntity | null> {
    const raw = await this.redis.get(this.jobCacheKey(id));
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as JobEntity;
  }

  async setCachedJob(job: JobEntity): Promise<void> {
    await this.redis.setex(
      this.jobCacheKey(job.id),
      JOB_CACHE_TTL_SEC,
      JSON.stringify(job),
    );
  }

  async invalidateJobCache(id: string): Promise<void> {
    await this.redis.del(this.jobCacheKey(id));
  }
}
