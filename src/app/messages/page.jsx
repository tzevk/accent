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
  PhotoIcon,
  InboxIcon,
  PaperAirplaneIcon as SentIcon,
  TrashIcon,
  StarIcon,
  ArchiveBoxIcon,
  EllipsisHorizontalIcon,
  ChevronRightIcon,
  EnvelopeIcon,
  EnvelopeOpenIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  FlagIcon
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';

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
  const [selectedMessage, setSelectedMessage] = useState(null);
  
  // Compose state
  const [showNewChat, setShowNewChat] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [messageSubject, setMessageSubject] = useState('');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  
  // Folder state
  const [activeFolder, setActiveFolder] = useState('inbox');
  const [starredMessages, setStarredMessages] = useState(new Set());
  
  // Collapsed folder pane
  const [folderPaneCollapsed, setFolderPaneCollapsed] = useState(false);
  
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
              unread_count: (existing?.unread_count || 0) + unreadIncrement,
              last_subject: msg.subject
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
    setShowCompose(false);
    fetchThread(conv.user_id);
    // Auto-select first message
    setSelectedMessage(null);
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
    setShowCompose(true);
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
        subject: messageSubject.trim() || 'Message',
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
        setMessageSubject('');
        setAttachments([]);
        setShowCompose(false);
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

  // Toggle star
  const toggleStar = (msgId) => {
    setStarredMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(msgId)) {
        newSet.delete(msgId);
      } else {
        newSet.add(msgId);
      }
      return newSet;
    });
  };

  // Format date for message list (Outlook style)
  const formatListDate = (dateStr) => {
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
    } else if (date.getFullYear() === now.getFullYear()) {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    }
  };

  // Format full date for reading pane
  const formatFullDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString([], { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
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

  // Folder items for sidebar
  const folders = [
    { id: 'inbox', name: 'Inbox', icon: InboxIcon, count: unreadCount },
    { id: 'sent', name: 'Sent Items', icon: SentIcon, count: 0 },
    { id: 'starred', name: 'Starred', icon: StarIcon, count: starredMessages.size },
    { id: 'archive', name: 'Archive', icon: ArchiveBoxIcon, count: 0 },
    { id: 'trash', name: 'Deleted Items', icon: TrashIcon, count: 0 },
  ];

  // Get initials for avatar
  const getInitials = (name) => {
    if (!name) return 'U';
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.charAt(0).toUpperCase();
  };

  // Get avatar color based on name
  const getAvatarColor = (name) => {
    const colors = [
      'bg-[#7F2487]', 'bg-[#4D025B]', 'bg-purple-600', 'bg-indigo-600',
      'bg-blue-600', 'bg-teal-600', 'bg-emerald-600', 'bg-amber-600'
    ];
    const index = (name?.charCodeAt(0) || 0) % colors.length;
    return colors[index];
  };

  return (
    <div className="min-h-screen bg-[#f3f2f1]">
      <Navbar />
      
      <div className="pt-1 h-screen flex flex-col">
        {/* Outlook-style Toolbar */}
        <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-2">
          <button
            onClick={() => { setShowCompose(true); setActiveConversation(null); setMessageText(''); setMessageSubject(''); }}
            className="flex items-center gap-2 px-4 py-2 bg-[#7F2487] text-white rounded hover:bg-[#6a1e73] transition-colors font-medium"
          >
            <PlusIcon className="w-4 h-4" />
            New Message
          </button>
          <div className="h-6 w-px bg-gray-300 mx-2" />
          <button className="p-2 text-gray-600 hover:bg-gray-100 rounded transition-colors" title="Reply">
            <ArrowUturnLeftIcon className="w-5 h-5" />
          </button>
          <button className="p-2 text-gray-600 hover:bg-gray-100 rounded transition-colors" title="Reply All">
            <ArrowUturnRightIcon className="w-5 h-5" />
          </button>
          <button className="p-2 text-gray-600 hover:bg-gray-100 rounded transition-colors" title="Forward">
            <PaperAirplaneIcon className="w-5 h-5" />
          </button>
          <div className="h-6 w-px bg-gray-300 mx-2" />
          <button className="p-2 text-gray-600 hover:bg-gray-100 rounded transition-colors" title="Delete">
            <TrashIcon className="w-5 h-5" />
          </button>
          <button className="p-2 text-gray-600 hover:bg-gray-100 rounded transition-colors" title="Archive">
            <ArchiveBoxIcon className="w-5 h-5" />
          </button>
          <button className="p-2 text-gray-600 hover:bg-gray-100 rounded transition-colors" title="Flag">
            <FlagIcon className="w-5 h-5" />
          </button>
          <div className="flex-1" />
          <button 
            onClick={() => { fetchConversations(); if (activeConversation) fetchThread(activeConversation.user_id); }}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded transition-colors" 
            title="Refresh"
          >
            <ArrowPathIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Main Content - Three Panel Layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel - Folder Navigation */}
          <div className={`${folderPaneCollapsed ? 'w-12' : 'w-56'} bg-[#f9f9f9] border-r border-gray-200 flex flex-col transition-all duration-200`}>
            <div className="p-2">
              {!folderPaneCollapsed && (
                <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Folders
                </div>
              )}
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  onClick={() => setActiveFolder(folder.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded text-left transition-colors ${
                    activeFolder === folder.id 
                      ? 'bg-[#7F2487]/10 text-[#7F2487]' 
                      : 'text-gray-700 hover:bg-gray-200'
                  }`}
                  title={folderPaneCollapsed ? folder.name : undefined}
                >
                  <folder.icon className={`w-5 h-5 flex-shrink-0 ${activeFolder === folder.id ? 'text-[#7F2487]' : 'text-gray-500'}`} />
                  {!folderPaneCollapsed && (
                    <>
                      <span className="flex-1 text-sm font-medium">{folder.name}</span>
                      {folder.count > 0 && (
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                          activeFolder === folder.id ? 'bg-[#7F2487] text-white' : 'bg-gray-300 text-gray-600'
                        }`}>
                          {folder.count}
                        </span>
                      )}
                    </>
                  )}
                </button>
              ))}
            </div>
            <div className="flex-1" />
            <button
              onClick={() => setFolderPaneCollapsed(!folderPaneCollapsed)}
              className="p-2 text-gray-500 hover:bg-gray-200 border-t border-gray-200"
            >
              {folderPaneCollapsed ? <ChevronRightIcon className="w-5 h-5 mx-auto" /> : <ChevronLeftIcon className="w-5 h-5 mx-auto" />}
            </button>
          </div>

          {/* Middle Panel - Message List */}
          <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
            {/* Search */}
            <div className="p-3 border-b border-gray-200">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={showNewChat ? "Search people..." : "Search messages..."}
                  className="w-full pl-9 pr-4 py-2 bg-[#f3f2f1] border border-transparent rounded text-sm focus:border-[#7F2487] focus:bg-white focus:outline-none"
                />
              </div>
            </div>

            {/* Message List Header */}
            <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700">
                {showNewChat ? 'Select Recipient' : activeFolder === 'inbox' ? 'Inbox' : folders.find(f => f.id === activeFolder)?.name}
              </span>
              <span className="text-xs text-gray-500">
                {showNewChat ? `${filteredUsers.length} people` : `${filteredConversations.length} conversations`}
              </span>
            </div>

            {/* Message List */}
            <div className="flex-1 overflow-y-auto">
              {showNewChat ? (
                // User selection list
                <div>
                  <button
                    onClick={() => setShowNewChat(false)}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-[#7F2487] hover:bg-gray-50 border-b border-gray-100"
                  >
                    <ChevronLeftIcon className="w-4 h-4" />
                    Back to messages
                  </button>
                  {filteredUsers.length === 0 ? (
                    <div className="px-4 py-8 text-center text-gray-500 text-sm">
                      No users found
                    </div>
                  ) : (
                    filteredUsers.map((u) => (
                      <button
                        key={u.id}
                        onClick={() => startNewChat(u)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#f3f2f1] transition-colors text-left border-b border-gray-100"
                      >
                        <div className={`w-10 h-10 ${getAvatarColor(u.full_name || u.username)} rounded-full flex items-center justify-center text-white text-sm font-semibold`}>
                          {getInitials(u.full_name || u.username)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate text-sm">
                            {u.full_name || u.username}
                          </p>
                          <p className="text-xs text-gray-500 truncate">{u.email}</p>
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
                <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                  <EnvelopeIcon className="w-12 h-12 text-gray-300 mb-3" />
                  <p className="text-gray-600 font-medium text-sm">No messages</p>
                  <p className="text-xs text-gray-500 mt-1">Start a conversation</p>
                </div>
              ) : (
                filteredConversations.map((conv) => {
                  const isSelected = activeConversation?.user_id === conv.user_id;
                  const isUnread = conv.unread_count > 0;
                  
                  return (
                    <button
                      key={conv.user_id}
                      onClick={() => openConversation(conv)}
                      className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors ${
                        isSelected 
                          ? 'bg-[#7F2487]/10 border-l-2 border-l-[#7F2487]' 
                          : 'hover:bg-[#f3f2f1] border-l-2 border-l-transparent'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Unread indicator */}
                        <div className="pt-1">
                          {isUnread ? (
                            <div className="w-2 h-2 bg-[#7F2487] rounded-full" />
                          ) : (
                            <div className="w-2 h-2" />
                          )}
                        </div>
                        
                        {/* Avatar */}
                        <div className={`w-10 h-10 ${getAvatarColor(conv.user_name)} rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0`}>
                          {getInitials(conv.user_name)}
                        </div>
                        
                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className={`text-sm truncate ${isUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                              {conv.user_name}
                            </span>
                            <span className="text-xs text-gray-500 ml-2 flex-shrink-0">
                              {formatListDate(conv.last_message_at)}
                            </span>
                          </div>
                          <p className={`text-xs truncate ${isUnread ? 'font-medium text-gray-800' : 'text-gray-500'}`}>
                            {conv.last_subject && conv.last_subject !== 'Message' ? conv.last_subject : 'No subject'}
                          </p>
                          <p className="text-xs text-gray-500 truncate mt-0.5">
                            {conv.last_message || 'No preview available'}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Panel - Reading Pane / Compose */}
          <div className="flex-1 bg-white flex flex-col">
            {showCompose ? (
              // Compose View - Outlook Style
              <div className="flex-1 flex flex-col bg-white">
                {/* From field */}
                <div className="px-6 py-3 border-b border-gray-200 flex items-center">
                  <span className="text-sm text-gray-500 w-20">From:</span>
                  <div className="flex-1 flex items-center justify-between">
                    <span className="text-sm text-gray-900">{user?.full_name || user?.username} ({user?.email?.substring(0, 15)}...)</span>
                    <div className="flex items-center gap-2">
                      <button className="p-1 text-gray-400 hover:text-gray-600" title="High Importance">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 15l7-7 7 7" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 10l7-7 7 7" />
                        </svg>
                      </button>
                      <button 
                        onClick={() => { setShowCompose(false); setShowNewChat(false); }}
                        className="p-1 text-gray-400 hover:text-gray-600" 
                        title="Pop out"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
                
                {/* To field */}
                <div className="px-6 py-3 border-b border-gray-200 flex items-center">
                  <span className="text-sm text-gray-500 w-20">To:</span>
                  <div className="flex-1 flex items-center">
                    {activeConversation ? (
                      <div className="flex items-center gap-2 px-2 py-1 bg-gray-100 rounded text-sm mr-2">
                        <span className="text-gray-900">{activeConversation.user_name}</span>
                        <button 
                          onClick={() => setActiveConversation(null)}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          <XMarkIcon className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder=""
                        className="flex-1 text-sm border-0 focus:ring-0 p-0 placeholder-gray-400 bg-transparent"
                        autoFocus
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <button className="text-gray-500 hover:text-[#7F2487]">Cc</button>
                    <button className="text-gray-500 hover:text-[#7F2487]">Bcc</button>
                    <button className="p-1 text-gray-400 hover:text-gray-600" title="Add from contacts">
                      <UserCircleIcon className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* User suggestions dropdown when no recipient selected */}
                {!activeConversation && searchTerm && (
                  <div className="absolute top-[180px] left-[calc(50%+140px)] right-6 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                    {filteredUsers.slice(0, 5).map((u) => (
                      <button
                        key={u.id}
                        onClick={() => {
                          startNewChat(u);
                          setSearchTerm('');
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2 hover:bg-gray-50 text-left"
                      >
                        <div className={`w-8 h-8 ${getAvatarColor(u.full_name || u.username)} rounded-full flex items-center justify-center text-white text-xs font-semibold`}>
                          {getInitials(u.full_name || u.username)}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{u.full_name || u.username}</p>
                          <p className="text-xs text-gray-500">{u.email}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                
                {/* Subject field */}
                <div className="px-6 py-3 border-b border-gray-200 flex items-center">
                  <span className="text-sm text-gray-500 w-20">Subject:</span>
                  <input
                    type="text"
                    value={messageSubject}
                    onChange={(e) => setMessageSubject(e.target.value)}
                    placeholder=""
                    className="flex-1 text-sm border-0 focus:ring-0 p-0 placeholder-gray-400 bg-transparent"
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">Importance</span>
                    <ChevronRightIcon className="w-4 h-4 text-gray-400 rotate-90" />
                  </div>
                </div>
                
                {/* Formatting Toolbar */}
                <div className="px-6 py-2 border-b border-gray-200 flex items-center gap-1">
                  <button className="p-1.5 text-gray-500 hover:bg-gray-100 rounded" title="Undo">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                    </svg>
                  </button>
                  <button className="p-1.5 text-gray-400 hover:bg-gray-100 rounded" title="Redo">
                    <ChevronRightIcon className="w-4 h-4 rotate-90" />
                  </button>
                  <button className="p-1.5 text-gray-500 hover:bg-gray-100 rounded" title="Paste">
                    <DocumentIcon className="w-4 h-4" />
                  </button>
                  <div className="w-px h-5 bg-gray-300 mx-1" />
                  <div className="flex items-center gap-1 px-2 py-1 hover:bg-gray-100 rounded cursor-pointer">
                    <span className="text-sm text-gray-700">Aptos</span>
                  </div>
                  <div className="flex items-center gap-1 px-2 py-1 hover:bg-gray-100 rounded cursor-pointer">
                    <span className="text-sm text-gray-700">12</span>
                  </div>
                  <button className="p-1.5 text-gray-500 hover:bg-gray-100 rounded" title="More options">
                    <EllipsisHorizontalIcon className="w-4 h-4" />
                  </button>
                </div>
                
                {/* Attachments */}
                {attachments.length > 0 && (
                  <div className="px-6 py-2 border-b border-gray-100 flex flex-wrap gap-2">
                    {attachments.map((att, idx) => (
                      <div key={idx} className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 rounded-lg text-sm">
                        <PaperClipIcon className="w-4 h-4 text-gray-500" />
                        <span className="text-gray-700 truncate max-w-[150px]">{att.original_name}</span>
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
                
                {/* Message body */}
                <div className="flex-1 px-6 py-4 overflow-y-auto">
                  <textarea
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder=""
                    className="w-full h-full min-h-[200px] resize-none border-0 focus:ring-0 text-sm text-gray-800 placeholder-gray-400 bg-transparent"
                    style={{ fontFamily: 'Aptos, Calibri, Arial, sans-serif' }}
                  />
                </div>
                
                {/* Footer with Send and Draft saved */}
                <div className="px-6 py-3 border-t border-gray-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSendMessage}
                      disabled={sending || !activeConversation || (!messageText.trim() && attachments.length === 0)}
                      className="flex items-center gap-2 px-5 py-2 bg-[#7F2487] text-white rounded hover:bg-[#6a1e73] transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                    >
                      {sending ? (
                        <ArrowPathIcon className="w-4 h-4 animate-spin" />
                      ) : (
                        <PaperAirplaneIcon className="w-4 h-4" />
                      )}
                      Send
                    </button>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="p-2 text-gray-600 hover:bg-gray-100 rounded transition-colors disabled:opacity-50"
                      title="Attach file"
                    >
                      <PaperClipIcon className="w-5 h-5" />
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      onChange={handleFileUpload}
                      className="hidden"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.txt,.csv,.nwd,.dwg,.rar,.zip"
                    />
                    <button
                      onClick={() => { setShowCompose(false); setShowNewChat(false); setMessageText(''); setMessageSubject(''); setAttachments([]); }}
                      className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded transition-colors text-sm"
                    >
                      Discard
                    </button>
                  </div>
                  <span className="text-xs text-gray-500">Draft saved just now</span>
                </div>
              </div>
            ) : activeConversation ? (
              // Reading Pane with Thread
              <div className="flex-1 flex flex-col">
                {/* Conversation Header */}
                <div className="px-6 py-4 border-b border-gray-200 bg-[#faf9f8]">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 ${getAvatarColor(activeConversation.user_name)} rounded-full flex items-center justify-center text-white text-lg font-semibold`}>
                      {getInitials(activeConversation.user_name)}
                    </div>
                    <div className="flex-1">
                      <h2 className="text-lg font-semibold text-gray-900">{activeConversation.user_name}</h2>
                      <p className="text-sm text-gray-500">{activeConversation.user_email}</p>
                    </div>
                    <button
                      onClick={() => setShowCompose(true)}
                      className="flex items-center gap-2 px-4 py-2 bg-[#7F2487] text-white rounded hover:bg-[#6a1e73] transition-colors text-sm font-medium"
                    >
                      <PlusIcon className="w-4 h-4" />
                      Reply
                    </button>
                  </div>
                </div>

                {/* Thread Messages */}
                <div className="flex-1 overflow-y-auto">
                  {threadLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <ArrowPathIcon className="w-8 h-8 text-gray-400 animate-spin" />
                    </div>
                  ) : threadMessages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500">
                      <EnvelopeIcon className="w-16 h-16 text-gray-300 mb-4" />
                      <p className="text-lg font-medium">No messages yet</p>
                      <p className="text-sm">Click Reply to start the conversation</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {threadMessages.map((msg) => {
                        const isMe = msg.sender_id === user?.id;
                        const isStarred = starredMessages.has(msg.id);
                        
                        return (
                          <div key={msg.id} className="px-6 py-4 hover:bg-[#faf9f8] transition-colors">
                            {/* Message Header */}
                            <div className="flex items-start gap-3 mb-3">
                              <div className={`w-10 h-10 ${getAvatarColor(isMe ? user?.full_name : activeConversation.user_name)} rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0`}>
                                {getInitials(isMe ? user?.full_name : activeConversation.user_name)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className="font-semibold text-gray-900 text-sm">
                                    {isMe ? 'You' : activeConversation.user_name}
                                  </span>
                                  {!isMe && (
                                    <span className="text-xs text-gray-500">
                                      &lt;{activeConversation.user_email}&gt;
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-gray-500">
                                  {formatFullDate(msg.created_at)}
                                </p>
                              </div>
                              <div className="flex items-center gap-1">
                                <button 
                                  onClick={() => toggleStar(msg.id)}
                                  className="p-1 text-gray-400 hover:text-yellow-500 transition-colors"
                                >
                                  {isStarred ? (
                                    <StarIconSolid className="w-5 h-5 text-yellow-500" />
                                  ) : (
                                    <StarIcon className="w-5 h-5" />
                                  )}
                                </button>
                                <button className="p-1 text-gray-400 hover:text-gray-600 transition-colors">
                                  <EllipsisHorizontalIcon className="w-5 h-5" />
                                </button>
                              </div>
                            </div>
                            
                            {/* Subject */}
                            {msg.subject && msg.subject !== 'Message' && (
                              <p className="text-sm font-medium text-gray-800 mb-2">{msg.subject}</p>
                            )}
                            
                            {/* Body */}
                            {msg.body && msg.body !== '[Attachment]' && (
                              <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed mb-3">
                                {msg.body}
                              </div>
                            )}
                            
                            {/* Attachments */}
                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className="mt-3 pt-3 border-t border-gray-100">
                                <p className="text-xs font-medium text-gray-500 mb-2">
                                  {msg.attachments.length} Attachment{msg.attachments.length > 1 ? 's' : ''}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                  {msg.attachments.map((att) => (
                                    <button
                                      key={att.id}
                                      onClick={() => handleDownloadAttachment(att.id, att.original_name)}
                                      className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors group"
                                    >
                                      {isImageFile(att.file_type) ? (
                                        <PhotoIcon className="w-5 h-5 text-[#7F2487]" />
                                      ) : (
                                        <DocumentIcon className="w-5 h-5 text-[#7F2487]" />
                                      )}
                                      <div className="text-left">
                                        <p className="text-sm font-medium text-gray-700 truncate max-w-[150px]">
                                          {att.original_name}
                                        </p>
                                        <p className="text-xs text-gray-500">
                                          {formatFileSize(att.file_size)}
                                        </p>
                                      </div>
                                      <ArrowDownTrayIcon className="w-4 h-4 text-gray-400 group-hover:text-[#7F2487] ml-2" />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </div>

                {/* Quick Reply */}
                <div className="p-4 border-t border-gray-200 bg-[#faf9f8]">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 ${getAvatarColor(user?.full_name)} rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0`}>
                      {getInitials(user?.full_name)}
                    </div>
                    <div className="flex-1 flex items-center gap-2 bg-white rounded-lg border border-gray-200 px-3 py-2">
                      <input
                        type="text"
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSendMessage();
                          }
                        }}
                        placeholder="Type a quick reply..."
                        className="flex-1 text-sm border-0 focus:ring-0 p-0 placeholder-gray-400"
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                        title="Attach file"
                      >
                        <PaperClipIcon className="w-5 h-5" />
                      </button>
                      <button
                        onClick={handleSendMessage}
                        disabled={sending || !messageText.trim()}
                        className="p-1 text-[#7F2487] hover:text-[#6a1e73] transition-colors disabled:opacity-50"
                      >
                        <PaperAirplaneIcon className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              // No conversation selected
              <div className="flex-1 flex flex-col items-center justify-center bg-[#faf9f8]">
                <div className="text-center">
                  <div className="w-24 h-24 bg-[#7F2487]/10 rounded-full flex items-center justify-center mx-auto mb-6">
                    <EnvelopeOpenIcon className="w-12 h-12 text-[#7F2487]" />
                  </div>
                  <h2 className="text-xl font-semibold text-gray-700 mb-2">Select a message</h2>
                  <p className="text-gray-500 mb-6">Choose a conversation from the list or start a new one</p>
                  <button
                    onClick={() => { setShowCompose(true); setActiveConversation(null); setMessageText(''); setMessageSubject(''); }}
                    className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#7F2487] text-white rounded hover:bg-[#6a1e73] transition-colors font-medium"
                  >
                    <PlusIcon className="w-5 h-5" />
                    New Message
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
