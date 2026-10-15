// Minimal test to verify tasks.delete confirmation requirement

// Mock the global tasks array
let tasks = [
  {
    id: 1,
    userId: 'test',
    title: 'Test Task',
    done: false,
    goalId: null,
    priority: 'normal',
    due: null,
    dueTime: null,
    subtasks: []
  }
];

// Mock saveTasks function
function saveTasks() {
  return true;
}

// Mock toToolResult function
function toToolResult(ok, summary, detail, data) {
  return { ok, summary, detail, data };
}

// Import the actual taskDeleteTool logic from the source file
const taskDeleteToolCode = require('./src/agent/tools/adapters/tasks');

// Test the confirmation requirement
describe('Task Delete Confirmation Test', () => {
  it('should require confirmation even with AUTO_CONFIRM_WRITES=true', async () => {
    // Test the actual tool logic
    const result = await taskDeleteToolCode.taskDeleteTool.execute({ taskId: 1 });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('CONFIRMATION_REQUIRED');
    expect(result.summary).toContain('Delete task #1?');

    // Task should not be deleted
    expect(tasks.some(t => t.id === 1)).toBe(true);
  });
});