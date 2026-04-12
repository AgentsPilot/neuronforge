export class SchemaAwareDataExtractor {
  extract(data: any, schema: any): any { return {}; }
}

export const schemaExtractor = {
  async extractArray(data: any, _plugin?: string, _action?: string): Promise<any[]> {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      const firstArray = Object.values(data).find(v => Array.isArray(v));
      return (firstArray as any[]) ?? [];
    }
    return [];
  },
};

export function analyzeOutputSchema(_schema: any): {
  primaryArrayField: string | null;
  is2DArray: boolean;
  nestedWrapper: 'fields' | 'properties' | 'data' | null;
  itemType: 'object' | 'array' | 'primitive' | 'unknown';
} {
  return { primaryArrayField: null, is2DArray: false, nestedWrapper: null, itemType: 'unknown' };
}
