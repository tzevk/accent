'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSessionRBAC } from '@/utils/client-rbac';
import { fetchJSON } from '@/utils/http';
import Navbar from '@/components/Navbar';

export default function MessagesPage() {
  const { user, loading: authLoading } = useSessionRBAC();
  
  // State
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [activeFolder, setActiveFolder] = useState('inbox');
  const [searchQuery, setSearchQuery] = useState('');
  const [inboxTab, setInboxTab] = useState('focused');
  const [expandedFolders, setExpandedFolders] = useState({ favorites: true, folders: true });
  
  // Compose state
  const [showCompose, setShowCompose] = useState(false);
  const [composeTo, setComposeTo] = useState([]);
  const [composeCc, setComposeCc] = useState([]);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [sending, setSending] = useState(false);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [showCc, setShowCc] = useState(false);
  
  // Reply state
  const [replyText, setReplyText] = useState('');
  const [replyMode, setReplyMode] = useState(null);
  
  // File attachments
  const [composeAttachments, setComposeAttachments] = useState([]);
  const [replyAttachments, setReplyAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  
  // Emoji picker
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showComposeEmojiPicker, setShowComposeEmojiPicker] = useState(false);
  
  // Client-side archived conversations
  const [archivedConvIds, setArchivedConvIds] = useState(new Set());
  
  const messagesEndRef = useRef(null);
  const composeFileRef = useRef(null);
  const replyFileRef = useRef(null);

  // Fetch conversations
  const fetchConversations = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const type = activeFolder === 'sent' ? 'sent' : 'inbox';
      const res = await fetchJSON(`/api/messages?type=${type}&limit=100`);
      if (res.data?.messages) {
        const convMap = new Map();
        res.data.messages.forEach(msg => {
          const convId = msg.conversation_id || `direct-${msg.sender_id}-${msg.receiver_id}`;
          if (!convMap.has(convId)) {
            convMap.set(convId, {
              id: convId,
              messages: [],
              participants: new Set(),
              lastMessage: msg,
              unreadCount: 0
            });
          }
          const conv = convMap.get(convId);
          conv.messages.push(msg);
          conv.participants.add(msg.sender_id);
          if (msg.receiver_id) conv.participants.add(msg.receiver_id);
          if (!msg.read_status && msg.receiver_id === user.id) {
            conv.unreadCount++;
          }
          if (new Date(msg.created_at) > new Date(conv.lastMessage.created_at)) {
            conv.lastMessage = msg;
          }
        });
        
        const convList = Array.from(convMap.values())
          .map(conv => ({
            ...conv,
            displayName: conv.lastMessage.sender_id === user.id 
              ? (conv.lastMessage.receiver_name || 'Unknown') 
              : (conv.lastMessage.sender_name || 'Unknown'),
            participantCount: conv.participants.size
          }))
          .sort((a, b) => new Date(b.lastMessage.created_at) - new Date(a.lastMessage.created_at));
        
        setConversations(convList);
      }
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
    } finally {
      setLoading(false);
    }
  }, [user?.id, activeFolder]);

  // Fetch users for compose — uses messages/users endpoint (no users:read permission required)
  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/messages/users?limit=500');
      const data = await res.json();
      if (data.data) {
        setUsers(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    }
  }, [user?.id]);

  // Fetch messages for selected conversation
  const fetchConversationMessages = useCallback(async (conv) => {
    if (!conv || !user?.id) return;
    setMessagesLoading(true);
    try {
      const otherParticipant = Array.from(conv.participants).find(id => id !== user.id);
      if (!otherParticipant) {
        setMessagesLoading(false);
        return;
      }
      const res = await fetchJSON(`/api/messages/thread/${otherParticipant}`);
      if (res.data?.messages) {
        setMessages(res.data.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)));
        res.data.messages.forEach(async (msg) => {
          if (!msg.read_status && msg.receiver_id === user.id) {
            try {
              await fetchJSON(`/api/messages/${msg.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ action: 'mark_read' })
              });
            } catch (e) {}
          }
        });
      }
    } catch (error) {
      console.error('Failed to fetch messages:', error);
    } finally {
      setMessagesLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) {
      fetchConversations();
      fetchUsers();
    }
  }, [user?.id, fetchConversations, fetchUsers]);

  // Re-fetch and clear selection when folder changes
  useEffect(() => {
    setSelectedConversation(null);
    setMessages([]);
    if (user?.id) {
      fetchConversations();
    }
  }, [activeFolder, fetchConversations]);

  useEffect(() => {
    if (selectedConversation) {
      fetchConversationMessages(selectedConversation);
    }
  }, [selectedConversation, fetchConversationMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Send message
  const sendMessage = async () => {
    if (!composeBody.trim() || composeTo.length === 0) return;
    setSending(true);
    try {
      await fetchJSON('/api/messages', {
        method: 'POST',
        body: JSON.stringify({
          receiver_id: composeTo[0].id,
          subject: composeSubject || '(No Subject)',
          body: composeBody,
          attachments: composeAttachments
        })
      });
      setShowCompose(false);
      setComposeTo([]);
      setComposeCc([]);
      setComposeSubject('');
      setComposeBody('');
      setComposeAttachments([]);
      setRecipientSearch('');
      setShowCc(false);
      fetchConversations();
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setSending(false);
    }
  };

  // Send reply
  const sendReply = async () => {
    if (!replyText.trim() || !selectedConversation) return;
    setSending(true);
    try {
      const otherParticipant = Array.from(selectedConversation.participants).find(id => id !== user.id);
      await fetchJSON('/api/messages', {
        method: 'POST',
        body: JSON.stringify({
          receiver_id: otherParticipant,
          subject: `Re: ${selectedConversation.lastMessage?.subject || 'Conversation'}`,
          body: replyText,
          attachments: replyAttachments
        })
      });
      setReplyText('');
      setReplyMode(null);
      setReplyAttachments([]);
      setShowEmojiPicker(false);
      fetchConversationMessages(selectedConversation);
      fetchConversations();
    } catch (error) {
      console.error('Failed to send reply:', error);
    } finally {
      setSending(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    if (msgDate.getTime() === today.getTime()) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    } else if (now - date < 7 * 24 * 60 * 60 * 1000) {
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    } else {
      return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
    }
  };

  const formatFullDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      weekday: 'long', 
      month: 'long', 
      day: 'numeric',
      year: 'numeric'
    }) + ' ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const getAvatarColor = (name) => {
    const colors = ['#0078d4', '#107c10', '#5c2d91', '#d83b01', '#008272', '#004e8c', '#8764b8', '#ca5010'];
    if (!name) return colors[0];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  const filteredUsers = users.filter(u => 
    (u.name?.toLowerCase().includes(recipientSearch.toLowerCase()) ||
    u.full_name?.toLowerCase().includes(recipientSearch.toLowerCase()) ||
    u.email?.toLowerCase().includes(recipientSearch.toLowerCase())) &&
    !composeTo.find(r => r.id === u.id)
  );

  const filteredConversations = conversations.filter(conv => {
    // Archive folder shows only archived conversations
    if (activeFolder === 'archive') return archivedConvIds.has(conv.id);
    // Other folders: hide archived conversations
    if (archivedConvIds.has(conv.id)) return false;
    if (!searchQuery) return true;
    const search = searchQuery.toLowerCase();
    return conv.displayName?.toLowerCase().includes(search) ||
           conv.lastMessage?.subject?.toLowerCase().includes(search) ||
           conv.lastMessage?.body?.toLowerCase().includes(search);
  });

  // Delete conversation
  const deleteConversation = async () => {
    if (!selectedConversation || !messages.length) return;
    if (!confirm('Are you sure you want to delete this conversation?')) return;
    try {
      for (const msg of messages) {
        await fetchJSON(`/api/messages/${msg.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ action: 'delete' })
        });
      }
      setSelectedConversation(null);
      setMessages([]);
      fetchConversations();
    } catch (error) {
      console.error('Failed to delete conversation:', error);
    }
  };

  // Archive conversation (client-side)
  const archiveConversation = () => {
    if (!selectedConversation) return;
    setArchivedConvIds(prev => new Set([...prev, selectedConversation.id]));
    setSelectedConversation(null);
    setMessages([]);
  };

  // Handle forward - opens compose with forwarded content
  const handleForward = () => {
    if (!selectedConversation || messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    setShowCompose(true);
    setComposeSubject(`Fwd: ${lastMsg.subject || selectedConversation.lastMessage?.subject || ''}`);
    setComposeBody(
      `\n\n---------- Forwarded message ----------\nFrom: ${lastMsg.sender_name || 'Unknown'}\nDate: ${formatFullDate(lastMsg.created_at)}\nSubject: ${lastMsg.subject || ''}\n\n${lastMsg.body?.replace(/<[^>]*>/g, '') || ''}`
    );
    setComposeTo([]);
    setComposeAttachments([]);
    setSelectedConversation(null);
  };

  // Discard compose - clear all fields
  const discardCompose = () => {
    setShowCompose(false);
    setComposeTo([]);
    setComposeCc([]);
    setComposeSubject('');
    setComposeBody('');
    setComposeAttachments([]);
    setRecipientSearch('');
    setShowCc(false);
    setShowComposeEmojiPicker(false);
  };

  // File upload handler
  const handleFileUpload = async (e, target = 'compose') => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/messages/attachments', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        if (target === 'reply') {
          setReplyAttachments(prev => [...prev, data.data]);
        } else {
          setComposeAttachments(prev => [...prev, data.data]);
        }
      } else {
        alert(data.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Failed to upload file');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  // Emoji constants
  const emojis = ['😊', '👍', '❤️', '😂', '🎉', '👏', '🙏', '💯', '✅', '🔥', '⭐', '💡', '😀', '🤝', '📎', '💼'];

  const unreadCount = conversations.reduce((acc, c) => acc + c.unreadCount, 0);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-white" role="status" aria-label="Loading messages">
        <Navbar />
        <div className="flex items-center justify-center h-[calc(100vh-64px)]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0078d4]" aria-hidden="true"></div>
          <span className="sr-only">Loading messages...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white" style={{ fontFamily: "'Segoe UI', 'Segoe UI Web (West European)', -apple-system, BlinkMacSystemFont, Roboto, 'Helvetica Neue', sans-serif" }}>
      <Navbar />
      
      {/* Screen reader announcement region for dynamic updates */}
      <div aria-live="polite" aria-atomic="true" className="sr-only" id="messages-announcer" role="status">
        {sending ? 'Sending message...' : ''}
      </div>
      
      <div className="flex-1 flex pt-16 overflow-hidden gap-0" role="main" aria-label="Messages">
        
        {/* Left Navigation Pane - Outlook Style */}
        <nav className="w-40 lg:w-48 xl:w-52 bg-[#f3f2f1] flex flex-col border-r border-[#edebe9] flex-shrink-0" aria-label="Mail folders">
          
          {/* New Mail Button */}
          <div className="p-2">
            <button
              onClick={() => setShowCompose(true)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-[#0078d4] text-white rounded-sm hover:bg-[#106ebe] transition-colors text-[13px] font-semibold"
              aria-label="Compose new message"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M14.5 2h-13C.67 2 0 2.67 0 3.5v9c0 .83.67 1.5 1.5 1.5h13c.83 0 1.5-.67 1.5-1.5v-9c0-.83-.67-1.5-1.5-1.5zM1.5 3h13c.28 0 .5.22.5.5v.5L8 8 1 4V3.5c0-.28.22-.5.5-.5zM1 12.5v-7L8 9l7-3.5v7c0 .28-.22.5-.5.5h-13c-.28 0-.5-.22-.5-.5z"/>
              </svg>
              New mail
            </button>
          </div>
          
          {/* Favorites Section */}
          <div className="mt-1">
            <button 
              onClick={() => setExpandedFolders({...expandedFolders, favorites: !expandedFolders.favorites})}
              className="w-full flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-[#605e5c] hover:bg-[#e1dfdd]"
              aria-expanded={expandedFolders.favorites}
              aria-controls="favorites-list"
            >
              <svg className={`w-3 h-3 transition-transform ${expandedFolders.favorites ? 'rotate-90' : ''}`} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M5.7 13.7L5 13l4.6-5L5 3l.7-.7L11 8z"/>
              </svg>
              Favorites
            </button>
            {expandedFolders.favorites && (
              <div className="ml-2" id="favorites-list" role="list" aria-label="Favorite folders">
                {[
                  { id: 'inbox', label: 'Inbox', count: unreadCount },
                  { id: 'sent', label: 'Sent Items', count: 0 },
                ].map(folder => (
                  <button
                    key={folder.id}
                    onClick={() => setActiveFolder(folder.id)}
                    role="listitem"
                    aria-current={activeFolder === folder.id ? 'true' : undefined}
                    aria-label={`${folder.label}${folder.count > 0 ? `, ${folder.count} unread` : ''}`}
                    className={`w-full flex items-center gap-2 px-2 py-[5px] text-[13px] rounded-sm ${
                      activeFolder === folder.id 
                        ? 'bg-[#e1dfdd]' 
                        : 'hover:bg-[#e9e8e7]'
                    }`}
                  >
                    <svg className="w-4 h-4 text-[#0078d4]" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      {folder.id === 'inbox' ? (
                        <path d="M14.5 2h-13C.67 2 0 2.67 0 3.5v9c0 .83.67 1.5 1.5 1.5h13c.83 0 1.5-.67 1.5-1.5v-9c0-.83-.67-1.5-1.5-1.5zM1 3.5c0-.28.22-.5.5-.5h13c.28 0 .5.22.5.5v.22L8 7.65 1 3.72V3.5zM14.5 13h-13c-.28 0-.5-.22-.5-.5V5.04l7 3.93 7-3.93v7.46c0 .28-.22.5-.5.5z"/>
                      ) : (
                        <path d="M14.5 2h-13C.67 2 0 2.67 0 3.5v9c0 .83.67 1.5 1.5 1.5h13c.83 0 1.5-.67 1.5-1.5v-9c0-.83-.67-1.5-1.5-1.5zm-13 1h13c.28 0 .5.22.5.5v.22L8 7.65 1 3.72V3.5c0-.28.22-.5.5-.5zm13 10h-13c-.28 0-.5-.22-.5-.5V5.04l7 3.93 7-3.93v7.46c0 .28-.22.5-.5.5z"/>
                      )}
                    </svg>
                    <span className="flex-1 text-left text-[#323130]">{folder.label}</span>
                    {folder.count > 0 && (
                      <span className="text-[11px] font-semibold text-[#0078d4]" aria-hidden="true">{folder.count}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          
          {/* Folders Section */}
          <div className="mt-1">
            <button 
              onClick={() => setExpandedFolders({...expandedFolders, folders: !expandedFolders.folders})}
              className="w-full flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-[#605e5c] hover:bg-[#e1dfdd]"
              aria-expanded={expandedFolders.folders}
              aria-controls="folders-list"
            >
              <svg className={`w-3 h-3 transition-transform ${expandedFolders.folders ? 'rotate-90' : ''}`} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M5.7 13.7L5 13l4.6-5L5 3l.7-.7L11 8z"/>
              </svg>
              Folders
            </button>
            {expandedFolders.folders && (
              <div className="ml-2" id="folders-list" role="list" aria-label="All folders">
                {[
                  { id: 'inbox', label: 'Inbox', count: unreadCount, icon: 'inbox' },
                  { id: 'drafts', label: 'Drafts', count: 0, icon: 'draft' },
                  { id: 'sent', label: 'Sent Items', count: 0, icon: 'sent' },
                  { id: 'deleted', label: 'Deleted Items', count: 0, icon: 'trash' },
                  { id: 'archive', label: 'Archive', count: 0, icon: 'archive' },
                  { id: 'junk', label: 'Junk Email', count: 0, icon: 'junk' },
                ].map(folder => (
                  <button
                    key={folder.id + '-folder'}
                    onClick={() => setActiveFolder(folder.id)}
                    role="listitem"
                    aria-current={activeFolder === folder.id ? 'true' : undefined}
                    aria-label={`${folder.label}${folder.count > 0 ? `, ${folder.count} unread` : ''}`}
                    className={`w-full flex items-center gap-2 px-2 py-[5px] text-[13px] rounded-sm ${
                      activeFolder === folder.id 
                        ? 'bg-[#e1dfdd]' 
                        : 'hover:bg-[#e9e8e7]'
                    }`}
                  >
                    <svg className="w-4 h-4 text-[#ffb900]" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <path d="M14 4H7.5l-1-2H2c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1V5c0-.55-.45-1-1-1zm0 9H2V5h12v8z"/>
                    </svg>
                    <span className="flex-1 text-left text-[#323130]">{folder.label}</span>
                    {folder.count > 0 && (
                      <span className="text-[11px] font-semibold text-[#0078d4]" aria-hidden="true">{folder.count}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>
        
        {/* Message List Pane */}
        <div className="w-72 lg:w-80 xl:w-[360px] 2xl:w-[400px] bg-white border-r border-[#edebe9] flex flex-col flex-shrink-0" role="region" aria-label="Message list">
          
          {/* Search Bar */}
          <div className="p-2 border-b border-[#edebe9]">
            <div className="relative">
              <svg className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-[#605e5c]" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M11.5 7c0 .79-.2 1.53-.56 2.18l3.53 3.53-.71.71-3.53-3.53A4.5 4.5 0 117 2.5 4.5 4.5 0 0111.5 7zm-1 0a3.5 3.5 0 10-7 0 3.5 3.5 0 007 0z"/>
              </svg>
              <label htmlFor="message-search" className="sr-only">Search messages</label>
              <input
                id="message-search"
                type="search"
                placeholder="Search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-[6px] text-[13px] border border-[#8a8886] rounded-sm focus:outline-none focus:border-[#0078d4] bg-white placeholder-[#605e5c]"
                aria-label="Search messages"
              />
            </div>
          </div>
          
          {/* Inbox Tabs: Focused / Other */}
          <div className="flex border-b border-[#edebe9]" role="tablist" aria-label="Inbox filters">
            <button 
              onClick={() => setInboxTab('focused')}
              role="tab"
              aria-selected={inboxTab === 'focused'}
              id="tab-focused"
              aria-controls="tabpanel-messages"
              className={`flex-1 py-2.5 text-[13px] font-semibold border-b-2 transition-colors ${
                inboxTab === 'focused' 
                  ? 'text-[#0078d4] border-[#0078d4]' 
                  : 'text-[#605e5c] border-transparent hover:text-[#323130]'
              }`}
            >
              Focused
            </button>
            <button 
              onClick={() => setInboxTab('other')}
              role="tab"
              aria-selected={inboxTab === 'other'}
              id="tab-other"
              aria-controls="tabpanel-messages"
              className={`flex-1 py-2.5 text-[13px] font-semibold border-b-2 transition-colors ${
                inboxTab === 'other' 
                  ? 'text-[#0078d4] border-[#0078d4]' 
                  : 'text-[#605e5c] border-transparent hover:text-[#323130]'
              }`}
            >
              Other
            </button>
          </div>
          
          {/* Message List */}
          <div className="flex-1 overflow-y-auto" id="tabpanel-messages" role="tabpanel" aria-labelledby={`tab-${inboxTab}`}>
            {loading ? (
              <div className="flex items-center justify-center h-32" role="status">
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-[#0078d4] border-t-transparent" aria-hidden="true"></div>
                <span className="sr-only">Loading conversations...</span>
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="text-center py-12 px-4" role="status">
                <svg className="w-12 h-12 mx-auto text-[#c8c6c4] mb-3" viewBox="0 0 48 48" fill="currentColor" aria-hidden="true">
                  <path d="M42 8H6a4 4 0 0 0-4 4v24a4 4 0 0 0 4 4h36a4 4 0 0 0 4-4V12a4 4 0 0 0-4-4zm0 2c.4 0 .77.12 1.08.32L24 23.3 4.92 10.32c.31-.2.68-.32 1.08-.32h36zM6 38a2 2 0 0 1-2-2V12.63l19.56 13.35a1 1 0 0 0 .88 0L44 12.63V36a2 2 0 0 1-2 2H6z"/>
                </svg>
                <p className="text-[13px] text-[#605e5c]">
                  {activeFolder === 'sent' ? 'No sent messages' : activeFolder === 'archive' ? 'No archived messages' : activeFolder === 'drafts' ? 'No drafts' : activeFolder === 'deleted' ? 'No deleted items' : 'Nothing in Focused right now'}
                </p>
                <p className="text-[12px] text-[#a19f9d] mt-1">
                  {activeFolder === 'sent' ? 'Messages you send will appear here' : activeFolder === 'archive' ? 'Archived conversations will appear here' : 'Check back later for new mail'}
                </p>
              </div>
            ) : (
              filteredConversations.map(conv => (
                <div
                  key={conv.id}
                  onClick={() => {
                    setSelectedConversation(conv);
                    setShowCompose(false);
                    setReplyMode(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedConversation(conv);
                      setShowCompose(false);
                      setReplyMode(null);
                    }
                  }}
                  role="option"
                  tabIndex={0}
                  aria-selected={selectedConversation?.id === conv.id}
                  aria-label={`${conv.unreadCount > 0 ? 'Unread: ' : ''}${conv.displayName || 'Unknown'}, ${conv.lastMessage?.subject || 'No Subject'}, ${formatDate(conv.lastMessage?.created_at)}`}
                  className={`relative cursor-pointer border-b border-[#edebe9] ${
                    selectedConversation?.id === conv.id 
                      ? 'bg-[#e6f2fb]' 
                      : 'hover:bg-[#f3f2f1]'
                  } focus:outline-none focus:ring-2 focus:ring-[#0078d4] focus:ring-inset`}
                >
                  {/* Unread Indicator Bar */}
                  {conv.unreadCount > 0 && (
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#0078d4]" aria-hidden="true" />
                  )}
                  
                  <div className="flex gap-3 px-4 py-3">
                    {/* Avatar */}
                    <div 
                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[12px] font-semibold flex-shrink-0"
                      style={{ backgroundColor: getAvatarColor(conv.displayName) }}
                    >
                      {getInitials(conv.displayName)}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      {/* Sender & Time */}
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[13px] truncate ${
                          conv.unreadCount > 0 ? 'font-semibold text-[#323130]' : 'text-[#323130]'
                        }`}>
                          {conv.displayName || 'Unknown'}
                        </span>
                        <span className="text-[12px] text-[#605e5c] flex-shrink-0">
                          {formatDate(conv.lastMessage?.created_at)}
                        </span>
                      </div>
                      
                      {/* Subject */}
                      <p className={`text-[13px] truncate ${
                        conv.unreadCount > 0 ? 'font-semibold text-[#323130]' : 'text-[#605e5c]'
                      }`}>
                        {conv.lastMessage?.subject || '(No Subject)'}
                      </p>
                      
                      {/* Preview */}
                      <p className="text-[12px] text-[#a19f9d] truncate">
                        {conv.lastMessage?.body?.replace(/<[^>]*>/g, '').substring(0, 80)}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        
        {/* Reading Pane */}
        <div className="flex-1 bg-white flex flex-col min-w-0">
          {showCompose ? (
            /* Compose New Message */
            <div className="flex-1 flex flex-col">
              
              {/* Compose Toolbar */}
              <div className="flex items-center gap-1 px-3 py-2 border-b border-[#edebe9] bg-[#faf9f8]">
                <button
                  onClick={sendMessage}
                  disabled={sending || composeTo.length === 0 || !composeBody.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0078d4] text-white rounded-sm hover:bg-[#106ebe] disabled:opacity-50 disabled:cursor-not-allowed text-[13px] font-semibold"
                  aria-label="Send message"
                >
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M1 1.91L5.63 8 1 14.09V1.91M0 0v16l7-8-7-8zM14.05 7.36L3.19 1.09l8.62 5.98L14.05 7 14.05 7.36zM3.19 14.91l10.86-6.27-.01.36-2.23.07L3.19 14.91zM16 8l-1.64 1.52L16 8z"/>
                  </svg>
                  Send
                </button>
                <button 
                  onClick={discardCompose}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[#323130] hover:bg-[#e1dfdd] rounded-sm text-[13px]"
                  aria-label="Discard draft"
                >
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M12 5v8H4V5h8m1-1H3v10h10V4z"/>
                    <path d="M10 2v2H6V2h4m1-1H5v4h6V1z"/>
                  </svg>
                  Discard
                </button>
              </div>
              
              {/* Compose Form */}
              <div className="flex-1 flex flex-col overflow-hidden">
                
                {/* To Field - Vertical Layout with Dropdown */}
                <div className="px-6 py-3 border-b border-[#edebe9]">
                  <label htmlFor="compose-to" className="block text-[13px] font-semibold text-[#323130] mb-2">To</label>
                  <div className="relative">
                    <div className="flex flex-wrap items-center gap-2 min-h-[40px] p-2 border border-[#c8c6c4] rounded bg-white focus-within:border-[#0078d4] focus-within:ring-1 focus-within:ring-[#0078d4]" role="group" aria-label="Selected recipients">
                      {composeTo.map(r => (
                        <span key={r.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#deecf9] text-[#0078d4] rounded text-[13px]" role="listitem">
                          {r.name || r.full_name || r.username}
                          <button 
                            onClick={() => setComposeTo(composeTo.filter(x => x.id !== r.id))} 
                            className="hover:text-[#106ebe]" 
                            aria-label={`Remove ${r.name || r.full_name || r.username}`}
                          >
                            <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                              <path d="M8.7 8l3.65-3.65-.7-.7L8 7.29 4.35 3.65l-.7.7L7.29 8l-3.64 3.65.7.7L8 8.71l3.65 3.64.7-.7L8.71 8z"/>
                            </svg>
                          </button>
                        </span>
                      ))}
                      <input
                        id="compose-to"
                        type="text"
                        value={recipientSearch}
                        onChange={(e) => setRecipientSearch(e.target.value)}
                        onFocus={() => setRecipientSearch(recipientSearch || ' ')}
                        placeholder={composeTo.length === 0 ? "Select recipient..." : ""}
                        className="flex-1 min-w-[150px] text-[13px] focus:outline-none py-1 bg-transparent placeholder-[#a19f9d]"
                        aria-label="Search for recipients"
                        aria-expanded={!!(recipientSearch || recipientSearch === ' ') && filteredUsers.length > 0}
                        aria-haspopup="listbox"
                        aria-autocomplete="list"
                        aria-controls="recipient-listbox"
                        role="combobox"
                      />
                      <svg className="w-4 h-4 text-[#605e5c] flex-shrink-0" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                        <path d="M4 6l4 4 4-4H4z"/>
                      </svg>
                    </div>
                    {/* User Dropdown */}
                    {(recipientSearch || recipientSearch === ' ') && filteredUsers.length > 0 && (
                      <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-[#c8c6c4] shadow-lg rounded z-20 max-h-60 overflow-y-auto" role="listbox" id="recipient-listbox" aria-label="Available recipients">
                        {filteredUsers.slice(0, 8).map(u => (
                          <button
                            key={u.id}
                            onClick={() => {
                              setComposeTo([...composeTo, u]);
                              setRecipientSearch('');
                            }}
                            role="option"
                            aria-selected={false}
                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[#f3f2f1] text-left border-b border-[#edebe9] last:border-b-0 focus:outline-none focus:bg-[#e1dfdd]"
                          >
                            <div 
                              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[12px] font-semibold flex-shrink-0"
                              style={{ backgroundColor: getAvatarColor(u.name || u.full_name) }}
                            >
                              {getInitials(u.name || u.full_name || u.username)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[14px] font-medium text-[#323130] truncate">{u.name || u.full_name || u.username}</div>
                              <div className="text-[12px] text-[#605e5c] truncate">{u.email}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Cc Field - Vertical Layout */}
                {showCc && (
                  <div className="px-6 py-3 border-b border-[#edebe9]">
                    <label htmlFor="compose-cc" className="block text-[13px] font-semibold text-[#323130] mb-2">Cc</label>
                    <input
                      id="compose-cc"
                      type="text"
                      className="w-full text-[13px] focus:outline-none p-2.5 bg-white border border-[#c8c6c4] rounded focus:border-[#0078d4] focus:ring-1 focus:ring-[#0078d4] placeholder-[#a19f9d]"
                      placeholder="Add Cc recipients..."
                      aria-label="Carbon copy recipients"
                    />
                  </div>
                )}
                
                {/* Subject Field - Vertical Layout */}
                <div className="px-6 py-3 border-b border-[#edebe9]">
                  <div className="flex items-center justify-between mb-2">
                    <label htmlFor="compose-subject" className="block text-[13px] font-semibold text-[#323130]">Subject</label>
                    {!showCc && (
                      <button onClick={() => setShowCc(true)} className="text-[12px] text-[#0078d4] hover:underline">+ Add Cc</button>
                    )}
                  </div>
                  <input
                    id="compose-subject"
                    type="text"
                    value={composeSubject}
                    onChange={(e) => setComposeSubject(e.target.value)}
                    placeholder="Enter subject..."
                    className="w-full text-[13px] focus:outline-none p-2.5 bg-white border border-[#c8c6c4] rounded focus:border-[#0078d4] focus:ring-1 focus:ring-[#0078d4] placeholder-[#a19f9d]"
                  />
                </div>
                
                {/* Body - Vertical Layout */}
                <div className="flex-1 px-6 py-3 flex flex-col overflow-hidden">
                  <label htmlFor="compose-body" className="block text-[13px] font-semibold text-[#323130] mb-2">Message</label>
                  <textarea
                    id="compose-body"
                    value={composeBody}
                    onChange={(e) => setComposeBody(e.target.value)}
                    placeholder="Write your message here..."
                    className="flex-1 w-full resize-none text-[14px] focus:outline-none text-[#323130] leading-relaxed p-3 border border-[#c8c6c4] rounded focus:border-[#0078d4] focus:ring-1 focus:ring-[#0078d4] placeholder-[#a19f9d]"
                    style={{ minHeight: '200px' }}
                    aria-label="Message body"
                  />
                  
                  {/* Compose Attachment Previews */}
                  {composeAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {composeAttachments.map((att, idx) => (
                        <span key={idx} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#f3f2f1] rounded text-[12px] text-[#323130]">
                          <svg className="w-3.5 h-3.5 text-[#605e5c]" viewBox="0 0 16 16" fill="currentColor"><path d="M14.5 3a3.5 3.5 0 0 1 0 7H6v1h8.5a4.5 4.5 0 0 0 0-9A4.5 4.5 0 0 0 10 6.5V15a3 3 0 0 0 6 0V6h1v9a4 4 0 0 1-8 0V6.5A5.5 5.5 0 0 1 14.5 1v2z"/></svg>
                          {att.original_name}
                          <button onClick={() => setComposeAttachments(prev => prev.filter((_, i) => i !== idx))} className="text-[#a19f9d] hover:text-[#323130]" aria-label={`Remove ${att.original_name}`}>
                            <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor"><path d="M8.7 8l3.65-3.65-.7-.7L8 7.29 4.35 3.65l-.7.7L7.29 8l-3.64 3.65.7.7L8 8.71l3.65 3.64.7-.7L8.71 8z"/></svg>
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  
                  {/* Compose Toolbar */}
                  <div className="flex items-center gap-1 mt-2 relative">
                    <input type="file" ref={composeFileRef} className="hidden" onChange={(e) => handleFileUpload(e, 'compose')} aria-hidden="true" />
                    <button onClick={() => composeFileRef.current?.click()} disabled={uploading} className="p-2 text-[#605e5c] hover:bg-[#e1dfdd] rounded disabled:opacity-50" title="Attach file" aria-label="Attach file to compose">
                      <svg className="w-[18px] h-[18px]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path d="M14.5 3a3.5 3.5 0 0 1 .15 6.995L14.5 10H6v1h8.5a4.5 4.5 0 0 0 .22-8.996L14.5 2A4.5 4.5 0 0 0 10 6.5V15a3 3 0 0 0 5.995.176L16 15V6h1v9a4 4 0 0 1-7.995.2L9 15V6.5a5.5 5.5 0 0 1 5.5-5.5V3z"/>
                      </svg>
                    </button>
                    <button onClick={() => setShowComposeEmojiPicker(!showComposeEmojiPicker)} className="p-2 text-[#605e5c] hover:bg-[#e1dfdd] rounded" title="Insert emoji" aria-label="Insert emoji to compose">
                      <svg className="w-[18px] h-[18px]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path d="M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm0 1a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM7.5 8a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm5 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM6.5 11.5h7c-.2 1.95-1.67 3.5-3.5 3.5s-3.3-1.55-3.5-3.5z"/>
                      </svg>
                    </button>
                    {uploading && <span className="text-[11px] text-[#605e5c] ml-1">Uploading...</span>}
                    {showComposeEmojiPicker && (
                      <div className="absolute bottom-full left-0 mb-2 bg-white border border-[#c8c6c4] rounded-lg shadow-lg p-2 z-30" role="dialog" aria-label="Emoji picker">
                        <div className="grid grid-cols-8 gap-1">
                          {emojis.map(emoji => (
                            <button
                              key={emoji}
                              onClick={() => {
                                setComposeBody(prev => prev + emoji);
                                setShowComposeEmojiPicker(false);
                              }}
                              className="w-8 h-8 flex items-center justify-center hover:bg-[#f3f2f1] rounded text-[18px]"
                              aria-label={`Insert ${emoji}`}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : selectedConversation ? (
            /* Reading Pane Content */
            <div className="flex-1 flex flex-col overflow-hidden">
              
              {/* Message Actions Toolbar */}
              <div className="flex items-center gap-1 px-3 py-2 border-b border-[#edebe9] bg-[#faf9f8]" role="toolbar" aria-label="Message actions">
                <button 
                  onClick={() => setReplyMode('reply')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[#323130] hover:bg-[#e1dfdd] rounded-sm text-[13px]"
                  aria-label="Reply to sender"
                >
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M6 3L1 8l5 5v-3c5 0 8 2 10 6 0-6-3-10-10-10V3z"/>
                  </svg>
                  Reply
                </button>
                <button 
                  onClick={() => setReplyMode('replyAll')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[#323130] hover:bg-[#e1dfdd] rounded-sm text-[13px]"
                  aria-label="Reply to all recipients"
                >
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M9 5L4 10l5 5v-3c5 0 7 2 9 5 0-5-3-9-9-9V5z"/>
                    <path d="M6 3L1 8l5 5v-2L3 8l3-3V3z"/>
                  </svg>
                  Reply all
                </button>
                <button 
                  onClick={handleForward}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[#323130] hover:bg-[#e1dfdd] rounded-sm text-[13px]"
                  aria-label="Forward message"
                >
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M10 3l5 5-5 5v-3C5 10 2 12 0 16c0-6 3-10 10-10V3z"/>
                  </svg>
                  Forward
                </button>
                <div className="w-px h-5 bg-[#c8c6c4] mx-2" aria-hidden="true" />
                <button onClick={archiveConversation} className="flex items-center gap-1.5 px-3 py-1.5 text-[#323130] hover:bg-[#e1dfdd] rounded-sm text-[13px]" aria-label="Archive message">
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M14 3H2v10h12V3zm-1 9H3V6h10v6z"/>
                  </svg>
                  Archive
                </button>
                <button onClick={deleteConversation} className="flex items-center gap-1.5 px-3 py-1.5 text-[#323130] hover:bg-[#e1dfdd] rounded-sm text-[13px]" aria-label="Delete message">
                  <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M13 3H3v10h10V3zm-1 9H4V4h8v8zM6 1h4v1H6V1z"/>
                  </svg>
                  Delete
                </button>
              </div>
              
              {/* Message Content */}
              <div className="flex-1 overflow-y-auto bg-white" role="region" aria-label="Message content">
                {messagesLoading ? (
                  <div className="flex items-center justify-center h-32" role="status">
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-[#0078d4] border-t-transparent" aria-hidden="true"></div>
                    <span className="sr-only">Loading messages...</span>
                  </div>
                ) : (
                  <>
                    {/* Thread Subject Header - Outlook style */}
                    <div className="px-6 lg:px-8 xl:px-10 py-5 border-b border-[#edebe9]">
                      <h1 className="text-[21px] font-semibold text-[#323130]" style={{ fontFamily: "'Segoe UI', 'Segoe UI Web (West European)', -apple-system, BlinkMacSystemFont, Roboto, sans-serif" }}>
                        {selectedConversation.lastMessage?.subject || '(No Subject)'}
                      </h1>
                    </div>
                    
                    {/* Messages Thread */}
                    <div className="divide-y divide-[#edebe9]" role="list" aria-label="Message thread">
                      {messages.map((msg, idx) => (
                        <div key={msg.id} className="px-6 lg:px-8 xl:px-10 py-5" role="listitem" aria-label={`Message from ${msg.sender_id === user?.id ? 'you' : msg.sender_name}, ${formatFullDate(msg.created_at)}`}>
                          {/* Message Header Row */}
                          <div className="flex items-start gap-4">
                            {/* Avatar */}
                            <div 
                              className="w-12 h-12 rounded-full flex items-center justify-center text-white text-[14px] font-semibold flex-shrink-0"
                              style={{ backgroundColor: getAvatarColor(msg.sender_id === user?.id ? 'You' : msg.sender_name) }}
                            >
                              {getInitials(msg.sender_id === user?.id ? user?.name || 'You' : msg.sender_name)}
                            </div>
                            
                            {/* Sender Details */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="text-[15px] font-semibold text-[#323130]">
                                  {msg.sender_id === user?.id ? (user?.name || 'You') : msg.sender_name}
                                </span>
                                <span className="text-[12px] text-[#605e5c] flex-shrink-0 ml-4">
                                  {formatFullDate(msg.created_at)}
                                </span>
                              </div>
                              <div className="text-[13px] text-[#605e5c] mb-4">
                                To: {msg.sender_id === user?.id ? (selectedConversation?.displayName || msg.receiver_name || 'Recipient') : (user?.name || 'You')}
                              </div>
                              
                              {/* Message Body - Outlook email content style */}
                              <div 
                                className="text-[14px] text-[#323130] leading-[1.6] max-w-none prose prose-sm"
                                style={{ 
                                  fontFamily: "'Segoe UI', 'Segoe UI Web (West European)', -apple-system, BlinkMacSystemFont, Roboto, sans-serif",
                                  wordWrap: 'break-word',
                                  overflowWrap: 'break-word'
                                }}
                                dangerouslySetInnerHTML={{ __html: msg.body }}
                                role="article"
                                aria-label={`Message body from ${msg.sender_id === user?.id ? 'you' : msg.sender_name}`}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>
              
              {/* Reply Box - Outlook Style */}
              <div className="border-t border-[#edebe9] p-4 bg-white" role="region" aria-label="Reply">
                <div className="border border-[#c8c6c4] rounded focus-within:border-[#0078d4] focus-within:ring-1 focus-within:ring-[#0078d4]">
                  <label htmlFor="reply-textarea" className="sr-only">Reply to message</label>
                  <textarea
                    id="reply-textarea"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Type your reply here..."
                    className="w-full resize-none text-[14px] focus:outline-none p-4 min-h-[100px] placeholder-[#a19f9d]"
                    style={{ fontFamily: "'Segoe UI', 'Segoe UI Web (West European)', -apple-system, BlinkMacSystemFont, Roboto, sans-serif" }}
                    aria-label="Reply message body. Press Ctrl+Enter or Cmd+Enter to send."
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        sendReply();
                      }
                    }}
                  />
                  {/* Attachment previews */}
                  {replyAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 px-4 py-2 border-t border-[#edebe9]">
                      {replyAttachments.map((att, idx) => (
                        <span key={idx} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#f3f2f1] rounded text-[12px] text-[#323130]">
                          <svg className="w-3.5 h-3.5 text-[#605e5c]" viewBox="0 0 16 16" fill="currentColor"><path d="M14.5 3a3.5 3.5 0 0 1 0 7H6v1h8.5a4.5 4.5 0 0 0 0-9A4.5 4.5 0 0 0 10 6.5V15a3 3 0 0 0 6 0V6h1v9a4 4 0 0 1-8 0V6.5A5.5 5.5 0 0 1 14.5 1v2z"/></svg>
                          {att.original_name}
                          <button onClick={() => setReplyAttachments(prev => prev.filter((_, i) => i !== idx))} className="text-[#a19f9d] hover:text-[#323130]" aria-label={`Remove ${att.original_name}`}>
                            <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor"><path d="M8.7 8l3.65-3.65-.7-.7L8 7.29 4.35 3.65l-.7.7L7.29 8l-3.64 3.65.7.7L8 8.71l3.65 3.64.7-.7L8.71 8z"/></svg>
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between px-3 py-2 border-t border-[#edebe9] bg-[#faf9f8]">
                    <div className="flex items-center gap-1 relative">
                      <input type="file" ref={replyFileRef} className="hidden" onChange={(e) => handleFileUpload(e, 'reply')} aria-hidden="true" />
                      <button onClick={() => replyFileRef.current?.click()} disabled={uploading} className="p-2 text-[#605e5c] hover:bg-[#e1dfdd] rounded disabled:opacity-50" title="Attach file" aria-label="Attach file">
                        <svg className="w-[18px] h-[18px]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                          <path d="M14.5 3a3.5 3.5 0 0 1 .15 6.995L14.5 10H6v1h8.5a4.5 4.5 0 0 0 .22-8.996L14.5 2A4.5 4.5 0 0 0 10 6.5V15a3 3 0 0 0 5.995.176L16 15V6h1v9a4 4 0 0 1-7.995.2L9 15V6.5a5.5 5.5 0 0 1 5.5-5.5V3z"/>
                        </svg>
                      </button>
                      <button onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="p-2 text-[#605e5c] hover:bg-[#e1dfdd] rounded" title="Insert emoji" aria-label="Insert emoji">
                        <svg className="w-[18px] h-[18px]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                          <path d="M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm0 1a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM7.5 8a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm5 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM6.5 11.5h7c-.2 1.95-1.67 3.5-3.5 3.5s-3.3-1.55-3.5-3.5z"/>
                        </svg>
                      </button>
                      {uploading && <span className="text-[11px] text-[#605e5c] ml-1">Uploading...</span>}
                      {/* Emoji Picker */}
                      {showEmojiPicker && (
                        <div className="absolute bottom-full left-0 mb-2 bg-white border border-[#c8c6c4] rounded-lg shadow-lg p-2 z-30" role="dialog" aria-label="Emoji picker">
                          <div className="grid grid-cols-8 gap-1">
                            {emojis.map(emoji => (
                              <button
                                key={emoji}
                                onClick={() => {
                                  setReplyText(prev => prev + emoji);
                                  setShowEmojiPicker(false);
                                }}
                                className="w-8 h-8 flex items-center justify-center hover:bg-[#f3f2f1] rounded text-[18px]"
                                aria-label={`Insert ${emoji}`}
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={sendReply}
                      disabled={sending || !replyText.trim()}
                      className="flex items-center gap-2 px-4 py-1.5 bg-[#0078d4] text-white rounded hover:bg-[#106ebe] disabled:opacity-50 disabled:cursor-not-allowed text-[13px] font-semibold transition-colors"
                      aria-label="Send reply"
                    >
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path d="M2.72 2.05l15.74 7.12c.38.18.51.64.25.97a.67.67 0 0 1-.25.21l-15.74 7.12a.75.75 0 0 1-1.01-.35.75.75 0 0 1-.04-.52l1.62-5.96L13 10 3.29 9.36l-1.62-5.96a.75.75 0 0 1 .48-.94c.18-.06.38-.04.57.09z"/>
                      </svg>
                      Send
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Empty State */
            <div className="flex-1 flex flex-col items-center justify-center text-[#605e5c]" role="status" aria-label="No message selected">
              <svg className="w-24 h-24 text-[#c8c6c4] mb-4" viewBox="0 0 96 96" fill="currentColor" aria-hidden="true">
                <path d="M84 16H12a8 8 0 0 0-8 8v48a8 8 0 0 0 8 8h72a8 8 0 0 0 8-8V24a8 8 0 0 0-8-8zm0 4c.77 0 1.47.3 2.02.78L48 46.58 9.98 20.78c.55-.48 1.25-.78 2.02-.78h72zM8 72V26.82l39.44 26.79a1 1 0 0 0 1.12 0L88 26.82V72a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4z"/>
              </svg>
              <p className="text-[16px] font-semibold text-[#323130]">Select an item to read</p>
              <p className="text-[13px] text-[#605e5c] mt-1">Nothing is selected</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
