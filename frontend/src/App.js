import React, { useEffect, useState } from "react";
import axios from "axios";
import "./index.css"; 

const API_URL = "http://localhost:5000/tasks";
const EVENT_URL = "http://localhost:5000/events";


const AgentPanel = ({ agent, expanded, toggleExpand }) => {
  const getStatusClass = (status) => {
    switch (status) {
      case "completed": return "status-completed";
      case "in-progress": return "status-in-progress";
      case "pending": return "status-pending";
      case "waiting": return "status-waiting";
      case "ready": return "status-ready";
      case "error": return "status-error";
      default: return "";
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case "completed": return "✓";
      case "in-progress": return "⟳";
      case "pending": return "⌛";
      case "waiting": return "⏳";
      case "ready": return "▶";
      case "error": return "✗";
      default: return "?";
    }
  };

  const formatTime = (timeString) => {
    if (!timeString) return "";
    return new Date(timeString).toLocaleTimeString();
  };

  const formatDuration = (startTime, endTime) => {
    if (!startTime || !endTime) return "";
    const start = new Date(startTime);
    const end = new Date(endTime);
    const durationMs = end - start;
 
    if (durationMs < 0) return "0ms";
    
    if (durationMs < 1000) {
      return `${durationMs}ms`;
    } else {
      return `${(durationMs / 1000).toFixed(1)}s`;
    }
  };

  return (
    <div className={`agent-panel ${getStatusClass(agent.status)}`}>
      <div className="agent-header" onClick={toggleExpand}>
        <div className="agent-status-icon">{getStatusIcon(agent.status)}</div>
        <div className="agent-name">{agent.agentName}</div>
        <div className="agent-status">{agent.status}</div>
        {agent.startTime && (
          <div className="agent-time">
            {formatTime(agent.startTime)}
            {agent.endTime && ` (${formatDuration(agent.startTime, agent.endTime)})`}
          </div>
        )}
        <div className="expand-collapse-icon">{expanded ? "▼" : "►"}</div>
      </div>
      
      {expanded && (
        <div className="agent-details">
          <div className="agent-task">
            <strong>Task:</strong> {agent.taskAssigned}
          </div>
          
          {agent.dependencies && agent.dependencies.length > 0 && (
            <div className="agent-dependencies">
              <strong>Dependencies:</strong> {agent.dependencies.join(", ")}
              {agent.pendingDependencies && agent.pendingDependencies.length > 0 && (
                <div className="pending-dependencies">
                  <em>Waiting for: {agent.pendingDependencies.join(", ")}</em>
                </div>
              )}
            </div>
          )}
          
          {agent.parallelGroup && (
            <div className="agent-group">
              <strong>Group:</strong> {agent.parallelGroup}
            </div>
          )}
          
          {agent.result && (
            <div className="agent-result">
              <strong>Result:</strong>
              <pre className="result-content">{
                typeof agent.result === 'object' 
                  ? JSON.stringify(agent.result, null, 2) 
                  : agent.result
              }</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function App() {
  const [tasks, setTasks] = useState([]);
  const [newTask, setNewTask] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");
  const [sortBy, setSortBy] = useState("dueDate");
  const [notification, setNotification] = useState(null);
  const [agentStatus, setAgentStatus] = useState({});
  const [expandedAgents, setExpandedAgents] = useState({});
  const [expandedTasks, setExpandedTasks] = useState({});
  const [eventSourceConnected, setEventSourceConnected] = useState(false);


  useEffect(() => {
    fetchTasks();
  }, []);

  
  useEffect(() => {
    let eventSource;
    let reconnectTimer;

    const connectEventSource = () => {
      
      if (eventSource) {
        eventSource.close();
      }

      eventSource = new EventSource(EVENT_URL);
      console.log("Connecting to SSE...");
      
      eventSource.onopen = () => {
        console.log("SSE connection established");
        setEventSourceConnected(true);
        setError("");
        
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      };
      
      eventSource.addEventListener("tasks", (event) => {
        try {
          const updatedTasks = JSON.parse(event.data);
          console.log("SSE tasks update received:", updatedTasks);
      
          setTasks(updatedTasks);
       
          updatedTasks.forEach(task => {
            if (task.status === "completed" && task.result && !expandedTasks[task.taskId]) {
              setExpandedTasks(prev => ({
                ...prev,
                [task.taskId]: true
              }));
              
              showNotification(`Task "${task.description}" completed!`);
            }
          });
          
        } catch (err) {
          console.error("Error parsing task SSE data:", err);
         
        }
      });

      eventSource.addEventListener("agents", (event) => {
        try {
          const updatedAgentStatus = JSON.parse(event.data);
          console.log("SSE agents update received:", updatedAgentStatus);
          setAgentStatus(updatedAgentStatus);
     
          const tasksToFetch = new Set();
          
          Object.entries(updatedAgentStatus).forEach(([taskId, agents]) => {
            const matchingTask = tasks.find(t => t.taskId === taskId);
            
            if (matchingTask) {
              const allComplete = agents.every(agent => agent.status === "completed");
              const hasCompletedAgents = agents.some(agent => agent.status === "completed" && agent.result);
            
              if (hasCompletedAgents) {
                tasksToFetch.add(taskId);
              }
              
              if (allComplete && !expandedTasks[taskId]) {
                setExpandedTasks(prev => ({
                  ...prev,
                  [taskId]: true
                }));
              }
            }
          });
         
          tasksToFetch.forEach(taskId => {
            fetchTaskDetails(taskId);
          });
          
        } catch (err) {
          console.error("Error parsing agent SSE data:", err);
     
        }
      });
      
      eventSource.onerror = (err) => {
        console.error("SSE connection error:", err);
        setEventSourceConnected(false);
        setError("Real-time connection lost. Attempting to reconnect...");
        eventSource.close();
        
        
        reconnectTimer = setTimeout(() => {
          console.log("Attempting to reconnect to SSE...");
          connectEventSource();
        }, 3000);
      };
    };

    connectEventSource();

    return () => {
      console.log("Cleaning up SSE connection");
      if (eventSource) {
        eventSource.close();
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
    };
  
  }, []);

  const fetchTaskDetails = async (taskId) => {
    try {
      const response = await axios.get(`${API_URL}/${taskId}`);
      const updatedTask = response.data;
    
      setTasks(prevTasks => 
        prevTasks.map(task => 
          task.taskId === taskId ? updatedTask : task
        )
      );
      
      if (updatedTask.result && updatedTask.status === "completed") {
        showNotification(`Task "${updatedTask.description}" result updated!`);
      }
      
    } catch (err) {
      console.error(`Error fetching task ${taskId} details:`, err);
    }
  };

  const toggleAgentExpand = (taskId, agentId) => {
    setExpandedAgents(prev => {
      const key = `${taskId}-${agentId}`;
      return {
        ...prev,
        [key]: !prev[key]
      };
    });
  };

  const toggleTaskExpand = (taskId) => {
    setExpandedTasks(prev => ({
      ...prev,
      [taskId]: !prev[taskId]
    }));
  };

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
      console.log("Tasks fetched from API:", response.data);
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

    setLoading(true);
    try {
      const response = await axios.post(API_URL, { 
        description: newTask, 
        priority, 
        dueDate 
      });
      
      console.log("Task added:", response.data);
      
      setTasks(prev => [...prev, response.data]);
      
      setNewTask("");
      setPriority("medium");
      setDueDate("");
      showNotification("Task added successfully!");
    } catch (err) {
      console.error("Error adding task:", err);
      setError("Error adding task. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (taskId, status) => {
    try {
      await axios.put(`${API_URL}/${taskId}/status`, { status });
 
      setTasks(prev => 
        prev.map(task => 
          task.taskId === taskId ? { ...task, status } : task
        )
      );
      
      showNotification(`Task status updated to ${status}`);
    } catch (err) {
      console.error("Error updating status:", err);
      setError("Error updating status. Please try again.");
    }
  };

  const updatePriority = async (taskId, newPriority) => {
    try {
      await axios.put(`${API_URL}/${taskId}/priority`, { priority: newPriority });

      setTasks(prev => 
        prev.map(task => 
          task.taskId === taskId ? { ...task, priority: newPriority } : task
        )
      );
      
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

      setTasks(prev => prev.filter(task => task.taskId !== taskId));

      setAgentStatus(prev => {
        const newStatus = { ...prev };
        delete newStatus[taskId];
        return newStatus;
      });
      
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
      case "error": return "status-error";
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

  const getAgentStatusSummary = (taskId) => {
    const agents = agentStatus[taskId] || [];
    if (!agents.length) return { counts: {}, total: 0 };
    
    const counts = agents.reduce((acc, agent) => {
      acc[agent.status] = (acc[agent.status] || 0) + 1;
      return acc;
    }, {});
    
    const total = agents.length;
    return { counts, total };
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Task Orchestrator</h1>
        <p>Manage your tasks with real-time agent execution updates</p>
        {eventSourceConnected ? (
          <div className="connection-status connected">
            ● Real-time updates connected
          </div>
        ) : (
          <div className="connection-status disconnected">
            ● Real-time updates disconnected
          </div>
        )}
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
            
            <button 
              type="submit" 
              className="btn btn-primary"
              disabled={loading}
            >
              {loading ? 'Adding...' : 'Add Task'}
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
                  <option value="error">Error</option>
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
              
              <button 
                onClick={fetchTasks} 
                className="btn btn-secondary"
                title="Manually refresh tasks"
              >
                ↻ Refresh
              </button>
            </div>
          </div>

          {loading && tasks.length === 0 ? (
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
                      className={`task-item ${getStatusClass(task.status)} ${isOverdue(task) ? 'overdue' : ''}`}
                    >
                      <div className="task-header" onClick={() => toggleTaskExpand(task.taskId)}>
                        <div className="task-title-section">
                          <span className={`priority-indicator ${getPriorityClass(task.priority)}`}></span>
                          <h3 className="task-title">{task.description}</h3>
                          {task.result && <span className="result-indicator">✓ Results available</span>}
                        </div>

                        <div className="task-meta">
                          <span className={`task-status ${getStatusClass(task.status)}`}>
                            {task.status}
                          </span>
                          
                          {task.agentCount > 0 && (
                            <span className="agent-count">
                              {task.agentCount} agents
                            </span>
                          )}
                          
                          <span className="task-due-date">
                            Due: {formatDate(task.dueDate)}
                          </span>
                          
                          <span className="expand-icon">
                            {expandedTasks[task.taskId] ? '▼' : '►'}
                          </span>
                        </div>
                      </div>

                      {expandedTasks[task.taskId] && (
                        <div className="task-expanded-content">
                          <div className="task-actions">
                            <select 
                              value={task.status}
                              onChange={(e) => updateStatus(task.taskId, e.target.value)}
                              className="form-control"
                            >
                              <option value="pending">Pending</option>
                              <option value="in-progress">In Progress</option>
                              <option value="completed">Completed</option>
                              <option value="error">Error</option>
                            </select>
                            
                            <select 
                              value={task.priority}
                              onChange={(e) => updatePriority(task.taskId, e.target.value)}
                              className="form-control"
                            >
                              <option value="low">Low Priority</option>
                              <option value="medium">Medium Priority</option>
                              <option value="high">High Priority</option>
                            </select>
                            
                            <button 
                              onClick={() => deleteTask(task.taskId)}
                              className="btn btn-danger"
                            >
                              Delete
                            </button>
                          </div>
                    
                          {agentStatus[task.taskId] && agentStatus[task.taskId].length > 0 && (
                            <div className="agent-summary">
                              <h4>Agent Status Overview</h4>
                              <div className="agent-status-bars">
                                {(() => {
                                  const { counts, total } = getAgentStatusSummary(task.taskId);
                                  return total > 0 ? (
                                    <div className="status-progress-bar">
                                      {Object.entries(counts).map(([status, count]) => (
                                        <div 
                                          key={status}
                                          className={`status-segment ${getStatusClass(status)}`}
                                          style={{ width: `${(count / total) * 100}%` }}
                                          title={`${status}: ${count} agents`}
                                        >
                                          {count > 0 && `${count}`}
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div>No agent data available</div>
                                  );
                                })()}
                              </div>
                            </div>
                          )}
                      
                          {agentStatus[task.taskId] && agentStatus[task.taskId].length > 0 ? (
                            <div className="agent-panels">
                              <h4>Agent Execution Details</h4>
                              {agentStatus[task.taskId].map((agent) => (
                                <AgentPanel
                                  key={agent.agentId}
                                  agent={agent}
                                  expanded={expandedAgents[`${task.taskId}-${agent.agentId}`] || false}
                                  toggleExpand={() => toggleAgentExpand(task.taskId, agent.agentId)}
                                />
                              ))}
                            </div>
                          ) : (
                            <div className="no-agents-message">
                              <p>No agent data available for this task yet.</p>
                            </div>
                          )}
                         
                          {task.result && (
                            <div className="task-result">
                              <h4>Task Result</h4>
                              <pre className="result-json">
                                {JSON.stringify(task.result, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      )}
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