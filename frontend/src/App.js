import React, { useEffect, useState } from "react";
import axios from "axios";

const API_URL = "http://localhost:5000/tasks";

function App() {
  const [tasks, setTasks] = useState([]);
  const [newTask, setNewTask] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

 
  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await axios.get(API_URL);
      setTasks(response.data);
    } catch (err) {
      console.error("Error fetching tasks:", err);
      setError("Error fetching tasks");
    } finally {
      setLoading(false);
    }
  };

  const addTask = async () => {
    if (!newTask) return alert("Task description is required!");

    try {
      await axios.post(API_URL, { description: newTask, priority, dueDate });
      
      setNewTask("");
      setPriority("medium");
      setDueDate("");
      fetchTasks(); 
    } catch (err) {
      console.error("Error adding task:", err);
      setError("Error adding task");
    }
  };


  const updateStatus = async (taskId, status) => {
    try {
      await axios.put(`${API_URL}/${taskId}/status`, { status });
      fetchTasks();
    } catch (err) {
      console.error("Error updating status:", err);
      setError("Error updating status");
    }
  };

  const updatePriority = async (taskId, newPriority) => {
    try {
      await axios.put(`${API_URL}/${taskId}/priority`, { priority: newPriority });
      fetchTasks();
    } catch (err) {
      console.error("Error updating priority:", err);
      setError("Error updating priority");
    }
  };

  
  const deleteTask = async (taskId) => {
    try {
      await axios.delete(`${API_URL}/${taskId}`);
      fetchTasks();
    } catch (err) {
      console.error("Error deleting task:", err);
      setError("Error deleting task");
    }
  };

  return (
    <div className="container">
      <h1>Task Orchestrator</h1>

      {error && <div className="error">{error}</div>}
      {loading ? (
        <div>Loading tasks...</div>
      ) : (
        <>
          
          <div className="task-form">
            <input
              type="text"
              placeholder="Enter new task"
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
            />
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
            <button onClick={addTask}>Add Task</button>
          </div>

         
          <ul className="task-list">
            {tasks.length === 0 ? (
              <p>No tasks available.</p>
            ) : (
              tasks.map((task) => (
                <li key={task.taskId} className={`task-item ${task.status}`}>
                  <div>
                    <strong>{task.description}</strong>
                    <p>Status: {task.status}</p>
                    <p>Priority: {task.priority}</p>
                    <p>Due Date: {task.dueDate || "N/A"}</p>

                    
                    {task.result && (
                      <div className="task-result">
                        <strong>Result:</strong>
                        <pre>{JSON.stringify(task.result, null, 2)}</pre>
                      </div>
                    )}

                    
                    <div>
                      <select
                        value={task.status}
                        onChange={(e) =>
                          updateStatus(task.taskId, e.target.value)
                        }
                      >
                        <option value="pending">Pending</option>
                        <option value="in-progress">In Progress</option>
                        <option value="completed">Completed</option>
                      </select>

                      <select
                        value={task.priority}
                        onChange={(e) =>
                          updatePriority(task.taskId, e.target.value)
                        }
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>

                      <button onClick={() => deleteTask(task.taskId)}>
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))
            )}
          </ul>
        </>
      )}
    </div>
  );
}

export default App;
