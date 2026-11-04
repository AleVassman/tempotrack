// src/hooks/useOnlineStatus.tsx

"use client";

import { useState, useEffect } from 'react';

export function useOnlineStatus() {
  // Initialize state from the browser's current status
  const [isOnline, setIsOnline] = useState(typeof window !== 'undefined' ? window.navigator.onLine : true);

  useEffect(() => {
    // Handler to update state when the online event fires
    const handleOnline = () => setIsOnline(true);
    // Handler to update state when the offline event fires
    const handleOffline = () => setIsOnline(false);

    // Add the event listeners
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Cleanup function to remove the listeners when the component unmounts
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []); // Empty dependency array means this runs once on mount

  return isOnline;
}