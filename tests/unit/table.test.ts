/**
 * Table Renderer Tests
 *
 * Tests for the table rendering and validation system.
 */

import { describe, it, expect } from 'vitest';
import {
  validateTable,
  renderTable,
  renderTableOrThrow,
  createTable,
  tableFromObjects,
  comparisonTable,
  quickTable,
  resultsToTable,
  propertiesTable,
  processAgentOutput,
  isValidTableData,
} from '../../apps/api/src/services/table';
import type { TableData } from '../../apps/api/src/services/table';

describe('Table Validator', () => {
  it('should validate a correct table', () => {
    const table: TableData = {
      schema: {
        columns: [
          { id: 'name', header: 'Name' },
          { id: 'value', header: 'Value' },
        ],
      },
      rows: [
        ['Alice', 100],
        ['Bob', 200],
      ],
    };

    const result = validateTable(table);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject table with column count mismatch', () => {
    const table: TableData = {
      schema: {
        columns: [
          { id: 'name', header: 'Name' },
          { id: 'value', header: 'Value' },
        ],
      },
      rows: [
        ['Alice', 100],
        ['Bob'], // Missing a column
      ],
    };

    const result = validateTable(table);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('column count mismatch'))).toBe(true);
  });

  it('should reject cells with line breaks', () => {
    const table: TableData = {
      schema: {
        columns: [{ id: 'name', header: 'Name' }],
      },
      rows: [['Line1\nLine2']],
    };

    const result = validateTable(table);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('line breaks'))).toBe(true);
  });

  it('should reject empty tables (no columns)', () => {
    const table: TableData = {
      schema: { columns: [] },
      rows: [],
    };

    const result = validateTable(table);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('at least one column'))).toBe(true);
  });

  it('should warn about empty data rows', () => {
    const table: TableData = {
      schema: {
        columns: [{ id: 'name', header: 'Name' }],
      },
      rows: [],
    };

    const result = validateTable(table);
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('no data rows'))).toBe(true);
  });
});

describe('Table Renderer', () => {
  it('should render a basic table to markdown', () => {
    const table: TableData = {
      schema: {
        columns: [
          { id: 'name', header: 'Name' },
          { id: 'score', header: 'Score', align: 'right' },
        ],
      },
      rows: [
        ['Alice', 95],
        ['Bob', 87],
      ],
    };

    const result = renderTable(table);
    expect(result.success).toBe(true);
    expect(result.output).toContain('| Name | Score |');
    expect(result.output).toContain('| :--- | ---: |');
    expect(result.output).toContain('| Alice | 95 |');
    expect(result.output).toContain('| Bob | 87 |');
  });

  it('should include caption when present', () => {
    const table: TableData = {
      schema: {
        columns: [{ id: 'name', header: 'Name' }],
      },
      rows: [['Alice']],
      caption: 'User List',
    };

    const result = renderTable(table);
    expect(result.success).toBe(true);
    expect(result.output).toContain('**User List**');
  });

  it('should escape pipe characters in content', () => {
    const table: TableData = {
      schema: {
        columns: [{ id: 'expr', header: 'Expression' }],
      },
      rows: [['a | b']],
    };

    const result = renderTable(table);
    expect(result.success).toBe(true);
    expect(result.output).toContain('a \\| b');
  });

  it('should return error for invalid table', () => {
    const table: TableData = {
      schema: {
        columns: [{ id: 'a', header: 'A' }],
      },
      rows: [['a', 'b']], // Too many columns
    };

    const result = renderTable(table);
    expect(result.success).toBe(false);
    expect(result.validation.errors.length).toBeGreaterThan(0);
  });

  it('should throw on invalid table with renderTableOrThrow', () => {
    const table: TableData = {
      schema: { columns: [] },
      rows: [],
    };

    expect(() => renderTableOrThrow(table)).toThrow();
  });
});

describe('Table Builder', () => {
  it('should build a table using fluent API', () => {
    const result = createTable()
      .caption('Test Table')
      .column('name', 'Name')
      .column('score', 'Score', 'right')
      .row('Alice', 95)
      .row('Bob', 87)
      .render();

    expect(result.success).toBe(true);
    expect(result.output).toContain('**Test Table**');
    expect(result.output).toContain('| Name | Score |');
  });

  it('should create table from objects', () => {
    const data = [
      { name: 'Alice', score: 95 },
      { name: 'Bob', score: 87 },
    ];

    const table = tableFromObjects(data);
    const result = renderTable(table);

    expect(result.success).toBe(true);
    expect(result.output).toContain('| Name | Score |');
  });

  it('should create comparison table', () => {
    const table = comparisonTable(
      'Options',
      ['Feature', 'A', 'B'],
      [
        ['Price', '$10', '$20'],
        ['Size', 'Small', 'Large'],
      ]
    );

    const result = renderTable(table);
    expect(result.success).toBe(true);
    expect(result.output).toContain('**Options**');
    expect(result.output).toContain('| Feature | A | B |');
  });
});

describe('Agent Utilities', () => {
  it('should render quick table', () => {
    const markdown = quickTable(
      ['A', 'B'],
      [
        [1, 2],
        [3, 4],
      ]
    );

    expect(markdown).toContain('| A | B |');
    expect(markdown).toContain('| 1 | 2 |');
  });

  it('should render results to table', () => {
    const results = [
      { title: 'Result 1', score: 0.95 },
      { title: 'Result 2', score: 0.87 },
    ];

    const markdown = resultsToTable(results, 'Search Results');
    expect(markdown).toContain('**Search Results**');
    expect(markdown).toContain('| Title | Score |');
  });

  it('should render properties table', () => {
    const markdown = propertiesTable({
      Name: 'test.txt',
      Size: '1.5 KB',
    });

    expect(markdown).toContain('| Property | Value |');
    expect(markdown).toContain('| Name | test.txt |');
    expect(markdown).toContain('| Size | 1.5 KB |');
  });

  it('should process agent output with table JSON', () => {
    const input = `Here's the data:

\`\`\`json
{
  "type": "table",
  "caption": "Results",
  "columns": [
    { "id": "name", "header": "Name" },
    { "id": "value", "header": "Value" }
  ],
  "rows": [
    ["Alice", 100],
    ["Bob", 200]
  ]
}
\`\`\`

That's all.`;

    const output = processAgentOutput(input);

    // Should have replaced JSON with rendered table
    expect(output).toContain('**Results**');
    expect(output).toContain('| Name | Value |');
    expect(output).toContain("Here's the data:");
    expect(output).toContain("That's all.");
    // Should NOT contain the raw JSON
    expect(output).not.toContain('"type": "table"');
  });

  it('should handle invalid table JSON gracefully', () => {
    const input = `\`\`\`json
{
  "type": "table",
  "invalid": true
}
\`\`\``;

    const output = processAgentOutput(input);
    // Should keep original since it's invalid
    expect(output).toBe(input);
  });
});

describe('Type Guards', () => {
  it('should identify valid table data', () => {
    const valid: TableData = {
      schema: {
        columns: [{ id: 'a', header: 'A' }],
      },
      rows: [['value']],
    };

    expect(isValidTableData(valid)).toBe(true);
    expect(isValidTableData(null)).toBe(false);
    expect(isValidTableData({})).toBe(false);
    expect(isValidTableData({ schema: {} })).toBe(false);
  });
});
