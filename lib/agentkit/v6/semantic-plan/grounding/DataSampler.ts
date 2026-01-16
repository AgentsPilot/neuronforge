/**
 * DataSampler - Validates assumptions against actual data
 *
 * Capabilities:
 * - Sample rows from data sources (Google Sheets, databases, APIs)
 * - Validate data types (string, number, date, email, boolean)
 * - Check value ranges and formats
 * - Detect patterns for inference
 * - Validate field existence and accessibility
 */

import type { FieldAssumption } from '../schemas/semantic-plan-types'

export interface FieldDescriptor {
  name: string
  description?: string
  type?: string
}

export interface DataSourceMetadata {
  type: 'tabular' | 'api' | 'database' | 'stream' | 'file' | 'webhook'
  headers?: string[] // For tabular sources (legacy - use fields instead)
  fields?: FieldDescriptor[] // Preferred - includes descriptions for semantic matching
  schema?: Record<string, string> // For databases
  sample_rows?: any[] // Pre-sampled data
  row_count?: number
  plugin_key?: string
}

export interface DataSampleResult {
  field_name: string
  sample_values: any[]
  data_type: 'string' | 'number' | 'date' | 'email' | 'boolean' | 'mixed' | 'unknown'
  is_nullable: boolean
  null_count: number
  unique_count: number
  patterns: string[]
  validation: {
    is_valid: boolean
    confidence: number
    errors: string[]
  }
}

export interface AssumptionValidationResult {
  assumption_id: string
  validated: boolean
  confidence: number
  resolved_value: any
  validation_method: string
  evidence: {
    sample_size: number
    matching_count: number
    details: string
  }
  errors: string[]
}

export class DataSampler {
  /**
   * Sample data from a tabular source (Google Sheets, Airtable, CSV)
   */
  async sampleTabularData(
    metadata: DataSourceMetadata,
    fieldName: string,
    sampleSize: number = 5
  ): Promise<DataSampleResult> {
    if (!metadata.headers || !metadata.sample_rows) {
      throw new Error('Tabular metadata must include headers and sample_rows')
    }

    // Check if field exists
    if (!metadata.headers.includes(fieldName)) {
      return {
        field_name: fieldName,
        sample_values: [],
        data_type: 'unknown',
        is_nullable: true,
        null_count: 0,
        unique_count: 0,
        patterns: [],
        validation: {
          is_valid: false,
          confidence: 0.0,
          errors: [`Field "${fieldName}" does not exist in data source`]
        }
      }
    }

    // Extract column values
    const columnValues = metadata.sample_rows
      .slice(0, sampleSize)
      .map(row => row[fieldName])

    // Analyze data
    return this.analyzeColumnData(fieldName, columnValues)
  }

  /**
   * Validate a field assumption against actual data
   */
  async validateFieldAssumption(
    assumption: FieldAssumption,
    metadata: DataSourceMetadata,
    actualFieldName: string
  ): Promise<AssumptionValidationResult> {
    try {
      // Sample data from the field
      const sampleResult = await this.sampleTabularData(metadata, actualFieldName, 10)

      if (!sampleResult.validation.is_valid) {
        return {
          assumption_id: assumption.semantic_name,
          validated: false,
          confidence: 0.0,
          resolved_value: null,
          validation_method: 'data_sample',
          evidence: {
            sample_size: 0,
            matching_count: 0,
            details: sampleResult.validation.errors.join('; ')
          },
          errors: sampleResult.validation.errors
        }
      }

      // Check if data type matches expectation
      let typeMatches = true
      let confidence = 1.0

      if (assumption.expected_type) {
        typeMatches = this.checkTypeCompatibility(
          assumption.expected_type,
          sampleResult.data_type
        )

        if (!typeMatches) {
          confidence *= 0.5 // Lower confidence if type mismatch
        }
      }

      // Check if field is required but has nulls
      if (assumption.required && sampleResult.is_nullable && sampleResult.null_count > 0) {
        confidence *= 0.7 // Lower confidence if required field has nulls
      }

      const validated = typeMatches && (!assumption.required || sampleResult.null_count === 0)

      return {
        assumption_id: assumption.semantic_name,
        validated,
        confidence,
        resolved_value: actualFieldName,
        validation_method: 'data_sample',
        evidence: {
          sample_size: sampleResult.sample_values.length,
          matching_count: sampleResult.sample_values.length - sampleResult.null_count,
          details: `Field "${actualFieldName}" contains ${sampleResult.data_type} data. ${sampleResult.null_count > 0 ? `${sampleResult.null_count} null values found.` : 'No null values.'}`
        },
        errors: validated ? [] : [
          `Type mismatch: expected ${assumption.expected_type}, got ${sampleResult.data_type}`,
          ...(assumption.required && sampleResult.null_count > 0
            ? [`Required field has ${sampleResult.null_count} null values`]
            : [])
        ]
      }
    } catch (error) {
      return {
        assumption_id: assumption.semantic_name,
        validated: false,
        confidence: 0.0,
        resolved_value: null,
        validation_method: 'data_sample',
        evidence: {
          sample_size: 0,
          matching_count: 0,
          details: `Error sampling data: ${error instanceof Error ? error.message : String(error)}`
        },
        errors: [error instanceof Error ? error.message : String(error)]
      }
    }
  }

  /**
   * Analyze column data to determine type, patterns, and validity
   */
  private analyzeColumnData(fieldName: string, values: any[]): DataSampleResult {
    const nonNullValues = values.filter(v => v !== null && v !== undefined && v !== '')
    const nullCount = values.length - nonNullValues.length
    const isNullable = nullCount > 0

    // Determine data type
    const dataType = this.inferDataType(nonNullValues)

    // Get unique values
    const uniqueValues = new Set(nonNullValues.map(v => String(v)))
    const uniqueCount = uniqueValues.size

    // Detect patterns
    const patterns = this.detectPatterns(nonNullValues)

    // Validation
    const validation = {
      is_valid: true,
      confidence: 1.0,
      errors: [] as string[]
    }

    if (values.length === 0) {
      validation.is_valid = false
      validation.confidence = 0.0
      validation.errors.push('No sample data available')
    }

    return {
      field_name: fieldName,
      sample_values: nonNullValues.slice(0, 5), // Return first 5 non-null values
      data_type: dataType,
      is_nullable: isNullable,
      null_count: nullCount,
      unique_count: uniqueCount,
      patterns,
      validation
    }
  }

  /**
   * Infer data type from sample values
   */
  private inferDataType(values: any[]): 'string' | 'number' | 'date' | 'email' | 'boolean' | 'mixed' | 'unknown' {
    if (values.length === 0) return 'unknown'

    const types = new Set<string>()

    for (const value of values) {
      if (this.isEmail(value)) {
        types.add('email')
      } else if (this.isDate(value)) {
        types.add('date')
      } else if (typeof value === 'boolean') {
        types.add('boolean')
      } else if (typeof value === 'number' || !isNaN(Number(value))) {
        types.add('number')
      } else if (typeof value === 'string') {
        types.add('string')
      } else {
        types.add('unknown')
      }
    }

    // If all values are the same type, return that type
    if (types.size === 1) {
      return Array.from(types)[0] as any
    }

    // If mixed types, return 'mixed'
    if (types.size > 1) {
      // Email takes priority over string
      if (types.has('email')) return 'email'
      // Date takes priority over string
      if (types.has('date')) return 'date'
      return 'mixed'
    }

    return 'unknown'
  }

  /**
   * Check if value is an email
   */
  private isEmail(value: any): boolean {
    if (typeof value !== 'string') return false
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(value.trim())
  }

  /**
   * Check if value is a date
   */
  private isDate(value: any): boolean {
    if (value instanceof Date) return true
    if (typeof value === 'string') {
      const date = new Date(value)
      return !isNaN(date.getTime())
    }
    return false
  }

  /**
   * Detect patterns in values
   */
  private detectPatterns(values: any[]): string[] {
    const patterns: string[] = []

    // Check if all values are emails
    const allEmails = values.every(v => this.isEmail(v))
    if (allEmails && values.length > 0) {
      patterns.push('all_emails')
    }

    // Check if all values are dates
    const allDates = values.every(v => this.isDate(v))
    if (allDates && values.length > 0) {
      patterns.push('all_dates')
    }

    // Check if all values are numeric
    const allNumeric = values.every(v => typeof v === 'number' || !isNaN(Number(v)))
    if (allNumeric && values.length > 0) {
      patterns.push('all_numeric')
    }

    // Check if values follow a specific format (e.g., "YYYY-MM-DD")
    if (values.length > 0 && typeof values[0] === 'string') {
      const firstValue = values[0]
      if (/^\d{4}-\d{2}-\d{2}$/.test(firstValue)) {
        patterns.push('iso_date_format')
      }
    }

    return patterns
  }

  /**
   * Check if actual type is compatible with expected type
   */
  private checkTypeCompatibility(
    expected: 'string' | 'number' | 'date' | 'email' | 'boolean',
    actual: 'string' | 'number' | 'date' | 'email' | 'boolean' | 'mixed' | 'unknown'
  ): boolean {
    if (expected === actual) return true

    // Email is compatible with string
    if (expected === 'email' && actual === 'string') return true
    if (expected === 'string' && actual === 'email') return true

    // Date is compatible with string
    if (expected === 'date' && actual === 'string') return true
    if (expected === 'string' && actual === 'date') return true

    // Number can be represented as string
    if (expected === 'number' && actual === 'string') return true

    return false
  }

  /**
   * Validate that a field contains values matching a specific pattern
   */
  async validateFieldPattern(
    metadata: DataSourceMetadata,
    fieldName: string,
    pattern: RegExp,
    minMatchRate: number = 0.8
  ): Promise<{
    is_valid: boolean
    match_rate: number
    sample_size: number
    matching_count: number
  }> {
    const sampleResult = await this.sampleTabularData(metadata, fieldName, 10)

    if (!sampleResult.validation.is_valid) {
      return {
        is_valid: false,
        match_rate: 0.0,
        sample_size: 0,
        matching_count: 0
      }
    }

    const matchingCount = sampleResult.sample_values.filter(v =>
      typeof v === 'string' && pattern.test(v)
    ).length

    const matchRate = sampleResult.sample_values.length > 0
      ? matchingCount / sampleResult.sample_values.length
      : 0

    return {
      is_valid: matchRate >= minMatchRate,
      match_rate: matchRate,
      sample_size: sampleResult.sample_values.length,
      matching_count: matchingCount
    }
  }

  /**
   * Get statistics about a field
   */
  async getFieldStatistics(
    metadata: DataSourceMetadata,
    fieldName: string
  ): Promise<{
    field_name: string
    data_type: string
    total_rows: number
    null_count: number
    unique_count: number
    sample_values: any[]
    min_value?: any
    max_value?: any
    avg_value?: number
  }> {
    const sampleResult = await this.sampleTabularData(metadata, fieldName, 20)

    const stats: any = {
      field_name: fieldName,
      data_type: sampleResult.data_type,
      total_rows: metadata.row_count || sampleResult.sample_values.length,
      null_count: sampleResult.null_count,
      unique_count: sampleResult.unique_count,
      sample_values: sampleResult.sample_values.slice(0, 5)
    }

    // Add numeric statistics if field is numeric
    if (sampleResult.data_type === 'number') {
      const numericValues = sampleResult.sample_values
        .map(v => Number(v))
        .filter(v => !isNaN(v))

      if (numericValues.length > 0) {
        stats.min_value = Math.min(...numericValues)
        stats.max_value = Math.max(...numericValues)
        stats.avg_value = numericValues.reduce((a, b) => a + b, 0) / numericValues.length
      }
    }

    return stats
  }
}
