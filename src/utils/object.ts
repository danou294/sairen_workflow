/**
 * Récupère une valeur imbriquée dans un objet via un chemin pointé (ex: "patient.prenom")
 * Retourne undefined si le chemin n'existe pas
 */
export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object') return (current as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}
