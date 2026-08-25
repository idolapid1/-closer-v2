import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Bot,
  ChevronLeft,
  MessageCircleMore,
  Phone,
  Search,
  Send,
  Sparkles,
  UserRoundCog,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { ProductInboxConversationView } from '../../application/presentation/ProductReadService';
import {
  conversationStageLabel,
  formatProductTime,
  handoffReasonLabel,
  nextActionCta,
  nextActionDescription,
  nextActionTitle,
} from '../../application/presentation/productCopy';
import { CustomerAvatar, EmptyState, ErrorBanner, SuccessBanner } from '../../components/product/ProductUi';
import { HandoffReason, MessageAuthor, MessagePurpose } from '../../domain/entities';
import { useCloser } from '../../state/closerState';

export function InboxPage() {
  const { state, businessId, service } = useCloser();
  const [searchParams, setSearchParams] = useSearchParams();
  const inbox = service.productInbox(businessId);
  const requestedId = searchParams.get('conversation');
  const selected = inbox.conversations.find((conversation) => conversation.id === requestedId)
    ?? inbox.conversations[0]
    ?? null;
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const threadHeading = useRef<HTMLHeadingElement>(null);
  const returnConversationId = useRef<string | null>(null);
  const business = state.businesses.find((candidate) => candidate.id === businessId);
  const filtered = useMemo(
    () => inbox.conversations.filter((conversation) =>
      [conversation.customerName, conversation.lastMessage?.body ?? '', conversation.serviceName ?? '']
        .join(' ')
        .toLocaleLowerCase('he')
        .includes(query.trim().toLocaleLowerCase('he')),
    ),
    [inbox.conversations, query],
  );

  useEffect(() => {
    if (requestedId) threadHeading.current?.focus();
  }, [requestedId]);

  useEffect(() => {
    if (!requestedId && returnConversationId.current) {
      document
        .querySelector<HTMLButtonElement>(`[data-conversation-id="${returnConversationId.current}"]`)
        ?.focus();
      returnConversationId.current = null;
    }
  }, [requestedId]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !message.trim()) return;
    setError('');
    setSuccess('');
    setIsSending(true);
    try {
      await service.sendMessage(businessId, selected.id, message, {
        author: MessageAuthor.Business,
        purpose: MessagePurpose.Operational,
      });
      setMessage('');
      setSuccess('ההודעה נשלחה.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'לא הצלחנו לשלוח את ההודעה.');
    } finally {
      setIsSending(false);
    }
  };

  const run = (action: () => void, confirmation: string) => {
    setError('');
    try {
      action();
      setSuccess(confirmation);
      window.requestAnimationFrame(() => threadHeading.current?.focus());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'הפעולה לא הושלמה.');
    }
  };

  return (
    <section className={`inbox-page${requestedId ? ' has-selection' : ''}`}>
      <aside className="inbox-list-pane" aria-label="רשימת פניות">
        <header className="inbox-list-header">
          <div>
            <p className="product-page-eyebrow">הקשר מסחרי</p>
            <h1>שיחות פעילות</h1>
            <span>{inbox.conversations.length} לקוחות בתהליך</span>
          </div>
          <MessageCircleMore aria-hidden="true" />
        </header>
        <label className="inbox-search">
          <Search aria-hidden="true" />
          <span className="sr-only">חיפוש בפניות</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="חיפוש לפי שם או תוכן"
          />
        </label>
        {filtered.length === 0 ? (
          <EmptyState title="לא נמצאו פניות">נסו חיפוש אחר.</EmptyState>
        ) : (
          <ul className="inbox-conversation-list" aria-label="שיחות">
            {filtered.map((conversation) => (
              <li key={conversation.id}>
                <ConversationListItem
                  conversation={conversation}
                  selected={conversation.id === selected?.id}
                  onSelect={() => setSearchParams({ conversation: conversation.id })}
                  timeZone={business?.timeZone}
                />
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="inbox-thread-pane" aria-label="שיחה פעילה">
        {selected ? (
          <>
            <header className="inbox-thread-header">
              <button
                className="icon-button inbox-mobile-back"
                type="button"
                aria-label="חזרה לפניות"
                onClick={() => {
                  returnConversationId.current = selected.id;
                  setSearchParams({});
                }}
              >
                <ArrowRight aria-hidden="true" />
              </button>
              <CustomerAvatar name={selected.customerName} size="large" />
              <div className="inbox-thread-title">
                <h2 ref={threadHeading} tabIndex={-1}>{selected.customerName}</h2>
                <span>{selected.serviceName ?? 'פנייה חדשה'} · {conversationStageLabel(selected.stage)}</span>
              </div>
              <div className="inbox-thread-tools">
                <a className="icon-button" href={`tel:${selected.phone}`} aria-label={`התקשר אל ${selected.customerName}`}>
                  <Phone aria-hidden="true" />
                </a>
                <Link
                  aria-label={`פתח לקוח: ${selected.customerName}`}
                  className="button button-secondary inbox-customer-link"
                  to={`/customer/${selected.contactId}`}
                >
                  פתח לקוח
                  <ChevronLeft aria-hidden="true" />
                </Link>
              </div>
            </header>

            {selected.automationStopped ? (
              <div className="handoff-banner" role="status">
                <UserRoundCog aria-hidden="true" />
                <div>
                  <strong>{selected.isHumanActive ? 'השיחה בטיפול אנושי' : 'העוזר מושהה'}</strong>
                  <span>
                    {selected.handoff
                      ? handoffReasonLabel(selected.handoff.reason)
                      : 'העוזר לא שולח הודעות עד שתחזירו אותו במפורש.'}
                  </span>
                  {selected.handoff?.detail ? <small>{selected.handoff.detail}</small> : null}
                </div>
                <button
                  type="button"
                  className="button button-secondary handoff-resume-button"
                  onClick={() => run(() => service.resumeAssistant(businessId, selected.id), 'העוזר חזר לפעול בשיחה.')}
                >
                  החזר את העוזר
                </button>
              </div>
            ) : null}

            {selected.action ? (
              <aside className="recommendation-strip" aria-labelledby="recommendation-heading">
                <Sparkles aria-hidden="true" />
                <div>
                  <span id="recommendation-heading">מה כדאי לעשות עכשיו</span>
                  <strong>
                    {nextActionTitle(
                      selected.action.actionType,
                      selected.customerName,
                      selected.action.amountCents,
                      business?.currency,
                    )}
                  </strong>
                  <p>{nextActionDescription(selected.action.actionType)}</p>
                </div>
                <span className="recommendation-cta">{nextActionCta(selected.action.actionType)}</span>
              </aside>
            ) : (
              <aside className="recommendation-strip is-complete">
                <Sparkles aria-hidden="true" />
                <div><span>מצב השיחה</span><strong>אין כרגע פעולה דחופה</strong></div>
              </aside>
            )}

            <ErrorBanner message={error} />
            <SuccessBanner message={success} />
            <ol className="conversation-thread" aria-label={`הודעות עם ${selected.customerName}`}>
              {selected.messages.length === 0 ? (
                <li><EmptyState title="עוד אין הודעות">אפשר לפתוח את השיחה בהודעה קצרה.</EmptyState></li>
              ) : selected.messages.map((item) => (
                <li key={item.id} className={`message-row message-row-${item.side.toLowerCase()}`}>
                  <article className="product-message" dir="auto">
                    <p>{item.body}</p>
                    <time dateTime={item.sentAt}><bdi dir="ltr">{formatProductTime(item.sentAt, business?.timeZone)}</bdi></time>
                  </article>
                </li>
              ))}
            </ol>

            <form className="conversation-composer" onSubmit={send}>
              {selected.suggestedReply ? (
                <button
                  className="suggested-reply-chip"
                  type="button"
                  onClick={() => setMessage(selected.suggestedReply ?? '')}
                >
                  <Bot aria-hidden="true" />
                  {selected.automationStopped
                    ? 'פתח טיוטה פנימית לבדיקה'
                    : 'השתמש בתשובה המוצעת'}
                </button>
              ) : null}
              <div className="conversation-composer-row">
                <label>
                  <span className="sr-only">כתיבת הודעה</span>
                  <textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="כתבו הודעה..."
                    required
                    rows={1}
                  />
                </label>
                <button
                  aria-label={isSending ? 'שולח הודעה' : 'שליחה'}
                  aria-busy={isSending}
                  className="button button-primary composer-send"
                  disabled={isSending || !message.trim()}
                  type="submit"
                >
                  <Send aria-hidden="true" />
                  <span>{isSending ? 'שולח…' : 'שליחה'}</span>
                </button>
                {!selected.automationStopped && !selected.isClosed ? (
                  <button
                    className="button button-quiet inbox-takeover-button"
                    type="button"
                    onClick={() => run(
                      () => service.startHumanTakeover(
                        businessId,
                        selected.id,
                        HandoffReason.Manual,
                        'השיחה הועברה לטיפול של בעל/ת העסק.',
                      ),
                      'השיחה הועברה לטיפול אנושי.',
                    )}
                  >
                    אני מטפל/ת
                  </button>
                ) : null}
              </div>
            </form>
          </>
        ) : (
          <EmptyState title="אין פניות להצגה">ברגע שתגיע פנייה חדשה היא תופיע כאן.</EmptyState>
        )}
      </section>
    </section>
  );
}

function ConversationListItem({
  conversation,
  selected,
  onSelect,
  timeZone,
}: {
  conversation: ProductInboxConversationView;
  selected: boolean;
  onSelect: () => void;
  timeZone: string | undefined;
}) {
  return (
    <button
      data-conversation-id={conversation.id}
      type="button"
      aria-current={selected ? 'true' : undefined}
      className={`conversation-list-item${selected ? ' is-selected' : ''}${conversation.automationStopped ? ' needs-human' : ''}`}
      onClick={onSelect}
    >
      <CustomerAvatar name={conversation.customerName} />
      <div className="conversation-list-copy">
        <div>
          <strong>{conversation.customerName}</strong>
          <time dateTime={conversation.updatedAt}><bdi dir="ltr">{formatProductTime(conversation.updatedAt, timeZone)}</bdi></time>
        </div>
        <p dir="auto">{conversation.lastMessage?.body ?? 'פנייה חדשה — עוד אין הודעות'}</p>
        <span>{conversation.isHumanActive ? 'דורש טיפול שלך' : conversation.automationStopped ? 'העוזר מושהה' : conversationStageLabel(conversation.stage)}</span>
      </div>
    </button>
  );
}
