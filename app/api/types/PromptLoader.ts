import fs from 'fs';
import path from 'path';

/**
 * PromptLoader - A utility class for loading and managing AI prompt templates from text files.
 *
 * This class handles loading prompt templates from the file system and provides
 * functionality to replace keywords/placeholders with actual values.
 *
 * @example
 * const loader = new PromptLoader('my-prompt');
 * const prompt = loader.getPrompt();
 * const customized = loader.replaceKeywords({ name: 'John', role: 'developer' });
 */
export class PromptLoader {
  private aiPrompt: string = '';
  private fileName: string;
  private fileLocation: string;
  private isDebugMode: boolean;

  /**
   * Creates an instance of PromptLoader and automatically loads the prompt file.
   *
   * @param fileName - The name of the prompt file (with or without .txt extension)
   * @param fileLocation - Optional custom directory path. Defaults to /app/api/prompt-templates
   *
   * @throws Error if the file cannot be loaded
   *
   * @example
   * // Using default location
   * const loader = new PromptLoader('welcome-prompt');
   *
   * // Using custom location
   * const loader = new PromptLoader('custom-prompt', '/custom/path');
   */
  constructor(
    fileName: string,
    fileLocation: string = path.join(process.cwd(), 'app', 'api', 'prompt-templates')
  ) {
    // Initialize debug mode based on environment
    this.isDebugMode = process.env.NODE_ENV === 'development';

    if (this.isDebugMode) {
      console.log(`[PromptLoader] Initializing loader for file: ${fileName}`);
    }

    // Ensure .txt extension is present
    this.fileName = fileName.endsWith('.txt') ? fileName : `${fileName}.txt`;
    this.fileLocation = fileLocation;

    if (this.isDebugMode) {
      console.log(`[PromptLoader] File location: ${this.fileLocation}`);
    }

    // Load the prompt file immediately upon instantiation
    this.loadPrompt();
  }

  /**
   * Loads the prompt file from the file system into the aiPrompt property.
   * This method is called automatically by the constructor.
   *
   * @private
   * @throws Error if the file cannot be read or doesn't exist
   */
  private loadPrompt(): void {
    try {
      const filePath = path.join(this.fileLocation, this.fileName);

      if (this.isDebugMode) {
        console.log(`[PromptLoader] Loading prompt from: ${filePath}`);
      }

      this.aiPrompt = fs.readFileSync(filePath, 'utf-8').trim();

      if (this.isDebugMode) {
        console.log(`[PromptLoader] Successfully loaded prompt (${this.aiPrompt.length} characters)`);
      }
    } catch (error) {
      console.error(`[PromptLoader] Failed to load prompt file: ${error}`);
      throw new Error(`Failed to load prompt file: ${error}`);
    }
  }

  /**
   * Retrieves the loaded prompt template as-is without any modifications.
   *
   * @returns The raw prompt string loaded from the file
   *
   * @example
   * const loader = new PromptLoader('greeting');
   * const rawPrompt = loader.getPrompt();
   * console.log(rawPrompt);
   */
  public getPrompt(): string {
    if (this.isDebugMode) {
      console.log(`[PromptLoader] Retrieving prompt for file: ${this.fileName}`);
    }
    return this.aiPrompt;
  }

  /**
   * Replaces keywords/placeholders in the prompt with provided values.
   * Supports both {{keyword}} and {keyword} placeholder patterns.
   *
   * @param keywords - An object containing key-value pairs where keys are placeholder names
   *                   and values are the replacement strings
   * @returns A new string with all matched placeholders replaced
   *
   * @example
   * const loader = new PromptLoader('user-greeting');
   * // If template contains: "Hello {{name}}, your role is {role}"
   * const result = loader.replaceKeywords({
   *   name: 'Alice',
   *   role: 'Admin'
   * });
   * // Result: "Hello Alice, your role is Admin"
   */
  public replaceKeywords(keywords: Record<string, string>): string {
    if (this.isDebugMode) {
      console.log(`[PromptLoader] Replacing keywords in prompt:`, Object.keys(keywords));
    }

    let result = this.aiPrompt;
    let replacementCount = 0;

    for (const [key, value] of Object.entries(keywords)) {
      // Support both {{keyword}} and {keyword} patterns
      const regex = new RegExp(`\\{\\{${key}\\}\\}|\\{${key}\\}`, 'g');
      const matches = result.match(regex);

      if (matches) {
        replacementCount += matches.length;
        result = result.replace(regex, value);

        if (this.isDebugMode) {
          console.log(`[PromptLoader] Replaced ${matches.length} occurrence(s) of {${key}} with "${value}"`);
        }
      } else {
        if (this.isDebugMode) {
          console.log(`[PromptLoader] Warning: Keyword {${key}} was not found in the prompt and was not replaced`);
        }
      }
    }

    if (this.isDebugMode) {
      console.log(`[PromptLoader] Total replacements made: ${replacementCount}`);
    }

    return result;
  }
}
