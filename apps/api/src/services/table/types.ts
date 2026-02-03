/**
 * Table Renderer Types
 *
 * Internal types for table rendering and validation.
 * Public types are re-exported from @mark/shared.
 */

import type {
  TableData,
  TableSchema,
  TableColumn,
  TableRow,
  TableCellValue,
  TableValidationResult,
  TableRenderOptions,
} from '@mark/shared';

// Re-export shared types for convenience
export type {
  TableData,
  TableSchema,
  TableColumn,
  TableRow,
  TableCellValue,
  TableValidationResult,
  TableRenderOptions,
};

/**
 * Internal validation context
 */
export interface ValidationContext {
  /** Expected column count */
  columnCount: number;
  /** Column IDs for error messages */
  columnIds: string[];
  /** Row index being validated */
  rowIndex?: number;
}

/**
 * Table rendering result
 */
export interface TableRenderResult {
  /** The rendered output (e.g., Markdown string) */
  output: string;
  /** Whether rendering succeeded */
  success: boolean;
  /** Validation result */
  validation: TableValidationResult;
}

/**
 * Builder pattern for creating tables programmatically
 */
export interface TableBuilder {
  /** Set the table caption */
  caption(caption: string): TableBuilder;
  /** Add a column definition */
  column(id: string, header: string, align?: 'left' | 'center' | 'right'): TableBuilder;
  /** Add a row of data */
  row(...cells: TableCellValue[]): TableBuilder;
  /** Build and validate the table */
  build(): TableData;
  /** Build, validate, and render to Markdown */
  render(options?: TableRenderOptions): TableRenderResult;
}
