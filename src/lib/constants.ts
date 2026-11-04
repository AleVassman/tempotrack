
/**
 * USER ROLES
 * Defines the roles users can have within the application.
 */
export const USER_ROLES = {
    USER: 'user',
    ADMIN: 'admin',
    HR: 'hr',
  } as const;
  
  /**
   * TIME OFF REQUEST STATUSES
   * The different states a time-off request can be in.
   */
  export const TIME_OFF_STATUS = {
    PENDING: 'In Sospeso',
    APPROVED: 'Approvato',
    REJECTED: 'Rifiutato',
  } as const;
  
  /**
   * COMPENSATORY MOVE REQUEST STATUSES
   * The different states a compensatory day move request can be in.
   */
  export const MOVE_REQUEST_STATUS = {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
  } as const;
  
  /**
   * LEAVE TYPES
   * All available types for a time-off request.
   */
  export const LEAVE_TYPES = [
    { value: "Ferie", label: "Ferie" },
    { value: "Assenza non Retribuita", label: "Assenza non Retribuita" },
    { value: "Ex Festività", label: "Ex Festività" },
    { value: "Paternità", label: "Paternità" },
    { value: "Maternità", label: "Maternità" },
    { value: "Parentale", label: "Parentale" },
    { value: "Lutto", label: "Lutto" },
    { value: "Legge 104", label: "Legge 104" },
    { value: "Licenza Matrimoniale", label: "Licenza Matrimoniale" },
    { value: "Recupero Straordinari", label: "Recupero Straordinari" },
    { value: "Permesso per Donazione del Sangue", label: "Permesso per Donazione del Sangue" },
    { value: "Permesso per Formazione", label: "Permesso per Formazione" },
    { value: "Permesso non retribuito", label: "Permesso non retribuito" },
    { value: "Permesso di studio", label: "Permesso di studio" },
    { value: "ROL", label: "ROL" },
    { value: "Infortunio", label: "Infortunio" },
    { value: "Malattia", label: "Malattia" },
  ];
  
  /**
   * DEPARTMENTS
   * The list of departments in the organization.
   */
  export const DEPARTMENTS = [
    "Vendite",
    "Direzione",
    "Back Office",
    "Amministrazione",
    "Marketing",
    "Customer Care",
    "Logistica",
    "Assistenza Tecnica",
    "Nessuno"
  ];

  /**
   * PLANNING EXCLUSION
   * Users whose profile has `excludeFromPlanning: true` (e.g. external
   * consultants or service accounts) are hidden from the planner and timesheets.
   */
  export const isExcludedFromPlanning = (user: object | null | undefined): boolean =>
    (user as { excludeFromPlanning?: unknown } | null | undefined)?.excludeFromPlanning === true;
  
  /**
   * DAYS OF THE WEEK MAPPING
   * For work schedule and compensatory day management.
   */
  export const DAYS_OF_WEEK = [
    { id: 'LUN', label: 'Lunedì' },
    { id: 'MAR', label: 'Martedì' },
    { id: 'MER', label: 'Mercoledì' },
    { id: 'GIO', label: 'Giovedì' },
    { id: 'VEN', label: 'Venerdì' },
    { id: 'SAB', label: 'Sabato' },
    { id: 'DOM', label: 'Domenica' },
  ] as const;

  export const LEAVE_TYPE_COLORS: { [key: string]: string } = {
  // --- Core Leave Types with unique colors ---
  "Ferie": "hsl(var(--chart-1))",                   // Teal
  "Malattia": "hsl(var(--chart-4))",                 // Orange
  "ROL": "hsl(var(--chart-5))",                     // Pink/Red
  "Recupero Straordinari": "hsl(var(--chart-2))",    // Muted Blue
  "Permesso non retribuito": "hsl(var(--chart-3))", // Lavender
  "Ex Festività": "hsl(var(--chart-6))",              // Lime Green
  "Infortunio": "hsl(var(--chart-4))",                // Shares color with Malattia (logical grouping)
  
  // --- Other types can share or have unique colors as needed ---
  "Permesso di studio": "hsl(var(--chart-7))",       // Purple
  "Assenza non Retribuita": "hsl(var(--muted-foreground))", // Neutral Gray
  
  // These can share colors as they are less frequent
  "Paternità": "hsl(var(--chart-3))",
  "Maternità": "hsl(var(--chart-3))",
  "Parentale": "hsl(var(--chart-3))",
  "Lutto": "hsl(var(--muted-foreground))",
  "Legge 104": "hsl(var(--muted-foreground))",
  "Licenza Matrimoniale": "hsl(var(--chart-1))",
  "Permesso per Donazione del Sangue": "hsl(var(--chart-5))",
  "Permesso per Formazione": "hsl(var(--chart-2))",
};
/**
 * DEMO MODE
 * In the public portfolio demo, creating and deleting accounts is disabled so
 * visitors cannot remove the shared demo logins (it also needs Cloud Functions).
 */
export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
export const DEMO_USER_MANAGEMENT_MESSAGE =
  "La creazione e l'eliminazione degli utenti sono disattivate nella versione demo. Puoi comunque modificare i profili esistenti.";
