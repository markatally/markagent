/**
 * Table Renderer
 *
 * Converts structured TableData to formatted Markdown tables.
 * Implements separation of concerns: LLM outputs structured data,
 * this renderer handles deterministic formatting.
 */

import type {
  TableData,
  TableCellValue,
  TableRenderOptions,
  TableRenderResult,
} from './types';
import { validateTable } from './validator';

/**
 * Default render options
 */
const DEFAULT_OPTIONS: Required<TableRenderOptions> = {
  format: 'markdown',
  includeCaption: true,
  escapePipes: true,
};

/**
 * Escape special characters in cell content for Markdown tables
 */
function escapeCellContent(value: TableCellValue, escapePipes: boolean): string {
  if (value === null || value === undefined) {
    return '';
  }

  let str = String(value);

  // Remove any line breaks (should be caught by validation, but be safe)
  str = str.replace(/[\r\n]+/g, ' ');

  // Escape pipe characters if enabled
  if (escapePipes) {
    str = str.replace(/\|/g, '\\|');
  }

  // Trim whitespace
  str = str.trim();

  return str;
}

/**
 * Get the alignment indicator for a column separator
 */
function getAlignmentSeparator(align?: 'left' | 'center' | 'right'): string {
  switch (align) {
    case 'center':
      return ':---:';
    case 'right':
      return '---:';
    case 'left':
    default:
      return ':---';
  }
}

/**
 * Render a single row to Markdown
 */
function renderRow(cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}

/**
 * Render table data to Markdown format
 *
 * @param table - Validated table data
 * @param options - Render options
 * @returns Markdown string
 */
function renderToMarkdown(table: TableData, options: Required<TableRenderOptions>): string {
  const lines: string[] = [];

  // Add caption if present and enabled
  if (options.includeCaption && table.caption) {
    lines.push(`**${table.caption}**`);
    lines.push('');
  }

  // Render header row
  const headers = table.schema.columns.map(col =>
    escapeCellContent(col.header, options.escapePipes)
  );
  lines.push(renderRow(headers));

  // Render separator row with alignment
  const separators = table.schema.columns.map(col => getAlignmentSeparator(col.align));
  lines.push(`| ${separators.join(' | ')} |`);

  // Render data rows
  for (const row of table.rows) {
    const cells = row.map(cell => escapeCellContent(cell, options.escapePipes));
    lines.push(renderRow(cells));
  }

  return lines.join('\n');
}

/**
 * Render structured table data to the specified format
 *
 * This is the main entry point for table rendering.
 * Validates the table and returns the rendered output.
 *
 * @param table - The table data to render
 * @param options - Optional render configuration
 * @returns Render result with output and validation info
 */
export function renderTable(
  table: TableData,
  options?: TableRenderOptions
): TableRenderResult {
  const opts: Required<TableRenderOptions> = { ...DEFAULT_OPTIONS, ...options };

  // Validate first
  const validation = validateTable(table);

  if (!validation.valid) {
    return {
      output: '',
      success: false,
      validation,
    };
  }

  // Render based on format
  let output: string;
  switch (opts.format) {
    case 'markdown':
    default:
      output = renderToMarkdown(table, opts);
  }

  return {
    output,
    success: true,
    validation,
  };
}

/**
 * Convenience function to render a table or throw on validation error
 *
 * @param table - The table data to render
 * @param options - Optional render configuration
 * @returns Rendered Markdown string
 * @throws Error if validation fails
 */
export function renderTableOrThrow(
  table: TableData,
  options?: TableRenderOptions
): string {
  const result = renderTable(table, options);

  if (!result.success) {
    throw new Error(`Table validation failed: ${result.validation.errors.join('; ')}`);
  }

  return result.output;
}
