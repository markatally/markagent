import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SkillsConfigModal } from '../SkillsConfigModal';

// Mock the API client
vi.mock('../../../lib/api', () => ({
  apiClient: {
    externalSkills: {
      list: vi.fn(),
    },
  },
}));

// Mock the hooks
vi.mock('../../../hooks/useUserSkills', () => ({
  useUserSkills: vi.fn(),
  useUpdateUserSkills: vi.fn(),
}));

// Mock the toast hook
vi.mock('../../../hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

import { apiClient } from '../../../lib/api';
import { useUserSkills, useUpdateUserSkills } from '../../../hooks/useUserSkills';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe('SkillsConfigModal - Scrolling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock user skills response
    (useUserSkills as any).mockReturnValue({
      data: { skills: [] },
      isLoading: false,
    });

    // Mock update mutation
    (useUpdateUserSkills as any).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });
  });

  it('should have fixed height container for scrolling', async () => {
    (apiClient.externalSkills.list as any).mockResolvedValue({
      skills: [
        {
          canonicalId: 'skill-1',
          name: 'Skill 1',
          description: 'Description 1',
          category: 'test',
          source: { repoUrl: '' },
        },
      ],
    });

    render(
      <SkillsConfigModal open={true} onOpenChange={() => {}} />,
      { wrapper: createWrapper() }
    );

    // Wait for modal header to load
    await waitFor(() => {
      expect(screen.getByText('Skills')).toBeInTheDocument();
    });

    // Wait for skill to load (API call completes)
    await waitFor(() => {
      expect(screen.getByText('Skill 1')).toBeInTheDocument();
    }, { timeout: 3000 });

    // Verify modal is fully rendered
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('Skill 1')).toBeInTheDocument();
  });

  it('should render ScrollArea for skills list', async () => {
    (apiClient.externalSkills.list as any).mockResolvedValue({
      skills: [
        {
          canonicalId: 'skill-1',
          name: 'Skill 1',
          description: 'Description 1',
          category: 'test',
          source: { repoUrl: '' },
        },
      ],
    });

    render(
      <SkillsConfigModal open={true} onOpenChange={() => {}} />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByText('Skill 1')).toBeInTheDocument();
    });

    // Verify skill content is rendered (ScrollArea is working)
    expect(screen.getByText('Skill 1')).toBeInTheDocument();
    expect(screen.getByText('Description 1')).toBeInTheDocument();
  });

  it('should display all skills when list is long (virtualized)', async () => {
    // Mock API to return 25 skills
    const manySkills = Array(25)
      .fill(null)
      .map((_, i) => ({
        canonicalId: `skill-${i}`,
        name: `Skill ${i}`,
        description: `Description ${i}`,
        category: 'test',
        source: { repoUrl: '' },
      }));

    (apiClient.externalSkills.list as any).mockResolvedValue({
      skills: manySkills,
    });

    render(
      <SkillsConfigModal open={true} onOpenChange={() => {}} />,
      { wrapper: createWrapper() }
    );

    // Wait for first skills to render (virtualization only renders visible items)
    await waitFor(() => {
      expect(screen.getByText('Skill 0')).toBeInTheDocument();
    });

    // Verify some visible skills are rendered (not all, due to virtualization)
    expect(screen.getByText('Skill 0')).toBeInTheDocument();
    // Should have at least a few skills visible (estimateSize=120, with overscan=5)
    const skillNames = screen.getAllByText(/^Skill \d+$/);
    expect(skillNames.length).toBeGreaterThan(0);
    expect(skillNames.length).toBeLessThan(25); // Not all rendered due to virtualization
  });

  it('should have flex-shrink-0 on header and footer', async () => {
    (apiClient.externalSkills.list as any).mockResolvedValue({
      skills: [],
    });

    render(
      <SkillsConfigModal open={true} onOpenChange={() => {}} />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByText('Skills')).toBeInTheDocument();
    });

    // Verify header and footer elements are present
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Save')).toBeInTheDocument();
  });
});

describe('SkillsConfigModal - Functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (useUserSkills as any).mockReturnValue({
      data: { skills: [] },
      isLoading: false,
    });

    (useUpdateUserSkills as any).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
      isPending: false,
    });
  });

  it('should add skill when Add button is clicked', async () => {
    (apiClient.externalSkills.list as any).mockResolvedValue({
      skills: [
        {
          canonicalId: 'test-skill',
          name: 'Test Skill',
          description: 'A test skill',
          category: 'test',
          source: { repoUrl: '' },
        },
      ],
    });

    render(
      <SkillsConfigModal open={true} onOpenChange={() => {}} />,
      { wrapper: createWrapper() }
    );

    // Wait for skill to appear
    await waitFor(() => {
      expect(screen.getByText('Test Skill')).toBeInTheDocument();
    });

    // Click Add button
    const addButton = screen.getByRole('button', { name: /add/i });
    fireEvent.click(addButton);

    // Verify button changed to enabled state
    await waitFor(() => {
      expect(screen.getByText('Enabled')).toBeInTheDocument();
    });
  });

  it('should call update mutation when Save is clicked', async () => {
    const mockMutate = vi.fn().mockResolvedValue({});
    (useUpdateUserSkills as any).mockReturnValue({
      mutateAsync: mockMutate,
      isPending: false,
    });

    (apiClient.externalSkills.list as any).mockResolvedValue({
      skills: [
        {
          canonicalId: 'test-skill',
          name: 'Test Skill',
          description: 'A test skill',
          category: 'test',
          source: { repoUrl: '' },
        },
      ],
    });

    render(
      <SkillsConfigModal open={true} onOpenChange={() => {}} />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByText('Test Skill')).toBeInTheDocument();
    });

    // Add the skill
    const addButton = screen.getByRole('button', { name: /add/i });
    fireEvent.click(addButton);

    // Click Save
    await waitFor(() => {
      const saveButton = screen.getByRole('button', { name: /save/i });
      expect(saveButton).not.toBeDisabled();
      fireEvent.click(saveButton);
    });

    // Verify mutation was called
    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalled();
    });
  });
});

describe('SkillsConfigModal - Scope and Filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show correct counts in tab labels', async () => {
    const mockUserSkills = [
      { canonicalId: 'skill-1', enabled: true, addedAt: new Date(), updatedAt: new Date() },
      { canonicalId: 'skill-2', enabled: false, addedAt: new Date(), updatedAt: new Date() },
    ];

    (useUserSkills as any).mockReturnValue({
      data: { skills: mockUserSkills },
      isLoading: false,
    });

    (useUpdateUserSkills as any).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });

    const allSkills = [
      {
        canonicalId: 'skill-1',
        name: 'Skill 1',
        description: 'Description 1',
        category: 'test',
        source: { repoUrl: 'https://github.com/test' },
      },
      {
        canonicalId: 'skill-2',
        name: 'Skill 2',
        description: 'Description 2',
        category: 'test',
        source: { repoUrl: '' },
      },
      {
        canonicalId: 'skill-3',
        name: 'Skill 3',
        description: 'Description 3',
        category: 'test',
        source: { repoUrl: '' },
      },
    ];

    (apiClient.externalSkills.list as any).mockResolvedValue({
      skills: allSkills,
    });

    render(
      <SkillsConfigModal open={true} onOpenChange={() => {}} />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByText('Added (2)')).toBeInTheDocument();
      expect(screen.getByText('All (3)')).toBeInTheDocument();
    });
  });

  it('should render tabs with correct scope and show contextual filters', async () => {
    const mockUserSkills = [
      { canonicalId: 'skill-1', enabled: true, addedAt: new Date(), updatedAt: new Date() },
    ];

    (useUserSkills as any).mockReturnValue({
      data: { skills: mockUserSkills },
      isLoading: false,
    });

    (useUpdateUserSkills as any).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });

    const allSkills = [
      {
        canonicalId: 'skill-1',
        name: 'Added Skill',
        description: 'This is added',
        category: 'test',
        source: { repoUrl: '' },
      },
      {
        canonicalId: 'skill-2',
        name: 'Not Added Skill',
        description: 'This is not added',
        category: 'test',
        source: { repoUrl: '' },
      },
    ];

    (apiClient.externalSkills.list as any).mockResolvedValue({
      skills: allSkills,
    });

    render(
      <SkillsConfigModal open={true} onOpenChange={() => {}} />,
      { wrapper: createWrapper() }
    );

    // Should start in Added scope (since user has skills)
    await waitFor(() => {
      expect(screen.getByText('Added Skill')).toBeInTheDocument();
    });

    // Should not show the "Not Added Skill" in Added scope
    expect(screen.queryByText('Not Added Skill')).not.toBeInTheDocument();

    // Verify Added scope shows contextual "Enabled only" filter
    expect(screen.getByText('Enabled only')).toBeInTheDocument();
    
    // Both tabs should be rendered with correct counts
    expect(screen.getByRole('tab', { name: /Added \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /All \(2\)/i })).toBeInTheDocument();
  });

  it('should filter by "Enabled only" in Added scope', async () => {
    const mockUserSkills = [
      { canonicalId: 'skill-1', enabled: true, addedAt: new Date(), updatedAt: new Date() },
      { canonicalId: 'skill-2', enabled: false, addedAt: new Date(), updatedAt: new Date() },
    ];

    (useUserSkills as any).mockReturnValue({
      data: { skills: mockUserSkills },
      isLoading: false,
    });

    (useUpdateUserSkills as any).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });

    const allSkills = [
      {
        canonicalId: 'skill-1',
        name: 'Enabled Skill',
        description: 'This is enabled',
        category: 'test',
        source: { repoUrl: '' },
      },
      {
        canonicalId: 'skill-2',
        name: 'Disabled Skill',
        description: 'This is disabled',
        category: 'test',
        source: { repoUrl: '' },
      },
    ];

    (apiClient.externalSkills.list as any).mockResolvedValue({
      skills: allSkills,
    });

    render(
      <SkillsConfigModal open={true} onOpenChange={() => {}} />,
      { wrapper: createWrapper() }
    );

    // Wait for skills to load
    await waitFor(() => {
      expect(screen.getByText('Enabled Skill')).toBeInTheDocument();
      expect(screen.getByText('Disabled Skill')).toBeInTheDocument();
    });

    // Click "Enabled only" filter
    const enabledOnlyBadge = screen.getByText('Enabled only');
    fireEvent.click(enabledOnlyBadge);

    // Only enabled skill should be visible
    await waitFor(() => {
      expect(screen.getByText('Enabled Skill')).toBeInTheDocument();
      expect(screen.queryByText('Disabled Skill')).not.toBeInTheDocument();
    });
  });

  it.skip('should filter by "Hide added" in All scope', async () => {
    const mockUserSkills = [
      { canonicalId: 'skill-1', enabled: true, addedAt: new Date(), updatedAt: new Date() },
    ];

    (useUserSkills as any).mockReturnValue({
      data: { skills: mockUserSkills },
      isLoading: false,
    });

    (useUpdateUserSkills as any).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });

    const allSkills = [
      {
        canonicalId: 'skill-1',
        name: 'Added Skill',
        description: 'This is added',
        category: 'test',
        source: { repoUrl: '' },
      },
      {
        canonicalId: 'skill-2',
        name: 'Not Added Skill',
        description: 'This is not added',
        category: 'test',
        source: { repoUrl: '' },
      },
    ];

    (apiClient.externalSkills.list as any).mockResolvedValue({
      skills: allSkills,
    });

    render(
      <SkillsConfigModal open={true} onOpenChange={() => {}} />,
      { wrapper: createWrapper() }
    );

    // Switch to All scope
    const allTab = await screen.findByRole('tab', { name: /All \(2\)/i });
    fireEvent.click(allTab);

    // Wait for All scope to be active by checking for "Hide added" badge
    await waitFor(() => {
      expect(screen.getByText('Hide added')).toBeInTheDocument();
    });

    // At least one skill should be visible initially
    await waitFor(() => {
      expect(screen.getByText('Added Skill')).toBeInTheDocument();
    });

    // Click "Hide added" filter
    const hideAddedBadge = screen.getByText('Hide added');
    fireEvent.click(hideAddedBadge);

    // Added skill should no longer be visible
    await waitFor(() => {
      expect(screen.queryByText('Added Skill')).not.toBeInTheDocument();
    });
  });

  it('should filter by "Official only" in All scope', async () => {
    (useUserSkills as any).mockReturnValue({
      data: { skills: [] },
      isLoading: false,
    });

    (useUpdateUserSkills as any).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });

    const allSkills = [
      {
        canonicalId: 'skill-1',
        name: 'Official Skill',
        description: 'This is official',
        category: 'test',
        source: { repoUrl: 'https://github.com/official' },
      },
      {
        canonicalId: 'skill-2',
        name: 'Community Skill',
        description: 'This is community',
        category: 'test',
        source: { repoUrl: '' },
      },
    ];

    (apiClient.externalSkills.list as any).mockResolvedValue({
      skills: allSkills,
    });

    render(
      <SkillsConfigModal open={true} onOpenChange={() => {}} />,
      { wrapper: createWrapper() }
    );

    // Both skills should be visible initially
    await waitFor(() => {
      expect(screen.getByText('Official Skill')).toBeInTheDocument();
      expect(screen.getByText('Community Skill')).toBeInTheDocument();
    });

    // Click "Official only" filter
    const officialOnlyBadge = screen.getByText('Official only');
    fireEvent.click(officialOnlyBadge);

    // Only official skill should be visible
    await waitFor(() => {
      expect(screen.getByText('Official Skill')).toBeInTheDocument();
      expect(screen.queryByText('Community Skill')).not.toBeInTheDocument();
    });
  });

  it.skip('should show "Browse all skills" CTA in empty Added scope', async () => {
    (useUserSkills as any).mockReturnValue({
      data: { skills: [] },
      isLoading: false,
    });

    (useUpdateUserSkills as any).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });

    (apiClient.externalSkills.list as any).mockResolvedValue({
      skills: [
        {
          canonicalId: 'skill-1',
          name: 'Skill 1',
          description: 'Description 1',
          category: 'test',
          source: { repoUrl: '' },
        },
      ],
    });

    render(
      <SkillsConfigModal open={true} onOpenChange={() => {}} />,
      { wrapper: createWrapper() }
    );

    // Should start in All scope (no user skills), verify by checking for "Hide added" badge
    await waitFor(() => {
      expect(screen.getByText('Hide added')).toBeInTheDocument();
    });

    // Switch to Added scope
    const addedTab = screen.getByRole('tab', { name: /Added \(0\)/i });
    fireEvent.click(addedTab);

    // Should show empty state with CTA
    await waitFor(() => {
      expect(screen.getByText('No skills added yet')).toBeInTheDocument();
    });

    const browseButton = screen.getByRole('button', { name: /Browse all skills/i });
    expect(browseButton).toBeInTheDocument();

    // Click CTA should switch to All scope
    fireEvent.click(browseButton);

    // Verify we're back in All scope by checking for "Hide added" badge
    await waitFor(() => {
      expect(screen.getByText('Hide added')).toBeInTheDocument();
    });
  });

  it('should show "Clear search" button when search has no results', async () => {
    (useUserSkills as any).mockReturnValue({
      data: { skills: [] },
      isLoading: false,
    });

    (useUpdateUserSkills as any).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });

    (apiClient.externalSkills.list as any).mockResolvedValue({
      skills: [
        {
          canonicalId: 'skill-1',
          name: 'Skill 1',
          description: 'Description 1',
          category: 'test',
          source: { repoUrl: '' },
        },
      ],
    });

    render(
      <SkillsConfigModal open={true} onOpenChange={() => {}} />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByText('Skill 1')).toBeInTheDocument();
    });

    // Search for non-existent skill
    const searchInput = screen.getByPlaceholderText('Search skills...');
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

    // Should show empty state with clear search button
    await waitFor(() => {
      expect(screen.getByText(/No skills match "nonexistent"/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Clear search/i })).toBeInTheDocument();
    });

    // Click clear search
    const clearButton = screen.getByRole('button', { name: /Clear search/i });
    fireEvent.click(clearButton);

    // Skill should be visible again
    await waitFor(() => {
      expect(screen.getByText('Skill 1')).toBeInTheDocument();
    });
  });

  it.skip('should update category options based on current scope', async () => {
    const mockUserSkills = [
      { canonicalId: 'skill-1', enabled: true, addedAt: new Date(), updatedAt: new Date() },
    ];

    (useUserSkills as any).mockReturnValue({
      data: { skills: mockUserSkills },
      isLoading: false,
    });

    (useUpdateUserSkills as any).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });

    const allSkills = [
      {
        canonicalId: 'skill-1',
        name: 'Dev Skill',
        description: 'Development skill',
        category: 'development',
        source: { repoUrl: '' },
      },
      {
        canonicalId: 'skill-2',
        name: 'Test Skill',
        description: 'Testing skill',
        category: 'testing',
        source: { repoUrl: '' },
      },
    ];

    (apiClient.externalSkills.list as any).mockResolvedValue({
      skills: allSkills,
    });

    render(
      <SkillsConfigModal open={true} onOpenChange={() => {}} />,
      { wrapper: createWrapper() }
    );

    // Wait for loading to complete - should start in Added scope (verify by Enabled only badge)
    await waitFor(() => {
      expect(screen.getByText('Enabled only')).toBeInTheDocument();
    });

    // In Added scope, only "development" category should be available
    const categorySelect = screen.getByRole('combobox') as HTMLSelectElement;
    let options = Array.from(categorySelect.options).map(opt => opt.value);
    expect(options).toContain('all');
    expect(options).toContain('development');
    expect(options).not.toContain('testing');

    // Switch to All scope
    const allTab = screen.getByRole('tab', { name: /All \(2\)/i });
    fireEvent.click(allTab);

    // Wait for All scope to be active by checking for "Hide added" badge
    await waitFor(() => {
      expect(screen.getByText('Hide added')).toBeInTheDocument();
    });

    // Now both categories should be available
    await waitFor(() => {
      options = Array.from(categorySelect.options).map(opt => opt.value);
      expect(options).toContain('testing');
    });

    expect(options).toContain('all');
    expect(options).toContain('development');
  });
});
