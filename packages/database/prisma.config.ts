import { defineConfig } from 'prisma/config';

// Prisma 7 : l'URL de la base est fournie ici et non dans schema.prisma.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://tontine:tontine@localhost:5432/tontinemoney',
  },
});
