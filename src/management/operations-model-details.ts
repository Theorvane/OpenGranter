import type { CatalogModel } from './catalog-client.ts';
import type { CatalogElement } from './catalog-view.ts';

/** Supplementary display of already-validated publication, never authority. */
export function appendOperationsModelDetails(root: CatalogElement, model: CatalogModel): void {
  const element = (tag: string, text?: string) => {
    const node = root.ownerDocument.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const bound = (value: number | null | undefined) =>
    value === undefined ? 'Not published' : value === null ? 'Unknown' : String(value);
  const labels = (value: readonly string[] | undefined) =>
    value === undefined ? 'Not published' : value.length ? value.join(', ') : 'None published';
  const section = element('section');
  section.setAttribute('aria-label', 'Published model information');
  const details = element('dl');
  for (const [label, value] of [
    ['Name', model.name ?? 'Not published'],
    ['Description', model.description ?? 'Not published'],
    ['Published context length (tokens)', bound(model.context_length)],
    ['Input modalities', labels(model.architecture?.input_modalities)],
    ['Output modalities', labels(model.architecture?.output_modalities)],
    ['Supported parameter labels', labels(model.supported_parameters)],
    ['Published provider context length (tokens)', bound(model.top_provider?.context_length)],
    ['Published maximum completion (tokens)', bound(model.top_provider?.max_completion_tokens)],
    ['Prompt base rate (USD/token)', model.pricing?.prompt ?? 'Not published'],
    ['Completion base rate (USD/token)', model.pricing?.completion ?? 'Not published'],
  ] as const) {
    details.append(element('dt', label), element('dd', value));
  }
  section.append(
    element('h2', 'Published model information'),
    element(
      'p',
      'Administrator-published information; not verified capability or routing authority. Bounds are not enforced quotas or invocation guarantees. Base rates are not billed costs, discounts or estimates for a request.',
    ),
    details,
  );
  root.append(section);
}
