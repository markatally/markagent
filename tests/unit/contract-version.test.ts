import { describe, it, expect } from 'bun:test';
import {
  ContractVersionValidator,
  CONTRACT_VERSION,
  IncompatibleContractError,
  MIN_SUPPORTED_CONTRACT_VERSION,
} from '@mark/shared';

describe('ContractVersionValidator', () => {
  describe('validateAtRegistration', () => {
    it('rejects skills without contractVersion field', () => {
      const skill = { canonicalId: 'test-skill' };
      const result = ContractVersionValidator.validateAtRegistration(skill as any);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('missing contractVersion');
    });

    it('rejects skills below minimum supported version', () => {
      const skill = { canonicalId: 'test-skill', contractVersion: '0.1.0' };
      const result = ContractVersionValidator.validateAtRegistration(skill as any);
      expect(result.valid).toBe(false);
    });

    it('warns when skill uses newer major version', () => {
      const [major] = CONTRACT_VERSION.split('.');
      const futureVersion = `${Number(major) + 1}.0.0`;
      const skill = { canonicalId: 'test-skill', contractVersion: futureVersion };
      const result = ContractVersionValidator.validateAtRegistration(skill as any);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('validateAtRuntime', () => {
    it('throws IncompatibleContractError for unsupported versions', () => {
      const skill = { canonicalId: 'test-skill', contractVersion: '0.1.0' };
      expect(() => ContractVersionValidator.validateAtRuntime(skill as any)).toThrow(
        IncompatibleContractError
      );
    });

    it('does NOT silently fall back - always throws or succeeds', () => {
      const skill = { canonicalId: 'test-skill', contractVersion: '0.1.0' };
      let threw = false;
      try {
        ContractVersionValidator.validateAtRuntime(skill as any);
      } catch (error) {
        threw = true;
        expect(error).toBeInstanceOf(IncompatibleContractError);
      }
      expect(threw).toBe(true);
    });

    it('accepts minimum supported version', () => {
      const skill = { canonicalId: 'test-skill', contractVersion: MIN_SUPPORTED_CONTRACT_VERSION };
      expect(() => ContractVersionValidator.validateAtRuntime(skill as any)).not.toThrow();
    });
  });
});
