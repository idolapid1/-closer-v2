import { useCloser } from '../state/closerState';

export function BusinessSwitcher() {
  const { state, businessId, setBusinessId } = useCloser();
  return (
    <label className="business-switcher">
      <span>Demo business</span>
      <select
        aria-label="Demo business"
        value={businessId}
        onChange={(event) => setBusinessId(event.target.value)}
      >
        {state.businesses.map((business) => (
          <option key={business.id} value={business.id}>
            {business.name}
          </option>
        ))}
      </select>
    </label>
  );
}
