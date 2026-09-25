import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type TxClient, isRetryableTransactionError } from '@tontine/database';
import { PrismaService } from './prisma.service';

export type IsolationLevel = 'ReadCommitted' | 'RepeatableRead' | 'Serializable';

export interface TransactionOptions {
  isolationLevel?: IsolationLevel;
  /** Nombre de rejeux sur conflit de sérialisation / interblocage (R-TRX-05). */
  retries?: number;
  timeoutMs?: number;
}

/** Exécute une unité de travail transactionnelle avec rejeu borné sur conflit. */
@Injectable()
export class UnitOfWork {
  private readonly logger = new Logger(UnitOfWork.name);

  constructor(private readonly prisma: PrismaService) {}

  async run<T>(fn: (tx: TxClient) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    const retries = options.retries ?? (options.isolationLevel === 'Serializable' ? 5 : 0);
    let attempt = 0;
    for (;;) {
      try {
        return await this.prisma.$transaction(fn, {
          isolationLevel:
            Prisma.TransactionIsolationLevel[options.isolationLevel ?? 'ReadCommitted'],
          timeout: options.timeoutMs ?? 15_000,
          maxWait: 10_000,
        });
      } catch (error) {
        if (attempt < retries && isRetryableTransactionError(error)) {
          attempt++;
          const delay = Math.min(200, 10 * 2 ** attempt) + Math.floor(Math.random() * 20);
          this.logger.debug(`Conflit transactionnel, rejeu ${attempt}/${retries} dans ${delay} ms`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw error;
      }
    }
  }
}
