import type { RuntimeRegistry, SkillRuntime } from './types';

class RuntimeRegistryImpl implements RuntimeRegistry {
  private runtimes = new Map<string, SkillRuntime>();

  get(kind: string): SkillRuntime | undefined {
    return this.runtimes.get(kind);
  }

  register(runtime: SkillRuntime): void {
    if (this.runtimes.has(runtime.kind)) {
      throw new Error(`Runtime for kind "${runtime.kind}" already registered`);
    }
    this.runtimes.set(runtime.kind, runtime);
  }

  list(): readonly SkillRuntime[] {
    return Array.from(this.runtimes.values());
  }
}

let registryInstance: RuntimeRegistry | null = null;

export function getRuntimeRegistry(): RuntimeRegistry {
  if (!registryInstance) {
    registryInstance = new RuntimeRegistryImpl();
  }
  return registryInstance;
}
