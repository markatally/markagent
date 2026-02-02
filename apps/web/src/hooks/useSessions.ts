import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api';
import { useToast } from './use-toast';
import type { Session } from '@mark/shared';

/**
 * Fetch all sessions for the current user
 */
export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const response = await apiClient.sessions.list();
      return response.sessions;
    },
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Fetch a single session with messages
 */
export function useSession(sessionId: string | undefined) {
  return useQuery({
    queryKey: ['sessions', sessionId],
    queryFn: async () => {
      if (!sessionId) throw new Error('Session ID is required');
      return apiClient.sessions.get(sessionId);
    },
    enabled: !!sessionId,
    staleTime: 10000, // 10 seconds
  });
}

/**
 * Create a new session
 */
export function useCreateSession() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (name?: string) => {
      return apiClient.sessions.create(name);
    },
    onSuccess: (newSession) => {
      // Invalidate sessions list to refetch
      queryClient.invalidateQueries({ queryKey: ['sessions'] });

      toast({
        title: 'Session created',
        description: `Created ${newSession.name || 'new session'}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Failed to create session',
        description: error.message || 'Could not create session',
        variant: 'destructive',
      });
    },
  });
}

/**
 * Update a session (e.g., rename)
 */
export function useUpdateSession() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { name?: string } }) => {
      return apiClient.sessions.update(id, data);
    },
    onSuccess: (updatedSession) => {
      // Invalidate both list and individual session
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['sessions', updatedSession.id] });

      toast({
        title: 'Session updated',
        description: `Updated to "${updatedSession.name}"`,
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Failed to update session',
        description: error.message || 'Could not update session',
        variant: 'destructive',
      });
    },
  });
}

/**
 * Delete a session
 */
export function useDeleteSession() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      return apiClient.sessions.delete(id);
    },
    onSuccess: () => {
      // Invalidate sessions list to refetch
      queryClient.invalidateQueries({ queryKey: ['sessions'] });

      toast({
        title: 'Session deleted',
        description: 'Session has been removed',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Failed to delete session',
        description: error.message || 'Could not delete session',
        variant: 'destructive',
      });
    },
  });
}
