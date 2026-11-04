
"use client";

import { WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function OfflinePage() {
  const handleReload = () => {
    window.location.reload();
  };

  return (
    // Rendered inside the root layout, which already provides <html> and <body>.
    <div className="flex flex-col items-center justify-center min-h-[70vh] text-center p-4">
          <WifiOff className="h-16 w-16 text-muted-foreground mb-4" />
          <h1 className="text-3xl font-bold mb-2 font-headline">Sei Offline</h1>
          <p className="text-lg text-muted-foreground mb-6 max-w-md">
            Sembra che tu non sia connesso a internet. Alcuni contenuti potrebbero non essere disponibili.
          </p>
          <Button onClick={handleReload}>
            Riprova
          </Button>
    </div>
  );
}
