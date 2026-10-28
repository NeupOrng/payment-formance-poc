import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';
import { fileURLToPath } from 'node:url';
import { SagaActivitiesService } from './saga.activities.js';
import { TASK_QUEUE } from './types.js';

export const TEMPORAL_CLIENT = Symbol('TEMPORAL_CLIENT');

async function withRetry<T>(what: string, connect: () => Promise<T>): Promise<T> {
  const logger = new Logger('Temporal');
  for (let attempt = 1; ; attempt++) {
    try {
      return await connect();
    } catch (err) {
      if (attempt >= 30) throw err;
      logger.warn(`${what} not reachable yet (${(err as Error).message}), retrying`);
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
}

export const temporalClientProvider = {
  provide: TEMPORAL_CLIENT,
  inject: [ConfigService],
  useFactory: async (config: ConfigService) => {
    const address = config.get<string>('TEMPORAL_ADDRESS') ?? 'localhost:7233';
    const connection = await withRetry('Temporal client', () => Connection.connect({ address }));
    return new Client({ connection, namespace: config.get<string>('TEMPORAL_NAMESPACE') ?? 'default' });
  },
};

/**
 * Runs the Temporal worker (workflows + activities) inside the payment engine process. Set
 * RUN_WORKER=false to run API-only instances and scale workers separately.
 */
@Injectable()
export class TemporalWorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('TemporalWorker');
  private worker?: Worker;
  private running?: Promise<void>;

  constructor(
    private readonly config: ConfigService,
    private readonly activities: SagaActivitiesService,
    @Inject(TEMPORAL_CLIENT) private readonly client: Client,
  ) {}

  async onApplicationBootstrap() {
    if (this.config.get<string>('RUN_WORKER') === 'false') return;
    const address = this.config.get<string>('TEMPORAL_ADDRESS') ?? 'localhost:7233';
    const connection = await withRetry('Temporal worker', () => NativeConnection.connect({ address }));
    this.worker = await Worker.create({
      connection,
      namespace: this.client.options.namespace,
      taskQueue: TASK_QUEUE,
      workflowsPath: fileURLToPath(new URL('./workflows.js', import.meta.url)),
      activities: this.activities.activities(),
      // In-flight activities get a short grace period; Temporal re-runs anything cut off.
      shutdownGraceTime: '5 seconds',
    });
    this.running = this.worker.run();
    this.running.catch((err) => this.logger.error(`worker stopped: ${(err as Error).message}`));
    this.logger.log(`Worker polling task queue "${TASK_QUEUE}"`);
  }

  async onApplicationShutdown() {
    if (!this.worker) return;
    this.worker.shutdown();
    // Never let a stuck activity block a restart (e.g. hot reload); Temporal retries it elsewhere.
    await Promise.race([this.running?.catch(() => undefined), new Promise((r) => setTimeout(r, 10_000))]);
  }
}
