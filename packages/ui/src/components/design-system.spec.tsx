import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Avatar, avatarTone, initialsOf } from './avatar';
import { Button, buttonVariants } from './button';
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger } from './dropdown';
import { KpiCard } from './kpi-card';
import { ProgressBar } from './progress-bar';
import { Timeline } from './timeline';

describe('Charte — boutons', () => {
  it('Primary = CTA or vif + texte navy ; Secondary par défaut ; alias historiques conservés', () => {
    expect(buttonVariants({ variant: 'primary' })).toContain('bg-cta');
    expect(buttonVariants({ variant: 'primary' })).toContain('text-cta-foreground');
    expect(buttonVariants()).toContain('bg-primary');
    expect(buttonVariants({ variant: 'destructive' })).toBe(buttonVariants({ variant: 'danger' }));
    expect(buttonVariants({ size: 'lg' })).toContain('text-base');
    render(<Button variant="primary">Payer ma contribution</Button>);
    expect(screen.getByRole('button', { name: 'Payer ma contribution' })).toBeEnabled();
  });

  it('aucune graisse interdite (600/700) dans les variantes', () => {
    for (const v of ['primary', 'secondary', 'outline', 'ghost', 'danger'] as const)
      expect(buttonVariants({ variant: v })).not.toMatch(/font-(semibold|bold)/);
  });
});

describe('ProgressBar', () => {
  it('rôle progressbar, valeurs bornées, texte de valeur', () => {
    render(
      <ProgressBar
        value={14}
        max={12}
        label="Progression des cycles"
        valueText="Cycle 12 sur 12"
      />,
    );
    const bar = screen.getByRole('progressbar', { name: 'Progression des cycles' });
    expect(bar).toHaveAttribute('aria-valuenow', '12');
    expect(bar).toHaveAttribute('aria-valuetext', 'Cycle 12 sur 12');
  });
});

describe('Avatar', () => {
  it('deux initiales, teinte stable par identifiant, nom lisible par les lecteurs d’écran', () => {
    expect(initialsOf('awa diallo')).toBe('AD');
    expect(initialsOf('Bella')).toBe('BE');
    expect(avatarTone('id-1')).toBe(avatarTone('id-1'));
    render(<Avatar name="Awa Diallo" seed="id-1" />);
    expect(screen.getByText('Awa Diallo')).toHaveClass('sr-only');
  });
});

describe('Timeline', () => {
  it('liste ordonnée, étape courante signalée', () => {
    render(
      <Timeline
        items={[
          { id: '1', title: 'Cycle 1', status: 'done' },
          { id: '2', title: 'Cycle 2', status: 'current' },
          { id: '3', title: 'Cycle 3', status: 'upcoming' },
        ]}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('En cours')).toHaveClass('sr-only');
  });
});

describe('KpiCard', () => {
  it('valeur puis unité en texte secondaire', () => {
    render(<KpiCard label="Wallet total" value="1 250 000" unit="XAF" />);
    expect(screen.getByText('1 250 000')).toBeInTheDocument();
    expect(screen.getByText('XAF')).toHaveClass('text-muted-foreground');
  });
});

describe('Dropdown', () => {
  it('ouverture au clavier, éléments de menu accessibles', async () => {
    const user = userEvent.setup();
    render(
      <Dropdown>
        <DropdownTrigger asChild>
          <button type="button">Actions</button>
        </DropdownTrigger>
        <DropdownContent>
          <DropdownItem>Voir</DropdownItem>
          <DropdownItem destructive>Suspendre</DropdownItem>
        </DropdownContent>
      </Dropdown>,
    );
    screen.getByRole('button', { name: 'Actions' }).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menuitem', { name: 'Voir' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Suspendre' })).toBeInTheDocument();
  });
});
