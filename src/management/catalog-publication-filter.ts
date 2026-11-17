import type { CatalogModel } from './catalog-client.ts';

export type PublicationField = 'input' | 'output' | 'parameter';
function labels(model: CatalogModel, field: PublicationField): readonly string[] {
  if (field === 'parameter') return model.supported_parameters ?? [];
  return (
    (field === 'input'
      ? model.architecture?.input_modalities
      : model.architecture?.output_modalities) ?? []
  );
}
/** Only the already-authorized publication; exact future labels are not normalized. */
export function publicationOptions(
  models: readonly CatalogModel[],
  field: PublicationField,
): readonly string[] {
  return [...new Set(models.flatMap((model) => [...labels(model, field)]))].sort();
}
export function matchesPublication(
  model: CatalogModel,
  selection: Readonly<Record<PublicationField, string>>,
): boolean {
  return (['input', 'output', 'parameter'] as const).every(
    (field) => selection[field] === '' || labels(model, field).includes(selection[field]),
  );
}
