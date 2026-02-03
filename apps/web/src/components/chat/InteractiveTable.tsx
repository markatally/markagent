/**
 * InteractiveTable Component
 *
 * Renders Table IR data with client-side sorting support.
 * Implements the Table IR contract defined in .cursor/rules/table-ir-contract.mdc
 *
 * Key behaviors:
 * - Consumes Table IR as structured input (schema + data)
 * - Sorting is disabled during streaming (isStreaming=true)
 * - Sortable columns (sortable=true) show clickable headers when not streaming
 * - Sorting respects dataType for proper comparison (number, date, string, etc.)
 * - Original row order is preserved when no sort is active
 */

import { useState, useMemo, useCallback } from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import type { TableIR, TableIRColumn, TableCellValue } from '@mark/shared';
import { cn } from '../../lib/utils';

interface InteractiveTableProps {
  /** The Table IR data to render */
  table: TableIR;
  /** Whether the table is still being streamed (disables sorting) */
  isStreaming?: boolean;
}

type SortDirection = 'asc' | 'desc' | null;

interface SortState {
  columnKey: string | null;
  direction: SortDirection;
}

/**
 * Compare two cell values based on the column's dataType
 */
function compareValues(
  a: TableCellValue,
  b: TableCellValue,
  dataType: TableIRColumn['dataType'],
  direction: 'asc' | 'desc'
): number {
  // Handle null/undefined - always sort to end
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  let result = 0;

  switch (dataType) {
    case 'number':
      result = Number(a) - Number(b);
      break;

    case 'date':
    case 'datetime':
      // Parse as dates and compare timestamps
      const dateA = new Date(String(a)).getTime();
      const dateB = new Date(String(b)).getTime();
      result = dateA - dateB;
      break;

    case 'boolean':
      // true > false
      result = (a === true ? 1 : 0) - (b === true ? 1 : 0);
      break;

    case 'string':
    case 'text':
    case 'url':
    case 'enum':
    default:
      // Lexicographic string comparison (case-insensitive)
      result = String(a).toLowerCase().localeCompare(String(b).toLowerCase());
      break;
  }

  return direction === 'desc' ? -result : result;
}

/**
 * Format a cell value for display based on dataType
 */
function formatCellValue(value: TableCellValue, dataType: TableIRColumn['dataType']): string {
  if (value == null) return '';

  switch (dataType) {
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'date':
      try {
        return new Date(String(value)).toLocaleDateString();
      } catch {
        return String(value);
      }
    case 'datetime':
      try {
        return new Date(String(value)).toLocaleString();
      } catch {
        return String(value);
      }
    default:
      return String(value);
  }
}

export function InteractiveTable({ table, isStreaming = false }: InteractiveTableProps) {
  const [sortState, setSortState] = useState<SortState>({
    columnKey: null,
    direction: null,
  });

  const { schema, data, caption } = table;

  // Handle column header click for sorting
  const handleHeaderClick = useCallback(
    (column: TableIRColumn) => {
      // Sorting is completely disabled during streaming
      if (isStreaming) return;
      if (!column.sortable) return;

      setSortState((prev) => {
        if (prev.columnKey !== column.key) {
          // New column: start with ascending
          return { columnKey: column.key, direction: 'asc' };
        }
        // Same column: cycle through asc -> desc -> null
        if (prev.direction === 'asc') {
          return { columnKey: column.key, direction: 'desc' };
        }
        if (prev.direction === 'desc') {
          return { columnKey: null, direction: null };
        }
        return { columnKey: column.key, direction: 'asc' };
      });
    },
    [isStreaming]
  );

  // Sort the data based on current sort state
  const sortedData = useMemo(() => {
    if (!sortState.columnKey || !sortState.direction) {
      // No sort active: return original order
      return data;
    }

    const column = schema.columns.find((c) => c.key === sortState.columnKey);
    if (!column) return data;

    return [...data].sort((a, b) =>
      compareValues(
        a[sortState.columnKey!],
        b[sortState.columnKey!],
        column.dataType,
        sortState.direction!
      )
    );
  }, [data, schema.columns, sortState.columnKey, sortState.direction]);

  // Render sort indicator for a column
  const renderSortIndicator = (column: TableIRColumn) => {
    if (!column.sortable || isStreaming) return null;

    const isSorted = sortState.columnKey === column.key;
    const Icon = isSorted
      ? sortState.direction === 'asc'
        ? ArrowUp
        : ArrowDown
      : ArrowUpDown;

    return (
      <Icon
        className={cn(
          'ml-1 h-3 w-3 inline-block',
          isSorted ? 'text-foreground' : 'text-muted-foreground opacity-50'
        )}
      />
    );
  };

  return (
    <div className="my-1 w-full overflow-x-auto rounded-md border border-border">
      {caption && (
        <div className="px-4 py-2 bg-muted/30 border-b border-border font-medium text-sm">
          {caption}
        </div>
      )}
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted/50 border-b border-border">
          <tr>
            {schema.columns.map((column) => {
              const canSort = column.sortable && !isStreaming;
              return (
                <th
                  key={column.key}
                  onClick={() => handleHeaderClick(column)}
                  className={cn(
                    'px-4 py-3 font-semibold text-foreground whitespace-nowrap text-left',
                    canSort && 'cursor-pointer select-none hover:bg-muted/70 transition-colors',
                    !canSort && column.sortable && 'cursor-not-allowed opacity-70'
                  )}
                  title={
                    isStreaming && column.sortable
                      ? 'Sorting disabled while streaming'
                      : column.sortable
                      ? 'Click to sort'
                      : undefined
                  }
                >
                  {column.label}
                  {renderSortIndicator(column)}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sortedData.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className="transition-colors hover:bg-muted/30"
            >
              {schema.columns.map((column) => (
                <td
                  key={column.key}
                  className="px-4 py-3 text-muted-foreground"
                >
                  {formatCellValue(row[column.key], column.dataType)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {isStreaming && (
        <div className="px-4 py-2 bg-muted/20 border-t border-border text-xs text-muted-foreground">
          Loading table data...
        </div>
      )}
    </div>
  );
}
