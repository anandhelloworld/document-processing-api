# Async Document Processing API

A production-ready asynchronous document processing system built with NestJS, BullMQ, Redis, and PostgreSQL.

## Architecture
```
Client → NestJS API → S3-compatible storage (AWS S3 / MinIO)
         │                    ↑
         │              (upload bytes or fetch from fileUrl)
         ↓
    PostgreSQL (job row + storedObjectKey)
         ↓
    BullMQ Queue (Redis) → Worker → GetObject from S3 → process
                                         ↓
                               PostgreSQL + Webhook Callback
```

### Flow
1. Client submits a document (multipart file or `fileUrl` field) via `POST /api/jobs/submit`
2. API uploads the document to **S3** (or streams from `fileUrl` into S3), saves the job in PostgreSQL with `storedObjectKey`, `queued`, and returns `jobId` immediately
3. Job is pushed into BullMQ backed by Redis
4. Worker loads the file from S3 with `S3StorageService.getFile`, marks the job `processing`, and runs processing (currently simulated 10–20s)
5. On completion, result is saved to the DB and the webhook is fired to the client
6. Client polls `GET /api/jobs/:id` for status and result

Object storage is implemented in **`StorageModule`** via **`S3StorageService`**: `addFile`, `addFileFromUrl`, `getFile`, and `deleteFile`.

## Tech Stack

- **NestJS** — backend framework
- **BullMQ + Bull** — job queue and worker management
- **Redis** — queue backend (BullMQ storage)
- **PostgreSQL + TypeORM** — job persistence
- **Amazon S3 API** (`@aws-sdk/client-s3`) — document storage (AWS S3 or MinIO via `AWS_S3_ENDPOINT`)
- **Axios** — remote `fileUrl` fetch and webhook HTTP callbacks

## Prerequisites

- Node.js v18+
- PostgreSQL 15+
- Redis 7+
- S3-compatible bucket (AWS S3) and credentials

## Local Setup

### 1. Clone and install
```bash
git clone <your-repo-url>
cd doc-processing-api
npm install
```

### 2. Start Redis and PostgreSQL
```bash
# Mac
brew services start redis
brew services start postgresql@15

# Linux
sudo systemctl start redis
sudo systemctl start postgresql
```

### 3. Create database
```bash
psql -U postgres
CREATE DATABASE docprocessing;
\q
```

### 4. Configure environment
```bash
cp .env.example .env
```
Edit `.env` with your values (see `.env.example` for the full list):
```
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_NAME=docprocessing
REDIS_HOST=localhost
REDIS_PORT=6379

# Object storage (required for uploads)
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-bucket-name
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_ENDPOINT=http://localhost:9000
```

Create the bucket in S3 or MinIO before submitting jobs. For MinIO, use the console or `mc mb` so `AWS_S3_BUCKET` exists.

### 5. Run the app
```bash
npm run start:dev
```

App runs at `http://localhost:3000`

## API Reference

### Submit a job
```
POST /api/jobs/submit
Content-Type: multipart/form-data
```

Use **form fields** (same endpoint for both cases):

| Field | Required | Description |
|--------|-----------|-------------|
| `file` | One of `file` or `fileUrl` | Uploaded binary |
| `fileUrl` | One of `file` or `fileUrl` | HTTPS URL; server downloads and copies into S3 |
| `webhookUrl` | No | Called when the job completes |

Example (file): `file` + optional `webhookUrl`.  
Example (URL): `fileUrl` + optional `webhookUrl`.

Response:
```json
{
  "success": true,
  "message": "Document submitted successfully, processing started",
  "jobId": "2e2d717f-8e01-4051-9fba-9829cf12a597",
  "status": "queued",
  "createdAt": "2026-03-28T09:33:34.833Z"
}
```

### Get job status
```
GET /api/jobs/:id
```

Response:
```json
{
  "success": true,
  "job": {
    "id": "2e2d717f-...",
    "status": "completed",
    "originalFileName": "report.pdf",
    "fileUrl": null,
    "storedObjectKey": "jobs/<uuid>/report.pdf",
    "retryCount": 0,
    "result": {
      "wordCount": 5226,
      "pageCount": 14,
      "language": "English",
      "sentiment": "Neutral",
      "keywords": ["document", "processing", "async", "nestjs"],
      "summary": "Mock document analysis completed successfully."
    },
    "errorMessage": null,
    "timestamps": {
      "createdAt": "...",
      "processingStartedAt": "...",
      "completedAt": "...",
      "updatedAt": "..."
    }
  }
}
```

### List all jobs
```
GET /api/jobs
GET /api/jobs?status=queued
GET /api/jobs?status=processing
GET /api/jobs?status=completed
GET /api/jobs?status=failed
```

## Job States
```
queued → processing → completed
                   → failed (retried up to 3x with exponential backoff)
```

## Design Decisions

1. **NestJS over Express** — decorators, dependency injection, and modular structure make the codebase clean and maintainable at scale

2. **BullMQ + Redis** — chosen over in-memory queues because jobs survive server restarts, supports concurrent workers, and provides built-in retry with exponential backoff out of the box

3. **PostgreSQL over SQLite** — JSONB column for flexible result storage, production-grade reliability, and better support for concurrent writes from multiple workers

4. **Webhook is non-blocking** — webhook failure never affects job status. If the client's endpoint is down, the job still completes successfully

5. **Exponential backoff on retries** — 3s → 6s → 12s delays between retries to avoid hammering a temporarily failing resource

6. **synchronize: true** — used in development for auto table creation. In production this should be replaced with TypeORM migrations

7. **S3-compatible object storage** — binaries are not held in Redis or Postgres; the API writes to a bucket and the worker reads via `storedObjectKey`. Use real AWS S3 in production or MinIO locally (`AWS_S3_ENDPOINT`)

## Assumptions

- Document processing is simulated with a 10–20s random delay
- 20% of jobs randomly fail to demonstrate retry logic
- File content is stored in **S3** (key on the job row); Postgres holds metadata, status, and JSON results
- `deleteFile` exists on `S3StorageService` for future cleanup flows; completed jobs do not auto-delete objects by default
- Webhook delivery is best-effort (no retry on webhook failure)
