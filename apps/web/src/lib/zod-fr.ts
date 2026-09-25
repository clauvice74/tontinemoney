import { type ParseParams, type ZodErrorMap, ZodIssueCode, z } from 'zod';

/**
 * Messages de validation zod en français (les schémas de `@tontine/contracts` ne précisent pas
 * toujours de message). Installé une fois au chargement de l'application.
 */
export const frenchErrorMap: ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null' || issue.received === 'nan') {
        return { message: 'Champ requis' };
      }
      if (issue.expected === 'integer') return { message: 'Nombre entier attendu' };
      if (issue.expected === 'number') return { message: 'Nombre attendu' };
      return { message: 'Valeur invalide' };
    case ZodIssueCode.too_small:
      if (issue.type === 'string') {
        return {
          message:
            issue.minimum === 1
              ? 'Champ requis'
              : `${String(issue.minimum)} caractères minimum`,
        };
      }
      if (issue.type === 'number') {
        return { message: `Valeur minimale : ${String(issue.minimum)}` };
      }
      if (issue.type === 'array') {
        return { message: `Sélectionnez au moins ${String(issue.minimum)} élément(s)` };
      }
      return { message: 'Valeur trop petite' };
    case ZodIssueCode.too_big:
      if (issue.type === 'string') {
        return { message: `${String(issue.maximum)} caractères maximum` };
      }
      if (issue.type === 'number') {
        return { message: `Valeur maximale : ${String(issue.maximum)}` };
      }
      return { message: 'Valeur trop grande' };
    case ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: 'Format email invalide' };
      if (issue.validation === 'uuid') return { message: 'Identifiant invalide' };
      if (issue.validation === 'regex') return { message: 'Format invalide' };
      return { message: 'Format invalide' };
    case ZodIssueCode.invalid_enum_value:
      return { message: 'Sélectionnez une valeur dans la liste' };
    case ZodIssueCode.invalid_literal:
      return { message: 'Valeur invalide' };
    case ZodIssueCode.unrecognized_keys:
      return { message: 'Champs non autorisés' };
    default:
      return { message: ctx.defaultError };
  }
};

/**
 * Options de parsing à passer à `zodResolver(schema, zodFr)`. La carte d'erreurs contextuelle
 * s'applique quel que soit l'exemplaire de zod ayant créé le schéma (le bundler peut charger
 * la version CommonJS pour `@tontine/contracts` et la version ESM pour l'application).
 */
export const zodFr: ParseParams = { errorMap: frenchErrorMap, path: [], async: false };

let installed = false;

export function installFrenchZodErrors(): void {
  if (installed) return;
  z.setErrorMap(frenchErrorMap);
  installed = true;
}
