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
  ChevronLeftIcon,
  ArrowDownTrayIcon,
  InboxIcon,
  TrashIcon,
  ArchiveBoxIcon,
  EnvelopeIcon,
  ArrowUturnLeftIcon,
  ArrowUturnRightIcon,
  FlagIcon,
  Cog6ToothIcon,
  BellIcon,
  Bars3Icon,
  PencilSquareIcon
} from '@heroicons/react/24/outline';
import { FlagIcon as FlagIconSolid } from '@heroicons/react/24/solid';

export default function MessagesPage() {
  const { user, loading: authLoading } = useSessionRBAC();
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  
  const [selectedMessage, setSelectedMessage] = useState(null);
  
  const [showCompose, setShowCompose] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [messageSubject, setMessageSubject] = useState('');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [toRecipients, setToRecipients] = useState([]);
  const [ccRecipients, setCcRecipients] = useState([]);
  const [bccRecipients, setBccRecipients] = useState([]);
  const [activeField, setActiveField] = useState('to');
  
  const [activeFolder, setActiveFolder] = useState('inbox');
  const [flaggedMessages, setFlaggedMessages] = useState(new Set());
  const [folderPaneCollapsed, setFolderPaneCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState('focused');
  
  const fileInputRef = useRef(null);

  // Fetch individual messages (not grouped by thread)
  const fetchMessages = useCallback(async () => {
    try {
      setLoading(true);
      // Fetch both inbox and sent messages
      const [inboxRes, sentRes] = await Promise.all([
        fetchJSON('/api/messages?type=inbox&limit=500'),
        fetchJSON('/api/messages?type=sent&limit=500')
      ]);
      
      let allMessages = [];
      
      if (inboxRes.success) {
        const inboxMessages = inboxRes.data?.messages || inboxRes.data || [];
        allMessages = [...allMessages, ...inboxMessages];
      }
      
      if (sentRes.success) {
        const sentMessages = sentRes.data?.messages || sentRes.data || [];
        allMessages = [...allMessages, ...sentMessages];
      }
      
      // Remove duplicates by id
      const uniqueMessages = Array.from(
        new Map(allMessages.map(m => [m.id, m])).values()
      );
      
      // Sort by date, newest first
      const sortedMessages = uniqueMessages.sort((a, b) => 
        new Date(b.created_at) - new Date(a.created_at)
      );
      setMessages(sortedMessages);
      
      // Count unread (only inbox messages can be unread)
      const unread = sortedMessages.filter(m => !m.read_status && m.receiver_id === user?.id).length;
      setUnreadCount(unread);
    } catch (error) {
      console.error('Failed to fetch messages:', error);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetchJSON('/api/users');
      if (res.success && res.data) {
        const userList = Array.isArray(res.data) ? res.data : (res.data.users || []);
        const otherUsers = userList.filter(u => u.id !== user?.id);
        setUsers(otherUsers);
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    }
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) {
      fetchMessages();
      fetchUsers();
    }
  }, [user?.id, fetchMessages, fetchUsers]);

  const selectMessage = async (msg) => {
    setSelectedMessage(msg);
    setShowCompose(false);
    
    // Fetch full message (this also marks it as read on the server)
    if (!msg.read_status) {
      try {
        await fetchJSON(`/api/messages/${msg.id}`);
        fetchMessages();
      } catch (error) {
        console.error('Failed to fetch message:', error);
      }
    }
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', 'message-attachment');

        const response = await fetch('/api/messages/upload', {
          method: 'POST',
          body: formData,
        });

        const result = await response.json();
        if (result.success) {
          setAttachments(prev => [...prev, {
            name: file.name,
            size: file.size,
            type: file.type,
            url: result.data.filePath
          }]);
        }
      }
    } catch (error) {
      console.error('Failed to upload file:', error);
    }
  };

  const removeAttachment = (index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const sendMessage = async () => {
    if ((!messageText.trim() && attachments.length === 0) || toRecipients.length === 0) return;
    
    setSending(true);
    try {
      for (const recipient of toRecipients) {
        await fetchJSON('/api/messages', {
          method: 'POST',
          body: JSON.stringify({
            receiver_id: recipient.id,
            body: messageText,
            subject: messageSubject,
            attachments: attachments.length > 0 ? attachments : []
          })
        });
      }

      setMessageText('');
      setMessageSubject('');
      setAttachments([]);
      setToRecipients([]);
      setCcRecipients([]);
      setBccRecipients([]);
      setShowCompose(false);
      fetchMessages();
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setSending(false);
    }
  };

  const sendReply = async () => {
    if (!messageText.trim() || !selectedMessage) return;
    
    setSending(true);
    try {
      await fetchJSON('/api/messages', {
        method: 'POST',
        body: JSON.stringify({
          receiver_id: selectedMessage.sender_id,
          message: messageText,
          subject: `Re: ${selectedMessage.subject || 'No Subject'}`,
          attachments: attachments.length > 0 ? JSON.stringify(attachments) : null
        })
      });

      setMessageText('');
      setAttachments([]);
      fetchMessages();
    } catch (error) {
      console.error('Failed to send reply:', error);
    } finally {
      setSending(false);
    }
  };

  const toggleFlag = (e, msgId) => {
    e.stopPropagation();
    setFlaggedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(msgId)) {
        newSet.delete(msgId);
      } else {
        newSet.add(msgId);
      }
      return newSet;
    });
  };

  const startNewMessage = () => {
    setShowCompose(true);
    setSelectedMessage(null);
    setMessageText('');
    setMessageSubject('');
    setAttachments([]);
    setToRecipients([]);
    setCcRecipients([]);
    setBccRecipients([]);
    setRecipientSearch('');
  };

  const addRecipient = (userToAdd, field) => {
    if (field === 'to' && !toRecipients.find(r => r.id === userToAdd.id)) {
      setToRecipients([...toRecipients, userToAdd]);
    } else if (field === 'cc' && !ccRecipients.find(r => r.id === userToAdd.id)) {
      setCcRecipients([...ccRecipients, userToAdd]);
    } else if (field === 'bcc' && !bccRecipients.find(r => r.id === userToAdd.id)) {
      setBccRecipients([...bccRecipients, userToAdd]);
    }
    setRecipientSearch('');
  };

  const removeRecipient = (userId, field) => {
    if (field === 'to') {
      setToRecipients(toRecipients.filter(r => r.id !== userId));
    } else if (field === 'cc') {
      setCcRecipients(ccRecipients.filter(r => r.id !== userId));
    } else if (field === 'bcc') {
      setBccRecipients(bccRecipients.filter(r => r.id !== userId));
    }
  };

  const formatTime = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    } else if (diffDays < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  const formatFullDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const parseAttachments = (attachments) => {
    if (!attachments || attachments === '' || attachments === 'null') return [];
    try {
      const parsed = JSON.parse(attachments);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const filteredUsers = users.filter(u => 
    u.name?.toLowerCase().includes(recipientSearch.toLowerCase()) ||
    u.email?.toLowerCase().includes(recipientSearch.toLowerCase())
  );

  const filteredMessages = messages.filter(msg =>
    msg.sender_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    msg.body_preview?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    msg.subject?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const folders = [
    { id: 'inbox', name: 'Inbox', icon: InboxIcon, count: unreadCount },
    { id: 'drafts', name: 'Drafts', icon: DocumentIcon, count: 0 },
    { id: 'sent', name: 'Sent Items', icon: PaperAirplaneIcon, count: 0 },
    { id: 'deleted', name: 'Deleted Items', icon: TrashIcon, count: 0 },
    { id: 'archive', name: 'Archive', icon: ArchiveBoxIcon, count: 0 },
  ];

  if (authLoading) {
    return (
      <div className="min-h-screen bg-white">
        <Navbar />
        <div className="flex items-center justify-center h-[calc(100vh-64px)]">
          <ArrowPathIcon className="h-8 w-8 animate-spin text-[#64126D]" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <Navbar />
      {/* Outlook Header Bar - Fixed */}
      <div className="bg-[#64126D] h-12 flex items-center px-4 gap-4 flex-shrink-0">
        <button 
          onClick={() => setFolderPaneCollapsed(!folderPaneCollapsed)}
          className="text-white hover:bg-white/10 p-1.5 rounded"
        >
          <Bars3Icon className="h-5 w-5" />
        </button>
        
        <div className="flex-1 max-w-xl">
          <div className="relative">
            <MagnifyingGlassIcon className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/60" />
            <input
              type="text"
              placeholder="Search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 bg-white/10 text-white placeholder-white/60 rounded text-sm focus:outline-none focus:bg-white/20"
            />
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button className="text-white hover:bg-white/10 p-1.5 rounded">
            <Cog6ToothIcon className="h-5 w-5" />
          </button>
          <button className="text-white hover:bg-white/10 p-1.5 rounded">
            <BellIcon className="h-5 w-5" />
          </button>
          <div className="h-8 w-8 rounded-full bg-[#7F2387] flex items-center justify-center text-white text-sm font-medium">
            {getInitials(user?.name)}
          </div>
        </div>
      </div>

      {/* Main Content Area - Takes remaining height */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Folder Pane - Fixed */}
        {!folderPaneCollapsed && (
          <div className="w-56 border-r border-gray-200 bg-gray-50 flex-shrink-0 overflow-hidden">
            {/* New Mail Button */}
            <div className="p-3">
              <button
                onClick={startNewMessage}
                className="w-full flex items-center gap-2 px-4 py-2 bg-[#7F2387] text-white rounded hover:bg-[#64126D] transition-colors"
              >
                <PencilSquareIcon className="h-5 w-5" />
                <span className="font-medium">New mail</span>
              </button>
            </div>
            
            {/* Folders */}
            <nav>
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  onClick={() => setActiveFolder(folder.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-gray-100 ${
                    activeFolder === folder.id ? 'bg-white border-l-2 border-[#7F2387] font-medium' : ''
                  }`}
                >
                  <folder.icon className={`h-5 w-5 ${activeFolder === folder.id ? 'text-[#7F2387]' : 'text-gray-500'}`} />
                  <span className="flex-1 text-left text-gray-700">{folder.name}</span>
                  {folder.count > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-[#7F2387] text-white">
                      {folder.count}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>
        )}

        {/* Message List Column */}
        <div className={`${showCompose ? 'hidden md:flex' : 'flex'} flex-col border-r border-gray-200 ${folderPaneCollapsed ? 'w-80' : 'w-72'} flex-shrink-0 min-h-0 overflow-hidden`}>
          {/* Focused/Other Tabs - Fixed */}
          <div className="flex border-b border-gray-200 bg-white flex-shrink-0">
            <button
              onClick={() => setActiveTab('focused')}
              className={`flex-1 py-3 text-sm font-medium border-b-2 ${
                activeTab === 'focused' 
                  ? 'border-[#7F2387] text-[#7F2387]' 
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Focused
            </button>
            <button
              onClick={() => setActiveTab('other')}
              className={`flex-1 py-3 text-sm font-medium border-b-2 ${
                activeTab === 'other' 
                  ? 'border-[#7F2387] text-[#7F2387]' 
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Other
            </button>
          </div>
          
          {/* Message List Items - Scrollable */}
          <div className="flex-1 bg-white overflow-y-auto">
            {loading ? (
              <div className="flex justify-center items-center h-32">
                <ArrowPathIcon className="h-6 w-6 animate-spin text-[#7F2387]" />
              </div>
            ) : filteredMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 p-8">
                <InboxIcon className="h-12 w-12 mb-2" />
                <p className="text-sm">No messages</p>
              </div>
            ) : (
              filteredMessages.map((msg) => (
                <div
                  key={msg.id}
                  onClick={() => selectMessage(msg)}
                  className={`border-b border-gray-100 p-3 cursor-pointer hover:bg-gray-50 ${
                    selectedMessage?.id === msg.id ? 'bg-[#7F2387]/5 border-l-2 border-l-[#7F2387]' : ''
                  }`}
                >
                  <div className="flex gap-3">
                    {/* Unread Indicator */}
                    <div className="flex flex-col items-center pt-1 w-2">
                      {!msg.read_status && (
                        <div className="w-2 h-2 rounded-full bg-[#7F2387]" />
                      )}
                    </div>
                    
                    {/* Avatar */}
                    <div className="h-10 w-10 rounded-full bg-[#7F2387] flex items-center justify-center text-white text-sm font-medium flex-shrink-0">
                      {getInitials(msg.sender_name)}
                    </div>
                    
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`truncate ${!msg.read_status ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                          {msg.sender_name}
                        </span>
                        <span className="text-xs text-gray-500 flex-shrink-0">
                          {formatTime(msg.created_at)}
                        </span>
                      </div>
                      <div className={`text-sm truncate ${!msg.read_status ? 'font-medium text-gray-800' : 'text-gray-600'}`}>
                        {msg.subject || 'No Subject'}
                      </div>
                      <div className="text-xs text-gray-500 truncate mt-0.5">
                        {msg.body_preview}
                      </div>
                    </div>
                    
                    {/* Actions */}
                    <div className="flex flex-col items-center gap-1">
                      <button 
                        onClick={(e) => toggleFlag(e, msg.id)}
                        className="p-1 hover:bg-gray-100 rounded"
                      >
                        {flaggedMessages.has(msg.id) ? (
                          <FlagIconSolid className="h-4 w-4 text-red-500" />
                        ) : (
                          <FlagIcon className="h-4 w-4 text-gray-400" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Reading Pane / Compose */}
        <div className="flex-1 flex flex-col bg-white min-w-0 h-full overflow-hidden">
          {showCompose ? (
            /* Compose View */
            <div className="flex flex-col h-full">
              {/* Compose Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowCompose(false)}
                    className="md:hidden p-1 hover:bg-gray-100 rounded"
                  >
                    <ChevronLeftIcon className="h-5 w-5 text-gray-500" />
                  </button>
                  <h2 className="font-medium text-gray-900">New Message</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowCompose(false)}
                    className="p-2 hover:bg-gray-100 rounded text-gray-500"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>
              </div>
              
              {/* Compose Form */}
              <div className="flex-1 flex flex-col min-h-0">
                {/* From Field */}
                <div className="flex items-center border-b border-gray-100 px-4 py-2 flex-shrink-0">
                  <label className="w-16 text-sm text-gray-500">From:</label>
                  <div className="flex-1 flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-[#7F2387] flex items-center justify-center text-white text-xs">
                      {getInitials(user?.name)}
                    </div>
                    <span className="text-sm text-gray-700">{user?.email}</span>
                  </div>
                </div>
                
                {/* To Field */}
                <div className="flex items-start border-b border-gray-100 px-4 py-2 flex-shrink-0 relative">
                  <label className="w-16 text-sm text-gray-500 pt-1">To:</label>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-1">
                      {toRecipients.map(r => (
                        <span key={r.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#7F2387]/10 text-[#7F2387] rounded text-sm">
                          {r.name || r.full_name || r.username}
                          <button onClick={() => removeRecipient(r.id, 'to')} className="hover:text-[#64126D]">
                            <XMarkIcon className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                      <input
                        type="text"
                        value={activeField === 'to' ? recipientSearch : ''}
                        onChange={(e) => { setActiveField('to'); setRecipientSearch(e.target.value); }}
                        onFocus={() => setActiveField('to')}
                        placeholder={toRecipients.length === 0 ? "Add recipients" : ""}
                        className="flex-1 min-w-[100px] text-sm focus:outline-none py-1"
                      />
                    </div>
                    {activeField === 'to' && recipientSearch && filteredUsers.length > 0 && (
                      <div className="absolute left-16 right-4 z-10 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {filteredUsers.map(u => (
                          <button
                            key={u.id}
                            onClick={() => addRecipient(u, 'to')}
                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-left"
                          >
                            <div className="h-8 w-8 rounded-full bg-[#7F2387] flex items-center justify-center text-white text-xs">
                              {getInitials(u.name || u.full_name || u.username)}
                            </div>
                            <div>
                              <div className="text-sm font-medium text-gray-900">{u.name || u.full_name || u.username}</div>
                              <div className="text-xs text-gray-500">{u.email}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 text-sm text-[#7F2387]">
                    {!showCc && <button onClick={() => setShowCc(true)} className="hover:underline">Cc</button>}
                    {!showBcc && <button onClick={() => setShowBcc(true)} className="hover:underline">Bcc</button>}
                  </div>
                </div>
                
                {/* Cc Field */}
                {showCc && (
                  <div className="flex items-start border-b border-gray-100 px-4 py-2 flex-shrink-0 relative">
                    <label className="w-16 text-sm text-gray-500 pt-1">Cc:</label>
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-1">
                        {ccRecipients.map(r => (
                          <span key={r.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#7F2387]/10 text-[#7F2387] rounded text-sm">
                            {r.name || r.full_name || r.username}
                            <button onClick={() => removeRecipient(r.id, 'cc')} className="hover:text-[#64126D]">
                              <XMarkIcon className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                        <input
                          type="text"
                          value={activeField === 'cc' ? recipientSearch : ''}
                          onChange={(e) => { setActiveField('cc'); setRecipientSearch(e.target.value); }}
                          onFocus={() => setActiveField('cc')}
                          className="flex-1 min-w-[100px] text-sm focus:outline-none py-1"
                        />
                      </div>
                      {activeField === 'cc' && recipientSearch && filteredUsers.length > 0 && (
                        <div className="absolute left-16 right-4 z-10 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          {filteredUsers.map(u => (
                            <button
                              key={u.id}
                              onClick={() => addRecipient(u, 'cc')}
                              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-left"
                            >
                              <div className="h-8 w-8 rounded-full bg-[#7F2387] flex items-center justify-center text-white text-xs">
                                {getInitials(u.name || u.full_name || u.username)}
                              </div>
                              <div>
                                <div className="text-sm font-medium text-gray-900">{u.name || u.full_name || u.username}</div>
                                <div className="text-xs text-gray-500">{u.email}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                {/* Bcc Field */}
                {showBcc && (
                  <div className="flex items-start border-b border-gray-100 px-4 py-2 flex-shrink-0 relative">
                    <label className="w-16 text-sm text-gray-500 pt-1">Bcc:</label>
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-1">
                        {bccRecipients.map(r => (
                          <span key={r.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#7F2387]/10 text-[#7F2387] rounded text-sm">
                            {r.name || r.full_name || r.username}
                            <button onClick={() => removeRecipient(r.id, 'bcc')} className="hover:text-[#64126D]">
                              <XMarkIcon className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                        <input
                          type="text"
                          value={activeField === 'bcc' ? recipientSearch : ''}
                          onChange={(e) => { setActiveField('bcc'); setRecipientSearch(e.target.value); }}
                          onFocus={() => setActiveField('bcc')}
                          className="flex-1 min-w-[100px] text-sm focus:outline-none py-1"
                        />
                      </div>
                      {activeField === 'bcc' && recipientSearch && filteredUsers.length > 0 && (
                        <div className="absolute left-16 right-4 z-10 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          {filteredUsers.map(u => (
                            <button
                              key={u.id}
                              onClick={() => addRecipient(u, 'bcc')}
                              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-left"
                            >
                              <div className="h-8 w-8 rounded-full bg-[#7F2387] flex items-center justify-center text-white text-xs">
                                {getInitials(u.name || u.full_name || u.username)}
                              </div>
                              <div>
                                <div className="text-sm font-medium text-gray-900">{u.name || u.full_name || u.username}</div>
                                <div className="text-xs text-gray-500">{u.email}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                
                {/* Subject Field */}
                <div className="flex items-center border-b border-gray-100 px-4 py-2 flex-shrink-0">
                  <label className="w-16 text-sm text-gray-500">Subject:</label>
                  <input
                    type="text"
                    value={messageSubject}
                    onChange={(e) => setMessageSubject(e.target.value)}
                    placeholder="Add a subject"
                    className="flex-1 text-sm focus:outline-none"
                  />
                </div>
                
                {/* Message Body */}
                <div className="flex-1 p-4">
                  <textarea
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder="Write your message here..."
                    className="w-full h-full text-sm focus:outline-none resize-none"
                  />
                </div>
                
                {/* Attachments */}
                {attachments.length > 0 && (
                  <div className="px-4 pb-2 flex-shrink-0">
                    <div className="flex flex-wrap gap-2">
                      {attachments.map((att, idx) => (
                        <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded">
                          <DocumentIcon className="h-4 w-4 text-gray-500" />
                          <span className="text-sm text-gray-700">{att.name}</span>
                          <button onClick={() => removeAttachment(idx)} className="text-gray-400 hover:text-gray-600">
                            <XMarkIcon className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              
              {/* Compose Footer */}
              <div className="border-t border-gray-200 px-4 py-3 flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2">
                  <button
                    onClick={sendMessage}
                    disabled={sending || toRecipients.length === 0}
                    className="flex items-center gap-2 px-4 py-2 bg-[#7F2387] text-white rounded hover:bg-[#64126D] disabled:opacity-50"
                  >
                    <PaperAirplaneIcon className="h-4 w-4" />
                    <span>Send</span>
                  </button>
                  
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 hover:bg-gray-100 rounded text-gray-500"
                    title="Attach file"
                  >
                    <PaperClipIcon className="h-5 w-5" />
                  </button>
                </div>
                
                <button
                  onClick={() => setShowCompose(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
                >
                  Discard
                </button>
              </div>
            </div>
          ) : selectedMessage ? (
            /* Reading Pane - Single Message */
            <div className="flex flex-col h-full min-h-0">
              {/* Message Header */}
              <div className="border-b border-gray-200 p-4 flex-shrink-0">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2 md:hidden">
                    <button
                      onClick={() => setSelectedMessage(null)}
                      className="p-1 hover:bg-gray-100 rounded"
                    >
                      <ChevronLeftIcon className="h-5 w-5 text-gray-500" />
                    </button>
                  </div>
                  <div className="flex items-center gap-3 flex-1">
                    <div className="h-10 w-10 rounded-full bg-[#7F2387] flex items-center justify-center text-white font-medium">
                      {getInitials(selectedMessage.sender_name)}
                    </div>
                    <div>
                      <h2 className="font-medium text-gray-900">{selectedMessage.sender_name}</h2>
                      <p className="text-sm text-gray-500">{selectedMessage.sender_email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button className="p-2 hover:bg-gray-100 rounded text-gray-500">
                      <ArrowUturnLeftIcon className="h-5 w-5" />
                    </button>
                    <button className="p-2 hover:bg-gray-100 rounded text-gray-500">
                      <ArrowUturnRightIcon className="h-5 w-5" />
                    </button>
                    <button className="p-2 hover:bg-gray-100 rounded text-gray-500">
                      <TrashIcon className="h-5 w-5" />
                    </button>
                  </div>
                </div>
                <div className="mt-3">
                  <h3 className="text-lg font-medium text-gray-900">{selectedMessage.subject || 'No Subject'}</h3>
                  <p className="text-sm text-gray-500 mt-1">{formatFullDate(selectedMessage.created_at)}</p>
                </div>
              </div>
              
              {/* Message Content */}
              <div className="flex-1 p-4 overflow-y-auto min-h-0">
                <div className="text-gray-700 whitespace-pre-wrap">
                  {selectedMessage.body_preview || selectedMessage.body}
                </div>
                {parseAttachments(selectedMessage.attachments).length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {parseAttachments(selectedMessage.attachments).map((att, attIdx) => (
                      <a
                        key={attIdx}
                        href={att.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded hover:bg-gray-200"
                      >
                        <DocumentIcon className="h-4 w-4 text-gray-500" />
                        <span className="text-sm text-gray-700">{att.name}</span>
                        <ArrowDownTrayIcon className="h-4 w-4 text-gray-400" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
              
              {/* Reply Box */}
              <div className="border-t border-gray-200 px-2 py-1 flex-shrink-0">
                <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-2 py-1 bg-white">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-1 hover:bg-gray-100 rounded text-gray-500"
                    title="Attach file"
                  >
                    <PaperClipIcon className="h-4 w-4" />
                  </button>
                  <input
                    type="text"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder="Type your reply..."
                    className="flex-1 text-sm focus:outline-none"
                  />
                  <button
                    onClick={sendReply}
                    disabled={sending || !messageText.trim()}
                    className="flex items-center gap-1 px-3 py-1 bg-[#7F2387] text-white rounded hover:bg-[#64126D] disabled:opacity-50 text-sm"
                  >
                    <PaperAirplaneIcon className="h-4 w-4" />
                    <span>Send</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Empty State */
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <EnvelopeIcon className="h-16 w-16 mb-4" />
              <p className="text-lg font-medium text-gray-500">Select a message to read</p>
              <p className="text-sm">Or start a new conversation</p>
              <button
                onClick={startNewMessage}
                className="mt-4 flex items-center gap-2 px-4 py-2 bg-[#7F2387] text-white rounded hover:bg-[#64126D]"
              >
                <PencilSquareIcon className="h-5 w-5" />
                <span>New Message</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
