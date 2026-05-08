export class SchemaAwareDataExtractor {
  extract(data: any, schema: any): any {
    return {};
  }

  async extractArray(data: any, _plugin?: string, _action?: string): Promise<any[]> {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      const firstArray = Object.values(data).find(v => Array.isArray(v));
      return (firstArray as any[]) ?? [];
    }
    return [];
  }
}

// Export singleton instance for convenience
export const schemaExtractor = new SchemaAwareDataExtractor();

// Export utility function for analyzing output schemas
export function analyzeOutputSchema(data: any, schema?: any): any {
  // Stub implementation - analyze data structure against schema
  // This will be implemented when schema-aware extraction is needed
  return {
    matchesSchema: true,
    detectedType: typeof data,
    fields: data && typeof data === 'object' ? Object.keys(data) : []
  };
}
