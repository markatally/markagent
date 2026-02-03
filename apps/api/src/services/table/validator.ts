/**
 * Table Validator
 *
 * Validates table structure before rendering to ensure:
 * - Column count matches across header, separator, and all rows
 * - No empty tables (at least one column required)
 * - Cell values are valid types
 */

import type {
  TableData,
  TableSchema,
  TableRow,
  TableCellValue,
  TableValidationResult,
} from './types';

/**
 * Maximum allowed columns and rows to prevent abuse
 */
const LIMITS = {
  maxColumns: 20,
  maxRows: 1000,
  maxCellLength: 1000,
} as const;

/**
 * Validate a single cell value
 */
function validateCell(value: TableCellValue, columnIndex: number, rowIndex: number): string[] {
  const errors: string[] = [];

  // Check type
  if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    errors.push(`Row ${rowIndex + 1}, column ${columnIndex + 1}: invalid cell type "${typeof value}"`);
  }

  // Check string length
  if (typeof value === 'string' && value.length > LIMITS.maxCellLength) {
    errors.push(`Row ${rowIndex + 1}, column ${columnIndex + 1}: cell content exceeds ${LIMITS.maxCellLength} characters`);
  }

  // Check for line breaks (not allowed in table cells)
  if (typeof value === 'string' && (value.includes('\n') || value.includes('\r'))) {
    errors.push(`Row ${rowIndex + 1}, column ${columnIndex + 1}: cell content contains line breaks`);
  }

  return errors;
}

/**
 * Validate the table schema
 */
function validateSchema(schema: TableSchema): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!schema || !schema.columns) {
    errors.push('Table schema is missing or has no columns array');
    return { errors, warnings };
  }

  if (!Array.isArray(schema.columns)) {
    errors.push('Schema columns must be an array');
    return { errors, warnings };
  }

  if (schema.columns.length === 0) {
    errors.push('Table must have at least one column');
    return { errors, warnings };
  }

  if (schema.columns.length > LIMITS.maxColumns) {
    errors.push(`Table exceeds maximum of ${LIMITS.maxColumns} columns`);
    return { errors, warnings };
  }

  // Validate each column
  const seenIds = new Set<string>();
  for (let i = 0; i < schema.columns.length; i++) {
    const col = schema.columns[i];

    if (!col.id || typeof col.id !== 'string') {
      errors.push(`Column ${i + 1}: missing or invalid column id`);
    } else if (seenIds.has(col.id)) {
      errors.push(`Column ${i + 1}: duplicate column id "${col.id}"`);
    } else {
      seenIds.add(col.id);
    }

    if (!col.header || typeof col.header !== 'string') {
      errors.push(`Column ${i + 1}: missing or invalid header`);
    }

    if (col.align && !['left', 'center', 'right'].includes(col.align)) {
      warnings.push(`Column ${i + 1}: invalid alignment "${col.align}", defaulting to "left"`);
    }
  }

  return { errors, warnings };
}

/**
 * Validate a single row
 */
function validateRow(row: TableRow, expectedColumns: number, rowIndex: number): string[] {
  const errors: string[] = [];

  if (!Array.isArray(row)) {
    errors.push(`Row ${rowIndex + 1}: must be an array`);
    return errors;
  }

  if (row.length !== expectedColumns) {
    errors.push(
      `Row ${rowIndex + 1}: has ${row.length} cells but expected ${expectedColumns} (column count mismatch)`
    );
    return errors;
  }

  // Validate each cell
  for (let i = 0; i < row.length; i++) {
    errors.push(...validateCell(row[i], i, rowIndex));
  }

  return errors;
}

/**
 * Validate complete table data
 *
 * @param table - The table data to validate
 * @returns Validation result with errors and warnings
 */
export function validateTable(table: TableData): TableValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Basic structure check
  if (!table) {
    return {
      valid: false,
      errors: ['Table data is null or undefined'],
      warnings: [],
    };
  }

  // Validate schema
  const schemaResult = validateSchema(table.schema);
  errors.push(...schemaResult.errors);
  warnings.push(...schemaResult.warnings);

  // If schema is invalid, don't continue
  if (schemaResult.errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  const columnCount = table.schema.columns.length;

  // Validate rows
  if (!table.rows) {
    errors.push('Table rows array is missing');
  } else if (!Array.isArray(table.rows)) {
    errors.push('Table rows must be an array');
  } else {
    if (table.rows.length > LIMITS.maxRows) {
      errors.push(`Table exceeds maximum of ${LIMITS.maxRows} rows`);
    } else {
      for (let i = 0; i < table.rows.length; i++) {
        errors.push(...validateRow(table.rows[i], columnCount, i));
      }
    }

    // Warn if table is empty
    if (table.rows.length === 0) {
      warnings.push('Table has no data rows');
    }
  }

  // Validate caption if present
  if (table.caption !== undefined && typeof table.caption !== 'string') {
    errors.push('Table caption must be a string');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Check if a value is valid table data (type guard)
 */
export function isValidTableData(value: unknown): value is TableData {
  if (!value || typeof value !== 'object') return false;
  const table = value as TableData;
  return validateTable(table).valid;
}
