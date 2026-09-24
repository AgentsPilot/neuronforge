/**
 * WebsiteAutoBuildService
 * Auto-builds website from business profile using LLM to generate personalized content
 * Selects best template and populates all blocks with custom content
 */

import { createLogger } from '@/lib/logger';
import { getProviderFactory } from '@/lib/ai/providerFactory';
import { getTemplatesByVertical, type WebsiteTemplate } from '@/lib/website-builder/templates';
import type { BuildingBlock } from '@/lib/website-builder/building-blocks';
import type { Locale } from '@/lib/i18n/config';

const logger = createLogger({ service: 'WebsiteAutoBuildService' });

export interface BusinessProfileData {
  vertical: string;
  sub_vertical?: string;
  company_name?: string;
  services: string[];
  clients_per_week?: number;
  tools: string[];
  website_url?: string;
  website_analysis?: {
    business_description?: string;
    target_audience?: string;
    brand_voice?: string;
  };
}

export interface GeneratedWebsiteContent {
  template_id: string;
  template_name: string;
  page_title: string;
  meta_description: string;
  blocks: BuildingBlock[];
  theme: {
    primary_color: string;
    secondary_color: string;
    font_family: string;
    brand_voice: string;
  };
}

export class WebsiteAutoBuildService {
  private factory = getProviderFactory();

  /**
   * Auto-build complete website from business profile
   */
  async buildWebsite(
    profile: BusinessProfileData,
    locale: Locale = 'en'
  ): Promise<{
    success: boolean;
    website?: GeneratedWebsiteContent;
    error?: string;
  }> {
    try {
      logger.info({ vertical: profile.vertical, locale }, 'Auto-building website');

      // 1. Select best template based on profile
      const template = this.selectTemplate(profile);

      logger.info({ templateId: template.id, templateName: template.name }, 'Template selected');

      // 2. Generate personalized content for all blocks using LLM
      const generatedBlocks = await this.generateBlockContent(template, profile, locale);

      // 3. Generate page metadata
      const metadata = await this.generatePageMetadata(profile, locale);

      const website: GeneratedWebsiteContent = {
        template_id: template.id,
        template_name: template.name,
        page_title: metadata.title,
        meta_description: metadata.description,
        blocks: generatedBlocks,
        theme: template.theme
      };

      logger.info({ templateId: template.id, blocksCount: generatedBlocks.length }, 'Website built successfully');

      return { success: true, website };
    } catch (error) {
      logger.error({ err: error, vertical: profile.vertical }, 'Failed to build website');
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Select best template based on business profile
   * Uses heuristics based on sub_vertical, brand_voice, and business characteristics
   */
  private selectTemplate(profile: BusinessProfileData): WebsiteTemplate {
    const templates = getTemplatesByVertical(profile.vertical);

    if (templates.length === 0) {
      throw new Error(`No templates found for vertical: ${profile.vertical}`);
    }

    // If we have website analysis with brand voice, match it
    const brandVoice = profile.website_analysis?.brand_voice;
    if (brandVoice) {
      const match = templates.find(t => t.theme.brand_voice === brandVoice);
      if (match) {
        logger.debug({ templateId: match.id, reason: 'brand_voice_match' }, 'Template selected');
        return match;
      }
    }

    // Match based on sub_vertical
    if (profile.sub_vertical) {
      const subVerticalKeywords: Record<string, string[]> = {
        trauma: ['trauma', 'ptsd', 'specialized'],
        executive: ['executive', 'leadership', 'professional'],
        wellness: ['wellness', 'mindfulness', 'holistic'],
        career: ['career', 'job', 'transition'],
        tech: ['tech', 'technology', 'it', 'cloud'],
        marketing: ['marketing', 'growth', 'digital'],
        financial: ['financial', 'finance', 'investment']
      };

      for (const [key, keywords] of Object.entries(subVerticalKeywords)) {
        if (keywords.some(kw => profile.sub_vertical?.toLowerCase().includes(kw))) {
          const match = templates.find(t => t.id.includes(key));
          if (match) {
            logger.debug({ templateId: match.id, reason: 'sub_vertical_match' }, 'Template selected');
            return match;
          }
        }
      }
    }

    // Default: Return first template (usually the most versatile)
    logger.debug({ templateId: templates[0].id, reason: 'default_first' }, 'Template selected');
    return templates[0];
  }

  /**
   * Generate personalized content for all blocks using LLM
   */
  private async generateBlockContent(
    template: WebsiteTemplate,
    profile: BusinessProfileData,
    locale: Locale
  ): Promise<BuildingBlock[]> {
    const provider = this.factory.getProvider('openai');
    const model = this.factory.getDefaultModel('openai');

    // Build context for LLM
    const context = this.buildProfileContext(profile);

    // Generate content for all blocks in a single LLM call for consistency
    const systemPrompt = this.getSystemPrompt(locale);
    const userPrompt = this.buildContentGenerationPrompt(template, profile, locale);

    logger.debug({ blocksCount: template.blocks.length }, 'Generating content for blocks');

    const response = await provider.complete({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7, // Balance between creativity and consistency
      max_tokens: 3000
    });

    const content = response.choices[0]?.message?.content || '{}';

    // Parse LLM response
    let generatedContent: Record<string, any>;
    try {
      generatedContent = JSON.parse(content);
    } catch (parseError) {
      logger.error({ err: parseError, content }, 'Failed to parse LLM response');
      throw new Error('Failed to parse generated content');
    }

    // Map generated content to blocks
    const personalizedBlocks = template.blocks.map((block, idx) => {
      const blockContent = generatedContent[`block_${idx}`] || block.content;

      return {
        ...block,
        content: {
          ...block.content,
          ...blockContent
        }
      };
    });

    logger.info({ blocksCount: personalizedBlocks.length }, 'Block content generated');
    return personalizedBlocks;
  }

  /**
   * Build profile context for LLM
   */
  private buildProfileContext(profile: BusinessProfileData): string {
    const parts: string[] = [];

    parts.push(`Vertical: ${profile.vertical}`);
    if (profile.sub_vertical) parts.push(`Specialization: ${profile.sub_vertical}`);
    if (profile.company_name) parts.push(`Business Name: ${profile.company_name}`);
    if (profile.services.length > 0) parts.push(`Services: ${profile.services.join(', ')}`);
    if (profile.clients_per_week) parts.push(`Client Volume: ~${profile.clients_per_week} per week`);
    if (profile.website_analysis?.business_description) {
      parts.push(`Description: ${profile.website_analysis.business_description}`);
    }
    if (profile.website_analysis?.target_audience) {
      parts.push(`Target Audience: ${profile.website_analysis.target_audience}`);
    }

    return parts.join('\n');
  }

  /**
   * Get system prompt for content generation based on locale
   */
  private getSystemPrompt(locale: Locale): string {
    const prompts = {
      en: `You are a professional website copywriter creating personalized, compelling content for business websites.

Your role:
- Write clear, persuasive copy that resonates with the target audience
- Match the brand voice and tone specified in the template
- Keep content concise and scannable (short paragraphs, bullet points)
- Use active voice and benefit-focused language
- Avoid clichés and generic phrases
- Make every word count

Always return valid JSON matching the exact structure requested.`,

      es: `Eres un redactor profesional de sitios web que crea contenido personalizado y convincente para sitios web de negocios.

Tu rol:
- Escribir textos claros y persuasivos que resuenen con la audiencia objetivo
- Coincidir con la voz y el tono de marca especificados en la plantilla
- Mantener el contenido conciso y escaneable (párrafos cortos, viñetas)
- Usar voz activa y lenguaje enfocado en beneficios
- Evitar clichés y frases genéricas
- Hacer que cada palabra cuente

Siempre devuelve JSON válido que coincida exactamente con la estructura solicitada.`,

      he: `אתה כותב תוכן מקצועי לאתרי אינטרנט שיוצר תוכן מותאם אישית ומשכנע לאתרי עסקים.

תפקידך:
- לכתוב טקסט ברור ומשכנע שמהדהד עם קהל היעד
- להתאים את הקול והטון של המותג המצוינים בתבנית
- לשמור על תוכן תמציתי וניתן לסריקה (פסקאות קצרות, נקודות)
- להשתמש בקול פעיל ובשפה ממוקדת יתרונות
- להימנע מקלישאות וביטויים גנריים
- לגרום לכל מילה להיות חשובה

תמיד החזר JSON תקין התואם בדיוק את המבנה המבוקש.`
    };

    return prompts[locale];
  }

  /**
   * Build content generation prompt
   */
  private buildContentGenerationPrompt(
    template: WebsiteTemplate,
    profile: BusinessProfileData,
    locale: Locale
  ): string {
    const context = this.buildProfileContext(profile);

    const prompt = `Generate personalized website content for this business:

${context}

Template: ${template.name} (${template.theme.brand_voice} voice)

Generate content for the following blocks. Return ONLY a JSON object with keys "block_0", "block_1", etc.

${template.blocks.map((block, idx) => this.getBlockPrompt(block, idx, profile)).join('\n\n')}

Requirements:
- Use the business name "${profile.company_name || 'the practice'}" naturally throughout
- Reference the specific services: ${profile.services.join(', ')}
- Write in ${locale === 'en' ? 'English' : locale === 'es' ? 'Spanish' : 'Hebrew'}
- Match the ${template.theme.brand_voice} brand voice
- Keep all content professional and persuasive
- Use the exact field names from each block's current content structure

Return ONLY valid JSON with NO additional text.`;

    return prompt;
  }

  /**
   * Get prompt for specific block type
   */
  private getBlockPrompt(block: BuildingBlock, idx: number, profile: BusinessProfileData): string {
    const prompts: Record<string, string> = {
      hero: `block_${idx} (Hero):
- headline: Compelling headline (max 60 chars)
- subheadline: Supporting text (max 100 chars)
- cta_text: Call-to-action button text (max 25 chars)`,

      services: `block_${idx} (Services):
- title: Section title
- subtitle: Optional subtitle
- services: Array of { name, description, price (optional) } for each service: ${profile.services.join(', ')}`,

      testimonials: `block_${idx} (Testimonials):
- title: Section title
- testimonials: Array of 2-3 realistic { quote, author, role } testimonials for ${profile.vertical}`,

      about: `block_${idx} (About):
- title: Section title (e.g., "About Me", "Our Story")
- content: 2-3 paragraphs about the business/practitioner (150-200 words)`,

      contact_form: `block_${idx} (Contact Form):
- title: Form section title
- Keep all other fields as-is`,

      pricing: `block_${idx} (Pricing):
- title: Pricing section title
- subtitle: Supporting text
- plans: Array of 2-3 pricing tiers with { name, price, features (array of 3-5 features) }`,

      faq: `block_${idx} (FAQ):
- title: FAQ section title
- faqs: Array of 4-6 { question, answer } pairs relevant to ${profile.vertical}`,

      cta: `block_${idx} (CTA):
- title: Compelling call-to-action headline
- description: Supporting text (1-2 sentences)
- button_text: Button text`,

      features: `block_${idx} (Features):
- title: Features section title
- subtitle: Optional subtitle
- features: Array of 3-4 { title, description } key benefits/features`,

      stats: `block_${idx} (Stats):
- title: Stats section title (if needed)
- stats: Array of 3-4 { value, label, description (optional) } impressive numbers`,

      process: `block_${idx} (Process):
- title: Process section title
- subtitle: Optional subtitle
- steps: Array of 3-5 { title, description } process steps`,

      booking_widget: `block_${idx} (Booking):
- title: Booking section title
- subtitle: Supporting text`,

      payment_button: `block_${idx} (Payment):
- Keep content as-is (will be customized per service)`,

      team: `block_${idx} (Team):
- title: Team section title
- members: Array of { name, role, bio } for team members`,

      newsletter: `block_${idx} (Newsletter):
- title: Newsletter signup title
- description: Benefits of subscribing (1 sentence)`,

      video: `block_${idx} (Video):
- title: Video section title (optional)
- description: Video description (1 sentence)`,

      gallery: `block_${idx} (Gallery):
- title: Gallery section title`,

      logo_cloud: `block_${idx} (Logo Cloud):
- title: "Trusted By" or similar`,

      default: `block_${idx} (${block.block_type}):
- Generate appropriate content for this block type`
    };

    return prompts[block.block_type] || prompts.default;
  }

  /**
   * Generate page metadata
   */
  private async generatePageMetadata(
    profile: BusinessProfileData,
    locale: Locale
  ): Promise<{ title: string; description: string }> {
    const provider = this.factory.getProvider('openai');
    const model = this.factory.getDefaultModel('openai');

    const prompt = `Generate SEO-optimized page metadata for this business:

Business: ${profile.company_name || profile.vertical}
Vertical: ${profile.vertical}
Services: ${profile.services.join(', ')}
${profile.website_analysis?.target_audience ? `Target Audience: ${profile.website_analysis.target_audience}` : ''}

Generate in ${locale === 'en' ? 'English' : locale === 'es' ? 'Spanish' : 'Hebrew'}:

Return ONLY a JSON object:
{
  "title": "Page title (max 60 chars, include business name and main service)",
  "description": "Meta description (max 160 chars, compelling and keyword-rich)"
}`;

    const response = await provider.complete({
      model,
      messages: [
        { role: 'system', content: 'You are an SEO expert. Return only valid JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3, // Low temperature for SEO consistency
      max_tokens: 200
    });

    const content = response.choices[0]?.message?.content || '{}';

    try {
      const metadata = JSON.parse(content);
      return {
        title: metadata.title || `${profile.company_name || profile.vertical} - Professional Services`,
        description: metadata.description || `${profile.services.join(', ')} and more.`
      };
    } catch (parseError) {
      logger.error({ err: parseError, content }, 'Failed to parse metadata');
      return {
        title: `${profile.company_name || profile.vertical} - Professional Services`,
        description: `${profile.services.join(', ')} and more.`
      };
    }
  }
}

// Singleton export
export const websiteAutoBuildService = new WebsiteAutoBuildService();
