interface PromptEchoProps {
  content: string;
}

export function PromptEcho({ content }: PromptEchoProps) {
  return (
    <div className="rounded-xl bg-muted/20 px-4 py-3 text-sm font-normal text-muted-foreground shadow-[0_1px_12px_rgba(0,0,0,0.06)] dark:shadow-[0_1px_12px_rgba(0,0,0,0.18)] transition-shadow duration-150">
      {content}
    </div>
  );
}
