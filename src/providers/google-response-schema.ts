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
      (node.type !== undefined &&
        (typeof node.type !== 'string' ||
          !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(
            node.type,
          ))) ||
      Object.keys(node).some(
        (key) =>
          ![
            'anyOf',
            'type',
            'title',
            'description',
            'properties',
            'required',
            'additionalProperties',
            'items',
            'enum',
            'minimum',
            'maximum',
            'minItems',
            'maxItems',
          ].includes(key),
      ) ||
      (node.title !== undefined && typeof node.title !== 'string') ||
      (node.description !== undefined && typeof node.description !== 'string')
    )
      invalid();
    if (Object.hasOwn(node, 'anyOf')) {
      if (!Array.isArray(node.anyOf) || node.anyOf.length === 0 || node.anyOf.length > 16)
        invalid();
      for (const branch of node.anyOf) visit(branch, depth + 1);
    }
    if (node.type === undefined) {
      if (
        !Object.hasOwn(node, 'anyOf') ||
        Object.keys(node).some((key) => !['anyOf', 'title', 'description'].includes(key))
      )
        invalid();
      return;
    }
    for (const key of ['minimum', 'maximum']) {
      if (
        Object.hasOwn(node, key) &&
        (!['number', 'integer'].includes(node.type) ||
          typeof node[key] !== 'number' ||
          !Number.isFinite(node[key]))
      )
        invalid();
    }
    if (
      typeof node.minimum === 'number' &&
      typeof node.maximum === 'number' &&
      node.minimum > node.maximum
    )
      invalid();
    for (const key of ['minItems', 'maxItems']) {
      if (
        Object.hasOwn(node, key) &&
        (node.type !== 'array' ||
          typeof node[key] !== 'number' ||
          !Number.isSafeInteger(node[key]) ||
          node[key] < 0)
      )
        invalid();
    }
    if (
      typeof node.minItems === 'number' &&
      typeof node.maxItems === 'number' &&
      node.minItems > node.maxItems
    )
      invalid();
    if (Object.hasOwn(node, 'enum')) {
      const values = node.enum;
      if (
        !['string', 'number', 'integer'].includes(node.type) ||
        !Array.isArray(values) ||
        values.length === 0 ||
        values.length > 128 ||
        new Set(values).size !== values.length ||
        values.some((value: unknown) =>
          node.type === 'string'
            ? typeof value !== 'string'
            : typeof value !== 'number' ||
              !Number.isFinite(value) ||
              (node.type === 'integer' && !Number.isInteger(value)),
        )
      )
        invalid();
    }
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
      if (Object.hasOwn(node, 'additionalProperties')) {
        if (typeof node.additionalProperties !== 'boolean')
          visit(node.additionalProperties, depth + 1);
      }
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
