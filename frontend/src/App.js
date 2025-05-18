import React, { useEffect, useState, useRef } from "react"; // Added useRef
import axios from "axios";
import "./index.css";

// API and SSE URLs
const API_URL = "http://localhost:3000/tasks";
const EVENT_URL = "http://localhost:3000/events"; // Corrected Port

// AgentPanel Component: Displays individual agent details 
const AgentPanel = ({ agent, expanded, toggleExpand }) => {
  // Get CSS class based on agent status
  const getStatusClass = (status) => {
    switch (status) {
      case "completed": return "status-completed";
      case "in-progress": return "status-in-progress";
      case "pending": return "status-pending";
      case "waiting": return "status-waiting"; // If orchestrator sends this
      case "ready": return "status-ready";     // If orchestrator sends this
      case "error": return "status-error";
      default: return "status-unknown"; // Default for any new statuses
    }
  };

  // Get icon based on agent status
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

  // Format time string (e.g., "10:30:45 AM")
  const formatTime = (timeString) => {
    if (!timeString) return "N/A";
    try {
      return new Date(timeString).toLocaleTimeString();
    } catch (e) {
      return "Invalid Date";
    }
  };

  // Format duration between start and end time
  const formatDuration = (startTime, endTime) => {
    if (!startTime || !endTime) return "";
    try {
      const start = new Date(startTime);
      const end = new Date(endTime);
      const durationMs = end - start;

      if (durationMs < 0) return "0ms"; // Should not happen if times are correct
      if (durationMs < 1000) return `${durationMs}ms`;
      return `${(durationMs / 1000).toFixed(1)}s`;
    } catch (e) {
      return "Invalid duration";
    }
  };

  return (
    <div className={`agent-panel ${getStatusClass(agent.status)}`}>
      <div className="agent-header" onClick={toggleExpand}>
        <div className="agent-status-icon">{getStatusIcon(agent.status)}</div>
        <div className="agent-name">{agent.agentName || agent.agentId}</div> {/* Fallback to agentId if agentName is not present */}
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
            <strong>Task Assigned:</strong> {agent.taskAssigned}
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
                  : String(agent.result)
              }</pre>
            </div>
          )}
           {agent.error && (
            <div className="agent-error">
              <strong>Error:</strong>
              <pre className="error-content">{
                typeof agent.error === 'object' 
                  ? JSON.stringify(agent.error, null, 2) 
                  : String(agent.error)
              }</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Main App Component
function App() {
  // State variables
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
  const [systemStats, setSystemStats] = useState(null);

  // Refs for SSE listeners to access latest state
  const tasksRef = useRef(tasks);
  const expandedTasksRef = useRef(expandedTasks);

  // Keep refs updated
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    expandedTasksRef.current = expandedTasks;
  }, [expandedTasks]);


  // Fetch initial tasks on component mount
  useEffect(() => {
    fetchTasks();
  }, []);

  // Setup Server-Sent Events (SSE)
  useEffect(() => {
    let eventSource;
    let reconnectTimer;

    const connectEventSource = () => {
      if (eventSource) {
        eventSource.close();
      }

      console.log("Connecting to SSE at:", EVENT_URL);
      eventSource = new EventSource(EVENT_URL);
      
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
            if ((task.status === "completed" || task.status === "completed_with_errors") && task.result && !expandedTasksRef.current[task.taskId]) {
              setExpandedTasks(prev => ({ ...prev, [task.taskId]: true }));
              if (task.status === "completed") {
                showNotification(`Task "${task.description}" completed!`);
              }
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
     
          Object.entries(updatedAgentStatus).forEach(([taskId, agentsData]) => {
            const agentsArray = Object.values(agentsData);
            const matchingTask = tasksRef.current.find(t => t.taskId === taskId); // Use ref
            
            if (matchingTask) {
              const allAgentsComplete = agentsArray.every(agent => agent.status === "completed" || agent.status === "error");
              if (allAgentsComplete && !expandedTasksRef.current[taskId]) { // Use ref
                setExpandedTasks(prev => ({ ...prev, [taskId]: true }));
              }
            }
          });
        } catch (err) {
          console.error("Error parsing agent SSE data:", err);
        }
      });

      eventSource.addEventListener("stats", (event) => {
        try {
          const statsData = JSON.parse(event.data);
          console.log("SSE stats update received:", statsData);
          setSystemStats(statsData);
        } catch (err) {
          console.error("Error parsing stats SSE data:", err);
        }
      });
      
      eventSource.onerror = (err) => {
        console.error("SSE connection error:", err);
        setEventSourceConnected(false);
        setError("Real-time connection lost. Attempting to reconnect...");
        eventSource.close();
        
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          console.log("Attempting to reconnect to SSE...");
          connectEventSource();
        }, 5000);
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
  }, []); // Empty dependency array (or [EVENT_URL] if it could change)

  const fetchTaskDetails = async (taskId) => {
    try {
      const response = await axios.get(`${API_URL}/${taskId}`);
      const updatedTask = response.data;
    
      setTasks(prevTasks => 
        prevTasks.map(task => 
          task.taskId === taskId ? updatedTask : task
        )
      );
      
      if (updatedTask.result && (updatedTask.status === "completed" || updatedTask.status === "completed_with_errors")) {
        showNotification(`Task "${updatedTask.description}" result updated!`);
      }
    } catch (err) {
      console.error(`Error fetching task ${taskId} details:`, err);
    }
  };

  const toggleAgentExpand = (taskId, agentId) => {
    const key = `${taskId}-${agentId}`;
    setExpandedAgents(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Corrected toggleTaskExpand
  const toggleTaskExpand = (taskId) => {
    const wasCurrentlyExpanded = expandedTasks[taskId];

    setExpandedTasks(currentExpandedTasks => ({
      ...currentExpandedTasks,
      [taskId]: !currentExpandedTasks[taskId]
    }));

    const task = tasks.find(t => t.taskId === taskId);
    if (task && !wasCurrentlyExpanded) {
      fetchTaskDetails(taskId);
    }
  };

  const showNotification = (message) => {
    setNotification(message);
    setTimeout(() => setNotification(null), 4000);
  };

  const fetchTasks = async () => {
    setLoading(true);
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
      showNotification("Task description cannot be empty.");
      return;
    }
    setNotification("Adding task...");

    try {
      const response = await axios.post(API_URL, { 
        description: newTask, 
        priority, 
        dueDate: dueDate || null
      });
      
      console.log("Task added via API, server response:", response.data);
      setNewTask("");
      setPriority("medium");
      setDueDate("");
      showNotification(`Task "${response.data.description}" submitted successfully!`);
    } catch (err) {
      console.error("Error adding task:", err);
      setError(err.response?.data?.error || "Error adding task. Please try again.");
      showNotification("Failed to add task.");
    } finally {
      if (notification === "Adding task...") setNotification(null);
    }
  };

  const updateStatus = async (taskId, status) => {
    try {
      await axios.put(`${API_URL}/${taskId}/status`, { status });
      setTasks(prev => 
        prev.map(task => 
          task.taskId === taskId ? { ...task, status, updatedAt: new Date().toISOString() } : task
        )
      );
      showNotification(`Task status updated to ${status}.`);
    } catch (err) {
      console.error("Error updating status:", err);
      setError(err.response?.data?.error || "Error updating status.");
      showNotification("Failed to update task status.");
    }
  };

  const updatePriority = async (taskId, newPriority) => {
    try {
      await axios.put(`${API_URL}/${taskId}/priority`, { priority: newPriority });
      setTasks(prev => 
        prev.map(task => 
          task.taskId === taskId ? { ...task, priority: newPriority, updatedAt: new Date().toISOString() } : task
        )
      );
      showNotification(`Task priority updated to ${newPriority}.`);
    } catch (err) {
      console.error("Error updating priority:", err);
      setError(err.response?.data?.error || "Error updating priority.");
      showNotification("Failed to update task priority.");
    }
  };

  const deleteTask = async (taskId) => {
    if (!window.confirm("Are you sure you want to delete this task? This action cannot be undone.")) return;
    
    try {
      await axios.delete(`${API_URL}/${taskId}`);
      setTasks(prev => prev.filter(task => task.taskId !== taskId));
      setAgentStatus(prev => {
        const newStatus = { ...prev };
        delete newStatus[taskId];
        return newStatus;
      });
      showNotification("Task deleted successfully.");
    } catch (err) {
      console.error("Error deleting task:", err);
      setError(err.response?.data?.error || "Error deleting task.");
      showNotification("Failed to delete task.");
    }
  };

  const filteredTasks = tasks.filter(task => {
    if (filter === "all") return true;
    return task.status === filter;
  });

  const sortedTasks = [...filteredTasks].sort((a, b) => {
    if (sortBy === "dueDate") {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate) - new Date(b.dueDate);
    } else if (sortBy === "priority") {
      const priorityValues = { high: 3, medium: 2, low: 1 };
      return (priorityValues[b.priority] || 0) - (priorityValues[a.priority] || 0);
    } else if (sortBy === 'createdAt') {
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
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
      case "decomposing": return "status-decomposing";
      case "evaluating": return "status-evaluating";
      case "completed_with_errors": return "status-completed-errors";
      default: return "status-unknown";
    }
  };

  const formatDate = (dateString, includeTime = false) => {
    if (!dateString) return "N/A";
    try {
      const date = new Date(dateString);
      const options = { year: 'numeric', month: 'short', day: 'numeric' };
      if (includeTime) {
        options.hour = '2-digit';
        options.minute = '2-digit';
      }
      return date.toLocaleDateString(undefined, options);
    } catch (e) {
      return "Invalid Date";
    }
  };

  const isOverdue = (task) => {
    if (!task.dueDate || task.status === "completed" || task.status === "completed_with_errors") return false;
    try {
      return new Date(task.dueDate) < new Date() && task.status !== "pending";
    } catch (e) {
      return false;
    }
  };

  const getAgentStatusSummary = (taskId) => {
    const agentsForTask = agentStatus[taskId];
    if (!agentsForTask || Object.keys(agentsForTask).length === 0) return { counts: {}, total: 0 };
    
    const agentsArray = Object.values(agentsForTask);
    const counts = agentsArray.reduce((acc, agent) => {
      acc[agent.status] = (acc[agent.status] || 0) + 1;
      return acc;
    }, {});
    
    const total = agentsArray.length;
    return { counts, total };
  };

  // JSX for the component
  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Task Orchestrator Dashboard</h1>
        <div className="header-meta">
            <p>Manage tasks with real-time agent execution updates.</p>
            {eventSourceConnected ? (
              <div className="connection-status connected">
                ● Real-time updates connected
              </div>
            ) : (
              <div className="connection-status disconnected">
                ● Real-time updates disconnected {error && "(Attempting to reconnect)"}
              </div>
            )}
        </div>
        {systemStats && (
          <div className="system-stats">
            <h4>System Info:</h4>
            {systemStats.totalDocumentsInDB !== undefined && <span>Vector DB Docs: {systemStats.totalDocumentsInDB} | </span>}
            {systemStats.averageAgentScore !== undefined && <span>Avg. Agent Score: {systemStats.averageAgentScore.toFixed(2)} | </span>}
            {systemStats.lastUpdatedAt && <span>Last Updated: {formatDate(systemStats.lastUpdatedAt, true)}</span>}
          </div>
        )}
      </header>

      {notification && <div className={`notification ${notification.includes("Failed") || notification.includes("Error") ? 'notification-error' : 'notification-success'}`}>{notification}</div>}
      {error && !notification?.includes(error) && <div className="error-message">{error}</div>}


      <div className="main-content">
        <section className="add-task-section card">
          <h2>Add New Task</h2>
          <form className="task-form" onSubmit={addTask}>
            <div className="form-group">
              <label htmlFor="task-description">Task Description:</label>
              <input
                id="task-description"
                type="text"
                placeholder="e.g., Research quantum computing advancements"
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                className="form-control"
                required
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
                <label htmlFor="task-due-date">Due Date (Optional):</label>
                <input
                  id="task-due-date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="form-control"
                  min={new Date().toISOString().split("T")[0]}
                />
              </div>
            </div>
            
            <button 
              type="submit" 
              className="btn btn-primary"
              disabled={loading && tasks.length === 0}
            >
              { (loading && tasks.length === 0) ? 'Loading...' : 'Add Task'}
            </button>
          </form>
        </section>

        <section className="task-list-section card">
          <div className="task-controls">
            <h2>My Tasks {tasks.length > 0 && `(${filteredTasks.length} of ${tasks.length})`}</h2>
            
            <div className="task-filters">
              <div className="filter-group">
                <label htmlFor="status-filter">Filter by Status:</label>
                <select 
                  id="status-filter"
                  value={filter} 
                  onChange={(e) => setFilter(e.target.value)}
                  className="form-control"
                >
                  <option value="all">All</option>
                  <option value="pending">Pending</option>
                  <option value="decomposing">Decomposing</option>
                  <option value="in-progress">In Progress</option>
                  <option value="evaluating">Evaluating</option>
                  <option value="completed">Completed</option>
                  <option value="completed_with_errors">Completed (w/ Errors)</option>
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
                  <option value="createdAt">Created Date</option>
                  <option value="dueDate">Due Date</option>
                  <option value="priority">Priority</option>
                </select>
              </div>
              
              <button 
                onClick={fetchTasks} 
                className="btn btn-secondary"
                title="Manually refresh all tasks"
                disabled={loading}
              >
                {loading ? 'Refreshing...' : '↻ Refresh Tasks'}
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
                  <p>{filter === 'all' ? 'No tasks yet. Add one above!' : `No tasks match the current filter "${filter}".`}</p>
                </div>
              ) : (
                <ul className="task-list">
                  {sortedTasks.map((task) => (
                    <li 
                      key={task.taskId} 
                      className={`task-item card ${getStatusClass(task.status)} ${isOverdue(task) ? 'overdue' : ''}`}
                    >
                      <div className="task-header" onClick={() => toggleTaskExpand(task.taskId)}>
                        <div className="task-title-section">
                          <span className={`priority-indicator ${getPriorityClass(task.priority)}`} title={`Priority: ${task.priority}`}></span>
                          <h3 className="task-title">{task.description}</h3>
                          {(task.status === "completed" || task.status === "completed_with_errors") && task.result && 
                            <span className="result-indicator" title="Results available">✓</span>}
                          {task.overallScore !== null && task.overallScore !== undefined && (
                            <span className="overall-score" title={`Overall Score: ${task.overallScore}`}>
                                Score: {typeof task.overallScore === 'number' ? task.overallScore.toFixed(2) : task.overallScore}
                            </span>
                          )}
                        </div>

                        <div className="task-meta">
                          <span className={`task-status-badge ${getStatusClass(task.status)}`}>
                            {task.status.replace(/_/g, ' ')}
                          </span>
                          
                          {task.agentCount > 0 && (
                            <span className="agent-count" title={`${task.agentCount} agents assigned`}>
                              {task.agentCount} agents
                            </span>
                          )}
                          
                          <span className="task-due-date" title={task.dueDate ? `Due: ${formatDate(task.dueDate)}` : "No due date"}>
                            Due: {formatDate(task.dueDate)}
                          </span>
                          
                          <span className="expand-icon">
                            {expandedTasks[task.taskId] ? '▼' : '►'}
                          </span>
                        </div>
                      </div>

                      {expandedTasks[task.taskId] && (
                        <div className="task-expanded-content">
                          <div className="task-timestamps">
                            <span>Created: {formatDate(task.createdAt, true)}</span>
                            <span>Last Updated: {formatDate(task.updatedAt, true)}</span>
                            {(task.status === "completed" || task.status === "completed_with_errors") && task.completedAt && 
                                <span>Completed: {formatDate(task.completedAt, true)}</span>}
                          </div>
                          <div className="task-actions">
                            <label>Status:
                                <select 
                                value={task.status}
                                onChange={(e) => updateStatus(task.taskId, e.target.value)}
                                className="form-control action-select"
                                >
                                <option value="pending">Pending</option>
                                <option value="decomposing">Decomposing</option>
                                <option value="in-progress">In Progress</option>
                                <option value="evaluating">Evaluating</option>
                                <option value="completed">Completed</option>
                                <option value="completed_with_errors">Completed (w/ Errors)</option>
                                <option value="error">Error</option>
                                </select>
                            </label>
                            
                            <label>Priority:
                                <select 
                                value={task.priority}
                                onChange={(e) => updatePriority(task.taskId, e.target.value)}
                                className="form-control action-select"
                                >
                                <option value="low">Low</option>
                                <option value="medium">Medium</option>
                                <option value="high">High</option>
                                </select>
                            </label>
                            
                            <button 
                              onClick={() => deleteTask(task.taskId)}
                              className="btn btn-danger"
                            >
                              Delete Task
                            </button>
                          </div>
                    
                          {agentStatus[task.taskId] && Object.keys(agentStatus[task.taskId]).length > 0 ? (
                            <>
                              <div className="agent-summary card">
                                <h4>Agent Status Overview ({Object.keys(agentStatus[task.taskId]).length} Agents)</h4>
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
                                            title={`${status.replace(/_/g, ' ')}: ${count} agent(s)`}
                                          >
                                            {count > 0 ? `${count}`: ''}
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div>No agent data available for progress bar.</div>
                                    );
                                  })()}
                                </div>
                              </div>
                              
                              <div className="agent-panels card">
                                <h4>Agent Execution Details</h4>
                                {Object.values(agentStatus[task.taskId]).map((agent) => (
                                  <AgentPanel
                                    key={agent.agentId}
                                    agent={agent}
                                    expanded={expandedAgents[`${task.taskId}-${agent.agentId}`] || false}
                                    toggleExpand={() => toggleAgentExpand(task.taskId, agent.agentId)}
                                  />
                                ))}
                              </div>
                            </>
                          ) : (
                            <div className="no-agents-message">
                              <p>No agent execution data available for this task yet.</p>
                            </div>
                          )}
                         
                          {(task.status === "completed" || task.status === "completed_with_errors") && task.result && (
                            <div className="task-result card">
                              <h4>Final Task Result</h4>
                              <pre className="result-json">
                                {typeof task.result === 'object' ? JSON.stringify(task.result, null, 2) : String(task.result)}
                              </pre>
                            </div>
                          )}
                          {task.evaluations && (task.evaluations.systemEvaluation || task.evaluations.agentEvaluations?.length > 0) && (
                            <div className="task-evaluations card">
                                <h4>Evaluation Summary</h4>
                                {task.evaluations.systemEvaluation?.systemRating !== undefined && (
                                    <p><strong>Overall System Rating:</strong> {task.evaluations.systemEvaluation.systemRating.toFixed(2)}</p>
                                )}
                                {task.evaluations.systemEvaluation?.feedback && (
                                    <p><strong>System Feedback:</strong> {task.evaluations.systemEvaluation.feedback}</p>
                                )}
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
      <footer className="app-footer">
        <p>&copy; {new Date().getFullYear()} Task Orchestrator. All rights reserved.</p>
      </footer>
    </div>
  );
}

export default App;