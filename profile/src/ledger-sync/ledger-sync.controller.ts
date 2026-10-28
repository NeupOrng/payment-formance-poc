import { Body, Controller, HttpCode, Logger, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { LedgerSyncService } from './ledger-sync.service.js';

type Posting = { source: string; destination: string };
type LedgerEvent = {
  type?: string;
  payload?: {
    transactions?: { postings?: Posting[] }[];
    revertTransaction?: { postings?: Posting[] };
  };
};

@ApiTags('stocks')
@Controller()
export class LedgerSyncController {
  private readonly logger = new Logger(LedgerSyncController.name);

  constructor(private readonly sync: LedgerSyncService) {}

  /** Formance HTTP publisher webhook (COMMITTED_TRANSACTIONS, REVERTED_TRANSACTION). */
  @ApiExcludeEndpoint()
  @Post('ledger-events')
  @HttpCode(204)
  async ledgerEvent(@Body() event: LedgerEvent) {
    const postings = [
      ...(event.payload?.transactions ?? []).flatMap((t) => t.postings ?? []),
      ...(event.payload?.revertTransaction?.postings ?? []),
    ];
    const addresses = [...new Set(postings.flatMap((p) => [p.source, p.destination]))];
    if (!addresses.length) return;
    try {
      await this.sync.refreshAddresses(addresses);
    } catch (err) {
      // Answering with an error makes Formance retry the event later.
      this.logger.warn(`balance sync failed: ${(err as Error).message}`);
      throw err;
    }
  }

  /** Recompute one stock's balances from the ledger (e.g. after missing events). */
  @Post('stocks/:id/refresh')
  refresh(@Param('id', ParseUUIDPipe) id: string) {
    return this.sync.refresh(id);
  }
}
