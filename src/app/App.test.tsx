import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CloserProvider } from '../state/CloserContext';
import { createHarness } from '../test/harness';
import { App } from './App';

function renderAt(path: string) {
  const harness = createHarness();
  render(
    <MemoryRouter initialEntries={[path]}>
      <CloserProvider service={harness.service}>
        <App />
      </CloserProvider>
    </MemoryRouter>,
  );
  return harness;
}

describe('internal demo interface', () => {
  it.each([
    ['/demo', 'Luma Aesthetics'],
    ['/inbox', 'Inbox'],
    ['/customer/biz-clinic-contact-new', 'Alex Morgan'],
    ['/appointments', 'Appointments'],
    ['/quotes', 'Quotes & jobs'],
    ['/debug', 'Debug'],
  ])('renders the required route %s', (path, heading) => {
    renderAt(path);
    expect(screen.getByRole('heading', { name: heading, level: 1 })).toBeInTheDocument();
  });

  it('switches the active demo business without exposing the previous tenant list', async () => {
    const user = userEvent.setup();
    renderAt('/demo');
    await user.selectOptions(screen.getByLabelText('Demo business'), 'biz-detailing');
    expect(screen.getByRole('heading', { name: 'Northstar Auto Detail', level: 1 })).toBeInTheDocument();
    expect(screen.queryByText('Signature facial')).not.toBeInTheDocument();
  });

  it('processes a simulated customer reply and shows the structured assistant proposal', async () => {
    const user = userEvent.setup();
    renderAt('/customer/biz-clinic-contact-new');
    await user.type(screen.getByLabelText('Customer message'), 'What are your opening hours?');
    await user.click(screen.getByRole('button', { name: 'Process customer message' }));
    await waitFor(() => expect(screen.getByText('Latest assistant proposal')).toBeInTheDocument());
    expect(screen.getAllByText(/Sunday–Thursday/).length).toBeGreaterThan(0);
    expect(screen.getByText('Customer reply processed and next action updated.')).toBeInTheDocument();
  });

  it('resets quote form ownership when the demo business changes', async () => {
    const user = userEvent.setup();
    renderAt('/quotes');
    await user.selectOptions(screen.getByLabelText('Demo business'), 'biz-detailing');
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(await screen.findByText('Quote draft created.')).toBeInTheDocument();
    expect(screen.queryByText('Select a contact with a lead.')).not.toBeInTheDocument();
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
    expect(screen.getByText('Verified business information retrieved.', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText(/Sunday–Thursday/).length).toBeGreaterThan(0);
  });
});
