import { z } from 'zod';

export const ConsentScope = z.enum(['SIMULATION', 'MARKETING', 'RESEARCH']);
export type ConsentScope = z.infer<typeof ConsentScope>;

export const CONSENT_SCOPE_INFO: Record<
  ConsentScope,
  { label: string; description: string; required: boolean }
> = {
  SIMULATION: {
    label: 'Captura, armazenamento e simulação',
    description:
      'Fotografar o rosto, gerar o modelo 3D e criar simulações ilustrativas para o meu atendimento nesta clínica.',
    required: true,
  },
  MARKETING: {
    label: 'Uso em divulgação',
    description:
      'Usar imagens ou simulações em materiais de divulgação da clínica. Opcional e independente do atendimento.',
    required: false,
  },
  RESEARCH: {
    label: 'Uso em estudos internos',
    description:
      'Usar dados anonimizados em estudos internos de qualidade. Opcional. As imagens nunca são usadas para treinar modelos de IA.',
    required: false,
  },
};

/**
 * Termo vigente. O texto exibido e a versão gravada saem daqui, para que o registro
 * aponte exatamente para o que a pessoa leu. Texto PROVISÓRIO: validar com o jurídico.
 */
export const CURRENT_TERM = {
  version: 'v1.0-2026-11',
  title: 'Termo de consentimento para captura de imagens e simulação estética 3D',
  draft: true,
  sections: [
    {
      heading: 'O que será feito',
      body: 'A clínica vai fotografar o seu rosto em até cinco ângulos e usar as fotos para gerar um modelo 3D. Sobre esse modelo, o profissional pode mostrar simulações visuais de alterações por região.',
    },
    {
      heading: 'A simulação é ilustrativa',
      body: 'A simulação serve para conversar sobre expectativas. Ela não é promessa nem garantia de resultado, não é avaliação clínica e não define procedimento, produto ou quantidade.',
    },
    {
      heading: 'Dados biométricos',
      body: 'Fotos do rosto e o modelo 3D podem ser considerados dados pessoais sensíveis (LGPD). Ficam em armazenamento privado, com acesso restrito à equipe da clínica, e não são usados para treinar modelos de inteligência artificial.',
    },
    {
      heading: 'Por quanto tempo',
      body: 'Os dados ficam guardados pelo prazo de retenção definido pela clínica ou até você pedir a exclusão.',
    },
    {
      heading: 'Revogação',
      body: 'Você pode revogar este consentimento a qualquer momento. A revogação do item obrigatório apaga as fotos, os modelos 3D e as simulações. Os usos opcionais podem ser aceitos ou recusados sem afetar o atendimento.',
    },
  ],
} as const;

export const SignerRelation = z.enum(['PACIENTE', 'RESPONSAVEL_LEGAL']);
export type SignerRelation = z.infer<typeof SignerRelation>;

export const SIGNER_RELATION_LABEL: Record<SignerRelation, string> = {
  PACIENTE: 'O próprio paciente',
  RESPONSAVEL_LEGAL: 'Responsável legal',
};

/** PNG em data URL, até ~400 KB. */
const SIGNATURE_MAX_CHARS = 550_000;

export const ConsentCreate = z.object({
  termVersion: z.literal(CURRENT_TERM.version, {
    error: 'Versão do termo desatualizada; recarregue a página',
  }),
  scopes: z
    .array(ConsentScope)
    .min(1, 'Marque ao menos a autorização obrigatória')
    .refine((s) => s.includes('SIMULATION'), 'O consentimento para captura e simulação é obrigatório')
    .refine((s) => new Set(s).size === s.length, 'Escopos repetidos'),
  signerName: z.string().trim().min(2, 'Informe quem está assinando').max(120),
  signerRelation: SignerRelation,
  signatureDataUrl: z
    .string()
    .startsWith('data:image/png;base64,', 'Assinatura inválida')
    .max(SIGNATURE_MAX_CHARS, 'Assinatura muito grande'),
});
export type ConsentCreate = z.infer<typeof ConsentCreate>;

export interface Consent {
  id: string;
  patientId: string;
  termVersion: string;
  scopes: ConsentScope[];
  signerName: string;
  signerRelation: SignerRelation;
  signedAt: string;
  revokedAt: string | null;
  collectedBy: { id: string; name: string };
}

/** Consentimento obrigatório ativo = existe um termo não revogado com escopo SIMULATION. */
export function hasActiveSimulationConsent(consents: Pick<Consent, 'scopes' | 'revokedAt'>[]) {
  return consents.some((c) => c.revokedAt === null && c.scopes.includes('SIMULATION'));
}
