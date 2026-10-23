import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LedgerPoster } from './ledger-poster.service.js';

/** Periodically retries outbox rows that could not be posted on the request path. */
@Injectable()
export class OutboxWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly poster: LedgerPoster,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    const interval = Number(this.config.get('OUTBOX_INTERVAL_MS') ?? 2_000);
    this.timer = setInterval(() => void this.tick(), interval);
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      while ((await this.poster.processDue()) > 0);
    } catch (err) {
      this.logger.error(`Outbox tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
