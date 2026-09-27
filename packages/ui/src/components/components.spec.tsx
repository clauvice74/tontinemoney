import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Alert } from './alert';
import { Button } from './button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './dialog';
import { FormField } from './form-field';
import { Input } from './input';
import { CursorPagination } from './pagination';
import { Toaster, toast } from './toast';

describe('Button', () => {
  it('désactive le bouton et signale le chargement', () => {
    render(<Button loading>Envoyer</Button>);
    const button = screen.getByRole('button', { name: 'Envoyer' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('rend son enfant avec asChild', () => {
    render(
      <Button asChild>
        <a href="/login">Connexion</a>
      </Button>,
    );
    expect(screen.getByRole('link', { name: 'Connexion' })).toHaveAttribute('href', '/login');
  });
});

describe('FormField', () => {
  it('relie libellé, aide et erreur au contrôle', () => {
    render(
      <FormField id="email" label="Email" description="Adresse de contact" error="Requis" required>
        <Input />
      </FormField>,
    );
    const input = screen.getByLabelText(/Email/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'email-description email-error');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Requis');
  });
});

describe('Alert', () => {
  it('annonce les erreurs avec role="alert"', () => {
    render(<Alert variant="destructive" title="Erreur" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Erreur');
  });
  it('utilise role="status" pour les informations', () => {
    render(<Alert variant="info" title="Info" />);
    expect(screen.getByRole('status')).toHaveTextContent('Info');
  });
});

describe('CursorPagination', () => {
  it('désactive les boutons selon les curseurs disponibles', async () => {
    const onNext = vi.fn();
    render(
      <CursorPagination
        page={1}
        hasPrevious={false}
        hasNext
        onPrevious={() => undefined}
        onNext={onNext}
      />,
    );
    expect(screen.getByRole('button', { name: 'Page précédente' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Page suivante' }));
    expect(onNext).toHaveBeenCalledOnce();
  });
});

describe('Dialog', () => {
  it('s’ouvre au clic et se ferme avec Échap', async () => {
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Ouvrir</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Confirmer</DialogTitle>
          <DialogDescription>Êtes-vous sûr ?</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ouvrir' }));
    expect(screen.getByRole('dialog', { name: 'Confirmer' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Toaster', () => {
  it('affiche les toasts émis', () => {
    render(<Toaster />);
    act(() => {
      toast.success('Dépôt initié', 'Confirmez sur votre téléphone');
    });
    expect(screen.getByText('Dépôt initié')).toBeInTheDocument();
    expect(screen.getByText('Confirmez sur votre téléphone')).toBeInTheDocument();
  });
});
