'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSessionRBAC } from '@/utils/client-rbac';
import { fetchJSON } from '@/utils/http';
import Navbar from '@/components/Navbar';
import {
  PaperAirplaneIcon,
  MagnifyingGlassIcon,
  PaperClipIcon,
  DocumentIcon,
  XMarkIcon,
  ArrowPathIcon,
  UserCircleIcon,
  PlusIcon,
  ChevronLeftIcon,
  ArrowDownTrayIcon,
  PhotoIcon
} from '@heroicons/react/24/outline';

export default function MessagesPage() {
  const { user, loading: authLoading } = useSessionRBAC();
  const [conversations, setConversations] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  
  // Active conversation
  const [activeConversation, setActiveConversation] = useState(null);
  const [threadMessages, setThreadMessages] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  
  // Compose state
  const [showNewChat, setShowNewChat] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);

  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [threadMessages]);

  // Fetch all conversations (grouped by user)
  const fetchConversations = useCallback(async () => {
    try {
      setLoading(true);
      // Fetch inbox and group by sender
      const inboxRes = await fetchJSON('/api/messages?type=inbox&limit=100');
      const sentRes = await fetchJSON('/api/messages?type=sent&limit=100');
      
      if (inboxRes.success && sentRes.success) {
        const allMessages = [...(inboxRes.data.messages || []), ...(sentRes.data.messages || [])];
        const conversationMap = new Map();
        
        allMessages.forEach(msg => {
          const otherUserId = msg.sender_id === user?.id ? msg.receiver_id : msg.sender_id;
          const otherUserName = msg.sender_id === user?.id ? msg.receiver_name : msg.sender_name;
          const otherUserEmail = msg.sender_id === user?.id ? msg.receiver_email : msg.sender_email;
          
          const existing = conversationMap.get(otherUserId);
          const msgDate = new Date(msg.created_at);
          
          if (!existing || msgDate > new Date(existing.last_message_at)) {
            const unreadIncrement = msg.sender_id !== user?.id && !msg.read_status ? 1 : 0;
            conversationMap.set(otherUserId, {
              user_id: otherUserId,
              user_name: otherUserName || 'Unknown User',
              user_email: otherUserEmail,
              last_message: msg.body_preview || msg.subject || '',
              last_message_at: msg.created_at,
              unread_count: (existing?.unread_count || 0) + unreadIncrement
            });
          } else if (msg.sender_id !== user?.id && !msg.read_status) {
            existing.unread_count = (existing.unread_count || 0) + 1;
          }
        });
        
        setConversations(Array.from(conversationMap.values()).sort((a, b) => 
          new Date(b.last_message_at) - new Date(a.last_message_at)
        ));
        setUnreadCount(inboxRes.data.unread_count || 0);
      }
    } catch (e) {
      console.error('Failed to fetch conversations:', e);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  // Fetch users for new chat
  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetchJSON('/api/users?limit=1000');
      if (res.success) {
        setUsers(res.data.filter(u => u.id !== user?.id));
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    }
  }, [user?.id]);

  // Fetch thread messages
  const fetchThread = useCallback(async (userId) => {
    try {
      setThreadLoading(true);
      const res = await fetchJSON(`/api/messages/thread/${userId}`);
      if (res.success) {
        setThreadMessages(res.data.messages || []);
        // Refresh conversations to update unread counts
        fetchConversations();
      }
    } catch (error) {
      console.error('Failed to fetch thread:', error);
    } finally {
      setThreadLoading(false);
    }
  }, [fetchConversations]);

  // Initial load
  useEffect(() => {
    if (!authLoading && user) {
      fetchConversations();
      fetchUsers();
    }
  }, [authLoading, user, fetchConversations, fetchUsers]);

  // Poll for new messages
  useEffect(() => {
    if (!user) return;
    
    const interval = setInterval(() => {
      fetchConversations();
      if (activeConversation) {
        fetchThread(activeConversation.user_id);
      }
    }, 30000); // Every 30 seconds
    
    return () => clearInterval(interval);
  }, [user, activeConversation, fetchConversations, fetchThread]);

  // Open conversation
  const openConversation = (conv) => {
    setActiveConversation(conv);
    setShowNewChat(false);
    fetchThread(conv.user_id);
  };

  // Start new chat with user
  const startNewChat = (selectedUser) => {
    const conv = {
      user_id: selectedUser.id,
      user_name: selectedUser.full_name || selectedUser.username,
      user_email: selectedUser.email,
      last_message: '',
      unread_count: 0
    };
    setActiveConversation(conv);
    setShowNewChat(false);
    setThreadMessages([]);
    fetchThread(selectedUser.id);
  };

  // File upload handler
  const handleFileUpload = async (e) => {
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
        setAttachments([...attachments, data.data]);
      } else {
        alert(data.error || 'Failed to upload file');
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to upload file');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  // Send message
  const handleSendMessage = async () => {
    if (!activeConversation?.user_id) {
      alert('Please select a conversation first');
      return;
    }
    if (!messageText.trim() && attachments.length === 0) {
      return;
    }

    setSending(true);
    try {
      const payload = {
        receiver_id: activeConversation.user_id,
        subject: 'Message',
        body: messageText.trim() || (attachments.length > 0 ? '[Attachment]' : ''),
        related_module: 'none',
        related_id: null,
        attachments
      };
      
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (data.success) {
        setMessageText('');
        setAttachments([]);
        fetchThread(activeConversation.user_id);
        fetchConversations();
      } else {
        alert(data.error || 'Failed to send message');
      }
    } catch (error) {
      console.error('Send error:', error);
      alert('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  // Format date
  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  // Format message time
  const formatMessageTime = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  // Format file size
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Check if file is an image
  const isImageFile = (fileType) => {
    return fileType?.startsWith('image/');
  };

  // Download attachment
  const handleDownloadAttachment = async (attachmentId, fileName) => {
    try {
      const response = await fetch(`/api/messages/attachments/${attachmentId}`);
      if (!response.ok) {
        throw new Error('Failed to download file');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download error:', error);
      alert('Failed to download file');
    }
  };

  // Filter conversations
  const filteredConversations = conversations.filter(conv =>
    conv.user_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Filter users for new chat
  const filteredUsers = users.filter(u => {
    const name = (u.full_name || u.username || '').toLowerCase();
    const email = (u.email || '').toLowerCase();
    const term = searchTerm.toLowerCase();
    return name.includes(term) || email.includes(term);
  });

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
        <ArrowPathIcon className="w-8 h-8 text-gray-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
      <Navbar />
      
      <div className="px-4 sm:px-6 lg:px-8 py-8 pt-20">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden" style={{ height: 'calc(100vh - 140px)' }}>
          <div className="flex h-full">
            {/* Left Sidebar - Conversations */}
            <div className="w-80 border-r border-gray-200 flex flex-col bg-white">
              {/* Header */}
              <div className="p-4 border-b border-gray-200">
                <div className="flex items-center justify-between mb-4">
                  <h1 className="text-xl font-bold text-gray-900">Messages</h1>
                  <button
                    onClick={() => { setShowNewChat(true); setActiveConversation(null); setSearchTerm(''); }}
                    className="p-2 bg-[#7F2487] text-white rounded-lg hover:bg-[#6a1e73] transition-colors"
                    title="New message"
                  >
                    <PlusIcon className="w-5 h-5" />
                  </button>
                </div>
                
                {/* Search */}
                <div className="relative">
                  <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={showNewChat ? "Search users..." : "Search conversations..."}
                    className="w-full pl-9 pr-4 py-2 bg-gray-100 border-0 rounded-lg text-sm focus:ring-2 focus:ring-[#7F2487] focus:bg-white"
                  />
                </div>
              </div>

              {/* Conversation List or User List */}
              <div className="flex-1 overflow-y-auto">
                {showNewChat ? (
                  // New Chat - User List
                  <div>
                    <div className="px-4 py-2 bg-gray-50 border-b border-gray-200">
                      <button
                        onClick={() => setShowNewChat(false)}
                        className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
                      >
                        <ChevronLeftIcon className="w-4 h-4" />
                        Back to conversations
                      </button>
                    </div>
                    <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase">
                      Select a user to message
                    </div>
                    {filteredUsers.length === 0 ? (
                      <div className="px-4 py-8 text-center text-gray-500 text-sm">
                        No users found
                      </div>
                    ) : (
                      filteredUsers.map((u) => (
                        <button
                          key={u.id}
                          onClick={() => startNewChat(u)}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                        >
                          <div className="w-10 h-10 bg-gradient-to-br from-purple-400 to-purple-600 rounded-full flex items-center justify-center text-white font-medium">
                            {(u.full_name || u.username || 'U').charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 truncate">
                              {u.full_name || u.username}
                            </p>
                            <p className="text-sm text-gray-500 truncate">{u.email}</p>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                ) : loading ? (
                  <div className="flex items-center justify-center py-20">
                    <ArrowPathIcon className="w-6 h-6 text-gray-400 animate-spin" />
                  </div>
                ) : filteredConversations.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                    <UserCircleIcon className="w-16 h-16 text-gray-300 mb-4" />
                    <p className="text-gray-600 font-medium">No conversations yet</p>
                    <p className="text-sm text-gray-500 mt-1">Start a new message to begin chatting</p>
                    <button
                      onClick={() => setShowNewChat(true)}
                      className="mt-4 px-4 py-2 bg-[#7F2487] text-white rounded-lg text-sm hover:bg-[#6a1e73]"
                    >
                      Start New Chat
                    </button>
                  </div>
                ) : (
                  filteredConversations.map((conv) => (
                    <button
                      key={conv.user_id}
                      onClick={() => openConversation(conv)}
                      className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left border-b border-gray-100 ${
                        activeConversation?.user_id === conv.user_id ? 'bg-purple-50' : ''
                      }`}
                    >
                      <div className="relative">
                        <div className="w-12 h-12 bg-gradient-to-br from-purple-400 to-purple-600 rounded-full flex items-center justify-center text-white font-medium text-lg">
                          {(conv.user_name || 'U').charAt(0).toUpperCase()}
                        </div>
                        {conv.unread_count > 0 && (
                          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                            {conv.unread_count > 9 ? '9+' : conv.unread_count}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className={`font-medium truncate ${conv.unread_count > 0 ? 'text-gray-900' : 'text-gray-700'}`}>
                            {conv.user_name}
                          </p>
                          <span className="text-xs text-gray-500 ml-2 flex-shrink-0">{formatDate(conv.last_message_at)}</span>
                        </div>
                        <p className={`text-sm truncate ${conv.unread_count > 0 ? 'text-gray-900 font-medium' : 'text-gray-500'}`}>
                          {conv.last_message || 'No messages yet'}
                        </p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Right - Chat Area */}
            <div className="flex-1 flex flex-col bg-gray-50">
              {activeConversation ? (
                <>
                  {/* Chat Header */}
                  <div className="px-6 py-4 border-b border-gray-200 bg-white flex items-center gap-4">
                    <div className="w-10 h-10 bg-gradient-to-br from-purple-400 to-purple-600 rounded-full flex items-center justify-center text-white font-medium">
                      {(activeConversation.user_name || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h2 className="font-semibold text-gray-900">{activeConversation.user_name}</h2>
                      {activeConversation.user_email && (
                        <p className="text-sm text-gray-500">{activeConversation.user_email}</p>
                      )}
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {threadLoading ? (
                      <div className="flex items-center justify-center h-full">
                        <ArrowPathIcon className="w-8 h-8 text-gray-400 animate-spin" />
                      </div>
                    ) : threadMessages.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full text-gray-500">
                        <p className="text-lg font-medium">No messages yet</p>
                        <p className="text-sm">Send a message to start the conversation</p>
                      </div>
                    ) : (
                      <>
                        {threadMessages.map((msg, idx) => {
                          const isMe = msg.sender_id === user?.id;
                          const showDate = idx === 0 || 
                            new Date(msg.created_at).toDateString() !== new Date(threadMessages[idx - 1].created_at).toDateString();
                          
                          return (
                            <div key={msg.id}>
                              {showDate && (
                                <div className="flex justify-center my-4">
                                  <span className="px-3 py-1 bg-gray-200 text-gray-600 text-xs rounded-full">
                                    {new Date(msg.created_at).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
                                  </span>
                                </div>
                              )}
                              <div className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[70%] rounded-2xl px-4 py-2.5 ${
                                  isMe
                                    ? 'bg-[#7F2487] text-white rounded-br-md'
                                    : 'bg-white text-gray-900 rounded-bl-md shadow-sm'
                                }`}>
                                  {msg.subject && msg.subject !== 'Message' && (
                                    <p className={`text-xs font-medium mb-1 ${isMe ? 'text-purple-200' : 'text-gray-500'}`}>
                                      {msg.subject}
                                    </p>
                                  )}
                                  {msg.body && msg.body !== '[Attachment]' && (
                                    <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
                                  )}
                                  {/* Display Attachments */}
                                  {msg.attachments && msg.attachments.length > 0 && (
                                    <div className={`mt-2 space-y-2 ${msg.body && msg.body !== '[Attachment]' ? 'pt-2 border-t border-opacity-20' : ''} ${isMe ? 'border-purple-200' : 'border-gray-200'}`}>
                                      {msg.attachments.map((att) => (
                                        <div 
                                          key={att.id} 
                                          className={`flex items-center gap-2 p-2 rounded-lg ${isMe ? 'bg-purple-600/30' : 'bg-gray-100'}`}
                                        >
                                          {isImageFile(att.file_type) ? (
                                            <PhotoIcon className={`w-5 h-5 flex-shrink-0 ${isMe ? 'text-purple-200' : 'text-gray-500'}`} />
                                          ) : (
                                            <DocumentIcon className={`w-5 h-5 flex-shrink-0 ${isMe ? 'text-purple-200' : 'text-gray-500'}`} />
                                          )}
                                          <div className="flex-1 min-w-0">
                                            <p className={`text-xs font-medium truncate ${isMe ? 'text-white' : 'text-gray-700'}`}>
                                              {att.original_name}
                                            </p>
                                            <p className={`text-xs ${isMe ? 'text-purple-200' : 'text-gray-400'}`}>
                                              {formatFileSize(att.file_size)}
                                            </p>
                                          </div>
                                          <button
                                            onClick={() => handleDownloadAttachment(att.id, att.original_name)}
                                            className={`p-1.5 rounded-full hover:bg-opacity-20 transition-colors ${isMe ? 'hover:bg-white text-white' : 'hover:bg-gray-300 text-gray-600'}`}
                                            title="Download"
                                          >
                                            <ArrowDownTrayIcon className="w-4 h-4" />
                                          </button>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {/* Legacy: Show attachment count if no attachments array but has count */}
                                  {(!msg.attachments || msg.attachments.length === 0) && msg.attachment_count > 0 && (
                                    <div className={`flex items-center gap-1 mt-2 text-xs ${isMe ? 'text-purple-200' : 'text-gray-500'}`}>
                                      <PaperClipIcon className="w-3 h-3" />
                                      {msg.attachment_count} attachment{msg.attachment_count > 1 ? 's' : ''}
                                    </div>
                                  )}
                                  <p className={`text-xs mt-1 ${isMe ? 'text-purple-200' : 'text-gray-400'}`}>
                                    {formatMessageTime(msg.created_at)}
                                  </p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        <div ref={messagesEndRef} />
                      </>
                    )}
                  </div>

                  {/* Message Input */}
                  <div className="p-4 border-t border-gray-200 bg-white">
                    {/* Attachments Preview */}
                    {attachments.length > 0 && (
                      <div className="mb-3 flex flex-wrap gap-2">
                        {attachments.map((att, idx) => (
                          <div key={idx} className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg">
                            <DocumentIcon className="w-4 h-4 text-gray-500" />
                            <span className="text-sm text-gray-700 truncate max-w-[150px]">{att.original_name}</span>
                            <button
                              onClick={() => setAttachments(attachments.filter((_, i) => i !== idx))}
                              className="text-gray-400 hover:text-red-500"
                            >
                              <XMarkIcon className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    <div className="flex items-end gap-3">
                      {/* Attach Button */}
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="p-2.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                        title="Attach file"
                      >
                        <PaperClipIcon className="w-5 h-5" />
                      </button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        onChange={handleFileUpload}
                        className="hidden"
                        accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.txt,.csv"
                      />

                      {/* Message Input */}
                      <div className="flex-1">
                        <textarea
                          value={messageText}
                          onChange={(e) => setMessageText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleSendMessage();
                            }
                          }}
                          placeholder="Type a message..."
                          rows={1}
                          className="w-full px-4 py-2.5 bg-gray-100 border-0 rounded-2xl resize-none focus:ring-2 focus:ring-[#7F2487] focus:bg-white text-sm"
                          style={{ minHeight: '44px', maxHeight: '120px' }}
                        />
                      </div>

                      {/* Send Button */}
                      <button
                        onClick={handleSendMessage}
                        disabled={sending || (!messageText.trim() && attachments.length === 0)}
                        className="p-2.5 bg-[#7F2487] text-white rounded-lg hover:bg-[#6a1e73] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {sending ? (
                          <ArrowPathIcon className="w-5 h-5 animate-spin" />
                        ) : (
                          <PaperAirplaneIcon className="w-5 h-5" />
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-gray-400 mt-2">Press Enter to send, Shift+Enter for new line</p>
                  </div>
                </>
              ) : (
                // No conversation selected
                <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
                  <div className="w-24 h-24 bg-gray-200 rounded-full flex items-center justify-center mb-6">
                    <UserCircleIcon className="w-16 h-16 text-gray-400" />
                  </div>
                  <h2 className="text-xl font-semibold text-gray-700 mb-2">Your Messages</h2>
                  <p className="text-gray-500 mb-6">Select a conversation or start a new one</p>
                  <button
                    onClick={() => setShowNewChat(true)}
                    className="flex items-center gap-2 px-6 py-2.5 bg-[#7F2487] text-white rounded-lg hover:bg-[#6a1e73] transition-colors"
                  >
                    <PlusIcon className="w-5 h-5" />
                    New Message
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
