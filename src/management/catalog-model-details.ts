import type { CatalogModel } from './catalog-client.ts';
import type { CatalogElement } from './catalog-view.ts';

/** Render only the client's validated, already-authorized publication.
 * No request, routing decision, price arithmetic or inference authority.
 */
export function renderCatalogModelDetails(root: CatalogElement, model: CatalogModel) {
  const element = (tag: string, text?: string) => {
    const node = root.ownerDocument.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const bound = (value: number | null | undefined) =>
    value === undefined ? 'Not published' : value === null ? 'Unknown' : String(value);
  const labels = (value: readonly string[] | undefined) =>
    value === undefined
      ? 'Not published'
      : value.length === 0
        ? 'None published'
        : value.join(', ');
  const details = element('dl');
  for (const [label, value] of [
    ['Model ID', model.id],
    ['Published by', model.owned_by],
    ['Created (Unix seconds)', String(model.created)],
    ['Name', model.name ?? 'Not published'],
    [
      'Description',
      model.description === '' ? 'Empty description' : (model.description ?? 'Not published'),
    ],
    ['Context length (tokens)', bound(model.context_length)],
    ['Published provider context (tokens)', bound(model.top_provider?.context_length)],
    ['Published maximum completion (tokens)', bound(model.top_provider?.max_completion_tokens)],
    ['Input modalities', labels(model.architecture?.input_modalities)],
    ['Output modalities', labels(model.architecture?.output_modalities)],
    ['Supported parameters', labels(model.supported_parameters)],
    ['Prompt base price (USD per token)', model.pricing?.prompt ?? 'Not published'],
    ['Completion base price (USD per token)', model.pricing?.completion ?? 'Not published'],
  ]) {
    details.append(element('dt', label), element('dd', value));
  }
  root.append(
    details,
    element(
      'p',
      'Administrator-published information only: bounds are not enforced quotas; listed modalities and parameters are not a capability guarantee. Base prices are not billed costs or invoice totals.',
    ),
  );
}
