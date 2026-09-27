import { Body, type PipeTransform, Query, applyDecorators, Injectable } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { type ZodTypeAny, type z, ZodError, ZodObject, ZodEffects } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { DomainError } from '../errors/domain-error';

export function zodIssues(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((i) => ({ path: i.path.join('.') || '(racine)', message: i.message }));
}

/** Valide et transforme une entrée avec un schéma zod ; 400 VALIDATION_FAILED sinon. */
@Injectable()
export class ZodValidationPipe<S extends ZodTypeAny> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    const res = this.schema.safeParse(value ?? {});
    if (!res.success) {
      const issues = zodIssues(res.error);
      const code = issues.some((i) => i.message === 'Au moins un identifiant requis')
        ? 'MISSING_IDENTIFIER'
        : issues.some((i) => i.message === 'Format téléphone invalide')
          ? 'INVALID_PHONE'
          : issues.some((i) => i.message.startsWith('Le mot de passe ne respecte pas'))
            ? 'WEAK_PASSWORD'
            : issues.some((i) => i.message === 'Le motif est obligatoire')
              ? 'REASON_REQUIRED'
              : 'VALIDATION_FAILED';
      throw new DomainError(
        code,
        issues.map((i) => `${i.path} : ${i.message}`).join(' ; '),
        {},
        issues,
      );
    }
    return res.data;
  }
}

export function jsonSchemaOf(schema: ZodTypeAny): Record<string, unknown> {
  const json = zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' }) as Record<
    string,
    unknown
  >;
  delete json['$schema'];
  return json;
}

/** Corps validé par zod + documentation OpenAPI. */
export function ZodBody(schema: ZodTypeAny): ParameterDecorator {
  return Body(new ZodValidationPipe(schema));
}

/** Documente le corps attendu (à placer sur la méthode). */
export function ApiZodBody(schema: ZodTypeAny): MethodDecorator {
  return ApiBody({ schema: jsonSchemaOf(schema) });
}

/** Paramètres de requête validés par zod. */
export function ZodQuery(schema: ZodTypeAny): ParameterDecorator {
  return Query(new ZodValidationPipe(schema));
}

function unwrapObject(schema: ZodTypeAny): ZodObject<Record<string, ZodTypeAny>> | null {
  let s: ZodTypeAny = schema;
  while (s instanceof ZodEffects) s = s.innerType();
  return s instanceof ZodObject ? (s as ZodObject<Record<string, ZodTypeAny>>) : null;
}

/** Documente les paramètres de requête (à placer sur la méthode). */
export function ApiZodQuery(schema: ZodTypeAny): MethodDecorator {
  const obj = unwrapObject(schema);
  if (!obj) return applyDecorators();
  const decorators = Object.entries(obj.shape).map(([name, field]) =>
    ApiQuery({ name, required: !field.isOptional(), schema: jsonSchemaOf(field) as never }),
  );
  return applyDecorators(...decorators);
}
