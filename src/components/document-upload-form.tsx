// "use client"

// import { zodResolver } from "@hookform/resolvers/zod"
// import { useForm } from "react-hook-form"
// import * as z from "zod"
// import { format } from "date-fns"
// import { it } from "date-fns/locale"
// import { Calendar as CalendarIcon, Loader2 } from "lucide-react"
// import { collection, addDoc, serverTimestamp, query, where, getDocs, orderBy, onSnapshot } from "firebase/firestore";
// import { db } from "@/lib/firebase";
// import { useAuth, UserProfile } from "@/app/layout";
// import { cn } from "@/lib/utils"
// import { Button } from "@/components/ui/button"
// import { Calendar } from "@/components/ui/calendar"
// import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
// import { Input } from "@/components/ui/input"
// import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
// import { useToast } from "@/components/ui/use-toast"
// import { useState, useEffect } from "react"
// import { Switch } from "@/components/ui/switch"
// import { notifyDocumentAssigned } from "@/lib/notification-triggers";

// const MAX_FILE_SIZE = 1024 * 1024; // 1 MB
// const ACCEPTED_FILE_TYPES = ["application/pdf"];

// const formSchema = z.object({
//   title: z.string().min(3, { message: "Il titolo deve avere almeno 3 caratteri." }),
//   type: z.string({ required_error: "È richiesto un tipo di documento." }),
//   hasExpiration: z.boolean().default(true),
//   expiration: z.date().optional(),
//   file: z.instanceof(File)
//     .refine(file => file.size > 0, "È richiesto un file.")
//     .refine(file => file.size <= MAX_FILE_SIZE, `La dimensione massima del file è 1MB.`)
//     .refine(file => ACCEPTED_FILE_TYPES.includes(file.type), "Solo i file .pdf sono accettati."),
//   userId: z.string({ required_error: "È richiesto un utente." }),
// }).refine(data => {
//     // If hasExpiration is true, expiration date must be provided.
//     if (data.hasExpiration) {
//         return !!data.expiration;
//     }
//     // If hasExpiration is false, the expiration date is not required.
//     return true;
// }, {
//     message: "È richiesta una data di scadenza.",
//     path: ["expiration"], // Show error on expiration field
// });


// interface DocumentUploadFormProps {
//     onSuccess: () => void;
// }

// const documentTypes = [
//     "Busta paga",
//     "CU",
//     "Altro"
// ];

// interface UserForSelect {
//   id: string;
//   email: string;
//   name: string;
//   firstName?: string;
//   lastName?: string;
//   department?: string;
// }

// // Fetch users to populate the select dropdown
// const useUsers = () => {
//   const [users, setUsers] = useState<UserForSelect[]>([]);
//   useEffect(() => {
//     const usersCollection = query(collection(db, 'users'));
//     const unsubscribe = onSnapshot(usersCollection, (userSnapshot) => {
//       const userList = userSnapshot.docs.map(doc => {
//         const data = doc.data();
//         return {
//           id: doc.id,
//           email: data.email,
//           name: `${data.firstName || ''} ${data.lastName || ''}`.trim() || data.email,
//           firstName: data.firstName,
//           lastName: data.lastName,
//           department: data.department,
//         }
//       });
//       setUsers(userList);
//     });
//     return () => unsubscribe();
//   }, []);
//   return users;
// };

// // Helper function to convert file to Base64 Data URL
// const fileToDataURL = (file: File): Promise<string> => {
//     return new Promise((resolve, reject) => {
//         const reader = new FileReader();
//         reader.readAsDataURL(file);
//         reader.onload = () => resolve(reader.result as string);
//         reader.onerror = error => reject(error);
//     });
// };

// export default function DocumentUploadForm({ onSuccess }: DocumentUploadFormProps) {
//     const { toast } = useToast();
//     const { user, userProfile } = useAuth();
//     const [isSubmitting, setIsSubmitting] = useState(false);
//     const allUsers = useUsers();
    
//     const isHr = userProfile?.role === 'hr';
//     const isAdmin = userProfile?.role === 'admin';
//     const canUpload = isHr || isAdmin;

//     const form = useForm<z.infer<typeof formSchema>>({
//         resolver: zodResolver(formSchema),
//         defaultValues: {
//             title: "",
//             type: undefined,
//             hasExpiration: true,
//             expiration: undefined,
//             file: undefined,
//             userId: user?.uid,
//         },
//     });

//     const hasExpiration = form.watch("hasExpiration");

//     useEffect(() => {
//         // When toggling expiration off, clear the date value and any errors
//         if (!hasExpiration) {
//             form.setValue("expiration", undefined);
//             form.clearErrors("expiration");
//         }
//     }, [hasExpiration, form]);


//     useEffect(() => {
//         if (isAdmin && user?.uid) {
//             form.setValue('userId', user.uid);
//         }
//     }, [isAdmin, user, form]);

//     async function onSubmit(values: z.infer<typeof formSchema>) {
//     if (!user || !canUpload) {
//         toast({ variant: "destructive", title: "Errore", description: "Non autorizzato." });
//         return;
//     }

//     setIsSubmitting(true);

//     try {
//         const fileDataUrl = await fileToDataURL(values.file);
//         const selectedUser = allUsers.find(u => u.id === values.userId);
//         const currentUserName = `${userProfile?.firstName || ''} ${userProfile?.lastName || ''}`.trim() || user.email || 'HR';
        
//         // Save the document
//         const docRef = await addDoc(collection(db, "documents"), {
//             userId: values.userId,
//             userEmail: selectedUser?.email,
//             firstName: selectedUser?.firstName || '',
//             lastName: selectedUser?.lastName || '',
//             department: selectedUser?.department || 'Nessuno',
//             title: values.title,
//             type: values.type,
//             expiration: values.hasExpiration ? format(values.expiration!, "yyyy-MM-dd") : null,
//             fileUrl: fileDataUrl, 
//             uploadedAt: serverTimestamp(),
//         });

//         // NEW: Notify the assigned user about the document
//         const document = {
//             id: docRef.id,
//             title: values.title,
//             assignedToUserId: values.userId,
//             assignedToUserName: selectedUser?.name || selectedUser?.email || 'Utente',
//             assignedByUserName: currentUserName
//         };

//         await notifyDocumentAssigned(document);
//         console.log(`Notified user ${values.userId} about new document assignment`);

//         toast({
//             title: "Documento Caricato",
//             description: "Il nuovo documento è stato salvato con successo.",
//         });
//         onSuccess();
//     } catch (error) {
//         console.error("Error processing document: ", error);
//         toast({ variant: "destructive", title: "Errore", description: "Impossibile salvare il documento. Assicurati che il file non superi 1MB." });
//     } finally {
//         setIsSubmitting(false);
//     }
// }

//     return (
//         <Form {...form}>
//             <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
//                 {isHr && (
//                     <FormField
//                         control={form.control}
//                         name="userId"
//                         render={({ field }) => (
//                             <FormItem>
//                                 <FormLabel>Dipendente</FormLabel>
//                                 <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isSubmitting}>
//                                     <FormControl>
//                                         <SelectTrigger>
//                                             <SelectValue placeholder="Seleziona un dipendente" />
//                                         </SelectTrigger>
//                                     </FormControl>
//                                     <SelectContent>
//                                         {allUsers.map(u => (
//                                             <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
//                                         ))}
//                                     </SelectContent>
//                                 </Select>
//                                 <FormMessage />
//                             </FormItem>
//                         )}
//                     />
//                 )}
//                  <FormField
//                     control={form.control}
//                     name="title"
//                     render={({ field }) => (
//                         <FormItem>
//                             <FormLabel>Titolo Documento</FormLabel>
//                             <FormControl>
//                                 <Input placeholder="es. Patente di guida" {...field} disabled={isSubmitting}/>
//                             </FormControl>
//                             <FormMessage />
//                         </FormItem>
//                     )}
//                 />
//                  <FormField
//                     control={form.control}
//                     name="type"
//                     render={({ field }) => (
//                         <FormItem>
//                             <FormLabel>Tipo</FormLabel>
//                              <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isSubmitting}>
//                                 <FormControl>
//                                     <SelectTrigger>
//                                         <SelectValue placeholder="Seleziona un tipo" />
//                                     </SelectTrigger>
//                                 </FormControl>
//                                 <SelectContent>
//                                     {documentTypes.map(type => (
//                                         <SelectItem key={type} value={type}>{type}</SelectItem>
//                                     ))}
//                                 </SelectContent>
//                             </Select>
//                             <FormMessage />
//                         </FormItem>
//                     )}
//                 />

//                 <FormField
//                     control={form.control}
//                     name="hasExpiration"
//                     render={({ field }) => (
//                         <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
//                         <div className="space-y-0.5">
//                             <FormLabel>Ha una scadenza?</FormLabel>
//                             <FormDescription>
//                                 Attiva se il documento ha una data di scadenza.
//                             </FormDescription>
//                         </div>
//                         <FormControl>
//                             <Switch
//                             checked={field.value}
//                             onCheckedChange={field.onChange}
//                             disabled={isSubmitting}
//                             />
//                         </FormControl>
//                         </FormItem>
//                     )}
//                 />

//                 {hasExpiration && (
//                      <FormField
//                         control={form.control}
//                         name="expiration"
//                         render={({ field }) => (
//                             <FormItem className="flex flex-col">
//                                 <FormLabel>Data di Scadenza</FormLabel>
//                                 <Popover>
//                                     <PopoverTrigger asChild>
//                                     <FormControl>
//                                         <Button
//                                         variant={"outline"}
//                                         className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}
//                                         disabled={isSubmitting}
//                                         >
//                                         {field.value ? (format(field.value, "PPP", { locale: it })) : (<span>Scegli una data</span>)}
//                                         <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
//                                         </Button>
//                                     </FormControl>
//                                     </PopoverTrigger>
//                                     <PopoverContent className="w-auto p-0" align="start">
//                                     <Calendar locale={it} mode="single" selected={field.value} onSelect={field.onChange} initialFocus/>
//                                     </PopoverContent>
//                                 </Popover>
//                                 <FormMessage />
//                             </FormItem>
//                         )}
//                     />
//                 )}
               
//                  <FormField
//                     control={form.control}
//                     name="file"
//                     render={({ field: { onChange, value, ...field } }) => (
//                         <FormItem>
//                         <FormLabel>File (PDF, max 1MB)</FormLabel>
//                         <FormControl>
//                             <Input
//                             type="file"
//                             accept=".pdf"
//                             onChange={(e) => onChange(e.target.files ? e.target.files[0] : null)}
//                             disabled={isSubmitting}
//                             />
//                         </FormControl>
//                         <FormMessage />
//                         </FormItem>
//                     )}
//                     />
                                
//                 <Button type="submit" className="w-full" disabled={isSubmitting || !form.formState.isValid}>
//                     {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
//                     {isSubmitting ? 'Salvataggio...' : 'Salva Documento'}
//                 </Button>
//             </form>
//         </Form>
//     )
// }

