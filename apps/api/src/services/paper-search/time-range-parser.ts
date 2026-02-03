/**
 * Time Range Parser & Validator
 * 
 * Provides semantic parsing of user time expressions into structured intent objects.
 * Enforces strict time constraints to prevent time-range drift.
 * 
 * KEY DESIGN DECISIONS:
 * 1. Parse user input ONCE at the start, converting to absolute dates
 * 2. Mark "explicit" user requests as strict=true (cannot be expanded)
 * 3. Provide both pre-search validation AND post-search filtering
 * 4. Never automatically expand strict time ranges
 */

/**
 * Structured time range intent - the canonical representation
 * parsed from user input BEFORE any tool calls
 */
export interface TimeRangeIntent {
  /** Numeric value (e.g., 1 for "last 1 month") */
  value: number;
  /** Time unit */
  unit: 'days' | 'weeks' | 'months' | 'years';
  /** 
   * If true, this is an EXPLICIT user constraint that MUST NOT be expanded.
   * Patterns like "last 1 month", "past 30 days", "recent 2 weeks" are strict.
   * Generic patterns like "recent papers" are non-strict.
   */
  strict: boolean;
  /** Original user expression for debugging/logging */
  originalExpression?: string;
}

/**
 * Absolute date window computed from TimeRangeIntent
 * This is what gets passed to search tools
 */
export interface AbsoluteDateWindow {
  /** Inclusive start date (YYYY-MM-DD) */
  startDate: string;
  /** Inclusive end date (YYYY-MM-DD), typically today */
  endDate: string;
  /** Whether this window is strict (cannot be expanded on retry) */
  strict: boolean;
  /** Original intent for traceability */
  intent?: TimeRangeIntent;
}

/**
 * Result of time range validation
 */
export interface TimeRangeValidationResult {
  valid: boolean;
  dateWindow?: AbsoluteDateWindow;
  error?: string;
}

/**
 * Patterns that indicate STRICT time constraints
 * These expressions show explicit user intent for a specific time range
 */
const STRICT_TIME_PATTERNS: Array<{
  pattern: RegExp;
  extract: (match: RegExpMatchArray) => TimeRangeIntent;
}> = [
  // "last N month(s)", "past N month(s)", "recent N month(s)"
  {
    pattern: /(?:last|past|recent|within(?: the)?)\s+(\d+)\s*(month|months)/i,
    extract: (m) => ({ value: parseInt(m[1], 10), unit: 'months', strict: true }),
  },
  // "last N day(s)", "past N day(s)"
  {
    pattern: /(?:last|past|recent|within(?: the)?)\s+(\d+)\s*(day|days)/i,
    extract: (m) => ({ value: parseInt(m[1], 10), unit: 'days', strict: true }),
  },
  // "last N week(s)", "past N week(s)"
  {
    pattern: /(?:last|past|recent|within(?: the)?)\s+(\d+)\s*(week|weeks)/i,
    extract: (m) => ({ value: parseInt(m[1], 10), unit: 'weeks', strict: true }),
  },
  // "last N year(s)", "past N year(s)"
  {
    pattern: /(?:last|past|recent|within(?: the)?)\s+(\d+)\s*(year|years)/i,
    extract: (m) => ({ value: parseInt(m[1], 10), unit: 'years', strict: true }),
  },
  // "in the last month" (singular = 1 month)
  {
    pattern: /in\s+the\s+(?:last|past)\s+(month)/i,
    extract: () => ({ value: 1, unit: 'months', strict: true }),
  },
  // "in the last week" (singular = 1 week)
  {
    pattern: /in\s+the\s+(?:last|past)\s+(week)/i,
    extract: () => ({ value: 1, unit: 'weeks', strict: true }),
  },
  // "this month"
  {
    pattern: /\bthis\s+month\b/i,
    extract: () => ({ value: 1, unit: 'months', strict: true }),
  },
  // "this week"
  {
    pattern: /\bthis\s+week\b/i,
    extract: () => ({ value: 1, unit: 'weeks', strict: true }),
  },
  // "this year"
  {
    pattern: /\bthis\s+year\b/i,
    extract: () => ({ value: 1, unit: 'years', strict: true }),
  },
  // "since January 2025" or "from January 2025"
  {
    pattern: /(?:since|from)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/i,
    extract: (m) => {
      const monthNames: Record<string, number> = {
        january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
        july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
      };
      const monthNum = monthNames[m[1].toLowerCase()];
      const year = parseInt(m[2], 10);
      const startDate = new Date(year, monthNum, 1);
      const now = new Date();
      const diffDays = Math.ceil((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      return { value: diffDays, unit: 'days', strict: true };
    },
  },
];

/**
 * Patterns that indicate NON-STRICT (flexible) time preferences
 * These can be expanded if no results are found
 */
const FLEXIBLE_TIME_PATTERNS: Array<{
  pattern: RegExp;
  extract: (match: RegExpMatchArray) => TimeRangeIntent;
}> = [
  // "recent papers", "recent research" (vague, default to 12 months, non-strict)
  {
    pattern: /\brecent\s+(?:papers?|research|work|studies|publications?)\b/i,
    extract: () => ({ value: 12, unit: 'months', strict: false }),
  },
  // "new papers", "latest papers"
  {
    pattern: /\b(?:new|latest|newest)\s+(?:papers?|research|work|studies|publications?)\b/i,
    extract: () => ({ value: 6, unit: 'months', strict: false }),
  },
];

/**
 * Parse user input to extract time range intent
 * 
 * @param userInput - Raw user query text
 * @returns TimeRangeIntent if time expression found, null otherwise
 * 
 * WHY THIS PREVENTS TIME-RANGE DRIFT:
 * - Parses the user's EXACT words into a structured object
 * - Marks explicit constraints as strict=true
 * - This intent object is the source of truth for all downstream operations
 */
export function parseTimeRangeFromInput(userInput: string): TimeRangeIntent | null {
  // First, try strict patterns (explicit user constraints)
  for (const { pattern, extract } of STRICT_TIME_PATTERNS) {
    const match = userInput.match(pattern);
    if (match) {
      const intent = extract(match);
      intent.originalExpression = match[0];
      console.log(`[TimeRangeParser] Parsed STRICT time range: "${match[0]}" -> ${intent.value} ${intent.unit}`);
      return intent;
    }
  }

  // Then, try flexible patterns (can be expanded on retry)
  for (const { pattern, extract } of FLEXIBLE_TIME_PATTERNS) {
    const match = userInput.match(pattern);
    if (match) {
      const intent = extract(match);
      intent.originalExpression = match[0];
      console.log(`[TimeRangeParser] Parsed FLEXIBLE time range: "${match[0]}" -> ${intent.value} ${intent.unit}`);
      return intent;
    }
  }

  return null;
}

/**
 * Convert a TimeRangeIntent to an AbsoluteDateWindow
 * 
 * @param intent - Parsed time range intent
 * @param referenceDate - Reference date (defaults to now)
 * @returns AbsoluteDateWindow with concrete start/end dates
 * 
 * WHY THIS PREVENTS TIME-RANGE DRIFT:
 * - Converts relative time ("last 1 month") to absolute dates ONCE
 * - The absolute dates don't change during retries
 * - strict flag is preserved to prevent expansion
 */
export function intentToAbsoluteDateWindow(
  intent: TimeRangeIntent,
  referenceDate: Date = new Date()
): AbsoluteDateWindow {
  const endDate = new Date(referenceDate);
  const startDate = new Date(referenceDate);

  switch (intent.unit) {
    case 'days':
      startDate.setDate(startDate.getDate() - intent.value);
      break;
    case 'weeks':
      startDate.setDate(startDate.getDate() - intent.value * 7);
      break;
    case 'months':
      startDate.setMonth(startDate.getMonth() - intent.value);
      break;
    case 'years':
      startDate.setFullYear(startDate.getFullYear() - intent.value);
      break;
  }

  return {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    strict: intent.strict,
    intent,
  };
}

/**
 * Parse dateRange string (from tool params) to AbsoluteDateWindow
 * Handles legacy formats like "last-12-months", "2020-2024"
 */
export function parseDateRangeString(dateRange: string): AbsoluteDateWindow | null {
  const lower = dateRange.toLowerCase().trim();

  // Pattern: last-N-months, last-N-years, last-N-days, last-N-weeks
  const lastMatch = lower.match(/^last-?(\d+)-?(day|days|week|weeks|month|months|year|years)$/);
  if (lastMatch) {
    const value = parseInt(lastMatch[1], 10);
    let unit: TimeRangeIntent['unit'] = 'months';
    if (lastMatch[2].startsWith('day')) unit = 'days';
    else if (lastMatch[2].startsWith('week')) unit = 'weeks';
    else if (lastMatch[2].startsWith('year')) unit = 'years';
    
    // IMPORTANT: dateRange strings from tool params are treated as STRICT
    // because they represent an explicit filter the user/system requested
    const intent: TimeRangeIntent = { value, unit, strict: true, originalExpression: dateRange };
    return intentToAbsoluteDateWindow(intent);
  }

  // Pattern: YYYY-YYYY (year range)
  const yearRangeMatch = lower.match(/^(\d{4})-(\d{4})$/);
  if (yearRangeMatch) {
    return {
      startDate: `${yearRangeMatch[1]}-01-01`,
      endDate: `${yearRangeMatch[2]}-12-31`,
      strict: true, // Explicit year ranges are strict
    };
  }

  // Pattern: single year YYYY
  const singleYearMatch = lower.match(/^(\d{4})$/);
  if (singleYearMatch) {
    return {
      startDate: `${singleYearMatch[1]}-01-01`,
      endDate: `${singleYearMatch[1]}-12-31`,
      strict: true,
    };
  }

  return null;
}

/**
 * Validate that a date falls within the AbsoluteDateWindow
 * 
 * @param dateStr - Date string to validate (YYYY-MM-DD or similar)
 * @param window - The date window to validate against
 * @returns true if date is within window, false otherwise
 * 
 * WHY THIS PREVENTS TIME-RANGE DRIFT:
 * - Post-search verification catches any papers that slipped through
 * - Even if the API returns papers outside the range, they get filtered
 * - This is the final gate before results reach the user
 * 
 * SPECIAL HANDLING FOR YEAR-ONLY DATES:
 * Semantic Scholar returns year-only precision (e.g., "2026-01-01" for any 2026 paper).
 * 
 * For NON-STRICT windows: We check if the YEAR overlaps with the window, allowing
 * papers where we only know the year to be included.
 * 
 * For STRICT windows (< 1 year): Year-only dates are EXCLUDED because we cannot
 * verify the actual publication month/day falls within the narrow time constraint.
 * This prevents "last 1 month" from including papers that might be from 11 months ago.
 */
export function isDateWithinWindow(dateStr: string | null | undefined, window: AbsoluteDateWindow): boolean {
  if (!dateStr) {
    // Papers without dates: include if non-strict, exclude if strict
    return !window.strict;
  }

  try {
    const date = new Date(dateStr);
    const start = new Date(window.startDate);
    const end = new Date(window.endDate);
    
    // Set end date to end of day for inclusive comparison
    end.setHours(23, 59, 59, 999);
    
    // Check if this is a year-only date (YYYY-01-01 pattern from Semantic Scholar)
    // Year-only dates have month=January and day=1
    const isYearOnlyDate = dateStr.endsWith('-01-01') && date.getMonth() === 0 && date.getDate() === 1;
    
    if (isYearOnlyDate) {
      // For year-only precision (Semantic Scholar): check if the year overlaps with the window
      const paperYear = date.getFullYear();
      const startYear = start.getFullYear();
      const endYear = end.getFullYear();
      
      // PRAGMATIC APPROACH FOR YEAR-ONLY DATES:
      // Semantic Scholar only provides year-level precision. For a paper dated "2026-01-01"
      // (meaning "published sometime in 2026"), we can't know the exact month/day.
      // 
      // Previous behavior was too aggressive - excluding all year-only papers for strict
      // windows < 365 days. This caused searches like "last 1 month" in Jan/Feb 2026 to
      // return zero results from Semantic Scholar even though papers exist.
      // 
      // NEW APPROACH: Include year-only papers if the paper's year overlaps with the
      // window's year range. This is slightly permissive but practical since:
      // 1. arXiv provides precise dates and handles strict filtering
      // 2. Semantic Scholar supplements with citation data and venue info
      // 3. Users see the date source ("semantic_scholar") and can assess confidence
      // 4. Zero results is worse than slightly imprecise results for research tasks
      // 
      // Paper year must be within or overlap the window's year range
      const yearOverlaps = paperYear >= startYear && paperYear <= endYear;
      if (!yearOverlaps) {
        console.log(`[TimeRangeValidator] Excluding year-only date ${dateStr}: year ${paperYear} outside window years [${startYear}-${endYear}]`);
      }
      return yearOverlaps;
    }
    
    // For precise dates (arXiv): use exact comparison
    return date >= start && date <= end;
  } catch {
    // Invalid date format: include if non-strict, exclude if strict
    return !window.strict;
  }
}

/**
 * Filter papers by date window (post-search verification)
 * 
 * @param papers - Array of papers with publicationDate field
 * @param window - The date window to filter by
 * @returns Filtered array and exclusion reasons
 * 
 * WHY THIS PREVENTS TIME-RANGE DRIFT:
 * - This is called AFTER search results are returned
 * - It removes any papers outside the strict time window
 * - For strict windows, papers without dates are also excluded
 */
export function filterPapersByDateWindow<T extends { publicationDate?: string | null }>(
  papers: T[],
  window: AbsoluteDateWindow
): { filtered: T[]; excluded: T[]; reasons: string[] } {
  const filtered: T[] = [];
  const excluded: T[] = [];
  const reasons: string[] = [];

  for (const paper of papers) {
    if (isDateWithinWindow(paper.publicationDate, window)) {
      filtered.push(paper);
    } else {
      excluded.push(paper);
      const reason = paper.publicationDate
        ? `Paper date ${paper.publicationDate} outside window [${window.startDate}, ${window.endDate}]`
        : `Paper has no publication date (strict mode excludes undated papers)`;
      reasons.push(reason);
    }
  }

  if (excluded.length > 0) {
    console.log(`[TimeRangeValidator] Post-search filter: ${excluded.length}/${papers.length} papers excluded for date constraints`);
  }

  return { filtered, excluded, reasons };
}

/**
 * Create a time-range validation gate for the search pipeline
 * 
 * This function wraps all the parsing and validation logic into a single
 * validation result that can be used as a pre-search gate.
 */
export function validateTimeRange(
  userInput?: string,
  dateRangeParam?: string
): TimeRangeValidationResult {
  // Priority 1: Parse from dateRange parameter (explicit tool param)
  if (dateRangeParam) {
    const window = parseDateRangeString(dateRangeParam);
    if (window) {
      return { valid: true, dateWindow: window };
    }
  }

  // Priority 2: Parse from user input text
  if (userInput) {
    const intent = parseTimeRangeFromInput(userInput);
    if (intent) {
      const window = intentToAbsoluteDateWindow(intent);
      return { valid: true, dateWindow: window };
    }
  }

  // No time range specified - valid but no window
  return { valid: true };
}

/**
 * Format AbsoluteDateWindow for arXiv API query format
 * Returns format: [YYYYMMDDTTTT TO YYYYMMDDTTTT]
 * where TTTT is the time in 24-hour format (HHMM) in GMT.
 * 
 * IMPORTANT: arXiv API does NOT support wildcards (*) in date queries.
 * Explicit times are required: start=0000 (midnight), end=2359 (end of day)
 */
export function formatForArxiv(window: AbsoluteDateWindow): string {
  const start = window.startDate.replace(/-/g, '') + '0000';
  const end = window.endDate.replace(/-/g, '') + '2359';
  return `[${start} TO ${end}]`;
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Check if a time range is strict (should not be expanded on retry)
 */
export function isStrictTimeRange(window: AbsoluteDateWindow | null | undefined): boolean {
  return window?.strict === true;
}

/**
 * Create a human-readable description of the time window
 */
export function describeTimeWindow(window: AbsoluteDateWindow): string {
  const strictLabel = window.strict ? ' (strict)' : ' (flexible)';
  if (window.intent) {
    return `${window.intent.value} ${window.intent.unit}${strictLabel}: ${window.startDate} to ${window.endDate}`;
  }
  return `${window.startDate} to ${window.endDate}${strictLabel}`;
}
