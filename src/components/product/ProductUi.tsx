import { ArrowLeft, Check, CircleAlert, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ProductActionView } from '../../application/presentation/ProductReadService';
import {
  formatActionAge,
  nextActionCta,
  nextActionDescription,
  nextActionTitle,
} from '../../application/presentation/productCopy';
import { NextActionType } from '../../domain/entities';

export function ProductPage({
  eyebrow,
  title,
  intro,
  children,
  actions,
}: {
  eyebrow?: string;
  title: string;
  intro: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="product-page">
      <header className="product-page-header">
        <div>
          {eyebrow ? <p className="product-page-eyebrow">{eyebrow}</p> : null}
          <h1>{title}</h1>
          <p>{intro}</p>
        </div>
        {actions ? <div className="product-page-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function SectionHeader({
  title,
  id,
  description,
  count,
  icon,
}: {
  title: string;
  id?: string;
  description?: string;
  count?: number;
  icon?: ReactNode;
}) {
  return (
    <header className="product-section-header">
      <div className="product-section-title">
        {icon}
        <h2 id={id}>{title}</h2>
        {count === undefined ? null : <span className="product-section-count">{count}</span>}
      </div>
      {description ? <p>{description}</p> : null}
    </header>
  );
}

export function CustomerAvatar({ name, size = 'medium' }: { name: string; size?: 'small' | 'medium' | 'large' }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
  return <span className={`customer-avatar customer-avatar-${size}`} aria-hidden="true">{initials}</span>;
}

export function ActionRow({
  action,
  currency,
  now,
}: {
  action: ProductActionView;
  currency: string;
  now: string;
}) {
  const urgent = action.actionType === NextActionType.HumanReview;
  return (
    <li className={`product-action-row${urgent ? ' is-urgent' : ''}`}>
      <div className="product-action-person">
        <CustomerAvatar name={action.customerName} />
        <div>
          <strong>{action.customerName}</strong>
          <span>{formatActionAge(action.dueAt ?? action.createdAt, now)}</span>
        </div>
      </div>
      <div className="product-action-copy">
        <strong>{nextActionTitle(action.actionType, action.customerName, action.amountCents, currency)}</strong>
        <span>{nextActionDescription(action.actionType)}</span>
      </div>
      <Link
        aria-label={`${nextActionCta(action.actionType)} עבור ${action.customerName}`}
        className="button button-secondary action-row-link"
        to={`/customer/${action.contactId}`}
      >
        {nextActionCta(action.actionType)}
        <ArrowLeft aria-hidden="true" />
      </Link>
    </li>
  );
}

export function EmptyState({
  title,
  children,
  variant = 'default',
}: {
  title: string;
  children: ReactNode;
  variant?: 'default' | 'success';
}) {
  const Icon = variant === 'success' ? Check : Inbox;
  return (
    <div className={`product-empty${variant === 'success' ? ' product-empty-success' : ''}`}>
      <Icon aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return message ? (
    <div className="product-feedback product-feedback-error" role="alert">
      <CircleAlert aria-hidden="true" />
      <span>{message}</span>
    </div>
  ) : null;
}

export function SuccessBanner({ message }: { message: string }) {
  return message ? (
    <div className="product-feedback product-feedback-success" role="status" aria-live="polite">
      <Check aria-hidden="true" />
      <span>{message}</span>
    </div>
  ) : null;
}
