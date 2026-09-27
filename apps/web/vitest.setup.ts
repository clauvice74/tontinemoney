import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { installFrenchZodErrors } from './src/lib/zod-fr';

installFrenchZodErrors();

afterEach(() => {
  cleanup();
});
