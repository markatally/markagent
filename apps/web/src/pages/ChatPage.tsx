import { useParams } from 'react-router-dom';
import { Sidebar } from '../components/layout/Sidebar';
import { ChatContainer } from '../components/chat/ChatContainer';
import { MessageSquare } from 'lucide-react';

export function ChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <Sidebar />

      {/* Main content area */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {sessionId ? (
          <ChatContainer sessionId={sessionId} />
        ) : (
          // No session selected
          <div className="flex flex-1 items-center justify-center">
            <div className="text-center space-y-4">
              <MessageSquare className="mx-auto h-12 w-12 text-muted-foreground" />
              <div>
                <h2 className="text-xl font-semibold">Welcome to Mark Agent</h2>
                <p className="text-sm text-muted-foreground mt-2">
                  Select a session from the sidebar or create a new one to get started
                </p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
