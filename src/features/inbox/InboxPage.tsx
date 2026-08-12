import { Link } from 'react-router-dom';
import { Card, Empty, Page, readable } from '../../components/ui';
import { useCloser } from '../../state/closerState';

export function InboxPage() {
  const { state, businessId } = useCloser();
  const conversations = state.conversations
    .filter((conversation) => conversation.businessId === businessId)
    .sort((first, second) => (second.lastCustomerMessageAt ?? '').localeCompare(first.lastCustomerMessageAt ?? ''));
  return (
    <Page title="Inbox" intro="WhatsApp-first conversations, their current mode, and the one action that matters next.">
      <Card>
        {conversations.length === 0 ? <Empty>No conversations.</Empty> : (
          <div className="conversation-list">
            {conversations.map((conversation) => {
              const contact = state.contacts.find((candidate) => candidate.id === conversation.contactId);
              const action = state.nextActions.find((candidate) => candidate.id === conversation.nextActionId);
              const lastMessage = [...state.messages]
                .filter((message) => message.conversationId === conversation.id)
                .sort((first, second) => second.sentAt.localeCompare(first.sentAt))[0];
              return (
                <Link key={conversation.id} to={`/customer/${conversation.contactId}`} className="conversation-row">
                  <div><strong>{contact?.displayName ?? 'Unknown customer'}</strong><small>{readable(conversation.channel)}</small></div>
                  <p>{lastMessage?.body ?? 'New inquiry — no messages yet'}</p>
                  <div><span className="status">{readable(conversation.mode)}</span><small>{action ? readable(action.type) : 'No action'}</small></div>
                </Link>
              );
            })}
          </div>
        )}
      </Card>
    </Page>
  );
}
