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
  if (strict !== false || !schema) invalid();
  const rootType = Array.isArray(schema.type)
    ? schema.type.find((member: unknown) => member !== 'null')
    : schema.type;
  if (
    !(
      rootType === undefined &&
      (Object.hasOwn(schema, 'anyOf') ||
        Object.hasOwn(schema, 'oneOf') ||
        Object.hasOwn(schema, '$ref'))
    ) &&
    (typeof rootType !== 'string' ||
      !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(rootType))
  )
    invalid();
  const definitions = schema.$defs;
  if (
    definitions !== undefined &&
    (!record(definitions) ||
      Object.keys(definitions).length === 0 ||
      Object.keys(definitions).length > 128 ||
      Object.keys(definitions).some((key) => !/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(key)))
  )
    invalid();
  const anchors = new Map<string, string>();
  const definitionNodes = new Set<unknown>();
  if (record(definitions)) {
    for (const [name, node] of Object.entries(definitions)) {
      definitionNodes.add(node);
      if (!record(node) || !Object.hasOwn(node, '$anchor')) continue;
      const anchor = node.$anchor;
      if (
        typeof anchor !== 'string' ||
        !/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(anchor) ||
        anchors.has(anchor)
      )
        invalid();
      anchors.set(anchor, name);
    }
  }
  let visits = 0;
  const activeReferences = new Set<string>();
  const visit = (node: unknown, depth: number): void => {
    if (!record(node) || depth > 16 || ++visits > 20_000) invalid();
    if (Object.hasOwn(node, '$defs') && node !== schema) invalid();
    if (Object.hasOwn(node, '$anchor') && !definitionNodes.has(node)) invalid();
    if (Object.hasOwn(node, '$ref')) {
      const ref = node.$ref;
      if (
        Object.keys(node).some(
          (key) =>
            key !== '$ref' &&
            !(key === '$anchor' && definitionNodes.has(node)) &&
            !(key === '$defs' && node === schema),
        ) ||
        typeof ref !== 'string' ||
        !/^#(?:\/\$defs\/[A-Za-z_][A-Za-z0-9_.-]{0,63}|[A-Za-z_][A-Za-z0-9_.-]{0,63})$/.test(ref) ||
        !record(definitions)
      )
        invalid();
      const name = ref.startsWith('#/$defs/') ? ref.slice(8) : anchors.get(ref.slice(1));
      if (name === undefined) invalid();
      if (!Object.hasOwn(definitions, name) || activeReferences.has(name)) invalid();
      activeReferences.add(name);
      try {
        visit(definitions[name], depth + 1);
      } finally {
        activeReferences.delete(name);
      }
      return;
    }
    let type = node.type;
    if (Array.isArray(type)) {
      if (type.length !== 2 || !type.includes('null') || type[0] === type[1]) invalid();
      type = type.find((member: unknown) => member !== 'null');
      if (type === undefined || type === 'null') invalid();
    }
    if (
      (type !== undefined &&
        (typeof type !== 'string' ||
          !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(type))) ||
      Object.keys(node).some(
        (key) =>
          ![
            '$defs',
            '$anchor',
            'anyOf',
            'oneOf',
            'type',
            'title',
            'description',
            'properties',
            'propertyOrdering',
            'required',
            'additionalProperties',
            'items',
            'prefixItems',
            'enum',
            'format',
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
    if (
      Object.hasOwn(node, 'format') &&
      (type !== 'string' || typeof node.format !== 'string' || node.format.length > 256)
    )
      invalid();
    if (Object.hasOwn(node, 'anyOf') && Object.hasOwn(node, 'oneOf')) invalid();
    for (const key of ['anyOf', 'oneOf']) {
      if (!Object.hasOwn(node, key)) continue;
      const branches = node[key];
      if (!Array.isArray(branches) || branches.length === 0 || branches.length > 16) invalid();
      for (const branch of branches) visit(branch, depth + 1);
    }
    if (type === undefined) {
      if (
        (!Object.hasOwn(node, 'anyOf') && !Object.hasOwn(node, 'oneOf')) ||
        Object.keys(node).some(
          (key) =>
            !['anyOf', 'oneOf', 'title', 'description', '$anchor'].includes(key) &&
            !(key === '$defs' && node === schema),
        )
      )
        invalid();
      return;
    }
    for (const key of ['minimum', 'maximum']) {
      if (
        Object.hasOwn(node, key) &&
        (!['number', 'integer'].includes(type) ||
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
        (type !== 'array' ||
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
    if (Object.hasOwn(node, 'prefixItems')) {
      if (
        type !== 'array' ||
        !Array.isArray(node.prefixItems) ||
        node.prefixItems.length === 0 ||
        node.prefixItems.length > 16
      )
        invalid();
      for (const child of node.prefixItems) visit(child, depth + 1);
    }
    if (Object.hasOwn(node, 'enum')) {
      const values = node.enum;
      if (
        !['string', 'number', 'integer'].includes(type) ||
        !Array.isArray(values) ||
        values.length === 0 ||
        values.length > 128 ||
        new Set(values).size !== values.length ||
        values.some((value: unknown) =>
          type === 'string'
            ? typeof value !== 'string'
            : typeof value !== 'number' ||
              !Number.isFinite(value) ||
              (type === 'integer' && !Number.isInteger(value)),
        )
      )
        invalid();
    }
    if (type === 'object') {
      if (node.items !== undefined) invalid();
      if (node.properties !== undefined && !record(node.properties)) invalid();
      const properties = node.properties ?? {};
      if (!record(properties)) invalid();
      for (const child of Object.values(properties)) visit(child, depth + 1);
      if (Object.hasOwn(node, 'propertyOrdering')) {
        const order = node.propertyOrdering;
        if (
          !Array.isArray(order) ||
          order.length > 128 ||
          new Set(order).size !== order.length ||
          order.some((key: unknown) => typeof key !== 'string' || !Object.hasOwn(properties, key))
        )
          invalid();
      }
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
        Object.hasOwn(node, 'propertyOrdering') ||
        node.properties !== undefined ||
        node.required !== undefined ||
        node.additionalProperties !== undefined
      )
        invalid();
      if (type === 'array') {
        if (Object.hasOwn(node, 'items') || !Object.hasOwn(node, 'prefixItems'))
          visit(node.items, depth + 1);
      } else if (node.items !== undefined) invalid();
    }
  };
  if (record(definitions)) {
    for (const child of Object.values(definitions)) visit(child, 1);
  }
  visit(schema, 0);
}
