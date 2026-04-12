export class VisionContentBuilder {
  static hasImageContent(_params: any): boolean {
    return false;
  }

  static async extractImageContentAsync(_params: any): Promise<any[]> {
    return [];
  }

  static extractNonImageData(params: any): any {
    return params;
  }

  static buildVisionContent(textPrompt: string, images: any[], _detail: 'low' | 'high' = 'low'): any[] {
    return [...images, { type: 'text', text: textPrompt }];
  }
}
