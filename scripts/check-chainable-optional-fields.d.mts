export interface SchemaOptionalFields {
  optionalFields: string[];
  nestedSchemaRefs: string[];
}
export function parseSchemaOptionalFields(text: string): Map<string, SchemaOptionalFields>;
