import { describe, expect, it } from 'vitest';
import { checkPasswordPolicy } from './password';
import { decodeCursor, encodeCursor, buildPage } from './pagination';

describe('Politique de mot de passe (US-1.5)', () => {
  it('refuse les mots de passe simples', () => {
    expect(checkPasswordPolicy('123456').ok).toBe(false);
    expect(checkPasswordPolicy('Password1!').ok).toBe(false); // trop court
    expect(checkPasswordPolicy('alllowercase123!').ok).toBe(false);
  });

  it('accepte un mot de passe robuste', () => {
    expect(checkPasswordPolicy('Tontine#2026-Secure').ok).toBe(true);
  });
});

describe('Pagination par curseur', () => {
  it('encode et décode un curseur opaque', () => {
    const c = encodeCursor({ k: 'Dupont', id: 'abc' });
    expect(decodeCursor(c)).toEqual({ k: 'Dupont', id: 'abc' });
    expect(decodeCursor('pas-un-curseur')).toBeNull();
  });

  it('construit une page avec curseur suivant', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const page = buildPage(rows, 2, (r) => r.id);
    expect(page.items).toHaveLength(2);
    expect(decodeCursor(page.nextCursor)).toEqual({ k: 'b', id: 'b' });
    expect(buildPage(rows, 5, (r) => r.id).nextCursor).toBeNull();
  });
});
