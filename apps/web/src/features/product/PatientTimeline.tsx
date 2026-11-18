import { can, type TimelineItem } from '@sim/contracts';
import { Box, Camera, FileSignature, MessageSquare, Trash2, UserPlus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, Loading } from '../../components/ui/States';
import { toast } from '../../components/ui/Toaster';
import { errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth-store';
import { formatDateTime } from '../../lib/format';
import { useNoteActions, usePatientNotes, usePatientTimeline } from './queries';

const ICON: Record<TimelineItem['kind'], ReactNode> = {
  PATIENT: <UserPlus className="size-4" aria-hidden />,
  CONSENT: <FileSignature className="size-4" aria-hidden />,
  CAPTURE: <Camera className="size-4" aria-hidden />,
  SIMULATION: <Box className="size-4" aria-hidden />,
  NOTE: <MessageSquare className="size-4" aria-hidden />,
};

/** Anotações da equipe e linha do tempo do paciente. */
export function PatientTimeline({ patientId }: { patientId: string }) {
  const role = useAuth((s) => s.user?.role ?? 'RECEPCAO');
  const userId = useAuth((s) => s.user?.id);
  const timeline = usePatientTimeline(patientId);
  const canNotes = can(role, 'captures.read');
  const notes = usePatientNotes(patientId, canNotes);
  const actions = useNoteActions(patientId);
  const [text, setText] = useState('');
  const noteAuthor = new Map((notes.data ?? []).map((n) => [`note-${n.id}`, n]));

  async function add() {
    try {
      await actions.add.mutateAsync({ text });
      setText('');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Card>
      <CardHeader title="Anotações e linha do tempo" description="Tudo o que aconteceu com este paciente, do mais novo ao mais antigo." />
      {can(role, 'captures.write') && (
        <div className="border-b border-line px-5 py-4">
          <label htmlFor="nova-nota" className="mb-1 block text-sm font-medium">Nova anotação</label>
          <textarea
            id="nova-nota"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            rows={3}
            className="w-full rounded-lg border border-field bg-surface px-3 py-2 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-xs text-muted">Evite dados sensíveis além do necessário para o atendimento.</p>
            <Button size="sm" onClick={add} loading={actions.add.isPending} disabled={!text.trim()}>Anotar</Button>
          </div>
        </div>
      )}
      {timeline.isPending ? (
        <Loading />
      ) : timeline.isError ? (
        <ErrorState error={timeline.error} onRetry={() => timeline.refetch()} />
      ) : timeline.data.length === 0 ? (
        <EmptyState title="Nada por aqui ainda" />
      ) : (
        <ol className="divide-y divide-line">
          {timeline.data.map((it) => {
            const note = noteAuthor.get(it.id);
            const canDelete = !!note && (note.author.id === userId || can(role, 'patients.delete')) && can(role, 'captures.write');
            return (
              <li key={it.id} className="flex gap-3 px-5 py-3">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-subtle text-muted">{ICON[it.kind]}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {it.ref?.type === 'simulation' ? <Link to={`/simulations/${it.ref.id}`} className="hover:underline">{it.title}</Link> : it.title}
                  </p>
                  {it.detail && <p className="whitespace-pre-wrap text-sm text-muted">{it.detail}</p>}
                  <p className="text-xs text-faint">{formatDateTime(it.at)}{it.by ? ` · ${it.by}` : ''}</p>
                </div>
                {canDelete && (
                  <Button variant="ghost" size="sm" aria-label="Apagar anotação" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => actions.remove.mutate(note.id, { onError: (e) => toast.error(errorMessage(e)) })} />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
