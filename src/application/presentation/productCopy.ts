import {
  ActivityType,
  ConversationStage,
  NextActionType,
  HandoffReason,
  type BusinessKind,
  type AppointmentStatus,
  type CustomerFactKey,
  type JobStatus,
  type OpportunityLostReason,
  type QuoteStatus,
} from '../../domain/entities';

const demoBusinessNames: Record<string, string> = {
  'biz-clinic': 'לומה אסתטיקה',
  'biz-detailing': 'נורת׳סטאר דיטיילינג',
  'biz-home': 'ברייטהום שירותי בית',
};

const businessNames: Record<BusinessKind, string> = {
  CLINIC: 'לומה אסתטיקה',
  AUTO_DETAILING: 'נורת׳סטאר דיטיילינג',
  HOME_SERVICES: 'ברייטהום שירותי בית',
};

const serviceNames: Record<BusinessKind, string> = {
  CLINIC: 'טיפול פנים קלאסי',
  AUTO_DETAILING: 'דיטיילינג פנימי מלא',
  HOME_SERVICES: 'ביקור תיקונים בבית',
};

const demoServiceNames: Record<string, string> = {
  'biz-clinic-service-1': 'טיפול פנים קלאסי',
  'biz-detailing-service-1': 'דיטיילינג פנימי מלא',
  'biz-home-service-1': 'ביקור תיקונים בבית',
};

export function productBusinessName(kind: BusinessKind, businessId?: string, fallback?: string): string {
  return (businessId ? demoBusinessNames[businessId] : undefined) ?? fallback ?? businessNames[kind];
}

export function productServiceName(kind: BusinessKind, serviceId?: string, fallback?: string): string {
  return (serviceId ? demoServiceNames[serviceId] : undefined) ?? fallback ?? serviceNames[kind];
}

export function nextActionTitle(
  type: NextActionType,
  customerName: string,
  amountCents: number | null,
  currency = 'ILS',
): string {
  switch (type) {
    case NextActionType.HumanReview:
      return `השיחה עם ${customerName} דורשת טיפול`;
    case NextActionType.CollectBalance:
      return amountCents === null
        ? `${customerName} ממתינ/ה להסדרת תשלום`
        : `נותרו ${formatProductMoney(amountCents, currency)} לתשלום`;
    case NextActionType.FollowUpQuote:
      return amountCents === null
        ? `הצעת המחיר של ${customerName} מחכה למענה`
        : `הצעה של ${formatProductMoney(amountCents, currency)} מחכה למענה`;
    case NextActionType.RequestDeposit:
      return amountCents === null
        ? `צריך לבקש מקדמה מ${customerName}`
        : `צריך לבקש מקדמה של ${formatProductMoney(amountCents, currency)}`;
    case NextActionType.ScheduleJob:
      return `צריך לתאם עבודה ל${customerName}`;
    case NextActionType.OfferAppointment:
      return `צריך להציע תור ל${customerName}`;
    case NextActionType.ConfirmAppointment:
      return `צריך לאשר את התור של ${customerName}`;
    case NextActionType.PrepareQuote:
      return `${customerName} מחכה להצעת מחיר`;
    case NextActionType.SendQuote:
      return `הצעת המחיר של ${customerName} מוכנה לשליחה`;
    case NextActionType.RequestPhotos:
      return `צריך לבקש תמונות מ${customerName}`;
    case NextActionType.VerifyServiceArea:
      return `צריך לבדוק אם אפשר להגיע אל ${customerName}`;
    case NextActionType.ReviewPaymentClaim:
      return `צריך לבדוק את התשלום של ${customerName}`;
    case NextActionType.ServiceScheduled:
      return `העבודה של ${customerName} מתוכננת`;
    case NextActionType.AnswerQuestion:
      return `${customerName} מחכה לתשובה`;
    case NextActionType.ReplyToCustomer:
      return `${customerName} מחכה למענה`;
    case NextActionType.CollectInformation:
      return `חסרים פרטים כדי להתקדם עם ${customerName}`;
    case NextActionType.FollowUpCustomer:
      return `כדאי לחזור אל ${customerName}`;
    case NextActionType.FutureReactivation:
      return `כדאי לבדוק מה נשמע עם ${customerName}`;
  }
}

export function nextActionCta(type: NextActionType): string {
  switch (type) {
    case NextActionType.HumanReview:
    case NextActionType.AnswerQuestion:
    case NextActionType.ReplyToCustomer:
    case NextActionType.CollectInformation:
    case NextActionType.RequestPhotos:
    case NextActionType.FollowUpCustomer:
    case NextActionType.FutureReactivation:
      return 'פתח שיחה';
    case NextActionType.OfferAppointment:
    case NextActionType.ConfirmAppointment:
    case NextActionType.ServiceScheduled:
      return 'פתח תור';
    case NextActionType.PrepareQuote:
    case NextActionType.SendQuote:
    case NextActionType.FollowUpQuote:
      return 'פתח הצעה';
    case NextActionType.ScheduleJob:
      return 'תאם עבודה';
    case NextActionType.RequestDeposit:
      return 'בקש מקדמה';
    case NextActionType.CollectBalance:
      return 'בקש תשלום';
    case NextActionType.VerifyServiceArea:
      return 'בדוק אזור';
    case NextActionType.ReviewPaymentClaim:
      return 'בדוק תשלום';
  }
}

export function nextActionDescription(type: NextActionType): string {
  switch (type) {
    case NextActionType.HumanReview:
      return 'האוטומציה מושהית עד שתחליטו להחזיר אותה.';
    case NextActionType.CollectBalance:
      return 'העבודה הושלמה, אבל התשלום עדיין לא הושלם.';
    case NextActionType.FollowUpQuote:
      return 'ההצעה נשלחה ועדיין לא התקבלה תשובה.';
    case NextActionType.RequestDeposit:
      return 'המקדמה נדרשת כדי לאשר את העבודה.';
    case NextActionType.ScheduleJob:
      return 'המקדמה שולמה ואפשר לקבוע מועד.';
    case NextActionType.OfferAppointment:
      return 'כל הפרטים קיימים ואפשר להציע מועד.';
    case NextActionType.ConfirmAppointment:
      return 'המקדמה התקבלה; נשאר לאשר את התור.';
    case NextActionType.PrepareQuote:
      return 'נאספו מספיק פרטים כדי להכין הצעה.';
    case NextActionType.SendQuote:
      return 'הטיוטה מוכנה ומחכה לבדיקה ולשליחה.';
    case NextActionType.RequestPhotos:
      return 'התמונות נדרשות לפני שאפשר להתקדם.';
    case NextActionType.VerifyServiceArea:
      return 'צריך לוודא שהכתובת נמצאת באזור השירות.';
    case NextActionType.ReviewPaymentClaim:
      return 'הלקוח טען ששילם, אך אין תשלום מאומת.';
    case NextActionType.ServiceScheduled:
      return 'המועד נקבע ואין כרגע פעולה נוספת.';
    case NextActionType.AnswerQuestion:
      return 'יש שאלה פתוחה שמחכה לתשובה.';
    case NextActionType.ReplyToCustomer:
      return 'פנייה חדשה מחכה למענה ראשון.';
    case NextActionType.CollectInformation:
      return 'צריך להשלים את הפרטים החסרים בשיחה.';
    case NextActionType.FollowUpCustomer:
      return 'לא התקבלה תשובה וכדאי לשלוח תזכורת קצרה.';
    case NextActionType.FutureReactivation:
      return 'אין דחיפות, אבל כדאי לחזור לקשר בהמשך.';
  }
}

export function conversationStageLabel(stage: ConversationStage): string {
  switch (stage) {
    case ConversationStage.NewInquiry:
      return 'פנייה חדשה';
    case ConversationStage.Discovery:
    case ConversationStage.Qualification:
    case ConversationStage.InformationCollection:
      return 'אוספים פרטים';
    case ConversationStage.ReadyToBook:
    case ConversationStage.AppointmentProposed:
      return 'מוכן לקביעת תור';
    case ConversationStage.AwaitingConfirmation:
      return 'מחכה לאישור';
    case ConversationStage.ReadyForQuote:
    case ConversationStage.QuotePreparation:
      return 'מוכן להצעת מחיר';
    case ConversationStage.QuoteSent:
      return 'הצעה נשלחה';
    case ConversationStage.AwaitingDeposit:
      return 'מחכה למקדמה';
    case ConversationStage.Booked:
      return 'נקבע';
    case ConversationStage.JobScheduled:
      return 'העבודה מתוכננת';
    case ConversationStage.ServiceComplete:
    case ConversationStage.AwaitingBalance:
      return 'הושלם, נשאר תשלום';
    case ConversationStage.ClosedWon:
      return 'הושלם ושולם';
    case ConversationStage.ClosedLost:
      return 'לא ממשיכים כרגע';
    case ConversationStage.HumanReview:
      return 'בטיפול אנושי';
  }
}

export function appointmentStatusLabel(status: AppointmentStatus): string {
  return {
    TENTATIVE: 'ממתין לאישור',
    CONFIRMED: 'התור מאושר',
    CANCELLED: 'התור בוטל',
    COMPLETED: 'הטיפול הושלם',
    NO_SHOW: 'לא הגיע/ה',
  }[status];
}

export function quoteStatusLabel(status: QuoteStatus): string {
  return {
    DRAFT: 'טיוטה',
    SENT: 'נשלחה',
    VIEWED: 'נצפתה',
    CHANGE_REQUESTED: 'נדרש שינוי',
    ACCEPTED: 'אושרה',
    REJECTED: 'נדחתה',
    EXPIRED: 'פגה',
  }[status];
}

export function jobStatusLabel(status: JobStatus): string {
  return {
    PENDING_DEPOSIT: 'מחכה למקדמה',
    READY_TO_SCHEDULE: 'מוכן לתיאום',
    SCHEDULED: 'מתוכנן',
    IN_PROGRESS: 'בעבודה',
    COMPLETED: 'העבודה הושלמה',
    CANCELLED: 'בוטלה',
  }[status];
}

export function factLabel(key: CustomerFactKey): string {
  return {
    REQUESTED_SERVICE: 'שירות מבוקש',
    CUSTOMER_TYPE: 'לקוח/ה חדש/ה או חוזר/ת',
    PREFERRED_DATE: 'תאריך מועדף',
    PREFERRED_TIME: 'שעה מועדפת',
    TREATMENT_PREFERENCE: 'העדפת טיפול',
    VEHICLE_MAKE: 'יצרן רכב',
    VEHICLE_MODEL: 'דגם רכב',
    VEHICLE_YEAR: 'שנת רכב',
    VEHICLE_CONDITION: 'מצב הרכב',
    PHOTOS_RECEIVED: 'תמונות',
    REQUESTED_JOB: 'עבודה מבוקשת',
    LOCATION: 'אזור',
    ADDRESS: 'כתובת',
    JOB_DETAILS: 'פרטי העבודה',
    URGENCY: 'דחיפות',
    ACCESS_CONSIDERATIONS: 'פרטי גישה',
    SPECIAL_REQUIREMENTS: 'בקשות מיוחדות',
  }[key];
}

export function factValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'התקבלו' : 'טרם התקבלו';
  return String(value);
}

export function activityLabel(type: ActivityType): string {
  const labels: Partial<Record<ActivityType, string>> = {
    [ActivityType.LeadCreated]: 'הפנייה נפתחה',
    [ActivityType.MessageReceived]: 'התקבלה הודעה מהלקוח/ה',
    [ActivityType.MessageSent]: 'נשלחה הודעה',
    [ActivityType.HandoffStarted]: 'השיחה הועברה לטיפול אנושי',
    [ActivityType.AssistantResumed]: 'העוזר חזר לפעול',
    [ActivityType.ConsentChanged]: 'העדפות התקשורת עודכנו',
    [ActivityType.AppointmentCreated]: 'נוצר תור',
    [ActivityType.AppointmentRescheduled]: 'התור הוזז',
    [ActivityType.AppointmentConfirmed]: 'התור אושר',
    [ActivityType.AppointmentCompleted]: 'הטיפול הושלם',
    [ActivityType.AppointmentCancelled]: 'התור בוטל',
    [ActivityType.QuoteCreated]: 'נוצרה הצעת מחיר',
    [ActivityType.QuoteSent]: 'הצעת המחיר נשלחה',
    [ActivityType.QuoteAccepted]: 'הצעת המחיר אושרה',
    [ActivityType.QuoteDeclined]: 'הצעת המחיר נדחתה',
    [ActivityType.QuoteExpired]: 'הצעת המחיר פגה',
    [ActivityType.JobCreated]: 'נפתחה עבודה',
    [ActivityType.JobScheduled]: 'העבודה נקבעה',
    [ActivityType.JobRescheduled]: 'מועד העבודה שונה',
    [ActivityType.JobCompleted]: 'העבודה הושלמה',
    [ActivityType.JobCancelled]: 'העבודה בוטלה',
    [ActivityType.DepositCollected]: 'המקדמה התקבלה',
    [ActivityType.BalanceCollected]: 'יתרת התשלום התקבלה',
    [ActivityType.RefundRecorded]: 'נרשם החזר',
    [ActivityType.OpportunityWon]: 'התהליך הושלם ושולם',
    [ActivityType.OpportunityLost]: 'הוחלט לא להמשיך',
    [ActivityType.OpportunityReopened]: 'התהליך נפתח מחדש',
    [ActivityType.RevenueAttributionVerified]: 'שיוך ההכנסה אומת',
    [ActivityType.ReactivationPrepared]: 'הוכן חיבור מחדש עם הלקוח/ה',
    [ActivityType.OwnerToolExecuted]: 'בוצעה פעולת בעלים מאושרת',
    [ActivityType.MemoryChanged]: 'פרטי הלקוח/ה עודכנו',
  };
  return labels[type] ?? 'הסטטוס עודכן';
}

export function lostReasonLabel(reason: OpportunityLostReason | null): string {
  if (reason === null) return 'לא ממשיכים כרגע';
  return {
    CUSTOMER_DECLINED: 'הלקוח/ה בחר/ה לא להמשיך',
    CANCELLED: 'בוטל',
    OUTSIDE_SERVICE_AREA: 'מחוץ לאזור השירות',
    NO_LONGER_INTERESTED: 'לא מעוניינ/ת כרגע',
    QUOTE_EXPIRED: 'הצעת המחיר פגה',
    UNAVAILABLE: 'לא נמצא מועד מתאים',
  }[reason];
}

export function handoffReasonLabel(reason: HandoffReason): string {
  switch (reason) {
    case HandoffReason.SensitiveQuestion:
      return 'נדרש שיקול דעת רגיש או רפואי';
    case HandoffReason.LegalQuestion:
      return 'נדרשת תשובה בנושא משפטי';
    case HandoffReason.Complaint:
      return 'הלקוח העלה תלונה שדורשת טיפול';
    case HandoffReason.Refund:
      return 'בקשת החזר דורשת החלטת בעלים';
    case HandoffReason.UnusualDiscount:
      return 'בקשת הנחה חריגה דורשת אישור';
    case HandoffReason.AggressiveOrConfused:
      return 'השיחה דורשת התערבות אנושית';
    case HandoffReason.LowConfidence:
      return 'אין מספיק ודאות כדי להמשיך אוטומטית';
    case HandoffReason.UnsupportedKnowledge:
      return 'הבקשה חורגת מהמידע המאומת של העסק';
    case HandoffReason.HumanRequested:
      return 'הלקוח ביקש לדבר עם אדם';
    case HandoffReason.ConflictingInformation:
      return 'נמצאו פרטים סותרים שדורשים בדיקה';
    case HandoffReason.SafetyConcern:
      return 'נדרשת בדיקת בטיחות לפני שממשיכים';
    case HandoffReason.Manual:
      return 'השיחה הועברה לבעלים באופן ידני';
  }
}

export function formatProductMoney(amountCents: number, currency: string): string {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency,
    maximumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
  }).format(amountCents / 100);
}

export function formatProductDateTime(value: string, timeZone = 'Asia/Jerusalem'): string {
  return new Intl.DateTimeFormat('he-IL', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(value));
}

export function formatProductTime(value: string, timeZone = 'Asia/Jerusalem'): string {
  return new Intl.DateTimeFormat('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(value));
}

export function formatProductLongDate(value: string, timeZone = 'Asia/Jerusalem'): string {
  return new Intl.DateTimeFormat('he-IL', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  }).format(new Date(value));
}

export function formatActionAge(value: string, now: string): string {
  const milliseconds = new Date(now).getTime() - new Date(value).getTime();
  const hours = Math.max(0, Math.floor(milliseconds / 3_600_000));
  if (hours < 1) return 'עכשיו';
  if (hours < 24) return `לפני ${hours} שעות`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'אתמול' : `לפני ${days} ימים`;
}
