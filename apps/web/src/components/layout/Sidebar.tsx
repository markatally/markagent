import { LogOut, Menu, X, GripVertical, PanelLeftClose } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { SessionList } from '../session/SessionList';
import { NewSessionButton } from '../session/NewSessionButton';
import { cn } from '../../lib/utils';

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 480;
const DEFAULT_SIDEBAR_WIDTH = 256;
const STORAGE_KEY = 'sidebar-width';

interface SidebarProps {
  className?: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Sidebar({ className, collapsed = false, onToggleCollapse }: SidebarProps) {
  const { user, logout } = useAuth();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [width, setWidth] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? Math.min(Math.max(parseInt(stored, 10), MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH) : DEFAULT_SIDEBAR_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);

  // Save width to localStorage when it changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(width));
  }, [width]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;
    
    const newWidth = e.clientX;
    if (newWidth >= MIN_SIDEBAR_WIDTH && newWidth <= MAX_SIDEBAR_WIDTH) {
      setWidth(newWidth);
    }
  }, [isResizing]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  return (
    <>
      {/* Mobile menu button */}
      <Button
        variant="ghost"
        size="icon"
        className="fixed top-4 left-4 z-50 md:hidden"
        onClick={() => setIsMobileOpen(!isMobileOpen)}
      >
        {isMobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>

      {/* Sidebar */}
      <aside
        ref={sidebarRef}
        style={{ width: `${collapsed && !isMobileOpen ? 0 : width}px` }}
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex flex-col border-r bg-background transition-transform duration-200 md:relative',
          isMobileOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed ? 'md:-translate-x-full md:overflow-hidden' : 'md:translate-x-0',
          isResizing && 'transition-none',
          className
        )}
      >
        {/* Header */}
        <div className="flex h-16 items-center justify-between border-b px-4">
          <h1 className="text-lg font-semibold">Mark Agent</h1>
          {onToggleCollapse ? (
            <Button
              variant="ghost"
              size="icon"
              className="hidden md:inline-flex"
              onClick={onToggleCollapse}
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </Button>
          ) : null}
        </div>

        {/* New Session Button */}
        <div className="p-4">
          <NewSessionButton />
        </div>

        <Separator />

        {/* Session List */}
        <div className="flex-1 overflow-hidden">
          <SessionList />
        </div>

        <Separator />

        {/* User Menu */}
        <div className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex-1 overflow-hidden">
              <p className="truncate text-sm font-medium">{user?.email}</p>
              <p className="text-xs text-muted-foreground">Signed in</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={logout}
              title="Log out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Resize handle - only visible on desktop */}
        {!collapsed ? (
          <div
            onMouseDown={handleMouseDown}
            className={cn(
              'absolute top-0 right-0 h-full w-1 cursor-col-resize hidden md:flex items-center justify-center group hover:bg-primary/20 transition-colors',
              isResizing && 'bg-primary/30'
            )}
          >
            <div className={cn(
              'absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-4 h-8 flex items-center justify-center rounded bg-border opacity-0 group-hover:opacity-100 transition-opacity',
              isResizing && 'opacity-100 bg-primary/50'
            )}>
              <GripVertical className="h-3 w-3 text-muted-foreground" />
            </div>
          </div>
        ) : null}
      </aside>

      {/* Overlay for mobile */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-background/80 backdrop-blur-sm md:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}
    </>
  );
}
