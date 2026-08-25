import { Bot, Building2, CircleHelp, PlugZap, UsersRound } from 'lucide-react';
import { productBusinessName } from '../../application/presentation/productCopy';
import { useCloser } from '../../state/closerState';

export function MorePage() {
  const { businessId, state } = useCloser();
  const business = state.businesses.find((candidate) => candidate.id === businessId);
  const knowledge = state.businessKnowledge.find((candidate) => candidate.businessId === businessId);
  const team = state.teamMembers.filter((member) => member.businessId === businessId && member.active);
  const settings = state.businessSettings.find((candidate) => candidate.businessId === businessId);

  return (
    <section className="owner-page more-page">
      <header className="owner-page-header">
        <div>
          <p className="owner-eyebrow">העסק שלך ב־CLOSER</p>
          <h1>עוד</h1>
          <p>הגדרות עסק, צוות והגבולות שבתוכם CLOSER יכול לפעול.</p>
        </div>
      </header>

      <section className="more-business-identity">
        <Building2 aria-hidden="true" />
        <div>
          <span>העסק הפעיל</span>
          <h2>{business ? productBusinessName(business.kind, business.id, business.name) : 'CLOSER'}</h2>
          <p>{knowledge?.address ?? 'כתובת עדיין לא הוגדרה'} · {knowledge?.openingHours ?? 'שעות עדיין לא הוגדרו'}</p>
        </div>
      </section>

      <div className="more-groups">
        <MoreGroup icon={UsersRound} title="צוות" description={`${team.length} חברי צוות פעילים`} details={team.map((member) => member.name).join(' · ')} />
        <MoreGroup icon={Bot} title="התנהגות CLOSER" description="אוטומציה בטוחה עם גבולות ברורים" details={`${knowledge?.allowedAutomaticAnswers.length ?? 0} נושאים מותרים אוטומטית · החלטות חריגות עוברות לאדם`} />
        <MoreGroup icon={PlugZap} title="תקשורת ותשלומים" description="הערוצים והאמצעים שהעסק מקבל" details={(settings?.paymentMethods ?? knowledge?.acceptedPaymentMethods ?? []).join(' · ')} />
        <MoreGroup icon={CircleHelp} title="עזרה" description="הסבר על מצבים, פעולות וטיפול אנושי" details="CLOSER תמיד מציג מה כבר נעשה ומה נדרש ממך." />
      </div>

      <p className="more-phase-note">חיבורים חיים, חיוב והגדרות מתקדמות יופיעו רק כשיהיו זמינים בפועל.</p>
    </section>
  );
}

function MoreGroup({
  icon: Icon,
  title,
  description,
  details,
}: {
  icon: typeof Building2;
  title: string;
  description: string;
  details: string;
}) {
  return (
    <section className="more-group">
      <Icon aria-hidden="true" />
      <div><h2>{title}</h2><p>{description}</p><span>{details}</span></div>
    </section>
  );
}
