/**
 * Table Builder
 *
 * Fluent API for constructing tables programmatically.
 * Useful for tools and agents that need to emit structured tables.
 */

import type {
  TableData,
  TableSchema,
  TableColumn,
  TableRow,
  TableCellValue,
  TableRenderOptions,
  TableBuilder,
  TableRenderResult,
} from './types';
import { renderTable } from './renderer';
import { validateTable } from './validator';

/**
 * Create a new table builder
 *
 * @example
 * ```typescript
 * const result = createTable()
 *   .caption('User Comparison')
 *   .column('name', 'Name')
 *   .column('role', 'Role', 'left')
 *   .column('score', 'Score', 'right')
 *   .row('Alice', 'Admin', 95)
 *   .row('Bob', 'User', 87)
 *   .render();
 * ```
 */
export function createTable(): TableBuilder {
  const columns: TableColumn[] = [];
  const rows: TableRow[] = [];
  let tableCaption: string | undefined;

  const builder: TableBuilder = {
    caption(caption: string) {
      tableCaption = caption;
      return builder;
    },

    column(id: string, header: string, align?: 'left' | 'center' | 'right') {
      columns.push({ id, header, align });
      return builder;
    },

    row(...cells: TableCellValue[]) {
      rows.push(cells);
      return builder;
    },

    build(): TableData {
      return {
        schema: { columns },
        rows,
        caption: tableCaption,
      };
    },

    render(options?: TableRenderOptions): TableRenderResult {
      return renderTable(builder.build(), options);
    },
  };

  return builder;
}

/**
 * Create a table from an array of objects
 *
 * Automatically infers columns from object keys.
 * Useful for converting tool outputs to tables.
 *
 * @param data - Array of objects with consistent keys
 * @param columnConfig - Optional column configuration (headers, alignment)
 * @param caption - Optional table caption
 *
 * @example
 * ```typescript
 * const users = [
 *   { name: 'Alice', role: 'Admin', score: 95 },
 *   { name: 'Bob', role: 'User', score: 87 },
 * ];
 *
 * const table = tableFromObjects(users, {
 *   name: { header: 'User Name' },
 *   score: { header: 'Score', align: 'right' },
 * });
 * ```
 */
export function tableFromObjects<T extends Record<string, TableCellValue>>(
  data: T[],
  columnConfig?: Partial<Record<keyof T, { header?: string; align?: 'left' | 'center' | 'right' }>>,
  caption?: string
): TableData {
  if (!data || data.length === 0) {
    return {
      schema: { columns: [] },
      rows: [],
      caption,
    };
  }

  // Extract column IDs from first object
  const columnIds = Object.keys(data[0]) as (keyof T)[];

  // Build column definitions
  const columns: TableColumn[] = columnIds.map(id => ({
    id: String(id),
    header: columnConfig?.[id]?.header ?? formatColumnHeader(String(id)),
    align: columnConfig?.[id]?.align,
  }));

  // Build rows
  const rows: TableRow[] = data.map(obj =>
    columnIds.map(id => obj[id])
  );

  return {
    schema: { columns },
    rows,
    caption,
  };
}

/**
 * Format a column ID as a display header
 * e.g., "user_name" -> "User Name", "firstName" -> "First Name"
 */
function formatColumnHeader(id: string): string {
  return id
    // Handle snake_case
    .replace(/_/g, ' ')
    // Handle camelCase
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // Capitalize each word
    .replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * Create a comparison table with a fixed structure
 *
 * Useful for side-by-side comparisons (features, trade-offs, etc.)
 *
 * @example
 * ```typescript
 * const table = comparisonTable(
 *   'Feature Comparison',
 *   ['Feature', 'Option A', 'Option B'],
 *   [
 *     ['Price', '$10/mo', '$20/mo'],
 *     ['Storage', '10 GB', '100 GB'],
 *     ['Support', 'Email', '24/7 Phone'],
 *   ]
 * );
 * ```
 */
export function comparisonTable(
  caption: string,
  headers: string[],
  rows: TableRow[]
): TableData {
  const columns: TableColumn[] = headers.map((header, index) => ({
    id: `col_${index}`,
    header,
    align: index === 0 ? 'left' : 'center',
  }));

  return {
    schema: { columns },
    rows,
    caption,
  };
}

/**
 * Validate and render a table in one step
 *
 * @param table - Table data to validate and render
 * @param maxRetries - Maximum attempts if validation fails
 * @param onRetry - Callback for retry attempts (for agent regeneration)
 * @returns Render result
 */
export async function validateAndRender(
  table: TableData,
  maxRetries: number = 0,
  onRetry?: (errors: string[], attempt: number) => Promise<TableData>
): Promise<TableRenderResult> {
  let currentTable = table;
  let attempt = 0;

  while (attempt <= maxRetries) {
    const result = renderTable(currentTable);

    if (result.success) {
      return result;
    }

    // If no retry callback or max retries reached, return the failed result
    if (!onRetry || attempt >= maxRetries) {
      return result;
    }

    // Attempt regeneration
    attempt++;
    try {
      currentTable = await onRetry(result.validation.errors, attempt);
    } catch {
      // If regeneration fails, return the original error
      return result;
    }
  }

  // This shouldn't be reached, but TypeScript needs it
  return renderTable(currentTable);
}
