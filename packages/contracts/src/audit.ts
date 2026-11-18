export const AUDIT_ACTIONS = [
  'AUTH_LOGIN',
  'AUTH_LOGIN_FAILED',
  'PATIENT_CREATE',
  'PATIENT_VIEW',
  'PATIENT_UPDATE',
  'PATIENT_DELETE',
  'CONSENT_SIGN',
  'CONSENT_REVOKE',
  'CONSENT_SIGNATURE_VIEW',
  'BIOMETRIC_PURGE',
  'USER_CREATE',
  'USER_UPDATE',
  'CLINIC_UPDATE',
  'CAPTURE_CREATE',
  'CAPTURE_COMPLETE',
  'CAPTURE_CANCEL',
  'PHOTO_UPLOAD',
  'PHOTO_DELETE',
  'PHOTO_VIEW',
  'MESH_DOWNLOAD',
  'SIMULATION_CREATE',
  'SIMULATION_VERSION_SAVE',
  'SIMULATION_EXPORT',
  'RETENTION_PURGE',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  AUTH_LOGIN: 'Login',
  AUTH_LOGIN_FAILED: 'Falha de login',
  PATIENT_CREATE: 'Paciente cadastrado',
  PATIENT_VIEW: 'Paciente visualizado',
  PATIENT_UPDATE: 'Paciente editado',
  PATIENT_DELETE: 'Paciente excluído',
  CONSENT_SIGN: 'Termo assinado',
  CONSENT_REVOKE: 'Termo revogado',
  CONSENT_SIGNATURE_VIEW: 'Assinatura visualizada',
  BIOMETRIC_PURGE: 'Dados biométricos apagados',
  USER_CREATE: 'Usuário criado',
  USER_UPDATE: 'Usuário alterado',
  CLINIC_UPDATE: 'Clínica alterada',
  CAPTURE_CREATE: 'Captura iniciada',
  CAPTURE_COMPLETE: 'Captura concluída',
  CAPTURE_CANCEL: 'Captura cancelada',
  PHOTO_UPLOAD: 'Foto enviada',
  PHOTO_DELETE: 'Foto descartada',
  PHOTO_VIEW: 'Fotos visualizadas',
  MESH_DOWNLOAD: 'Modelo 3D aberto',
  SIMULATION_CREATE: 'Simulação criada',
  SIMULATION_VERSION_SAVE: 'Versão de simulação salva',
  SIMULATION_EXPORT: 'Simulação exportada',
  RETENTION_PURGE: 'Expurgo por prazo de retenção',
};

export interface AuditEntry {
  id: string;
  action: AuditAction;
  entity: string;
  entityId: string;
  user: { id: string; name: string } | null;
  ip: string | null;
  createdAt: string;
}
