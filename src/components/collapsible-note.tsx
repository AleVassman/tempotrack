// src/components/collapsible-note.tsx

"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";

interface CollapsibleNoteProps {
  note: string;
  maxLength?: number;
  className?: string;
}

export function CollapsibleNote({ note, maxLength = 100, className }: CollapsibleNoteProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const needsCollapsing = note.length > maxLength;

  return (
    <div className={cn("w-full text-xs italic text-muted-foreground", className)}>
      {/* 
        This outer div uses a grid layout to separate the icon from the text.
        This is the key to preventing the icon from being pushed around by the text content.
      */}
      <div className="grid grid-cols-[auto_1fr] gap-x-2 items-start">
        
        {/* Column 1: Icon. Stays fixed on the left. */}
        <FileText className="h-4 w-4 mt-0.5 shrink-0" />

        {/* 
          Column 2: Text content wrapper. 
          "min-w-0" is essential. It tells this grid cell that it's okay for its
          content (the <p> tag) to be smaller than the content's intrinsic width.
          This allows the text wrapping to actually work.
        */}
        <div className="min-w-0">
          <p
            // `break-words` is used to wrap normal long words.
            // `[word-break:break-all]` is the fallback for unbreakable strings.
            // Together, they handle all text-wrapping scenarios.
            className="break-words [word-break:break-all]"
          >
            {isExpanded ? note : `${note.substring(0, maxLength)}${needsCollapsing ? '...' : ''}`}
          </p>
        </div>
      </div>
      
      {/* 
        The "Show More" button is rendered outside the grid.
        The `ml-6` indents it to align with the text, not the icon, for a cleaner look.
      */}
      {needsCollapsing && (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs text-blue-600 dark:text-blue-400 self-start ml-6"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? "Mostra meno" : "Mostra di più"}
        </Button>
      )}
    </div>
  );
}