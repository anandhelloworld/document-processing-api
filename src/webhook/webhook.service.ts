import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
@Injectable()
export class WebhookService {
    private readonly logger = new Logger(WebhookService.name);


    async fire(webhookUrl: string | null, jobId: string, result: object): Promise<void> {
        if (!webhookUrl) return;
        try {
            // POST the job result back to the client's URL
            await axios.post(webhookUrl, {
                jobId,
                status: 'completed',
                result,
                timestamp: new Date().toISOString(),
            });

            this.logger.log(`Webhook fired successfully for job ${jobId}`);
        } catch (error) {
            // Webhook failure should NOT fail the job itself
            // Just log it and move on
            this.logger.error(
                `Webhook failed for job ${jobId}: ${error.message}`
            );
        }
    }
}