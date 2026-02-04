import semver from 'semver';
import {
  CONTRACT_VERSION,
  MIN_SUPPORTED_CONTRACT_VERSION,
  IncompatibleContractError,
  type ExternalSkillContract,
} from './external-skill-contract';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warnings: string[];
}

export class ContractVersionValidator {
  /**
   * Validate at registration time (when skill is synced/added to registry)
   * Allows skills to be registered but flags incompatibilities
   */
  static validateAtRegistration(skill: ExternalSkillContract): ValidationResult {
    const warnings: string[] = [];

    if (!skill.contractVersion) {
      return {
        valid: false,
        error: `Skill "${skill.canonicalId}" missing contractVersion field`,
        warnings,
      };
    }

    const skillVersion = semver.parse(skill.contractVersion);

    if (!skillVersion) {
      return {
        valid: false,
        error: `Skill "${skill.canonicalId}" has invalid contractVersion: ${skill.contractVersion}`,
        warnings,
      };
    }

    // Check if major version is compatible
    const currentContract = semver.parse(CONTRACT_VERSION);
    if (currentContract && skillVersion.major > currentContract.major) {
      warnings.push(
        `Skill "${skill.canonicalId}" uses newer contract version ${skill.contractVersion}. ` +
          `Some features may not be supported.`
      );
    }

    if (semver.lt(skill.contractVersion, MIN_SUPPORTED_CONTRACT_VERSION)) {
      return {
        valid: false,
        error:
          `Skill "${skill.canonicalId}" contract version ${skill.contractVersion} ` +
          `is below minimum supported ${MIN_SUPPORTED_CONTRACT_VERSION}`,
        warnings,
      };
    }

    return { valid: true, warnings };
  }

  /**
   * Validate at runtime (when skill is about to execute)
   * MUST throw IncompatibleContractError if version is not supported
   * NO SILENT FALLBACK
   */
  static validateAtRuntime(skill: ExternalSkillContract): void {
    if (!skill.contractVersion) {
      throw new IncompatibleContractError(
        skill.canonicalId,
        'undefined',
        MIN_SUPPORTED_CONTRACT_VERSION
      );
    }

    if (semver.lt(skill.contractVersion, MIN_SUPPORTED_CONTRACT_VERSION)) {
      throw new IncompatibleContractError(
        skill.canonicalId,
        skill.contractVersion,
        MIN_SUPPORTED_CONTRACT_VERSION
      );
    }
  }

  /**
   * Check if a breaking change would occur
   */
  static isBreakingChange(fromVersion: string, toVersion: string): boolean {
    const from = semver.parse(fromVersion);
    const to = semver.parse(toVersion);
    if (!from || !to) return true;
    return to.major > from.major;
  }
}
