/**
 * WebsiteAnalyzer
 * Scrapes and analyzes user's website to extract business information
 * Used to enrich business profile during onboarding
 */

import { createLogger } from '@/lib/logger';
import { getProviderFactory } from '@/lib/ai/providerFactory';

const logger = createLogger({ service: 'WebsiteAnalyzer' });

export interface WebsiteAnalysis {
  business_description: string;
  services: string[];
  target_audience: string;
  brand_voice: string; // 'professional', 'friendly', 'technical', etc.
  technology_stack: string[];
  conversion_points: string[]; // Contact forms, booking links, etc.
  seo_quality: 'high' | 'medium' | 'low';
  recommendations: string[];
}

export class WebsiteAnalyzer {
  private factory = getProviderFactory();

  /**
   * Analyze a website URL and extract structured information
   */
  async analyzeWebsite(url: string): Promise<{
    success: boolean;
    analysis?: WebsiteAnalysis;
    error?: string;
  }> {
    try {
      logger.info({ url }, 'Analyzing website');

      // Fetch website HTML
      const html = await this.fetchWebsiteHTML(url);

      if (!html) {
        return {
          success: false,
          error: 'Failed to fetch website content'
        };
      }

      // Use LLM to analyze the HTML content
      const analysis = await this.extractInformationWithLLM(html, url);

      logger.info({ url, seoQuality: analysis.seo_quality }, 'Website analyzed successfully');
      return { success: true, analysis };
    } catch (error) {
      logger.error({ err: error, url }, 'Failed to analyze website');
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Fetch website HTML content
   */
  private async fetchWebsiteHTML(url: string): Promise<string | null> {
    try {
      // Ensure URL has protocol
      const normalizedUrl = url.startsWith('http') ? url : `https://${url}`;

      logger.debug({ url: normalizedUrl }, 'Fetching website HTML');

      const response = await fetch(normalizedUrl, {
        headers: {
          'User-Agent': 'AgentPilot-BusinessOS/1.0 (Website Analyzer)'
        },
        // 10 second timeout
        signal: AbortSignal.timeout(10000)
      });

      if (!response.ok) {
        logger.warn({ url: normalizedUrl, status: response.status }, 'Website fetch failed');
        return null;
      }

      const html = await response.text();
      logger.debug({ url: normalizedUrl, htmlLength: html.length }, 'Website HTML fetched');

      return html;
    } catch (error) {
      logger.error({ err: error, url }, 'Failed to fetch website HTML');
      return null;
    }
  }

  /**
   * Extract business information from HTML using LLM
   */
  private async extractInformationWithLLM(html: string, url: string): Promise<WebsiteAnalysis> {
    // Clean and truncate HTML to fit in context window
    const cleanedHTML = this.cleanHTML(html);

    const provider = this.factory.getProvider('openai');
    const model = this.factory.getDefaultModel('openai');

    const extractionPrompt = `Analyze this business website and extract structured information.

Website URL: ${url}

HTML Content (cleaned):
${cleanedHTML}

Return ONLY a JSON object with these fields:
{
  "business_description": "1-2 sentence description of what this business does",
  "services": ["service 1", "service 2", "service 3"],
  "target_audience": "who this business serves",
  "brand_voice": "professional|friendly|technical|casual|formal",
  "technology_stack": ["tech 1", "tech 2"] (detected from HTML),
  "conversion_points": ["contact form at /contact", "booking link", etc.],
  "seo_quality": "high|medium|low" (based on meta tags, headings, structure),
  "recommendations": ["recommendation 1", "recommendation 2"] (up to 3 SEO/conversion improvements)
}`;

    const response = await provider.complete({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a website analysis assistant. Extract business information and return only valid JSON.'
        },
        {
          role: 'user',
          content: extractionPrompt
        }
      ],
      temperature: 0.1, // Low temperature for consistent extraction
      max_tokens: 800
    });

    const content = response.choices[0]?.message?.content || '{}';

    // Parse JSON response
    try {
      const analysis: WebsiteAnalysis = JSON.parse(content);
      return analysis;
    } catch (parseError) {
      logger.error({ err: parseError, content }, 'Failed to parse website analysis JSON');

      // Return a default analysis if parsing fails
      return {
        business_description: 'Unable to extract description',
        services: [],
        target_audience: 'Unknown',
        brand_voice: 'professional',
        technology_stack: [],
        conversion_points: [],
        seo_quality: 'medium',
        recommendations: ['Improve meta descriptions', 'Add clear call-to-action buttons']
      };
    }
  }

  /**
   * Clean HTML for LLM processing
   * Remove scripts, styles, and keep only relevant content
   */
  private cleanHTML(html: string): string {
    // Remove script tags
    let cleaned = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

    // Remove style tags
    cleaned = cleaned.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

    // Remove HTML comments
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');

    // Extract text content from key tags
    const titleMatch = cleaned.match(/<title[^>]*>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1] : '';

    const metaDescMatch = cleaned.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
    const metaDesc = metaDescMatch ? metaDescMatch[1] : '';

    // Extract headings
    const h1Matches = cleaned.match(/<h1[^>]*>(.*?)<\/h1>/gi) || [];
    const h2Matches = cleaned.match(/<h2[^>]*>(.*?)<\/h2>/gi) || [];

    // Extract body text (simplified - remove all tags)
    let bodyText = cleaned.replace(/<[^>]+>/g, ' ');
    bodyText = bodyText.replace(/\s+/g, ' ').trim();

    // Truncate to ~3000 characters to fit in context window
    bodyText = bodyText.substring(0, 3000);

    const result = `
Title: ${title}
Meta Description: ${metaDesc}
Headings (H1): ${h1Matches.join(', ').replace(/<[^>]+>/g, '')}
Headings (H2): ${h2Matches.join(', ').replace(/<[^>]+>/g, '')}
Content Preview: ${bodyText}
    `.trim();

    return result;
  }
}

// Singleton export
export const websiteAnalyzer = new WebsiteAnalyzer();
