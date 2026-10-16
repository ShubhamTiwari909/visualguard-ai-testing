export interface AuditEvent {
  id: string;
  actorId: string;
  actorName: string;
  actorEmail: string;
  action: string;
  at: string;
  details: Record<string, string | number | boolean | { role?: string; disabled?: boolean }>;
}
export interface AuditPage {
  events: AuditEvent[];
  nextCursor?: string;
}
export interface OperationsStatus {
  transactions: boolean;
  identitySchema: number | null;
  admission: string;
  accountsScanned: number;
  inventoryComplete: boolean;
  activeAdministrators: number;
  activePasswordAdministrators: number;
  duplicateEmails: number;
  duplicateEmailGroups: { email: string; accounts: number }[];
  warnings: string[];
}
