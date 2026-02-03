/**
 * Markdown Table to Table IR Parser
 *
 * Converts GFM markdown tables to Table IR format for interactive rendering.
 * This is a transitional adapter that enables Table IR features without
 * requiring backend changes.
 *
 * @see .cursor/rules/table-ir-contract.mdc
 */

import type { TableIR, TableIRColumn, TableIRRow, TableIRDataType, TableCellValue } from '@mark/shared';

/**
 * Regex pattern to match a complete GFM markdown table.
 * Captures: header row, separator row, and data rows.
 */
const MARKDOWN_TABLE_PATTERN = /(?:^|\n)((?:\|[^\n]+\|)\n(?:\|[\s:|-]+\|)\n(?:(?:\|[^\n]+\|\n?)+))/gm;

/**
 * Parse a single row of a markdown table into cells.
 */
function parseTableRow(row: string): string[] {
  // Remove leading/trailing pipes and split by |
  const trimmed = row.trim().replace(/^\||\|$/g, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

/**
 * Infer the data type of a cell value.
 */
function inferDataType(values: string[]): TableIRDataType {
  // Sample non-empty values
  const samples = values.filter((v) => v && v.trim() !== '').slice(0, 10);
  if (samples.length === 0) return 'string';

  // Check if all values are numbers
  const allNumbers = samples.every((v) => !isNaN(Number(v.replace(/,/g, ''))));
  if (allNumbers) return 'number';

  // Check if all values are booleans
  const boolValues = ['true', 'false', 'yes', 'no'];
  const allBooleans = samples.every((v) => boolValues.includes(v.toLowerCase()));
  if (allBooleans) return 'boolean';

  // Check if all values look like dates
  const datePattern = /^\d{4}-\d{2}-\d{2}|^\w+\s+\d{1,2},?\s+\d{4}|^\d{1,2}\/\d{1,2}\/\d{2,4}/;
  const allDates = samples.every((v) => datePattern.test(v) || !isNaN(Date.parse(v)));
  if (allDates && samples.some((v) => datePattern.test(v))) return 'date';

  // Check if all values are URLs
  const urlPattern = /^https?:\/\//;
  const allUrls = samples.every((v) => urlPattern.test(v));
  if (allUrls) return 'url';

  return 'string';
}

/**
 * Convert a cell string to typed value based on dataType.
 */
function parseValue(value: string, dataType: TableIRDataType): TableCellValue {
  if (!value || value.trim() === '') return null;

  switch (dataType) {
    case 'number':
      const num = Number(value.replace(/,/g, ''));
      return isNaN(num) ? value : num;
    case 'boolean':
      return ['true', 'yes'].includes(value.toLowerCase());
    default:
      return value;
  }
}

/**
 * Parse a markdown table string into Table IR format.
 */
export function parseMarkdownTable(tableMarkdown: string): TableIR | null {
  const lines = tableMarkdown.trim().split('\n').filter((line) => line.trim());

  if (lines.length < 3) return null; // Need at least header, separator, and one data row

  // Parse header row
  const headers = parseTableRow(lines[0]);

  // Validate separator row (should contain only |, -, :, and spaces)
  const separatorLine = lines[1];
  if (!/^\|[\s:|-]+\|$/.test(separatorLine.trim())) return null;

  // Parse data rows
  const dataRows = lines.slice(2).map(parseTableRow);

  // Build column values for type inference
  const columnValues: string[][] = headers.map((_, colIndex) =>
    dataRows.map((row) => row[colIndex] || '')
  );

  // Infer data types for each column
  const dataTypes = columnValues.map(inferDataType);

  // Build Table IR columns
  const columns: TableIRColumn[] = headers.map((header, index) => ({
    key: `col_${index}`,
    label: header,
    dataType: dataTypes[index],
    sortable: true, // Enable sorting for all columns
    filterable: false, // Phase 1: sorting only
  }));

  // Build Table IR rows
  const data: TableIRRow[] = dataRows.map((row) => {
    const rowData: TableIRRow = {};
    headers.forEach((_, colIndex) => {
      rowData[`col_${colIndex}`] = parseValue(row[colIndex] || '', dataTypes[colIndex]);
    });
    return rowData;
  });

  return {
    schema: { columns },
    data,
  };
}

export interface ParsedContent {
  /** Segments of content (text or table) */
  segments: Array<
    | { type: 'text'; content: string }
    | { type: 'table'; table: TableIR }
  >;
  /** Whether any tables were found */
  hasTables: boolean;
}

/**
 * Parse message content and extract markdown tables as Table IR.
 * Returns segments of text and tables for mixed rendering.
 */
export function parseContentWithTables(content: string): ParsedContent {
  const segments: ParsedContent['segments'] = [];
  let lastIndex = 0;
  let hasTables = false;

  // Reset regex state
  MARKDOWN_TABLE_PATTERN.lastIndex = 0;

  let match;
  while ((match = MARKDOWN_TABLE_PATTERN.exec(content)) !== null) {
    const tableMarkdown = match[1];
    const tableStart = match.index + (match[0].startsWith('\n') ? 1 : 0);

    // Add text before the table
    if (tableStart > lastIndex) {
      const textContent = content.slice(lastIndex, tableStart).trim();
      if (textContent) {
        segments.push({ type: 'text', content: textContent });
      }
    }

    // Parse the table
    const tableIR = parseMarkdownTable(tableMarkdown);
    if (tableIR) {
      segments.push({ type: 'table', table: tableIR });
      hasTables = true;
    } else {
      // Failed to parse - keep as text
      segments.push({ type: 'text', content: tableMarkdown });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last table
  if (lastIndex < content.length) {
    const textContent = content.slice(lastIndex).trim();
    if (textContent) {
      segments.push({ type: 'text', content: textContent });
    }
  }

  // If no tables found, return entire content as text
  if (segments.length === 0 && content.trim()) {
    segments.push({ type: 'text', content: content });
  }

  return { segments, hasTables };
}
