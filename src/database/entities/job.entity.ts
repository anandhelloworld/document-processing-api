import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';


export enum JobStatus {
    QUEUED = 'queued',
    PROCESSING = 'processing',
    COMPLETED = 'completed',
    FAILED = 'failed',
}
@Entity('jobs')
export class Job {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    originalFileName: string;

    @Column({ type: 'varchar', nullable: true })
    fileUrl: string | null;

    @Column({ default: 0 })
    retryCount: number;

    @Column({ type: 'enum', enum: JobStatus, default: JobStatus.QUEUED })
    status: JobStatus;

    @Column({ type: 'varchar', nullable: true })
    webhookUrl: string | null;

    /** S3 object key for the document (multipart upload or copy from fileUrl). */
    @Column({ type: 'varchar', nullable: true })
    storedObjectKey: string | null;

    @Column({ type: 'jsonb', nullable: true })
    result: object;

    @Column({ nullable: true })
    errorMessage: string;

    @CreateDateColumn()
    createdAt: Date

    @Column({ nullable: true })
    processingStartedAt: Date;          

    @Column({ nullable: true })
    completedAt: Date;                

    @UpdateDateColumn()
    updatedAt: Date;
}
