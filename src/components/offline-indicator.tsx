// src/components/offline-indicator.tsx

"use client";

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  // If the user is online, render nothing.
  if (isOnline) {
    return null;
  }

  // If the user is offline, render the banner.
  return (
    <div 
      className={cn(
        "fixed bottom-4 left-1/2 -translate-x-1/2 z-50", // Centered at the bottom
        "flex items-center gap-3 px-4 py-2 rounded-lg",
        "bg-destructive text-destructive-foreground shadow-lg",
        "animate-in fade-in slide-in-from-bottom-4" // Entrance animation
      )}
      role="status"
      aria-live="assertive"
    >
      <WifiOff className="h-5 w-5" />
      <div className="flex flex-col text-sm">
        <span className="font-semibold">Sei offline</span>
        <span className="text-xs opacity-90">I dati potrebbero non essere aggiornati.</span>
      </div>
    </div>
  );
}