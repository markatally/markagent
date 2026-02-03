/**
 * Table Rendering Module
 *
 * Provides structured table generation and rendering for the agent.
 * Enforces separation of concerns: LLM outputs structured data,
 * this module handles deterministic formatting.
 *
 * @example
 * ```typescript
 * import { createTable, renderTable, tableFromObjects } from './services/table';
 *
 * // Method 1: Builder pattern
 * const result = createTable()
 *   .caption('Results')
 *   .column('name', 'Name')
 *   .column('score', 'Score', 'right')
 *   .row('Alice', 95)
 *   .row('Bob', 87)
 *   .render();
 *
 * // Method 2: From objects
 * const data = [{ name: 'Alice', score: 95 }, { name: 'Bob', score: 87 }];
 * const table = tableFromObjects(data);
 * const markdown = renderTable(table);
 *
 * // Method 3: Direct structured data
 * const tableData = {
 *   schema: {
 *     columns: [
 *       { id: 'name', header: 'Name' },
 *       { id: 'score', header: 'Score', align: 'right' },
 *     ],
 *   },
 *   rows: [['Alice', 95], ['Bob', 87]],
 * };
 * const markdown = renderTable(tableData);
 * ```
 */

// Types
export type {
  TableData,
  TableSchema,
  TableColumn,
  TableRow,
  TableCellValue,
  TableValidationResult,
  TableRenderOptions,
  TableRenderResult,
  TableBuilder,
} from './types';

// Validation
export { validateTable, isValidTableData } from './validator';

// Rendering
export { renderTable, renderTableOrThrow } from './renderer';

// Builder utilities
export {
  createTable,
  tableFromObjects,
  comparisonTable,
  validateAndRender,
} from './builder';

// Agent utilities
export {
  TABLE_GENERATION_INSTRUCTIONS,
  parseTableBlocks,
  processAgentOutput,
  quickTable,
  resultsToTable,
  propertiesTable,
} from './agent-utils';
