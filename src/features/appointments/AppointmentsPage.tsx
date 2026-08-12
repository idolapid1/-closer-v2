import { useEffect, useState, type FormEvent } from 'react';
import { Card, Empty, ErrorNotice, Page, SuccessNotice, displayError, formatMoney, readable } from '../../components/ui';
import { AppointmentStatus, PaymentReferenceType, WorkflowType } from '../../domain/entities';
import { useCloser } from '../../state/closerState';

export function AppointmentsPage() {
  const { state, businessId, service } = useCloser();
  const business = state.businesses.find((candidate) => candidate.id === businessId);
  const appointments = state.appointments.filter((appointment) => appointment.businessId === businessId);
  const contacts = state.contacts.filter((contact) => contact.businessId === businessId);
  const leads = state.leads.filter((lead) => lead.businessId === businessId);
  const services = state.services.filter((item) => item.businessId === businessId);
  const staff = state.teamMembers.filter((member) => member.businessId === businessId && member.active);
  const firstContactId = contacts[0]?.id ?? '';
  const firstServiceId = services[0]?.id ?? '';
  const firstStaffId = staff[0]?.id ?? '';
  const [contactId, setContactId] = useState(firstContactId);
  const [serviceId, setServiceId] = useState(firstServiceId);
  const [staffId, setStaffId] = useState(firstStaffId);
  const [startAt, setStartAt] = useState('2026-08-17T09:00');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const currency = business?.currency ?? 'ILS';
  const selectedLead = leads.find((lead) => lead.contactId === contactId);
  useEffect(() => {
    setContactId(firstContactId);
    setServiceId(firstServiceId);
    setStaffId(firstStaffId);
  }, [businessId, firstContactId, firstServiceId, firstStaffId]);
  const slots = (() => {
    if (!serviceId || !staffId || !startAt) return [];
    try {
      return service.getAvailableSlots(businessId, serviceId, staffId, startAt.slice(0, 10));
    } catch {
      return [];
    }
  })();

  const create = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!selectedLead) return setError('Select a contact with a lead.');
    try {
      service.createAppointment({
        businessId,
        contactId,
        leadId: selectedLead.id,
        serviceId,
        staffId,
        startAt: new Date(startAt).toISOString(),
      });
      setSuccess('Appointment created. Record its deposit to confirm it.');
    } catch (caught) {
      setError(displayError(caught));
    }
  };

  const run = (action: () => unknown, message: string) => {
    setError('');
    try { action(); setSuccess(message); } catch (caught) { setError(displayError(caught)); }
  };

  return (
    <Page title="Appointments" intro="Availability, deposits, confirmation, completion, and balances without a calendar UI.">
      <ErrorNotice message={error} /><SuccessNotice message={success} />
      {business?.workflowType !== WorkflowType.AppointmentService ? (
        <p className="notice">This demo business uses the quote/job workflow. Switch to Luma Aesthetics to create appointments.</p>
      ) : null}
      <Card title="Create appointment">
        <form className="form-grid" onSubmit={create}>
          <label>Customer<select value={contactId} onChange={(event) => setContactId(event.target.value)}>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.displayName}</option>)}</select></label>
          <label>Service<select value={serviceId} onChange={(event) => setServiceId(event.target.value)}>{services.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Staff<select value={staffId} onChange={(event) => setStaffId(event.target.value)}>{staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
          <label>Start<input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label>
          <button type="submit" disabled={business?.workflowType !== WorkflowType.AppointmentService}>Create appointment</button>
        </form>
        <small>Available starts that day: {slots.slice(0, 8).map((slot) => new Date(slot).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })).join(', ') || 'none'}</small>
      </Card>
      <Card title="Appointments">
        {appointments.length === 0 ? <Empty>No appointments for this business.</Empty> : (
          <div className="table-wrap"><table><thead><tr><th>Customer</th><th>When</th><th>Status</th><th>Balance</th><th>Actions</th></tr></thead><tbody>
            {appointments.map((appointment) => {
              const balance = service.balance(businessId, PaymentReferenceType.Appointment, appointment.id);
              return <tr key={appointment.id}>
                <td>{contacts.find((contact) => contact.id === appointment.contactId)?.displayName}</td>
                <td>{new Date(appointment.startAt).toLocaleString()}</td>
                <td>{readable(appointment.status)}</td>
                <td>{formatMoney(balance, currency)}</td>
                <td><div className="button-row compact">
                  <button type="button" disabled={appointment.depositRequiredCents === 0 || balance <= appointment.totalCents - appointment.depositRequiredCents} onClick={() => run(() => service.recordDeposit(businessId, PaymentReferenceType.Appointment, appointment.id), 'Deposit recorded once.')}>Deposit</button>
                  <button type="button" disabled={appointment.status !== AppointmentStatus.Tentative} onClick={() => run(() => service.confirmAppointment(businessId, appointment.id), 'Appointment confirmed.')}>Confirm</button>
                  <button type="button" disabled={appointment.status === AppointmentStatus.Completed || appointment.status === AppointmentStatus.Cancelled} onClick={() => run(() => service.completeAppointment(businessId, appointment.id), 'Appointment completed; payment remains separate.')}>Complete</button>
                  <button type="button" disabled={balance === 0} onClick={() => run(() => service.collectRemainingBalance(businessId, PaymentReferenceType.Appointment, appointment.id), 'Remaining balance collected.')}>Collect balance</button>
                </div></td>
              </tr>;
            })}
          </tbody></table></div>
        )}
      </Card>
    </Page>
  );
}
