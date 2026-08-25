import { productBusinessName } from '../../application/presentation/productCopy';
import { useCloser } from '../../state/closerState';
import { OwnerShell } from './OwnerShell';

export function ProductLayout() {
  const { state, businessId, setBusinessId } = useCloser();
  return <OwnerShell
    businesses={state.businesses.map((business) => ({
      id: business.id,
      name: productBusinessName(business.kind, business.id, business.name),
    }))}
    businessId={businessId}
    onBusinessChange={setBusinessId}
    switcherLabel="עסק לדוגמה"
  />;
}
