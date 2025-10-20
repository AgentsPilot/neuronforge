'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Mail, 
  MailOpen, 
  Search, 
  Eye, 
  Trash2, 
  RefreshCw,
  CheckCircle,
  X,
  Send,
  Reply,
  Phone,
  Building,
  Clock,
  User,
  MessageSquare,
  Edit,
  Save
} from 'lucide-react';

interface ContactMessage {
  id: string;
  name: string;
  email: string;
  message: string;
  status: 'unread' | 'read' | 'replied';
  email_sent: boolean;
  created_at: string;
  // New optional fields we'll add to the table
  subject?: string;
  phone?: string;
  company?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  source?: 'contact_form' | 'email' | 'phone' | 'chat';
  updated_at?: string;
  admin_notes?: string;
  replies?: MessageReply[];
}

interface MessageReply {
  id: string;
  message_id: string;
  sender: 'admin' | 'user';
  content: string;
  created_at: string;
  admin_id?: string;
}

export default function AdminMessages() {
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState<ContactMessage | null>(null);
  const [filter, setFilter] = useState<'all' | 'unread' | 'read' | 'replied'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [replyContent, setReplyContent] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [showReplyModal, setShowReplyModal] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);

  useEffect(() => {
    fetchMessages();
  }, [filter]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchTerm !== '') {
        fetchMessages();
      }
    }, 300); // Debounce search

    return () => clearTimeout(timeoutId);
  }, [searchTerm]);

  const fetchMessages = async () => {
    try {
      setLoading(true);
      const queryParams = new URLSearchParams({
        filter,
        search: searchTerm
      });
      
      const response = await fetch(`/api/admin/messages?${queryParams}`);
      if (!response.ok) throw new Error('Failed to fetch messages');
      
      const data = await response.json();
      setMessages(data.messages || []);
    } catch (error) {
      console.error('Error fetching messages:', error);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  };

  const updateMessageStatus = async (messageId: string, status: ContactMessage['status']) => {
    try {
      const response = await fetch(`/api/admin/messages/${messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, updated_at: new Date().toISOString() })
      });

      if (response.ok) {
        setMessages(prev => prev.map(msg => 
          msg.id === messageId ? { ...msg, status, updated_at: new Date().toISOString() } : msg
        ));
        
        if (selectedMessage?.id === messageId) {
          setSelectedMessage(prev => prev ? { ...prev, status } : null);
        }
      }
    } catch (error) {
      console.error('Error updating message status:', error);
    }
  };

  const saveAdminNotes = async () => {
    if (!selectedMessage) return;

    try {
      const response = await fetch(`/api/admin/messages/${selectedMessage.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          admin_notes: adminNotes,
          updated_at: new Date().toISOString()
        })
      });

      if (response.ok) {
        setSelectedMessage(prev => prev ? { ...prev, admin_notes: adminNotes } : null);
        setMessages(prev => prev.map(msg => 
          msg.id === selectedMessage.id ? { ...msg, admin_notes: adminNotes } : msg
        ));
        setEditingNotes(false);
      }
    } catch (error) {
      console.error('Error saving admin notes:', error);
    }
  };

  const sendReply = async () => {
    if (!selectedMessage || !replyContent.trim()) return;

    try {
      setSendingReply(true);
      const response = await fetch(`/api/admin/messages/${selectedMessage.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          content: replyContent,
          send_email: true 
        })
      });

      if (response.ok) {
        const data = await response.json();
        
        // Update message status to replied and email_sent to true
        await updateMessageStatus(selectedMessage.id, 'replied');
        
        // Update email_sent flag
        await fetch(`/api/admin/messages/${selectedMessage.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email_sent: true })
        });

        // Add reply to the message
        const newReply: MessageReply = {
          id: data.reply_id,
          message_id: selectedMessage.id,
          sender: 'admin',
          content: replyContent,
          created_at: new Date().toISOString(),
          admin_id: data.admin_id
        };

        setSelectedMessage(prev => prev ? {
          ...prev,
          replies: [...(prev.replies || []), newReply],
          status: 'replied',
          email_sent: true
        } : null);

        setReplyContent('');
        setShowReplyModal(false);
      }
    } catch (error) {
      console.error('Error sending reply:', error);
    } finally {
      setSendingReply(false);
    }
  };

  const deleteMessage = async (messageId: string) => {
    if (!confirm('Are you sure you want to delete this message?')) return;

    try {
      const response = await fetch(`/api/admin/messages/${messageId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setMessages(prev => prev.filter(msg => msg.id !== messageId));
        if (selectedMessage?.id === messageId) {
          setSelectedMessage(null);
        }
      }
    } catch (error) {
      console.error('Error deleting message:', error);
    }
  };

  const markAsRead = async (message: ContactMessage) => {
    if (message.status === 'unread') {
      await updateMessageStatus(message.id, 'read');
    }
    setSelectedMessage(message);
    setAdminNotes(message.admin_notes || '');
  };

  const getFilteredMessages = () => {
    let filtered = messages;
    if (filter !== 'all') {
      filtered = filtered.filter(msg => msg.status === filter);
    }
    if (searchTerm) {
      filtered = filtered.filter(msg => 
        msg.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        msg.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        msg.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (msg.subject && msg.subject.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (msg.company && msg.company.toLowerCase().includes(searchTerm.toLowerCase()))
      );
    }
    return filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  };

  const getStatusBadge = (message: ContactMessage) => {
    const { status, email_sent, replies } = message;
    const hasReplies = replies && replies.length > 0;
    
    switch (status) {
      case 'unread': 
        return (
          <div className="flex items-center gap-1">
            <span className="px-2 py-1 text-xs font-medium bg-blue-500/20 text-blue-300 rounded-full border border-blue-500/30">
              Unread
            </span>
            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" title="New message" />
          </div>
        );
      case 'read': 
        return <span className="px-2 py-1 text-xs font-medium bg-gray-500/20 text-gray-300 rounded-full">Read</span>;
      case 'replied': 
        return (
          <div className="flex items-center gap-1">
            <span className="px-2 py-1 text-xs font-medium bg-green-500/20 text-green-300 rounded-full">Replied</span>
            {email_sent && <Mail className="w-3 h-3 text-green-400" title="Email sent" />}
            {hasReplies && (
              <div className="flex items-center gap-1">
                <MessageSquare className="w-3 h-3 text-green-400" title="Has conversation thread" />
                <span className="text-xs text-green-400">{replies.length}</span>
              </div>
            )}
          </div>
        );
      default: 
        return null;
    }
  };

  const getPriorityBadge = (priority?: string) => {
    if (!priority) return null;
    
    const colors = {
      low: 'bg-slate-500/20 text-slate-300',
      normal: 'bg-blue-500/20 text-blue-300',
      high: 'bg-orange-500/20 text-orange-300',
      urgent: 'bg-red-500/20 text-red-300'
    };

    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${colors[priority as keyof typeof colors]}`}>
        {priority.charAt(0).toUpperCase() + priority.slice(1)}
      </span>
    );
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-400">Loading messages...</p>
        </div>
      </div>
    );
  }

  const filteredMessages = getFilteredMessages();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Contact Messages</h1>
          <div className="flex items-center gap-4">
            <p className="text-slate-400">Manage and respond to user inquiries</p>
            {messages.length > 0 && (
              <div className="flex items-center gap-3 text-sm">
                <span className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                  <span className="text-blue-300">
                    {messages.filter(m => m.status === 'unread').length} unread
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <MessageSquare className="w-3 h-3 text-green-400" />
                  <span className="text-green-300">
                    {messages.filter(m => m.replies && m.replies.length > 0).length} with replies
                  </span>
                </span>
              </div>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {messages.filter(m => m.status === 'unread').length > 0 && (
            <button
              onClick={async () => {
                if (confirm('Mark all messages as read?')) {
                  try {
                    await Promise.all(
                      messages
                        .filter(m => m.status === 'unread')
                        .map(m => updateMessageStatus(m.id, 'read'))
                    );
                    fetchMessages();
                  } catch (error) {
                    console.error('Error marking all as read:', error);
                  }
                }
              }}
              className="px-3 py-1 bg-blue-500/20 text-blue-300 rounded text-sm hover:bg-blue-500/30 transition-colors border border-blue-500/20"
            >
              Mark All Read
            </button>
          )}
          <button 
            onClick={fetchMessages}
            className="p-2 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10">
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-slate-700/50 rounded-lg px-3 py-2 w-64">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search messages..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-transparent text-white placeholder-slate-400 text-sm focus:outline-none flex-1"
              />
            </div>
            
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as any)}
              className="bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
            >
              <option value="all">All Messages</option>
              <option value="unread">Unread</option>
              <option value="read">Read</option>
              <option value="replied">Replied</option>
            </select>
          </div>
        </div>
      </div>

      {/* Messages List */}
      <div className="bg-slate-800/50 backdrop-blur-xl rounded-xl border border-white/10 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-700/50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Contact</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Message</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {filteredMessages.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                  <Mail className="w-12 h-12 mx-auto mb-4 text-slate-600" />
                  <p className="text-lg font-medium">No messages found</p>
                  <p className="text-sm">Try adjusting your search or filter criteria</p>
                </td>
              </tr>
            ) : (
              filteredMessages.map((message) => (
                <tr 
                  key={message.id} 
                  className={`hover:bg-slate-700/30 transition-colors cursor-pointer ${
                    message.status === 'unread' ? 'bg-blue-500/10 border-l-4 border-blue-400' : ''
                  }`}
                  onClick={() => markAsRead(message)}
                >
                  <td className="px-6 py-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-medium ${message.status === 'unread' ? 'text-white font-bold' : 'text-white'}`}>
                          {message.name}
                        </p>
                        {message.priority && getPriorityBadge(message.priority)}
                        {message.status === 'unread' && (
                          <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" title="Unread message" />
                        )}
                        {message.replies && message.replies.length > 0 && (
                          <div className="flex items-center gap-1 px-1.5 py-0.5 bg-green-500/20 rounded text-xs">
                            <MessageSquare className="w-3 h-3 text-green-400" />
                            <span className="text-green-300">{message.replies.length}</span>
                          </div>
                        )}
                      </div>
                      <p className="text-sm text-slate-400">{message.email}</p>
                      {message.company && (
                        <p className="text-xs text-slate-500 flex items-center gap-1">
                          <Building className="w-3 h-3" />
                          {message.company}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {message.subject && (
                      <p className="text-sm font-medium text-white mb-1 truncate max-w-xs">
                        {message.subject}
                      </p>
                    )}
                    <p className="text-sm text-slate-400 line-clamp-2 max-w-md">
                      {message.message}
                    </p>
                  </td>
                  <td className="px-6 py-4">
                    {getStatusBadge(message)}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-400">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDate(message.created_at)}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          markAsRead(message);
                        }}
                        className="text-blue-400 hover:text-blue-300 p-1"
                        title="View details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedMessage(message);
                          setShowReplyModal(true);
                        }}
                        className="text-green-400 hover:text-green-300 p-1"
                        title="Reply"
                      >
                        <Reply className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteMessage(message.id);
                        }}
                        className="text-red-400 hover:text-red-300 p-1"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Message Detail Modal */}
      {selectedMessage && !showReplyModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-800/95 backdrop-blur-xl rounded-xl border border-white/10 max-w-4xl w-full max-h-[90vh] overflow-y-auto"
          >
            <div className="p-6 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h2 className="text-xl font-semibold text-white">Message Details</h2>
                <div className="flex gap-2">
                  {getStatusBadge(selectedMessage)}
                  {selectedMessage.priority && getPriorityBadge(selectedMessage.priority)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowReplyModal(true)}
                  className="px-4 py-2 bg-green-500/20 text-green-300 rounded-lg hover:bg-green-500/30 transition-colors border border-green-500/20 flex items-center gap-2"
                >
                  <Reply className="w-4 h-4" />
                  Reply
                </button>
                {selectedMessage.status !== 'unread' && (
                  <button
                    onClick={() => {
                      updateMessageStatus(selectedMessage.id, 'unread');
                      setSelectedMessage(prev => prev ? { ...prev, status: 'unread' } : null);
                    }}
                    className="px-4 py-2 bg-orange-500/20 text-orange-300 rounded-lg hover:bg-orange-500/30 transition-colors border border-orange-500/20 flex items-center gap-2"
                  >
                    <MailOpen className="w-4 h-4" />
                    Mark as Unread
                  </button>
                )}
                <button
                  onClick={() => setSelectedMessage(null)}
                  className="text-slate-400 hover:text-white p-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Contact Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-slate-700/30 p-4 rounded-lg">
                  <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                    <User className="w-5 h-5" />
                    Contact Information
                  </h3>
                  <div className="space-y-2">
                    <div>
                      <span className="text-slate-400 text-sm">Name:</span>
                      <p className="text-white font-medium">{selectedMessage.name}</p>
                    </div>
                    <div>
                      <span className="text-slate-400 text-sm">Email:</span>
                      <p className="text-white">{selectedMessage.email}</p>
                    </div>
                    {selectedMessage.phone && (
                      <div>
                        <span className="text-slate-400 text-sm">Phone:</span>
                        <p className="text-white flex items-center gap-1">
                          <Phone className="w-3 h-3" />
                          {selectedMessage.phone}
                        </p>
                      </div>
                    )}
                    {selectedMessage.company && (
                      <div>
                        <span className="text-slate-400 text-sm">Company:</span>
                        <p className="text-white flex items-center gap-1">
                          <Building className="w-3 h-3" />
                          {selectedMessage.company}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-slate-700/30 p-4 rounded-lg">
                  <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                    <Clock className="w-5 h-5" />
                    Message Details
                  </h3>
                  <div className="space-y-2">
                    <div>
                      <span className="text-slate-400 text-sm">Received:</span>
                      <p className="text-white">{new Date(selectedMessage.created_at).toLocaleString()}</p>
                    </div>
                    {selectedMessage.updated_at && (
                      <div>
                        <span className="text-slate-400 text-sm">Last Updated:</span>
                        <p className="text-white">{new Date(selectedMessage.updated_at).toLocaleString()}</p>
                      </div>
                    )}
                    {selectedMessage.source && (
                      <div>
                        <span className="text-slate-400 text-sm">Source:</span>
                        <p className="text-white capitalize">{selectedMessage.source.replace('_', ' ')}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Original Message */}
              <div>
                <h3 className="text-lg font-semibold text-white mb-4">
                  {selectedMessage.subject ? `Subject: ${selectedMessage.subject}` : 'Message'}
                </h3>
                <div className="bg-slate-700/50 p-4 rounded-lg">
                  <p className="text-slate-200 leading-relaxed whitespace-pre-wrap">
                    {selectedMessage.message}
                  </p>
                </div>
              </div>

              {/* Admin Notes */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Edit className="w-5 h-5" />
                    Admin Notes
                  </h3>
                  <button
                    onClick={() => {
                      if (editingNotes) {
                        saveAdminNotes();
                      } else {
                        setEditingNotes(true);
                      }
                    }}
                    className="px-3 py-1 bg-blue-500/20 text-blue-300 rounded text-sm hover:bg-blue-500/30 transition-colors border border-blue-500/20 flex items-center gap-1"
                  >
                    {editingNotes ? <Save className="w-3 h-3" /> : <Edit className="w-3 h-3" />}
                    {editingNotes ? 'Save' : 'Edit'}
                  </button>
                </div>
                {editingNotes ? (
                  <textarea
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    rows={3}
                    className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Add internal notes about this message..."
                  />
                ) : (
                  <div className="bg-slate-700/50 p-4 rounded-lg">
                    <p className="text-slate-200">
                      {selectedMessage.admin_notes || 'No admin notes yet.'}
                    </p>
                  </div>
                )}
              </div>

              {/* Conversation Thread */}
              {selectedMessage.replies && selectedMessage.replies.length > 0 && (
                <div>
                  <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                    <MessageSquare className="w-5 h-5" />
                    Conversation Thread
                  </h3>
                  <div className="space-y-4">
                    {selectedMessage.replies.map((reply) => (
                      <div key={reply.id} className={`p-4 rounded-lg ${
                        reply.sender === 'admin' 
                          ? 'bg-green-500/10 border border-green-500/20 ml-4' 
                          : 'bg-blue-500/10 border border-blue-500/20 mr-4'
                      }`}>
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-sm font-medium ${
                            reply.sender === 'admin' ? 'text-green-300' : 'text-blue-300'
                          }`}>
                            {reply.sender === 'admin' ? 'Admin Reply' : selectedMessage.name}
                          </span>
                          <span className="text-xs text-slate-400">
                            {new Date(reply.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-slate-200 whitespace-pre-wrap">{reply.content}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* Reply Modal */}
      {showReplyModal && selectedMessage && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-800/95 backdrop-blur-xl rounded-xl border border-white/10 max-w-2xl w-full"
          >
            <div className="p-6 border-b border-white/10 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Reply to {selectedMessage.name}</h2>
              <button
                onClick={() => {
                  setShowReplyModal(false);
                  setReplyContent('');
                }}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <div className="mb-2">
                  <span className="text-slate-400 text-sm">To: </span>
                  <span className="text-white">{selectedMessage.email}</span>
                </div>
                <div className="mb-4">
                  <span className="text-slate-400 text-sm">Subject: </span>
                  <span className="text-white">
                    Re: {selectedMessage.subject || 'Your message'}
                  </span>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Your Reply
                </label>
                <textarea
                  value={replyContent}
                  onChange={(e) => setReplyContent(e.target.value)}
                  rows={8}
                  className="w-full bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Type your reply here..."
                />
              </div>
              
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => {
                    setShowReplyModal(false);
                    setReplyContent('');
                  }}
                  className="px-4 py-2 bg-slate-600/50 text-slate-300 rounded-lg hover:bg-slate-500/50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={sendReply}
                  disabled={!replyContent.trim() || sendingReply}
                  className="px-4 py-2 bg-indigo-500/20 text-indigo-300 rounded-lg hover:bg-indigo-500/30 transition-colors border border-indigo-500/20 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sendingReply ? (
                    <div className="w-4 h-4 border-2 border-indigo-300 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  {sendingReply ? 'Sending...' : 'Send Reply'}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}