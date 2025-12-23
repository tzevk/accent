'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  PlusIcon,
  CheckIcon,
  TrashIcon,
  CalendarIcon,
  FlagIcon,
  PencilIcon,
  ClipboardDocumentListIcon,
  ClockIcon
} from '@heroicons/react/24/outline';

const PRIORITY_COLORS = {
  high: 'text-red-600 bg-red-50 border-red-200',
  medium: 'text-amber-600 bg-amber-50 border-amber-200',
  low: 'text-green-600 bg-green-50 border-green-200'
};

const PRIORITY_LABELS = {
  high: 'High',
  medium: 'Medium',
  low: 'Low'
};

// Helper to get today's date in YYYY-MM-DD format
const getTodayDate = () => {
  const today = new Date();
  return today.toISOString().split('T')[0];
};

// Helper to get current time in HH:MM format
const getCurrentTime = () => {
  const now = new Date();
  return now.toTimeString().slice(0, 5);
};

export default function TodoList() {
  const [todos, setTodos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [newTodo, setNewTodo] = useState({
    title: '',
    description: '',
    priority: 'medium',
    due_date: getTodayDate(),
    due_time: getCurrentTime()
  });

  const fetchTodos = useCallback(async () => {
    try {
      const res = await fetch(`/api/todos?show_completed=${showCompleted}`);
      const data = await res.json();
      if (data.success) {
        setTodos(data.data || []);
      }
    } catch (error) {
      console.error('Error fetching todos:', error);
    } finally {
      setLoading(false);
    }
  }, [showCompleted]);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  const handleAddTodo = async (e) => {
    e.preventDefault();
    if (!newTodo.title.trim()) return;

    // Combine date and time for due_date
    let dueDateTime = newTodo.due_date;
    if (newTodo.due_date && newTodo.due_time) {
      dueDateTime = `${newTodo.due_date}T${newTodo.due_time}:00`;
    }

    try {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newTodo,
          due_date: dueDateTime
        })
      });
      const data = await res.json();
      if (data.success) {
        setTodos(prev => [data.data, ...prev]);
        setNewTodo({ 
          title: '', 
          description: '', 
          priority: 'medium', 
          due_date: getTodayDate(),
          due_time: getCurrentTime()
        });
        setShowAddForm(false);
      }
    } catch (error) {
      console.error('Error adding todo:', error);
    }
  };

  const handleToggleStatus = async (todo) => {
    const newStatus = todo.status === 'completed' ? 'pending' : 'completed';
    try {
      const res = await fetch('/api/todos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: todo.id, status: newStatus })
      });
      const data = await res.json();
      if (data.success) {
        if (newStatus === 'completed' && !showCompleted) {
          setTodos(prev => prev.filter(t => t.id !== todo.id));
        } else {
          setTodos(prev => prev.map(t => t.id === todo.id ? data.data : t));
        }
      }
    } catch (error) {
      console.error('Error updating todo:', error);
    }
  };

  const handleDelete = async (id) => {
    try {
      const res = await fetch(`/api/todos?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setTodos(prev => prev.filter(t => t.id !== id));
      }
    } catch (error) {
      console.error('Error deleting todo:', error);
    }
  };

  const handleUpdateTodo = async (id, updates) => {
    try {
      const res = await fetch('/api/todos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...updates })
      });
      const data = await res.json();
      if (data.success) {
        setTodos(prev => prev.map(t => t.id === id ? data.data : t));
        setEditingId(null);
      }
    } catch (error) {
      console.error('Error updating todo:', error);
    }
  };

  const formatDueDate = (dateStr) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Format time if available
    const hasTime = dateStr.includes('T') && !dateStr.endsWith('00:00:00');
    const timeStr = hasTime ? date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '';
    
    const dateOnly = new Date(date);
    dateOnly.setHours(0, 0, 0, 0);
    
    if (dateOnly < today) {
      return { text: `Overdue${timeStr ? ' • ' + timeStr : ''}`, class: 'text-red-600 bg-red-50' };
    } else if (dateOnly.toDateString() === today.toDateString()) {
      return { text: `Today${timeStr ? ' • ' + timeStr : ''}`, class: 'text-amber-600 bg-amber-50' };
    } else if (dateOnly.toDateString() === tomorrow.toDateString()) {
      return { text: `Tomorrow${timeStr ? ' • ' + timeStr : ''}`, class: 'text-blue-600 bg-blue-50' };
    } else {
      const dateText = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return { 
        text: `${dateText}${timeStr ? ' • ' + timeStr : ''}`, 
        class: 'text-gray-600 bg-gray-50' 
      };
    }
  };

  const pendingCount = todos.filter(t => t.status !== 'completed').length;
  const completedCount = todos.filter(t => t.status === 'completed').length;

  return (
    <div className="w-72 bg-white border-r border-gray-200 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <ClipboardDocumentListIcon className="h-5 w-5 text-purple-600" />
            <h2 className="font-semibold text-gray-900">My Tasks</h2>
          </div>
          <button
            onClick={() => {
              // Reset form with current date/time when opening
              setNewTodo({
                title: '',
                description: '',
                priority: 'medium',
                due_date: getTodayDate(),
                due_time: getCurrentTime()
              });
              setShowAddForm(!showAddForm);
            }}
            className="p-1.5 rounded-lg hover:bg-purple-50 text-purple-600 transition-colors"
            title="Add task"
          >
            <PlusIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Stats */}
        <div className="flex items-center space-x-4 text-xs">
          <span className="text-gray-500">
            <span className="font-medium text-gray-900">{pendingCount}</span> pending
          </span>
          {completedCount > 0 && (
            <button
              onClick={() => setShowCompleted(!showCompleted)}
              className="text-gray-500 hover:text-purple-600 transition-colors"
            >
              {showCompleted ? 'Hide' : 'Show'} {completedCount} completed
            </button>
          )}
        </div>
      </div>

      {/* Add Form */}
      {showAddForm && (
        <form onSubmit={handleAddTodo} className="p-3 border-b border-gray-100 bg-gray-50">
          <input
            type="text"
            value={newTodo.title}
            onChange={(e) => setNewTodo(prev => ({ ...prev, title: e.target.value }))}
            placeholder="What needs to be done?"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 mb-2"
            autoFocus
          />
          
          {/* Priority */}
          <div className="mb-2">
            <label className="block text-xs text-gray-500 mb-1">Priority</label>
            <select
              value={newTodo.priority}
              onChange={(e) => setNewTodo(prev => ({ ...prev, priority: e.target.value }))}
              className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
            >
              <option value="low">🟢 Low Priority</option>
              <option value="medium">🟡 Medium Priority</option>
              <option value="high">🔴 High Priority</option>
            </select>
          </div>
          
          {/* Date and Time */}
          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">Due Date & Time</label>
            <div className="flex items-center space-x-2">
              <div className="flex-1 relative">
                <CalendarIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <input
                  type="date"
                  value={newTodo.due_date}
                  onChange={(e) => setNewTodo(prev => ({ ...prev, due_date: e.target.value }))}
                  className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div className="flex-1 relative">
                <ClockIcon className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <input
                  type="time"
                  value={newTodo.due_time}
                  onChange={(e) => setNewTodo(prev => ({ ...prev, due_time: e.target.value }))}
                  className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <button
              type="submit"
              disabled={!newTodo.title.trim()}
              className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add Task
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false);
                setNewTodo({ 
                  title: '', 
                  description: '', 
                  priority: 'medium', 
                  due_date: getTodayDate(),
                  due_time: getCurrentTime()
                });
              }}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Todo List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600"></div>
          </div>
        ) : todos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
            <ClipboardDocumentListIcon className="h-10 w-10 text-gray-300 mb-2" />
            <p className="text-sm text-gray-500">No tasks yet</p>
            <button
              onClick={() => setShowAddForm(true)}
              className="mt-2 text-sm text-purple-600 hover:text-purple-700"
            >
              Add your first task
            </button>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {todos.map((todo) => (
              <div
                key={todo.id}
                className={`p-3 hover:bg-gray-50 transition-colors ${
                  todo.status === 'completed' ? 'opacity-60' : ''
                }`}
              >
                <div className="flex items-start space-x-3">
                  {/* Checkbox */}
                  <button
                    onClick={() => handleToggleStatus(todo)}
                    className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                      todo.status === 'completed'
                        ? 'bg-green-500 border-green-500 text-white'
                        : 'border-gray-300 hover:border-purple-500'
                    }`}
                  >
                    {todo.status === 'completed' && (
                      <CheckIcon className="h-3 w-3" />
                    )}
                  </button>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {editingId === todo.id ? (
                      <EditTodoForm
                        todo={todo}
                        onSave={(updates) => handleUpdateTodo(todo.id, updates)}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <>
                        <p className={`text-sm font-medium ${
                          todo.status === 'completed' ? 'line-through text-gray-500' : 'text-gray-900'
                        }`}>
                          {todo.title}
                        </p>
                        
                        {/* Meta info */}
                        <div className="flex items-center flex-wrap gap-1.5 mt-1">
                          {/* Priority */}
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${PRIORITY_COLORS[todo.priority]}`}>
                            <FlagIcon className="h-3 w-3 mr-0.5" />
                            {PRIORITY_LABELS[todo.priority]}
                          </span>
                          
                          {/* Due date */}
                          {todo.due_date && (() => {
                            const dueInfo = formatDueDate(todo.due_date);
                            return dueInfo ? (
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${dueInfo.class}`}>
                                <CalendarIcon className="h-3 w-3 mr-0.5" />
                                {dueInfo.text}
                              </span>
                            ) : null;
                          })()}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Actions */}
                  {editingId !== todo.id && (
                    <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setEditingId(todo.id)}
                        className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600"
                        title="Edit"
                      >
                        <PencilIcon className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(todo.id)}
                        className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-600"
                        title="Delete"
                      >
                        <TrashIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EditTodoForm({ todo, onSave, onCancel }) {
  // Parse existing date and time
  const parseDateTime = (dateStr) => {
    if (!dateStr) return { date: getTodayDate(), time: getCurrentTime() };
    const date = new Date(dateStr);
    return {
      date: date.toISOString().split('T')[0],
      time: date.toTimeString().slice(0, 5)
    };
  };
  
  const { date: initialDate, time: initialTime } = parseDateTime(todo.due_date);
  
  const [form, setForm] = useState({
    title: todo.title,
    priority: todo.priority,
    due_date: initialDate,
    due_time: initialTime
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    
    // Combine date and time
    let dueDateTime = form.due_date;
    if (form.due_date && form.due_time) {
      dueDateTime = `${form.due_date}T${form.due_time}:00`;
    }
    
    onSave({
      title: form.title,
      priority: form.priority,
      due_date: dueDateTime
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <input
        type="text"
        value={form.title}
        onChange={(e) => setForm(prev => ({ ...prev, title: e.target.value }))}
        className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-purple-500"
        autoFocus
      />
      <div className="flex items-center space-x-2">
        <select
          value={form.priority}
          onChange={(e) => setForm(prev => ({ ...prev, priority: e.target.value }))}
          className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded"
        >
          <option value="low">🟢 Low</option>
          <option value="medium">🟡 Medium</option>
          <option value="high">🔴 High</option>
        </select>
      </div>
      <div className="flex items-center space-x-2">
        <input
          type="date"
          value={form.due_date}
          onChange={(e) => setForm(prev => ({ ...prev, due_date: e.target.value }))}
          className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded"
        />
        <input
          type="time"
          value={form.due_time}
          onChange={(e) => setForm(prev => ({ ...prev, due_time: e.target.value }))}
          className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded"
        />
      </div>
      <div className="flex items-center space-x-2">
        <button
          type="submit"
          className="px-2 py-1 text-xs font-medium text-white bg-purple-600 rounded hover:bg-purple-700"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
