// TODO: Implement universal extractor
export class UniversalExtractor {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isSupported(_mimeType: string, _filename?: string): boolean {
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async extract(_input: { content: string; mimeType: string; filename?: string }): Promise<{ success: boolean; text: string; error?: string }> {
    return { success: false, text: '', error: 'UniversalExtractor not implemented' };
  }
}
