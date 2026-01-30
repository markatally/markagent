import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';
import { useCreateSession } from '../../hooks/useSessions';

export function NewSessionButton() {
  const navigate = useNavigate();
  const createSession = useCreateSession();

  const handleCreateSession = async () => {
    try {
      const newSession = await createSession.mutateAsync(undefined);
      navigate(`/chat/${newSession.id}`);
    } catch (error) {
      // Error already handled by mutation
      console.error('Failed to create session:', error);
    }
  };

  return (
    <Button
      className="w-full"
      onClick={handleCreateSession}
      disabled={createSession.isPending}
    >
      <Plus className="mr-2 h-4 w-4" />
      {createSession.isPending ? 'Creating...' : 'New Session'}
    </Button>
  );
}
