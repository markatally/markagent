// SSE Event types from backend
export interface StreamEvent {
  type: 'message.start' | 'message.delta' | 'message.complete' |
        'reasoning.step' |
        'thinking.start' | 'thinking.delta' | 'thinking.complete' |
        'tool.start' | 'tool.progress' | 'tool.complete' | 'tool.error' |
        'plan.created' | 'plan.step.start' | 'plan.step.complete' |
        'approval.required' | 'file.created' | 'file.modified' | 'file.deleted' |
        'error' | 'session.end' | 'agent.step_limit';
  data: any;
}

export interface SSEOptions {
  onEvent: (event: StreamEvent) => void;
  onError?: (error: Error) => void;
  onOpen?: () => void;
  onClose?: () => void;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

/**
 * SSE Client wrapper for EventSource
 * Handles connection lifecycle, reconnection, and event parsing
 */
export class SSEClient {
  private eventSource: EventSource | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts: number;
  private reconnectInterval: number;
  private shouldReconnect: boolean;
  private url: string = '';
  private options: SSEOptions | null = null;
  private isClosed = false;

  constructor() {
    this.maxReconnectAttempts = 3;
    this.reconnectInterval = 1000;
    this.shouldReconnect = true;
  }

  /**
   * Connect to SSE stream
   * @param url - SSE endpoint URL
   * @param options - Connection options
   * @returns Cleanup function to close the connection
   */
  connect(url: string, options: SSEOptions): () => void {
    this.url = url;
    this.options = options;
    this.isClosed = false;
    this.shouldReconnect = options.reconnect !== false;
    this.reconnectInterval = options.reconnectInterval || 1000;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 3;

    this._connect();

    // Return cleanup function
    return () => this.close();
  }

  private _connect() {
    if (this.isClosed) return;

    try {
      this.eventSource = new EventSource(this.url);

      this.eventSource.onopen = () => {
        this.reconnectAttempts = 0;
        this.options?.onOpen?.();
      };

      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Parse SSE event format
          const streamEvent: StreamEvent = {
            type: data.type || 'message.delta',
            data: data.data || data,
          };

          this.options?.onEvent(streamEvent);
        } catch (error) {
          console.error('Failed to parse SSE event:', error);
          this.options?.onError?.(error as Error);
        }
      };

      this.eventSource.onerror = (error) => {
        console.error('SSE connection error:', error);

        // Close current connection
        this.eventSource?.close();
        this.eventSource = null;

        // Attempt reconnection if enabled
        if (this.shouldReconnect &&
            this.reconnectAttempts < this.maxReconnectAttempts &&
            !this.isClosed) {
          this.reconnectAttempts++;
          console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

          setTimeout(() => {
            this._connect();
          }, this.reconnectInterval * this.reconnectAttempts);
        } else {
          this.options?.onError?.(new Error('SSE connection failed'));
          this.options?.onClose?.();
        }
      };
    } catch (error) {
      console.error('Failed to create EventSource:', error);
      this.options?.onError?.(error as Error);
    }
  }

  /**
   * Close the SSE connection
   */
  close() {
    this.isClosed = true;
    this.shouldReconnect = false;

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.options?.onClose?.();
  }

  /**
   * Check if connection is active
   */
  isConnected(): boolean {
    return this.eventSource !== null &&
           this.eventSource.readyState === EventSource.OPEN;
  }

  /**
   * Get current connection state
   */
  getReadyState(): number {
    return this.eventSource?.readyState ?? EventSource.CLOSED;
  }
}

/**
 * Create and connect to SSE stream
 * Convenience function for one-off connections
 */
export function createSSEConnection(
  url: string,
  onEvent: (event: StreamEvent) => void,
  options?: Partial<SSEOptions>
): () => void {
  const client = new SSEClient();
  return client.connect(url, {
    onEvent,
    ...options,
  });
}
