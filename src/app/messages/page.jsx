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
  PencilSquareIcon,
  UserGroupIcon,
  ChatBubbleLeftRightIcon,
  EllipsisHorizontalIcon,
  InboxIcon,
  EnvelopeIcon,
  StarIcon,
  ArchiveBoxIcon,
  BellSlashIcon,
  BellIcon,
  LinkIcon,
  PhoneIcon,
  VideoCameraIcon,
  InformationCircleIcon,
  ListBulletIcon,
  CodeBracketIcon,
  PhotoIcon,
  TableCellsIcon,
  FaceSmileIcon,
  ChevronDownIcon
} from '@heroicons/react/24/outline';
import { 
  FlagIcon as FlagIconSolid, 
  ChatBubbleLeftRightIcon as ChatBubbleLeftRightIconSolid,
  InboxIcon as InboxIconSolid,
  EnvelopeIcon as EnvelopeIconSolid,
  StarIcon as StarIconSolid,
  ArchiveBoxIcon as ArchiveBoxIconSolid
} from '@heroicons/react/24/solid';

export default function MessagesPage() {
  const { user, loading: authLoading } = useSessionRBAC();
  
  // Conversations state (left pane)
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [conversationFilter, setConversationFilter] = useState('all'); // all, unread, flagged, archived
  const [conversationSearch, setConversationSearch] = useState('');
  
  // Messages state (center pane)
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState(null);
  
  // Users for compose
  const [users, setUsers] = useState([]);
  
  // Compose state
  const [showCompose, setShowCompose] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [messageSubject, setMessageSubject] = useState('');
  const [sending, setSending] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [toRecipients, setToRecipients] = useState([]);
  
  // UI state
  const [leftPaneCollapsed, setLeftPaneCollapsed] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [flaggedConversations, setFlaggedConversations] = useState(new Set());
  
  // Rich text editor state
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
  });
  const [selectedFont, setSelectedFont] = useState('Calibri');
  const [selectedFontSize, setSelectedFontSize] = useState('11');
  const [showFontDropdown, setShowFontDropdown] = useState(false);
  const [showFontSizeDropdown, setShowFontSizeDropdown] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [currentTextColor, setCurrentTextColor] = useState('#000000');
  const [currentHighlightColor, setCurrentHighlightColor] = useState('#ffff00');
  
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const replyInputRef = useRef(null);
  const composeEditorRef = useRef(null);
  const replyEditorRef = useRef(null);

  // Font options
  const fontOptions = ['Arial', 'Calibri', 'Georgia', 'Helvetica', 'Times New Roman', 'Verdana', 'Courier New'];
  const fontSizeOptions = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '36'];
  const colorOptions = ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff', '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff'];

  // Rich text formatting functions
  const execCommand = (command, value = null) => {
    document.execCommand(command, false, value);
    updateActiveFormats();
  };

  const updateActiveFormats = () => {
    setActiveFormats({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
    });
  };

  const handleFormat = (format) => {
    execCommand(format);
  };

  const handleFontChange = (font) => {
    execCommand('fontName', font);
    setSelectedFont(font);
    setShowFontDropdown(false);
  };

  const handleFontSizeChange = (size) => {
    // Convert to HTML font size (1-7)
    const htmlSize = Math.min(7, Math.max(1, Math.floor(parseInt(size) / 4)));
    execCommand('fontSize', htmlSize);
    setSelectedFontSize(size);
    setShowFontSizeDropdown(false);
  };

  const handleTextColor = (color) => {
    execCommand('foreColor', color);
    setCurrentTextColor(color);
    setShowColorPicker(false);
  };

  const handleHighlightColor = (color) => {
    execCommand('hiliteColor', color);
    setCurrentHighlightColor(color);
    setShowHighlightPicker(false);
  };

  const handleInsertLink = () => {
    const url = prompt('Enter URL:');
    if (url) {
      execCommand('createLink', url);
    }
  };

  const handleInsertList = (type) => {
    execCommand(type === 'bullet' ? 'insertUnorderedList' : 'insertOrderedList');
  };

  const getEditorContent = (editorRef) => {
    if (editorRef?.current) {
      return editorRef.current.innerHTML;
    }
    return messageText;
  };

  const getEditorText = (editorRef) => {
    if (editorRef?.current) {
      return editorRef.current.innerText || editorRef.current.textContent;
    }
    return messageText;
  };

  const clearEditor = (editorRef) => {
    if (editorRef?.current) {
      editorRef.current.innerHTML = '';
    }
    setMessageText('');
  };

  // Handle keyboard shortcuts for formatting
  const handleEditorKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 'b':
          e.preventDefault();
          handleFormat('bold');
          break;
        case 'i':
          e.preventDefault();
          handleFormat('italic');
          break;
        case 'u':
          e.preventDefault();
          handleFormat('underline');
          break;
        case 'k':
          e.preventDefault();
          handleInsertLink();
          break;
        default:
          break;
      }
    }
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest('[data-dropdown]')) {
        setShowFontDropdown(false);
        setShowFontSizeDropdown(false);
        setShowColorPicker(false);
        setShowHighlightPicker(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Fetch conversations list
  const fetchConversations = useCallback(async () => {
    if (!user?.id) return;
    
    try {
      setConversationsLoading(true);
      
      // Fetch all messages and group by conversation
      const [inboxRes, sentRes] = await Promise.all([
        fetchJSON('/api/messages?type=inbox&limit=500'),
        fetchJSON('/api/messages?type=sent&limit=500')
      ]);
      
      const allMessages = [];
      if (inboxRes.success) {
        allMessages.push(...(inboxRes.data?.messages || []));
      }
      if (sentRes.success) {
        allMessages.push(...(sentRes.data?.messages || []));
      }
      
      // Remove duplicates and group by conversation_id
      const uniqueMessages = Array.from(new Map(allMessages.map(m => [m.id, m])).values());
      const conversationMap = new Map();
      
      uniqueMessages.forEach(msg => {
        const convId = msg.conversation_id || `legacy_${Math.min(msg.sender_id, msg.receiver_id || 0)}_${Math.max(msg.sender_id, msg.receiver_id || 0)}`;
        
        if (!conversationMap.has(convId)) {
          conversationMap.set(convId, {
            id: convId,
            conversation_id: msg.conversation_id,
            messages: [],
            participants: new Set(),
            participantNames: new Map(),
            lastMessage: null,
            unreadCount: 0,
            type: 'direct' // Could be 'group' or 'project' in future
          });
        }
        
        const conv = conversationMap.get(convId);
        conv.messages.push(msg);
        
        // Track participants
        if (msg.sender_id) {
          conv.participants.add(msg.sender_id);
          if (msg.sender_name) conv.participantNames.set(msg.sender_id, msg.sender_name);
        }
        if (msg.receiver_id) {
          conv.participants.add(msg.receiver_id);
          if (msg.receiver_name) conv.participantNames.set(msg.receiver_id, msg.receiver_name);
        }
        
        // Track unread (messages TO current user that are unread)
        if (msg.sender_id !== user.id && !msg.read_status) {
          conv.unreadCount++;
        }
      });
      
      // Process conversations
      const convList = Array.from(conversationMap.values()).map(conv => {
        // Sort messages by date
        conv.messages.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        conv.lastMessage = conv.messages[0];
        
        // Get other participant name for display
        const otherParticipants = Array.from(conv.participants).filter(id => id !== user.id);
        conv.displayName = otherParticipants.length > 0 
          ? otherParticipants.map(id => conv.participantNames.get(id) || 'Unknown').join(', ')
          : conv.participantNames.get(user.id) || 'Me';
        
        conv.participantCount = conv.participants.size;
        
        return conv;
      });
      
      // Sort by last message date
      convList.sort((a, b) => new Date(b.lastMessage?.created_at || 0) - new Date(a.lastMessage?.created_at || 0));
      
      setConversations(convList);
      
      // Calculate total unread
      const totalUnread = convList.reduce((sum, c) => sum + c.unreadCount, 0);
      setUnreadCount(totalUnread);
      
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
    } finally {
      setConversationsLoading(false);
    }
  }, [user?.id]);

  // Fetch messages for selected conversation
  const fetchConversationMessages = useCallback(async (conversation) => {
    if (!conversation?.conversation_id) {
      // Use cached messages for legacy conversations
      const msgs = [...(conversation?.messages || [])];
      msgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      setMessages(msgs);
      return;
    }
    
    try {
      setMessagesLoading(true);
      const res = await fetchJSON(`/api/messages/conversation/${conversation.conversation_id}?limit=100`);
      
      if (res.success) {
        const msgs = res.data?.messages || [];
        // Sort oldest first for chat display
        msgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        setMessages(msgs);
      } else {
        // Fallback to cached messages
        const msgs = [...(conversation.messages || [])];
        msgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        setMessages(msgs);
      }
    } catch (error) {
      console.error('Failed to fetch conversation messages:', error);
      const msgs = [...(conversation?.messages || [])];
      msgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      setMessages(msgs);
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  // Fetch users for compose
  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetchJSON('/api/users');
      if (res.success && res.data) {
        const userList = Array.isArray(res.data) ? res.data : (res.data.users || []);
        setUsers(userList.filter(u => u.id !== user?.id));
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    }
  }, [user?.id]);

  useEffect(() => {
    if (user?.id) {
      fetchConversations();
      fetchUsers();
    }
  }, [user?.id, fetchConversations, fetchUsers]);

  // Load messages when conversation is selected
  useEffect(() => {
    if (selectedConversation) {
      fetchConversationMessages(selectedConversation);
    }
  }, [selectedConversation, fetchConversationMessages]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const selectConversation = (conv) => {
    setSelectedConversation(conv);
    setSelectedMessage(null);
    setShowCompose(false);
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
            url: result.data.filePath,
            file_name: result.data.fileName,
            original_name: file.name,
            file_path: result.data.filePath,
            file_type: file.type,
            file_size: file.size
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

  // Send new message (compose)
  const sendMessage = async () => {
    const content = getEditorContent(composeEditorRef);
    const textContent = getEditorText(composeEditorRef);
    
    if ((!textContent.trim() && attachments.length === 0) || toRecipients.length === 0) return;
    
    setSending(true);
    try {
      for (const recipient of toRecipients) {
        await fetchJSON('/api/messages', {
          method: 'POST',
          body: JSON.stringify({
            receiver_id: recipient.id,
            body: content,
            subject: messageSubject || 'No Subject',
            attachments: attachments.length > 0 ? attachments : []
          })
        });
      }

      clearEditor(composeEditorRef);
      setMessageSubject('');
      setAttachments([]);
      setToRecipients([]);
      setShowCompose(false);
      fetchConversations();
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setSending(false);
    }
  };

  // Send reply in conversation
  const sendReply = async () => {
    const content = getEditorContent(replyEditorRef);
    const textContent = getEditorText(replyEditorRef);
    
    if (!textContent.trim() || !selectedConversation) return;
    
    setSending(true);
    try {
      // For direct conversations, find the other participant
      const otherParticipants = Array.from(selectedConversation.participants).filter(id => id !== user.id);
      const receiverId = otherParticipants[0];
      
      if (!receiverId && !selectedConversation.conversation_id) {
        console.error('No recipient found');
        return;
      }

      const payload = {
        body: content,
        subject: selectedConversation.lastMessage?.subject || 'Re: Conversation',
        attachments: attachments.length > 0 ? attachments : []
      };

      // If we have a conversation_id, use it; otherwise use receiver_id
      if (selectedConversation.conversation_id) {
        payload.conversation_id = selectedConversation.conversation_id;
      } else {
        payload.receiver_id = receiverId;
      }

      await fetchJSON('/api/messages', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      clearEditor(replyEditorRef);
      setAttachments([]);
      fetchConversationMessages(selectedConversation);
      fetchConversations();
    } catch (error) {
      console.error('Failed to send reply:', error);
    } finally {
      setSending(false);
    }
  };

  const startNewMessage = () => {
    setShowCompose(true);
    setSelectedConversation(null);
    setSelectedMessage(null);
    setMessageText('');
    setMessageSubject('');
    setAttachments([]);
    setToRecipients([]);
    setRecipientSearch('');
    // Clear compose editor after a tick
    setTimeout(() => {
      if (composeEditorRef.current) {
        composeEditorRef.current.innerHTML = '';
      }
    }, 0);
  };

  const addRecipient = (userToAdd) => {
    if (!toRecipients.find(r => r.id === userToAdd.id)) {
      setToRecipients([...toRecipients, userToAdd]);
    }
    setRecipientSearch('');
  };

  const removeRecipient = (userId) => {
    setToRecipients(toRecipients.filter(r => r.id !== userId));
  };

  const toggleFlag = (e, convId) => {
    e.stopPropagation();
    setFlaggedConversations(prev => {
      const newSet = new Set(prev);
      if (newSet.has(convId)) {
        newSet.delete(convId);
      } else {
        newSet.add(convId);
      }
      return newSet;
    });
  };

  const formatTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    if (messageDate.getTime() === today.getTime()) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    } else if (messageDate.getTime() === yesterday.getTime()) {
      return 'Yesterday';
    } else if (now - date < 7 * 24 * 60 * 60 * 1000) {
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  // WhatsApp-style last message preview with sender prefix
  const getLastMessagePreview = (conv) => {
    const msg = conv.lastMessage;
    if (!msg) return 'No messages yet';
    
    const isSentByMe = msg.sender_id === user?.id;
    const body = msg.body_preview || msg.body?.substring(0, 60) || '';
    
    // For group conversations, show sender name prefix
    if (conv.participantCount > 2 && !isSentByMe) {
      const senderFirstName = msg.sender_name?.split(' ')[0] || 'Unknown';
      return `${senderFirstName}: ${body}`;
    }
    
    // For direct messages sent by me, show "You: " prefix
    if (isSentByMe) {
      return `You: ${body}`;
    }
    
    return body;
  };

  const formatFullDate = (dateString) => {
    if (!dateString) return '';
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

  const formatMessageTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const getInitials = (name) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const getAvatarColor = (name) => {
    const colors = ['#7F2387', '#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed'];
    const index = name ? name.charCodeAt(0) % colors.length : 0;
    return colors[index];
  };

  const filteredUsers = users.filter(u => 
    (u.name?.toLowerCase().includes(recipientSearch.toLowerCase()) ||
    u.full_name?.toLowerCase().includes(recipientSearch.toLowerCase()) ||
    u.email?.toLowerCase().includes(recipientSearch.toLowerCase())) &&
    !toRecipients.find(r => r.id === u.id)
  );

  const filteredConversations = conversations.filter(conv => {
    // Search filter
    if (conversationSearch) {
      const searchLower = conversationSearch.toLowerCase();
      const matchesName = conv.displayName?.toLowerCase().includes(searchLower);
      const matchesSubject = conv.lastMessage?.subject?.toLowerCase().includes(searchLower);
      const matchesBody = conv.lastMessage?.body_preview?.toLowerCase().includes(searchLower);
      if (!matchesName && !matchesSubject && !matchesBody) return false;
    }
    
    // Category filters (Outlook-style folders acting as chat filters)
    switch (conversationFilter) {
      case 'unread':
        if (conv.unreadCount === 0) return false;
        break;
      case 'flagged':
        if (!flaggedConversations.has(conv.id)) return false;
        break;
      case 'archived':
        // For now, archived is empty until we implement archive functionality
        return false;
      case 'all':
      default:
        // Show all non-archived conversations
        break;
    }
    
    return true;
  });

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
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <Navbar />
      
      {/* Main Content - Three Pane Layout */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        
        {/* LEFT PANE - Conversations (WhatsApp-style) */}
        {!leftPaneCollapsed && (
          <div className="w-[360px] bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
            {/* Header */}
            <div className="px-4 py-3 bg-[#7F2387] flex items-center justify-between">
              <h1 className="text-lg font-semibold text-white">Chats</h1>
              <div className="flex items-center gap-2">
                <button
                  onClick={startNewMessage}
                  className="p-2 hover:bg-white/10 rounded-full text-white transition-colors"
                  title="New message"
                >
                  <PencilSquareIcon className="h-5 w-5" />
                </button>
                <button className="p-2 hover:bg-white/10 rounded-full text-white transition-colors">
                  <EllipsisHorizontalIcon className="h-5 w-5" />
                </button>
              </div>
            </div>
            
            {/* Search Bar */}
            <div className="px-3 py-2 bg-gray-50">
              <div className="relative">
                <MagnifyingGlassIcon className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search or start new chat"
                  value={conversationSearch}
                  onChange={(e) => setConversationSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-white border-0 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#7F2387]/30 placeholder-gray-400"
                />
              </div>
            </div>
            
            {/* Horizontal Icon-Only Filters */}
            <div className="px-3 py-2 border-b border-gray-100">
              <div className="flex items-center justify-around bg-gray-100 rounded-lg p-1">
                {[
                  { id: 'all', label: 'All Chats', icon: InboxIcon, iconSolid: InboxIconSolid, count: conversations.length },
                  { id: 'unread', label: 'Unread', icon: EnvelopeIcon, iconSolid: EnvelopeIconSolid, count: unreadCount },
                  { id: 'flagged', label: 'Starred', icon: StarIcon, iconSolid: StarIconSolid, count: flaggedConversations.size },
                  { id: 'archived', label: 'Archived', icon: ArchiveBoxIcon, iconSolid: ArchiveBoxIconSolid, count: 0 }
                ].map(folder => {
                  const isActive = conversationFilter === folder.id;
                  const Icon = isActive ? folder.iconSolid : folder.icon;
                  
                  return (
                    <button
                      key={folder.id}
                      onClick={() => setConversationFilter(folder.id)}
                      className={`relative flex-1 flex items-center justify-center p-2.5 rounded-md transition-all ${
                        isActive 
                          ? 'bg-white text-[#7F2387] shadow-sm' 
                          : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                      }`}
                      title={folder.label}
                    >
                      <Icon className="h-5 w-5" />
                      {/* Badge */}
                      {folder.count > 0 && (
                        <span className={`absolute -top-1 -right-0.5 min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full flex items-center justify-center ${
                          isActive 
                            ? 'bg-[#7F2387] text-white' 
                            : folder.id === 'unread' 
                              ? 'bg-[#7F2387] text-white'
                              : 'bg-gray-300 text-gray-700'
                        }`}>
                          {folder.count > 99 ? '99+' : folder.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            
            {/* Conversations List */}
            <div className="flex-1 overflow-y-auto">
              {conversationsLoading ? (
                <div className="flex flex-col items-center justify-center h-40 gap-2">
                  <ArrowPathIcon className="h-6 w-6 animate-spin text-[#7F2387]" />
                  <p className="text-xs text-gray-400">Loading chats...</p>
                </div>
              ) : filteredConversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-48 text-gray-400 p-6">
                  <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                    {conversationFilter === 'unread' ? (
                      <EnvelopeIcon className="h-8 w-8 text-gray-300" />
                    ) : conversationFilter === 'flagged' ? (
                      <StarIcon className="h-8 w-8 text-gray-300" />
                    ) : conversationFilter === 'archived' ? (
                      <ArchiveBoxIcon className="h-8 w-8 text-gray-300" />
                    ) : (
                      <ChatBubbleLeftRightIcon className="h-8 w-8 text-gray-300" />
                    )}
                  </div>
                  <p className="text-sm font-medium text-gray-500">
                    {conversationFilter === 'unread' ? 'All caught up!' : 
                     conversationFilter === 'flagged' ? 'No starred chats' : 
                     conversationFilter === 'archived' ? 'No archived chats' :
                     'No conversations'}
                  </p>
                  <p className="text-xs text-gray-400 mt-1 text-center">
                    {conversationFilter === 'unread' ? 'No unread messages' :
                     conversationFilter === 'flagged' ? 'Star important chats to find them here' :
                     conversationFilter === 'archived' ? 'Archived chats will appear here' :
                     'Start a new chat to begin messaging'}
                  </p>
                </div>
              ) : (
                <div>
                  {filteredConversations.map((conv, index) => {
                    const isSentByMe = conv.lastMessage?.sender_id === user?.id;
                    const hasUnread = conv.unreadCount > 0;
                    const isSelected = selectedConversation?.id === conv.id;
                    const isStarred = flaggedConversations.has(conv.id);
                    
                    return (
                      <div
                        key={conv.id}
                        onClick={() => selectConversation(conv)}
                        className={`group relative flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-all duration-150 ${
                          isSelected 
                            ? 'bg-[#7F2387]/8' 
                            : 'hover:bg-gray-50/80'
                        }`}
                      >
                        {/* Unread accent bar */}
                        {hasUnread && (
                          <div className="absolute left-0 top-2 bottom-2 w-[3px] bg-[#7F2387] rounded-r-full" />
                        )}
                        
                        {/* Selected indicator */}
                        {isSelected && !hasUnread && (
                          <div className="absolute left-0 top-2 bottom-2 w-[3px] bg-[#7F2387]/40 rounded-r-full" />
                        )}
                        
                        {/* Avatar - slightly smaller for compact look */}
                        <div className="relative flex-shrink-0">
                          <div 
                            className="h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-medium"
                            style={{ backgroundColor: getAvatarColor(conv.displayName) }}
                          >
                            {conv.participantCount > 2 ? (
                              <UserGroupIcon className="h-5 w-5" />
                            ) : (
                              getInitials(conv.displayName)
                            )}
                          </div>
                          {/* Online indicator */}
                          {conv.participantCount <= 2 && (
                            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
                          )}
                        </div>
                        
                        {/* Content */}
                        <div className="flex-1 min-w-0 py-0.5">
                          {/* Top row: Name + Time */}
                          <div className="flex items-baseline justify-between gap-2">
                            <h3 className={`truncate text-[14px] leading-tight ${
                              hasUnread 
                                ? 'font-semibold text-gray-900' 
                                : 'font-medium text-gray-700'
                            }`}>
                              {conv.displayName}
                            </h3>
                            <span className={`text-[11px] flex-shrink-0 tabular-nums ${
                              hasUnread ? 'text-[#7F2387] font-medium' : 'text-gray-400'
                            }`}>
                              {formatTime(conv.lastMessage?.created_at)}
                            </span>
                          </div>
                          
                          {/* Bottom row: Preview + indicators */}
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {/* Read receipt for sent messages */}
                            {isSentByMe && (
                              <svg className={`w-3.5 h-3.5 flex-shrink-0 ${
                                conv.lastMessage?.read_status ? 'text-blue-500' : 'text-gray-300'
                              }`} viewBox="0 0 16 16" fill="currentColor">
                                <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L8.666 9.88a.32.32 0 0 1-.484.032l-.358-.325a.32.32 0 0 0-.484.032l-.378.48a.418.418 0 0 0 .036.54l1.32 1.266a.32.32 0 0 0 .484-.034l6.272-8.048a.366.366 0 0 0-.064-.512zm-4.1 0l-.478-.372a.365.365 0 0 0-.51.063L4.566 9.88a.32.32 0 0 1-.484.032L1.892 7.77a.366.366 0 0 0-.516.005l-.423.433a.364.364 0 0 0 .006.514l3.255 3.185a.32.32 0 0 0 .484-.033l6.272-8.048a.365.365 0 0 0-.063-.51z"/>
                              </svg>
                            )}
                            
                            {/* Message preview */}
                            <p className={`flex-1 truncate text-[13px] leading-tight ${
                              hasUnread 
                                ? 'text-gray-600 font-medium' 
                                : 'text-gray-400'
                            }`}>
                              {getLastMessagePreview(conv)}
                            </p>
                            
                            {/* Star indicator (subtle, no badge) */}
                            {isStarred && (
                              <StarIconSolid className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Toggle Button for Left Pane */}
        <button
          onClick={() => setLeftPaneCollapsed(!leftPaneCollapsed)}
          className={`absolute top-1/2 -translate-y-1/2 z-10 bg-white border border-gray-200 rounded-r-lg p-1 shadow-sm hover:bg-gray-50 transition-all ${
            leftPaneCollapsed ? 'left-0' : 'left-[359px]'
          }`}
        >
          <ChevronLeftIcon className={`h-4 w-4 text-gray-500 transition-transform ${leftPaneCollapsed ? 'rotate-180' : ''}`} />
        </button>

        {/* CENTER/MAIN PANE - Message List / Compose */}
        <div className="flex-1 flex flex-col bg-white min-w-0 overflow-hidden">
          {showCompose ? (
            /* Compose View */
            <div className="flex flex-col h-full">
              {/* Compose Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
                <h2 className="text-lg font-semibold text-gray-900">New Message</h2>
                <button
                  onClick={() => setShowCompose(false)}
                  className="p-2 hover:bg-gray-200 rounded-lg text-gray-500"
                >
                  <XMarkIcon className="h-5 w-5" />
                </button>
              </div>
              
              {/* Compose Form */}
              <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
                {/* To Field */}
                <div className="flex items-start border-b border-gray-100 px-6 py-3 relative">
                  <label className="w-16 text-sm text-gray-500 pt-2">To:</label>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2 min-h-[36px]">
                      {toRecipients.map(r => (
                        <span key={r.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#7F2387]/10 text-[#7F2387] rounded-full text-sm">
                          {r.name || r.full_name || r.username}
                          <button onClick={() => removeRecipient(r.id)} className="hover:text-[#64126D]">
                            <XMarkIcon className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ))}
                      <input
                        type="text"
                        value={recipientSearch}
                        onChange={(e) => setRecipientSearch(e.target.value)}
                        placeholder={toRecipients.length === 0 ? "Search people..." : ""}
                        className="flex-1 min-w-[150px] text-sm focus:outline-none py-1.5"
                      />
                    </div>
                    {recipientSearch && filteredUsers.length > 0 && (
                      <div className="absolute left-16 right-6 z-20 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {filteredUsers.slice(0, 8).map(u => (
                          <button
                            key={u.id}
                            onClick={() => addRecipient(u)}
                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-left"
                          >
                            <div 
                              className="h-9 w-9 rounded-full flex items-center justify-center text-white text-sm"
                              style={{ backgroundColor: getAvatarColor(u.name || u.full_name) }}
                            >
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
                
                {/* Subject Field */}
                <div className="flex items-center border-b border-gray-100 px-6 py-3">
                  <label className="w-16 text-sm text-gray-500">Subject:</label>
                  <input
                    type="text"
                    value={messageSubject}
                    onChange={(e) => setMessageSubject(e.target.value)}
                    placeholder="Add a subject"
                    className="flex-1 text-sm focus:outline-none py-1"
                  />
                </div>
                
                {/* Formatting Toolbar - Outlook Style */}
                <div className="flex items-center gap-0.5 px-4 py-2 border-b border-gray-100 bg-gray-50 overflow-x-auto flex-nowrap">
                  {/* Font Family */}
                  <div className="relative" data-dropdown>
                    <button 
                      onClick={() => setShowFontDropdown(!showFontDropdown)}
                      className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-200 rounded transition-colors whitespace-nowrap"
                      title="Font"
                    >
                      <span className="font-medium">{selectedFont}</span>
                      <ChevronDownIcon className="h-3 w-3" />
                    </button>
                    {showFontDropdown && (
                      <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1 min-w-[140px]">
                        {fontOptions.map(font => (
                          <button
                            key={font}
                            onClick={() => handleFontChange(font)}
                            className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100"
                            style={{ fontFamily: font }}
                          >
                            {font}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  {/* Font Size */}
                  <div className="relative" data-dropdown>
                    <button 
                      onClick={() => setShowFontSizeDropdown(!showFontSizeDropdown)}
                      className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-200 rounded transition-colors"
                      title="Font Size"
                    >
                      <span>{selectedFontSize}</span>
                      <ChevronDownIcon className="h-3 w-3" />
                    </button>
                    {showFontSizeDropdown && (
                      <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1 max-h-48 overflow-y-auto">
                        {fontSizeOptions.map(size => (
                          <button
                            key={size}
                            onClick={() => handleFontSizeChange(size)}
                            className="w-full px-3 py-1 text-left text-sm hover:bg-gray-100"
                          >
                            {size}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  <div className="w-px h-5 bg-gray-300 mx-1 flex-shrink-0" />
                  
                  {/* Bold */}
                  <button 
                    onClick={() => handleFormat('bold')}
                    className={`p-1.5 rounded transition-colors flex-shrink-0 ${activeFormats.bold ? 'bg-gray-300 text-gray-800' : 'text-gray-600 hover:bg-gray-200'}`}
                    title="Bold (Ctrl+B)"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6V4zm0 8h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6v-8zm3 7h5a2 2 0 0 0 0-4H9v4zm0-7h4a2 2 0 0 0 0-4H9v4z"/>
                    </svg>
                  </button>
                  
                  {/* Italic */}
                  <button 
                    onClick={() => handleFormat('italic')}
                    className={`p-1.5 rounded transition-colors flex-shrink-0 ${activeFormats.italic ? 'bg-gray-300 text-gray-800' : 'text-gray-600 hover:bg-gray-200'}`}
                    title="Italic (Ctrl+I)"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4h-8z"/>
                    </svg>
                  </button>
                  
                  {/* Underline */}
                  <button 
                    onClick={() => handleFormat('underline')}
                    className={`p-1.5 rounded transition-colors flex-shrink-0 ${activeFormats.underline ? 'bg-gray-300 text-gray-800' : 'text-gray-600 hover:bg-gray-200'}`}
                    title="Underline (Ctrl+U)"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3h-2v7a4 4 0 0 1-4 4 4 4 0 0 1-4-4V3H6zM4 20h16v2H4v-2z"/>
                    </svg>
                  </button>
                  
                  <div className="w-px h-5 bg-gray-300 mx-1 flex-shrink-0" />
                  
                  {/* Text Color */}
                  <div className="relative" data-dropdown>
                    <button 
                      onClick={() => setShowColorPicker(!showColorPicker)}
                      className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition-colors relative flex-shrink-0"
                      title="Font Color"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M11 2L5.5 16h2.25l1.12-3h6.25l1.12 3h2.25L13 2h-2zm-1.38 9L12 4.67 14.38 11H9.62z"/>
                      </svg>
                      <div className="absolute bottom-0 left-1 right-1 h-1 rounded-full" style={{ backgroundColor: currentTextColor }} />
                    </button>
                    {showColorPicker && (
                      <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-2 grid grid-cols-5 gap-1">
                        {colorOptions.map(color => (
                          <button
                            key={color}
                            onClick={() => handleTextColor(color)}
                            className="w-6 h-6 rounded border border-gray-300 hover:scale-110 transition-transform"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  
                  {/* Highlight Color */}
                  <div className="relative" data-dropdown>
                    <button 
                      onClick={() => setShowHighlightPicker(!showHighlightPicker)}
                      className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition-colors relative flex-shrink-0"
                      title="Highlight Color"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M15.24 2.86l3.89 3.89-1.41 1.41-3.89-3.89 1.41-1.41zM3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM5.92 19H5v-.92l9.06-9.06.92.92L5.92 19z"/>
                      </svg>
                      <div className="absolute bottom-0 left-1 right-1 h-1 rounded-full" style={{ backgroundColor: currentHighlightColor }} />
                    </button>
                    {showHighlightPicker && (
                      <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-2 grid grid-cols-5 gap-1">
                        {colorOptions.map(color => (
                          <button
                            key={color}
                            onClick={() => handleHighlightColor(color)}
                            className="w-6 h-6 rounded border border-gray-300 hover:scale-110 transition-transform"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  
                  <div className="w-px h-5 bg-gray-300 mx-1 flex-shrink-0" />
                  
                  {/* Bullet List */}
                  <button 
                    onClick={() => handleInsertList('bullet')}
                    className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition-colors flex-shrink-0"
                    title="Bullet List"
                  >
                    <ListBulletIcon className="h-4 w-4" />
                  </button>
                  
                  {/* Numbered List */}
                  <button 
                    onClick={() => handleInsertList('numbered')}
                    className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition-colors flex-shrink-0"
                    title="Numbered List"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z"/>
                    </svg>
                  </button>
                  
                  <div className="w-px h-5 bg-gray-300 mx-1 flex-shrink-0" />
                  
                  {/* Link */}
                  <button 
                    onClick={handleInsertLink}
                    className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition-colors flex-shrink-0"
                    title="Insert Link (Ctrl+K)"
                  >
                    <LinkIcon className="h-4 w-4" />
                  </button>
                  
                  {/* Code */}
                  <button 
                    onClick={() => execCommand('formatBlock', 'pre')}
                    className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition-colors flex-shrink-0"
                    title="Code Block"
                  >
                    <CodeBracketIcon className="h-4 w-4" />
                  </button>
                  
                  {/* Insert Table */}
                  <button className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition-colors flex-shrink-0" title="Insert Table">
                    <TableCellsIcon className="h-4 w-4" />
                  </button>
                  
                  {/* Insert Image */}
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition-colors flex-shrink-0"
                    title="Insert Picture"
                  >
                    <PhotoIcon className="h-4 w-4" />
                  </button>
                  
                  {/* Emoji */}
                  <button className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition-colors flex-shrink-0" title="Insert Emoji">
                    <FaceSmileIcon className="h-4 w-4" />
                  </button>
                </div>
                
                {/* Message Body - Rich Text Editor */}
                <div className="px-4 py-3">
                  <div
                    ref={composeEditorRef}
                    contentEditable
                    onInput={updateActiveFormats}
                    onMouseUp={updateActiveFormats}
                    onKeyUp={updateActiveFormats}
                    onKeyDown={handleEditorKeyDown}
                    className="w-full text-[15px] leading-relaxed text-gray-700 focus:outline-none min-h-[120px] max-h-[300px] overflow-y-auto border border-gray-200 rounded-lg p-4"
                    style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
                    data-placeholder="Write your message..."
                    suppressContentEditableWarning={true}
                  />
                </div>
                
                {/* Attachments */}
                {attachments.length > 0 && (
                  <div className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {attachments.map((att, idx) => (
                        <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg">
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
              
              {/* Compose Footer - Always visible */}
              <div className="border-t border-gray-200 px-4 py-3 flex items-center justify-between bg-gray-50 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <button
                    onClick={sendMessage}
                    disabled={sending || toRecipients.length === 0 || (!getEditorText(composeEditorRef).trim() && attachments.length === 0)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-[#7F2387] text-white rounded-lg hover:bg-[#64126D] disabled:opacity-50 font-medium"
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
                    className="p-2.5 hover:bg-gray-200 rounded-lg text-gray-500"
                    title="Attach file"
                  >
                    <PaperClipIcon className="h-5 w-5" />
                  </button>
                </div>
                
                <button
                  onClick={() => setShowCompose(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded-lg"
                >
                  Discard
                </button>
              </div>
            </div>
          ) : selectedConversation ? (
            /* Conversation View - Outlook 3-pane style */
            <div className="flex h-full">
              {/* MIDDLE PANE - Message List (Outlook-style) */}
              <div className="w-[340px] flex-shrink-0 border-r border-gray-200 flex flex-col bg-white">
                {/* Conversation Header - Clean & Minimal */}
                <div className="border-b border-gray-200 bg-white">
                  {/* Main row */}
                  <div className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {/* Back button (mobile) */}
                      <button
                        onClick={() => setSelectedConversation(null)}
                        className="p-1 -ml-1 hover:bg-gray-100 rounded-lg lg:hidden"
                      >
                        <ChevronLeftIcon className="h-5 w-5 text-gray-500" />
                      </button>
                      
                      {/* Avatar */}
                      <div className="relative flex-shrink-0">
                        <div 
                          className="h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-semibold"
                          style={{ backgroundColor: getAvatarColor(selectedConversation.displayName) }}
                        >
                          {selectedConversation.participantCount > 2 ? (
                            <UserGroupIcon className="h-5 w-5" />
                          ) : (
                            getInitials(selectedConversation.displayName)
                          )}
                        </div>
                        {/* Online indicator for direct chats */}
                        {selectedConversation.participantCount <= 2 && (
                          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
                        )}
                      </div>
                      
                      {/* Name & Activity */}
                      <div className="flex-1 min-w-0">
                        <h2 className="font-semibold text-gray-900 text-[15px] truncate leading-tight">
                          {selectedConversation.displayName}
                        </h2>
                        <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                          {selectedConversation.participantCount > 2 ? (
                            <span>{selectedConversation.participantCount} participants</span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                              Active now
                            </span>
                          )}
                          <span className="text-gray-300 mx-1">•</span>
                          <span>{formatTime(selectedConversation.lastMessage?.created_at)}</span>
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  {/* Quick Actions Row */}
                  <div className="px-4 pb-2.5 flex items-center gap-1">
                    {/* Star */}
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setFlaggedConversations(prev => {
                          const newSet = new Set(prev);
                          if (newSet.has(selectedConversation.id)) {
                            newSet.delete(selectedConversation.id);
                          } else {
                            newSet.add(selectedConversation.id);
                          }
                          return newSet;
                        });
                      }}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        flaggedConversations.has(selectedConversation.id)
                          ? 'bg-amber-50 text-amber-600'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {flaggedConversations.has(selectedConversation.id) ? (
                        <StarIconSolid className="h-3.5 w-3.5" />
                      ) : (
                        <StarIcon className="h-3.5 w-3.5" />
                      )}
                      <span>Star</span>
                    </button>
                    
                    {/* Archive */}
                    <button 
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                    >
                      <ArchiveBoxIcon className="h-3.5 w-3.5" />
                      <span>Archive</span>
                    </button>
                    
                    {/* Mute */}
                    <button 
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                    >
                      <BellSlashIcon className="h-3.5 w-3.5" />
                      <span>Mute</span>
                    </button>
                    
                    {/* Link to Project */}
                    <button 
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                    >
                      <LinkIcon className="h-3.5 w-3.5" />
                      <span>Link</span>
                    </button>
                    
                    {/* More */}
                    <button 
                      className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors ml-auto"
                    >
                      <EllipsisHorizontalIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                
                {/* Message List - Outlook style */}
                <div className="flex-1 overflow-y-auto">
                  {messagesLoading ? (
                    <div className="flex justify-center items-center h-32">
                      <ArrowPathIcon className="h-5 w-5 animate-spin text-[#7F2387]" />
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 text-gray-400 p-4">
                      <EnvelopeIcon className="h-8 w-8 mb-2 text-gray-300" />
                      <p className="text-sm text-center">No messages in this conversation</p>
                    </div>
                  ) : (
                    <div>
                      {messages.map((msg, idx) => {
                        const isOwn = msg.sender_id === user?.id;
                        const isSelected = selectedMessage?.id === msg.id;
                        const isUnread = !isOwn && !msg.read_status;
                        
                        return (
                          <div
                            key={msg.id}
                            onClick={() => setSelectedMessage(msg)}
                            className={`group relative px-4 py-3 cursor-pointer border-b border-gray-100 transition-colors ${
                              isSelected 
                                ? 'bg-[#7F2387]/8' 
                                : 'hover:bg-gray-50'
                            }`}
                          >
                            {/* Unread indicator bar */}
                            {isUnread && (
                              <div className="absolute left-0 top-3 bottom-3 w-[3px] bg-[#7F2387] rounded-r-full" />
                            )}
                            
                            {/* Selected indicator */}
                            {isSelected && !isUnread && (
                              <div className="absolute left-0 top-3 bottom-3 w-[3px] bg-[#7F2387]/40 rounded-r-full" />
                            )}
                            
                            {/* Row 1: Sender + Time */}
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <div 
                                  className="h-6 w-6 rounded-full flex items-center justify-center text-white text-[10px] font-medium flex-shrink-0"
                                  style={{ backgroundColor: getAvatarColor(msg.sender_name) }}
                                >
                                  {getInitials(msg.sender_name)}
                                </div>
                                <span className={`truncate text-[13px] ${
                                  isUnread ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'
                                }`}>
                                  {isOwn ? 'You' : msg.sender_name?.split(' ')[0] || 'Unknown'}
                                </span>
                              </div>
                              <span className={`text-[11px] tabular-nums flex-shrink-0 ${
                                isUnread ? 'text-[#7F2387] font-medium' : 'text-gray-400'
                              }`}>
                                {formatTime(msg.created_at)}
                              </span>
                            </div>
                            
                            {/* Row 2: Subject */}
                            <p className={`truncate text-[13px] leading-tight mb-0.5 ${
                              isUnread ? 'font-semibold text-gray-800' : 'font-medium text-gray-600'
                            }`}>
                              {msg.subject || 'No Subject'}
                            </p>
                            
                            {/* Row 3: Preview */}
                            <p className={`truncate text-[12px] leading-tight ${
                              isUnread ? 'text-gray-600' : 'text-gray-400'
                            }`}>
                              {msg.body?.substring(0, 80) || msg.body_preview || 'No content'}
                            </p>
                            
                            {/* Row 4: Attachment indicator (if any) */}
                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className="flex items-center gap-1 mt-1.5">
                                <PaperClipIcon className="h-3 w-3 text-gray-400" />
                                <span className="text-[11px] text-gray-400">
                                  {msg.attachments.length} attachment{msg.attachments.length > 1 ? 's' : ''}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                
                {/* Quick Reply at bottom of message list */}
                <div className="border-t border-gray-200 p-3 bg-gray-50">
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      ref={fileInputRef}
                      multiple
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="p-2 hover:bg-gray-200 rounded-lg text-gray-500 flex-shrink-0"
                      title="Attach file"
                    >
                      <PaperClipIcon className="h-4 w-4" />
                    </button>
                    <input
                      ref={replyInputRef}
                      type="text"
                      value={messageText}
                      onChange={(e) => setMessageText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendReply();
                        }
                      }}
                      placeholder="Type a reply..."
                      className="flex-1 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#7F2387]/30"
                    />
                    <button
                      onClick={sendReply}
                      disabled={sending || (!messageText.trim() && attachments.length === 0)}
                      className="p-2 bg-[#7F2387] text-white rounded-lg hover:bg-[#64126D] disabled:opacity-50 flex-shrink-0"
                    >
                      <PaperAirplaneIcon className="h-4 w-4" />
                    </button>
                  </div>
                  {attachments.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {attachments.map((att, idx) => (
                        <span key={idx} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-200 rounded text-xs text-gray-600">
                          <PaperClipIcon className="h-3 w-3" />
                          {att.name.substring(0, 15)}{att.name.length > 15 ? '...' : ''}
                          <button onClick={() => removeAttachment(idx)} className="hover:text-gray-800">
                            <XMarkIcon className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              
              {/* RIGHT PANE - Reading Pane (Email-style Thread View) */}
              <div className="flex-1 flex flex-col bg-gray-100 min-w-0">
                {/* Thread Header */}
                <div className="border-b border-gray-200 bg-white px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <h2 className="font-semibold text-gray-900 text-lg truncate">
                        {selectedConversation.lastMessage?.subject || 'Conversation'}
                      </h2>
                      <p className="text-sm text-gray-500 mt-0.5">
                        {messages.length} message{messages.length !== 1 ? 's' : ''} in this thread
                      </p>
                    </div>
                    
                    {/* Thread Actions */}
                    <div className="flex items-center gap-1">
                      <button 
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                        title="Reply to thread"
                      >
                        <PaperAirplaneIcon className="h-5 w-5 text-gray-400 hover:text-gray-600 -rotate-45" />
                      </button>
                      <button 
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                        title="Print thread"
                      >
                        <DocumentIcon className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                      </button>
                      <button 
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                        title="More options"
                      >
                        <EllipsisHorizontalIcon className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                      </button>
                    </div>
                  </div>
                </div>
                
                {/* Email Cards Stack */}
                <div className="flex-1 overflow-y-auto p-6">
                  {messagesLoading ? (
                    <div className="flex justify-center items-center h-32">
                      <ArrowPathIcon className="h-6 w-6 animate-spin text-[#7F2387]" />
                    </div>
                  ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                      <EnvelopeIcon className="h-12 w-12 mb-2 text-gray-300" />
                      <p className="text-sm">No messages in this conversation</p>
                    </div>
                  ) : (
                    <div className="space-y-4 max-w-4xl mx-auto">
                      {messages.map((msg, idx) => {
                        const isOwn = msg.sender_id === user?.id;
                        const isSelected = selectedMessage?.id === msg.id;
                        
                        return (
                          <div
                            key={msg.id}
                            onClick={() => setSelectedMessage(msg)}
                            className={`bg-white rounded-lg shadow-sm border transition-all cursor-pointer ${
                              isSelected 
                                ? 'border-[#7F2387] ring-1 ring-[#7F2387]/20' 
                                : 'border-gray-200 hover:border-gray-300 hover:shadow'
                            }`}
                          >
                            {/* Card Header */}
                            <div className="px-5 py-4 border-b border-gray-100">
                              <div className="flex items-start gap-4">
                                {/* Sender Avatar */}
                                <div 
                                  className="h-11 w-11 rounded-full flex items-center justify-center text-white text-sm font-semibold flex-shrink-0"
                                  style={{ backgroundColor: getAvatarColor(msg.sender_name) }}
                                >
                                  {getInitials(msg.sender_name)}
                                </div>
                                
                                {/* Sender Info & Subject */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-3 mb-1">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="font-semibold text-gray-900 text-[15px]">
                                        {isOwn ? 'You' : msg.sender_name}
                                      </span>
                                      {isOwn && (
                                        <span className="px-1.5 py-0.5 bg-[#7F2387]/10 text-[#7F2387] text-[10px] font-medium rounded">
                                          SENT
                                        </span>
                                      )}
                                    </div>
                                    <span className="text-xs text-gray-400 flex-shrink-0 tabular-nums">
                                      {formatFullDate(msg.created_at)}
                                    </span>
                                  </div>
                                  
                                  {/* Subject Line */}
                                  <p className="text-sm font-medium text-gray-700 truncate">
                                    {msg.subject || 'No Subject'}
                                  </p>
                                  
                                  {/* To/From line */}
                                  <p className="text-xs text-gray-400 mt-1">
                                    {isOwn ? (
                                      <>To: {msg.receiver_name || selectedConversation.displayName}</>
                                    ) : (
                                      <>To: You</>
                                    )}
                                  </p>
                                </div>
                              </div>
                            </div>
                            
                            {/* Card Body - Enhanced Reading Area */}
                            <div className="px-8 py-6 bg-gray-50/30">
                              <div 
                                className="prose prose-gray max-w-none
                                  prose-headings:text-gray-900 prose-headings:font-semibold
                                  prose-p:text-gray-700 prose-p:leading-[1.75] prose-p:text-[15px]
                                  prose-a:text-[#7F2387] prose-a:no-underline hover:prose-a:underline
                                  prose-strong:text-gray-900 prose-strong:font-semibold
                                  prose-code:text-[#7F2387] prose-code:bg-gray-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:font-normal prose-code:before:content-none prose-code:after:content-none
                                  prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-pre:rounded-lg
                                  prose-blockquote:border-l-[#7F2387] prose-blockquote:bg-gray-50 prose-blockquote:py-1 prose-blockquote:not-italic
                                  prose-ul:text-gray-700 prose-ol:text-gray-700
                                  prose-li:marker:text-gray-400
                                  prose-hr:border-gray-200
                                  prose-table:text-sm prose-th:bg-gray-100 prose-th:px-3 prose-th:py-2
                                  prose-td:px-3 prose-td:py-2 prose-td:border-gray-200
                                  whitespace-pre-wrap
                                  selection:bg-[#7F2387]/20"
                                style={{ maxWidth: '65ch' }}
                                dangerouslySetInnerHTML={{ __html: (msg.body || msg.body_preview || 'No content').replace(/\n/g, '<br/>') }}
                              />
                            </div>
                            
                            {/* Card Attachments */}
                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 rounded-b-lg">
                                <div className="flex items-center gap-2 mb-2">
                                  <PaperClipIcon className="h-4 w-4 text-gray-400" />
                                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                                    {msg.attachments.length} Attachment{msg.attachments.length > 1 ? 's' : ''}
                                  </span>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {msg.attachments.map((att, attIdx) => (
                                    <a
                                      key={attIdx}
                                      href={att.file_path || att.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-colors group"
                                    >
                                      <div className="p-1.5 bg-gray-100 rounded">
                                        <DocumentIcon className="h-4 w-4 text-gray-500" />
                                      </div>
                                      <div className="min-w-0">
                                        <p className="text-sm font-medium text-gray-700 truncate max-w-[150px]">
                                          {att.original_name || att.name}
                                        </p>
                                        <p className="text-[10px] text-gray-400">
                                          {att.file_size ? `${(att.file_size / 1024).toFixed(1)} KB` : 'Download'}
                                        </p>
                                      </div>
                                      <ArrowDownTrayIcon className="h-4 w-4 text-gray-400 group-hover:text-[#7F2387]" />
                                    </a>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            {/* Card Footer - Quick Actions */}
                            <div className="px-5 py-2.5 border-t border-gray-100 flex items-center gap-2">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  replyInputRef.current?.focus();
                                }}
                                className="text-xs text-gray-500 hover:text-[#7F2387] font-medium flex items-center gap-1"
                              >
                                <PaperAirplaneIcon className="h-3.5 w-3.5 -rotate-45" />
                                Reply
                              </button>
                              <span className="text-gray-300">•</span>
                              <button 
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs text-gray-500 hover:text-[#7F2387] font-medium flex items-center gap-1"
                              >
                                <ArchiveBoxIcon className="h-3.5 w-3.5" />
                                Archive
                              </button>
                              <span className="text-gray-300">•</span>
                              <button 
                                onClick={(e) => e.stopPropagation()}
                                className="text-xs text-gray-500 hover:text-red-500 font-medium"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </div>
                
                {/* Reply Composer - Outlook Style Rich Text Editor */}
                <div className="border-t border-gray-200 bg-white flex-shrink-0">
                  {/* Formatting Toolbar - Full Width */}
                  <div className="flex items-center gap-0.5 px-4 py-2 border-b border-gray-100 bg-gray-50 overflow-x-auto flex-nowrap">
                    {/* Font Family */}
                    <div className="relative" data-dropdown>
                      <button 
                        onClick={() => setShowFontDropdown(!showFontDropdown)}
                        className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-200 rounded transition-colors whitespace-nowrap"
                        title="Font"
                      >
                        <span className="font-medium">{selectedFont}</span>
                        <ChevronDownIcon className="h-3 w-3" />
                      </button>
                      {showFontDropdown && (
                        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1 min-w-[140px]">
                          {fontOptions.map(font => (
                            <button
                              key={font}
                              onClick={() => handleFontChange(font)}
                              className="w-full px-3 py-1.5 text-left text-sm hover:bg-gray-100"
                              style={{ fontFamily: font }}
                            >
                              {font}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    
                    {/* Font Size */}
                    <div className="relative" data-dropdown>
                      <button 
                        onClick={() => setShowFontSizeDropdown(!showFontSizeDropdown)}
                        className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-200 rounded transition-colors"
                        title="Font Size"
                      >
                        <span>{selectedFontSize}</span>
                        <ChevronDownIcon className="h-3 w-3" />
                      </button>
                      {showFontSizeDropdown && (
                        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1 max-h-48 overflow-y-auto">
                          {fontSizeOptions.map(size => (
                            <button
                              key={size}
                              onClick={() => handleFontSizeChange(size)}
                              className="w-full px-3 py-1 text-left text-sm hover:bg-gray-100"
                            >
                              {size}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    
                    <div className="w-px h-5 bg-gray-300 mx-1 flex-shrink-0" />
                    
                    {/* Bold */}
                    <button 
                      onClick={() => handleFormat('bold')}
                      className={`p-1.5 rounded transition-colors flex-shrink-0 ${activeFormats.bold ? 'bg-gray-300 text-gray-800' : 'text-gray-600 hover:bg-gray-200'}`}
                      title="Bold (Ctrl+B)"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6V4zm0 8h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6v-8zm3 7h5a2 2 0 0 0 0-4H9v4zm0-7h4a2 2 0 0 0 0-4H9v4z"/>
                      </svg>
                    </button>
                    
                    {/* Italic */}
                    <button 
                      onClick={() => handleFormat('italic')}
                      className={`p-1.5 rounded transition-colors flex-shrink-0 ${activeFormats.italic ? 'bg-gray-300 text-gray-800' : 'text-gray-600 hover:bg-gray-200'}`}
                      title="Italic (Ctrl+I)"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M10 4v3h2.21l-3.42 8H6v3h8v-3h-2.21l3.42-8H18V4h-8z"/>
                      </svg>
                    </button>
                    
                    {/* Underline */}
                    <button 
                      onClick={() => handleFormat('underline')}
                      className={`p-1.5 rounded transition-colors flex-shrink-0 ${activeFormats.underline ? 'bg-gray-300 text-gray-800' : 'text-gray-600 hover:bg-gray-200'}`}
                      title="Underline (Ctrl+U)"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 3v7a6 6 0 0 0 6 6 6 6 0 0 0 6-6V3h-2v7a4 4 0 0 1-4 4 4 4 0 0 1-4-4V3H6zM4 20h16v2H4v-2z"/>
                      </svg>
                    </button>
                    
                    <div className="w-px h-5 bg-gray-300 mx-1 flex-shrink-0" />
                    
                    {/* Text Color */}
                    <div className="relative" data-dropdown>
                      <button 
                        onClick={() => setShowColorPicker(!showColorPicker)}
                        className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition-colors relative flex-shrink-0"
                        title="Font Color"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M11 2L5.5 16h2.25l1.12-3h6.25l1.12 3h2.25L13 2h-2zm-1.38 9L12 4.67 14.38 11H9.62z"/>
                        </svg>
                        <div className="absolute bottom-0 left-1 right-1 h-1 rounded-full" style={{ backgroundColor: currentTextColor }} />
                      </button>
                      {showColorPicker && (
                        <div className="absolute bottom-full left-0 mb-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-2 grid grid-cols-5 gap-1">
                          {colorOptions.map(color => (
                            <button
                              key={color}
                              onClick={() => handleTextColor(color)}
                              className="w-6 h-6 rounded border border-gray-300 hover:scale-110 transition-transform"
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                    
                    {/* Highlight Color */}
                    <div className="relative" data-dropdown>
                      <button 
                        onClick={() => setShowHighlightPicker(!showHighlightPicker)}
                        className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition-colors relative flex-shrink-0"
                        title="Highlight Color"
                      >
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M15.24 2.86l3.89 3.89-1.41 1.41-3.89-3.89 1.41-1.41zM3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM5.92 19H5v-.92l9.06-9.06.92.92L5.92 19z"/>
                        </svg>
                        <div className="absolute bottom-0 left-1 right-1 h-1 rounded-full" style={{ backgroundColor: currentHighlightColor }} />
                      </button>
                      {showHighlightPicker && (
                        <div className="absolute bottom-full left-0 mb-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 p-2 grid grid-cols-5 gap-1">
                          {colorOptions.map(color => (
                            <button
                              key={color}
                              onClick={() => handleHighlightColor(color)}
                              className="w-6 h-6 rounded border border-gray-300 hover:scale-110 transition-transform"
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                    
                    <div className="w-px h-5 bg-gray-300 mx-1 flex-shrink-0" />
                    
                    {/* Bullet List */}
                    <button 
                      onClick={() => handleInsertList('bullet')}
                      className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition-colors flex-shrink-0"
                      title="Bullet List"
                    >
                      <ListBulletIcon className="h-4 w-4" />
                    </button>
                    
                    {/* Numbered List */}
                    <button 
                      onClick={() => handleInsertList('numbered')}
                      className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition-colors flex-shrink-0"
                      title="Numbered List"
                    >
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z"/>
                      </svg>
                    </button>
                    
                    <div className="w-px h-5 bg-gray-300 mx-1 flex-shrink-0" />
                    
                    {/* Link */}
                    <button 
                      onClick={handleInsertLink}
                      className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition-colors flex-shrink-0"
                      title="Insert Link (Ctrl+K)"
                    >
                      <LinkIcon className="h-4 w-4" />
                    </button>
                    
                    {/* Code */}
                    <button 
                      onClick={() => execCommand('formatBlock', 'pre')}
                      className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition-colors flex-shrink-0"
                      title="Code Block"
                    >
                      <CodeBracketIcon className="h-4 w-4" />
                    </button>
                    
                    {/* Insert Table */}
                    <button className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition-colors flex-shrink-0" title="Insert Table">
                      <TableCellsIcon className="h-4 w-4" />
                    </button>
                    
                    {/* Insert Image */}
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition-colors flex-shrink-0"
                      title="Insert Picture"
                    >
                      <PhotoIcon className="h-4 w-4" />
                    </button>
                    
                    {/* Emoji */}
                    <button className="p-1.5 text-gray-600 hover:bg-gray-200 rounded transition-colors flex-shrink-0" title="Insert Emoji">
                      <FaceSmileIcon className="h-4 w-4" />
                    </button>
                  </div>
                  
                  {/* Attachments Preview */}
                  {attachments.length > 0 && (
                    <div className="px-4 py-2 border-b border-gray-100 flex flex-wrap gap-2">
                      {attachments.map((att, idx) => (
                        <span key={idx} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-100 rounded-lg text-xs text-gray-600">
                          <PaperClipIcon className="h-3.5 w-3.5" />
                          <span className="max-w-[120px] truncate">{att.name}</span>
                          <button onClick={() => removeAttachment(idx)} className="hover:text-red-500">
                            <XMarkIcon className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  
                  {/* Rich Text Editor Area */}
                  <div className="px-4 py-3">
                    <div
                      ref={replyEditorRef}
                      contentEditable
                      onInput={updateActiveFormats}
                      onMouseUp={updateActiveFormats}
                      onKeyUp={updateActiveFormats}
                      onKeyDown={(e) => {
                        // Handle formatting shortcuts
                        handleEditorKeyDown(e);
                        // Handle Enter to send
                        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                          const text = getEditorText(replyEditorRef);
                          if (text.trim()) {
                            e.preventDefault();
                            sendReply();
                          }
                        }
                      }}
                      className="w-full text-[15px] leading-relaxed text-gray-700 focus:outline-none min-h-[60px] max-h-[120px] overflow-y-auto border border-gray-200 rounded-lg p-3"
                      style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
                      data-placeholder="Write your reply here..."
                      suppressContentEditableWarning={true}
                    />
                  </div>
                  
                  {/* Bottom Actions */}
                  <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={sendReply}
                        disabled={sending || (!getEditorText(replyEditorRef).trim() && attachments.length === 0)}
                        className="px-5 py-2 bg-[#7F2387] text-white rounded-md hover:bg-[#64126D] disabled:opacity-50 font-medium flex items-center gap-2 text-sm"
                      >
                        <PaperAirplaneIcon className="h-4 w-4" />
                        Send
                      </button>
                      
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-2 text-gray-600 hover:bg-gray-200 rounded-md transition-colors flex items-center gap-1.5 text-sm"
                        title="Attach file"
                      >
                        <PaperClipIcon className="h-4 w-4" />
                        Attach
                      </button>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded transition-colors" title="Save as draft">
                        <DocumentIcon className="h-4 w-4" />
                      </button>
                      <button className="p-2 text-gray-400 hover:text-red-500 hover:bg-gray-200 rounded transition-colors" title="Discard">
                        <XMarkIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Empty State */
            <div className="flex flex-col items-center justify-center h-full text-gray-400 bg-gray-50">
              <div className="bg-white rounded-full p-6 shadow-sm mb-4">
                <ChatBubbleLeftRightIconSolid className="h-16 w-16 text-[#7F2387]/30" />
              </div>
              <h3 className="text-xl font-semibold text-gray-700 mb-2">Your Messages</h3>
              <p className="text-sm text-gray-500 mb-6 text-center max-w-sm">
                Select a conversation from the list or start a new message
              </p>
              <button
                onClick={startNewMessage}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#7F2387] text-white rounded-lg hover:bg-[#64126D] font-medium"
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
