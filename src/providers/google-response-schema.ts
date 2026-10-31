import type { ResponseFormat } from '../gateway/chat-parameters.ts';
import { DirectProviderFailure } from '../routing/invoke-jev-managed-route.ts';

function invalid(): never {
  throw new DirectProviderFailure('other', false, false);
}
function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** Conservative transport subset, not a generated-output validator. Input is already captured. */
export function validateGoogleResponseSchema(format: ResponseFormat): void {
  if (format.type !== 'json_schema') return;
  const { schema, strict } = format.json_schema;
  if (strict !== false || !schema || schema.type !== 'object') invalid();
  const visit = (node: unknown, depth: number): void => {
    if (!record(node) || depth > 16) invalid();
    if (
      typeof node.type !== 'string' ||
      !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(node.type) ||
      Object.keys(node).some(
        (key) =>
          ![
            'type',
            'title',
            'description',
            'properties',
            'required',
            'additionalProperties',
            'items',
          ].includes(key),
      ) ||
      (node.title !== undefined && typeof node.title !== 'string') ||
      (node.description !== undefined && typeof node.description !== 'string')
    )
      invalid();
    if (node.type === 'object') {
      if (node.items !== undefined) invalid();
      if (node.properties !== undefined && !record(node.properties)) invalid();
      const properties = node.properties ?? {};
      if (!record(properties)) invalid();
      for (const child of Object.values(properties)) visit(child, depth + 1);
      if (node.required !== undefined) {
        if (
          !Array.isArray(node.required) ||
          new Set(node.required).size !== node.required.length ||
          node.required.some(
            (key: unknown) => typeof key !== 'string' || !Object.hasOwn(properties, key),
          )
        )
          invalid();
      }
      if (node.additionalProperties !== undefined && typeof node.additionalProperties !== 'boolean')
        invalid();
    } else {
      if (
        node.properties !== undefined ||
        node.required !== undefined ||
        node.additionalProperties !== undefined
      )
        invalid();
      if (node.type === 'array') visit(node.items, depth + 1);
      else if (node.items !== undefined) invalid();
    }
  };
  visit(schema, 0);
}
