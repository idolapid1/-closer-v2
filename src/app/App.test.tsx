import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CloserProvider } from '../state/CloserContext';
import { createHarness } from '../test/harness';
import { App } from './App';

function renderAt(path: string, harness = createHarness()) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <CloserProvider service={harness.service}>
        <App />
      </CloserProvider>
    </MemoryRouter>,
  );
  return harness;
}

describe('production product experience', () => {
  it.each([
    ['/inbox', 'פניות'],
    ['/actions', 'CLOSER עובד. נשאר רק להחליט.'],
    ['/customer/biz-clinic-contact-new', 'אלכס מור'],
  ])('renders the production route %s in Hebrew', (path, heading) => {
    renderAt(path);
    expect(screen.getByRole('heading', { name: heading, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'ניווט ראשי' })).toBeInTheDocument();
  });

  it.each([
    ['/demo', 'Luma Aesthetics'],
    ['/appointments', 'Appointments'],
    ['/quotes', 'Quotes & jobs'],
    ['/debug', 'Debug'],
  ])('preserves the internal route %s', (path, heading) => {
    renderAt(path);
    expect(screen.getByRole('heading', { name: heading, level: 1 })).toBeInTheDocument();
  });

  it('shows grouped Today actions with real payment truth and correct links', () => {
    renderAt('/actions');
    expect(screen.getByRole('heading', { name: 'צריך אותך עכשיו', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'היום', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'תשלומים', level: 2 })).toBeInTheDocument();
    expect(screen.getAllByText((content) => content.includes('315')).length).toBeGreaterThan(0);
    const mayaAction = screen.getByText('השיחה עם מאיה לוי דורשת טיפול').closest('li');
    expect(mayaAction).not.toBeNull();
    expect(within(mayaAction!).getByRole('link', { name: /פתח שיחה/ })).toHaveAttribute(
      'href',
      '/customer/biz-clinic-contact-handoff',
    );
  });

  it('names each Today region from its visible section heading', () => {
    renderAt('/actions');

    for (const name of ['צריך אותך עכשיו', 'היום', 'תשלומים']) {
      const heading = screen.getByRole('heading', { name, level: 2 });
      expect(screen.getByRole('region', { name })).toContainElement(heading);
    }
  });

  it('uses customer-specific accessible names for repeated Today links', () => {
    renderAt('/actions');

    expect(screen.getByRole('link', { name: 'פתח שיחה עבור מאיה לוי' })).toHaveAttribute(
      'href',
      '/customer/biz-clinic-contact-handoff',
    );
    expect(screen.getByRole('link', { name: 'בקש תשלום עבור יובל רוזן' })).toHaveAttribute(
      'href',
      '/customer/biz-clinic-contact-completed',
    );
  });

  it('presents a calm, complete Today empty state', () => {
    const harness = createHarness();
    vi.spyOn(harness.service, 'productToday').mockReturnValue({
      asOf: '2026-08-12T12:00:00.000Z',
      attention: [],
      commitments: [],
      payments: [],
      activeOpportunityCount: 0,
      automation: {
        preparedActions: 0,
        informationCollected: 0,
        progressedCustomers: 0,
      },
    });

    renderAt('/actions', harness);

    expect(screen.getByText('הכול מתקדם כרגע')).toBeInTheDocument();
    expect(screen.getByText('אין תורים או עבודות מתוכננות להיום.')).toBeInTheDocument();
    expect(screen.getByText('אין יתרות פתוחות שדורשות פעולה.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /עבור/ })).not.toBeInTheDocument();
  });

  it('keeps owner navigation lead-to-cash and hides engineering routes', () => {
    renderAt('/actions');
    const navigation = screen.getByRole('navigation', { name: 'ניווט ראשי' });

    for (const label of ['היום', 'לקוחות', 'יומן ועבודות', 'כסף', 'עוד']) {
      expect(within(navigation).getByText(label)).toBeInTheDocument();
    }
    expect(within(navigation).queryByText('כלי פיתוח')).not.toBeInTheDocument();
    expect(within(navigation).queryByText('סביבת הדגמה')).not.toBeInTheDocument();
    expect(within(navigation).queryByRole('link', { name: 'לקוחות' })).not.toBeInTheDocument();
  });

  it('keeps the mixed Hebrew and English masked heading in logical reading order', () => {
    renderAt('/actions');

    const heading = screen.getByRole('heading', {
      name: 'CLOSER עובד. נשאר רק להחליט.',
      level: 1,
    });
    const glyphs = heading.querySelectorAll('text');

    expect(glyphs[0]).toHaveAttribute('direction', 'ltr');
    expect(glyphs[0]).toHaveAttribute('text-anchor', 'end');
    expect(glyphs[1]).toHaveAttribute('direction', 'rtl');
    expect(glyphs[1]).toHaveAttribute('text-anchor', 'start');
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('falls back to the static ambient treatment when motion support is unavailable', () => {
    renderAt('/actions');

    expect(document.querySelector('.molten-metal-container')).toHaveAttribute(
      'data-renderer',
      'static',
    );
    expect(document.querySelector('.molten-metal-container canvas')).not.toBeInTheDocument();
  });

  it('keeps the ambient treatment static when reduced motion is requested', () => {
    const originalMatchMedia = window.matchMedia;
    const originalWebGl2 = window.WebGL2RenderingContext;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    Object.defineProperty(window, 'WebGL2RenderingContext', {
      configurable: true,
      value: class WebGl2RenderingContext {},
    });

    try {
      renderAt('/actions');
      expect(document.querySelector('.molten-metal-container')).toHaveAttribute(
        'data-renderer',
        'static',
      );
      expect(document.querySelector('.molten-metal-container canvas')).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: originalMatchMedia,
      });
      Object.defineProperty(window, 'WebGL2RenderingContext', {
        configurable: true,
        value: originalWebGl2,
      });
    }
  });

  it('switches the active demo business without exposing previous tenant actions', async () => {
    const user = userEvent.setup();
    renderAt('/actions');
    await user.selectOptions(screen.getByLabelText('עסק לדוגמה'), 'biz-detailing');
    expect(screen.getAllByText('נורת׳סטאר דיטיילינג').length).toBeGreaterThan(0);
    expect(screen.queryByText(/טיפול פנים/)).not.toBeInTheDocument();
  });

  it('selects an inbox conversation and exposes a readable thread', async () => {
    const user = userEvent.setup();
    renderAt('/inbox');
    const mayaOption = screen.getByRole('button', { name: /מאיה לוי/ });
    await user.click(mayaOption);
    expect(mayaOption).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('heading', { name: 'מאיה לוי', level: 2 })).toBeInTheDocument();
    expect(screen.getByText('השיחה בטיפול אנושי')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'החזר את העוזר' })).toBeInTheDocument();
  });

  it('uses an ordinary conversation list with native buttons', () => {
    renderAt('/inbox');

    const conversationList = screen.getByRole('list', { name: 'שיחות' });
    expect(within(conversationList).getAllByRole('button').length).toBeGreaterThan(0);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(within(conversationList).queryByRole('option')).not.toBeInTheDocument();
  });

  it('sends a mock business message from the inbox composer', async () => {
    const user = userEvent.setup();
    renderAt('/inbox?conversation=biz-clinic-conversation-waiting');
    await user.type(screen.getByLabelText('כתיבת הודעה'), 'היי דנה, איזה יום יתאים לך?');
    await user.click(screen.getByRole('button', { name: 'שליחה' }));
    expect(await screen.findByRole('status')).toHaveTextContent('ההודעה נשלחה.');
    expect(screen.getAllByText('היי דנה, איזה יום יתאים לך?').length).toBeGreaterThan(0);
  });

  it('shows customer payment balance and no developer-only assistant fields', () => {
    renderAt('/customer/biz-clinic-contact-completed');
    expect(screen.getByText('נותר לתשלום')).toBeInTheDocument();
    expect(screen.getAllByText((content) => content.includes('315') && content.includes('₪')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Confidence')).not.toBeInTheDocument();
    expect(screen.queryByText('Tool request')).not.toBeInTheDocument();
    expect(screen.queryByText('AI_ACTIVE')).not.toBeInTheDocument();
  });

  it('renders operational and marketing consent independently from customer truth', () => {
    const harness = createHarness();
    const consent = harness.database.repositories.consentRecords.get(
      'biz-clinic',
      'biz-clinic-consent-new',
    );
    expect(consent).not.toBeNull();
    harness.database.repositories.consentRecords.save('biz-clinic', {
      ...consent!,
      marketingAllowed: true,
      operationalAllowed: false,
      optedOut: false,
    });

    renderAt('/customer/biz-clinic-contact-new', harness);

    const communication = screen.getByRole('heading', { name: 'תקשורת', level: 2 }).closest('section');
    expect(communication).not.toBeNull();
    const operationalRow = within(communication!).getByText('הודעות תפעוליות').parentElement;
    const marketingRow = within(communication!).getByText('הודעות שיווקיות').parentElement;
    expect(operationalRow).toHaveTextContent('חסומות');
    expect(marketingRow).toHaveTextContent('מותרות');
  });

  it('shows Human Takeover and resumes only after explicit action', async () => {
    const user = userEvent.setup();
    const harness = renderAt('/customer/biz-clinic-contact-handoff');
    expect(screen.getByText('אתם מנהלים את השיחה עכשיו')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'החזר את העוזר' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('העוזר חזר לפעול.'));
    const conversation = harness.database.repositories.conversations.get(
      'biz-clinic',
      'biz-clinic-conversation-handoff',
    );
    expect(conversation?.mode).toBe('AI_ACTIVE');
  });

  it('presents a closed opportunity calmly without a stale primary sales action', () => {
    renderAt('/customer/biz-clinic-contact-lost');
    expect(screen.getAllByText('לא מעוניינ/ת כרגע').length).toBeGreaterThan(0);
    expect(screen.queryByText('הפעולה הבאה')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'פתח מחדש' })).toBeInTheDocument();
  });

  it('runs a grounded conversation in the debug simulator', async () => {
    const user = userEvent.setup();
    renderAt('/debug');
    await user.type(
      screen.getByLabelText('Simulator customer message'),
      'What are your opening hours?',
    );
    await user.click(screen.getByRole('button', { name: 'Simulate customer message' }));
    expect(await screen.findByText('Customer message processed.')).toBeInTheDocument();
    expect(screen.getByText('Latest grounded decision')).toBeInTheDocument();
    expect(screen.getAllByText(/Sunday–Thursday/).length).toBeGreaterThan(0);
  });

  it('resets quote form ownership when the demo business changes', async () => {
    const user = userEvent.setup();
    renderAt('/quotes');
    await user.selectOptions(screen.getByLabelText('Demo business'), 'biz-detailing');
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(await screen.findByText('Quote draft created.')).toBeInTheDocument();
    expect(screen.queryByText('Select a contact with a lead.')).not.toBeInTheDocument();
  });
});
