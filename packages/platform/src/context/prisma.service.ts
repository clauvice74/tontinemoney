import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { type AppConfig } from '@tontine/config';
import { PrismaClient, prismaClientOptions } from '@tontine/database';
import { APP_CONFIG } from './tokens';

/** Client Prisma partagé (pool `pg`). */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const o = prismaClientOptions({ url: config.DATABASE_URL, poolSize: config.NODE_ENV === 'test' ? 5 : 20 });
    super({ adapter: o.adapter, log: [...o.log] });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
