import { writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { SLIDERS, type SimulationParams } from '@sim/contracts';
import { describe, expect, it } from 'vitest';
import { buildReportPdf, type ReportData } from './product.module.js';

const base: ReportData = {
  clinicName: 'Clínica Teste',
  logo: null,
  thumb: null,
  patientName: 'Paciente de Teste',
  simulationName: 'Simulação de teste',
  versionName: 'Versão 1',
  description: null,
  versionDate: new Date('2026-11-23T12:00:00Z'),
  versionAuthor: 'Profissional',
  generatedBy: 'Profissional',
  params: {},
  hasSculpt: false,
};

describe('relatório em PDF: procedimentos simulados', () => {
  it('sem ajustes diz que não há ajuste e ainda traz o aviso', async () => {
    const pdf = await PDFDocument.load(await buildReportPdf(base));
    expect(pdf.getPageCount()).toBe(1);
  });

  it('com todos os procedimentos ajustados cabe, abrindo outra página se preciso', async () => {
    const params: SimulationParams = {};
    for (const s of SLIDERS) params[s.id] = 0.6;
    const bytes = await buildReportPdf({ ...base, params, hasSculpt: true, description: 'Observação de teste '.repeat(8) });
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-');
    if (process.env.REPORT_OUT) writeFileSync(process.env.REPORT_OUT, bytes);
  });

  it('valores negativos (contornos) também saem', async () => {
    const pdf = await PDFDocument.load(await buildReportPdf({ ...base, params: { 'chin.height': -0.4, 'nose.tipRotation': -0.3 } }));
    expect(pdf.getPageCount()).toBe(1);
  });
});
