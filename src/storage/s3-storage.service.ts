import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { basename } from 'path';
import { Readable } from 'stream';

@Injectable()
export class S3StorageService {
  private readonly logger = new Logger(S3StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    const region = this.config.get<string>('AWS_REGION') ?? 'us-east-1';
    const endpoint = this.config.get<string>('AWS_S3_ENDPOINT');
    this.bucket = this.config.get<string>('AWS_S3_BUCKET') ?? '';
    this.client = new S3Client({
      region,
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
  }

  private ensureBucket(): void {
    if (!this.bucket) {
      throw new Error(
        'AWS_S3_BUCKET is not set — configure S3 to store uploaded documents.',
      );
    }
  }

  private sanitizeFileName(name: string): string {
    const base = basename(name)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 200);
    return base || 'file';
  }

  private buildObjectKey(originalName: string): string {
    return `jobs/${randomUUID()}/${this.sanitizeFileName(originalName)}`;
  }

  /** Upload bytes; returns the object key. */
  async addFile(
    buffer: Buffer,
    originalName: string,
    contentType?: string,
  ): Promise<string> {
    this.ensureBucket();
    const key = this.buildObjectKey(originalName);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ...(contentType ? { ContentType: contentType } : {}),
      }),
    );
    this.logger.log(`Uploaded object s3://${this.bucket}/${key}`);
    return key;
  }

  /** Download a URL and store it in the bucket; returns the object key. */
  async addFileFromUrl(url: string, suggestedName: string): Promise<string> {
    this.ensureBucket();
    const res = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      maxContentLength: 100 * 1024 * 1024,
      maxBodyLength: 100 * 1024 * 1024,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    const buffer = Buffer.from(res.data);
    const contentType =
      (res.headers['content-type'] as string | undefined)?.split(';')[0] ||
      'application/octet-stream';
    return this.addFile(buffer, suggestedName, contentType);
  }

  /** Read an object by key. */
  async getFile(key: string): Promise<Buffer> {
    this.ensureBucket();
    const out = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    return this.bodyToBuffer(out.Body);
  }

  /** Remove an object by key (idempotent: succeeds if key does not exist). */
  async deleteFile(key: string): Promise<void> {
    this.ensureBucket();
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    this.logger.log(`Deleted object s3://${this.bucket}/${key}`);
  }

  private async bodyToBuffer(body: unknown): Promise<Buffer> {
    if (!body) return Buffer.alloc(0);
    if (Buffer.isBuffer(body)) return body;
    if (body instanceof Uint8Array) return Buffer.from(body);
    const stream = body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
