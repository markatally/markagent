import { useState, useMemo, useEffect, useRef } from 'react';
import { X, Search, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import { Switch } from '../ui/switch';
import { Badge } from '../ui/badge';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
import { useToast } from '../../hooks/use-toast';
import { useUserSkills, useUpdateUserSkills } from '../../hooks/useUserSkills';
import { apiClient, type UserSkill, type ExternalSkill } from '../../lib/api';
import { useQuery } from '@tanstack/react-query';

interface SkillsConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type AvailableSkill = ExternalSkill;

export function SkillsConfigModal({ open, onOpenChange }: SkillsConfigModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [scope, setScope] = useState<'added' | 'all'>('all');
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [hideAdded, setHideAdded] = useState(false);
  const [officialOnly, setOfficialOnly] = useState(false);
  const { toast } = useToast();

  // Fetch all available external skills
  const { data: availableSkillsData, isLoading: loadingAvailable } = useQuery({
    queryKey: ['external-skills'],
    queryFn: () => apiClient.externalSkills.list(),
    enabled: open,
  });

  // Fetch user's skill preferences
  const { data: userSkillsData, isLoading: loadingUserSkills } = useUserSkills();

  // Update mutation
  const updateMutation = useUpdateUserSkills();

  // Local state for pending changes
  const [pendingChanges, setPendingChanges] = useState<
    Map<string, { enabled: boolean; isInUserSet: boolean }>
  >(new Map());

  // Combine available skills with user preferences
  const combinedSkills = useMemo(() => {
    if (!availableSkillsData?.skills || !userSkillsData?.skills) {
      return [];
    }

    const userSkillsMap = new Map(
      userSkillsData.skills.map((s) => [s.canonicalId, s])
    );

    return availableSkillsData.skills.map((skill) => {
      const userSkill = userSkillsMap.get(skill.canonicalId);
      const pending = pendingChanges.get(skill.canonicalId);

      return {
        ...skill,
        isInUserSet: pending?.isInUserSet ?? !!userSkill,
        enabled: pending?.enabled ?? userSkill?.enabled ?? false,
        addedAt: userSkill?.addedAt,
        updatedAt: userSkill?.updatedAt,
      };
    });
  }, [availableSkillsData, userSkillsData, pendingChanges]);

  // Filter skills based on scope, quick filters, search, and category
  const filteredSkills = useMemo(() => {
    let filtered = combinedSkills;

    // 1. Scope filter
    if (scope === 'added') {
      filtered = filtered.filter((skill) => skill.isInUserSet);
    }

    // 2. Quick filters (contextual)
    if (scope === 'added' && enabledOnly) {
      filtered = filtered.filter((skill) => skill.enabled);
    }
    if (scope === 'all' && hideAdded) {
      filtered = filtered.filter((skill) => !skill.isInUserSet);
    }
    if (scope === 'all' && officialOnly) {
      filtered = filtered.filter((skill) => !!skill.source.repoUrl);
    }

    // 3. Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (skill) =>
          skill.name.toLowerCase().includes(query) ||
          skill.description.toLowerCase().includes(query)
      );
    }

    // 4. Filter by category
    if (category !== 'all') {
      filtered = filtered.filter((skill) => skill.category === category);
    }

    return filtered;
  }, [combinedSkills, scope, enabledOnly, hideAdded, officialOnly, searchQuery, category]);

  // Get unique categories from scoped skills
  const categories = useMemo(() => {
    const scopedSkills = scope === 'added'
      ? combinedSkills.filter((skill) => skill.isInUserSet)
      : combinedSkills;
    const cats = new Set<string>();
    scopedSkills.forEach((skill) => {
      if (skill.category) cats.add(skill.category);
    });
    return ['all', ...Array.from(cats).sort()];
  }, [combinedSkills, scope]);

  // Default scope on open based on user state
  useEffect(() => {
    if (open && userSkillsData?.skills) {
      setScope(userSkillsData.skills.length > 0 ? 'added' : 'all');
      // Reset filters when modal opens
      setEnabledOnly(false);
      setHideAdded(false);
      setOfficialOnly(false);
    }
  }, [open, userSkillsData]);

  // Compute counts for tab labels
  const addedCount = useMemo(
    () => combinedSkills.filter((s) => s.isInUserSet).length,
    [combinedSkills]
  );
  const allCount = combinedSkills.length;

  // Handle add skill to user's set
  const handleAddSkill = (canonicalId: string) => {
    setPendingChanges((prev) => {
      const newChanges = new Map(prev);
      newChanges.set(canonicalId, { enabled: true, isInUserSet: true });
      return newChanges;
    });
  };

  // Handle remove skill from user's set
  const handleRemoveSkill = (canonicalId: string) => {
    setPendingChanges((prev) => {
      const newChanges = new Map(prev);
      newChanges.set(canonicalId, { enabled: false, isInUserSet: false });
      return newChanges;
    });
  };

  // Handle toggle enabled state
  const handleToggleEnabled = (canonicalId: string, enabled: boolean) => {
    setPendingChanges((prev) => {
      const newChanges = new Map(prev);
      const current = prev.get(canonicalId);
      newChanges.set(canonicalId, {
        enabled,
        isInUserSet: current?.isInUserSet ?? true,
      });
      return newChanges;
    });
  };

  // Handle save
  const handleSave = async () => {
    try {
      // Build the update payload
      const skillsToUpdate = combinedSkills
        .filter((skill) => skill.isInUserSet)
        .map((skill) => ({
          canonicalId: skill.canonicalId,
          enabled: skill.enabled,
        }));

      await updateMutation.mutateAsync(skillsToUpdate);

      toast({
        title: 'Skills updated',
        description: 'Your skill preferences have been saved.',
      });

      // Clear pending changes and close
      setPendingChanges(new Map());
      onOpenChange(false);
    } catch (error) {
      toast({
        title: 'Failed to update skills',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  // Handle cancel
  const handleCancel = () => {
    setPendingChanges(new Map());
    onOpenChange(false);
  };

  const isLoading = loadingAvailable || loadingUserSkills;
  const hasPendingChanges = pendingChanges.size > 0;

  // Virtualization
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filteredSkills.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120, // approx row height
    overscan: 5,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 flex-shrink-0">
          <DialogTitle>Skills</DialogTitle>
          <DialogDescription>
            Skills provide the agent with pre-packaged best practices and tools.
          </DialogDescription>
        </DialogHeader>

        {/* Sticky header with tabs, search, and filters */}
        <div className="sticky top-0 bg-background z-10 px-6 pb-4 space-y-3 flex-shrink-0 border-b">
          {/* Scope tabs */}
          <Tabs value={scope} onValueChange={(value) => setScope(value as 'added' | 'all')}>
            <TabsList>
              <TabsTrigger value="added">
                Added ({addedCount})
              </TabsTrigger>
              <TabsTrigger value="all">
                All ({allCount})
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Search and category filter */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search skills..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="px-3 py-2 border rounded-md text-sm"
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === 'all' ? 'All types' : cat}
                </option>
              ))}
            </select>
          </div>

          {/* Contextual quick filters */}
          <div className="flex gap-2">
            {scope === 'added' ? (
              <Badge
                variant={enabledOnly ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setEnabledOnly(!enabledOnly)}
              >
                Enabled only
              </Badge>
            ) : (
              <>
                <Badge
                  variant={hideAdded ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => setHideAdded(!hideAdded)}
                >
                  Hide added
                </Badge>
                <Badge
                  variant={officialOnly ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => setOfficialOnly(!officialOnly)}
                >
                  Official only
                </Badge>
              </>
            )}
          </div>
        </div>

        {/* Skills list */}
        <div className="flex-1 min-h-0 overflow-hidden px-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="text-center py-12">
              {scope === 'added' && !searchQuery ? (
                <div className="space-y-4">
                  <p className="text-muted-foreground">No skills added yet</p>
                  <Button variant="outline" onClick={() => setScope('all')}>
                    Browse all skills
                  </Button>
                </div>
              ) : searchQuery ? (
                <div className="space-y-4">
                  <p className="text-muted-foreground">
                    No skills match &quot;{searchQuery}&quot;
                  </p>
                  <Button variant="ghost" onClick={() => setSearchQuery('')}>
                    Clear search
                  </Button>
                </div>
              ) : (
                <p className="text-muted-foreground">No skills found</p>
              )}
            </div>
          ) : (
            <div ref={parentRef} className="h-full overflow-auto">
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {virtualizer.getVirtualItems().map((virtualItem) => {
                  const skill = filteredSkills[virtualItem.index];
                  return (
                    <div
                      key={skill.canonicalId}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                    >
                      <div className="border rounded-lg p-4 space-y-2 mr-4 mb-3">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold">{skill.name}</h3>
                              {skill.source.repoUrl && (
                                <Badge variant="secondary" className="text-xs">
                                  Official
                                </Badge>
                              )}
                              {skill.category && (
                                <Badge variant="outline" className="text-xs">
                                  {skill.category}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {skill.description}
                            </p>
                            {skill.updatedAt && (
                              <p className="text-xs text-muted-foreground">
                                Last updated:{' '}
                                {new Date(skill.updatedAt).toLocaleDateString('en-US', {
                                  month: 'short',
                                  year: 'numeric',
                                })}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            {skill.isInUserSet ? (
                              <>
                                <div className="flex items-center gap-2">
                                  <Switch
                                    checked={skill.enabled}
                                    onCheckedChange={(checked) =>
                                      handleToggleEnabled(skill.canonicalId, checked)
                                    }
                                  />
                                  <span className="text-sm text-muted-foreground">
                                    {skill.enabled ? 'Enabled' : 'Disabled'}
                                  </span>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleRemoveSkill(skill.canonicalId)}
                                  title="Remove skill"
                                >
                                  <XCircle className="h-4 w-4" />
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleAddSkill(skill.canonicalId)}
                              >
                                <CheckCircle2 className="h-4 w-4 mr-1" />
                                Add
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t flex-shrink-0">
          <Button variant="outline" onClick={handleCancel} disabled={updateMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!hasPendingChanges || updateMutation.isPending}
          >
            {updateMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Save'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
