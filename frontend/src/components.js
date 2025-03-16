import React from "react";
import "./styles.css";

export const TaskCard = ({ task, onStatusChange, onPriorityChange, onDelete, onViewDetails }) => {
  const statusOptions = [
    { value: "pending", label: "Pending" },
    { value: "in-progress", label: "In Progress" },
    { value: "completed", label: "Completed" }
  ];

  const priorityOptions = [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" }
  ];

  return (
    <div className={`task-card ${task.status} priority-${task.priority}`}>
      <div className="card-header">
        <h3 className="task-title">{task.description}</h3>
        <button className="delete-btn" onClick={() => onDelete(task.taskId)}>×</button>
      </div>
      
      <div className="card-body">
        <div className="status-row">
          <StatusBadge status={task.status} />
          {task.status === "in-progress" && <ProgressBar progress={calculateProgress(task)} />}
        </div>
        
        <div className="task-meta">
          <div className="meta-item">
            <span className="meta-label">Priority:</span>
            <span className={`priority-tag ${task.priority}`}>{task.priority}</span>
          </div>
          
          <div className="meta-item">
            <span className="meta-label">Due:</span>
            <span>{task.dueDate || "Not set"}</span>
          </div>
        </div>
      </div>
      
      <div className="card-actions">
        <select 
          className="status-select"
          value={task.status}
          onChange={(e) => onStatusChange(task.taskId, e.target.value)}
        >
          {statusOptions.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        
        <select
          className="priority-select"
          value={task.priority}
          onChange={(e) => onPriorityChange(task.taskId, e.target.value)}
        >
          {priorityOptions.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        
        <button className="details-btn" onClick={onViewDetails}>
          View Details
        </button>
      </div>
    </div>
  );
};

// Status Badge Component
export const StatusBadge = ({ status }) => {
  const statusMap = {
    "pending": { label: "Pending", icon: "⏳" },
    "in-progress": { label: "In Progress", icon: "🔄" },
    "completed": { label: "Completed", icon: "✅" },
    "error": { label: "Error", icon: "❌" }
  };
  
  const { label, icon } = statusMap[status] || { label: status, icon: "❓" };
  
  return (
    <span className={`status-badge ${status}`}>
      {icon} {label}
    </span>
  );
};

// Progress Bar Component
export const ProgressBar = ({ progress }) => {
  return (
    <div className="progress-bar-container">
      <div 
        className="progress-bar-fill" 
        style={{ width: `${progress}%` }}
        aria-valuenow={progress}
        aria-valuemin="0"
        aria-valuemax="100"
      />
      <span className="progress-text">{progress}%</span>
    </div>
  );
};

// Task Form Component
export const TaskForm = ({ onSubmit, loading }) => {
  const [description, setDescription] = React.useState("");
  const [priority, setPriority] = React.useState("medium");
  const [dueDate, setDueDate] = React.useState("");
  
  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({ description, priority, dueDate });
  };
  
  return (
    <form className="task-form" onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="task-description">Task Description</label>
        <input
          id="task-description"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What needs to be done?"
          required
        />
      </div>
      
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="task-priority">Priority</label>
          <select 
            id="task-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        
        <div className="form-group">
          <label htmlFor="task-due-date">Due Date (Optional)</label>
          <input
            id="task-due-date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </div>
      </div>
      
      <button 
        type="submit" 
        className="submit-button"
        disabled={loading || !description}
      >
        {loading ? "Adding..." : "Add Task"}
      </button>
    </form>
  );
};

// Error Alert Component
export const ErrorAlert = ({ message, onClose }) => {
  return (
    <div className="error-alert">
      <div className="error-content">
        <span className="error-icon">⚠️</span>
        <p>{message}</p>
      </div>
      <button className="error-close" onClick={onClose}>×</button>
    </div>
  );
};

// Connection Status Component
export const ConnectionStatus = ({ status }) => {
  const statusMap = {
    "connecting": { color: "orange", text: "Connecting..." },
    "connected": { color: "green", text: "Connected" },
    "reconnecting": { color: "orange", text: "Reconnecting..." },
    "failed": { color: "red", text: "Connection Failed" }
  };
  
  const { color, text } = statusMap[status] || { color: "gray", text: status };
  
  return (
    <div className="connection-status" style={{ color }}>
      <span className="status-dot" style={{ backgroundColor: color }}></span>
      <span className="status-text">{text}</span>
    </div>
  );
};

export const calculateProgress = (task) => {
  if (task.status === "completed") return 100;
  if (task.status === "pending") return 0;
  
 
  if (task.result && task.result.agentResults) {
    const totalAgents = Object.keys(task.result.agentResults).length;
    const completedAgents = Object.values(task.result.agentResults)
      .filter(agent => agent.result && !agent.result.startsWith("Error")).length;
    return Math.round((completedAgents / totalAgents) * 100);
  }
  
  return 50; 
};