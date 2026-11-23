import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  can,
  PatientNoteCreate,
  SIMULATION_DISCLAIMER,
  PROCEDURE_PRESETS,
  SLIDER_MAX_MM,
  SLIDERS,
  SimulationParams,
  type DashboardStats,
  type PatientNote,
  type TimelineItem,
} from '@sim/contracts';
import type { Response } from 'express';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, RequirePermission, type AuthContext } from '../common/auth-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PatientsModule } from '../patients/patients.module.js';
import { PatientsService } from '../patients/patients.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

/** Roda uma de cada vez: o banco local de desenvolvimento (PGlite) atende uma conexão por vez e trava com consultas simultâneas. */
async function inOrder<T extends (() => Promise<unknown>)[]>(fns: [...T]): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const out: unknown[] = [];
  for (const f of fns) out.push(await f());
  return out as never;
}

const startOfMonth = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

@Injectable()
export class ProductService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly patients: PatientsService,
  ) {}

  private async names(ids: string[]) {
    const rows = await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
    return new Map(rows.map((u) => [u.id, u.name]));
  }

  // ---- Painel ----
  async dashboard(me: AuthContext): Promise<DashboardStats> {
    const clinicId = me.clinicId;
    const month = startOfMonth();
    const active = { revokedAt: null, scopes: { has: 'SIMULATION' as const } };
    const live = { clinicId, deletedAt: null };
    const sees = can(me.role, 'captures.read');
    const [total, withActive, newThisMonth, capMonth, capOpen, simTotal, simMonth, verMonth] = await inOrder([
      () => this.prisma.patient.count({ where: live }),
      () => this.prisma.patient.count({ where: { ...live, consents: { some: active } } }),
      () => this.prisma.patient.count({ where: { ...live, createdAt: { gte: month } } }),
      () => this.prisma.captureSession.count({ where: { clinicId, createdAt: { gte: month } } }),
      () => this.prisma.captureSession.count({ where: { clinicId, status: 'OPEN' } }),
      () => this.prisma.simulation.count({ where: { clinicId } }),
      () => this.prisma.simulation.count({ where: { clinicId, createdAt: { gte: month } } }),
      () => this.prisma.simulationVersion.count({ where: { simulation: { clinicId }, createdAt: { gte: month } } }),
    ]);

    let recent: DashboardStats['recent'] = [];
    if (sees) {
      const caps = await this.prisma.captureSession.findMany({ where: { clinicId }, orderBy: { createdAt: 'desc' }, take: 6, select: { patientId: true, createdAt: true } });
      const sims = await this.prisma.simulation.findMany({ where: { clinicId }, orderBy: { createdAt: 'desc' }, take: 6, select: { patientId: true, createdAt: true } });
      const patientRows = await this.prisma.patient.findMany({
        where: { clinicId, deletedAt: null, id: { in: [...caps, ...sims].map((x) => x.patientId) } },
        select: { id: true, name: true },
      });
      const byId = new Map(patientRows.map((p) => [p.id, p.name]));
      recent = [
        ...caps.map((c) => ({ kind: 'CAPTURE' as const, patientId: c.patientId, at: c.createdAt })),
        ...sims.map((c) => ({ kind: 'SIMULATION' as const, patientId: c.patientId, at: c.createdAt })),
      ]
        .filter((x) => byId.has(x.patientId))
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .slice(0, 8)
        .map((x) => ({ kind: x.kind, patientId: x.patientId, patientName: byId.get(x.patientId)!, at: x.at.toISOString() }));
    }

    return {
      patients: { total, withActiveConsent: withActive, pendingConsent: total - withActive, newThisMonth },
      captures: { thisMonth: capMonth, open: capOpen },
      simulations: { total: simTotal, thisMonth: simMonth, versionsThisMonth: verMonth },
      recent,
    };
  }

  // ---- Anotações ----
  async listNotes(me: AuthContext, patientId: string): Promise<PatientNote[]> {
    await this.patients.findOwned(me.clinicId, patientId);
    const rows = await this.prisma.patientNote.findMany({ where: { clinicId: me.clinicId, patientId }, orderBy: { createdAt: 'desc' } });
    const who = await this.names(rows.map((r) => r.authorId));
    return rows.map((r) => ({ id: r.id, text: r.text, createdAt: r.createdAt.toISOString(), author: { id: r.authorId, name: who.get(r.authorId) ?? '—' } }));
  }

  async addNote(me: AuthContext, patientId: string, input: PatientNoteCreate): Promise<PatientNote> {
    await this.patients.findOwned(me.clinicId, patientId);
    const n = await this.prisma.$transaction(async (tx) => {
      const created = await tx.patientNote.create({ data: { clinicId: me.clinicId, patientId, authorId: me.userId, text: input.text } });
      await this.audit.log(me, 'NOTE_CREATE', 'patient', patientId, tx);
      return created;
    });
    const who = await this.names([me.userId]);
    return { id: n.id, text: n.text, createdAt: n.createdAt.toISOString(), author: { id: me.userId, name: who.get(me.userId) ?? '—' } };
  }

  /** Quem escreveu apaga a própria anotação; gerência apaga qualquer uma. */
  async deleteNote(me: AuthContext, noteId: string): Promise<void> {
    const n = await this.prisma.patientNote.findFirst({ where: { id: noteId, clinicId: me.clinicId } });
    if (!n) throw new NotFoundException('Anotação não encontrada');
    if (n.authorId !== me.userId && !can(me.role, 'patients.delete')) {
      throw new ForbiddenException('Só quem escreveu ou a gerência apaga esta anotação');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.patientNote.delete({ where: { id: noteId } });
      await this.audit.log(me, 'NOTE_DELETE', 'patient', n.patientId, tx);
    });
  }

  // ---- Linha do tempo ----
  async timeline(me: AuthContext, patientId: string): Promise<TimelineItem[]> {
    const patient = await this.patients.findOwned(me.clinicId, patientId);
    const clinicId = me.clinicId;
    const sees = can(me.role, 'captures.read');
    const [consents, captures, sims, notes] = await inOrder([
      () => this.prisma.consent.findMany({ where: { clinicId, patientId } }),
      async () => (sees ? await this.prisma.captureSession.findMany({ where: { clinicId, patientId }, include: { _count: { select: { photos: true } } } }) : []),
      async () => (sees ? await this.prisma.simulation.findMany({ where: { clinicId, patientId }, include: { _count: { select: { versions: true } } } }) : []),
      async () => (sees ? await this.prisma.patientNote.findMany({ where: { clinicId, patientId } }) : []),
    ]);
    const who = await this.names([
      ...consents.flatMap((c) => [c.collectedById, c.revokedById ?? '']),
      ...captures.map((c) => c.capturedById),
      ...sims.map((s) => s.createdById),
      ...notes.map((n) => n.authorId),
    ].filter(Boolean));
    const by = (id: string | null) => (id ? who.get(id) ?? null : null);

    const items: TimelineItem[] = [{ id: `patient-${patient.id}`, kind: 'PATIENT', title: 'Paciente cadastrado', at: patient.createdAt.toISOString(), by: null }];
    for (const c of consents) {
      items.push({ id: `consent-${c.id}`, kind: 'CONSENT', title: 'Termo de consentimento assinado', detail: `Assinado por ${c.signerName}`, at: c.signedAt.toISOString(), by: by(c.collectedById) });
      if (c.revokedAt) items.push({ id: `consent-rev-${c.id}`, kind: 'CONSENT', title: 'Termo revogado', at: c.revokedAt.toISOString(), by: by(c.revokedById) });
    }
    for (const c of captures) {
      const status = c.status === 'COMPLETED' ? 'concluída' : c.status === 'CANCELED' ? 'cancelada' : 'em andamento';
      items.push({ id: `capture-${c.id}`, kind: 'CAPTURE', title: `Captura facial ${status}`, detail: `${c._count.photos} foto(s)`, at: c.createdAt.toISOString(), by: by(c.capturedById), ref: { type: 'capture', id: c.id } });
    }
    for (const s of sims) {
      items.push({ id: `sim-${s.id}`, kind: 'SIMULATION', title: `Simulação “${s.name}”`, detail: `${s._count.versions} versão(ões) salva(s)`, at: s.createdAt.toISOString(), by: by(s.createdById), ref: { type: 'simulation', id: s.id } });
    }
    for (const n of notes) {
      items.push({ id: `note-${n.id}`, kind: 'NOTE', title: 'Anotação', detail: n.text, at: n.createdAt.toISOString(), by: by(n.authorId) });
    }
    return items.sort((a, b) => b.at.localeCompare(a.at));
  }

  // ---- Relatório em PDF ----
  async simulationReport(me: AuthContext, simulationId: string, versionId?: string): Promise<Buffer> {
    const sim = await this.prisma.simulation.findFirst({ where: { id: simulationId, clinicId: me.clinicId } });
    if (!sim) throw new NotFoundException('Simulação não encontrada');
    const version = await this.prisma.simulationVersion.findFirst({
      where: { simulationId, ...(versionId ? { id: versionId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    if (!version) throw new NotFoundException(versionId ? 'Versão não encontrada' : 'A simulação ainda não tem versão salva');
    const [clinic, patient, who] = await Promise.all([
      this.prisma.clinic.findUniqueOrThrow({ where: { id: me.clinicId }, select: { name: true, logoKey: true } }),
      this.patients.findOwned(me.clinicId, sim.patientId),
      this.names([me.userId, version.createdById]),
    ]);
    const logo = clinic.logoKey ? await this.storage.get(clinic.logoKey) : null;
    const thumb = version.thumbnailKey ? await this.storage.get(version.thumbnailKey) : null;
    const params = SimulationParams.catch({}).parse(version.params);
    const pdf = await buildReportPdf({
      clinicName: clinic.name,
      logo,
      thumb,
      patientName: patient.name,
      simulationName: sim.name,
      versionName: version.name,
      description: version.description,
      versionDate: version.createdAt,
      versionAuthor: who.get(version.createdById) ?? '—',
      generatedBy: who.get(me.userId) ?? '—',
      params,
      hasSculpt: !!version.sculpt,
    });
    await this.audit.log(me, 'REPORT_GENERATE', 'simulation', simulationId);
    return pdf;
  }
}

export interface ReportData {
  clinicName: string;
  logo: Buffer | null;
  thumb: Buffer | null;
  patientName: string;
  simulationName: string;
  versionName: string;
  description: string | null;
  versionDate: Date;
  versionAuthor: string;
  generatedBy: string;
  params: SimulationParams;
  hasSculpt: boolean;
}

/** WinAnsi (fonte padrão do PDF) não tem todos os caracteres; troca o que faltar por algo legível. */
const safe = (t: string) => t.replace(/[^\x20-\x7e\xa0-\xff“”‘’–—•]/g, '?').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of safe(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

const isPng = (b: Buffer) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

export async function buildReportPdf(d: ReportData): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Relatório de simulação - ${safe(d.patientName)}`);
  pdf.setCreator('Sculpta');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 48;
  const ink = rgb(0.09, 0.12, 0.14);
  const muted = rgb(0.38, 0.43, 0.46);
  const accent = rgb(0.04, 0.4, 0.38);
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  /** Abre outra página quando não cabe mais (o rodapé é desenhado em todas no fim). */
  const ensureSpace = (h: number) => {
    if (y - h < M + 80) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
  };

  // Cabeçalho com o logo da clínica (se houver)
  let x = M;
  if (d.logo) {
    try {
      const img = isPng(d.logo) ? await pdf.embedPng(d.logo) : await pdf.embedJpg(d.logo);
      const s = Math.min(46 / img.height, 120 / img.width);
      page.drawImage(img, { x: M, y: y - img.height * s, width: img.width * s, height: img.height * s });
      x = M + img.width * s + 14;
    } catch {
      /* logo ilegível: segue sem ele */
    }
  }
  page.drawText(safe(d.clinicName), { x, y: y - 16, size: 16, font: bold, color: ink });
  page.drawText('Relatório de simulação estética', { x, y: y - 34, size: 10.5, font: regular, color: muted });
  y -= 64;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: accent });
  y -= 26;

  const row = (label: string, value: string) => {
    page.drawText(label, { x: M, y, size: 9.5, font: regular, color: muted });
    page.drawText(safe(value), { x: M + 110, y, size: 11, font: bold, color: ink });
    y -= 18;
  };
  row('Paciente', d.patientName);
  row('Simulação', d.simulationName);
  row('Versão', d.versionName);
  row('Salva em', d.versionDate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + ' por ' + d.versionAuthor);
  y -= 8;

  if (d.thumb) {
    try {
      const img = isPng(d.thumb) ? await pdf.embedPng(d.thumb) : await pdf.embedJpg(d.thumb);
      const s = Math.min(200 / img.height, 260 / img.width);
      page.drawImage(img, { x: M, y: y - img.height * s, width: img.width * s, height: img.height * s });
      y -= img.height * s + 14;
    } catch {
      /* miniatura ilegível */
    }
  }

  if (d.description) {
    page.drawText('Observação', { x: M, y, size: 11, font: bold, color: ink });
    y -= 16;
    for (const l of wrap(d.description, regular, 10.5, W - 2 * M)) {
      page.drawText(l, { x: M, y, size: 10.5, font: regular, color: ink });
      y -= 14;
    }
    y -= 8;
  }

  page.drawText('Procedimentos simulados', { x: M, y, size: 11, font: bold, color: ink });
  y -= 4;
  // um bloco por procedimento: intensidade de cada ajuste em % do limite da simulação e em mm aproximados
  const groups = PROCEDURE_PRESETS.map((pr) => ({
    pr,
    items: SLIDERS.filter((x) => (pr.sliders as readonly string[]).includes(x.id))
      .map((x) => ({ x, v: d.params[x.id] ?? 0 }))
      .filter((r) => Math.abs(r.v) > 0.005),
  })).filter((g) => g.items.length > 0);
  if (groups.length === 0 && !d.hasSculpt) {
    y -= 14;
    page.drawText('Nenhum ajuste nesta versão.', { x: M, y, size: 10.5, font: regular, color: muted });
    y -= 16;
  }
  for (const { pr, items } of groups) {
    ensureSpace(34 + items.length * 18 + 30);
    y -= 22;
    page.drawText(safe(pr.label), { x: M, y, size: 11, font: bold, color: accent });
    for (const { x: sl, v } of items) {
      y -= 17;
      page.drawText(safe(sl.label), { x: M + 10, y, size: 10, font: regular, color: ink });
      // barra de -100% a +100% do limite do controle
      const bx = M + 235, bw = 110;
      page.drawRectangle({ x: bx, y: y - 1, width: bw, height: 8, color: rgb(0.92, 0.94, 0.95) });
      const mid = bx + bw / 2;
      page.drawRectangle({ x: v >= 0 ? mid : mid + (v * bw) / 2, y: y - 1, width: Math.abs(v * bw) / 2, height: 8, color: accent });
      const mm = Math.abs(v) * SLIDER_MAX_MM[sl.id];
      const sign = v < 0 ? '-' : '';
      page.drawText(`${sign}${Math.round(Math.abs(v) * 100)}% do limite | ${sign}${mm.toFixed(1).replace('.', ',')} mm`, {
        x: bx + bw + 8,
        y,
        size: 9,
        font: bold,
        color: ink,
      });
    }
    y -= 4;
    for (const l of wrap(pr.limitation, regular, 8.5, W - 2 * M - 10)) {
      y -= 11;
      page.drawText(l, { x: M + 10, y, size: 8.5, font: regular, color: muted });
    }
  }
  if (d.hasSculpt) {
    ensureSpace(60);
    y -= 22;
    for (const l of wrap('Inclui modelagem fina e pontos de aplicação feitos no rosto 3D, dentro da zona dos procedimentos.', regular, 10.5, W - 2 * M)) {
      page.drawText(l, { x: M, y, size: 10.5, font: regular, color: ink });
      y -= 14;
    }
  }
  ensureSpace(70);
  y -= 14;
  page.drawText('Como ler', { x: M, y, size: 10, font: bold, color: ink });
  for (const t of [
    '100% é o limite máximo de cada controle nesta simulação; os milímetros são o deslocamento aproximado no modelo 3D de um rosto médio.',
    'Este relatório não traz faixa de resultado: ela só será incluída depois de validada por um profissional habilitado.',
  ]) {
    for (const l of wrap(t, regular, 9, W - 2 * M)) {
      y -= 12;
      page.drawText(l, { x: M, y, size: 9, font: regular, color: muted });
    }
  }

  // Rodapé de todas as páginas: aviso e rastro
  const foot = [
    SIMULATION_DISCLAIMER,
    'Os milimetros sao do modelo 3D (um rosto estimado a partir das fotos) e aproximados. Nao sao dose, volume de produto nem previsao de resultado: o resultado real pode ser menor ou maior.',
    `Gerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} por ${d.generatedBy}.`,
  ];
  for (const pg of pdf.getPages()) {
    let fy = M + 12 * foot.length + 24;
    pg.drawLine({ start: { x: M, y: fy }, end: { x: W - M, y: fy }, thickness: 0.5, color: muted });
    fy -= 14;
    for (const t of foot) {
      for (const l of wrap(t, regular, 8.5, W - 2 * M)) {
        pg.drawText(l, { x: M, y: fy, size: 8.5, font: regular, color: muted });
        fy -= 11;
      }
    }
  }
  return Buffer.from(await pdf.save());
}

const ReportQuery = z.object({ versionId: z.uuid().optional() });

@Controller()
export class ProductController {
  constructor(private readonly product: ProductService) {}

  @Get('dashboard')
  @RequirePermission('patients.read')
  dashboard(@CurrentUser() me: AuthContext) {
    return this.product.dashboard(me);
  }

  @Get('patients/:id/timeline')
  @RequirePermission('patients.read')
  timeline(@CurrentUser() me: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.product.timeline(me, id);
  }

  @Get('patients/:id/notes')
  @RequirePermission('captures.read')
  notes(@CurrentUser() me: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.product.listNotes(me, id);
  }

  @Post('patients/:id/notes')
  @RequirePermission('captures.write')
  addNote(
    @CurrentUser() me: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(PatientNoteCreate)) body: PatientNoteCreate,
  ) {
    return this.product.addNote(me, id, body);
  }

  @Delete('notes/:id')
  @HttpCode(204)
  @RequirePermission('captures.write')
  async deleteNote(@CurrentUser() me: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.product.deleteNote(me, id);
  }

  @Get('simulations/:id/report.pdf')
  @RequirePermission('reports.generate')
  async report(
    @CurrentUser() me: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(ReportQuery)) q: z.infer<typeof ReportQuery>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const bytes = await this.product.simulationReport(me, id, q.versionId);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="relatorio-simulacao.pdf"', 'Cache-Control': 'no-store' });
    return new StreamableFile(bytes);
  }
}

@Module({ imports: [PatientsModule], controllers: [ProductController], providers: [ProductService] })
export class ProductModule {}
