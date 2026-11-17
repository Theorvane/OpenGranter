import type { CatalogModel } from './catalog-client.ts';
import type { CatalogElement } from './catalog-view.ts';

/** Already-decoded publication only. No calculations, HTML, URLs or authority. */
export function renderPublishedModelDetails(root: CatalogElement, model: CatalogModel) {
  const element = (tag: string, text?: string) => {
    const node = root.ownerDocument.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const scalar = (value: string | number | null | undefined) =>
    value === undefined
      ? 'Not published'
      : value === null
        ? 'Unknown'
        : value === ''
          ? 'Empty'
          : String(value);
  const labels = (value: readonly string[] | undefined) =>
    value === undefined
      ? 'Not published'
      : value.length === 0
        ? 'None published'
        : value.join(', ');
  const rows: readonly (readonly [string, string])[] = [
    ['Model ID', model.id],
    ['Published by', model.owned_by],
    ['Created (Unix seconds)', String(model.created)],
    ['Name', scalar(model.name)],
    ['Description', scalar(model.description)],
    ['Context length (tokens)', scalar(model.context_length)],
    ['Input modalities', labels(model.architecture?.input_modalities)],
    ['Output modalities', labels(model.architecture?.output_modalities)],
    ['Supported parameters', labels(model.supported_parameters)],
    ['Provider context length (tokens)', scalar(model.top_provider?.context_length)],
    ['Provider maximum output (tokens)', scalar(model.top_provider?.max_completion_tokens)],
    ['Prompt base price (USD/token)', scalar(model.pricing?.prompt)],
    ['Completion base price (USD/token)', scalar(model.pricing?.completion)],
  ];
  const details = element('dl');
  for (const [label, text] of rows) {
    const value = element('dd', text);
    // Preserve multiline published descriptions without interpreting markup.
    if (label === 'Description') value.setAttribute('style', 'white-space: pre-wrap');
    details.append(element('dt', label), value);
  }
  return [
    element(
      'p',
      'Published metadata only; not effective routing limits or guaranteed capabilities.',
    ),
    element('p', 'Published base prices only; not estimated or billed request costs.'),
    details,
  ];
}
