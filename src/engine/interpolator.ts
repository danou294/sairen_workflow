import { createLogger } from '../utils/logger';

const logger = createLogger('interpolator');

// Regex pour capturer {{variable}} ou {{variable | pipe:'arg'}}
const INTERPOLATION_REGEX = /\{\{([^}]+)\}\}/g;

/**
 * Récupère une valeur imbriquée dans un objet via un chemin pointé
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object') return (current as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

// --- Pipes (filtres) ---

type PipeFunction = (value: unknown, arg?: string) => unknown;

const pipes: Record<string, PipeFunction> = {
  uppercase: (value) => (typeof value === 'string' ? value.toUpperCase() : value),
  lowercase: (value) => (typeof value === 'string' ? value.toLowerCase() : value),
  capitalize: (value) =>
    typeof value === 'string' ? value.charAt(0).toUpperCase() + value.slice(1) : value,
  trim: (value) => (typeof value === 'string' ? value.trim() : value),

  default: (value, arg) => (value === undefined || value === null ? arg : value),

  truncate: (value, arg) => {
    if (typeof value !== 'string' || !arg) return value;
    const maxLength = parseInt(arg, 10);
    return value.length > maxLength ? value.slice(0, maxLength) + '...' : value;
  },

  format: (value, arg) => {
    if (!arg) return value;
    try {
      const date = new Date(value as string);
      if (isNaN(date.getTime())) return value;

      // Format simplifié : DD/MM/YYYY, HH:mm, etc.
      const replacements: Record<string, string> = {
        DD: String(date.getDate()).padStart(2, '0'),
        MM: String(date.getMonth() + 1).padStart(2, '0'),
        YYYY: String(date.getFullYear()),
        YY: String(date.getFullYear()).slice(-2),
        HH: String(date.getHours()).padStart(2, '0'),
        mm: String(date.getMinutes()).padStart(2, '0'),
        ss: String(date.getSeconds()).padStart(2, '0'),
      };

      let formatted = arg;
      for (const [token, replacement] of Object.entries(replacements)) {
        formatted = formatted.replace(token, replacement);
      }
      return formatted;
    } catch {
      return value;
    }
  },
};

/**
 * Parse et applique les pipes sur une expression
 * Exemple : "variable | uppercase | truncate:'50'"
 */
function applyPipes(value: unknown, pipeExpressions: string[]): unknown {
  let result = value;

  for (const expr of pipeExpressions) {
    const colonIndex = expr.indexOf(':');
    let pipeName: string;
    let pipeArg: string | undefined;

    if (colonIndex !== -1) {
      pipeName = expr.slice(0, colonIndex).trim();
      pipeArg = expr.slice(colonIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    } else {
      pipeName = expr.trim();
    }

    const pipeFn = pipes[pipeName];
    if (pipeFn) {
      result = pipeFn(result, pipeArg);
    } else {
      logger.warn({ pipe: pipeName }, 'Pipe inconnu');
    }
  }

  return result;
}

/**
 * Interpole une chaîne avec les variables du contexte
 *
 * Exemples :
 * - "Bonjour {{patient.prenom}}" → "Bonjour Jean"
 * - "RDV le {{rdv.date | format:'DD/MM/YYYY'}}" → "RDV le 15/03/2026"
 * - "{{nom | default:'Patient'}}" → "Patient" (si nom est undefined)
 */
export function interpolate(
  template: string,
  context: Record<string, unknown>
): string {
  return template.replace(INTERPOLATION_REGEX, (_match, expression: string) => {
    const parts = expression.split('|').map((p: string) => p.trim());
    const variablePath = parts[0];
    const pipeExprs = parts.slice(1);

    let value = getNestedValue(context, variablePath);

    if (pipeExprs.length > 0) {
      value = applyPipes(value, pipeExprs);
    }

    if (value === undefined || value === null) {
      logger.debug({ variable: variablePath }, 'Variable non trouvée dans le contexte');
      return '';
    }

    return String(value);
  });
}

/** Enregistre un pipe custom */
export function registerPipe(name: string, fn: PipeFunction): void {
  pipes[name] = fn;
}
