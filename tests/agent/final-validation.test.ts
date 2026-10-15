// Final Validation Test for tasks.delete with AUTO_CONFIRM_WRITES=true

import { describe, it, expect, beforeEach } from 'vitest';
import { tasks } from '../../../core/data';
import { loadConfig } from '../../../agent/config';

let originalEnv = process.env;

function resetEnv(): void {
  process.env = { ...originalEnv };
}

function setEnvAutoConfirm(value: boolean): void {
  process.env.AUTO_CONFIRM_WRITES = value.toString();
}

describe('Final Validation: tasks.delete with AUTO_CONFIRM_WRITES=true', () => {
  beforeEach(() => {
    resetEnv();
    tasks.length = 0;
    tasks.push({
      id: 1,
      userId: 'test',
      title: 'Test Task',
      done: false,
      goalId: null,
      priority: 'normal',
      due: null,
      dueTime: null,
      subtasks: [],
    });
  });

  it('Core Requirement: tasks.delete should require confirmation even with AUTO_CONFIRM_WRITES=true', async () => {
    // Set AUTO_CONFIRM_WRITES to true - this is the key test case
    setEnvAutoConfirm(true);

    // Reload config to pick up environment changes
    delete require.cache[require.resolve('../../../agent/config')];
    const config = require('../../../agent/config').loadConfig();

    console.log('\n=== VALIDATION TEST ===');
    console.log('AUTO_CONFIRM_WRITES:', config.autoConfirmWrites);
    console.log('tasks.delete risk level: sensitive');
    console.log('needsUserConfirmation logic: sensitive tools ALWAYS require confirmation');
    console.log('===================================\n');

    // Verify config shows autoConfirmWrites is true
    expect(config.autoConfirmWrites).toBe(true);

    // Import taskDeleteTool
    const { taskDeleteTool } = await import('../../../agent/tools/adapters/tasks');

    // Execute the tool (simulating the loop.ts behavior)
    const result = await taskDeleteTool.execute({ taskId: 1 });

    // This is the CRITICAL assertion we're testing:
    // Even with AUTO_CONFIRM_WRITES=true, tasks.delete should still require confirmation
    expect(result.ok).toBe(false);
    expect(result.error).toBe('CONFIRMATION_REQUIRED');
    expect(result.summary).toContain('Delete task #1?');

    // Task should NOT be deleted (confirms the requirement works)
    expect(tasks.some(t => t.id === 1)).toBe(true);
    expect(tasks.length).toBe(1);

    console.log('✓ Test PASSED: tasks.delete correctly requires confirmation even with AUTO_CONFIRM_WRITES=true');
    console.log(`✓ Task #1 preserved: ${tasks[0].title}`);
  });
});