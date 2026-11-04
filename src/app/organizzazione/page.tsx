
"use client";

import { useState, useEffect } from "react";
import { collection, query, onSnapshot, orderBy, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/app/layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { Users as UsersIcon } from "lucide-react";
import { format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import BirthdayCalendar from "@/components/birthday-calendar";

interface UserDocument {
    id: string;
    firstName?: string;
    lastName?: string;
    email: string;
    department?: string;
    role: 'user' | 'admin' | 'hr';
    compleanno?: string;
    contactEmail?: string;
    cellphone?: string;
}

function OrganizationSkeleton() {
    return (
        <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
                <Card key={i}>
                    <CardHeader>
                        <Skeleton className="h-6 w-1/3" />
                        <Skeleton className="h-4 w-1/4 mt-2" />
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            <Skeleton className="h-8 w-full" />
                            <Skeleton className="h-8 w-full" />
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>
    );
}

export default function OrganizationPage() {
    const { user, userProfile, loading: authLoading } = useAuth();
    const [allUsers, setAllUsers] = useState<UserDocument[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!user) {
            setLoading(false);
            return;
        }

        setLoading(true);
        // Filters for "active" status and sorts by name
        const usersQuery = query(
            collection(db, "users"), 
            where("status", "==", "active"), // <-- Only active users
            orderBy("lastName"), 
            orderBy("firstName")
        );

        const unsubscribe = onSnapshot(usersQuery, (querySnapshot) => {
            const usersData = querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as UserDocument));
            setAllUsers(usersData);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching organization users:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user]);

    const groupedUsers = allUsers.reduce((acc, user) => {
        const department = user.department || 'Non Assegnato';
        if (!acc[department]) {
            acc[department] = [];
        }
        acc[department].push(user);
        return acc;
    }, {} as Record<string, UserDocument[]>);

    const sortedDepartments = Object.keys(groupedUsers).sort((a, b) => {
        if (a === 'Non Assegnato') return 1;
        if (b === 'Non Assegnato') return -1;
        return a.localeCompare(b);
    });

    const pageLoading = loading || authLoading;

    // Auth Guard: HR users have the more powerful management page instead.
    // Kept after all hooks so the hook order never changes between renders.
    if (userProfile?.role === 'hr') {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center">
                <h2 className="text-xl font-semibold">Pagina non disponibile per il tuo ruolo.</h2>
                <p className="text-muted-foreground mt-2">Gli utenti HR devono utilizzare la pagina di Gestione Utenti per una vista completa.</p>
                <Button asChild className="mt-4">
                    <Link href="/users">Vai a Gestione Utenti</Link>
                </Button>
            </div>
        );
    }

    return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-headline text-3xl font-semibold">Organizzazione</h1>
        <p className="text-muted-foreground">
          Visualizza i team e i colleghi della tua organizzazione.
        </p>
      </div>

      {!pageLoading && (
        <Card>
          <CardHeader>
            <CardTitle>Calendario Compleanni</CardTitle>
          </CardHeader>
          <CardContent>
            <BirthdayCalendar users={allUsers} />
          </CardContent>
        </Card>
      )}

      {pageLoading ? (
        <OrganizationSkeleton />
      ) : (
        <Accordion type="multiple" defaultValue={sortedDepartments} className="w-full space-y-4">
          {sortedDepartments.map((department) => (
            <AccordionItem value={department} key={department} className="border-none">
              <Card>
                <CardHeader className="p-4">
                  <AccordionTrigger className="p-2 -m-2">
                    <div className="flex-1 text-left">
                      <CardTitle className="text-xl">{department}</CardTitle>
                      <CardDescription className="flex items-center gap-2">
                        <UsersIcon className="h-4 w-4" /> {groupedUsers[department].length} Persone
                      </CardDescription>
                    </div>
                  </AccordionTrigger>
                </CardHeader>
                
                <AccordionContent>
                    <CardContent className="p-0">

                    {/* --- 1. MOBILE CARD VIEW --- */}
                    <div className="sm:hidden p-4 space-y-4">
                        {groupedUsers[department].map((u) => (
                        <Card key={u.id} className="bg-muted/50">
                            <CardContent className="p-4 space-y-2">
                            {/* Name is the main identifier */}
                                <div className="font-medium">{u.firstName} {u.lastName}</div>
                        
                                {/* Contact Info (only shown if present) */}
                                {(u.contactEmail || u.cellphone) && (
                                    <div className="border-t pt-2 space-y-1">
                                        {u.contactEmail && (
                                            <div className="text-sm text-muted-foreground break-all">
                                                <span className="font-semibold">Email:</span> {u.contactEmail}
                                            </div>
                                        )}
                                        {u.cellphone && (
                                            <div className="text-sm text-muted-foreground">
                                                <span className="font-semibold">Cellulare:</span> {u.cellphone}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Birthday Info */}
                                <div className="text-sm text-muted-foreground pt-2 border-t">
                                    <span className="font-semibold">Compleanno:</span> {u.compleanno ? format(parseISO(u.compleanno), 'd MMMM', { locale: it }) : '--'}
                                </div>
                            </CardContent>
                        </Card>
                        ))}
                    </div>

                    {/* --- 2. DESKTOP TABLE VIEW --- */}
                    <div className="hidden sm:block overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Nome</TableHead>
                                    <TableHead>Email Contatto</TableHead>
                                    <TableHead>Cellulare</TableHead>
                                    <TableHead>Compleanno</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {groupedUsers[department].map((u) => (
                                    <TableRow key={u.id}>
                                        <TableCell className="font-medium whitespace-nowrap">{u.firstName} {u.lastName}</TableCell>
                                        <TableCell>{u.contactEmail || '--'}</TableCell>
                                        <TableCell>{u.cellphone || '--'}</TableCell>
                                        <TableCell className="whitespace-nowrap">
                                            {u.compleanno ? format(parseISO(u.compleanno), 'd MMMM', { locale: it }) : '--'}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>

                    </CardContent>
                </AccordionContent>
              </Card>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}