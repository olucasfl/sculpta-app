import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { PatientForm } from './PatientForm';

describe('PatientForm', () => {
  it('valida com o contrato antes de enviar e liga o erro ao campo', async () => {
    const onSubmit = vi.fn();
    render(<PatientForm submitLabel="Salvar" onSubmit={onSubmit} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText('Nome'), 'A');
    await userEvent.type(screen.getByLabelText(/Telefone/), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Nome')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Nome')).toHaveAccessibleDescription(/mín\. 2 letras/);
    expect(screen.getByText('Telefone inválido')).toBeInTheDocument();
  });

  it('envia só os campos preenchidos, já normalizados', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PatientForm submitLabel="Salvar" onSubmit={onSubmit} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText('Nome'), '  Ana Souza  ');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Ana Souza' });
  });

  it('mostra erros que vêm da API', async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      new ApiError(409, { statusCode: 409, code: 'CONFLICT', message: 'Registro duplicado' }),
    );
    render(<PatientForm submitLabel="Salvar" onSubmit={onSubmit} onCancel={() => {}} />);
    await userEvent.type(screen.getByLabelText('Nome'), 'Ana');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Registro duplicado');
  });
});
