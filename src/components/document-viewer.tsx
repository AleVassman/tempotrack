
"use client"
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Eye } from "lucide-react";

interface DocumentViewerProps {
    fileUrl: string;
    title: string;
}

export default function DocumentViewer({ fileUrl, title }: DocumentViewerProps) {
    const isDataUrl = fileUrl && fileUrl.startsWith('data:');

    const handleViewClick = () => {
        if (isDataUrl) {
            const newWindow = window.open();
            if (newWindow) {
                newWindow.document.body.style.margin = "0";
                newWindow.document.body.style.height = "100vh";
                newWindow.document.body.innerHTML = `<iframe src="${fileUrl}" style="border:0; width:100%; height:100%;" allowfullscreen></iframe>`;
                newWindow.document.title = title;
            } else {
                alert("Per favore, consenti i pop-up per visualizzare il documento.");
            }
        }
    };

    return (
        <Button variant="outline" size="sm" disabled={!isDataUrl} onClick={handleViewClick}>
            <Eye className="h-4 w-4 mr-2" />
            Visualizza
        </Button>
    );
}
