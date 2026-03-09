import { Condition, ConditionOperator } from '../models/types';
import { getNestedValue } from '../utils/object';
import { createLogger } from '../utils/logger';

const logger = createLogger('condition-evaluator');

/** Taille max de l'input pour les regex (protection ReDoS) */
const MAX_REGEX_INPUT_LENGTH = 10000;

/**
 * Évalue un opérateur de condition sur une valeur et une valeur de référence
 */
function evaluateOperator(
  fieldValue: unknown,
  operator: ConditionOperator,
  conditionValue: unknown
): boolean {
  switch (operator) {
    case 'equals':
      return fieldValue === conditionValue;

    case 'not_equals':
      return fieldValue !== conditionValue;

    case 'contains':
      if (typeof fieldValue === 'string' && typeof conditionValue === 'string') {
        return fieldValue.includes(conditionValue);
      }
      return false;

    case 'not_contains':
      if (typeof fieldValue === 'string' && typeof conditionValue === 'string') {
        return !fieldValue.includes(conditionValue);
      }
      return true;

    case 'greater_than':
      return Number(fieldValue) > Number(conditionValue);

    case 'less_than':
      return Number(fieldValue) < Number(conditionValue);

    case 'exists':
      return fieldValue !== undefined && fieldValue !== null;

    case 'not_exists':
      return fieldValue === undefined || fieldValue === null;

    case 'in':
      if (Array.isArray(conditionValue)) {
        return conditionValue.includes(fieldValue);
      }
      return false;

    case 'not_in':
      if (Array.isArray(conditionValue)) {
        return !conditionValue.includes(fieldValue);
      }
      return true;

    case 'matches':
      if (typeof fieldValue === 'string' && typeof conditionValue === 'string') {
        try {
          const regex = new RegExp(conditionValue);
          // Protection ReDoS : limiter la taille de l'input
          const safeInput = fieldValue.slice(0, MAX_REGEX_INPUT_LENGTH);
          return regex.test(safeInput);
        } catch {
          logger.warn({ pattern: conditionValue }, 'Regex invalide dans la condition');
          return false;
        }
      }
      return false;

    case 'date_before': {
      const d1 = new Date(fieldValue as string);
      const d2 = new Date(conditionValue as string);
      return !isNaN(d1.getTime()) && !isNaN(d2.getTime()) && d1 < d2;
    }

    case 'date_after': {
      const d1 = new Date(fieldValue as string);
      const d2 = new Date(conditionValue as string);
      return !isNaN(d1.getTime()) && !isNaN(d2.getTime()) && d1 > d2;
    }

    default:
      logger.warn({ operator }, 'Opérateur de condition inconnu');
      return false;
  }
}

/**
 * Évalue une condition unique contre un contexte
 */
export function evaluateCondition(
  condition: Condition,
  context: Record<string, unknown>
): boolean {
  const fieldValue = getNestedValue(context, condition.field);
  const result = evaluateOperator(fieldValue, condition.operator, condition.value);

  logger.debug(
    { field: condition.field, operator: condition.operator, result },
    'Condition évaluée'
  );

  return result;
}

/**
 * Évalue un groupe de conditions avec logique AND/OR
 */
export function evaluateConditions(
  conditions: Condition[],
  context: Record<string, unknown>
): boolean {
  if (conditions.length === 0) return true;

  let result = evaluateCondition(conditions[0], context);

  for (let i = 1; i < conditions.length; i++) {
    const condition = conditions[i];
    const condResult = evaluateCondition(condition, context);

    if (condition.logic === 'OR') {
      result = result || condResult;
    } else {
      // AND par défaut
      result = result && condResult;
    }
  }

  return result;
}
