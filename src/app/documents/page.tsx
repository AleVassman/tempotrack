
"use client";

import { FileText as FileTextIcon, } from "lucide-react";

export default function DocumentsPage() {

    return (
    <div className="flex flex-col items-center justify-center h-full text-center">
        <FileTextIcon className="h-12 w-12 text-muted-foreground mb-4" />
        <h1 className="font-headline text-2xl font-semibold">Funzionalità non disponibile</h1>
        <p className="text-muted-foreground mt-2">La gestione dei documenti è temporaneamente disattivata.</p>
    </div>
  );
}
