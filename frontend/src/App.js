import React, { useEffect, useState } from "react";
import axios from "axios";
import "./index.css"; 

const API_URL = "http://localhost:5000/tasks";
const EVENT_URL = "http://localhost:5000/events";

function App() {
  const [tasks, setTasks] = useState([]);
  const [newTask, setNewTask] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [sortBy, setSortBy] = useState("dueDate");
  const [notification, setNotification] = useState(null);

  useEffect(() => {
    fetchTasks();
  }, []);

  // SSE for live updates
  useEffect(() => {
    const eventSource = new EventSource(EVENT_URL);
    
    eventSource.onmessage = (event) => {
      try {
        const updatedTasks = JSON.parse(event.data);
        setTasks(updatedTasks);
        showNotification("Tasks updated in real-time");
      } catch (err) {
        console.error("Error parsing SSE data:", err);
      }
    };

    eventSource.onerror = (err) => {
      console.error("SSE connection error:", err);
      eventSource.close();
      setTimeout(() => {
        const newEventSource = new EventSource(EVENT_URL);
        eventSource.onmessage = eventSource.onmessage;
        eventSource.onerror = eventSource.onerror;
      }, 5000);
    };

    return () => {
      eventSource.close();
    };
  }, []);

  const showNotification = (message) => {
    setNotification(message);
    setTimeout(() => setNotification(null), 3000);
  };

  const fetchTasks = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await axios.get(API_URL);
      setTasks(response.data);
    } catch (err) {
      console.error("Error fetching tasks:", err);
      setError("Error fetching tasks. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const addTask = async (e) => {
    e.preventDefault();
    if (!newTask.trim()) {
      setError("Task description is required!");
      return;
    }

    try {
      await axios.post(API_URL, { description: newTask, priority, dueDate });
      setNewTask("");
      setPriority("medium");
      setDueDate("");
      showNotification("Task added successfully!");
    } catch (err) {
      console.error("Error adding task:", err);
      setError("Error adding task. Please try again.");
    }
  };

  const updateStatus = async (taskId, status) => {
    try {
      await axios.put(`${API_URL}/${taskId}/status`, { status });
      showNotification(`Task status updated to ${status}`);
    } catch (err) {
      console.error("Error updating status:", err);
      setError("Error updating status. Please try again.");
    }
  };

  const updatePriority = async (taskId, newPriority) => {
    try {
      await axios.put(`${API_URL}/${taskId}/priority`, { priority: newPriority });
      showNotification(`Task priority updated to ${newPriority}`);
    } catch (err) {
      console.error("Error updating priority:", err);
      setError("Error updating priority. Please try again.");
    }
  };

  const deleteTask = async (taskId) => {
    if (!window.confirm("Are you sure you want to delete this task?")) return;
    
    try {
      await axios.delete(`${API_URL}/${taskId}`);
      showNotification("Task deleted successfully");
    } catch (err) {
      console.error("Error deleting task:", err);
      setError("Error deleting task. Please try again.");
    }
  };

  const filteredTasks = tasks.filter(task => {
    if (filter === "all") return true;
    return task.status === filter;
  });

  const sortedTasks = [...filteredTasks].sort((a, b) => {
    if (sortBy === "dueDate") {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate) - new Date(b.dueDate);
    } else if (sortBy === "priority") {
      const priorityValues = { high: 3, medium: 2, low: 1 };
      return priorityValues[b.priority] - priorityValues[a.priority];
    }
    return 0;
  });

  const getPriorityClass = (priority) => {
    switch (priority) {
      case "high": return "priority-high";
      case "medium": return "priority-medium";
      case "low": return "priority-low";
      default: return "";
    }
  };

  const getStatusClass = (status) => {
    switch (status) {
      case "completed": return "status-completed";
      case "in-progress": return "status-in-progress";
      case "pending": return "status-pending";
      default: return "";
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };

  const isOverdue = (task) => {
    if (!task.dueDate || task.status === "completed") return false;
    return new Date(task.dueDate) < new Date();
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Task Orchestrator</h1>
        <p>Manage your tasks with real-time updates</p>
      </header>

      {notification && <div className="notification">{notification}</div>}
      {error && <div className="error-message">{error}</div>}

      <div className="main-content">
        <section className="add-task-section">
          <h2>Add New Task</h2>
          <form className="task-form" onSubmit={addTask}>
            <div className="form-group">
              <label htmlFor="task-description">Task Description:</label>
              <input
                id="task-description"
                type="text"
                placeholder="What needs to be done?"
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                className="form-control"
              />
            </div>
            
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="task-priority">Priority:</label>
                <select 
                  id="task-priority"
                  value={priority} 
                  onChange={(e) => setPriority(e.target.value)}
                  className="form-control"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              
              <div className="form-group">
                <label htmlFor="task-due-date">Due Date:</label>
                <input
                  id="task-due-date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="form-control"
                />
              </div>
            </div>
            
            <button type="submit" className="btn btn-primary">
              Add Task
            </button>
          </form>
        </section>

        <section className="task-list-section">
          <div className="task-controls">
            <h2>My Tasks {tasks.length > 0 && `(${filteredTasks.length})`}</h2>
            
            <div className="task-filters">
              <div className="filter-group">
                <label htmlFor="status-filter">Status:</label>
                <select 
                  id="status-filter"
                  value={filter} 
                  onChange={(e) => setFilter(e.target.value)}
                  className="form-control"
                >
                  <option value="all">All</option>
                  <option value="pending">Pending</option>
                  <option value="in-progress">In Progress</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
              
              <div className="filter-group">
                <label htmlFor="sort-by">Sort by:</label>
                <select 
                  id="sort-by"
                  value={sortBy} 
                  onChange={(e) => setSortBy(e.target.value)}
                  className="form-control"
                >
                  <option value="dueDate">Due Date</option>
                  <option value="priority">Priority</option>
                </select>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="loading-spinner">
              <div className="spinner"></div>
              <p>Loading tasks...</p>
            </div>
          ) : (
            <div className="task-list-container">
              {sortedTasks.length === 0 ? (
                <div className="empty-state">
                  <p>No tasks available. Add your first task to get started!</p>
                </div>
              ) : (
                <ul className="task-list">
                  {sortedTasks.map((task) => (
                    <li 
                      key={task.taskId} 
                      className={`task-item ${getStatusClass(task.status)} ${isOverdue(task) ? "overdue" : ""}`}
                    >
                      <div className="task-header">
                        <div className={`priority-badge ${getPriorityClass(task.priority)}`}>
                          {task.priority}
                        </div>
                        <h3 className="task-title">{task.description}</h3>
                      </div>
                      
                      <div className="task-details">
                        <div className="task-detail">
                          <span className="detail-label">Status:</span>
                          <span className={`detail-value ${getStatusClass(task.status)}`}>
                            {task.status}
                          </span>
                        </div>
                        
                        <div className="task-detail">
                          <span className="detail-label">Due:</span>
                          <span className={`detail-value ${isOverdue(task) ? "overdue-text" : ""}`}>
                            {formatDate(task.dueDate)}
                            {isOverdue(task) && " (Overdue)"}
                          </span>
                        </div>
                      </div>

                      {task.result && (
                        <div className="task-result">
                          <h4>Result:</h4>
                          <pre className="result-content">{JSON.stringify(task.result, null, 2)}</pre>
                        </div>
                      )}
                      
                      <div className="task-actions">
                        <div className="action-group">
                          <label htmlFor={`status-${task.taskId}`}>Update Status:</label>
                          <select
                            id={`status-${task.taskId}`}
                            value={task.status}
                            onChange={(e) => updateStatus(task.taskId, e.target.value)}
                            className="form-control"
                          >
                            <option value="pending">Pending</option>
                            <option value="in-progress">In Progress</option>
                            <option value="completed">Completed</option>
                          </select>
                        </div>
                        
                        <div className="action-group">
                          <label htmlFor={`priority-${task.taskId}`}>Update Priority:</label>
                          <select
                            id={`priority-${task.taskId}`}
                            value={task.priority}
                            onChange={(e) => updatePriority(task.taskId, e.target.value)}
                            className="form-control"
                          >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                          </select>
                        </div>
                        
                        <button 
                          onClick={() => deleteTask(task.taskId)}
                          className="btn btn-danger"
                          aria-label="Delete task"
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default App;