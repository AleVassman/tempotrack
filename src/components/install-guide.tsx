
"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Download, Share, PlusSquare } from "lucide-react";
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar";

// Helper function to detect the OS/Browser
const getPlatform = () => {
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    const isAndroid = /Android/.test(ua);
    const isChrome = /Chrome/.test(ua);
    const isEdge = /Edg/.test(ua);

    if (isIOS) return 'ios';
    if (isAndroid && isChrome) return 'android';
    if (isChrome || isEdge) return 'desktop';
    return 'other';
};

export function InstallGuideButton() {
    const [isOpen, setIsOpen] = useState(false);
    const [platform, setPlatform] = useState<'ios' | 'android' | 'desktop' | 'other'>('other');
    const [isStandalone, setIsStandalone] = useState(false);
    
    useEffect(() => {
        // This ensures navigator is available
        setPlatform(getPlatform());
        if (window.matchMedia('(display-mode: standalone)').matches) {
            setIsStandalone(true);
        }
    }, []);

    // If the app is already installed, don't show the button
    if (isStandalone) {
        return null;
    }
    
    const renderInstructions = () => {
        switch (platform) {
            case 'ios':
                return (
                    <div className="space-y-4 text-center">
                        <p>Per installare l'app, tocca l'icona "Condividi" nella barra del browser.</p>
                        <Share className="h-8 w-8 mx-auto text-primary" />
                        <p>Quindi, scorri verso il basso e seleziona "Aggiungi a schermata Home".</p>
                        <PlusSquare className="h-8 w-8 mx-auto text-primary" />
                    </div>
                );
            case 'android':
                return (
                    <div className="space-y-4 text-center">
                        <p>Per installare l'app, tocca i tre puntini (menu) nell'angolo in alto a destra o in basso a destra del browser.</p>
                        <p>Quindi, seleziona "Installa app" o "Aggiungi a schermata Home".</p>
                        <Download className="h-8 w-8 mx-auto text-primary" />
                    </div>
                );
            case 'desktop':
                return (
                    <div className="space-y-4 text-center">
                        <p>Per installare l'app, cerca l'icona di installazione nella barra degli indirizzi (URL) del browser.</p>
                        <Download className="h-8 w-8 mx-auto text-primary" />
                        <p>In alternativa, vai nel menu del browser (tre puntini) e seleziona "Installa TempoTrack".</p>
                    </div>
                );
            default:
                return <p>Apri questo sito su Chrome, Edge, o Safari sul tuo telefono per installare l'app.</p>;
        }
    };

    return (
        <>
            <div className="p-2">
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            onClick={() => setIsOpen(true)}
                            tooltip="Installa App"
                            className="justify-start bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary"
                        >
                            <Download />
                            <span>Installa App</span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </div>

            <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Installa TempoTrack</DialogTitle>
                        <DialogDescription>
                            Segui le istruzioni per il tuo dispositivo per aggiungere questa app alla tua schermata home.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        {renderInstructions()}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}