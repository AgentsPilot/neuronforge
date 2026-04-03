// TODO: Implement universal extractor
export class UniversalExtractor {
  async extract(content: string, mimeType: string): Promise<{text: string; keyValuePairs?: any[]; tables?: any[]}> {
    return { text: '' };
  }
}
