export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export class RegistryValidator {
  validate(plugin: any): ValidationResult {
    const errors: string[] = [];
    if (!plugin.id) errors.push('missing plugin id');
    if (!plugin.version) errors.push('missing version');
    if (!plugin.source) errors.push('missing source');
    if (!plugin.runtime) errors.push('missing runtime');
    return { valid: errors.length === 0, errors };
  }
}
