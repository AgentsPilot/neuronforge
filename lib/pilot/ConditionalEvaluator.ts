/**
 * ConditionalEvaluator - Safe evaluation of conditional expressions
 *
 * Security: NO eval() or Function() - uses safe expression parsing
 *
 * Supports:
 * - Simple conditions: { field: "step1.data.score", operator: ">", value: 70 }
 * - Complex conditions: { and: [...], or: [...], not: {...} }
 * - String expressions: "step1.data.score > 70 && step2.success"
 *
 * @module lib/orchestrator/ConditionalEvaluator
 */

import type {
  Condition,
  SimpleCondition,
  ComplexCondition,
  ComparisonOperator,
  ExecutionContext,
} from './types';
import {
  ConditionError,
  isSimpleCondition,
  isComplexCondition,
} from './types';

export class ConditionalEvaluator {
  /**
   * Evaluate condition against execution context
   */
  evaluate(condition: Condition, context: ExecutionContext): boolean {
    if (!condition) {
      return true;  // No condition = always true
    }

    try {
      // Simple condition: { field: "step1.data.score", operator: ">", value: 70 }
      if (isSimpleCondition(condition)) {
        return this.evaluateSimpleCondition(condition, context);
      }

      // Complex condition: { and: [...], or: [...], not: {...} }
      if (isComplexCondition(condition)) {
        return this.evaluateComplexCondition(condition, context);
      }

      // String expression: "step1.data.score > 70 && step2.success"
      if (typeof condition === 'string') {
        return this.evaluateExpression(condition, context);
      }

      throw new ConditionError(
        `Invalid condition format: ${JSON.stringify(condition)}`
      );
    } catch (error: any) {
      if (error instanceof ConditionError) {
        throw error;
      }
      throw new ConditionError(
        `Condition evaluation failed: ${error.message}`,
        undefined,
        { condition, originalError: error.message }
      );
    }
  }

  /**
   * Evaluate simple condition
   */
  private evaluateSimpleCondition(
    condition: SimpleCondition,
    context: ExecutionContext
  ): boolean {
    // Resolve field value from context
    const actualValue = context.resolveVariable(`{{${condition.field}}}`);

    return this.compareValues(
      actualValue,
      condition.value,
      condition.operator
    );
  }

  /**
   * Evaluate complex condition (and/or/not)
   */
  private evaluateComplexCondition(
    condition: ComplexCondition,
    context: ExecutionContext
  ): boolean {
    // AND: All conditions must be true
    if (condition.and) {
      return condition.and.every(c => this.evaluate(c, context));
    }

    // OR: At least one condition must be true
    if (condition.or) {
      return condition.or.some(c => this.evaluate(c, context));
    }

    // NOT: Negate the result
    if (condition.not) {
      return !this.evaluate(condition.not, context);
    }

    throw new ConditionError('Invalid complex condition: missing and/or/not');
  }

  /**
   * Evaluate expression string (safe - no eval!)
   *
   * Example: "step1.data.score > 70 && step2.success"
   */
  private evaluateExpression(expression: string, context: ExecutionContext): boolean {
    // First, resolve all variable references
    const resolved = this.resolveVariablesInExpression(expression, context);

    // Parse and evaluate using safe parser
    return this.safeEvaluate(resolved);
  }

  /**
   * Resolve all variable references in expression
   */
  private resolveVariablesInExpression(
    expression: string,
    context: ExecutionContext
  ): string {
    return expression.replace(/\{\{([^}]+)\}\}|(\w+\.\w+[\w.\[\]]*)/g, (match, explicit, implicit) => {
      const ref = explicit || implicit;

      try {
        const value = context.resolveVariable(`{{${ref}}}`);

        // Convert to JSON-safe string representation
        if (typeof value === 'string') {
          return `"${value.replace(/"/g, '\\"')}"`;
        }
        if (typeof value === 'boolean' || typeof value === 'number') {
          return String(value);
        }
        if (value === null || value === undefined) {
          return 'null';
        }

        return JSON.stringify(value);
      } catch (error) {
        // If variable resolution fails, keep the original reference
        console.warn(`Failed to resolve ${ref} in condition:`, error);
        return match;
      }
    });
  }

  /**
   * Safe expression evaluator (NO eval!)
   *
   * Supports:
   * - Comparison: ==, !=, >, >=, <, <=
   * - Logical: &&, ||, !
   * - Grouping: ( )
   */
  private safeEvaluate(expression: string): boolean {
    // Tokenize expression
    const tokens = this.tokenize(expression);

    // Parse to AST
    const ast = this.parse(tokens);

    // Evaluate AST
    return this.evaluateAST(ast);
  }

  /**
   * Tokenize expression
   */
  private tokenize(expression: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inString = false;
    let stringChar = '';

    for (let i = 0; i < expression.length; i++) {
      const char = expression[i];
      const nextChar = expression[i + 1];

      // Handle string literals
      if ((char === '"' || char === "'") && !inString) {
        inString = true;
        stringChar = char;
        current += char;
        continue;
      }

      if (char === stringChar && inString) {
        inString = false;
        current += char;
        tokens.push(current);
        current = '';
        continue;
      }

      if (inString) {
        current += char;
        continue;
      }

      // Handle operators
      if (char === ' ') {
        if (current) {
          tokens.push(current);
          current = '';
        }
        continue;
      }

      // Two-character operators: ==, !=, >=, <=, &&, ||
      if (
        (char === '=' && nextChar === '=') ||
        (char === '!' && nextChar === '=') ||
        (char === '>' && nextChar === '=') ||
        (char === '<' && nextChar === '=') ||
        (char === '&' && nextChar === '&') ||
        (char === '|' && nextChar === '|')
      ) {
        if (current) {
          tokens.push(current);
          current = '';
        }
        tokens.push(char + nextChar);
        i++; // Skip next char
        continue;
      }

      // Single-character operators: >, <, !, (, )
      if (['>', '<', '!', '(', ')'].includes(char)) {
        if (current) {
          tokens.push(current);
          current = '';
        }
        tokens.push(char);
        continue;
      }

      current += char;
    }

    if (current) {
      tokens.push(current);
    }

    return tokens.filter(t => t.trim());
  }

  /**
   * Parse tokens to AST
   */
  private parse(tokens: string[]): any {
    let index = 0;

    const parseExpression = (): any => {
      return parseLogicalOr();
    };

    const parseLogicalOr = (): any => {
      let left = parseLogicalAnd();

      while (index < tokens.length && tokens[index] === '||') {
        index++; // consume ||
        const right = parseLogicalAnd();
        left = { type: 'or', left, right };
      }

      return left;
    };

    const parseLogicalAnd = (): any => {
      let left = parseComparison();

      while (index < tokens.length && tokens[index] === '&&') {
        index++; // consume &&
        const right = parseComparison();
        left = { type: 'and', left, right };
      }

      return left;
    };

    const parseComparison = (): any => {
      let left = parseUnary();

      const comparisonOps = ['==', '!=', '>', '>=', '<', '<='];

      if (index < tokens.length && comparisonOps.includes(tokens[index])) {
        const operator = tokens[index];
        index++; // consume operator
        const right = parseUnary();
        return { type: 'comparison', operator, left, right };
      }

      return left;
    };

    const parseUnary = (): any => {
      if (index < tokens.length && tokens[index] === '!') {
        index++; // consume !
        const operand = parseUnary();
        return { type: 'not', operand };
      }

      return parsePrimary();
    };

    const parsePrimary = (): any => {
      // Parentheses
      if (tokens[index] === '(') {
        index++; // consume (
        const expr = parseExpression();
        if (tokens[index] !== ')') {
          throw new Error('Expected )');
        }
        index++; // consume )
        return expr;
      }

      // Literal value
      const token = tokens[index];
      index++;

      // Boolean
      if (token === 'true') return { type: 'literal', value: true };
      if (token === 'false') return { type: 'literal', value: false };

      // Null
      if (token === 'null') return { type: 'literal', value: null };

      // Number
      if (!isNaN(Number(token))) {
        return { type: 'literal', value: Number(token) };
      }

      // String
      if (token.startsWith('"') && token.endsWith('"')) {
        return { type: 'literal', value: token.slice(1, -1) };
      }
      if (token.startsWith("'") && token.endsWith("'")) {
        return { type: 'literal', value: token.slice(1, -1) };
      }

      // Variable (shouldn't happen if resolveVariablesInExpression worked)
      return { type: 'literal', value: token };
    };

    return parseExpression();
  }

  /**
   * Evaluate AST
   */
  private evaluateAST(node: any): boolean {
    switch (node.type) {
      case 'literal':
        return Boolean(node.value);

      case 'comparison':
        return this.compareValues(
          this.evaluateASTValue(node.left),
          this.evaluateASTValue(node.right),
          node.operator as ComparisonOperator
        );

      case 'and':
        return this.evaluateAST(node.left) && this.evaluateAST(node.right);

      case 'or':
        return this.evaluateAST(node.left) || this.evaluateAST(node.right);

      case 'not':
        return !this.evaluateAST(node.operand);

      default:
        throw new Error(`Unknown AST node type: ${node.type}`);
    }
  }

  /**
   * Evaluate AST node to value (not boolean)
   */
  private evaluateASTValue(node: any): any {
    if (node.type === 'literal') {
      return node.value;
    }
    throw new Error(`Cannot evaluate ${node.type} as value`);
  }

  /**
   * Compare two values using operator
   */
  private compareValues(
    left: any,
    right: any,
    operator: ComparisonOperator
  ): boolean {
    switch (operator) {
      case '==':
      case 'equals':
        return left == right;

      case '!=':
      case 'not_equals':
        return left != right;

      case '>':
      case 'greater_than':
        return left > right;

      case '>=':
      case 'greater_than_or_equal':
        return left >= right;

      case '<':
      case 'less_than':
        return left < right;

      case '<=':
      case 'less_than_or_equal':
        return left <= right;

      case 'contains':
        return String(left).includes(String(right));

      case 'not_contains':
        return !String(left).includes(String(right));

      case 'in':
        return Array.isArray(right) && right.includes(left);

      case 'not_in':
        return Array.isArray(right) && !right.includes(left);

      case 'exists':
        return left !== undefined && left !== null;

      case 'not_exists':
        return left === undefined || left === null;

      case 'is_empty':
        if (left === null || left === undefined) return true;
        if (typeof left === 'string') return left.length === 0;
        if (Array.isArray(left)) return left.length === 0;
        if (typeof left === 'object') return Object.keys(left).length === 0;
        return false;

      case 'is_not_empty':
        return !this.compareValues(left, right, 'is_empty');

      case 'matches':
        try {
          const regex = new RegExp(String(right));
          return regex.test(String(left));
        } catch (error) {
          throw new ConditionError(`Invalid regex pattern: ${right}`);
        }

      case 'starts_with':
        return String(left).startsWith(String(right));

      case 'ends_with':
        return String(left).endsWith(String(right));

      default:
        throw new ConditionError(`Unknown operator: ${operator}`);
    }
  }

  /**
   * Validate condition structure (useful for workflow validation)
   */
  validateCondition(condition: Condition): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    try {
      if (typeof condition === 'string') {
        // Try to tokenize and parse
        const tokens = this.tokenize(condition);
        this.parse(tokens);
        return { valid: true, errors: [] };
      }

      if (isSimpleCondition(condition)) {
        if (!condition.field) {
          errors.push('Simple condition missing field');
        }
        if (!condition.operator) {
          errors.push('Simple condition missing operator');
        }
        if (condition.value === undefined) {
          errors.push('Simple condition missing value');
        }
      } else if (isComplexCondition(condition)) {
        if (condition.and) {
          condition.and.forEach((c, i) => {
            const result = this.validateCondition(c);
            if (!result.valid) {
              errors.push(...result.errors.map(e => `and[${i}]: ${e}`));
            }
          });
        }
        if (condition.or) {
          condition.or.forEach((c, i) => {
            const result = this.validateCondition(c);
            if (!result.valid) {
              errors.push(...result.errors.map(e => `or[${i}]: ${e}`));
            }
          });
        }
        if (condition.not) {
          const result = this.validateCondition(condition.not);
          if (!result.valid) {
            errors.push(...result.errors.map(e => `not: ${e}`));
          }
        }

        if (!condition.and && !condition.or && !condition.not) {
          errors.push('Complex condition must have and, or, or not');
        }
      } else {
        errors.push('Invalid condition format');
      }
    } catch (error: any) {
      errors.push(`Validation error: ${error.message}`);
    }

    return { valid: errors.length === 0, errors };
  }
}
