import type { UnifiedSkill, SkillSourceInfo } from './types';

export interface RawSkillDescriptor {
  filePath: string;
  content: string;
  source: SkillSourceInfo;
}

export function normalizeSkillDescriptor(
  descriptor: RawSkillDescriptor
): UnifiedSkill {
  const trimmed = descriptor.content.trim();

  if (descriptor.filePath.endsWith('.md')) {
    return normalizeFromMarkdown(descriptor);
  }

  if (descriptor.filePath.endsWith('.json')) {
    return normalizeFromJson(descriptor);
  }

  if (descriptor.filePath.endsWith('.ts') || descriptor.filePath.endsWith('.js')) {
    return normalizeFromTypeScript(descriptor);
  }

  return normalizeFallback(descriptor);
}

function normalizeFromMarkdown(descriptor: RawSkillDescriptor): UnifiedSkill {
  const frontmatter = parseFrontmatter(descriptor.content);
  const name = frontmatter.name || extractHeading(descriptor.content) || 'external-skill';
  const description =
    frontmatter.description || extractParagraph(descriptor.content) || 'External skill';

  return baseSkill(descriptor, {
    name,
    description,
  });
}

function normalizeFromJson(descriptor: RawSkillDescriptor): UnifiedSkill {
  try {
    const parsed = JSON.parse(descriptor.content) as Record<string, unknown>;
    const name = stringValue(parsed.name) || stringValue(parsed.title) || 'external-skill';
    const description =
      stringValue(parsed.description) || stringValue(parsed.summary) || 'External skill';
    const version = stringValue(parsed.version);

    return baseSkill(descriptor, {
      name,
      description,
      version,
      inputSchema: objectValue(parsed.inputSchema) || objectValue(parsed.input_schema),
      outputSchema: objectValue(parsed.outputSchema) || objectValue(parsed.output_schema),
      invocationPattern: stringValue(parsed.invocationPattern),
      systemPrompt: stringValue(parsed.systemPrompt),
      userPromptTemplate: stringValue(parsed.userPromptTemplate),
      functionDefinition: objectValue(parsed.functionDefinition),
      dependencies: arrayValue(parsed.dependencies),
      requiredTools: arrayValue(parsed.requiredTools),
    });
  } catch {
    return normalizeFallback(descriptor);
  }
}

function normalizeFromTypeScript(descriptor: RawSkillDescriptor): UnifiedSkill {
  const name =
    matchStringLiteral(descriptor.content, /name:\s*['"`]([^'"`]+)['"`]/) ||
    matchStringLiteral(descriptor.content, /title:\s*['"`]([^'"`]+)['"`]/) ||
    'external-skill';
  const description =
    matchStringLiteral(descriptor.content, /description:\s*['"`]([^'"`]+)['"`]/) ||
    'External skill';
  const version =
    matchStringLiteral(descriptor.content, /version:\s*['"`]([^'"`]+)['"`]/);

  return baseSkill(descriptor, {
    name,
    description,
    version,
  });
}

function normalizeFallback(descriptor: RawSkillDescriptor): UnifiedSkill {
  const name = extractHeading(descriptor.content) || 'external-skill';
  const description = extractParagraph(descriptor.content) || 'External skill';
  return baseSkill(descriptor, { name, description });
}

function baseSkill(
  descriptor: RawSkillDescriptor,
  overrides: Partial<UnifiedSkill>
): UnifiedSkill {
  const canonicalId = deriveCanonicalId(overrides.name || 'external-skill');
  return {
    canonicalId,
    name: overrides.name || 'external-skill',
    description: overrides.description || 'External skill',
    version: overrides.version || '0.0.0',
    runtimeVersion: overrides.runtimeVersion,
    category: overrides.category,
    status: overrides.status || 'ACTIVE',
    inputSchema: overrides.inputSchema,
    outputSchema: overrides.outputSchema,
    invocationPattern: overrides.invocationPattern || 'prompt',
    systemPrompt: overrides.systemPrompt,
    userPromptTemplate: overrides.userPromptTemplate,
    functionDefinition: overrides.functionDefinition,
    dependencies: overrides.dependencies || [],
    requiredTools: overrides.requiredTools,
    capabilityLevel: overrides.capabilityLevel || 'EXTERNAL',
    executionScope: overrides.executionScope || 'AGENT',
    source: descriptor.source,
    isProtected: overrides.isProtected ?? false,
    protectionReason: overrides.protectionReason,
  };
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith('---')) {
    return {};
  }

  const endIndex = content.indexOf('\n---', 3);
  if (endIndex === -1) {
    return {};
  }

  const frontmatter = content.slice(3, endIndex).trim();
  const result: Record<string, string> = {};
  for (const line of frontmatter.split('\n')) {
    const [key, ...rest] = line.split(':');
    if (!key || rest.length === 0) continue;
    result[key.trim()] = rest.join(':').trim();
  }
  return result;
}

function extractHeading(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function extractParagraph(content: string): string | null {
  const match = content.match(/\n\n([^#\n][^\n]+)/);
  return match ? match[1].trim() : null;
}

function deriveCanonicalId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function arrayValue(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : undefined;
}

function matchStringLiteral(content: string, pattern: RegExp): string | undefined {
  const match = content.match(pattern);
  return match ? match[1] : undefined;
}
