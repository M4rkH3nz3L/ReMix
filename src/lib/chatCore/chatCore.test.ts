import { groupTitle, MESSAGE_COLUMNS, toMessage, type Conversation, type MessageRow } from '@/lib/chatCore/model';
import * as chat from '@/lib/chat';

/** 💬 A chat expo-mentes magja (REFACTOR: a src/lib/chat.ts-ből kiemelve) — a mai viselkedés rögzítve. */

const row = (over: Partial<MessageRow> = {}): MessageRow => ({
  id: 'm1',
  conversation_id: 'c1',
  sender_id: 'u2',
  body: 'szia',
  kind: 'text',
  sender_username: 'bea',
  sender_name: 'Bea',
  sender_avatar: null,
  created_at: '2026-11-01T00:00:00Z',
  ...over,
});

const conv = (over: Partial<Conversation> = {}): Conversation => ({
  id: 'c1',
  kind: 'group',
  lastMessageAt: '2026-11-01T00:00:00Z',
  lastMessagePreview: null,
  lastSenderId: null,
  hasUnread: false,
  ...over,
});

describe('MESSAGE_COLUMNS — a lekért üzenet-oszlopok (RLS-érzékeny select) pontosan', () => {
  it('a lista és a sorrend változatlan', () => {
    expect(MESSAGE_COLUMNS).toBe(
      'id, conversation_id, sender_id, body, kind, sender_username, sender_name, sender_avatar, created_at'
    );
  });
});

describe('toMessage — üzenet-sor → ChatMessage', () => {
  it('a mezők leképezése; a sender_username NEM kerül át', () => {
    expect(toMessage(row({ kind: 'system' }))).toEqual({
      id: 'm1',
      conversationId: 'c1',
      senderId: 'u2',
      body: 'szia',
      kind: 'system',
      senderName: 'Bea',
      senderAvatar: null,
      createdAt: '2026-11-01T00:00:00Z',
    });
  });

  it('nem-loopback avatar változatlan, üres → null', () => {
    expect(toMessage(row({ sender_avatar: 'https://cdn.example/a.png' })).senderAvatar).toBe('https://cdn.example/a.png');
    expect(toMessage(row({ sender_avatar: '' })).senderAvatar).toBeNull();
  });
});

describe('groupTitle — a csoport megjelenített neve', () => {
  it('a beállított cím nyer', () => {
    expect(groupTitle(conv({ title: 'Csapat', members: [{ id: 'a', name: 'A', avatar: null }] }), 'X')).toBe('Csapat');
  });

  it('cím nélkül a nem-üres tagnevek vesszővel', () => {
    const members = [
      { id: 'a', name: 'A', avatar: null },
      { id: 'b', name: null, avatar: null },
      { id: 'c', name: '', avatar: null },
      { id: 'd', name: 'D', avatar: null },
    ];
    expect(groupTitle(conv({ title: '', members }), 'X')).toBe('A, D');
  });

  it('se cím, se név → a fallback', () => {
    expect(groupTitle(conv(), 'Csoport')).toBe('Csoport');
    expect(groupTitle(conv({ members: [{ id: 'b', name: null, avatar: null }] }), 'Csoport')).toBe('Csoport');
  });
});

describe('chat barrel — a publikus felület', () => {
  it('a futásidejű exportok listája változatlan', () => {
    expect(Object.keys(chat).sort()).toEqual(
      [
        'addGroupMember',
        'createGroup',
        'currentUserId',
        'getConversation',
        'groupTitle',
        'leaveConversation',
        'listConversations',
        'listFollowingPeers',
        'listMessages',
        'logProjectActivity',
        'markRead',
        'openDm',
        'openProjectConversation',
        'openTypingChannel',
        'renameGroup',
        'sendMessage',
        'sendSystemMessage',
        'subscribeInbox',
        'subscribeMessages',
      ].sort()
    );
  });
});
