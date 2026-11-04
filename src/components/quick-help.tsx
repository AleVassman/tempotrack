
"use client";

import React from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface QuickHelpProps {
  title: string;
  content: string | React.ReactNode;
  className?: string;
}

export function QuickHelp({ title, content, className }: QuickHelpProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button 
          className={cn(
            "inline-flex items-center justify-center rounded-full p-1 transition-all duration-200",
            "text-primary/70 hover:text-primary hover:scale-110 bg-primary/5",
            className
          )}
          aria-label={`Aiuto per ${title}`}
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent 
        className="w-[calc(100vw-8rem)] sm:w-80 p-4 shadow-xl border-2 z-[100] bg-popover" 
        side="top" 
        align="center" // Center alignment is safer for mobile
        sideOffset={8}
        collisionPadding={16} 
      >
        <div className="space-y-2">
          <h4 className="font-headline font-bold text-sm leading-none border-b pb-2 text-primary">
            {title}
          </h4>
          <div className="text-xs text-muted-foreground leading-relaxed">
            {content}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}