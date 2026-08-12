import type { ReactNode } from 'react';

export function Page({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <section className="page">
      <header className="page-header">
        <h1>{title}</h1>
        <p>{intro}</p>
      </header>
      {children}
    </section>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="card">
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function ErrorNotice({ message }: { message: string }) {
  return message ? <p className="notice error">{message}</p> : null;
}

export function SuccessNotice({ message }: { message: string }) {
  return message ? <p className="notice success">{message}</p> : null;
}

export function formatMoney(amountCents: number, currency: string): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).format(amountCents / 100);
}

export function readable(value: string): string {
  return value.toLowerCase().replaceAll('_', ' ');
}

export function displayError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}
