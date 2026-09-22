import crypto from 'node:crypto';

/**
 * ComputerInterface - Unified Computer Use, Terminal & Browser Action Bus
 * Safely executes Terminal commands, Browser interactions, and File changes under capability bounds.
 */
export class ComputerInterface {
  constructor(options = {}) {
    this.allowedPrograms = new Set(options.allowedPrograms || ['git', 'node', 'npm', 'ls', 'cat', 'echo', 'grep']);
    this.virtualFileSystem = new Map();
  }

  /**
   * Plans and validates a Terminal execution proposal
   */
  planTerminalAction(program, args = []) {
    const isAllowed = this.allowedPrograms.has(program);

    return {
      type: 'TERMINAL_EXECUTION',
      program,
      args,
      isAllowed,
      riskLevel: program === 'git' || program === 'npm' ? 'MEDIUM' : 'LOW',
      actionPayloadHash: crypto.createHash('sha256').update(JSON.stringify({ program, args })).digest('hex')
    };
  }

  /**
   * Plans and validates a Browser automation step (Playwright / browser-use compatible)
   */
  planBrowserAction(actionType, targetSelector, value = null) {
    const validActions = ['GOTO', 'CLICK', 'FILL', 'SCREENSHOT', 'EXTRACT_TEXT', 'WAIT_FOR_SELECTOR'];
    const isValid = validActions.includes(actionType.toUpperCase());

    return {
      type: 'BROWSER_AUTOMATION',
      action: actionType.toUpperCase(),
      selector: targetSelector,
      value,
      isValid,
      riskLevel: actionType.toUpperCase() === 'FILL' ? 'MEDIUM' : 'LOW',
      actionPayloadHash: crypto.createHash('sha256').update(JSON.stringify({ actionType, targetSelector, value })).digest('hex')
    };
  }

  /**
   * Plans and commits an atomic File System modification
   */
  planFileMutation(filePath, newContent, expectedDigest = null) {
    const contentHash = crypto.createHash('sha256').update(newContent).digest('hex');

    // Reject dangerous path traversal attempts
    if (filePath.includes('../') || filePath.includes('..\\') || filePath.startsWith('/etc/') || filePath.startsWith('/root/')) {
      return {
        type: 'FILE_MUTATION',
        filePath,
        allowed: false,
        reason: 'Path traversal or protected system directory mutation refused.'
      };
    }

    return {
      type: 'FILE_MUTATION',
      filePath,
      allowed: true,
      contentLength: newContent.length,
      contentHash,
      isCommitted: false
    };
  }
}
