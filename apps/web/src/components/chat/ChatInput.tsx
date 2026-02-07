import { useState, useRef, KeyboardEvent } from 'react';
import { ArrowUp, Plus, Square } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;      // Completely disables input (invalid session, sending)
  sendDisabled?: boolean;  // Only disables send button (streaming)
  onStop?: () => void;
  onOpenSkills?: () => void;
}

export function ChatInput({ onSend, disabled, sendDisabled, onStop, onOpenSkills }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = !disabled && !sendDisabled && message.trim();

  const handleSend = () => {
    if (!canSend) return;

    onSend(message.trim());
    setMessage('');
  };

  // IME composition handlers
  const handleCompositionStart = () => {
    setIsComposing(true);
  };

  const handleCompositionEnd = () => {
    setIsComposing(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // IMPORTANT: Do not submit when IME composition is active
    // This allows Enter to confirm IME text (e.g., Chinese characters) instead of submitting
    // Check both nativeEvent.isComposing and our state for maximum compatibility
    const nativeEvent = e.nativeEvent as any;
    const isIMEActive = nativeEvent.isComposing || isComposing;

    // Send on Ctrl/Cmd + Enter (always works, even during IME)
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
      return;
    }
    
    // Regular Enter: only submit if IME is NOT active and Shift is NOT pressed
    if (e.key === 'Enter' && !e.shiftKey && !isIMEActive) {
      e.preventDefault();
      handleSend();
    }
    // If IME is active or Shift is pressed, allow default behavior (new line or IME confirmation)
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
  };

  return (
    <div className="bg-background/90 pb-2 backdrop-blur">
      <div className="mx-auto w-full max-w-3xl px-4 pt-4">
        <div className="flex items-center gap-2 rounded-2xl border border-input/50 bg-background px-4 py-3 transition-colors focus-within:border-input">
          <button
            type="button"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center self-start pt-0.5 text-muted-foreground hover:text-foreground"
            aria-label="Attach"
            onClick={onOpenSkills}
          >
            <Plus className="h-4 w-4" />
          </button>
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            placeholder="Ask anything"
            disabled={disabled}
            className="min-h-[52px] max-h-48 flex-1 resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          {sendDisabled && onStop ? (
            <Button
              onClick={onStop}
              size="icon"
              className="shrink-0 rounded-full bg-secondary text-foreground hover:bg-secondary/80"
              aria-label="Stop response"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={handleSend}
              disabled={!canSend}
              size="icon"
              className="shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
              aria-label="Send message"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="mt-2 text-center text-xs text-muted-foreground">
          Mark Agent may make mistakes. Check important info.
        </div>
      </div>
    </div>
  );
}
