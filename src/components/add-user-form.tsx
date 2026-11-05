// src/components/add-user-form.tsx

"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { getFunctions, httpsCallable } from "firebase/functions";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { Loader2 } from "lucide-react";
import { USER_ROLES, IS_DEMO, DEMO_USER_MANAGEMENT_MESSAGE } from "@/lib/constants";
import { useDepartments } from "@/hooks/use-departments";
import { NONE_DEPARTMENT } from "@/lib/departments";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

// Define the shape of our form data with validation
const formSchema = z.object({
  email: z.string().email({ message: "Inserisci un'email valida." }),
  password: z.string().min(8, { message: "La password deve essere di almeno 8 caratteri." }),
  firstName: z.string().min(2, { message: "Il nome è richiesto." }),
  lastName: z.string().min(2, { message: "Il cognome è richiesto." }),
  department: z.string({ message: "Seleziona un dipartimento." }),
  role: z.string({ message: "Seleziona un ruolo." }),
  contactEmail: z.string().email({ message: "Inserisci un'email di contatto valida." }).optional().or(z.literal('')),
  cellphone: z.string().optional(),
});

interface AddUserFormProps {
    onSuccess: () => void;
}

export function AddUserForm({ onSuccess }: AddUserFormProps) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { names: departmentNames } = useDepartments(); // live list: new departments appear here immediately

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "", password: "", firstName: "", lastName: "", department: NONE_DEPARTMENT, role: "user", contactEmail: "", cellphone: "" },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (IS_DEMO) {
      toast({ title: "Non disponibile nella demo", description: DEMO_USER_MANAGEMENT_MESSAGE });
      return;
    }
    setIsSubmitting(true);
    try {
      const functions = getFunctions();
      const createUser = httpsCallable(functions, 'createUser');
      
      const result = await createUser(values);

      if ((result.data as any).success) {
        toast({
          title: "Utente Creato",
          description: "Il nuovo utente è stato creato con successo.",
        });
        onSuccess();
      } else {
        throw new Error((result.data as any).error || "Errore sconosciuto.");
      }
    } catch (error: any) {
      console.error("Error creating user:", error);
      toast({
        variant: "destructive",
        title: "Errore nella Creazione",
        description: error.message || "Impossibile creare l'utente. Controlla i dati e riprova.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pt-2">
        {/* 2-column grid for the inputs */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nome</FormLabel>
                <FormControl><Input {...field} placeholder="Mario" /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="lastName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Cognome</FormLabel>
                <FormControl><Input {...field} placeholder="Rossi" /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl><Input type="email" {...field} placeholder="mario.rossi@azienda.it" /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl><Input type="password" {...field} placeholder="••••••••" /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="department"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Dipartimento</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {departmentNames.map(dep => <SelectItem key={dep} value={dep}>{dep}</SelectItem>)}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="role"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Ruolo</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value={USER_ROLES.USER}>User</SelectItem>
                    <SelectItem value={USER_ROLES.ADMIN}>Admin</SelectItem>
                    <SelectItem value={USER_ROLES.HR}>HR</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="contactEmail"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email di Contatto (Opzionale)</FormLabel>
                <FormControl><Input type="email" {...field} placeholder="info.personali@email.com" /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="cellphone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Cellulare (Opzionale)</FormLabel>
                <FormControl><Input {...field} placeholder="333 123 4567" /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Action Button */}
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Crea Utente
        </Button>
      </form>
    </Form>
  );
}