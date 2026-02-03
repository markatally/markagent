/**
 * Agent Table Utilities
 *
 * Helper functions and instructions for agents to emit structured tables.
 * These utilities enforce the separation of concerns:
 * - LLM/Agent generates structured data
 * - TableRenderer handles formatting
 */

import type { TableData, TableCellValue } from './types';
import { createTable, tableFromObjects, comparisonTable, validateAndRender } from './builder';
import { renderTable, renderTableOrThrow } from './renderer';

/**
 * Instructions for LLM to generate structured table data
 * Include in system prompt when tables are expected
 */
export const TABLE_GENERATION_INSTRUCTIONS = `
## Table Output Guidelines

When you need to present tabular data, you MUST output it as structured JSON, not as raw markdown tables.

### Structured Table Format

Output tables in this JSON structure:

\`\`\`json
{
  "type": "table",
  "caption": "Optional table title",
  "columns": [
    { "id": "col1", "header": "Column 1", "align": "left" },
    { "id": "col2", "header": "Column 2", "align": "center" },
    { "id": "col3", "header": "Column 3", "align": "right" }
  ],
  "rows": [
    ["value1", "value2", "value3"],
    ["value4", "value5", "value6"]
  ]
}
\`\`\`

### Rules

1. **Never format tables directly as markdown** - always use the structured format
2. **Column count must match** - every row must have exactly as many cells as columns
3. **No line breaks in cells** - cell content must not contain \\n or \\r
4. **No pipe characters** - avoid | in cell content (will be escaped if present)
5. **Use alignment** - "left", "center", or "right" for each column
6. **Include caption** - when the table represents a specific comparison or summary

### When to Use Tables

- Comparisons (features, trade-offs, options)
- Data summaries (metrics, statistics)
- Lists with multiple attributes
- Matrix-style information

### Example: Feature Comparison

\`\`\`json
{
  "type": "table",
  "caption": "Database Comparison",
  "columns": [
    { "id": "feature", "header": "Feature", "align": "left" },
    { "id": "postgres", "header": "PostgreSQL", "align": "center" },
    { "id": "mysql", "header": "MySQL", "align": "center" }
  ],
  "rows": [
    ["ACID Compliance", "Full", "Full"],
    ["JSON Support", "Native", "Limited"],
    ["Replication", "Built-in", "Built-in"]
  ]
}
\`\`\`
`;

/**
 * Parse LLM output that contains structured table JSON
 *
 * @param content - LLM output that may contain table JSON blocks
 * @returns Array of extracted TableData objects
 */
export function parseTableBlocks(content: string): { tables: TableData[]; text: string } {
  const tables: TableData[] = [];
  let text = content;

  // Match JSON blocks with type: "table"
  const tableJsonPattern = /```json\s*(\{[\s\S]*?"type"\s*:\s*"table"[\s\S]*?\})\s*```/g;

  let match;
  while ((match = tableJsonPattern.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.type === 'table' && parsed.columns && parsed.rows) {
        const tableData: TableData = {
          schema: {
            columns: parsed.columns.map((col: any) => ({
              id: col.id || col.header?.toLowerCase().replace(/\s+/g, '_') || 'col',
              header: col.header || col.id || 'Column',
              align: col.align,
            })),
          },
          rows: parsed.rows,
          caption: parsed.caption,
        };
        tables.push(tableData);

        // Replace JSON block with rendered table
        const result = renderTable(tableData);
        if (result.success) {
          text = text.replace(match[0], result.output);
        }
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  return { tables, text };
}

/**
 * Process agent output, converting any structured tables to markdown
 *
 * @param content - Raw agent output
 * @returns Processed content with tables rendered as markdown
 */
export function processAgentOutput(content: string): string {
  const { text } = parseTableBlocks(content);
  return text;
}

/**
 * Quick table creation for tool outputs
 *
 * @example
 * ```typescript
 * // In a tool executor:
 * const markdown = quickTable(
 *   ['Name', 'Status', 'Duration'],
 *   [
 *     ['Task 1', 'Complete', '2m'],
 *     ['Task 2', 'Running', '5m'],
 *   ],
 *   'Task Summary'
 * );
 * ```
 */
export function quickTable(
  headers: string[],
  rows: TableCellValue[][],
  caption?: string
): string {
  const table = comparisonTable(caption || '', headers, rows);
  // If no caption provided, don't include it
  if (!caption) {
    delete table.caption;
  }
  return renderTableOrThrow(table);
}

/**
 * Convert search/query results to a table
 *
 * @example
 * ```typescript
 * const results = [
 *   { title: 'Result 1', url: 'https://...', score: 0.95 },
 *   { title: 'Result 2', url: 'https://...', score: 0.87 },
 * ];
 * const markdown = resultsToTable(results, 'Search Results');
 * ```
 */
export function resultsToTable<T extends Record<string, TableCellValue>>(
  results: T[],
  caption?: string,
  columnConfig?: Partial<Record<keyof T, { header?: string; align?: 'left' | 'center' | 'right' }>>
): string {
  const table = tableFromObjects(results, columnConfig, caption);
  return renderTableOrThrow(table);
}

/**
 * Create a key-value properties table
 *
 * @example
 * ```typescript
 * const markdown = propertiesTable({
 *   'File Size': '2.5 MB',
 *   'Created': '2024-01-15',
 *   'Type': 'PDF Document',
 * }, 'File Properties');
 * ```
 */
export function propertiesTable(
  properties: Record<string, TableCellValue>,
  caption?: string
): string {
  const table = createTable();

  if (caption) {
    table.caption(caption);
  }

  table.column('property', 'Property');
  table.column('value', 'Value');

  for (const [key, value] of Object.entries(properties)) {
    table.row(key, value);
  }

  return renderTableOrThrow(table.build());
}

// Re-export core utilities for convenience
export { createTable, tableFromObjects, comparisonTable, validateAndRender, renderTable, renderTableOrThrow };
